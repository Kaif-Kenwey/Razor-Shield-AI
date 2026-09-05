"use client";

/**
 * MODEL PERFORMANCE — detection engine evaluation page.
 *
 * Every value on this page is rendered from the MODEL_PERFORMANCE snapshot
 * in the mock data layer — nothing is hardcoded. Because that snapshot is
 * demo data, a prominent disclaimer banner marks the metrics as mock
 * evaluation values for the Buildathon demo (not live production metrics).
 */

import { motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import { MODEL_PERFORMANCE } from "@/data/mockData";
import type { ModelPerformance } from "@/types";
import { formatINR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

type ScoreMetricKey = "precision" | "recall" | "f1" | "rocAuc";

/** Card + bar definitions only — values come from the snapshot object. */
const SCORE_METRICS: { key: ScoreMetricKey; label: string; bar: string }[] = [
  { key: "precision", label: "Precision", bar: "bg-intel" },
  { key: "recall", label: "Recall", bar: "bg-intel" },
  { key: "f1", label: "F1 score", bar: "bg-intel/80" },
  { key: "rocAuc", label: "ROC-AUC", bar: "bg-intel/60" },
];

export function ModelPerformanceView() {
  const mp: ModelPerformance = MODEL_PERFORMANCE;
  const cm = mp.confusionMatrix;

  /* Misclassification exposure, computed from counts × cost assumptions. */
  const fpExposure = cm.falsePositives * mp.costAssumptions.falsePositiveCostPerCase;
  const fnExposure = cm.falseNegatives * mp.costAssumptions.falseNegativeCostPerCase;

  const matrixCells = [
    {
      abbr: "TP",
      label: "True positive",
      count: cm.truePositives,
      bg: "bg-risk-low/8",
      numTone: "text-risk-low",
      desc: "correctly blocked fraud",
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
      desc: "fraud missed — direct loss",
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
    { label: "Model version", value: mp.modelVersion },
    { label: "Trained", value: mp.trainedAt },
    { label: "Training dataset", value: mp.trainingDataset },
    { label: "Evaluation dataset", value: mp.evaluationDataset },
    { label: "Decision threshold", value: `score ≥ ${mp.threshold}` },
    { label: "Note", value: mp.note, note: true },
  ];

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
        <span className="micro-11 rounded-sm border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-amber-300">
          DEMO ENGINE BENCHMARK — not production ML performance
        </span>
      </motion.header>

      {/* Demo disclaimer — values are mock evaluation data, never presented as live */}
      {mp.isDemoSnapshot && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.06, duration: 0.35, ease: "easeOut" }}
          role="note"
          className="mb-6 flex items-center gap-2.5 rounded-sm border border-risk-medium/30 bg-risk-medium/8 px-4 py-2.5"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-risk-medium" aria-hidden />
          <p className="text-[12px] text-risk-medium/90">
            Demo snapshot — these are mock evaluation values for the Buildathon demo, not live
            production metrics. Replace via{" "}
            <span className="font-mono text-[11px] tracking-tight">GET /model/performance</span>.
          </p>
        </motion.div>
      )}

      {/* Score metrics */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Model score metrics">
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

      {/* Confusion matrix + cost of errors */}
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
              Evaluated: {formatNumber(cm.totalEvaluated)} transactions · decision threshold: score ≥{" "}
              {mp.threshold}
            </p>
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.42, duration: 0.35, ease: "easeOut" }}
          className="panel overflow-hidden"
          aria-label="Cost of errors"
        >
          <div className="border-b border-line px-4 py-3">
            <h2 className="micro-11 font-semibold text-slate-200">Cost of errors</h2>
          </div>
          <div className="p-4">
            <div className="space-y-4">
              <div>
                <p className="micro text-slate-500">False positive cost</p>
                <p className="mt-1.5 flex items-baseline gap-1.5">
                  <span className="num text-[22px] font-semibold text-risk-medium">
                    {formatINR(mp.costAssumptions.falsePositiveCostPerCase)}
                  </span>
                  <span className="text-[11.5px] text-slate-500">per case</span>
                </p>
                <p className="mt-1 text-[11.5px] text-slate-500">
                  Average manual-review operations cost per wrongly flagged legitimate transaction.
                </p>
              </div>
              <div>
                <p className="micro text-slate-500">False negative cost</p>
                <p className="mt-1.5 flex items-baseline gap-1.5">
                  <span className="num text-[22px] font-semibold text-risk-critical">
                    {formatINR(mp.costAssumptions.falseNegativeCostPerCase)}
                  </span>
                  <span className="text-[11.5px] text-slate-500">per case</span>
                </p>
                <p className="mt-1 text-[11.5px] text-slate-500">
                  Average fraud loss per missed fraudulent transaction.
                </p>
              </div>
            </div>
            <p className="num mt-4 border-t border-line pt-3 text-[11px] text-slate-500">
              Estimated misclassification exposure: FP {formatINR(fpExposure)} · FN{" "}
              {formatINR(fnExposure)} per evaluation window
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
    </div>
  );
}
