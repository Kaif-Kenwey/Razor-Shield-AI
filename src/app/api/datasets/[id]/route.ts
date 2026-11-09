/**
 * GET    /api/datasets/:id — full stored analysis (rows ordered flag-first).
 * DELETE /api/datasets/:id — remove a stored analysis (rows cascade).
 */

import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { ENGINE_VERSION } from "@/lib/riskEngine";
import type { DatasetAnalysis, ScoredRow } from "@/types/dataset";
import type { RiskLevel } from "@/types";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;

  const dataset = await db.dataset.findUnique({
    where: { id },
    include: {
      rows: { orderBy: [{ riskScore: "desc" }, { rowIndex: "asc" }] },
    },
  });

  if (!dataset) {
    return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
  }

  const rows: ScoredRow[] = dataset.rows.map((r) => ({
    index: r.rowIndex,
    txnId: r.txnId,
    amount: r.amount,
    timestamp: r.timestamp,
    customerId: r.customerId,
    customerName: r.customerName,
    merchant: r.merchant,
    location: r.location,
    device: r.device,
    paymentMethod: r.paymentMethod,
    label: r.label === null ? null : (r.label as 0 | 1),
    riskScore: r.riskScore,
    riskLevel: r.riskLevel as RiskLevel,
    recommendation: r.recommendation as ScoredRow["recommendation"],
    signals: JSON.parse(r.signalsJson || "[]"),
    outcome: (r.outcome as ScoredRow["outcome"]) ?? undefined,
    warnings: JSON.parse(r.warnings || "[]"),
  }));

  // aggregate analytics are derived from stored rows (single source of truth)
  const counts = new Map<string, number>();
  for (const r of rows) {
    for (const s of r.signals) counts.set(s.type, (counts.get(s.type) ?? 0) + 1);
  }
  const SIGNAL_LABELS: Record<string, string> = {
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
  const topSignals = [...counts.entries()]
    .map(([type, count]) => ({ type, label: SIGNAL_LABELS[type] ?? type, count }))
    .sort((a, b) => b.count - a.count);

  const histogram = Array.from({ length: 10 }, (_, i) => ({
    bucket: `${i * 10}-${i === 9 ? 100 : i * 10 + 9}`,
    count: 0,
  }));
  for (const r of rows) histogram[Math.min(9, Math.floor(r.riskScore / 10))].count += 1;

  const levels: RiskLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
  const levelDistribution = levels.map((level) => ({
    level,
    count: rows.filter((r) => r.riskLevel === level).length,
  }));

  const analysis: DatasetAnalysis = {
    id: dataset.id,
    name: dataset.name,
    sourceFile: dataset.sourceFile,
    rowCount: dataset.rowCount,
    skippedCount: dataset.skippedCount,
    flaggedCount: dataset.flaggedCount,
    avgScore: dataset.avgScore,
    createdAt: dataset.createdAt.toISOString(),
    engineVersion: dataset.engineVersion || ENGINE_VERSION,
    rows,
    metrics: {
      labelsPresent: dataset.labelsPresent,
      labeledCount: dataset.labeledCount,
      truePositives: dataset.truePositives,
      falsePositives: dataset.falsePositives,
      falseNegatives: dataset.falseNegatives,
      trueNegatives: dataset.trueNegatives,
      precision: dataset.precision,
      recall: dataset.recall,
      f1: dataset.f1,
      falsePositiveCost: dataset.fpCost,
      falseNegativeCost: dataset.fnCost,
      flaggedValue: dataset.flaggedValue,
      catchRateAtBlock: 0,
    },
    topSignals,
    scoreHistogram: histogram,
    levelDistribution,
  };

  return NextResponse.json({ analysis });
}

export async function DELETE(_request: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;

  const existing = await db.dataset.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
  }

  await db.dataset.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
