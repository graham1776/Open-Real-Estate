# ORE — Open Real Estate Format

**An open, JSON-based file format for commercial real estate underwriting data, and
an open-source reference engine that computes it.**

Deal data should belong to the deal, not to any software license.

Every CRE transaction moves the same underlying data — rent rolls, lease abstracts,
operating histories, underwriting assumptions — between brokers, buyers, and
appraisers. Today that data travels in formats that force manual re-keying at every
hand-off. Errors compound, hours evaporate, and no two parties can verify they are
computing the same NOI from the same inputs.

ORE is two things:

1. **A published file format** (`.ore`, standard JSON) with a versioned JSON Schema
   anyone can implement, free forever. Machine-readable by design, LLM-native, with
   calculation assumptions traveling *with* the data.
2. **A reference calculation engine** (TypeScript) producing standardized outputs —
   NOI, DCF, direct cap, sensitivity — so any conforming implementation reproduces
   identical results from the same file. Auditable math, line by line.

The model is PDF, not a software product: any tool can produce the format, any tool
can consume it, and no one owns it.

## Status

**Pre-v0.1.** Current scope: US industrial (single- and multi-tenant), DCF and
direct capitalization. See [ROADMAP.md](ROADMAP.md).

| Component | Where | State |
|---|---|---|
| Format spec & JSON Schema | [`spec/`](spec/) | All v0.1 modules drafted |
| Viewer / demo | [`demo/`](demo/) | Working: drag a `.ore` file → summary, rent roll, outputs, warnings (`npm run demo`) |
| Reference engine (TypeScript) | [`engine/`](engine/) | Working: full cash model, valuation, debt, returns, sensitivity; goldens locked (`npm test`) |
| Example deal files | [`examples/`](examples/) | Three examples, all validating (`npm run validate`) |
| Validator (CLI + browser) | [`validator/`](validator/) | Example-validation script; CLI not started |
| Documentation site | [`docs/`](docs/) | Decision and design notes; site not started |

## A `.ore` file is just JSON

```bash
cat examples/single-tenant-nnn.ore | jq .property.name
```

See the [spec](spec/README.md) and [data dictionary](spec/data-dictionary.md).

## Contributing

Issues and PRs welcome — edge-case arguments are a feature; they harden the spec.
See [CONTRIBUTING.md](CONTRIBUTING.md) and [GOVERNANCE.md](GOVERNANCE.md).

## License

[Apache 2.0](LICENSE).
