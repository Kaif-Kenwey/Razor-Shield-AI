/**
 * RazorShield AI — real similar-case similarity.
 *
 * Replaces the canned archive lookup with feature-vector similarity
 * computed over the transaction universe actually loaded in the workspace
 * (demo ledger, live arrivals and dataset-routed rows alike — anything in
 * the store is a candidate). Deterministic: same universe, same matches.
 *
 * Feature vector per transaction (six components, all derived from fields
 * already on the transaction, each folded into a [0,1] similarity against
 * the focus case):
 *
 *   f1 amount deviation   d(t) = clamp(ln(amount / customerMedian), -3, +3) / 3
 *                         sim = 1 - |d_focus - d_cand| / 2        (w = 0.30)
 *                         customerMedian = median of the customer's txns in
 *                         the universe; single-txn customers fall back to
 *                         their deterministic customer baseline.
 *   f2 hour-of-day        cyclical encoding h → (sin, cos) on the 24h circle;
 *                         sim = (1 + cos(2π(h1 - h2) / 24)) / 2    (w = 0.20)
 *                         (03:00 vs 23:00 are near each other, 12:00 far)
 *   f3 velocity in window v(t) = min(neighbours within ±10 min, 6) / 6
 *                         sim = 1 - |v_focus - v_cand|             (w = 0.15)
 *   f4 device age flag    sim = isNewDevice equality               (w = 0.15)
 *   f5 geography          sim = same-city flag                     (w = 0.10)
 *   f6 payment rail       sim = paymentMethod equality             (w = 0.10)
 *
 * Distance is a weighted RMS L2 over the component gaps:
 *   D = sqrt( Σ wᵢ · (1 - simᵢ)² / Σ wᵢ )   ∈ [0, 1]
 *   similarity = (1 - D) × 100
 * All weights sum to 1, so D is a true normalized RMS distance and
 * similarity is 100 only when every component matches exactly.
 */

import type { Transaction } from "@/types";
import { customerFor } from "@/data/mockData";

export type PrecedentOutcome = "FRAUD_CONFIRMED" | "LEGITIMATE";

export interface SimilarTxnHit {
  txn: Transaction;
  /** 0-100, weighted RMS-L2 over the six feature components. */
  similarity: number;
  /** Top contributing shared features, strongest first ("why" line). */
  reasons: string[];
  /** Ground-truth outcome when the case was analyst-adjudicated. */
  outcome: PrecedentOutcome | null;
}

export interface SimilarityResult {
  hits: SimilarTxnHit[];
  /** Candidates actually evaluated (other-customer, settled rows). */
  comparable: number;
  /** Raw universe size handed to the engine. */
  total: number;
}

export interface SimilarityOptions {
  /** Analyst decisions keyed by txn id — the source of known outcomes. */
  decisions?: Record<string, { action?: string }>;
  limit?: number;
}

const WEIGHTS = { amount: 0.3, hour: 0.2, velocity: 0.15, device: 0.15, city: 0.1, method: 0.1 } as const;

const LOG_CLAMP = 3; // ln ratio beyond e^±3 (~20x) saturates the amount feature
const VELOCITY_WINDOW_MS = 10 * 60_000;
const VELOCITY_SATURATION = 6;
/** Below this the candidate is not "similar" enough to present as precedent. */
const MIN_SIMILARITY = 35;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Per-customer amount baseline: universe median, or the deterministic customer profile when thin. */
function customerMedians(universe: Transaction[]): Map<string, number> {
  const byCustomer = new Map<string, { amounts: number[]; first: Transaction }>();
  for (const t of universe) {
    const entry = byCustomer.get(t.customerId);
    if (entry) {
      entry.amounts.push(t.amount);
    } else {
      byCustomer.set(t.customerId, { amounts: [t.amount], first: t });
    }
  }
  const medians = new Map<string, number>();
  for (const [customerId, { amounts, first }] of byCustomer) {
    medians.set(
      customerId,
      amounts.length >= 2 ? median(amounts) : customerFor(first).avgTransaction,
    );
  }
  return medians;
}

/** Normalized hour deviation from the customer's own median, clamped to ±LOG_CLAMP. */
function amountDeviation(txn: Transaction, medians: Map<string, number>): number {
  const base = medians.get(txn.customerId) || txn.amount;
  if (base <= 0 || txn.amount <= 0) return 0;
  return Math.max(-LOG_CLAMP, Math.min(LOG_CLAMP, Math.log(txn.amount / base))) / LOG_CLAMP;
}

/** Share of the universe arriving within ±10 minutes — a coarse burst detector. */
function velocityInWindow(txn: Transaction, times: number[]): number {
  const at = new Date(txn.timestamp).getTime();
  const near = times.filter((t) => Math.abs(t - at) <= VELOCITY_WINDOW_MS).length;
  return Math.min(near, VELOCITY_SATURATION) / VELOCITY_SATURATION;
}

const hourOf = (iso: string) => new Date(iso).getHours();
const oddHour = (h: number) => h >= 23 || h <= 5;

/** Outcome is only claimed when a human adjudicated the case (BLOCK = confirmed fraud, ALLOW = cleared). */
function adjudicatedOutcome(txnId: string, decisions: SimilarityOptions["decisions"]): PrecedentOutcome | null {
  const action = decisions?.[txnId]?.action;
  if (action === "BLOCK") return "FRAUD_CONFIRMED";
  if (action === "ALLOW") return "LEGITIMATE";
  return null;
}

/**
 * Ranks the universe against the focus transaction and returns the top
 * precedents with the feature components that earned their place.
 */
export function similarTransactionsFor(
  focus: Transaction,
  universe: Transaction[],
  opts?: SimilarityOptions,
): SimilarityResult {
  const eligible = universe.filter(
    (t) =>
      t.id !== focus.id &&
      t.customerId !== focus.customerId && // precedent must be OTHER-customer
      t.status !== "EVALUATING",
  );

  if (eligible.length === 0) return { hits: [], comparable: 0, total: universe.length };

  const medians = customerMedians(universe);
  const times = universe.map((t) => new Date(t.timestamp).getTime());
  const focusHour = hourOf(focus.timestamp);

  const focusFeat = {
    amount: amountDeviation(focus, medians),
    hour: focusHour,
    odd: oddHour(focusHour),
    velocity: velocityInWindow(focus, times),
    newDevice: focus.isNewDevice,
    city: focus.location,
    method: focus.paymentMethod,
  };

  const scored = eligible.map((cand) => {
    const candHour = hourOf(cand.timestamp);
    const hourSim = (1 + Math.cos((2 * Math.PI * (focusHour - candHour)) / 24)) / 2;
    const comps = {
      amount: Math.max(0, 1 - Math.abs(focusFeat.amount - amountDeviation(cand, medians)) / 2),
      hour: hourSim,
      velocity: 1 - Math.abs(focusFeat.velocity - velocityInWindow(cand, times)),
      device: focusFeat.newDevice === cand.isNewDevice ? 1 : 0,
      city: focusFeat.city === cand.location ? 1 : 0,
      method: focusFeat.method === cand.paymentMethod ? 1 : 0,
    };

    // Weighted RMS L2: D = sqrt( Σ wᵢ(1-simᵢ)² / Σ wᵢ ), Σwᵢ = 1
    const gap2 =
      WEIGHTS.amount * (1 - comps.amount) ** 2 +
      WEIGHTS.hour * (1 - comps.hour) ** 2 +
      WEIGHTS.velocity * (1 - comps.velocity) ** 2 +
      WEIGHTS.device * (1 - comps.device) ** 2 +
      WEIGHTS.city * (1 - comps.city) ** 2 +
      WEIGHTS.method * (1 - comps.method) ** 2;
    const similarity = Math.round((1 - Math.sqrt(gap2)) * 100);

    /* "Why" line — only claim a feature when it genuinely aligns. Amount
     * additionally requires absolute proximity (|log10 ratio| ≤ 0.35 ≈ 2.2x)
     * so a shared deviation profile never masquerades as a shared band. */
    const candOdd = oddHour(candHour);
    const reasons: { label: string; strength: number }[] = [];
    const log10Gap = Math.abs(Math.log10(Math.max(1, focus.amount)) - Math.log10(Math.max(1, cand.amount)));
    if (comps.amount >= 0.6 && log10Gap <= 0.35) reasons.push({ label: "similar amount band", strength: WEIGHTS.amount * comps.amount });
    if (focusFeat.odd && candOdd && comps.hour >= 0.8) reasons.push({ label: "same odd-hour window", strength: WEIGHTS.hour * comps.hour });
    else if (comps.hour >= 0.92) reasons.push({ label: "matching time-of-day", strength: WEIGHTS.hour * comps.hour });
    if (focusFeat.velocity >= 0.5 && comps.velocity >= 0.5) reasons.push({ label: "burst-window velocity", strength: WEIGHTS.velocity * comps.velocity });
    else if (comps.velocity >= 0.85) reasons.push({ label: "similar velocity profile", strength: WEIGHTS.velocity * comps.velocity });
    if (focusFeat.newDevice && cand.isNewDevice) reasons.push({ label: "new device", strength: WEIGHTS.device });
    if (comps.city === 1) reasons.push({ label: "same city", strength: WEIGHTS.city });
    if (comps.method === 1) reasons.push({ label: "same payment rail", strength: WEIGHTS.method });

    reasons.sort((a, b) => b.strength - a.strength);

    return {
      txn: cand,
      similarity: Math.max(0, Math.min(100, similarity)),
      reasons: reasons.slice(0, 3).map((r) => r.label),
      outcome: adjudicatedOutcome(cand.id, opts?.decisions),
    } satisfies SimilarTxnHit;
  });

  const hits = scored
    .filter((h) => h.similarity >= MIN_SIMILARITY && h.reasons.length > 0)
    .sort(
      (a, b) =>
        b.similarity - a.similarity ||
        b.txn.riskScore - a.txn.riskScore ||
        new Date(b.txn.timestamp).getTime() - new Date(a.txn.timestamp).getTime(),
    )
    .slice(0, opts?.limit ?? 3);

  return { hits, comparable: eligible.length, total: universe.length };
}
