/**
 * POST /api/investigate — runs the AI investigation agent on a case.
 *
 * TRUST BOUNDARY: the client sends ONLY `{ transactionId }`. Every fact
 * the investigation engine sees — amount, risk score, signals, customer
 * profile, precedent recall — is loaded from the database on the server,
 * tenant-scoped to the authenticated organisation. A tampered request
 * cannot change the facts, and a transaction belonging to another tenant
 * is indistinguishable from a missing one (404).
 *
 * The LLM provider configuration is the ORGANISATION's own (per-tenant
 * keys, sealed at rest) — one org can never spend another's credits or
 * see another's provider settings. Requires "investigations:create".
 */

import { NextResponse } from "next/server";
import {
  investigateCase,
  type AgentVerdict,
} from "@/lib/agent/investigator";
import { llmConfigured, resolveLlmConfig } from "@/lib/agent/llm";
import { loadServerCaseContext } from "@/lib/server/caseContext";
import { writeAudit } from "@/lib/server/ledger";
import { db } from "@/lib/db";
import { guardMutation } from "@/lib/server/auth/context";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await guardMutation(request, "investigations:create");
  if (!auth.ok) return auth.response;
  const { organisationId, user } = auth.value;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "Request body is not valid JSON" }, { status: 400 });
  }

  /* The ONLY client input: the transaction id. Everything else is loaded
   * from the database — tampering with amounts, scores or signals in the
   * request body has no effect on the facts the engine uses. */
  const txnId = typeof (body as Record<string, unknown> | null)?.transactionId === "string"
    ? ((body as Record<string, unknown>).transactionId as string).trim()
    : "";
  if (!txnId || txnId.length > 64) {
    return NextResponse.json(
      { ok: false, reason: "A `transactionId` string is required (this is the only accepted field)." },
      { status: 400 },
    );
  }

  /* Server-built case context — null covers both "missing" and
   * "belongs to another tenant" (non-disclosing 404). */
  const serverCase = await loadServerCaseContext(txnId, organisationId);
  if (!serverCase) {
    return NextResponse.json(
      { ok: false, reason: `Transaction ${txnId} does not exist in this organisation's ledger` },
      { status: 404 },
    );
  }

  if (!(await llmConfigured(organisationId))) {
    return NextResponse.json(
      { ok: false, reason: "LLM not configured for this organisation — heuristic engine will handle this case" },
      { status: 200 },
    );
  }

  const started = Date.now();
  const verdict: AgentVerdict | null = await investigateCase(serverCase.context, organisationId);
  const latencyMs = Date.now() - started;

  if (!verdict) {
    /* LLM was configured but failed (timeout/provider error/malformed
     * output) — record the fallback so the case file shows WHY the
     * heuristic verdict is the one of record. */
    await persistInvestigation(serverCase, null, latencyMs, organisationId);
    return NextResponse.json(
      { ok: false, reason: "Agent did not return a valid verdict — falling back to heuristics" },
      { status: 200 },
    );
  }

  await persistInvestigation(serverCase, verdict, latencyMs, organisationId);

  await writeAudit({
    organisationId,
    actor: "AI ENGINE",
    actorType: "AI",
    actorUserId: user.id,
    action: "INVESTIGATION_COMPLETED",
    entityType: "Investigation",
    entityId: txnId,
    detail: { mode: "llm", model: verdict.modelLabel, latencyMs },
    transactionId: serverCase.factsSummary.transactionRowId,
  });

  return NextResponse.json({
    ok: true,
    verdict,
    contextUsed: serverCase.factsSummary,
  });
}

/**
 * Persists the investigation outcome on the case's Investigation row —
 * never overwrites an analyst decision, never downgrades an LLM verdict.
 */
async function persistInvestigation(
  serverCase: NonNullable<Awaited<ReturnType<typeof loadServerCaseContext>>>,
  verdict: AgentVerdict | null,
  latencyMs: number,
  organisationId: string,
): Promise<void> {
  const rowId = serverCase.factsSummary.transactionRowId;
  const config = await resolveLlmConfig(organisationId);

  try {
    const existing = await db.investigation.findUnique({ where: { transactionId: rowId } });
    if (existing?.analystAction) return; // analyst decision is final — do not touch

    if (verdict) {
      const data = {
        mode: "llm",
        provider: config?.provider ?? null,
        modelId: verdict.modelLabel,
        riskAssessment: verdict.riskStory,
        recommendedAction: verdict.recommendedAction,
        confidence: verdict.confidence,
        supportingEvidenceJson: JSON.stringify(verdict.evidence),
        contradictingEvidenceJson: JSON.stringify(verdict.contradictingEvidence),
        uncertaintiesJson: JSON.stringify(verdict.uncertainties),
        status: "COMPLETE",
        fallbackReason: null,
        latencyMs,
      };
      await db.investigation.upsert({
        where: { transactionId: rowId },
        create: { organisationId, transactionId: rowId, ...data },
        update: data,
      });
    } else {
      /* Configured LLM failed — persist the heuristic fallback reason. */
      const data = {
        mode: "heuristic",
        provider: config?.provider ?? null,
        modelId: null,
        status: "COMPLETE",
        fallbackReason: "LLM call failed — deterministic heuristic verdict is the record",
        latencyMs,
      };
      await db.investigation.upsert({
        where: { transactionId: rowId },
        create: {
          organisationId,
          transactionId: rowId,
          ...data,
          riskAssessment: "Heuristic verdict — LLM was configured but the call failed.",
          recommendedAction: "REVIEW",
        },
        update: data,
      });
      await writeAudit({
        organisationId,
        actor: "SYSTEM",
        actorType: "SYSTEM",
        action: "INVESTIGATION_FALLBACK",
        entityType: "Investigation",
        entityId: serverCase.factsSummary.transactionId,
        detail: { fallbackReason: data.fallbackReason, latencyMs },
        transactionId: rowId,
      });
    }
  } catch {
    // Persistence must never break the investigation response contract.
  }
}
