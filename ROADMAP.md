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
- [x] Thin calc kernel (`engine/kernel.mjs`): occupancy, in-place rent, WA rent,
      market rent gap, simplified NOI, direct cap with adjustments, simplified DCF
      — with per-file warnings naming every simplification applied
- [x] Golden output files locked for all examples (`npm run golden`)
- [ ] Validator CLI works (`npx @ore-format/cli validate deal.ore`) — packages the
      demo loader's checks as `validate` / `summarize` / `compute`
- [ ] One real (anonymized) deal run end-to-end as the case study: source summary,
      anonymized `.ore`, computed outputs, memo (what mapped cleanly, what was
      ambiguous, what required human review)
- [ ] Hardened reference engine (TypeScript) replaces the kernel
      function-by-function, reproducing or consciously re-locking each golden
- [ ] `llms.txt`: the spec, data dictionary, and an annotated example published as
      a single LLM-ingestible document (see `docs/design/llm-and-excel.md`)
- [ ] README leads with a viewer screenshot/GIF
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
