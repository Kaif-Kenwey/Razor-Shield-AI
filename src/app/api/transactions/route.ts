/**
 * /api/transactions — the ledger API.
 *
 * GET  — paginated, filterable, sortable transactions straight from SQLite.
 *        Filters: risk level, status, customer, search text, date range,
 *        amount range, data source. Returns pagination metadata.
 * POST — validate → de-duplicate → score against stored history via the
 *        shared scoring service → persist → audit. Returns the stored,
 *        scored transaction in the UI shape.
 * PATCH — direct status transition (used by analyst tooling).
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  jsonError,
  paginationMeta,
  paginationSchema,
  toUiTransaction,
  writeAudit,
} from "@/lib/server/ledger";
import { newTxnId, scoreAndPersistTransaction } from "@/lib/server/scoringService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ------------------------------------------------------------------ */
/* GET — paginated ledger                                              */
/* ------------------------------------------------------------------ */

const SORT_FIELDS = ["timestamp", "amount", "riskScore"] as const;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsedPagination = paginationSchema.safeParse({
    page: url.searchParams.get("page") ?? undefined,
    pageSize: url.searchParams.get("pageSize") ?? undefined,
  });
  const { page, pageSize } = parsedPagination.success
    ? parsedPagination.data
    : { page: 1, pageSize: 25 };

  const riskLevel = url.searchParams.get("riskLevel");
  const status = url.searchParams.get("status");
  const customerId = url.searchParams.get("customerId");
  const dataSource = url.searchParams.get("dataSource");
  const search = url.searchParams.get("q")?.trim();
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const minAmount = url.searchParams.get("minAmount");
  const maxAmount = url.searchParams.get("maxAmount");
  const sortParam = url.searchParams.get("sort") ?? "timestamp";
  const sort = SORT_FIELDS.includes(sortParam as (typeof SORT_FIELDS)[number])
    ? (sortParam as (typeof SORT_FIELDS)[number])
    : "timestamp";
  const order = url.searchParams.get("order") === "asc" ? "asc" : "desc";

  const where: Prisma.TransactionWhereInput = {};
  if (riskLevel) where.riskLevel = riskLevel;
  if (status) where.status = status;
  if (customerId) where.customerId = customerId;
  if (dataSource) where.dataSource = dataSource;
  if (from || to) {
    where.timestamp = {};
    if (from && !Number.isNaN(new Date(from).getTime())) where.timestamp.gte = new Date(from);
    if (to && !Number.isNaN(new Date(to).getTime())) where.timestamp.lte = new Date(to);
  }
  if (minAmount && Number.isFinite(Number(minAmount))) {
    where.amount = { ...(where.amount as Prisma.FloatFilter | undefined), gte: Number(minAmount) };
  }
  if (maxAmount && Number.isFinite(Number(maxAmount))) {
    where.amount = { ...(where.amount as Prisma.FloatFilter | undefined), lte: Number(maxAmount) };
  }
  if (search) {
    where.OR = [
      { id: { contains: search } },
      { customerName: { contains: search } },
      { customerId: { contains: search } },
      { merchant: { contains: search } },
      { location: { contains: search } },
      { device: { contains: search } },
    ];
  }

  const [total, rows] = await Promise.all([
    db.transaction.count({ where }),
    db.transaction.findMany({
      where,
      include: { investigation: true },
      orderBy: { [sort]: order },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return NextResponse.json({
    ok: true,
    rows: rows.map(toUiTransaction),
    pagination: paginationMeta(total, page, pageSize),
  });
}

/* ------------------------------------------------------------------ */
/* POST — create + score                                               */
/* ------------------------------------------------------------------ */

const createSchema = z.object({
  amount: z.coerce.number().positive("Amount must be greater than zero").max(100_000_000),
  customerId: z.string().trim().min(2, "Customer id is required").max(64),
  customerName: z.string().trim().max(120).optional(),
  merchant: z.string().trim().max(120).optional(),
  location: z.string().trim().max(120).optional(),
  device: z.string().trim().max(120).optional(),
  paymentMethod: z.string().trim().max(40).optional(),
  timestamp: z.string().datetime({ offset: true }).optional(),
  id: z.string().trim().max(64).optional(),
  dataSource: z.enum(["demo", "import", "manual"]).default("manual"),
  label: z.number().int().min(0).max(1).nullable().optional(),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body is not valid JSON");
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid transaction payload");
  }
  const input = parsed.data;

  /* Duplicate guard — the ledger id is the natural key. */
  const id = input.id?.trim() || newTxnId();
  const existing = await db.transaction.findUnique({ where: { id } });
  if (existing) {
    return jsonError(
      `Transaction ${id} already exists in the ledger — duplicate ingestion is blocked.`,
      409,
      { duplicateOf: id },
    );
  }

  try {
    await scoreAndPersistTransaction({
      id,
      amount: input.amount,
      customerId: input.customerId,
      customerName: input.customerName,
      merchant: input.merchant,
      location: input.location,
      device: input.device,
      paymentMethod: input.paymentMethod,
      timestamp: input.timestamp,
      label: input.label ?? null,
      dataSource: input.dataSource,
    });

    const row = await db.transaction.findUniqueOrThrow({
      where: { id },
      include: { investigation: true },
    });

    return NextResponse.json({ ok: true, transaction: toUiTransaction(row) }, { status: 201 });
  } catch (err) {
    console.error("[RS] transaction create failed:", err);
    return jsonError("Could not score and store the transaction — check server logs.", 500);
  }
}

/* ------------------------------------------------------------------ */
/* PATCH — direct status transition                                    */
/* ------------------------------------------------------------------ */

export async function PATCH(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body is not valid JSON");
  }
  const parsed = z
    .object({
      id: z.string().trim().min(2),
      status: z.enum(["EVALUATING", "MONITORING", "INVESTIGATING", "UNDER_REVIEW", "ON_HOLD", "BLOCKED", "ALLOWED"]),
    })
    .safeParse(body);
  if (!parsed.success) return jsonError("id and status are required");

  const { id, status } = parsed.data;
  const existing = await db.transaction.findUnique({ where: { id } });
  if (!existing) return jsonError("Transaction not found", 404);

  const updated = await db.transaction.update({
    where: { id },
    data: { status },
    include: { investigation: true },
  });
  await writeAudit({
    actor: "SYSTEM",
    action: "STATUS_CHANGED",
    entityType: "Transaction",
    entityId: id,
    detail: { from: existing.status, to: status },
    transactionId: id,
  });

  return NextResponse.json({ ok: true, transaction: toUiTransaction(updated) });
}
