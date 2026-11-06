/**
 * /api/transactions/:id — one complete ledger record.
 *
 * GET    — the transaction with customer profile, engine signals, stored
 *          investigation (if any) and the persisted audit trail.
 * PATCH  — analyst workflows: status updates and final decisions, both
 *          audited. The analyst decision also closes the stored
 *          investigation when one exists.
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
/* PATCH — status / analyst decision (audited)                         */
/* ------------------------------------------------------------------ */

const patchSchema = z.object({
  status: z
    .enum(["EVALUATING", "MONITORING", "INVESTIGATING", "UNDER_REVIEW", "ON_HOLD", "BLOCKED", "ALLOWED"])
    .optional(),
  decision: z.enum(["ALLOW", "REVIEW", "HOLD", "BLOCK"]).optional(),
  note: z.string().trim().max(1000).optional(),
  analystId: z.string().trim().max(16).optional(),
});

export async function PATCH(request: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body is not valid JSON");
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Invalid patch");
  const { status, decision, note, analystId } = parsed.data;
  if (!status && !decision) return jsonError("Provide a status or an analyst decision");

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
                  create: {
                    mode: "heuristic",
                    riskAssessment: "Analyst decision recorded without a prior investigation.",
                    recommendedAction: decision,
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

export async function DELETE(_request: Request, ctx: RouteCtx) {
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
