/**
 * POST /api/transactions/import — push a Dataset Studio analysis into the
 * main ledger.
 *
 * The client sends the mapped rows of a scored run (same shape Dataset
 * Studio already holds in memory). Each row goes through the shared
 * scoring service with its own stored history, so imported records get
 * real per-row context — not the batch-file baselines. Duplicates are
 * reported, not silently dropped. dataSource="import" + optional
 * ground-truth labels are preserved for the model-performance endpoint.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { jsonError, writeAudit } from "@/lib/server/ledger";
import { scoreAndPersistTransaction } from "@/lib/server/scoringService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rowSchema = z.object({
  txnId: z.string().trim().min(1).max(64),
  amount: z.coerce.number().nonnegative(),
  timestamp: z.string().optional(),
  customerId: z.string().trim().min(1).max(64),
  customerName: z.string().trim().max(120).optional(),
  merchant: z.string().trim().max(120).optional(),
  location: z.string().trim().max(120).optional(),
  device: z.string().trim().max(120).optional(),
  paymentMethod: z.string().trim().max(40).optional(),
  label: z.number().int().min(0).max(1).nullable().optional(),
});

const importSchema = z.object({
  datasetName: z.string().trim().max(120).default("Imported dataset"),
  rows: z.array(rowSchema).min(1, "No rows to import").max(2000, "Import up to 2000 rows per run"),
});

/** Normalise any ledger-conflicting id into a free one. */
async function freeId(base: string): Promise<string> {
  let id = base.toUpperCase().startsWith("TXN_") ? base : `TXN_${base}`;
  let n = 1;
  while (await db.transaction.findUnique({ where: { id }, select: { id: true } })) {
    id = `${base}_X${n}`;
    n += 1;
  }
  return id;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body is not valid JSON");
  }

  const parsed = importSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid import payload");
  }
  const { datasetName, rows } = parsed.data;

  let imported = 0;
  const duplicates: string[] = [];
  const failed: { txnId: string; error: string }[] = [];

  for (const row of rows) {
    try {
      const exists = await db.transaction.findUnique({
        where: { id: row.txnId.toUpperCase().startsWith("TXN_") ? row.txnId : `TXN_${row.txnId}` },
        select: { id: true },
      });
      if (exists) {
        duplicates.push(row.txnId);
        continue;
      }
      const id = await freeId(row.txnId);
      await scoreAndPersistTransaction({
        id,
        amount: row.amount,
        customerId: row.customerId,
        customerName: row.customerName,
        merchant: row.merchant,
        location: row.location,
        device: row.device,
        paymentMethod: row.paymentMethod,
        timestamp: row.timestamp,
        label: row.label ?? null,
        dataSource: "import",
      });
      imported += 1;
    } catch (err) {
      failed.push({ txnId: row.txnId, error: err instanceof Error ? err.message : "unknown error" });
    }
  }

  await writeAudit({
    actor: "SYSTEM",
    action: "DATASET_IMPORTED",
    entityType: "Ledger",
    entityId: datasetName,
    detail: { imported, duplicates: duplicates.length, failed: failed.length, datasetName },
  });

  return NextResponse.json({
    ok: true,
    imported,
    duplicates,
    failed,
    total: rows.length,
  });
}
