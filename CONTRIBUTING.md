# Contributing to ORE

Thanks for your interest. ORE is pre-v0.1 and moving fast; the most valuable
contributions right now are **real-world edge cases** — lease structures, expense
arrangements, and underwriting conventions the schema cannot yet express cleanly.

## Ways to contribute

- **File an issue** describing a lease or deal structure the format can't represent.
  Anonymize everything; never include identifiable tenant or deal data.
- **Schema PRs:** changes to `spec/schema/` must update the data dictionary
  (`spec/data-dictionary.md`) in the same PR, and must keep every file in
  `examples/` validating.
- **Engine PRs** (once the engine lands): every calculation change must keep the
  golden-file test suite passing, or update the golden files with a clear
  justification in the PR description.

## Ground rules

1. **Positioning discipline.** No contribution — code, docs, comments, examples —
   may name, reference, or imply displacement of any commercial software vendor or
   product. The project does not import, convert, or interoperate with proprietary
   file formats. The case for ORE is affirmative.
2. **No real confidential data.** Example files must be anonymized or synthetic.
3. **Spec changes are deliberate.** Pre-1.0, the maintainer decides; arguments are
   welcome, design-by-committee is not. See [GOVERNANCE.md](GOVERNANCE.md).

## Development

The reference engine is TypeScript (Node ≥ 20). Repo layout is described in the
[README](README.md). Until the engine scaffolding lands, the spec is the active
surface: JSON Schema draft 2020-12, validated examples, documented fields.

## License

By contributing, you agree your contributions are licensed under [Apache 2.0](LICENSE).
