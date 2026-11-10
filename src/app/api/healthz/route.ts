/**
 * GET /api/healthz — unauthenticated liveness probe for load balancers
 * and uptime checks. Intentionally reveals no data. The detailed
 * system health (database, queue, LLM state) lives at
 * /api/system/health behind authentication.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: true, status: "healthy", time: new Date().toISOString() });
}
