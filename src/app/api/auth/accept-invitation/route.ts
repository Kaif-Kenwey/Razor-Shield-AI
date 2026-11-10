/**
 * POST /api/auth/accept-invitation — a signed-in user redeems an
 * invitation token (the invited email must match the signed-in account).
 * New users register via POST /api/auth/register { invitationToken }.
 */

import { NextResponse } from "next/server";
import { assertSameOrigin, requireAuth } from "@/lib/server/auth/context";
import { acceptInvitation } from "@/lib/server/auth/orgService";
import { setOrgCookie } from "@/lib/server/auth/cookies";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;

  const auth = await requireAuth(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: "Sign in (or register with this invitation) to accept it." },
      { status: 401 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be JSON." }, { status: 400 });
  }

  const result = await acceptInvitation(auth.value, String(body.token ?? ""));
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  const res = NextResponse.json({
    ok: true,
    organisation: { id: result.value.organisationId, name: result.value.organisationName },
    role: result.value.role,
  });
  setOrgCookie(res, result.value.organisationId);
  return res;
}
