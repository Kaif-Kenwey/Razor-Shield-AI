# Access Control Matrix

Authoritative source: `src/lib/rbac.ts` (server-enforced). Legend: ✅ granted · · not granted.
The platform super-admin flag (`User.isPlatformAdmin`) is reserved; no platform-admin surfaces
exist yet, so it grants nothing today.

| Permission | Owner | Admin | Fraud Mgr | Analyst | Investigator | Auditor | Viewer | Billing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| org:read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| org:manage (rename/delete) | ✅ | · | · | · | · | · | · | · |
| org:members:read | ✅ | ✅ | ✅ | · | · | ✅ | · | ✅ |
| org:members:manage | ✅ | ✅ | · | · | · | · | · | · |
| org:invitations:manage | ✅ | ✅ | · | · | · | · | · | · |
| org:config:manage (LLM settings) | ✅ | ✅ | · | · | · | · | · | · |
| transactions:read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · |
| transactions:write (manual entry, delete) | ✅ | ✅ | ✅ | ✅ | · | · | · | · |
| datasets:read | ✅ | ✅ | ✅ | ✅ | · | ✅ | ✅ | · |
| datasets:import | ✅ | ✅ | ✅ | ✅ | · | · | · | · |
| datasets:delete | ✅ | ✅ | · | · | · | · | · | · |
| investigations:read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · |
| investigations:create (run AI agent) | ✅ | ✅ | ✅ | ✅ | · | · | · | · |
| investigations:note | ✅ | ✅ | ✅ | ✅ | ✅ | · | · | · |
| investigations:decide (final decision) | ✅ | ✅ | ✅ | ✅ | · | · | · | · |
| investigations:assign / escalate | ✅ | ✅ | ✅ | · | · | · | · | · |
| audit:read | ✅ | ✅ | ✅ | · | · | ✅ | · | · |
| network:read (fraud graph) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · |
| evaluation:read (benchmark) | ✅ | ✅ | ✅ | ✅ | · | ✅ | ✅ | · |
| evaluation:run (threshold lab) | ✅ | ✅ | ✅ | · | · | · | · | · |
| demo:manage (seed/clear synthetic data) | ✅ | ✅ | ✅ | · | · | · | · | · |
| billing:read | ✅ | ✅ | · | · | · | ✅ | · | ✅ |
| billing:manage | ✅ | · | · | · | · | · | · | ✅ |

## Rules enforced in code

- Owners can assign any role; admins only non-owner roles (`assignableRoles`).
- The last Owner of an organisation can never be demoted or removed (409).
- Assignment/escalation targets must be members of the same organisation (validated per request).
- Every guard failure is a typed JSON error: 401 `UNAUTHENTICATED`, 403 `FORBIDDEN`,
  404 non-disclosing for cross-tenant resources.
- Audit actors derive from the session — `analystId` fields in client payloads are ignored
  (kept in schemas only for backward compatibility).
