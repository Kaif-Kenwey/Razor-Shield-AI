# RazorShield AI — SaaS Architecture (Phase 1)

Status: **Phase 1 implemented on branch `feat/saas-phase-1`** (open as a PR — not merged to `main`).
This document describes what is actually built and verified, not aspirations.

## 1. What RazorShield was before Phase 1

A single-tenant, no-auth fraud investigation demo:

- Next.js 16 App Router SPA (single `/` route, view-state navigation)
- Prisma + SQLite ledger (transactions, customers, datasets, investigations, case notes, audit events)
- Deterministic risk engine (`rse-1.2`, rules-based — **not a trained ML model**)
- Multi-provider LLM investigator (OpenRouter / Gemini / Groq / Ollama / custom) with honest
  heuristic fallback, configured globally from one file (`db/llm-config.json`, AES-256-GCM)
- "Auth" was a shared `ADMIN_TOKEN` for a few destructive routes, off by default
- Analyst identity was a client-side persona switcher (`signedInAnalystId`)

## 2. What Phase 1 adds (implemented)

### Identity & sessions (`src/lib/server/auth/*`)
- Email+password registration; **bcrypt** hashes (cost 12) — hashing is done by the maintained
  `bcryptjs` library, never hand-rolled.
- Server-side sessions: 256-bit opaque token in an httpOnly/SameSite=Lax/Secure(prod) cookie;
  the DB stores only its SHA-256 hash. Sliding 30-day expiry, per-request membership
  re-verification, immediate revocation (logout, password reset, device revoke).
- Account lockout: 5 consecutive failures → 15-minute lock; per-IP and per-account rate limits.
- Email verification + single-use password reset tokens (hashed at rest, 24h/30m TTLs).
  Email delivery is a **log transport** in this environment (no SMTP) — dev builds receive the
  link in the API response; this is disclosed in the UI. SMTP integration is documented as
  Phase 2 and marked unverified.
- TOTP MFA (RFC 6238 via the maintained `otplib` library); secrets sealed with AES-256-GCM.
- CSRF: cookie-authenticated mutations require a same-origin `Origin` header
  (proxy-aware: x-forwarded-host → host → request URL authority).

### Multi-tenancy (`Organisation`, `Membership`)
- Every business record carries `organisationId` (Transactions, Customers, Datasets, DatasetRows,
  Investigations, CaseNotes, AuditEvents, LLM configs, invitations).
- **Surrogate primary keys**: `Transaction`/`Customer` previously used externally-supplied ids
  (CSV `transaction_id`) as PKs — a cross-tenant collision risk. They now use cuid PKs with
  `externalId` and `@@unique([organisationId, externalId])` composite constraints.
- The active organisation is derived from the session's **verified membership** (cookie value is
  re-checked server-side every request). Cross-tenant reads return a non-disclosing 404 —
  foreign ids are indistinguishable from missing ones (verified by test 19).
- All shared services (scoring, case context, demo data, audit writer) are tenant-scoped, so
  every ingestion surface (manual entry, CSV import, demo generator) inherits isolation.

### RBAC (`src/lib/rbac.ts`)
- 8 organisation roles (Owner, Admin, Fraud Ops Manager, Analyst, Investigator, Auditor, Viewer,
  Billing Admin) mapped to 23 typed permissions.
- Enforced **server-side** in every route via `requirePermission` / `guardMutation`; the client
  uses the same matrix only to hide entry points. A client-supplied role or analyst id is never
  trusted — audit actors come from the session.

### Per-tenant LLM configuration
- `LlmProviderConfig` (one row per org), API keys AES-256-GCM sealed by the shared
  `secretBox` (env `ENCRYPTION_KEY` or a 0600 machine-local key file). One org can never use or
  see another org's provider credentials. Legacy file configs are imported by the migration tool.

### Audit trail (`AuditEvent` extension)
- Append-only, org-scoped; records actorType (HUMAN/SYSTEM/AI/INTEGRATION), authenticated
  actorUserId + name snapshot, entity, before/after detail JSON. Auth events (login/failed
  login/logout/MFA changes/registration) are recorded too. Export/tamper-evidence tooling is
  Phase 3 — the log is NOT yet claimed tamper-proof.

### Data migration utilities (both runnable)
- `scripts/migrate-to-multitenant.ts` — single-tenant SQLite → multi-tenant schema (surrogate
  key remap, demo-org bootstrap, count validation). Executed in the dev sandbox.
- `scripts/migrate-sqlite-to-postgres.ts` — SQLite → PostgreSQL copy with per-table count
  validation and duplicate detection. **Implemented, UNVERIFIED** (no PostgreSQL instance is
  available in this sandbox — see `postgres-migration.md`).

## 3. Authentication framework decision record

The prompt asked us to evaluate the installed `next-auth@4` before choosing.

- `next-auth@4.24` is installed but in maintenance mode; its credentials provider is JWT-oriented
  and does not natively provide DB-backed revocable sessions, account lockout, TOTP enrolment or
  organisation switching — all of which would be custom code around the framework anyway.
- Auth.js v5 remains beta; adding it (or `better-auth`) would add a new dependency and
  version-compatibility risk against Next 16 + bun for no capability we would actually use
  unmodified.
- **Decision**: a purpose-built session layer on standard, reputable primitives (bcryptjs,
  otplib, node:crypto, Prisma). No cryptography or protocol is implemented from scratch —
  hashing, TOTP and randomness all come from maintained libraries. The full session lifecycle is
  ~600 lines of auditable TypeScript that the team owns.
- Revisit trigger: if SSO/SAML/OAuth federation becomes a requirement (Phase 3+), evaluate
  Auth.js v5 or better-auth for federation only, keeping the DB session table as the source of
  truth.

## 4. Preserved from the pre-SaaS product (unchanged by design)

- The deterministic risk engine (`rse-1.2`) — explainable signals, chronological time-aware
  scoring, velocity/impossible-travel/structuring/device/location/merchant detection.
- Dataset Studio (CSV import → batch scoring → threshold lab, calibration, benchmark).
- The LLM investigation pipeline with server-built case facts and heuristic fallback.
- The fraud-network graph, digest/print case-file flows, demo simulation (now org-scoped,
  still explicitly labelled `dataSource="demo"`).
- All 21 automated tests (15 original behaviours ported to the tenanted APIs + 6 new SaaS
  security tests).

## 5. Current limits (honest)

- SQLite remains the dev/storefront database; PostgreSQL is wired via the schema variant +
  migration utility but not yet exercised against a live instance.
- Rate limiting is in-memory per-process (fine for single-node; Redis-backed limiter is Phase 2).
- No background job system yet (imports run inline; Phase 2 introduces durable queues).
- No billing/subscription code exists yet (Phase 3) — nothing here pretends otherwise.
- Email delivery, real payment-gateway integrations, and PCI/SOC/ISO claims: none — the
  deployment is a demo-grade environment with honest labelling.
