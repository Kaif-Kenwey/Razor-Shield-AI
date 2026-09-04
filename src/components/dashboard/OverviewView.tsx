"use client";

/**
 * OVERVIEW — RISK COMMAND CENTER.
 * Answers one question: "What's happening right now?"
 */

import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { LiveFeed } from "@/components/dashboard/LiveFeed";
import { SectionHeader } from "@/components/shared/States";
import { SlaChip } from "@/components/shared/SlaChip";
import { AiStatusPill } from "@/components/ai/AiStatusPill";
import { StatusDot } from "@/components/shared/StatusDot";
import { useAppStore } from "@/store/appStore";
import { RISK_METRICS, TOP_RISK_SIGNALS } from "@/data/mockData";
import { formatINR } from "@/lib/format";
import { RiskLevelBadge } from "@/components/risk/RiskBadge";
import { cn } from "@/lib/utils";

function HighRiskQueue() {
  const transactions = useAppStore((s) => s.transactions);
  const openInvestigation = useAppStore((s) => s.openInvestigation);

  const queue = transactions
    .filter((t) => t.status === "INVESTIGATING" && (t.riskLevel === "CRITICAL" || t.riskLevel === "HIGH"))
    .slice(0, 4);

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
        <p className="micro text-slate-500 mb-3">Top signals · 24h</p>
        <div className="space-y-2">
          {TOP_RISK_SIGNALS.slice(0, 4).map((s, i) => {
            const max = TOP_RISK_SIGNALS[0].count;
            return (
              <div key={s.signal} className="flex items-center gap-3">
                <span className="w-28 shrink-0 truncate text-[11px] text-slate-400">{s.signal}</span>
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-500/10">
                  <motion.div
                    className={cn("h-full rounded-full", i === 0 ? "bg-risk-critical/70" : i === 1 ? "bg-risk-high/60" : "bg-risk-medium/50")}
                    initial={{ width: 0 }}
                    animate={{ width: `${(s.count / max) * 100}%` }}
                    transition={{ duration: 0.8, delay: 0.2 + i * 0.1, ease: [0.22, 1, 0.36, 1] }}
                  />
                </div>
                <span className="num w-8 text-right text-[11px] text-slate-500">{s.count}</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function OverviewView() {
  const connection = useAppStore((s) => s.connection);

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
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Key risk metrics">
        {RISK_METRICS.map((m, i) => (
          <MetricCard key={m.key} metric={m} index={i} />
        ))}
      </div>

      {/* Feed + queue */}
      <div className="mt-5 grid gap-4 xl:grid-cols-[1fr_360px]">
        <LiveFeed />
        <HighRiskQueue />
      </div>
    </div>
  );
}
