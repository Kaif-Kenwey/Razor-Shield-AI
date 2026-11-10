# Incident Response (Runbook v0)

Phase 1 draft. These procedures are written to be executable with today's architecture; they
have NOT yet been rehearsed in a drill (Phase 4 task).

## Severity ladder

- **S1** — cross-tenant data exposure, auth bypass, or full outage. Drop everything.
- **S2** — single-tenant data integrity issue, credential leak, degraded detection.
- **S3** — cosmetic/availability nits, single-user account issues.

## S1: Suspected cross-tenant exposure

1. **Contain**: stop the app process (`pkill -f "next dev"` / stop the service). A stopped app
   cannot leak. Do not attempt in-place hotfixes while data is exposed.
2. **Assess**: query the audit trail for the affected orgs (`SELECT * FROM "AuditEvent" WHERE
   "organisationId" IN (...) ORDER BY "createdAt" DESC`) and application logs for the offending
   route. Capture timestamps + actor ids.
3. **Notify**: maintainer (Mohammad Kaif) + affected tenant owners with factual scope (what
   fields, what window, which orgs). No speculation in writing.
4. **Eradicate**: fix on a branch, add a regression test reproducing the leak, review, deploy.
5. **Verify**: re-run the full suite (cross-tenant tests) + a manual two-org probe against the
   deployed build.
6. **Review**: write a post-incident note into `docs/incidents/` (what/why/change).

## S2: Credential / secret exposure

1. Rotate immediately: session tokens are DB records — `UPDATE "Session" SET "revokedAt" = now()
   WHERE ...` revokes instantly platform-wide (or per user).
2. LLM keys / TOTP secrets: set a new `ENCRYPTION_KEY`, then have users re-save provider configs
   and re-enrol MFA (old sealed values fail closed to "not configured" — by design).
3. If the exposed secret reached git: rotate it, then rewrite history (`git filter-repo`) and
   force-push in coordination with collaborators; note that public repos require assuming
   compromise regardless.

## S2: Detection-engine integrity (bad scores being produced)

1. Freeze ingestion: pause demo stream (System view), stop import endpoints via deploy flag.
2. Snapshots: `cp db/custom.db ...` before any intervention.
3. Reproduce with the deterministic suite (`bun test`) — the engine is deterministic, so a
   regression is reproducible from stored signals (persisted per transaction).

## Account-level incidents (S3)

- Locked account: clears automatically after 15 minutes, or via password reset.
- Stolen session: user revokes the device in Security & devices; operator can revoke via DB.
- MFA loss: disable MFA requires password + current code; without both, operator resets from
  the database (documented manual path).

## Contacts & escalation

- Maintainer: Mohammad Kaif (repository owner).
- There is no 24×7 on-call; the deployment is demo-grade. This runbook becomes contractual only
  with the Phase 4 operations setup.

## Post-incident template

```
# Incident YYYY-MM-DD <slug>
severity, window, systems affected
timeline (UTC) detected → contained → eradicated → verified
root cause
what the audit trail showed
regression test added (path)
honest customer-facing summary (if tenants affected)
```
