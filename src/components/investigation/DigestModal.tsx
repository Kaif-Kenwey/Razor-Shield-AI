"use client";

/**
 * PATTERN DIGEST — an analyst-facing brief computed live from the
 * current transaction window: open exposure, resolved actions,
 * dominant signals and geographies. Demo-flavoured ("brief"), but
 * every number is derived from real store state — nothing hardcoded.
 */

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Ban,
  FolderCheck,
  Gauge,
  Globe2,
  NotebookPen,
  Newspaper,
  Printer,
  ShieldAlert,
  TimerOff,
  TriangleAlert,
  Users,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RiskLevelBadge } from "@/components/risk/RiskBadge";
import { PrintDigestBrief } from "@/components/investigation/PrintDigestBrief";
import { useAppStore } from "@/store/appStore";
import { ANALYSTS, ANALYST_LOAD_HISTORY } from "@/data/mockData";
import { slaState, SLA_BREACH_MINUTES } from "@/components/shared/SlaChip";
import { formatINR, formatNumber, riskLevelFromScore } from "@/lib/format";
import { cn } from "@/lib/utils";

const SCORE_TONE_TEXT: Record<string, string> = {
  CRITICAL: "text-risk-critical",
  HIGH: "text-risk-high",
  MEDIUM: "text-risk-medium",
  LOW: "text-risk-low",
};

/** Tiny violet sparkline — open-case trend over the last 12 windows. */
function LoadSparkline({ series, idle }: { series: number[]; idle: boolean }) {
  const W = 56;
  const H = 16;
  const max = Math.max(...series, 1);
  const min = Math.min(...series);
  const span = Math.max(max - min, 1);
  const pts = series
    .map((v, i) => {
      const x = (i / (series.length - 1)) * (W - 2) + 1;
      const y = idle ? H - 3 : H - 3 - ((v - min) / span) * (H - 6);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  if (idle) {
    return (
      <svg width={W} height={H} className="shrink-0 opacity-40" aria-hidden>
        <line x1="1" y1={H - 3} x2={W - 1} y2={H - 3} stroke="#475569" strokeWidth="1" strokeDasharray="2 3" />
      </svg>
    );
  }
  return (
    <svg width={W} height={H} className="shrink-0" aria-hidden>
      <polyline
        points={pts}
        fill="none"
        stroke="#8b5cf6"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        style={{ filter: "drop-shadow(0 0 3px rgba(139,92,246,0.45))" }}
      />
      <circle
        cx={pts.split(" ").slice(-1)[0].split(",")[0]}
        cy={pts.split(" ").slice(-1)[0].split(",")[1]}
        r="1.8"
        fill="#c4b5fd"
      />
    </svg>
  );
}

function DigestStat({
  label,
  value,
  sub,
  tone,
  icon: Icon,
  delay,
  onClick,
  testId,
}: {
  label: string;
  value: string;
  sub: string;
  tone: string;
  icon: typeof Gauge;
  delay: number;
  /** When set, the stat renders as a jump target — clicking drills into the related queue. */
  onClick?: () => void;
  testId?: string;
}) {
  const cls = cn(
    "rounded-sm border border-line bg-surface-1 p-3.5 text-left",
    onClick &&
      "group cursor-pointer border-risk-critical/30 bg-risk-critical/[0.06] transition-all hover:border-risk-critical/55 hover:bg-risk-critical/10 hover:shadow-[0_0_18px_-6px_rgba(248,113,113,0.6)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-risk-critical/60 active:scale-[0.98]"
  );
  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="micro text-slate-500">{label}</p>
        <Icon className={cn("h-3.5 w-3.5", tone)} aria-hidden />
      </div>
      <p className={cn("num mt-2 text-xl font-bold tracking-tight", tone)}>{value}</p>
      <p className="mt-0.5 text-[10.5px] text-slate-600">{sub}</p>
      {onClick && (
        <p className="mt-1.5 flex items-center gap-1 text-[10px] font-medium text-risk-critical/90 opacity-80 transition-opacity group-hover:opacity-100">
          Open breached queue
          <ArrowRight className="h-2.5 w-2.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </p>
      )}
    </>
  );
  return onClick ? (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      onClick={onClick}
      data-testid={testId}
      className={cls}
    >
      {inner}
    </motion.button>
  ) : (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className={cls}
    >
      {inner}
    </motion.div>
  );
}

export function DigestModal() {
  const open = useAppStore((s) => s.digestOpen);
  const setOpen = useAppStore((s) => s.setDigestOpen);
  const setDigestPrintOpen = useAppStore((s) => s.setDigestPrintOpen);
  const transactions = useAppStore((s) => s.transactions);
  const decisions = useAppStore((s) => s.decisions);
  const assignments = useAppStore((s) => s.assignments);
  const caseNotes = useAppStore((s) => s.caseNotes);
  const signedInId = useAppStore((s) => s.signedInAnalystId);
  const digestPrintOpen = useAppStore((s) => s.digestPrintOpen);
  const openInvestigation = useAppStore((s) => s.openInvestigation);
  const setQueueAssignee = useAppStore((s) => s.setQueueAssignee);
  const setQueueBreachFilter = useAppStore((s) => s.setQueueBreachFilter);
  const navigate = useAppStore((s) => s.navigate);

  const digest = useMemo(() => {
    const open = transactions.filter(
      (t) =>
        (t.riskLevel === "HIGH" || t.riskLevel === "CRITICAL" || t.status === "INVESTIGATING" || t.status === "UNDER_REVIEW") &&
        !decisions[t.id]
    );
    const resolvedList = transactions.filter((t) => decisions[t.id]);
    const blocked = resolvedList.filter((t) => decisions[t.id]?.action === "BLOCK");
    const avgOpenScore = open.length
      ? Math.round(open.reduce((sum, t) => sum + t.riskScore, 0) / open.length)
      : 0;
    const exposure = open.reduce((sum, t) => sum + t.amount, 0);

    const signalCounts = new Map<string, number>();
    for (const t of open) for (const s of t.signals) signalCounts.set(s.title, (signalCounts.get(s.title) ?? 0) + 1);
    const topSignals = [...signalCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);

    const locationCounts = new Map<string, number>();
    for (const t of open) locationCounts.set(t.location, (locationCounts.get(t.location) ?? 0) + 1);
    const topLocations = [...locationCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);

    const hottest = [...open].sort((a, b) => b.riskScore - a.riskScore || b.amount - a.amount)[0] ?? null;

    const assignedCount = Object.keys(assignments).filter((id) => open.some((t) => t.id === id)).length;

    /* notebook volume — analyst evidence logged across the window */
    const notebookEntries = Object.values(caseNotes).reduce((n, arr) => n + arr.length, 0);
    const notebookCases = Object.values(caseNotes).filter((arr) => arr.length > 0).length;
    /* SLA pressure — open cases past the 30m escalation threshold */
    const slaBreached = open.filter((t) => slaState(t.timestamp) === "breached").length;

    /* per-analyst workload over open cases only (resolved handoffs don't load anyone) */
    const loadByAnalyst = new Map<string, { count: number; exposure: number; hottest: number }>();
    for (const t of open) {
      const key = assignments[t.id]?.analystId ?? "__unassigned";
      const cur = loadByAnalyst.get(key) ?? { count: 0, exposure: 0, hottest: 0 };
      cur.count += 1;
      cur.exposure += t.amount;
      cur.hottest = Math.max(cur.hottest, t.riskScore);
      loadByAnalyst.set(key, cur);
    }
    const workload = ANALYSTS.map((a) => ({
      analyst: a,
      ...(loadByAnalyst.get(a.id) ?? { count: 0, exposure: 0, hottest: 0 }),
    })).sort((x, y) => y.count - x.count || x.analyst.name.localeCompare(y.analyst.name));
    const unassigned = loadByAnalyst.get("__unassigned") ?? { count: 0, exposure: 0, hottest: 0 };
    const maxLoad = Math.max(unassigned.count, ...workload.map((w) => w.count), 1);

    return {
      open,
      resolved: resolvedList.length,
      blocked: blocked.length,
      avgOpenScore,
      exposure,
      topSignals,
      topLocations,
      hottest,
      assignedCount,
      analyzed: transactions.length,
      notebookEntries,
      notebookCases,
      slaBreached,
      workload,
      unassigned,
      maxLoad,
      loadHistory: ANALYST_LOAD_HISTORY,
      signedInId,
    };
  }, [transactions, decisions, assignments, caseNotes, signedInId]);

  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

  /** Jump from a workload row to that analyst's prefiltered queue. "__unassigned" opens the pool. */
  const openAnalystQueue = (analystId: string | null) => {
    setQueueAssignee(analystId);
    setQueueBreachFilter(false);
    setOpen(false);
    navigate("investigations");
  };

  /** Jump from the SLA stat card to the breached-only queue (escalate-first view). */
  const openBreachQueue = () => {
    setQueueBreachFilter(true);
    setQueueAssignee(null);
    setOpen(false);
    navigate("investigations");
  };

  const printBrief = () => {
    setOpen(false);
    // Next tick so the dialog is gone before the print snapshot.
    setTimeout(() => setDigestPrintOpen(true), 50);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg border-line bg-surface-1 p-0 sm:rounded-md">
        <DialogHeader className="relative border-b border-intel/25 px-5 py-4">
          <span
            className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-intel/50 to-transparent"
            aria-hidden
          />
          <DialogTitle className="flex items-center gap-2 text-[14px] font-semibold text-slate-100">
            <Newspaper className="h-4 w-4 text-intel" aria-hidden />
            Pattern digest
          </DialogTitle>
          <DialogDescription className="text-[12px] text-slate-500">
            {today} · compiled from the {formatNumber(digest.analyzed)}-transaction live window
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[62vh] space-y-4 overflow-y-auto px-5 py-4 scroll-thin">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            <DigestStat
              label="Open cases"
              value={String(digest.open.length)}
              sub={`₹${formatNumber(digest.exposure)} under scrutiny`}
              tone="text-slate-100"
              icon={ShieldAlert}
              delay={0}
            />
            <DigestStat
              label="Avg open score"
              value={`${digest.avgOpenScore}/100`}
              sub={digest.avgOpenScore >= 80 ? "Elevated — prioritize review" : "Within normal review range"}
              tone={digest.avgOpenScore >= 80 ? "text-risk-critical" : "text-slate-100"}
              icon={Gauge}
              delay={0.05}
            />
            <DigestStat
              label="Resolved"
              value={String(digest.resolved)}
              sub="Bounded actions this window"
              tone="text-risk-low"
              icon={FolderCheck}
              delay={0.1}
            />
            <DigestStat
              label="Blocked"
              value={String(digest.blocked)}
              sub="Confirmed-fraud prevention path"
              tone="text-risk-critical"
              icon={Ban}
              delay={0.15}
            />
            <DigestStat
              label="Notebook entries"
              value={String(digest.notebookEntries)}
              sub={
                digest.notebookEntries > 0
                  ? `Evidence on ${digest.notebookCases} case${digest.notebookCases === 1 ? "" : "s"}`
                  : "No analyst evidence yet"
              }
              tone="text-intel"
              icon={NotebookPen}
              delay={0.2}
            />
            <DigestStat
              label="SLA breached"
              value={String(digest.slaBreached)}
              sub={digest.slaBreached > 0 ? `Past ${SLA_BREACH_MINUTES}m — escalate first` : "All cases within SLA"}
              tone={digest.slaBreached > 0 ? "text-risk-critical" : "text-slate-100"}
              icon={TimerOff}
              delay={0.25}
              onClick={digest.slaBreached > 0 ? openBreachQueue : undefined}
              testId={digest.slaBreached > 0 ? "digest-sla-card" : undefined}
            />
          </div>

          {/* Dominant signals */}
          {digest.topSignals.length > 0 && (
            <section aria-label="Dominant signals">
              <p className="micro mb-2 text-slate-500">Dominant signals in open cases</p>
              <ul className="space-y-1.5">
                {digest.topSignals.map(([title, count], i) => (
                  <motion.li
                    key={title}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.2 + i * 0.05, duration: 0.3 }}
                    className="flex items-center gap-2.5"
                  >
                    <TriangleAlert className="h-3 w-3 shrink-0 text-risk-medium/80" aria-hidden />
                    <span className="flex-1 truncate text-[12px] text-slate-300">{title}</span>
                    <span className="relative h-1 w-24 shrink-0 overflow-hidden rounded-full bg-surface-3" aria-hidden>
                      <span
                        className="absolute inset-y-0 left-0 rounded-full bg-risk-medium/70"
                        style={{ width: `${(count / digest.topSignals[0][1]) * 100}%` }}
                      />
                    </span>
                    <span className="num w-5 text-right text-[11px] font-semibold text-slate-400">{count}</span>
                  </motion.li>
                ))}
              </ul>
            </section>
          )}

          {/* Geography */}
          {digest.topLocations.length > 0 && (
            <div className="rounded-sm border border-line bg-surface-1 p-3">
              <p className="micro mb-2 flex items-center gap-1.5 text-slate-500">
                <Globe2 className="h-3 w-3" aria-hidden />
                Top origin geos
              </p>
              <ul className="grid gap-1 sm:grid-cols-3">
                {digest.topLocations.map(([loc, count]) => (
                  <li
                    key={loc}
                    className="flex items-center justify-between gap-2 rounded-sm px-1.5 py-1 text-[11.5px] transition-colors hover:bg-surface-2 sm:flex-col sm:items-start sm:gap-0.5"
                  >
                    <span className="truncate text-slate-300">{loc}</span>
                    <span className="num text-slate-500">{count} open</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Per-analyst workload — who carries what right now */}
          <section aria-label="Analyst workload" className="rounded-sm border border-line bg-surface-1 p-3">
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <p className="micro flex items-center gap-1.5 text-slate-500">
                <Users className="h-3 w-3" aria-hidden />
                Analyst workload
              </p>
              <p className="num text-[10.5px] text-slate-600">
                {digest.assignedCount > 0
                  ? `${digest.assignedCount} of ${digest.open.length} open assigned`
                  : "all cases in pool"}
              </p>
            </div>
            <ul className="space-y-2">
              {digest.workload.map((w, i) => {
                const idle = w.count === 0;
                const hottestLevel = w.hottest > 0 ? riskLevelFromScore(w.hottest) : null;
                const isYou = w.analyst.id === signedInId;
                return (
                  <motion.li
                    key={w.analyst.id}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.15 + i * 0.05, duration: 0.3 }}
                    className={cn(
                      "relative rounded-sm px-1.5 py-1 -mx-1.5",
                      idle && "opacity-45",
                      isYou && "bg-intel/8 ring-1 ring-inset ring-intel/25"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => !idle && openAnalystQueue(w.analyst.id)}
                      disabled={idle}
                      aria-label={idle ? `${w.analyst.name} — no open cases` : `Open ${w.analyst.name}'s queue — ${w.count} open ${w.count === 1 ? "case" : "cases"}`}
                      className={cn(
                        "group/btn flex w-full items-center gap-2.5 rounded-sm px-1 py-0.5 text-left transition-colors",
                        idle ? "cursor-default" : "cursor-pointer hover:bg-surface-2"
                      )}
                    >
                    <div className="flex items-center gap-2.5">
                      <span
                        className={cn(
                          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border num text-[9.5px] font-semibold",
                          isYou
                            ? "border-intel/50 bg-intel/15 text-intel shadow-[0_0_10px_-2px_rgba(139,92,246,0.6)]"
                            : idle
                              ? "border-dashed border-line-strong text-slate-500"
                              : "border-intel/40 bg-intel/10 text-intel"
                        )}
                        aria-hidden
                      >
                        {w.analyst.initials}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-1.5">
                          <span className="truncate text-[12px] font-medium text-slate-200">{w.analyst.name}</span>
                          <span className="num shrink-0 text-[9.5px] text-slate-600">{w.analyst.level}</span>
                          {isYou && (
                            <span className="shrink-0 rounded-sm border border-intel/35 bg-intel/10 px-1 text-[8.5px] font-semibold uppercase tracking-wider text-intel">
                              you
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-[10px] text-slate-600">
                          {idle ? w.analyst.role.replace(" · you", "") : `${formatINR(w.exposure)} exposure`}
                        </span>
                      </span>
                      <span className="hidden shrink-0 md:block" title="Open-case trend — last 12 five-minute windows (synthetic demo series)">
                        <LoadSparkline series={digest.loadHistory[w.analyst.id] ?? []} idle={idle} />
                      </span>
                      {idle ? (
                        <span className="shrink-0 rounded-sm border border-line bg-surface-2 px-1.5 py-0.5 text-[9px] tracking-wide text-slate-500">
                          IDLE
                        </span>
                      ) : (
                        <span className="flex shrink-0 items-center gap-2">
                          {hottestLevel && (
                            <span className={cn("num text-[11px] font-semibold", SCORE_TONE_TEXT[hottestLevel])}>
                              peak {w.hottest}
                            </span>
                          )}
                          <span className="num text-[12px] font-semibold text-slate-200">
                            {w.count} open
                          </span>
                          <ArrowRight
                            className="h-3 w-3 text-intel opacity-0 transition-all group-hover/btn:translate-x-0.5 group-hover/btn:opacity-100"
                            aria-hidden
                          />
                        </span>
                      )}
                    </div>
                    </button>
                    {!idle && (
                      <span
                        className="mt-1 ml-[34px] block h-0.5 overflow-hidden rounded-full bg-surface-3/60"
                        aria-hidden
                      >
                        <motion.span
                          initial={{ width: 0 }}
                          animate={{ width: `${(w.count / digest.maxLoad) * 100}%` }}
                          transition={{ delay: 0.25 + i * 0.05, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                          className={cn("block h-full rounded-full", isYou ? "bg-intel" : "bg-intel/60")}
                        />
                      </span>
                    )}
                  </motion.li>
                );
              })}
              {/* unassigned pool */}
              {digest.unassigned.count > 0 && (
                <motion.li
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.15 + digest.workload.length * 0.05, duration: 0.3 }}
                >
                  <button
                    type="button"
                    onClick={() => openAnalystQueue("__unassigned")}
                    aria-label={`Open the unassigned pool — ${digest.unassigned.count} open ${digest.unassigned.count === 1 ? "case" : "cases"}`}
                    className="group/btn flex w-full cursor-pointer items-center gap-2.5 rounded-sm px-1 py-0.5 text-left transition-colors hover:bg-surface-2"
                  >
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-dashed border-line-strong num text-[10px] text-slate-500"
                      aria-hidden
                    >
                      ··
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] font-medium text-slate-400">Unassigned pool</span>
                      <span className="block truncate text-[10px] text-slate-600">
                        {formatINR(digest.unassigned.exposure)} awaiting handoff
                      </span>
                    </span>
                    <span className="num shrink-0 text-[12px] font-semibold text-slate-400">
                      {digest.unassigned.count} open
                    </span>
                    <ArrowRight
                      className="h-3 w-3 text-intel opacity-0 transition-all group-hover/btn:translate-x-0.5 group-hover/btn:opacity-100"
                      aria-hidden
                    />
                  </button>
                  <span className="mt-1 ml-[34px] block h-0.5 overflow-hidden rounded-full bg-surface-3/60" aria-hidden>
                    <motion.span
                      initial={{ width: 0 }}
                      animate={{ width: `${(digest.unassigned.count / digest.maxLoad) * 100}%` }}
                      transition={{ delay: 0.25 + digest.workload.length * 0.05, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                      className="block h-full rounded-full bg-slate-600/60"
                    />
                  </span>
                </motion.li>
              )}
            </ul>
            <p className="mt-2.5 text-[10px] leading-relaxed text-slate-600">
              On shift: {ANALYSTS.map((a) => `${a.name} (${a.level})`).join(" · ")} — handoff is advisory;
              bounded actions stay with the signed-in analyst. Click a row to open that queue. Sparklines:
              open-case trend across the last 12 five-minute windows (synthetic demo series).
            </p>
          </section>

          {/* Highest exposure */}
          {digest.hottest && (
            <section aria-label="Highest exposure case">
              <p className="micro mb-2 text-slate-500">Highest exposure right now</p>
              <button
                onClick={() => {
                  setOpen(false);
                  openInvestigation(digest.hottest!.id);
                }}
                className="group flex w-full items-center gap-3 rounded-sm border border-line bg-surface-1 p-3 text-left transition-colors hover:border-line-strong hover:bg-surface-2"
              >
                <span className="num text-lg font-bold text-risk-critical">{digest.hottest.riskScore}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="num text-[12.5px] font-semibold text-slate-100">{digest.hottest.id}</span>
                    <RiskLevelBadge level={digest.hottest.riskLevel} />
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                    {formatINR(digest.hottest.amount)} · {digest.hottest.location} · {digest.hottest.signals.length} signals
                  </span>
                </span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-600 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </button>
            </section>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
          <p className="text-[10.5px] text-slate-600">
            Live view · regenerates on every open (D)
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={printBrief}
              className="gap-1.5 border-intel/35 bg-intel/10 text-intel hover:bg-intel/20 hover:text-intel"
            >
              <Printer className="h-3.5 w-3.5" aria-hidden />
              Print brief
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setOpen(false)}
              className="border-line bg-surface-1 text-slate-300 hover:bg-surface-2 hover:text-slate-100"
            >
              Close brief
            </Button>
          </div>
        </div>
      </DialogContent>
      {/* Paper brief — mounted only while a digest print is pending */}
      {digestPrintOpen && (
        <PrintDigestBrief
          digest={{
          open: digest.open.map((t) => ({ id: t.id, riskScore: t.riskScore, amount: t.amount, location: t.location })),
          resolved: digest.resolved,
          blocked: digest.blocked,
          avgOpenScore: digest.avgOpenScore,
          exposure: digest.exposure,
          analyzed: digest.analyzed,
          topSignals: digest.topSignals,
          topLocations: digest.topLocations,
          hottest: digest.hottest
            ? { id: digest.hottest.id, riskScore: digest.hottest.riskScore, amount: digest.hottest.amount, location: digest.hottest.location }
            : null,
          workload: digest.workload.map((w) => ({
            analyst: { id: w.analyst.id, name: w.analyst.name, level: w.analyst.level },
            count: w.count,
            exposure: w.exposure,
            hottest: w.hottest,
          })),
          unassigned: digest.unassigned,
          loadHistory: digest.loadHistory,
          signedInId: digest.signedInId,
          todayLabel: today,
          notebookEntries: digest.notebookEntries,
          notebookCases: digest.notebookCases,
          slaBreached: digest.slaBreached,
        }}
        />
      )}
    </Dialog>
  );
}
