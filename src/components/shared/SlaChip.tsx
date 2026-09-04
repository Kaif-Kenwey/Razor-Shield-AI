"use client";

import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";

/** Cases open longer than this are considered aging past the review SLA. */
export const SLA_MINUTES = 15;
/** Past this, the case is treated as an SLA breach — escalated styling. */
export const SLA_BREACH_MINUTES = 30;

export type SlaState = "ok" | "aging" | "breached";

export function caseAgeMinutes(timestamp: string): number {
  return (Date.now() - new Date(timestamp).getTime()) / 60000;
}

export function slaState(timestamp: string): SlaState {
  const ageMin = caseAgeMinutes(timestamp);
  if (ageMin >= SLA_BREACH_MINUTES) return "breached";
  if (ageMin >= SLA_MINUTES) return "aging";
  return "ok";
}

/**
 * SLA chip on open cases — amber AGING past the review SLA (15m),
 * red BREACHED past double that (30m). Deterministic against case age.
 */
export function SlaChip({ timestamp, className }: { timestamp: string; className?: string }) {
  const ageMin = caseAgeMinutes(timestamp);
  const state = slaState(timestamp);
  if (state === "ok") return null;
  const breached = state === "breached";
  return (
    <span
      data-sla={state}
      data-testid={breached ? "sla-breached" : undefined}
      title={
        breached
          ? `Open ${Math.floor(ageMin)}m — SLA breached (review SLA ${SLA_MINUTES}m, escalation threshold ${SLA_BREACH_MINUTES}m)`
          : `Open ${Math.floor(ageMin)}m — past the ${SLA_MINUTES}m review SLA`
      }
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-sm border px-1.5 py-0.5 micro-11",
        breached
          ? "border-risk-critical/40 bg-risk-critical/10 text-risk-critical shadow-[0_0_12px_-4px_rgba(248,113,113,0.55)]"
          : "border-risk-medium/30 bg-risk-medium/8 text-risk-medium",
        className
      )}
    >
      {breached ? (
        <span className="relative flex h-1.5 w-1.5" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-risk-critical opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-risk-critical" />
        </span>
      ) : (
        <Clock className="h-2.5 w-2.5" aria-hidden />
      )}
      {breached ? `SLA BREACHED ${Math.floor(ageMin)}m` : `AGING ${Math.floor(ageMin)}m`}
    </span>
  );
}
