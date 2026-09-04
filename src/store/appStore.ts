"use client";

/**
 * RazorShield AI — client state.
 * Holds SPA view state (single-route product), demo mode, connection
 * status, analyst decisions and per-transaction investigation progress.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ConnectionStatus, RiskAction, Transaction, ViewKey } from "@/types";

export type InvestigationPhase = "idle" | "analyzing" | "complete";

/** The fraud desk — one-click SLA-breach escalations route here. */
export const L3_LEAD_ID = "AD";

/** One append-only notebook entry on a case. */
export interface CaseNote {
  id: string;
  text: string;
  analystId: string;
  at: string;
}

interface AppState {
  view: ViewKey;
  /** Transaction under investigation (investigation view). */
  focusTxnId: string | null;
  /** Transaction shown in the detail view. */
  detailTxnId: string | null;
  demoMode: boolean;
  /** Demo arrivals paused — freeze the stream while presenting. */
  streamPaused: boolean;
  connection: ConnectionStatus;
  transactions: Transaction[];
  loading: boolean;
  /** Investigation lifecycle per transaction. */
  phases: Record<string, InvestigationPhase>;
  /** Analyst decisions per transaction (bounded actions, attributed). */
  decisions: Record<string, { action: RiskAction; note?: string; at: string; analystId?: string }>;
  /** Cases the analyst is watching. */
  watchlist: Record<string, true>;
  /** Case handoff — which analyst a case is assigned to (acceptedAt = claim recorded). */
  assignments: Record<string, { analystId: string; at: string; acceptedAt?: string }>;
  /** SLA-breach escalations — one-click "send to the L3 fraud lead" events (audited). */
  escalations: Record<string, { at: string; byAnalystId: string; toAnalystId: string }>;
  /** Append-only per-case analyst notebook. */
  caseNotes: Record<string, CaseNote[]>;
  /** Which roster analyst is currently signed in ("acting as"). */
  signedInAnalystId: string;
  /** Audible chime when a CRITICAL transaction lands. */
  soundEnabled: boolean;
  unreadNotifications: number;
  /** Pattern digest modal (weekly stats brief). */
  digestOpen: boolean;
  /** Once-per-session flag — the scheduled digest briefing toast. */
  digestToastShown: boolean;
  /** While true, printing shows the digest brief instead of a case file. */
  digestPrintOpen: boolean;
  /** Queue prefilter — show only cases assigned to this analyst ("__unassigned" = pool). Ephemeral. */
  queueAssignee: string | null;
  /** Queue prefilter — show only open cases past the SLA breach threshold. Ephemeral. */
  queueBreachFilter: boolean;
  /** Notebook entry to spotlight after a palette jump (scroll + flash). Ephemeral. */
  highlightNoteId: string | null;

  navigate: (view: ViewKey) => void;
  openInvestigation: (txnId: string) => void;
  openTransactionDetail: (txnId: string) => void;
  setTransactions: (txns: Transaction[]) => void;
  setLoading: (loading: boolean) => void;
  setDemoMode: (on: boolean) => void;
  setStreamPaused: (paused: boolean) => void;
  setConnection: (status: ConnectionStatus) => void;
  setPhase: (txnId: string, phase: InvestigationPhase) => void;
  resolveAction: (txnId: string, action: RiskAction, note?: string) => void;
  toggleWatch: (txnId: string) => void;
  assignCase: (txnId: string, analystId: string | null) => void;
  /** Assigned analyst claims the case — audited; switches the acting persona unless keepPersona. */
  acceptCaseHandoff: (txnId: string, opts?: { keepPersona?: boolean }) => void;
  /** One-click SLA-breach escalation — reassigns to the L3 fraud lead (audited). */
  escalateCase: (txnId: string) => void;
  addCaseNote: (txnId: string, text: string) => void;
  setSignedInAnalyst: (analystId: string) => void;
  setDigestOpen: (open: boolean) => void;
  setDigestPrintOpen: (open: boolean) => void;
  setQueueAssignee: (analystId: string | null) => void;
  setQueueBreachFilter: (on: boolean) => void;
  setHighlightNoteId: (noteId: string | null) => void;
  markDigestToastShown: () => void;
  setSoundEnabled: (on: boolean) => void;
  markNotificationsRead: () => void;
  updateTransaction: (txnId: string, patch: Partial<Transaction>) => void;
}

/**
 * Keys that survive a reload during a pitch: the analyst's watchlist,
 * recorded decisions, and presentation toggles. Ephemeral state
 * (view, transactions, phases) re-boots from the API layer.
 */
const PERSISTED_KEYS = [
  "watchlist",
  "decisions",
  "assignments",
  "escalations",
  "caseNotes",
  "signedInAnalystId",
  "demoMode",
  "streamPaused",
  "soundEnabled",
] as const;

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
  view: "landing",
  focusTxnId: null,
  detailTxnId: null,
  demoMode: true,
  streamPaused: false,
  connection: "online",
  transactions: [],
  loading: true,
  phases: {},
  decisions: {},
  watchlist: {},
  assignments: {},
  escalations: {},
  caseNotes: {},
  signedInAnalystId: "RK",
  soundEnabled: false,
  unreadNotifications: 2,
  digestOpen: false,
  digestToastShown: false,
  digestPrintOpen: false,
  queueAssignee: null,
  queueBreachFilter: false,
  highlightNoteId: null,

  navigate: (view) => set({ view, focusTxnId: null, detailTxnId: null }),

  openInvestigation: (txnId) =>
    set({ view: "investigation", focusTxnId: txnId, detailTxnId: null }),

  openTransactionDetail: (txnId) =>
    set({ view: "transaction-detail", detailTxnId: txnId, focusTxnId: null }),

  setTransactions: (transactions) => set({ transactions }),
  setLoading: (loading) => set({ loading }),
  setDemoMode: (demoMode) => set({ demoMode }),
  setStreamPaused: (streamPaused) => set({ streamPaused }),
  setConnection: (connection) => set({ connection }),

  toggleWatch: (txnId) =>
    set((s) => {
      const next = { ...s.watchlist };
      if (next[txnId]) delete next[txnId];
      else next[txnId] = true;
      return { watchlist: next };
    }),

  setSoundEnabled: (soundEnabled) => set({ soundEnabled }),

  assignCase: (txnId, analystId) =>
    set((s) => {
      const next = { ...s.assignments };
      if (analystId) next[txnId] = { analystId, at: new Date().toISOString() };
      else delete next[txnId];
      return { assignments: next };
    }),

  acceptCaseHandoff: (txnId, opts) =>
    set((s) => {
      const a = s.assignments[txnId];
      if (!a || a.acceptedAt) return {};
      return {
        assignments: { ...s.assignments, [txnId]: { ...a, acceptedAt: new Date().toISOString() } },
        /* claiming a handoff means acting as the assigned analyst from now on —
           unless the claimer keeps their own persona (L3 leads reviewing other queues) */
        ...(!opts?.keepPersona ? { signedInAnalystId: a.analystId } : {}),
      };
    }),

  escalateCase: (txnId) =>
    set((s) => {
      /* single escalation per case — re-escalating is a no-op */
      if (s.escalations[txnId]) return {};
      return {
        escalations: {
          ...s.escalations,
          [txnId]: { at: new Date().toISOString(), byAnalystId: s.signedInAnalystId, toAnalystId: L3_LEAD_ID },
        },
        /* the breach re-routes the handoff to the L3 fraud lead */
        assignments: { ...s.assignments, [txnId]: { analystId: L3_LEAD_ID, at: new Date().toISOString() } },
      };
    }),

  addCaseNote: (txnId, text) =>
    set((s) => {
      const note: CaseNote = {
        id: `note_${Date.now().toString(36)}`,
        text,
        analystId: s.signedInAnalystId,
        at: new Date().toISOString(),
      };
      return { caseNotes: { ...s.caseNotes, [txnId]: [...(s.caseNotes[txnId] ?? []), note] } };
    }),

  setSignedInAnalyst: (signedInAnalystId) => set({ signedInAnalystId }),

  setDigestOpen: (digestOpen) => set({ digestOpen }),

  setDigestPrintOpen: (digestPrintOpen) => set({ digestPrintOpen }),

  setQueueAssignee: (queueAssignee) => set({ queueAssignee }),

  setQueueBreachFilter: (queueBreachFilter) => set({ queueBreachFilter }),

  setHighlightNoteId: (highlightNoteId) => set({ highlightNoteId }),

  markDigestToastShown: () => set({ digestToastShown: true }),

  setPhase: (txnId, phase) =>
    set((s) => ({ phases: { ...s.phases, [txnId]: phase } })),

  resolveAction: (txnId, action, note) =>
    set((s) => ({
      decisions: {
        ...s.decisions,
        [txnId]: { action, note, at: new Date().toISOString(), analystId: s.signedInAnalystId },
      },
      transactions: s.transactions.map((t) =>
        t.id === txnId
          ? {
              ...t,
              status:
                action === "BLOCK"
                  ? "BLOCKED"
                  : action === "ALLOW"
                    ? "ALLOWED"
                    : action === "HOLD"
                      ? "ON_HOLD"
                      : "UNDER_REVIEW",
              investigation: t.investigation
                ? {
                    ...t.investigation,
                    analystAction: action,
                    analystNote: note,
                    resolvedAt: new Date().toISOString(),
                  }
                : t.investigation,
            }
          : t,
      ),
    })),

  markNotificationsRead: () => set({ unreadNotifications: 0 }),

  updateTransaction: (txnId, patch) =>
    set((s) => ({
      transactions: s.transactions.map((t) =>
        t.id === txnId ? { ...t, ...patch } : t,
      ),
    })),
    }),
    {
      name: "razorshield-analyst-v1",
      version: 2,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) =>
        Object.fromEntries(PERSISTED_KEYS.map((k) => [k, s[k]])) as Pick<
          AppState,
          (typeof PERSISTED_KEYS)[number]
        >,
      /** v1 → v2: notebook, persona identity and decision attribution. */
      migrate: (persisted: unknown) => {
        const p = (persisted ?? {}) as Record<string, unknown>;
        return {
          ...p,
          caseNotes: p.caseNotes ?? {},
          escalations: p.escalations ?? {},
          signedInAnalystId: p.signedInAnalystId ?? "RK",
        } as Pick<AppState, (typeof PERSISTED_KEYS)[number]>;
      },
      /** Rehydrate after first client render — avoids SSR hydration mismatch. */
      skipHydration: true,
    }
  )
);
