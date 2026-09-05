/**
 * RazorShield AI — shared domain types.
 *
 * These mirror the future backend contract (FastAPI / Next API):
 *   GET /transactions, GET /transactions/:id, POST /risk/score,
 *   POST /investigations, GET /customers/:id, GET /risk/metrics,
 *   GET /model/performance
 * The UI is rendered entirely from these structures — never from
 * hardcoded presentation values.
 */

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type RiskAction = "ALLOW" | "REVIEW" | "HOLD" | "BLOCK";

export type TransactionStatus =
  | "EVALUATING"
  | "MONITORING"
  | "INVESTIGATING"
  | "UNDER_REVIEW"
  | "ON_HOLD"
  | "BLOCKED"
  | "ALLOWED";

export type SignalSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type ConnectionStatus = "online" | "offline";

export type SignalType =
  | "NEW_DEVICE"
  | "UNUSUAL_AMOUNT"
  | "LOCATION_ANOMALY"
  | "VELOCITY_SPIKE"
  | "IMPOSSIBLE_TRAVEL"
  | "HIGH_VALUE"
  | "MERCHANT_RISK"
  | "TIME_ANOMALY"
  | "METHOD_MISMATCH"
  | "STRUCTURING";

/** A single piece of risk evidence attached to a transaction. */
export interface RiskSignal {
  id: string;
  type: SignalType;
  title: string;
  /** Why this signal fired — the analyst-facing evidence sentence. */
  evidence: string;
  severity: SignalSeverity;
  /** Approximate points this signal contributed to the composite score. */
  impact: number;
  /** Structured key/value evidence shown inside the signal card. */
  facts: { label: string; value: string }[];
}

export interface Transaction {
  id: string;
  amount: number; // INR
  customerId: string;
  customerName: string;
  merchant: string;
  location: string;
  device: string;
  isNewDevice: boolean;
  paymentMethod: "UPI" | "Credit Card" | "Debit Card" | "Netbanking" | "Wallet";
  riskScore: number; // 0–100
  riskLevel: RiskLevel;
  status: TransactionStatus;
  /** ISO timestamp of when the payment entered the risk engine. */
  timestamp: string;
  currency: "INR";
  signals: RiskSignal[];
  /** AI-generated, analyst-facing investigation summary (no chain-of-thought). */
  aiSummary: string | null;
  recommendation: RiskAction | null;
  /** Model confidence in the recommendation, 0–100. */
  confidence: number | null;
  /** Present only after the AI investigation has run. */
  investigation?: Investigation;
}

export interface Investigation {
  transactionId: string;
  status: "ANALYZING" | "COMPLETE";
  timeline: TimelineEvent[];
  auditTrail: AuditEntry[];
  evidenceUsed: string[];
  reasoning: string;
  /** Analyst's final bounded action, once taken. */
  analystAction?: RiskAction;
  analystNote?: string;
  resolvedAt?: string;
}

export interface TimelineEvent {
  id: string;
  /** hh:mm:ss display time. */
  time: string;
  label: string;
  detail?: string;
  kind: "info" | "warn" | "ai" | "action" | "model";
}

export interface AuditEntry {
  time: string;
  actor: "SYSTEM" | "AI ENGINE" | "RISK MODEL" | "ANALYST";
  action: string;
  detail?: string;
}

export interface Customer {
  id: string;
  name: string;
  kycTier: "FULL KYC" | "MIN KYC" | "PENDING";
  accountAge: string;
  avgTransaction: number;
  transactionCount: number;
  previousIncidents: number;
  usualLocation: string;
  usualDevice: string;
  lastSeen: string;
  /** Recent transaction history for the sparkline / timeline. */
  history: { label: string; amount: number; riskScore: number; flagged?: boolean }[];
}

export interface RiskMetric {
  key: string;
  label: string;
  value: number;
  delta?: number;
  deltaLabel?: string;
  tone: "neutral" | "low" | "medium" | "high" | "critical" | "intel";
  hint: string;
}

export interface ModelPerformance {
  modelVersion: string;
  trainedAt: string;
  trainingDataset: string;
  evaluationDataset: string;
  isDemoSnapshot: boolean;
  precision: number;
  recall: number;
  f1: number;
  rocAuc: number;
  confusionMatrix: {
    truePositives: number;
    falsePositives: number;
    falseNegatives: number;
    trueNegatives: number;
    totalEvaluated: number;
  };
  costAssumptions: {
    falsePositiveCostPerCase: number; // INR — manual review ops cost
    falseNegativeCostPerCase: number; // INR — average fraud loss
    currency: "INR";
  };
  threshold: number;
  note: string;
}

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  time: string;
  tone: "critical" | "high" | "medium" | "intel";
  transactionId?: string;
  read: boolean;
}

export interface SystemService {
  id: string;
  name: string;
  status: "operational" | "degraded" | "offline";
  latencyMs: number;
  uptimeP30d: string;
  detail: string;
}

export type ViewKey =
  | "landing"
  | "overview"
  | "investigations"
  | "transactions"
  | "datastudio"
  | "intelligence"
  | "model"
  | "system"
  | "investigation"
  | "transaction-detail";
