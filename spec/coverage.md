# ORE Coverage & Scope

Single source of truth for **what an ORE file can represent** and **what the
reference engine actually computes** — by data domain, derived from a
first-principles decomposition of a US industrial deal. This document is both the
scope statement (design rationale) and the status checklist; the v0.2 backlog lives
here too, so there is one place to look, not three.

It complements, and does not duplicate, the field-level definitions in
[`data-dictionary.md`](data-dictionary.md) and the normative
[`schema/`](schema/) files. Where a row's status is "Gap," the gap is a deliberate,
tracked decision — not an oversight.

## How to read this

Two **independent** questions are tracked per element, because a field can be in
the spec yet ignored by the engine (or absent from both):

- **Spec** — can a conforming `.ore` file express this today?
  - ✅ yes · ✗ no
- **Engine** — does the v0.1 reference engine use it in a computation?
  - ✅ honored · ◐ partial — simplified or estimated, **disclosed via a `warnings` entry** · ⚠️ **ignored silently** (no warning — the trust risk) · — not applicable (informational field, no cash-flow effect)

**Target** marks intended work: blank = complete; `v0.2` = prioritized; `v0.x` =
later; `scope` = deliberately out of v0.1's charter (US industrial, simple
structures). **Standard** notes an external definition to align with where one
exists.

> The most important column is **Engine = ⚠️**: the spec advertises the field, a
> producer reasonably assumes it is handled, and it is not. These erode the
> "same inputs → same NOI" guarantee and are the highest-priority fixes.

---

## 1. Asset identity & legal

| Element | Spec | Engine | Target | Standard / notes |
|---|---|---|---|---|
| Name, situs address, market/submarket, lat-long | ✅ | — | | |
| Parcels / APNs / zoning (per parcel) | ✅ | — | | |
| Asset type / industrial subtype | ✅ | ✅ | | |
| Owner / title-holding entity (SPE) | ✗ | — | v0.2 | provenance names the *producer*, not the owner; map to REDI asset-ownership fields |
| Ground-lease vs fee; ground-rent payment stream | ◐ | ⚠️ | v0.2 | `interestAppraised: leasehold` flag exists; no ground-rent outflow modeled |
| Multi-building campus / business park as one asset | ✗ | — | v0.2 | see [§10 hierarchy decision](#10-structural-open-decisions) |
| Legal description, easements, encroachments | ✗ | — | v0.x | notes only |
| Flood zone / environmental (Phase I, contamination) | ✗ | — | v0.x | notes only |
| Entitlements / excess FAR / expansion land | ✗ | — | v0.x | `yardAcres` partial; notes otherwise |

## 2. Physical / building

| Element | Spec | Engine | Target | Standard / notes |
|---|---|---|---|---|
| RBA, office SF, mezzanine SF | ✅ | ✅ | | RBA is the per-SF / pro-rata denominator |
| Clear height, dock/grade doors, truck court, trailer & auto parking | ✅ | — | | |
| Year built/renovated, construction, sprinkler, power, rail, coverage/FAR, fenced yard | ✅ | — | | |
| **Rentable-vs-usable / load factor** | ✗ | — | v0.2 | BOMA / SIOR; pro-rata share & $/SF both depend on it |
| **Measurement standard declaration (BOMA/SIOR/gross)** | ✗ | — | v0.2 | BOMA 2017; today only free-text in `notes` |
| **Remeasurement (event or restated RBA)** | ✗ | — | v0.x | changes $/SF rent and shares mid-hold |
| `sf_mismatch` tolerance vs loaded buildings | ✅ | ◐ | v0.2 | engine warns at >0.5%; false-positives on any load-factored multi-tenant building |
| Column spacing, floor load, HVAC / cold-storage spec, roof age, condition / PCA | ✗ | — | v0.x | `cold_storage` subtype exists with no temp spec |

## 3. Tenancy / rent roll

The core of the format, and where gaps concentrate. ORE computes **base rent**
thoroughly and **recovery income** and **lease optionality** crudely.

| Element | Spec | Engine | Target | Standard / notes |
|---|---|---|---|---|
| Tenant name/dba/parent/guarantor entity, industry | ✅ | — | | guarantor stored, not used (no cash-flow effect) |
| Suite, leased SF, commencement, expiration | ✅ | ✅ | | |
| Base-rent steps + unit | ✅ | ✅ | | |
| Escalation — fixed % | ✅ | ✅ | | |
| Escalation — fixed $ | ✅ | ◐ | v0.2 | honored in-place; **dropped to flat on rollover/market leases** (warned) |
| Escalation — CPI w/ floor/cap | ✅ | ◐ | v0.2 | flattened to year-1 rate (warned) |
| **CPI index spec (CPI-U/-W, region, lookback, fraction)** | ✗ | — | v0.x | only floor/cap today |
| Free rent (incl. % abated, reimbursement-abating) | ✅ | ✅ | | |
| Reimbursement — NNN | ✅ | ✅ | | |
| Reimbursement — NN (landlord roof/structure) | ✅ | ◐ | v0.2 | modeled as NNN; carve-out only via per-expense `recoverable:false` — not enforced by structure |
| Reimbursement — MG base year | ✅ | ◐ | v0.2 | **base-year $ estimated by deflation; no field for the actual base-year amount** |
| Reimbursement — MG expense stop | ✅ | ✅ | | |
| Reimbursement — Gross | ✅ | ⚠️ | v0.2 | **recovers $0 silently** (no warning, unlike MG/market) |
| **Controllable-expense cap (cap % + basis: non-cumulative / cumulative / cumulative-compounded)** | ✗ | — | **v0.2** | the single biggest recovery-income gap for industrial NNN |
| **Controllable vs non-controllable classification** | ✗ | — | **v0.2** | taxes & insurance normally uncapped; pairs with the cap |
| **Gross-up of variable expenses to occupancy (~95%)** | ✗ | — | **v0.2** | under-collects on partially-occupied multi-tenant |
| Admin / management fee load on CAM (`adminFeePercent`) | ✅ | ◐ | v0.2 | parsed, warned, **not applied to recoveries** |
| Pro-rata share — building vs occupied-share basis | ◐ | ⚠️ | v0.2 | `proRataSharePercent` honored; no occupied-share / gross-up toggle |
| Excluded expenses (per lease) | ✅ | ✅ | | |
| In-place unfunded TI / unpaid LC | ✅ | ✅ | | |
| **Tenant options — renewal / termination / expansion / ROFR / ROFO / purchase** | ✅ | ⚠️ | **v0.2** | **fully in spec, engine ignores ALL** — incl. a below-market fixed renewal; rollover is always generic market |
| Contraction / give-back option | ✗ | — | v0.2 | not in the option enum |
| Holdover rent provision | ✗ | — | v0.x | expired lease rolls straight to market |
| **One lease across multiple suites / blended premises** | ✗ | — | v0.2 | see [§10](#10-structural-open-decisions) |
| Security deposit / LOC (`form`) | ✅ | — | | informational; no value effect |
| **Lease amendments / blend-and-extend as structured history** | ✗ | — | v0.x | only the current effective schedule + notes |
| Estoppel / SNDA status, bankruptcy / arrears, subleases | ✗ | — | v0.x | notes |
| Percentage / overage rent | ✗ | — | scope | retail; out of v0.1 charter |

## 4. Other income (everything that isn't base rent)

| Element | Spec | Engine | Target | Standard / notes |
|---|---|---|---|---|
| Expense reimbursements | ✅ | ✅ | | computed, not stored |
| Parking / trailer-storage / IOS yard income line | ✗ | — | v0.2 | material for IOS and trailer-heavy logistics |
| Antenna / rooftop / signage / fiber / solar / EV income | ✗ | — | v0.x | |
| Late fees / miscellaneous income | ✗ | — | v0.x | |

## 5. Operating expenses

| Element | Spec | Engine | Target | Standard / notes |
|---|---|---|---|---|
| Taxes, insurance, CAM, R&M, utilities, mgmt fee (%EGR), admin, reserves | ✅ | ✅ | | category enum maps toward NCREIF expense taxonomy |
| Recoverable flag, per-item growth override, below-the-line | ✅ | ✅ | | |
| **Property-tax reassessment on sale (e.g. CA Prop 13)** | ✗ | — | **v0.2** | flat growth only; often the largest expense swing in a CA hold |
| **One-time / dated capital expenditures (roof in yr 2)** | ✗ | — | **v0.2** | only a recurring `reserves` line today |
| Tax appeal / PILOT / abatement / special assessment | ✗ | — | v0.x | |
| Ground rent (as an expense) | ✗ | — | v0.2 | pairs with the ground-lease row in §1 |

## 6. Market & underwriting assumptions

| Element | Spec | Engine | Target | Standard / notes |
|---|---|---|---|---|
| Market rent by space type; stepped rent & expense growth; CPI assumption | ✅ | ✅ | | |
| General vacancy, credit loss | ✅ | ✅ | | de-duplicated against explicit downtime |
| Renewal probability, downtime, market TI / LC / free rent | ✅ | ✅ | | |
| Absorption curve for large vacant blocks | ◐ | ◐ | v0.x | single downtime only; no multi-suite lease-up schedule |

## 7. Valuation

| Element | Spec | Engine | Target | Standard / notes |
|---|---|---|---|---|
| DCF (4 terminal methods, mid/end period, monthly/annual timing) | ✅ | ✅ | | |
| Direct cap (5 NOI bases, near-term deductions, mark-to-market, adjustments) | ✅ | ✅ | | |
| Sales comparison; cost approach | ✅ | — | v0.x | carried as structured disclosure; engine output later |
| Hold, discount rate, terminal, selling costs | ✅ | ✅ | | |
| Tax reassessment at reversion | ✗ | — | v0.2 | pairs with §5 reassessment |
| Partial interest / JV promote / waterfall | ✗ | — | scope | |
| Multiple named scenarios in one file | ✗ | — | v0.x | |

## 8. Debt & transaction

| Element | Spec | Engine | Target | Standard / notes |
|---|---|---|---|---|
| Single fixed-rate loan (amount or LTV), IO, amortization, DSCR | ✅ | ✅ | | |
| Floating / SOFR+spread, mezz / multiple tranches | ✗ | — | scope | |
| Prepayment penalty / defeasance / yield maintenance | ✗ | — | scope | |
| Assumable existing (in-place) debt | ✗ | — | v0.x | |
| Refinance during hold | ◐ | ◐ | v0.x | assumed refi at identical terms when loan term < hold |
| Closing prorations, earnest money, earnout / holdback, 1031 structure | ✗ | — | scope | transaction mechanics, not underwriting |

## 9. Provenance / metadata

| Element | Spec | Engine | Target | Standard / notes |
|---|---|---|---|---|
| Producer identity & role, source documents, contacts, confidentiality | ✅ | — | | |
| Data-as-of dates (`asOfDate`, `analysisStartDate`) | ✅ | ✅ | | |
| Currency declaration | ✗ | — | v0.x | USD implicit; fine for US-only v0.1 |

---

## 10. Structural open decisions

### The property → building → suite → lease hierarchy

Today the model is **flat**: one file = one building (`property.physical.buildingSF`),
and one lease = one premises (a single `leasedSF` and `suite`). Two real situations
have no clean home:

- a **multi-suite lease** (one tenant in suites 100 + 200 at blended terms) — must
  be split into two lease records, which then mis-splits the deposit, guaranty, and
  options; and
- a **multi-building campus / business park** as a single asset — must be split into
  separate files (losing single-asset identity) or flattened into one building.

This is **additive, not breaking, if the field names are reserved now** and the flat
shape is kept as the default. Options:

- **A — Stay flat.** Document the split-records convention. Simplest; loses
  per-lease attribution and single-asset campus identity.
- **B — Optional collections (recommended).** Add optional `property.buildings[]`
  and an optional `lease.premises[]` (suite + SF pairs); when absent, the existing
  flat fields are the single building / single premises. Existing files stay valid;
  the engine sums premises SF and attributes options/deposits to the whole lease.
- **C — Full nesting.** portfolio → property → building → suite → lease as nested
  objects. Most correct, genuinely breaking, heaviest.

**Recommendation: reserve the §B field names in v0.1.x now** (so there is one
canonical way to express a multi-suite lease before real files proliferate),
**implement the engine semantics in v0.2.** This defuses the only "clock" in the
backlog — every other gap below is purely additive and can land any time.

---

## v0.2 priorities (derived from the gaps)

Ordered by credibility risk — the items most likely to make ORE's NOI visibly
disagree with a real underwrite on the first industrial deal, which is what would
undercut the "same inputs → same NOI" thesis. All are **additive** to the schema
unless noted.

1. **Honor tenant options in the engine** — a below-market fixed renewal currently
   overvalues silently. *(Correctness bug, not a missing feature.)*
2. **Controllable-expense caps** + controllable/non-controllable classification.
3. **Expense gross-up to occupancy.**
4. **Property-tax reassessment on sale** (going-in and at reversion).
5. **Actual MG base-year amount** (stop estimating by deflation).
6. **One-time / dated capital expenditures** in the DCF.
7. **Fix silent Gross recoveries** + apply `adminFeePercent`.
8. **Reserve the hierarchy field names** (§10) — the one item with a clock.
9. Ground-lease payment stream; parking / IOS-yard other-income line.

## Deliberately out of scope (v0.1 charter)

Listed so deferral is a decision, not an oversight: percentage / overage rent and
co-tenancy (retail); floating-rate / mezzanine / defeasance debt; JV promotes and
waterfalls; transaction mechanics (closing prorations, earnouts, 1031); non-US
conventions and multi-currency; office / multifamily / hotel structures.

## Standards alignment

Following REDI's discipline, each ORE field should map to an existing standard where
one exists, rather than inventing a definition:

- **Expense categories** → NCREIF / PREA Reporting Standards expense taxonomy.
- **Area measurement** → BOMA 2017 / SIOR industrial conventions (the §2 load-factor
  and measurement-standard rows).
- **Asset & ownership identity** → REDI asset-level fields (exact field IDs pending —
  the REDI data model is gated; align on the published v1.0 dictionary when
  accessible).

REDI standardizes the *reporting* layer (GP→LP, backward-looking); ORE standardizes
the *transaction* layer (broker↔buyer↔appraiser, forward-looking). The overlap is
exactly the asset-identity and operating-financials rows above — aligning their
definitions is the field-level form of "REDI for reporting, ORE for transactions."
