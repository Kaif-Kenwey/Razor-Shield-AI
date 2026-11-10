# Security Posture

Updated for Phase 1 (`feat/saas-phase-1`). Companion: `docs/saas/security-threat-model.md`.

## Implemented controls

- **Authentication on every protected API.** Only `/`, `/api/healthz` and the auth endpoints
  themselves are reachable unauthenticated. Everything else returns 401 without a session and
  403 without the required permission.
- **Tenant isolation.** Every business row carries `organisationId`; every query, update,
  delete, export and job is org-pinned server-side; cross-tenant ids are non-disclosing 404s.
  Verified by automated cross-tenant tests.
- **Server-side RBAC.** 8 roles × 23 permissions; enforced per route; UI gating is
  presentation-only.
- **Password & session hygiene.** bcrypt(12); opaque session tokens hashed at rest; sliding
  expiry; revocation on logout/password-reset/device-revoke; lockout after 5 failures; rate
  limits on auth endpoints.
- **CSRF.** SameSite=Lax cookies + Origin/Host equality on all mutations.
- **Secrets at rest.** LLM keys and TOTP secrets sealed with AES-256-GCM (fail-closed on
  tampering); secret material gitignored; no secrets in git history (swept + verified).
- **Input validation.** Zod schemas on every request body; Prisma-only data access; bounded
  pagination and take-limits on all list endpoints.
- **SSRF.** Operator-configured LLM endpoints pass the URL guard (private-range blocking)
  before every call — inherited from the pre-SaaS hardening, still active.
- **Honest LLM boundaries.** The LLM receives server-built facts, returns schema-validated
  assessments, and can never execute actions, alter policies or override a human decision.

## Not implemented (tracked, see roadmap)

Security headers/CSP middleware, Redis-backed distributed rate limiting, PG row-level security,
hash-chained audit export, attachment malware scanning, automated dependency/secret scanning in
CI, egress proxy for LLM traffic, formal pen-test.

## Compliance statements (explicit)

We do NOT claim PCI DSS, ISO 27001, SOC 2, RBI or DPDP compliance. The schema by design stores
no card numbers or CVV (payment ids are token-like strings), and PII is limited to customer
names/ids from source files — but formal compliance requires controls, assessment and legal
review that do not exist here.

## Reporting

See `incident-response.md`. Security issues found in the codebase should be opened as private
security advisories by the maintainer (Mohammad Kaif).
