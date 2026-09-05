# RazorShield AI

**AI-Powered Payment Risk Detection & Investigation Agent**

*Razorpay AI Buildathon 2026 — "AI Risk Manager" track*

![Next.js](https://img.shields.io/badge/Next.js-16-black) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue) ![Tailwind](https://img.shields.io/badge/Tailwind-4-06b6d4) ![shadcn/ui](https://img.shields.io/badge/shadcn%2Fui-latest-black) ![License](https://img.shields.io/badge/license-MIT-green)

RazorShield AI is a dark-mode **risk operations command center** that turns fraud triage into a closed, auditable loop: transactions stream in live, the risk engine scores them, an AI investigator assembles evidence and recommends an action — and a human analyst confirms, notes, hands off, and exports the audit trail.

Every recommendation stays **human-gated**: the AI investigates and recommends (ALLOW / REVIEW / HOLD / BLOCK with a confidence score), the analyst decides, and the system records who did what, when, and why.

---

## The demo case

The flagship case the product opens on — fully deterministic, no network required:

```
TXN_8F21A9 · ₹48,500 · CUS_10482 · Mumbai
Risk score 92/100 · CRITICAL · RECOMMENDATION: BLOCK (confidence 94%)
Signals: New device · Unusual amount 6.4× · Location anomaly · Velocity spike (5 txns / 3 min)
```

The customer profile contradicts the alarm — 2y 4m tenure, 184 transactions, avg ticket ₹7,540, clean except 2 prior flags — which is exactly the tension the AI investigator walks the analyst through before recommending BLOCK.

## The investigation loop

```
TRANSACTION → RISK DETECTION → EVIDENCE → AI INVESTIGATION
     → RECOMMENDATION → HUMAN ACTION → AUDIT TRAIL
```

- **Risk detection** — live-streamed transactions scored on arrival; CRITICAL/HIGH cases surface with signal cards (device, amount, geo, velocity).
- **Evidence** — four scored risk signals, customer intelligence (tenure, avg ticket, prior flags, device history, spend timeline chart), similar-case recall.
- **AI investigation** — a step-by-step AI activity timeline plays out in the workspace; the full reasoning is one click away ("VIEW FULL REASONING") but never force-fed — the AI states its conclusion, the analyst can drill in.
- **Recommendation** — ALLOW / REVIEW / HOLD / BLOCK with a confidence score, grounded in the evidence set.
- **Human action** — the analyst confirms through a "Confirm risk action?" modal (94% confidence shown), optionally adding a notebook entry (quick chips, `Alt+1-5`).
- **Audit trail** — every AI step, handoff, and analyst action is timestamped and exportable (CSV includes notebook volume per case).

## Dataset Studio — score your own data

The demo feed proves the UI; **Dataset Studio** proves the engine. It accepts real payment data:

1. **Import** — drop in any CSV/TSV export (up to 5 MB / 5,000 rows). Delimiter, quoting and BOM quirks are handled; there's a 58-row labeled sample file for a one-click start — including a five-account mule ring the graph module is meant to catch.
2. **Map** — columns are auto-detected against the engine's fields (`amount`, `timestamp`, `customer_id`, `is_fraud`, …) with fuzzy header matching — payment exports name the same field a dozen different ways. Everything is editable before the run.
3. **Score** — rows go to `POST /api/datasets/analyze`; the deterministic engine (`rse-1.2`, `src/lib/riskEngine.ts`) builds per-customer baselines and scores every row against 10 rules: high value, structuring (threshold-hugging amounts), customer-relative amount deviation, velocity bursts, impossible travel, location drift, first-seen devices (per-customer first-seen and portfolio-rare burners are distinct signals), odd-hour activity, merchant outliers, payment-method switches. Each row gets an evidence-backed score, level and recommendation.
4. **Measure** — when the file carries ground-truth labels, the run reports **precision, recall, F1, the confusion matrix and the rupee cost of both mistake types** (false alarms = wrongly frozen funds + ₹450 review ops each; missed fraud = the fraud loss). Unlabeled files still get volume analytics: score histogram, level mix, top firing signals.

Every run is persisted in SQLite (Prisma) and re-openable from the run history. Alerts can be routed into the live investigation queue with one click — scored rows become real cases with the full workspace, notebook and audit trail. Scoring is deterministic: the same file always produces the same scores.

On the built-in sample, the per-row engine scores **P 85.7 / R 57.1 / F1 68.6** — it catches the velocity burst and the big-ticket fraud, false-alarms on two legit high-value payments, and honestly misses nine fraud rows: six of them belong to the mule ring, where every account looks unremarkable in isolation. The entity-graph module links those accounts into **one cluster (5 accounts · 2 burner devices · ₹2.9L exposure, ring score 76)** — fraud that is invisible row-by-row and obvious as a graph. That division of labor is the point: rules price individual payments, the graph exposes coordination, the dashboard prices every mistake instead of hiding it.

## What's inside

### Command center (overview)
Top-line metrics (24,891 analyzed / 183 high-risk / 67 under review / 41 blocked), a live transaction feed with a deterministic demo-arrival cycle, pattern digest with a 6-stat grid and a printable paper brief.

### Investigations queue
Active / Watchlist / Resolved tabs, SLA tiers (amber *aging* at 15m, red *breached* at 30m with a pulsing marker), per-analyst assignment with an **accept-handoff** flow (claiming switches the acting persona and is audited), notebook-entry badges on every card, per-analyst queue filtering, CSV audit export.

### Investigation workspace
Large animated risk score (92/100), recommendation panel with confidence, expandable AI reasoning, four evidence cards, customer intel with charts, similar cases, investigation timeline, analyst notebook with quick chips, and a full audit trail. Case file can be printed as a PDF brief.

### Risk intelligence & detection benchmark
Signal-level analytics view, and a Detection Benchmark page (precision 91.4% / recall 87.8% / F1 89.6% / ROC-AUC 94.1% + confusion matrix) — explicitly badged as a demo engine benchmark, not production ML performance. The honest, measurable numbers live in Dataset Studio, computed from whatever labeled data you import.

### Analyst-grade keyboard control

| Keys | Action | | Keys | Action |
|---|---|---|---|---|
| `⌘K` | Command palette / search | | `1–7` | Jump to view |
| `/` | Quick search | | `J` / `K` | Move feed cursor |
| `N` | Open newest high-risk case | | `↵` | Open highlighted txn |
| `D` | Pattern digest | | `P` | Pause live stream |
| `M` | Toggle alert chime | | `Alt+1–5` | Notebook quick chips |
| `?` | Cheat-sheet overlay | | `note:…` | Search all notebooks (palette) |

### Command palette
`⌘K` opens case search, navigation, live per-analyst **case queues** (with open counts), and a `note:` mode that searches every analyst's notebook entries across all cases.

## Tech stack

- **Next.js 16** (App Router, single-route SPA) + **TypeScript 5**
- **Tailwind CSS 4** + **shadcn/ui** (New York) + Lucide icons
- **framer-motion** (transitions), **recharts** (charts), **zustand** (state, persisted)
- **Prisma + SQLite** — Dataset Studio persists every analysis run server-side
- **bun** as the runtime / package manager

## Architecture: two data paths, one engine philosophy

**Live console** — all data flows through a service abstraction (`src/services/api.ts`) over a deterministic mock data layer (`src/data/mockData.ts`). The flag `USE_REMOTE=false` currently serves mocks; flipping it to `true` routes the same typed contracts (`src/types/index.ts`) at the real endpoints. Swapping in a live risk feed requires **no component changes** — only the service layer changes.

**Dataset Studio** — a real server path end to end: `src/lib/csv.ts` (parse + map, client) → `POST /api/datasets/analyze` → `src/lib/riskEngine.ts` (scoring + metrics, server) → Prisma/SQLite persistence → typed results back to the dashboard. The engine is pure TypeScript with no I/O, so the same rules can run in a worker, a cron job, or another runtime unchanged.

## Getting started

Prerequisites: [bun](https://bun.sh) ≥ 1.1

```bash
bun install
bun run db:push     # create the local SQLite database (db/custom.db)
bun run dev         # http://localhost:3000
```

Environment: `.env` holds only `DATABASE_URL` (local SQLite). A `.env.example` is included — copy it to `.env` if needed; the default Prisma datasource works with zero configuration.

## Testing

Static checks: `bun run lint` (ESLint) and `bunx tsc --noEmit` (strict TypeScript). Every UI surface is exercised manually across desktop and mobile widths before each release — boot, hero CTA, workspace flows, palette search, queue filters, the BLOCK confirm flow, CSV export, and the full Dataset Studio pipeline.

## Project structure

```
src/
├── app/                    # Single-route SPA (page.tsx) + layout + design tokens (globals.css)
│   └── api/datasets/       # Dataset Studio API: analyze, list, detail, delete (Prisma-backed)
├── components/
│   ├── dashboard/          # Hero landing, overview, metrics, live feed
│   ├── datastudio/         # Import wizard, column mapping, results dashboard
│   ├── investigation/      # Workspace, AI investigator, notebook, audit trail, digest, print briefs
│   ├── risk/               # Risk intelligence, badges
│   ├── model/              # Detection benchmark (demo snapshot, labeled as such)
│   ├── layout/             # App shell, sidebar, command palette, keyboard layer
│   ├── ai/                 # AI activity indicator, status pill
│   ├── shared/             # Shared primitives (status dots, SLA chips, states)
│   ├── system/             # Engine & service health
│   ├── transactions/       # Payment ledger + transaction detail
│   └── ui/                 # shadcn/ui primitives
├── data/                   # Deterministic mock data (flagship case + demo arrival script)
├── lib/                    # riskEngine.ts (batch scorer) · csv.ts (parser/mapper) · format · db
├── services/               # API abstraction (USE_REMOTE switch) + dataset client
├── store/                  # zustand store (view state, demo mode, decisions, personas)
└── types/                  # Domain contracts (core + dataset)
prisma/                     # Schema (SQLite): Dataset + DatasetRow
```

## Roadmap

- Streaming CSV import (chunked upload) beyond the 5,000-row cap
- Threshold sweep view — precision/recall across score cutoffs, not just the default
- Per-signal ablation — recompute metrics with individual rules disabled
- Cross-run diff — compare two imports of the same portfolio over time
- Real-time risk-feed swap via `USE_REMOTE=true` for the live console

---

Built for the **Razorpay AI Buildathon 2026**, "AI Risk Manager" track — where the AI does the legwork, and the human stays in command.
