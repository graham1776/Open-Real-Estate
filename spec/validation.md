# Validation rules

JSON Schema checks the shape of one value. The rules below check relationships
across fields. The reference engine implements them in `lint()`. Any conforming
implementation — including a Python port — produces the same results.

A result has:

| Field | Meaning |
|---|---|
| `code` | Rule id from the tables below. This is the conformance id. |
| `severity` | `error` — the file is invalid. `warning` — a default or fallback still produced a result; it does not by itself fail validation. |
| `path` | JSON Pointer (RFC 6901) to the offending value. Omitted only when the whole document is the problem and no pointer applies; `not_object` uses `/`. |
| `message` | Human-readable detail. Wording is not part of the conformance contract. |

Results follow the file: structural checks, then each lease (required fields,
duplicate `leaseId`, `spaceType`, `excludedExpenses`, options, rent steps), then vacant
suites, then duplicate `expenseId`s, then `excludeExpenseIds`, then
`taxReassessment.expenseId`, then unrecognised enum values (in the order of
the [enum table](#enum-values), and within a row in file order), then
warning-level advice. Option fields on a
non-renewal are reported in the order `renewalTermMonths`, `renewalCount`,
`rentBasis`, `fixedRent`, `percentOfMarket`, then `terminationFee` when that
field is present on a non-termination.

Conformance fixtures live in [`engine/golden/invalid/`](../engine/golden/invalid/).
Most are invalid; a fixture whose expected issues are all warnings (e.g.
`space-type-without-profiles`) locks a warning-level rule.
Each `*.ore` file has a sibling `*.lint.json` listing the `code`, `severity`,
and `path` that `lint()` must produce, in order, and nothing else. `schemaValid`
says whether the file also passes JSON Schema. Reference and id rules are
schema-valid on purpose: JSON Schema cannot check them. Option rules are also
expressed as `if`/`then` in the rent-roll schema, the same way `escalation`
requires `rate` or `amount`, so a schema-only check rejects them too.

Omitting `spaceType` is not an error. A space with no `spaceType` uses the
file's first leasing profile. Omitting `taxReassessment.expenseId` is not an
error either: it defaults to the `real_estate_taxes` item.

## Cross-field rules

| Id | Severity | Rule |
|---|---|---|
| `space_type_unknown` | error | A lease or vacant-suite `spaceType` is not a key of `marketAssumptions.leasingProfiles`. |
| `space_type_without_profiles` | warning | A lease or vacant-suite `spaceType` is present but the file has no leasing profiles (`marketAssumptions` omitted). Nothing is priced from it, so it is descriptive only; the file stays valid. |
| `expense_ref_unknown` | error | A string in `reimbursement.excludedExpenses`, `valuation.directCap.excludeExpenseIds`, or `valuation.taxReassessment.expenseId` is not an `expenses.items[].expenseId`. |
| `lease_id_duplicate` | error | `leaseId` repeats an earlier lease. The pointer is the later occurrence. |
| `expense_id_duplicate` | error | `expenseId` repeats an earlier expense item. The pointer is the later occurrence. |
| `option_field_mismatch` | error | A renewal-only field (`renewalTermMonths`, `renewalCount`, `rentBasis`, `fixedRent`, `percentOfMarket`) is set on an option whose `type` is not `renewal`, or `terminationFee` is set on an option whose `type` is not `termination`. |
| `option_rent_incomplete` | error | A renewal option has `rentBasis` `fixed` without `fixedRent`, or `percent_of_market` without `percentOfMarket`. The pointer is the missing field. Not reported when `rentBasis` itself is illegal for the option type. |
| `rent_steps_unordered` | error | A `baseRent.schedule[]` step's `startDate` is not after the latest earlier step's `startDate` (steps must be in strictly ascending order; a repeated date is ambiguous). The pointer is each offending step's `startDate`. The ordering itself is stated in the rent-roll schema and data dictionary; JSON Schema cannot compare array items. |

## Enum values

| Id | Severity | Rule |
|---|---|---|
| `enum_value_unknown` | error | A field below holds a value its schema enum does not list. The message names the snake_case spelling when the value is a camelCase or upper-case form of an allowed value (`NNN` → `nnn`, `perSFPerYear` → `per_sf_per_year`). |

JSON Schema already rejects every unlisted enum value. `lint()` repeats the
check for the enums the engine computes from, because there an unrecognised
value does not stop the arithmetic: it falls through to a default or prices
`NaN`. A reader that runs `lint()` without a schema validator would otherwise
show a wrong number with no error. Descriptive enums (`construction`,
`provenance.generatedBy.role`, and the like) change no number and are left to
the schema.

Fields checked, in result order:

1. `property.propertyType`
2. `rentRoll.leases[].baseRent.unit`
3. `rentRoll.leases[].escalation.type`
4. `rentRoll.leases[].reimbursement.structure`
5. `rentRoll.leases[].reimbursement.expenseCap.basis`
6. `rentRoll.leases[].options[].type`
7. `rentRoll.leases[].options[].rentBasis`
8. `expenses.items[].category`
9. `expenses.items[].amountUnit`
10. `marketAssumptions.leasingProfiles.<key>.marketRent.unit`
11. `marketAssumptions.leasingProfiles.<key>.escalation.type`
12. `marketAssumptions.leasingProfiles.<key>.reimbursementStructure`
13. `valuation.dcf.discountTiming`
14. `valuation.dcf.periodConvention`
15. `valuation.dcf.terminalValue.method`
16. `valuation.dcf.terminalValue.noiBasis`
17. `valuation.directCap.noiBasis`
18. `valuation.directCap.adjustments[].type`

The allowed values are the schema's. The reference engine keeps them in
`COMPUTED_ENUMS`, and the conformance harness fails if any list differs from
the schema enum it mirrors. A field that is absent or `null` is not checked
here; its default applies.

## Structural checks

These predate the cross-field rules. They stay in `lint()` so a file can be checked without a schema validator.

| Id | Severity | Rule |
|---|---|---|
| `not_object` | error | The document is not a JSON object. |
| `missing` | error | `formatVersion`, `property`, `property.physical.buildingSF`, `rentRoll`, `rentRoll.asOfDate`, or a required lease field is absent. |
| `version` | error | `formatVersion` is not `0.1.x`. |
| `advice` | warning | `marketAssumptions` or `valuation` is omitted. The engine can still report what the remaining inputs support. |
