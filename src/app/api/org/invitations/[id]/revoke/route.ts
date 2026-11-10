/**
 * POST /api/org/invitations/:id/revoke — revoke a pending invitation.
 */

import { NextResponse } from "next/server";
import { guardMutation } from "@/lib/server/auth/context";
import { revokeInvitation } from "@/lib/server/auth/orgService";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guardMutation(request, "org:invitations:manage");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const result = await revokeInvitation(auth.value, id);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, revoked: true });
}
