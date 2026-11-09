/**
 * POST /api/datasets/analyze
 *
 * Scores an uploaded batch of payment records with the deterministic risk
 * engine (rse-1.2), computes honest quality metrics when ground-truth labels
 * are present, persists the run to SQLite, and returns the full analysis.
 */

import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import {
  ENGINE_VERSION,
  scoreBatch,
  type EngineInput,
} from "@/lib/riskEngine";
import { labelValue, parseAmount, parseTimestamp } from "@/lib/csv";
import type { ColumnMapping, DatasetAnalysis, RawRow, ScoredRow } from "@/types/dataset";
import { DATASET_LIMITS } from "@/types/dataset";

export const runtime = "nodejs";
export const maxDuration = 60;

/* ------------------------------------------------------------------ */

interface Normalized {
  inputs: EngineInput[];
  skippedCount: number;
  warningsByIndex: Map<number, string[]>;
}

function normalizeRows(
  rows: RawRow[],
  mapping: ColumnMapping,
): Normalized {
  const inputs: EngineInput[] = [];
  const warningsByIndex = new Map<number, string[]>();
  let skipped = 0;

  const pick = (row: RawRow, field: keyof ColumnMapping): string => {
    const col = mapping[field];
    return col ? (row[col] ?? "").trim() : "";
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const warnings: string[] = [];

    const amount = parseAmount(pick(row, "amount"));
    if (amount === null) {
      // A record without a usable amount cannot be scored — skip honestly.
      skipped += 1;
      continue;
    }

    const rawTs = pick(row, "timestamp");
    let at: number | null = null;
    if (rawTs) {
      at = parseTimestamp(rawTs);
      if (at === null) warnings.push(`Unparsable timestamp "${rawTs}" — time rules skipped`);
    }

    const rawLabel = pick(row, "label");
    let label: 0 | 1 | null = null;
    if (rawLabel) {
      label = labelValue(rawLabel);
      if (label === null) warnings.push(`Unrecognized label "${rawLabel}" — treated as unlabeled`);
    }

    const txnId = pick(row, "txnId") || `IMP-${String(i + 1).padStart(5, "0")}`;

    inputs.push({
      index: i,
      txnId,
      amount,
      at,
      customerId: pick(row, "customerId") || `ANON-${txnId}`,
      customerName: pick(row, "customerName"),
      merchant: pick(row, "merchant"),
      location: pick(row, "location"),
      device: pick(row, "device"),
      paymentMethod: pick(row, "paymentMethod"),
      label,
    });
    if (warnings.length) warningsByIndex.set(i, warnings);
  }

  return { inputs, skippedCount: skipped, warningsByIndex };
}

/* ------------------------------------------------------------------ */

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad("Request body is not valid JSON");
  }

  const { name, sourceFile, rows, mapping } = (body ?? {}) as {
    name?: unknown;
    sourceFile?: unknown;
    rows?: unknown;
    mapping?: unknown;
  };

  if (typeof name !== "string" || !name.trim()) return bad("`name` is required");
  if (typeof sourceFile !== "string") return bad("`sourceFile` is required");
  if (!Array.isArray(rows) || rows.length === 0) return bad("`rows` must be a non-empty array");
  if (rows.length > DATASET_LIMITS.maxRows) {
    return bad(`Batch too large: ${rows.length} rows exceeds the ${DATASET_LIMITS.maxRows}-row limit`);
  }
  if (typeof mapping !== "object" || mapping === null) return bad("`mapping` is required");

  const { inputs, skippedCount, warningsByIndex } = normalizeRows(
    rows as RawRow[],
    mapping as ColumnMapping,
  );

  if (!inputs.length) {
    return bad("No scoreable rows found — check the amount column mapping");
  }

  const batch = scoreBatch(inputs);

  // attach per-row warnings; flag-first ordering so the dashboard leads with
  // the interesting rows (matches the stored-run view)
  const rowsOut: ScoredRow[] = batch.rows
    .map((r) => ({
      ...r,
      warnings: warningsByIndex.get(r.index) ?? [],
    }))
    .sort((a, b) => b.riskScore - a.riskScore || a.index - b.index);

  const flaggedCount = rowsOut.filter((r) => r.recommendation !== "ALLOW").length;
  const avgScore = rowsOut.reduce((s, r) => s + r.riskScore, 0) / rowsOut.length;

  // persist (rows chunked to keep SQLite parameter counts sane)
  const created = await db.dataset.create({
    data: {
      name: name.trim().slice(0, 120),
      sourceFile: sourceFile.slice(0, 200),
      engineVersion: ENGINE_VERSION,
      rowCount: rowsOut.length,
      skippedCount,
      flaggedCount,
      avgScore,
      flaggedValue: batch.metrics.flaggedValue,
      labelsPresent: batch.metrics.labelsPresent,
      labeledCount: batch.metrics.labeledCount,
      truePositives: batch.metrics.truePositives,
      falsePositives: batch.metrics.falsePositives,
      falseNegatives: batch.metrics.falseNegatives,
      trueNegatives: batch.metrics.trueNegatives,
      precision: batch.metrics.precision,
      recall: batch.metrics.recall,
      f1: batch.metrics.f1,
      fpCost: batch.metrics.falsePositiveCost,
      fnCost: batch.metrics.falseNegativeCost,
    },
  });

  const CHUNK = 400;
  for (let i = 0; i < rowsOut.length; i += CHUNK) {
    await db.datasetRow.createMany({
      data: rowsOut.slice(i, i + CHUNK).map((r) => ({
        datasetId: created.id,
        rowIndex: r.index,
        txnId: r.txnId.slice(0, 64),
        amount: r.amount,
        timestamp: r.timestamp,
        customerId: r.customerId.slice(0, 64),
        customerName: r.customerName.slice(0, 120),
        merchant: r.merchant.slice(0, 120),
        location: r.location.slice(0, 64),
        device: r.device.slice(0, 120),
        paymentMethod: r.paymentMethod.slice(0, 40),
        label: r.label,
        riskScore: r.riskScore,
        riskLevel: r.riskLevel,
        recommendation: r.recommendation,
        signalsJson: JSON.stringify(r.signals),
        outcome: r.outcome ?? null,
        warnings: JSON.stringify(r.warnings),
      })),
    });
  }

  const analysis: DatasetAnalysis = {
    id: created.id,
    name: created.name,
    sourceFile: created.sourceFile,
    rowCount: created.rowCount,
    skippedCount,
    flaggedCount,
    avgScore,
    createdAt: created.createdAt.toISOString(),
    engineVersion: ENGINE_VERSION,
    rows: rowsOut,
    metrics: batch.metrics,
    topSignals: batch.topSignals,
    scoreHistogram: batch.scoreHistogram,
    levelDistribution: batch.levelDistribution,
  };

  return NextResponse.json({ analysis }, { status: 201 });
}
