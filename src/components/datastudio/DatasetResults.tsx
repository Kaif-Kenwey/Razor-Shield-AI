"use client";

/**
 * Dataset Studio — results dashboard.
 *
 * Renders the outcome of one analysis run: engine-quality metrics when the
 * file carried ground-truth labels (precision / recall / F1, confusion
 * matrix, rupee cost of mistakes), volume analytics (score histogram, level
 * mix, top signals), and a drill-down table of every scored row. Flagged
 * rows can be routed into the live investigation queue.
 */

import { Fragment, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowDownToLine,
  BadgeCheck,
  Crosshair,
  FolderSearch,
  RotateCcw,
  Search,
  ShieldAlert,
  Timer,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RiskLevelBadge } from "@/components/risk/RiskBadge";
import { StatusDot } from "@/components/shared/StatusDot";
import { ThresholdLab } from "@/components/datastudio/ThresholdLab";
import { FraudNetwork } from "@/components/datastudio/FraudNetwork";
import { AttackSimulator } from "@/components/datastudio/AttackSimulator";
import { DataQuality } from "@/components/datastudio/DataQuality";
import { CalibrationTable } from "@/components/datastudio/CalibrationTable";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/store/appStore";
import { formatINR, formatNumber } from "@/lib/format";
import type { DatasetAnalysis, ScoredRow } from "@/types/dataset";
import type { RiskLevel, Transaction } from "@/types";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const LEVEL_COLORS: Record<RiskLevel, string> = {
  LOW: "#34d399",
  MEDIUM: "#fbbf24",
  HIGH: "#fb7185",
  CRITICAL: "#f87171",
};

const OUTCOME_META = {
  tp: { label: "TP", title: "Fraud caught", cls: "text-risk-low border-risk-low/30 bg-risk-low/10" },
  fp: { label: "FP", title: "False alarm — legit payment flagged", cls: "text-risk-medium border-risk-medium/30 bg-risk-medium/10" },
  fn: { label: "FN", title: "Missed fraud", cls: "text-risk-critical border-risk-critical/30 bg-risk-critical/10" },
  tn: { label: "TN", title: "Correctly passed", cls: "text-slate-400 border-slate-500/30 bg-slate-500/10" },
} as const;

const REC_STYLES: Record<string, string> = {
  ALLOW: "text-risk-low border-risk-low/25 bg-risk-low/8",
  REVIEW: "text-intel border-intel/30 bg-intel/10",
  HOLD: "text-orange-300 border-orange-400/25 bg-orange-400/8",
  BLOCK: "text-risk-critical border-risk-critical/30 bg-risk-critical/10",
};

const SEVERITY_DOT: Record<string, string> = {
  LOW: "bg-risk-low",
  MEDIUM: "bg-risk-medium",
  HIGH: "bg-risk-high",
  CRITICAL: "bg-risk-critical",
};

const fmtPct = (n: number) => `${n.toFixed(1)}%`;

/** The alert definition, stated where the metrics are shown — no black boxes. */
const ALERT_DEFINITION =
  "An alert is any row the engine did not ALLOW — REVIEW, HOLD or BLOCK. Precision and recall are measured on that alert queue, matching fraud-ops convention.";

function downloadScoredCsv(analysis: DatasetAnalysis): void {
  const header = "txn_id,amount_inr,risk_score,risk_level,recommendation,label,outcome,top_signal";
  const lines = analysis.rows.map((r) => {
    const top = r.signals.length ? r.signals[0].type : "";
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    return [
      esc(r.txnId),
      r.amount,
      r.riskScore,
      r.riskLevel,
      r.recommendation,
      r.label === null ? "" : r.label,
      r.outcome ?? "",
      top,
    ].join(",");
  });
  const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${analysis.name.replace(/[^a-z0-9-_]+/gi, "_")}-scored.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Convert an alerted row into a live-feed transaction for the case queue. */
export function scoredRowToTransaction(row: ScoredRow, datasetId: string): Transaction {
  const METHODS: Transaction["paymentMethod"][] = ["UPI", "Credit Card", "Debit Card", "Netbanking", "Wallet"];
  const method = METHODS.find((m) => m.toLowerCase() === row.paymentMethod.toLowerCase()) ?? "UPI";
  const status: Transaction["status"] =
    row.recommendation === "BLOCK"
      ? "BLOCKED"
      : row.recommendation === "HOLD"
        ? "ON_HOLD"
        : row.recommendation === "REVIEW"
          ? "UNDER_REVIEW"
          : "MONITORING";
  return {
    id: `IMP_${datasetId.slice(-6)}_${row.txnId}`.slice(0, 48),
    amount: row.amount,
    customerId: row.customerId,
    customerName: row.customerName || row.customerId,
    merchant: row.merchant || "Unknown merchant",
    location: row.location || "Unknown",
    device: row.device || "unknown-device",
    isNewDevice: row.signals.some((s) => s.type === "NEW_DEVICE"),
    paymentMethod: method,
    riskScore: row.riskScore,
    riskLevel: row.riskLevel,
    status,
    timestamp: row.timestamp ?? new Date().toISOString(),
    currency: "INR",
    signals: row.signals,
    aiSummary: null,
    recommendation: row.recommendation,
    confidence: null,
  };
}

/* ------------------------------------------------------------------ */
/* metric sub-components                                               */
/* ------------------------------------------------------------------ */

function QualityStat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone: "green" | "amber" | "red" | "intel";
  hint: string;
}) {
  const toneCls = {
    green: "text-risk-low",
    amber: "text-risk-medium",
    red: "text-risk-critical",
    intel: "text-intel",
  }[tone];
  return (
    <div className="panel p-4">
      <p className="micro text-slate-500">{label}</p>
      <p className={cn("num mt-2 text-[26px] font-semibold leading-none tracking-tight", toneCls)}>
        {value}
      </p>
      <p className="micro-11 mt-2 leading-snug text-slate-600">{hint}</p>
    </div>
  );
}

function ConfusionMatrix({ analysis }: { analysis: DatasetAnalysis }) {
  const m = analysis.metrics;
  const cells = [
    { label: "Fraud caught", sub: "TP", n: m.truePositives, cls: "border-risk-low/30 bg-risk-low/8", text: "text-risk-low" },
    { label: "False alarms", sub: "FP", n: m.falsePositives, cls: "border-risk-medium/30 bg-risk-medium/8", text: "text-risk-medium" },
    { label: "Missed fraud", sub: "FN", n: m.falseNegatives, cls: "border-risk-critical/30 bg-risk-critical/8", text: "text-risk-critical" },
    { label: "Correctly passed", sub: "TN", n: m.trueNegatives, cls: "border-slate-500/25 bg-slate-500/8", text: "text-slate-300" },
  ];
  return (
    <div className="panel p-4">
      <p className="micro text-slate-500">Confusion matrix</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {cells.map((c) => (
          <div key={c.sub} className={cn("rounded-sm border p-3", c.cls)}>
            <p className={cn("num text-[22px] font-semibold leading-none", c.text)}>{c.n}</p>
            <p className="micro-11 mt-1.5 text-slate-500">
              {c.label} <span className="num text-slate-600">· {c.sub}</span>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChartCard({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("panel p-4", className)}>
      <p className="micro text-slate-500">{title}</p>
      <div className="mt-3 h-44">{children}</div>
    </div>
  );
}

const chartTooltipStyle = {
  backgroundColor: "rgba(10,14,21,0.95)",
  border: "1px solid rgba(148,163,184,0.18)",
  borderRadius: 4,
  fontSize: 11,
  color: "#e2e8f0",
} as const;

/* ------------------------------------------------------------------ */
/* main component                                                      */
/* ------------------------------------------------------------------ */

type RowFilter = "all" | "alerts" | "tp" | "fp" | "fn";
const PAGE_SIZE = 25;

export function DatasetResults({
  analysis,
  onReset,
}: {
  analysis: DatasetAnalysis;
  onReset: () => void;
}) {
  const { toast } = useToast();
  const injectTransactions = useAppStore((s) => s.injectTransactions);
  const navigate = useAppStore((s) => s.navigate);
  const [filter, setFilter] = useState<RowFilter>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [routed, setRouted] = useState(false);

  const m = analysis.metrics;

  const alertRows = useMemo(
    () => analysis.rows.filter((r) => r.recommendation !== "ALLOW"),
    [analysis.rows],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return analysis.rows.filter((r) => {
      if (filter === "alerts" && r.recommendation === "ALLOW") return false;
      if (filter === "fp" && r.outcome !== "fp") return false;
      if (filter === "fn" && r.outcome !== "fn") return false;
      if (filter === "tp" && r.outcome !== "tp") return false;
      if (!q) return true;
      return (
        r.txnId.toLowerCase().includes(q) ||
        r.customerName.toLowerCase().includes(q) ||
        r.customerId.toLowerCase().includes(q) ||
        r.merchant.toLowerCase().includes(q) ||
        r.location.toLowerCase().includes(q) ||
        r.paymentMethod.toLowerCase().includes(q)
      );
    });
  }, [analysis.rows, filter, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const routeAlerts = () => {
    const txns = alertRows.slice(0, 200).map((r) => scoredRowToTransaction(r, analysis.id));
    injectTransactions(txns);
    setRouted(true);
    toast({
      title: "Alerts routed to the case queue",
      description: `${txns.length} scored ${txns.length === 1 ? "transaction" : "transactions"} now appear in Investigations.`,
    });
    setTimeout(() => navigate("investigations"), 700);
  };

  const filterPills: { key: RowFilter; label: string; count: number | null }[] = [
    { key: "all", label: "All rows", count: analysis.rows.length },
    { key: "alerts", label: "Alerts", count: alertRows.length },
    ...(m.labelsPresent
      ? [
          { key: "tp" as const, label: "TP", count: m.truePositives },
          { key: "fp" as const, label: "FP", count: m.falsePositives },
          { key: "fn" as const, label: "FN", count: m.falseNegatives },
        ]
      : []),
  ];

  return (
    <div className="space-y-5">
      {/* header */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="flex flex-wrap items-start justify-between gap-3"
      >
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-slate-100">{analysis.name}</h2>
            <span className="num rounded-sm border border-line bg-surface-2 px-1.5 py-0.5 micro-11 text-slate-400">
              engine {analysis.engineVersion}
            </span>
          </div>
          <p className="micro mt-1 text-slate-500">
            {analysis.sourceFile} · {formatNumber(analysis.rowCount)} rows scored
            {analysis.skippedCount > 0 && ` · ${analysis.skippedCount} skipped (unusable amount)`}
            {" · "}
            <span className={analysis.flaggedCount > 0 ? "text-risk-medium" : undefined}>
              {analysis.flaggedCount} {analysis.flaggedCount === 1 ? "alert" : "alerts"}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={onReset} className="gap-1.5">
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            New import
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              downloadScoredCsv(analysis);
              toast({ title: "Scored CSV exported", description: `${analysis.rowCount} rows with scores, levels and outcomes.` });
            }}
          >
            <ArrowDownToLine className="h-3.5 w-3.5" aria-hidden />
            Export scored CSV
          </Button>
          <Button
            size="sm"
            className="gap-1.5"
            disabled={alertRows.length === 0 || routed}
            onClick={routeAlerts}
          >
            <FolderSearch className="h-3.5 w-3.5" aria-hidden />
            {routed ? "Alerts routed ✓" : `Route ${alertRows.length} alert${alertRows.length === 1 ? "" : "s"} to queue`}
          </Button>
        </div>
      </motion.div>

      {/* data quality — the file behind the run */}
      <motion.section
        aria-label="Data quality"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.04, ease: "easeOut" }}
      >
        <DataQuality rows={analysis.rows} skippedCount={analysis.skippedCount} />
      </motion.section>

      {/* engine quality (labeled files only) */}
      {m.labelsPresent ? (
        <motion.section
          aria-label="Engine quality"
          className="space-y-3"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.06, ease: "easeOut" }}
        >
          <div className="flex items-center gap-2">
            <BadgeCheck className="h-3.5 w-3.5 text-risk-low" aria-hidden />
            <p className="micro uppercase tracking-[0.14em] text-slate-400">
              Engine quality — measured against ground truth ({formatNumber(m.labeledCount)} labeled rows)
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <QualityStat
              label="Precision"
              value={fmtPct(m.precision)}
              tone={m.precision >= 80 ? "green" : m.precision >= 60 ? "amber" : "red"}
              hint="Share of alerts that were true fraud"
            />
            <QualityStat
              label="Recall"
              value={fmtPct(m.recall)}
              tone={m.recall >= 80 ? "green" : m.recall >= 60 ? "amber" : "red"}
              hint="Share of fraud rows the engine alerted on"
            />
            <QualityStat
              label="F1 score"
              value={m.f1.toFixed(1)}
              tone="intel"
              hint="Harmonic mean — single-number balance of P & R"
            />
            <QualityStat
              label="False-positive cost"
              value={formatINR(m.falsePositiveCost)}
              tone={m.falsePositiveCost > 0 ? "amber" : "green"}
              hint="Frozen funds + ₹450 review ops per false alarm"
            />
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            <ConfusionMatrix analysis={analysis} />
            <div className="panel space-y-3 p-4 lg:col-span-2">
              <p className="micro text-slate-500">Cost of mistakes (rupee view)</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-sm border border-risk-medium/25 bg-risk-medium/5 p-3">
                  <p className="micro-11 text-slate-500">False alarms cost</p>
                  <p className="num mt-1 text-lg font-semibold text-risk-medium">{formatINR(m.falsePositiveCost)}</p>
                  <p className="micro-11 mt-1 leading-snug text-slate-600">
                    {m.falsePositives} legit {m.falsePositives === 1 ? "payment" : "payments"} flagged
                  </p>
                </div>
                <div className="rounded-sm border border-risk-critical/25 bg-risk-critical/5 p-3">
                  <p className="micro-11 text-slate-500">Missed fraud loss</p>
                  <p className="num mt-1 text-lg font-semibold text-risk-critical">{formatINR(m.falseNegativeCost)}</p>
                  <p className="micro-11 mt-1 leading-snug text-slate-600">
                    {m.falseNegatives} fraud {m.falseNegatives === 1 ? "row" : "rows"} slipped through
                  </p>
                </div>
                <div className="rounded-sm border border-line bg-surface-2/60 p-3">
                  <p className="micro-11 text-slate-500">Auto-block catch rate</p>
                  <p className="num mt-1 text-lg font-semibold text-slate-100">{fmtPct(m.catchRateAtBlock)}</p>
                  <p className="micro-11 mt-1 leading-snug text-slate-600">Fraud rows scoring BLOCK outright</p>
                </div>
              </div>
              <div className="flex items-start gap-1.5 rounded-sm border border-line bg-surface-1/60 px-2.5 py-2">
                <Crosshair className="mt-0.5 h-3 w-3 shrink-0 text-slate-500" aria-hidden />
                <p className="micro-11 leading-relaxed text-slate-500">{ALERT_DEFINITION}</p>
              </div>
            </div>
          </div>
          <ThresholdLab rows={analysis.rows} />
          <CalibrationTable rows={analysis.rows} />
        </motion.section>
      ) : (
        <section aria-label="Unlabeled notice" className="flex items-start gap-2 rounded-sm border border-line bg-surface-1 px-3 py-2.5">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-risk-medium" aria-hidden />
          <p className="micro-11 leading-relaxed text-slate-400">
            No fraud-label column detected — showing volume analytics only. Upload a file with a{" "}
            <span className="num text-slate-200">is_fraud</span> / <span className="num text-slate-200">label</span> column to get
            precision, recall and the rupee cost of mistakes.
          </p>
        </section>
      )}

      {/* entity-graph ring detection — works with or without labels */}
      <motion.section
        aria-label="Fraud network"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.1, ease: "easeOut" }}
      >
        <FraudNetwork rows={analysis.rows} />
      </motion.section>

      {/* attack simulator — red team vs the rule engine */}
      <motion.section
        aria-label="Attack simulator"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.12, ease: "easeOut" }}
      >
        <AttackSimulator analysis={analysis} />
      </motion.section>

      {/* volume analytics */}
      <motion.section
        aria-label="Volume analytics"
        className="grid gap-3 lg:grid-cols-3"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.12, ease: "easeOut" }}
      >
        <ChartCard title="Risk level mix">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={analysis.levelDistribution.filter((l) => l.count > 0)}
                dataKey="count"
                nameKey="level"
                innerRadius={38}
                outerRadius={62}
                paddingAngle={2}
                strokeWidth={0}
              >
                {analysis.levelDistribution
                  .filter((l) => l.count > 0)
                  .map((l) => (
                    <Cell key={l.level} fill={LEVEL_COLORS[l.level]} fillOpacity={0.85} />
                  ))}
              </Pie>
              <ReTooltip contentStyle={chartTooltipStyle} />
              <g>
                <text x="50%" y="47%" textAnchor="middle" fill="#94a3b8" fontSize="10">
                  avg score
                </text>
                <text x="50%" y="60%" textAnchor="middle" fill="#e2e8f0" fontSize="15" fontWeight="600">
                  {analysis.avgScore.toFixed(0)}
                </text>
              </g>
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Score distribution">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={analysis.scoreHistogram} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical={false} />
              <XAxis dataKey="bucket" tick={{ fill: "#64748b", fontSize: 9 }} interval={1} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: "#64748b", fontSize: 9 }} tickLine={false} axisLine={false} allowDecimals={false} />
              <ReTooltip contentStyle={chartTooltipStyle} cursor={{ fill: "rgba(148,163,184,0.06)" }} />
              <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                {analysis.scoreHistogram.map((b, i) => (
                  <Cell
                    key={b.bucket}
                    fill={LEVEL_COLORS[(["LOW", "MEDIUM", "HIGH", "CRITICAL"] as RiskLevel[])[Math.min(3, Math.floor(i / 3))]]}
                    fillOpacity={0.8}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Top firing signals">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={analysis.topSignals.slice(0, 6)} layout="vertical" margin={{ top: 0, right: 10, bottom: 0, left: 8 }}>
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="label"
                width={88}
                tick={{ fill: "#94a3b8", fontSize: 9.5 }}
                tickLine={false}
                axisLine={false}
              />
              <ReTooltip contentStyle={chartTooltipStyle} cursor={{ fill: "rgba(148,163,184,0.06)" }} />
              <Bar dataKey="count" fill="#a78bfa" fillOpacity={0.75} radius={[0, 2, 2, 0]} barSize={11} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </motion.section>

      {/* rows table */}
      <motion.section
        aria-label="Scored rows"
        className="panel"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.18, ease: "easeOut" }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {filterPills.map((p) => (
              <button
                key={p.key}
                onClick={() => {
                  setFilter(p.key);
                  setPage(0);
                  setExpanded(null);
                }}
                aria-pressed={filter === p.key}
                className={cn(
                  "num rounded-sm border px-2 py-1 micro-11 transition-all active:scale-[0.97]",
                  filter === p.key
                    ? "border-intel/40 bg-intel/12 text-intel"
                    : "border-line bg-surface-1 text-slate-400 hover:border-slate-500/40 hover:text-slate-200",
                )}
              >
                {p.label}
                {p.count !== null && <span className="ml-1 text-slate-500">{p.count}</span>}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-500" aria-hidden />
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              placeholder="Search id, customer, merchant, city…"
              className="h-7 w-52 border-line bg-surface-1 pl-7 text-[11px] placeholder:text-slate-600"
              aria-label="Search scored rows"
            />
          </div>
        </div>

        <div className="max-h-[26rem] overflow-y-auto" data-testid="scored-rows">
          <table className="w-full text-left">
            <thead className="sticky top-0 z-10 bg-surface-1/95 backdrop-blur">
              <tr className="border-b border-line">
                {["Transaction", "Amount", "Score", "Level", "Action", ...(m.labelsPresent ? ["Truth"] : [])].map((h) => (
                  <th key={h} className="micro px-4 py-2 font-medium text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => {
                const isExpanded = expanded === r.index;
                return (
                  <Fragment key={r.index}>
                    <tr
                      onClick={() => setExpanded(isExpanded ? null : r.index)}
                      className={cn(
                        "cursor-pointer border-b border-line/60 transition-colors hover:bg-surface-1/70",
                        r.riskLevel === "CRITICAL" && "bg-risk-critical/[0.04]",
                      )}
                    >
                      <td className="px-4 py-2">
                        <p className="num text-[11.5px] font-medium text-slate-200">{r.txnId}</p>
                        <p className="micro-11 text-slate-500">
                          {r.customerName || r.customerId}
                          {r.merchant && ` · ${r.merchant}`}
                          {r.location && ` · ${r.location}`}
                        </p>
                      </td>
                      <td className="num px-4 py-2 text-[11.5px] text-slate-300">{formatINR(r.amount)}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <span className="num text-[11.5px] text-slate-200">{r.riskScore}</span>
                          <div className="h-1 w-12 overflow-hidden rounded-full bg-surface-2">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${r.riskScore}%`,
                                backgroundColor: LEVEL_COLORS[r.riskLevel],
                              }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2"><RiskLevelBadge level={r.riskLevel} /></td>
                      <td className="px-4 py-2">
                        <span className={cn("num inline-flex rounded-sm border px-1.5 py-0.5 micro-11", REC_STYLES[r.recommendation])}>
                          {r.recommendation}
                        </span>
                      </td>
                      {m.labelsPresent && (
                        <td className="px-4 py-2">
                          {r.outcome ? (
                            <span
                              title={OUTCOME_META[r.outcome].title}
                              className={cn("num inline-flex rounded-sm border px-1.5 py-0.5 micro-11", OUTCOME_META[r.outcome].cls)}
                            >
                              {OUTCOME_META[r.outcome].label}
                            </span>
                          ) : (
                            <span className="micro-11 text-slate-600">—</span>
                          )}
                        </td>
                      )}
                    </tr>
                    {isExpanded && (
                      <tr className="border-b border-line/60 bg-surface-1/50">
                        <td colSpan={m.labelsPresent ? 6 : 5} className="px-4 py-3">
                          <div className="space-y-1.5">
                            <p className="micro text-slate-500">
                              {r.signals.length ? `${r.signals.length} signal${r.signals.length === 1 ? "" : "s"} fired` : "No signals — clean row"}
                              {r.warnings.length > 0 && (
                                <span className="text-risk-medium"> · {r.warnings.join(" · ")}</span>
                              )}
                            </p>
                            {r.signals.map((s) => (
                              <div key={s.id} className="flex items-start gap-2 rounded-sm border border-line/70 bg-surface-2/50 px-2.5 py-1.5">
                                <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", SEVERITY_DOT[s.severity] ?? "bg-slate-500")} />
                                <div className="min-w-0 flex-1">
                                  <p className="text-[11.5px] font-medium text-slate-200">
                                    {s.title}
                                    <span className="num ml-2 text-[10px] text-slate-500">+{s.impact} pts</span>
                                  </p>
                                  <p className="micro-11 leading-snug text-slate-500">{s.evidence}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={m.labelsPresent ? 6 : 5} className="px-4 py-10 text-center">
                    <ShieldAlert className="mx-auto h-5 w-5 text-slate-600" aria-hidden />
                    <p className="micro mt-2 text-slate-500">No rows match this filter</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* pagination */}
        <div className="flex items-center justify-between border-t border-line px-4 py-2.5">
          <p className="micro-11 text-slate-500">
            {filtered.length === 0
              ? "0 rows"
              : `${safePage * PAGE_SIZE + 1}–${Math.min(filtered.length, (safePage + 1) * PAGE_SIZE)} of ${formatNumber(filtered.length)} rows`}
          </p>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" className="h-7 px-2.5" disabled={safePage === 0} onClick={() => { setPage(safePage - 1); setExpanded(null); }}>
              Prev
            </Button>
            <span className="num micro-11 text-slate-400">{safePage + 1}/{pageCount}</span>
            <Button variant="outline" size="sm" className="h-7 px-2.5" disabled={safePage >= pageCount - 1} onClick={() => { setPage(safePage + 1); setExpanded(null); }}>
              Next
            </Button>
          </div>
        </div>
      </motion.section>

      {/* routing footnote */}
      {routed ? (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center gap-1.5 micro-11 text-slate-500"
        >
          <Timer className="h-3 w-3 text-intel" aria-hidden />
          Alerts are now in the Investigations queue — the analyst decides from there. Nothing is auto-blocked.
        </motion.p>
      ) : (
        <p className="flex items-center gap-1.5 micro-11 text-slate-600">
          <StatusDot tone="green" label="engine deterministic" />
          Scoring is deterministic — the same file always produces the same scores.
        </p>
      )}
    </div>
  );
}
