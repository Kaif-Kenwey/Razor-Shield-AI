/**
 * GET /api/org/members — the organisation's member roster.
 * Requires "org:members:read".
 */

import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/server/auth/context";
import { listMembers } from "@/lib/server/auth/orgService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requirePermission(request, "org:members:read");
  if (!auth.ok) return auth.response;

  const result = await listMembers(auth.value);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.value);
}
