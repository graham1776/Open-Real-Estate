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
      (`/demo/index.html`, static, no backend)
- [x] Viewer editing (reader → writer, first cut): Edit JSON tab — edit the
      file's original text, Apply re-validates and recomputes, Save writes back
      in place through the file handle (Chrome/Edge) with Save As… / download
      everywhere else; unsaved edits pause the watcher; malformed files open
      straight into the editor for repair
- [x] Multi-file portfolio roll-up: drop several `.ore` files → totals, per-deal
      comparison, blended returns, lease expiration schedule, top tenants,
      combined cash flows (`computePortfolio` in the engine, locked by a
      portfolio golden)
- [x] Live refresh: the viewer watches loaded files and re-reads on change
      (~2s), plus a manual refresh — edit the `.ore` in any tool, save, see it
- [x] Thin calc kernel — shipped, then retired by the reference engine (which
      kept its interface and its warnings-first design)
- [x] Golden output files locked for all examples (`npm run golden`)
- [x] Validator CLI works (`validator/cli.mjs`, package `@ore-format/cli`) —
      packages the demo loader's checks as `validate` / `summarize` / `compute`;
      npm publish (for `npx @ore-format/cli ...`) deferred until first release
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

**Writer track** (reader → writer; raw-JSON editing shipped in the viewer — the
items below are the rest of what "ORE files get *authored*, not just exchanged"
implies, roughly in build order)
- Structured quick-edit: form controls for the high-leverage assumptions
  (discount rate, exit cap, market rent, growth, renewal probability, purchase
  price) with instant recompute — the what-if loop analysts actually run; raw
  JSON stays the escape hatch for everything else
- What-if delta view: after an edit, show outputs against the pre-edit baseline
  (value / IRR / Year-1 NOI, side by side) so the price of an assumption is
  visible the moment it changes
- New deal in the browser: a "New deal" button that scaffolds a minimal valid
  file from a template (single-tenant NNN first) — ORE as authoring tool, not
  just interchange; pairs with `ore init` below
- Provenance on save: how does an edited file disclose who changed it? Candidate:
  the editor appends an entry (producer, date, tool) to a provenance history on
  save — needs a small schema decision, since v0.1 provenance describes a single
  producer (v0.2 candidate, alongside the coverage-doc backlog)
- CLI writer verbs in `@ore-format/cli`: `ore init` (scaffold from template),
  `ore set <path>=<value> deal.ore` (scripted single-field edits, validated
  before write), `ore fmt` (canonical formatting for clean git diffs) — the same
  writer story for scripts, CI, and agents
- Schema-aware forms (the endgame): generate the full editor UI from the JSON
  Schema itself, so every field is editable with types, enums, and units
  enforced — and third-party tools can do the same trick

**Format & ecosystem**
- Python port of the reference engine
- Engine support for sales comparison and cost approach outputs
- Additional asset classes, starting with the simplest lease structures first
- Formal governance (technical steering committee), then consortium/foundation home
