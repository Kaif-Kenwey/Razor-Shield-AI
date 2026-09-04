# RazorShield AI

**AI-Powered Payment Risk Detection & Investigation Agent**

*Razorpay AI Buildathon 2026 — "AI Risk Manager" track*

![Next.js](https://img.shields.io/badge/Next.js-16-black) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue) ![Tailwind](https://img.shields.io/badge/Tailwind-4-06b6d4) ![shadcn/ui](https://img.shields.io/badge/shadcn%2Fui-latest-black)

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

## What's inside

### Command center (overview)
Top-line metrics (24,891 analyzed / 183 high-risk / 67 under review / 41 blocked), a live transaction feed with a deterministic demo-arrival cycle, pattern digest with a 6-stat grid and a printable paper brief.

### Investigations queue
Active / Watchlist / Resolved tabs, SLA tiers (amber *aging* at 15m, red *breached* at 30m with a pulsing marker), per-analyst assignment with an **accept-handoff** flow (claiming switches the acting persona and is audited), notebook-entry badges on every card, per-analyst queue filtering, CSV audit export.

### Investigation workspace
Large animated risk score (92/100), recommendation panel with confidence, expandable AI reasoning, four evidence cards, customer intel with charts, similar cases, investigation timeline, analyst notebook with quick chips, and a full audit trail. Case file can be printed as a PDF brief.

### Risk intelligence & model performance
Signal-level analytics view, and a model performance page (precision 91.4% / recall 87.8% / F1 89.6% / ROC-AUC 94.1% + confusion matrix) — clearly labeled as a demo snapshot.

### Analyst-grade keyboard control

| Keys | Action | | Keys | Action |
|---|---|---|---|---|
| `⌘K` | Command palette / search | | `1–6` | Jump to view |
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
- **Prisma** (SQLite) — schema and API route stubs ready for a real backend
- **bun** as the runtime / package manager

## Architecture note: backend-ready by design

All data flows through a service abstraction (`src/services/api.ts`) over a deterministic mock data layer (`src/data/mockData.ts`). The flag `USE_REMOTE=false` currently serves mocks; flipping it to `true` routes the same typed contracts (`src/types/index.ts`) at the real endpoints (`/transactions`, `/risk/score`, `/investigations`, `/customers/:id`, `/risk/metrics`, `/model/performance`). Swapping in a real risk engine requires **no component changes** — only the service layer changes.

## Getting started

Prerequisites: [bun](https://bun.sh) ≥ 1.1

```bash
bun install
bun run db:push     # create the local SQLite database (db/custom.db)
bun run dev         # http://localhost:3000
```

Environment: `.env` holds only `DATABASE_URL` (local SQLite). A `.env.example` is included — copy it to `.env` if needed; the default Prisma datasource works with zero configuration.

## Testing

Static checks: `bun run lint` (ESLint) and `bunx tsc --noEmit` (strict TypeScript). Every UI surface is exercised manually across desktop and mobile widths before each release.

Static checks: `bun run lint` (ESLint) and `bunx tsc --noEmit` (strict TypeScript). Every UI surface is exercised manually across desktop and mobile widths before each release.

## Project structure

```
src/
├── app/                    # Single-route SPA (page.tsx) + layout + design tokens (globals.css)
│   └── api/                # Prisma-backed API route stubs (backend contract)
├── components/
│   ├── dashboard/          # Hero landing, overview, metrics, live feed
│   ├── investigation/      # Workspace, AI investigator, notebook, audit trail, digest, print briefs
│   ├── queue/              # Investigations queue, SLA chips, filters
│   ├── risk/               # Risk intelligence, badges
│   ├── model/              # Model performance
│   ├── layout/             # App shell, sidebar, command palette, keyboard layer
│   ├── ai/                 # AI activity indicator, status pill
│   └── ui/                 # shadcn/ui primitives
├── data/                   # Deterministic mock data (flagship case + demo arrival script)
├── services/               # API abstraction (USE_REMOTE switch — mock ↔ real backend)
├── store/                  # zustand store (view state, demo mode, decisions, personas)
└── types/                  # Domain contracts mirroring the future backend
prisma/                     # Schema (SQLite)
```

## Roadmap

- One-click **escalate** on SLA-breached cards (reassign to L3 lead, audited)
- Breached-only prefiltered queue linked from the digest SLA stat
- Jump-to-note highlight from palette search results
- Accept-and-keep-persona variant for L3 leads reviewing other queues
- Real-time risk-engine swap via `USE_REMOTE=true` (FastAPI service in progress)

---

Built for the **Razorpay AI Buildathon 2026**, "AI Risk Manager" track — where the AI does the legwork, and the human stays in command.
