/**
 * POST /api/auth/mfa/setup — begin TOTP enrolment. Returns an otpauth://
 * URI (for authenticator apps) and the raw secret shown once for manual
 * entry. Nothing is enabled until /api/auth/mfa/enable verifies a code.
 */

import { NextResponse } from "next/server";
import { guardMutationAuth } from "@/lib/server/auth/context";
import { enrolTotp } from "@/lib/server/auth/totp";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await guardMutationAuth(request);
  if (!auth.ok) return auth.response;

  if (auth.value.user.totpEnabled) {
    return NextResponse.json({ ok: false, error: "MFA is already enabled on this account." }, { status: 409 });
  }

  const enrolment = enrolTotp(auth.value.user.email);
  // The sealed secret is held in memory only until enable() persists it —
  // setup alone never weakens the account.
  return NextResponse.json({
    ok: true,
    otpauthUrl: enrolment.otpauthUrl,
    secretOnce: enrolment.secretOnce,
    instructions:
      "Add the entry to your authenticator app (scan the URI with a QR tool or enter the secret manually), then confirm with a 6-digit code via /api/auth/mfa/enable.",
  });
}
