# ORE Reference Engine

TypeScript reference implementation of the ORE calculation methodology. Pure
functions, zero runtime dependencies; compiles to ESM that runs identically in
Node and the browser (the demo imports `dist/` directly).

```bash
npm run build    # tsc -p engine  ->  engine/dist/
npm test         # build + schema validation + golden reproduction
```

## What it computes

- Monthly cash model: contractual rent steps and escalations (fixed %, fixed
  amount, CPI with collar), free rent (including reimbursement abatement),
  NNN/NN pro-rata recoveries, **MG base-year / expense-stop recoveries**
  (base year estimated by deflating current expenses when actuals are absent —
  disclosed via warning), per-lease expense exclusions
- Rollover: true two-branch renewal/new-tenant blending (memoized), with
  branch-correct downtime, free rent, and split TI/LC; vacant-suite lease-up
- General vacancy de-duplicated against explicit modeled downtime; credit loss
- Valuation: direct capitalization (five NOI bases, near-term deductions at
  face or PV, mark-to-market, lump-sum adjustments) and DCF (four terminal
  value methods, mid/end period, monthly/annual timing, unfunded free-rent
  obligations deducted at exit)
- Debt: amortization schedule with IO period, DSCR, levered cash flows
- Returns: unlevered/levered IRR, NPV vs price, equity multiples
- Annual cash flow table, year-1 NOI bridge, 5×5 sensitivity grid
  (discount rate × exit cap)
- **Warnings as a first-class output**: every estimate or simplification
  applied to the file at hand is named

## Conformance

Golden outputs for every example are locked in `golden/`:

```bash
npm run golden          # check examples against goldens
npm run golden:update   # consciously re-lock after a methodology change
```

A conforming third-party implementation reproduces the golden outputs exactly.
Methodology changes must re-lock goldens with justification in the commit.

Planned package: `@ore-format/engine`. Layout: `src/` TypeScript sources,
`dist/` committed build output (so the zero-build demo and static hosting
work), `golden/` locked outputs + harness.
