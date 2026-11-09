# ORE — Open Real Estate Format

**An open, JSON-based file format for commercial real estate underwriting data, and
an open-source reference engine that computes it.**

> Deal data should belong to the deal, not to any software license.

[![Try an example deal](https://img.shields.io/badge/Try_an_example_deal-0b5fff?style=for-the-badge)](https://graham1776.github.io/Open-Real-Estate/demo/?example=multi-tenant-infill)
[![Open the viewer](https://img.shields.io/badge/Open_the_viewer-1a2433?style=for-the-badge)](https://graham1776.github.io/Open-Real-Estate/demo/)
[![Project home](https://img.shields.io/badge/Project_home-5b6b80?style=for-the-badge)](https://graham1776.github.io/Open-Real-Estate/)

![The ORE viewer: drop a .ore file and see the deal — summary, rent roll, computed DCF, returns, and warnings — in seconds, entirely in the browser.](docs/images/viewer-demo.gif)

<p align="center"><em>Drop a <code>.ore</code> file into the <a href="https://graham1776.github.io/Open-Real-Estate/demo/">viewer</a> and the whole deal renders — property, rent roll, NOI, DCF, returns, sensitivity — with zero re-keying. No install, no upload, no license.</em></p>

## The problem

Every CRE transaction moves the same underlying data — rent rolls, lease abstracts,
operating histories, underwriting assumptions — between brokers, buyers, and
appraisers. Today that data travels in formats that force manual re-keying at every
hand-off. Errors compound, hours evaporate, and no two parties can verify they are
computing the same NOI from the same inputs.

## What ORE is

1. **A published file format** (`.ore`, standard JSON) with a versioned JSON Schema
   anyone can implement, free forever. Machine-readable by design, LLM-native, with
   calculation assumptions traveling *with* the data — one self-contained file per deal.
2. **A reference calculation engine** (TypeScript) producing standardized outputs —
   NOI, cash flows, DCF, direct cap, debt, IRR, sensitivity — so any conforming
   implementation reproduces identical results from the same file. Auditable math,
   line by line.

The model is PDF, not a software product: any tool can produce the format, any tool
can consume it, and no one owns it.

## See it in 30 seconds

**In the browser:** open the [viewer](https://graham1776.github.io/Open-Real-Estate/demo/)
and click *Try an example deal*. Nothing to install, nothing uploaded.

**Locally:**

```bash
git clone https://github.com/graham1776/Open-Real-Estate.git
cd Open-Real-Estate
npm install        # ajv, for schema validation
npm run demo       # opens the viewer at http://localhost:8080/demo/
```

Then drag any file from [`examples/`](examples/) onto the page. (The viewer is a
static page with no backend — your deal file never leaves your machine.)

Prefer the terminal? A `.ore` file is just JSON:

```bash
cat examples/single-tenant-nnn.ore | jq .property.name
npm run cli -- summarize examples/single-tenant-nnn.ore   # occupancy, WALT, NOI, value, returns
npm run cli -- compute examples/single-tenant-nnn.ore | jq .returns
npm test           # builds the engine, validates examples, reproduces golden outputs
```

**In Excel:** open [`excel/ORE-Workbook.xlsm`](excel/) and click *Import .ore
file*, or run `npm run cli -- excel examples/multi-tenant-infill.ore`. You get a
printable deal summary, rent roll, cash flow and valuation, computed by native
Excel formulas that reproduce the reference engine, with a Check sheet showing
the two side by side. See [`excel/README.md`](excel/README.md).

## What a `.ore` file carries

One JSON document, seven modules — `property` and `rentRoll` required, the rest
optional so a file carries exactly what its producer knows:

| Module | Holds |
|---|---|
| `property` | Identity, location, type, physicals (SF, unit count, clear height, docks, power) |
| `rentRoll` | Leases with stepped rent, escalations, NNN/NN/MG/Gross, free rent, TI/LC, options; vacant suites |
| `expenses` | Operating expenses with recoverability flags and growth |
| `marketAssumptions` | Market rent, growth curves, downtime, renewal probability, market TI/LC |
| `valuation` | DCF, direct cap, sales comparison, cost — assumptions travel with the data |
| `debt` | Optional loan terms for levered returns |
| `provenance` | Who produced the file, when, from what sources |

Full field-by-field reference: the [spec](spec/README.md) and
[data dictionary](spec/data-dictionary.md). For LLMs and agents, the entire format
is published as a single ingestible document: [`llms.txt`](llms.txt).

## Status

**v0.1 feature-complete; looking for collaborators.** ORE is meant for every commercial property type. The format accepts any of them today; the engine is deepest on industrial, where the examples started, and names what it does not yet model for other types in each file's warnings. Coverage by type: [`spec/coverage.md`](spec/coverage.md). See [ROADMAP.md](ROADMAP.md).

| Component | Where | State |
|---|---|---|
| Format spec & JSON Schema | [`spec/`](spec/) | All v0.1 modules drafted |
| Reference engine (TypeScript) | [`engine/`](engine/) | Working: full cash model, valuation, debt, returns, sensitivity; goldens locked (`npm test`) |
| Viewer / demo | [`demo/`](demo/) | Working: drag `.ore` files → deal view or multi-file portfolio roll-up; watches files for live refresh; click any value to change it, see outputs move, and save the file back (`npm run demo`) |
| Example deal files | [`examples/`](examples/) | Seven examples, all validating (`npm run validate`), one structured on a real underwrite and [benchmarked against an institutional model](docs/design/institutional-model-benchmark.md) |
| LLM ingestible spec | [`llms.txt`](llms.txt) | Published |
| Validator CLI | [`validator/`](validator/) | Working: `validate` / `summarize` / `compute` / `tape` / `excel` (`npm run cli -- validate examples`) |
| Excel workbook | [`excel/`](excel/) | Working: reader sheets + engine in native formulas; matches the engine on every example and stress fixture (`npm run excel:test`); Import button in the `.xlsm` |
| Documentation site | [`docs/`](docs/) | Decision and design notes; site not started |

## Why the math is open too

A format alone would let every tool disagree about NOI. ORE ships a reference engine
whose outputs are **locked by golden files** — every example deal has expected
outputs checked into the repo, and conformance means reproducing them exactly. The
engine also treats uncertainty as a feature: when a file is ambiguous or the engine
estimates something, it says so in a first-class `warnings` output rather than
projecting false precision.

From one `.ore` file, the engine produces the full underwriting — direct cap and DCF
walks, levered/unlevered returns, an annual cash flow table, and a sensitivity grid:

![ORE engine outputs: direct cap and DCF walks, IRR and equity multiples, annual cash flows, and a discount-rate-by-exit-cap sensitivity grid, all computed from the deal file.](docs/images/viewer-outputs.png)

## Contributing

Issues and PRs welcome — edge-case arguments are a feature; they harden the spec.
See [CONTRIBUTING.md](CONTRIBUTING.md) and [GOVERNANCE.md](GOVERNANCE.md).

## License

[Apache 2.0](LICENSE).
