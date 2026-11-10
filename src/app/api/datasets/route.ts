/**
 * GET /api/datasets — list recent analysis runs (summaries, no rows).
 *
 * Tenant-scoped: only datasets created by the authenticated session's
 * organisation are listed. Requires "datasets:read".
 */

import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import type { DatasetSummary } from "@/types/dataset";
import { requirePermission } from "@/lib/server/auth/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requirePermission(request, "datasets:read");
  if (!auth.ok) return auth.response;
  const { organisationId } = auth.value;

  const datasets = await db.dataset.findMany({
    where: { organisationId },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: {
      id: true,
      name: true,
      sourceFile: true,
      rowCount: true,
      flaggedCount: true,
      labelsPresent: true,
      precision: true,
      recall: true,
      f1: true,
      fpCost: true,
      createdAt: true,
    },
  });

  const summaries: DatasetSummary[] = datasets.map((d) => ({
    id: d.id,
    name: d.name,
    sourceFile: d.sourceFile,
    rowCount: d.rowCount,
    flaggedCount: d.flaggedCount,
    labelsPresent: d.labelsPresent,
    precision: d.precision,
    recall: d.recall,
    f1: d.f1,
    falsePositiveCost: d.fpCost,
    createdAt: d.createdAt.toISOString(),
  }));

  return NextResponse.json({ datasets: summaries });
}
