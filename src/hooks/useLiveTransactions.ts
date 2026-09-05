"use client";

/**
 * useLiveTransactions — boots the feed from the API layer, then (in demo
 * mode) emits a deterministic scripted stream of arrivals.
 *
 * Escalation lifecycle per arrival:
 *   arrives (EVALUATING, score —)
 *     → risk engine evaluates (~2.2s)
 *     → score settles, level assigned
 *     → HIGH/CRITICAL become INVESTIGATING and are demo-clickable
 */

import { useEffect, useRef } from "react";
import { useAppStore } from "@/store/appStore";
import { api } from "@/services/api";
import { DEMO_ARRIVALS_SCRIPT, buildInvestigation, idFromSeed, makeSignals } from "@/data/mockData";
import { riskLevelFromScore } from "@/lib/format";
import { playCriticalChime } from "@/lib/alertSound";
import type { Transaction } from "@/types";
import { useToast } from "@/hooks/use-toast";

const ARRIVAL_INTERVAL_MS = 8000;
const EVALUATION_MS = 2200;

export function useLiveTransactions() {
  const demoMode = useAppStore((s) => s.demoMode);
  const streamPaused = useAppStore((s) => s.streamPaused);
  const connection = useAppStore((s) => s.connection);
  const setLoading = useAppStore((s) => s.setLoading);
  const setTransactions = useAppStore((s) => s.setTransactions);
  const setConnection = useAppStore((s) => s.setConnection);
  const updateTransaction = useAppStore((s) => s.updateTransaction);
  const { toast } = useToast();

  const scriptIndex = useRef(0);
  const cycle = useRef(0);
  const demoRef = useRef(demoMode);
  const pausedRef = useRef(streamPaused);
  const connRef = useRef(connection);
  demoRef.current = demoMode;
  pausedRef.current = streamPaused;
  connRef.current = connection;

  /* initial boot from the (mock) API ------------------------------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // restore persisted analyst state (watchlist / decisions / toggles)
        // before boot so decisions can be re-applied to fresh transactions
        await useAppStore.persist.rehydrate();
        const txns = await api.getTransactions();
        if (cancelled) return;
        // re-apply persisted analyst decisions — transaction rows boot in
        // their original engine state, so a reload must not resurrect a
        // case the analyst already resolved.
        const { decisions, updateTransaction: patch } = useAppStore.getState();
        for (const [txnId, d] of Object.entries(decisions)) {
          const t = txns.find((x) => x.id === txnId);
          if (!t) continue;
          t.status =
            d.action === "BLOCK"
              ? "BLOCKED"
              : d.action === "ALLOW"
                ? "ALLOWED"
                : d.action === "HOLD"
                  ? "ON_HOLD"
                  : "UNDER_REVIEW";
          if (t.investigation) {
            t.investigation.analystAction = d.action;
            t.investigation.analystNote = d.note;
            t.investigation.resolvedAt = d.at;
          }
          patch(txnId, { status: t.status, investigation: t.investigation });
        }
        setTransactions(txns);
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

  /* demo arrivals --------------------------------------------------- */
  useEffect(() => {
    if (!demoMode || connection === "offline" || streamPaused) return;

    const spawn = () => {
      if (!demoRef.current || connRef.current === "offline" || pausedRef.current) return;

      const script = DEMO_ARRIVALS_SCRIPT[scriptIndex.current % DEMO_ARRIVALS_SCRIPT.length];
      const seed = `live-${cycle.current}-${scriptIndex.current}`;
      scriptIndex.current += 1;
      if (scriptIndex.current % DEMO_ARRIVALS_SCRIPT.length === 0) cycle.current += 1;

      const id = `TXN_${idFromSeed(seed)}`;
      const now = new Date().toISOString();
      const level = riskLevelFromScore(script.finalScore);

      const txn: Transaction = {
        id,
        amount: script.amount,
        customerId: `CUS_${idFromSeed(seed + "cus").slice(0, 5)}`,
        customerName: script.customerName,
        merchant: script.merchant,
        location: script.location,
        device: script.device,
        isNewDevice: script.isNewDevice,
        paymentMethod: script.method,
        riskScore: 0,
        riskLevel: "LOW",
        status: "EVALUATING",
        timestamp: now,
        currency: "INR",
        signals: makeSignals(script.signals, seed),
        aiSummary: null,
        recommendation: null,
        confidence: null,
      };

      const state = useAppStore.getState();
      // avoid duplicate ids if the demo runs unusually long
      if (state.transactions.some((t) => t.id === id)) return;

      state.setTransactions([txn, ...state.transactions].slice(0, 80));

      setTimeout(() => {
        const s = useAppStore.getState();
        const stillThere = s.transactions.find((t) => t.id === id);
        if (!stillThere || stillThere.status !== "EVALUATING") return;

        const enginePatch = {
          riskScore: script.finalScore,
          riskLevel: level,
          recommendation: level === "CRITICAL" ? "BLOCK" : level === "HIGH" ? "REVIEW" : null,
          confidence: level === "CRITICAL" ? 93 : level === "HIGH" ? 86 : null,
        } as const;

        /* A reload regenerates the same scripted ids (deterministic demo).
         * If the analyst already resolved this id in a previous session,
         * restore the decided status instead of resurrecting the case. */
        const decided = s.decisions[id];
        if (decided) {
          const settled = { ...txn, riskScore: script.finalScore, riskLevel: level };
          s.updateTransaction(id, {
            ...enginePatch,
            status:
              decided.action === "BLOCK"
                ? "BLOCKED"
                : decided.action === "ALLOW"
                  ? "ALLOWED"
                  : decided.action === "HOLD"
                    ? "ON_HOLD"
                    : "UNDER_REVIEW",
            investigation: {
              ...buildInvestigation(settled, now),
              mode: "heuristic",
              modelLabel: "rse-1.2 heuristics",
              analystAction: decided.action,
              analystNote: decided.note,
              resolvedAt: decided.at,
            },
          });
          return; // no chime, no toast — a resolved case never re-alerts
        }

        s.updateTransaction(id, {
          ...enginePatch,
          status: level === "CRITICAL" || level === "HIGH" ? "INVESTIGATING" : "MONITORING",
        });
        if (level === "CRITICAL") {
          if (useAppStore.getState().soundEnabled) playCriticalChime();
          toast({
            title: `Critical transaction ${id}`,
            description: `₹${script.amount.toLocaleString("en-IN")} · ${script.location} — AI investigation available.`,
            variant: "destructive",
          });
        }
      }, EVALUATION_MS);
    };

    const timer = setInterval(spawn, ARRIVAL_INTERVAL_MS);
    // first demo arrival comes quickly after boot for a lively first impression
    const warmup = setTimeout(spawn, 2500);
    return () => {
      clearInterval(timer);
      clearTimeout(warmup);
    };
  }, [demoMode, connection, streamPaused, updateTransaction, toast]);
}
