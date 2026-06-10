# ORE Example Deal Files

Synthetic industrial deal files validating against the v0.1 schema. Run
`npm install && npm run validate` from the repo root to check them.

| File | Profile | What it exercises |
|---|---|---|
| `single-tenant-nnn.ore` | Single-tenant NNN warehouse, SoCal infill | Fixed-percent escalations, renewal option, LTV-sized amortizing debt, all modules |
| `multi-tenant-infill.ore` | Four-suite multi-tenant park, one vacancy | NNN / MG base-year / CPI-collar mix, free rent, vacant-suite lease-up, general vacancy, unlevered (no debt module) |
| `value-add-rollover.ore` | Below-market single tenant, near-term expiry | Mark-to-market rollover, stepped growth curve, DCF-only valuation, interest-only bridge debt |

These files double as the engine's golden-file inputs. All data is synthetic; no
confidential deal information. Each `.ore` file is a single self-contained JSON
document — every module travels in the one file.
