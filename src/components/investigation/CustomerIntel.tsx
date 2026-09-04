"use client";

/**
 * CUSTOMER INTELLIGENCE — who is behind the transaction, and does this
 * payment fit their story? Includes a compact history chart.
 */

import { motion } from "framer-motion";
import { AlertTriangle, ArrowUpRight, Check, Gauge, MapPin, MonitorSmartphone, X } from "lucide-react";
import { SectionHeader } from "@/components/shared/States";
import { formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Customer, Transaction } from "@/types";

function HistoryChart({ customer }: { customer: Customer }) {
  const w = 100;
  const h = 34;
  const pts = customer.history;
  const max = Math.max(...pts.map((p) => p.amount), 1);
  const step = pts.length > 1 ? w / (pts.length - 1) : w;
  const path = pts.map((p, i) => `${i * step},${h - (p.amount / max) * (h - 6) - 3}`).join(" ");
  const flaggedIdx = pts.findIndex((p) => p.flagged);

  return (
    <div className="relative" role="img" aria-label="Customer transaction history chart, latest transaction flagged">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-16 w-full">
        <defs>
          <linearGradient id="cust-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(167,139,250,0.28)" />
            <stop offset="100%" stopColor="rgba(167,139,250,0.02)" />
          </linearGradient>
        </defs>
        <polygon points={`0,${h} ${path} ${w},${h}`} fill="url(#cust-fill)" />
        <motion.polyline
          points={path}
          fill="none"
          stroke="rgba(167,139,250,0.75)"
          strokeWidth="1.4"
          strokeLinejoin="round"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.1, ease: "easeOut" }}
          vectorEffect="non-scaling-stroke"
        />
        {flaggedIdx >= 0 && (
          <circle
            cx={flaggedIdx * step}
            cy={h - (pts[flaggedIdx].amount / max) * (h - 6) - 3}
            r="2.4"
            fill="#f87171"
            stroke="rgba(248,113,113,0.35)"
            strokeWidth="3"
          />
        )}
      </svg>
      <div className="mt-1 flex justify-between text-[9.5px] text-slate-600">
        <span>{pts[0]?.label}</span>
        <span>Latest: {formatINR(pts[pts.length - 1]?.amount ?? 0)}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Baseline comparison — this payment vs the customer's story          */
/* ------------------------------------------------------------------ */

type BaselineTone = "match" | "mismatch" | "outlier";

const TONE_STYLE: Record<BaselineTone, { icon: typeof Check; cls: string; label: string }> = {
  match: { icon: Check, cls: "text-risk-low border-risk-low/30 bg-risk-low/10", label: "In line" },
  mismatch: { icon: X, cls: "text-risk-medium border-risk-medium/40 bg-risk-medium/10", label: "Deviation" },
  outlier: { icon: AlertTriangle, cls: "text-risk-critical border-risk-critical/40 bg-risk-critical/10", label: "Outlier" },
};

function BaselineComparison({ customer, txn }: { customer: Customer; txn: Transaction }) {
  const histScores = customer.history.slice(0, -1).map((p) => p.riskScore);
  const avgHist = histScores.length
    ? Math.round(histScores.reduce((a, b) => a + b, 0) / histScores.length)
    : 0;
  const amountRatio = txn.amount / Math.max(customer.avgTransaction, 1);
  const riskDelta = txn.riskScore - avgHist;

  const rows: {
    icon: typeof MapPin;
    label: string;
    baseline: string;
    current: string;
    note: string;
    tone: BaselineTone;
  }[] = [
    {
      icon: MapPin,
      label: "Location",
      baseline: customer.usualLocation,
      current: txn.location,
      note: customer.usualLocation === txn.location ? "usual" : "unusual origin",
      tone: customer.usualLocation === txn.location ? "match" : "mismatch",
    },
    {
      icon: MonitorSmartphone,
      label: "Device",
      baseline: customer.usualDevice,
      current: txn.device,
      note: customer.usualDevice === txn.device ? "recognized" : "unrecognized",
      tone: customer.usualDevice === txn.device ? "match" : "mismatch",
    },
    {
      icon: ArrowUpRight,
      label: "Amount",
      baseline: `${formatINR(customer.avgTransaction)} avg`,
      current: formatINR(txn.amount),
      note: `${amountRatio.toFixed(1)}× average`,
      tone: amountRatio > 3 ? "outlier" : amountRatio > 1.5 ? "mismatch" : "match",
    },
    {
      icon: Gauge,
      label: "Risk history",
      baseline: `${avgHist}/100 avg`,
      current: `${txn.riskScore}/100`,
      note: riskDelta > 0 ? `+${riskDelta} vs baseline` : `${riskDelta} vs baseline`,
      tone: riskDelta > 40 ? "outlier" : riskDelta > 15 ? "mismatch" : "match",
    },
  ];

  const flagged = rows.filter((r) => r.tone !== "match").length;

  return (
    <div className="mt-4 border-t border-line/70 pt-3">
      <div className="mb-2.5 flex items-center justify-between">
        <p className="micro text-slate-500">Baseline vs this transaction</p>
        <span
          className={cn(
            "rounded-sm border px-1.5 py-0.5 micro-11",
            flagged > 2
              ? "border-risk-critical/40 bg-risk-critical/10 text-risk-critical"
              : flagged > 0
                ? "border-risk-medium/35 bg-risk-medium/10 text-risk-medium"
                : "border-risk-low/30 bg-risk-low/10 text-risk-low"
          )}
        >
          {flagged > 0 ? `${flagged} deviation${flagged > 1 ? "s" : ""}` : "consistent"}
        </span>
      </div>
      <ul className="space-y-1.5" aria-label="Customer baseline comparison">
        {rows.map((r, i) => {
          const tone = TONE_STYLE[r.tone];
          return (
            <motion.li
              key={r.label}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.05 + i * 0.06, duration: 0.3 }}
              className="rounded-sm border border-line/70 bg-surface-1/60 px-2.5 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-slate-400">
                  <r.icon className="h-3 w-3 shrink-0 text-slate-600" aria-hidden />
                  {r.label}
                </span>
                <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-sm border px-1.5 py-0.5 micro-11", tone.cls)}>
                  <tone.icon className="h-2.5 w-2.5" strokeWidth={3} aria-hidden />
                  {tone.label}
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 pl-[18px] num text-[11px]">
                <span className="truncate text-slate-500" title={r.baseline}>{r.baseline}</span>
                <span className="text-slate-700" aria-hidden>→</span>
                <span className={cn("truncate font-medium", r.tone === "match" ? "text-slate-300" : "text-slate-100")} title={r.current}>{r.current}</span>
                <span className="ml-auto shrink-0 text-[10px] text-slate-600">{r.note}</span>
              </div>
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}

export function CustomerIntel({ customer, analyzing, txn }: { customer: Customer; analyzing: boolean; txn?: Transaction }) {
  const stats = [
    { label: "Account age", value: customer.accountAge },
    { label: "Avg transaction", value: formatINR(customer.avgTransaction) },
    { label: "Transactions", value: String(customer.transactionCount) },
    { label: "Previous incidents", value: String(customer.previousIncidents), alert: customer.previousIncidents > 0 },
  ];

  return (
    <section className="panel overflow-hidden" aria-label="Customer intelligence">
      <div className="border-b border-line px-4 py-3">
        <SectionHeader eyebrow="Customer" title={customer.id} />
      </div>

      <div className="px-4 py-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 text-[11px] font-semibold text-slate-300">
              {customer.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-slate-200">{customer.name}</p>
              <p className="text-[10.5px] text-slate-500">{customer.kycTier} · last seen {customer.lastSeen}</p>
            </div>
          </div>
          <span className="shrink-0 rounded-sm border border-line bg-surface-2 px-1.5 py-0.5 micro text-slate-400">
            {customer.usualLocation}
          </span>
        </div>

        {analyzing ? (
          <div className="mt-4 space-y-2" aria-label="Loading customer profile">
            <div className="h-3 w-full animate-pulse rounded bg-slate-500/10" />
            <div className="h-3 w-3/4 animate-pulse rounded bg-slate-500/8" />
            <div className="h-12 w-full animate-pulse rounded bg-slate-500/6" />
          </div>
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
              {stats.map((s) => (
                <div key={s.label}>
                  <dt className="micro text-slate-500">{s.label}</dt>
                  <dd className={cn("num mt-0.5 text-[14px] font-semibold", s.alert ? "text-risk-medium" : "text-slate-100")}>
                    {s.value}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="mt-4 grid grid-cols-2 gap-x-4 border-t border-line/70 pt-3">
              <div>
                <dt className="micro text-slate-500">Usual location</dt>
                <dd className="mt-0.5 text-[12px] text-slate-300">{customer.usualLocation}</dd>
              </div>
              <div>
                <dt className="micro text-slate-500">Usual device</dt>
                <dd className="mt-0.5 text-[12px] text-slate-300">{customer.usualDevice}</dd>
              </div>
            </div>

            <div className="mt-4 border-t border-line/70 pt-3">
              <p className="micro text-slate-500 mb-2">Transaction history</p>
              <HistoryChart customer={customer} />
            </div>

            {txn && <BaselineComparison customer={customer} txn={txn} />}
          </motion.div>
        )}
      </div>
    </section>
  );
}
