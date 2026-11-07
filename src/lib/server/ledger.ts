/**
 * RazorShield AI — server-side ledger helpers.
 *
 * Bridges the Prisma Transaction model and the UI's `Transaction` shape,
 * plus small shared utilities used by every API route (audit writer,
 * status mapping, pagination plumbing). Nothing in here runs in the
 * browser — everything imports `db` from the server context.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type {
  AuditEntry,
  Investigation,
  RiskAction,
  RiskLevel,
  RiskSignal,
  Transaction,
  TransactionStatus,
} from "@/types";

/* ------------------------------------------------------------------ */
/* Row ⇄ UI mapping                                                    */
/* ------------------------------------------------------------------ */

export type LedgerRow = Prisma.TransactionGetPayload<{ include: { investigation: true } }>;

export function parseSignals(raw: string): RiskSignal[] {
  try {
    const parsed = JSON.parse(raw) as RiskSignal[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parseWarnings(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Prisma ledger row → the UI's Transaction shape. */
export function toUiTransaction(row: LedgerRow): Transaction {
  const level = row.riskLevel as RiskLevel;
  return {
    id: row.id,
    amount: row.amount,
    customerId: row.customerId,
    customerName: row.customerName,
    merchant: row.merchant,
    location: row.location,
    device: row.device,
    isNewDevice: row.isNewDevice,
    paymentMethod: normalizeMethod(row.paymentMethod),
    riskScore: Math.round(row.riskScore),
    riskLevel: level,
    status: row.status as TransactionStatus,
    timestamp: row.timestamp.toISOString(),
    currency: "INR",
    signals: parseSignals(row.signalsJson),
    aiSummary: row.aiSummary,
    recommendation: (row.recommendation as RiskAction | null) ?? null,
    confidence: row.confidence,
    assigneeId: row.assigneeId,
    escalatedTo: row.escalatedTo,
    investigation: row.investigation ? investigationFromRow(row.investigation) : undefined,
  };
}

/** Prisma Investigation row → the UI's Investigation shape. */
export function investigationFromRow(
  inv: NonNullable<LedgerRow["investigation"]>,
): Investigation {
  const baseIso = inv.createdAt.toISOString();
  return {
    transactionId: inv.transactionId,
    status: inv.status === "ANALYZING" ? "ANALYZING" : "COMPLETE",
    timeline: [],
    auditTrail: auditEntriesFromInvestigation(inv, baseIso),
    evidenceUsed: safeStringArray(inv.supportingEvidenceJson),
    reasoning: inv.riskAssessment,
    mode: inv.mode === "llm" ? "llm" : "heuristic",
    modelLabel:
      inv.mode === "llm"
        ? inv.modelId || "unknown model"
        : "rse-1.2 heuristics",
    riskStory: inv.riskAssessment,
    contradictingEvidence: safeStringArray(inv.contradictingEvidenceJson),
    uncertainties: safeStringArray(inv.uncertaintiesJson),
    analystAction: (inv.analystAction as RiskAction | null) ?? undefined,
    analystNote: inv.analystNote ?? undefined,
    resolvedAt: inv.resolvedAt?.toISOString(),
  };
}

function auditEntriesFromInvestigation(
  inv: NonNullable<LedgerRow["investigation"]>,
  baseIso: string,
): AuditEntry[] {
  const entries: AuditEntry[] = [
    { time: baseIso, actor: "RISK MODEL", action: "Case opened with engine signals" },
    {
      time: baseIso,
      actor: inv.mode === "llm" ? "AI ENGINE" : "SYSTEM",
      action:
        inv.mode === "llm"
          ? `LLM investigation completed (${inv.modelId ?? "model"})`
          : "Heuristic investigation completed",
      detail: inv.fallbackReason ?? undefined,
    },
  ];
  if (inv.analystAction) {
    entries.push({
      time: inv.resolvedAt?.toISOString() ?? baseIso,
      actor: "ANALYST",
      action: `Decision recorded — ${inv.analystAction}`,
      detail: inv.analystNote ?? undefined,
    });
  }
  return entries;
}

function safeStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

const METHODS = ["UPI", "Credit Card", "Debit Card", "Netbanking", "Wallet"] as const;

function normalizeMethod(raw: string): Transaction["paymentMethod"] {
  const hit = METHODS.find((m) => m.toLowerCase() === raw.toLowerCase());
  /* Honest fallback: an absent/unrecognized rail is shown as Unknown —
   * never silently fabricated into a real rail like UPI. */
  return hit ?? "Unknown";
}

/** UI status the ledger stores after an analyst decision. */
export function statusForAction(action: RiskAction): TransactionStatus {
  return action === "BLOCK"
    ? "BLOCKED"
    : action === "ALLOW"
      ? "ALLOWED"
      : action === "HOLD"
        ? "ON_HOLD"
        : "UNDER_REVIEW";
}

/* ------------------------------------------------------------------ */
/* Audit writer                                                        */
/* ------------------------------------------------------------------ */

export interface AuditInput {
  actor: "SYSTEM" | "AI ENGINE" | "RISK MODEL" | "ANALYST";
  action: string;
  entityType: string;
  entityId: string;
  detail?: Record<string, unknown>;
  transactionId?: string | null;
}

export async function writeAudit(input: AuditInput): Promise<void> {
  await db.auditEvent.create({
    data: {
      actor: input.actor,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      detailJson: JSON.stringify(input.detail ?? {}),
      transactionId: input.transactionId ?? null,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Shared route plumbing                                               */
/* ------------------------------------------------------------------ */

export function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export type Pagination = z.infer<typeof paginationSchema>;

export function paginationMeta(total: number, page: number, pageSize: number) {
  return {
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
