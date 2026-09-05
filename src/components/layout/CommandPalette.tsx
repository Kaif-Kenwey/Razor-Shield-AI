"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import {
  ArrowLeftRight,
  ArrowRight,
  BarChart3,
  Cpu,
  FileUp,
  FolderSearch,
  LayoutGrid,
  Newspaper,
  NotebookPen,
  Pause,
  Play,
  Server,
  Sparkles,
  TimerOff,
  UserCog,
  UserPlus,
  Users,
  UserX,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { useToast } from "@/hooks/use-toast";
import { isDialogOpen } from "@/components/layout/KeyboardShortcuts";
import { ANALYSTS } from "@/data/mockData";
import { slaState, SLA_BREACH_MINUTES } from "@/components/shared/SlaChip";
import { formatINR, relativeTime } from "@/lib/format";
import type { ViewKey } from "@/types";
import { cn } from "@/lib/utils";

const NAV_ITEMS: { key: ViewKey; label: string; icon: typeof LayoutGrid }[] = [
  { key: "overview", label: "Overview — Risk Command Center", icon: LayoutGrid },
  { key: "investigations", label: "Investigations — Case Queue", icon: FolderSearch },
  { key: "transactions", label: "Transactions — Payment Ledger", icon: ArrowLeftRight },
  { key: "datastudio", label: "Dataset Studio — Import & Score Real Data", icon: FileUp },
  { key: "intelligence", label: "Risk Intelligence — Patterns", icon: BarChart3 },
  { key: "model", label: "Model Performance — rse-1.2", icon: Cpu },
  { key: "system", label: "System — Engine Health", icon: Server },
];

/** Highlight the matched term inside a notebook snippet (violet). */
function NoteSnippet({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(term);
  if (idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <span className="rounded-[2px] bg-intel/20 px-0.5 text-intel">{text.slice(idx, idx + term.length)}</span>
      {text.slice(idx + term.length)}
    </>
  );
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const transactions = useAppStore((s) => s.transactions);
  const navigate = useAppStore((s) => s.navigate);
  const openInvestigation = useAppStore((s) => s.openInvestigation);
  const openTransactionDetail = useAppStore((s) => s.openTransactionDetail);
  const focusTxnId = useAppStore((s) => s.focusTxnId);
  const assignments = useAppStore((s) => s.assignments);
  const caseNotes = useAppStore((s) => s.caseNotes);
  const decisions = useAppStore((s) => s.decisions);
  const soundEnabled = useAppStore((s) => s.soundEnabled);
  const streamPaused = useAppStore((s) => s.streamPaused);
  const signedInId = useAppStore((s) => s.signedInAnalystId);
  const { toast } = useToast();

  const focused = useMemo(
    () => transactions.find((t) => t.id === focusTxnId) ?? null,
    [transactions, focusTxnId]
  );
  const focusedAssignment = focusTxnId ? assignments[focusTxnId] : undefined;

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        // never stack the palette on another dialog (digest, confirm modal, cheat-sheet)
        if (!open && isDialogOpen()) return;
        setOpen((o) => !o);
        return;
      }
      // "/" — quick search, ignored while typing in another field or over a dialog
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const target = e.target;
        const typing =
          target instanceof HTMLElement &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable);
        if (!typing && !isDialogOpen()) {
          e.preventDefault();
          setOpen(true);
        }
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  /* quick actions: only open cases — resolved ones live in the queue's Resolved tab */
  const highRisk = useMemo(
    () =>
      transactions
        .filter(
          (t) =>
            (t.riskLevel === "CRITICAL" || t.riskLevel === "HIGH") && !decisions[t.id]
        )
        .slice(0, 4),
    [transactions, decisions]
  );

  const recent = useMemo(() => transactions.slice(0, 40), [transactions]);

  /* ---- notebook search: queries starting with "note:" ---- */
  const noteQueryRaw = query.trim().toLowerCase().startsWith("note:")
    ? query.trim().slice(5).trim().toLowerCase()
    : null;
  const allNotes = useMemo(
    () =>
      Object.entries(caseNotes)
        .flatMap(([txnId, notes]) => notes.map((n) => ({ txnId, ...n })))
        .sort((a, b) => b.at.localeCompare(a.at)),
    [caseNotes]
  );
  const noteMatches = useMemo(() => {
    if (noteQueryRaw === null) return [];
    return allNotes
      .filter(
        (n) =>
          !noteQueryRaw ||
          n.text.toLowerCase().includes(noteQueryRaw) ||
          n.txnId.toLowerCase().includes(noteQueryRaw)
      )
      .slice(0, 10);
  }, [allNotes, noteQueryRaw]);
  const noteAuthor = (id: string) => ANALYSTS.find((a) => a.id === id)?.name ?? id;

  /* per-analyst open-case counts — mirrors the digest workload math */
  const queueCounts = useMemo(() => {
    const open = transactions.filter(
      (t) =>
        (t.riskLevel === "HIGH" || t.riskLevel === "CRITICAL" || t.status === "INVESTIGATING" || t.status === "UNDER_REVIEW") &&
        !decisions[t.id]
    );
    const byAnalyst = new Map<string, number>();
    let unassigned = 0;
    for (const t of open) {
      const id = assignments[t.id]?.analystId;
      if (id) byAnalyst.set(id, (byAnalyst.get(id) ?? 0) + 1);
      else unassigned += 1;
    }
    const breached = open.filter((t) => slaState(t.timestamp) === "breached").length;
    return { byAnalyst, unassigned, breached };
  }, [transactions, decisions, assignments]);

  /* Single close path — clears the query so the palette never reopens
     filtered by a stale search (cmdk keeps the last query in state). */
  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  const go = useCallback(
    (key: ViewKey) => {
      navigate(key);
      close();
    },
    [navigate, close]
  );

  const openDetail = openTransactionDetail;

  const handOff = useCallback(
    (analystId: string | null) => {
      if (!focusTxnId) return;
      const s = useAppStore.getState();
      s.assignCase(focusTxnId, analystId);
      const analyst = ANALYSTS.find((a) => a.id === analystId);
      toast({
        title: analyst ? `Case handed off to ${analyst.name}` : "Assignment removed",
        description: analyst
          ? `${focusTxnId} · ${analyst.role.replace(" · you", " — that's you")} — handoff recorded in the audit trail.`
          : `${focusTxnId} is back in the unassigned pool.`,
      });
      close();
    },
    [focusTxnId, toast, close]
  );

  const actAs = useCallback(
    (analystId: string) => {
      const s = useAppStore.getState();
      const analyst = ANALYSTS.find((a) => a.id === analystId);
      s.setSignedInAnalyst(analystId);
      close();
      toast({
        title: `Now acting as ${analyst?.name ?? analystId} (${analyst?.level ?? ""})`,
        description: "Decisions and notebook entries will carry this identity — switching is itself audit-logged.",
      });
    },
    [toast, close]
  );

  return (
    <CommandDialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}>
      <CommandInput
        placeholder="Search cases — or 'note: <text>' to search the notebook…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList className="scroll-thin">
        <CommandEmpty>
          {noteQueryRaw !== null ? "No notebook entries match." : "No matching transactions found."}
        </CommandEmpty>

        {/* Notebook search mode — 'note:' prefix searches every analyst's entries */}
        {noteQueryRaw !== null && (
          <CommandGroup
            heading={noteQueryRaw ? "Notebook search" : "Notebook — recent entries"}
            className="[&_[cmdk-group-heading]]:text-intel/90"
          >
            {noteMatches.map((n) => (
              <CommandItem
                key={n.id}
                value={`note: ${query.trim()} ${n.text} ${n.txnId} ${n.id}`}
                data-testid="palette-note-result"
                onSelect={() => {
                  /* spotlight the entry in the notebook — scroll + flash on arrival */
                  useAppStore.getState().setHighlightNoteId(n.id);
                  openInvestigation(n.txnId);
                  close();
                }}
                className="gap-3"
              >
                <NotebookPen className="h-3.5 w-3.5 shrink-0 text-intel" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-slate-200">
                    <NoteSnippet text={n.text} term={noteQueryRaw} />
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-slate-600">
                    <span className="num font-medium text-slate-400">{n.txnId}</span>
                    <span aria-hidden>·</span>
                    <span>{noteAuthor(n.analystId)}</span>
                    <span aria-hidden>·</span>
                    <span className="num">{relativeTime(n.at)}</span>
                  </span>
                </span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-600" aria-hidden />
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {noteQueryRaw === null && (
          <>
        {highRisk.length > 0 && (
          <>
            <CommandGroup heading="High-risk transactions">
              {highRisk.map((t) => (
                <CommandItem
                  key={t.id}
                  value={`${t.id} ${t.customerId} ${t.customerName} ${t.location} ${t.merchant}`}
                  onSelect={() => {
                    openInvestigation(t.id);
                    close();
                  }}
                  className="gap-3"
                >
                  <Sparkles className="h-3.5 w-3.5 text-risk-critical" aria-hidden />
                  <span className="num text-[12.5px] font-medium text-slate-200">{t.id}</span>
                  <span className="num text-[12px] text-slate-400">{formatINR(t.amount)}</span>
                  <span className="text-[12px] text-slate-500">{t.location}</span>
                  <span className="ml-auto num text-[11px] text-slate-600">{relativeTime(t.timestamp)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        <CommandGroup heading="Analyst briefings">
          <CommandItem
            value="open pattern digest brief weekly stats"
            onSelect={() => {
              useAppStore.getState().setDigestOpen(true);
              close();
            }}
            className="gap-3"
          >
            <Newspaper className="h-3.5 w-3.5 text-intel" aria-hidden />
            <span className="text-[12.5px] text-slate-300">Open pattern digest</span>
            <CommandShortcut className="num text-[10px] tracking-normal text-slate-500">D</CommandShortcut>
          </CommandItem>
          <CommandItem
            value={soundEnabled ? "mute critical alert chime sound off" : "unmute critical alert chime sound on"}
            onSelect={() => {
              const s = useAppStore.getState();
              s.setSoundEnabled(!s.soundEnabled);
              close();
              toast({
                title: s.soundEnabled ? "Critical-alert chime muted" : "Critical-alert chime armed",
                description: s.soundEnabled
                  ? "Critical arrivals surface as toasts only."
                  : "A two-tone chime plays when a critical transaction lands (M toggles).",
              });
            }}
            className="gap-3"
          >
            {soundEnabled ? (
              <Volume2 className="h-3.5 w-3.5 text-risk-medium" aria-hidden />
            ) : (
              <VolumeX className="h-3.5 w-3.5 text-slate-500" aria-hidden />
            )}
            <span className="text-[12.5px] text-slate-300">
              {soundEnabled ? "Mute critical-alert chime" : "Arm critical-alert chime"}
            </span>
            <CommandShortcut className="num text-[10px] tracking-normal text-slate-500">M</CommandShortcut>
          </CommandItem>
          <CommandItem
            value={streamPaused ? "resume live transaction stream" : "pause live transaction stream"}
            onSelect={() => {
              const s = useAppStore.getState();
              s.setStreamPaused(!s.streamPaused);
              close();
              toast({
                title: s.streamPaused ? "Live stream resumed" : "Live stream paused",
                description: s.streamPaused
                  ? "Scripted arrivals continue in the background."
                  : "The feed freezes — useful while presenting.",
              });
            }}
            className="gap-3"
          >
            {streamPaused ? (
              <Play className="h-3.5 w-3.5 text-risk-low" aria-hidden />
            ) : (
              <Pause className="h-3.5 w-3.5 text-slate-500" aria-hidden />
            )}
            <span className="text-[12.5px] text-slate-300">
              {streamPaused ? "Resume live stream" : "Pause live stream"}
            </span>
            <CommandShortcut className="num text-[10px] tracking-normal text-slate-500">P</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />

        {/* Case queues — jump straight to a prefiltered queue */}
        <CommandGroup
          heading="Case queues"
          className="[&_[cmdk-group-heading]]:text-intel/90"
        >
          {ANALYSTS.map((a) => {
            const count = queueCounts.byAnalyst.get(a.id) ?? 0;
            const isYou = a.id === signedInId;
            return (
              <CommandItem
                key={a.id}
                value={`open queue cases assigned to ${a.name} ${a.level} ${a.role}`}
                disabled={count === 0}
                onSelect={() => {
                  const s = useAppStore.getState();
                  s.setQueueAssignee(a.id);
                  s.navigate("investigations");
                  close();
                  toast({
                    title: `Queue filtered — ${a.name}`,
                    description: `Showing the ${count} open case(s) assigned to ${a.name}. Clear the violet filter chip to see everything.`,
                  });
                }}
                className="gap-3"
              >
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border num text-[9px] font-semibold",
                    isYou ? "border-intel/45 bg-intel/12 text-intel" : "border-line-strong bg-surface-2 text-slate-300"
                  )}
                  aria-hidden
                >
                  {a.initials}
                </span>
                <span className="text-[12.5px] text-slate-300">
                  Open {isYou ? "your" : `${a.name}'s`} queue
                  <span className="ml-1.5 text-[11px] text-slate-600">
                    {a.level} · {count} open
                  </span>
                </span>
                <Users className="ml-auto h-3.5 w-3.5 text-slate-600" aria-hidden />
              </CommandItem>
            );
          })}
          <CommandItem
            value="open unassigned pool cases awaiting handoff"
            disabled={queueCounts.unassigned === 0}
            onSelect={() => {
              const s = useAppStore.getState();
              s.setQueueAssignee("__unassigned");
              s.navigate("investigations");
              close();
              toast({
                title: "Queue filtered — unassigned pool",
                description: `Showing ${queueCounts.unassigned} open case(s) awaiting handoff.`,
              });
            }}
            className="gap-3"
          >
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-dashed border-line-strong num text-[8px] text-slate-500"
              aria-hidden
            >
              ··
            </span>
            <span className="text-[12.5px] text-slate-300">
              Open unassigned pool
              <span className="ml-1.5 text-[11px] text-slate-600">{queueCounts.unassigned} awaiting handoff</span>
            </span>
            <Users className="ml-auto h-3.5 w-3.5 text-slate-600" aria-hidden />
          </CommandItem>
          <CommandItem
            value="open sla breached queue cases past escalation threshold escalate"
            disabled={queueCounts.breached === 0}
            data-testid="palette-breached-item"
            onSelect={() => {
              const s = useAppStore.getState();
              s.setQueueBreachFilter(true);
              s.setQueueAssignee(null);
              s.navigate("investigations");
              close();
              toast({
                title: "Queue filtered — SLA breached",
                description: `Showing the ${queueCounts.breached} open case(s) past the ${SLA_BREACH_MINUTES}-minute escalation threshold.`,
              });
            }}
            className="gap-3"
          >
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-risk-critical/40 bg-risk-critical/10"
              aria-hidden
            >
              <TimerOff className="h-2.5 w-2.5 text-risk-critical" />
            </span>
            <span className="text-[12.5px] text-slate-300">
              Open SLA-breached queue
              <span className="ml-1.5 text-[11px] text-slate-600">
                {queueCounts.breached} past the {SLA_BREACH_MINUTES}m threshold
              </span>
            </span>
            <ArrowRight className="ml-auto h-3.5 w-3.5 text-risk-critical/70" aria-hidden />
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />

        {/* Persona — who the analyst is signed in as */}
        <CommandGroup
          heading="Acting analyst"
          className="[&_[cmdk-group-heading]]:text-intel/90"
        >
          {ANALYSTS.map((a) => {
            const active = a.id === signedInId;
            return (
              <CommandItem
                key={a.id}
                value={`act as sign in switch persona ${a.name} ${a.level} ${a.role}`}
                disabled={active}
                onSelect={() => actAs(a.id)}
                className="gap-3"
              >
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border num text-[9px] font-semibold",
                    active ? "border-intel/45 bg-intel/12 text-intel" : "border-line-strong bg-surface-2 text-slate-300"
                  )}
                  aria-hidden
                >
                  {a.initials}
                </span>
                <span className="text-[12.5px] text-slate-300">
                  {active ? (
                    <>
                      Signed in as {a.name}
                      <span className="ml-1.5 text-[11px] text-intel/80">· current identity</span>
                    </>
                  ) : (
                    <>
                      Act as {a.name}
                      <span className="ml-1.5 text-[11px] text-slate-600">
                        {a.level} · {a.role}
                      </span>
                    </>
                  )}
                </span>
                <UserCog className={cn("ml-auto h-3.5 w-3.5", active ? "text-intel" : "text-slate-600")} aria-hidden />
              </CommandItem>
            );
          })}
        </CommandGroup>
        <CommandSeparator />

        {focused && (
          <>
            <CommandGroup
              heading={`Case handoff — ${focused.id}`}
              className="[&_[cmdk-group-heading]]:text-intel/90"
            >
              {ANALYSTS.filter((a) => a.id !== focusedAssignment?.analystId).map((a) => (
                <CommandItem
                  key={a.id}
                  value={`assign hand off ${focused.id} to ${a.name} ${a.level} ${a.role}`}
                  onSelect={() => handOff(a.id)}
                  className="gap-3"
                >
                  <span
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface-2 num text-[9px] font-semibold text-slate-300"
                    aria-hidden
                  >
                    {a.initials}
                  </span>
                  <span className="text-[12.5px] text-slate-300">
                    Hand off to {a.name}
                    <span className="ml-1.5 text-[11px] text-slate-600">
                      {a.level} · {a.role}
                    </span>
                  </span>
                  <UserPlus className="ml-auto h-3.5 w-3.5 text-slate-600" aria-hidden />
                </CommandItem>
              ))}
              {focusedAssignment && (
                <CommandItem
                  value={`remove assignment unassign ${focused.id}`}
                  onSelect={() => handOff(null)}
                  className="gap-3"
                >
                  <UserX className="h-3.5 w-3.5 text-slate-500" aria-hidden />
                  <span className="text-[12.5px] text-slate-400">Remove assignment — back to pool</span>
                </CommandItem>
              )}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}
        <CommandGroup heading={query.trim() ? "Matching transactions" : "All transactions"}>
          {recent.map((t) => (
            <CommandItem
              key={t.id}
              value={`${t.id} ${t.customerId} ${t.customerName} ${t.location} ${t.merchant} ${t.status}`}
              onSelect={() => {
                openDetail(t.id);
                close();
              }}
              className="gap-3"
            >
              <ArrowLeftRight
                className={cn(
                  "h-3.5 w-3.5",
                  t.riskLevel === "CRITICAL" || t.riskLevel === "HIGH" ? "text-risk-critical" : "text-slate-500"
                )}
                aria-hidden
              />
              <span className="num text-[12.5px] font-medium text-slate-200">{t.id}</span>
              <span className="num text-[12px] text-slate-400">{formatINR(t.amount)}</span>
              <span className="text-[12px] text-slate-500">{t.location}</span>
              <span className="ml-auto num text-[11px] text-slate-600">{relativeTime(t.timestamp)}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Navigate">
          {NAV_ITEMS.map((item) => (
            <CommandItem
              key={item.key}
              value={item.label}
              onSelect={() => go(item.key)}
              className="gap-3"
            >
              <item.icon className="h-3.5 w-3.5 text-slate-400" aria-hidden />
              <span className="text-[12.5px] text-slate-300">{item.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Shortcuts">
          <CommandItem
            value="open full transaction ledger"
            onSelect={() => go("transactions")}
            className="gap-3"
          >
            <ArrowLeftRight className="h-3.5 w-3.5 text-slate-400" aria-hidden />
            <span className="text-[12.5px] text-slate-300">Open full transaction ledger</span>
          </CommandItem>
        </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
