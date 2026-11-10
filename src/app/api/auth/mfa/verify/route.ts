/**
 * POST /api/auth/mfa/verify — complete a TOTP sign-in with the ticket
 * issued by /api/auth/login when the account has MFA enabled.
 */

import { NextResponse } from "next/server";
import { clientKey, rateLimit } from "@/lib/server/guard";
import { assertSameOrigin } from "@/lib/server/auth/context";
import { verifyMfaLogin } from "@/lib/server/auth/service";
import { setSessionCookie } from "@/lib/server/auth/cookies";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;

  const limit = rateLimit(clientKey(request, "mfa-verify"), 10, 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json({ ok: false, error: "Too many attempts. Try again shortly." }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be JSON." }, { status: 400 });
  }

  const result = await verifyMfaLogin(String(body.ticket ?? ""), String(body.code ?? ""), {
    ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined,
    userAgent: request.headers.get("user-agent") ?? undefined,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  const res = NextResponse.json({ ok: true, user: result.value.user });
  setSessionCookie(res, result.value.sessionToken, {
    maxAgeSec: Math.floor((result.value.expiresAt.getTime() - Date.now()) / 1000),
  });
  return res;
}
