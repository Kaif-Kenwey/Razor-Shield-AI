# Dataset provenance — `sparkov_anonymised_sample.csv`

## What this file is

A **4,062-row, fully anonymised, fraud-labelled sample** built from the
public Sparkov credit-card transaction dataset (the `kartik2112
"Fraudulent Transactions Data"` distribution widely used as a fraud
benchmark: ~1.3M transactions, 983 cards, 7,506 labeled frauds, Jan 2019 –
Jun 2020). The source is synthetic data generated from real spending
patterns — it is NOT real cardholder data, and this project never claims
otherwise. It is used because it is (a) publicly and legally usable for
research/education, and (b) carries genuine ground-truth `is_fraud`
labels, which RazorShield's own demo generator cannot provide.

## Why a card-centric stratified sample

Scanning all 1.3M rows would exceed the app's 5,000-row batch limit and
dilute fraud density to 0.58% (useless for a live demo). Instead:

- **45 fraud-dense cards** (most labeled frauds) contribute their genuine
  transaction history: the **12 transactions immediately preceding their
  first fraud** (so real customer baselines exist) plus a **±14-day window
  around their frauds** — this preserves real customer baselines, real
  velocity bursts and real impossible-travel structures that the engine
  needs.
- **20 clean cards** (≥40 transactions, zero frauds) provide realistic
  legitimate traffic.
- Per-card cap 100 rows (25 for clean cards). Rows are ordered
  chronologically. Result: 4,036 rows, **699 labeled frauds (17.3%)**,
  65 anonymised customers.

The stratification is disclosed everywhere the metrics are shown:
precision / recall / F1 are measured **on this sample**, not on the full
population, and are not directly comparable to production fraud rates.

## Anonymisation applied

| Source field | Disposition |
|---|---|
| `cc_num` (card number) | Replaced by salted SHA-256 → `CUS_XXXXXXXX` |
| `first`, `last`, `gender`, `street`, `zip`, `lat`, `long`, `job`, `dob`, `city_pop`, `merch_lat`, `merch_long` | **Dropped** (PII / quasi-PII) |
| `trans_num` | Kept as `transaction_id` (random hash, not personal data) |
| `merchant` | Kept (generator-obfuscated business names, `fraud_` prefix stripped) |
| `city`, `state` | Kept as coarse `location` ("City, ST") |
| `trans_date_trans_time` | Normalised to ISO-8601 UTC `timestamp` |
| `amt` | Converted to the app's portfolio currency at a **fixed, documented rate of ₹83.00/USD** (rounded to paise). The conversion is linear and reversible, changes no behavioral relationship, and is disclosed here and in the demo. Absolute-value thresholds (₹50k/₹1L) are calibrated for INR portfolios — this normalization makes them meaningful instead of silently miscalibrated. |
| `is_fraud` | Kept as `is_fraud` ground truth |
| `category` | Kept for reference (merchant category, not a payment rail) |

## Fields the source does not carry — honestly absent

- **Device fingerprint** — absent. The engine's device-novelty signal
  cannot fire and the ledger records a data-quality warning.
- **Payment rail** — absent. Rows show rail "Unknown"; the
  payment-method-mismatch signal cannot fire. No rail is ever invented.

## Reproducibility

Built by a deterministic two-pass streamed sampler (fixed RNG seed
`20260101`): same source file → byte-identical sample. The full-size
source is not committed; only this sample is.
