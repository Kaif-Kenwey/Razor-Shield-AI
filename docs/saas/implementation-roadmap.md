# RazorShield AI — SaaS Implementation Roadmap

Ordered per the master engineering plan. Status markers: ✅ implemented & verified ·
🟡 implemented, environment-unverified · ⬜ planned (not started). Honest by construction:
nothing is marked ✅ without a test, a browser walkthrough, or an executed run behind it.

## Phase 1 — SaaS foundation ✅ (branch `feat/saas-phase-1`, PR open)

- ✅ Authentication: register / login / logout / lockout / email-verify / password-reset /
  TOTP MFA / session-device management (21 automated tests incl. lockout + token-hashing)
- ✅ Organisations & memberships with owner protection; invitations (token links; SMTP pending)
- ✅ Multi-tenancy: org-scoped schema + surrogate keys + composite uniques; verified
  cross-tenant isolation test
- ✅ RBAC: 8 roles × 23 permissions, server-enforced on every route
- ✅ API authorisation: every business + org route behind guards; non-disclosing 404s
- 🟡 PostgreSQL path: provider-neutral schema + `schema.postgres.prisma` generator +
  `migrate-sqlite-to-postgres.ts` (validated migration report) — **not yet run against a live
  PostgreSQL** (none in sandbox)
- ✅ SQLite → multi-tenant migration utility (executed)
- ✅ Audit events extended with actor identity + org scope
- ⬜ Row-Level Security on PostgreSQL (needs live PG; Phase 2/4)

## Phase 2 — Operational platform ⬜

- Durable background jobs (BullMQ or equivalent) for imports/scoring/network analysis; real
  server-side progress (replaces inline chunked import)
- Redis-backed distributed rate limiting + cache (replace in-process limiter)
- API keys for programmatic ingestion (scoped, expiring, revocable) + idempotency keys
- Signed webhook ingestion (timestamp + replay protection + DLQ)
- Gateway-adapter interface (sandbox-first; an integration is "connected" only after a verified
  real-provider test)
- Tenant risk policies + engine versioning (per-org thresholds, versioned scoring, reproducible
  decisions, evaluation across versions)
- SMTP transport for verification/invitations; prompt-injection regression suite
- Security headers + CSP; dependency & secret scanning in CI

## Phase 3 — Enterprise controls ⬜

- Usage metering + subscription/billing adapter (no fake payments; provider-verified only)
- Audit export + hash-chained integrity verification
- Data retention controls, export & deletion requests (DPDP/GDPR-aligned workflows)
- Notifications centre; org-level admin console; platform super-admin surfaces
- Attachment evidence with malware-scanning integration

## Phase 4 — Production operations ⬜

- Multi-stage Dockerfile + compose (PostgreSQL, Redis, separate worker), health checks
- CI/CD with migrations-as-deploy, rollback strategy, backup/restore drills
- OpenTelemetry instrumentation, request correlation ids end-to-end, error tracking
- Load tests (ingestion, dashboards, queue); PG connection pooling + query tuning
- Egress strategy for LLM calls (DNS pinning / proxy)

## Phase 5 — Verification & release ⬜

- Playwright end-to-end suite (register → org → invite → ingest → investigate → decide → audit)
- Cross-tenant penetration pass (horizontal/vertical escalation, replay, CSRF, SSRF)
- Performance report, production-readiness checklist, external assessment engagement

## Definition-of-Done scorecard (Phase 1 scope)

| Requirement | Status |
| --- | --- |
| Secure register + login | ✅ tested |
| Orgs use the app independently | ✅ isolation test |
| Tenant isolation verified by tests | ✅ test 19 |
| RBAC enforced server-side | ✅ every guarded route |
| PostgreSQL = production source of truth | 🟡 path + utility ready, unverified |
| Migrations reproducible | 🟡 SQLite→PG report; PG baseline pending live run |
| Existing SQLite data migrates safely | ✅ multitenant utility executed |
| Ingestion through documented interfaces | ✅ manual/CSV/demo (REST ingestion = Phase 2) |
| Explainable, reproducible scoring | ✅ engine untouched, signals persisted |
| LLM cannot override evidence/humans | ✅ server-built facts + decision precedence |
| Background jobs reliable/observable | ⬜ Phase 2 |
| Audit attributable & protected | ✅ actor/org fields (hash-chain = Phase 3) |
| API keys & provider credentials protected | ✅ sealed at rest |
| Backups & recovery tested | 🟡 file-level backups only; restore drill pending |
| CI runs the full suite | ✅ lint + typecheck + isolated-DB tests + build |
| Production deployment verified | ⬜ Phase 4 |
| Security & operational docs complete | ✅ this docs/ set (compliance claims excluded) |
