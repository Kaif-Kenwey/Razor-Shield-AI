/**
 * /api/audit — the persisted audit trail.
 *
 * GET — paginated audit events, newest first. Optional filters: actor,
 *       action, entity. This is what the UI's audit surfaces read — the
 *       trail survives transaction deletion (rows are SetNull-linked).
 */

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
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
    : { page: 1, pageSize: 40 };

  const actor = url.searchParams.get("actor");
  const action = url.searchParams.get("action");
  const entityId = url.searchParams.get("entityId");
  const transactionId = url.searchParams.get("transactionId");

  const where: Prisma.AuditEventWhereInput = {};
  if (actor) where.actor = actor;
  if (action) where.action = action;
  if (entityId) where.entityId = entityId;
  if (transactionId) where.transactionId = transactionId;

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
      actor: e.actor,
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
