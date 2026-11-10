# Privacy & Data Handling

Phase 1 status. This document describes what the system actually stores today.

## What we store

| Data | Where | Purpose | Notes |
| --- | --- | --- | --- |
| Account: name, email, bcrypt hash, verification/MFA state | `User` | sign-in, security | Email is the only direct identifier |
| Session metadata: token hash, IP, user-agent, timestamps | `Session` | device management, security | Raw tokens never stored |
| Organisation name/slug, membership roles | `Organisation`, `Membership` | tenancy | — |
| Payment records: token-like ids, amount, merchant, location, device label, rail, (optional) ground-truth label | `Transaction` | fraud detection | **No card numbers, no CVV, no bank credentials — by schema design** |
| Customer code + optional name, KYC tier label | `Customer` | behavioural baselines | Names come from source CSVs; treat as untrusted input |
| Investigation narratives + evidence arrays | `Investigation` | case continuity | May quote merchant/location fields |
| Analyst notebook entries | `CaseNote` | case record | Attributed to authenticated user |
| Audit events (actor, action, entity, detail JSON) | `AuditEvent` | accountability | Org-scoped; append-only by code |

## Minimisation practices

- Source CSV columns are mapped explicitly; the pipeline never invents identity fields.
- Location/device are used as fraud signals and stored as provided — deployments handling real
  PII should minimise at ingestion (map to tokens) before import; the schema tolerates opaque
  values everywhere except amount/timestamp.
- LLM payloads: only the case facts needed for assessment (amount, merchant, location, device,
  rail, timestamps, signals) are sent to the configured provider — never credentials, never
  other tenants' data, never more history than the bounded context. Orgs that need data
  residency can point the org config at a local/self-hosted endpoint (e.g. Ollama).
- Login-failure audit detail masks email local parts.

## Retention & deletion (current state)

- Demo data is labelled `dataSource="demo"` and can be cleared per-org without touching real
  imports (System → Clear demo data).
- Deleting a transaction preserves the audit trail (SetNull) — intentional for accountability.
- Formal retention schedules, org-initiated export and hard-deletion requests are Phase 3
  (roadmap). Until then, removal is manual (database-level) by the operator.

## Ground truth labels

Labelled fraud data may exist in imported datasets (e.g. the public Sparkov sample, disclosed in
`data/PROVENANCE.md`). Labels are synthetic-research data, not real customer outcomes, and are
presented as such everywhere they appear.
