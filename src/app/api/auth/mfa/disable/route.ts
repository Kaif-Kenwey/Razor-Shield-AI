/**
 * POST /api/auth/mfa/disable — turn off TOTP MFA. Requires BOTH the
 * current password and a valid 6-digit code (defence in depth).
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { assertSameOrigin, requireAuth } from "@/lib/server/auth/context";
import { verifyPassword } from "@/lib/server/auth/passwords";
import { verifyTotp } from "@/lib/server/auth/totp";
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

  const user = await db.user.findUnique({ where: { id: auth.value.user.id } });
  if (!user?.totpEnabled) {
    return NextResponse.json({ ok: false, error: "MFA is not enabled on this account." }, { status: 409 });
  }

  const passwordOk = await verifyPassword(String(body.password ?? ""), user.passwordHash);
  const codeOk = verifyTotp(user.totpSecretEnc ?? "", String(body.code ?? ""));
  if (!passwordOk || !codeOk) {
    return NextResponse.json(
      { ok: false, error: "Password and a valid authentication code are required to disable MFA." },
      { status: 403 },
    );
  }

  await db.user.update({
    where: { id: user.id },
    data: { totpSecretEnc: null, totpEnabled: false },
  });
  await writeAudit({
    actor: "SYSTEM",
    actorType: "HUMAN",
    actorUserId: user.id,
    actorName: user.name,
    action: "MFA_DISABLED",
    entityType: "User",
    entityId: user.id,
  });
  return NextResponse.json({ ok: true, enabled: false });
}
