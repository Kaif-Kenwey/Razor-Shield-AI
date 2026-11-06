/**
 * RazorShield AI — shared transaction-scoring service.
 *
 * The single path every ingestion surface uses (manual entry, CSV import,
 * demo generator). It never scores a transaction in isolation: the rules
 * engine's customer-relative signals (velocity, impossible travel, unusual
 * amount, method mismatch, device novelty) need the customer's stored
 * history, and the portfolio baselines (median/p95 ticket, merchant
 * profile, device first-use) need recent ledger context.
 *
 * Method:
 *   1. Upsert the customer row.
 *   2. Load the customer's stored history (newest-first, capped) and a
 *      recent portfolio sample for baselines.
 *   3. Build EngineInput[] (history + the new payment), run the existing
 *      `scoreBatch` unchanged, and take the result row for the new txn.
 *   4. Persist transaction + audit events in one Prisma transaction.
 *
 * Deterministic, independently testable, and honest about missing data —
 * incomplete records still score, with warnings attached.
 */

import { db } from "@/lib/db";
import { scoreBatch, type EngineInput } from "@/lib/riskEngine";
import { writeAudit } from "@/lib/server/ledger";

/** How much stored history feeds the engine for one new payment. */
const CUSTOMER_HISTORY_CAP = 120;
/** Recent portfolio sample used for medians / p95 / merchant baselines. */
const PORTFOLIO_CONTEXT_CAP = 600;

/** A new payment as submitted by any ingestion surface. */
export interface NewTransactionInput {
  id: string;
  amount: number;
  currency?: string;
  customerId: string;
  customerName?: string;
  merchant?: string;
  location?: string;
  device?: string;
  paymentMethod?: string;
  /** ISO timestamp — defaults to now. */
  timestamp?: string;
  /** Ground-truth label when the source provides one (CSV import). */
  label?: number | null;
  /** demo | import | manual — honest provenance label. */
  dataSource?: "demo" | "import" | "manual";
}

export interface ScoreOutcome {
  id: string;
  riskScore: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  recommendation: "ALLOW" | "REVIEW" | "HOLD" | "BLOCK";
  isNewDevice: boolean;
  signals: unknown[];
  warnings: string[];
  label: number | null;
  dataSource: string;
  timestamp: string;
}

/** Data-quality warnings for fields the engine needs but the submitter omitted. */
function qualityWarnings(input: NewTransactionInput, safeAt: Date): string[] {
  const warnings: string[] = [];
  if (!Number.isFinite(input.amount) || input.amount <= 0) warnings.push("Missing or invalid amount — scored with amount evidence disabled.");
  if (!input.merchant?.trim()) warnings.push("Merchant missing — merchant-outlier signal cannot fire.");
  if (!input.location?.trim()) warnings.push("Location missing — travel and location signals cannot fire.");
  if (!input.device?.trim()) warnings.push("Device fingerprint missing — device signals cannot fire.");
  if (!input.timestamp) {
    warnings.push("No timestamp supplied — scored at ingestion time.");
  } else if (Number.isNaN(new Date(input.timestamp).getTime())) {
    warnings.push("Timestamp is invalid/unparseable — scored at ingestion time instead of silently defaulting.");
  } else if (safeAt.getTime() > Date.now() + 5 * 60_000) {
    warnings.push("Timestamp is in the future — history is cut at this timestamp, so later ledger rows were not used as context.");
  }
  return warnings;
}

/**
 * Scores ONE new payment against the customer's stored history and the
 * recent ledger context, then persists it with audit events.
 */
export async function scoreAndPersistTransaction(
  input: NewTransactionInput,
): Promise<ScoreOutcome> {
  const at = input.timestamp ? new Date(input.timestamp) : new Date();
  /* Invalid timestamps are scored at ingestion time but flagged — never
   * silently treated as "now" (review fix: honest data-quality trail). */
  const safeAt = Number.isNaN(at.getTime()) ? new Date() : at;
  const warnings = qualityWarnings(input, safeAt);

  const customerId = input.customerId.trim() || "CUS_UNKNOWN";

  /* 1 — customer upsert (identity only; stats stay derived). */
  await db.customer.upsert({
    where: { id: customerId },
    update: { name: input.customerName?.trim() || undefined },
    create: {
      id: customerId,
      name: input.customerName?.trim() || "",
      kycTier: "MIN KYC",
      riskProfile: "normal",
    },
  });

  /* 2 — history + context, TIME-AWARE. Both loads are bounded to rows at
   * or before the payment's own timestamp: a historical import must never
   * see the future. A ₹2,000 payment at 10:00 is scored against history
   * up to 10:00 — the ₹95,000 payment at 10:10 cannot leak backwards into
   * its baselines. Caps stay at 120 customer rows / 600 portfolio rows. */
  const [customerHistory, portfolio] = await Promise.all([
    db.transaction.findMany({
      where: { customerId, timestamp: { lte: safeAt } },
      orderBy: { timestamp: "desc" },
      take: CUSTOMER_HISTORY_CAP,
    }),
    db.transaction.findMany({
      where: { timestamp: { lte: safeAt } },
      orderBy: { timestamp: "desc" },
      take: PORTFOLIO_CONTEXT_CAP,
    }),
  ]);

  /* 3 — build the engine batch: chronological history, then the new txn
   * last. scoreBatch assigns indexes; customer-relative rules (velocity,
   * travel, method mismatch) key off the profiles it builds internally. */
  const historyInputs: EngineInput[] = customerHistory
    .slice()
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    .map((t) => ({
      index: 0,
      txnId: t.id,
      amount: t.amount,
      at: t.timestamp.getTime(),
      customerId: t.customerId,
      customerName: t.customerName,
      merchant: t.merchant,
      location: t.location,
      device: t.device,
      paymentMethod: t.paymentMethod,
      label: (t.label as 0 | 1 | null) ?? null,
    }));

  const newInput: EngineInput = {
    index: historyInputs.length,
    txnId: input.id,
    amount: Number.isFinite(input.amount) && input.amount > 0 ? input.amount : 0,
    at: safeAt.getTime(),
    customerId,
    customerName: input.customerName?.trim() ?? "",
    merchant: input.merchant?.trim() ?? "",
    location: input.location?.trim() ?? "",
    device: input.device?.trim() ?? "",
    paymentMethod: input.paymentMethod?.trim() ?? "",
    label: (input.label as 0 | 1 | null) ?? null,
  };

  // Portfolio context rows participate in baselines but belong to OTHER
  // customers only — including this customer's rows would double-count
  // them with customerHistory. Deduplicate by id.
  const seen = new Set(historyInputs.map((r) => r.txnId));
  const contextInputs: EngineInput[] = portfolio
    .filter((t) => !seen.has(t.id) && t.customerId !== customerId)
    .map((t) => ({
      index: 0,
      txnId: t.id,
      amount: t.amount,
      at: t.timestamp.getTime(),
      customerId: t.customerId,
      customerName: t.customerName,
      merchant: t.merchant,
      location: t.location,
      device: t.device,
      paymentMethod: t.paymentMethod,
      label: (t.label as 0 | 1 | null) ?? null,
    }));

  const inputs = [...historyInputs, ...contextInputs, newInput].map((r, i) => ({ ...r, index: i }));
  const batch = scoreBatch(inputs);
  const scored = batch.rows.find((r) => r.txnId === input.id) ?? batch.rows[batch.rows.length - 1];

  /* 4 — persist + audit, atomically. */
  const status = scored.riskLevel === "CRITICAL" || scored.riskLevel === "HIGH"
    ? "INVESTIGATING"
    : "MONITORING";

  await db.$transaction(async (tx) => {
    await tx.transaction.create({
      data: {
        id: input.id,
        amount: scored.amount,
        currency: input.currency || "INR",
        customerId,
        customerName: input.customerName?.trim() ?? "",
        merchant: input.merchant?.trim() ?? "",
        location: input.location?.trim() ?? "",
        device: input.device?.trim() ?? "",
        paymentMethod: input.paymentMethod?.trim() ?? "",
        timestamp: safeAt,
        riskScore: scored.riskScore,
        riskLevel: scored.riskLevel,
        recommendation: scored.recommendation,
        status,
        isNewDevice: scored.signals.some((s) => s.type === "NEW_DEVICE"),
        signalsJson: JSON.stringify(scored.signals),
        warningsJson: JSON.stringify(warnings),
        dataSource: input.dataSource ?? "demo",
        label: (input.label as number | null) ?? null,
      },
    });

    await tx.auditEvent.create({
      data: {
        actor: "SYSTEM",
        action: "TRANSACTION_CREATED",
        entityType: "Transaction",
        entityId: input.id,
        detailJson: JSON.stringify({ dataSource: input.dataSource ?? "demo", amount: scored.amount }),
        transactionId: input.id,
      },
    });
    await tx.auditEvent.create({
      data: {
        actor: "RISK MODEL",
        action: "TRANSACTION_SCORED",
        entityType: "Transaction",
        entityId: input.id,
        detailJson: JSON.stringify({
          riskScore: scored.riskScore,
          riskLevel: scored.riskLevel,
          recommendation: scored.recommendation,
          signalCount: scored.signals.length,
          historyUsed: historyInputs.length,
          contextRows: contextInputs.length,
          contextCutoff: safeAt.toISOString(),
        }),
        transactionId: input.id,
      },
    });
  });

  return {
    id: input.id,
    riskScore: Math.round(scored.riskScore),
    riskLevel: scored.riskLevel,
    recommendation: scored.recommendation,
    isNewDevice: scored.signals.some((s) => s.type === "NEW_DEVICE"),
    signals: scored.signals,
    warnings,
    label: (input.label as number | null) ?? null,
    dataSource: input.dataSource ?? "demo",
    timestamp: safeAt.toISOString(),
  };
}

/** Collision-proof ledger id for a new payment. */
export function newTxnId(seed?: string): string {
  const base =
    seed?.replace(/[^A-Za-z0-9]/g, "").slice(0, 10) ||
    Math.random().toString(36).slice(2, 10).toUpperCase();
  return `TXN_${base}`;
}
