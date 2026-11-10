/**
 * POST /api/auth/register — create a user + (new organisation OR invite
 * redemption). Returns a session immediately; email verification is
 * requested separately (dev builds receive the link back, see mailer).
 */

import { NextResponse } from "next/server";
import { clientKey, rateLimit } from "@/lib/server/guard";
import { assertSameOrigin } from "@/lib/server/auth/context";
import { createSession, register } from "@/lib/server/auth/service";
import { setSessionCookie } from "@/lib/server/auth/cookies";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;

  const limit = rateLimit(clientKey(request, "register"), 5, 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many registration attempts. Try again shortly." },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSec) } },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be JSON." }, { status: 400 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || undefined;
  const userAgent = request.headers.get("user-agent") ?? undefined;

  const result = await register({
    name: String(body.name ?? ""),
    email: String(body.email ?? ""),
    password: String(body.password ?? ""),
    organisationName: body.organisationName ? String(body.organisationName) : undefined,
    invitationToken: body.invitationToken ? String(body.invitationToken) : undefined,
    ip,
    userAgent,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error, ...(result.extra ?? {}) }, { status: result.status });
  }

  // Registration signs the user in (standard SaaS onboarding).
  const session = await createSession(result.value.user.id, { ip, userAgent });
  const res = NextResponse.json({
    ok: true,
    user: result.value.user,
    organisation: result.value.organisation,
    role: result.value.role,
    requiresEmailVerification: result.value.devVerificationUrl ? true : undefined,
    devVerificationUrl: result.value.devVerificationUrl ?? undefined,
  });
  setSessionCookie(res, session.token);
  return res;
}
