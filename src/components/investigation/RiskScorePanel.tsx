"use client";

/**
 * RiskScorePanel — the score must visually dominate the investigation.
 * Dial + recommended action + model confidence.
 */

import { motion } from "framer-motion";
import { RiskScoreDial } from "@/components/risk/RiskScoreDial";
import { cn } from "@/lib/utils";
import type { RiskAction, RiskLevel, RiskSignal, SignalSeverity } from "@/types";

const ACTION_TONE: Record<RiskAction, string> = {
  ALLOW: "text-risk-low border-risk-low/40 bg-risk-low/10",
  REVIEW: "text-risk-medium border-risk-medium/40 bg-risk-medium/10",
  HOLD: "text-orange-300 border-orange-400/40 bg-orange-400/10",
  BLOCK: "text-risk-critical border-risk-critical/50 bg-risk-critical/12 glow-critical",
};

const SEVERITY_SEGMENT: Record<SignalSeverity, string> = {
  LOW: "bg-slate-400/80",
  MEDIUM: "bg-risk-medium",
  HIGH: "bg-risk-high",
  CRITICAL: "bg-risk-critical",
};

const SEVERITY_DOT: Record<SignalSeverity, string> = {
  LOW: "bg-slate-400",
  MEDIUM: "bg-risk-medium",
  HIGH: "bg-risk-high",
  CRITICAL: "bg-risk-critical",
};

/**
 * ScoreComposition — decomposes the composite score into its signal
 * contributions (engine data, not AI output) so the analyst can see how
 * the number was built. Sums of impacts approximate the score.
 */
function ScoreComposition({ signals, score }: { signals: RiskSignal[]; score: number }) {
  if (signals.length === 0) return null;

  const total = Math.max(score, signals.reduce((a, s) => a + s.impact, 0), 1);
  const remainder = Math.max(0, 100 - signals.reduce((a, s) => a + s.impact, 0));

  return (
    <div aria-label="Score composition">
      <div className="flex items-baseline justify-between gap-3">
        <p className="micro text-slate-500">Score composition</p>
        <p className="num text-[10.5px] text-slate-600">{signals.length} weighted signals · 0–100</p>
      </div>

      {/* stacked decomposition bar */}
      <div
        className="mt-2 flex h-2.5 w-full gap-px overflow-hidden rounded-full bg-surface-3"
        role="img"
        aria-label={signals.map((s) => `${s.title} +${s.impact}`).join(", ")}
      >
        {signals.map((s, i) => (
          <motion.div
            key={s.id}
            className={cn("h-full", SEVERITY_SEGMENT[s.severity])}
            initial={{ width: 0 }}
            animate={{ width: `${(s.impact / total) * 100}%` }}
            transition={{ duration: 0.7, delay: 0.2 + i * 0.1, ease: [0.22, 1, 0.36, 1] }}
          />
        ))}
        {remainder > 0 && (
          <motion.div
            className="h-full bg-slate-500/15"
            initial={{ width: 0 }}
            animate={{ width: `${(remainder / total) * 100}%` }}
            transition={{ duration: 0.7, delay: 0.2 + signals.length * 0.1, ease: [0.22, 1, 0.36, 1] }}
          />
        )}
      </div>

      {/* legend */}
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
        {signals.map((s) => (
          <span key={s.id} className="flex items-center gap-1.5 text-[10.5px] text-slate-500">
            <span className={cn("h-1.5 w-1.5 rounded-full", SEVERITY_DOT[s.severity])} aria-hidden />
            <span className="uppercase tracking-[0.06em]">{s.title}</span>
            <span className="num font-semibold text-slate-400">+{s.impact}</span>
          </span>
        ))}
        {remainder > 0 && (
          <span className="flex items-center gap-1.5 text-[10.5px] text-slate-600">
            <span className="h-1.5 w-1.5 rounded-full bg-slate-500/40" aria-hidden />
            <span className="uppercase tracking-[0.06em]">Baseline behavior</span>
            <span className="num font-semibold">+{remainder}</span>
          </span>
        )}
      </div>
    </div>
  );
}

export function RiskScorePanel({
  score,
  level,
  recommendation,
  confidence,
  analyzing,
  signals = [],
}: {
  score: number;
  level: RiskLevel;
  recommendation: RiskAction | null;
  confidence: number | null;
  analyzing: boolean;
  signals?: RiskSignal[];
}) {
  return (
    <section className="panel-raised relative overflow-hidden px-6 py-6" aria-label="Risk assessment">
      {level === "CRITICAL" && (
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-risk-critical/60 to-transparent" aria-hidden />
      )}
      <div className="flex flex-col items-center gap-7 sm:flex-row sm:items-center sm:gap-10">
        <RiskScoreDial score={score} level={level} className="shrink-0" />

        <div className="min-w-0 flex-1 space-y-5">
          <div>
            <p className="micro text-slate-500">Recommended action</p>
            {analyzing ? (
              <div className="mt-2 h-9 w-40 animate-pulse rounded-sm bg-surface-3" aria-label="Evaluating recommendation" />
            ) : (
              <motion.p
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15, duration: 0.35 }}
                className={cn(
                  "mt-2 inline-flex items-center rounded-sm border px-3.5 py-2 text-[15px] font-bold tracking-[0.08em]",
                  recommendation ? ACTION_TONE[recommendation] : "border-line bg-surface-2 text-slate-300"
                )}
              >
                {recommendation ? `${recommendation} TRANSACTION` : "MONITOR ONLY"}
              </motion.p>
            )}
          </div>

          <div>
            <p className="micro text-slate-500">Model confidence</p>
            {analyzing ? (
              <div className="mt-2 h-7 w-28 animate-pulse rounded-sm bg-surface-3" aria-label="Evaluating confidence" />
            ) : (
              <div className="mt-2 flex items-center gap-3">
                <span className="num text-2xl font-semibold text-slate-100">{confidence ?? "—"}%</span>
                <div className="h-1.5 w-32 overflow-hidden rounded-full bg-slate-500/12">
                  <motion.div
                    className={cn("h-full rounded-full", level === "CRITICAL" || level === "HIGH" ? "bg-risk-critical/70" : "bg-risk-medium/70")}
                    initial={{ width: 0 }}
                    animate={{ width: `${confidence ?? 0}%` }}
                    transition={{ duration: 0.8, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  />
                </div>
              </div>
            )}
          </div>

          <ScoreComposition signals={signals} score={score} />

          <p className="max-w-md text-[12px] leading-relaxed text-slate-500">
            Score is a composite of independent risk signals. The recommendation is
            advisory — the final bounded action always belongs to the analyst and is
            recorded in the audit trail.
          </p>
        </div>
      </div>
    </section>
  );
}
