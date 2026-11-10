/**
 * GET /api/auth/session — the SPA boot call. Returns the authenticated
 * context (user, memberships, active organisation, server-computed
 * permissions) or 401 { demoAvailable } for the dev login hint.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveSession } from "@/lib/server/auth/context";
import { getOrganisationProfile } from "@/lib/server/auth/orgService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ctx = await resolveSession(request);
  if (!ctx) {
    const demoAvailable =
      process.env.NODE_ENV !== "production" &&
      (await db.user.findUnique({ where: { email: "demo@razorshield.ai" }, select: { id: true } })) !== null;
    return NextResponse.json({ ok: false, error: "Not signed in.", demoAvailable }, { status: 401 });
  }
  const organisation = await getOrganisationProfile(ctx);
  return NextResponse.json({
    ok: true,
    user: ctx.user,
    sessionId: ctx.sessionId,
    memberships: ctx.memberships,
    organisationId: ctx.organisationId,
    role: ctx.role,
    permissions: ctx.permissions,
    organisation,
  });
}
