/**
 * RazorShield AI — server-side case context builder.
 *
 * SECURITY BOUNDARY: the investigation engine's facts are assembled HERE,
 * from SQLite only. The client sends a transaction id and nothing else —
 * amount, risk score, signals, customer profile and precedent recall all
 * come from the database, so a tampered request cannot change what the
 * LLM is told about the case.
 *
 * Everything is bounded and time-aware: customer aggregates and precedent
 * recall only see transactions at or before the case's own timestamp.
 */

import { db } from "@/lib/db";
import type { AgentCaseContext, AgentSignal } from "@/lib/agent/investigator";
import type { RiskSignal } from "@/types";

/** How much precedent history recall considers (bounded, most recent first). */
const RECALL_POOL = 300;

/** Median of an already-sorted numeric array. */
function medianSorted(sorted: number[]): number {
  if (!sorted.length) return 0;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const HOUR = 60 * 60 * 1000;

interface PriorRow {
  id: string;
  amount: number;
  timestamp: Date;
  customerId: string;
  merchant: string;
  location: string;
  device: string;
  paymentMethod: string;
  riskScore: number;
  isNewDevice: boolean;
  label: number | null;
  analystAction: string | null;
}

/** Load prior transactions (≤ the case timestamp) with their adjudication. */
async function loadPriorRows(customerId: string, at: Date): Promise<PriorRow[]> {
  const rows = await db.transaction.findMany({
    where: { timestamp: { lte: at } },
    orderBy: { timestamp: "desc" },
    take: RECALL_POOL,
    select: {
      id: true,
      amount: true,
      timestamp: true,
      customerId: true,
      merchant: true,
      location: true,
      device: true,
      paymentMethod: true,
      riskScore: true,
      isNewDevice: true,
      label: true,
      investigation: { select: { analystAction: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    amount: r.amount,
    timestamp: r.timestamp,
    customerId: r.customerId,
    merchant: r.merchant,
    location: r.location,
    device: r.device,
    paymentMethod: r.paymentMethod,
    riskScore: r.riskScore,
    isNewDevice: r.isNewDevice,
    label: r.label,
    analystAction: r.investigation?.analystAction ?? null,
  }));
}

/** Most common non-empty value, or "" when none exists. */
function modeOf(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best = "";
  let bestN = 0;
  for (const [v, n] of counts) {
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

/** Deterministic precedent recall over the bounded prior pool. */
function similarCasesFor(
  focus: {
    id: string;
    amount: number;
    customerId: string;
    timestamp: Date;
    location: string;
    device: string;
    paymentMethod: string;
    isNewDevice: boolean;
  },
  pool: PriorRow[],
): AgentCaseContext["similarCases"] {
  const candidates = pool.filter((r) => r.id !== focus.id);
  if (!candidates.length) return [];

  // per-customer median amount inside the pool (bounded, in-memory)
  const byCustomer = new Map<string, number[]>();
  for (const r of candidates) {
    const arr = byCustomer.get(r.customerId) ?? [];
    arr.push(r.amount);
    byCustomer.set(r.customerId, arr);
  }
  const customerMedian = new Map<string, number>();
  for (const [cid, amounts] of byCustomer) {
    customerMedian.set(cid, medianSorted([...amounts].sort((a, b) => a - b)));
  }

  const dev = (amount: number, median: number) => {
    const base = Math.max(median, 1);
    const d = Math.log(Math.max(amount, 1) / base);
    return Math.max(-3, Math.min(3, d)) / 3;
  };

  const focusHour = focus.timestamp.getHours();
  const focusDev = dev(focus.amount, customerMedian.get(focus.customerId) ?? 0);

  const weights = [0.3, 0.2, 0.15, 0.15, 0.1, 0.1];
  const hits = candidates.map((c) => {
    const sims = [
      1 - Math.abs(dev(c.amount, customerMedian.get(c.customerId) ?? 0) - focusDev) / 2,
      (1 + Math.cos((2 * Math.PI * (c.timestamp.getHours() - focusHour)) / 24)) / 2,
      1 - Math.min(6, Math.abs(c.timestamp.getTime() - focus.timestamp.getTime()) <= 10 * 60_000 ? 1 : 0) / 6,
      (c.isNewDevice === focus.isNewDevice ? 1 : 0),
      (c.location && focus.location && c.location.toLowerCase() === focus.location.toLowerCase() ? 1 : 0),
      (c.paymentMethod && focus.paymentMethod && c.paymentMethod.toLowerCase() === focus.paymentMethod.toLowerCase() ? 1 : 0),
    ];
    const d = Math.sqrt(sims.reduce((s, sim, i) => s + weights[i] * (1 - sim) ** 2, 0) / weights.reduce((s, w) => s + w, 0));
    const similarity = Math.max(0, Math.min(1, 1 - d));

    const outcome = c.analystAction
      ? c.analystAction === "BLOCK" || c.analystAction === "HOLD"
        ? "confirmed fraud (analyst-blocked)"
        : c.analystAction === "ALLOW"
          ? "legitimate (analyst-cleared)"
          : `analyst action: ${c.analystAction.toLowerCase()}`
      : c.label === 1
        ? "confirmed fraud (ground-truth label)"
        : `unadjudicated · engine score ${c.riskScore}/100`;

    return { id: c.id, similarity, outcome };
  });

  return hits
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 6);
}

export interface ServerCaseContext {
  context: AgentCaseContext;
  /** Server facts echoed back so any caller can audit what was used. */
  factsSummary: {
    transactionId: string;
    amount: number;
    riskScore: number;
    riskLevel: string;
    signalCount: number;
    priorTransactionCount: number;
    priorIncidents: number;
    similarCaseCount: number;
  };
}

/**
 * Builds the investigation context for a case entirely from SQLite.
 * Returns null when the transaction does not exist.
 */
export async function loadServerCaseContext(txnId: string): Promise<ServerCaseContext | null> {
  const row = await db.transaction.findUnique({
    where: { id: txnId },
    include: { investigation: true },
  });
  if (!row) return null;

  const signals: RiskSignal[] = (() => {
    try {
      const parsed = JSON.parse(row.signalsJson) as RiskSignal[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();

  const at = row.timestamp;
  const [priorRows, customer, priorIncidentCount] = await Promise.all([
    loadPriorRows(row.customerId, at),
    db.customer.findUnique({ where: { id: row.customerId } }),
    db.transaction.count({ where: { customerId: row.customerId, timestamp: { lte: at }, label: 1 } }),
  ]);

  const priorForCustomer = priorRows.filter((r) => r.customerId === row.customerId);
  const priorAmounts = priorForCustomer.map((r) => r.amount).sort((a, b) => a - b);
  const priorLocations = priorForCustomer.map((r) => r.location);
  const priorDevices = priorForCustomer.map((r) => r.device);

  const priorCases = priorRows.filter((r) => r.analystAction || r.label === 1).length;

  const context: AgentCaseContext = {
    transaction: {
      id: row.id,
      amount: row.amount,
      currency: row.currency || "INR",
      merchant: row.merchant || "unknown",
      location: row.location || "unknown",
      device: row.device || "unknown",
      paymentMethod: row.paymentMethod || "unknown",
      timestamp: at.toISOString(),
    },
    riskScore: Math.round(row.riskScore),
    riskLevel: row.riskLevel,
    signals: signals.slice(0, 12).map(
      (s): AgentSignal => ({
        type: s.type,
        title: s.title,
        evidence: s.evidence,
        severity: s.severity,
        impact: s.impact,
      }),
    ),
    customer: {
      id: row.customerId,
      name: customer?.name || row.customerName || undefined,
      accountAge: customer?.createdAt
        ? (() => {
            const days = Math.max(0, Math.floor((at.getTime() - customer.createdAt.getTime()) / 86_400_000));
            return days >= 365 ? `${Math.floor(days / 365)} year(s) ${days % 365} days` : `${days} days`;
          })()
        : undefined,
      transactionCount: priorForCustomer.length,
      avgTransaction: priorAmounts.length
        ? Math.round(priorAmounts.reduce((s, n) => s + n, 0) / priorAmounts.length)
        : undefined,
      previousIncidents: priorIncidentCount,
      usualLocation: modeOf(priorLocations) || undefined,
      usualDevice: modeOf(priorDevices) || undefined,
    },
    similarCases: similarCasesFor(
      {
        id: row.id,
        amount: row.amount,
        customerId: row.customerId,
        timestamp: at,
        location: row.location,
        device: row.device,
        paymentMethod: row.paymentMethod,
        isNewDevice: row.isNewDevice,
      },
      priorRows,
    ),
  };

  return {
    context,
    factsSummary: {
      transactionId: row.id,
      amount: row.amount,
      riskScore: Math.round(row.riskScore),
      riskLevel: row.riskLevel,
      signalCount: signals.length,
      priorTransactionCount: priorForCustomer.length,
      priorIncidents: priorIncidentCount,
      similarCaseCount: priorCases,
    },
  };
}
