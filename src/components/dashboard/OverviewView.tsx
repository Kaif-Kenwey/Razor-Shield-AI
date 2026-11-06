"use client";

/**
 * OVERVIEW — RISK COMMAND CENTER.
 * Answers one question: "What's happening right now?"
 *
 * Every number here is computed live from the SQLite ledger through
 * useRiskMetrics() — when the ledger is empty the view says so and offers
 * honest ways to fill it (demo seed or a real CSV import).
 */

import { useMemo } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, Database, RefreshCw } from "lucide-react";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { LiveFeed } from "@/components/dashboard/LiveFeed";
import { EmptyState, SectionHeader } from "@/components/shared/States";
import { SlaChip } from "@/components/shared/SlaChip";
import { AiStatusPill } from "@/components/ai/AiStatusPill";
import { StatusDot } from "@/components/shared/StatusDot";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store/appStore";
import { useDemoControls, useRiskMetrics } from "@/hooks/useLedger";
import { formatINR } from "@/lib/format";
import { RiskLevelBadge } from "@/components/risk/RiskBadge";
import type { RiskMetric, SignalType } from "@/types";
import { cn } from "@/lib/utils";

/**
 * Local display labels for engine signal types (mirrors the engine's
 * internal SIGNAL_LABELS map, which is not exported).
 */
const SIGNAL_LABELS: Record<SignalType, string> = {
  NEW_DEVICE: "New device",
  UNUSUAL_AMOUNT: "Unusual amount",
  LOCATION_ANOMALY: "Location anomaly",
  VELOCITY_SPIKE: "Velocity spike",
  IMPOSSIBLE_TRAVEL: "Impossible travel",
  HIGH_VALUE: "High value",
  MERCHANT_RISK: "Merchant risk",
  TIME_ANOMALY: "Time anomaly",
  METHOD_MISMATCH: "Method mismatch",
  STRUCTURING: "Structuring",
};

/* ------------------------------------------------------------------ */
/* Skeleton                                                            */
/* ------------------------------------------------------------------ */

function MetricCardSkeleton({ index = 0 }: { index?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: index * 0.05, duration: 0.3 }}
      className="panel relative overflow-hidden p-4"
      role="status"
      aria-label="Loading metric"
    >
      <div className="h-2.5 w-28 rounded bg-slate-500/12 animate-pulse" />
      <div className="mt-3.5 h-8 w-20 rounded bg-slate-500/10 animate-pulse" style={{ animationDelay: "120ms" }} />
      <div className="mt-3 h-3 w-24 rounded bg-slate-500/8 animate-pulse" style={{ animationDelay: "240ms" }} />
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* High-risk queue                                                     */
/* ------------------------------------------------------------------ */

function HighRiskQueue() {
  const transactions = useAppStore((s) => s.transactions);
  const openInvestigation = useAppStore((s) => s.openInvestigation);

  const queue = transactions
    .filter((t) => t.status === "INVESTIGATING" && (t.riskLevel === "CRITICAL" || t.riskLevel === "HIGH"))
    .slice(0, 4);

  /* Top signals across the recently loaded ledger rows in the store —
   * a recent window, not a portfolio-wide 24h aggregate. */
  const topSignals = useMemo(() => {
    const counts = new Map<SignalType, number>();
    for (const t of transactions) {
      for (const sig of t.signals ?? []) {
        counts.set(sig.type, (counts.get(sig.type) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([type, count]) => ({ signal: SIGNAL_LABELS[type] ?? type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);
  }, [transactions]);
  const maxSignalCount = topSignals[0]?.count ?? 1;

  return (
    <section className="panel flex flex-col overflow-hidden" aria-label="High-risk queue">
      <div className="border-b border-line px-4 py-3">
        <SectionHeader
          eyebrow="Awaiting analyst"
          title="High-risk queue"
          right={
            <span className="num flex h-5 items-center rounded-full border border-risk-critical/30 bg-risk-critical/10 px-2 text-[11px] font-semibold text-risk-critical">
              {queue.length}
            </span>
          }
        />
      </div>
      <div className="flex-1 divide-y divide-line/60">
        {queue.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <AlertTriangle className="h-4 w-4 text-slate-600" aria-hidden />
            <p className="text-[12px] text-slate-500">No cases waiting. The engine has the board under control.</p>
          </div>
        ) : (
          queue.map((t, i) => (
            <motion.button
              key={t.id}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.06, duration: 0.3 }}
              onClick={() => openInvestigation(t.id)}
              className={cn(
                "group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2/70",
                t.riskLevel === "CRITICAL" && "bg-risk-critical/[0.03]"
              )}
              aria-label={`Investigate ${t.id}`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="num text-[12.5px] font-medium text-slate-200">{t.id}</span>
                  <RiskLevelBadge level={t.riskLevel} />
                  <SlaChip timestamp={t.timestamp} />
                </div>
                <p className="num mt-1 text-[12px] text-slate-400">
                  {formatINR(t.amount)} <span className="text-slate-600">· {t.location} · {t.paymentMethod}</span>
                </p>
              </div>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-600 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-300" aria-hidden />
            </motion.button>
          ))
        )}
      </div>
      <div className="border-t border-line px-4 py-3">
        <p className="micro text-slate-500 mb-3">Top signals · recent ledger window</p>
        {topSignals.length === 0 ? (
          <p className="text-[11.5px] text-slate-600">
            No signals recorded in the recently loaded ledger rows.
          </p>
        ) : (
          <div className="space-y-2">
            {topSignals.map((s, i) => (
              <div key={s.signal} className="flex items-center gap-3">
                <span className="w-28 shrink-0 truncate text-[11px] text-slate-400">{s.signal}</span>
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-500/10">
                  <motion.div
                    className={cn("h-full rounded-full", i === 0 ? "bg-risk-critical/70" : i === 1 ? "bg-risk-high/60" : "bg-risk-medium/50")}
                    initial={{ width: 0 }}
                    animate={{ width: `${(s.count / maxSignalCount) * 100}%` }}
                    transition={{ duration: 0.8, delay: 0.2 + i * 0.1, ease: [0.22, 1, 0.36, 1] }}
                  />
                </div>
                <span className="num w-8 text-right text-[11px] text-slate-500">{s.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* View                                                                */
/* ------------------------------------------------------------------ */

export function OverviewView() {
  const connection = useAppStore((s) => s.connection);
  const navigate = useAppStore((s) => s.navigate);
  const { data, isLoading, isError, refetch } = useRiskMetrics();
  const { seed } = useDemoControls();

  const handleSeed = async () => {
    await seed.mutateAsync();
    await refetch();
  };

  const empty = data?.raw.empty === true;
  const metricCards = data?.metricCards ?? [];

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-6 lg:px-6">
      {/* Command center header */}
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1.5 flex items-center gap-2">
            <StatusDot tone="green" pulse />
            <p className="micro text-slate-500">Risk command center</p>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-50 sm:text-2xl">
            Monitor, investigate and resolve payment risk in real time
          </h1>
          <p className="mt-1 text-[13px] text-slate-500">
            Every payment is scored, evidence is correlated, and actions stay bounded and auditable.
          </p>
        </div>
        <AiStatusPill className={connection === "offline" ? "opacity-50" : ""} />
      </header>

      {/* Metrics */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Loading key risk metrics">
          {[0, 1, 2, 3].map((i) => (
            <MetricCardSkeleton key={i} index={i} />
          ))}
        </div>
      ) : isError ? (
        <section className="panel mt-1 overflow-hidden" aria-label="Metrics unavailable">
          <EmptyState
            icon={<AlertTriangle className="h-5 w-5 text-risk-medium" aria-hidden />}
            title="Risk metrics unavailable"
            body="The metrics endpoint could not be reached, so no statistics are shown rather than stale or invented numbers."
            action={
              <Button
                variant="outline"
                onClick={() => void refetch()}
                className="gap-2 border-line bg-surface-2 hover:bg-surface-3"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Retry
              </Button>
            }
          />
        </section>
      ) : empty ? (
        /* Honest empty ledger — nothing is fabricated, offer real ways forward */
        <section className="panel overflow-hidden" aria-label="Empty ledger">
          <EmptyState
            icon={<Database className="h-5 w-5 text-slate-400" aria-hidden />}
            title="The ledger is empty"
            body="No transactions are stored yet, so every statistic on this dashboard would be zero. Load the demo records (clearly labelled synthetic payments scored by the deterministic engine) or import your own CSV in Dataset Studio."
            action={
              <div className="flex flex-col items-center gap-2.5 sm:flex-row">
                <Button
                  onClick={() => void handleSeed()}
                  disabled={seed.isPending}
                  className="glow-critical gap-2 border border-risk-critical/40 bg-risk-critical/12 text-[13px] font-semibold text-risk-critical hover:bg-risk-critical/20"
                >
                  <Database className={cn("h-4 w-4", seed.isPending && "animate-pulse")} aria-hidden />
                  {seed.isPending ? "Loading demo records…" : "Load demo records"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => navigate("datastudio")}
                  className="gap-2 border-line bg-surface-1 text-[13px] font-medium text-slate-300 hover:bg-surface-2 hover:text-slate-100"
                >
                  Import CSV
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            }
          />
        </section>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Key risk metrics">
            {metricCards.map((m, i) => (
              <MetricCard
                key={m.key}
                metric={m}
                index={i}
                spark={(m as RiskMetric & { spark?: number[] }).spark}
              />
            ))}
          </div>

          {/* Feed + queue */}
          <div className="mt-5 grid gap-4 xl:grid-cols-[1fr_360px]">
            <LiveFeed />
            <HighRiskQueue />
          </div>
        </>
      )}
    </div>
  );
}
