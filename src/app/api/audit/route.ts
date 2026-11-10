/**
 * /api/audit — the persisted audit trail (tenant-scoped).
 *
 * GET — paginated audit events for the authenticated organisation,
 *       newest first. Optional filters: actor, action, entity.
 *       Requires "audit:read" — the full trail is deliberately
 *       auditor/manager-facing, not every viewer's.
 */

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { jsonError, paginationMeta, paginationSchema } from "@/lib/server/ledger";
import { requirePermission } from "@/lib/server/auth/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requirePermission(request, "audit:read");
  if (!auth.ok) return auth.response;
  const { organisationId } = auth.value;

  const url = new URL(request.url);
  const parsedPagination = paginationSchema.safeParse({
    page: url.searchParams.get("page") ?? undefined,
    pageSize: url.searchParams.get("pageSize") ?? undefined,
  });
  const { page, pageSize } = parsedPagination.success
    ? parsedPagination.data
    : { page: 1, pageSize: 40 };

  const actor = url.searchParams.get("actor");
  const action = url.searchParams.get("action");
  const entityId = url.searchParams.get("entityId");
  const transactionId = url.searchParams.get("transactionId");

  /* Tenant scope is NOT optional and never filterable by the client —
   * every query is pinned to the caller's organisation. */
  const where: Prisma.AuditEventWhereInput = { organisationId };
  if (actor) where.actor = actor;
  if (action) where.action = action;
  if (entityId) where.entityId = entityId;
  if (transactionId) {
    /* Audit rows store the transaction's surrogate id; the client sends
     * the external id. Resolve within the tenant, non-disclosing. */
    const txn = await db.transaction.findFirst({
      where: { organisationId, externalId: transactionId },
      select: { id: true },
    });
    where.transactionId = txn?.id ?? "__none__";
  }

  const [total, events] = await Promise.all([
    db.auditEvent.count({ where }),
    db.auditEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return NextResponse.json({
    ok: true,
    events: events.map((e) => ({
      id: e.id,
      time: e.createdAt.toISOString(),
      actor: e.actorName ?? e.actor,
      actorType: e.actorType,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      detail: e.detailJson === "{}" ? undefined : safeParse(e.detailJson),
      transactionId: e.transactionId,
    })),
    pagination: paginationMeta(total, page, pageSize),
  });
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
