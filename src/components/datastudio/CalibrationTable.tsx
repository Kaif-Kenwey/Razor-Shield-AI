"use client";

/**
 * CALIBRATION TABLE — reliability of the score, by band.
 *
 * Groups labeled rows into four score bands and compares the engine's mean
 * score against the observed fraud rate from ground truth. A calibrated
 * score means "rows scored 75+ really are fraud most of the time". Rendered
 * only when the file carries labels — calibration cannot be claimed from
 * unlabeled data.
 */

import { useMemo } from "react";
import { Gauge } from "lucide-react";

import type { ScoredRow } from "@/types/dataset";
import { cn } from "@/lib/utils";

const BANDS: { label: string; min: number; max: number }[] = [
  { label: "0-24", min: 0, max: 24 },
  { label: "25-49", min: 25, max: 49 },
  { label: "50-74", min: 50, max: 74 },
  { label: "75-100", min: 75, max: 100 },
];

/** Minimum labeled rows before a band's rate means anything. */
const MIN_ROWS_PER_BAND = 8;

export function CalibrationTable({ rows }: { rows: ScoredRow[] }) {
  const bands = useMemo(() => {
    const labeled = rows.filter((r) => r.label !== null);
    return BANDS.map((band) => {
      const inBand = labeled.filter((r) => r.riskScore >= band.min && r.riskScore <= band.max);
      const meanScore = inBand.length
        ? inBand.reduce((s, r) => s + r.riskScore, 0) / inBand.length
        : 0;
      const observed = inBand.length
        ? (inBand.filter((r) => r.label === 1).length / inBand.length) * 100
        : 0;
      return {
        ...band,
        count: inBand.length,
        meanScore: Math.round(meanScore * 10) / 10,
        observed: Math.round(observed * 10) / 10,
        judged: inBand.length >= MIN_ROWS_PER_BAND,
        /** observed minus predicted — negative means over-confident. */
        gap: Math.round((observed - meanScore) * 10) / 10,
      };
    });
  }, [rows]);

  const takeaway = useMemo(() => {
    const judgable = bands.filter((b) => b.judged);
    const thin = bands.filter((b) => b.count > 0 && !b.judged);
    const overconfident = judgable.filter((b) => b.gap <= -15);
    const underconfident = judgable.filter((b) => b.gap >= 15);

    const parts: string[] = [];
    if (overconfident.length) {
      const b = overconfident[0];
      parts.push(
        `over-confident in the ${b.label} band — rows scored there were ${b.observed}% fraud vs a mean score of ${b.meanScore}`,
      );
    }
    if (underconfident.length) {
      const b = underconfident[0];
      parts.push(
        `under-confident in the ${b.label} band — ${b.observed}% fraud vs a mean score of ${b.meanScore}`,
      );
    }
    if (thin.length) {
      const b = thin[0];
      parts.push(
        `only ${b.count} labeled ${b.count === 1 ? "row" : "rows"} in the ${b.label} band — too few to judge`,
      );
    }
    if (!parts.length) {
      return judgable.length
        ? "Observed rates track predicted scores within ~15 points in every judgable band — roughly calibrated for what this sample can show."
        : "Too few labeled rows in every band to judge calibration.";
    }
    const head = judgable.length ? "Honest read: " : "";
    return `${head}${parts.join("; ")}.`;
  }, [bands]);

  return (
    <section className="panel p-4" aria-label="Calibration table">
      <p className="micro-11 flex items-center gap-1.5 font-semibold text-slate-200">
        <Gauge className="h-3.5 w-3.5 text-intel" aria-hidden />
        Reliability by score band
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[430px] text-left">
          <thead>
            <tr className="border-b border-line">
              {["Score band", "Rows", "Mean predicted score", "Observed fraud rate"].map((h) => (
                <th key={h} className="micro px-2 py-1.5 font-medium text-slate-500">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bands.map((b) => (
              <tr key={b.label} className="border-b border-line/50">
                <td className="num px-2 py-2 text-[11.5px] text-slate-300">{b.label}</td>
                <td className="num px-2 py-2 text-[11.5px] text-slate-300">{b.count}</td>
                <td className="num px-2 py-2 text-[11.5px] text-slate-300">{b.count ? b.meanScore : "—"}</td>
                <td className="num px-2 py-2 text-[11.5px]">
                  {b.count === 0 ? (
                    <span className="text-slate-600">no rows</span>
                  ) : (
                    <span
                      className={cn(
                        !b.judged
                          ? "text-slate-500"
                          : b.gap <= -15
                            ? "text-risk-medium"
                            : b.gap >= 15
                              ? "text-risk-low"
                              : "text-slate-300",
                      )}
                    >
                      {b.observed}%
                      {!b.judged && <span className="ml-1.5 text-[10px] text-slate-600">thin</span>}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="micro-11 mt-3 flex items-start gap-1.5 leading-relaxed text-slate-500">
        <Gauge className="mt-0.5 h-3 w-3 shrink-0 text-slate-600" aria-hidden />
        {takeaway} Predicted is the band&apos;s mean engine score; observed comes from ground-truth labels
        only — a calibration check, not a promise.
      </p>
    </section>
  );
}
