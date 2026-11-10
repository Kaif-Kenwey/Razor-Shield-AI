/**
 * POST /api/auth/verify-email — confirm an email address with the token
 * from the verification link.
 */

import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/server/auth/context";
import { verifyEmail } from "@/lib/server/auth/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be JSON." }, { status: 400 });
  }

  const result = await verifyEmail(String(body.token ?? ""));
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, verified: true });
}
