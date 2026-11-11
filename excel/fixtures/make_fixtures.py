#!/usr/bin/env python3
"""Generate the workbook stress fixtures (excel/fixtures/*.ore).

The six published examples exercise the common paths. These fixtures are
synthetic variants built to reach every branch the workbook mirrors: fee-simple
basis, expense stops and estimated base years, exclusions, admin fees,
non-cumulative and simple-cumulative caps, partial and reimbursement-abating
free rent, signed-not-yet-commenced leases, fixed-amount and CPI escalations,
CPI and MG market profiles, unmapped space types, percent-of-rent commissions,
annual and mid-period discounting, every terminal-value method, trailing and
in-place NOI bases, custom NOI, direct-cap exclusions and lump-sum adjustments,
derived-rate tax reassessment, LTV debt with amortization, and growth curves.

They are test inputs, not examples: values are arbitrary and unrealistic in
places on purpose. Regenerate with:  python3 excel/fixtures/make_fixtures.py
"""

import copy
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))


def load(name):
    with open(os.path.join(ROOT, "examples", name + ".ore")) as f:
        return json.load(f)


def save(name, d):
    d["provenance"] = {
        "generatedAt": "2026-11-06T00:00:00Z",
        "generatedBy": {"name": "ORE workbook test fixtures", "role": "other"},
        "software": {"name": "excel/fixtures/make_fixtures.py", "version": "0.1.0"},
        "notes": "Synthetic stress fixture for workbook conformance. Not an example deal.",
    }
    with open(os.path.join(HERE, name + ".ore"), "w") as f:
        json.dump(d, f, indent=2)
        f.write("\n")


# 1. Multi-tenant mechanics: every reimbursement path on one rent roll.
d = load("multi-tenant-infill")
L100, L200, L300 = d["rentRoll"]["leases"]
L100["reimbursement"] = {
    "structure": "nnn", "adminFeePercent": 10, "excludedExpenses": ["E-CAM"],
    "expenseCap": {"capPercent": 3, "basis": "non_cumulative", "baseYearControllableAmount": 40000},
}
L100["baseRent"]["schedule"] = [
    {"startDate": "2025-04-01", "amount": 1.25},
    {"startDate": "2026-04-01", "amount": 1.31},
    {"startDate": "2027-04-01", "amount": 1.36},
]
L100["escalation"] = {"type": "fixed_amount", "amount": 0.05, "frequencyMonths": 12}
L100["freeRent"] = [{"startDate": "2026-08-01", "endDate": "2026-09-30", "percentAbated": 50, "abatesReimbursements": True}]
L100["leasingCommissions"] = {"percentOfTotalRent": 4, "fundingDate": "2026-09-01"}
L100["tenantImprovements"] = {"amountPerSF": 6}
L200["reimbursement"] = {"structure": "mg", "expenseStopPerSF": 5.0}
L200["expirationDate"] = "2027-12-31"
L300["reimbursement"] = {"structure": "nnn", "proRataSharePercent": 27,
                         "expenseCap": {"capPercent": 4, "basis": "cumulative"}}
L300["spaceType"] = "flex"           # unmapped -> first profile
L300["options"] = [{"type": "renewal", "rentBasis": "percent_of_market", "percentOfMarket": 90, "renewalTermMonths": 30}]
d["rentRoll"]["leases"].append({
    "leaseId": "L-450", "tenant": {"name": "Forward Commit Tenant"}, "suite": "450", "leasedSF": 6000,
    "commencementDate": "2026-10-01", "expirationDate": "2031-09-30",
    "baseRent": {"unit": "per_sf_per_year", "schedule": [{"startDate": "2026-10-01", "amount": 17.4}]},
    "escalation": {"type": "cpi", "frequencyMonths": 12, "cpiFloorPercent": 3.0},
    "reimbursement": {"structure": "mg", "baseYear": 2024},
    "freeRent": [{"startDate": "2026-10-01", "endDate": "2026-12-31"}],
})
d["rentRoll"]["vacantSuites"][0]["sf"] = 8200
d["rentRoll"]["vacantSuites"].append({"suite": "500", "sf": 2400, "spaceType": "creative"})  # unmapped space type
d["property"]["physical"]["buildingSF"] = 78400 + 6000 - 6000 + 2400 - 6000 + 6000  # SF mismatch on purpose
d["expenses"]["items"].append({"expenseId": "E-LAND", "name": "Landscaping", "category": "cam", "amount": 9000,
                               "amountUnit": "total_per_year", "recoverable": True, "controllable": False})
d["marketAssumptions"]["growth"] = {
    "marketRent": [{"fromYear": 1, "annualPercent": 5.0}, {"fromYear": 3, "annualPercent": 3.0}, {"fromYear": 6, "annualPercent": 2.5}],
    "expenses": [{"fromYear": 1, "annualPercent": 3.5}, {"fromYear": 4, "annualPercent": 2.75}],
    "cpi": [{"fromYear": 1, "annualPercent": 2.2}, {"fromYear": 2, "annualPercent": 3.0}],
}
prof = d["marketAssumptions"]["leasingProfiles"]["small_bay"]
prof["escalation"] = {"type": "cpi", "frequencyMonths": 12, "cpiFloorPercent": 2.5, "cpiCapPercent": 4.0}
prof["renewal"]["freeRentMonths"] = 2
d["marketAssumptions"]["leasingProfiles"]["mg_suite"] = {
    "marketRent": {"amount": 16.0, "unit": "per_sf_per_year"}, "termMonths": 36,
    "escalation": {"type": "fixed_amount", "amount": 0.5, "frequencyMonths": 12},
    "reimbursementStructure": "mg", "downtimeMonths": 0, "renewalProbabilityPercent": 100,
    "renewal": {"tiPerSF": 0.5, "lcPercentOfRent": 2}, "renewalRentPercentOfMarket": 100,
}
L200["spaceType"] = "mg_suite"
v = d["valuation"]
v["dcf"].update({"discountTiming": "annual", "periodConvention": "mid", "holdPeriodYears": 6})
v["dcf"]["terminalValue"].update({"noiBasis": "trailing_year", "deductBelowTheLineItems": True})
v["directCap"] = {"capRatePercent": 5.6, "noiBasis": "year1", "applyGeneralVacancy": False,
                  "deductBelowTheLineItems": True, "excludeExpenseIds": ["E-UTIL"],
                  "nearTermAdjustments": {"periodMonths": 12, "includeTI": False, "discountRatePercent": 9},
                  "adjustments": [{"name": "Roof", "type": "deduction", "amount": 125000},
                                  {"name": "Excess land", "type": "addition", "amount": 40000}]}
d["debt"] = {"ltvPercent": 60, "interestRatePercent": 6.0, "termMonths": 84, "amortizationMonths": 300,
             "originationFeePercent": 0.75}
save("stress-multi-tenant", d)

# 2. Fee simple + growth-curve CPI, in-place basis, exit price per SF.
d = load("multi-tenant-infill")
d["valuation"]["interestAppraised"] = "fee_simple"
d["valuation"]["directCap"] = {"capRatePercent": 5.25, "noiBasis": "in_place"}
d["valuation"]["dcf"]["terminalValue"] = {"method": "exit_price_psf", "exitPricePerSF": 340, "sellingCostsPercent": 2,
                                          "deductUnfundedObligations": True}
save("stress-fee-simple", d)

# 3. Single tenant: grown purchase price exit, custom NOI, derived-rate tax reassessment, amortizing debt.
d = load("single-tenant-nnn")
v = d["valuation"]
v["dcf"]["terminalValue"] = {"method": "grown_purchase_price", "annualAppreciationPercent": 2.75, "sellingCostsPercent": 1}
v["dcf"]["holdPeriodMonths"] = 90
v["dcf"].pop("holdPeriodYears", None)
v["dcf"]["periodConvention"] = "mid"
v["directCap"] = {"capRatePercent": 5.5, "noiBasis": "custom", "customNOI": 812000}
v["taxReassessment"] = {"reassessAtReversion": False}
d["debt"] = {"loanAmount": 9000000, "interestRatePercent": 5.5, "termMonths": 120, "amortizationMonths": 360,
             "fundingDate": "2026-06-01"}
lease = d["rentRoll"]["leases"][0]
lease["options"] = [{"type": "termination"}, {"type": "renewal", "rentBasis": "fixed", "fixedRent": 1.95,
                                              "renewalTermMonths": 48, "renewalCount": 2}]
lease["reimbursement"] = {"structure": "gross"}
save("stress-single-tenant", d)

# 4. Value-add: stabilized exit with reassessment at reversion on current taxes (no acquisition reset),
#    vacancy in place of the tenant, total_per_month rents, and an LC by amountPerSF.
d = load("value-add-rollover")
v = d["valuation"]
v["taxReassessment"] = {"effectiveTaxRatePercent": 1.1, "reassessOnAcquisition": False, "reassessAtReversion": True,
                        "expenseId": "E-TAX"}
v["dcf"]["terminalValue"]["noiBasis"] = "forward_year"
lease = d["rentRoll"]["leases"][0]
lease["baseRent"] = {"unit": "total_per_month", "schedule": [{"startDate": "2024-09-01", "amount": 52700}]}
lease["leasingCommissions"] = {"amountPerSF": 1.25}
d["rentRoll"]["leases"][0]["leasedSF"] = 50000
d["rentRoll"]["vacantSuites"] = [{"suite": "B", "sf": 12000}]
save("stress-value-add", d)

print("wrote", sorted(f for f in os.listdir(HERE) if f.endswith(".ore")))
