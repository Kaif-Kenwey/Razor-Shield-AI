"use client";

/**
 * RISK SIGNALS — evidence cards. Each card states the signal, its severity,
 * the concrete evidence, and its weighted impact on the composite score.
 */

import { motion } from "framer-motion";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowLeftRight,
  Clock,
  DollarSign,
  Globe2,
  Info,
  MapPin,
  Scissors,
  Smartphone,
  Store,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { SignalSeverity, SignalType } from "@/types";

const SEVERITY_STYLE: Record<SignalSeverity, { chip: string; bar: string; label: string }> = {
  LOW: { chip: "border-slate-500/30 bg-slate-500/10 text-slate-300", bar: "bg-slate-400", label: "LOW" },
  MEDIUM: { chip: "border-risk-medium/30 bg-risk-medium/8 text-risk-medium", bar: "bg-risk-medium", label: "MEDIUM" },
  HIGH: { chip: "border-risk-high/35 bg-risk-high/10 text-risk-high", bar: "bg-risk-high", label: "HIGH" },
  CRITICAL: { chip: "border-risk-critical/40 bg-risk-critical/10 text-risk-critical", bar: "bg-risk-critical", label: "CRITICAL" },
};

const TYPE_ICON: Record<SignalType, LucideIcon> = {
  NEW_DEVICE: Smartphone,
  UNUSUAL_AMOUNT: DollarSign,
  LOCATION_ANOMALY: MapPin,
  VELOCITY_SPIKE: AlertOctagon,
  IMPOSSIBLE_TRAVEL: Globe2,
  HIGH_VALUE: DollarSign,
  MERCHANT_RISK: Store,
  TIME_ANOMALY: Clock,
  METHOD_MISMATCH: ArrowLeftRight,
  STRUCTURING: Scissors,
};

export function SignalCard({
  signal,
  index,
  maxImpact,
}: {
  signal: {
    id: string;
    type: SignalType;
    title: string;
    evidence: string;
    severity: SignalSeverity;
    impact: number;
    facts: { label: string; value: string }[];
  };
  index: number;
  maxImpact: number;
}) {
  const Icon = TYPE_ICON[signal.type] ?? AlertTriangle;
  const sev = SEVERITY_STYLE[signal.severity];

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.12 * index, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "group relative overflow-hidden rounded-sm border bg-surface-1 p-4 transition-colors",
        signal.severity === "CRITICAL"
          ? "border-risk-critical/25 hover:border-risk-critical/45"
          : signal.severity === "HIGH"
            ? "border-risk-high/20 hover:border-risk-high/40"
            : "border-line hover:border-line-strong"
      )}
      aria-label={`Risk signal: ${signal.title}, severity ${signal.severity}`}
    >
      <span className={cn("absolute left-0 top-0 h-full w-0.5", sev.bar)} aria-hidden />

      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className={cn("flex h-7 w-7 items-center justify-center rounded-sm border", sev.chip)}>
            <Icon className="h-3.5 w-3.5" aria-hidden />
          </span>
          <div>
            <h3 className="text-[13px] font-semibold tracking-tight text-slate-100">⚠ {signal.title}</h3>
            <p className="mt-0.5 text-[11.5px] leading-snug text-slate-400">{signal.evidence}</p>
          </div>
        </div>
        <span className={cn("shrink-0 rounded-sm border px-1.5 py-0.5 micro-11", sev.chip)}>
          {sev.label}
        </span>
      </div>

      <dl className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-line/70 pt-3">
        {signal.facts.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="text-[10px] uppercase tracking-wider text-slate-600">{f.label}</dt>
            <dd className="num truncate text-[11.5px] text-slate-300">{f.value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-3 flex items-center gap-2">
        <p className="micro text-slate-500">Impact on risk</p>
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} className="text-slate-600 hover:text-slate-400">
              <Info className="h-2.5 w-2.5" aria-hidden />
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-[10.5px]">
            Approximate points contributed to the composite risk score
          </TooltipContent>
        </Tooltip>
        <div className="ml-auto flex w-28 items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-500/12">
            <motion.div
              className={cn("h-full rounded-full", sev.bar)}
              initial={{ width: 0 }}
              animate={{ width: `${(signal.impact / Math.max(maxImpact, 1)) * 100}%` }}
              transition={{ duration: 0.7, delay: 0.2 + 0.12 * index, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
          <span className="num text-[11px] font-semibold text-slate-300">+{signal.impact}</span>
        </div>
      </div>
    </motion.article>
  );
}

export function RiskSignals({
  signals,
  analyzing,
}: {
  signals: { id: string; type: SignalType; title: string; evidence: string; severity: SignalSeverity; impact: number; facts: { label: string; value: string }[] }[];
  analyzing: boolean;
}) {
  const maxImpact = Math.max(...signals.map((s) => s.impact), 1);

  return (
    <section aria-label="Risk signals">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="micro-11 font-semibold text-slate-200">Risk signals</h2>
        <span className="num text-[11px] text-slate-500">
          {signals.length} independent {signals.length === 1 ? "signal" : "signals"}
        </span>
      </div>
      {analyzing ? (
        signals.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2" aria-label="Correlating signals">
            {[0, 1, 2, 3].slice(0, Math.max(signals.length, 2)).map((i) => (
              <div key={i} className="h-40 animate-pulse rounded-sm border border-line bg-surface-1" style={{ animationDelay: `${i * 120}ms` }} />
            ))}
          </div>
        ) : (
          <div className="panel px-4 py-8 text-center">
            <p className="text-[12.5px] text-slate-500">Correlating customer, device and location evidence…</p>
          </div>
        )
      ) : signals.length === 0 ? (
        <div className="panel px-4 py-8 text-center">
          <p className="text-[12.5px] text-risk-low">✓ No independent risk signals fired for this transaction.</p>
          <p className="mt-1 text-[11.5px] text-slate-500">The payment is consistent with the customer's established pattern.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {signals.map((s, i) => (
            <SignalCard key={s.id} signal={s} index={i} maxImpact={maxImpact} />
          ))}
        </div>
      )}
    </section>
  );
}
