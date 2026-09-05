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
import { llmConfigured } from "@/lib/agent/llm";

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

  const ctx = sanitizeContext((body as Record<string, unknown> | null)?.context);
  if (!ctx) {
    return NextResponse.json({ ok: false, reason: "Missing or malformed case context" }, { status: 400 });
  }

  if (!llmConfigured()) {
    return NextResponse.json(
      { ok: false, reason: "LLM not configured — heuristic engine will handle this case" },
      { status: 200 },
    );
  }

  const verdict = await investigateCase(ctx);
  if (!verdict) {
    return NextResponse.json(
      { ok: false, reason: "Agent did not return a valid verdict — falling back to heuristics" },
      { status: 200 },
    );
  }

  return NextResponse.json({ ok: true, verdict });
}
