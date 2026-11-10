/**
 * DELETE /api/auth/sessions/:id — revoke one of the caller's own
 * sessions (device sign-out). Sessions belonging to other users answer
 * 404 (non-disclosing).
 */

import { NextResponse } from "next/server";
import { assertSameOrigin, requireAuth } from "@/lib/server/auth/context";
import { revokeSession } from "@/lib/server/auth/service";

export const runtime = "nodejs";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;

  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const result = await revokeSession(auth.value.user.id, id);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, revoked: true });
}
