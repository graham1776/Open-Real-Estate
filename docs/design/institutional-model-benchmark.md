# Benchmarking ORE against a live institutional underwriting model

*July 2026. Companion to `examples/estate-mark-to-market.ore`.*

## What this is

A buyer's working acquisition model — a 45-sheet Excel workbook underwriting a
seven-building, 1,154,018 SF multi-tenant industrial estate (25 tenants, 10-year
monthly DCF, ~$352M purchase price) — was extracted into a single `.ore` file and
run through the reference engine. The engine's outputs were then compared against
the source model's own reported results. Names, address, and tenant identities in
the published example are fictionalized; the economics are preserved.

This is the first test of the format against a real institutional model rather
than a synthetic example, and it answers three questions: **can the format carry
a real underwrite** (yes, with two small additions shipped alongside this doc),
**does the engine reproduce the model's results** (headline returns within a
basis point; year-by-year details in the table below), and **where do the
methodologies legitimately differ** (rollover blending, growth compounding, and
vacancy conventions — each documented below).

## Headline comparison

| Metric | Source model | ORE engine | Note |
|---|---|---|---|
| 10-year unlevered IRR | 7.58% | **7.57%** | see "compensating differences" below |
| Year-1 NOI | $13.57M | $13.54M | −0.2% |
| In-place vs market rent | ~−32% (11.83 vs 17.51 $/SF/yr) | −32.5% | market rent $17.51 equivalent on both sides |
| Stabilized (market) NOI, today | $20.21M | $19.69M | engine deducts the 2% vacancy allowance; model does not |
| Terminal value, gross (yr 10) | $490.6M @ 5.75% | $483.2M @ 5.75% | same vacancy-allowance difference at exit |
| Terminal value, net | $479.3M | $472.1M | −1.5% |
| DCF value @ 8% | $348.5M (model "net value") | $342.3M | −1.8% |

Reconstructing the model's own monthly cash-flow stream (NOI + rollover leasing
costs + terminal) and solving for IRR gives 7.55% vs its reported 7.58%, so
roughly 3 bps of any comparison is day-count/rounding noise inside the source
model itself.

## Year-by-year NOI

Analysis years run June–May, matching the model's start. Engine values from
`computeAll().cashFlows.annual`; model values rebinned from its consolidated
monthly cash flow.

| Year | Engine NOI | Model NOI | Diff |
|---|---|---|---|
| 1 | 13,539,738 | 13,565,516 | −0.2% |
| 2 | 14,789,501 | 14,733,951 | +0.4% |
| 3 | 16,129,872 | 16,407,856 | −1.7% |
| 4 | 17,964,508 | 17,894,874 | +0.4% |
| 5 | 19,793,124 | 20,231,542 | −2.2% |
| 6 | 20,821,134 | 20,557,061 | +1.3% |
| 7 | 21,990,499 | 21,086,453 | +4.3% |
| 8 | 22,614,719 | 20,716,625 | +9.2% |
| 9 | 25,153,561 | 23,767,680 | +5.8% |
| 10 | 25,843,576 | 23,118,122 | +11.8% |

Years 1–6 — dominated by contractual rent — agree within ~2%. The drift in years
7–10 is rollover methodology (below), where every model is making assumptions
about leases that do not exist yet. Both models converge again at the terminal,
which each marks to market NOI.

**Compensating differences, stated plainly:** the engine's out-year NOI runs
above the model's while its terminal value runs below (vacancy allowance in
stabilized NOI), and at an 8% discount rate these nearly cancel — that is why the
headline IRRs land 1 bp apart. The agreement is real but partly offsetting; the
table above is the honest picture.

## What mapped cleanly (no format changes needed)

- **25 leases with per-tenant effective escalation rates** (0%–22.9%/yr) and
  mid-lease review anniversaries — via `escalation.fixed_percent` plus the
  schedule-step anchoring pattern now documented in the data dictionary (date the
  last enumerated step one review cycle before the next contractual review).
- **Rollover friction**: 64-month market terms, 75% renewal probability,
  4 months downtime on new deals, branch-specific costs (new: 3 mo free / $3 TI /
  6% LC; renewal: 1 mo free / $1 TI / 3.5% LC), renewals at 100% of market —
  all native `marketLeasing` profile fields.
- **The underwritten lease-up** of the one vacant suite (negotiated $17.75 rate,
  3 months free, $8/SF TI, 6% LC, August 2026 start) — carried as a
  signed-not-yet-commenced lease so the deal-specific terms travel in the file,
  with `tenant.creditNotes` disclosing it is an assumption, not an executed lease.
- **Estate-level structure**: seven buildings under one file, buildings identified
  in `suite`, building SF table in `property.notes`.
- 2% general vacancy, 3%/3.5% expense/market-rent growth, fully recoverable
  $4.30/SF NNN expense pool with a recoverable 3% management fee, 120-month
  monthly DCF at 8%, terminal direct cap at 5.75% on market NOI.

## What this exercise added to the format and engine

1. **`leases[].spaceType`** — the model prices suites at three market-rent tiers
   ($17.25 / $17.50 / $18.25). Leases previously fell back to the file's first
   leasing profile; they now key into `marketAssumptions.marketLeasing` exactly
   like vacant suites. Stabilized/market NOI and the market-rent metric are now
   SF-weighted blends across profiles (identical to prior behavior for
   single-profile files — goldens unchanged).
2. **Signed-but-not-yet-commenced leases** — the engine now models no rent,
   occupancy, or recoveries before `commencementDate`, and defaults TI/LC funding
   to the commencement month. Real rent rolls carry these constantly; the spec
   text on `commencementDate` now states the behavior.

## Where the math legitimately differs

| Convention | Source model | ORE engine |
|---|---|---|
| Rollover blending | Single blended lease per expiry (probability-weighted downtime ≈1 mo, free rent 1.5 mo, TI $1.50) | True two-branch expected value (renew vs re-let), recursing through subsequent rollovers |
| Market-rent growth | Compounded monthly (≈3.5%/yr effective 3.4% to terminal) | Compounded annually on analysis anniversaries |
| General vacancy | Flat 2% of potential base rent, always | 2% of potential gross incl. recoveries, de-duplicated against explicit modeled downtime |
| Stabilized/terminal NOI | No vacancy allowance | Vacancy + credit-loss allowance deducted |
| Management fee | % of effective base rent | % of EGR (immaterial at full recovery) |
| Month-0 timing | NOI booked in the acquisition month | First operating month discounted one period |

None of these is wrong; they are exactly the class of convention divergence the
format exists to surface. The `.ore` file states the inputs once, and any engine's
choices become auditable against a conformance suite instead of buried in cell
formulas.

## Gaps observed and deferred (roadmap candidates)

- **Per-lease rollover overrides** (renewal probability, downtime, renewal rent %
  per tenant). This model applied uniform assumptions, so profiles sufficed; other
  shops set them per tenant. Likely shape: optional `lease.rollover` overriding
  profile fields.
- **Estate/multi-building attribution**: per-building cap rates, land areas, and
  returns inside one property. The portfolio roll-up (`computePortfolio`) covers
  the N-files case; a `property.buildings[]` map with a `lease.building` key is
  the single-file version.
- **Yield-on-cost outputs** (stabilized NOI ÷ total project cost, trended and
  untrended) — the model's primary return-threshold metrics; computable from
  existing fields, worth adding to `computeAll` outputs.
- **Growth compounding convention** — a `growthCompounding: "monthly" | "annual"`
  switch on `marketAssumptions` would remove the largest benign source of
  out-year drift.
- **Terminal marketing/reversion period** (the model carries a 24-month terminal
  reversion window) — not modeled; document-only for now.
