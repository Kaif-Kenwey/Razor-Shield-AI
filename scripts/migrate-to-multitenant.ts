/// <reference types="bun-types" />
/**
 * RazorShield AI — single-tenant → multi-tenant data migration utility.
 *
 * Reads the pre-SaaS SQLite database (single-tenant, external ids as
 * primary keys) and rewrites every business record into the new
 * multi-tenant schema:
 *
 *   - Creates the bootstrap Organisation + demo Owner user (idempotent).
 *   - Customer.id / Transaction.id (externally-supplied) become
 *     `externalId` on new surrogate cuid primary keys, unique per org.
 *   - Investigations, CaseNotes, AuditEvents and Datasets are remapped
 *     through those keys; audit rows pointing at deleted transactions
 *     keep SetNull semantics (transactionId → null).
 *   - A legacy db/llm-config.json (AES-256-GCM file store) is imported
 *     into the organisation's LlmProviderConfig row.
 *   - Validates record counts and prints a migration report.
 *
 * Usage:
 *   bun scripts/migrate-to-multitenant.ts                 # migrate + validate
 *   bun scripts/migrate-to-multitenant.ts --seed-only     # just org + demo user
 *   bun scripts/migrate-to-multitenant.ts --source db/custom.db.old-saas-migrate
 *
 * The source database file is never modified (opened read-only) and is
 * preserved as the recoverable backup.
 */

import { Database } from "bun:sqlite";
import { randomUUID, createHash, createDecipheriv } from "crypto";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { db } from "../src/lib/db";

const args = process.argv.slice(2);
const seedOnly = args.includes("--seed-only");
const sourceIdx = args.indexOf("--source");
const SOURCE =
  sourceIdx >= 0 && args[sourceIdx + 1]
    ? args[sourceIdx + 1]
    : path.join(process.cwd(), "db", "custom.db.old-saas-migrate");

/* ------------------------------------------------------------------ */
/* Demo bootstrap (organisation + owner)                               */
/* ------------------------------------------------------------------ */

const DEMO_ORG_NAME = "RazorShield Demo";
const DEMO_ORG_SLUG = "razorshield-demo";
const DEMO_EMAIL = "demo@razorshield.ai";
/** Demo-only bootstrap password — MUST be rotated/removed for real deployments. */
const DEMO_PASSWORD = process.env.DEMO_PASSWORD?.trim() || "RazorShield!Demo2025";

async function hashPassword(plain: string): Promise<string> {
  const bcrypt = await import("bcryptjs");
  return bcrypt.hash(plain, 12);
}

/** Ensures the bootstrap org + demo owner exist. Returns their ids. */
async function ensureBootstrap(): Promise<{ orgId: string; userId: string }> {
  const org = await db.organisation.upsert({
    where: { slug: DEMO_ORG_SLUG },
    update: {},
    create: { name: DEMO_ORG_NAME, slug: DEMO_ORG_SLUG },
  });

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const user = await db.user.upsert({
    where: { email: DEMO_EMAIL },
    update: { emailVerifiedAt: new Date() },
    create: {
      email: DEMO_EMAIL,
      name: "Demo Analyst",
      passwordHash,
      emailVerifiedAt: new Date(),
    },
  });

  await db.membership.upsert({
    where: { organisationId_userId: { organisationId: org.id, userId: user.id } },
    update: { role: "OWNER" },
    create: { organisationId: org.id, userId: user.id, role: "OWNER" },
  });

  return { orgId: org.id, userId: user.id };
}

/* ------------------------------------------------------------------ */
/* Legacy file-store LLM config import                                 */
/* ------------------------------------------------------------------ */

/** Re-derives the legacy file-store decryption key (same scheme as the
 * pre-SaaS llmConfigStore: LLM_CONFIG_SECRET env, else db/.llm-secret). */
function legacyDecryptKey(stored: string): string {
  if (!stored.startsWith("enc:v1:")) return stored; // legacy plaintext
  const secretPath = path.join(process.cwd(), "db", ".llm-secret");
  let material = process.env.LLM_CONFIG_SECRET?.trim() ?? "";
  if (!material) {
    try {
      material = readFileSync(secretPath, "utf8").trim();
    } catch {
      return "";
    }
  }
  const key = createHash("sha256").update(`razorshield:llm:${material}`).digest();
  try {
    const [ivHex, tagHex, ctHex] = stored.slice("enc:v1:".length).split(".");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"), {
      authTagLength: 16,
    });
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(ctHex, "hex")), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    return "";
  }
}

/** Encrypts with the NEW shared secret box (same wire format, separate key). */
async function encryptWithSecretBox(plain: string): Promise<string> {
  const { sealSecret } = await import("../src/lib/server/secretBox");
  return sealSecret(plain);
}

async function importLegacyLlmConfig(orgId: string): Promise<"imported" | "absent" | "unreadable"> {
  const configPath = path.join(process.cwd(), "db", "llm-config.json");
  if (!existsSync(configPath)) return "absent";
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    const baseUrl = typeof parsed.baseUrl === "string" ? parsed.baseUrl.trim().replace(/\/+$/, "") : "";
    const apiKey = legacyDecryptKey(typeof parsed.apiKey === "string" ? parsed.apiKey.trim() : "");
    if (!baseUrl || !apiKey) return "unreadable";
    const apiKeyEnc = await encryptWithSecretBox(apiKey);
    await db.llmProviderConfig.upsert({
      where: { organisationId: orgId },
      update: {
        provider: typeof parsed.provider === "string" ? parsed.provider : "custom",
        baseUrl,
        apiKeyEnc,
        model: typeof parsed.model === "string" ? parsed.model : "",
        extraHeadersJson: JSON.stringify(
          parsed.extraHeaders && typeof parsed.extraHeaders === "object" ? parsed.extraHeaders : {},
        ),
        routing: typeof parsed.routing === "string" ? parsed.routing : null,
        verifiedAt: typeof parsed.verifiedAt === "string" ? new Date(parsed.verifiedAt) : null,
        verifiedModel: typeof parsed.verifiedModel === "string" ? parsed.verifiedModel : null,
      },
      create: {
        organisationId: orgId,
        provider: typeof parsed.provider === "string" ? parsed.provider : "custom",
        baseUrl,
        apiKeyEnc,
        model: typeof parsed.model === "string" ? parsed.model : "",
      },
    });
    return "imported";
  } catch {
    return "unreadable";
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function newId(): string {
  return "c" + randomUUID().replace(/-/g, "").slice(0, 24);
}

/** Tolerant date parse — Prisma/SQLite legacy formats vary. */
function toDate(v: unknown, fallback = new Date()): Date {
  if (v instanceof Date) return v;
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return fallback;
}

function toNullableDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = toDate(v, null as unknown as Date);
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

function toNullableFloat(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function chunkedCreateMany<T>(
  table: "customer" | "transaction" | "dataset" | "datasetRow" | "investigation" | "caseNote" | "auditEvent",
  rows: T[],
  map: (r: T) => Record<string, unknown>,
  size = 500,
): Promise<number> {
  let written = 0;
  for (let i = 0; i < rows.length; i += size) {
    const slice = rows.slice(i, i + size).map(map);
    const res = await (db as unknown as Record<string, { createMany: (a: { data: unknown[] }) => Promise<{ count: number }> }>)[table]
      .createMany({ data: slice });
    written += res.count;
  }
  return written;
}

/* ------------------------------------------------------------------ */
/* Main migration                                                      */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  console.log("== RazorShield single-tenant → multi-tenant migration ==");
  const { orgId, userId } = await ensureBootstrap();
  console.log(`bootstrap: org=${orgId} demoOwner=${DEMO_EMAIL}`);

  const llmState = await importLegacyLlmConfig(orgId);
  console.log(`legacy llm-config.json: ${llmState}`);

  if (seedOnly) {
    console.log("seed-only mode — done.");
    return;
  }

  if (!existsSync(SOURCE)) {
    console.log(`source ${SOURCE} not found — nothing to migrate (fresh install).`);
    await report(orgId);
    return;
  }

  const old = new Database(SOURCE, { readonly: true });

  /* ---- 1. Customers: external id → surrogate key ---- */
  const oldCustomers = old.query("SELECT * FROM \"Customer\"").all() as Record<string, unknown>[];
  const customerIdMap = new Map<string, string>();
  const customerRows = oldCustomers.map((c) => {
    const id = newId();
    customerIdMap.set(String(c.id), id);
    return {
      id,
      organisationId: orgId,
      externalId: String(c.id),
      name: String(c.name ?? ""),
      kycTier: String(c.kycTier ?? "MIN KYC"),
      riskProfile: String(c.riskProfile ?? "normal"),
      priorIncidents: Number(c.priorIncidents ?? 0),
      createdAt: toDate(c.createdAt),
      updatedAt: toDate(c.updatedAt, toDate(c.createdAt)),
    };
  });
  const customersWritten = await chunkedCreateMany("customer", customerRows, (r) => r);
  console.log(`customers: ${customersWritten}/${oldCustomers.length}`);

  /* ---- 2. Transactions: external id → surrogate key, remap customer ---- */
  const oldTxns = old.query("SELECT * FROM \"Transaction\"").all() as Record<string, unknown>[];
  const txnIdMap = new Map<string, string>();
  const txnRows = oldTxns.map((t) => {
    const id = newId();
    txnIdMap.set(String(t.id), id);
    return {
      id,
      organisationId: orgId,
      externalId: String(t.id),
      amount: Number(t.amount ?? 0),
      currency: String(t.currency ?? "INR"),
      customerId: customerIdMap.get(String(t.customerId)) ?? "",
      customerName: String(t.customerName ?? ""),
      merchant: String(t.merchant ?? ""),
      location: String(t.location ?? ""),
      device: String(t.device ?? ""),
      paymentMethod: String(t.paymentMethod ?? ""),
      timestamp: toDate(t.timestamp),
      riskScore: Number(t.riskScore ?? 0),
      riskLevel: String(t.riskLevel ?? "LOW"),
      recommendation: t.recommendation === null || t.recommendation === undefined ? null : String(t.recommendation),
      status: String(t.status ?? "MONITORING"),
      isNewDevice: Number(t.isNewDevice ?? 0) === 1,
      signalsJson: String(t.signalsJson ?? "[]"),
      warningsJson: String(t.warningsJson ?? "[]"),
      aiSummary: t.aiSummary === null || t.aiSummary === undefined ? null : String(t.aiSummary),
      confidence: toNullableFloat(t.confidence),
      dataSource: String(t.dataSource ?? "demo"),
      label: t.label === null || t.label === undefined ? null : Number(t.label),
      assigneeId: t.assigneeId === null || t.assigneeId === undefined ? null : String(t.assigneeId),
      escalatedTo: t.escalatedTo === null || t.escalatedTo === undefined ? null : String(t.escalatedTo),
      createdAt: toDate(t.createdAt),
      updatedAt: toDate(t.updatedAt, toDate(t.createdAt)),
    };
  });
  /* Skip rows whose customer did not migrate (should not happen — FK integrity). */
  const validTxnRows = txnRows.filter((r) => r.customerId);
  const txnsWritten = await chunkedCreateMany("transaction", validTxnRows, (r) => r);
  console.log(`transactions: ${txnsWritten}/${oldTxns.length} (orphan-customer rows skipped: ${txnRows.length - validTxnRows.length})`);

  /* ---- 3. Investigations (transactionId remapped to surrogate) ---- */
  const oldInvestigations = old.query("SELECT * FROM \"Investigation\"").all() as Record<string, unknown>[];
  const investigationRows = oldInvestigations
    .map((i) => ({
      id: newId(),
      organisationId: orgId,
      transactionId: txnIdMap.get(String(i.transactionId)) ?? "",
      mode: String(i.mode ?? "heuristic"),
      provider: i.provider === null || i.provider === undefined ? null : String(i.provider),
      modelId: i.modelId === null || i.modelId === undefined ? null : String(i.modelId),
      riskAssessment: String(i.riskAssessment ?? ""),
      recommendedAction: String(i.recommendedAction ?? "REVIEW"),
      confidence: toNullableFloat(i.confidence),
      supportingEvidenceJson: String(i.supportingEvidenceJson ?? "[]"),
      contradictingEvidenceJson: String(i.contradictingEvidenceJson ?? "[]"),
      uncertaintiesJson: String(i.uncertaintiesJson ?? "[]"),
      status: String(i.status ?? "COMPLETE"),
      fallbackReason: i.fallbackReason === null || i.fallbackReason === undefined ? null : String(i.fallbackReason),
      latencyMs: i.latencyMs === null || i.latencyMs === undefined ? null : Number(i.latencyMs),
      analystAction: i.analystAction === null || i.analystAction === undefined ? null : String(i.analystAction),
      analystNote: i.analystNote === null || i.analystNote === undefined ? null : String(i.analystNote),
      resolvedAt: toNullableDate(i.resolvedAt),
      createdAt: toDate(i.createdAt),
    }))
    .filter((r) => r.transactionId);
  const investigationsWritten = await chunkedCreateMany("investigation", investigationRows, (r) => r);
  console.log(`investigations: ${investigationsWritten}/${oldInvestigations.length}`);

  /* ---- 4. Case notes ---- */
  const oldNotes = old.query("SELECT * FROM \"CaseNote\"").all() as Record<string, unknown>[];
  const noteRows = oldNotes
    .map((n) => ({
      id: newId(),
      organisationId: orgId,
      transactionId: txnIdMap.get(String(n.transactionId)) ?? "",
      text: String(n.text ?? ""),
      analystId: String(n.analystId ?? "legacy"),
      analystName: null as string | null,
      createdAt: toDate(n.createdAt),
    }))
    .filter((r) => r.transactionId);
  const notesWritten = await chunkedCreateMany("caseNote", noteRows, (r) => r);
  console.log(`caseNotes: ${notesWritten}/${oldNotes.length}`);

  /* ---- 5. Datasets + rows ---- */
  const oldDatasets = old.query("SELECT * FROM \"Dataset\"").all() as Record<string, unknown>[];
  const datasetRowsAll: Record<string, unknown>[] = [];
  const datasetRowsOut = oldDatasets.map((d) => ({
    id: String(d.id),
    organisationId: orgId,
    name: String(d.name ?? ""),
    sourceFile: String(d.sourceFile ?? ""),
    engineVersion: String(d.engineVersion ?? ""),
    rowCount: Number(d.rowCount ?? 0),
    skippedCount: Number(d.skippedCount ?? 0),
    flaggedCount: Number(d.flaggedCount ?? 0),
    avgScore: Number(d.avgScore ?? 0),
    flaggedValue: Number(d.flaggedValue ?? 0),
    labelsPresent: Number(d.labelsPresent ?? 0) === 1,
    labeledCount: Number(d.labeledCount ?? 0),
    truePositives: Number(d.truePositives ?? 0),
    falsePositives: Number(d.falsePositives ?? 0),
    falseNegatives: Number(d.falseNegatives ?? 0),
    trueNegatives: Number(d.trueNegatives ?? 0),
    precision: Number(d.precision ?? 0),
    recall: Number(d.recall ?? 0),
    f1: Number(d.f1 ?? 0),
    fpCost: Number(d.fpCost ?? 0),
    fnCost: Number(d.fnCost ?? 0),
    createdAt: toDate(d.createdAt),
  }));
  const datasetsWritten = await chunkedCreateMany("dataset", datasetRowsOut, (r) => r);
  for (const d of oldDatasets) {
    const rows = old
      .query("SELECT * FROM \"DatasetRow\" WHERE datasetId = ?")
      .all(String(d.id)) as Record<string, unknown>[];
    for (const r of rows) {
      datasetRowsAll.push({
        id: newId(),
        organisationId: orgId,
        datasetId: String(d.id),
        rowIndex: Number(r.rowIndex ?? 0),
        txnId: String(r.txnId ?? ""),
        amount: Number(r.amount ?? 0),
        timestamp: r.timestamp === null || r.timestamp === undefined ? null : String(r.timestamp),
        customerId: String(r.customerId ?? ""),
        customerName: String(r.customerName ?? ""),
        merchant: String(r.merchant ?? ""),
        location: String(r.location ?? ""),
        device: String(r.device ?? ""),
        paymentMethod: String(r.paymentMethod ?? ""),
        label: r.label === null || r.label === undefined ? null : Number(r.label),
        riskScore: Number(r.riskScore ?? 0),
        riskLevel: String(r.riskLevel ?? "LOW"),
        recommendation: String(r.recommendation ?? "REVIEW"),
        signalsJson: String(r.signalsJson ?? "[]"),
        outcome: r.outcome === null || r.outcome === undefined ? null : String(r.outcome),
        warnings: String(r.warnings ?? "[]"),
      });
    }
  }
  const datasetRowsWritten = await chunkedCreateMany("datasetRow", datasetRowsAll, (r) => r);
  console.log(`datasets: ${datasetsWritten}/${oldDatasets.length}, datasetRows: ${datasetRowsWritten}`);

  /* ---- 6. Audit events (transactionId remap, SetNull when gone) ---- */
  const oldAudit = old.query("SELECT * FROM \"AuditEvent\"").all() as Record<string, unknown>[];
  const auditRows = oldAudit.map((a) => ({
    id: String(a.id),
    organisationId: orgId,
    actor: String(a.actor ?? "SYSTEM"),
    actorType: String(a.actor ?? "SYSTEM") === "ANALYST" ? "HUMAN" : String(a.actor ?? "SYSTEM") === "AI ENGINE" ? "AI" : "SYSTEM",
    actorUserId: null as string | null,
    actorName: null as string | null,
    action: String(a.action ?? ""),
    entityType: String(a.entityType ?? ""),
    entityId: String(a.entityId ?? ""),
    detailJson: String(a.detailJson ?? "{}"),
    transactionId: txnIdMap.get(String(a.transactionId ?? "")) ?? null,
    createdAt: toDate(a.createdAt),
  }));
  const auditWritten = await chunkedCreateMany("auditEvent", auditRows, (r) => r);
  console.log(`auditEvents: ${auditWritten}/${oldAudit.length}`);

  old.close();

  /* ---- 7. Relationship + integrity validation ---- */
  const orphans = await db.$queryRawUnsafe<{ n: number }[]>(
    `SELECT COUNT(*) as n FROM "Transaction" t LEFT JOIN "Customer" c ON c.id = t.customerId WHERE c.id IS NULL`,
  );
  const dupExternal = await db.$queryRawUnsafe<{ n: number }[]>(
    `SELECT COUNT(*) as n FROM (SELECT externalId, COUNT(*) c FROM "Transaction" WHERE organisationId = ? GROUP BY externalId HAVING c > 1)`,
    orgId,
  );
  console.log(`orphan transactions (broken FK): ${orphans[0]?.n ?? "?"}`);
  console.log(`duplicate externalIds within org: ${dupExternal[0]?.n ?? "?"}`);

  await report(orgId);
  console.log("\nDONE — demo sign-in: demo@razorshield.ai / password from DEMO_PASSWORD or the documented demo default (rotate before any real deployment).");
}

async function report(orgId: string): Promise<void> {
  const [users, orgs, members, customers, txns, inv, notes, datasets, rows, audit] = await Promise.all([
    db.user.count(),
    db.organisation.count(),
    db.membership.count(),
    db.customer.count({ where: { organisationId: orgId } }),
    db.transaction.count({ where: { organisationId: orgId } }),
    db.investigation.count({ where: { organisationId: orgId } }),
    db.caseNote.count({ where: { organisationId: orgId } }),
    db.dataset.count({ where: { organisationId: orgId } }),
    db.datasetRow.count({ where: { organisationId: orgId } }),
    db.auditEvent.count({ where: { organisationId: orgId } }),
  ]);
  console.log("\n== MIGRATION REPORT ==");
  console.log({ users, organisations: orgs, memberships: members, customers, transactions: txns, investigations: inv, caseNotes: notes, datasets, datasetRows: rows, auditEvents: audit });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("MIGRATION FAILED:", err);
    process.exit(1);
  });
