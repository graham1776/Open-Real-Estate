# ORE Data Dictionary — v0.1 (draft)

Normative definitions live in the JSON Schema files under [`schema/`](schema/); this
dictionary restates them for human readers and adds interpretation guidance. Fields
are listed as JSON paths from the file root. **(R)** marks required fields.

## Root

| Field | Type | Definition |
|---|---|---|
| `$schema` | uri | Optional URL of the published ORE JSON Schema the file conforms to. Carrying it lets any reader — editor, validator, or LLM — resolve field definitions from the file alone. |
| `formatVersion` **(R)** | string | ORE format version (semver). `0.1.x` files validate against the 0.1.0 schema. |
| `property` **(R)** | object | Property module — see below. |
| `rentRoll` **(R)** | object | Rent roll module — see below. |
| `expenses` | object | Expenses module — see below. |
| `marketAssumptions` | object | Market assumptions module — see below. |
| `valuation` | object | Valuation module — see below. |
| `debt` | object | Optional debt module — see below. |
| `provenance` | object | Provenance module — see below. |

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
| `baseYearExpenseAmount` | number | Actual building-level annual recoverable expenses in the base year. Optional companion to `baseYear`; when present the engine uses it as the MG base instead of deflating current expenses (removes the estimate warning). |
| `expenseStopPerSF` | number | MG expense stop, USD/SF/yr. |
| `adminFeePercent` | number | Admin/management markup on recoverable expenses, percent. The engine adds it as additional recovery income on top of the tenant's recoverable-expense share (e.g. `15` = the tenant reimburses 115% of its share). |
| `expenseCap` | object | Annual cap on growth of the tenant’s recoverable **controllable** expenses (NNN/NN): `capPercent` **(R)**, `basis` (`cumulative_compounded` default / `cumulative` / `non_cumulative`), optional `baseYearControllableAmount` (else the controllable level at analysis start is the base). Non-controllable expenses are uncapped. |
| `excludedExpenses[]` | string[] | `expenseId`s this lease excludes from recovery, overriding expense-level flags. |

### `lease.options[]`

The reference engine models **renewal** options: at the lease's expiry the renewal
branch of rollover uses the option's stated rent (`fixed` or `percent_of_market`,
capped at market — a rational tenant won't renew above market) and `renewalTermMonths`,
instead of the generic market-leasing assumptions. A `market`-basis renewal stays on
the generic path. Renewal *probability* remains the market profile's
`renewalProbabilityPercent`; when an option is below market the engine warns that real
exercise is likely higher. termination/expansion/purchase/ROFR/ROFO are carried for
diligence and do not yet affect cash flows.

| Field | Type | Definition |
|---|---|---|
| `type` **(R)** | enum | `renewal`, `termination`, `purchase`, `expansion`, `right_of_first_refusal`, `right_of_first_offer`. Renewal options carry modelable economics (above); the rest are disclosed for diligence. |
| `noticeMonths` | number | Required notice before the option date. |
| `earliestExerciseDate` | date | Earliest effective date. |
| `renewalTermMonths` | integer | Renewal term length (renewal only). |
| `renewalCount` | integer | Successive renewals on these terms, default 1. |
| `rentBasis` | enum | `market`, `fixed`, `percent_of_market`. |
| `fixedRent` | number | Renewal rent in the lease's `baseRent.unit` (when `fixed`). |
| `percentOfMarket` | number | E.g. `95` (when `percent_of_market`). |
| `terminationFee` | number | USD payable on exercise (termination only). |
| `notes` | string | Terms structured fields cannot carry. |

## `expenses`

Operating expense schedule. Amounts are annualized as of `rentRoll.asOfDate` and grow
per `marketAssumptions.growth.expenses` unless an item carries its own override.

| Field | Type | Definition |
|---|---|---|
| `items[]` **(R)** | array | Expense items — see below. Min 1. |
| `notes` | string | Schedule-level notes (source statements, normalization adjustments). |

### `expenses.items[]`

| Field | Type | Definition |
|---|---|---|
| `expenseId` **(R)** | string | Stable identifier, unique within the file. Referenced by `lease.reimbursement.excludedExpenses`. |
| `name` **(R)** | string | Display name, e.g. "Real Estate Taxes". |
| `category` | enum | `real_estate_taxes`, `insurance`, `cam`, `repairs_maintenance`, `utilities`, `management_fee`, `administrative`, `reserves`, `other`. For cross-file comparability and standards mapping. |
| `amount` **(R)** | number | Annual amount in `amountUnit`, as of `rentRoll.asOfDate`. |
| `amountUnit` **(R)** | enum | `totalPerYear` (USD/yr), `perSFPerYear` (USD per `buildingSF` per yr), `percentOfEGR` (percent of effective gross revenue — the conventional management fee basis; `amount` is the percent value, e.g. `2.5`). |
| `recoverable` **(R)** | boolean | Recoverable from tenants, subject to each lease's reimbursement structure and exclusions. |
| `controllable` | boolean | Whether the item is a controllable expense (cap-eligible). Default by category when omitted: taxes/insurance/utilities non-controllable, all else controllable. Only matters with a lease `expenseCap`. |
| `belowTheLine` | boolean | Excluded from NOI but included in cash flow (conventionally capital reserves). Default false. |
| `growthOverridePercent` | number | Item-specific annual growth, percent. No effect on `percentOfEGR` items, which float with revenue. |

## `marketAssumptions`

| Field | Type | Definition |
|---|---|---|
| `asOfDate` | date | When the assumptions were struck. Defaults to `rentRoll.asOfDate`. |
| `growth` **(R)** | object | `marketRent` **(R)**, `expenses` **(R)**, `cpi` — each a growth curve (below). `cpi` required if any lease escalates on CPI. |
| `generalVacancyPercent` | number | Percent of potential gross revenue, in addition to explicit downtime. Engines must not double-count downtime months. Default 0. |
| `creditLossPercent` | number | Percent of scheduled revenue. Default 0. |
| `marketLeasing` **(R)** | map | Leasing profiles keyed by space type (min 1) — see below. Keys are matched by `vacantSuites[].spaceType` and by leases at rollover. |

**Growth curve:** either a flat annual rate in percent (`3.0`), or a stepped array of
`{ fromYear, annualPercent }` where `fromYear` is the 1-based analysis year and each
entry applies until the next. The first entry must have `fromYear: 1`. Growth
compounds annually on each anniversary of the analysis start.

### `marketAssumptions.marketLeasing.<spaceType>`

At each lease expiration, engines blend the renewal and new-tenant outcomes by
`renewalProbabilityPercent`.

| Field | Type | Definition |
|---|---|---|
| `marketRent` **(R)** | object | `amount` **(R)** + `unit` **(R)** (`perSFPerMonth` or `perSFPerYear`). As of `asOfDate`, grown by `growth.marketRent` thereafter. |
| `termMonths` **(R)** | integer | Market lease term. |
| `escalation` | object | Same shape as `lease.escalation`. Defaults to none. |
| `reimbursementStructure` | enum | `NNN` (default), `NN`, `MG`, `Gross`. MG market leases use the first calendar year of the new lease as base year. |
| `downtimeMonths` **(R)** | number | Vacant months before a new-tenant lease commences. Not applied to renewals. |
| `renewalProbabilityPercent` **(R)** | number | 0–100. 100 disables new-tenant outcomes; 0 disables renewals. |
| `newTenant` / `renewal` | object | Leasing costs per outcome: `tiPerSF`, `lcPercentOfRent`, `freeRentMonths` — all default 0. |
| `renewalRentPercentOfMarket` | number | Renewal rent as percent of market, default 100. |

## `valuation`

Carries inputs for all four approaches: income (DCF and direct capitalization),
sales comparison, and cost. Each method listed in `methods` requires its parameter
object. Reference engine v0.1 computes DCF and direct cap; sales comparison and cost
inputs travel as structured, auditable disclosure until engine support lands.

| Field | Type | Definition |
|---|---|---|
| `analysisStartDate` **(R)** | date | First day of analysis month 1; conventionally `rentRoll.asOfDate`. All growth, downtime, and discounting measure from here. |
| `valueDate` | date | Effective date of value if different (retrospective/prospective). |
| `interestAppraised` | enum | `leased_fee` (default — subject to in-place leases), `fee_simple` (unencumbered: engines value as if every lease rolled to market at analysis start), `leasehold`. |
| `valuePremise` | enum | `as_is` (default), `as_stabilized`, `as_complete` — state assumed dates/conditions in notes. |
| `purpose` | enum | `acquisition`, `disposition`, `financing`, `appraisal`, `internal`, `other`. |
| `methods` **(R)** | array | Any of `dcf`, `direct_cap`, `sales_comparison`, `cost` (min 1, unique). |
| `purchasePrice` | number | USD. When present, engines report IRR/NPV against it; when absent, concluded value only. |
| `acquisitionCostsPercent` | number | Closing costs, percent of price, added to initial outflow. Default 0. |
| `taxReassessment` | object | Opt-in property-tax reassessment on transfer (Prop 13). `effectiveTaxRatePercent` (else derived from current tax ÷ price), `reassessOnAcquisition` (default true — tax resets to price × rate from analysis start), `reassessAtReversion` (default true — terminal cap loaded by the tax rate so the exit reflects the buyer’s reassessment to sale price), `expenseId` (default: the real_estate_taxes item). Needs `purchasePrice`. |
| `reconciliation` | object | Final conclusion across approaches — see below. |

### `valuation.dcf`

| Field | Type | Definition |
|---|---|---|
| `holdPeriodYears` / `holdPeriodMonths` **(R)** | integer | Exactly one. Years (1–30) for calendar holds; months (1–360) for exits timed to lease events. Reversion occurs at the end of the final period. |
| `discountRatePercent` **(R)** | number | Annual rate applied to unlevered operating cash flows. |
| `reversionDiscountRatePercent` | number | Separate rate for the reversion where terminal risk is priced differently. Defaults to `discountRatePercent`. |
| `discountTiming` | enum | `monthly` (default): cash flows at the equivalent monthly rate ((1+r)^(1/12)−1). `annual`: year-end aggregation. Declared so every engine produces the identical NPV. |
| `periodConvention` | enum | `end` (default) or `mid` period discounting (mid is common in appraisal DCF). Reversion always discounts from the end of the final period. |
| `terminalValue` **(R)** | object | How gross reversion value is computed — see below. |

### `valuation.dcf.terminalValue`

| Field | Type | Definition |
|---|---|---|
| `method` **(R)** | enum | `direct_cap`: capitalize terminal NOI. `exit_price_psf`: `exitPricePerSF` × building SF. `fixed_value`: stated value. `grown_purchase_price`: purchase price compounded at `annualAppreciationPercent`. Each method's parameter is conditionally required. |
| `capRatePercent` | number | Terminal cap rate (required for `direct_cap`). |
| `noiBasis` | enum | `forwardYear` (default): the 12 months after sale. `trailingYear`: the 12 months before. `stabilizedAtMarket`: all space at market rent/structure at exit — strips residual below-market leases from terminal NOI (the lease-to-market exit). |
| `deductBelowTheLineItems` | boolean | Capitalize NOI net of reserves. Default false; declared so engines agree. |
| `exitPricePerSF` / `fixedValue` / `annualAppreciationPercent` | number | Parameter for the respective method. |
| `sellingCostsPercent` | number | Percent of gross reversion, default 0. |
| `deductUnfundedObligations` | boolean | Deduct outstanding TI/LC and remaining free rent on leases extending past sale — the buyer-assumed-costs adjustment. Default false. |

### `valuation.directCap`

| Field | Type | Definition |
|---|---|---|
| `capRatePercent` **(R)** | number | Overall capitalization rate. |
| `noiBasis` **(R)** | enum | `year1`: forward 12 months per the full assumption set. `inPlace`: annualized contractual rent less annualized expenses, no rollover or lease-up. `stabilizedAtMarket`: all space at market — the fee-simple / lease-to-market basis, typically paired with `markToMarket` and `nearTermAdjustments` to walk back to as-is leased-fee value. `trailing12` / `custom`: the stated `customNOI` (required for both). |
| `customNOI` | number | Stated annual NOI for `custom`/`trailing12` bases. |
| `applyGeneralVacancy` | boolean | Apply general vacancy / credit loss in the basis NOI. Default true. |
| `deductBelowTheLineItems` | boolean | Capitalize NOI net of reserves. Default false. |
| `excludeExpenseIds[]` | string[] | Expense items excluded from the capped NOI (e.g. owner-specific costs a buyer won't inherit). |
| `nearTermAdjustments` | object | Deduct near-term costs from the capped value — the bridge from stabilized to as-is. `periodMonths` **(R)** (e.g. 18); toggles `includeDowntimeLostRent`, `includeFreeRent`, `includeTI`, `includeLC` (all default true); optional `discountRatePercent` to take deductions at PV instead of face. |
| `markToMarket` | object | Leased-fee adjustment: PV of (contract − market) rent differentials through each lease's expiration, added (above-market) or deducted (below-market). `discountRatePercent` **(R)**. Presence enables it. |
| `adjustments[]` | array | Explicit lump sums: `name` **(R)**, `type` **(R)** (`deduction`/`addition`), `amount` **(R)** (positive USD; type carries the sign), `category` (`deferred_maintenance`, `capital_costs`, `leasing_costs`, `excess_land`, `entitlements`, `other`). |

### `valuation.salesComparison`

| Field | Type | Definition |
|---|---|---|
| `unitBasis` **(R)** | enum | `building_sf` (improved industrial), `land_sf` / `land_acre` (land-driven product, e.g. IOS). |
| `comparables[]` **(R)** | array | Min 1 — see below. |
| `concludedValuePerUnit` **(R)** | number | Concluded value per unit after reconciling the adjusted comps. |
| `indicatedValue` | number | Concluded × subject units; stated so files are self-checking. |

### `valuation.salesComparison.comparables[]`

| Field | Type | Definition |
|---|---|---|
| `salePrice` **(R)** / `saleDate` **(R)** | number / date | Transaction facts. |
| `name`, `address` | — | Comp identification (`street1`, `city`, `state`). |
| `buildingSF`, `landAcres` | number | Size in the relevant basis. |
| `pricePerUnit`, `adjustedPricePerUnit` | number | Unadjusted and post-adjustment unit prices, stated for self-checking. |
| `capRatePercent` | number | Going-in cap at sale — supports cap rate extraction. |
| `occupancyPercentAtSale`, `yearBuilt`, `clearHeightFt`, `condition` | — | Comparability facts. |
| `propertyRights` | enum | Interest conveyed: `fee_simple`, `leased_fee`, `leasehold`. |
| `financingNotes` | string | Non-market financing / conditions-of-sale color. |
| `adjustments[]` | array | `factor` **(R)** from the standard elements of comparison (`property_rights`, `financing`, `conditions_of_sale`, `market_conditions` (time), `location`, `size`, `age_condition`, `clear_height`, `loading`, `site_coverage`, `yard`, `other`), plus exactly one of `percentAdjustment` (signed) or `amountPerUnitAdjustment` (signed USD/unit), and `rationale`. |
| `source` | string | Verification source. |

### `valuation.costApproach`

| Field | Type | Definition |
|---|---|---|
| `landValue` **(R)** | object | Exactly one of `amount` (USD) or `perAcreAmount` (× `siteAreaAcres`); optional `landComparables[]` (`salePrice` **(R)**, `saleDate` **(R)**, `landAcres` **(R)**, `zoning`). |
| `improvements` **(R)** | object | Exactly one of `replacementCostNew` (USD) or `replacementCostNewPerSF` (× `buildingSF`); `costBasis` (`replacement` default / `reproduction`); `costSource` free text; `siteImprovementsCost` (paving, fencing, yard, rail); `indirectCostsPercent`; `entrepreneurialProfitPercent`. |
| `depreciation` | object | `physicalDeteriorationPercent`, `functionalObsolescencePercent` (e.g. inadequate clear height), `externalObsolescencePercent`, plus age-life inputs `effectiveAgeYears` / `economicLifeYears`. Percents apply to RCN + site improvements. |
| `indicatedValue` | number | Land + depreciated improvements (+ profit); stated for self-checking. |

### `valuation.reconciliation`

| Field | Type | Definition |
|---|---|---|
| `concludedValue` **(R)** | number | Final value conclusion, USD. |
| `concludedValuePerSF` | number | Stated for self-checking. |
| `primaryMethod` | enum | Approach given most weight. |
| `exposureTimeMonths` / `marketingTimeMonths` | number | Appraisal context. |

## `debt` (optional)

Single fixed-rate loan; waterfalls and floating rates are out of scope for v0.1.
Size by exactly one of `loanAmount` or `ltvPercent`.

| Field | Type | Definition |
|---|---|---|
| `loanAmount` | number | USD. |
| `ltvPercent` | number | Percent of `valuation.purchasePrice` (which must be present when sizing by LTV). |
| `interestRatePercent` **(R)** | number | Fixed annual rate. |
| `rateType` | `"fixed"` | v0.1 is fixed-only. |
| `termMonths` **(R)** | integer | From `fundingDate`. If shorter than the hold, engines assume payoff refinanced on identical terms. |
| `amortizationMonths` | integer | E.g. 360. Omit for interest-only through the term. |
| `interestOnlyMonths` | integer | IO period before amortization begins. Default 0. |
| `originationFeePercent` | number | Percent of loan amount, deducted from proceeds. Default 0. |
| `fundingDate` | date | Defaults to `analysisStartDate`. |

## `provenance`

| Field | Type | Definition |
|---|---|---|
| `generatedAt` **(R)** | date-time | When the file was produced (ISO 8601 with timezone). |
| `generatedBy` **(R)** | object | `name` **(R)**, `organization`, `role` (`listing_broker`, `buyer`, `appraiser`, `owner`, `lender`, `other`), `email`, `phone`. |
| `software` | object | `name`, `version` of the tool that wrote the file. |
| `sourceDocuments[]` | array | `name` **(R)**, `type` **(R)** (`lease`, `lease_amendment`, `rent_roll`, `operating_statement`, `budget`, `tax_bill`, `offering_memorandum`, `site_plan`, `estoppel`, `other`), `date`, `description`. Listed for diligence; documents do not travel in the file. |
| `contacts[]` | array | `name` **(R)**, `organization`, `role` (free text), `email`, `phone`. |
| `confidentiality` | string | Confidentiality statement or NDA reference. |

## Standards mappings

Mappings to NCREIF PREA Reporting Standards and REDI field definitions will be added
field-by-field, anchored on `expenses.items[].category` and the valuation parameters,
before v0.1.0 is tagged.
