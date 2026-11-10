/**
 * /api/org/members/:membershipId — member administration.
 *   PATCH  change a member's role   ("org:members:manage")
 *   DELETE remove a member          ("org:members:manage")
 * Both enforce last-owner protection and role-assignability.
 */

import { NextResponse } from "next/server";
import { guardMutation } from "@/lib/server/auth/context";
import { changeMemberRole, removeMember } from "@/lib/server/auth/orgService";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guardMutation(request, "org:members:manage");
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be JSON." }, { status: 400 });
  }

  const { id } = await params;
  const result = await changeMemberRole(auth.value, id, String(body.role ?? ""));
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, changed: true });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guardMutation(request, "org:members:manage");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const result = await removeMember(auth.value, id);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, removed: true });
}
