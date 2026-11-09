"use client";

/**
 * THRESHOLD LAB — decision-cost optimization for a scored, labeled run.
 *
 * Answers: "where should the operational score cutoff sit?" The analyst
 * drags the cutoff; precision/recall and the rupee cost of both mistake
 * types recompute live using the SAME cost model the engine reports.
 * The lab marks the cost-optimal cutoff and the engine's current
 * effective cutoff so the gap is visible at a glance.
 */

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SlidersHorizontal } from "lucide-react";
import { formatINR } from "@/lib/format";
import {
  engineDefaultCutoff,
  optimalThreshold,
  thresholdSweep,
  type ThresholdPoint,
} from "@/lib/threshold";
import type { ScoredRow } from "@/types/dataset";
import { cn } from "@/lib/utils";

const INTEL = "#a78bfa";
const AMBER = "#fbbf24";
const RED = "#f87171";
const GREEN = "#34d399";

const fmtShort = (n: number) =>
  n >= 1_00_000 ? `₹${(n / 1_00_000).toFixed(1)}L` : n >= 1000 ? `₹${(n / 1000).toFixed(1)}k` : `₹${n}`;

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number | string }[];
  label?: number | string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-sm border border-line bg-surface-1 px-2.5 py-2 shadow-lg">
      <p className="num micro-11 text-slate-500">cutoff {label}</p>
      {payload.map((p) => (
        <p key={p.name} className="micro-11 mt-0.5 text-slate-300">
          {p.name}: <span className="num">{typeof p.value === "number" ? Math.round(p.value * 10) / 10 : p.value}</span>
        </p>
      ))}
    </div>
  );
}

export function ThresholdLab({ rows }: { rows: ScoredRow[] }) {
  const sweep = useMemo(() => thresholdSweep(rows), [rows]);
  const optimal = useMemo(() => optimalThreshold(sweep), [sweep]);
  const engineCut = useMemo(() => engineDefaultCutoff(rows), [rows]);

  const [cutoff, setCutoff] = useState<number>(() => optimal?.threshold ?? engineCut ?? 70);
  const point: ThresholdPoint | null = useMemo(
    () => sweep.find((p) => p.threshold === cutoff) ?? null,
    [sweep, cutoff],
  );

  if (!sweep.length || !point) return null;

  const pData = sweep.map((p) => ({
    threshold: p.threshold,
    precision: Math.round(p.precision * 10) / 10,
    recall: Math.round(p.recall * 10) / 10,
    f1: Math.round(p.f1 * 10) / 10,
  }));
  const cData = sweep.map((p) => ({
    threshold: p.threshold,
    falseAlarms: p.fpCost,
    missedFraud: p.fnCost,
    total: p.totalCost,
  }));

  const savingsVsSelected = optimal ? point.totalCost - optimal.totalCost : 0;
  const isOptimal = optimal?.threshold === cutoff;

  return (
    <section className="panel p-4" aria-label="Threshold lab">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="micro-11 flex items-center gap-1.5 font-semibold text-slate-200">
          <SlidersHorizontal className="h-3.5 w-3.5 text-intel" aria-hidden />
          Threshold lab — where should the operational cutoff sit?
        </p>
        <div className="flex items-center gap-2">
          {optimal && (
            <span className="micro-11 rounded-sm border border-risk-low/30 bg-risk-low/10 px-2 py-0.5 text-risk-low">
              COST-OPTIMAL: {optimal.threshold} · {formatINR(optimal.totalCost)}
            </span>
          )}
          {engineCut !== null && (
            <span className="micro-11 rounded-sm border border-line bg-surface-1 px-2 py-0.5 text-slate-500">
              ENGINE NOW: {engineCut}+ ALERTS
            </span>
          )}
        </div>
      </div>

      {/* slider row */}
      <div className="mt-4 flex items-center gap-3">
        <span className="num micro-11 w-6 text-slate-500">5</span>
        <input
          type="range"
          min={5}
          max={95}
          step={5}
          value={cutoff}
          onChange={(e) => setCutoff(Number(e.target.value))}
          aria-label="Operational risk score cutoff"
          className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-surface-3 accent-[#a78bfa]"
        />
        <span className="num micro-11 w-6 text-right text-slate-500">95</span>
        <span
          className={cn(
            "num rounded-sm border px-2.5 py-1 text-[13px] font-semibold",
            isOptimal ? "border-risk-low/40 bg-risk-low/10 text-risk-low" : "border-intel/40 bg-intel/10 text-intel",
          )}
        >
          cutoff {cutoff}
        </span>
      </div>

      {/* live metrics at the selected cutoff */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {(
          [
            ["Precision", `${point.precision.toFixed(0)}%`, "text-slate-100"],
            ["Recall", `${point.recall.toFixed(0)}%`, "text-slate-100"],
            ["False alarms", `${point.fp}`, "text-risk-medium"],
            ["Missed fraud", `${point.fn}`, "text-risk-critical"],
            ["Est. total cost", formatINR(point.totalCost), savingsVsSelected > 0 ? "text-risk-critical" : "text-risk-low"],
          ] as const
        ).map(([label, value, tone]) => (
          <div key={label} className="rounded-sm border border-line bg-surface-2/50 px-2.5 py-2">
            <p className="micro-11 text-slate-600">{label}</p>
            <p className={cn("num mt-0.5 text-[15px] font-semibold", tone)}>{value}</p>
          </div>
        ))}
      </div>

      {savingsVsSelected > 0 && optimal && (
        <p className="micro-11 mt-2 leading-relaxed text-slate-500">
          Moving the cutoff to <span className="num text-risk-low">{optimal.threshold}</span> would cut expected cost by{" "}
          <span className="num text-risk-low">{formatINR(savingsVsSelected)}</span> at this dataset — precision{" "}
          <span className="num">{optimal.precision.toFixed(0)}%</span>, recall{" "}
          <span className="num">{optimal.recall.toFixed(0)}%</span>, review queue{" "}
          <span className="num">{optimal.reviewLoad}</span> rows.
        </p>
      )}

      {/* charts */}
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-sm border border-line bg-surface-1/50 p-3">
          <p className="micro mb-2 text-slate-500">Precision / recall vs cutoff</p>
          <ResponsiveContainer width="100%" height={190}>
            <LineChart data={pData} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
              <XAxis dataKey="threshold" tick={{ fill: "#71717a", fontSize: 10 }} stroke="#3f3f46" />
              <YAxis domain={[0, 100]} tick={{ fill: "#71717a", fontSize: 10 }} stroke="#3f3f46" />
              <ReTooltip content={<ChartTooltip />} />
              <ReferenceLine x={cutoff} stroke={INTEL} strokeDasharray="4 4" />
              {optimal && <ReferenceLine x={optimal.threshold} stroke={GREEN} strokeDasharray="2 6" />}
              <Line type="monotone" dataKey="precision" name="Precision %" stroke={AMBER} strokeWidth={1.8} dot={false} />
              <Line type="monotone" dataKey="recall" name="Recall %" stroke={INTEL} strokeWidth={1.8} dot={false} />
              <Line type="monotone" dataKey="f1" name="F1" stroke="#52525b" strokeWidth={1.2} dot={false} strokeDasharray="4 3" />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-sm border border-line bg-surface-1/50 p-3">
          <p className="micro mb-2 text-slate-500">Cost of mistakes vs cutoff (INR)</p>
          <ResponsiveContainer width="100%" height={190}>
            <AreaChart data={cData} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
              <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
              <XAxis dataKey="threshold" tick={{ fill: "#71717a", fontSize: 10 }} stroke="#3f3f46" />
              <YAxis tickFormatter={fmtShort} tick={{ fill: "#71717a", fontSize: 10 }} stroke="#3f3f46" />
              <ReTooltip content={<ChartTooltip />} />
              <ReferenceLine x={cutoff} stroke={INTEL} strokeDasharray="4 4" />
              {optimal && <ReferenceLine x={optimal.threshold} stroke={GREEN} strokeDasharray="2 6" />}
              <Area type="monotone" dataKey="missedFraud" name="Missed fraud ₹" stroke={RED} fill={RED} fillOpacity={0.12} strokeWidth={1.6} />
              <Area type="monotone" dataKey="falseAlarms" name="False alarms ₹" stroke={AMBER} fill={AMBER} fillOpacity={0.12} strokeWidth={1.6} />
              <Area type="monotone" dataKey="total" name="Total ₹" stroke={INTEL} fill={INTEL} fillOpacity={0.06} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <p className="micro-11 mt-3 leading-relaxed text-slate-600">
        A row alerts when its score ≥ cutoff. Both mistake types are priced with the same model the engine
        reports — wrongly frozen funds + ₹450 review ops per false alarm, full fraud loss per miss. The
        recommended cutoff minimizes expected total cost; the dotted green line marks it, the violet line is
        your current position. The analyst always makes the final call — this lab only prices the tradeoff.
      </p>
    </section>
  );
}
