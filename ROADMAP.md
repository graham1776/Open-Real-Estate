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
- [ ] Browser demo: drag file → rendered DCF, cash flows, returns. Read-first
      viewer with tabs per module (the "reader" anyone can open a deal file with);
      light editing (change an assumption → outputs update → download the edited
      file) follows post-v0.1
- [ ] `llms.txt`: the spec, data dictionary, and an annotated example published as
      a single LLM-ingestible document (see `docs/design/llm-and-excel.md`)
- [x] README, CONTRIBUTING, GOVERNANCE, ROADMAP, LICENSE in place
- [ ] One real (anonymized) deal run end-to-end as the case study

## v0.1 scope (deliberate constraints)

US industrial only; NNN/NN/modified gross leases; simple debt sizing only. The
valuation schema carries inputs for all four approaches — DCF (with terminal value
method options), direct capitalization (with stabilized/mark-to-market bases and
near-term cost deductions), sales comparison, and cost — while the v0.1 reference
engine computes DCF and direct cap; sales comparison and cost travel as structured
disclosure until engine support lands. Out of scope for v0.1: retail percentage
rent, office complex reimbursement pools, hotel, multifamily unit-level,
international conventions, debt waterfalls.

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
