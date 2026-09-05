/**
 * RazorShield AI — investigation runner (client side).
 *
 * Single pipeline for turning a transaction into an analyst-facing
 * investigation:
 *
 *   transaction → rules engine evidence (already attached)
 *              → POST /api/investigate  (LLM investigator, when configured)
 *              → validated agent verdict  OR  heuristic fallback
 *              → store update + phase completion
 *
 * The UI states which mode produced the final analysis ("llm" vs
 * "heuristic") — the system never blurs that line.
 */

import type { Investigation, Transaction } from "@/types";
import { useAppStore } from "@/store/appStore";
import { buildInvestigation, customerFor, similarCasesFor } from "@/data/mockData";
import type { AgentCaseContext } from "./investigator";

/* ------------------------------------------------------------------ */
/* Heuristic conclusion (fallback + render-time derivation)            */
/* ------------------------------------------------------------------ */

const SIGNAL_CLAUSE: Record<string, string> = {
  NEW_DEVICE: "the device has not previously been associated with the account",
  UNUSUAL_AMOUNT: "the amount is well above the customer's typical range",
  LOCATION_ANOMALY: "the origin location is inconsistent with recent activity",
  VELOCITY_SPIKE: "a short burst of transactions was detected",
  IMPOSSIBLE_TRAVEL: "successive activity implies physically impossible travel",
  HIGH_VALUE: "the amount crosses the elevated-value policy threshold",
  MERCHANT_RISK: "the merchant category shows elevated chargeback rates",
  TIME_ANOMALY: "the payment occurs outside the customer's usual activity window",
};

export function deriveConclusion(txn: Transaction): {
  aiSummary: string;
  recommendation: NonNullable<Transaction["recommendation"]>;
  confidence: number;
} {
  const clauses = txn.signals
    .map((s) => SIGNAL_CLAUSE[s.type])
    .filter(Boolean);

  const level = txn.riskLevel;
  const tail =
    level === "CRITICAL"
      ? " Multiple independent signals converge, so an immediate bounded action is recommended."
      : level === "HIGH"
        ? " Correlated signals suggest elevated exposure; analyst review is recommended before settlement."
        : level === "MEDIUM"
          ? " The deviation is moderate; a review is suggested but the pattern is not conclusive."
          : " The transaction is consistent with the customer's established behavior and requires no action.";

  return {
    aiSummary: `This transaction deviates from the customer's historical behavior${clauses.length ? ": " + clauses.join("; ") : "."}${tail}`,
    recommendation:
      txn.recommendation ??
      (level === "CRITICAL" ? "BLOCK" : level === "HIGH" ? "REVIEW" : level === "MEDIUM" ? "REVIEW" : "ALLOW"),
    confidence: Math.round(Math.min(96, 58 + txn.riskScore * 0.4)),
  };
}

export const ENGINE_LABEL = "rse-1.2 heuristics";

/** Deterministic investigation with honest mode labeling. */
export function heuristicInvestigation(txn: Transaction): Investigation {
  const d = deriveConclusion(txn);
  return {
    ...buildInvestigation(txn, txn.timestamp),
    mode: "heuristic",
    modelLabel: ENGINE_LABEL,
    reasoning: txn.aiSummary ?? d.aiSummary,
  };
}

/* ------------------------------------------------------------------ */
/* Agent context assembly                                              */
/* ------------------------------------------------------------------ */

export function buildAgentContext(txn: Transaction): AgentCaseContext {
  const c = customerFor(txn);
  return {
    transaction: {
      id: txn.id,
      amount: txn.amount,
      currency: txn.currency,
      merchant: txn.merchant,
      location: txn.location,
      device: txn.device,
      paymentMethod: txn.paymentMethod,
      timestamp: txn.timestamp,
    },
    riskScore: txn.riskScore,
    riskLevel: txn.riskLevel,
    signals: txn.signals.map((s) => ({
      type: s.type,
      title: s.title,
      evidence: s.evidence,
      severity: s.severity,
      impact: s.impact,
    })),
    customer: {
      id: c.id,
      name: c.name,
      accountAge: c.accountAge,
      transactionCount: c.transactionCount,
      avgTransaction: c.avgTransaction,
      previousIncidents: c.previousIncidents,
      usualLocation: c.usualLocation,
      usualDevice: c.usualDevice,
    },
    similarCases: similarCasesFor(txn).map((s) => ({
      id: s.id,
      similarity: Math.min(1, s.similarity / 100),
      outcome: s.outcomeLabel ?? s.outcome,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* The runner                                                          */
/* ------------------------------------------------------------------ */

/** Matches the staged-analysis pacing in InvestigationView (6 × 620ms + 500ms). */
export const MIN_THEATER_MS = 6 * 620 + 500;

export type InvestigationMode = "llm" | "heuristic" | "skipped";

/**
 * Runs the real investigation for a case and completes its phase.
 * Idempotent: never overwrites an existing investigation, always ends
 * with phase === "complete", never throws.
 */
export async function runAgentInvestigation(
  txnId: string,
  opts?: { minTheaterMs?: number },
): Promise<InvestigationMode> {
  const started = Date.now();
  try {
    const s0 = useAppStore.getState();
    const txn = s0.transactions.find((t) => t.id === txnId);
    const inv = txn?.investigation;
    /* Canned heuristic investigations ship with the demo cases — they are
     * a PREVIEW, not the final analysis. The agent replaces them unless a
     * real verdict (mode "llm") or an analyst decision already exists. */
    const locked = !!inv && (inv.mode === "llm" || !!inv.analystAction);
    if (!txn || locked) {
      if (txn) s0.setPhase(txnId, "complete");
      return "skipped";
    }

    const base = deriveConclusion(txn);
    const heuristic = heuristicInvestigation(txn);

    let patch: Partial<Transaction> = {
      aiSummary: base.aiSummary,
      recommendation: txn.recommendation ?? base.recommendation,
      confidence: base.confidence,
      investigation: heuristic,
    };
    let mode: InvestigationMode = "heuristic";

    try {
      const res = await fetch("/api/investigate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: buildAgentContext(txn) }),
        signal: AbortSignal.timeout(24_000),
      });
      if (res.ok) {
        const data: unknown = await res.json();
        const d = data as {
          ok?: boolean;
          verdict?: {
            modelLabel?: string;
            recommendedAction?: Transaction["recommendation"];
            confidence?: number;
            confidenceFactors?: Investigation["confidenceFactors"];
            contradictingEvidence?: string[];
            uncertainties?: string[];
            riskStory?: string;
          };
        };
        const v = d?.verdict;
        if (d?.ok && v?.riskStory && v.recommendedAction) {
          mode = "llm";
          patch = {
            aiSummary: v.riskStory,
            recommendation: v.recommendedAction,
            confidence: typeof v.confidence === "number" ? v.confidence : base.confidence,
            investigation: {
              ...heuristic,
              mode: "llm",
              modelLabel: typeof v.modelLabel === "string" && v.modelLabel ? v.modelLabel : "llm",
              reasoning: v.riskStory,
              riskStory: v.riskStory,
              contradictingEvidence: Array.isArray(v.contradictingEvidence) ? v.contradictingEvidence : [],
              uncertainties: Array.isArray(v.uncertainties) ? v.uncertainties : [],
              confidenceFactors: v.confidenceFactors ?? undefined,
            },
          };
        }
      }
    } catch {
      // Network failure / timeout / abort → heuristic verdict stands.
    }

    // Respect the staged-analysis minimum so the theater still plays out.
    const wait = (opts?.minTheaterMs ?? MIN_THEATER_MS) - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));

    const s = useAppStore.getState();
    const still = s.transactions.find((t) => t.id === txnId);
    if (!still) return "skipped";
    const stillInv = still.investigation;
    const stillLocked = !!stillInv && (stillInv.mode === "llm" || !!stillInv.analystAction);
    if (!stillLocked) s.updateTransaction(txnId, patch);
    s.setPhase(txnId, "complete");
    return mode;
  } catch {
    // Last-resort guarantee: the case never hangs in "analyzing".
    const s = useAppStore.getState();
    const txn = s.transactions.find((t) => t.id === txnId);
    if (txn && !txn.investigation) {
      const d = deriveConclusion(txn);
      s.updateTransaction(txnId, {
        aiSummary: d.aiSummary,
        recommendation: d.recommendation,
        confidence: d.confidence,
        investigation: heuristicInvestigation(txn),
      });
    }
    s.setPhase(txnId, "complete");
    return "heuristic";
  }
}
