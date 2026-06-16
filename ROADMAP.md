# ORE Roadmap

**Sequencing (decided 2026-06-10, see `docs/decisions/2026-06-10-demo-first-sequencing.md`):**
schema → demo shell + golden outputs → thin calc kernel → validator CLI → real case
study → hardened reference engine. The demo is the first customer of the engine;
the goal of the next milestone is the 30-second "I can see the deal" moment, not a
perfect institutional DCF.

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
- [x] Browser demo shell: drag a `.ore` file → tabs for summary, rent roll,
      expenses, assumptions, valuation, computed outputs, and warnings
      (`/demo/index.html`, static, no backend; light editing follows post-v0.1)
- [x] Multi-file portfolio roll-up: drop several `.ore` files → totals, per-deal
      comparison, blended returns, lease expiration schedule, top tenants,
      combined cash flows (`computePortfolio` in the engine, locked by a
      portfolio golden)
- [x] Live refresh: the viewer watches loaded files and re-reads on change
      (~2s), plus a manual refresh — edit the `.ore` in any tool, save, see it
- [x] Thin calc kernel — shipped, then retired by the reference engine (which
      kept its interface and its warnings-first design)
- [x] Golden output files locked for all examples (`npm run golden`)
- [ ] Validator CLI works (`npx @ore-format/cli validate deal.ore`) — packages the
      demo loader's checks as `validate` / `summarize` / `compute`
- [ ] One real (anonymized) deal run end-to-end as the case study: source summary,
      anonymized `.ore`, computed outputs, memo (what mapped cleanly, what was
      ambiguous, what required human review)
- [x] Hardened reference engine (TypeScript, `engine/src/`) replaces the kernel:
      MG base-year/stop recoveries, true two-branch rollover, TI/LC split,
      general-vacancy de-dup, debt schedule, levered/unlevered IRR, NOI bridge,
      annual cash flows, sensitivity grid; goldens consciously re-locked
- [x] `llms.txt`: the spec, data dictionary, and an annotated example published as
      a single LLM-ingestible document, generated from source (`npm run llms`)
- [x] README leads with a viewer screenshot/GIF
- [x] README, CONTRIBUTING, GOVERNANCE, ROADMAP, LICENSE in place

## v0.1 scope (deliberate constraints)

US industrial only; NNN/NN/modified gross leases; simple debt sizing only. The
valuation schema carries inputs for all four approaches — DCF (with terminal value
method options), direct capitalization (with stabilized/mark-to-market bases and
near-term cost deductions), sales comparison, and cost — while the v0.1 reference
engine computes DCF and direct cap; sales comparison and cost travel as structured
disclosure until engine support lands. Out of scope for v0.1: retail percentage
rent, office complex reimbursement pools, hotel, multifamily unit-level,
international conventions, debt waterfalls.

**Field-level coverage and the v0.2 gap backlog** — what the format represents and
what the engine actually computes, element by element — live in
[`spec/coverage.md`](spec/coverage.md), the single source of truth for "is *X*
supported?". The headline v0.2 priorities from that audit: honor tenant options in
the engine (a silent overvaluation bug today), controllable-expense caps, expense
gross-up, property-tax reassessment on sale, actual MG base-year, dated capital
expenditures, and reserving the property→building→suite→lease hierarchy field names
(the one change with a clock on it — see the coverage doc's open-decisions section).

## After v0.1

Strategy for the AI and Excel tracks: `docs/design/llm-and-excel.md`.

**AI / agents**
- MCP server (`@ore-format/mcp`) wrapping the reference engine: `validate`,
  `run_valuation`, `cash_flows`, `compare` — LLMs do judgment, the engine does
  arithmetic
- Optional producer-stated summary block (claimed NOI / value), explicitly
  non-authoritative and engine-verifiable, so validators flag files whose claims
  don't reproduce

**Excel** ("your model, ORE's data")
- `ore export-xlsx`: typed, named tables under a documented ORE Excel Layout
  convention (retrofit the house model once, every deal file plugs in); published
  Power Query snippet for zero-install ingestion
- Excel add-in (`@ore-format/excel`) embedding the TypeScript engine via Office.js:
  open/validate/edit/save `.ore` in place, engine outputs as custom functions
- Non-goal: a formula-based reference workbook (a second engine breaks conformance)

**Format & ecosystem**
- Python port of the reference engine
- Viewer light editing (assumption tweaks, re-run, download)
- Engine support for sales comparison and cost approach outputs
- Additional asset classes, starting with the simplest lease structures first
- Formal governance (technical steering committee), then consortium/foundation home
