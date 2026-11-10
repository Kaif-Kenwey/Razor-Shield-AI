/**
 * /api/transactions/:id — one complete ledger record (tenant-scoped).
 *
 * `:id` is the EXTERNAL payment id, resolved within the authenticated
 * session's organisation. A transaction belonging to another tenant is
 * indistinguishable from a missing one (404) — non-disclosing by design.
 *
 * GET    — the transaction with customer profile, engine signals, stored
 *          investigation (if any), persisted case notes and the audit
 *          trail. Requires "transactions:read".
 * PATCH  — analyst workflows: status updates, final decisions, case
 *          assignments and SLA-breach escalations, all audited. The
 *          actor recorded is the AUTHENTICATED user — any client-supplied
 *          analyst id is ignored. Requires "investigations:decide" for
 *          decisions/status and "investigations:assign" for handoffs.
 * DELETE — restricted cleanup ("transactions:write"); the audit trail
 *          itself survives (SetNull).
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  findOrgTransaction,
  investigationFromRow,
  jsonError,
  LEDGER_INCLUDE,
  parseSignals,
  statusForAction,
  toUiTransaction,
  writeAudit,
} from "@/lib/server/ledger";
import { clientKey, rateLimit } from "@/lib/server/guard";
import { guardMutation, requirePermission } from "@/lib/server/auth/context";
import { hasPermission } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: RouteCtx) {
  const auth = await requirePermission(request, "transactions:read");
  if (!auth.ok) return auth.response;
  const { organisationId } = auth.value;

  const { id } = await ctx.params;

  const row = await findOrgTransaction(organisationId, id, {
    auditEvents: { orderBy: { createdAt: "desc" }, take: 60 },
  });
  if (!row) return jsonError("Transaction not found", 404);

  /* Customer stats are derived, never stored — computed from the ledger. */
  const [txnCount, agg, devices, locations, history] = await Promise.all([
    db.transaction.count({ where: { organisationId, customerId: row.customerId } }),
    db.transaction.aggregate({
      where: { organisationId, customerId: row.customerId },
      _avg: { amount: true, riskScore: true },
      _max: { amount: true },
    }),
    db.transaction.findMany({
      where: { organisationId, customerId: row.customerId, device: { not: "" } },
      select: { device: true },
      distinct: ["device"],
    }),
    db.transaction.findMany({
      where: { organisationId, customerId: row.customerId, location: { not: "" } },
      select: { location: true },
      distinct: ["location"],
    }),
    db.transaction.findMany({
      where: { organisationId, customerId: row.customerId },
      orderBy: { timestamp: "desc" },
      take: 12,
      select: { id: true, externalId: true, amount: true, riskScore: true, riskLevel: true, timestamp: true },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    transaction: toUiTransaction(row),
    signals: parseSignals(row.signalsJson),
    warnings: (() => {
      try {
        const w = JSON.parse(row.warningsJson) as string[];
        return Array.isArray(w) ? w : [];
      } catch {
        return [];
      }
    })(),
    auditTrail: row.auditEvents.map((e) => ({
      time: e.createdAt.toISOString(),
      actor: e.actorName ?? e.actor,
      action: e.action,
      detail: e.detailJson === "{}" ? undefined : e.detailJson,
    })),
    customer: {
      id: row.customer?.externalId ?? row.customerId,
      name: row.customerName || row.customerName || row.customer?.externalId || row.customerId,
      kycTier: "MIN KYC",
      riskProfile: "normal",
      transactionCount: txnCount,
      avgTransaction: Math.round(agg._avg.amount ?? 0),
      maxTransaction: Math.round(agg._max.amount ?? 0),
      avgRiskScore: Math.round(agg._avg.riskScore ?? 0),
      knownDevices: devices.map((d) => d.device),
      usualLocations: locations.map((l) => l.location),
      history: history
        .slice()
        .reverse()
        .map((t) => ({
          label: t.timestamp.toISOString().slice(5, 16).replace("T", " "),
          amount: t.amount,
          riskScore: Math.round(t.riskScore),
          flagged: t.riskLevel === "HIGH" || t.riskLevel === "CRITICAL",
        })),
    },
  });
}

/* ------------------------------------------------------------------ */
/* PATCH — status / analyst decision / assignment / escalation         */
/* ------------------------------------------------------------------ */

const patchSchema = z.object({
  status: z
    .enum(["EVALUATING", "MONITORING", "INVESTIGATING", "UNDER_REVIEW", "ON_HOLD", "BLOCKED", "ALLOWED"])
    .optional(),
  decision: z.enum(["ALLOW", "REVIEW", "HOLD", "BLOCK"]).optional(),
  note: z.string().trim().max(1000).optional(),
  /* Deprecated: ignored. The actor is the authenticated session user. */
  analystId: z.string().trim().max(64).optional(),
  /** Case handoff — the target USER's id (must be an organisation member). */
  assignee: z.string().trim().max(64).nullable().optional(),
  /** SLA-breach escalation target user id. */
  escalateTo: z.string().trim().max(64).optional(),
});

export async function PATCH(request: Request, ctx: RouteCtx) {
  const auth = await guardMutation(request, "investigations:decide");
  if (!auth.ok) return auth.response;
  const { organisationId, user, role } = auth.value;

  const rl = rateLimit(clientKey(request, "txn-patch"), 60, 60_000);
  if (!rl.allowed) {
    return jsonError(`Too many updates — retry in ${rl.retryAfterSec}s.`, 429);
  }
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body is not valid JSON");
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Invalid patch");
  const { status, decision, note, assignee, escalateTo } = parsed.data;
  if (!status && !decision && assignee === undefined && !escalateTo) {
    return jsonError("Provide a status, a decision, an assignee or an escalation target");
  }

  /* Assignment/escalation needs the assign permission on top of decide. */
  if ((assignee !== undefined || escalateTo) && !hasPermission(role, "investigations:assign")) {
    return jsonError('Your role does not grant "investigations:assign" in this organisation.', 403);
  }

  /* Handoff targets must be organisation members — server-validated. */
  const memberNames = new Map<string, string>();
  const targetIds = [assignee, escalateTo].filter((v): v is string => typeof v === "string" && v.length > 0);
  for (const targetId of targetIds) {
    const member = await db.membership.findFirst({
      where: { organisationId, userId: targetId },
      select: { id: true, user: { select: { name: true } } },
    });
    if (!member) return jsonError("Assignment target is not a member of this organisation.", 400);
    memberNames.set(targetId, member.user.name);
  }

  const existing = await findOrgTransaction(organisationId, id);
  if (!existing) return jsonError("Transaction not found", 404);

  const nextStatus = status ?? (decision ? statusForAction(decision) : existing.status);

  const updated = await db.$transaction(async (tx) => {
    const row = await tx.transaction.update({
      where: { id: existing.id },
      data: {
        status: nextStatus,
        ...(decision
          ? {
              investigation: {
                upsert: {
                  /* Creation path must carry the decision too — a verdict
                   * recorded BEFORE any AI/heuristic investigation ran
                   * still persists action, note and resolved timestamp. */
                  create: {
                    organisationId,
                    mode: "heuristic",
                    riskAssessment: "Analyst decision recorded without a prior investigation.",
                    recommendedAction: decision,
                    analystAction: decision,
                    analystNote: note ?? null,
                    resolvedAt: new Date(),
                  },
                  update: {
                    analystAction: decision,
                    analystNote: note ?? null,
                    resolvedAt: new Date(),
                  },
                },
              },
            }
          : {}),
        ...(assignee !== undefined
          ? { assigneeId: assignee || null, assigneeName: assignee ? (memberNames.get(assignee) ?? null) : null }
          : {}),
        ...(escalateTo
          ? { escalatedTo: escalateTo, escalatedName: memberNames.get(escalateTo) ?? null, assigneeId: escalateTo, assigneeName: memberNames.get(escalateTo) ?? null }
          : {}),
      },
      include: LEDGER_INCLUDE,
    });

    if (decision) {
      await tx.auditEvent.create({
        data: {
          organisationId,
          actor: "ANALYST",
          actorType: "HUMAN",
          actorUserId: user.id,
          actorName: user.name,
          action: "DECISION_RECORDED",
          entityType: "Transaction",
          entityId: id,
          detailJson: JSON.stringify({ decision, note: note ?? null, by: user.email }),
          transactionId: existing.id,
        },
      });
    }
    if (assignee !== undefined) {
      await tx.auditEvent.create({
        data: {
          organisationId,
          actor: "ANALYST",
          actorType: "HUMAN",
          actorUserId: user.id,
          actorName: user.name,
          action: assignee ? "CASE_ASSIGNED" : "CASE_UNASSIGNED",
          entityType: "Transaction",
          entityId: id,
          detailJson: JSON.stringify({
            assignee,
            assigneeName: assignee ? (memberNames.get(assignee) ?? null) : null,
            by: user.email,
          }),
          transactionId: existing.id,
        },
      });
    }
    if (escalateTo) {
      await tx.auditEvent.create({
        data: {
          organisationId,
          actor: "ANALYST",
          actorType: "HUMAN",
          actorUserId: user.id,
          actorName: user.name,
          action: "CASE_ESCALATED",
          entityType: "Transaction",
          entityId: id,
          detailJson: JSON.stringify({
            to: escalateTo,
            toName: memberNames.get(escalateTo) ?? null,
            by: user.email,
            reason: "SLA breach — one-click escalation",
          }),
          transactionId: existing.id,
        },
      });
    }
    if (nextStatus !== existing.status) {
      await tx.auditEvent.create({
        data: {
          organisationId,
          actor: decision ? "ANALYST" : "SYSTEM",
          actorType: decision ? "HUMAN" : "SYSTEM",
          actorUserId: decision ? user.id : null,
          actorName: decision ? user.name : null,
          action: "STATUS_CHANGED",
          entityType: "Transaction",
          entityId: id,
          detailJson: JSON.stringify({ from: existing.status, to: nextStatus }),
          transactionId: existing.id,
        },
      });
    }
    return row;
  });

  return NextResponse.json({ ok: true, transaction: toUiTransaction(updated) });
}

/* ------------------------------------------------------------------ */
/* DELETE — restricted cleanup, audit preserved                        */
/* ------------------------------------------------------------------ */

export async function DELETE(request: Request, ctx: RouteCtx) {
  const auth = await guardMutation(request, "transactions:write");
  if (!auth.ok) return auth.response;
  const { organisationId, user } = auth.value;

  const { id } = await ctx.params;
  const existing = await findOrgTransaction(organisationId, id);
  if (!existing) return jsonError("Transaction not found", 404);

  if (existing.dataSource !== "demo" && existing.dataSource !== "manual" && existing.dataSource !== "import") {
    return jsonError(
      `Only demo, manual or imported records can be deleted — ${existing.dataSource} rows are protected.`,
      403,
    );
  }

  await writeAudit({
    organisationId,
    actor: "ANALYST",
    actorType: "HUMAN",
    actorUserId: user.id,
    actorName: user.name,
    action: "TRANSACTION_DELETED",
    entityType: "Transaction",
    entityId: id,
    detail: { dataSource: existing.dataSource, amount: existing.amount },
  });
  await db.transaction.delete({ where: { id: existing.id } });

  return NextResponse.json({ ok: true });
}
