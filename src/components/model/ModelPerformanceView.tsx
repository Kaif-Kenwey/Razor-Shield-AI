"use client";

/**
 * MODEL PERFORMANCE — detection engine evaluation page.
 *
 * Every value is rendered from GET /api/model/performance via
 * useModelPerformance(): the deterministic rule engine's recommendations
 * are compared against the ground-truth labels that actually exist in the
 * ledger. When fewer labelled rows exist than the minimum, the endpoint
 * says so and this view renders the honest "not enough labelled data"
 * state instead of fabricated metrics.
 *
 * There is deliberately no ROC-AUC, training date or cost fabrication
 * here: the engine is a deterministic rules engine, not a trained ML
 * classifier, and only measured quantities are shown.
 */

import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/States";
import { useModelPerformance } from "@/hooks/useLedger";
import { useAppStore } from "@/store/appStore";
import type { ModelPerformanceResponse } from "@/services/api";
import { dateTimeShort, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

type FullEvaluation = Extract<ModelPerformanceResponse, { insufficientData: false }>;

/** Card + bar definitions only — values come from the evaluation response. */
const SCORE_METRICS: { key: "precision" | "recall" | "f1"; label: string; bar: string }[] = [
  { key: "precision", label: "Precision", bar: "bg-intel" },
  { key: "recall", label: "Recall", bar: "bg-intel" },
  { key: "f1", label: "F1 score", bar: "bg-intel/80" },
];

function PanelSkeleton() {
  return (
    <div className="panel p-5" role="status" aria-label="Loading evaluation">
      <div className="h-2.5 w-24 rounded bg-slate-500/12 animate-pulse" />
      <div className="mt-4 h-8 w-32 rounded bg-slate-500/10 animate-pulse" style={{ animationDelay: "120ms" }} />
      <div className="mt-6 space-y-2">
        <div className="h-3 w-full rounded bg-slate-500/8 animate-pulse" style={{ animationDelay: "200ms" }} />
        <div className="h-3 w-4/5 rounded bg-slate-500/8 animate-pulse" style={{ animationDelay: "280ms" }} />
      </div>
    </div>
  );
}

function FullPerformance({ mp }: { mp: FullEvaluation }) {
  const cm = mp.confusionMatrix;

  const matrixCells = [
    {
      abbr: "TP",
      label: "True positive",
      count: cm.truePositives,
      bg: "bg-risk-low/8",
      numTone: "text-risk-low",
      desc: "correctly flagged fraud (score ≥ threshold, label = fraud)",
    },
    {
      abbr: "FP",
      label: "False positive",
      count: cm.falsePositives,
      bg: "bg-risk-medium/8",
      numTone: "text-risk-medium",
      desc: "legitimate flagged — review cost",
    },
    {
      abbr: "FN",
      label: "False negative",
      count: cm.falseNegatives,
      bg: "bg-risk-critical/10",
      numTone: "text-risk-critical",
      desc: "fraud scored below threshold — direct loss",
    },
    {
      abbr: "TN",
      label: "True negative",
      count: cm.trueNegatives,
      bg: "bg-slate-500/5",
      numTone: "text-slate-200",
      desc: "correctly allowed",
    },
  ];

  const modelCardRows: { label: string; value: string; note?: boolean }[] = [
    { label: "Engine version", value: mp.modelVersion },
    { label: "Engine kind", value: mp.engineKind },
    { label: "Evaluated", value: dateTimeShort(mp.evaluatedAt) },
    { label: "Labelled rows", value: `${formatNumber(mp.labeledCount)} of ${formatNumber(mp.totalTransactions)} stored` },
    { label: "Decision threshold", value: `score ≥ ${mp.threshold}` },
    { label: "Note", value: mp.note, note: true },
  ];

  return (
    <>
      {/* Honest disclaimer — deterministic engine, measured on real labelled rows */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.06, duration: 0.35, ease: "easeOut" }}
        role="note"
        className="mb-6 flex items-center gap-2.5 rounded-sm border border-risk-medium/30 bg-risk-medium/8 px-4 py-2.5"
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-risk-medium" aria-hidden />
        <p className="text-[12px] text-risk-medium/90">
          Deterministic rule engine — these rates are measured on the labelled rows currently stored
          in the ledger, not a trained ML classifier. Thresholded recommendation (score ≥{" "}
          {mp.threshold}) vs ground-truth labels.
        </p>
      </motion.div>

      {/* Score metrics */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3" aria-label="Engine score metrics">
        {SCORE_METRICS.map((m, i) => {
          const value = mp[m.key];
          return (
            <motion.div
              key={m.key}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12 + i * 0.06, duration: 0.35, ease: "easeOut" }}
              className="panel p-4"
            >
              <p className="micro text-slate-500">{m.label}</p>
              <p className="num mt-2 text-[28px] font-semibold leading-none text-slate-100">
                {value.toFixed(1)}%
              </p>
              <div className="mt-3 h-1 rounded bg-slate-500/12" aria-hidden>
                <motion.div
                  className={cn("h-full rounded", m.bar)}
                  initial={{ width: 0 }}
                  animate={{ width: `${value}%` }}
                  transition={{ delay: 0.3 + i * 0.06, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                />
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Confusion matrix */}
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.36, duration: 0.35, ease: "easeOut" }}
          className="panel overflow-hidden"
          aria-label="Confusion matrix"
        >
          <div className="border-b border-line px-4 py-3">
            <h2 className="micro-11 font-semibold text-slate-200">Confusion matrix</h2>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-line bg-line">
              {matrixCells.map((cell) => (
                <div key={cell.abbr} className={cn("p-4", cell.bg)}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="micro text-slate-500">
                      {cell.label} · {cell.abbr}
                    </span>
                    <span className={cn("num text-xl font-semibold", cell.numTone)}>
                      {formatNumber(cell.count)}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[10.5px] text-slate-500">{cell.desc}</p>
                </div>
              ))}
            </div>
            <p className="num mt-3 text-[11.5px] text-slate-500">
              Evaluated: {formatNumber(cm.totalEvaluated)} labelled transactions · decision threshold:
              score ≥ {mp.threshold}
            </p>
          </div>
        </motion.section>

        {/* Evaluation basis — what was actually measured, nothing invented */}
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.42, duration: 0.35, ease: "easeOut" }}
          className="panel overflow-hidden"
          aria-label="Evaluation basis"
        >
          <div className="border-b border-line px-4 py-3">
            <h2 className="micro-11 font-semibold text-slate-200">Evaluation basis</h2>
          </div>
          <div className="space-y-4 p-4">
            <div>
              <p className="micro text-slate-500">Labelled coverage</p>
              <p className="num mt-1.5 text-[22px] font-semibold text-slate-100">
                {formatNumber(mp.labeledCount)}
                <span className="text-[13px] font-normal text-slate-500">
                  {" "}
                  / {formatNumber(mp.totalTransactions)} stored transactions
                </span>
              </p>
              <p className="mt-1 text-[11.5px] text-slate-500">
                Only rows with a ground-truth label participate. Unlabelled payments are excluded
                rather than guessed.
              </p>
            </div>
            <div>
              <p className="micro text-slate-500">Method</p>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-300">
                The deterministic rules engine scores each labelled row; its recommendation at the
                current threshold is compared with the stored label to derive the rates above.
              </p>
            </div>
            <p className="num border-t border-line pt-3 text-[11px] text-slate-500">
              Cost-of-error figures are intentionally omitted — no verified cost model exists in the
              ledger yet.
            </p>
          </div>
        </motion.section>
      </div>

      {/* Model card */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.48, duration: 0.35, ease: "easeOut" }}
        className="panel mt-5 overflow-hidden"
        aria-label="Model card"
      >
        <div className="border-b border-line px-4 py-3">
          <h2 className="micro-11 font-semibold text-slate-200">Model card</h2>
        </div>
        <dl className="px-4 py-2">
          {modelCardRows.map((row) => (
            <div
              key={row.label}
              className="flex flex-col gap-0.5 border-b border-line/60 py-2.5 last:border-b-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
            >
              <dt className="micro shrink-0 text-slate-500">{row.label}</dt>
              <dd
                className={cn(
                  "text-[12.5px] sm:flex-1 sm:text-right",
                  row.note ? "italic text-slate-500" : "num text-slate-300"
                )}
              >
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      </motion.section>
    </>
  );
}

export function ModelPerformanceView() {
  const navigate = useAppStore((s) => s.navigate);
  const { data: mp, isLoading, isError, refetch } = useModelPerformance();

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 lg:px-6">
      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0, duration: 0.35, ease: "easeOut" }}
        className="mb-6 flex flex-wrap items-end justify-between gap-4"
      >
        <div>
          <p className="micro mb-1.5 text-slate-500">Detection engine</p>
          <h1 className="text-xl font-semibold tracking-tight text-slate-50 sm:text-2xl">
            Detection benchmark
          </h1>
        </div>
        <span className="micro-11 rounded-sm border border-line bg-surface-1 px-2 py-1 text-slate-400">
          deterministic rules · not ML-trained
        </span>
      </motion.header>

      {isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2" aria-label="Loading detection benchmark">
          <PanelSkeleton />
          <PanelSkeleton />
        </div>
      ) : isError || !mp ? (
        <section className="panel overflow-hidden" aria-label="Evaluation unavailable">
          <EmptyState
            icon={<AlertTriangle className="h-5 w-5 text-risk-medium" aria-hidden />}
            title="Evaluation unavailable"
            body="The performance endpoint could not be reached, so no benchmark values are shown rather than stale or invented numbers."
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
      ) : mp.insufficientData ? (
        /* Honest insufficient-data state — the endpoint refuses to fabricate rates */
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.06, duration: 0.35, ease: "easeOut" }}
          className="panel overflow-hidden"
          aria-label="Not enough labelled data"
        >
          <div className="flex flex-col items-center px-6 py-14 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-line bg-surface-2 text-slate-400">
              <AlertTriangle className="h-5 w-5 text-risk-medium" aria-hidden />
            </div>
            <p className="text-sm font-medium text-slate-200">Not enough labelled data</p>
            <p className="num mt-1.5 text-[12.5px] text-slate-500">
              {formatNumber(mp.labeledCount)} labelled row{mp.labeledCount === 1 ? "" : "s"} in the
              ledger · {formatNumber(mp.minRequired)} required to compute meaningful rates
              {mp.totalTransactions > mp.labeledCount
                ? ` · ${formatNumber(mp.totalTransactions - mp.labeledCount)} stored rows are unlabelled`
                : ""}
            </p>
            <p className="mt-2 max-w-md text-[13px] leading-relaxed text-slate-500">{mp.note}</p>
            <Button
              onClick={() => navigate("datastudio")}
              className="mt-6 gap-2 border border-line bg-surface-1 text-[13px] font-medium text-slate-300 hover:bg-surface-2 hover:text-slate-100"
            >
              Import a labelled dataset
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </motion.section>
      ) : (
        <FullPerformance mp={mp} />
      )}
    </div>
  );
}
