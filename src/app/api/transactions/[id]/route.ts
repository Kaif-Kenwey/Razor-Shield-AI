/**
 * /api/transactions/:id — one complete ledger record.
 *
 * GET    — the transaction with customer profile, engine signals, stored
 *          investigation (if any), persisted case notes and the persisted
 *          audit trail.
 * PATCH  — analyst workflows: status updates, final decisions, case
 *          assignments and SLA-breach escalations, all audited and
 *          persisted to SQLite. The analyst decision also closes the
 *          stored investigation when one exists — and creates one with
 *          the decision attached when it does not.
 * DELETE — restricted cleanup: only demo, manual and imported records can
 *          be deleted, the audit trail itself survives (SetNull).
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  investigationFromRow,
  jsonError,
  parseSignals,
  statusForAction,
  toUiTransaction,
  writeAudit,
} from "@/lib/server/ledger";
import { checkAdminGuard, clientKey, rateLimit } from "@/lib/server/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;

  const row = await db.transaction.findUnique({
    where: { id },
    include: {
      investigation: true,
      customer: true,
      auditEvents: { orderBy: { createdAt: "desc" }, take: 60 },
    },
  });
  if (!row) return jsonError("Transaction not found", 404);

  /* Customer stats are derived, never stored — computed from the ledger. */
  const [txnCount, agg, devices, locations, history] = await Promise.all([
    db.transaction.count({ where: { customerId: row.customerId } }),
    db.transaction.aggregate({
      where: { customerId: row.customerId },
      _avg: { amount: true, riskScore: true },
      _max: { amount: true },
    }),
    db.transaction.findMany({
      where: { customerId: row.customerId, device: { not: "" } },
      select: { device: true },
      distinct: ["device"],
    }),
    db.transaction.findMany({
      where: { customerId: row.customerId, location: { not: "" } },
      select: { location: true },
      distinct: ["location"],
    }),
    db.transaction.findMany({
      where: { customerId: row.customerId },
      orderBy: { timestamp: "desc" },
      take: 12,
      select: { id: true, amount: true, riskScore: true, riskLevel: true, timestamp: true },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    transaction: toUiTransaction({ ...row, investigation: row.investigation }),
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
      actor: e.actor,
      action: e.action,
      detail: e.detailJson === "{}" ? undefined : e.detailJson,
    })),
    customer: {
      id: row.customerId,
      name: row.customerName || row.customer?.name || row.customerId,
      kycTier: row.customer?.kycTier ?? "MIN KYC",
      riskProfile: row.customer?.riskProfile ?? "normal",
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
  analystId: z.string().trim().max(16).optional(),
  /** Server-persisted case handoff. null clears the assignment. */
  assignee: z.string().trim().max(16).nullable().optional(),
  /** Server-persisted SLA-breach escalation target (analyst roster id). */
  escalateTo: z.string().trim().max(16).optional(),
});

export async function PATCH(request: Request, ctx: RouteCtx) {
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
  const { status, decision, note, analystId, assignee, escalateTo } = parsed.data;
  if (!status && !decision && assignee === undefined && !escalateTo) {
    return jsonError("Provide a status, a decision, an assignee or an escalation target");
  }

  const existing = await db.transaction.findUnique({
    where: { id },
    include: { investigation: true },
  });
  if (!existing) return jsonError("Transaction not found", 404);

  const nextStatus = status ?? (decision ? statusForAction(decision) : existing.status);

  const updated = await db.$transaction(async (tx) => {
    const row = await tx.transaction.update({
      where: { id },
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
        ...(assignee !== undefined ? { assigneeId: assignee } : {}),
        ...(escalateTo ? { escalatedTo: escalateTo, assigneeId: escalateTo } : {}),
      },
      include: { investigation: true },
    });

    if (decision) {
      await tx.auditEvent.create({
        data: {
          actor: "ANALYST",
          action: "DECISION_RECORDED",
          entityType: "Transaction",
          entityId: id,
          detailJson: JSON.stringify({ decision, note: note ?? null, analystId: analystId ?? null }),
          transactionId: id,
        },
      });
    }
    if (assignee !== undefined) {
      await tx.auditEvent.create({
        data: {
          actor: "ANALYST",
          action: assignee ? "CASE_ASSIGNED" : "CASE_UNASSIGNED",
          entityType: "Transaction",
          entityId: id,
          detailJson: JSON.stringify({
            assignee,
            byAnalystId: analystId ?? null,
          }),
          transactionId: id,
        },
      });
    }
    if (escalateTo) {
      await tx.auditEvent.create({
        data: {
          actor: "ANALYST",
          action: "CASE_ESCALATED",
          entityType: "Transaction",
          entityId: id,
          detailJson: JSON.stringify({
            to: escalateTo,
            byAnalystId: analystId ?? null,
            reason: "SLA breach — one-click escalation",
          }),
          transactionId: id,
        },
      });
    }
    if (nextStatus !== existing.status) {
      await tx.auditEvent.create({
        data: {
          actor: decision ? "ANALYST" : "SYSTEM",
          action: "STATUS_CHANGED",
          entityType: "Transaction",
          entityId: id,
          detailJson: JSON.stringify({ from: existing.status, to: nextStatus }),
          transactionId: id,
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
  /* Destructive operation — guarded when this deployment sets ADMIN_TOKEN. */
  const guard = checkAdminGuard(request);
  if (!guard.ok) {
    return jsonError(guard.message, 401, { adminRequired: true });
  }
  const { id } = await ctx.params;
  const existing = await db.transaction.findUnique({ where: { id } });
  if (!existing) return jsonError("Transaction not found", 404);

  if (existing.dataSource !== "demo" && existing.dataSource !== "manual" && existing.dataSource !== "import") {
    return jsonError(
      `Only demo, manual or imported records can be deleted — ${existing.dataSource} rows are protected.`,
      403,
    );
  }

  await writeAudit({
    actor: "SYSTEM",
    action: "TRANSACTION_DELETED",
    entityType: "Transaction",
    entityId: id,
    detail: { dataSource: existing.dataSource, amount: existing.amount },
  });
  await db.transaction.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
