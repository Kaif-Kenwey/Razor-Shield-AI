"use client";

/**
 * Case file header — "opening a case" moment.
 * Breadcrumb: Command center / Investigations / TXN_XXXX
 * Watchlist star: pin the case for follow-up.
 * Assign: hand the case to a named analyst (advisory, audited).
 * Print: clean paper case-file via the print stylesheet.
 */

import { useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Lock,
  Printer,
  Star,
  UserPlus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StatusDot } from "@/components/shared/StatusDot";
import { SlaChip } from "@/components/shared/SlaChip";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/store/appStore";
import { ANALYSTS, customerFor } from "@/data/mockData";
import { buildCaseFile, downloadCaseFile } from "@/lib/caseFile";
import { formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Investigation, Transaction } from "@/types";

function AnalystAvatar({ initials, className }: { initials: string; className?: string }) {
  return (
    <span
      className={cn(
        "flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-intel/70 to-intel-soft/60 num text-[7.5px] font-bold text-white",
        className
      )}
      aria-hidden
    >
      {initials}
    </span>
  );
}

export function CaseHeader({
  txn,
  investigation,
}: {
  txn: Transaction;
  investigation?: Investigation;
}) {
  const navigate = useAppStore((s) => s.navigate);
  const watchlist = useAppStore((s) => s.watchlist);
  const toggleWatch = useAppStore((s) => s.toggleWatch);
  const assignments = useAppStore((s) => s.assignments);
  const escalations = useAppStore((s) => s.escalations);
  const assignCase = useAppStore((s) => s.assignCase);
  const acceptCaseHandoff = useAppStore((s) => s.acceptCaseHandoff);
  const caseNotes = useAppStore((s) => s.caseNotes[txn.id]);
  const signedInId = useAppStore((s) => s.signedInAnalystId);
  const watched = Boolean(watchlist[txn.id]);
  const assignment = assignments[txn.id];
  const assignedAnalyst = assignment ? ANALYSTS.find((a) => a.id === assignment.analystId) : undefined;
  const { toast } = useToast();
  const [exported, setExported] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [acceptMenuOpen, setAcceptMenuOpen] = useState(false);

  const resolved = Boolean(investigation?.analystAction);

  /** Claim the handoff: audited, and switches the acting persona to the assignee. */
  const acceptHandoff = () => {
    if (!assignment || !assignedAnalyst) return;
    acceptCaseHandoff(txn.id);
    toast({
      title: `Handoff accepted — now acting as ${assignedAnalyst.name}`,
      description: `${txn.id} · persona switched to ${assignedAnalyst.level} ${assignedAnalyst.name}; the claim is recorded in the audit trail.`,
    });
  };

  const canAcceptHandoff = Boolean(assignedAnalyst && assignedAnalyst.id !== signedInId && !resolved && !assignment?.acceptedAt);

  /** SLA-breach escalation — shown as a red state chip beside the assignment badges. */
  const escalation = escalations[txn.id];
  const escalationTo = escalation ? ANALYSTS.find((a) => a.id === escalation.toAnalystId) : undefined;

  /** Claim without switching persona — for leads reviewing other analysts' queues. */
  const acceptKeepPersona = () => {
    if (!assignment || !assignedAnalyst) return;
    acceptCaseHandoff(txn.id, { keepPersona: true });
    setAcceptMenuOpen(false);
    toast({
      title: "Handoff accepted — persona retained",
      description: `${txn.id} · claim recorded for ${assignedAnalyst.name} in the audit trail — still acting as ${signedInId === "RK" ? "R. Khan" : ANALYSTS.find((a) => a.id === signedInId)?.name ?? signedInId}.`,
    });
  };

  const exportCaseFile = () => {
    const caseFile = buildCaseFile(txn, investigation ?? null, customerFor(txn), caseNotes ?? [], signedInId);
    const ok = downloadCaseFile(caseFile);
    if (ok) {
      setExported(true);
      setTimeout(() => setExported(false), 1800);
      toast({
        title: "Case file exported",
        description: `${txn.id}-case-file.json — full evidence, timeline and decision.`,
      });
    } else {
      toast({
        title: "Export unavailable",
        description: "The browser blocked the download in this context.",
        variant: "destructive",
      });
    }
  };

  return (
    <motion.header
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="panel scanline relative overflow-hidden px-5 py-4"
    >
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1.5 text-[11px] text-slate-600">
        <button onClick={() => navigate("overview")} className="transition-colors hover:text-slate-300">
          Command center
        </button>
        <ChevronRight className="h-3 w-3 text-slate-700" aria-hidden />
        <button onClick={() => navigate("investigations")} className="transition-colors hover:text-slate-300">
          Investigations
        </button>
        <ChevronRight className="h-3 w-3 text-slate-700" aria-hidden />
        <span className="num text-slate-400" aria-current="page">{txn.id}</span>
      </nav>

      <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("overview")}
              className="h-7 w-7 shrink-0 text-slate-500 hover:bg-surface-3 hover:text-slate-200"
              aria-label="Back to command center"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </Button>
            <p className="micro text-slate-500">Investigation</p>
            <span className="h-3 w-px bg-line-strong" aria-hidden />
            <h1 className="num text-lg font-semibold tracking-tight text-slate-50">{txn.id}</h1>
            <button
              onClick={() => toggleWatch(txn.id)}
              aria-pressed={watched}
              aria-label={watched ? "Remove from watchlist" : "Add to watchlist"}
              title={watched ? "Remove from watchlist" : "Add to watchlist"}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-sm border transition-all active:scale-90",
                watched
                  ? "border-risk-medium/45 bg-risk-medium/10 text-risk-medium shadow-[0_0_12px_-4px_rgba(251,191,36,0.5)]"
                  : "border-line bg-surface-1 text-slate-500 hover:border-line-strong hover:text-risk-medium"
              )}
            >
              <Star className={cn("h-3.5 w-3.5", watched && "fill-current")} aria-hidden />
            </button>
            <button
              onClick={exportCaseFile}
              aria-label="Export case file as JSON"
              title="Export case file (JSON) — transaction, evidence, timeline and decision"
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-sm border px-2 text-[10.5px] font-medium transition-all active:scale-95",
                exported
                  ? "border-risk-low/40 bg-risk-low/10 text-risk-low"
                  : "border-line bg-surface-1 text-slate-500 hover:border-line-strong hover:text-slate-200"
              )}
            >
              {exported ? <Check className="h-3 w-3" aria-hidden /> : <Download className="h-3 w-3" aria-hidden />}
              {exported ? "Exported" : "Export"}
            </button>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => window.print()}
                  aria-label="Print case file"
                  title="Print case file — clean paper report"
                  className="flex h-7 items-center gap-1.5 rounded-sm border border-line bg-surface-1 px-2 text-[10.5px] font-medium text-slate-500 transition-all hover:border-line-strong hover:text-slate-200 active:scale-95"
                >
                  <Printer className="h-3 w-3" aria-hidden />
                  Print
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Open the print dialog — a clean paper case-file is generated automatically</TooltipContent>
            </Tooltip>

            {/* Analyst handoff */}
            <Popover open={assignOpen} onOpenChange={setAssignOpen}>
              <PopoverTrigger asChild>
                <button
                  onClick={() => setAssignOpen((o) => !o)}
                  aria-label={assignedAnalyst ? `Assigned to ${assignedAnalyst.name} — reassign` : "Assign case to an analyst"}
                  aria-expanded={assignOpen}
                  title="Assign case — hand off to another analyst (logged in the audit trail)"
                  className={cn(
                    "flex h-7 items-center gap-1.5 rounded-sm border px-2 text-[10.5px] font-medium transition-all active:scale-95",
                    assignedAnalyst
                      ? "border-intel/40 bg-intel/10 text-intel"
                      : "border-line bg-surface-1 text-slate-500 hover:border-line-strong hover:text-slate-200"
                  )}
                >
                  {assignedAnalyst ? <AnalystAvatar initials={assignedAnalyst.initials} /> : <UserPlus className="h-3 w-3" aria-hidden />}
                  {assignedAnalyst ? assignedAnalyst.name : "Assign"}
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" sideOffset={8} className="w-64 border-line bg-popover p-0">
                <div className="border-b border-line px-3.5 py-2.5">
                  <p className="micro text-slate-400">Assign case</p>
                  <p className="mt-1 text-[11px] leading-snug text-slate-600">
                    Handoff is advisory — the bounded action stays with the assignee.
                  </p>
                </div>
                <ul className="py-1" role="listbox" aria-label="Analysts">
                  {ANALYSTS.map((a) => {
                    const selected = assignment?.analystId === a.id;
                    const isYou = a.id === signedInId;
                    return (
                      <li key={a.id}>
                        <button
                          role="option"
                          aria-selected={selected}
                          onClick={() => {
                            assignCase(txn.id, selected ? null : a.id);
                            setAssignOpen(false);
                            if (!selected) {
                              toast({
                                title: `Case assigned to ${a.name}`,
                                description: `${txn.id} · handoff recorded in the audit trail.`,
                              });
                            }
                          }}
                          className={cn(
                            "flex w-full items-center gap-2.5 px-3.5 py-2 text-left transition-colors hover:bg-surface-2",
                            selected && "bg-intel/8"
                          )}
                        >
                          <AnalystAvatar initials={a.initials} className="h-6 w-6 text-[9px]" />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className="text-[12.5px] font-medium text-slate-200">{a.name}</span>
                              <span className="num rounded-sm border border-line bg-surface-2 px-1 text-[9px] uppercase tracking-wider text-slate-500">
                                {a.level}
                              </span>
                              {isYou && <span className="text-[10px] text-slate-600">· you</span>}
                            </span>
                            <span className="mt-0.5 block truncate text-[10.5px] text-slate-600">{a.role}</span>
                          </span>
                          {selected && <Check className="h-3.5 w-3.5 shrink-0 text-intel" aria-hidden />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {assignment && (
                  <div className="border-t border-line px-3.5 py-2">
                    <button
                      onClick={() => {
                        assignCase(txn.id, null);
                        setAssignOpen(false);
                      }}
                      className="flex items-center gap-1.5 text-[11px] text-slate-500 transition-colors hover:text-slate-300"
                    >
                      <X className="h-3 w-3" aria-hidden />
                      Unassign case
                    </button>
                  </div>
                )}
              </PopoverContent>
            </Popover>

            {/* Accept handoff — split control: direct claim (persona switch) or menu → keep persona */}
            {canAcceptHandoff && assignedAnalyst && (
              <div className="flex items-stretch">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={acceptHandoff}
                      aria-label={`Accept handoff as ${assignedAnalyst.name} — switch acting analyst and claim this case`}
                      className="flex h-7 items-center gap-1.5 rounded-l-sm border border-intel/45 bg-intel/12 px-2 text-[10.5px] font-medium text-intel shadow-[0_0_14px_-5px_rgba(139,92,246,0.8)] transition-all hover:bg-intel/20 active:scale-95"
                    >
                      <AnalystAvatar initials={assignedAnalyst.initials} />
                      Accept handoff
                      <ChevronRight className="h-3 w-3 opacity-70" aria-hidden />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    Case sits in {assignedAnalyst.name}&apos;s queue — accept it to act as {assignedAnalyst.name} (audited)
                  </TooltipContent>
                </Tooltip>
                <Popover open={acceptMenuOpen} onOpenChange={setAcceptMenuOpen}>
                  <PopoverTrigger asChild>
                    <button
                      aria-label="More accept options — claim without switching persona"
                      data-testid="accept-keep-persona"
                      aria-expanded={acceptMenuOpen}
                      title="More ways to accept — including claiming without switching persona"
                      className="flex h-7 items-center rounded-r-sm border border-l-0 border-intel/45 bg-intel/12 px-1 text-intel transition-all hover:bg-intel/20 active:scale-95"
                    >
                      <ChevronDown className={cn("h-3 w-3 transition-transform", acceptMenuOpen && "rotate-180")} aria-hidden />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" sideOffset={8} className="w-72 border-intel/30 bg-popover p-0">
                    <div className="border-b border-line px-3.5 py-2.5">
                      <p className="micro text-intel/90">Accept handoff</p>
                      <p className="mt-1 text-[11px] leading-snug text-slate-600">
                        Claiming is audited — choose whether to switch into the assignee&apos;s seat.
                      </p>
                    </div>
                    <div className="py-1">
                      <button
                        onClick={acceptHandoff}
                        className="flex w-full items-start gap-2.5 px-3.5 py-2 text-left transition-colors hover:bg-surface-2"
                      >
                        <AnalystAvatar initials={assignedAnalyst.initials} className="mt-0.5" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12.5px] font-medium text-slate-200">Accept &amp; act as {assignedAnalyst.name}</span>
                          <span className="mt-0.5 block text-[10.5px] text-slate-600">Switch persona — decisions carry {assignedAnalyst.initials} from here on</span>
                        </span>
                      </button>
                      <button
                        onClick={acceptKeepPersona}
                        className="flex w-full items-start gap-2.5 px-3.5 py-2 text-left transition-colors hover:bg-surface-2"
                      >
                        <Check className="mt-1 h-4 w-4 shrink-0 text-intel" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12.5px] font-medium text-slate-200">Accept &amp; keep my persona</span>
                          <span className="mt-0.5 block text-[10.5px] text-slate-600">Stay as you — the claim alone goes on the record</span>
                        </span>
                      </button>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            )}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2 pl-[42px]">
            {resolved ? (
              <span className="inline-flex items-center gap-1.5 rounded-sm border border-risk-low/30 bg-risk-low/8 px-2 py-1 micro-11 text-risk-low">
                <Lock className="h-2.5 w-2.5" aria-hidden />
                RESOLVED · {investigation?.analystAction}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-sm border border-intel/35 bg-intel/10 px-2 py-1 micro-11 text-intel">
                <StatusDot tone="violet" pulse />
                ACTIVE INVESTIGATION
              </span>
            )}
            {watched && (
              <span className="inline-flex items-center gap-1 rounded-sm border border-risk-medium/25 bg-risk-medium/6 px-1.5 py-1 micro-11 text-risk-medium/90">
                <Star className="h-2.5 w-2.5 fill-current" aria-hidden />
                WATCHED
              </span>
            )}
            {escalation && escalationTo && (
              <span
                data-testid="escalated-badge-header"
                title={`SLA breach escalated to ${escalationTo.name} (${escalationTo.level}) — recorded in the audit trail`}
                className="inline-flex items-center gap-1.5 rounded-sm border border-risk-critical/40 bg-risk-critical/10 px-1.5 py-1 micro-11 text-risk-critical shadow-[0_0_12px_-5px_rgba(248,113,113,0.7)]"
              >
                <span className="relative flex h-1.5 w-1.5" aria-hidden>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-risk-critical opacity-60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-risk-critical" />
                </span>
                ESCALATED · {escalationTo.name.toUpperCase()}
              </span>
            )}
            {assignedAnalyst && (
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-1 micro-11",
                  assignment?.acceptedAt
                    ? "border-intel/45 bg-intel/12 text-intel shadow-[0_0_10px_-4px_rgba(139,92,246,0.7)]"
                    : "border-intel/25 bg-intel/6 text-intel/90"
                )}
              >
                {assignment?.acceptedAt ? (
                  <Check className="h-2.5 w-2.5" aria-hidden />
                ) : (
                  <AnalystAvatar initials={assignedAnalyst.initials} />
                )}
                {assignment?.acceptedAt ? "ACCEPTED · " : "ASSIGNED · "}{assignedAnalyst.name.toUpperCase()}
              </span>
            )}
            {!resolved && <SlaChip timestamp={txn.timestamp} />}
            <span className="text-[12px] text-slate-500">
              {txn.merchant} · {txn.paymentMethod}
            </span>
          </div>
        </div>

        <div className="ml-auto grid grid-cols-3 gap-x-8 gap-y-1 sm:gap-x-10">
          <div>
            <p className="micro text-slate-500">Amount</p>
            <p className="num mt-1 text-[15px] font-semibold text-slate-100">{formatINR(txn.amount)}</p>
          </div>
          <div>
            <p className="micro text-slate-500">Customer</p>
            <p className="num mt-1 text-[15px] font-semibold text-slate-100">{txn.customerId}</p>
          </div>
          <div>
            <p className="micro text-slate-500">Origin</p>
            <p className="num mt-1 text-[15px] font-semibold text-slate-100">{txn.location}</p>
          </div>
        </div>
      </div>
    </motion.header>
  );
}
