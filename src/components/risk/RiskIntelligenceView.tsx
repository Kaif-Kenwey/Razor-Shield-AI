"use client";

/**
 * RISK INTELLIGENCE — pattern analytics across the scored payment stream.
 *
 * Six Recharts panels + the top-signals list, all driven by the chart datasets
 * in @/data/mockData (RISK_DISTRIBUTION, SCORE_HISTOGRAM, TRANSACTIONS_BY_HOUR,
 * RISK_BY_LOCATION, RISK_BY_PAYMENT_METHOD, TOP_RISK_SIGNALS, VELOCITY_TREND).
 * No data values are hardcoded here — swap the data source in services/api.ts
 * and this view keeps working unchanged.
 */

import type { CSSProperties, ReactNode } from "react";
import { motion } from "framer-motion";
import { Database } from "lucide-react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { StatusDot } from "@/components/shared/StatusDot";
import {
  RISK_BY_LOCATION,
  RISK_BY_PAYMENT_METHOD,
  RISK_DISTRIBUTION,
  SCORE_HISTOGRAM,
  TOP_RISK_SIGNALS,
  TRANSACTIONS_BY_HOUR,
  VELOCITY_TREND,
} from "@/data/mockData";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Presentation palette (matches the token system, no indigo/blue)     */
/* ------------------------------------------------------------------ */

const INTEL = "#a78bfa";
const INTEL_AREA_FILL = "rgba(167,139,250,0.15)";
const INTEL_BAR = "rgba(167,139,250,0.7)";
const CRITICAL = "#f87171";
const HIGH = "#fb7185";
const MEDIUM = "#fbbf24";
const LOW = "#34d399";
const SLATE_TOTAL = "rgba(148,163,184,0.35)";
const SLATE_TOTAL_SOFT = "rgba(148,163,184,0.4)";
const GRID_STROKE = "rgba(148,163,184,0.07)";
const AXIS_TICK = { fill: "#64748b", fontSize: 10 };

const TOOLTIP_BASE: {
  contentStyle: CSSProperties;
  itemStyle: CSSProperties;
  labelStyle: CSSProperties;
} = {
  contentStyle: {
    background: "#0d1219",
    border: "1px solid rgba(148,163,184,0.15)",
    borderRadius: 6,
    fontSize: 11.5,
    color: "#e7ecf4",
  },
  itemStyle: { color: "#8b95a9" },
  labelStyle: {
    color: "#94a3b8",
    fontSize: 10.5,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
};

/* ------------------------------------------------------------------ */
/* Derived stats — computed from the dataset, never hardcoded          */
/* ------------------------------------------------------------------ */

const RISK_TOTAL = RISK_DISTRIBUTION.reduce((sum, row) => sum + row.count, 0);
const LOW_SHARE = ((RISK_DISTRIBUTION[0].count / RISK_TOTAL) * 100).toFixed(1);
const HISTOGRAM_PEAK = SCORE_HISTOGRAM.reduce((peak, row) => (row.count > peak.count ? row : peak));
const HOUR_PEAK = TRANSACTIONS_BY_HOUR.reduce((peak, row) =>
  row.transactions > peak.transactions ? row : peak
);
const LOCATION_HIGH = RISK_BY_LOCATION.reduce((sum, row) => sum + row.high, 0);
const TOP_PAYMENT = RISK_BY_PAYMENT_METHOD.reduce((top, row) => (row.total > top.total ? row : top));
const VELOCITY_AVG = Math.round(
  VELOCITY_TREND.reduce((sum, point) => sum + point.rate, 0) / VELOCITY_TREND.length
);
const SIGNALS_TOTAL = TOP_RISK_SIGNALS.reduce((sum, row) => sum + row.count, 0);
const SIGNAL_MAX = TOP_RISK_SIGNALS.reduce((max, row) => Math.max(max, row.count), 0);

/** Histogram bar color by score band: 80+ critical red, 60–80 rose, else intel violet. */
function scoreFill(bucket: string): string {
  const start = Number.parseInt(bucket, 10);
  if (start >= 80) return CRITICAL;
  if (start >= 60) return HIGH;
  return INTEL_BAR;
}

/* ------------------------------------------------------------------ */
/* Shared pieces                                                       */
/* ------------------------------------------------------------------ */

function ChartCard({
  title,
  stat,
  index,
  span = false,
  ariaLabel,
  children,
}: {
  title: string;
  stat?: string;
  index: number;
  span?: boolean;
  ariaLabel: string;
  children: ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.35 }}
      className={cn("panel flex flex-col overflow-hidden", span && "lg:col-span-2")}
      aria-label={ariaLabel}
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 className="micro-11 font-semibold text-slate-200">{title}</h2>
        {stat != null && <span className="num shrink-0 text-[11px] text-slate-500">{stat}</span>}
      </div>
      <div className="flex flex-1 flex-col justify-center px-4 py-4">{children}</div>
    </motion.section>
  );
}

function MiniLegend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1" aria-hidden>
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5 text-[10.5px] text-slate-500">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cards                                                               */
/* ------------------------------------------------------------------ */

function RiskDistributionCard({ index }: { index: number }) {
  return (
    <ChartCard
      title="Risk level distribution"
      stat={`${LOW_SHARE}% low`}
      index={index}
      ariaLabel="Risk level distribution donut chart"
    >
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:justify-center sm:gap-10">
        <div className="relative h-[220px] w-[220px] shrink-0">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={RISK_DISTRIBUTION}
                dataKey="count"
                nameKey="level"
                innerRadius={55}
                outerRadius={80}
                paddingAngle={2}
                stroke="rgba(10,14,21,0.9)"
                strokeWidth={2}
              >
                {RISK_DISTRIBUTION.map((row) => (
                  <Cell key={row.level} fill={row.tone} />
                ))}
              </Pie>
              <Tooltip {...TOOLTIP_BASE} cursor={false} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="num text-[20px] font-semibold tracking-tight text-slate-100">
              {formatNumber(RISK_TOTAL)}
            </span>
            <span className="micro mt-0.5 text-slate-500">scored</span>
          </div>
        </div>
        <ul className="w-full max-w-[190px] space-y-2.5">
          {RISK_DISTRIBUTION.map((row) => (
            <li key={row.level} className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: row.tone }} />
              <span className="text-[12px] text-slate-400">{row.level}</span>
              <span className="num ml-auto text-[11.5px] text-slate-500">{formatNumber(row.count)}</span>
            </li>
          ))}
        </ul>
      </div>
    </ChartCard>
  );
}

function ScoreHistogramCard({ index }: { index: number }) {
  return (
    <ChartCard
      title="Risk score distribution"
      stat={`peak ${formatNumber(HISTOGRAM_PEAK.count)}`}
      index={index}
      ariaLabel="Risk score distribution histogram"
    >
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={SCORE_HISTOGRAM} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_STROKE} vertical={false} />
          <XAxis dataKey="bucket" tick={AXIS_TICK} axisLine={false} tickLine={false} tickMargin={8} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={34} />
          <Tooltip {...TOOLTIP_BASE} cursor={{ fill: "rgba(148,163,184,0.06)" }} />
          <Bar dataKey="count" name="Transactions" radius={[2, 2, 0, 0]} maxBarSize={26}>
            {SCORE_HISTOGRAM.map((row) => (
              <Cell key={row.bucket} fill={scoreFill(row.bucket)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/**
 * AreaChart semantics via ComposedChart — recharts' AreaChart only accepts
 * Area children, so Area + Line pairings must live in a ComposedChart.
 */
function TransactionsByHourCard({ index }: { index: number }) {
  return (
    <ChartCard
      title="Transactions by hour"
      stat={`peak ${HOUR_PEAK.hour}`}
      index={index}
      span
      ariaLabel="Transactions by hour with high-risk overlay"
    >
      <MiniLegend
        items={[
          { label: "Transactions", color: INTEL },
          { label: "High-risk", color: CRITICAL },
        ]}
      />
      <ResponsiveContainer width="100%" height={250}>
        <ComposedChart data={TRANSACTIONS_BY_HOUR} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_STROKE} vertical={false} />
          <XAxis
            dataKey="hour"
            interval={2}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            tickMargin={8}
          />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={36} />
          <Tooltip {...TOOLTIP_BASE} cursor={{ fill: "rgba(148,163,184,0.06)" }} />
          <Area
            type="monotone"
            dataKey="transactions"
            name="Transactions"
            stroke={INTEL}
            strokeWidth={1.5}
            fill={INTEL_AREA_FILL}
          />
          <Line
            type="monotone"
            dataKey="highRisk"
            name="High-risk"
            stroke={CRITICAL}
            strokeWidth={1.5}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function RiskByLocationCard({ index }: { index: number }) {
  return (
    <ChartCard
      title="Risk by location"
      stat={`${formatNumber(LOCATION_HIGH)} high-risk`}
      index={index}
      ariaLabel="Risk by location bar chart"
    >
      <MiniLegend
        items={[
          { label: "Total", color: SLATE_TOTAL },
          { label: "High-risk", color: CRITICAL },
        ]}
      />
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={RISK_BY_LOCATION} layout="vertical" barGap={2} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_STROKE} vertical={false} />
          <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <YAxis
            type="category"
            dataKey="city"
            width={80}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip {...TOOLTIP_BASE} cursor={{ fill: "rgba(148,163,184,0.06)" }} />
          <Bar dataKey="total" name="Total" fill={SLATE_TOTAL} barSize={6} radius={[0, 2, 2, 0]} />
          <Bar dataKey="high" name="High-risk" fill={CRITICAL} barSize={6} radius={[0, 2, 2, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function RiskByPaymentMethodCard({ index }: { index: number }) {
  return (
    <ChartCard
      title="Risk by payment method"
      stat={`top · ${TOP_PAYMENT.method}`}
      index={index}
      ariaLabel="Risk by payment method bar chart"
    >
      <MiniLegend
        items={[
          { label: "Total", color: SLATE_TOTAL_SOFT },
          { label: "High-risk", color: MEDIUM },
        ]}
      />
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={RISK_BY_PAYMENT_METHOD} barGap={3} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_STROKE} vertical={false} />
          <XAxis dataKey="method" tick={AXIS_TICK} axisLine={false} tickLine={false} tickMargin={8} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={36} />
          <Tooltip {...TOOLTIP_BASE} cursor={{ fill: "rgba(148,163,184,0.06)" }} />
          <Bar dataKey="total" name="Total" fill={SLATE_TOTAL_SOFT} radius={[2, 2, 0, 0]} maxBarSize={26} />
          <Bar dataKey="high" name="High-risk" fill={MEDIUM} radius={[2, 2, 0, 0]} maxBarSize={26} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function VelocityCard({ index }: { index: number }) {
  return (
    <ChartCard
      title="Transaction velocity"
      stat={`avg ${VELOCITY_AVG}/min`}
      index={index}
      ariaLabel="Transaction velocity trend line chart"
    >
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={VELOCITY_TREND} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_STROKE} vertical={false} />
          <XAxis
            dataKey="t"
            interval={1}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            tickMargin={8}
          />
          <YAxis
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            width={30}
            domain={["dataMin - 20", "dataMax + 20"]}
          />
          <Tooltip {...TOOLTIP_BASE} cursor={{ stroke: "rgba(148,163,184,0.25)", strokeWidth: 1 }} />
          <ReferenceLine
            y={VELOCITY_AVG}
            stroke="rgba(52,211,153,0.35)"
            strokeDasharray="4 4"
            label={{
              value: `avg ${VELOCITY_AVG}`,
              fill: "#64748b",
              fontSize: 9.5,
              position: "insideTopRight",
            }}
          />
          <Line
            type="monotone"
            dataKey="rate"
            name="Velocity"
            stroke={LOW}
            strokeWidth={1.5}
            dot={{ r: 2, fill: LOW, strokeWidth: 0 }}
            activeDot={{ r: 3 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/** Weighted signal bars — same visual pattern as the HighRiskQueue signal list. */
function TopSignalsCard({ index }: { index: number }) {
  return (
    <ChartCard
      title="Top risk signals"
      stat={`${formatNumber(SIGNALS_TOTAL)} events`}
      index={index}
      ariaLabel="Top risk signals ranked list"
    >
      <div className="flex flex-col gap-3">
        {TOP_RISK_SIGNALS.map((row, i) => (
          <div key={row.signal} className="flex items-center gap-3">
            <span className="w-32 shrink-0 truncate text-[11px] text-slate-400">{row.signal}</span>
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-500/10">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-risk-critical/70 to-transparent"
                initial={{ width: 0 }}
                animate={{ width: `${(row.count / SIGNAL_MAX) * 100}%` }}
                transition={{ duration: 0.8, delay: 0.2 + i * 0.1, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
            <span className="num w-10 text-right text-[11px] text-slate-500">{formatNumber(row.count)}</span>
          </div>
        ))}
      </div>
    </ChartCard>
  );
}

/* ------------------------------------------------------------------ */
/* View                                                                */
/* ------------------------------------------------------------------ */

export function RiskIntelligenceView() {
  return (
    <div className="mx-auto max-w-[1500px] px-4 py-6 lg:px-6">
      {/* Page header */}
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1.5 flex items-center gap-2">
            <StatusDot tone="violet" pulse />
            <p className="micro text-slate-500">Pattern intelligence</p>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-50 sm:text-2xl">
            Risk intelligence
          </h1>
          <p className="mt-1 max-w-2xl text-[13px] text-slate-500">
            Cross-transaction patterns from the risk engine — distributions, geography, instruments
            and signal frequency.
          </p>
        </div>
        <span className="num flex items-center gap-2 rounded-full border border-line bg-surface-1 px-3 py-1.5 text-[11px] text-slate-400">
          <Database className="h-3 w-3 text-intel" aria-hidden />
          Demo dataset · {formatNumber(RISK_TOTAL)} transactions
        </span>
      </header>

      {/* Pattern grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-label="Risk intelligence pattern charts">
        <RiskDistributionCard index={0} />
        <ScoreHistogramCard index={1} />
        <TransactionsByHourCard index={2} />
        <RiskByLocationCard index={3} />
        <RiskByPaymentMethodCard index={4} />
        <VelocityCard index={5} />
        <TopSignalsCard index={6} />
      </div>

      <p className="mt-5 text-[11px] text-slate-600">
        Demo dataset for Buildathon presentation — swap in backend metrics via services/api.ts
        without UI changes.
      </p>
    </div>
  );
}
