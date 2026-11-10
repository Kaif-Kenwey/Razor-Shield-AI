/**
 * POST /api/auth/forgot-password — request a password reset link.
 * Always answers ok (no account enumeration); the mail is sent only for
 * existing accounts.
 */

import { NextResponse } from "next/server";
import { clientKey, rateLimit } from "@/lib/server/guard";
import { assertSameOrigin } from "@/lib/server/auth/context";
import { requestPasswordReset } from "@/lib/server/auth/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;

  const limit = rateLimit(clientKey(request, "forgot-password"), 5, 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json({ ok: false, error: "Too many requests. Try again shortly." }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be JSON." }, { status: 400 });
  }

  const result = await requestPasswordReset(String(body.email ?? ""));
  return NextResponse.json({
    ok: true,
    sent: true,
    devResetUrl: result.ok ? (result.value.devUrl ?? undefined) : undefined,
    note: "If an account exists for that address, a reset link has been generated.",
  });
}
