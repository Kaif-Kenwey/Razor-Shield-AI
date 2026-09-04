/**
 * RazorShield AI — API service layer.
 *
 * The UI talks ONLY to this module. Today every method resolves from the
 * deterministic mock dataset with realistic latency; when the FastAPI /
 * Next.js backend lands, flip `USE_REMOTE` to true (or implement
 * `remoteFetch`) and the entire frontend keeps working unchanged.
 *
 * Expected backend contract:
 *   GET  /transactions          → Transaction[]
 *   GET  /transactions/:id      → Transaction
 *   POST /risk/score            → { riskScore, riskLevel, signals }
 *   POST /investigations        → Investigation
 *   GET  /customers/:id         → Customer
 *   GET  /risk/metrics          → RiskMetric[]
 *   GET  /model/performance     → ModelPerformance
 */

import type {
  Customer,
  Investigation,
  ModelPerformance,
  RiskMetric,
  Transaction,
} from "@/types";
import {
  CUSTOMERS,
  INITIAL_TRANSACTIONS,
  MODEL_PERFORMANCE,
  RISK_METRICS,
  buildInvestigation,
  customerFor,
} from "@/data/mockData";

const USE_REMOTE = false;

export const ENDPOINTS = {
  transactions: "/api/transactions",
  transaction: (id: string) => `/api/transactions/${id}`,
  riskScore: "/api/risk/score",
  investigations: "/api/investigations",
  customer: (id: string) => `/api/customers/${id}`,
  riskMetrics: "/api/risk/metrics",
  modelPerformance: "/api/model/performance",
} as const;

async function remoteFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) throw new Error(`RazorShield API ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Simulated network latency so loading states are real, not decorative. */
async function mockLatency<T>(value: T, ms = 260 + Math.random() * 340): Promise<T> {
  await delay(ms);
  return value;
}

export const api = {
  async getTransactions(): Promise<Transaction[]> {
    if (USE_REMOTE) return remoteFetch<Transaction[]>(ENDPOINTS.transactions);
    return mockLatency(structuredClone(INITIAL_TRANSACTIONS), 520);
  },

  async getTransaction(id: string): Promise<Transaction | null> {
    if (USE_REMOTE) return remoteFetch<Transaction | null>(ENDPOINTS.transaction(id));
    const txn = INITIAL_TRANSACTIONS.find((t) => t.id === id) ?? null;
    return mockLatency(txn ? structuredClone(txn) : null, 220);
  },

  async getCustomer(id: string): Promise<Customer> {
    if (USE_REMOTE) return remoteFetch<Customer>(ENDPOINTS.customer(id));
    const known = CUSTOMERS[id];
    const txn = INITIAL_TRANSACTIONS.find((t) => t.customerId === id);
    return mockLatency(known ? structuredClone(known) : customerFor(txn ?? {
      ...INITIAL_TRANSACTIONS[0],
      customerId: id,
      customerName: "Unknown Customer",
    }), 300);
  },

  /**
   * Runs the AI investigation for a transaction. In the future this will
   * POST /investigations and stream progress events; the UI already renders
   * a staged "analyzing" sequence while this promise is in flight.
   */
  async runInvestigation(txn: Transaction): Promise<Investigation> {
    if (USE_REMOTE) {
      return remoteFetch<Investigation>(ENDPOINTS.investigations, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId: txn.id }),
      });
    }
    return mockLatency(buildInvestigation(txn, txn.timestamp), 1600);
  },

  async getRiskMetrics(): Promise<RiskMetric[]> {
    if (USE_REMOTE) return remoteFetch<RiskMetric[]>(ENDPOINTS.riskMetrics);
    return mockLatency(structuredClone(RISK_METRICS), 320);
  },

  async getModelPerformance(): Promise<ModelPerformance> {
    if (USE_REMOTE) return remoteFetch<ModelPerformance>(ENDPOINTS.modelPerformance);
    return mockLatency(structuredClone(MODEL_PERFORMANCE), 420);
  },
};
