# ORE Specification

ORE (Open Real Estate) is an open, JSON-based file format for property-level
underwriting data. A `.ore` file is standard JSON — `cat deal.ore | jq` just works —
validated against the published JSON Schema in [`schema/`](schema/), then against
the cross-field rules in [`validation.md`](validation.md).

- Current format version: **0.1.0** (pre-release, unstable until tagged)
- Schema dialect: JSON Schema draft 2020-12
- Scope: US commercial property of any type, DCF and direct capitalization. The reference engine is deepest on industrial; coverage for each property type is in [`coverage.md`](coverage.md)

## Module status

| Module | Schema file | Status |
|---|---|---|
| root | `schema/ore.schema.json` | Draft |
| `property` | `schema/property.schema.json` | Draft |
| `rentRoll` / `leases[]` | `schema/rentRoll.schema.json` | Draft |
| `expenses` | `schema/expenses.schema.json` | Draft |
| `marketAssumptions` | `schema/marketAssumptions.schema.json` | Draft |
| `valuation` | `schema/valuation.schema.json` | Draft |
| `debt` | `schema/debt.schema.json` | Draft |
| `provenance` | `schema/provenance.schema.json` | Draft |

All v0.1 modules are drafted. `property` and `rentRoll` are required in every file;
the rest are optional so a file can carry exactly what its producer knows (e.g. a
broker may omit `valuation` and let the buyer add their own assumptions). A deal is
always a **single self-contained `.ore` file** — modules are sections of one JSON
document, never separate files.

## Conventions

- **A `.ore` file is JSON.** Any JSON parser reads it and any JSON tool works on
  it. The extension says which format the JSON follows; the content is plain
  UTF-8 JSON with no comments or trailing commas. Where a tool refuses an
  unknown extension, name the file `deal.ore.json`: every ORE tool accepts
  both. Serve it as `application/json`.
- **Dates** are ISO 8601 (`YYYY-MM-DD`) strings.
- **Names:** field names are camelCase (`leasedSF`, `discountRatePercent`).
  Enum values are snake_case: lowercase words joined by underscores, with
  acronyms lowercased (`fixed_percent`, `per_sf_per_year`, `percent_of_egr`,
  `nnn`, `dcf`). Digits may follow a word (`year1`, `trailing12`). A value may
  depart from this where it must match an external standard or data format,
  such as the ISO 3166 country code `US`.
- **Self-description:** files may carry a root `$schema` URL pointing at the
  published schema, and field names spell out their units (`clearHeightFt`,
  `...Percent`) — a reader (human, tool, or LLM) should understand a `.ore` file
  cold, with no external lookup. See `docs/design/llm-and-excel.md`.
- **Money** is USD. Per-SF rent units are declared explicitly per lease via
  `baseRent.unit` — never inferred from market convention.
- **Percentages** are expressed as percent values (`3.5` = 3.5%), except ratios
  documented as decimals (e.g. `coverageRatio`).
- **Areas** are square feet; **land** is acres.
- Calculation assumptions travel with the data so any conforming engine reproduces
  identical outputs from the same file.

## Unknown fields and extensions

**A field the schema does not define is an error.** Every object in the schema
is closed (`additionalProperties: false`), so a misspelled or invented field
fails validation instead of being silently ignored. A reader can trust that
every field in a valid file means what the data dictionary says.

**Extensions go in `x-` keys.** Any object except a keyed map may carry extra
keys whose names start with `x-`, with any JSON value. Use them for data the
format has no field for yet: an internal deal code, a CRM id, a note a producer
wants to keep next to the value it describes.

```json
"leases": [{ "leaseId": "L-100", "x-acme-crmId": "T-4471", "...": "..." }]
```

The rules:

- **Readers ignore them.** Validators accept them; engines never read them. An
  `x-` key cannot change any computed number, and the conformance tests check
  this by adding one to every object in every example.
- **Name them after the producer**, `x-<producer>-<name>`, so two producers'
  extensions do not collide.
- **Keep them on save.** A tool that edits a file should write back the `x-`
  keys it read, unchanged.
- **Not in keyed maps.** The keys of `marketAssumptions.leasingProfiles` are
  profile names, so an `x-` key there is rejected; put it inside a profile.
- **Not a way to change the math.** If an extension would need to change how a
  number is computed, it is a format proposal: open an issue.

## Documents

- [`data-dictionary.md`](data-dictionary.md) — every field defined, typed, and documented
- [`validation.md`](validation.md) — cross-field rules (`lint()`): ids, severity, JSON Pointers
- [`coverage.md`](coverage.md) — scope & coverage matrix: what the format represents
  and what the engine computes, by data domain, with the v0.2 gap backlog. The single
  source of truth for "is *X* supported?"
- `schema/` — the normative JSON Schema files
- [`../reference.html`](../reference.html) and [`../llms.txt`](../llms.txt) — the
  entire format (an authoring guide, every field in one table, this spec, the data
  dictionary, validation rules and schemas, plus examples) as one HTML page on the
  project site and as one plain-text document. Both are generated by `npm run llms`
  (`build-llms-txt.mjs`, `field-table.mjs`); regenerate after any spec change.

Where a field corresponds to a concept in an existing open standard (NCREIF PREA
Reporting Standards, REDI), the data dictionary notes the mapping.
