/**
 * POST /api/auth/switch-organisation — activate another membership.
 * The target organisation is re-verified against the session's
 * memberships; a non-member organisation id is rejected with 403.
 */

import { NextResponse } from "next/server";
import { setOrgCookie } from "@/lib/server/auth/cookies";
import { assertSameOrigin, guardMutationAuth } from "@/lib/server/auth/context";
import { resolveSwitchTarget } from "@/lib/server/auth/orgService";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;

  const auth = await guardMutationAuth(request);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be JSON." }, { status: 400 });
  }

  const target = String(body.organisationId ?? "");
  const membership = await resolveSwitchTarget(auth.value, target);
  if (!membership) {
    return NextResponse.json({ ok: false, error: "You are not a member of that organisation." }, { status: 403 });
  }

  const res = NextResponse.json({ ok: true, organisationId: membership.organisationId, role: membership.role });
  setOrgCookie(res, membership.organisationId);
  return res;
}
