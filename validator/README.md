# ORE Validator CLI

`@ore-format/cli` — check, summarize, and compute `.ore` files from the shell.
It packages the same checks the browser viewer runs: JSON Schema validation
(against [`/spec/schema`](../spec/schema)) plus the reference engine's
structural lint, with full engine outputs one command away.

```bash
# from the repo root, after `npm install`
npm run cli -- validate examples            # or: node validator/cli.mjs validate examples
npm run cli -- summarize examples/single-tenant-nnn.ore
npm run cli -- compute examples/single-tenant-nnn.ore | jq .returns
```

## Commands

| Command | Does | Exit code |
|---|---|---|
| `validate <file.ore \| dir> [...]` | JSON parse → schema validation → structural lint, per file. `advice`-level notes print but don't fail. | 0 all pass, 1 any fail |
| `summarize <file.ore> [...] [--json]` | Key metrics per deal: building, occupancy, WALT and near-term roll, in-place vs market rent, Year 1 / stabilized NOI, direct cap and DCF values, concluded value, returns. | 0, or 1 if a file fails validation |
| `compute <file.ore>` | The full reference-engine output (`computeAll`) as JSON — cash flows, NOI bridge, valuations, debt, returns, sensitivity, warnings. Pipe to `jq`. | 0, or 1 if the file fails validation |

`ore --version` prints CLI and engine versions; `ore help` prints usage.

## Packaging status

The package is not yet published to npm (planned usage:
`npx @ore-format/cli validate deal.ore`, via the `ore` bin) — tracked in
[#39](https://github.com/graham1776/Open-Real-Estate/issues/39). In-repo it reads
schemas from `../spec/schema` and the engine from `../engine/dist`; publishing
will bundle both so the CLI is self-contained. Until then, run it from a clone
as shown above.
