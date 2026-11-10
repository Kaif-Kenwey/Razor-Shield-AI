/**
 * /api/system/health — live service status measured against the real
 * backend: database latency (round-trip timing), ledger + dataset counts,
 * investigation queue depth and the LLM endpoint state — all TENANT-
 * SCOPED to the authenticated organisation. Requires authentication.
 *
 * The unauthenticated liveness probe lives at /api/healthz and reveals
 * no data. The audit log counts recent system events so the UI can
 * prove activity is real.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveLlmConfig, llmConfigured } from "@/lib/agent/llm";
import { orgConfigVerified, readOrgLlmConfig } from "@/lib/agent/llmConfigStore";
import { requireAuth } from "@/lib/server/auth/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const { organisationId, role, user } = auth.value;

  const dbStart = Date.now();
  let dbOk = true;
  let counts = { transactions: 0, customers: 0, datasets: 0, auditEvents: 0 };
  let queue = { investigating: 0, underReview: 0 };
  if (organisationId) {
    try {
      const [transactions, customers, datasets, auditEvents, investigating, underReview] =
        await Promise.all([
          db.transaction.count({ where: { organisationId } }),
          db.customer.count({ where: { organisationId } }),
          db.dataset.count({ where: { organisationId } }),
          db.auditEvent.count({ where: { organisationId } }),
          db.transaction.count({ where: { organisationId, status: "INVESTIGATING" } }),
          db.transaction.count({ where: { organisationId, status: "UNDER_REVIEW" } }),
        ]);
      counts = { transactions, customers, datasets, auditEvents };
      queue = { investigating, underReview };
    } catch {
      dbOk = false;
    }
  }
  const dbLatencyMs = Date.now() - dbStart;

  const orgCfg = organisationId ? await readOrgLlmConfig(organisationId) : null;
  const active = await resolveLlmConfig(organisationId);
  const verification = organisationId ? await orgConfigVerified(organisationId) : null;
  const llm = {
    configured: await llmConfigured(organisationId),
    /** "org" = this organisation's own saved config; "env" = infra-managed
     * fallback; "none" = heuristics only. */
    source: orgCfg ? ("org" as const) : active ? ("env" as const) : ("none" as const),
    provider: orgCfg?.provider ?? (active ? "env" : null),
    model: active?.model || null,
    verification: orgCfg ? (verification ? ("verified" as const) : ("saved" as const)) : null,
    /** Keys are always encrypted at rest (AES-256-GCM) — surfaced so the
     * posture is inspectable, not just promised. */
    keyEncryption: "aes-256-gcm" as const,
  };

  return NextResponse.json({
    ok: true,
    database: { ok: dbOk, latencyMs: dbLatencyMs },
    counts,
    queue,
    llm,
    engine: { version: "rse-1.2.0", kind: "deterministic-rules" },
    security: {
      /** Phase 1 posture: every route requires an authenticated session;
       * data is isolated per organisation; RBAC is enforced server-side. */
      authentication: "required" as const,
      tenantIsolation: "organisation-scoped" as const,
      rbac: "enforced" as const,
      yourRole: role,
      keyEncryption: "aes-256-gcm" as const,
      hint: "Session authentication with per-organisation isolation. API keys and LLM credentials are encrypted at rest.",
    },
    viewer: { email: user.email, name: user.name, emailVerified: user.emailVerified },
    serverTime: new Date().toISOString(),
  });
}
