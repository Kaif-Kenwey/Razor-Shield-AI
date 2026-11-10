/**
 * POST /api/auth/resend-verification — re-send the email verification
 * (rate-limited to one per minute). Dev builds return the link.
 */

import { NextResponse } from "next/server";
import { assertSameOrigin, requireAuth } from "@/lib/server/auth/context";
import { resendVerification } from "@/lib/server/auth/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;

  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const result = await resendVerification(auth.value.user.id);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({
    ok: true,
    sent: true,
    devVerificationUrl: result.value.devUrl ?? undefined,
  });
}
