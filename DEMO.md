# RazorShield AI — demo script (6 steps, ~8 minutes)

The demo proves one loop end-to-end on **real, labelled data**:
upload → detect → investigate → act → persist → audit.
Prerequisite state: app running on port 3000, demo mode ON for the live
feed, and the evaluation file `data/sparkov_anonymised_sample.csv` on hand
(see `data/PROVENANCE.md` for what it is and how it was built).

**Honest framing to open with (30 seconds):**
> "The detection engine is a deterministic, explainable rules engine —
> 10 transparent rules, every point on the score is traceable to a signal.
> The LLM is an optional investigator that interprets that evidence; when
> it's not configured, a heuristic investigator takes over and the UI says
> which one answered. I'll show both, and I'll show measured precision and
> recall against genuine ground-truth labels."

---

## 1. Introduce the problem (overview screen)

- Open **Overview**. Suspicious payments need risk detection + human
  investigation; RazorShield correlates amount, device, location, velocity
  and merchant context into explainable, bounded, auditable cases.
- Point at the honest labels: `DEMO ENVIRONMENT · SYNTHETIC PAYMENT FEED`,
  `AI: HEURISTICS` (no LLM configured), `Demo environment · synthetic data
  only` in the footer.

## 2. Import transaction data (Dataset Studio)

- **Dataset Studio → New import → Upload a CSV file** → choose
  `data/sparkov_anonymised_sample.csv`.
- Show the mapping step: `amount`, `transaction_id`, `timestamp`,
  `customer_id`, `merchant`, `location`, `is_fraud` are mapped; **device
  and payment rail are deliberately left unmapped** — the source dataset
  doesn't have them, and the app reports that as a data-quality gap
  instead of inventing values.
- Click **Score 4,036 rows**. The header shows `4,035 rows scored · 1
  skipped (unusable amount) · 337 alerts` and **DATA QUALITY 80%** with the
  red `DEVICE FINGERPRINT 0%` chip.
- Scroll to **Engine quality**: precision **86.9%**, recall **41.9%**,
  F1 56.6, confusion matrix, rupee cost of both mistake types. Say the
  recall number out loud — it's the honest ceiling of a 10-rule engine on
  this file, and the **Threshold Lab** below shows the trade-off at every
  cutoff. Provenance/caveats live in `data/PROVENANCE.md`.

## 3. Demonstrate risk detection

- In the run header click **Import 4035 rows to ledger** — rows are scored
  per-row against the ledger chronologically, with a live progress bar.
- Open **Transactions**: the ledger now holds the imported rows
  (`dataSource="import"`) alongside the demo portfolio
  (`dataSource="demo"`) — provenance is visible per row.
- Sort by risk: flagged rows carry structured signal cards — high value,
  amount deviation vs the card's prior median, velocity bursts,
  odd-hour activity, merchant outliers.

## 4. Investigate a suspicious transaction

- **Investigations → open a HIGH case** from the imported data.
- Walk the case file: risk score composition (each signal's point
  contribution), risk signals with facts, **customer intelligence —
  genuine aggregates from the ledger** (account age, prior transaction
  count, average ticket, usual location; "unknown" where the data has
  none), transaction timeline and similar past cases.
- The AI investigator panel shows **HEURISTIC · LLM UNAVAILABLE** —
  deterministic analysis of record. (Optional: connect an LLM from the top
  bar `AI` button and rerun; the badge flips to the model that answered,
  and the verdict is persisted with provider/model/latency.)
- Security note for the professor: the investigation API accepts only a
  transaction id — the facts come from SQLite server-side, so a tampered
  request cannot change what the engine sees.

## 5. Demonstrate analyst actions

- In the case: **Assign** the case, then record a bounded decision
  (e.g. **BLOCK**) with a short note in the confirm dialog.
- Add a notebook entry (quick chips: *Called customer*, *OTP verified*…).
- Show the **Audit trail** panel: system/engine/analyst events,
  append-only, each with actor + timestamp.

## 6. Prove persistence

- **Restart the app** (or just reload the page after a full server
  restart). Re-open the same case: the status, the BLOCK decision, the
  note and the notebook entry are all still there — they live in SQLite,
  not in the browser.
- Optional proof: `curl /api/audit?transactionId=…` returns the full event
  history from the server.
- Close with the automated test suite: `bun test` — 15 tests covering
  future-data leakage, scoring consistency, duplicate rejection, import
  validation, tamper-proofing, LLM fallback and restart persistence.

---

### Backup talking points

- **Scoring consistency**: the same rows score identically in Dataset
  Studio and the ledger — 100.00% of 4,035 rows matched in the recorded
  run — because both use the same causal engine path (`tests/riskEngine.test.ts`).
- **Why recall isn't 90%**: static rules can't see adapted attacks; the
  **Attack Simulator** (Detection Benchmark) demonstrates the arms race —
  per-row detection decays as the red team adapts while the entity graph
  recovers coordinated fraud. That's the roadmap argument for ML layering
  *on top of* explainable rules, not instead of them.
- **What I did not claim**: this is not a trained ML model, and the
  metrics are measured on a stratified sample, not production traffic.
  Both statements are in the README and the UI.
