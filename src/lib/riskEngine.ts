/**
 * RazorShield AI — deterministic batch risk engine (rse-1.2).
 *
 * Pure TypeScript: no DOM, no Node APIs, no I/O. Used by the Dataset Studio
 * API route, the server scoring service (manual entry, CSV import, demo
 * generator) and the attack simulator.
 *
 * Design notes
 * ------------
 * - CAUSAL SCORING (review fix): every record is scored against ONLY the
 *   context that existed before it. Rows are processed in chronological
 *   order (ties broken by upload index) and each row's customer profile
 *   and portfolio baselines are built from strictly earlier rows — a
 *   future payment can never leak backwards into an earlier one's
 *   velocity, baselines or "usual" corridor. Records without a parsable
 *   timestamp are scored after all dated rows (no time axis — the whole
 *   dated context is used) and flagged accordingly upstream.
 * - This makes Dataset Studio batch scoring and the ledger's
 *   chronological ingestion agree: the same rows, processed under the
 *   same conditions, produce the same scores.
 * - Every signal is a rule with an evidence sentence and structured facts,
 *   so an analyst can always ask "why this score?" and get an answer.
 * - Customer-relative signals (unusual amount, location drift, velocity,
 *   impossible travel) only fire when the customer has at least 3 PRIOR
 *   transactions. A single-transaction customer never triggers them —
 *   that avoids false precision the data cannot support.
 * - Scoring is capped at 100 and signal impacts sum to the composite score.
 */

import type {
  RiskAction,
  RiskLevel,
  RiskSignal,
  SignalSeverity,
  SignalType,
} from "@/types";
import type { ScoredRow } from "@/types/dataset";

export const ENGINE_VERSION = "rse-1.2.0";

/** Points contributed by each rule (upper bounds; caps applied at runtime). */
const WEIGHTS = {
  highValue: 26,
  structuring: 20,
  unusualAmount: 18,
  velocity: 26,
  impossibleTravel: 24,
  locationAnomaly: 12,
  newDevice: 10,
  timeAnomaly: 8,
  merchantOutlier: 9,
  methodMismatch: 9,
} as const;

/** A normalized payment record handed to the scorer. */
export interface EngineInput {
  index: number;
  txnId: string;
  amount: number;
  /** Epoch ms — null when the date column was missing/unparsable. */
  at: number | null;
  customerId: string;
  customerName: string;
  merchant: string;
  location: string;
  device: string;
  paymentMethod: string;
  label: 0 | 1 | null;
}

/* ------------------------------------------------------------------ */
/* Statistics helpers                                                  */
/* ------------------------------------------------------------------ */

function medianSorted(sorted: number[]): number {
  if (!sorted.length) return 0;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentileSorted(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function insertSorted(arr: number[], v: number): void {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  arr.splice(lo, 0, v);
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function modeFromCounts(map: Map<string, number>): { value: string; count: number } {
  let best = "";
  let bestN = 0;
  for (const [v, n] of map) {
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return { value: best, count: bestN };
}

const HOUR = 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* Running scoring context (strictly-prior rows only)                  */
/* ------------------------------------------------------------------ */

interface RunningCustomer {
  amounts: number[]; // ascending
  locations: Map<string, number>;
  devices: Map<string, number>;
  methods: Map<string, number>;
  /** Prior timed rows for this customer, ascending by time. */
  timed: { at: number; location: string }[];
  count: number;
}

function emptyCustomer(): RunningCustomer {
  return { amounts: [], locations: new Map(), devices: new Map(), methods: new Map(), timed: [], count: 0 };
}

/** Everything scoreRow is allowed to know about the world for ONE record. */
interface RowContext {
  /** Customer transactions strictly BEFORE this record. */
  priorCount: number;
  priorMedianAmount: number;
  usualLocation: string;
  usualLocationCount: number;
  usualDevice: string;
  usualMethod: string;
  priorUsesOfThisDevice: number;
  priorTimed: { at: number; location: string }[];
  /** Portfolio baselines over all rows scored before this one. */
  portfolioMedian: number;
  portfolioP95: number;
  merchantMedian: number;
  /** Portfolio-prior uses of this device — first-seen detection, causal. */
  portfolioPriorDeviceUses: number;
}

/* ------------------------------------------------------------------ */
/* Signal builders                                                     */
/* ------------------------------------------------------------------ */

let signalSeq = 0;
function signal(
  type: SignalType,
  title: string,
  evidence: string,
  severity: SignalSeverity,
  impact: number,
  facts: { label: string; value: string }[],
): RiskSignal {
  signalSeq += 1;
  return {
    id: `sig_${type.toLowerCase()}_${signalSeq}`,
    type,
    title,
    evidence,
    severity,
    impact: Math.round(impact),
    facts,
  };
}

const inr = (n: number) =>
  `₹${Math.round(n).toLocaleString("en-IN")}`;

function hourOf(at: number | null): number | null {
  return at === null ? null : new Date(at).getHours();
}

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

/**
 * Scores one record against its strictly-prior context. Returns the
 * composite score (0–100), the fired signals and the recommended action.
 */
function scoreRow(rec: EngineInput, ctx: RowContext): {
  score: number;
  signals: RiskSignal[];
  recommendation: RiskAction;
} {
  const signals: RiskSignal[] = [];
  const at = rec.at;
  const hour = hourOf(at);

  /* --- absolute amount rules ------------------------------------- */
  if (rec.amount >= 100_000) {
    signals.push(
      signal(
        "HIGH_VALUE",
        "High-value transaction",
        `${inr(rec.amount)} is ${rec.amount >= 250_000 ? "far" : "well"} above the ₹1,00,000 watch threshold for this portfolio.`,
        "CRITICAL",
        WEIGHTS.highValue,
        [
          { label: "Amount", value: inr(rec.amount) },
          { label: "Threshold", value: "₹1,00,000" },
          { label: "Median to date", value: ctx.portfolioMedian ? inr(ctx.portfolioMedian) : "no prior data" },
        ],
      ),
    );
  } else if (rec.amount >= 50_000) {
    signals.push(
      signal(
        "HIGH_VALUE",
        "Elevated ticket size",
        `${inr(rec.amount)} crosses the ₹50,000 review threshold (${(rec.amount / Math.max(ctx.portfolioMedian, 1)).toFixed(1)}× the median to date).`,
        "HIGH",
        WEIGHTS.highValue * 0.7,
        [
          { label: "Amount", value: inr(rec.amount) },
          { label: "Median to date", value: ctx.portfolioMedian ? inr(ctx.portfolioMedian) : "no prior data" },
        ],
      ),
    );
  }

  /* just under common review thresholds — classic structuring shape */
  const justUnder =
    (rec.amount >= 9_000 && rec.amount < 10_000) ||
    (rec.amount >= 49_000 && rec.amount < 50_000) ||
    (rec.amount >= 99_000 && rec.amount < 100_000);
  if (justUnder) {
    signals.push(
      signal(
        "STRUCTURING",
        "Threshold-hugging amount",
        `${inr(rec.amount)} sits just under a common review threshold — a known structuring pattern worth a second look.`,
        "HIGH",
        WEIGHTS.structuring,
        [
          { label: "Amount", value: inr(rec.amount) },
          { label: "Pattern", value: "just-under-threshold" },
        ],
      ),
    );
  }

  /* --- customer-relative amount (needs ≥3 PRIOR txns) ------------- */
  if (ctx.priorCount >= 3 && ctx.priorMedianAmount > 0 && rec.amount >= ctx.priorMedianAmount * 5) {
    signals.push(
      signal(
        "UNUSUAL_AMOUNT",
        "Amount deviates from customer baseline",
        `${inr(rec.amount)} is ${(rec.amount / ctx.priorMedianAmount).toFixed(1)}× this customer's median ticket of ${inr(ctx.priorMedianAmount)} across ${ctx.priorCount} earlier transactions.`,
        rec.amount >= ctx.priorMedianAmount * 10 ? "HIGH" : "MEDIUM",
        WEIGHTS.unusualAmount,
        [
          { label: "Customer median (prior)", value: inr(ctx.priorMedianAmount) },
          { label: "This txn", value: `${(rec.amount / ctx.priorMedianAmount).toFixed(1)}×` },
          { label: "Prior txns", value: `${ctx.priorCount}` },
        ],
      ),
    );
  }

  /* --- velocity + impossible travel (needs timestamps) ------------ */
  if (at !== null && ctx.priorTimed.length > 0) {
    // Strictly earlier rows within the 10 minutes before this payment.
    let peers = 0;
    for (let i = ctx.priorTimed.length - 1; i >= 0; i--) {
      const gap = at - ctx.priorTimed[i].at;
      if (gap > 10 * 60 * 1000) break;
      peers += 1;
    }
    if (peers >= 2) {
      signals.push(
        signal(
          "VELOCITY_SPIKE",
          "Velocity spike",
          `${peers} earlier transactions on this customer within the 10 minutes before this payment — burst behaviour consistent with card testing or scripted fraud.`,
          peers >= 4 ? "CRITICAL" : "HIGH",
          Math.min(WEIGHTS.velocity, 14 + (peers - 1) * 4),
          [
            { label: "Earlier txns / 10 min", value: String(peers) },
            { label: "Customer", value: rec.customerName || rec.customerId },
          ],
        ),
      );
    }

    // Nearest PRIOR row within the past hour — travel must be possible
    // forwards in time only; a later payment can never explain an earlier one.
    let nearest: { at: number; location: string } | null = null;
    for (let i = ctx.priorTimed.length - 1; i >= 0; i--) {
      const gap = at - ctx.priorTimed[i].at;
      if (gap <= HOUR) {
        nearest = ctx.priorTimed[i];
        break;
      }
      if (gap > 24 * HOUR) break; // nothing recent enough further back
    }
    if (
      nearest &&
      nearest.location &&
      rec.location &&
      nearest.location.toLowerCase() !== rec.location.toLowerCase()
    ) {
      signals.push(
        signal(
          "IMPOSSIBLE_TRAVEL",
          "Impossible travel",
          `This payment is ${rec.location} while a transaction ${Math.max(1, Math.round((at - nearest.at) / 60000))} min earlier was ${nearest.location} — the customer cannot be in both places.`,
          "HIGH",
          WEIGHTS.impossibleTravel,
          [
            { label: "This location", value: rec.location },
            { label: "Earlier location", value: nearest.location },
            { label: "Gap", value: `${Math.max(1, Math.round((at - nearest.at) / 60000))} min` },
          ],
        ),
      );
    }
  }

  /* --- location drift --------------------------------------------- */
  if (
    ctx.priorCount >= 3 &&
    ctx.usualLocationCount >= Math.ceil(ctx.priorCount * 0.6) &&
    rec.location &&
    rec.location.toLowerCase() !== ctx.usualLocation.toLowerCase()
  ) {
    signals.push(
      signal(
        "LOCATION_ANOMALY",
        "Unusual location for this customer",
        `${rec.location} is outside this customer's usual corridor (${ctx.usualLocation} on ${ctx.usualLocationCount}/${ctx.priorCount} prior transactions).`,
        "MEDIUM",
        WEIGHTS.locationAnomaly,
        [
          { label: "This txn", value: rec.location },
          { label: "Usual", value: ctx.usualLocation },
          { label: "Prior txns", value: `${ctx.priorCount}` },
        ],
      ),
    );
  }

  /* --- device reputation ------------------------------------------ */
  /* Two honest, distinct device evidences — both strictly CAUSAL so the
   * rule is identical whether a batch is scored at once or row-by-row
   * (scoring-consistency contract):
   *  A) behavioral — the customer HAS prior history and this device is
   *     first-seen for THEM (cold-start customers are exempt: with no
   *     device history, "new" is not evidence).
   *  B) infrastructure — the device has NEVER appeared in the portfolio
   *     before this payment (prior-uses == 0): a burner tell, weaker
   *     per-customer evidence, labeled as what it is. Cross-account
   *     device sharing is escalated to the entity-graph module. */
  const newForCustomer = rec.device && ctx.priorCount >= 3 && ctx.priorUsesOfThisDevice <= 0;
  const portfolioFirstSeen = rec.device && ctx.portfolioPriorDeviceUses <= 0;
  if (rec.device && (newForCustomer || (portfolioFirstSeen && ctx.priorCount >= 3))) {
    signals.push(
      signal(
        "NEW_DEVICE",
        newForCustomer ? "First-seen device for this customer" : "Device never seen in the portfolio before",
        newForCustomer
          ? `Device "${rec.device}" has no prior history for ${rec.customerId} across ${ctx.priorCount} earlier transactions${portfolioFirstSeen ? " and has never appeared in the portfolio before" : ""} — unseen-device risk on a ${inr(rec.amount)} payment.`
          : `Device "${rec.device}" has never appeared in this portfolio before this payment, on a customer with ${ctx.priorCount} prior transactions — burner-device pattern on a ${inr(rec.amount)} payment.`,
        newForCustomer ? "MEDIUM" : "LOW",
        WEIGHTS.newDevice,
        newForCustomer
          ? [
              { label: "Device", value: rec.device },
              { label: "Usual device", value: ctx.usualDevice || "—" },
              { label: "Prior uses (customer)", value: "0" },
            ]
          : [
              { label: "Device", value: rec.device },
              { label: "Prior uses (portfolio)", value: "0" },
              { label: "Customer history", value: `${ctx.priorCount} prior txns` },
            ],
      ),
    );
  }

  /* --- time-of-day ------------------------------------------------ */
  if (hour !== null && hour >= 0 && hour < 5) {
    signals.push(
      signal(
        "TIME_ANOMALY",
        "Odd-hour activity",
        `Processed at ${String(hour).padStart(2, "0")}:${String(new Date(at ?? 0).getMinutes()).padStart(2, "0")} local — outside this portfolio's normal activity band.`,
        "LOW",
        WEIGHTS.timeAnomaly,
        [{ label: "Hour", value: `${String(hour).padStart(2, "0")}:00` }],
      ),
    );
  }

  /* --- merchant outlier ------------------------------------------- */
  if (rec.merchant && ctx.merchantMedian > 0 && rec.amount >= ctx.merchantMedian * 6 && rec.amount >= ctx.portfolioP95) {
    signals.push(
      signal(
        "MERCHANT_RISK",
        "Outlier vs merchant profile",
        `${inr(rec.amount)} at ${rec.merchant} is ${(rec.amount / ctx.merchantMedian).toFixed(1)}× that merchant's typical ticket and in the top 5% of values to date.`,
        "MEDIUM",
        WEIGHTS.merchantOutlier,
        [
          { label: "Merchant median", value: inr(ctx.merchantMedian) },
          { label: "This txn", value: `${(rec.amount / ctx.merchantMedian).toFixed(1)}×` },
        ],
      ),
    );
  }

  /* --- payment-method mismatch ------------------------------------ */
  if (
    ctx.priorCount >= 3 &&
    ctx.usualMethod &&
    rec.paymentMethod &&
    rec.paymentMethod.toLowerCase() !== ctx.usualMethod.toLowerCase()
  ) {
    signals.push(
      signal(
        "METHOD_MISMATCH",
        "New payment method for this customer",
        `Paid via ${rec.paymentMethod}; this customer's history is ${ctx.usualMethod} — account-takeover actors often switch rails first.`,
        "MEDIUM",
        WEIGHTS.methodMismatch,
        [
          { label: "This txn", value: rec.paymentMethod },
          { label: "Usual", value: ctx.usualMethod },
        ],
      ),
    );
  }

  /* --- composite ---------------------------------------------------- */
  const score = Math.min(100, signals.reduce((sum, s) => sum + s.impact, 0));
  const level = scoreToLevel(score);
  return { score, signals, recommendation: levelToAction(score, level) };
}

export function scoreToLevel(score: number): RiskLevel {
  if (score >= 75) return "CRITICAL";
  if (score >= 50) return "HIGH";
  if (score >= 28) return "MEDIUM";
  return "LOW";
}

/**
 * The score at/above which a row counts as FLAGGED — the single
 * definition used everywhere a "detected/flagged" row is counted:
 * MEDIUM and above (score ≥ 28), which is exactly the band the engine
 * routes into the review flow (recommendation ≠ ALLOW). Evaluation
 * dashboards, Dataset Studio and the metrics API all read this constant
 * so no view can quietly invent its own detection threshold.
 */
export const FLAG_THRESHOLD = 28;

export function levelToAction(score: number, level: RiskLevel): RiskAction {
  if (level === "CRITICAL") return "BLOCK";
  if (level === "HIGH") return score >= 60 ? "HOLD" : "REVIEW";
  if (level === "MEDIUM") return "REVIEW";
  return "ALLOW";
}

/** Model confidence for the recommendation — deterministic, explainable. */
export function confidenceFor(score: number, signalCount: number): number {
  if (signalCount === 0) return Math.max(60, 92 - score); // quiet allow = high confidence
  const base = 62 + Math.min(signalCount, 5) * 5 + Math.round(score / 12);
  return Math.min(97, base);
}

/* ------------------------------------------------------------------ */
/* Batch evaluation                                                    */
/* ------------------------------------------------------------------ */

export interface BatchResult {
  rows: ScoredRow[];
  metrics: ReturnType<typeof computeMetrics>;
  topSignals: { type: string; label: string; count: number }[];
  scoreHistogram: { bucket: string; count: number }[];
  levelDistribution: { level: RiskLevel; count: number }[];
}

const SIGNAL_LABELS: Record<SignalType, string> = {
  NEW_DEVICE: "New device",
  UNUSUAL_AMOUNT: "Unusual amount",
  LOCATION_ANOMALY: "Location anomaly",
  VELOCITY_SPIKE: "Velocity spike",
  IMPOSSIBLE_TRAVEL: "Impossible travel",
  HIGH_VALUE: "High value",
  MERCHANT_RISK: "Merchant risk",
  TIME_ANOMALY: "Time anomaly",
  METHOD_MISMATCH: "Method mismatch",
  STRUCTURING: "Structuring",
};

/**
 * The engine "alerts" when it raises a flag — REVIEW, HOLD or BLOCK — i.e.
 * anything that consumes analyst time or touches the payment. ALLOW is the
 * predicted-negative. This matches fraud-ops convention where precision and
 * recall are measured on the alert queue, and it is stated verbatim in the UI.
 */
function isAlert(rec: RiskAction): boolean {
  return rec !== "ALLOW";
}

/** Estimated ops cost of handling one false alarm (manual review). */
export const REVIEW_OPS_COST = 450; // INR per reviewed case

export function computeMetrics(rows: ScoredRow[]) {
  const labeled = rows.filter((r) => r.label !== null);
  const labelsPresent = labeled.length > 0;

  let tp = 0, fp = 0, fn = 0, tn = 0;
  let fpCost = 0, fnCost = 0, flaggedValue = 0;
  let fraudTotal = 0, fraudBlocked = 0;

  for (const r of rows) {
    const alert = isAlert(r.recommendation);
    if (alert) flaggedValue += r.amount;
    if (r.label === null) continue;
    if (r.label === 1) {
      fraudTotal += 1;
      if (r.recommendation === "BLOCK") fraudBlocked += 1;
    }
    if (r.label === 1 && alert) { tp += 1; }
    else if (r.label === 0 && alert) {
      fp += 1;
      /* false-alarm cost = funds wrongly frozen (HOLD/BLOCK) + review ops */
      fpCost += r.recommendation === "HOLD" || r.recommendation === "BLOCK" ? r.amount : 0;
      fpCost += REVIEW_OPS_COST;
    }
    else if (r.label === 1 && !alert) { fn += 1; fnCost += r.amount; }
    else { tn += 1; }
  }

  // tag each row's outcome for the drill-down table
  for (const r of rows) {
    if (r.label === null) continue;
    const flagged = isAlert(r.recommendation);
    r.outcome = r.label === 1 ? (flagged ? "tp" : "fn") : flagged ? "fp" : "tn";
  }

  const precision = tp + fp > 0 ? (tp / (tp + fp)) * 100 : 0;
  const recall = tp + fn > 0 ? (tp / (tp + fn)) * 100 : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return {
    labelsPresent,
    labeledCount: labeled.length,
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    trueNegatives: tn,
    precision,
    recall,
    f1,
    falsePositiveCost: fpCost,
    falseNegativeCost: fnCost,
    flaggedValue,
    catchRateAtBlock: fraudTotal > 0 ? (fraudBlocked / fraudTotal) * 100 : 0,
  };
}

/**
 * Scores a full batch CAUSALLY and derives the aggregate analytics.
 *
 * Processing order: timestamped rows oldest→newest (ties broken by upload
 * index), then undated rows in upload order. Each row is scored against
 * the running state of strictly earlier rows, so the result is identical
 * whether the batch arrives at once (Dataset Studio) or row-by-row in the
 * same order (ledger ingestion) — that is the scoring-consistency contract.
 */
export function scoreBatch(inputs: EngineInput[]): BatchResult {
  /* Scoring order: dated rows chronological (ties by index), undated rows
   * last in upload order. Output is POSITIONAL — result row k corresponds
   * to inputs[k] regardless of the index values a caller assigned. */
  const order = inputs
    .map((rec, position) => ({ rec, position }))
    .sort(
      (a, b) =>
        (a.rec.at === null ? 1 : 0) - (b.rec.at === null ? 1 : 0) ||
        (a.rec.at as number) - (b.rec.at as number) ||
        a.rec.index - b.rec.index ||
        a.position - b.position,
    );

  const customers = new Map<string, RunningCustomer>();
  const portfolioAmounts: number[] = [];
  const merchantAmounts = new Map<string, number[]>();
  const portfolioDeviceUses = new Map<string, number>();
  const rows: ScoredRow[] = new Array(inputs.length);

  const applyRow = (rec: EngineInput): void => {
    let rc = customers.get(rec.customerId);
    if (!rc) {
      rc = emptyCustomer();
      customers.set(rec.customerId, rc);
    }
    insertSorted(rc.amounts, rec.amount);
    if (rec.location) bump(rc.locations, rec.location);
    if (rec.device) bump(rc.devices, rec.device);
    if (rec.paymentMethod) bump(rc.methods, rec.paymentMethod);
    if (rec.at !== null) rc.timed.push({ at: rec.at, location: rec.location });
    rc.count += 1;

    insertSorted(portfolioAmounts, rec.amount);
    if (rec.merchant) {
      const arr = merchantAmounts.get(rec.merchant);
      if (arr) insertSorted(arr, rec.amount);
      else merchantAmounts.set(rec.merchant, [rec.amount]);
    }
    if (rec.device) bump(portfolioDeviceUses, rec.device);
  };

  const scoreOne = (rec: EngineInput, position: number): void => {
    const rc = customers.get(rec.customerId) ?? emptyCustomer();
    const usualLoc = modeFromCounts(rc.locations);
    const usualDev = modeFromCounts(rc.devices);
    const usualMethod = modeFromCounts(rc.methods);

    const ctx: RowContext = {
      priorCount: rc.count,
      priorMedianAmount: medianSorted(rc.amounts),
      usualLocation: usualLoc.value,
      usualLocationCount: usualLoc.count,
      usualDevice: usualDev.value,
      usualMethod: usualMethod.value,
      priorUsesOfThisDevice: rec.device ? rc.devices.get(rec.device) ?? 0 : 0,
      priorTimed: rc.timed,
      portfolioMedian: medianSorted(portfolioAmounts),
      portfolioP95: percentileSorted(portfolioAmounts, 95),
      merchantMedian: rec.merchant ? medianSorted(merchantAmounts.get(rec.merchant) ?? []) : 0,
      portfolioPriorDeviceUses: rec.device ? portfolioDeviceUses.get(rec.device) ?? 0 : 0,
    };

    const { score, signals } = scoreRow(rec, ctx);
    const level = scoreToLevel(score);

    rows[position] = {
      index: rec.index,
      txnId: rec.txnId,
      amount: rec.amount,
      timestamp: rec.at !== null ? new Date(rec.at).toISOString() : null,
      customerId: rec.customerId,
      customerName: rec.customerName,
      merchant: rec.merchant,
      location: rec.location,
      device: rec.device,
      paymentMethod: rec.paymentMethod,
      label: rec.label,
      riskScore: score,
      riskLevel: level,
      recommendation: levelToAction(score, level),
      signals,
      warnings: rec.at === null
        ? ["No parsable timestamp — scored against the whole dated context (no time axis)."]
        : [],
    };

    applyRow(rec);
  };

  for (const { rec, position } of order) scoreOne(rec, position);

  const metrics = computeMetrics(rows);

  // signal frequency
  const counts = new Map<SignalType, number>();
  for (const r of rows) for (const s of r.signals) counts.set(s.type, (counts.get(s.type) ?? 0) + 1);
  const topSignals = [...counts.entries()]
    .map(([type, count]) => ({ type, label: SIGNAL_LABELS[type], count }))
    .sort((a, b) => b.count - a.count);

  // score histogram
  const histogram = Array.from({ length: 10 }, (_, i) => ({
    bucket: `${i * 10}-${i === 9 ? 100 : i * 10 + 9}`,
    count: 0,
  }));
  for (const r of rows) histogram[Math.min(9, Math.floor(r.riskScore / 10))].count += 1;

  // level distribution
  const levels: RiskLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
  const levelDistribution = levels.map((level) => ({
    level,
    count: rows.filter((r) => r.riskLevel === level).length,
  }));

  return { rows, metrics, topSignals, scoreHistogram: histogram, levelDistribution };
}
