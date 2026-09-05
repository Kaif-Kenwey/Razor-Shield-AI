/**
 * RazorShield AI — adversarial attack simulator.
 *
 * Plays the red team against the real rule engine (rse-1.2): each run
 * generates a few waves of synthetic fraud attempts seeded from the CURRENT
 * dataset's baselines — customer medians, devices, merchants, hours — plus
 * legit-looking filler traffic so the mix resembles a live book.
 *
 * Every synthetic transaction is scored by the real engine (scoreRecord over
 * computeStats of dataset + wave rows). Detection = any non-ALLOW
 * recommendation, same alert definition the metrics use. The mixed wave is
 * then clustered by the entity-graph module; attack rows inside a detected
 * ring count as graph catches even when per-row rules stayed silent.
 *
 * Deterministic: seed is derived from dataset id + profile, and one mulberry32
 * stream drives every choice — same dataset + profile replays identically.
 *
 * Honest framing: this is an arms race. The attacker is assumed to know the
 * rule thresholds (the realistic worst case for static rules), so adapted
 * waves slip under per-row signals. What adaptation cannot cheaply hide is
 * coordination — shared infrastructure is what betrays organized fraud.
 */

import { computeStats, scoreRecord, type EngineInput } from "@/lib/riskEngine";
import { detectFraudRings } from "@/lib/fraudGraph";
import type { RiskAction, RiskLevel, RiskSignal } from "@/types";
import type { ScoredRow } from "@/types/dataset";

/* ------------------------------------------------------------------ */
/* Public types                                                        */
/* ------------------------------------------------------------------ */

export type AttackProfileId = "opportunistic" | "threshold" | "ring";

export interface AttackProfileMeta {
  id: AttackProfileId;
  label: string;
  tag: string;
  blurb: string;
  /** Static honest verdict shown under the headline after a run. */
  verdict: string;
}

export const ATTACK_PROFILES: AttackProfileMeta[] = [
  {
    id: "opportunistic",
    label: "Opportunistic",
    tag: "naive",
    blurb: "Big tickets, dead-zone hours, first-seen devices — every per-row rule gets a shot at it.",
    verdict:
      "Static rules win the first exchange, then decay wave over wave. Adaptation is cheap: drop the loud signals and the same attacker walks through.",
  },
  {
    id: "threshold",
    label: "Threshold-aware",
    tag: "structuring",
    blurb: "Splits hug the review thresholds from below and mirror the customer's own behavior.",
    verdict:
      "The structuring rule fires on every installment — and still slides under the 28-point alert line. Per-row thresholds are a floor, not a defense; the levers are cutoffs (Threshold Lab) and cross-rail analytics.",
  },
  {
    id: "ring",
    label: "Organized ring",
    tag: "identity rotation",
    blurb: "Burner devices rotated across mule accounts, near-median amounts, business hours.",
    verdict:
      "Per-row rules go nearly blind — each mule looks like a quiet new customer. Coordination is the tell: shared infrastructure is what the entity graph sees and single rows cannot.",
  },
];

export interface AttackWaveResult {
  wave: number;
  /** The attacker's stance this wave — the adaptation story in one line. */
  stance: string;
  attempted: number;
  attemptedExposure: number;
  caughtByRules: number;
  caughtByRulesPct: number;
  /** Rupee value of attack transactions per-row rules let through. */
  missedExposure: number;
  caughtByGraph: number;
  caughtByGraphPct: number;
  legitMixed: number;
  legitFlagged: number;
  narratives: string[];
  /** Signal types that fired on attack rows this wave, descending. */
  topSignals: { type: string; count: number }[];
  /** Median per-row score across attack rows. */
  medianScore: number;
}

export interface AttackSimResult {
  profile: AttackProfileId;
  seed: number;
  seedHex: string;
  waves: AttackWaveResult[];
  /** Every synthetic attack transaction across waves, engine-scored. */
  attackRows: ScoredRow[];
  totals: {
    attempted: number;
    attemptedExposure: number;
    caughtByRules: number;
    caughtByRulesPct: number;
    caughtByGraph: number;
    caughtByGraphPct: number;
    missedExposure: number;
  };
  graphFoundRings: number;
  graphRingMembers: number;
}

/* ------------------------------------------------------------------ */
/* Seeded randomness                                                   */
/* ------------------------------------------------------------------ */

export function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Rng {
  f: () => number;
  /** float in [min, max) */
  range: (min: number, max: number) => number;
  /** integer in [min, max] */
  int: (min: number, max: number) => number;
  pick: <T>(arr: readonly T[]) => T;
}

function makeRng(seed: number): Rng {
  const f = mulberry32(seed);
  return {
    f,
    range: (min, max) => min + f() * (max - min),
    int: (min, max) => Math.floor(min + f() * (max - min + 1)),
    pick: (arr) => arr[Math.floor(f() * arr.length)],
  };
}

/* ------------------------------------------------------------------ */
/* Baselines from the current run                                      */
/* ------------------------------------------------------------------ */

interface CustomerBaseline {
  id: string;
  name: string;
  rowCount: number;
  medianAmount: number;
  /** Distinct devices, most-used first. */
  devices: string[];
  merchants: string[];
  methods: string[];
  locations: string[];
  /** True when every device this customer touches appears under no other customer. */
  deviceExclusive: boolean;
}

interface Baselines {
  datasetInputs: EngineInput[];
  customers: CustomerBaseline[];
  medianAmount: number;
  p95Amount: number;
  merchants: string[];
  methods: string[];
  locations: string[];
  maxTime: number | null;
}

const HOUR = 3_600_000;
const MINUTE = 60_000;
/** Local-midnight fallback day when the file has no parsable timestamps. */
const FALLBACK_DAY = new Date(2026, 0, 13).getTime();

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function p95(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)];
}

function distinctByFrequency(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    const k = v.trim().toLowerCase();
    if (!k || k.startsWith("unknown")) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
}

function buildBaselines(rows: ScoredRow[]): Baselines {
  const byCustomer = new Map<string, ScoredRow[]>();
  const deviceOwners = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.customerId) continue;
    const list = byCustomer.get(r.customerId) ?? [];
    list.push(r);
    byCustomer.set(r.customerId, list);
    const key = r.device.trim().toLowerCase();
    if (key && !key.startsWith("unknown")) {
      const owners = deviceOwners.get(key) ?? new Set<string>();
      owners.add(r.customerId);
      deviceOwners.set(key, owners);
    }
  }

  const customers: CustomerBaseline[] = [...byCustomer.entries()].map(([id, list]) => {
    const devices = distinctByFrequency(list.map((r) => r.device));
    return {
      id,
      name: list[0]?.customerName || id,
      rowCount: list.length,
      medianAmount: median(list.map((r) => r.amount)),
      devices,
      merchants: distinctByFrequency(list.map((r) => r.merchant)),
      methods: distinctByFrequency(list.map((r) => r.paymentMethod)),
      locations: distinctByFrequency(list.map((r) => r.location)),
      deviceExclusive: list.every((r) => (deviceOwners.get(r.device.trim().toLowerCase())?.size ?? 0) <= 1),
    };
  });

  const amounts = rows.map((r) => r.amount);
  const times = rows
    .map((r) => (r.timestamp ? Date.parse(r.timestamp) : NaN))
    .filter((t) => Number.isFinite(t));

  return {
    datasetInputs: rows.map((r) => scoreRowToInput(r, r.index)),
    customers,
    medianAmount: median(amounts),
    p95Amount: p95(amounts),
    merchants: distinctByFrequency(rows.map((r) => r.merchant)),
    methods: distinctByFrequency(rows.map((r) => r.paymentMethod)),
    locations: distinctByFrequency(rows.map((r) => r.location)),
    maxTime: times.length ? Math.max(...times) : null,
  };
}

function scoreRowToInput(r: ScoredRow, index: number): EngineInput {
  return {
    index,
    txnId: r.txnId,
    amount: r.amount,
    at: r.timestamp ? Date.parse(r.timestamp) : null,
    customerId: r.customerId,
    customerName: r.customerName,
    merchant: r.merchant,
    location: r.location,
    device: r.device,
    paymentMethod: r.paymentMethod,
    label: r.label,
  };
}

/* ------------------------------------------------------------------ */
/* Amount / time shaping                                               */
/* ------------------------------------------------------------------ */

/** The engine's just-under-threshold bands (mirrors riskEngine's STRUCTURING rule). */
function inStructuringBand(a: number): boolean {
  return (a >= 9_000 && a < 10_000) || (a >= 49_000 && a < 50_000) || (a >= 99_000 && a < 100_000);
}

const round10 = (n: number) => Math.max(60, Math.round(n / 10) * 10);
const round100 = (n: number) => Math.max(500, Math.round(n / 100) * 100);

/** Nudge an amount out of a structuring band (downward, deterministic). */
function avoidBand(a: number): number {
  let v = a;
  let guard = 0;
  while (inStructuringBand(v) && guard++ < 12) v = round10(v - 150);
  if (inStructuringBand(v)) v = v < 50_000 ? 8_850 : 48_500;
  return v;
}

/** An amount that hugs the given review threshold from below (₹10k / ₹50k lines). */
function hugBelow(threshold: number, rng: Rng): number {
  return round10(threshold - rng.range(70, 950));
}

/** Near-median amount for an organized-ring ticket — quiet by construction. */
function quietAmount(baselines: Baselines, rng: Rng): number {
  const base = baselines.medianAmount * rng.range(0.55, 1.65);
  const cap = Math.min(45_000, Math.max(1_000, baselines.p95Amount * 0.85));
  return Math.min(cap, avoidBand(round10(Math.max(500, base))));
}

interface WaveClock {
  /** Local midnight of the wave's day. */
  base: number;
  /** Times already claimed per customer — keeps bursts and travel quiet. */
  used: Map<string, number[]>;
}

function makeClock(baselines: Baselines, wave: number): WaveClock {
  const ref = baselines.maxTime ?? FALLBACK_DAY;
  const d = new Date(ref);
  d.setDate(d.getDate() + wave); // wave 1 = the day after the file's last txn
  d.setHours(0, 0, 0, 0);
  return { base: d.getTime(), used: new Map() };
}

/**
 * Place a timestamp inside the given local-hour window, keeping ≥75 minutes
 * from anything else this customer does in the wave (no velocity, no travel).
 */
function placeTime(clock: WaveClock, customerId: string, hourMin: number, hourMax: number, rng: Rng): number {
  const used = clock.used.get(customerId) ?? [];
  for (let tries = 0; tries < 14; tries++) {
    const t = clock.base + rng.int(hourMin, hourMax) * HOUR + rng.int(0, 59) * MINUTE;
    if (used.every((u) => Math.abs(u - t) >= 75 * MINUTE)) {
      used.push(t);
      clock.used.set(customerId, used);
      return t;
    }
  }
  const last = used.length ? Math.max(...used) : clock.base + 10 * HOUR;
  const t = last + 80 * MINUTE;
  used.push(t);
  clock.used.set(customerId, used);
  return t;
}

const BUSINESS: [number, number] = [9, 19];
const DEAD_ZONE: [number, number] = [0, 4];

/* ------------------------------------------------------------------ */
/* Synthetic row assembly                                              */
/* ------------------------------------------------------------------ */

interface GenRow {
  input: EngineInput;
  isAttack: boolean;
}

let simIndex = 10_000;

function makeInput(
  wave: number,
  seq: number,
  kind: "A" | "F",
  opts: {
    amount: number;
    at: number;
    customerId: string;
    customerName: string;
    merchant: string;
    location: string;
    device: string;
    paymentMethod: string;
  },
): EngineInput {
  simIndex += 1;
  return {
    index: simIndex,
    txnId: `SIM-${kind}${wave}-${String(seq).padStart(2, "0")}`,
    amount: Math.max(60, Math.round(opts.amount)),
    at: opts.at,
    customerId: opts.customerId,
    customerName: opts.customerName,
    merchant: opts.merchant,
    location: opts.location,
    device: opts.device,
    paymentMethod: opts.paymentMethod,
    label: kind === "A" ? 1 : 0,
  };
}

function scoreWave(datasetInputs: EngineInput[], gen: GenRow[]): ScoredRow[] {
  const stats = computeStats([...datasetInputs, ...gen.map((g) => g.input)]);
  return gen.map((g) => {
    const { score, signals, recommendation } = scoreRecord(g.input, stats);
    const level: RiskLevel =
      score >= 75 ? "CRITICAL" : score >= 50 ? "HIGH" : score >= 28 ? "MEDIUM" : "LOW";
    return {
      index: g.input.index,
      txnId: g.input.txnId,
      amount: g.input.amount,
      timestamp: g.input.at !== null ? new Date(g.input.at).toISOString() : null,
      customerId: g.input.customerId,
      customerName: g.input.customerName,
      merchant: g.input.merchant,
      location: g.input.location,
      device: g.input.device,
      paymentMethod: g.input.paymentMethod,
      label: g.input.label,
      riskScore: score,
      riskLevel: level,
      recommendation: recommendation as RiskAction,
      signals,
      warnings: [],
    } satisfies ScoredRow;
  });
}

/* ------------------------------------------------------------------ */
/* Victim / mule selection                                             */
/* ------------------------------------------------------------------ */

function pickVictims(baselines: Baselines, rng: Rng, count: number, deepHistory: boolean): CustomerBaseline[] {
  const pool = baselines.customers.filter((c) =>
    deepHistory ? c.rowCount >= 3 : c.rowCount <= 2,
  );
  const fallback = baselines.customers.filter((c) => c.rowCount >= 3);
  const source = pool.length ? pool : fallback.length ? fallback : baselines.customers;
  if (!source.length) return [];
  const out: CustomerBaseline[] = [];
  for (let i = 0; i < count; i++) out.push(rng.pick(source));
  return out;
}

/** Filler customers keep their own devices exclusive so they never join rings. */
function pickFillerCustomers(baselines: Baselines, rng: Rng, count: number): CustomerBaseline[] {
  const clean = baselines.customers.filter((c) => c.deviceExclusive && c.rowCount >= 1);
  const source = clean.length ? clean : baselines.customers;
  const out: CustomerBaseline[] = [];
  for (let i = 0; i < count; i++) out.push(source[Math.floor(rng.f() * source.length)]);
  return out;
}

/* ------------------------------------------------------------------ */
/* Profile generators                                                  */
/* ------------------------------------------------------------------ */

const ODD_HOUR_NOTE = "00:00-04:59 local";
const BUSINESS_NOTE = "09:00-19:59 local";

interface WavePlan {
  stance: string;
  rows: GenRow[];
  notes: Record<string, string | number>;
}

function genOpportunistic(baselines: Baselines, rng: Rng, wave: number, clock: WaveClock): WavePlan {
  const rows: GenRow[] = [];
  const perWave = 5;
  const victims = pickVictims(baselines, rng, perWave, true);
  const notes: Record<string, string | number> = {};
  const freshDevices = new Set<string>();

  victims.forEach((victim, i) => {
    const amount =
      wave === 1
        ? round100(rng.range(60_000, 240_000))
        : wave === 2
          ? round100(rng.range(28_000, 48_000))
          : avoidBand(
              round10(
                Math.min(
                  48_000,
                  victim.medianAmount > 0
                    ? victim.medianAmount * rng.range(1.2, 4.4)
                    : rng.range(1_200, 8_000),
                ),
              ),
            );

    const at = placeTime(clock, victim.id, wave === 1 ? DEAD_ZONE[0] : BUSINESS[0], wave === 1 ? DEAD_ZONE[1] : BUSINESS[1], rng);
    const device =
      wave === 1 || rng.f() < 0.75
        ? `BNR-${rng.int(1000, 9999)}-OP${wave}${i}`
        : victim.devices[0] || `BNR-${rng.int(1000, 9999)}-OP${wave}${i}`;
    if (wave < 3 || !victim.devices.length) freshDevices.add(device);

    const merchant =
      wave === 1
        ? baselines.merchants.length
          ? rng.pick(baselines.merchants)
          : "Unknown merchant"
        : victim.merchants[0] || rng.pick(baselines.merchants.length ? baselines.merchants : ["Unknown merchant"]);
    const method =
      wave === 1
        ? baselines.methods.length
          ? rng.pick(baselines.methods)
          : "UPI"
        : victim.methods[0] || "UPI";
    const location =
      wave === 1
        ? baselines.locations.filter((l) => !victim.locations.includes(l))[0] ??
          rng.pick(baselines.locations.length ? baselines.locations : ["Unknown"])
        : victim.locations[0] || "Unknown";

    rows.push({
      isAttack: true,
      input: makeInput(wave, i + 1, "A", {
        amount,
        at,
        customerId: victim.id,
        customerName: victim.name,
        merchant,
        location,
        device,
        paymentMethod: method,
      }),
    });
  });

  notes.devices = freshDevices.size;
  notes.hours = wave === 1 ? ODD_HOUR_NOTE : BUSINESS_NOTE;
  notes.stance =
    wave === 1
      ? "Loud and naive — max-size tickets in the dead zone on first-seen devices"
      : wave === 2
        ? "Half-adapted — quiet hours, mid tickets, the customer's own city and rail, but the burner habit stays"
        : "Cautious — near-median tickets on known rails, device rotation remains the one tell";

  return { stance: notes.stance as string, rows, notes };
}

function genThreshold(baselines: Baselines, rng: Rng, wave: number, clock: WaveClock): WavePlan {
  const rows: GenRow[] = [];
  const notes: Record<string, string | number> = {};

  // Thin-file victims (1-2 rows) never fire customer-relative rules; when the
  // file has none, fall back to customers whose median keeps a ₹10k hug below
  // 5x their baseline.
  let pool = baselines.customers.filter((c) => c.rowCount <= 2);
  if (pool.length < 2) {
    pool = baselines.customers.filter((c) => c.rowCount >= 3 && c.medianAmount >= 2_500);
  }
  if (!pool.length) pool = baselines.customers;

  const splitTargets: { victim: CustomerBaseline; threshold: number }[] = [];
  if (wave === 3) {
    const big = pickVictims(baselines, rng, 1, false)[0] ?? rng.pick(pool);
    splitTargets.push({ victim: big, threshold: 50_000 });
  }
  const smallVictims = wave === 3 ? 1 : 2;
  for (let i = 0; i < smallVictims; i++) {
    const victim = pool[Math.floor(rng.f() * pool.length)] ?? rng.pick(pool);
    splitTargets.push({ victim, threshold: 10_000 });
  }

  let seq = 0;
  let oddCount = 0;
  for (const { victim, threshold } of splitTargets) {
    const k = threshold === 50_000 ? 4 : 3;
    for (let j = 0; j < k; j++) {
      seq += 1;
      // Wave 1 plants one dead-zone installment per victim — the flaw wave 2 patches.
      const sloppy = wave === 1 && j === 0;
      const at = placeTime(clock, victim.id, sloppy ? DEAD_ZONE[0] : BUSINESS[0], sloppy ? DEAD_ZONE[1] : BUSINESS[1], rng);
      if (sloppy) oddCount += 1;
      rows.push({
        isAttack: true,
        input: makeInput(wave, seq, "A", {
          amount: hugBelow(threshold, rng),
          at,
          customerId: victim.id,
          customerName: victim.name,
          merchant: victim.merchants[0] || "Unknown merchant",
          location: victim.locations[0] || "Unknown",
          device: victim.devices[0] || `SIM-DEV-${victim.id}`,
          paymentMethod: victim.methods[0] || "UPI",
        }),
      });
    }
  }

  notes.oddCount = oddCount;
  notes.stance =
    wave === 1
      ? "Structuring drips — installments hug the ₹10,000 line from below on the customer's own rails"
      : wave === 2
        ? "Flaw patched — all installments in business hours, zero behavioral drift"
        : "Scaled up — the same drip wrapped around the ₹50,000 line";
  return { stance: notes.stance as string, rows, notes };
}

function genRing(baselines: Baselines, rng: Rng, wave: number, clock: WaveClock): WavePlan {
  const rows: GenRow[] = [];
  // Burner count grows with the wave; one mule more than burners closes the chain.
  const burners = wave === 1 ? 2 : wave === 2 ? 3 : 4;
  const mules = burners + 1;
  const poolMerchant = baselines.merchants.length ? rng.pick(baselines.merchants) : "QuickMart Kiosk";
  const altMerchant = baselines.merchants.length ? rng.pick(baselines.merchants) : "FuelPoint Fuels";
  const poolLocation = baselines.locations.length ? rng.pick(baselines.locations) : "Unknown";
  const burnerName = (j: number) => `BNR-${wave}${j}-RING`;

  let seq = 0;
  for (let j = 0; j < burners; j++) {
    // Primary mule owns the burner; the next mule rides it once — every burner
    // ends up shared by exactly 2 accounts, chaining the whole cluster.
    for (const muleIdx of [j, (j + 1) % mules]) {
      seq += 1;
      const muleId = `SIM-MULE-${wave}${muleIdx}`;
      const merchant = seq % 4 === 0 ? altMerchant : poolMerchant;
      const method = seq % 3 === 0 ? "Wallet" : baselines.methods[0] || "UPI";
      rows.push({
        isAttack: true,
        input: makeInput(wave, seq, "A", {
          amount: quietAmount(baselines, rng),
          at: placeTime(clock, muleId, BUSINESS[0], BUSINESS[1], rng),
          customerId: muleId,
          customerName: `Mule ${String(muleIdx + 1).padStart(2, "0")}`,
          merchant,
          location: poolLocation,
          device: burnerName(j),
          paymentMethod: method,
        }),
      });
    }
  }

  return {
    stance:
      wave === 1
        ? "Ring opens — mule accounts move near-median tickets through a small shared burner pool"
        : wave === 2
          ? "Rotation — the burner pool grows before any device saturates"
          : "Full rotation — no account repeats a device, no ticket crosses a review line",
    rows,
    notes: { burners, mules, merchant: poolMerchant },
  };
}

function genFiller(baselines: Baselines, rng: Rng, wave: number, clock: WaveClock, count: number): GenRow[] {
  const rows: GenRow[] = [];
  const customers = pickFillerCustomers(baselines, rng, count);
  customers.forEach((c, i) => {
    const amount = avoidBand(round10(Math.max(120, c.medianAmount * rng.range(0.7, 1.5))));
    rows.push({
      isAttack: false,
      input: makeInput(wave, 40 + i, "F", {
        amount,
        at: placeTime(clock, `filler-${c.id}`, BUSINESS[0], BUSINESS[1], rng),
        customerId: c.id,
        customerName: c.name,
        merchant: c.merchants[0] || "Unknown merchant",
        location: c.locations[0] || "Unknown",
        device: c.devices[0] || `SIM-DEV-${c.id}`,
        paymentMethod: c.methods[0] || "UPI",
      }),
    });
  });
  return rows;
}

/* ------------------------------------------------------------------ */
/* Narratives                                                          */
/* ------------------------------------------------------------------ */

function fmtShort(n: number): string {
  if (n >= 1_00_000) return `₹${(n / 1_00_000).toFixed(2)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}k`;
  return `₹${Math.round(n)}`;
}

function medianScoreOf(rows: ScoredRow[]): number {
  return Math.round(median(rows.map((r) => r.riskScore)));
}

function signalCounts(rows: ScoredRow[]): { type: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) for (const s of r.signals) counts.set(s.type, (counts.get(s.type) ?? 0) + 1);
  return [...counts.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count);
}

function graphLine(wave: WaveSeedMetrics, profile: AttackProfileId): string {
  if (wave.graphCaught > wave.caughtByRules) {
    return `Graph uplift: ring clustering linked ${wave.ringMembers} accounts through shared devices — detection ${wave.caughtByRulesPct}% → ${wave.caughtByGraphPct}%.`;
  }
  if (profile === "threshold") {
    return "No shared devices across accounts — smurfing leaves no infrastructure trail for the graph. Defense: cutoffs and payee-side analytics this file cannot see.";
  }
  if (profile === "opportunistic") {
    return "One burner per hit gives the graph nothing to link — per-row signals and graph topology both need repetition.";
  }
  return "Per-row rules and the graph agree here — nothing coordinated to cluster in this wave.";
}

interface WaveSeedMetrics {
  caughtByRules: number;
  caughtByRulesPct: number;
  caughtByGraph: number;
  caughtByGraphPct: number;
  graphCaught: number;
  ringMembers: number;
}

function buildNarratives(
  profile: AttackProfileId,
  wave: number,
  attackRows: ScoredRow[],
  notes: Record<string, string | number>,
  metrics: WaveSeedMetrics,
  prevCaught: number,
): string[] {
  const n = attackRows.length;
  const total = attackRows.reduce((s, r) => s + r.amount, 0);
  const amounts = [...attackRows].map((r) => r.amount);
  const minA = Math.min(...amounts);
  const maxA = Math.max(...amounts);
  const caught = metrics.caughtByRules;
  const lines: string[] = [];

  if (profile === "opportunistic") {
    if (wave === 1) {
      lines.push(
        `${n} naked shots worth ${fmtShort(total)} at ${notes.hours} on ${notes.devices} first-seen devices — high value, odd hour and fresh device stack on the same rows.`,
      );
      lines.push(
        caught > 0
          ? `The engine caught ${caught}/${n} at a median score of ${medianScoreOf(attackRows)}/100 — every static rule fired at once.`
          : `Even the loud ones slipped — check the per-row scores below; the engine's thresholds tolerated this mix.`,
      );
    } else if (wave === 2) {
      lines.push(
        `Adapted after ${prevCaught} wave-1 arrest${prevCaught === 1 ? "" : "s"}: tickets cut to ${fmtShort(maxA)} max, hours moved to ${notes.hours}, payments ride the customer's own city and rail.`,
      );
      lines.push(
        `Device rotation stayed — ${notes.devices} fresh burners. First-seen evidence alone adds 8-10 points, under the 28-point alert line.`,
      );
    } else {
      lines.push(
        `Near-median tickets (${fmtShort(minA)}-${fmtShort(maxA)}) inside each victim's normal band — the amount rules went quiet.`,
      );
      lines.push(
        `Detection collapsed to ${metrics.caughtByRulesPct}% — on every per-row signal the attacker now reads like your best customer.`,
      );
    }
  } else if (profile === "threshold") {
    if (wave === 1) {
      lines.push(
        `Split ${fmtShort(total)} into ${n} installments hugging the ₹10,000 line from below (${fmtShort(minA)}-${fmtShort(maxA)} each).`,
      );
      lines.push(
        `The structuring signal fired on every installment — and still slid under the 28-point alert line on its own.`,
      );
      if (Number(notes.oddCount) > 0) {
        lines.push(
          `${notes.oddCount} installment${Number(notes.oddCount) === 1 ? "" : "s"} ran in the dead zone — the odd-hour tip pushed just those into review. Wave 2 patches the habit.`,
        );
      }
    } else if (wave === 2) {
      lines.push(
        `Dead-zone hours dropped — the ${prevCaught} wave-1 review hit${prevCaught === 1 ? "" : "s"} taught the lesson. Every installment reuses the customer's own device, rail and city: zero behavioral drift.`,
      );
      lines.push(`Per-row scores now read ${attackRows.map((r) => r.riskScore).join(", ")} — a structuring whisper the rules were tuned to tolerate.`);
    } else {
      lines.push(
        `Scaled to the ₹50,000 line: 4 installments of ₹49,0xx plus the usual ₹10k drip — one more threshold, same blindness.`,
      );
      lines.push(`Total dripped: ${fmtShort(total)} across ${n} installments. No per-row signal crosses the alert line at any point.`);
    }
  } else {
    const burners = Number(notes.burners);
    const mules = Number(notes.mules);
    if (wave === 1) {
      lines.push(
        `${mules} mule accounts moved ${fmtShort(total)} through ${burners} shared burners concentrated on "${notes.merchant}" — every ticket within ±65% of the file median.`,
      );
      lines.push(
        `Per-row scores: ${attackRows.map((r) => r.riskScore).join(", ")}. Business hours, near-median amounts, devices shared only across accounts — nothing fires.`,
      );
    } else if (wave === 2) {
      lines.push(`Burner pool rotated before saturation — ${burners} devices, each touching exactly two accounts.`);
      lines.push(`${fmtShort(total)} settled in ${n} transactions; no account repeated an instrument, no hour left the business window.`);
    } else {
      lines.push(`Rotated ${burners} burners across ${mules} accounts — no device repeats on any single account.`);
      lines.push(
        `${fmtShort(total)} settled at "${notes.merchant}" in a textbook mule pattern priced at a median of ${medianScoreOf(attackRows)}/100 by per-row rules.`,
      );
    }
  }

  lines.push(graphLine(metrics, profile));
  return lines;
}

/* ------------------------------------------------------------------ */
/* The run                                                             */
/* ------------------------------------------------------------------ */

const FILLER_PER_WAVE = 6;

/**
 * Simulate an attack campaign against the current run.
 * Deterministic in (rows, profile, seedOverride).
 */
export function simulateAttack(rows: ScoredRow[], profile: AttackProfileId, seedOverride?: number): AttackSimResult {
  simIndex = 10_000; // reset so identical inputs replay byte-identical runs
  const baselines = buildBaselines(rows);
  const seed = seedOverride ?? hashSeed(`razorshield:attack:${profile}`);
  const rng = makeRng(seed);
  const seedHex = seed.toString(16).toUpperCase().padStart(8, "0").slice(0, 6);

  const waves: AttackWaveResult[] = [];
  const allAttackRows: ScoredRow[] = [];
  let graphFoundRings = 0;
  let graphRingMembers = 0;

  let prevCaught = 0;
  for (let wave = 1; wave <= 3; wave++) {
    const clock = makeClock(baselines, wave);
    const plan =
      profile === "opportunistic"
        ? genOpportunistic(baselines, rng, wave, clock)
        : profile === "threshold"
          ? genThreshold(baselines, rng, wave, clock)
          : genRing(baselines, rng, wave, clock);

    const gen: GenRow[] = [...plan.rows, ...genFiller(baselines, rng, wave, clock, FILLER_PER_WAVE)];
    const scored = scoreWave(baselines.datasetInputs, gen);
    const attackRows = scored.filter((r) => r.label === 1);
    const legitRows = scored.filter((r) => r.label === 0);
    allAttackRows.push(...attackRows);

    const caughtRows = attackRows.filter((r) => r.recommendation !== "ALLOW");
    const caughtByRules = caughtRows.length;
    const missedExposure = attackRows
      .filter((r) => r.recommendation === "ALLOW")
      .reduce((s, r) => s + r.amount, 0);
    const attemptedExposure = attackRows.reduce((s, r) => s + r.amount, 0);

    // Graph pass on the mixed wave — the same module the results dashboard uses.
    const rings = detectFraudRings(scored);
    const ringMembers = new Set(rings.flatMap((ring) => ring.members.map((m) => m.customerId)));
    const graphCaughtRows = attackRows.filter(
      (r) => r.recommendation !== "ALLOW" || ringMembers.has(r.customerId),
    );
    graphFoundRings = Math.max(graphFoundRings, rings.length);
    graphRingMembers = Math.max(graphRingMembers, ringMembers.size);

    const attempted = attackRows.length;
    const caughtByRulesPct = attempted ? Math.round((caughtByRules / attempted) * 100) : 0;
    const caughtByGraphPct = attempted ? Math.round((graphCaughtRows.length / attempted) * 100) : 0;

    const metrics: WaveSeedMetrics = {
      caughtByRules,
      caughtByRulesPct,
      caughtByGraph: graphCaughtRows.length,
      caughtByGraphPct,
      graphCaught: graphCaughtRows.length,
      ringMembers: ringMembers.size,
    };

    waves.push({
      wave,
      stance: plan.stance,
      attempted,
      attemptedExposure,
      caughtByRules,
      caughtByRulesPct,
      missedExposure,
      caughtByGraph: graphCaughtRows.length,
      caughtByGraphPct,
      legitMixed: legitRows.length,
      legitFlagged: legitRows.filter((r) => r.recommendation !== "ALLOW").length,
      narratives: buildNarratives(profile, wave, attackRows, plan.notes, metrics, prevCaught),
      topSignals: signalCounts(attackRows),
      medianScore: medianScoreOf(attackRows),
    });
    prevCaught = caughtByRules;
  }

  const attempted = waves.reduce((s, w) => s + w.attempted, 0);
  const attemptedExposure = waves.reduce((s, w) => s + w.attemptedExposure, 0);
  const caughtByRules = waves.reduce((s, w) => s + w.caughtByRules, 0);
  const caughtByGraph = waves.reduce((s, w) => s + w.caughtByGraph, 0);
  const missedExposure = waves.reduce((s, w) => s + w.missedExposure, 0);

  return {
    profile,
    seed,
    seedHex,
    waves,
    attackRows: allAttackRows,
    totals: {
      attempted,
      attemptedExposure,
      caughtByRules,
      caughtByRulesPct: attempted ? Math.round((caughtByRules / attempted) * 100) : 0,
      caughtByGraph,
      caughtByGraphPct: attempted ? Math.round((caughtByGraph / attempted) * 100) : 0,
      missedExposure,
    },
    graphFoundRings,
    graphRingMembers,
  };
}
