/**
 * /api/demo — the DEMO SIMULATION control surface (tenant-scoped).
 *
 * All synthetic data is seeded INTO the authenticated organisation with
 * dataSource="demo", clearly labelled in the UI. Nothing here touches
 * other tenants. Requires "demo:manage".
 *
 * POST   — { action: "seed" }    → load the synthetic demo portfolio
 *          { action: "arrival" } → one synthetic arrival for the live feed
 * DELETE — clear ONLY demo-labelled records of this organisation;
 *          imported and manual data survive. Every action is audited.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { findOrgTransaction, jsonError, toUiTransaction, writeAudit } from "@/lib/server/ledger";
import { clearDemoData, generateDemoArrival, seedDemoData } from "@/lib/server/demoData";
import { clientKey, rateLimit } from "@/lib/server/guard";
import { guardMutation, requirePermission } from "@/lib/server/auth/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ action: z.enum(["seed", "arrival"]) });

export async function POST(request: Request) {
  const auth = await guardMutation(request, "demo:manage");
  if (!auth.ok) return auth.response;
  const { organisationId, user } = auth.value;

  const rl = rateLimit(clientKey(request, "demo"), 40, 60_000);
  if (!rl.allowed) {
    return jsonError(`Demo controls are rate limited — retry in ${rl.retryAfterSec}s.`, 429);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body is not valid JSON");
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return jsonError("action must be 'seed' or 'arrival'");

  if (parsed.data.action === "seed") {
    const result = await seedDemoData(organisationId);
    return NextResponse.json({ ok: true, ...result });
  }

  const { ids, burst } = await generateDemoArrival(organisationId);
  const rows = await Promise.all(ids.map((id) => findOrgTransaction(organisationId, id)));
  return NextResponse.json({
    ok: true,
    ids,
    burst,
    transactions: rows.filter((r): r is NonNullable<typeof r> => r !== null).map(toUiTransaction),
  });
}

export async function DELETE(request: Request) {
  const auth = await guardMutation(request, "demo:manage");
  if (!auth.ok) return auth.response;
  const { organisationId, user } = auth.value;

  const result = await clearDemoData(organisationId);
  await writeAudit({
    organisationId,
    actor: "ANALYST",
    actorType: "HUMAN",
    actorUserId: user.id,
    actorName: user.name,
    action: "DEMO_CLEARED",
    entityType: "Ledger",
    entityId: "demo",
    detail: { deleted: result.deleted, by: user.email },
  });
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(request: Request) {
  const auth = await requirePermission(request, "transactions:read");
  if (!auth.ok) return auth.response;
  const demoCount = await db.transaction.count({
    where: { organisationId: auth.value.organisationId, dataSource: "demo" },
  });
  return NextResponse.json({ ok: true, demoCount });
}
