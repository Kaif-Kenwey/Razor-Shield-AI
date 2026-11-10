# RazorShield AI — Security Threat Model (Phase 1)

Scope: the Next.js application, its API routes, the Prisma/SQLite data store and the auth layer
as implemented on `feat/saas-phase-1`. Assets: tenant ledgers (payment records), customer PII,
investigation records, audit trail, LLM provider credentials, session tokens.

## Trust boundaries

1. Browser ↔ Next.js API routes (public internet / preview proxy)
2. API routes ↔ Prisma/SQLite (server-internal)
3. Server ↔ external LLM providers (operator-configured egress)
4. Tenant ↔ tenant (logical isolation inside one database)

## STRIDE analysis & implemented mitigations

| Threat | Vector | Mitigation (implemented) | Residual risk |
| --- | --- | --- | --- |
| Spoofing | Forged session cookie | 256-bit random tokens, SHA-256-at-rest, httpOnly+SameSite+Secure(prod), server-side session table | DB read access = session fixation impossible (hash only); DB write access out of scope |
| Spoofing | Client-supplied analyst/role/tenant ids | Identity, role, org always resolved server-side from session + verified membership; client ids ignored (deprecated fields accepted but unused) | — |
| Tampering | Cross-tenant reads/writes | `organisationId` on every row + composite `@@unique([org, externalId])`; every query org-pinned; foreign ids → 404. Verified by automated test 19 | PostgreSQL RLS is NOT yet enabled (defence-in-depth, Phase 2/4 when PG is live) |
| Tampering | Prompt-injection via merchant/customer text | LLM receives server-built facts only; verdicts schema-validated; LLM output can never execute actions, modify policies or override analyst decisions (persisted as `recommendedAction` only) | Ongoing; no tool-use by LLM by design |
| Tampering | Stolen LLM API keys at rest | AES-256-GCM sealed (`enc:v1:iv.tag.ct`); tampered/wrong-key values fail CLOSED as "not configured" (test 20) | Key file compromise = compromise of stored keys (rotate via ENCRYPTION_KEY) |
| Repudiation | "I never decided that" | Append-only audit with authenticated actor id/name snapshot + detail JSON; notes/decisions/handoffs/escalations all audited | Tamper-EVIDENCE (hash chain) is Phase 3; today's log is append-only by code, not by storage controls |
| Information disclosure | Unauthenticated access | Every business + org route behind `requireAuth`/`requirePermission`; `/api/healthz` reveals only `{ok,status,time}` | None known |
| Information disclosure | Account enumeration | Uniform login failure messages; register/reset respond consistently; email masked in LOGIN_FAILED audit detail | Registration 409 does reveal existence of an account (documented trade-off) |
| DoS | Auth hammering | Per-IP (20/min) + per-account (10/min) login limits; 5-failure lockout; in-memory limiter | Multi-instance deployments need the Phase-2 Redis limiter |
| Elevation of privilege | Vertical (role escalation) | Role changes restricted by `assignableRoles`; last-owner protection; server-side permission check per route | Platform-super-admin UI does not exist yet (flag is inert) |
| Elevation of privilege | Horizontal (act on other org's cases) | Same org-pinning as above; membership validated on assignment targets | — |
| CSRF | Cookie-bearing cross-site POST | SameSite=Lax + Origin/Host equality check on all mutations | Non-browser clients without Origin are allowed (they cannot carry victim cookies) |
| SSRF | Operator-configured LLM base URLs | Pre-existing `assertSafeLlmUrl` guard retained (private-range blocking; local only for Ollama or explicit opt-in) | Egress proxy / DNS pinning for real deployments: Phase 4 |
| Injection | SQL | Prisma parameterised queries exclusively; two raw queries are fixed-string + bound params | — |
| XSS | Notebook/verdict text rendering | React escaping; no `dangerouslySetInnerHTML` on user content | CSP headers are Phase 2 |

## Secrets handling

- Passwords: bcrypt cost 12. Never logged.
- Session/reset/MFA tokens: stored as SHA-256 hashes only.
- LLM keys + TOTP secrets: AES-256-GCM sealed; key from `ENCRYPTION_KEY` env or 0600 file
  (`db/.secret-box-key`, gitignored).
- `.gitignore` covers `db/*.db`, `db/.llm-secret`, `db/.secret-box-key`; a commit sweep was
  performed to ensure no secret or DB file entered history.
- No payment card numbers/CVV anywhere: the schema has no card fields by construction; CSV
  ingestion maps to token-like ids only.

## Explicit non-claims

Not claimed: PCI DSS / ISO 27001 / SOC 2 / RBI / DPDP compliance; tamper-proof audit storage;
multi-region HA; penetration-testing sign-off. These require controls, assessments and legal
review beyond this codebase.

## Known gaps → tracked in `implementation-roadmap.md`

PG row-level security, hash-chained audit export, CSP/security headers, Redis rate limiting,
attachment malware scanning, dependency/secret scanning in CI (beyond ESLint+tsc), formal
incident runbook testing.
