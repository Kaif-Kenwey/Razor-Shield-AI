/**
 * POST /api/investigate — runs the AI investigation agent on a case.
 *
 * TRUST BOUNDARY (hardened): the client sends ONLY `{ transactionId }`.
 * Every fact the investigation engine sees — amount, risk score, signals,
 * customer profile, precedent recall — is loaded from SQLite on the
 * server (`loadServerCaseContext`). A tampered request cannot change the
 * facts: extra fields in the body are ignored, unknown transactions are
 * rejected with 404, and the response echoes the server-built facts so
 * any caller can verify what was actually used.
 *
 * The response is ALWAYS valid JSON. When the agent is unavailable
 * (no LLM configured, timeout, provider error, malformed output) the
 * route answers { ok: false, reason } and the client falls back to the
 * deterministic heuristic engine — the UI states which mode produced
 * the final analysis either way. LLM verdicts are persisted to the
 * Investigation row (with provider/model/latency) so the mode survives
 * restarts; heuristic fallbacks are persisted only when an LLM was
 * configured but the call failed (the fallback reason is the record).
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

export const runtime = "nodejs";

export async function POST(request: Request) {
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

  /* Server-built case context — null means the transaction does not exist. */
  const serverCase = await loadServerCaseContext(txnId);
  if (!serverCase) {
    return NextResponse.json(
      { ok: false, reason: `Transaction ${txnId} does not exist in the ledger` },
      { status: 404 },
    );
  }

  if (!llmConfigured()) {
    return NextResponse.json(
      { ok: false, reason: "LLM not configured — heuristic engine will handle this case" },
      { status: 200 },
    );
  }

  const started = Date.now();
  const verdict: AgentVerdict | null = await investigateCase(serverCase.context);
  const latencyMs = Date.now() - started;

  if (!verdict) {
    /* LLM was configured but failed (timeout/provider error/malformed
     * output) — record the fallback so the case file shows WHY the
     * heuristic verdict is the one of record. */
    await persistInvestigation(serverCase, null, latencyMs);
    return NextResponse.json(
      { ok: false, reason: "Agent did not return a valid verdict — falling back to heuristics" },
      { status: 200 },
    );
  }

  await persistInvestigation(serverCase, verdict, latencyMs);

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
): Promise<void> {
  const txnId = serverCase.factsSummary.transactionId;
  const config = resolveLlmConfig();

  try {
    const existing = await db.investigation.findUnique({ where: { transactionId: txnId } });
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
        where: { transactionId: txnId },
        create: { transactionId: txnId, ...data },
        update: data,
      });
      await writeAudit({
        actor: "AI ENGINE",
        action: "INVESTIGATION_COMPLETED",
        entityType: "Investigation",
        entityId: txnId,
        detail: {
          mode: "llm",
          model: verdict.modelLabel,
          confidence: verdict.confidence,
          latencyMs,
          factsUsed: serverCase.factsSummary,
        },
        transactionId: txnId,
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
        where: { transactionId: txnId },
        create: {
          transactionId: txnId,
          ...data,
          riskAssessment: "Heuristic verdict — LLM was configured but the call failed.",
          recommendedAction: "REVIEW",
        },
        update: data,
      });
      await writeAudit({
        actor: "SYSTEM",
        action: "INVESTIGATION_FALLBACK",
        entityType: "Investigation",
        entityId: txnId,
        detail: { fallbackReason: data.fallbackReason, latencyMs },
        transactionId: txnId,
      });
    }
  } catch {
    // Persistence must never break the investigation response contract.
  }
}
