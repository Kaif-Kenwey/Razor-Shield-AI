/**
 * /api/model/performance — engine quality measured on LABELLED ledger rows
 * only (tenant-scoped). The rule engine is deterministic, not a trained
 * classifier: this endpoint reports how its thresholded recommendations
 * line up with the ground-truth labels that actually exist in the
 * authenticated organisation's ledger.
 *
 * When fewer than MIN_LABELED labelled rows are stored, the response says
 * `insufficientData` and the UI renders the honest empty state instead of
 * fabricated metrics. Requires "evaluation:read".
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ENGINE_VERSION, FLAG_THRESHOLD } from "@/lib/riskEngine";
import { requirePermission } from "@/lib/server/auth/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Below this many labelled rows, rates would be noise — say so instead. */
const MIN_LABELED = 12;

export async function GET(request: Request) {
  const auth = await requirePermission(request, "evaluation:read");
  if (!auth.ok) return auth.response;
  const { organisationId } = auth.value;

  const labeled = await db.transaction.findMany({
    where: { organisationId, label: { not: null } },
    select: { label: true, recommendation: true, riskScore: true, riskLevel: true, amount: true },
  });

  const totalTransactions = await db.transaction.count({ where: { organisationId } });
  /* The detection threshold is the ENGINE'S OWN definition — a row is
   * "predicted fraud" when it scores MEDIUM or above (FLAG_THRESHOLD =
   * 28), the exact band that enters the review flow. Every evaluation
   * surface (this endpoint, Dataset Studio, dashboard metrics) reads the
   * same constant so no view can quietly redefine "flagged". */
  const threshold = FLAG_THRESHOLD;

  if (labeled.length < MIN_LABELED) {
    return NextResponse.json({
      ok: true,
      insufficientData: true,
      labeledCount: labeled.length,
      minRequired: MIN_LABELED,
      totalTransactions,
      modelVersion: ENGINE_VERSION,
      note: "Deterministic rule engine — scores are not from a trained ML model. Import a labelled dataset (Dataset Studio → Import to ledger) to evaluate precision/recall on real stored rows.",
    });
  }

  let tp = 0, fp = 0, fn = 0, tn = 0;
  let fpValue = 0, fnValue = 0;
  for (const row of labeled) {
    const predictedFraud = row.riskScore >= threshold;
    const actualFraud = row.label === 1;
    if (predictedFraud && actualFraud) tp += 1;
    else if (predictedFraud && !actualFraud) {
      fp += 1;
      fpValue += row.amount;
    } else if (!predictedFraud && actualFraud) {
      fn += 1;
      fnValue += row.amount;
    } else tn += 1;
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return NextResponse.json({
    ok: true,
    insufficientData: false,
    modelVersion: ENGINE_VERSION,
    engineKind: "deterministic-rules",
    evaluatedAt: new Date().toISOString(),
    labeledCount: labeled.length,
    totalTransactions,
    threshold,
    precision: Math.round(precision * 1000) / 10,
    recall: Math.round(recall * 1000) / 10,
    f1: Math.round(f1 * 1000) / 10,
    confusionMatrix: {
      truePositives: tp,
      falsePositives: fp,
      falseNegatives: fn,
      trueNegatives: tn,
      totalEvaluated: labeled.length,
    },
    costAssumptions: {
      falsePositiveCostPerCase: 450,
      falseNegativeCostPerCase: Math.round(fnValue / Math.max(fn, 1)),
      currency: "INR",
    },
    note: 'Measured on the labelled rows currently stored in the ledger. "Detected" means the engine scored the row MEDIUM or above (score ≥ 28) — the same band it routes to review. Scores come from the deterministic rule engine (rse) — not a trained ML classifier.',
  });
}
