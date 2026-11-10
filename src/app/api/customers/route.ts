/**
 * /api/customers — customer directory with derived statistics (tenant-scoped).
 *
 * Every query is bounded to the authenticated session's organisation.
 * The UI-facing customer id is the EXTERNAL customer code (unique per
 * tenant); the surrogate row id never leaves the server.
 *
 * GET — paginated profiles calculated live from the ledger. Lifetime
 *       numbers (transaction count, averages, flagged counts, open
 *       cases, last-seen) come from bounded SQL groupBy/aggregate
 *       queries — NOT from loading every transaction per customer
 *       (review fix). Only a small recent sample per displayed customer
 *       (last 25 rows) feeds the "usual device/location/method" modes
 *       and the median, so memory stays flat as the ledger grows.
 *       Requires "transactions:read".
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { paginationMeta, paginationSchema } from "@/lib/server/ledger";
import { requirePermission } from "@/lib/server/auth/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPEN_STATUSES = ["INVESTIGATING", "UNDER_REVIEW"];

export async function GET(request: Request) {
  const auth = await requirePermission(request, "transactions:read");
  if (!auth.ok) return auth.response;
  const { organisationId } = auth.value;

  const url = new URL(request.url);
  const parsedPagination = paginationSchema.safeParse({
    page: url.searchParams.get("page") ?? undefined,
    pageSize: url.searchParams.get("pageSize") ?? undefined,
  });
  const { page, pageSize } = parsedPagination.success
    ? parsedPagination.data
    : { page: 1, pageSize: 25 };
  const search = url.searchParams.get("q")?.trim();

  /* Tenant scope is NOT optional and never filterable by the client. */
  const where = search
    ? {
        organisationId,
        OR: [{ externalId: { contains: search } }, { name: { contains: search } }],
      }
    : { organisationId };

  const [total, customers] = await Promise.all([
    db.customer.count({ where }),
    db.customer.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const ids = customers.map((c) => c.id);
  const emptyIds = ids.length === 0;

  /* Lifetime statistics straight from SQL — bounded by the page's ids.
   * Every transaction query is pinned to the organisation as well. */
  const [lifeStats, flaggedStats, openStats, lastSeenStats] = emptyIds
    ? [[], [], [], []]
    : await Promise.all([
        db.transaction.groupBy({
          by: ["customerId"],
          where: { organisationId, customerId: { in: ids } },
          _count: { _all: true },
          _avg: { amount: true, riskScore: true },
        }),
        db.transaction.groupBy({
          by: ["customerId"],
          where: { organisationId, customerId: { in: ids }, riskLevel: { in: ["HIGH", "CRITICAL"] } },
          _count: { _all: true },
        }),
        db.transaction.groupBy({
          by: ["customerId"],
          where: { organisationId, customerId: { in: ids }, status: { in: OPEN_STATUSES } },
          _count: { _all: true },
        }),
        db.transaction.groupBy({
          by: ["customerId"],
          where: { organisationId, customerId: { in: ids } },
          _max: { timestamp: true },
        }),
      ]);

  /* Small recent sample per displayed customer — usual device/location/
   * method and median are presentation-level stats over the tail, not
   * lifetime claims. Bounded: pageSize × 25 rows max. */
  const samples = emptyIds
    ? new Map<string, { amount: number; device: string; location: string; paymentMethod: string; timestamp: Date }[]>()
    : new Map(
        (
          await Promise.all(
            ids.map((id) =>
              db.transaction.findMany({
                where: { organisationId, customerId: id },
                orderBy: { timestamp: "desc" },
                take: 25,
                select: {
                  amount: true,
                  device: true,
                  location: true,
                  paymentMethod: true,
                  timestamp: true,
                },
              }),
            ),
          )
        ).map((rows, i) => [ids[i], rows]),
      );

  const life = new Map(lifeStats.map((r) => [r.customerId, r]));
  const flagged = new Map(flaggedStats.map((r) => [r.customerId, r._count._all]));
  const open = new Map(openStats.map((r) => [r.customerId, r._count._all]));
  const seen = new Map(lastSeenStats.map((r) => [r.customerId, r._max.timestamp]));

  const profiles = customers.map((c) => {
    const txns = samples.get(c.id) ?? [];
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

    const stat = life.get(c.id);
    const txCount = stat?._count._all ?? 0;
    const flaggedCount = flagged.get(c.id) ?? 0;

    return {
      /* The UI speaks EXTERNAL customer ids — the surrogate key never leaves the server. */
      id: c.externalId,
      name: c.name,
      kycTier: c.kycTier,
      riskProfile: c.riskProfile,
      priorIncidents: c.priorIncidents,
      transactionCount: txCount,
      avgTransaction: Math.round(stat?._avg.amount ?? 0),
      medianTransaction: Math.round(median),
      flaggedCount,
      flaggedRate: txCount ? flaggedCount / txCount : 0,
      avgRiskScore: Math.round(stat?._avg.riskScore ?? 0),
      usualDevice: top(deviceCounts),
      usualLocation: top(locationCounts),
      usualMethod: top(methodCounts),
      lastSeen: seen.get(c.id)?.toISOString() ?? null,
      openCases: open.get(c.id) ?? 0,
    };
  });

  profiles.sort((a, b) => b.avgRiskScore - a.avgRiskScore);

  return NextResponse.json({ ok: true, customers: profiles, pagination: paginationMeta(total, page, pageSize) });
}
