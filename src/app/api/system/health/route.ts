/**
 * /api/system/health — live service status measured against the real
 * backend: database latency (round-trip timing), ledger + dataset counts,
 * investigation queue depth and the LLM endpoint state. The audit log
 * counts recent system events so the UI can prove activity is real.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveLlmConfig, llmConfigured } from "@/lib/agent/llm";
import { readRuntimeLlmConfig } from "@/lib/agent/llmConfigStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const dbStart = Date.now();
  let dbOk = true;
  let counts = { transactions: 0, customers: 0, datasets: 0, auditEvents: 0 };
  let queue = { investigating: 0, underReview: 0 };
  try {
    const [transactions, customers, datasets, auditEvents, investigating, underReview] =
      await Promise.all([
        db.transaction.count(),
        db.customer.count(),
        db.dataset.count(),
        db.auditEvent.count(),
        db.transaction.count({ where: { status: "INVESTIGATING" } }),
        db.transaction.count({ where: { status: "UNDER_REVIEW" } }),
      ]);
    counts = { transactions, customers, datasets, auditEvents };
    queue = { investigating, underReview };
  } catch {
    dbOk = false;
  }
  const dbLatencyMs = Date.now() - dbStart;

  const runtimeCfg = readRuntimeLlmConfig();
  const active = resolveLlmConfig();
  const llm = {
    configured: llmConfigured(),
    source: runtimeCfg ? ("runtime" as const) : active ? ("env" as const) : ("none" as const),
    provider: runtimeCfg?.provider ?? (active ? "env" : null),
    model: active?.model || null,
  };

  return NextResponse.json({
    ok: true,
    database: { ok: dbOk, latencyMs: dbLatencyMs },
    counts,
    queue,
    llm,
    engine: { version: "rse-1.2.0", kind: "deterministic-rules" },
    serverTime: new Date().toISOString(),
  });
}
