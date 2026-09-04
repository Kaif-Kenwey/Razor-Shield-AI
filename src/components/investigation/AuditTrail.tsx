"use client";

/**
 * AUDIT TRAIL — the immutable record. System, model, AI and analyst entries.
 */

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { ANALYSTS } from "@/data/mockData";
import type { AuditEntry, RiskAction } from "@/types";
import type { CaseNote } from "@/store/appStore";

const ACTOR_TONE: Record<AuditEntry["actor"], string> = {
  SYSTEM: "text-slate-400 border-slate-500/30 bg-slate-500/10",
  "RISK MODEL": "text-slate-300 border-slate-400/30 bg-slate-400/10",
  "AI ENGINE": "text-intel border-intel/30 bg-intel/10",
  ANALYST: "text-risk-medium border-risk-medium/35 bg-risk-medium/10",
};

export function AuditTrail({
  entries,
  analystAction,
  analystNote,
  resolvedAt,
  assignment,
  handoffAccepted,
  escalation,
  notes,
  resolvedByAnalystName,
  className,
}: {
  entries: AuditEntry[];
  analystAction?: RiskAction;
  analystNote?: string;
  resolvedAt?: string;
  /** Case handoff — shows the analyst assignment inside the immutable trail. */
  assignment?: { analystId: string; analystName: string; at: string } | null;
  /** Handoff claim — the assigned analyst accepted the case (audited persona switch or retained claim). */
  handoffAccepted?: { analystName: string; at: string; keepPersona?: boolean } | null;
  /** SLA-breach escalation — the case was pushed to the L3 fraud lead (audited). */
  escalation?: { at: string; byAnalystName: string; toAnalystName: string } | null;
  /** Notebook entries — recorded in the trail as ANALYST events. */
  notes?: CaseNote[];
  /** Who took the bounded action (persona attribution). */
  resolvedByAnalystName?: string;
  className?: string;
}) {
  const analystEntries: AuditEntry[] = [];
  if (assignment) {
    analystEntries.push({
      time: new Date(assignment.at).toLocaleTimeString("en-GB", { hour12: false }),
      actor: "ANALYST",
      action: `Case assigned to ${assignment.analystName}`,
      detail: "Handoff recorded — assignment is advisory only",
    });
  }
  if (handoffAccepted) {
    analystEntries.push({
      time: new Date(handoffAccepted.at).toLocaleTimeString("en-GB", { hour12: false }),
      actor: "ANALYST",
      action: handoffAccepted.keepPersona
        ? `Handoff claimed on behalf of ${handoffAccepted.analystName}`
        : `Handoff accepted by ${handoffAccepted.analystName}`,
      detail: handoffAccepted.keepPersona
        ? "Case claimed — persona retained (no switch)"
        : "Case claimed — acting analyst switched to the assignee",
    });
  }
  if (escalation) {
    analystEntries.push({
      time: new Date(escalation.at).toLocaleTimeString("en-GB", { hour12: false }),
      actor: "ANALYST",
      action: `SLA breach escalated by ${escalation.byAnalystName}`,
      detail: `Reassigned to ${escalation.toAnalystName} (L3 fraud lead) — breach acknowledged`,
    });
  }
  for (const n of notes ?? []) {
    const who = ANALYSTS.find((a) => a.id === n.analystId);
    analystEntries.push({
      time: new Date(n.at).toLocaleTimeString("en-GB", { hour12: false }),
      actor: "ANALYST",
      action: `Notebook entry added${who ? ` by ${who.name}` : ""}`,
      detail: n.text.length > 64 ? `${n.text.slice(0, 64)}…` : n.text,
    });
  }
  if (analystAction && resolvedAt) {
    analystEntries.push({
      time: new Date(resolvedAt).toLocaleTimeString("en-GB", { hour12: false }),
      actor: "ANALYST",
      action: `Risk action: ${analystAction}`,
      detail: resolvedByAnalystName
        ? `Recorded against ${resolvedByAnalystName} — case locked`
        : "Bounded action recorded — case locked",
    });
    if (analystNote) {
      analystEntries.push({
        time: new Date(resolvedAt).toLocaleTimeString("en-GB", { hour12: false }),
        actor: "ANALYST",
        action: "Analyst note attached",
        detail: analystNote,
      });
    }
  }
  const all: AuditEntry[] = [...entries, ...analystEntries].sort((a, b) => a.time.localeCompare(b.time));

  return (
    <ol className={cn("space-y-0", className)} aria-label="Audit trail">
      {all.map((e, i) => (
        <motion.li
          key={`${e.time}-${i}-${e.action}`}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05, duration: 0.3 }}
          className="relative flex gap-3 pb-3.5 last:pb-0"
        >
          {i < all.length - 1 && <span className="absolute left-[5px] top-4 h-[calc(100%-16px)] w-px bg-line" aria-hidden />}
          <span className="relative z-10 mt-1 h-[11px] w-[11px] shrink-0 rounded-full border-2 border-line-strong bg-surface-2" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[12.5px] text-slate-300">{e.action}</p>
              <span className="num shrink-0 text-[10.5px] text-slate-600">{e.time}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className={cn("rounded-sm border px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wider", ACTOR_TONE[e.actor])}>
                {e.actor}
              </span>
              {e.detail && <span className="text-[11px] text-slate-500">{e.detail}</span>}
            </div>
          </div>
        </motion.li>
      ))}
    </ol>
  );
}
