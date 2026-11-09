# Excel: a formula workbook that conforms to the engine

Date: 2026-11-06. Status: adopted (founder request). Supersedes the "explicit
non-goal" in `docs/design/llm-and-excel.md` (June 2026).

## Decision

Ship an Excel workbook in the repo (`excel/`) that:

1. **reads** any `.ore` file into a standard, printable layout (summary, rent roll,
   expenses, assumptions, annual cash flow, valuation), and
2. **computes** the deal with native Excel formulas that reproduce the reference
   engine's outputs, with a Check sheet that compares the two side by side.

Data enters through one input, the **tape**: the file flattened to path/value
rows. Three routes fill it: an Import button (VBA, in the `.xlsm`), `ore excel`
(writes a loaded copy with engine outputs), and `ore tape` (paste).

## Why reverse the non-goal

The June note declined a formula workbook because a second engine breaks the
conformance story "the moment a rounding mode differs," and maintaining parity is
a permanent tax. Both risks are real. What changed:

- **Analysts live in Excel, today.** The add-in (Tier 2) needs install rights and
  IT review at most shops; a workbook needs neither. An appraiser or a small
  buyer can open a file and see the deal, computed, with no software at all.
- **Parity is testable, so it can be enforced rather than hoped for.** The June
  note itself said such a workbook would be "objectively testable" against the
  goldens. `excel/test_workbook.py` recalculates the workbook for every example
  and stress fixture and fails on any output that differs from the engine; the
  first build reproduced all 1,818 outputs. A rounding-mode difference is exactly
  what the test caught (and what the workbook now mirrors).
- **Auditable math in the medium the audience reads.** "Trust by inspection" is
  stronger when the inspection happens in formulas an analyst already reads.

## Rules that keep it honest

1. **The TypeScript engine stays the reference.** The workbook mirrors it, never
   the other way round. Where they disagree, the workbook is wrong.
2. **One methodology change, one pull request.** A change to `engine/src` that
   moves outputs must update `excel/build_workbook.py` in the same PR, with
   `npm run excel:test` passing. That is the parity tax, paid where it is visible.
3. **Generated, never hand-edited.** Every formula is source in
   `build_workbook.py`; the `.xlsx`/`.xlsm` are build outputs, reviewed as such.
4. **Disclose the boundary.** Engine warnings and the portfolio roll-up stay in
   the engine; the workbook says so on Start Here.

## Still true

- The add-in (`@ore-format/excel`, the engine itself running inside Excel) remains
  on the roadmap. It removes the parity tax entirely for shops that can install
  it; the workbook serves everyone else.
- Third parties may build their own Excel implementations; the goldens and the
  Check sheet's layout make them testable the same way.
