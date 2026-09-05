/**
 * RazorShield AI — deterministic batch risk engine (rse-1.2).
 *
 * Pure TypeScript: no DOM, no Node APIs, no I/O. Used by the Dataset Studio
 * API route to score uploaded payment records and to compute honest quality
 * metrics when the file carries ground-truth fraud labels.
 *
 * Design notes
 * ------------
 * - Every signal is a rule with an evidence sentence and structured facts,
 *   so an analyst can always ask "why this score?" and get an answer.
 * - Customer-relative signals (unusual amount, location drift, velocity,
 *   impossible travel) only fire when the customer has enough history in the
 *   file. A single-transaction customer never triggers them — that avoids
 *   false precision the data cannot support.
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

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx];
}

function mode(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
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

function modeCount(values: string[]): number {
  const m = mode(values);
  return m ? values.filter((v) => v === m).length : 0;
}

const HOUR = 60 * 60 * 1000;

/** Per-customer aggregates used by the relative rules. */
interface CustomerProfile {
  ids: string[];
  amounts: number[];
  medianAmount: number;
  locations: string[];
  devices: string[];
  methods: string[];
  usualLocation: string;
  usualLocationCount: number;
  usualDevice: string;
  usualMethod: string;
  /** Customer's own records ordered by time (when timestamps exist). */
  timed: { index: number; at: number; location: string }[];
}

interface DatasetStats {
  rows: EngineInput[];
  medianAmount: number;
  p95Amount: number;
  customers: Map<string, CustomerProfile>;
  deviceFirstUse: Map<string, number>;
  /** Median amount per merchant — merchant-outlier rule. */
  merchantMedian: Map<string, number>;
  /** How many transactions carry a parsable timestamp. */
  timedCount: number;
}

export function computeStats(rows: EngineInput[]): DatasetStats {
  const amounts = rows.map((r) => r.amount);
  const customers = new Map<string, CustomerProfile>();
  const deviceUse = new Map<string, number>();
  const merchantAmounts = new Map<string, number[]>();

  for (const r of rows) {
    let cp = customers.get(r.customerId);
    if (!cp) {
      cp = {
        ids: [],
        amounts: [],
        medianAmount: 0,
        locations: [],
        devices: [],
        methods: [],
        usualLocation: "",
        usualLocationCount: 0,
        usualDevice: "",
        usualMethod: "",
        timed: [],
      };
      customers.set(r.customerId, cp);
    }
    cp.ids.push(r.txnId);
    cp.amounts.push(r.amount);
    cp.locations.push(r.location);
    cp.devices.push(r.device);
    cp.methods.push(r.paymentMethod);
    if (r.at !== null) cp.timed.push({ index: r.index, at: r.at, location: r.location });
    deviceUse.set(r.device, (deviceUse.get(r.device) ?? 0) + 1);

    const ma = merchantAmounts.get(r.merchant) ?? [];
    ma.push(r.amount);
    merchantAmounts.set(r.merchant, ma);
  }

  const merchantMedian = new Map<string, number>();
  for (const [m, vals] of merchantAmounts) merchantMedian.set(m, median(vals));

  for (const cp of customers.values()) {
    cp.medianAmount = median(cp.amounts);
    cp.usualLocation = mode(cp.locations);
    cp.usualLocationCount = cp.usualLocation
      ? cp.locations.filter((v) => v === cp!.usualLocation).length
      : 0;
    cp.usualDevice = mode(cp.devices);
    cp.usualMethod = mode(cp.methods);
    cp.timed.sort((a, b) => a.at - b.at);
  }

  const deviceFirstUse = new Map<string, number>();
  for (const [device, n] of deviceUse) deviceFirstUse.set(device, n);

  return {
    rows,
    medianAmount: median(amounts),
    p95Amount: percentile(amounts, 95),
    customers,
    deviceFirstUse,
    merchantMedian,
    timedCount: rows.filter((r) => r.at !== null).length,
  };
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
 * Scores one record against the dataset statistics. Returns the composite
 * score (0–100), the fired signals and the recommended action.
 */
export function scoreRecord(rec: EngineInput, stats: DatasetStats): {
  score: number;
  signals: RiskSignal[];
  recommendation: RiskAction;
} {
  const signals: RiskSignal[] = [];
  const cp = stats.customers.get(rec.customerId);
  const history = cp ? cp.ids.length : 0;
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
          { label: "Dataset median", value: inr(stats.medianAmount) },
        ],
      ),
    );
  } else if (rec.amount >= 50_000) {
    signals.push(
      signal(
        "HIGH_VALUE",
        "Elevated ticket size",
        `${inr(rec.amount)} crosses the ₹50,000 review threshold (${(rec.amount / Math.max(stats.medianAmount, 1)).toFixed(1)}× the dataset median).`,
        "HIGH",
        WEIGHTS.highValue * 0.7,
        [
          { label: "Amount", value: inr(rec.amount) },
          { label: "Dataset median", value: inr(stats.medianAmount) },
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

  /* --- customer-relative amount ---------------------------------- */
  if (cp && history >= 3 && cp.medianAmount > 0 && rec.amount >= cp.medianAmount * 5) {
    signals.push(
      signal(
        "UNUSUAL_AMOUNT",
        "Amount deviates from customer baseline",
        `${inr(rec.amount)} is ${(rec.amount / cp.medianAmount).toFixed(1)}× this customer's median ticket of ${inr(cp.medianAmount)}.`,
        rec.amount >= cp.medianAmount * 10 ? "HIGH" : "MEDIUM",
        WEIGHTS.unusualAmount,
        [
          { label: "Customer median", value: inr(cp.medianAmount) },
          { label: "This txn", value: `${(rec.amount / cp.medianAmount).toFixed(1)}×` },
          { label: "History", value: `${history} txns` },
        ],
      ),
    );
  }

  /* --- velocity + impossible travel (needs timestamps) ------------ */
  if (cp && at !== null && cp.timed.length >= 3) {
    const window = cp.timed.filter((t) => Math.abs(t.at - at) <= 10 * 60 * 1000);
    const peers = window.length;
    if (peers >= 3) {
      signals.push(
        signal(
          "VELOCITY_SPIKE",
          "Velocity spike",
          `${peers} transactions on this customer within a 10-minute window — burst behaviour consistent with card testing or scripted fraud.`,
          peers >= 5 ? "CRITICAL" : "HIGH",
          Math.min(WEIGHTS.velocity, 14 + (peers - 2) * 4),
          [
            { label: "Txns / 10 min", value: String(peers) },
            { label: "Customer", value: rec.customerName || rec.customerId },
          ],
        ),
      );
    }

    const nearest = cp.timed
      .filter((t) => t.index !== rec.index)
      .map((t) => ({ ...t, gap: Math.abs(t.at - at) }))
      .sort((a, b) => a.gap - b.gap)[0];
    if (
      nearest &&
      nearest.gap <= HOUR &&
      nearest.location &&
      rec.location &&
      nearest.location.toLowerCase() !== rec.location.toLowerCase()
    ) {
      signals.push(
        signal(
          "IMPOSSIBLE_TRAVEL",
          "Impossible travel",
          `This payment is ${rec.location} while a transaction ${Math.round(nearest.gap / 60000)} min earlier/later is ${nearest.location} — the customer cannot be in both places.`,
          "HIGH",
          WEIGHTS.impossibleTravel,
          [
            { label: "This location", value: rec.location },
            { label: "Other location", value: nearest.location },
            { label: "Gap", value: `${Math.round(nearest.gap / 60000)} min` },
          ],
        ),
      );
    }
  }

  /* --- location drift --------------------------------------------- */
  if (cp && history >= 3 && cp.usualLocationCount >= Math.ceil(history * 0.6) &&
      rec.location && rec.location.toLowerCase() !== cp.usualLocation.toLowerCase()) {
    signals.push(
      signal(
        "LOCATION_ANOMALY",
        "Unusual location for this customer",
        `${rec.location} is outside this customer's usual corridor (${cp.usualLocation} on ${cp.usualLocationCount}/${history} prior transactions).`,
        "MEDIUM",
        WEIGHTS.locationAnomaly,
        [
          { label: "This txn", value: rec.location },
          { label: "Usual", value: cp.usualLocation },
          { label: "History", value: `${history} txns` },
        ],
      ),
    );
  }

  /* --- device reputation ------------------------------------------ */
  /* Two honest, distinct device evidences:
   *  A) behavioral — the customer HAS prior history and this device is
   *     first-seen for THEM (cold-start customers are exempt: with no
   *     device history, "new" is not evidence).
   *  B) infrastructure — the device is portfolio-rare (single use in the
   *     file): a burner tell. Weaker per-customer evidence, labeled as
   *     what it is; cross-account device sharing is escalated to the
   *     entity-graph fraud-ring module. */
  const priorRows = history; // customer's other transactions in the file
  const customerDeviceUses = cp
    ? cp.devices.filter((d) => d === rec.device).length - 1 // minus the row itself
    : 0;
  const portfolioUses = rec.device ? stats.deviceFirstUse.get(rec.device) ?? 0 : 0;
  const newForCustomer = rec.device && customerDeviceUses <= 0 && priorRows >= 3;
  const portfolioRare = rec.device && portfolioUses <= 1;
  if (rec.device && (newForCustomer || portfolioRare)) {
    signals.push(
      signal(
        "NEW_DEVICE",
        newForCustomer ? "First-seen device for this customer" : "Unrecognized device (single use in file)",
        newForCustomer
          ? `Device "${rec.device}" has no prior history for ${rec.customerId} across ${priorRows} earlier transactions${portfolioRare ? " and appears nowhere else in the file" : ""} — unseen-device risk on a ${inr(rec.amount)} payment.`
          : `Device "${rec.device}" appears exactly once in the whole file and has no customer history — burner-device pattern on a ${inr(rec.amount)} payment.`,
        newForCustomer ? "MEDIUM" : "LOW",
        WEIGHTS.newDevice,
        newForCustomer
          ? [
              { label: "Device", value: rec.device },
              { label: "Usual device", value: cp?.usualDevice || "—" },
              { label: "Prior uses (customer)", value: "0" },
            ]
          : [
              { label: "Device", value: rec.device },
              { label: "Seen in file", value: `${portfolioUses}×` },
              { label: "Customer history", value: `${priorRows} prior txns` },
            ],
      ),
    );
  }

  /* --- time-of-day ------------------------------------------------ */
  if (hour !== null && (hour >= 0 && hour < 5)) {
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
  const mMedian = stats.merchantMedian.get(rec.merchant) ?? 0;
  if (rec.merchant && mMedian > 0 && rec.amount >= mMedian * 6 && rec.amount >= stats.p95Amount) {
    signals.push(
      signal(
        "MERCHANT_RISK",
        "Outlier vs merchant profile",
        `${inr(rec.amount)} at ${rec.merchant} is ${(rec.amount / mMedian).toFixed(1)}× that merchant's typical ticket and in the top 5% of file values.`,
        "MEDIUM",
        WEIGHTS.merchantOutlier,
        [
          { label: "Merchant median", value: inr(mMedian) },
          { label: "This txn", value: `${(rec.amount / mMedian).toFixed(1)}×` },
        ],
      ),
    );
  }

  /* --- payment-method mismatch ------------------------------------ */
  if (cp && history >= 3 && cp.usualMethod && rec.paymentMethod &&
      rec.paymentMethod.toLowerCase() !== cp.usualMethod.toLowerCase()) {
    signals.push(
      signal(
        "METHOD_MISMATCH",
        "New payment method for this customer",
        `Paid via ${rec.paymentMethod}; this customer's history is ${cp.usualMethod} — account-takeover actors often switch rails first.`,
        "MEDIUM",
        WEIGHTS.methodMismatch,
        [
          { label: "This txn", value: rec.paymentMethod },
          { label: "Usual", value: cp.usualMethod },
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

/** Scores a full batch and derives the aggregate analytics. */
export function scoreBatch(inputs: EngineInput[]): BatchResult {
  const stats = computeStats(inputs);

  const rows: ScoredRow[] = inputs.map((rec) => {
    const { score, signals } = scoreRecord(rec, stats);
    const level = scoreToLevel(score);
    return {
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
      warnings: [],
    };
  });

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
