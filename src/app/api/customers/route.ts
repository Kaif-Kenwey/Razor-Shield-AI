/**
 * /api/customers — customer directory with derived statistics.
 *
 * GET — paginated profiles calculated live from the ledger: ticket
 *       averages/medians, usual device and location, incident counts and
 *       risk roll-ups. Nothing about a customer is stored twice.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, paginationMeta, paginationSchema } from "@/lib/server/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsedPagination = paginationSchema.safeParse({
    page: url.searchParams.get("page") ?? undefined,
    pageSize: url.searchParams.get("pageSize") ?? undefined,
  });
  const { page, pageSize } = parsedPagination.success
    ? parsedPagination.data
    : { page: 1, pageSize: 25 };
  const search = url.searchParams.get("q")?.trim();

  const where = search
    ? { OR: [{ id: { contains: search } }, { name: { contains: search } }] }
    : {};

  const [total, customers] = await Promise.all([
    db.customer.count({ where }),
    db.customer.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        transactions: {
          orderBy: { timestamp: "desc" },
          select: { amount: true, riskScore: true, riskLevel: true, device: true, location: true, paymentMethod: true, timestamp: true, status: true },
        },
      },
    }),
  ]);

  const profiles = customers.map((c) => {
    const txns = c.transactions;
    const amounts = txns.map((t) => t.amount).sort((a, b) => a - b);
    const median = amounts.length
      ? amounts.length % 2
        ? amounts[(amounts.length - 1) / 2]
        : (amounts[amounts.length / 2 - 1] + amounts[amounts.length / 2]) / 2
      : 0;
    const flagged = txns.filter((t) => t.riskLevel === "HIGH" || t.riskLevel === "CRITICAL").length;
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

    return {
      id: c.id,
      name: c.name,
      kycTier: c.kycTier,
      riskProfile: c.riskProfile,
      priorIncidents: c.priorIncidents,
      transactionCount: txns.length,
      avgTransaction: amounts.length ? Math.round(amounts.reduce((s, a) => s + a, 0) / amounts.length) : 0,
      medianTransaction: Math.round(median),
      flaggedCount: flagged,
      flaggedRate: txns.length ? flagged / txns.length : 0,
      avgRiskScore: txns.length ? Math.round(txns.reduce((s, t) => s + t.riskScore, 0) / txns.length) : 0,
      usualDevice: top(deviceCounts),
      usualLocation: top(locationCounts),
      usualMethod: top(methodCounts),
      lastSeen: txns[0]?.timestamp.toISOString() ?? null,
      openCases: txns.filter((t) => ["INVESTIGATING", "UNDER_REVIEW"].includes(t.status)).length,
    };
  });

  profiles.sort((a, b) => b.avgRiskScore - a.avgRiskScore);

  return NextResponse.json({ ok: true, customers: profiles, pagination: paginationMeta(total, page, pageSize) });
}
