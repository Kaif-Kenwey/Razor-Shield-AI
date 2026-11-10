/**
 * POST /api/auth/reset-password — set a new password with the reset
 * token. Revokes every existing session for the account.
 */

import { NextResponse } from "next/server";
import { clientKey, rateLimit } from "@/lib/server/guard";
import { assertSameOrigin } from "@/lib/server/auth/context";
import { resetPassword } from "@/lib/server/auth/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;

  const limit = rateLimit(clientKey(request, "reset-password"), 10, 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json({ ok: false, error: "Too many attempts. Try again shortly." }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be JSON." }, { status: 400 });
  }

  const result = await resetPassword(String(body.token ?? ""), String(body.password ?? ""));
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, reset: true });
}
