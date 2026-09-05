# RazorShield AI

**AI-Powered Payment Risk Detection & Investigation Agent**

*Razorpay AI Buildathon 2026 — "AI Risk Manager" track*

![Next.js](https://img.shields.io/badge/Next.js-16-black) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue) ![Tailwind](https://img.shields.io/badge/Tailwind-4-06b6d4) ![License](https://img.shields.io/badge/license-MIT-green)

RazorShield AI is a dark-mode **risk operations command center** that turns fraud triage into a closed, auditable loop: transactions stream in live, a deterministic risk engine scores them, an LLM investigator argues over the evidence and recommends an action — and a human analyst confirms, notes, hands off, and exports the audit trail.

Every recommendation stays **human-gated**: the AI investigates and recommends (ALLOW / REVIEW / HOLD / BLOCK with a confidence score), the analyst decides, and the system records who did what, when, and why.

## Why this exists

Most fraud tooling stops at a score. An analyst gets a number, a queue, and no context — the customer history has to be pulled by hand, the alert argued with, and the write-up done after the fact. Worse, a row-level score physically cannot see a fraud ring: five accounts that each look unremarkable in isolation, all sharing one burner device.

RazorShield AI puts the whole loop in one workspace instead of four tabs. The rule engine produces structured evidence, the LLM investigates that evidence and recommends an action, similar closed cases are recalled as precedent, coordinated fraud is caught at the entity-graph level, and the analyst — never the model — signs the decision into an audit trail. That separation is deliberate: the engine owns evidence, the AI owns interpretation, the human owns the decision.

---

## The demo case

The flagship case the product opens on — fully deterministic, no network required:

```
TXN_8F21A9 · ₹48,500 · CUS_10482 · Mumbai
Risk score 92/100 · CRITICAL · RECOMMENDATION: BLOCK (confidence 94%)
Signals: New device · Unusual amount 6.4× · Location anomaly · Velocity spike (5 txns / 3 min)
```

The customer profile contradicts the alarm — 2y 4m tenure, 184 transactions, avg ticket ₹7,540, clean except 2 prior flags — which is exactly the tension the investigator walks the analyst through before recommending BLOCK.

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

- The engine is a **deterministic rule system**, not a trained ML model. The Detection Benchmark page is a demo snapshot and labeled as such; the real, reproducible numbers live in Dataset Studio on whatever data you import.
- The LLM investigator is only as good as the endpoint you give it; latency runs a few seconds and a timeout falls back to heuristics (the UI says which).
- The live console feed is a deterministic demo script, not a real gateway — swapping in a live source is a service-layer change by design.
- The sample dataset is 58 rows. Every percentage on it is a demonstration of method, not statistical proof; bring a real file.
- The fraud-graph currently links on shared device fingerprints; adding IP/email/address edges is roadmap work.
- Persistence is local-first SQLite — right for the demo, not for scale. A production deployment would swap it for managed PostgreSQL (the Prisma schema ports as-is); nothing else in the app assumes a single machine.

## Tech stack

- **Next.js 16** (App Router, single-route SPA) + **TypeScript 5**
- **Tailwind CSS 4** + **shadcn/ui** (New York) + Lucide icons
- **framer-motion** (transitions), **recharts** (charts), **zustand** (state, persisted)
- **Prisma + SQLite** — Dataset Studio persists every analysis run server-side
- **bun** as the runtime / package manager
- Type system: Space Grotesk for display, IBM Plex Sans/Mono for UI and data

## Architecture: two data paths, one engine philosophy

**Live console** — all data flows through a service abstraction (`src/services/api.ts`) over a deterministic mock layer. The flag `USE_REMOTE=false` currently serves mocks; flipping it to `true` routes the same typed contracts (`src/types/index.ts`) at real endpoints. Swapping in a live risk feed requires **no component changes** — only the service layer changes.

**Dataset Studio** — a real server path end to end: `src/lib/csv.ts` (parse + map, client) → `POST /api/datasets/analyze` → `src/lib/riskEngine.ts` (scoring + metrics, server) → Prisma/SQLite persistence → typed results back to the dashboard.

**Investigation** — `POST /api/investigate` hands rule-engine evidence to the configured LLM (`src/lib/agent/`, provider-agnostic via `LLM_BASE_URL`/`LLM_API_KEY`) and returns a validated structured verdict; without credentials it returns the heuristic verdict. The engine, graph module, similarity and simulator are all pure TypeScript with no I/O — the same code runs in a worker, a cron job, or another runtime unchanged.

## Getting started

Prerequisites: [bun](https://bun.sh) ≥ 1.1

```bash
bun install
bun run db:push     # create the local SQLite database (db/custom.db)
bun run dev         # http://localhost:3000
```

Environment: copy `.env.example` to `.env`. `DATABASE_URL` works with zero configuration. The LLM investigator is **optional** — set `LLM_BASE_URL`, `LLM_API_KEY` (and optionally `LLM_MODEL`) to any OpenAI-compatible endpoint (OpenAI, Groq, Together, a private gateway, or local Ollama/vLLM) and the investigator goes live; leave them empty and the deterministic heuristic investigator answers, clearly labeled.

## Project structure

```
src/
├── app/                    # Single-route SPA (page.tsx) + layout + design tokens (globals.css)
│   └── api/
│       ├── datasets/       # Dataset Studio API: analyze, list, detail, delete (Prisma-backed)
│       └── investigate/    # LLM investigation endpoint (provider-agnostic, validated output)
├── components/
│   ├── dashboard/          # Hero landing, overview, metrics, live feed + cluster events
│   ├── datastudio/         # Import wizard, mapping, results, Threshold Lab, Fraud Network, Attack Sim
│   ├── investigation/      # Workspace, AI investigator, sensitivity, notebook, audit trail
│   ├── model/              # Detection benchmark (demo snapshot, labeled as such)
│   ├── layout/             # App shell, sidebar, command palette, keyboard layer
│   ├── risk/               # Risk intelligence, badges, score dials
│   ├── shared/  system/ ai/# Shared primitives, engine health, AI status
│   ├── transactions/       # Payment ledger + transaction detail
│   └── ui/                 # shadcn/ui primitives
├── data/                   # Deterministic mock data (flagship case + demo arrival script)
├── lib/
│   ├── riskEngine.ts       # Deterministic batch scorer (rse-1.2)
│   ├── fraudGraph.ts       # Entity-graph ring detector
│   ├── threshold.ts        # Cost-optimal cutoff sweep
│   ├── attackSim.ts        # Adversarial attack simulator
│   ├── similarCases.ts     # Feature-vector precedent recall
│   ├── agent/              # LLM client + investigator (server-side only)
│   └── csv.ts · format.ts · db.ts
├── services/               # API abstraction (USE_REMOTE switch) + dataset client
├── store/                  # zustand store (view state, demo mode, decisions, personas)
└── types/                  # Domain contracts (core + dataset)
prisma/                     # Schema (SQLite): Dataset + DatasetRow
```

## Roadmap

- IP / email / billing-address edges in the fraud graph (currently device-sharing only)
- Streaming CSV import (chunked upload) beyond the 5,000-row cap
- Cross-run diff — compare two imports of the same portfolio over time
- Calibration curves with confidence intervals once real labeled volume lands
- Real-time risk-feed swap via `USE_REMOTE=true` for the live console

---

Built by **Mohammad Kaif** for the Razorpay AI Buildathon 2026, "AI Risk Manager" track — where the AI does the legwork, and the human stays in command.
