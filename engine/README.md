# ORE Engine

## Today: the thin calc kernel

`kernel.mjs` is a deliberately simplified, dependency-free calculation kernel — the
seed of the reference engine and the demo's math:

- occupancy, in-place rent, weighted-average rent, market rent gap
- simplified NOI (monthly grid, expected-value rollover blending)
- direct capitalization with mark-to-market, near-term cost deductions, and
  lump-sum adjustments
- simplified DCF (all four terminal value methods)
- **warnings as a first-class output**: every simplification applied to the file
  at hand is named (`mg_recovery_zero`, `general_vacancy_simplified`, …)

Golden outputs for every example are locked in `golden/`:

```bash
npm run golden          # check examples against goldens
npm run golden:update   # consciously re-lock after a methodology change
```

## Next: the hardened reference engine

TypeScript, pure functions, zero UI dependency; replaces the kernel
function-by-function and must reproduce (or consciously re-lock, with
justification) each golden. Outputs grow to monthly/annual cash flows, NOI bridge,
unlevered/levered IRR, NPV, per-SF metrics, and sensitivity tables. Conformance
for any third-party implementation is defined by the golden-file suite. Planned
package: `@ore-format/engine`.
