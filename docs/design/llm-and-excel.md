# Design note: LLMs and Excel

Date: 2026-06-10. Status: adopted direction; sequencing in ROADMAP.md.

ORE meets users where they already work. Two environments dominate: AI assistants
(LLMs) and Excel. They pull the design in opposite directions — LLMs want the file
itself to be maximally legible; Excel wants the data without the math — and ORE has
a deliberate answer for each.

## LLMs

**Standing principle: the file is the prompt; the engine is the calculator.** LLMs
reason over deal data in language; arithmetic is delegated to a conforming engine.
Three modes, designed for separately:

### 1. LLM as cold reader (no engine present)

Someone drops a `.ore` file into a chat assistant and asks it to underwrite the
deal — the same workflow people use today with OM PDFs, except the file is a few
tens of KB of typed, self-describing JSON instead of dozens of pages of layout
noise. Format rules that make cold reads work:

- Field names are spelled out, never abbreviated (`renewalProbabilityPercent`).
- Units are embedded in names (`clearHeightFt`, `amountPerSF`, `...Percent`) or
  declared explicitly in-file (`baseRent.unit`) — never inferred from convention.
- Enums are readable words, not codes. `notes` fields sit alongside structure so
  human nuance travels with the data.
- Files may carry a root `$schema` URL pointing at the published JSON Schema, so
  any reader — human, tool, or LLM — can resolve field definitions from the file
  alone.

Accepted limitation: a cold-reading LLM doing its own arithmetic on a multi-year
monthly DCF will get it wrong. That is not a format problem; it is the reason the
engine exists, and the reason for mode 2.

### 2. LLM + engine (the intended division of labor)

The engine becomes available to AI assistants as an **MCP server**
(`@ore-format/mcp`, post-engine) exposing tools such as `validate`,
`run_valuation`, `cash_flows`, and `compare`. The LLM handles judgment — are these
assumptions aggressive, where is the rollover exposure — and calls the engine for
deterministic numbers. Because the engine is a pure TypeScript library, the MCP
wrapper is thin.

The file deliberately carries **inputs only**; outputs are always one engine call
away. A possible later addition is an optional producer-stated summary block
(claimed Year-1 NOI, value conclusion), explicitly non-authoritative and
engine-verifiable, so validators can flag files whose claims don't reproduce —
the same "stated for self-checking" pattern the valuation module already uses.
Deferred until there is an engine to verify against.

### 3. LLM as author (agent-to-agent exchange)

LLMs and agents will author `.ore` files to send deal data to each other. An LLM
author is simply a producer like any other, and the project is already built for
unreliable producers:

- **Schema validation** gates malformed output.
- **The engine** gates incoherent output (numbers that don't compute).
- **Provenance** discloses authorship: `provenance.software` identifies an
  authoring agent; `generatedBy.role` identifies whose interest it serves.

Cheap, high-leverage enabler: publish the spec as a single LLM-ingestible document
(the `llms.txt` convention — concatenated spec, data dictionary, and an annotated
example), so any model in any tool can be handed the complete format definition in
one paste. This doubles as the LLM authoring guide.

## Excel

**Standing principle: your model, ORE's data.** Every shop has a house model it
trusts; the pain ORE solves in Excel is re-keying, not a missing DCF. ORE therefore
ships data *into* Excel rather than competing with the workbook.

### Tier 1 — standard export, zero install

`ore export-xlsx deal.ore` (CLI command and a button in the viewer/demo) produces a
workbook of typed, named tables — `ore_RentRoll`, `ore_Expenses`,
`ore_LeasingProfiles`, `ore_Valuation`, etc. — under a small documented **ORE Excel
Layout** convention (sheet and table names, column order, units columns).

The naming convention is the point: a shop retrofits its house model once to
reference the standard tables, and every subsequent deal file plugs into their
model with zero re-keying. A published Power Query (M) snippet additionally lets
shops pull `.ore` JSON directly with no ORE tooling installed at all.

### Tier 2 — Excel add-in bundling the reference engine

Office.js add-ins run JavaScript, so the TypeScript reference engine runs **inside
Excel unmodified**. The add-in (`@ore-format/excel`, post-engine):

- opens, validates, edits, and saves `.ore` files in place; and
- exposes real engine outputs as custom functions (`=ORE.NOI(1)`, `=ORE.IRR()`,
  `=ORE.VALUE("direct_cap")`) and an optional rendered outputs sheet.

This delivers "the logic natively in Excel" with exactly one engine in existence —
the same auditable code running in the browser demo, Node, agents (via MCP), and
Excel. No formula re-implementation, no divergence, no parity tax.

### Tier 1b — the ORE Workbook (adopted 2026-11-06)

*This replaces the original "explicit non-goal" of a formula workbook; see
`docs/decisions/2026-11-06-excel-workbook.md`.*

A generated workbook (`excel/ORE-Workbook.xlsx` / `.xlsm`) reads any `.ore` file
through a path/value **tape** into printable reader sheets, and computes the deal
with native formulas that mirror the reference engine. A Check sheet places every
workbook output beside the engine's. The parity risk the original note raised is
handled by enforcement rather than avoidance: `npm run excel:test` recalculates the
workbook for every example and stress fixture and fails on any difference, and a
methodology change to the engine must update the workbook generator in the same
pull request. The engine remains the reference; the workbook conforms to it.

## Sequencing

1. **v0.1 (with the spec):** root `$schema` field; LLM-legibility rules enforced in
   schema review; `llms.txt` published with the docs.
2. **Engine ships:** MCP server (`@ore-format/mcp`) and Excel export are the first
   two consumers after the browser demo. Excel export shipped as the ORE Workbook
   (`ore excel`, `ore tape`, and an Import button) in November 2026; a Power Query
   snippet remains open.
3. **Later:** Excel add-in with embedded engine; optional producer-stated summary
   block once the engine can verify it.
