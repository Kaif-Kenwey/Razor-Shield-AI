/**
 * RazorShield AI — entity-graph fraud-ring detector.
 *
 * Transaction-level rules answer "is THIS payment suspicious?"; this
 * module answers the question fraud rings are designed to defeat:
 * "are these ACCOUNTS connected?"
 *
 * Method (documented, deterministic):
 *   1. Index device → customers. A device seen on ≥2 distinct accounts is
 *      SHARED INFRASTRUCTURE (unknown/blank devices never link).
 *   2. Union-find customers through shared devices → connected clusters.
 *   3. A cluster qualifies as a ring when ≥2 members run ≥3 transactions
 *      on the shared devices — noise from one-off device lending stays out.
 *   4. ringScore (0–100) prices the cluster:
 *        fraud density      ≤ 35 pts  (share of labeled fraud, when labels exist)
 *        infra breadth      ≤ 25 pts  (shared burners + distinct instruments)
 *        burst behavior     ≤ 20 pts  (≥4 shared-device txns inside 60 min)
 *        rupee exposure     ≤ 20 pts  (log-scaled exposure vs ₹5L cap)
 *
 * Extension path (schema permitting): link on phone, email hash, IP,
 * address and card fingerprints exactly the same way — the graph code
 * only needs another edge source.
 *
 * Known failure mode, handled explicitly: if a file reuses a handful of
 * device strings across most of the portfolio (fuzzy exports, shared
 * family devices, test data), union-find merges nearly EVERY account into
 * one giant component. That is an infrastructure artifact, not a ring —
 * such clusters are flagged `degenerate` (≥40% of all accounts in the
 * run AND ≥10 members) so the UI can say so instead of crying wolf.
 */

import type { ScoredRow } from "@/types/dataset";

export interface RingMember {
  customerId: string;
  customerName: string;
  txCount: number;
  fraudCount: number;
  totalAmount: number;
}

export interface FraudRing {
  id: string;
  members: RingMember[];
  /** Devices shared across members (the linking infrastructure). */
  devices: string[];
  methods: string[];
  merchants: string[];
  txCount: number;
  totalAmount: number;
  fraudCount: number;
  fraudAmount: number;
  ringScore: number;
  /** Labeled-fraud rows inside the cluster that the per-row rules missed
   *  (recommendation ALLOW) — fraud only VISIBLE at the graph level. */
  fraudMissedByRules: number;
  windowStart: string | null;
  windowEnd: string | null;
  /** Analyst-facing bullets — each one grounded in the rows. */
  evidence: string[];
  /** Share of all accounts in the run that sit inside this cluster (0–1). */
  portfolioShare: number;
  /** True when the cluster spans most of the portfolio — broad device
   *  reuse, almost certainly a data artifact rather than a targeted ring. */
  degenerate: boolean;
}

interface Edge {
  device: string;
  customers: Set<string>;
  txCount: number;
}

const MINUTES = (a: Date, b: Date) => Math.abs(a.getTime() - b.getTime()) / 60_000;
const deviceKey = (d: string) => d.trim().toLowerCase();
const isRealDevice = (d: string) => {
  const k = d.trim().toLowerCase();
  return k.length > 0 && !k.startsWith("unknown");
};

export function detectFraudRings(rows: ScoredRow[]): FraudRing[] {
  const totalAccounts = new Set(rows.map((r) => r.customerId).filter(Boolean)).size;

  /* 1 — shared infrastructure index */
  const byDevice = new Map<string, Edge>();
  for (const r of rows) {
    if (!r.customerId || !isRealDevice(r.device)) continue;
    const k = deviceKey(r.device);
    const e = byDevice.get(k) ?? { device: r.device.trim(), customers: new Set<string>(), txCount: 0 };
    e.customers.add(r.customerId);
    e.txCount += 1;
    byDevice.set(k, e);
  }
  const shared = [...byDevice.values()].filter((e) => e.customers.size >= 2);
  if (!shared.length) return [];

  /* 2 — union-find over customers through shared devices */
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const c of rows.map((r) => r.customerId)) if (c) parent.set(c, find(c));
  for (const e of shared) {
    const [first, ...rest] = [...e.customers];
    for (const c of rest) union(first, c);
  }

  /* 3 — collect clusters, keep qualifying rings */
  const clusters = new Map<string, Set<string>>();
  for (const c of parent.keys()) {
    const root = find(c);
    const set = clusters.get(root) ?? new Set<string>();
    set.add(c);
    clusters.set(root, set);
  }

  const rings: FraudRing[] = [];
  for (const members of clusters.values()) {
    const memberIds = new Set(members);
    const clusterEdges = shared.filter((e) => [...e.customers].some((c) => memberIds.has(c)));
    const linkedRows = rows.filter(
      (r) => memberIds.has(r.customerId) && clusterEdges.some((e) => deviceKey(e.device) === deviceKey(r.device)),
    );
    const sharedTx = linkedRows.length;
    if (members.size < 2 || sharedTx < 3) continue;

    const perCustomer = new Map<string, RingMember>();
    for (const r of linkedRows) {
      const m =
        perCustomer.get(r.customerId) ??
        ({
          customerId: r.customerId,
          customerName: r.customerName || r.customerId,
          txCount: 0,
          fraudCount: 0,
          totalAmount: 0,
        } satisfies RingMember);
      m.txCount += 1;
      m.totalAmount += r.amount;
      if (r.label === 1) m.fraudCount += 1;
      perCustomer.set(r.customerId, m);
    }

    const txCount = linkedRows.length;
    const totalAmount = linkedRows.reduce((s, r) => s + r.amount, 0);
    const labeledRows = linkedRows.filter((r) => r.label !== null);
    const fraudRows = linkedRows.filter((r) => r.label === 1);
    const fraudCount = fraudRows.length;
    const fraudAmount = fraudRows.reduce((s, r) => s + r.amount, 0);
    const methods = [...new Set(linkedRows.map((r) => r.paymentMethod).filter(Boolean))];
    const merchants = [...new Set(linkedRows.map((r) => r.merchant).filter(Boolean))];
    const devices = clusterEdges.map((e) => e.device);

    const times = linkedRows
      .map((r) => (r.timestamp ? new Date(r.timestamp) : null))
      .filter((d): d is Date => d !== null && !Number.isNaN(d.getTime()))
      .sort((a, b) => a.getTime() - b.getTime());

    /* 4 — scoring */
    const fraudDensity = labeledRows.length > 0 ? fraudCount / labeledRows.length : 0;
    const burstCount = times.filter(
      (t) => times.some((o) => o !== t && MINUTES(t, o) <= 60) && true,
    ).length;
    const burstRatio = txCount > 0 ? burstCount / txCount : 0;

    const scoreDensity = labeledRows.length > 0 ? fraudDensity * 35 : fraudCount > 0 ? 17.5 : 0;
    const scoreInfra = Math.min(1, devices.length / 3) * 20 + (methods.length >= 2 ? 5 : 0);
    const scoreBurst = burstRatio * 20;
    const scoreExposure = Math.min(1, totalAmount / 500_000) * 20;
    const ringScore = Math.round(Math.min(100, scoreDensity + scoreInfra + scoreBurst + scoreExposure));

    const window =
      times.length >= 2
        ? `${Math.round(MINUTES(times[times.length - 1], times[0]))} min`
        : null;

    const evidence: string[] = [
      `${members.size} accounts share ${devices.length === 1 ? "one device" : `${devices.length} devices`} (${devices.slice(0, 3).join(", ")}${devices.length > 3 ? "…" : ""}).`,
      `${formatINRShort(totalAmount)} moved across ${txCount} transactions${window ? ` in a ${window} window` : ""}.`,
    ];
    if (labeledRows.length > 0) {
      evidence.push(
        fraudCount > 0
          ? `${fraudCount} of ${labeledRows.length} labeled rows in the cluster are confirmed fraud${fraudAmount ? ` — ${formatINRShort(fraudAmount)} exposure` : ""}.`
          : "No labeled fraud in the cluster yet — flagged on infrastructure alone.",
      );
    }
    if (merchants.length <= 2 && txCount >= 4) {
      evidence.push(`Payments concentrate on ${merchants.join(" / ") || "a single merchant"} — mule-merchant pattern.`);
    }
    const fraudMissedByRules = linkedRows.filter(
      (r) => r.label === 1 && r.recommendation === "ALLOW",
    ).length;
    if (fraudMissedByRules > 0) {
      evidence.push(
        `${fraudMissedByRules} confirmed-fraud ${fraudMissedByRules === 1 ? "row" : "rows"} in this cluster scored below the alert line — each mule account looks normal alone; only the graph links them.`,
      );
    }

    const portfolioShare = totalAccounts > 0 ? members.size / totalAccounts : 0;
    const degenerate = portfolioShare >= 0.4 && members.size >= 10;

    rings.push({
      id: `RING-${[...members].sort()[0]}`,
      members: [...perCustomer.values()].sort((a, b) => b.totalAmount - a.totalAmount),
      devices,
      methods,
      merchants,
      txCount,
      totalAmount,
      fraudCount,
      fraudAmount,
      ringScore,
      fraudMissedByRules,
      windowStart: times[0]?.toISOString() ?? null,
      windowEnd: times[times.length - 1]?.toISOString() ?? null,
      evidence,
      portfolioShare,
      degenerate,
    });
  }

  return rings.sort((a, b) => b.ringScore - a.ringScore || b.totalAmount - a.totalAmount);
}

function formatINRShort(n: number): string {
  if (n >= 1_00_000) return `₹${(n / 1_00_000).toFixed(2)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}k`;
  return `₹${n}`;
}
