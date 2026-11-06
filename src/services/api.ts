/**
 * RazorShield AI — API service layer.
 *
 * The UI talks ONLY to this module, and every method hits the real
 * backend (Next API routes over the Prisma/SQLite ledger). The demo
 * simulation is explicitly labelled: arrivals generated in demo mode are
 * stored with dataSource="demo" and surface in the UI as demo data.
 *
 * Backend contract:
 *   GET    /api/transactions          paginated + filtered ledger
 *   POST   /api/transactions          validate → score → persist
 *   GET    /api/transactions/:id      txn + customer + audit trail
 *   PATCH  /api/transactions/:id      status / analyst decision
 *   GET    /api/customers, /api/customers/:id
 *   GET    /api/risk/metrics          dashboard stats (live queries)
 *   GET    /api/model/performance     labelled-row evaluation
 *   GET    /api/system/health         db latency, counts, LLM state
 *   GET    /api/audit                 persisted audit trail
 *   POST   /api/demo                  seed | arrival (DEMO SIMULATION)
 *   DELETE /api/demo                  clear demo-labelled rows only
 *   POST   /api/investigations→/api/investigate  run + persist investigation
 */

import type {
  Customer,
  ModelPerformance,
  RiskAction,
  RiskMetric,
  Transaction,
  TransactionStatus,
} from "@/types";

export const ENDPOINTS = {
  transactions: "/api/transactions",
  transaction: (id: string) => `/api/transactions/${id}`,
  import: "/api/transactions/import",
  investigate: "/api/investigate",
  customers: "/api/customers",
  customer: (id: string) => `/api/customers/${id}`,
  riskMetrics: "/api/risk/metrics",
  modelPerformance: "/api/model/performance",
  systemHealth: "/api/system/health",
  audit: "/api/audit",
  demo: "/api/demo",
} as const;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const data = (await res.json().catch(() => null)) as
    | (T & { ok?: boolean; error?: string })
    | null;
  if (!res.ok || (data && data.ok === false)) {
    throw new Error(data?.error || `RazorShield API ${res.status}: ${path}`);
  }
  return data as T;
}

/* ------------------------------------------------------------------ */
/* Ledger reads                                                        */
/* ------------------------------------------------------------------ */

export interface LedgerQuery {
  page?: number;
  pageSize?: number;
  sort?: "timestamp" | "amount" | "riskScore";
  order?: "asc" | "desc";
  riskLevel?: string;
  status?: string;
  customerId?: string;
  dataSource?: string;
  q?: string;
}

export interface LedgerPage {
  ok: true;
  rows: Transaction[];
  pagination: { total: number; page: number; pageSize: number; totalPages: number };
}

export async function getLedgerPage(query: LedgerQuery = {}): Promise<LedgerPage> {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  });
  return request<LedgerPage>(`${ENDPOINTS.transactions}?${params.toString()}`);
}

/** Recent ledger rows for the live store boot / polling refresh. */
export async function getRecentTransactions(pageSize = 60): Promise<Transaction[]> {
  const page = await getLedgerPage({ pageSize, sort: "timestamp", order: "desc" });
  return page.rows;
}

/** Rows inserted after a timestamp — the polling delta. */
export async function getTransactionsSince(iso: string, pageSize = 40): Promise<Transaction[]> {
  const page = await getLedgerPage({ pageSize, sort: "timestamp", order: "desc" });
  const since = new Date(iso).getTime();
  return page.rows.filter((t) => new Date(t.timestamp).getTime() > since);
}

export interface TransactionDetail {
  ok: true;
  transaction: Transaction;
  signals: Transaction["signals"];
  warnings: string[];
  auditTrail: { time: string; actor: string; action: string; detail?: string }[];
  customer: {
    id: string;
    name: string;
    kycTier: string;
    riskProfile: string;
    transactionCount: number;
    avgTransaction: number;
    avgRiskScore: number;
    knownDevices: string[];
    usualLocations: string[];
    history: { label: string; amount: number; riskScore: number; flagged?: boolean }[];
  };
}

export async function getTransactionDetail(id: string): Promise<TransactionDetail> {
  return request<TransactionDetail>(ENDPOINTS.transaction(id));
}

/* ------------------------------------------------------------------ */
/* Ledger writes                                                       */
/* ------------------------------------------------------------------ */

export interface NewTransactionPayload {
  amount: number;
  customerId: string;
  customerName?: string;
  merchant?: string;
  location?: string;
  device?: string;
  paymentMethod?: string;
  dataSource?: "demo" | "import" | "manual";
  label?: number | null;
}

export async function createTransaction(payload: NewTransactionPayload): Promise<Transaction> {
  const res = await request<{ ok: true; transaction: Transaction }>(ENDPOINTS.transactions, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res.transaction;
}

export interface ImportResult {
  ok: true;
  imported: number;
  duplicates: string[];
  failed: { txnId: string; error: string }[];
  total: number;
}

export async function importRowsToLedger(payload: {
  datasetName: string;
  rows: Record<string, unknown>[];
}): Promise<ImportResult> {
  return request<ImportResult>(ENDPOINTS.import, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function recordDecision(
  txnId: string,
  decision: RiskAction,
  note?: string,
  analystId?: string,
): Promise<Transaction> {
  const res = await request<{ ok: true; transaction: Transaction }>(ENDPOINTS.transaction(txnId), {
    method: "PATCH",
    body: JSON.stringify({ decision, note, analystId }),
  });
  return res.transaction;
}

export async function updateTransactionStatus(txnId: string, status: TransactionStatus): Promise<Transaction> {
  const res = await request<{ ok: true; transaction: Transaction }>(ENDPOINTS.transaction(txnId), {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  return res.transaction;
}

/* ------------------------------------------------------------------ */
/* Customers                                                           */
/* ------------------------------------------------------------------ */

export interface CustomerDirectory {
  ok: true;
  customers: {
    id: string;
    name: string;
    kycTier: string;
    riskProfile: string;
    transactionCount: number;
    avgTransaction: number;
    medianTransaction: number;
    flaggedCount: number;
    avgRiskScore: number;
    usualDevice: string;
    usualLocation: string;
    usualMethod: string;
    lastSeen: string | null;
    openCases: number;
  }[];
  pagination: { total: number; page: number; pageSize: number; totalPages: number };
}

export async function getCustomerDirectory(q?: string): Promise<CustomerDirectory["customers"]> {
  const res = await request<CustomerDirectory>(
    `${ENDPOINTS.customers}?pageSize=50${q ? `&q=${encodeURIComponent(q)}` : ""}`,
  );
  return res.customers;
}

export interface CustomerProfile
  extends Omit<Customer, "kycTier" | "accountAge" | "previousIncidents" | "usualLocation" | "usualDevice" | "lastSeen"> {
  kycTier: string;
  riskProfile: string;
  medianTransaction: number;
  maxTransaction: number;
  flaggedCount: number;
  flaggedRate?: number;
  openCases: number;
  knownDevices: string[];
  usualLocations: string[];
  methodMix: Record<string, number>;
  firstSeen: string | null;
  accountCreated: string | null;
  priorIncidents?: number;
  transactionCount: number;
  avgTransaction: number;
  lastSeen?: string | null;
}

export async function getCustomerProfile(id: string): Promise<{
  customer: CustomerProfile;
  history: { label: string; amount: number; riskScore: number; flagged?: boolean; txnId: string }[];
  transactions: Transaction[];
}> {
  const res = await request<{
    ok: true;
    customer: CustomerProfile;
    history: { label: string; amount: number; riskScore: number; flagged?: boolean; txnId: string }[];
    transactions: Transaction[];
  }>(ENDPOINTS.customer(id));
  return res;
}

/* ------------------------------------------------------------------ */
/* Metrics / performance / health / audit                              */
/* ------------------------------------------------------------------ */

export interface RiskMetricsResponse {
  ok: true;
  empty: boolean;
  totals: {
    transactions: number;
    value: number;
    highRisk: number;
    critical: number;
    pendingInvestigations: number;
    avgRiskScore: number;
    fraudExposure: number;
  };
  riskDistribution: { level: string; count: number; value: number }[];
  statusDistribution: { status: string; count: number }[];
  byPaymentMethod: { method: string; count: number; value: number }[];
  volumeOverTime: { label: string; count: number; value: number; flagged: number }[];
  topFlaggedMerchants: { merchant: string; flaggedCount: number; value: number; avgRiskScore: number }[];
  highRiskCustomers: { customerId: string; customerName: string; flaggedCount: number; avgRiskScore: number; exposure: number }[];
  queue: { investigating: number; underReview: number; resolvedToday: number };
}

export async function getRiskMetrics(): Promise<RiskMetricsResponse> {
  return request<RiskMetricsResponse>(ENDPOINTS.riskMetrics);
}

export type ModelPerformanceResponse =
  | {
      ok: true;
      insufficientData: true;
      labeledCount: number;
      minRequired: number;
      totalTransactions: number;
      modelVersion: string;
      note: string;
    }
  | {
      ok: true;
      insufficientData: false;
      modelVersion: string;
      engineKind: string;
      evaluatedAt: string;
      labeledCount: number;
      totalTransactions: number;
      threshold: number;
      precision: number;
      recall: number;
      f1: number;
      confusionMatrix: {
        truePositives: number;
        falsePositives: number;
        falseNegatives: number;
        trueNegatives: number;
        totalEvaluated: number;
      };
      /** Average rupee value of missed fraud rows (informative only). */
      costAssumptions?: {
        falsePositiveCostPerCase: number;
        falseNegativeCostPerCase: number;
        currency: "INR";
      };
      note: string;
    };

export async function getModelPerformance(): Promise<ModelPerformanceResponse> {
  return request<ModelPerformanceResponse>(ENDPOINTS.modelPerformance);
}

export interface SystemHealth {
  ok: true;
  database: { ok: boolean; latencyMs: number };
  counts: { transactions: number; customers: number; datasets: number; auditEvents: number };
  queue: { investigating: number; underReview: number };
  llm: { configured: boolean; source: "runtime" | "env" | "none"; provider: string | null; model: string | null };
  engine: { version: string; kind: string };
  serverTime: string;
}

export async function getSystemHealth(): Promise<SystemHealth> {
  return request<SystemHealth>(ENDPOINTS.systemHealth);
}

export interface AuditPage {
  ok: true;
  events: {
    id: string;
    time: string;
    actor: string;
    action: string;
    entityType: string;
    entityId: string;
    detail?: unknown;
    transactionId?: string | null;
  }[];
  pagination: { total: number; page: number; pageSize: number; totalPages: number };
}

export async function getAuditTrail(opts?: { transactionId?: string; pageSize?: number }): Promise<AuditPage["events"]> {
  const params = new URLSearchParams({ pageSize: String(opts?.pageSize ?? 40) });
  if (opts?.transactionId) params.set("transactionId", opts.transactionId);
  const res = await request<AuditPage>(`${ENDPOINTS.audit}?${params.toString()}`);
  return res.events;
}

/* ------------------------------------------------------------------ */
/* Demo simulation (explicit, honest)                                  */
/* ------------------------------------------------------------------ */

export async function seedDemoData(): Promise<{ ok: true; created: number; skipped: number }> {
  return request<{ ok: true; created: number; skipped: number }>(ENDPOINTS.demo, {
    method: "POST",
    body: JSON.stringify({ action: "seed" }),
  });
}

export async function clearDemoData(): Promise<{ ok: true; deleted: number }> {
  return request<{ ok: true; deleted: number }>(ENDPOINTS.demo, { method: "DELETE" });
}

/** One DEMO SIMULATION arrival — stored with dataSource="demo". */
export async function requestDemoArrival(): Promise<{ ids: string[]; burst: boolean; transactions: Transaction[] }> {
  return request<{ ids: string[]; burst: boolean; transactions: Transaction[] }>(ENDPOINTS.demo, {
    method: "POST",
    body: JSON.stringify({ action: "arrival" }),
  });
}

/* ------------------------------------------------------------------ */
/* Investigation                                                       */
/* ------------------------------------------------------------------ */

export interface InvestigationVerdict {
  mode: "llm";
  modelLabel: string;
  riskAssessment: string;
  recommendedAction: RiskAction;
  confidence: number;
  evidence: string[];
  contradictingEvidence: string[];
  uncertainties: string[];
  riskStory: string;
}

export async function runInvestigation(payload: {
  context: Record<string, unknown>;
}): Promise<{ ok: boolean; verdict?: InvestigationVerdict; reason?: string }> {
  return request(ENDPOINTS.investigate, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/* Back-compat shim for the RiskMetric[] consumers — the dashboard builds
 * these live from useRiskMetrics(); this stays for typing convenience. */
export type { RiskMetric };
