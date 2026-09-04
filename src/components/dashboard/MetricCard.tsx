"use client";

import { useEffect, useMemo, useState } from "react";
import { animate, motion } from "framer-motion";
import { TrendingDown, TrendingUp, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { METRIC_SPARKS } from "@/data/mockData";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { RiskMetric } from "@/types";

const TONE_ACCENT = {
  neutral: "bg-slate-400",
  low: "bg-risk-low",
  medium: "bg-risk-medium",
  high: "bg-risk-high",
  critical: "bg-risk-critical",
  intel: "bg-intel",
} as const;

const TONE_TEXT = {
  neutral: "text-slate-100",
  low: "text-risk-low",
  medium: "text-risk-medium",
  high: "text-risk-high",
  critical: "text-risk-critical",
  intel: "text-intel",
} as const;

const TONE_STROKE = {
  neutral: "rgba(148,163,184,0.55)",
  low: "rgba(52,211,153,0.7)",
  medium: "rgba(251,191,36,0.7)",
  high: "rgba(251,113,133,0.7)",
  critical: "rgba(248,113,113,0.75)",
  intel: "rgba(167,139,250,0.75)",
} as const;

/** Hand-rolled SVG sparkline — lighter than a chart library for 12 points. */
function Sparkline({ points, tone }: { points: number[]; tone: RiskMetric["tone"] }) {
  const path = useMemo(() => {
    const w = 100;
    const h = 26;
    const max = Math.max(...points, 1);
    const min = Math.min(...points);
    const span = Math.max(max - min, 1);
    const step = points.length > 1 ? w / (points.length - 1) : w;
    const coords = points.map((p, i) => [i * step, h - 3 - ((p - min) / span) * (h - 8)]);
    const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const area = `${line} L${w},${h} L0,${h} Z`;
    return { line, area };
  }, [points]);

  const uid = `spark-${tone}`;
  return (
    <svg viewBox="0 0 100 26" preserveAspectRatio="none" className="h-6 w-full" aria-hidden>
      <defs>
        <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={TONE_STROKE[tone]} stopOpacity="0.28" />
          <stop offset="100%" stopColor={TONE_STROKE[tone]} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon points={sparkAreaToPoints(path.area)} fill={`url(#${uid})`} />
      <motion.path
        d={path.line}
        fill="none"
        stroke={TONE_STROKE[tone]}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.1, delay: 0.3, ease: "easeOut" }}
      />
    </svg>
  );
}

/** Convert the "M.. L.. L.. Z" area string into a polygon points string. */
function sparkAreaToPoints(areaPath: string): string {
  return areaPath
    .replace(/^M/, "")
    .replace(/ L/g, " ")
    .replace(/Z$/, "");
}

function useCountUp(target: number, duration = 1.2) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const controls = animate(0, target, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setValue(Math.round(v)),
    });
    return () => controls.stop();
  }, [target, duration]);
  return value;
}

export function MetricCard({ metric, index = 0 }: { metric: RiskMetric; index?: number }) {
  const value = useCountUp(metric.value);
  const up = (metric.delta ?? 0) >= 0;
  const spark = METRIC_SPARKS[metric.key];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.07, ease: "easeOut" }}
      className="panel group relative overflow-hidden p-4"
    >
      <span className={cn("absolute left-0 top-0 h-full w-0.5", TONE_ACCENT[metric.tone])} />
      <div className="flex items-center justify-between">
        <p className="micro text-slate-500">{metric.label}</p>
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} className="text-slate-600 transition-colors hover:text-slate-400">
              <Info className="h-3 w-3" aria-hidden />
              <span className="sr-only">{metric.hint}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-52 text-[11px] leading-snug">
            {metric.hint}
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="mt-2.5 flex items-end justify-between gap-3">
        <p className={cn("num text-[30px] font-semibold leading-none tracking-tight", TONE_TEXT[metric.tone])}>
          {formatNumber(value)}
        </p>
        {spark && (
          <div className="w-24 shrink-0 opacity-80 transition-opacity group-hover:opacity-100">
            <Sparkline points={spark} tone={metric.tone} />
            <p className="micro mt-0.5 text-right text-[8.5px] text-slate-600">24h trend</p>
          </div>
        )}
      </div>
      {metric.delta !== undefined && (
        <p className="mt-2.5 flex items-center gap-1 text-[11px] text-slate-500">
          {up ? (
            <TrendingUp className={cn("h-3 w-3", metric.tone === "critical" || metric.tone === "high" ? "text-risk-critical" : "text-risk-low")} aria-hidden />
          ) : (
            <TrendingDown className="h-3 w-3 text-risk-low" aria-hidden />
          )}
          <span className={cn("num font-medium", up && (metric.tone === "critical" || metric.tone === "high") ? "text-risk-critical/90" : "text-slate-400")}>
            {up ? "+" : ""}
            {metric.delta}%
          </span>
          {metric.deltaLabel}
        </p>
      )}
    </motion.div>
  );
}
