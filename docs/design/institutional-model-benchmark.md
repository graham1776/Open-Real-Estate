# Benchmarking ORE against an institutional underwriting model

*July 2026, revised November 2026. Companion to `examples/estate-mark-to-market.ore`.*

## What this is

A buyer's acquisition model for a multi-building, multi-tenant industrial estate
(roughly two dozen leases, 10-year monthly DCF) was extracted into a single `.ore`
file and run through the reference engine. The engine's outputs were then compared
against the source model's own reported results.

This was the first test of the format against a real institutional model rather
than a synthetic example. It answers three questions: **can the format carry a
real underwrite** (yes, with two small additions shipped alongside this doc),
**does the engine reproduce the model's results** (headline returns within a
basis point; details below), and **where do the methodologies legitimately
differ** (rollover blending, growth compounding, and vacancy conventions).

**About the published example.** The comparison below was run on the original
extraction. Before publication, every identifying element and every figure in
the file was replaced: location, building sizes, rents, escalations, lease dates,
expenses, cap rates, price, and tenants. `examples/estate-mark-to-market.ore`
keeps the *structure* of the underwrite (lease-by-lease rent roll, three market
tiers, uniform rollover friction, a carried lease-up, a stabilized-at-market
exit) and describes no real property or transaction. For that reason this doc
reports differences between engine and source model as percentages only, and the
published file will not reproduce them.

## Headline comparison

| Metric | Engine vs source model | Note |
|---|---|---|
| 10-year unlevered IRR | −1 bp | see "compensating differences" below |
| Year-1 NOI | −0.2% | |
| In-place vs market rent | within 0.5 pts | same market-rent equivalent on both sides |
| Stabilized (market) NOI, today | −2.6% | engine deducts the general vacancy allowance; the model does not |
| Terminal value, gross and net | −1.5% | same vacancy-allowance difference at exit |
| DCF value at the model's discount rate | −1.8% | |

Reconstructing the model's own monthly cash-flow stream (NOI, rollover leasing
costs, terminal) and solving for IRR lands about 3 bps away from the IRR the
model reports, so a few basis points of any comparison are day-count and rounding
noise inside the source model itself.

## Year-by-year NOI

Engine NOI relative to the source model's, by analysis year:

| Year | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| Engine vs model | −0.2% | +0.4% | −1.7% | +0.4% | −2.2% | +1.3% | +4.3% | +9.2% | +5.8% | +11.8% |

Years 1–6, dominated by contractual rent, agree within about 2%. The drift in
years 7–10 is rollover methodology (below), where every model is making
assumptions about leases that do not exist yet. Both models converge again at the
terminal, which each marks to market NOI.

**Compensating differences, stated plainly:** the engine's out-year NOI runs
above the model's while its terminal value runs below (vacancy allowance in
stabilized NOI), and at the model's discount rate these nearly cancel. That is
why the headline IRRs land 1 bp apart. The agreement is real but partly
offsetting; the table above is the honest picture.

## What mapped cleanly (no format changes needed)

- **Per-tenant effective escalation rates** (from flat to well into double
  digits) and mid-lease review anniversaries, via `escalation.fixed_percent` plus
  the schedule-step anchoring pattern now documented in the data dictionary (date
  the last enumerated step one review cycle before the next contractual review).
- **Rollover friction**: market lease term, renewal probability, downtime on new
  deals, and branch-specific costs (free rent, TI, LC for new vs renewal),
  renewals at a percent of market. All native `leasingProfiles` profile fields.
- **The underwritten lease-up** of the one vacant suite, with its negotiated
  rate, free rent, TI, and LC, carried as a signed-not-yet-commenced lease so the
  deal-specific terms travel in the file, with `tenant.creditNotes` disclosing it
  is an assumption, not an executed lease.
- **Estate-level structure**: several buildings under one file, buildings
  identified in `suite`, building SF table in `property.notes`.
- General vacancy, expense and market-rent growth, a fully recoverable NNN
  expense pool with a recoverable management fee, a 120-month monthly DCF, and a
  terminal direct cap on market NOI.

## What this exercise added to the format and engine

1. **`leases[].spaceType`**: the model prices suites at three market-rent tiers.
   Leases previously fell back to the file's first leasing profile; they now key
   into `marketAssumptions.leasingProfiles` exactly like vacant suites.
   Stabilized/market NOI and the market-rent metric are now SF-weighted blends
   across profiles (identical to prior behavior for single-profile files).
2. **Signed-but-not-yet-commenced leases**: the engine now models no rent,
   occupancy, or recoveries before `commencementDate`, and defaults TI/LC funding
   to the commencement month. Real rent rolls carry these constantly; the spec
   text on `commencementDate` now states the behavior.

## Where the math legitimately differs

| Convention | Source model | ORE engine |
|---|---|---|
| Rollover blending | Single blended lease per expiry (probability-weighted downtime, free rent, and TI) | True two-branch expected value (renew vs re-let), recursing through subsequent rollovers |
| Market-rent growth | Compounded monthly | Compounded annually on analysis anniversaries |
| General vacancy | Flat percent of potential base rent, always | Percent of potential gross incl. recoveries, de-duplicated against explicit modeled downtime |
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
  untrended): the model's primary return-threshold metrics; computable from
  existing fields, worth adding to `computeAll` outputs.
- **Growth compounding convention**: a `growthCompounding: "monthly" | "annual"`
  switch on `marketAssumptions` would remove the largest benign source of
  out-year drift.
- **Terminal marketing/reversion period** (the model carries a multi-month
  reversion window): not modeled; document-only for now.
