# PostgreSQL Migration Guide (SQLite → PostgreSQL)

Status: **path implemented, execution UNVERIFIED** — the development sandbox has no PostgreSQL
instance. Run against a staging database first. Both scripts are read-only on the source.

## Why two schemas?

Prisma fixes one provider per schema file. The canonical `prisma/schema.prisma` uses
`provider = "sqlite"` for local dev and is provider-neutral everywhere else (no SQLite-only
types). Production generates `prisma/schema.postgres.prisma` from it mechanically:

```bash
node scripts/use-postgres-schema.mjs
# → prisma/schema.postgres.prisma (only the datasource block differs)
```

Because the field definitions are byte-identical by construction, schema drift between dev and
production cannot hide inside the models.

## Migration procedure (fresh production database)

```bash
export POSTGRES_URL="postgres://user:pass@host:5432/razorshield"
bun scripts/migrate-sqlite-to-postgres.ts
```

The script:
1. Generates the postgres schema variant.
2. Pushes it to the target database (`prisma db push --schema prisma/schema.postgres.prisma`).
3. Copies every table **in FK-safe order** (Organisation → User → Membership → Session →
   Customer → Transaction → Investigation → CaseNote → Dataset → DatasetRow → AuditEvent),
   upserting by primary key so surrogate ids, external ids and relationships are preserved
   exactly (investigations and audit rows stay attached to their transactions).
4. Prints a **migration report**: per-table source/migrated counts (must match), plus a
   duplicate check on `(organisationId, externalId)` in `Transaction`. Exit code 0 only when
   every check passes.

## Upgrade path for existing single-tenant SQLite databases

Run the multi-tenant migration FIRST (it rewrites external-id PKs into the surrogate schema and
bootstraps the organisation/user model), then the PostgreSQL migration:

```bash
bun scripts/migrate-to-multitenant.ts          # SQLite → multi-tenant SQLite
POSTGRES_URL=... bun scripts/migrate-sqlite-to-postgres.ts
```

## Backups & recovery

- Before any migration: `cp db/custom.db db/custom.db.$(date +%F).bak` (gitignored) — the
  original file is the recoverable backup; migration scripts never write to the source.
- PostgreSQL deployments: use managed PITR/snapshots; verify restore monthly into a scratch
  database (drill documented in Phase 4 — not yet performed).
- The application never executes destructive migrations automatically; `prisma db push
  --accept-data-loss` appears ONLY inside the (target-empty) migration script, never in app
  startup.

## Unverified-verification checklist (execute on first real PG environment)

1. `schema.postgres.prisma` generates and `prisma db push` succeeds.
2. Migration report: all table counts OK, duplicate check OK, exit code 0.
3. Spot-check: login as a migrated user (bcrypt hash compatible), open a migrated
   investigation, confirm case notes + audit trail intact.
4. Enable PostgreSQL Row-Level Security per-tenant as defence-in-depth (Phase 2/4) — policies
   not yet written.
5. Connection pooling (PgBouncer or Prisma Accelerate) sized for the deployment.
