# Design note: property types beyond industrial

Date: 2026-11-09. Status: direction adopted (founder decision); unit mix proposed,
not yet built. Tracking: issues 44, 45, 49, 50.

## Decision

ORE is a format for commercial real estate, not for industrial real estate. v0.1
shipped with `propertyType` fixed to `industrial` because that is where the first
examples and the first engine tests came from. Launch feedback made the cost of
that plain: a large share of first-time readers tried a multifamily deal first, and
the file could not validate. If ORE cannot carry multifamily, it does not work.

## What changed in the first pass

- `property.propertyType` is an enum of fifteen types, not a constant.
- `property.propertySubtype` keeps the industrial list for industrial files and is
  open snake_case text for everything else, until each type settles its own list.
- `property.physical.unitCount` exists, for property counted in units.
- The engine emits a `property_type_coverage` warning for any type whose
  conventions it does not fully model, and says which ones. The rule from
  `spec/coverage.md` holds: a gap may be disclosed, never silent.
- `llms.txt` tells an LLM author what to do with a property that is not industrial.
- `examples/small-multifamily.ore`: a 12-unit building written one unit per lease,
  with a locked golden.

None of this changes any existing file or any existing golden output.

## Two income shapes

Sorting property types by how their income is underwritten gives two shapes that
cover most of the market.

**Lease-based.** Income is a list of leases, each with its own tenant, term, rent
schedule and recovery structure. Rollover is modeled lease by lease. This is the
model ORE has. It fits industrial, office, medical office, life science, retail,
data centers and net-leased property of any kind.

**Unit-based.** Income is a count of similar units at a rent per unit. Leases are
short, tenants are interchangeable, and nobody abstracts them one at a time.
Rollover is a turnover rate, not an event. This fits multifamily, student and
senior housing, self-storage and manufactured housing.

A third group, operating businesses (hotels), earns revenue that is not rent at
all. That is out of scope until someone needs it.

Mixed-use property is both shapes in one file: apartments over shops.

## Lease-based types: what is missing

The lease model carries office and retail today. The gaps are specific:

| Gap | Affects | Changes cash flow? | Tracked |
|---|---|---|---|
| Rentable vs usable area, load factor | office | yes, through pro-rata shares | #24 |
| Expense gross-up to occupancy | office, any multi-tenant | yes | #20 |
| Parking and other income | office, retail, industrial | yes | #23 |
| Percentage rent | retail | yes | #49 |
| Recovery pools with anchor exclusions | retail | result is expressible per lease; the pool is not | #49 |
| Co-tenancy, exclusive use | retail | no, disclosure | #49 |

Three of the six were already in the industrial backlog. Percentage rent is the
only item that changes cash flow and has no workaround.

## Unit-based types: what is needed

### What works today

A unit can be written as a lease: rent in `totalPerMonth`, a `Gross` structure,
no escalation, a 12-month leasing profile per unit type. The engine's two-branch
rollover (renew or re-let, with downtime and turn cost) is a fair model of an
apartment turning over. For a 12-unit building this is accurate and readable.

It stops being reasonable somewhere past a few dozen units:

- A 300-unit property is 300 lease records. An LLM can write that; a person
  cannot review it.
- Market rent is stated per square foot. Apartments are quoted per unit.
- Outputs are per square foot. The market reads per unit.
- Other income (parking, laundry, fees, utility reimbursement) has no field.
- Loss to lease, concessions and non-revenue units are standard lines in a
  multifamily underwrite and have no home.

### Proposal: `rentRoll.unitMix[]`

An optional array beside `leases[]`. A file may carry either, or both.

| Field | Meaning |
|---|---|
| `unitTypeId` | Stable id, unique in the file |
| `name` | "2 bed / 2 bath" |
| `bedrooms`, `bathrooms` | Optional; not every unit type is an apartment |
| `unitCount` | Units of this type |
| `averageUnitSF` | Average size |
| `occupiedUnits` | Occupied as of `asOfDate` |
| `inPlaceRentPerUnitPerMonth` | Average rent on occupied units |
| `marketRentPerUnitPerMonth` | Market rent as of `asOfDate` |
| `rentRestriction` | `market`, `affordable`, `rent_controlled`, `other` |
| `notes` | Free text |

With it:

- **Assumptions** under `marketAssumptions`: months for loss to lease to burn
  off (default 12), concessions as a percent of potential rent, non-revenue units,
  annual turnover percent and turn cost per unit. General vacancy and credit loss
  already exist.
- **Other income**: the `otherIncome[]` array already proposed for parking and
  yard income (issue 23). One construct serves every property type.
- **Expenses**: add `perUnitPerYear` to `amountUnit`, and categories for payroll,
  marketing and turnover.
- **Outputs**: value per unit, rent per unit, expense ratio, occupancy by units.

### Engine

One new stream beside the lease streams:

1. Gross potential rent: units × market rent, grown on the market rent curve.
2. Less loss to lease: the gap between in-place and market, burning off over the
   stated months.
3. Less vacancy, concessions and credit loss.
4. Plus other income.

That is effective gross revenue. Everything after it (expenses, management fee,
NOI, reserves, DCF, direct cap, debt, returns, sensitivity) is the existing path,
unchanged.

### Open questions

1. **Unit-level rent rolls.** Keep small properties as leases (today's example),
   or allow a `unitMix` row with `unitCount: 1`? Two ways to say the same thing is
   a cost; the lease route also carries real dates.
2. **Renovation programs.** Units per month, cost per unit, rent premium. Common
   in value-add multifamily. First cut or later?
3. **Rent restrictions.** A label is enough for disclosure. Modeling regulated
   rent growth is a separate piece of work.
4. **Personal data.** Unit-level files must never carry a resident's name. The
   spec should say so in the data dictionary, and the validator could warn on
   tenant names in a multifamily file that do not look like unit labels.
5. **Excel workbook.** The workbook mirrors the engine formula by formula. A unit
   mix stream has to be added there in the same change.

## Sequence

1. Done: accept every type, warn on gaps, one multifamily example.
2. One synthetic example each for office and retail, to find what breaks.
3. `otherIncome[]` (issue 23): small, and needed by every type.
4. `unitMix[]` in the schema and engine, with a 200-unit example and golden.
5. Percentage rent.

Steps 3 and 4 are schema additions, so existing files stay valid.
