/**
 * POST /api/auth/logout — revoke the current session and clear cookies.
 */

import { NextResponse } from "next/server";
import { clearSessionCookies } from "@/lib/server/auth/cookies";
import { assertSameOrigin, requireAuth } from "@/lib/server/auth/context";
import { logout } from "@/lib/server/auth/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;

  const auth = await requireAuth(request);
  if (auth.ok) {
    await logout(auth.value.sessionId, auth.value.user.id, auth.value.user.name);
  }
  const res = NextResponse.json({ ok: true });
  clearSessionCookies(res);
  return res;
}
