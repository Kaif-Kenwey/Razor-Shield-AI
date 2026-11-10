/**
 * GET /api/org — active organisation profile for the authenticated user.
 */

import { NextResponse } from "next/server";
import { requireOrg } from "@/lib/server/auth/context";
import { getOrganisationProfile } from "@/lib/server/auth/orgService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireOrg(request);
  if (!auth.ok) return auth.response;

  const profile = await getOrganisationProfile(auth.value);
  if (!profile) {
    return NextResponse.json({ ok: false, error: "Organisation not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, organisation: profile });
}
