#!/usr/bin/env node
/**
 * RazorShield AI — generate the PostgreSQL variant of the Prisma schema.
 *
 * The canonical `prisma/schema.prisma` is provider-neutral (no SQLite-only
 * field types); the ONLY provider-specific line is the datasource block.
 * Prisma requires one fixed provider per schema file, so production
 * deployments generate the postgres variant with this script:
 *
 *   node scripts/use-postgres-schema.mjs        # writes prisma/schema.postgres.prisma
 *   DATABASE_URL="$PG_URL" npx prisma db push --schema prisma/schema.postgres.prisma
 *
 * (or `prisma migrate` once a baseline exists — see
 * docs/saas/postgres-migration.md). The dev SQLite schema remains the
 * source of truth; this keeps the two provably in sync.
 */

import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(path.join(root, "prisma", "schema.prisma"), "utf8");

if (!/provider\s*=\s*"sqlite"/.test(src)) {
  console.error("prisma/schema.prisma is not the sqlite variant — refusing to derive.");
  process.exit(1);
}

const pg = src.replace(
  /datasource\s+db\s*\{[^}]*\}/,
  `datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}`,
);

const out = path.join(root, "prisma", "schema.postgres.prisma");
writeFileSync(out, pg, "utf8");
console.log(`wrote ${out} (postgresql provider) — field definitions are unchanged by construction.`);
