# ORE Example Deal Files

Synthetic industrial deal files validating against the v0.1 schema. Run
`npm install && npm run validate` from the repo root to check them.

| File | Profile | What it exercises |
|---|---|---|
| `single-tenant-nnn.ore` | Single-tenant NNN warehouse, SoCal infill | Fixed-percent escalations, renewal option, LTV-sized amortizing debt, year-1 direct cap, forward-year terminal value, all modules |
| `multi-tenant-infill.ore` | Four-suite multi-tenant park, one vacancy | NNN / MG base-year / CPI-collar mix, free rent, vacant-suite lease-up, stabilized direct cap with 18-month near-term deductions and mark-to-market, sales comparison with adjusted comps, reconciliation, unlevered (no debt module) |
| `value-add-rollover.ore` | Below-market single tenant, near-term expiry | Mark-to-market rollover, stepped growth curve, partial-year hold (months), stabilized-at-market terminal value with buyer-assumed costs, deferred-maintenance deduction, cost approach with land comps and depreciation, interest-only bridge debt |

These files double as the engine's golden-file inputs. All data is synthetic; no
confidential deal information. Each `.ore` file is a single self-contained JSON
document — every module travels in the one file.
