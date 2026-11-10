/**
 * /api/org/invitations — pending organisation invitations.
 *   GET  list   ("org:invitations:manage")
 *   POST create ("org:invitations:manage")
 */

import { NextResponse } from "next/server";
import { guardMutation, requirePermission } from "@/lib/server/auth/context";
import { createInvitation, listInvitations } from "@/lib/server/auth/orgService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requirePermission(request, "org:invitations:manage");
  if (!auth.ok) return auth.response;

  const result = await listInvitations(auth.value);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.value);
}

export async function POST(request: Request) {
  const auth = await guardMutation(request, "org:invitations:manage");
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be JSON." }, { status: 400 });
  }

  const result = await createInvitation(auth.value, String(body.email ?? ""), String(body.role ?? ""));
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({
    ok: true,
    invitation: {
      id: result.value.invitationId,
      email: result.value.email,
      role: result.value.role,
    },
    devUrl: result.value.devUrl ?? undefined,
  });
}
