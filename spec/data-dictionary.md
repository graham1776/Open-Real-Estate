# ORE Data Dictionary — v0.1 (draft)

Normative definitions live in the JSON Schema files under [`schema/`](schema/); this
dictionary restates them for human readers and adds interpretation guidance. Fields
are listed as JSON paths from the file root. **(R)** marks required fields.

## Root

| Field | Type | Definition |
|---|---|---|
| `formatVersion` **(R)** | string | ORE format version (semver). `0.1.x` files validate against the 0.1.0 schema. |
| `property` **(R)** | object | Property module — see below. |
| `rentRoll` **(R)** | object | Rent roll module — see below. |
| `expenses`, `marketAssumptions`, `valuation`, `debt`, `provenance` | object | Accepted but not yet specified; schemas land before v0.1.0 is tagged. |

## `property`

| Field | Type | Definition |
|---|---|---|
| `name` **(R)** | string | Display name of the property. |
| `propertyType` **(R)** | `"industrial"` | Asset class. v0.1 is industrial-only. |
| `propertySubtype` | enum | `warehouse_distribution`, `manufacturing`, `flex`, `cold_storage`, `truck_terminal`, `industrial_outdoor_storage`, `other`. |
| `tenancy` | enum | `single` or `multi`, as currently operated. |
| `description` | string | Free-text narrative. |
| `notes` | string | Measurement conventions, entitlements, anything needed to interpret the module. |

### `property.address` **(R)**

| Field | Type | Definition |
|---|---|---|
| `street1` **(R)** | string | Primary street address line. |
| `street2` | string | Secondary line (suite, building). |
| `city` **(R)** | string | City. |
| `state` **(R)** | string | Two-letter USPS code, e.g. `CA`. |
| `postalCode` **(R)** | string | 5-digit ZIP or ZIP+4. |
| `county` | string | County name, without the word "County". |
| `country` | `"US"` | v0.1 is US-only. |

### `property.location`

| Field | Type | Definition |
|---|---|---|
| `latitude` / `longitude` | number | WGS 84 decimal degrees. |
| `market` | string | Metro market, e.g. "Los Angeles". |
| `submarket` | string | Submarket, e.g. "San Gabriel Valley". |

### `property.parcels[]`

| Field | Type | Definition |
|---|---|---|
| `apn` **(R)** | string | Assessor's parcel number as it appears on the assessor roll. |
| `landAcres` | number | Land area of the parcel, acres. |
| `zoning` | string | Zoning designation, e.g. `M-1`. |

`property.siteAreaAcres` (number) is the total site area; when `parcels[].landAcres`
are provided it should equal their sum.

### `property.physical` **(R)**

| Field | Type | Definition |
|---|---|---|
| `buildingSF` **(R)** | number | Total rentable building area, SF. Default denominator for per-SF metrics and pro-rata shares. |
| `officeSF` | number | Office build-out, SF, included within `buildingSF`. |
| `mezzanineSF` | number | Mezzanine area, SF. |
| `clearHeightFt` | number | Minimum clear height, feet, at the first interior column line. |
| `dockHighDoors` | integer | Dock-high door count. |
| `gradeLevelDoors` | integer | Grade-level (drive-in) door count. |
| `railServed` | boolean | Active rail service. |
| `yearBuilt` / `yearRenovated` | integer | Calendar years. |
| `stories` | integer | Default 1. |
| `construction` | enum | `tilt_up`, `masonry`, `metal`, `wood_frame`, `other`. |
| `sprinkler` | enum | `esfr`, `wet`, `dry`, `none`. |
| `powerAmps` | number | Electrical service, amps. |
| `powerVolts` | string | Voltage/phase, e.g. "277/480V 3-phase". |
| `truckCourtDepthFt` | number | Truck court depth, feet, at primary loading. |
| `trailerParkingStalls` / `autoParkingStalls` | integer | Stall counts. |
| `coverageRatio` | number (decimal) | Building footprint ÷ site area, e.g. `0.45`. |
| `fencedYard` | boolean | Secured yard present. |
| `yardAcres` | number | Usable yard area, acres, when a meaningful component of value. |

## `rentRoll`

| Field | Type | Definition |
|---|---|---|
| `asOfDate` **(R)** | date | Date the rent roll was struck. All leases and vacancies reflect this date. |
| `leases` **(R)** | array | All leases in place. Empty array = fully vacant building. |
| `vacantSuites[]` | array | Vacant space available for lease-up: `suite`, `sf` **(R)**, `spaceType` (keys into `marketAssumptions.marketRent`), `notes`. |
| `notes` | string | Rent-roll-level notes (estoppel status, pending amendments). |

### `rentRoll.leases[]`

| Field | Type | Definition |
|---|---|---|
| `leaseId` **(R)** | string | Stable identifier, unique within the file. |
| `tenant` **(R)** | object | `name` **(R)**, `dba`, `parentCompany`, `industry`, `creditNotes`. |
| `suite` | string | Suite/unit identifier; optional for single-tenant. |
| `leasedSF` **(R)** | number | Leased area, SF. Denominator for per-SF rent; numerator for pro-rata share. |
| `commencementDate` **(R)** | date | Lease commencement. |
| `expirationDate` **(R)** | date | Current expiration, reflecting executed amendments and exercised options. |
| `baseRent` **(R)** | object | Stepped rent schedule — see below. |
| `escalation` | object | Rule generating steps beyond the enumerated schedule — see below. |
| `reimbursement` **(R)** | object | Expense recovery structure — see below. |
| `freeRent[]` | array | Remaining abatement periods: `startDate` **(R)**, `endDate` **(R)** (inclusive), `percentAbated` (default 100), `abatesReimbursements` (default false). |
| `tenantImprovements` | object | Unfunded TI: exactly one of `amountPerSF` or `totalAmount`; optional `fundingDate` (engines default to the month after `asOfDate`). |
| `leasingCommissions` | object | Unpaid LCs: exactly one of `amountPerSF`, `totalAmount`, or `percentOfTotalRent`; optional `fundingDate`. |
| `options[]` | array | Tenant options — see below. |
| `securityDeposit` | object | `amount` **(R)** (USD), `form` (`cash` or `letter_of_credit`). |
| `guarantor` | string | Guarantor name, if any. |
| `notes` | string | Anything a re-underwriter must know that structured fields cannot carry. |

### `lease.baseRent`

Contractual base rent as a stepped schedule. Each step applies from its `startDate`
until the next step's `startDate`, or until `expirationDate` for the last step.
Steps are in ascending date order; steps before `asOfDate` may be omitted.

| Field | Type | Definition |
|---|---|---|
| `unit` **(R)** | enum | `perSFPerMonth`, `perSFPerYear`, `totalPerMonth`, `totalPerYear`. Applies to every `amount` in the schedule. Per-SF units are multiplied by `leasedSF`; annual units divided by 12 for monthly cash flows. |
| `schedule[]` **(R)** | array | Steps of `{ startDate, amount }`, min 1. |

> **Why an explicit unit?** Industrial rents are quoted per-SF-per-month in some
> markets and per-SF-per-year in others. ORE never infers the convention — the file
> states it, so every engine computes the same cash flow.

### `lease.escalation`

Rule for generating rent steps **not** enumerated in `baseRent.schedule`. If the
schedule enumerates every step through expiration, omit this or use type `none`.
When present, engines apply the rule starting one frequency-interval after the last
enumerated step's `startDate`, through expiration. Enumerated steps are always
authoritative over generated ones.

| Field | Type | Definition |
|---|---|---|
| `type` **(R)** | enum | `fixed_percent`, `fixed_amount`, `cpi`, `none`. |
| `rate` | number | Percent per interval (required for `fixed_percent`), e.g. `3.5`. |
| `amount` | number | Amount per interval in `baseRent.unit` (required for `fixed_amount`). |
| `frequencyMonths` | integer | Months between escalations, default 12. |
| `cpiFloorPercent` / `cpiCapPercent` | number | CPI collar per interval (`cpi` only). Engines use the CPI growth assumption from `marketAssumptions`. |

### `lease.reimbursement`

| Field | Type | Definition |
|---|---|---|
| `structure` **(R)** | enum | `NNN` — tenant reimburses pro-rata share of all recoverable expenses. `NN` — as NNN, except landlord retains roof/structure. `MG` — tenant reimburses increases over a base year or expense stop. `Gross` — no reimbursement. |
| `proRataSharePercent` | number | Tenant's share, percent. Defaults to `leasedSF / property.physical.buildingSF × 100`. |
| `baseYear` | integer | MG base year (provide this **or** `expenseStopPerSF`, not both). |
| `expenseStopPerSF` | number | MG expense stop, USD/SF/yr. |
| `adminFeePercent` | number | Admin/management markup on recoveries, percent. |
| `excludedExpenses[]` | string[] | `expenseId`s this lease excludes from recovery, overriding expense-level flags. |

### `lease.options[]`

| Field | Type | Definition |
|---|---|---|
| `type` **(R)** | enum | `renewal`, `termination`, `purchase`, `expansion`, `right_of_first_refusal`, `right_of_first_offer`. Renewal options carry modelable economics; the rest are disclosed for diligence. |
| `noticeMonths` | number | Required notice before the option date. |
| `earliestExerciseDate` | date | Earliest effective date. |
| `renewalTermMonths` | integer | Renewal term length (renewal only). |
| `renewalCount` | integer | Successive renewals on these terms, default 1. |
| `rentBasis` | enum | `market`, `fixed`, `percent_of_market`. |
| `fixedRent` | number | Renewal rent in the lease's `baseRent.unit` (when `fixed`). |
| `percentOfMarket` | number | E.g. `95` (when `percent_of_market`). |
| `terminationFee` | number | USD payable on exercise (termination only). |
| `notes` | string | Terms structured fields cannot carry. |

## Standards mappings

Mappings to NCREIF PREA Reporting Standards and REDI field definitions will be added
field-by-field as the `expenses` and `valuation` modules are specified, since most
overlap (NOI composition, expense categories) lives there.
