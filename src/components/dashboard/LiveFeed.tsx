"use client";

/**
 * LIVE TRANSACTION FEED — the operational heart of the command center.
 * Filter pills, sortable columns, animated arrivals, evaluation lifecycle.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown, ArrowUp, ArrowUpDown, CheckCircle2, ChevronRight, FolderSearch, Pause, Play, Star, TriangleAlert } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RiskLevelBadge, StatusBadge } from "@/components/risk/RiskBadge";
import { InlineScore } from "@/components/risk/RiskScoreDial";
import { EmptyState, FeedSkeleton } from "@/components/shared/States";
import { isDialogOpen, isTypingTarget } from "@/components/layout/KeyboardShortcuts";
import { useAppStore } from "@/store/appStore";
import { useClusterStore, type ClusterEvent } from "@/hooks/useFraudClusters";
import { formatINR, formatINRCompact, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { RiskLevel, Transaction } from "@/types";

type FilterKey = "ALL" | "WATCHED" | "HIGH" | "MEDIUM" | "LOW" | "INVESTIGATING" | "BLOCKED";
type SortKey = "time" | "risk" | "amount";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "WATCHED", label: "★ Watched" },
  { key: "HIGH", label: "High Risk" },
  { key: "MEDIUM", label: "Medium Risk" },
  { key: "LOW", label: "Low Risk" },
  { key: "INVESTIGATING", label: "Investigating" },
  { key: "BLOCKED", label: "Blocked" },
];

function matchesFilter(t: Transaction, f: FilterKey, watchlist: Record<string, true>): boolean {
  switch (f) {
    case "ALL":
      return true;
    case "WATCHED":
      return Boolean(watchlist[t.id]);
    case "HIGH":
      return t.riskLevel === "HIGH" || t.riskLevel === "CRITICAL";
    case "MEDIUM":
      return t.riskLevel === "MEDIUM";
    case "LOW":
      return t.riskLevel === "LOW";
    case "INVESTIGATING":
      return t.status === "INVESTIGATING";
    case "BLOCKED":
      return t.status === "BLOCKED";
  }
}

const LEVEL_ORDER: Record<RiskLevel, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

/** A feed row is either a transaction or a staged fraud-cluster stream event. */
type FeedRow = { kind: "txn"; txn: Transaction } | { kind: "cluster"; cluster: ClusterEvent };

/**
 * Cluster banner row — a typed stream event rendered between transactions.
 * While the burst window is live it pulses (CRITICAL styling language);
 * once the window closes it stays only if the analyst opened the linked
 * case, downgraded to a non-pulsing row with an emerald link chip.
 */
function ClusterBannerRow({
  cluster,
  cursorRow,
  onOpen,
}: {
  cluster: ClusterEvent;
  cursorRow: boolean;
  onOpen: () => void;
}) {
  const active = cluster.status === "active";
  return (
    <motion.tr
      layout="position"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.45, ease: "easeOut" }}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={
        active
          ? `Fraud cluster detected: ${cluster.summary.txnCount} transactions, ${cluster.summary.deviceCount} devices, exposure ${cluster.summary.exposure}. Open highest-risk case.`
          : `Resolved fraud cluster linked to case ${cluster.linkedCaseId}`
      }
      data-cursor={cursorRow ? "true" : undefined}
      className={cn(
        "group cursor-pointer border-b border-line/60 transition-colors outline-none",
        "focus-visible:bg-surface-2",
        cursorRow && "bg-surface-2 shadow-[inset_2px_0_0_0_rgba(167,139,250,0.65)]",
        active
          ? "bg-risk-high/[0.06] hover:bg-risk-high/[0.1]"
          : "bg-surface-2/60 hover:bg-surface-2",
      )}
    >
      <td colSpan={9} className="px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="relative flex h-2 w-2 shrink-0">
            {active && (
              <span className="absolute h-full w-full rounded-full bg-risk-high opacity-60 live-ping" aria-hidden />
            )}
            <span className={cn("relative h-2 w-2 rounded-full", active ? "bg-risk-high" : "bg-risk-low/70")} />
          </span>
          <TriangleAlert
            className={cn("h-3.5 w-3.5 shrink-0", active ? "text-risk-high" : "text-slate-500")}
            aria-hidden
          />
          <span className={cn("micro-11 font-bold tracking-wide", active ? "text-risk-high" : "text-slate-400")}>
            {active ? "FRAUD CLUSTER DETECTED" : "FRAUD CLUSTER"}
          </span>
          <span className="num text-[11.5px] text-slate-300">
            {cluster.summary.txnCount} txns · {cluster.summary.deviceCount}{" "}
            {cluster.summary.deviceCount === 1 ? "device" : "devices"} ·{" "}
            {formatINRCompact(cluster.summary.exposure)} exposure
          </span>
          {active && (
            <span className="rounded-sm border border-risk-high/35 bg-risk-high/10 px-1.5 py-0.5 micro-11 text-risk-high">
              2 min window
            </span>
          )}
          <span className="ml-auto flex items-center gap-1.5">
            {!active && cluster.linkedCaseId ? (
              <span className="flex items-center gap-1 rounded-sm border border-risk-low/35 bg-risk-low/10 px-1.5 py-0.5 micro-11 text-risk-low">
                <CheckCircle2 className="h-3 w-3" aria-hidden />
                linked to case {cluster.linkedCaseId}
              </span>
            ) : (
              <span className="flex items-center gap-1 micro-11 text-slate-500 transition-colors group-hover:text-slate-300">
                open highest-risk case
                <ChevronRight className="h-3 w-3" aria-hidden />
              </span>
            )}
          </span>
        </div>
      </td>
    </motion.tr>
  );
}

function SortButton({
  label,
  active,
  dir,
  onToggle,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        "group inline-flex items-center gap-1 micro text-slate-500 hover:text-slate-300 transition-colors",
        active && "text-slate-300"
      )}
      aria-label={`Sort by ${label}`}
    >
      {label}
      {active ? (
        dir === "desc" ? <ArrowDown className="h-2.5 w-2.5" aria-hidden /> : <ArrowUp className="h-2.5 w-2.5" aria-hidden />
      ) : (
        <ArrowUpDown className="h-2.5 w-2.5 opacity-0 group-hover:opacity-60" aria-hidden />
      )}
    </button>
  );
}

export function LiveFeed({ compact = false, clickMode = "investigation" }: { compact?: boolean; clickMode?: "investigation" | "detail" }) {
  const transactions = useAppStore((s) => s.transactions);
  const loading = useAppStore((s) => s.loading);
  const connection = useAppStore((s) => s.connection);
  const demoMode = useAppStore((s) => s.demoMode);
  const streamPaused = useAppStore((s) => s.streamPaused);
  const setStreamPaused = useAppStore((s) => s.setStreamPaused);
  const watchlist = useAppStore((s) => s.watchlist);
  const openInvestigation = useAppStore((s) => s.openInvestigation);
  const openDetail = useAppStore((s) => s.openTransactionDetail);
  const clusterEvents = useClusterStore((s) => s.clusters);
  const onRowClick = clickMode === "detail" ? openDetail : openInvestigation;

  /** Banner click — opens the linked highest-risk case and pins the link
   * so the resolved banner keeps its emerald "linked to case" chip. */
  const openClusterCase = (cluster: ClusterEvent) => {
    const caseId = cluster.linkedCaseId ?? cluster.topTxnId;
    useClusterStore.getState().linkCluster(cluster.id, caseId);
    openInvestigation(caseId);
  };

  const [filter, setFilter] = useState<FilterKey>("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("time");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [tick, setTick] = useState(0);
  /** Keyboard cursor (j/k) — index into the visible rows. */
  const [cursor, setCursor] = useState<number | null>(null);
  const [cursorScope, setCursorScope] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // refresh relative timestamps
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 20000);
    return () => clearInterval(t);
  }, []);

  // filter/sort changes reset the keyboard cursor (render-time reset)
  const nextScope = `${filter}|${sortKey}|${sortDir}`;
  if (cursorScope !== nextScope) {
    setCursorScope(nextScope);
    setCursor(null);
  }

  const rows = useMemo(() => {
    const filtered = transactions.filter((t) => matchesFilter(t, filter, watchlist));
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "risk":
          return (LEVEL_ORDER[a.riskLevel] - LEVEL_ORDER[b.riskLevel] || b.riskScore - a.riskScore) * dir;
        case "amount":
          return (a.amount - b.amount) * dir;
        default:
          return (new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()) * dir;
      }
    });
  }, [transactions, filter, sortKey, sortDir, tick, watchlist]);

  /** Unified row model — transactions interleaved with cluster stream
   * events. Each banner anchors at its first visible member so the burst
   * group stays together; non-time sorts pin banners to the top. */
  const unified = useMemo<FeedRow[]>(() => {
    const txnRows: FeedRow[] = rows.map((txn) => ({ kind: "txn", txn }));
    if (clusterEvents.length === 0) return txnRows;

    const anchors = clusterEvents.map((cluster) => {
      let idx = txnRows.findIndex((r) => r.kind === "txn" && cluster.memberIds.includes(r.txn.id));
      if (idx === -1 && sortKey === "time") {
        const detected = new Date(cluster.detectedAt).getTime();
        idx = txnRows.findIndex((r) => r.kind === "txn" && new Date(r.txn.timestamp).getTime() < detected);
        if (idx === -1) idx = txnRows.length;
      } else if (idx === -1) {
        idx = 0;
      }
      return { cluster, idx };
    });

    // insert bottom-up so earlier anchors stay valid; older banner first on ties
    anchors.sort(
      (a, b) => b.idx - a.idx || new Date(a.cluster.detectedAt).getTime() - new Date(b.cluster.detectedAt).getTime(),
    );
    const out = [...txnRows];
    for (const { cluster, idx } of anchors) out.splice(idx, 0, { kind: "cluster", cluster });
    return out;
  }, [rows, clusterEvents, sortKey]);

  const visible = compact ? unified.slice(0, 9) : unified;
  const visibleTxnCount = visible.reduce((n, r) => (r.kind === "txn" ? n + 1 : n), 0);

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { ALL: transactions.length, WATCHED: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INVESTIGATING: 0, BLOCKED: 0 };
    for (const t of transactions) {
      if (watchlist[t.id]) c.WATCHED++;
      if (t.riskLevel === "HIGH" || t.riskLevel === "CRITICAL") c.HIGH++;
      else if (t.riskLevel === "MEDIUM") c.MEDIUM++;
      else if (t.riskLevel === "LOW") c.LOW++;
      if (t.status === "INVESTIGATING") c.INVESTIGATING++;
      if (t.status === "BLOCKED") c.BLOCKED++;
    }
    return c;
  }, [transactions, watchlist]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  /* j / k / Enter — keyboard cursor over the feed (banners included) */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target) || isDialogOpen()) return;

      if (e.key === "Escape") {
        setCursor(null);
        return;
      }
      if (e.key !== "j" && e.key !== "k" && e.key !== "Enter") return;
      if (loading || visible.length === 0) return;

      if (e.key === "Enter") {
        // don't hijack Enter on focused buttons / links
        if (e.target instanceof HTMLElement && e.target.closest("button, a, [role='button']")) return;
        if (cursor === null) return;
        const row = visible[cursor];
        if (!row) return;
        if (row.kind === "cluster") {
          openClusterCase(row.cluster);
          return;
        }
        if (row.txn.status !== "EVALUATING") onRowClick(row.txn.id);
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
  }, [visible, cursor, loading, rows.length, onRowClick]);

  // keep the cursor row in view
  useEffect(() => {
    if (cursor === null) return;
    const row = scrollRef.current?.querySelector('[data-cursor="true"]');
    row?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  return (
    <section className="panel overflow-hidden" aria-label="Live transaction feed">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2 w-2">
            {demoMode && connection === "online" && !streamPaused && (
              <span className="absolute h-full w-full rounded-full bg-risk-critical opacity-50 live-ping" />
            )}
            <span className={cn("relative h-2 w-2 rounded-full", connection === "online" && !streamPaused ? "bg-risk-critical" : "bg-risk-medium", streamPaused && "pulse-dot")} />
          </span>
          <h2 className="micro-11 font-semibold text-slate-200">Live transaction feed</h2>
          <span className="num text-[11px] text-slate-600">{rows.length} shown</span>
          {streamPaused && (
            <span className="rounded-sm border border-risk-medium/30 bg-risk-medium/8 px-1.5 py-0.5 micro-11 text-risk-medium">Stream paused</span>
          )}
        </div>

        {/* Stream pause — freeze demo arrivals while presenting */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setStreamPaused(!streamPaused)}
              aria-pressed={streamPaused}
              aria-label={streamPaused ? "Resume live stream" : "Pause live stream"}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-sm border transition-colors",
                streamPaused
                  ? "border-risk-medium/40 bg-risk-medium/10 text-risk-medium"
                  : "border-line bg-surface-1 text-slate-500 hover:border-line-strong hover:text-slate-200"
              )}
            >
              {streamPaused ? <Play className="h-3 w-3" aria-hidden /> : <Pause className="h-3 w-3" aria-hidden />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-[11px]">
            {streamPaused ? "Resume demo arrivals" : "Freeze demo arrivals — useful mid-pitch"}
          </TooltipContent>
        </Tooltip>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-1 md:ml-auto" role="tablist" aria-label="Filter transactions">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-sm border px-2 py-1 micro text-slate-500 transition-all active:scale-[0.97]",
                filter === f.key
                  ? "border-line-strong bg-surface-3 text-slate-100"
                  : "border-transparent hover:bg-surface-2 hover:text-slate-300"
              )}
            >
              {f.label}
              <span className={cn("num ml-1.5 text-[9.5px]", f.key === "WATCHED" && counts[f.key] > 0 && filter !== f.key ? "text-risk-medium/90" : "text-slate-600")}>
                {counts[f.key]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <FeedSkeleton rows={compact ? 6 : 9} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No transactions match this filter"
          body="The risk engine is streaming normally. Try a different filter — or enable demo mode to generate live traffic."
        />
      ) : (
        <div className="relative overflow-x-auto">
          {/* scroll fades — hint at more rows without stealing height */}
          <div className="pointer-events-none absolute inset-x-0 top-[38px] z-20 h-5 bg-gradient-to-b from-surface-1 to-transparent" aria-hidden />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-6 bg-gradient-to-t from-surface-1 to-transparent" aria-hidden />
          <div ref={scrollRef} className={cn("min-w-[760px]", compact && "max-h-[430px] overflow-y-auto scroll-thin", !compact && "max-h-[600px] overflow-y-auto scroll-thin")}>
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 z-10 bg-surface-1/95 backdrop-blur-sm">
                <tr className="border-b border-line">
                  <th scope="col" className="px-4 py-2.5 micro text-slate-500 font-medium">Transaction</th>
                  <th scope="col" className="px-3 py-2.5"><SortButton label="Amount" active={sortKey === "amount"} dir={sortDir} onToggle={() => toggleSort("amount")} /></th>
                  <th scope="col" className="px-3 py-2.5 micro text-slate-500 font-medium hidden lg:table-cell">Customer</th>
                  <th scope="col" className="px-3 py-2.5 micro text-slate-500 font-medium hidden xl:table-cell">Location</th>
                  <th scope="col" className="px-3 py-2.5 micro text-slate-500 font-medium hidden xl:table-cell">Device</th>
                  <th scope="col" className="px-3 py-2.5"><SortButton label="Score" active={sortKey === "risk"} dir={sortDir} onToggle={() => toggleSort("risk")} /></th>
                  <th scope="col" className="px-3 py-2.5 micro text-slate-500 font-medium">Level</th>
                  <th scope="col" className="px-3 py-2.5 micro text-slate-500 font-medium hidden md:table-cell">Status</th>
                  <th scope="col" className="px-4 py-2.5 text-right"><SortButton label="Time" active={sortKey === "time"} dir={sortDir} onToggle={() => toggleSort("time")} /></th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {visible.map((row, idx) => {
                    if (row.kind === "cluster") {
                      return (
                        <ClusterBannerRow
                          key={`cluster-${row.cluster.id}`}
                          cluster={row.cluster}
                          cursorRow={cursor === idx}
                          onOpen={() => openClusterCase(row.cluster)}
                        />
                      );
                    }
                    const t = row.txn;
                    const isEvaluating = t.status === "EVALUATING";
                    const hot = t.riskLevel === "CRITICAL";
                    const cursorRow = cursor === idx;
                    return (
                      <motion.tr
                        key={t.id}
                        layout="position"
                        initial={{ opacity: 0, y: -8, backgroundColor: "rgba(167,139,250,0.07)" }}
                        animate={{ opacity: 1, y: 0, backgroundColor: "rgba(167,139,250,0)" }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.55, ease: "easeOut" }}
                        onClick={() => !isEvaluating && onRowClick(t.id)}
                        onKeyDown={(e) => {
                          if (!isEvaluating && (e.key === "Enter" || e.key === " ")) {
                            e.preventDefault();
                            onRowClick(t.id);
                          }
                        }}
                        tabIndex={isEvaluating ? -1 : 0}
                        role="button"
                        aria-label={`Investigate transaction ${t.id}, risk score ${t.riskScore}`}
                        data-cursor={cursorRow ? "true" : undefined}
                        className={cn(
                          "group cursor-pointer border-b border-line/60 transition-colors outline-none",
                          "hover:bg-surface-2/70 focus-visible:bg-surface-2",
                          hot && !cursorRow && "bg-risk-critical/[0.035]",
                          cursorRow && "bg-surface-2 shadow-[inset_2px_0_0_0_rgba(167,139,250,0.65)]"
                        )}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className={cn("relative h-3.5 w-0.5 rounded-full", isEvaluating ? "bg-slate-600" : hot ? "bg-risk-critical" : t.riskLevel === "HIGH" ? "bg-risk-high" : t.riskLevel === "MEDIUM" ? "bg-risk-medium" : "bg-risk-low/60")}>
                              {hot && !isEvaluating && (
                                <span className="absolute inset-0 animate-ping rounded-full bg-risk-critical opacity-60" aria-hidden />
                              )}
                            </span>
                            <span className="num text-[12.5px] font-medium text-slate-200 group-hover:text-white">{t.id}</span>
                            {watchlist[t.id] && (
                              <span title="On your watchlist" aria-label={`${t.id} is on the watchlist`}>
                                <Star className="h-3 w-3 fill-current text-risk-medium drop-shadow-[0_0_4px_rgba(251,191,36,0.55)]" aria-hidden />
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 pl-[10px] text-[11px] text-slate-500 lg:hidden">{t.customerId} · {t.location}</p>
                        </td>
                        <td className="px-3 py-3 num text-[12.5px] text-slate-200">{formatINR(t.amount)}</td>
                        <td className="px-3 py-3 hidden lg:table-cell">
                          <p className="num text-[12px] text-slate-300">{t.customerId}</p>
                          <p className="text-[10.5px] text-slate-500">{t.merchant}</p>
                        </td>
                        <td className="px-3 py-3 text-[12px] text-slate-300 hidden xl:table-cell">{t.location}</td>
                        <td className="px-3 py-3 hidden xl:table-cell">
                          <span className={cn("text-[11.5px]", t.isNewDevice ? "text-risk-medium" : "text-slate-500")}>
                            {t.isNewDevice ? "New device" : "Known"}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          {isEvaluating ? (
                            <span className="num text-[12.5px] text-slate-500 animate-pulse">· · ·</span>
                          ) : (
                            <InlineScore score={t.riskScore} level={t.riskLevel} />
                          )}
                        </td>
                        <td className="px-3 py-3">
                          {isEvaluating ? (
                            <span className="micro text-slate-500">Scoring…</span>
                          ) : (
                            <RiskLevelBadge level={t.riskLevel} />
                          )}
                        </td>
                        <td className="px-3 py-3 hidden md:table-cell">
                          <StatusBadge status={t.status} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="flex items-center justify-end gap-2">
                            <span className="num text-[11.5px] text-slate-500 whitespace-nowrap">{relativeTime(t.timestamp)}</span>
                            {!isEvaluating && (
                              <ChevronRight
                                className="h-3.5 w-3.5 -mr-1 text-slate-600 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100 group-focus-visible:opacity-100"
                                aria-hidden
                              />
                            )}
                          </span>
                        </td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Footer hint */}
      {!loading && rows.length > 0 && (
        <div className="flex items-center justify-between border-t border-line px-4 py-2">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-600">
            <FolderSearch className="h-3 w-3" aria-hidden />
            Select a transaction to open the AI investigation workspace
            {!compact && (
              <span className="ml-2 hidden items-center gap-1.5 md:inline-flex">
                <kbd className="inline-flex h-4.5 items-center rounded border border-line bg-surface-2 px-1.5 num text-[9.5px] text-slate-500">j</kbd>
                <kbd className="inline-flex h-4.5 items-center rounded border border-line bg-surface-2 px-1.5 num text-[9.5px] text-slate-500">k</kbd>
                <span>navigate</span>
                <span className="text-slate-700">·</span>
                <kbd className="inline-flex h-4.5 items-center rounded border border-line bg-surface-2 px-1.5 num text-[9.5px] text-slate-500">↵</kbd>
                <span>open</span>
              </span>
            )}
          </p>
          {!compact && <p className="num text-[11px] text-slate-600">showing {visibleTxnCount} / {rows.length}</p>}
        </div>
      )}
    </section>
  );
}
