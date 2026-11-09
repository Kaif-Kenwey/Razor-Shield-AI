/**
 * RazorShield AI — Dataset Studio domain types.
 *
 * The import pipeline: a CSV of raw payment records is uploaded, its columns
 * are mapped onto the engine's expected fields, and the risk engine scores
 * every row server-side. When the file carries ground-truth fraud labels the
 * engine also reports honest quality metrics — precision, recall, F1, the
 * confusion matrix, and the rupee cost of the mistakes (false-positive cost).
 */

import type { RiskAction, RiskLevel, RiskSignal } from ".";

/** A raw row as parsed from the uploaded CSV — every value is a string. */
export type RawRow = Record<string, string>;

/** Engine fields a CSV column can be mapped onto. */
export type EngineField =
  | "txnId"
  | "amount"
  | "timestamp"
  | "customerId"
  | "customerName"
  | "merchant"
  | "location"
  | "device"
  | "paymentMethod"
  | "label";

/** Mapping from engine field → CSV column header (empty string = unmapped). */
export type ColumnMapping = Record<EngineField, string>;

/** A single scored row returned by the analysis API. */
export interface ScoredRow {
  /** Row number in the source file (1-based, header excluded). */
  index: number;
  txnId: string;
  amount: number;
  timestamp: string | null;
  customerId: string;
  customerName: string;
  merchant: string;
  location: string;
  device: string;
  paymentMethod: string;
  /** Ground-truth label when the file carried one: 1 = fraud, 0 = legit. */
  label: 0 | 1 | null;
  riskScore: number;
  riskLevel: RiskLevel;
  recommendation: RiskAction;
  signals: RiskSignal[];
  /**
   * Outcome of the engine's recommendation vs the label (labeled rows only):
   * "tp" fraud caught · "fp" legit frozen · "fn" fraud missed · "tn" correct pass.
   */
  outcome?: "tp" | "fp" | "fn" | "tn";
  /** Normalization problems on this row (bad amount, unparsable date…). */
  warnings: string[];
}

/** Honest quality metrics — computed only from rows that carry a label. */
export interface DatasetMetrics {
  labelsPresent: boolean;
  labeledCount: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  trueNegatives: number;
  /** Precision in percent (0 when undefined). */
  precision: number;
  /** Recall in percent (0 when undefined). */
  recall: number;
  f1: number;
  /**
   * Estimated cost of false alarms: funds wrongly frozen (HOLD/BLOCK on legit
   * rows) plus ₹450 review ops per false alert (INR).
   */
  falsePositiveCost: number;
  /** Sum of `amount` across false negatives — fraud that slipped through (INR). */
  falseNegativeCost: number;
  /** Total rupee value the engine alerted on — review queue value (INR). */
  flaggedValue: number;
  /** Detection rate at zero reviews: share of fraud caught if everything ≥ HOLD is blocked. */
  catchRateAtBlock: number;
}

/** Top-level result of one analysis run. */
export interface DatasetAnalysis {
  id: string;
  name: string;
  sourceFile: string;
  rowCount: number;
  skippedCount: number;
  flaggedCount: number;
  avgScore: number;
  createdAt: string;
  /** Engine version that produced the scores. */
  engineVersion: string;
  rows: ScoredRow[];
  metrics: DatasetMetrics;
  /** Signal frequency across all rows, descending — "what fired the most". */
  topSignals: { type: string; label: string; count: number }[];
  /** Histogram buckets of risk scores: 0-9, 10-19, … 90-100. */
  scoreHistogram: { bucket: string; count: number }[];
  /** Level distribution. */
  levelDistribution: { level: RiskLevel; count: number }[];
}

/** List-item projection of a stored analysis (no rows — kept light). */
export interface DatasetSummary {
  id: string;
  name: string;
  sourceFile: string;
  rowCount: number;
  flaggedCount: number;
  labelsPresent: boolean;
  precision: number;
  recall: number;
  f1: number;
  falsePositiveCost: number;
  createdAt: string;
}

/** POST /api/datasets/analyze — request body. */
export interface AnalyzeRequest {
  name: string;
  sourceFile: string;
  headers: string[];
  rows: RawRow[];
  mapping: ColumnMapping;
}

/** POST /api/datasets/analyze — response body. */
export interface AnalyzeResponse {
  analysis: DatasetAnalysis;
}

/** Processing caps — enforced server-side, surfaced in the UI. */
export const DATASET_LIMITS = {
  maxRows: 5000,
  maxFileBytes: 5 * 1024 * 1024,
} as const;

export const EMPTY_MAPPING: ColumnMapping = {
  txnId: "",
  amount: "",
  timestamp: "",
  customerId: "",
  customerName: "",
  merchant: "",
  location: "",
  device: "",
  paymentMethod: "",
  label: "",
};
