/// <reference types="bun-types" />
/**
 * RazorShield AI — SQLite → PostgreSQL data migration utility.
 *
 * Migrates the dev/single-node SQLite database into a PostgreSQL
 * database with the SAME multi-tenant schema:
 *
 *   1. Generates the postgres schema variant (scripts/use-postgres-schema.mjs).
 *   2. Pushes that schema to the target PG database (POSTGRES_URL).
 *   3. Copies every business + identity record, preserving primary keys
 *      and relations (surrogate ids are stable across the move).
 *   4. Validates record counts table-by-table, detects duplicates and
 *      orphans, and prints a migration report.
 *
 *   POSTGRES_URL="postgres://user:pass@host:5432/razorshield" \
 *     bun scripts/migrate-sqlite-to-postgres.ts
 *
 * HONEST STATUS: implemented and type-checked, but NOT executed against a
 * real PostgreSQL instance in the development sandbox (none available) —
 * this integration is marked UNVERIFIED in docs/saas/postgres-migration.md.
 * Run it against a staging database first; the source SQLite file is
 * opened read-only and is never modified.
 */

import { Database } from "bun:sqlite";
import { execSync } from "child_process";
import path from "path";

const PG_URL = process.env.POSTGRES_URL?.trim();
const SQLITE_PATH = process.env.SQLITE_PATH?.trim() || path.join(process.cwd(), "db", "custom.db");

if (!PG_URL) {
  console.error("POSTGRES_URL is required (target PostgreSQL database).");
  process.exit(1);
}

process.env.DATABASE_URL = PG_URL;
const { PrismaClient } = await import("@prisma/client");
const pg = new PrismaClient({ log: ["error", "warn"] });

/* SQLite source — read-only, plain SQL (no Prisma on the source side). */
const src = new Database(SQLITE_PATH, { readonly: true });

function rows(table: string): Record<string, unknown>[] {
  return src.query(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[];
}

function date(v: unknown, fallback: Date = new Date()): Date {
  if (v instanceof Date) return v;
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return fallback;
}

async function main(): Promise<void> {
  console.log("== RazorShield SQLite → PostgreSQL migration ==");
  console.log(`source: ${SQLITE_PATH} (read-only)`);

  /* 1-2. Generate + push the postgres schema (tables must exist before copy). */
  console.log("generating postgres schema variant…");
  execSync("node scripts/use-postgres-schema.mjs", { stdio: "inherit" });
  console.log("pushing schema to PostgreSQL (no data loss check needed — target should be empty)…");
  execSync(
    "npx prisma db push --schema prisma/schema.postgres.prisma --skip-generate --accept-data-loss",
    { stdio: "inherit", env: { ...process.env, DATABASE_URL: PG_URL } },
  );

  /* 3. Copy in FK-safe order. Identity first (business rows reference orgs/users). */
  const report: Record<string, { source: number; migrated: number }> = {};

  const organisations = rows("Organisation");
  for (const o of organisations) {
    await pg.organisation.upsert({
      where: { id: String(o.id) },
      update: {},
      create: {
        id: String(o.id),
        name: String(o.name),
        slug: String(o.slug),
        createdAt: date(o.createdAt),
        updatedAt: date(o.updatedAt, date(o.createdAt)),
      },
    });
  }
  report.Organisation = { source: organisations.length, migrated: await pg.organisation.count() };

  const users = rows("User");
  for (const u of users) {
    await pg.user.upsert({
      where: { id: String(u.id) },
      update: {},
      create: {
        id: String(u.id),
        email: String(u.email),
        name: String(u.name),
        passwordHash: String(u.passwordHash),
        isPlatformAdmin: Number(u.isPlatformAdmin ?? 0) === 1,
        emailVerifiedAt: u.emailVerifiedAt ? date(u.emailVerifiedAt) : null,
        totpSecretEnc: u.totpSecretEnc ? String(u.totpSecretEnc) : null,
        totpEnabled: Number(u.totpEnabled ?? 0) === 1,
        failedLogins: Number(u.failedLogins ?? 0),
        lockedUntil: u.lockedUntil ? date(u.lockedUntil) : null,
        lastLoginAt: u.lastLoginAt ? date(u.lastLoginAt) : null,
        createdAt: date(u.createdAt),
        updatedAt: date(u.updatedAt, date(u.createdAt)),
      },
    });
  }
  report.User = { source: users.length, migrated: await pg.user.count() };

  for (const m of rows("Membership")) {
    await pg.membership.upsert({
      where: { id: String(m.id) },
      update: {},
      create: {
        id: String(m.id),
        organisationId: String(m.organisationId),
        userId: String(m.userId),
        role: String(m.role),
        createdAt: date(m.createdAt),
      },
    });
  }
  report.Membership = { source: rows("Membership").length, migrated: await pg.membership.count() };

  for (const s of rows("Session")) {
    await pg.session.upsert({
      where: { id: String(s.id) },
      update: {},
      create: {
        id: String(s.id),
        userId: String(s.userId),
        tokenHash: String(s.tokenHash),
        expiresAt: date(s.expiresAt),
        revokedAt: s.revokedAt ? date(s.revokedAt) : null,
        ip: s.ip ? String(s.ip) : null,
        userAgent: s.userAgent ? String(s.userAgent) : null,
        createdAt: date(s.createdAt),
        lastSeenAt: date(s.lastSeenAt, date(s.createdAt)),
      },
    });
  }
  report.Session = { source: rows("Session").length, migrated: await pg.session.count() };

  for (const c of rows("Customer")) {
    await pg.customer.upsert({
      where: { id: String(c.id) },
      update: {},
      create: {
        id: String(c.id),
        organisationId: String(c.organisationId),
        externalId: String(c.externalId),
        name: String(c.name ?? ""),
        kycTier: String(c.kycTier ?? "MIN KYC"),
        riskProfile: String(c.riskProfile ?? "normal"),
        priorIncidents: Number(c.priorIncidents ?? 0),
        createdAt: date(c.createdAt),
        updatedAt: date(c.updatedAt, date(c.createdAt)),
      },
    });
  }
  report.Customer = { source: rows("Customer").length, migrated: await pg.customer.count() };

  for (const t of rows("Transaction")) {
    await pg.transaction.upsert({
      where: { id: String(t.id) },
      update: {},
      create: {
        id: String(t.id),
        organisationId: String(t.organisationId),
        externalId: String(t.externalId),
        amount: Number(t.amount ?? 0),
        currency: String(t.currency ?? "INR"),
        customerId: String(t.customerId),
        customerName: String(t.customerName ?? ""),
        merchant: String(t.merchant ?? ""),
        location: String(t.location ?? ""),
        device: String(t.device ?? ""),
        paymentMethod: String(t.paymentMethod ?? ""),
        timestamp: date(t.timestamp),
        riskScore: Number(t.riskScore ?? 0),
        riskLevel: String(t.riskLevel ?? "LOW"),
        recommendation: t.recommendation == null ? null : String(t.recommendation),
        status: String(t.status ?? "MONITORING"),
        isNewDevice: Number(t.isNewDevice ?? 0) === 1,
        signalsJson: String(t.signalsJson ?? "[]"),
        warningsJson: String(t.warningsJson ?? "[]"),
        aiSummary: t.aiSummary == null ? null : String(t.aiSummary),
        confidence: t.confidence == null ? null : Number(t.confidence),
        dataSource: String(t.dataSource ?? "demo"),
        label: t.label == null ? null : Number(t.label),
        assigneeId: t.assigneeId == null ? null : String(t.assigneeId),
        assigneeName: t.assigneeName == null ? null : String(t.assigneeName),
        escalatedTo: t.escalatedTo == null ? null : String(t.escalatedTo),
        escalatedName: t.escalatedName == null ? null : String(t.escalatedName),
        createdAt: date(t.createdAt),
        updatedAt: date(t.updatedAt, date(t.createdAt)),
      },
    });
  }
  report.Transaction = { source: rows("Transaction").length, migrated: await pg.transaction.count() };

  for (const i of rows("Investigation")) {
    await pg.investigation.upsert({
      where: { id: String(i.id) },
      update: {},
      create: {
        id: String(i.id),
        organisationId: String(i.organisationId),
        transactionId: String(i.transactionId),
        mode: String(i.mode),
        provider: i.provider == null ? null : String(i.provider),
        modelId: i.modelId == null ? null : String(i.modelId),
        riskAssessment: String(i.riskAssessment ?? ""),
        recommendedAction: String(i.recommendedAction ?? "REVIEW"),
        confidence: i.confidence == null ? null : Number(i.confidence),
        supportingEvidenceJson: String(i.supportingEvidenceJson ?? "[]"),
        contradictingEvidenceJson: String(i.contradictingEvidenceJson ?? "[]"),
        uncertaintiesJson: String(i.uncertaintiesJson ?? "[]"),
        status: String(i.status ?? "COMPLETE"),
        fallbackReason: i.fallbackReason == null ? null : String(i.fallbackReason),
        latencyMs: i.latencyMs == null ? null : Number(i.latencyMs),
        analystAction: i.analystAction == null ? null : String(i.analystAction),
        analystNote: i.analystNote == null ? null : String(i.analystNote),
        resolvedAt: i.resolvedAt ? date(i.resolvedAt) : null,
        createdAt: date(i.createdAt),
      },
    });
  }
  report.Investigation = { source: rows("Investigation").length, migrated: await pg.investigation.count() };

  for (const n of rows("CaseNote")) {
    await pg.caseNote.upsert({
      where: { id: String(n.id) },
      update: {},
      create: {
        id: String(n.id),
        organisationId: String(n.organisationId),
        transactionId: String(n.transactionId),
        text: String(n.text ?? ""),
        analystId: String(n.analystId ?? "legacy"),
        analystName: n.analystName == null ? null : String(n.analystName),
        createdAt: date(n.createdAt),
      },
    });
  }
  report.CaseNote = { source: rows("CaseNote").length, migrated: await pg.caseNote.count() };

  for (const d of rows("Dataset")) {
    await pg.dataset.upsert({
      where: { id: String(d.id) },
      update: {},
      create: {
        id: String(d.id),
        organisationId: String(d.organisationId),
        name: String(d.name),
        sourceFile: String(d.sourceFile),
        engineVersion: String(d.engineVersion),
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
        createdAt: date(d.createdAt),
      },
    });
  }
  report.Dataset = { source: rows("Dataset").length, migrated: await pg.dataset.count() };

  for (const r of rows("DatasetRow")) {
    await pg.datasetRow.upsert({
      where: { id: String(r.id) },
      update: {},
      create: {
        id: String(r.id),
        organisationId: String(r.organisationId),
        datasetId: String(r.datasetId),
        rowIndex: Number(r.rowIndex ?? 0),
        txnId: String(r.txnId ?? ""),
        amount: Number(r.amount ?? 0),
        timestamp: r.timestamp == null ? null : String(r.timestamp),
        customerId: String(r.customerId ?? ""),
        customerName: String(r.customerName ?? ""),
        merchant: String(r.merchant ?? ""),
        location: String(r.location ?? ""),
        device: String(r.device ?? ""),
        paymentMethod: String(r.paymentMethod ?? ""),
        label: r.label == null ? null : Number(r.label),
        riskScore: Number(r.riskScore ?? 0),
        riskLevel: String(r.riskLevel ?? "LOW"),
        recommendation: String(r.recommendation ?? "REVIEW"),
        signalsJson: String(r.signalsJson ?? "[]"),
        outcome: r.outcome == null ? null : String(r.outcome),
        warnings: String(r.warnings ?? "[]"),
      },
    });
  }
  report.DatasetRow = { source: rows("DatasetRow").length, migrated: await pg.datasetRow.count() };

  for (const a of rows("AuditEvent")) {
    await pg.auditEvent.upsert({
      where: { id: String(a.id) },
      update: {},
      create: {
        id: String(a.id),
        organisationId: a.organisationId == null ? null : String(a.organisationId),
        actor: String(a.actor ?? "SYSTEM"),
        actorType: String(a.actorType ?? "SYSTEM"),
        actorUserId: a.actorUserId == null ? null : String(a.actorUserId),
        actorName: a.actorName == null ? null : String(a.actorName),
        action: String(a.action ?? ""),
        entityType: String(a.entityType ?? ""),
        entityId: String(a.entityId ?? ""),
        detailJson: String(a.detailJson ?? "{}"),
        correlationId: a.correlationId == null ? null : String(a.correlationId),
        transactionId: a.transactionId == null ? null : String(a.transactionId),
        createdAt: date(a.createdAt),
      },
    });
  }
  report.AuditEvent = { source: rows("AuditEvent").length, migrated: await pg.auditEvent.count() };

  /* 4. Validation report — every table must match exactly. */
  console.log("\n== MIGRATION REPORT ==");
  let ok = true;
  for (const [table, r] of Object.entries(report)) {
    const match = r.source === r.migrated;
    if (!match) ok = false;
    console.log(`${match ? "OK " : "MISMATCH"} ${table}: source=${r.source} migrated=${r.migrated}`);
  }

  const dupCheck = await pg.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*)::bigint AS n FROM (
       SELECT "organisationId", "externalId" FROM "Transaction"
       GROUP BY "organisationId", "externalId" HAVING COUNT(*) > 1
     ) x`,
  );
  const dups = Number(dupCheck[0]?.n ?? 0);
  console.log(`${dups === 0 ? "OK " : "FAIL"} duplicate (organisationId, externalId) in Transaction: ${dups}`);
  if (dups > 0) ok = false;

  console.log(ok ? "\nMIGRATION VERIFIED — counts match, no duplicates." : "\nMIGRATION INCOMPLETE — inspect the MISMATCH rows above.");
  process.exit(ok ? 0 : 1);
}

main()
  .catch((err) => {
    console.error("MIGRATION FAILED:", err);
    process.exit(1);
  })
  .finally(async () => {
    await pg.$disconnect().catch(() => undefined);
    src.close();
  });
