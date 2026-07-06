# ORE Roadmap

**Where next steps live (decided 2026-07-06):** actionable work is tracked in
**[GitHub issues](https://github.com/graham1776/Open-Real-Estate/issues)** — one
issue per chunk (schema change + engine change + example + golden re-lock + PR).
This file is the milestone view: what shipped, what the current milestone is, and
which issues belong to which track. [`spec/coverage.md`](spec/coverage.md) is the
**scope matrix** — what the format can represent and what the engine computes,
element by element, each open gap linking to its issue. Neither document carries
its own private backlog anymore; if it's worth doing, it has an issue number.

**Sequencing (decided 2026-06-10, see `docs/decisions/2026-06-10-demo-first-sequencing.md`):**
schema → demo shell + golden outputs → thin calc kernel → validator CLI → real case
study → hardened reference engine. The demo is the first customer of the engine.

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
      — grown to six, including two patterned on real buyer underwriting and one
      extracted from a live institutional model
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
      npm publish tracked in [#39](https://github.com/graham1776/Open-Real-Estate/issues/39)
- [x] One real (anonymized) deal run end-to-end as the case study: a live
      institutional buyer's Excel model (seven-building industrial estate)
      extracted to [`examples/estate-mark-to-market.ore`](examples/estate-mark-to-market.ore)
      and benchmarked line-by-line against the source model's own outputs —
      what mapped cleanly, what the format gained, where conventions diverge:
      [`docs/design/institutional-model-benchmark.md`](docs/design/institutional-model-benchmark.md)
- [x] Hardened reference engine (TypeScript, `engine/src/`) replaces the kernel:
      MG base-year/stop recoveries, true two-branch rollover, TI/LC split,
      general-vacancy de-dup, debt schedule, levered/unlevered IRR, NOI bridge,
      annual cash flows, sensitivity grid; goldens consciously re-locked
- [x] `llms.txt`: the spec, data dictionary, and an annotated example published as
      a single LLM-ingestible document, generated from source (`npm run llms`)
- [x] README leads with a viewer screenshot/GIF
- [x] README, CONTRIBUTING, GOVERNANCE, ROADMAP, LICENSE in place

**v0.1 scope (deliberate constraints):** US industrial only; NNN/NN/modified gross
leases; simple debt sizing only. The valuation schema carries inputs for all four
approaches while the engine computes DCF and direct cap ([#38](https://github.com/graham1776/Open-Real-Estate/issues/38)
adds the other two). Out of scope for v0.1: retail percentage rent, office complex
reimbursement pools, hotel, multifamily unit-level, international conventions,
debt waterfalls.

## v0.2 — make ORE's NOI agree with a real underwrite

The theme, derived from the coverage audit and the institutional-model benchmark:
close every gap likely to make ORE visibly disagree with a buyer's model on an
ordinary industrial deal. Ordered by credibility risk:

| Issue | Item |
|---|---|
| [#22](https://github.com/graham1776/Open-Real-Estate/issues/22) | **G8 — reserve the property→building→suite→lease hierarchy field names** (the one item with a clock) |
| [#13](https://github.com/graham1776/Open-Real-Estate/issues/13) | IRR compounding convention governed by the spec |
| [#28](https://github.com/graham1776/Open-Real-Estate/issues/28) | Growth compounding convention (monthly vs annual) declarable |
| [#20](https://github.com/graham1776/Open-Real-Estate/issues/20) | G3 — expense gross-up to occupancy |
| [#21](https://github.com/graham1776/Open-Real-Estate/issues/21) | G6 — one-time / dated capital expenditures |
| [#26](https://github.com/graham1776/Open-Real-Estate/issues/26) | Per-lease rollover overrides (renewal prob / downtime / vacate per tenant) |
| [#15](https://github.com/graham1776/Open-Real-Estate/issues/15) | Dual SF basis: contract RBA vs market-lettable SF |
| [#23](https://github.com/graham1776/Open-Real-Estate/issues/23) | G9 — ground-lease payment stream; parking / IOS other income |
| [#24](https://github.com/graham1776/Open-Real-Estate/issues/24) | G10 — gross vs net rentable area + measurement standard |
| [#27](https://github.com/graham1776/Open-Real-Estate/issues/27) | Yield-on-cost engine outputs (trended / untrended) |
| [#14](https://github.com/graham1776/Open-Real-Estate/issues/14) | Land-residual terminal value method |
| [#25](https://github.com/graham1776/Open-Real-Estate/issues/25) | G12 — `life_science` subtype; ORE→REDI crosswalk |
| [#29](https://github.com/graham1776/Open-Real-Estate/issues/29) | Producer-stated summary block, engine-verifiable |
| [#30](https://github.com/graham1776/Open-Real-Estate/issues/30) | Provenance history on save |
| [#16](https://github.com/graham1776/Open-Real-Estate/issues/16) / [#17](https://github.com/graham1776/Open-Real-Estate/issues/17) | Portfolio/transaction container · structured subleases (spec discussions) |

## Tracks beyond the format (post-v0.1, any order)

Strategy for the AI and Excel tracks: `docs/design/llm-and-excel.md`.

| Track | Issues |
|---|---|
| **Release / packaging** | [#39](https://github.com/graham1776/Open-Real-Estate/issues/39) npm publish (`@ore-format/cli`, `@ore-format/engine`) — gates the MCP server and Excel add-in |
| **AI / agents** | [#31](https://github.com/graham1776/Open-Real-Estate/issues/31) MCP server (`@ore-format/mcp`) |
| **Excel** ("your model, ORE's data") | [#32](https://github.com/graham1776/Open-Real-Estate/issues/32) `ore export-xlsx` + ORE Excel Layout + Power Query · [#33](https://github.com/graham1776/Open-Real-Estate/issues/33) Excel add-in with embedded engine. Non-goal, permanent: a formula-based reference workbook (a second engine breaks conformance) |
| **Writer** (reader → author) | [#34](https://github.com/graham1776/Open-Real-Estate/issues/34) viewer quick-edit + what-if delta · [#35](https://github.com/graham1776/Open-Real-Estate/issues/35) new-deal scaffolding + `ore init/set/fmt` · [#36](https://github.com/graham1776/Open-Real-Estate/issues/36) schema-aware forms (endgame) |
| **Ecosystem** | [#37](https://github.com/graham1776/Open-Real-Estate/issues/37) Python port (goldens as the conformance test) · [#38](https://github.com/graham1776/Open-Real-Estate/issues/38) sales-comparison + cost-approach engine outputs · [#40](https://github.com/graham1776/Open-Real-Estate/issues/40) documentation site + schema `$id` hosting |

**Not tracked as issues** (strategy, not build work — see `CLAUDE.md` §7):
additional asset classes after industrial, design partners, conference circuit,
REDI outreach, advisory board, governance formalization (technical steering
committee, then consortium/foundation home).
