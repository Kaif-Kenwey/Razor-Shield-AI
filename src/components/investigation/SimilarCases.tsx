"use client";

/**
 * SimilarCases — precedent library panel for the investigation workspace.
 * Shows closed cases from the archive that share risk signals with the
 * case at hand, so the analyst decides with historical context
 * ("what happened last time this pattern appeared?").
 */

import { motion } from "framer-motion";
import { History, Scale } from "lucide-react";
import { similarCasesFor } from "@/data/mockData";
import { formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { RiskLevel, SignalType, Transaction } from "@/types";

const SIGNAL_SHORT: Record<SignalType, string> = {
  NEW_DEVICE: "New device",
  UNUSUAL_AMOUNT: "Amount",
  LOCATION_ANOMALY: "Location",
  VELOCITY_SPIKE: "Velocity",
  IMPOSSIBLE_TRAVEL: "Travel",
  HIGH_VALUE: "High value",
  MERCHANT_RISK: "Merchant",
  TIME_ANOMALY: "Time",
};

const LEVEL_CHIP: Record<RiskLevel, string> = {
  LOW: "border-slate-500/30 bg-slate-500/10 text-slate-300",
  MEDIUM: "border-risk-medium/30 bg-risk-medium/8 text-risk-medium",
  HIGH: "border-risk-high/35 bg-risk-high/10 text-risk-high",
  CRITICAL: "border-risk-critical/40 bg-risk-critical/10 text-risk-critical",
};

const OUTCOME_TONE: Record<string, string> = {
  FRAUD_CONFIRMED: "text-risk-critical",
  CHARGEBACK_FILED: "text-risk-high",
  CUSTOMER_VERIFIED: "text-risk-low",
  LEGITIMATE: "text-risk-low",
};

export function SimilarCases({ txn }: { txn: Transaction }) {
  const cases = similarCasesFor(txn);

  if (cases.length === 0) return null;

  return (
    <section className="panel overflow-hidden" aria-label="Similar past cases">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <p className="micro-11 flex items-center gap-2 font-semibold text-slate-200">
          <History className="h-3.5 w-3.5 text-intel" aria-hidden />
          Similar past cases
        </p>
        <span className="num rounded-full border border-intel/30 bg-intel/10 px-2 py-0.5 text-[10.5px] text-intel">
          {cases.length} matched
        </span>
      </div>

      <ul className="divide-y divide-line/60">
        {cases.map((c, i) => (
          <motion.li
            key={c.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.08, duration: 0.3 }}
            className="group px-4 py-3 transition-colors hover:bg-surface-2/70"
          >
            {/* id · closed · score · similarity */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="num truncate text-[12.5px] font-semibold text-slate-100">{c.id}</span>
                <span className="micro shrink-0 text-slate-600">{c.closedLabel}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={cn(
                    "num rounded-sm border px-1.5 py-0.5 text-[10.5px] font-bold",
                    LEVEL_CHIP[c.level]
                  )}
                  title={`Closed at ${c.score}/100 · ${c.level}`}
                >
                  {c.score}
                </span>
                <span
                  className="num flex items-center gap-1 text-[10.5px] font-medium text-intel"
                  title={`${c.sharedSignals.length} of ${txn.signals.length} signals matched`}
                >
                  <Scale className="h-3 w-3 opacity-70" aria-hidden />
                  {c.similarity}%
                </span>
              </div>
            </div>

            {/* pattern chips — shared signals highlighted */}
            <div className="mt-2 flex flex-wrap gap-1">
              {c.signals.map((s) => {
                const shared = c.sharedSignals.includes(s);
                return (
                  <span
                    key={s}
                    className={cn(
                      "rounded-sm border px-1.5 py-0.5 text-[10px]",
                      shared
                        ? "border-intel/40 bg-intel/10 text-intel"
                        : "border-line bg-surface-1 text-slate-600"
                    )}
                  >
                    {SIGNAL_SHORT[s]}
                  </span>
                );
              })}
            </div>

            {/* amount + outcome */}
            <div className="mt-2 flex items-baseline justify-between gap-3">
              <span className="num text-[11.5px] text-slate-500">{formatINR(c.amount)}</span>
              <span className={cn("truncate text-[11px] font-medium", OUTCOME_TONE[c.outcome])}>
                {c.action} · {c.outcomeLabel}
              </span>
            </div>
          </motion.li>
        ))}
      </ul>

      <div className="border-t border-line px-4 py-2.5">
        <p className="text-[10.5px] leading-relaxed text-slate-600">
          Closed cases from the demo archive — pattern reference only, shown to
          the analyst before the bounded action.
        </p>
      </div>
    </section>
  );
}
