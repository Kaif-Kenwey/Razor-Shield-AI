/**
 * POST /api/auth/login — email+password sign-in.
 *
 * Security: uniform invalid-credential errors (no account enumeration),
 * per-IP and per-account rate limiting, progressive account lockout
 * (5 failures → 15 minutes), and a TOTP second step via a short-lived
 * ticket when MFA is enabled.
 */

import { NextResponse } from "next/server";
import { clientKey, rateLimit } from "@/lib/server/guard";
import { assertSameOrigin } from "@/lib/server/auth/context";
import { login } from "@/lib/server/auth/service";
import { setSessionCookie } from "@/lib/server/auth/cookies";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;

  const ipLimit = rateLimit(clientKey(request, "login-ip"), 20, 60 * 1000);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many sign-in attempts from this network. Try again shortly." },
      { status: 429, headers: { "retry-after": String(ipLimit.retryAfterSec) } },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be JSON." }, { status: 400 });
  }

  const email = String(body.email ?? "");
  const emailLimit = rateLimit(`login-email:${email.toLowerCase().slice(0, 120)}`, 10, 60 * 1000);
  if (!emailLimit.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many sign-in attempts for this account. Try again shortly." },
      { status: 429, headers: { "retry-after": String(emailLimit.retryAfterSec) } },
    );
  }

  const result = await login(email, String(body.password ?? ""), {
    ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || undefined,
    userAgent: request.headers.get("user-agent") ?? undefined,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error, ...(result.extra ?? {}) }, { status: result.status });
  }

  if (result.value.kind === "mfa") {
    return NextResponse.json({ ok: true, mfaRequired: true, ticket: result.value.ticket });
  }

  const res = NextResponse.json({
    ok: true,
    user: result.value.user,
    requiresEmailVerification: result.value.devVerificationUrl ? true : undefined,
    devVerificationUrl: result.value.devVerificationUrl ?? undefined,
  });
  setSessionCookie(res, result.value.sessionToken, {
    maxAgeSec: Math.floor((result.value.expiresAt.getTime() - Date.now()) / 1000),
  });
  return res;
}
