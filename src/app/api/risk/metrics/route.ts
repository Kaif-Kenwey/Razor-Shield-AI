/**
 * /api/risk/metrics — every dashboard statistic, computed live from the
 * stored ledger. No fabricated numbers: when the ledger is empty the
 * response says so and the UI renders the empty state.
 *
 * Honesty notes (review fixes):
 *   - `flaggedValue` is the rupee value of rows the engine scored HIGH or
 *     CRITICAL — flagged for review, NOT confirmed fraud.
 *   - `resolvedToday` counts rows that reached a resolved status in the
 *     last 24h, via its own query (it used to read a slice that excluded
 *     resolved rows entirely and could only ever return 0).
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { FLAG_THRESHOLD } from "@/lib/riskEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [total, agg, levelRows, statusRows, methodRows, merchantRows, recent, highRiskCustomers, investigations, resolvedRecently] =
    await Promise.all([
      db.transaction.count(),
      db.transaction.aggregate({ _sum: { amount: true }, _avg: { riskScore: true } }),
      db.transaction.groupBy({ by: ["riskLevel"], _count: { _all: true }, _sum: { amount: true } }),
      db.transaction.groupBy({ by: ["status"], _count: { _all: true } }),
      db.transaction.groupBy({ by: ["paymentMethod"], _count: { _all: true }, _sum: { amount: true } }),
      db.transaction.groupBy({
        by: ["merchant"],
        where: { riskLevel: { in: ["HIGH", "CRITICAL"] }, merchant: { not: "" } },
        _count: { _all: true },
        _sum: { amount: true },
        _avg: { riskScore: true },
        orderBy: { _count: { merchant: "desc" } },
        take: 8,
      }),
      db.transaction.findMany({
        where: { timestamp: { gte: since } },
        orderBy: { timestamp: "asc" },
        select: { timestamp: true, amount: true, riskScore: true, riskLevel: true },
      }),
      db.transaction.groupBy({
        by: ["customerId", "customerName"],
        where: { riskLevel: { in: ["HIGH", "CRITICAL"] } },
        _count: { _all: true },
        _avg: { riskScore: true },
        _sum: { amount: true },
        orderBy: { _avg: { riskScore: "desc" } },
        take: 6,
      }),
      db.transaction.findMany({
        where: { status: { in: ["INVESTIGATING", "UNDER_REVIEW"] } },
        select: { status: true, riskLevel: true, timestamp: true, updatedAt: true },
      }),
      /* Separate query: resolved rows were NOT part of the open-queue
       * slice above, so counting them from it always returned 0. */
      db.transaction.count({
        where: { status: { in: ["BLOCKED", "ALLOWED", "ON_HOLD"] }, updatedAt: { gte: since } },
      }),
    ]);

  const levelCount = (l: string) => levelRows.find((r) => r.riskLevel === l)?._count._all ?? 0;
  const highRisk = levelCount("HIGH") + levelCount("CRITICAL");
  /* Honest naming: this is the value the engine FLAGGED (score ≥ 28 →
   * MEDIUM and above enter the review flow), not confirmed fraud. */
  const flaggedValue = levelRows
    .filter((r) => r.riskLevel === "HIGH" || r.riskLevel === "CRITICAL")
    .reduce((s, r) => s + (r._sum.amount ?? 0), 0);

  /* Volume over the last 24h in 2-hour buckets, labelled for the chart. */
  const volumeBuckets: { label: string; count: number; value: number; flagged: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const end = new Date(Date.now() - i * 2 * 60 * 60 * 1000);
    const start = new Date(end.getTime() - 2 * 60 * 60 * 1000);
    const inBucket = recent.filter(
      (t) => t.timestamp >= start && t.timestamp < end,
    );
    volumeBuckets.push({
      label: `${String(start.getHours()).padStart(2, "0")}:00`,
      count: inBucket.length,
      value: Math.round(inBucket.reduce((s, t) => s + t.amount, 0)),
      flagged: inBucket.filter((t) => t.riskLevel === "HIGH" || t.riskLevel === "CRITICAL").length,
    });
  }

  const openQueue = investigations.filter((t) => t.status === "INVESTIGATING").length;
  const underReview = investigations.filter((t) => t.status === "UNDER_REVIEW").length;
  const resolvedToday = resolvedRecently;

  return NextResponse.json({
    ok: true,
    empty: total === 0,
    totals: {
      transactions: total,
      value: Math.round(agg._sum.amount ?? 0),
      highRisk,
      critical: levelCount("CRITICAL"),
      pendingInvestigations: openQueue + underReview,
      avgRiskScore: Math.round((agg._avg.riskScore ?? 0) * 10) / 10,
      /** HIGH+CRITICAL rupee value — flagged for review, not confirmed fraud. */
      flaggedValue: Math.round(flaggedValue),
      /** Engine score at/above which a row enters the review flow (MEDIUM). */
      flaggedThreshold: FLAG_THRESHOLD,
    },
    riskDistribution: (["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const).map((l) => ({
      level: l,
      count: levelCount(l),
      value: Math.round(levelRows.find((r) => r.riskLevel === l)?._sum.amount ?? 0),
    })),
    statusDistribution: statusRows.map((r) => ({ status: r.status, count: r._count._all })),
    byPaymentMethod: methodRows.map((r) => ({
      method: r.paymentMethod || "Unknown",
      count: r._count._all,
      value: Math.round(r._sum.amount ?? 0),
    })),
    volumeOverTime: volumeBuckets,
    topFlaggedMerchants: merchantRows.map((r) => ({
      merchant: r.merchant,
      flaggedCount: r._count._all,
      value: Math.round(r._sum.amount ?? 0),
      avgRiskScore: Math.round(r._avg.riskScore ?? 0),
    })),
    highRiskCustomers: highRiskCustomers.map((r) => ({
      customerId: r.customerId,
      customerName: r.customerName || r.customerId,
      flaggedCount: r._count._all,
      avgRiskScore: Math.round(r._avg.riskScore ?? 0),
      /** Rupee value of this customer's flagged rows — potential exposure. */
      flaggedValue: Math.round(r._sum.amount ?? 0),
    })),
    queue: {
      investigating: openQueue,
      underReview,
      resolvedToday,
    },
  });
}
