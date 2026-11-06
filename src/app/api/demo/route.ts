/**
 * /api/demo — the DEMO SIMULATION control surface.
 *
 * POST   — two modes:
 *          { action: "seed" }    → load the synthetic demo portfolio
 *                                  (no-op when demo rows already exist)
 *          { action: "arrival" } → one synthetic arrival for the live
 *                                  feed (occasionally a correlated burst)
 * DELETE — clear ONLY demo-labelled records; imported and manual data
 *          survive. Every action is audited.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { jsonError, toUiTransaction } from "@/lib/server/ledger";
import { clearDemoData, generateDemoArrival, seedDemoData } from "@/lib/server/demoData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ action: z.enum(["seed", "arrival"]) });

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body is not valid JSON");
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return jsonError("action must be 'seed' or 'arrival'");

  if (parsed.data.action === "seed") {
    const result = await seedDemoData();
    return NextResponse.json({ ok: true, ...result });
  }

  const { ids, burst } = await generateDemoArrival();
  const rows = await db.transaction.findMany({
    where: { id: { in: ids } },
    include: { investigation: true },
  });
  return NextResponse.json({
    ok: true,
    ids,
    burst,
    transactions: rows.map(toUiTransaction),
  });
}

export async function DELETE() {
  const result = await clearDemoData();
  return NextResponse.json({ ok: true, ...result });
}

export async function GET() {
  const demoCount = await db.transaction.count({ where: { dataSource: "demo" } });
  return NextResponse.json({ ok: true, demoCount });
}
