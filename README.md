# RazorShield AI

**AI-Powered Payment Risk Detection & Investigation Agent**


![Next.js](https://img.shields.io/badge/Next.js-16-black) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue) ![Tailwind](https://img.shields.io/badge/Tailwind-4-06b6d4) ![License](https://img.shields.io/badge/license-MIT-green)

RazorShield AI is a dark-mode **risk operations command center** that turns fraud triage into a closed, auditable loop: transactions stream in live, a deterministic risk engine scores them, an LLM investigator argues over the evidence and recommends an action — and a human analyst confirms, notes, hands off, and exports the audit trail.

Every recommendation stays **human-gated**: the AI investigates and recommends (ALLOW / REVIEW / HOLD / BLOCK with a confidence score), the analyst decides, and the system records who did what, when, and why.

## Why this exists

Most fraud tooling stops at a score. An analyst gets a number, a queue, and no context — the customer history has to be pulled by hand, the alert argued with, and the write-up done after the fact. Worse, a row-level score physically cannot see a fraud ring: five accounts that each look unremarkable in isolation, all sharing one burner device.

RazorShield AI puts the whole loop in one workspace instead of four tabs. The rule engine produces structured evidence, the LLM investigates that evidence and recommends an action, similar closed cases are recalled as precedent, coordinated fraud is caught at the entity-graph level, and the analyst — never the model — signs the decision into an audit trail. That separation is deliberate: the engine owns evidence, the AI owns interpretation, the human owns the decision.

---

## The seeded demo cases

`bun run db:seed` loads a reproducible synthetic portfolio built to exercise every rule honestly (each row labelled `dataSource="demo"`):

```
High-value spike   TXN_D… · ₹1,85,000 · CUS_D01 · Surat
                   Risk HIGH — high-value + ≥10× customer median + location drift

Velocity burst     6 payments ₹12-18k in 10 minutes on one card
                   Risk HIGH — velocity + unusual-amount stack

Mule ring          3 accounts · 6 payments · one BURNER-D900 device · QuickMart Kiosk
                   Per-row scores LOW (by design — each mule looks normal alone);
                   the Fraud Network panel links them and reports the missed rows
```

## The investigation loop

```
TRANSACTION → RISK DETECTION → EVIDENCE → AI INVESTIGATION
     → RECOMMENDATION → HUMAN ACTION → AUDIT TRAIL
```

- **Risk detection** — live-streamed transactions scored on arrival; CRITICAL/HIGH cases surface with signal cards (device, amount, geo, velocity). Coordinated bursts raise a `FRAUD CLUSTER DETECTED` stream event with a one-click path to the worst case in the group.
- **Evidence** — scored risk signals, customer intelligence (tenure, avg ticket, prior flags, device history, spend timeline), and **precedent recall**: similar closed cases found by feature-vector similarity across the loaded universe, each with a similarity score, the shared features that earned the match, and the analyst's actual verdict on that precedent where one exists.
- **AI investigation** — the rules engine collects the evidence; the LLM plays investigator. It returns a structured verdict (recommended action, confidence, supporting evidence, *contradicting* evidence, and open uncertainties) plus a short risk story. The reasoning is one click away, never force-fed. When no LLM endpoint is configured, a deterministic heuristic investigator takes over and **the UI badges which one answered** — no pretending.
- **Recommendation** — ALLOW / REVIEW / HOLD / BLOCK with a confidence score, grounded in the evidence set.
- **Human action** — the analyst confirms through the decision modal, optionally adding notebook entries (quick chips, `Alt+1-5`).
- **Audit trail** — every AI step, handoff, and analyst action is timestamped and exportable (CSV includes notebook volume per case).

### Counterfactuals, not just conclusions

For any case, "View full reasoning" includes a **decision sensitivity** panel: each risk signal is removed in turn and the score is recomputed. You see exactly which signals are load-bearing ("remove velocity 92 → 74, verdict survives; remove amount 92 → 61, verdict flips to REVIEW") — the honest answer to "what would change your mind?".

## Dataset Studio — score your own data

The demo feed proves the UI; **Dataset Studio** proves the engine:

1. **Import** — drop in any CSV/TSV export (up to 5 MB / 5,000 rows). Delimiter, quoting and BOM quirks are handled; there's a 58-row labeled sample for a one-click start — including a five-account mule ring planted on purpose.
2. **Map** — columns are auto-detected against the engine's fields (`amount`, `timestamp`, `customer_id`, `is_fraud`, …) with fuzzy header matching — payment exports name the same field a dozen different ways. Everything is editable before the run.
3. **Score** — rows go to `POST /api/datasets/analyze`; the deterministic engine (`rse-1.2`, `src/lib/riskEngine.ts`) builds per-customer baselines and scores every row against 10 rules: high value, structuring, customer-relative amount deviation, velocity bursts, impossible travel, location drift, first-seen devices (per-customer first-seen and portfolio-rare burners are distinct signals), odd-hour activity, merchant outliers, payment-method switches.
4. **Measure** — with ground-truth labels the run reports **precision, recall, F1, the confusion matrix and the rupee cost of both mistake types** (false alarm = wrongly frozen funds + ₹450 review ops; miss = the fraud loss). Unlabeled files still get volume analytics.

Every run is persisted in SQLite (Prisma) and re-openable from history. Alerts route into the live investigation queue with one click — scored rows become real cases with the full workspace.

On the built-in sample, the per-row engine scores **P 85.7 / R 57.1 / F1 68.6** — it catches the velocity burst and the big-ticket fraud, false-alarms on two legit high-value payments, and honestly misses nine fraud rows: six of them belong to the mule ring, where every account looks unremarkable in isolation. The entity-graph module links those accounts into **one cluster (5 accounts · 2 burner devices · ₹2.9L exposure, ring score 76)**, lifting combined recall to ~85.7%. That division of labor is the point: rules price individual payments, the graph exposes coordination.

## Threshold Lab, Fraud Network, Attack Sim

Three tools live under the scored results, because a score without instruments is just a number:

- **Threshold Lab** — replays labeled outcomes at every score cutoff with the same cost model as the engine, plots P/R/F1 and rupee cost across the sweep, and marks the **cost-optimal cutoff** alongside the engine's default. The savings figure between "engine now" and "cost-optimal" is printed, not implied.
- **Fraud Network** — builds an entity graph over devices shared across accounts, clusters them (union-find), scores each ring 0-100 (fraud density, infrastructure breadth, burst tempo, rupee exposure — weights documented in `src/lib/fraudGraph.ts`), and renders the bipartite graph: burner devices on the left, accounts on the right, fraud-colored nodes.
- **Attack Simulator** — plays red team against the real engine. Three profiles (opportunistic → threshold-aware structuring → organized ring with burner rotation); each generates deterministic multi-wave campaigns seeded from *your* run's baselines, scored by the actual rule engine. The honest pattern falls out on its own: per-row detection decays as the attacker adapts, while the graph keeps recovering coordinated fraud the rules never saw.
- **Data quality** — grades the file behind the run (field completeness, graph identifiers, label coverage) as a single percentage with named deficits, so a weak metric can be traced to weak inputs.
- **Reliability by score band** — compares the engine's mean predicted score against the observed fraud rate per score band. Calibration is only claimed where the sample can actually support it.

## Design decisions (the why behind the numbers)

- **Median, not mean, for customer baselines.** Fraud inflates means — one ₹2L transaction drags a ₹8k-average customer's baseline up and hides the next fraud. Medians shrug that off. I'd rather re-derive the baseline than let the attacker write it.
- **10-minute velocity window.** Card-testing bursts run in minutes, not hours; a 60-minute window buries a 12-authorization burst under legitimate traffic. The window matches how attacks actually pace themselves.
- **Impossible travel tops out at 24 points, not 40+.** Geo/IP data is noisy — VPN egress and cell-tower jitter produce real false positives. It's strong corroboration, not a verdict on its own.
- **A missed fraud costs more than a false alarm.** The cost model prices a false alarm at frozen funds + ₹450 review ops; a miss is the full fraud loss. That asymmetry is why the recommended cutoff leans sensitive, and why Threshold Lab exists — the trade-off should be a business decision, not a hidden default.
- **Cold start.** A customer with thin history gets fewer customer-relative rules and more portfolio-level ones (new device, merchant outliers). First-seen device alone never escalates past MEDIUM — the rule needs ≥3 prior transactions before it's allowed to be loud.
- **When the LLM and the rules disagree, both survive.** The engine owns evidence; the LLM owns judgment. If the model downgrades a CRITICAL to HOLD at 75% confidence, the UI shows the disagreement rather than averaging it away — that tension is exactly what an analyst should see.
- **Missing data degrades loudly.** Data quality scoring names which fields are missing on which rows and which rules go blind as a result — an honest gap beats a silent one.

## Honest limitations

- The engine is a **deterministic rule system**, not a trained ML model. The Detection Benchmark computes precision/recall/F1 and the confusion matrix **only over rows that carry ground-truth labels** in the ledger — unlabelled payments are excluded rather than guessed, and the page says so.
- The LLM investigator is only as good as the endpoint you give it; latency runs a few seconds and a timeout falls back to heuristics (the UI says which). Free-tier models carry provider rate limits; the *Automatic Free Model* route is only as available as OpenRouter's current $0 catalogue.
- The live feed in DEMO mode is a synthetic generator writing to the real ledger with `dataSource="demo"` — labelled as such in the UI. There is **no real payment gateway**; swapping one in is a service-layer change by design.
- Demo percentages (precision 57% on the seeded 80 rows, say) are demonstrations of method, not statistical proof; import a real labelled file for real numbers.
- The fraud-graph currently links on shared device fingerprints; adding IP/email/address edges is roadmap work.
- Persistence is local-first SQLite — right for the demo, not for scale. A production deployment would swap it for managed PostgreSQL (the Prisma schema ports as-is); nothing else in the app assumes a single machine.

## Tech stack

- **Next.js 16** (App Router, single-route SPA) + **TypeScript 5**
- **Tailwind CSS 4** + **shadcn/ui** (New York) + Lucide icons
- **framer-motion** (transitions), **recharts** (charts)
- **zustand** (analyst workspace state) + **TanStack Query** (server state: 5s metrics polling, ledger pages, mutations)
- **Prisma + SQLite** — the ledger is the single source of truth: transactions, customers, investigations and the audit trail
- **bun** as the runtime / package manager
- Type system: Space Grotesk for display, IBM Plex Sans/Mono for UI and data

## Architecture: one ledger, every surface reads it

**The ledger is the source of truth.** Everything the dashboard shows — metrics, queues, charts, the audit trail — is computed from SQLite at request time (`/api/risk/metrics`, `/api/system/health`, `/api/model/performance`). There is no mock fallback: when the database is empty the UI says so and offers the seed/import actions.

**Ingestion & scoring** — every record (manual, CSV import, demo generator) goes through one shared service (`src/lib/server/scoringService.ts`): load the customer's stored history + recent portfolio context, run the existing `scoreBatch` unchanged, persist the score, signals and audit rows in one Prisma transaction. Rules that need history (velocity, impossible travel, method switch) always see real context — a transaction is never scored in isolation.

**Dataset Studio** — unchanged batch path: `src/lib/csv.ts` (parse + map, client) → `POST /api/datasets/analyze` → `src/lib/riskEngine.ts` (server) → persisted runs. The added **Import to ledger** action feeds the same rows through the shared scoring service with per-customer context.

**Investigation** — `POST /api/investigate` loads the ledger row server-side, hands rule-engine evidence to the configured LLM (`src/lib/agent/`, provider-agnostic via the in-app panel or `LLM_BASE_URL`/`LLM_API_KEY`), validates the verdict, and **persists it** (provider, model id, latency, fallback reason) alongside an audit event. Without credentials it returns the heuristic verdict — also persisted, also labelled. The engine, graph module, similarity and simulator remain pure TypeScript with no I/O.

## API surface

| Route | What it does |
|---|---|
| `GET/POST/PATCH /api/transactions` | paginated+filtered ledger; create→score→persist; status transitions |
| `GET/PATCH/DELETE /api/transactions/:id` | full case file (txn + customer + audit); analyst decision; restricted delete |
| `POST /api/transactions/import` | Dataset Studio → ledger bulk import (duplicates reported, never silently dropped) |
| `GET /api/customers` · `/api/customers/:id` | profiles derived live from the ledger — nothing stored twice |
| `GET /api/risk/metrics` | every dashboard statistic as live SQL aggregates |
| `GET /api/model/performance` | precision/recall/F1 on labelled rows only; `insufficientData` state below 12 labels |
| `GET /api/system/health` | measured db latency, counts, queue depth, LLM state |
| `GET /api/audit` | persisted audit trail (survives transaction deletion) |
| `POST/DELETE /api/demo` | DEMO SIMULATION: seed / arrival / clear-only-demo |
| `POST /api/investigate` | LLM or heuristic investigation, validated + persisted |
| `GET/POST/DELETE /api/llm-config` · `POST /api/llm-config/test` · `POST /api/llm/models` | AI panel: status, key storage (server-only), live probe, live model catalogues |

## Getting started

Prerequisites: [bun](https://bun.sh) ≥ 1.1

```bash
bun install
bun run db:push     # create/sync the local SQLite database (db/custom.db)
bun run db:seed     # optional: load the labelled synthetic demo portfolio (80 rows)
bun run dev         # http://localhost:3000
```

Environment: copy `.env.example` to `.env`. `DATABASE_URL` works with zero configuration. The LLM investigator is **optional** — without it the deterministic heuristic investigator answers, clearly labeled.

### Connecting an LLM (no file editing needed)

Click the **AI** button in the top bar and pick a provider card:

| Provider | Key | Model catalogue |
|---|---|---|
| **OpenRouter** | [openrouter.ai/keys](https://openrouter.ai/keys) | fetched live; **FREE** labels come from each model's own pricing metadata, plus an *Automatic Free Model* route that resolves to a currently-$0 model |
| **Google Gemini** | [AI Studio](https://aistudio.google.com/apikey) | fetched live from the OpenAI-compatible endpoint |
| **Groq** | [console.groq.com/keys](https://console.groq.com/keys) | fetched live |
| **Ollama (local)** | none — runs on your machine | your installed models only, fetched from the local server |
| **Custom endpoint** | your provider's key | type the model id (Together, Fireworks, vLLM, private gateways) |

Paste a key, hit **Test connection** (a real probe — latency and the model that responded are shown), then **Save & activate**. The key is stored server-side in `db/llm-config.json` (gitignored), never returned to the browser, and the in-app config overrides `.env` — disconnect to fall back.

**Privacy:** case evidence (transaction facts + signal summary, with identifiers minimized) is sent to the provider you select. For a nothing-leaves-the-machine setup use Ollama — the panel marks it LOCAL.

## Data ingestion — three ways to populate the ledger

1. **Demo simulation** — `bun run db:seed` (or the empty-state / System-page button) loads a reproducible synthetic portfolio: normal traffic plus high-value, velocity-burst, new-device, odd-hour, structuring and shared-burner mule-ring scenarios, each labelled `dataSource="demo"`. Clear only demo rows any time (System → Clear demo data) — imports and manual entries survive. The DEMO toggle in the top bar also streams synthetic arrivals; they are labelled demo data in the UI, never presented as gateway traffic.
2. **CSV import** — Dataset Studio scores any CSV/TSV, then **Import to ledger** pushes the mapped rows into the main database, where each row is re-scored server-side against the customer's *stored* history. Ground-truth labels come along and feed the benchmark.
3. **Manual entry** — Transactions → **New transaction** scores and stores a single payment live: built for the classroom question "what happens if I submit ₹5,00,000 right now?".

## Transaction lifecycle (all stages on stored records)

```
INGESTION (CSV / manual / demo generator)
  → SQLite ledger (Prisma: Transaction + Customer)
  → scoring against stored customer history + portfolio baselines (rse-1.2)
  → classification (LOW/MEDIUM/HIGH/CRITICAL → ALLOW/REVIEW/HOLD/BLOCK)
  → alert queue + fraud-graph clustering
  → AI/heuristic investigation (persisted)
  → analyst decision (persisted)
  → audit trail (AuditEvent rows — survives deletion)
  → dashboard refresh (5s metric polling, 4s feed polling)
```

## Project structure

```
src/
├── app/                    # Single-route SPA (page.tsx) + layout + design tokens (globals.css)
│   └── api/
│       ├── transactions/   # Ledger CRUD + pagination/filters + bulk import
│       ├── customers/      # Derived customer profiles
│       ├── risk/metrics/   # Live dashboard aggregates
│       ├── model/          # Labelled-row engine evaluation
│       ├── system/health/  # Measured service status
│       ├── audit/          # Persisted audit trail
│       ├── demo/           # DEMO SIMULATION: seed / arrival / clear
│       ├── datasets/       # Dataset Studio API: analyze, list, detail, delete (Prisma-backed)
│       ├── investigate/    # LLM investigation endpoint (persisted, provider-agnostic)
│       └── llm-config/     # AI panel: status, save/clear, probe, model catalogues
├── components/
│   ├── dashboard/          # Hero landing, overview, metrics, live feed + cluster events
│   ├── datastudio/         # Import wizard, mapping, results, Threshold Lab, Fraud Network, Attack Sim
│   ├── investigation/      # Workspace, AI investigator, sensitivity, notebook, audit trail
│   ├── model/              # Detection benchmark (live labelled-row evaluation)
│   ├── layout/             # App shell, sidebar, command palette, keyboard layer
│   ├── providers/          # TanStack Query provider
│   ├── risk/               # Risk intelligence, badges, score dials
│   ├── settings/           # Multi-provider AI configuration dialog
│   ├── shared/  system/ ai/# Shared primitives, engine health, AI status
│   ├── transactions/       # Payment ledger + transaction detail + manual entry
│   └── ui/                 # shadcn/ui primitives
├── lib/
│   ├── riskEngine.ts       # Deterministic batch scorer (rse-1.2)
│   ├── server/             # scoringService (history-aware), ledger mapping, demo generator
│   ├── fraudGraph.ts       # Entity-graph ring detector
│   ├── threshold.ts        # Cost-optimal cutoff sweep
│   ├── attackSim.ts        # Adversarial attack simulator
│   ├── similarCases.ts     # Feature-vector precedent recall
│   ├── agent/              # LLM client + investigator + provider registry (server-side only)
│   └── csv.ts · format.ts · db.ts
├── services/               # Typed API layer (all methods hit real endpoints)
├── hooks/                  # React Query hooks + DB-backed live feed
├── store/                  # zustand store (view state, demo mode, decisions, personas)
└── types/                  # Domain contracts (core + dataset)
prisma/                     # Schema (SQLite): Dataset, DatasetRow, Transaction, Customer, Investigation, AuditEvent + seed script
```

## Roadmap

- IP / email / billing-address edges in the fraud graph (currently device-sharing only)
- Streaming CSV import (chunked upload) beyond the 5,000-row cap
- Cross-run diff — compare two imports of the same portfolio over time
- Calibration curves with confidence intervals once real labeled volume lands
- Real-time risk-feed swap via `USE_REMOTE=true` for the live console

---

Built by **Mohammad Kaif** — where the AI does the legwork, and the human stays in command.
