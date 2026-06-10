# ORE Roadmap

## v0.1 — definition of done

- [x] JSON Schema drafted and documented (all v0.1 modules; data dictionary complete)
  - [x] `property` module (draft)
  - [x] `rentRoll` / `leases[]` module (draft)
  - [x] `expenses` module (draft)
  - [x] `marketAssumptions` module (draft)
  - [x] `valuation` module (draft)
  - [x] `debt` module (draft; optional, simple loan terms)
  - [x] `provenance` module (draft)
- [x] Three example deal files validate against the schema (`npm run validate`)
  - [x] Single-tenant NNN (all modules populated)
  - [x] Multi-tenant infill (NNN / MG base-year / CPI mix, one vacant suite)
  - [x] Value-add with rollover (below-market single tenant, DCF-only, IO bridge debt)
- [ ] Reference engine (TypeScript) reproduces golden outputs for all examples
- [ ] Validator CLI works (`npx @ore-format/cli validate deal.ore`)
- [ ] Browser demo: drag file → rendered DCF, cash flows, returns
- [x] README, CONTRIBUTING, GOVERNANCE, ROADMAP, LICENSE in place
- [ ] One real (anonymized) deal run end-to-end as the case study

## v0.1 scope (deliberate constraints)

US industrial only; NNN/NN/modified gross leases; DCF and direct capitalization;
simple debt sizing only. Out of scope for v0.1: retail percentage rent, office
complex reimbursement pools, hotel, multifamily unit-level, international
conventions, debt waterfalls.

## After v0.1

- Python port of the reference engine
- Sales comparison approach
- Additional asset classes, starting with the simplest lease structures first
- Formal governance (technical steering committee), then consortium/foundation home
