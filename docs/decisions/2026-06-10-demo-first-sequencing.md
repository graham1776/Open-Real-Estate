# Demo-first sequencing

Date: 2026-06-10. Status: adopted (founder review of the v0.1 spec milestone).

## Decision

Resequence the build so the drag-and-drop viewer/demo ships **before** the hardened
reference engine, with a thin calculation kernel as the demo's first engine and
golden output files locked from day one.

Old sequence: schema → reference engine → validator CLI → browser demo → docs →
real case study.

New sequence: **schema → demo shell + golden outputs → thin calc kernel →
validator CLI → real case study → hardened reference engine.**

## Rationale

The next milestone's goal is not a perfect institutional DCF engine — it is the
"aha" moment: drop a `.ore` file and immediately see the property summary, rent
roll, occupancy, market rent gap, expenses, valuation assumptions, computed
outputs, and warnings, without re-keying anything. The biggest project risk is
spending months on a complete engine before proving that experience. The most
valuable artifact is a working demo that makes the standard obvious in 30 seconds.

## Consequences

1. **`/engine/kernel.mjs`** — a deliberately thin, dependency-free calc kernel
   (occupancy, in-place rent, weighted average rent, market rent gap, simplified
   NOI, direct cap with adjustments, simplified monthly DCF). The demo imports it
   directly, so logic is never duplicated. It is the seed of the reference engine,
   which replaces it function-by-function under golden-file discipline.
2. **Golden outputs now** — `engine/golden/*.golden.json`, one per example, narrow
   outputs, locked by `npm run golden`. Any change to computed outputs must
   reproduce the goldens or consciously re-lock them (`npm run golden:update`)
   with justification.
3. **Warnings are a first-class output.** The kernel names every simplification it
   applied to the file at hand (zero MG recoveries, expected-value rollover
   blending, unapplied adjustments, etc.), and the demo gives warnings their own
   tab. CRE practitioners know data is messy; a format that admits uncertainty is
   more credible than one that pretends precision.
4. **Validator CLI moves after the demo loader** — the browser loader surfaces
   practical validation issues first; the CLI then packages the same logic
   (`validate`, `summarize`, `compute`).
5. **The real anonymized case study moves earlier** (before the hardened engine):
   synthetic examples prove schema coverage; a real messy deal proves usefulness.
   Structure: source summary, anonymized `.ore`, computed output JSON, memo on
   what mapped cleanly / what was ambiguous / what required human review.
6. **README leads with the viewer** once a screenshot/GIF exists — the reader
   should feel "I can see the deal" before reading about schema modules.
