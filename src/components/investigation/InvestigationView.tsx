"use client";

/**
 * INVESTIGATION WORKSPACE — the signature screen of RazorShield.
 * Opening a transaction dims the world, runs the AI agent in staged view,
 * then hands the analyst a bounded decision.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { CaseHeader } from "@/components/investigation/CaseHeader";
import { RiskScorePanel } from "@/components/investigation/RiskScorePanel";
import { RiskSignals } from "@/components/investigation/RiskSignals";
import { CustomerIntel } from "@/components/investigation/CustomerIntel";
import { InvestigationTimeline } from "@/components/investigation/InvestigationTimeline";
import { AiInvestigator } from "@/components/investigation/AiInvestigator";
import { AnalystNotes } from "@/components/investigation/AnalystNotes";
import { SimilarCases } from "@/components/investigation/SimilarCases";
import { ActionPanel } from "@/components/investigation/ActionPanel";
import { AuditTrail } from "@/components/investigation/AuditTrail";
import { PrintCaseFile } from "@/components/investigation/PrintCaseFile";
import { StatusDot } from "@/components/shared/StatusDot";
import { EmptyState } from "@/components/shared/States";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store/appStore";
import { ANALYSTS, customerFor, buildInvestigation } from "@/data/mockData";
import { cn } from "@/lib/utils";
import type { Investigation, Transaction } from "@/types";

/* ------------------------------------------------------------------ */
/* AI conclusion derivation (analyst-facing only)                      */
/* ------------------------------------------------------------------ */

const SIGNAL_CLAUSE: Record<string, string> = {
  NEW_DEVICE: "the device has not previously been associated with the account",
  UNUSUAL_AMOUNT: "the amount is well above the customer's typical range",
  LOCATION_ANOMALY: "the origin location is inconsistent with recent activity",
  VELOCITY_SPIKE: "a short burst of transactions was detected",
  IMPOSSIBLE_TRAVEL: "successive activity implies physically impossible travel",
  HIGH_VALUE: "the amount crosses the elevated-value policy threshold",
  MERCHANT_RISK: "the merchant category shows elevated chargeback rates",
  TIME_ANOMALY: "the payment occurs outside the customer's usual activity window",
};

function deriveConclusion(txn: Transaction): {
  aiSummary: string;
  recommendation: Transaction["recommendation"];
  confidence: number;
} {
  const clauses = txn.signals
    .map((s) => SIGNAL_CLAUSE[s.type])
    .filter(Boolean);

  const level = txn.riskLevel;
  const tail =
    level === "CRITICAL"
      ? " Multiple independent signals converge, so an immediate bounded action is recommended."
      : level === "HIGH"
        ? " Correlated signals suggest elevated exposure; analyst review is recommended before settlement."
        : level === "MEDIUM"
          ? " The deviation is moderate; a review is suggested but the pattern is not conclusive."
          : " The transaction is consistent with the customer's established behavior and requires no action.";

  return {
    aiSummary: `This transaction deviates from the customer's historical behavior${clauses.length ? ": " + clauses.join("; ") : "."}${tail}`,
    recommendation:
      txn.recommendation ??
      (level === "CRITICAL" ? "BLOCK" : level === "HIGH" ? "REVIEW" : level === "MEDIUM" ? "REVIEW" : "ALLOW"),
    confidence: Math.round(Math.min(96, 58 + txn.riskScore * 0.4)),
  };
}

/* ------------------------------------------------------------------ */
/* View                                                                */
/* ------------------------------------------------------------------ */

const STEP_MS = 620;
const TIMELINE_MS = 430;

export function InvestigationView() {
  const focusTxnId = useAppStore((s) => s.focusTxnId);
  const transactions = useAppStore((s) => s.transactions);
  const phases = useAppStore((s) => s.phases);
  const assignments = useAppStore((s) => s.assignments);
  const escalations = useAppStore((s) => s.escalations);
  const setPhase = useAppStore((s) => s.setPhase);
  const updateTransaction = useAppStore((s) => s.updateTransaction);

  const txn = transactions.find((t) => t.id === focusTxnId) ?? null;
  const phase = (txn && phases[txn.id]) || "idle";
  const caseNotes = useAppStore((s) => (txn ? s.caseNotes[txn.id] : undefined));
  const decisions = useAppStore((s) => s.decisions);
  const digestPrintOpen = useAppStore((s) => s.digestPrintOpen);

  const [step, setStep] = useState(0);
  const [timelineCount, setTimelineCount] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const customer = useMemo(() => (txn ? customerFor(txn) : null), [txn]);

  const totalSteps = 6;

  /* run the investigation theater once per session per case */
  useEffect(() => {
    if (!txn) return;
    timers.current.forEach(clearTimeout);
    timers.current = [];

    if (phase === "idle") {
      setPhase(txn.id, "analyzing");
      setStep(0);
      setTimelineCount(0);
      return;
    }

    if (phase !== "analyzing") {
      setStep(totalSteps);
      setTimelineCount(99);
      return;
    }

    for (let i = 1; i <= totalSteps; i++) {
      timers.current.push(setTimeout(() => setStep(i), i * STEP_MS));
    }
    for (let i = 1; i <= 7; i++) {
      timers.current.push(setTimeout(() => setTimelineCount(i), i * TIMELINE_MS));
    }
    timers.current.push(
      setTimeout(() => {
        setPhase(txn.id, "complete");
        const s = useAppStore.getState();
        const current = s.transactions.find((t) => t.id === txn.id);
        if (current && !current.investigation) {
          const d = deriveConclusion(current);
          s.updateTransaction(txn.id, {
            aiSummary: d.aiSummary,
            recommendation: d.recommendation,
            confidence: d.confidence,
            investigation: buildInvestigation(current, current.timestamp) as Investigation,
          });
        }
      }, totalSteps * STEP_MS + 500)
    );

    return () => {
      timers.current.forEach(clearTimeout);
    };
  }, [txn?.id, phase]);

  if (!txn || !customer) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16">
        <EmptyState
          title="Investigation unavailable"
          body="This transaction is no longer in the live window. Open the full ledger to locate it, or pick another case from the queue."
        />
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => useAppStore.getState().navigate("overview")} className="border-line bg-surface-1">
            Back to command center
          </Button>
        </div>
      </div>
    );
  }

  const analyzing = phase === "analyzing";
  const investigation = txn.investigation ?? null;
  const assignment = assignments[txn.id] ?? null;
  const assignedAnalyst = assignment ? ANALYSTS.find((a) => a.id === assignment.analystId) : undefined;
  const escalationRecord = escalations[txn.id] ?? null;
  const escalationToAnalyst = escalationRecord ? ANALYSTS.find((a) => a.id === escalationRecord.toAnalystId) : undefined;
  const escalationByAnalyst = escalationRecord ? ANALYSTS.find((a) => a.id === escalationRecord.byAnalystId) : undefined;
  const decision = decisions[txn.id] ?? null;
  const resolvedBy = decision?.analystId ? ANALYSTS.find((a) => a.id === decision.analystId)?.name : undefined;
  const shownInvestigation =
    investigation ??
    (phase === "complete"
      ? buildInvestigation(txn, txn.timestamp)
      : null);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-5 lg:px-6">
      <CaseHeader txn={txn} investigation={shownInvestigation ?? undefined} />

      <div className="mx-auto mt-4 grid w-full grid-cols-[minmax(0,1fr)] items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* Main column */}
        <div className="space-y-4 min-w-0">
          <RiskScorePanel
            score={txn.riskScore}
            level={txn.riskLevel}
            recommendation={phase === "complete" ? txn.recommendation ?? deriveConclusion(txn).recommendation : null}
            confidence={phase === "complete" ? txn.confidence ?? deriveConclusion(txn).confidence : null}
            analyzing={analyzing}
            signals={txn.signals}
          />
          <RiskSignals signals={txn.signals} analyzing={analyzing} />
          <AiInvestigator
            txn={txn}
            investigation={shownInvestigation}
            analyzing={analyzing}
            currentStep={step}
          />

          {/* The analyst voice — append-only notebook */}
          <AnalystNotes txnId={txn.id} />

          {/* The immutable record lives beside the narrative it audits */}
          <section className="panel overflow-hidden" aria-label="Audit trail">
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
              <p className="micro-11 font-semibold text-slate-200">Audit trail</p>
              <span className="micro-11 text-slate-600">APPEND-ONLY</span>
            </div>
            <div className="px-4 py-4">
              <AuditTrail
                entries={shownInvestigation?.auditTrail ?? []}
                analystAction={shownInvestigation?.analystAction}
                analystNote={shownInvestigation?.analystNote}
                resolvedAt={shownInvestigation?.resolvedAt}
                assignment={
                  assignment && assignedAnalyst
                    ? { analystId: assignedAnalyst.id, analystName: assignedAnalyst.name, at: assignment.at }
                    : null
                }
                handoffAccepted={
                  assignment && assignedAnalyst && assignment.acceptedAt
                    ? { analystName: assignedAnalyst.name, at: assignment.acceptedAt, keepPersona: assignment.keepPersona }
                    : null
                }
                escalation={
                  escalationRecord && escalationToAnalyst
                    ? {
                        at: escalationRecord.at,
                        byAnalystName: escalationByAnalyst?.name ?? escalationRecord.byAnalystId,
                        toAnalystName: escalationToAnalyst.name,
                      }
                    : null
                }
                notes={caseNotes}
                resolvedByAnalystName={resolvedBy}
              />
            </div>
          </section>
        </div>

        {/* Right rail */}
        <div className="space-y-4">
          <CustomerIntel customer={customer} analyzing={analyzing} txn={txn} />

          <section className="panel overflow-hidden" aria-label="Transaction timeline">
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
              <p className="micro-11 font-semibold text-slate-200">Transaction timeline</p>
              <span
                className="flex shrink-0 items-center gap-1.5 rounded-sm border border-line bg-surface-1 px-1.5 py-1"
                aria-live="polite"
              >
                <StatusDot tone={analyzing ? "violet" : "green"} pulse={analyzing} label={analyzing ? "AI analyzing" : "AI online"} />
                <span className={cn("micro-11", analyzing ? "text-intel" : "text-slate-500")}>
                  {analyzing ? "AI ANALYZING" : "AI COMPLETE"}
                </span>
              </span>
            </div>
            <div className="px-4 py-4">
              <InvestigationTimeline
                events={shownInvestigation?.timeline ?? []}
                visibleCount={analyzing ? timelineCount : 99}
              />
            </div>
          </section>

          {txn.signals.length > 0 && <SimilarCases txn={txn} />}

          <ActionPanel txn={txn} investigation={shownInvestigation} analyzing={analyzing} />
        </div>
      </div>

      {/* Print-only paper case file (made visible by the print stylesheet)
          — suppressed while the digest brief owns the printer */}
      {!digestPrintOpen && (
        <PrintCaseFile
          txn={txn}
          customer={customer}
          investigation={shownInvestigation}
          assignedTo={assignedAnalyst?.name}
          notes={caseNotes}
          resolvedBy={resolvedBy}
        />
      )}

      {/* Skip control for demo pacing */}
      {analyzing && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="pointer-events-none fixed inset-x-0 bottom-6 z-20 flex justify-center"
        >
          <Button
            variant="outline"
            size="sm"
            className="pointer-events-auto border-line bg-surface-2/90 text-[11px] text-slate-400 backdrop-blur hover:bg-surface-3 hover:text-slate-200"
            onClick={() => {
              timers.current.forEach(clearTimeout);
              setStep(totalSteps);
              setTimelineCount(99);
              setPhase(txn.id, "complete");
              const s = useAppStore.getState();
              const current = s.transactions.find((t) => t.id === txn.id);
              if (current && !current.investigation) {
                const d = deriveConclusion(current);
                s.updateTransaction(txn.id, {
                  aiSummary: d.aiSummary,
                  recommendation: d.recommendation,
                  confidence: d.confidence,
                  investigation: buildInvestigation(current, current.timestamp) as Investigation,
                });
              }
            }}
          >
            Skip animation
          </Button>
        </motion.div>
      )}
    </div>
  );
}
