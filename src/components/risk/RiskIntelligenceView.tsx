"use client";

/**
 * RISK INTELLIGENCE — pattern analytics across the scored payment stream.
 *
 * Data sources, honestly separated:
 *  - Portfolio-wide panels (risk distribution, 24h volume, payment methods,
 *    flagged merchants) come from GET /api/risk/metrics via useRiskMetrics().
 *  - Panels tagged "recent ledger window" (score histogram, locations, top
 *    signals) are derived client-side from the recently loaded rows in the
 *    app store — they are a recent window, never presented as portfolio-wide.
 *
 * When the ledger is empty the view says so instead of rendering zeros.
 */

import { useMemo, type CSSProperties, type ReactNode } from "react";
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
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/shared/StatusDot";
import { EmptyState, PanelSkeleton } from "@/components/shared/States";
import { useDemoControls, useRiskMetrics } from "@/hooks/useLedger";
import { useAppStore } from "@/store/appStore";
import { formatINRCompact, formatNumber } from "@/lib/format";
import type { SignalType } from "@/types";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Presentation palette (matches the token system, no indigo/blue)     */
/* ------------------------------------------------------------------ */

const INTEL = "#a78bfa";
const INTEL_AREA_FILL = "rgba(167,139,250,0.15)";
const CRITICAL = "#f87171";
const HIGH = "#fb7185";
const MEDIUM = "#fbbf24";
const LOW = "#34d399";
const SLATE_TOTAL = "rgba(148,163,184,0.35)";
const SLATE_TOTAL_SOFT = "rgba(148,163,184,0.4)";
const GRID_STROKE = "rgba(148,163,184,0.07)";
const AXIS_TICK = { fill: "#64748b", fontSize: 10 };

/** Server levels ("LOW"…"CRITICAL") → display name + token colour. */
const LEVEL_TONES: Record<string, string> = {
  LOW: LOW,
  MEDIUM: MEDIUM,
  HIGH: HIGH,
  CRITICAL: CRITICAL,
};
const LEVEL_DISPLAY: Record<string, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};

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

/** Local display labels for engine signal types (mirrors the engine's map). */
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

/** Histogram bar color by score band: 80+ critical red, 60–80 rose, else intel violet. */
function scoreFill(bucket: string): string {
  const start = Number.parseInt(bucket, 10);
  if (start >= 80) return CRITICAL;
  if (start >= 60) return HIGH;
  return "rgba(167,139,250,0.7)";
}

/* ------------------------------------------------------------------ */
/* Shared pieces                                                       */
/* ------------------------------------------------------------------ */

function ChartCard({
  title,
  stat,
  tag,
  index,
  span = false,
  ariaLabel,
  children,
}: {
  title: string;
  stat?: string;
  /** Honest-scope marker, e.g. "recent ledger window". */
  tag?: string;
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
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="micro-11 font-semibold text-slate-200">{title}</h2>
          {tag && (
            <span className="micro-11 shrink-0 rounded-sm border border-intel/25 bg-intel/8 px-1.5 py-0.5 text-intel/80">
              {tag}
            </span>
          )}
        </div>
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

/** Honest empty note inside a chart panel — no fabricated chart axes. */
function PanelEmptyNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-[200px] items-center justify-center px-6 text-center">
      <p className="max-w-xs text-[12px] leading-relaxed text-slate-500">{children}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cards — portfolio-wide (from /api/risk/metrics)                     */
/* ------------------------------------------------------------------ */

function RiskDistributionCard({
  distribution,
  total,
  index,
}: {
  distribution: { level: string; count: number; tone: string }[];
  total: number;
  index: number;
}) {
  const lowShare = total > 0 ? ((distribution[0]?.count ?? 0) / total) * 100 : null;
  return (
    <ChartCard
      title="Risk level distribution"
      stat={lowShare != null ? `${lowShare.toFixed(1)}% low` : undefined}
      index={index}
      ariaLabel="Risk level distribution donut chart"
    >
      {total === 0 ? (
        <PanelEmptyNote>
          No transactions are stored yet, so there is no risk distribution to show.
        </PanelEmptyNote>
      ) : (
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:justify-center sm:gap-10">
          <div className="relative h-[220px] w-[220px] shrink-0">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={distribution}
                  dataKey="count"
                  nameKey="level"
                  innerRadius={55}
                  outerRadius={80}
                  paddingAngle={2}
                  stroke="rgba(10,14,21,0.9)"
                  strokeWidth={2}
                >
                  {distribution.map((row) => (
                    <Cell key={row.level} fill={row.tone} />
                  ))}
                </Pie>
                <Tooltip {...TOOLTIP_BASE} cursor={false} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="num text-[20px] font-semibold tracking-tight text-slate-100">
                {formatNumber(total)}
              </span>
              <span className="micro mt-0.5 text-slate-500">scored</span>
            </div>
          </div>
          <ul className="w-full max-w-[190px] space-y-2.5">
            {distribution.map((row) => (
              <li key={row.level} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: row.tone }} />
                <span className="text-[12px] text-slate-400">{row.level}</span>
                <span className="num ml-auto text-[11.5px] text-slate-500">{formatNumber(row.count)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ChartCard>
  );
}

function VolumeCard({
  volume,
  index,
}: {
  volume: { label: string; count: number; flagged: number }[];
  index: number;
}) {
  const peak = volume.reduce((p, row) => (row.count > p.count ? row : p), volume[0] ?? { label: "—", count: 0, flagged: 0 });
  return (
    <ChartCard
      title="Volume · last 24h"
      stat={`2h buckets · peak ${peak.label}`}
      index={index}
      span
      ariaLabel="Ledger volume over the last 24 hours in 2-hour buckets"
    >
      <MiniLegend
        items={[
          { label: "Transactions", color: INTEL },
          { label: "High-risk", color: CRITICAL },
        ]}
      />
      <ResponsiveContainer width="100%" height={250}>
        <ComposedChart data={volume} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_STROKE} vertical={false} />
          <XAxis
            dataKey="label"
            interval={1}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            tickMargin={8}
          />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={36} allowDecimals={false} />
          <Tooltip {...TOOLTIP_BASE} cursor={{ fill: "rgba(148,163,184,0.06)" }} />
          <Area
            type="monotone"
            dataKey="count"
            name="Transactions"
            stroke={INTEL}
            strokeWidth={1.5}
            fill={INTEL_AREA_FILL}
          />
          <Line
            type="monotone"
            dataKey="flagged"
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

function RiskByPaymentMethodCard({
  paymentData,
  index,
}: {
  paymentData: { method: string; count: number }[];
  index: number;
}) {
  const top = paymentData.reduce((t, row) => (row.count > t.count ? row : t), paymentData[0]);
  return (
    <ChartCard
      title="Risk by payment method"
      stat={top ? `top · ${top.method}` : undefined}
      index={index}
      ariaLabel="Transactions by payment method bar chart"
    >
      {paymentData.length === 0 ? (
        <PanelEmptyNote>No payment methods in the ledger yet.</PanelEmptyNote>
      ) : (
        <>
          <MiniLegend items={[{ label: "Transactions", color: SLATE_TOTAL_SOFT }]} />
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={paymentData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={GRID_STROKE} vertical={false} />
              <XAxis dataKey="method" tick={AXIS_TICK} axisLine={false} tickLine={false} tickMargin={8} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={36} allowDecimals={false} />
              <Tooltip {...TOOLTIP_BASE} cursor={{ fill: "rgba(148,163,184,0.06)" }} />
              <Bar dataKey="count" name="Transactions" fill={SLATE_TOTAL_SOFT} radius={[2, 2, 0, 0]} maxBarSize={26} />
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
    </ChartCard>
  );
}

function TopMerchantsCard({
  merchants,
  index,
}: {
  merchants: { merchant: string; flaggedCount: number; value: number; avgRiskScore: number }[];
  index: number;
}) {
  return (
    <ChartCard
      title="Top flagged merchants"
      stat={merchants[0] ? `top · ${merchants[0].merchant}` : undefined}
      index={index}
      ariaLabel="Most-flagged merchants ranked bar chart"
    >
      {merchants.length === 0 ? (
        <PanelEmptyNote>
          No merchant has been flagged HIGH or CRITICAL in the ledger yet.
        </PanelEmptyNote>
      ) : (
        <>
          <MiniLegend items={[{ label: "Flagged rows (HIGH + CRITICAL)", color: CRITICAL }]} />
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={merchants} layout="vertical" barGap={2} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={GRID_STROKE} vertical={false} />
              <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="merchant"
                width={110}
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip {...TOOLTIP_BASE} cursor={{ fill: "rgba(148,163,184,0.06)" }} />
              <Bar dataKey="flaggedCount" name="Flagged rows" fill={CRITICAL} barSize={8} radius={[0, 2, 2, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
    </ChartCard>
  );
}

function ValueFlowCard({
  volume,
  index,
}: {
  volume: { label: string; value: number }[];
  index: number;
}) {
  const avg = volume.length > 0 ? Math.round(volume.reduce((s, b) => s + b.value, 0) / volume.length) : 0;
  return (
    <ChartCard
      title="Value flow (₹) · last 24h"
      stat={`avg ${formatINRCompact(avg)} / 2h`}
      index={index}
      ariaLabel="Rupee value of payments per 2-hour bucket"
    >
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={volume} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID_STROKE} vertical={false} />
          <XAxis
            dataKey="label"
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
            width={52}
            tickFormatter={(v: number) => formatINRCompact(v)}
          />
          <Tooltip
            {...TOOLTIP_BASE}
            cursor={{ stroke: "rgba(148,163,184,0.25)", strokeWidth: 1 }}
            formatter={(v) => formatINRCompact(Number(v))}
          />
          <ReferenceLine
            y={avg}
            stroke="rgba(52,211,153,0.35)"
            strokeDasharray="4 4"
            label={{
              value: `avg ${formatINRCompact(avg)}`,
              fill: "#64748b",
              fontSize: 9.5,
              position: "insideTopRight",
            }}
          />
          <Line
            type="monotone"
            dataKey="value"
            name="Payment value"
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

/* ------------------------------------------------------------------ */
/* Cards — recent ledger window (derived from the store's loaded rows) */
/* ------------------------------------------------------------------ */

function ScoreHistogramCard({
  histogram,
  hasRows,
  index,
}: {
  histogram: { bucket: string; count: number }[];
  hasRows: boolean;
  index: number;
}) {
  const peak = histogram.reduce((p, row) => (row.count > p.count ? row : p), histogram[0]);
  return (
    <ChartCard
      title="Risk score distribution"
      tag="recent ledger window"
      stat={hasRows ? `peak ${formatNumber(peak.count)}` : undefined}
      index={index}
      ariaLabel="Risk score distribution histogram over the recently loaded rows"
    >
      {!hasRows ? (
        <PanelEmptyNote>
          No rows are loaded in the recent ledger window yet, so the score histogram is empty.
        </PanelEmptyNote>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={histogram} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID_STROKE} vertical={false} />
            <XAxis dataKey="bucket" tick={AXIS_TICK} axisLine={false} tickLine={false} tickMargin={8} />
            <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={34} allowDecimals={false} />
            <Tooltip {...TOOLTIP_BASE} cursor={{ fill: "rgba(148,163,184,0.06)" }} />
            <Bar dataKey="count" name="Transactions" radius={[2, 2, 0, 0]} maxBarSize={26}>
              {histogram.map((row) => (
                <Cell key={row.bucket} fill={scoreFill(row.bucket)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

function RiskByLocationCard({
  locationData,
  hasRows,
  index,
}: {
  locationData: { city: string; total: number; high: number }[];
  hasRows: boolean;
  index: number;
}) {
  const locationHigh = locationData.reduce((sum, row) => sum + row.high, 0);
  return (
    <ChartCard
      title="Risk by location"
      tag="recent ledger window"
      stat={hasRows ? `${formatNumber(locationHigh)} high-risk` : undefined}
      index={index}
      ariaLabel="Risk by location bar chart over the recently loaded rows"
    >
      {!hasRows ? (
        <PanelEmptyNote>
          No rows are loaded in the recent ledger window yet, so the location split is empty.
        </PanelEmptyNote>
      ) : (
        <>
          <MiniLegend
            items={[
              { label: "Total", color: SLATE_TOTAL },
              { label: "High-risk", color: CRITICAL },
            ]}
          />
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={locationData} layout="vertical" barGap={2} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={GRID_STROKE} vertical={false} />
              <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} />
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
        </>
      )}
    </ChartCard>
  );
}

/** Weighted signal bars — same visual pattern as the HighRiskQueue signal list. */
function TopSignalsCard({
  signals,
  hasRows,
  index,
}: {
  signals: { signal: string; count: number }[];
  hasRows: boolean;
  index: number;
}) {
  const total = signals.reduce((sum, row) => sum + row.count, 0);
  const max = signals.reduce((m, row) => Math.max(m, row.count), 0) || 1;
  return (
    <ChartCard
      title="Top risk signals"
      tag="recent ledger window"
      stat={hasRows ? `${formatNumber(total)} events` : undefined}
      index={index}
      ariaLabel="Top risk signals ranked list over the recently loaded rows"
    >
      {!hasRows || signals.length === 0 ? (
        <PanelEmptyNote>
          {hasRows
            ? "No risk signals fired in the recently loaded rows."
            : "No rows are loaded in the recent ledger window yet, so signal frequency is empty."}
        </PanelEmptyNote>
      ) : (
        <div className="flex flex-col gap-3">
          {signals.map((row, i) => (
            <div key={row.signal} className="flex items-center gap-3">
              <span className="w-32 shrink-0 truncate text-[11px] text-slate-400">{row.signal}</span>
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-500/10">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-risk-critical/70 to-transparent"
                  initial={{ width: 0 }}
                  animate={{ width: `${(row.count / max) * 100}%` }}
                  transition={{ duration: 0.8, delay: 0.2 + i * 0.1, ease: [0.22, 1, 0.36, 1] }}
                />
              </div>
              <span className="num w-10 text-right text-[11px] text-slate-500">{formatNumber(row.count)}</span>
            </div>
          ))}
        </div>
      )}
    </ChartCard>
  );
}

/* ------------------------------------------------------------------ */
/* View                                                                */
/* ------------------------------------------------------------------ */

export function RiskIntelligenceView() {
  const transactions = useAppStore((s) => s.transactions);
  const { data, isLoading, isError, refetch } = useRiskMetrics();
  const { seed } = useDemoControls();

  const metrics = data?.raw;

  /* Portfolio-wide panels — computed from the metrics response only. */
  const distribution = useMemo(
    () =>
      (metrics?.riskDistribution ?? []).map((row) => ({
        level: LEVEL_DISPLAY[row.level] ?? row.level,
        count: row.count,
        tone: LEVEL_TONES[row.level] ?? SLATE_TOTAL,
      })),
    [metrics]
  );
  const riskTotal = distribution.reduce((sum, row) => sum + row.count, 0);

  const volume = useMemo(
    () => (metrics?.volumeOverTime ?? []).map((b) => ({ label: b.label, count: b.count, flagged: b.flagged, value: b.value })),
    [metrics]
  );

  const paymentData = useMemo(
    () => (metrics?.byPaymentMethod ?? []).map((row) => ({ method: row.method, count: row.count })),
    [metrics]
  );

  const merchants = useMemo(() => metrics?.topFlaggedMerchants ?? [], [metrics]);

  /* Recent-ledger-window panels — derived from the store's loaded rows. */
  const storeHasRows = transactions.length > 0;
  const scoreHistogram = useMemo(() => {
    const buckets = Array.from({ length: 10 }, (_, i) => ({
      bucket: `${i * 10}–${i === 9 ? 100 : i * 10 + 9}`,
      count: 0,
    }));
    for (const t of transactions) {
      const idx = Math.min(9, Math.max(0, Math.floor(t.riskScore / 10)));
      buckets[idx].count += 1;
    }
    return buckets;
  }, [transactions]);

  const locationData = useMemo(() => {
    const byCity = new Map<string, { total: number; high: number }>();
    for (const t of transactions) {
      const entry = byCity.get(t.location) ?? { total: 0, high: 0 };
      entry.total += 1;
      if (t.riskLevel === "HIGH" || t.riskLevel === "CRITICAL") entry.high += 1;
      byCity.set(t.location, entry);
    }
    return [...byCity.entries()]
      .map(([city, v]) => ({ city, ...v }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
  }, [transactions]);

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
      .slice(0, 6);
  }, [transactions]);

  const handleSeed = async () => {
    await seed.mutateAsync();
    await refetch();
  };

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
          {metrics ? `SQLite ledger · ${formatNumber(metrics.totals.transactions)} transactions` : "SQLite ledger"}
        </span>
      </header>

      {/* Body */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-label="Loading pattern charts">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <PanelSkeleton key={i} />
          ))}
        </div>
      ) : isError || !metrics ? (
        <section className="panel overflow-hidden" aria-label="Metrics unavailable">
          <EmptyState
            title="Pattern metrics unavailable"
            body="The metrics endpoint could not be reached, so the intelligence panels show nothing rather than stale or invented aggregates."
            action={
              <Button
                variant="outline"
                onClick={() => void refetch()}
                className="gap-2 border-line bg-surface-2 hover:bg-surface-3"
              >
                Retry
              </Button>
            }
          />
        </section>
      ) : metrics.empty ? (
        <section className="panel overflow-hidden" aria-label="Empty ledger">
          <EmptyState
            icon={<Database className="h-5 w-5 text-slate-400" aria-hidden />}
            title="The ledger is empty"
            body="No transactions are stored yet, so there are no patterns to analyse. Load the demo records (clearly labelled synthetic payments scored by the deterministic engine) to populate the panels."
            action={
              <Button
                onClick={() => void handleSeed()}
                disabled={seed.isPending}
                className="gap-2 border border-risk-critical/40 bg-risk-critical/12 text-[13px] font-semibold text-risk-critical hover:bg-risk-critical/20"
              >
                <Database className="h-4 w-4" aria-hidden />
                {seed.isPending ? "Loading demo records…" : "Load demo records"}
              </Button>
            }
          />
        </section>
      ) : (
        <>
          {/* Pattern grid */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-label="Risk intelligence pattern charts">
            <RiskDistributionCard distribution={distribution} total={riskTotal} index={0} />
            <ScoreHistogramCard histogram={scoreHistogram} hasRows={storeHasRows} index={1} />
            <VolumeCard volume={volume} index={2} />
            <RiskByLocationCard locationData={locationData} hasRows={storeHasRows} index={3} />
            <RiskByPaymentMethodCard paymentData={paymentData} index={4} />
            <TopMerchantsCard merchants={merchants} index={5} />
            <ValueFlowCard volume={volume} index={6} />
            <TopSignalsCard signals={topSignals} hasRows={storeHasRows} index={7} />
          </div>

          <p className="mt-5 text-[11px] text-slate-600">
            Portfolio-wide panels are computed live from the SQLite ledger. Panels tagged “recent
            ledger window” reflect only the rows currently loaded in this session — not the full
            portfolio.
          </p>
        </>
      )}
    </div>
  );
}
