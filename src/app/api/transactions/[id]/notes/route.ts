/**
 * /api/transactions/:id/notes — the analyst notebook, persisted server-side.
 *
 * GET  — every notebook entry for the case, oldest first. Notes live in
 *        the database (CaseNote model), not browser state.
 * POST — append one entry. Trimmed, bounded to 240 chars, attributed to
 *        the AUTHENTICATED user (any client-supplied analyst id is
 *        ignored) and audited (NOTE_ADDED). Requires
 *        "investigations:note".
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { findOrgTransaction, jsonError, writeAudit } from "@/lib/server/ledger";
import { clientKey, rateLimit } from "@/lib/server/guard";
import { guardMutation, requirePermission } from "@/lib/server/auth/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

const MAX_NOTE = 240;

export async function GET(request: Request, ctx: RouteCtx) {
  const auth = await requirePermission(request, "investigations:read");
  if (!auth.ok) return auth.response;
  const { organisationId } = auth.value;

  const { id } = await ctx.params;
  const txn = await findOrgTransaction(organisationId, id, {});
  if (!txn) return jsonError("Transaction not found", 404);

  const notes = await db.caseNote.findMany({
    where: { transactionId: txn.id },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  return NextResponse.json({
    ok: true,
    notes: notes.map((n) => ({
      id: n.id,
      text: n.text,
      /* New entries carry the author's user id + name snapshot; rows
       * migrated from the single-tenant era keep legacy roster ids. */
      analystId: n.analystId,
      analystName: n.analystName ?? undefined,
      at: n.createdAt.toISOString(),
    })),
  });
}

const postSchema = z.object({
  text: z.string().trim().min(1, "Note text is required").max(MAX_NOTE),
  /* Deprecated: ignored — authorship comes from the session. */
  analystId: z.string().trim().max(64).optional(),
});

export async function POST(request: Request, ctx: RouteCtx) {
  const auth = await guardMutation(request, "investigations:note");
  if (!auth.ok) return auth.response;
  const { organisationId, user } = auth.value;

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

  const txn = await findOrgTransaction(organisationId, id, {});
  if (!txn) return jsonError("Transaction not found", 404);

  const note = await db.caseNote.create({
    data: {
      organisationId,
      transactionId: txn.id,
      text: parsed.data.text,
      analystId: user.id,
      analystName: user.name,
    },
  });

  await writeAudit({
    organisationId,
    actor: "ANALYST",
    actorType: "HUMAN",
    actorUserId: user.id,
    actorName: user.name,
    action: "NOTE_ADDED",
    entityType: "Transaction",
    entityId: id,
    detail: { author: user.email, length: parsed.data.text.length },
    transactionId: txn.id,
  });

  return NextResponse.json(
    {
      ok: true,
      note: {
        id: note.id,
        text: note.text,
        analystId: note.analystId,
        analystName: note.analystName ?? undefined,
        at: note.createdAt.toISOString(),
      },
    },
    { status: 201 },
  );
}
