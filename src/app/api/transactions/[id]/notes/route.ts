/**
 * /api/transactions/:id/notes — the analyst notebook, persisted server-side.
 *
 * GET  — every notebook entry for the case, oldest first. Notes live in
 *        SQLite (CaseNote model), not browser state: they survive
 *        reloads, other devices and demo-data clears.
 * POST — append one entry. Trimmed, bounded to 240 chars (same limit the
 *        composer enforces), attributed to the signed-in analyst and
 *        audited (NOTE_ADDED) so the notebook is part of the case record.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { jsonError, writeAudit } from "@/lib/server/ledger";
import { clientKey, rateLimit } from "@/lib/server/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

const MAX_NOTE = 240;

export async function GET(_request: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const exists = await db.transaction.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return jsonError("Transaction not found", 404);

  const notes = await db.caseNote.findMany({
    where: { transactionId: id },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  return NextResponse.json({
    ok: true,
    notes: notes.map((n) => ({
      id: n.id,
      text: n.text,
      analystId: n.analystId,
      at: n.createdAt.toISOString(),
    })),
  });
}

const postSchema = z.object({
  text: z.string().trim().min(1, "Note text is required").max(MAX_NOTE),
  analystId: z.string().trim().min(1).max(16),
});

export async function POST(request: Request, ctx: RouteCtx) {
  const rl = rateLimit(clientKey(request, "case-note"), 60, 60_000);
  if (!rl.allowed) {
    return jsonError(`Too many notes — retry in ${rl.retryAfterSec}s.`, 429);
  }

  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body is not valid JSON");
  }

  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Invalid note");

  const exists = await db.transaction.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return jsonError("Transaction not found", 404);

  const note = await db.caseNote.create({
    data: {
      transactionId: id,
      text: parsed.data.text,
      analystId: parsed.data.analystId,
    },
  });

  await writeAudit({
    actor: "ANALYST",
    action: "NOTE_ADDED",
    entityType: "Transaction",
    entityId: id,
    detail: { analystId: parsed.data.analystId, length: parsed.data.text.length },
    transactionId: id,
  });

  return NextResponse.json(
    {
      ok: true,
      note: {
        id: note.id,
        text: note.text,
        analystId: note.analystId,
        at: note.createdAt.toISOString(),
      },
    },
    { status: 201 },
  );
}
