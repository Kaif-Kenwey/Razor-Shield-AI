/**
 * POST /api/auth/mfa/enable — verify a 6-digit code against a freshly
 * issued enrolment secret (sent again in the body, never read from
 * storage) and activate TOTP MFA for the account.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { assertSameOrigin, requireAuth } from "@/lib/server/auth/context";
import { sealSecret, openSecret } from "@/lib/server/secretBox";
import { writeAudit } from "@/lib/server/ledger";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;

  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be JSON." }, { status: 400 });
  }

  const secret = String(body.secret ?? "");
  const code = String(body.code ?? "");
  if (!secret || !code) {
    return NextResponse.json({ ok: false, error: "The enrolment secret and a 6-digit code are required." }, { status: 400 });
  }

  const { verifySync } = await import("otplib/functional");
  const normalized = code.replace(/\s+/g, "");
  const codeValid = /^\d{6}$/.test(normalized)
    ? verifySync({ token: normalized, secret }).valid
    : false;
  if (!codeValid) {
    return NextResponse.json({ ok: false, error: "Invalid authentication code — enrolment not completed." }, { status: 400 });
  }

  await db.user.update({
    where: { id: auth.value.user.id },
    data: { totpSecretEnc: sealSecret(secret), totpEnabled: true },
  });
  await writeAudit({
    actor: "SYSTEM",
    actorType: "HUMAN",
    actorUserId: auth.value.user.id,
    actorName: auth.value.user.name,
    action: "MFA_ENABLED",
    entityType: "User",
    entityId: auth.value.user.id,
  });
  return NextResponse.json({ ok: true, enabled: true });
}
