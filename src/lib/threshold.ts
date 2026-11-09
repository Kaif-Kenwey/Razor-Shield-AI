/**
 * RazorShield AI — operational threshold sweep.
 *
 * The engine recommends an action per row; the alert convention is
 * "anything not ALLOWED". This module answers the follow-up question a
 * real risk team asks: *where should the operational score cutoff sit?*
 *
 * For every candidate cutoff T (a row alerts when riskScore >= T) it
 * replays the labeled outcomes and re-prices both mistake types with the
 * SAME cost model the engine reports (frozen funds + ₹450 review ops per
 * false alarm; fraud loss per miss). The recommended cutoff is the one
 * that minimizes expected total cost — ties break toward higher recall.
 */

import { REVIEW_OPS_COST } from "./riskEngine";
import type { ScoredRow } from "@/types/dataset";

export interface ThresholdPoint {
  threshold: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  /** 0–100. */
  precision: number;
  /** 0–100. */
  recall: number;
  f1: number;
  /** Frozen funds + review ops on false alarms (INR). */
  fpCost: number;
  /** Fraud loss from missed rows (INR). */
  fnCost: number;
  /** fpCost + fnCost — the number to minimize (INR). */
  totalCost: number;
  /** Rows the cutoff alerts on = analyst review queue size. */
  reviewLoad: number;
}

const PCT = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);

export function thresholdSweep(rows: ScoredRow[], step = 5): ThresholdPoint[] {
  const labeled = rows.filter((r) => r.label !== null);
  const points: ThresholdPoint[] = [];

  for (let t = 5; t <= 95; t += step) {
    let tp = 0, fp = 0, fn = 0, tn = 0;
    let fpCost = 0, fnCost = 0;

    for (const r of labeled) {
      const alert = r.riskScore >= t;
      if (r.label === 1) {
        if (alert) tp += 1;
        else {
          fn += 1;
          fnCost += r.amount;
        }
      } else if (alert) {
        fp += 1;
        fpCost += r.amount + REVIEW_OPS_COST;
      } else {
        tn += 1;
      }
    }

    const precision = PCT(tp, tp + fp);
    const recall = PCT(tp, tp + fn);
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    points.push({
      threshold: t,
      tp, fp, fn, tn,
      precision,
      recall,
      f1,
      fpCost,
      fnCost,
      totalCost: fpCost + fnCost,
      reviewLoad: labeled.filter((r) => r.riskScore >= t).length,
    });
  }
  return points;
}

/** Cutoff with the lowest total cost; ties break toward higher recall. */
export function optimalThreshold(points: ThresholdPoint[]): ThresholdPoint | null {
  if (!points.length) return null;
  return points.reduce((best, p) => {
    const costDiff = p.totalCost - best.totalCost;
    if (costDiff < -0.5) return p;
    if (Math.abs(costDiff) <= 0.5 && p.recall > best.recall) return p;
    return best;
  }, points[0]);
}

/** The cutoff the engine effectively operates at today (min alerted score). */
export function engineDefaultCutoff(rows: ScoredRow[]): number | null {
  const alerted = rows.filter((r) => r.recommendation !== "ALLOW");
  if (!alerted.length) return null;
  return Math.min(...alerted.map((r) => r.riskScore));
}
