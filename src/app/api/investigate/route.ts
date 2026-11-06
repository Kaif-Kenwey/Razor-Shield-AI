/**
 * POST /api/investigate — runs the AI investigation agent on a case.
 *
 * The client sends the case context assembled from the live transaction
 * (engine signals + customer profile + similar-case recall); the server
 * asks the configured LLM for a bounded verdict and validates it.
 *
 * The response is ALWAYS valid JSON. When the agent is unavailable
 * (no LLM configured, timeout, provider error, malformed output) the
 * route answers { ok: false, reason } and the client falls back to the
 * deterministic heuristic engine — the UI states which mode produced
 * the final analysis either way.
 */

import { NextResponse } from "next/server";

import {
  investigateCase,
  type AgentCaseContext,
} from "@/lib/agent/investigator";
import { llmConfigured, resolveLlmConfig } from "@/lib/agent/llm";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/server/ledger";

export const runtime = "nodejs";

const MAX_SIGNALS = 12;
const MAX_SIMILAR = 8;

function num(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : fallback;
}

/** Defensive coercion — the client is trusted-ish, the LLM is not. */
function sanitizeContext(raw: unknown): AgentCaseContext | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const t = (r.transaction ?? {}) as Record<string, unknown>;
  const c = (r.customer ?? {}) as Record<string, unknown>;

  const id = str(t.id);
  if (!id) return null;

  const signalsRaw = Array.isArray(r.signals) ? r.signals.slice(0, MAX_SIGNALS) : [];
  const similarRaw = Array.isArray(r.similarCases) ? r.similarCases.slice(0, MAX_SIMILAR) : [];

  return {
    transaction: {
      id,
      amount: Math.max(0, num(t.amount, 0)),
      currency: str(t.currency, "INR") || "INR",
      merchant: str(t.merchant, "unknown"),
      location: str(t.location, "unknown"),
      device: str(t.device, "unknown"),
      paymentMethod: str(t.paymentMethod, "unknown"),
      timestamp: str(t.timestamp, new Date().toISOString()),
    },
    riskScore: Math.min(100, Math.max(0, num(r.riskScore, 0))),
    riskLevel: str(r.riskLevel, "MEDIUM"),
    signals: signalsRaw.map((s) => {
      const sig = (s ?? {}) as Record<string, unknown>;
      return {
        type: str(sig.type, "SIGNAL"),
        title: str(sig.title, "Signal"),
        evidence: str(sig.evidence),
        severity: str(sig.severity, "LOW"),
        impact: Math.max(0, num(sig.impact, 0)),
      };
    }),
    customer: {
      id: str(c.id, "unknown"),
      name: str(c.name) || undefined,
      accountAge: str(c.accountAge) || undefined,
      transactionCount: typeof c.transactionCount === "number" ? c.transactionCount : undefined,
      avgTransaction: typeof c.avgTransaction === "number" ? c.avgTransaction : undefined,
      previousIncidents: typeof c.previousIncidents === "number" ? c.previousIncidents : undefined,
      usualLocation: str(c.usualLocation) || undefined,
      usualDevice: str(c.usualDevice) || undefined,
    },
    similarCases: similarRaw.map((s) => {
      const sc = (s ?? {}) as Record<string, unknown>;
      return {
        id: str(sc.id, "CASE"),
        similarity: Math.min(1, Math.max(0, num(sc.similarity, 0))),
        outcome: str(sc.outcome, "unknown"),
      };
    }),
  };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "Request body is not valid JSON" }, { status: 400 });
  }

  const raw = (body as Record<string, unknown> | null)?.context;
  const ctx = sanitizeContext(raw);
  if (!ctx) {
    return NextResponse.json({ ok: false, reason: "Missing or malformed case context" }, { status: 400 });
  }

  /* DB-backed case when the transaction exists in the ledger — evidence is
   * loaded server-side instead of trusting the client copy. */
  const ledgerRow = await db.transaction.findUnique({
    where: { id: ctx.transaction.id },
    include: { investigation: true },
  });

  const started = Date.now();

  if (!llmConfigured()) {
    if (ledgerRow) {
      await persistInvestigation(ledgerRow.id, {
        mode: "heuristic",
        provider: null,
        modelId: null,
        riskAssessment: "Heuristic mode — no LLM configured. The rules engine's signals are the analysis; the recommendation mirrors the engine verdict.",
        recommendedAction: verdictFromLevel(ledgerRow.riskLevel),
        confidence: null,
        fallbackReason: "No LLM configured",
        latencyMs: Date.now() - started,
      });
      await writeAudit({
        actor: "SYSTEM",
        action: "INVESTIGATION_COMPLETED",
        entityType: "Transaction",
        entityId: ledgerRow.id,
        detail: { mode: "heuristic", reason: "no-llm" },
        transactionId: ledgerRow.id,
      });
    }
    return NextResponse.json(
      { ok: false, reason: "LLM not configured — heuristic engine will handle this case" },
      { status: 200 },
    );
  }

  const verdict = await investigateCase(ctx);
  const latencyMs = Date.now() - started;

  if (!verdict) {
    if (ledgerRow) {
      await persistInvestigation(ledgerRow.id, {
        mode: "heuristic",
        provider: null,
        modelId: null,
        riskAssessment: "The configured LLM failed or returned malformed output — the deterministic heuristic verdict applies.",
        recommendedAction: verdictFromLevel(ledgerRow.riskLevel),
        confidence: null,
        fallbackReason: "LLM unavailable or invalid response",
        latencyMs,
      });
      await writeAudit({
        actor: "AI ENGINE",
        action: "INVESTIGATION_COMPLETED",
        entityType: "Transaction",
        entityId: ledgerRow.id,
        detail: { mode: "heuristic", reason: "llm-fallback", latencyMs },
        transactionId: ledgerRow.id,
      });
    }
    return NextResponse.json(
      { ok: false, reason: "Agent did not return a valid verdict — falling back to heuristics" },
      { status: 200 },
    );
  }

  /* Persist the completed LLM investigation with the provider/model that
   * actually answered. */
  if (ledgerRow) {
    await persistInvestigation(ledgerRow.id, {
      mode: "llm",
      provider: resolveLlmConfig()?.provider ?? "custom",
      modelId: verdict.modelLabel || resolveLlmConfig()?.model || null,
      riskAssessment: verdict.riskAssessment || verdict.riskStory || "",
      recommendedAction: verdict.recommendedAction,
      confidence: typeof verdict.confidence === "number" ? verdict.confidence : null,
      supporting: verdict.evidence ?? [],
      contradicting: verdict.contradictingEvidence ?? [],
      uncertainties: verdict.uncertainties ?? [],
      fallbackReason: null,
      latencyMs,
    });
    await writeAudit({
      actor: "AI ENGINE",
      action: "INVESTIGATION_COMPLETED",
      entityType: "Transaction",
      entityId: ledgerRow.id,
      detail: {
        mode: "llm",
        provider: resolveLlmConfig()?.provider ?? "custom",
        model: verdict.modelLabel ?? null,
        recommendedAction: verdict.recommendedAction,
        latencyMs,
      },
      transactionId: ledgerRow.id,
    });
  }

  return NextResponse.json({ ok: true, verdict });
}

/* ------------------------------------------------------------------ */
/* Persistence helpers                                                 */
/* ------------------------------------------------------------------ */

function verdictFromLevel(level: string): "ALLOW" | "REVIEW" | "HOLD" | "BLOCK" {
  return level === "CRITICAL" ? "BLOCK" : level === "HIGH" ? "REVIEW" : level === "MEDIUM" ? "REVIEW" : "ALLOW";
}

interface PersistInput {
  mode: "llm" | "heuristic";
  provider: string | null;
  modelId: string | null;
  riskAssessment: string;
  recommendedAction: string;
  confidence: number | null;
  supporting?: string[];
  contradicting?: string[];
  uncertainties?: string[];
  fallbackReason: string | null;
  latencyMs: number;
}

async function persistInvestigation(transactionId: string, input: PersistInput) {
  const data = {
    mode: input.mode,
    provider: input.provider,
    modelId: input.modelId,
    riskAssessment: input.riskAssessment.slice(0, 6000),
    recommendedAction: input.recommendedAction,
    confidence: input.confidence,
    supportingEvidenceJson: JSON.stringify((input.supporting ?? []).slice(0, 12)),
    contradictingEvidenceJson: JSON.stringify((input.contradicting ?? []).slice(0, 12)),
    uncertaintiesJson: JSON.stringify((input.uncertainties ?? []).slice(0, 12)),
    status: "COMPLETE",
    fallbackReason: input.fallbackReason,
    latencyMs: input.latencyMs,
  };
  await db.investigation.upsert({
    where: { transactionId },
    create: { transactionId, ...data },
    update: data,
  });
}
