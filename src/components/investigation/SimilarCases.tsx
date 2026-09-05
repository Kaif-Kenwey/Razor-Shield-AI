"use client";

/**
 * SimilarCases — precedent evidence panel for the investigation workspace.
 *
 * Matches are computed for real: a six-component feature vector (amount
 * deviation from the customer median, cyclical hour-of-day, burst-window
 * velocity, device age flag, city, payment rail) is compared against every
 * OTHER-customer transaction loaded in the workspace — the demo ledger,
 * live arrivals and dataset-routed rows alike. See lib/similarCases.ts for
 * the exact math. Outcomes are shown only for analyst-adjudicated cases,
 * which turns matched precedents into genuine evidence ("last time this
 * pattern appeared, it ended in confirmed fraud").
 */

import { useMemo } from "react";
import { motion } from "framer-motion";
import { History, Scale } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { similarTransactionsFor } from "@/lib/similarCases";
import { formatINR, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { RiskLevel, Transaction } from "@/types";
import type { PrecedentOutcome } from "@/lib/similarCases";

const LEVEL_CHIP: Record<RiskLevel, string> = {
  LOW: "border-slate-500/30 bg-slate-500/10 text-slate-300",
  MEDIUM: "border-risk-medium/30 bg-risk-medium/8 text-risk-medium",
  HIGH: "border-risk-high/35 bg-risk-high/10 text-risk-high",
  CRITICAL: "border-risk-critical/40 bg-risk-critical/10 text-risk-critical",
};

const OUTCOME_CHIP: Record<PrecedentOutcome, string> = {
  FRAUD_CONFIRMED: "border-risk-critical/40 bg-risk-critical/10 text-risk-critical",
  LEGITIMATE: "border-risk-low/40 bg-risk-low/10 text-risk-low",
};

const OUTCOME_LABEL: Record<PrecedentOutcome, string> = {
  FRAUD_CONFIRMED: "Outcome: CONFIRMED FRAUD",
  LEGITIMATE: "Outcome: LEGITIMATE",
};

const OUTCOME_HINT: Record<PrecedentOutcome, string> = {
  FRAUD_CONFIRMED: "Analyst adjudicated this case with a BLOCK decision.",
  LEGITIMATE: "Analyst adjudicated this case with an ALLOW decision.",
};

export function SimilarCases({ txn }: { txn: Transaction }) {
  const universe = useAppStore((s) => s.transactions);
  const decisions = useAppStore((s) => s.decisions);
  const openInvestigation = useAppStore((s) => s.openInvestigation);

  const { hits, comparable, total } = useMemo(
    () => similarTransactionsFor(txn, universe, { decisions }),
    [txn, universe, decisions],
  );

  if (hits.length === 0) return null;

  return (
    <section className="panel overflow-hidden" aria-label="Similar cases">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <p className="micro-11 flex items-center gap-2 font-semibold text-slate-200">
          <History className="h-3.5 w-3.5 text-intel" aria-hidden />
          Similar cases
        </p>
        <span className="num flex items-center gap-1 rounded-full border border-intel/30 bg-intel/10 px-2 py-0.5 text-[10.5px] text-intel">
          <Scale className="h-3 w-3 opacity-70" aria-hidden />
          {hits.length} matched
        </span>
      </div>

      <ul className="divide-y divide-line/60">
        {hits.map((hit, i) => (
          <motion.li
            key={hit.txn.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.08, duration: 0.3 }}
            className="group px-4 py-3 transition-colors hover:bg-surface-2/70"
          >
            {/* id · score level · similarity */}
            <button
              type="button"
              onClick={() => openInvestigation(hit.txn.id)}
              title={`Open ${hit.txn.id} in the investigation workspace`}
              className="flex w-full items-center justify-between gap-2 rounded-sm text-left outline-none focus-visible:ring-1 focus-visible:ring-intel/60"
            >
              <span className="num truncate text-[12.5px] font-semibold text-slate-100 group-hover:text-white">
                {hit.txn.id}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span
                  className={cn(
                    "num rounded-sm border px-1.5 py-0.5 text-[10.5px] font-bold",
                    LEVEL_CHIP[hit.txn.riskLevel],
                  )}
                  title={`Scored ${hit.txn.riskScore}/100 · ${hit.txn.riskLevel}`}
                >
                  {hit.txn.riskScore}
                </span>
                <span
                  className="num flex items-center gap-1 text-[10.5px] font-medium text-intel"
                  title="Weighted feature-vector similarity (see footnote)"
                >
                  <Scale className="h-3 w-3 opacity-70" aria-hidden />
                  {hit.similarity}%
                </span>
              </span>
            </button>

            {/* why — top contributing shared features */}
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
              {hit.reasons.join(" · ")}
            </p>

            {/* amount · context · outcome */}
            <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="num text-[11.5px] text-slate-500">
                {formatINR(hit.txn.amount)} · {hit.txn.merchant} · {relativeTime(hit.txn.timestamp)}
              </span>
              {hit.outcome && (
                <span
                  className={cn(
                    "rounded-sm border px-1.5 py-0.5 text-[10px] font-bold",
                    OUTCOME_CHIP[hit.outcome],
                  )}
                  title={OUTCOME_HINT[hit.outcome]}
                >
                  {OUTCOME_LABEL[hit.outcome]}
                </span>
              )}
            </div>
          </motion.li>
        ))}
      </ul>

      <div className="space-y-1 border-t border-line px-4 py-2.5">
        {comparable < 15 && (
          <p className="text-[10.5px] leading-relaxed text-risk-medium/80">
            limited precedent universe: {comparable} comparable transaction{comparable === 1 ? "" : "s"}
          </p>
        )}
        <p className="text-[10.5px] leading-relaxed text-slate-600">
          Feature-vector match over {comparable} of {total} loaded transactions — amount vs customer
          median, hour-of-day, velocity, device, city, rail. Outcome chips only for
          analyst-adjudicated cases.
        </p>
      </div>
    </section>
  );
}
