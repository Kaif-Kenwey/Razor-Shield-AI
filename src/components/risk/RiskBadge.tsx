"use client";

import { cn } from "@/lib/utils";
import type { RiskLevel, TransactionStatus } from "@/types";
import { statusLabel } from "@/lib/format";
import { StatusDot } from "@/components/shared/StatusDot";

const LEVEL_STYLES: Record<RiskLevel, { dot: "green" | "amber" | "red"; text: string; chip: string }> = {
  LOW: {
    dot: "green",
    text: "text-risk-low",
    chip: "bg-risk-low/8 border-risk-low/25 text-risk-low",
  },
  MEDIUM: {
    dot: "amber",
    text: "text-risk-medium",
    chip: "bg-risk-medium/8 border-risk-medium/25 text-risk-medium",
  },
  HIGH: {
    dot: "red",
    text: "text-risk-high",
    chip: "bg-risk-high/8 border-risk-high/25 text-risk-high",
  },
  CRITICAL: {
    dot: "red",
    text: "text-risk-critical",
    chip: "bg-risk-critical/10 border-risk-critical/30 text-risk-critical",
  },
};

/** Risk level chip — LOW / MEDIUM / HIGH / CRITICAL. */
export function RiskLevelBadge({ level, className }: { level: RiskLevel; className?: string }) {
  const s = LEVEL_STYLES[level];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 micro-11 num",
        s.chip,
        level === "CRITICAL" && "font-semibold",
        className
      )}
    >
      <StatusDot tone={s.dot} pulse={level === "CRITICAL"} />
      {level}
    </span>
  );
}

const STATUS_TONES: Record<TransactionStatus, string> = {
  EVALUATING: "text-slate-300 border-slate-500/30 bg-slate-500/8",
  MONITORING: "text-slate-400 border-slate-600/40 bg-slate-600/8",
  INVESTIGATING: "text-intel border-intel/30 bg-intel/10",
  UNDER_REVIEW: "text-risk-medium border-risk-medium/25 bg-risk-medium/8",
  ON_HOLD: "text-orange-300 border-orange-400/25 bg-orange-400/8",
  BLOCKED: "text-risk-critical border-risk-critical/30 bg-risk-critical/10",
  ALLOWED: "text-risk-low border-risk-low/25 bg-risk-low/8",
};

/** Workflow status chip — MONITORING / INVESTIGATING / BLOCKED … */
export function StatusBadge({ status, className }: { status: TransactionStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border px-1.5 py-0.5 micro-11 whitespace-nowrap",
        STATUS_TONES[status],
        className
      )}
    >
      {statusLabel(status)}
    </span>
  );
}
