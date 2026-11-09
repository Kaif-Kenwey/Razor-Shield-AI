/**
 * RazorShield AI — the investigation agent.
 *
 * The deterministic rules engine (rse-1.2) remains the ground-truth
 * evidence generator; this module lets an LLM act as the INVESTIGATOR on
 * top of that evidence: interpret the signal set, weigh contradicting
 * evidence, and return a bounded, analyst-facing verdict.
 *
 * Design contract (deliberate):
 *  - No chain-of-thought is exposed. The analyst sees structured evidence
 *    and an interpretation, never the model's internal deliberation.
 *  - Output is strictly-typed JSON, validated and clamped server-side.
 *    Anything malformed → the caller falls back to the heuristic engine.
 *  - Confidence is decomposed (evidence agreement / data completeness /
 *    historical precedent) so "why 94%?" always has an answer.
 */

import type { RiskAction } from "@/types";
import { chatComplete, llmConfigured } from "./llm";

const ACTIONS: RiskAction[] = ["ALLOW", "REVIEW", "HOLD", "BLOCK"];

export interface AgentSignal {
  type: string;
  title: string;
  evidence: string;
  severity: string;
  impact: number;
}

export interface AgentCaseContext {
  transaction: {
    id: string;
    amount: number;
    currency: string;
    merchant: string;
    location: string;
    device: string;
    paymentMethod: string;
    timestamp: string;
  };
  riskScore: number;
  riskLevel: string;
  signals: AgentSignal[];
  customer: {
    id: string;
    name?: string;
    accountAge?: string;
    transactionCount?: number;
    avgTransaction?: number;
    previousIncidents?: number;
    usualLocation?: string;
    usualDevice?: string;
  };
  similarCases?: { id: string; similarity: number; outcome: string }[];
}

export interface AgentVerdict {
  mode: "llm";
  modelLabel: string;
  riskAssessment: string;
  recommendedAction: RiskAction;
  confidence: number;
  confidenceFactors: {
    evidenceAgreement: number;
    dataCompleteness: number;
    historicalPrecedent: number;
  };
  evidence: string[];
  contradictingEvidence: string[];
  uncertainties: string[];
  riskStory: string;
}

const clamp = (n: unknown, lo: number, hi: number, fallback: number): number => {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;
};

const strList = (v: unknown, max: number, maxLen = 240): string[] =>
  Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .map((x) => x.trim().slice(0, maxLen))
        .slice(0, max)
    : [];

function extractJson(text: string): Record<string, unknown> | null {
  // Tolerate markdown fences or stray prose around the JSON object.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(candidate.slice(start, end + 1));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function buildSystemPrompt(): string {
  return [
    "You are the RazorShield investigation agent: a senior payment-risk investigator working inside a fraud-operations command center.",
    "A deterministic rules engine (rse-1.2) has already scored the transaction and produced structured evidence. Your job is to INTERPRET that evidence like an experienced investigator would: weigh which signals genuinely matter for THIS customer, consider contradicting evidence, and recommend one bounded action.",
    "",
    "Ground rules:",
    "- Ground every statement ONLY in the facts provided. Never invent transactions, devices, or history.",
    "- Weigh contradicting evidence honestly (e.g. long tenure, consistent prior behavior, small amount). If it materially weakens the case, say so and lower the recommended severity.",
    "- Distinguish risk probability from decision confidence. Confidence must reflect how complete and mutually consistent the evidence is.",
    "- Recommended action must be one of: ALLOW, REVIEW, HOLD, BLOCK.",
    "- risk_story is an analyst-facing narrative of 3-5 sentences: lead with what is most unusual, quantify against the customer baseline, then state why the action follows. No preamble, no first person.",
    "- Do NOT expose chain-of-thought. The evidence, contradicting_evidence and uncertainties arrays ARE the analyst-facing output of your reasoning — nothing else.",
    "- uncertainties should state what better data would resolve (e.g. coarse location, missing device history).",
    "",
    "Respond with ONLY a JSON object matching exactly this schema:",
    `{`,
    `  "risk_assessment": "LOW | MEDIUM | HIGH | CRITICAL",`,
    `  "recommended_action": "ALLOW | REVIEW | HOLD | BLOCK",`,
    `  "confidence": 0-100,`,
    `  "confidence_factors": { "evidence_agreement": 0-100, "data_completeness": 0-100, "historical_precedent": 0-100 },`,
    `  "evidence": ["short analyst-facing findings that SUPPORT the assessment"],`,
    `  "contradicting_evidence": ["facts that cut the other way — empty array only if truly none"],`,
    `  "uncertainties": ["what better data would resolve"],`,
    `  "risk_story": "3-5 sentence narrative for the case file"`,
    `}`,
  ].join("\n");
}

function buildCaseBlock(ctx: AgentCaseContext): string {
  const t = ctx.transaction;
  const c = ctx.customer;
  const lines: string[] = [
    "TRANSACTION",
    `  id: ${t.id}`,
    `  amount: ${t.currency} ${t.amount.toLocaleString("en-IN")}`,
    `  merchant: ${t.merchant}`,
    `  location: ${t.location}`,
    `  device: ${t.device}`,
    `  payment_method: ${t.paymentMethod}`,
    `  timestamp: ${t.timestamp}`,
    "",
    "RULES ENGINE RESULT",
    `  risk_score: ${ctx.riskScore}/100`,
    `  risk_level: ${ctx.riskLevel}`,
    `  signals (${ctx.signals.length}):`,
    ...ctx.signals.map(
      (s) => `    - [${s.severity}] ${s.title} (+${s.impact} pts): ${s.evidence}`,
    ),
    "",
    "CUSTOMER PROFILE",
    `  id: ${c.id}`,
    c.name ? `  name: ${c.name}` : null,
    c.accountAge ? `  account_age: ${c.accountAge}` : null,
    typeof c.transactionCount === "number" ? `  lifetime_transactions: ${c.transactionCount}` : null,
    typeof c.avgTransaction === "number" ? `  avg_ticket: INR ${c.avgTransaction.toLocaleString("en-IN")}` : null,
    typeof c.previousIncidents === "number" ? `  prior_incidents: ${c.previousIncidents}` : null,
    c.usualLocation ? `  usual_location: ${c.usualLocation}` : null,
    c.usualDevice ? `  usual_device: ${c.usualDevice}` : null,
  ].filter((x): x is string => typeof x === "string");

  if (ctx.similarCases?.length) {
    lines.push(
      "",
      "SIMILAR PAST CASES (engine recall)",
      ...ctx.similarCases.map(
        (s) => `  - ${s.id}: ${Math.round(s.similarity * 100)}% similar → resolved ${s.outcome}`,
      ),
    );
  }
  return lines.join("\n");
}

/**
 * Runs the investigation. Returns null when the LLM is unavailable or the
 * verdict fails validation — the caller then falls back to the heuristic
 * engine, and the UI labels which mode produced the final analysis.
 */
export async function investigateCase(ctx: AgentCaseContext): Promise<AgentVerdict | null> {
  if (!llmConfigured()) return null;

  try {
    const { content, model } = await chatComplete(
      [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: buildCaseBlock(ctx) },
      ],
      { temperature: 0.2, maxTokens: 800, timeoutMs: 22_000 },
    );

    const raw = extractJson(content);
    if (!raw) return null;

    const action = String(raw.recommended_action ?? "").toUpperCase() as RiskAction;
    if (!ACTIONS.includes(action)) return null;

    const story = typeof raw.risk_story === "string" ? raw.risk_story.trim() : "";
    if (story.length < 40) return null; // guard against degenerate output

    const factors = (raw.confidence_factors ?? {}) as Record<string, unknown>;
    const confidence = clamp(raw.confidence, 0, 100, 60);

    return {
      mode: "llm",
      modelLabel: model,
      riskAssessment: String(raw.risk_assessment ?? ctx.riskLevel).toUpperCase().slice(0, 12),
      recommendedAction: action,
      confidence,
      confidenceFactors: {
        evidenceAgreement: clamp(factors.evidence_agreement, 0, 100, confidence),
        dataCompleteness: clamp(factors.data_completeness, 0, 100, confidence),
        historicalPrecedent: clamp(factors.historical_precedent, 0, 100, confidence),
      },
      evidence: strList(raw.evidence, 6),
      contradictingEvidence: strList(raw.contradicting_evidence, 5),
      uncertainties: strList(raw.uncertainties, 4),
      riskStory: story,
    };
  } catch {
    // Network/timeout/HTTP failure — deterministic fallback handles it.
    return null;
  }
}
