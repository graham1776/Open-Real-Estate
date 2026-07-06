# ORE Example Deal Files

Synthetic industrial deal files validating against the v0.1 schema. Run
`npm install && npm run validate` from the repo root to check them.

| File | Profile | What it exercises |
|---|---|---|
| `single-tenant-nnn.ore` | Single-tenant NNN warehouse, SoCal infill | Fixed-percent escalations, renewal option, LTV-sized amortizing debt, year-1 direct cap, forward-year terminal value, all modules |
| `multi-tenant-infill.ore` | Four-suite multi-tenant park, one vacancy | NNN / MG base-year / CPI-collar mix, free rent, vacant-suite lease-up, stabilized direct cap with 18-month near-term deductions and mark-to-market, sales comparison with adjusted comps, reconciliation, unlevered (no debt module) |
| `value-add-rollover.ore` | Below-market single tenant, near-term expiry | Mark-to-market rollover, stepped growth curve, partial-year hold (months), stabilized-at-market terminal value with buyer-assumed costs, deferred-maintenance deduction, cost approach with land comps and depreciation, interest-only bridge debt |
| `corporate-net-lease.ore` | Long-WALE corporate NNN, O'Hare infill | Fully enumerated rent schedule (`escalation: none`) with a mid-term contractual step-DOWN that engines must honor over any escalation rule, letter-of-credit security deposit, percent-of-EGR management fee under full NNN recovery (NOI tracks rent), renewal at 100% FMV, stabilized-at-market exit cap, buyer-underwriting-style rollover friction (12-month downtime, TI/LC) |
| `covered-land-play.ore` | Above-market rent on credit, land-value exit | The reverse mark-to-market: in-place rent ~35% ABOVE market rolling down at expiry, absolute-net lease with NO expenses module, `fixed_value` terminal carrying a residual land-value derivation (FAR x $/buildable-SF grown over hold), hold period in months timed exactly to lease expiration, 95%-of-market renewal option, sales comparison on a `land_sf` unit basis, sublease disclosure via tenant notes |
| `estate-mark-to-market.ore` | Seven-building, 1.15M SF multi-tenant estate, deep loss-to-lease | 25 leases with per-tenant escalation rates and mid-lease review anniversaries (schedule-step anchoring), three market-rent tiers mapped via `leases[].spaceType`, a signed-not-yet-commenced lease-up carrying its negotiated terms, 120-month monthly DCF with a stabilized-at-market terminal cap — extracted from and benchmarked against a live institutional buyer model (`docs/design/institutional-model-benchmark.md`) |

These files double as the engine's golden-file inputs. All data is synthetic; no
confidential deal information. `corporate-net-lease.ore` and
`covered-land-play.ore` are patterned on the assumption *structure* of a real
institutional buyer's acquisition underwriting (contract rent schedules, terminal
value methodology, rollover friction), with every name, location, date, and
figure fictionalized — which is why their conventions read like a live deal
model rather than a textbook. `estate-mark-to-market.ore` goes further: it was
extracted from a real buyer's Excel underwriting model with the economics
preserved and every name, address, and tenant identity fictionalized, then
benchmarked against that model's own outputs (headline IRR within one basis
point — the comparison and the conventions that differ are documented in
`docs/design/institutional-model-benchmark.md`). Each `.ore` file is a single
self-contained JSON document — every module travels in the one file.
