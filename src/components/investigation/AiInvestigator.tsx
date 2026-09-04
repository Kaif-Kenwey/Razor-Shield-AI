"use client";

/**
 * AI INVESTIGATOR — the agent panel. Analyst-facing reasoning only:
 * concise summary, evidence used, bounded recommendation. No hidden
 * chain-of-thought — "view full reasoning" expands structured evidence,
 * never internal deliberation.
 */

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Copy, Sparkles } from "lucide-react";
import { AiActivityIndicator } from "@/components/ai/AiActivityIndicator";
import { StatusDot } from "@/components/shared/StatusDot";
import { useToast } from "@/hooks/use-toast";
import { formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Investigation, RiskAction, Transaction } from "@/types";

const REC_TONE: Record<RiskAction, string> = {
  ALLOW: "text-risk-low border-risk-low/40 bg-risk-low/10",
  REVIEW: "text-risk-medium border-risk-medium/40 bg-risk-medium/10",
  HOLD: "text-orange-300 border-orange-400/40 bg-orange-400/10",
  BLOCK: "text-risk-critical border-risk-critical/50 bg-risk-critical/12",
};

function buildCaseSummary(txn: Transaction, investigation: Investigation | null): string {
  const lines = [
    `RazorShield AI — Case Summary`,
    `Transaction: ${txn.id} · ${formatINR(txn.amount)} · ${txn.paymentMethod} · ${txn.merchant}`,
    `Customer: ${txn.customerId} (${txn.customerName}) · Origin: ${txn.location} · Device: ${txn.device}`,
    `Risk score: ${txn.riskScore}/100 (${txn.riskLevel})`,
    `Signals: ${txn.signals.map((s) => `${s.title} (+${s.impact})`).join(", ") || "none"}`,
    `Recommendation: ${txn.recommendation ?? "MONITOR"} · Confidence: ${txn.confidence ?? "—"}%`,
    `AI summary: ${txn.aiSummary ?? "Investigation not yet run."}`,
  ];
  if (investigation?.analystAction) {
    lines.push(`Analyst action: ${investigation.analystAction}${investigation.analystNote ? ` — note: ${investigation.analystNote}` : ""}`);
  }
  return lines.join("\n");
}

export function AiInvestigator({
  txn,
  investigation,
  analyzing,
  currentStep,
}: {
  txn: Transaction;
  investigation: Investigation | null;
  analyzing: boolean;
  currentStep: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const complete = !analyzing && Boolean(investigation);
  const recommendation = txn.recommendation ?? (txn.riskLevel === "LOW" || txn.riskLevel === "MEDIUM" ? "ALLOW" : null);

  const copySummary = async () => {
    const text = buildCaseSummary(txn, investigation);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast({ title: "Copy unavailable", description: "Clipboard is blocked in this context.", variant: "destructive" });
    }
  };

  return (
    <section className="panel glow-intel relative overflow-hidden" aria-label="AI investigator">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-intel/60 to-transparent" aria-hidden />

      {/* Panel header */}
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Sparkles className="h-4 w-4 text-intel" aria-hidden />
          <h2 className="micro-11 font-semibold text-slate-100">AI Investigator</h2>
        </div>
        <div className="flex items-center gap-2">
          {!analyzing && complete && (
            <button
              onClick={copySummary}
              aria-label="Copy case summary to clipboard"
              title="Copy case summary"
              className={cn(
                "flex h-6.5 items-center gap-1.5 rounded-sm border px-2 text-[10.5px] font-medium transition-all active:scale-95",
                copied
                  ? "border-risk-low/40 bg-risk-low/10 text-risk-low"
                  : "border-line bg-surface-1 text-slate-400 hover:border-line-strong hover:text-slate-200"
              )}
            >
              {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
              {copied ? "Copied" : "Copy summary"}
            </button>
          )}
          <span className="flex items-center gap-1.5 rounded-sm border border-intel/30 bg-intel/8 px-2 py-1 micro-11 text-intel">
            {analyzing ? (
              <>
                <StatusDot tone="violet" pulse />
                ANALYZING
              </>
            ) : (
              <>
                <StatusDot tone="green" />
                ANALYSIS COMPLETE
              </>
            )}
          </span>
        </div>
      </div>

      <div className="px-4 py-4">
        <p className="text-[13px] font-medium text-slate-200">Why is this transaction risky?</p>

        <AnimatePresence mode="wait">
          {analyzing ? (
            <motion.div
              key="analyzing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="mt-4"
            >
              <AiActivityIndicator steps={[
                { label: "◌ Analyzing transaction history..." },
                { label: "Customer history analyzed" },
                { label: "Device history analyzed" },
                { label: "Location anomaly checked" },
                { label: "Risk signals correlated" },
                { label: "Recommendation generated" },
              ].map(s => ({ label: s.label }))} currentStep={currentStep} done={false} />
            </motion.div>
          ) : complete ? (
            <motion.div
              key="complete"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              className="mt-4 space-y-4"
            >
              {/* Investigation summary */}
              <p className="border-l-2 border-intel/40 pl-3 text-[13px] leading-relaxed text-slate-300">
                {investigation?.reasoning ?? txn.aiSummary}
              </p>

              {/* Evidence used */}
              <div>
                <p className="micro mb-2 text-slate-500">Evidence used</p>
                <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {(investigation?.evidenceUsed ?? []).map((e, i) => (
                    <motion.li
                      key={e}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.1 + i * 0.07 }}
                      className="flex items-center gap-2 text-[12px] text-slate-400"
                    >
                      <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-risk-low/12 text-risk-low">
                        <Check className="h-2 w-2" strokeWidth={3.5} aria-hidden />
                      </span>
                      {e}
                    </motion.li>
                  ))}
                </ul>
              </div>

              {/* Recommendation */}
              <div className="rounded-sm border border-line bg-surface-2/60 p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="micro text-slate-500">Recommendation</p>
                    <span className={cn("mt-1.5 inline-flex rounded-sm border px-3 py-1.5 text-[14px] font-bold tracking-[0.1em]", recommendation ? REC_TONE[recommendation] : "border-line text-slate-300")}>
                      {recommendation ?? "MONITOR"}
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="micro text-slate-500">Confidence</p>
                    <p className="num mt-1 text-xl font-semibold text-slate-100">{txn.confidence ?? "—"}%</p>
                  </div>
                </div>
                <p className="mt-3 border-t border-line/70 pt-2.5 text-[12px] leading-relaxed text-slate-500">
                  <span className="text-slate-400">Reason:</span>{" "}
                  {recommendation === "ALLOW"
                    ? "Transaction is consistent with the customer's established behavior across all correlated signals."
                    : "Multiple independent risk signals converge on abnormal behavior."}
                </p>
              </div>

              {/* Full reasoning expander */}
              <button
                onClick={() => setExpanded((x) => !x)}
                aria-expanded={expanded}
                className="flex w-full items-center justify-between rounded-sm border border-line bg-surface-1 px-3 py-2.5 text-[12px] font-medium text-slate-300 transition-colors hover:border-line-strong hover:bg-surface-2"
              >
                View full reasoning
                <ChevronDown className={cn("h-3.5 w-3.5 text-slate-500 transition-transform", expanded && "rotate-180")} aria-hidden />
              </button>
              <AnimatePresence initial={false}>
                {expanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="rounded-sm border border-line bg-surface-2/40 p-3.5">
                      <p className="micro mb-3 text-slate-500">Signal weighting</p>
                      <div className="space-y-2.5">
                        {txn.signals.map((s) => (
                          <div key={s.id} className="flex items-center gap-3">
                            <span className="w-32 shrink-0 truncate text-[11.5px] text-slate-400">{s.title}</span>
                            <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-500/10">
                              <motion.div
                                className={cn("h-full rounded-full", s.severity === "CRITICAL" ? "bg-risk-critical/70" : s.severity === "HIGH" ? "bg-risk-high/60" : "bg-risk-medium/50")}
                                initial={{ width: 0 }}
                                animate={{ width: `${Math.min(100, (s.impact / Math.max(...txn.signals.map((x) => x.impact), 1)) * 100)}%` }}
                                transition={{ duration: 0.6 }}
                              />
                            </div>
                            <span className="num w-8 text-right text-[11px] text-slate-400">+{s.impact}</span>
                          </div>
                        ))}
                      </div>
                      <p className="mt-3.5 border-t border-line/70 pt-3 text-[11px] leading-relaxed text-slate-500">
                        The composite score weighs each independent signal against the customer's
                        90-day baseline. Correlated signals compound; a single signal alone would
                        not reach the action threshold. This panel shows structured evidence only —
                        the model's internal deliberation is never exposed.
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </section>
  );
}
