# ORE in Excel

Two workbooks that read any `.ore` file and compute it with native Excel formulas
that reproduce the reference engine.

| File | Use it when |
|---|---|
| [`ORE-Workbook.xlsm`](ORE-Workbook.xlsm) | You want an **Import .ore file** button. Macro-enabled. |
| [`ORE-Workbook.xlsx`](ORE-Workbook.xlsx) | Macros are blocked where you work. Load deals with `ore excel` or by pasting a tape. |

Both are the same workbook; the `.xlsm` adds a small VBA module
([`vba/ORE.bas`](vba/ORE.bas)) that reads a file and writes the Tape. Neither
needs an add-in, a reference library, or a network connection.

## Loading a deal

**Import button (.xlsm).** Open the workbook, enable macros, click *Import .ore
file* on Start Here, pick a file. The Tape is replaced and every sheet
recalculates. *Save Tape as .ore* writes the Tape back out as a `.ore` file, so a
deal edited in the Tape round-trips. Works on Windows and Mac; a workbook
downloaded from the web may need right-click > Properties > Unblock before Excel
will run its macros.

**Command line.** `ore excel deal.ore` writes `deal.xlsx`, a copy of the workbook
with the deal loaded and the reference engine's outputs alongside (use
`-o deal.xlsm` for the macro version). Excel recalculates on open; in Protected
View, click *Enable Editing* to see values.

```bash
npm run cli -- excel examples/multi-tenant-infill.ore -o garvey.xlsx
```

**Paste a tape.** `ore tape deal.ore --engine` prints the tape as tab-separated
text. Paste it at `Tape!A1` (header row included) with *Paste Special > Text*, so
dates and IDs stay text.

## What is in the workbook

| Sheet | Contents |
|---|---|
| Start Here | Load buttons, status, legend, capacity |
| Summary | One page: property, rent roll statistics, income, value, returns, provenance |
| Rent Roll | Lease abstract, leases then vacancies: dates, SF, rent today, escalation, reimbursement, free rent, renewal option, unfunded TI/LC |
| Expenses | The expense schedule as stated |
| Assumptions | Growth, leasing profiles, valuation and debt inputs as stated |
| Annual CF | Annual cash flow over the hold, and the year-1 NOI bridge |
| Valuation | Direct cap and DCF walks, debt, returns, sensitivity grid, lease metrics |
| Check | Every engine output beside the workbook's own, PASS/FAIL |
| Tape | The file, one row per value. The only input |
| Data, SpaceParams, SpaceCalc, ExpCalc, MonthlyCF | The engine, in formulas |

The five reader sheets print cleanly (landscape where wide, print areas sized to
the deal). Blue text is input (the Tape); black is formula.

## The tape

A lossless, two-column flattening of the file, the shape every route agrees on:

```
path                                         value
property.name                                Garvey Industrial Park
property.physical.buildingSF                 78400
rentRoll.leases[0].leaseId                   L-100
rentRoll.leases[0].baseRent.schedule[0].amount  1.31
valuation.dcf.terminalValue.deductUnfundedObligations  TRUE
$engine.noi.year1NOI                         1017853
```

- One row per leaf value, in document order.
- Object keys join with `.`; array positions are `[i]`, zero-based.
- Values keep their JSON type (number, text, TRUE/FALSE). `null` is an empty cell;
  an empty array or object is the text `[]` or `{}`.
- Optional reference-engine outputs follow under `$engine.`, which is what the
  Check sheet compares against.

Defined in [`validator/tape.mjs`](../validator/tape.mjs) and implemented again in
the VBA module; `test_macro.py` holds the two to the same output.

## The math

The calculation sheets mirror the reference engine
([`engine/src/index.ts`](../engine/src/index.ts)) line for line: in-place
contract rent with stepped schedules and fixed, fixed-amount, and CPI escalations;
free rent, including partial and reimbursement-abating periods; NNN/NN pro-rata
recoveries, admin fees, exclusions, expense caps (all three bases), MG base-year
and expense-stop recoveries; property-tax reassessment; general vacancy
de-duplicated against modeled downtime; credit loss; management fee with its
recovery gross-up; direct cap (all NOI bases, near-term deductions, mark-to-market,
adjustments); DCF (monthly or annual timing, end or mid period, all four
terminal-value methods); debt; IRR, NPV, multiples; the sensitivity grid; WALT and
lease roll.

The engine's rollover tree (renewal vs. new tenant at every expiration, recursively)
is computed as an expected-value recurrence on SpaceCalc: one row of rollover-event
probability mass per space, from which every rent, free-rent, occupancy, TI and LC
stream follows by convolution. It is the same expectation the engine computes by
recursion, so any space's numbers can be traced month by month.

Where the engine does something specific, the workbook does the same thing: the
engine rounds the terminal value and net loan proceeds to the dollar before reusing
them in returns, and it rounds with JavaScript's `Math.round` (halves toward +∞),
not Excel's `ROUND`. Both are mirrored, and commented where they occur.

### How "always matches" is enforced

```bash
npm run excel:test
```

recalculates the workbook in LibreOffice for every example deal plus four stress
fixtures ([`fixtures/`](fixtures/), built to reach every branch: fee-simple
basis, expense stops, non-cumulative caps, CPI and MG market profiles, annual
mid-period discounting, every exit method, and more) and requires every Check row
to pass. Today: 10 files, 1,818 outputs, all passing. Two land on a `PASS*`: the
unrounded values agree to 1e-14 but sit exactly on a half-unit, where spreadsheet
and JavaScript floating point round to neighbouring cents. The Check sheet labels
those rather than hiding them.

It also runs the VBA importer headless against every file (the Tape it writes must
equal `ore tape` row for row, and *Save Tape as .ore* must reproduce the original
JSON), and builds each workbook through `ore excel` to test the shipped path.

**Any change to engine methodology must change `build_workbook.py` in the same
pull request**, with `npm run excel:test` passing, or the two will diverge. That
cost is deliberate: see
[`docs/decisions/2026-11-06-excel-workbook.md`](../docs/decisions/2026-11-06-excel-workbook.md).

### Not in the workbook

- **Warnings.** The engine's disclosures (estimates applied, simplifications) stay
  in the engine: `ore compute deal.ore | jq .warnings`.
- **Portfolio roll-up.** One deal per workbook; the viewer and `computePortfolio`
  combine deals.

## Linking your own model

The point is to stop re-keying, not to replace your model. Link your house model to
this workbook once and every deal loads into the same addresses:

- Reader sheets have fixed layouts (Rent Roll row 6 onward is always lease 1, 2, ...
  then vacancies).
- Key outputs are workbook names: `OCC_SF`, `OCC_PCT`, `RENT_IP_ANNUAL`,
  `RENT_WA_IP`, `RENT_WA_MKT`, `LM_WALT_RENT`, `LM_ROLL_RENT`, `TV_NET`,
  `TOTAL_COST`, `LOAN_AMT`.
- `Data` holds every input as a typed table (scalars, leases, expenses, profiles,
  vacant suites), and `MonthlyCF` every monthly line.

## Capacity

40 leases, 8 vacant suites, 12 rent steps / 4 free-rent periods / 8 expense
exclusions / 4 options per lease, 25 expense items, 8 leasing profiles, 240 months
(hold + 36, so holds up to 17 years), 6,000 tape rows. Start Here and Check flag a
file that exceeds any of these. Capacities are constants at the top of
`build_workbook.py`; raising them and rebuilding is all it takes.

## Building and testing

The workbooks are generated, never edited by hand. Every formula lives in
[`build_workbook.py`](build_workbook.py).

```bash
npm run excel:build    # python3 excel/build_workbook.py && python3 excel/build_xlsm.py
npm run excel:test     # python3 excel/test_workbook.py && python3 excel/test_macro.py
```

Requires Python 3 with `openpyxl`, and LibreOffice with its Python bridge (`uno`)
for the VBA build and the tests. `build_xlsm.py` compiles `vba/ORE.bas` into a VBA
project with LibreOffice and injects it, with the Start Here buttons, into the
generated workbook; Excel compiles the stored source on first open.
`python3 excel/test_workbook.py --via-cli` tests through `ore excel` (slower).

## Status

Verified by recalculation in LibreOffice, which evaluates every formula the
workbook uses. Not yet opened in Microsoft Excel by the maintainers: the first
open on Windows and on Mac (formulas recalculate, Import button runs, nothing
repaired) is the open checklist item before calling this done.
