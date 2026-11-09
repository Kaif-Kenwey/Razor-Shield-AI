"use client";

/**
 * DECISION SENSITIVITY — counterfactual analysis for the current case.
 *
 * "What would have changed this decision?" The composite score is
 * additive over signal impacts, so each row replays the score with one
 * signal removed and re-derives the bounded action from the SAME
 * thresholds the engine uses (75/50/28 score bands → BLOCK/HOLD/REVIEW/
 * ALLOW). Signals whose removal changes the outcome are highlighted —
 * the analyst sees which evidence is actually load-bearing.
 */

import { motion } from "framer-motion";
import { ArrowRight, TrendingDown } from "lucide-react";
import type { RiskAction, RiskLevel, RiskSignal } from "@/types";
import { cn } from "@/lib/utils";

export function levelForScore(score: number): RiskLevel {
  if (score >= 75) return "CRITICAL";
  if (score >= 50) return "HIGH";
  if (score >= 28) return "MEDIUM";
  return "LOW";
}

export function actionForLevel(level: RiskLevel, score: number): RiskAction {
  if (level === "CRITICAL") return "BLOCK";
  if (level === "HIGH") return score >= 60 ? "HOLD" : "REVIEW";
  if (level === "MEDIUM") return "REVIEW";
  return "ALLOW";
}

const ACTION_TONE: Record<RiskAction, string> = {
  ALLOW: "text-risk-low",
  REVIEW: "text-intel",
  HOLD: "text-orange-300",
  BLOCK: "text-risk-critical",
};

export function DecisionSensitivity({ score, signals }: { score: number; signals: RiskSignal[] }) {
  const currentAction = actionForLevel(levelForScore(score), score);
  const rows = signals
    .filter((s) => s.impact > 0)
    .map((s) => {
      const cf = Math.max(0, score - s.impact);
      return { title: s.title, impact: s.impact, cf, action: actionForLevel(levelForScore(cf), cf) };
    })
    .sort((a, b) => a.cf - b.cf); // biggest lever first

  const flippers = rows.filter((r) => r.action !== currentAction);

  return (
    <div className="mt-3.5 border-t border-line/70 pt-3">
      <p className="micro mb-2 flex items-center gap-1.5 text-slate-400">
        <TrendingDown className="h-3 w-3" aria-hidden />
        Decision sensitivity — what would change the recommendation?
      </p>
      <div className="space-y-1.5">
        {rows.map((r, i) => {
          const flips = r.action !== currentAction;
          return (
            <motion.div
              key={r.title}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.06 * i }}
              className={cn(
                "flex items-center gap-2 rounded-sm border px-2 py-1.5 text-[11.5px]",
                flips ? "border-amber-400/30 bg-amber-400/6" : "border-transparent",
              )}
            >
              <span className="min-w-0 flex-1 truncate text-slate-400">Remove {r.title.toLowerCase()}</span>
              <span className="num text-slate-500">
                {score} → {r.cf}
              </span>
              <ArrowRight className="h-3 w-3 shrink-0 text-slate-600" aria-hidden />
              <span className={cn("num w-14 text-right font-semibold", ACTION_TONE[r.action])}>{r.action}</span>
              {flips && <span className="micro-11 shrink-0 text-amber-300">FLIPS</span>}
            </motion.div>
          );
        })}
      </div>
      <p className="micro-11 mt-2.5 leading-relaxed text-slate-600">
        Each row re-scores the case with one signal removed and re-applies the engine thresholds
        (75/50/28 → BLOCK/HOLD/REVIEW/ALLOW). Current composite {score} maps to{" "}
        <span className={cn("num font-semibold", ACTION_TONE[currentAction])}>{currentAction}</span>.
        {flippers.length > 0
          ? ` ${flippers.length === 1 ? "One signal is load-bearing:" : `${flippers.length} signals are load-bearing:`} without ${flippers
              .slice(0, 2)
              .map((f) => f.title.toLowerCase())
              .join(" or ")} the recommendation would change.`
          : " No single signal carries the decision alone — the case rests on the combined pattern."}
      </p>
    </div>
  );
}
