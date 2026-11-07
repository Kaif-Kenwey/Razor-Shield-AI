/**
 * /api/customers/:id — one customer profile, fully derived from the
 * stored ledger.
 *
 * Lifetime statistics (count, average, max, flagged counts, device and
 * location discovery) come from SQL aggregates over the WHOLE history —
 * never from a truncated sample presented as lifetime truth (review
 * fix). Only the DISPLAYED history is limited: a 40-row chart sample
 * plus the 25 most recent transactions for the timeline.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, toUiTransaction } from "@/lib/server/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

const OPEN_STATUSES = ["INVESTIGATING", "UNDER_REVIEW"];

export async function GET(request: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  /* Optional time-awareness: `before` (ISO) bounds every aggregate and the
   * history to rows at or before that moment — the case view uses the
   * transaction's own timestamp so the panel shows what the engine knew. */
  const beforeRaw = new URL(request.url).searchParams.get("before");
  const beforeDate = beforeRaw ? new Date(beforeRaw) : null;
  const before = beforeDate && !Number.isNaN(beforeDate.getTime()) ? beforeDate : null;
  const timeWhere = before ? { timestamp: { lte: before } } : {};

  const customer = await db.customer.findUnique({ where: { id } });

  /* Lifetime aggregates — bounded result sets, never full-table loads. */
  const [lifeAgg, flaggedAgg, openAgg, devices, locations, methods, firstRow] = await Promise.all([
    db.transaction.aggregate({
      where: { customerId: id, ...timeWhere },
      _count: { _all: true },
      _avg: { amount: true, riskScore: true },
      _max: { amount: true },
    }),
    db.transaction.count({ where: { customerId: id, riskLevel: { in: ["HIGH", "CRITICAL"] }, ...timeWhere } }),
    db.transaction.count({ where: { customerId: id, status: { in: OPEN_STATUSES }, ...timeWhere } }),
    db.transaction.findMany({
      where: { customerId: id, device: { not: "" }, ...timeWhere },
      select: { device: true },
      distinct: ["device"],
      take: 20,
    }),
    db.transaction.findMany({
      where: { customerId: id, location: { not: "" }, ...timeWhere },
      select: { location: true },
      distinct: ["location"],
      take: 20,
    }),
    db.transaction.groupBy({
      by: ["paymentMethod"],
      where: { customerId: id, ...timeWhere },
      _count: { _all: true },
    }),
    db.transaction.findFirst({
      where: { customerId: id, ...timeWhere },
      orderBy: { timestamp: "asc" },
      select: { timestamp: true, customerName: true },
    }),
  ]);

  if (!customer && lifeAgg._count._all === 0) {
    return jsonError("Customer not found", 404);
  }

  /* Displayed history only — chart sample (40) + recent list (25). */
  const [chartRows, recentRows] = await Promise.all([
    db.transaction.findMany({
      where: { customerId: id, ...timeWhere },
      orderBy: { timestamp: "desc" },
      take: 40,
      select: { timestamp: true, amount: true, riskScore: true, riskLevel: true, id: true },
    }),
    db.transaction.findMany({
      where: { customerId: id },
      orderBy: { timestamp: "desc" },
      take: 25,
      include: { investigation: true },
    }),
  ]);

  /* Median over a recent tail sample — labelled as such in the UI. */
  const tail = chartRows.map((t) => t.amount).sort((a, b) => a - b);
  const median = tail.length
    ? tail.length % 2
      ? tail[(tail.length - 1) / 2]
      : (tail[tail.length / 2 - 1] + tail[tail.length / 2]) / 2
    : 0;

  const usualDevice = devices[0]?.device ?? "";
  const usualLocation = locations[0]?.location ?? "";
  const usualMethod =
    [...methods].sort((a, b) => b._count._all - a._count._all)[0]?.paymentMethod ?? "";

  const txCount = lifeAgg._count._all;
  const lastSeen = chartRows[0]?.timestamp.toISOString() ?? null;

  return NextResponse.json({
    ok: true,
    customer: {
      id,
      name: customer?.name || recentRows[0]?.customerName || firstRow?.customerName || id,
      kycTier: customer?.kycTier ?? "MIN KYC",
      riskProfile: customer?.riskProfile ?? "normal",
      priorIncidents: customer?.priorIncidents ?? 0,
      accountCreated: customer?.createdAt.toISOString() ?? firstRow?.timestamp.toISOString() ?? null,
      firstSeen: firstRow?.timestamp.toISOString() ?? null,
      lastSeen,
      transactionCount: txCount,
      avgTransaction: Math.round(lifeAgg._avg.amount ?? 0),
      medianTransaction: Math.round(median),
      maxTransaction: Math.round(lifeAgg._max.amount ?? 0),
      avgRiskScore: Math.round(lifeAgg._avg.riskScore ?? 0),
      flaggedCount: flaggedAgg,
      flaggedRate: txCount ? flaggedAgg / txCount : 0,
      openCases: openAgg,
      knownDevices: devices.map((d) => d.device),
      usualLocations: locations.map((l) => l.location),
      usualDevice,
      usualLocation,
      usualMethod,
      methodMix: Object.fromEntries(methods.map((m) => [m.paymentMethod || "Unknown", m._count._all])),
    },
    history: chartRows
      .slice()
      .reverse()
      .map((t) => ({
        label: t.timestamp.toISOString().slice(5, 16).replace("T", " "),
        amount: t.amount,
        riskScore: Math.round(t.riskScore),
        flagged: t.riskLevel === "HIGH" || t.riskLevel === "CRITICAL",
        txnId: t.id,
      })),
    transactions: recentRows.map(toUiTransaction),
  });
}
