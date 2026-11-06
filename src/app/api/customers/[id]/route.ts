/**
 * /api/customers/:id — one customer profile, fully derived from the
 * stored ledger: history, devices, locations, method mix and rolling
 * statistics. Includes the recent transaction list for the timeline.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, toUiTransaction } from "@/lib/server/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;

  const customer = await db.customer.findUnique({ where: { id } });
  const txns = await db.transaction.findMany({
    where: { customerId: id },
    orderBy: { timestamp: "desc" },
    take: 200,
    include: { investigation: true },
  });

  if (!customer && txns.length === 0) {
    return jsonError("Customer not found", 404);
  }

  const amounts = txns.map((t) => t.amount).sort((a, b) => a - b);
  const median = amounts.length
    ? amounts.length % 2
      ? amounts[(amounts.length - 1) / 2]
      : (amounts[amounts.length / 2 - 1] + amounts[amounts.length / 2]) / 2
    : 0;
  const deviceCounts = new Map<string, number>();
  const locationCounts = new Map<string, number>();
  const methodCounts = new Map<string, number>();
  for (const t of txns) {
    if (t.device) deviceCounts.set(t.device, (deviceCounts.get(t.device) ?? 0) + 1);
    if (t.location) locationCounts.set(t.location, (locationCounts.get(t.location) ?? 0) + 1);
    if (t.paymentMethod) methodCounts.set(t.paymentMethod, (methodCounts.get(t.paymentMethod) ?? 0) + 1);
  }
  const top = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";

  const flagged = txns.filter((t) => t.riskLevel === "HIGH" || t.riskLevel === "CRITICAL");

  return NextResponse.json({
    ok: true,
    customer: {
      id,
      name: customer?.name || txns[0]?.customerName || id,
      kycTier: customer?.kycTier ?? "MIN KYC",
      riskProfile: customer?.riskProfile ?? "normal",
      priorIncidents: customer?.priorIncidents ?? 0,
      accountCreated: customer?.createdAt.toISOString() ?? txns[txns.length - 1]?.timestamp.toISOString() ?? null,
      firstSeen: txns[txns.length - 1]?.timestamp.toISOString() ?? null,
      lastSeen: txns[0]?.timestamp.toISOString() ?? null,
      transactionCount: txns.length,
      avgTransaction: amounts.length ? Math.round(amounts.reduce((s, a) => s + a, 0) / amounts.length) : 0,
      medianTransaction: Math.round(median),
      maxTransaction: amounts.length ? Math.round(amounts[amounts.length - 1]) : 0,
      avgRiskScore: txns.length ? Math.round(txns.reduce((s, t) => s + t.riskScore, 0) / txns.length) : 0,
      flaggedCount: flagged.length,
      flaggedRate: txns.length ? flagged.length / txns.length : 0,
      openCases: txns.filter((t) => ["INVESTIGATING", "UNDER_REVIEW"].includes(t.status)).length,
      knownDevices: [...deviceCounts.keys()],
      usualLocations: [...locationCounts.keys()],
      usualDevice: top(deviceCounts),
      usualLocation: top(locationCounts),
      usualMethod: top(methodCounts),
      methodMix: Object.fromEntries(methodCounts),
    },
    history: txns
      .slice()
      .reverse()
      .map((t) => ({
        label: t.timestamp.toISOString().slice(5, 16).replace("T", " "),
        amount: t.amount,
        riskScore: Math.round(t.riskScore),
        flagged: t.riskLevel === "HIGH" || t.riskLevel === "CRITICAL",
        txnId: t.id,
      })),
    transactions: txns.slice(0, 25).map(toUiTransaction),
  });
}
