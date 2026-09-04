"use client";

/**
 * INVESTIGATIONS — the case queue. Active cases await analyst action;
 * resolved cases show the bounded action that was taken.
 * Keyboard: j/k cursor navigation, Enter opens the highlighted case.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  CornerDownLeft,
  Download,
  FolderSearch,
  FolderCheck,
  Gauge,
  NotebookPen,
  Star,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RiskLevelBadge, StatusBadge } from "@/components/risk/RiskBadge";
import { EmptyState } from "@/components/shared/States";
import { SlaChip, slaState, SLA_BREACH_MINUTES } from "@/components/shared/SlaChip";
import { isDialogOpen, isTypingTarget } from "@/components/layout/KeyboardShortcuts";
import { useAppStore } from "@/store/appStore";
import { useToast } from "@/hooks/use-toast";
import { ANALYSTS } from "@/data/mockData";
import { downloadCasesCsv } from "@/lib/caseFile";
import { formatINR, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { RiskLevel } from "@/types";

const SCORE_TONE: Record<RiskLevel, { text: string; bar: string }> = {
  CRITICAL: { text: "text-risk-critical", bar: "bg-risk-critical" },
  HIGH: { text: "text-risk-high", bar: "bg-risk-high" },
  MEDIUM: { text: "text-risk-medium", bar: "bg-risk-medium" },
  LOW: { text: "text-risk-low", bar: "bg-risk-low" },
};

const LEVEL_ORDER: Record<RiskLevel, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

export function InvestigationsView() {
  const transactions = useAppStore((s) => s.transactions);
  const decisions = useAppStore((s) => s.decisions);
  const watchlist = useAppStore((s) => s.watchlist);
  const assignments = useAppStore((s) => s.assignments);
  const caseNotes = useAppStore((s) => s.caseNotes);
  const signedInId = useAppStore((s) => s.signedInAnalystId);
  const queueAssignee = useAppStore((s) => s.queueAssignee);
  const setQueueAssignee = useAppStore((s) => s.setQueueAssignee);
  const queueBreachFilter = useAppStore((s) => s.queueBreachFilter);
  const setQueueBreachFilter = useAppStore((s) => s.setQueueBreachFilter);
  const escalateCase = useAppStore((s) => s.escalateCase);
  const escalations = useAppStore((s) => s.escalations);
  const openInvestigation = useAppStore((s) => s.openInvestigation);
  const setDigestOpen = useAppStore((s) => s.setDigestOpen);
  const { toast } = useToast();
  const [tab, setTab] = useState<"active" | "watched" | "resolved">("active");

  const matchesAssignee = (id: string) => {
    if (!queueAssignee) return true;
    if (queueAssignee === "__unassigned") return !assignments[id];
    return assignments[id]?.analystId === queueAssignee;
  };

  /* breach prefilter — only open cases past the 30m escalation threshold */
  const matchesBreach = (t: (typeof transactions)[number]) => {
    if (!queueBreachFilter) return true;
    return !decisions[t.id] && slaState(t.timestamp) === "breached";
  };

  const active = transactions.filter(
    (t) => (t.riskLevel === "HIGH" || t.riskLevel === "CRITICAL" || t.status === "INVESTIGATING" || t.status === "UNDER_REVIEW") && !decisions[t.id] && matchesAssignee(t.id) && matchesBreach(t)
  );
  const watched = transactions.filter((t) => watchlist[t.id] && matchesAssignee(t.id) && matchesBreach(t));
  const resolved = transactions.filter((t) => decisions[t.id] && matchesAssignee(t.id) && matchesBreach(t));
  const list = tab === "active" ? active : tab === "watched" ? watched : resolved;
  const filterAnalyst = queueAssignee && queueAssignee !== "__unassigned" ? ANALYSTS.find((a) => a.id === queueAssignee) : null;

  /* sort the queue the way analysts read it: hottest first */
  const visible = useMemo(
    () =>
      [...list].sort(
        (a, b) => LEVEL_ORDER[a.riskLevel] - LEVEL_ORDER[b.riskLevel] || b.riskScore - a.riskScore
      ),
    [list]
  );

  const [cursor, setCursor] = useState<number | null>(null);
  const [cursorScope, setCursorScope] = useState(tab);
  const gridRef = useRef<HTMLDivElement | null>(null);

  // tab changes reset the keyboard cursor (render-time reset)
  if (cursorScope !== tab) {
    setCursorScope(tab);
    setCursor(null);
  }

  /* j / k / Enter — cursor over the case queue */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target) || isDialogOpen()) return;

      if (e.key === "Escape") {
        setCursor(null);
        return;
      }
      if (e.key !== "j" && e.key !== "k" && e.key !== "Enter") return;
      if (visible.length === 0) return;

      if (e.key === "Enter") {
        if (e.target instanceof HTMLElement && e.target.closest("button, a, [role='button']")) return;
        if (cursor === null) return;
        const t = visible[cursor];
        if (t) openInvestigation(t.id);
        return;
      }

      e.preventDefault();
      setCursor((c) => {
        if (e.key === "j") return Math.min((c ?? -1) + 1, visible.length - 1);
        return Math.max((c ?? visible.length) - 1, 0);
      });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [visible, cursor, openInvestigation]);

  // keep the cursor card in view
  useEffect(() => {
    if (cursor === null) return;
    const card = gridRef.current?.querySelector('[data-cursor="true"]');
    card?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 lg:px-6">
      <header className="mb-6">
        <p className="micro mb-1.5 text-slate-500">Case management</p>
        <h1 className="text-xl font-semibold tracking-tight text-slate-50 sm:text-2xl">Investigation queue</h1>
        <p className="mt-1 text-[13px] text-slate-500">
          Cases opened by the risk engine. Each carries correlated evidence and an advisory recommendation.
        </p>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2" role="tablist" aria-label="Case tabs">
        {(
          [
            { key: "active", label: "Active", icon: FolderSearch, count: active.length },
            { key: "watched", label: "Watchlist", icon: Star, count: watched.length },
            { key: "resolved", label: "Resolved", icon: FolderCheck, count: resolved.length },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex h-9 items-center gap-2 rounded-sm border px-3.5 text-[12.5px] font-medium transition-colors",
              tab === t.key
                ? "border-line-strong bg-surface-2 text-slate-100"
                : "border-line bg-surface-1 text-slate-500 hover:text-slate-300"
            )}
          >
            <t.icon className={cn("h-3.5 w-3.5", tab === t.key ? (t.key === "watched" ? "text-risk-medium fill-current" : "text-intel") : "text-slate-600")} aria-hidden />
            {t.label}
            <span className="num rounded-full bg-surface-3 px-1.5 text-[10.5px] text-slate-400">{t.count}</span>
          </button>
        ))}

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {/* Pattern digest brief */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDigestOpen(true)}
                className="border-line bg-surface-1 text-slate-400 hover:bg-surface-2 hover:text-slate-200"
              >
                <BarChart3 className="h-3.5 w-3.5 text-intel" aria-hidden />
                <span className="hidden sm:inline">Digest</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Pattern digest — open exposure, dominant signals and geographies (D)
            </TooltipContent>
          </Tooltip>

          {/* Audit export — resolved cases as CSV */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={resolved.length === 0}
                onClick={() => {
                  const ok = downloadCasesCsv(transactions, decisions, caseNotes);
                  toast({
                    title: ok ? "Audit export downloaded" : "Export failed",
                    description: ok
                      ? `${resolved.length} resolved case(s) written to razorshield-audit.csv.`
                      : "The browser blocked the file download — try again or check permissions.",
                  });
                }}
                className="border-line bg-surface-1 text-slate-400 hover:bg-surface-2 hover:text-slate-200"
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                <span className="hidden sm:inline">Export audit</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              Download every resolved case as a CSV audit trail
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Queue prefilters — assignee chip (from digest workload rows) + breach chip (digest SLA card) */}
      {(queueAssignee || queueBreachFilter) && (
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="mb-4 flex flex-wrap items-center gap-2"
          >
            {queueAssignee && (
              <span
                className={cn(
                  "inline-flex h-8 items-center gap-2 rounded-sm border py-1 pl-1.5 pr-1.5",
                  "border-intel/35 bg-intel/8 shadow-[0_0_14px_-6px_rgba(139,92,246,0.6)]"
                )}
              >
                <span className="micro text-intel/80">Filter</span>
                {filterAnalyst ? (
                  <>
                    <span
                      className="flex h-5 w-5 items-center justify-center rounded-full border border-intel/40 bg-intel/15 num text-[8px] font-bold text-intel"
                      aria-hidden
                    >
                      {filterAnalyst.initials}
                    </span>
                    <span className="text-[12px] font-medium text-slate-200">
                      Assigned to {filterAnalyst.name}
                      {filterAnalyst.id === signedInId && <span className="ml-1 text-[10px] text-intel/80">· you</span>}
                    </span>
                  </>
                ) : (
                  <span className="text-[12px] font-medium text-slate-300">Unassigned pool</span>
                )}
                <button
                  onClick={() => setQueueAssignee(null)}
                  aria-label="Clear assignee filter"
                  className="flex h-5 w-5 items-center justify-center rounded-sm text-slate-500 transition-colors hover:bg-intel/15 hover:text-intel"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </span>
            )}
            {queueBreachFilter && (
              <span
                data-testid="breach-filter-chip"
                className={cn(
                  "inline-flex h-8 items-center gap-2 rounded-sm border py-1 pl-1.5 pr-1.5",
                  "border-risk-critical/40 bg-risk-critical/8 shadow-[0_0_14px_-6px_rgba(248,113,113,0.65)]"
                )}
              >
                <span className="micro text-risk-critical/90">Filter</span>
                <span className="relative flex h-1.5 w-1.5" aria-hidden>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-risk-critical opacity-60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-risk-critical" />
                </span>
                <span className="text-[12px] font-medium text-slate-200">SLA breached only</span>
                <button
                  onClick={() => setQueueBreachFilter(false)}
                  aria-label="Clear SLA breach filter"
                  className="flex h-5 w-5 items-center justify-center rounded-sm text-slate-500 transition-colors hover:bg-risk-critical/15 hover:text-risk-critical"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </span>
            )}
          </motion.div>
        </AnimatePresence>
      )}

      {list.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={
              tab === "active" ? <FolderSearch className="h-5 w-5" aria-hidden />
              : tab === "watched" ? <Star className="h-5 w-5" aria-hidden />
              : <FolderCheck className="h-5 w-5" aria-hidden />
            }
            title={
              queueAssignee || queueBreachFilter
                ? tab === "active"
                  ? "No active cases match the current filters"
                  : tab === "watched"
                    ? "Nothing watched matches the current filters"
                    : "No resolved cases match the current filters"
                : tab === "active" ? "No active cases" : tab === "watched" ? "Nothing on your watchlist" : "No resolved cases yet"
            }
            body={
              queueAssignee || queueBreachFilter
                ? "No cases in this tab match the active prefilter(s) — clear the filter chip(s) to see the full queue."
                : tab === "active"
                ? "The risk engine found nothing requiring investigation right now. High-risk arrivals will appear here instantly."
                : tab === "watched"
                  ? "Star any open case to pin it here for follow-up — watched cases survive demo traffic."
                  : "Take a bounded action on an active case and it will be archived here with its full audit trail."
            }
          />
        </div>
      ) : (
        <div ref={gridRef} className="grid gap-3 md:grid-cols-2">
          {visible.map((t, i) => {
            const decision = decisions[t.id];
            const assignment = assignments[t.id];
            const assignedAnalyst = assignment ? ANALYSTS.find((a) => a.id === assignment.analystId) : undefined;
            const noteCount = caseNotes[t.id]?.length ?? 0;
            const cursorRow = cursor === i;
            const tone = SCORE_TONE[t.riskLevel];
            const sla = !decision ? slaState(t.timestamp) : "ok";
            const breached = sla === "breached";
            return (
              <motion.button
                key={t.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, 8) * 0.05, duration: 0.3 }}
                onClick={() => openInvestigation(t.id)}
                data-cursor={cursorRow ? "true" : undefined}
                className={cn(
                  "group panel flex min-w-0 flex-col items-start gap-3 p-4 text-left transition-all duration-200 hover:-translate-y-px hover:border-line-strong hover:bg-surface-2/60 hover:shadow-[0_12px_32px_-18px_rgba(0,0,0,0.9)]",
                  t.riskLevel === "CRITICAL" && !decision && !cursorRow && "glow-critical",
                  breached && !cursorRow && "border-risk-critical/30 shadow-[inset_2px_0_0_0_rgba(248,113,113,0.6)]",
                  cursorRow && "border-intel/40 bg-surface-2 shadow-[inset_2px_0_0_0_rgba(167,139,250,0.65),0_12px_32px_-18px_rgba(0,0,0,0.9)]"
                )}
                aria-label={`Open case ${t.id}`}
              >
                <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="num text-[13px] font-semibold text-slate-100">{t.id}</span>
                    <RiskLevelBadge level={t.riskLevel} />
                    {!decision && <SlaChip timestamp={t.timestamp} />}
                    {noteCount > 0 && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-intel/30 bg-intel/10 px-1.5"
                            data-testid={`note-count-${t.id}`}
                          >
                            <NotebookPen className="h-2.5 w-2.5 text-intel" aria-hidden />
                            <span className="num text-[9px] font-semibold text-intel">{noteCount}</span>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          {noteCount} notebook {noteCount === 1 ? "entry" : "entries"} — travels with the case file
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                  <div className="flex min-w-0 items-center gap-2">
                    {assignedAnalyst && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5",
                              assignedAnalyst.id === signedInId
                                ? "border-intel/50 bg-intel/15 shadow-[0_0_10px_-3px_rgba(139,92,246,0.7)]"
                                : "border-intel/25 bg-intel/8"
                            )}
                          >
                            <span
                              className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-gradient-to-br from-intel/70 to-intel-soft/60 num text-[6.5px] font-bold text-white"
                              aria-hidden
                            >
                              {assignedAnalyst.initials}
                            </span>
                            <span className="hidden text-[9.5px] font-medium uppercase tracking-wider text-intel/90 sm:inline">
                              {assignedAnalyst.id === signedInId ? "you" : assignedAnalyst.name}
                            </span>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          {assignedAnalyst.id === signedInId
                            ? "Assigned to you — this case is in your hands"
                            : `Assigned to ${assignedAnalyst.name} (${assignedAnalyst.level})`}
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {decision ? (
                      <span className="num rounded-sm border border-risk-low/30 bg-risk-low/8 px-2 py-0.5 micro-11 text-risk-low">
                        {decision.action}
                      </span>
                    ) : (
                      <StatusBadge status={t.status} />
                    )}
                  </div>
                </div>

                <div className="grid w-full grid-cols-4 gap-2 border-y border-line/60 py-2.5">
                  <div>
                    <p className="micro text-slate-600">Amount</p>
                    <p className="num mt-0.5 text-[13px] text-slate-200">{formatINR(t.amount)}</p>
                  </div>
                  <div>
                    <p className="micro text-slate-600">Signals</p>
                    <p className="num mt-0.5 text-[13px] text-slate-200">{t.signals.length}</p>
                  </div>
                  <div>
                    <p className="micro text-slate-600">Score</p>
                    <p className="mt-0.5 flex items-center gap-1.5">
                      {t.status === "EVALUATING" ? (
                        <span className="text-[13px] text-slate-600">—</span>
                      ) : (
                        <>
                          <span className={cn("num text-[13px] font-semibold", tone.text)}>{t.riskScore}</span>
                          <span className="relative h-1 w-8 overflow-hidden rounded-full bg-surface-3" aria-hidden>
                            <span className={cn("absolute inset-y-0 left-0 rounded-full", tone.bar)} style={{ width: `${t.riskScore}%` }} />
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="micro text-slate-600">Opened</p>
                    <p
                      className={cn(
                        "num mt-0.5 text-[13px]",
                        breached ? "font-semibold text-risk-critical" : sla === "aging" ? "text-risk-medium" : "text-slate-200"
                      )}
                    >
                      {relativeTime(t.timestamp)}
                    </p>
                  </div>
                </div>

                <p className="line-clamp-2 text-[12px] leading-relaxed text-slate-500">
                  {t.aiSummary ?? `${t.signals.map((s) => s.title).join(" · ")} — awaiting AI investigation.`}
                </p>

                {/* SLA-breach escalation — one-click reassign to the L3 fraud lead (audited) */}
                {breached && !decision && (
                  escalations[t.id] ? (
                    <span
                      data-testid="escalated-badge"
                      className="mr-auto inline-flex items-center gap-1.5 rounded-sm border border-risk-critical/40 bg-risk-critical/10 px-2 py-1 text-[10.5px] font-semibold text-risk-critical shadow-[0_0_12px_-4px_rgba(248,113,113,0.6)]"
                    >
                      <span className="relative flex h-1.5 w-1.5" aria-hidden>
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-risk-critical opacity-60" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-risk-critical" />
                      </span>
                      ESCALATED · {escalations[t.id].toAnalystId === "AD" ? "A. DAS" : escalations[t.id].toAnalystId.toUpperCase()}
                    </span>
                  ) : (
                    <span
                      role="button"
                      tabIndex={0}
                      data-testid={`escalate-${t.id}`}
                      aria-label={`Escalate case ${t.id} to the L3 fraud lead — SLA breached`}
                      title="SLA breached — one-click escalate to the L3 fraud lead (A. Das) and record the escalation"
                      onClick={(e) => {
                        e.stopPropagation();
                        escalateCase(t.id);
                        toast({
                          title: "Case escalated to A. Das (L3 fraud lead)",
                          description: `${t.id} breached the ${SLA_BREACH_MINUTES}m escalation threshold — handoff re-routed and the escalation was recorded in the audit trail.`,
                        });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          escalateCase(t.id);
                          toast({
                            title: "Case escalated to A. Das (L3 fraud lead)",
                            description: `${t.id} breached the ${SLA_BREACH_MINUTES}m escalation threshold — handoff re-routed and the escalation was recorded in the audit trail.`,
                          });
                        }
                      }}
                      className="mr-auto inline-flex items-center gap-1.5 rounded-sm border border-risk-critical/45 bg-risk-critical/10 px-2 py-1 text-[10.5px] font-semibold text-risk-critical transition-all hover:bg-risk-critical/20 hover:shadow-[0_0_14px_-4px_rgba(248,113,113,0.7)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-risk-critical/60 active:scale-95"
                    >
                      <ArrowUpRight className="h-3 w-3" aria-hidden />
                      Escalate › L3
                    </span>
                  )
                )}
                <span className="ml-auto flex items-center gap-1.5 text-[11.5px] font-medium text-intel opacity-80 transition-opacity group-hover:opacity-100">
                  Open case <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </span>
              </motion.button>
            );
          })}
        </div>
      )}

      {/* keyboard hint (desktop) */}
      {visible.length > 0 && (
        <p className="mt-4 hidden items-center justify-end gap-2 text-[10.5px] text-slate-600 sm:flex">
          <kbd className="inline-flex h-4.5 items-center rounded border border-line bg-surface-2 px-1.5 num text-[9.5px] text-slate-400">j</kbd>
          <kbd className="inline-flex h-4.5 items-center rounded border border-line bg-surface-2 px-1.5 num text-[9.5px] text-slate-400">k</kbd>
          navigate queue
          <kbd className="ml-1 inline-flex h-4.5 items-center gap-1 rounded border border-line bg-surface-2 px-1.5 num text-[9.5px] text-slate-400">
            <CornerDownLeft className="h-2.5 w-2.5" aria-hidden />
          </kbd>
          open case
          <Gauge className="h-3 w-3 text-slate-700" aria-hidden />
          sorted hottest-first
        </p>
      )}
    </div>
  );
}
