"use client";

/**
 * RazorShield AI — React Query hooks over the ledger API.
 *
 * One consistent source of truth: the SQLite ledger. Every dashboard
 * surface reads through these hooks — polling keeps the operational
 * views live (5s metrics / 15s health), mutations invalidate what they
 * touch so charts, queues and the audit trail refresh after decisions.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/services/api";
import type { RiskAction, RiskMetric } from "@/types";

const qk = {
  metrics: ["risk-metrics"] as const,
  health: ["system-health"] as const,
  performance: ["model-performance"] as const,
  ledger: (params?: Record<string, unknown>) => ["ledger", params ?? {}] as const,
  audit: (txnId?: string) => ["audit", txnId ?? "all"] as const,
  customers: (q?: string) => ["customers", q ?? ""] as const,
  customer: (id: string) => ["customer", id] as const,
};

/* ------------------------------------------------------------------ */
/* Dashboard metrics — 5s polling                                      */
/* ------------------------------------------------------------------ */

/** Builds the RiskMetric[] cards the command center renders, with
 * sparklines from the real 24h volume buckets. */
function buildMetricCards(m: api.RiskMetricsResponse): RiskMetric[] {
  const counts = m.volumeOverTime.map((b) => b.count);
  const flaggedCounts = m.volumeOverTime.map((b) => b.flagged);
  const valueBuckets = m.volumeOverTime.map((b) => b.value);
  const t = m.totals;
  return [
    {
      key: "transactions",
      label: "Transactions analyzed",
      value: t.transactions,
      tone: "neutral",
      hint: "Payments currently stored in the SQLite ledger — every statistic on this dashboard is computed from these rows.",
    },
    {
      key: "highRisk",
      label: "High risk",
      value: t.highRisk,
      tone: "high",
      hint: "Rows the deterministic engine scored HIGH or CRITICAL. The score band threshold is visible in the calibration views.",
    },
    {
      key: "pendingInvestigations",
      label: "Under review",
      value: t.pendingInvestigations,
      tone: "medium",
      hint: "Cases in the INVESTIGATING or UNDER_REVIEW state right now — the analyst queue.",
    },
    {
      key: "fraudExposure",
      label: "Flagged value (₹k)",
      value: t.flaggedValue,
      tone: "critical",
      hint: `Rupee value of payments the engine scored HIGH or CRITICAL (score ≥ ${t.flaggedThreshold} enters the review flow). Flagged ≠ confirmed fraud — the value is potential exposure until an analyst decides.`,
    },
  ].map((card, i) => ({
    ...card,
    value: card.key === "fraudExposure" ? Math.round(card.value / 1000) : card.value,
    delta: undefined,
    deltaLabel:
      card.key === "transactions"
        ? `· live ledger`
        : card.key === "highRisk"
          ? `· ${t.critical} critical`
          : card.key === "pendingInvestigations"
            ? `· ${m.queue.investigating} investigating · ${m.queue.resolvedToday} resolved 24h`
            : `· ₹${Math.round(t.flaggedValue / 1000)}k total`,
    // attach per-card sparkline data from the real volume buckets
    ...(i === 0 ? { spark: counts } : i === 1 ? { spark: flaggedCounts } : i === 3 ? { spark: valueBuckets } : {}),
  })) as RiskMetric[];
}

export function useRiskMetrics(enabled = true) {
  return useQuery({
    queryKey: qk.metrics,
    queryFn: api.getRiskMetrics,
    refetchInterval: enabled ? 5_000 : false,
    staleTime: 4_000,
    select: (m) => ({
      raw: m,
      metricCards: buildMetricCards(m),
    }),
  });
}

/* ------------------------------------------------------------------ */
/* System health — 15s polling                                         */
/* ------------------------------------------------------------------ */

export function useSystemHealth(enabled = true) {
  return useQuery({
    queryKey: qk.health,
    queryFn: api.getSystemHealth,
    refetchInterval: enabled ? 15_000 : false,
    staleTime: 10_000,
  });
}

/* ------------------------------------------------------------------ */
/* Model performance — 60s polling                                     */
/* ------------------------------------------------------------------ */

export function useModelPerformance(enabled = true) {
  return useQuery({
    queryKey: qk.performance,
    queryFn: api.getModelPerformance,
    refetchInterval: enabled ? 60_000 : false,
    staleTime: 30_000,
  });
}

/* ------------------------------------------------------------------ */
/* Ledger                                                              */
/* ------------------------------------------------------------------ */

export function useLedgerPage(params: api.LedgerQuery, enabled = true) {
  return useQuery({
    queryKey: qk.ledger(params as Record<string, unknown>),
    queryFn: () => api.getLedgerPage(params),
    enabled,
    staleTime: 3_000,
  });
}

export function useAuditTrail(transactionId?: string, pageSize = 40) {
  return useQuery({
    queryKey: qk.audit(transactionId),
    queryFn: () => api.getAuditTrail({ transactionId, pageSize }),
    staleTime: 5_000,
  });
}

export function useCustomerDirectory(q?: string) {
  return useQuery({
    queryKey: qk.customers(q),
    queryFn: () => api.getCustomerDirectory(q),
    staleTime: 10_000,
  });
}

export function useCustomerProfile(id: string | null) {
  return useQuery({
    queryKey: qk.customer(id ?? "none"),
    queryFn: () => api.getCustomerProfile(id as string),
    enabled: Boolean(id),
    staleTime: 5_000,
  });
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

export function useCreateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createTransaction,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.metrics });
      void qc.invalidateQueries({ queryKey: ["ledger"] });
      void qc.invalidateQueries({ queryKey: ["customers"] });
      void qc.invalidateQueries({ queryKey: ["audit"] });
    },
  });
}

export function useRecordDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      txnId,
      decision,
      note,
      analystId,
    }: {
      txnId: string;
      decision: RiskAction;
      note?: string;
      analystId?: string;
    }) => api.recordDecision(txnId, decision, note, analystId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["ledger"] });
      void qc.invalidateQueries({ queryKey: qk.metrics });
      void qc.invalidateQueries({ queryKey: ["audit"] });
      void qc.invalidateQueries({ queryKey: ["transaction-detail"] });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Case notes — server-persisted analyst notebook                      */
/* ------------------------------------------------------------------ */

export function useCaseNotes(txnId: string | null) {
  return useQuery({
    queryKey: ["case-notes", txnId ?? "none"],
    queryFn: () => api.getCaseNotes(txnId as string),
    enabled: Boolean(txnId),
    staleTime: 5_000,
  });
}

export function useAddCaseNote(txnId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ text, analystId }: { text: string; analystId: string }) =>
      api.addCaseNote(txnId, text, analystId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["case-notes", txnId] });
      void qc.invalidateQueries({ queryKey: ["audit"] });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Assignments & escalations — server-persisted, audited               */
/* ------------------------------------------------------------------ */

export function useRecordAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ txnId, assignee, analystId }: { txnId: string; assignee: string | null; analystId?: string }) =>
      api.recordAssignment(txnId, assignee, analystId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["ledger"] });
      void qc.invalidateQueries({ queryKey: ["audit"] });
      void qc.invalidateQueries({ queryKey: ["transaction-detail"] });
    },
  });
}

export function useRecordEscalation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ txnId, escalateTo, analystId }: { txnId: string; escalateTo: string; analystId?: string }) =>
      api.recordEscalation(txnId, escalateTo, analystId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["ledger"] });
      void qc.invalidateQueries({ queryKey: ["audit"] });
      void qc.invalidateQueries({ queryKey: ["transaction-detail"] });
    },
  });
}

export function useImportRows() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.importRowsToLedger,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.metrics });
      void qc.invalidateQueries({ queryKey: ["ledger"] });
      void qc.invalidateQueries({ queryKey: ["customers"] });
    },
  });
}

export function useDemoControls() {
  const qc = useQueryClient();
  const seed = useMutation({
    mutationFn: api.seedDemoData,
    onSuccess: () => void qc.invalidateQueries(),
  });
  const clear = useMutation({
    mutationFn: api.clearDemoData,
    onSuccess: () => void qc.invalidateQueries(),
  });
  return { seed, clear };
}
