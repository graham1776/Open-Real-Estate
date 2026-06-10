# ORE Specification

ORE (Open Real Estate) is an open, JSON-based file format for property-level
underwriting data. A `.ore` file is standard JSON — `cat deal.ore | jq` just works —
validated against the published JSON Schema in [`schema/`](schema/).

- Current format version: **0.1.0** (pre-release, unstable until tagged)
- Schema dialect: JSON Schema draft 2020-12
- v0.1 scope: US industrial (single- and multi-tenant), DCF and direct capitalization

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

- **Dates** are ISO 8601 (`YYYY-MM-DD`) strings.
- **Money** is USD. Per-SF rent units are declared explicitly per lease via
  `baseRent.unit` — never inferred from market convention.
- **Percentages** are expressed as percent values (`3.5` = 3.5%), except ratios
  documented as decimals (e.g. `coverageRatio`).
- **Areas** are square feet; **land** is acres.
- Calculation assumptions travel with the data so any conforming engine reproduces
  identical outputs from the same file.

## Documents

- [`data-dictionary.md`](data-dictionary.md) — every field defined, typed, and documented
- `schema/` — the normative JSON Schema files

Where a field corresponds to a concept in an existing open standard (NCREIF PREA
Reporting Standards, REDI), the data dictionary notes the mapping.
