/**
 * /api/auth/sessions — active session (device) management.
 *   GET    list active sessions (current flagged)
 *   DELETE revoke all OTHER sessions (?keepCurrent=1 is implicit)
 */

import { NextResponse } from "next/server";
import { assertSameOrigin, requireAuth } from "@/lib/server/auth/context";
import { listSessions, revokeAllOtherSessions } from "@/lib/server/auth/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const sessions = await listSessions(auth.value.user.id, auth.value.sessionId);
  return NextResponse.json({ ok: true, sessions });
}

export async function DELETE(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;

  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const count = await revokeAllOtherSessions(auth.value.user.id, auth.value.sessionId);
  return NextResponse.json({ ok: true, revoked: count });
}
