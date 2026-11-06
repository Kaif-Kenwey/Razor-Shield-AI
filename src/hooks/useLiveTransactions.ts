"use client";

/**
 * useLiveTransactions — boots the ledger store from the SQLite API and
 * keeps it live with polling (TanStack Query handles the server-state
 * surfaces; this hook owns the operational feed store).
 *
 * Data flow (honest version):
 *   boot   → GET /api/transactions (latest 60 stored rows)
 *   poll   → every 4s, merge newer/updated server rows into the store
 *   demo   → when DEMO SIMULATION is on, the client asks the server for a
 *            synthetic arrival every ~8s (POST /api/demo, action=arrival).
 *            Those rows are stored with dataSource="demo" and labelled as
 *            demo data in the UI — they are never presented as live
 *            gateway traffic.
 *
 * Escalation lifecycle per arrival:
 *   arrives (EVALUATING, score —)
 *     → the server has ALREADY scored it against stored history
 *     → the scored row settles in after a short client-side beat
 *     → HIGH/CRITICAL become INVESTIGATING and are demo-clickable
 *
 * Coordinated bursts: the arrival endpoint occasionally returns 3-4
 * correlated rows (shared burner device); the client raises the typed
 * FRAUD CLUSTER DETECTED stream event once they land.
 */

import { useEffect, useRef } from "react";
import { useAppStore } from "@/store/appStore";
import * as api from "@/services/api";
import { playCriticalChime } from "@/lib/alertSound";
import { useClusterStore } from "@/hooks/useFraudClusters";
import { CLUSTER_WINDOW_MS } from "@/lib/demoClusters";
import type { Transaction } from "@/types";
import { useToast } from "@/hooks/use-toast";

const POLL_MS = 4_000;
const ARRIVAL_INTERVAL_MS = 8_000;
const EVALUATION_MS = 2_200;
const STORE_CAP = 80;

/** Apply the analyst's persisted decisions to freshly-booted rows so a
 * reload never resurrects a resolved case. */
function applyPersistedDecisions(txns: Transaction[]): Transaction[] {
  const { decisions } = useAppStore.getState();
  return txns.map((t) => {
    const d = decisions[t.id];
    if (!d) return t;
    const status =
      d.action === "BLOCK"
        ? "BLOCKED"
        : d.action === "ALLOW"
          ? "ALLOWED"
          : d.action === "HOLD"
            ? "ON_HOLD"
            : "UNDER_REVIEW";
    return {
      ...t,
      status,
      investigation: t.investigation
        ? {
            ...t.investigation,
            analystAction: d.action,
            analystNote: d.note,
            resolvedAt: d.at,
          }
        : t.investigation,
    };
  });
}

export function useLiveTransactions() {
  const demoMode = useAppStore((s) => s.demoMode);
  const streamPaused = useAppStore((s) => s.streamPaused);
  const connection = useAppStore((s) => s.connection);
  const setLoading = useAppStore((s) => s.setLoading);
  const setTransactions = useAppStore((s) => s.setTransactions);
  const setConnection = useAppStore((s) => s.setConnection);
  const { toast } = useToast();

  const demoRef = useRef(demoMode);
  const pausedRef = useRef(streamPaused);
  const connRef = useRef(connection);
  demoRef.current = demoMode;
  pausedRef.current = streamPaused;
  connRef.current = connection;

  /* initial boot from the SQLite ledger ----------------------------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // restore persisted analyst state (watchlist / decisions / toggles)
        // before boot so decisions can be re-applied to fresh transactions
        await useAppStore.persist.rehydrate();
        const txns = await api.getRecentTransactions(60);
        if (cancelled) return;
        setTransactions(applyPersistedDecisions(txns));
        setConnection("online");
      } catch (err) {
        console.error("[RS] boot failed", err);
        if (!cancelled) setConnection("offline");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setTransactions, setLoading, setConnection]);

  /* polling — merge server truth into the feed ---------------------- */
  useEffect(() => {
    if (connection === "offline") return;
    const tick = async () => {
      if (pausedRef.current) return;
      try {
        const rows = await api.getRecentTransactions(30);
        const s = useAppStore.getState();
        const local = new Map(s.transactions.map((t) => [t.id, t]));
        let changed = false;
        const merged = [...local.values()];

        for (const row of rows) {
          const decided = Boolean(s.decisions[row.id]);
          const existing = local.get(row.id);
          if (!existing) {
            // new arrival — prepend, with the evaluating→settled beat
            merged.unshift({ ...row, status: "EVALUATING", riskScore: 0 });
            changed = true;
            const rowRef = row;
            setTimeout(() => {
              const st = useAppStore.getState();
              const still = st.transactions.find((t) => t.id === rowRef.id);
              if (!still || still.status !== "EVALUATING") return;
              const decidedNow = Boolean(st.decisions[rowRef.id]);
              st.updateTransaction(rowRef.id, {
                riskScore: rowRef.riskScore,
                riskLevel: rowRef.riskLevel,
                recommendation: rowRef.recommendation,
                confidence: rowRef.confidence,
                status: decidedNow
                  ? still.status
                  : rowRef.riskLevel === "CRITICAL" || rowRef.riskLevel === "HIGH"
                    ? "INVESTIGATING"
                    : "MONITORING",
                signals: rowRef.signals,
              });
              if (!decidedNow && rowRef.riskLevel === "CRITICAL") {
                if (useAppStore.getState().soundEnabled) playCriticalChime();
                toast({
                  title: `Critical transaction ${rowRef.id}`,
                  description: `₹${rowRef.amount.toLocaleString("en-IN")} · ${rowRef.location} — AI investigation available.`,
                  variant: "destructive",
                });
              }
            }, EVALUATION_MS);
          } else if (
            !decided &&
            (existing.status !== row.status ||
              existing.status === "EVALUATING" && row.status !== "EVALUATING")
          ) {
            // server-side status moved (another analyst/tab or the engine)
            const idx = merged.findIndex((t) => t.id === row.id);
            if (idx >= 0) {
              merged[idx] = { ...existing, ...row };
              changed = true;
            }
          }
        }
        if (changed) {
          setTransactions(merged.slice(0, STORE_CAP));
        }
        if (useAppStore.getState().connection === "offline") {
          useAppStore.getState().setConnection("online");
        }
      } catch {
        useAppStore.getState().setConnection("offline");
      }
    };
    const timer = setInterval(tick, POLL_MS);
    return () => clearInterval(timer);
  }, [connection, setTransactions, toast]);

  /* DEMO SIMULATION arrivals ---------------------------------------- */
  useEffect(() => {
    if (!demoMode || connection === "offline" || streamPaused) return;

    const spawn = async () => {
      if (!demoRef.current || connRef.current === "offline" || pausedRef.current) return;
      try {
        const res = await api.requestDemoArrival();
        const s = useAppStore.getState();
        const known = new Set(s.transactions.map((t) => t.id));
        const fresh = res.transactions.filter((t) => !known.has(t.id));
        if (!fresh.length) return;

        // stage as EVALUATING, then settle each row (server already scored)
        setTransactions(
          [
            ...fresh.map((t) => ({ ...t, status: "EVALUATING" as const, riskScore: 0 })),
            ...s.transactions,
          ].slice(0, STORE_CAP),
        );

        fresh.forEach((row, i) => {
          setTimeout(
            () => {
              const st = useAppStore.getState();
              const still = st.transactions.find((t) => t.id === row.id);
              if (!still || still.status !== "EVALUATING") return;
              if (st.decisions[row.id]) return; // resolved while staging
              st.updateTransaction(row.id, {
                status:
                  row.riskLevel === "CRITICAL" || row.riskLevel === "HIGH"
                    ? "INVESTIGATING"
                    : "MONITORING",
              });
              if (row.riskLevel === "CRITICAL") {
                if (useAppStore.getState().soundEnabled) playCriticalChime();
                toast({
                  title: `Critical transaction ${row.id}`,
                  description: `₹${row.amount.toLocaleString("en-IN")} · ${row.location} — AI investigation available.`,
                  variant: "destructive",
                });
              }
            },
            EVALUATION_MS + i * 150,
          );
        });

        // correlated burst → typed stream event for the cluster banner
        if (res.burst && fresh.length >= 3) {
          const exposure = fresh.reduce((sum, t) => sum + t.amount, 0);
          useClusterStore.getState().registerCluster({
            id: `burst-${fresh[0].id}`,
            detectedAt: new Date().toISOString(),
            archetype: "device",
            summary: {
              txnCount: fresh.length,
              deviceCount: new Set(fresh.map((t) => t.device)).size,
              exposure,
            },
            memberIds: fresh.map((t) => t.id),
            topTxnId: [...fresh].sort((a, b) => b.amount - a.amount)[0].id,
            linkedCaseId: null,
            status: "active",
          });
          setTimeout(() => useClusterStore.getState().closeWindow(`burst-${fresh[0].id}`), CLUSTER_WINDOW_MS);
        }
      } catch {
        /* demo arrival failed (server busy) — polling still reflects truth */
      }
    };

    const timer = setInterval(spawn, ARRIVAL_INTERVAL_MS);
    const warmup = setTimeout(spawn, 2_500);
    return () => {
      clearInterval(timer);
      clearTimeout(warmup);
    };
  }, [demoMode, connection, streamPaused, setTransactions, toast]);
}
