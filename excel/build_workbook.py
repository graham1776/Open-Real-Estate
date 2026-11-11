#!/usr/bin/env python3
"""Build the ORE Excel workbook (reader + native-formula engine).

    python3 excel/build_workbook.py            # writes excel/ORE-Workbook.xlsx
    python3 excel/build_workbook.py --out X    # somewhere else

The workbook is generated, never hand-edited: every formula lives in this file,
so a methodology change is a reviewable diff here plus a re-run of the
conformance test (excel/test_workbook.py), which recalculates the workbook for
every example deal and requires it to reproduce the reference engine's golden
outputs.

Layout (left to right in the tab bar):
  Start Here   how to load a file, legend, capacity, status
  Summary      one-page deal summary (printable)
  Rent Roll    lease abstract table (printable)
  Expenses     operating expense schedule (printable)
  Assumptions  market leasing, growth, valuation and debt inputs (printable)
  Annual CF    annual cash flow and NOI bridge (printable)
  Valuation    direct cap, DCF, sensitivity, debt, returns
  Check        every workbook output beside the reference engine's, PASS/FAIL
  Tape         the .ore file as path/value rows: the only input
  Data         typed tables parsed from the tape
  SpaceParams  per-space (lease or vacant suite) parameters
  SpaceCalc    per-space monthly streams (in-place lease + rollover)
  ExpCalc      monthly operating expenses by line item
  MonthlyCF    monthly property cash flow, debt, return vectors

Mirrors engine/src/index.ts (engine 0.1.0). Where the TypeScript is the
authority, comments here name the function being mirrored.
"""

import argparse
import os

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.formatting.rule import CellIsRule, FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter as CL
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.worksheet.properties import PageSetupProperties

ENGINE_VERSION = "0.1.0"
WORKBOOK_VERSION = "0.1.0"

# ---------------------------------------------------------------- capacity
NL = 40      # leases
NV = 8       # vacant suites
NS = NL + NV # spaces
MS = 12      # rent schedule steps per lease
MF = 4       # free-rent periods per lease
MX = 8       # expense exclusions per lease
MO = 4       # options per lease
NE = 25      # expense line items
NP = 8       # leasing profiles
NA = 10      # direct-cap lump-sum adjustments
NDX = 10     # direct-cap excluded expense ids
NC = 10      # growth-curve steps
NY = 25      # growth-curve years tabulated
MAXM = 240   # monthly columns (horizon = max(hold + 36, 48) must fit)
NYR = 17     # annual cash-flow columns (hold <= 204 months)
TAPE_ROWS = 6000
BIG = 1000000000  # "never" month index

M0 = 6                       # column F is month 0 on every monthly sheet
LASTC = CL(M0 + MAXM - 1)    # last month column letter


def mcol(m):
    return CL(M0 + m)


# ---------------------------------------------------------------- styling
FONT = "Arial"
F_BASE = Font(name=FONT, size=10)
F_BOLD = Font(name=FONT, size=10, bold=True)
F_TITLE = Font(name=FONT, size=16, bold=True)
F_SUB = Font(name=FONT, size=11, bold=True)
F_NOTE = Font(name=FONT, size=9, italic=True, color="595959")
F_INPUT = Font(name=FONT, size=10, color="0000FF")
F_HDR = Font(name=FONT, size=10, bold=True, color="FFFFFF")
F_LINK = Font(name=FONT, size=10, color="008000")
FILL_HDR = PatternFill("solid", fgColor="1F3864")
FILL_SEC = PatternFill("solid", fgColor="D9E1F2")
FILL_KEY = PatternFill("solid", fgColor="FFFF00")
FILL_PASS = PatternFill("solid", fgColor="C6EFCE")
FILL_FAIL = PatternFill("solid", fgColor="FFC7CE")
FILL_INPUT = PatternFill("solid", fgColor="FFF2CC")
THIN = Side(style="thin", color="BFBFBF")
B_BOTTOM = Border(bottom=THIN)
B_TOP = Border(top=Side(style="thin", color="000000"))

NF_USD = '$#,##0;($#,##0);"-"'
NF_USD2 = '$#,##0.00;($#,##0.00);"-"'
NF_NUM = '#,##0;(#,##0);"-"'
NF_NUM2 = '#,##0.00;(#,##0.00);"-"'
NF_PCT = '0.00%;(0.00%);"-"'
NF_PCT1 = '0.0%;(0.0%);"-"'
NF_X = '0.00"x"'
NF_DATE = "yyyy-mm-dd"


def q(sheet):
    return f"'{sheet}'" if (" " in sheet or "-" in sheet) else sheet


def ref(sheet, col, row, abs_col=True, abs_row=True):
    c = f"${col}" if abs_col else col
    r = f"${row}" if abs_row else str(row)
    return f"{q(sheet)}!{c}{r}"


# Tape lookups. TapeP/TapeV are workbook names over the tape's two columns.
def LK(path_expr):
    """Value at a tape path ('' when the path is absent)."""
    return f'IFERROR(INDEX(TapeV,MATCH({path_expr},TapeP,0)),"")'


def LKN(path_expr):
    """Like LK but '' for a present-but-null cell (engine outputs use JSON null)."""
    return (f'IFERROR(IF(ISBLANK(INDEX(TapeV,MATCH({path_expr},TapeP,0))),"",'
            f'INDEX(TapeV,MATCH({path_expr},TapeP,0))),"")')


def S(text):
    """Excel string literal."""
    return '"' + text.replace('"', '""') + '"'


def DK(cell):
    """Absolute month key (year*12 + month) of an ISO date that may have been typed as text or a date."""
    return (f'IF({cell}="","",IF(ISNUMBER({cell}),YEAR({cell})*12+MONTH({cell}),'
            f'VALUE(LEFT({cell},4))*12+VALUE(MID({cell},6,2))))')


def DATEV(cell):
    """Display date from an ISO date text (or a date already)."""
    return (f'IF({cell}="","",IF(ISNUMBER({cell}),{cell},'
            f'DATE(VALUE(LEFT({cell},4)),VALUE(MID({cell},6,2)),VALUE(MID({cell},9,2)))))')


def ANNUITY(T, r, f):
    """sum_{t<T} (1+r)^floor(t/f) — termRentTotal() per unit of starting rent."""
    return (f'IF({r}=0,{T},{f}*((1+{r})^INT({T}/{f})-1)/{r}+({T}-INT({T}/{f})*{f})*(1+{r})^INT({T}/{f}))')


class Book:
    def __init__(self):
        self.wb = Workbook()
        self.wb.remove(self.wb.active)
        self.n = {}  # name -> absolute reference string

    def sheet(self, title, tab=None):
        ws = self.wb.create_sheet(title)
        ws.sheet_view.showGridLines = False
        if tab:
            ws.sheet_properties.tabColor = tab
        return ws

    def name(self, key, sheet, col, row):
        self.n[key] = ref(sheet, col, row)
        return self.n[key]

    def __getitem__(self, key):
        return self.n[key]


def put(ws, addr, value, font=F_BASE, nf=None, fill=None, align=None, border=None):
    c = ws[addr]
    c.value = value
    c.font = font
    if nf:
        c.number_format = nf
    if fill:
        c.fill = fill
    if align:
        c.alignment = align
    if border:
        c.border = border
    return c


def header_row(ws, row, col0, labels, widths=None):
    for j, lab in enumerate(labels):
        c = ws.cell(row=row, column=col0 + j, value=lab)
        c.font = F_HDR
        c.fill = FILL_HDR
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    if widths:
        for j, w in enumerate(widths):
            ws.column_dimensions[CL(col0 + j)].width = w


def section(ws, row, col0, text, ncols=6):
    for j in range(ncols):
        ws.cell(row=row, column=col0 + j).fill = FILL_SEC
    c = ws.cell(row=row, column=col0, value=text)
    c.font = F_SUB


# =====================================================================
# Tape
# =====================================================================
def build_tape(B):
    ws = B.sheet("Tape", "7F7F7F")
    ws.sheet_view.showGridLines = True
    header_row(ws, 1, 1, ["path", "value", "profile key (calc)", "profile # (calc)"], [58, 48, 18, 10])
    ws.freeze_panes = "A2"
    for r in range(2, TAPE_ROWS + 2):
        ws.cell(row=r, column=1).font = F_INPUT
        b = ws.cell(row=r, column=2)
        b.font = F_INPUT
        b.number_format = "@"
        pre = "marketAssumptions.leasingProfiles."
        ws.cell(row=r, column=3, value=(
            f'=IF(LEFT(A{r},{len(pre)})="{pre}",MID(A{r},{len(pre)+1},FIND(".",A{r}&".",{len(pre)+1})-{len(pre)+1}),"")'
        )).font = F_BASE
        ws.cell(row=r, column=4, value=(
            f'=IF(C{r}="","",IF(COUNTIF(C$1:C{r-1},C{r})=0,MAX(D$1:D{r-1})+1,""))'
        )).font = F_BASE
    last = TAPE_ROWS + 1
    for nm, col in (("TapeP", "A"), ("TapeV", "B"), ("TapeK", "C"), ("TapeKN", "D")):
        B.wb.defined_names[nm] = DefinedName(nm, attr_text=f"Tape!${col}$2:${col}${last}")
    ws.cell(row=1, column=1).comment = Comment(
        "Paste or import the .ore file here as path/value rows, starting at row 2. "
        "The Import button (xlsm), `ore excel`, or `ore tape` fill it. Columns C:D are formulas.", "ORE")
    return ws


# =====================================================================
# Data: typed tables parsed from the tape
# =====================================================================
SCALARS = [
    # key, path, kind  (kind: n number, t text, d date, b boolean)
    ("formatVersion", "formatVersion", "t"),
    ("propName", "property.name", "t"),
    ("propType", "property.propertyType", "t"),
    ("propSubtype", "property.propertySubtype", "t"),
    ("tenancy", "property.tenancy", "t"),
    ("propDesc", "property.description", "t"),
    ("street", "property.address.street1", "t"),
    ("city", "property.address.city", "t"),
    ("state", "property.address.state", "t"),
    ("zip", "property.address.postalCode", "t"),
    ("county", "property.address.county", "t"),
    ("market", "property.location.market", "t"),
    ("submarket", "property.location.submarket", "t"),
    ("apn", "property.parcels[0].apn", "t"),
    ("zoning", "property.parcels[0].zoning", "t"),
    ("siteAcres", "property.siteAreaAcres", "n"),
    ("bsf", "property.physical.buildingSF", "n"),
    ("officeSF", "property.physical.officeSF", "n"),
    ("clearHt", "property.physical.clearHeightFt", "n"),
    ("dockDoors", "property.physical.dockHighDoors", "n"),
    ("gradeDoors", "property.physical.gradeLevelDoors", "n"),
    ("yearBuilt", "property.physical.yearBuilt", "n"),
    ("yearRenov", "property.physical.yearRenovated", "n"),
    ("coverage", "property.physical.coverageRatio", "n"),
    ("propNotes", "property.notes", "t"),
    ("asOf", "rentRoll.asOfDate", "d"),
    ("rrNotes", "rentRoll.notes", "t"),
    ("maAsOf", "marketAssumptions.asOfDate", "d"),
    ("gvPct", "marketAssumptions.generalVacancyPercent", "n"),
    ("clPct", "marketAssumptions.creditLossPercent", "n"),
    ("maNotes", "marketAssumptions.notes", "t"),
    ("expNotes", "expenses.notes", "t"),
    ("anStart", "valuation.analysisStartDate", "d"),
    ("valueDate", "valuation.valueDate", "d"),
    ("interest", "valuation.interestAppraised", "t"),
    ("premise", "valuation.valuePremise", "t"),
    ("purpose", "valuation.purpose", "t"),
    ("method1", "valuation.methods[0]", "t"),
    ("method2", "valuation.methods[1]", "t"),
    ("method3", "valuation.methods[2]", "t"),
    ("method4", "valuation.methods[3]", "t"),
    ("price", "valuation.purchasePrice", "n"),
    ("acqPct", "valuation.acquisitionCostsPercent", "n"),
    ("holdYears", "valuation.dcf.holdPeriodYears", "n"),
    ("holdMonths", "valuation.dcf.holdPeriodMonths", "n"),
    ("dr", "valuation.dcf.discountRatePercent", "n"),
    ("revDr", "valuation.dcf.reversionDiscountRatePercent", "n"),
    ("timing", "valuation.dcf.discountTiming", "t"),
    ("convention", "valuation.dcf.periodConvention", "t"),
    ("tvMethod", "valuation.dcf.terminalValue.method", "t"),
    ("tvCap", "valuation.dcf.terminalValue.capRatePercent", "n"),
    ("tvBasis", "valuation.dcf.terminalValue.noiBasis", "t"),
    ("tvBTL", "valuation.dcf.terminalValue.deductBelowTheLineItems", "b"),
    ("tvPSF", "valuation.dcf.terminalValue.exitPricePerSF", "n"),
    ("tvFixed", "valuation.dcf.terminalValue.fixedValue", "n"),
    ("tvAppr", "valuation.dcf.terminalValue.annualAppreciationPercent", "n"),
    ("tvSell", "valuation.dcf.terminalValue.sellingCostsPercent", "n"),
    ("tvUnfunded", "valuation.dcf.terminalValue.deductUnfundedObligations", "b"),
    ("tvNotes", "valuation.dcf.terminalValue.notes", "t"),
    ("dcCap", "valuation.directCap.capRatePercent", "n"),
    ("dcBasis", "valuation.directCap.noiBasis", "t"),
    ("dcCustom", "valuation.directCap.customNOI", "n"),
    ("dcGV", "valuation.directCap.applyGeneralVacancy", "b"),
    ("dcBTL", "valuation.directCap.deductBelowTheLineItems", "b"),
    ("ntPeriod", "valuation.directCap.nearTermAdjustments.periodMonths", "n"),
    ("ntLost", "valuation.directCap.nearTermAdjustments.includeDowntimeLostRent", "b"),
    ("ntFree", "valuation.directCap.nearTermAdjustments.includeFreeRent", "b"),
    ("ntTI", "valuation.directCap.nearTermAdjustments.includeTI", "b"),
    ("ntLC", "valuation.directCap.nearTermAdjustments.includeLC", "b"),
    ("ntDr", "valuation.directCap.nearTermAdjustments.discountRatePercent", "n"),
    ("mtmDr", "valuation.directCap.markToMarket.discountRatePercent", "n"),
    ("recValue", "valuation.reconciliation.concludedValue", "n"),
    ("recPrimary", "valuation.reconciliation.primaryMethod", "t"),
    ("trRate", "valuation.taxReassessment.effectiveTaxRatePercent", "n"),
    ("trAcq", "valuation.taxReassessment.reassessOnAcquisition", "b"),
    ("trRev", "valuation.taxReassessment.reassessAtReversion", "b"),
    ("trId", "valuation.taxReassessment.expenseId", "t"),
    ("trEmpty", "valuation.taxReassessment", "t"),
    ("valNotes", "valuation.notes", "t"),
    ("loanAmt", "debt.loanAmount", "n"),
    ("ltv", "debt.ltvPercent", "n"),
    ("loanRate", "debt.interestRatePercent", "n"),
    ("loanTerm", "debt.termMonths", "n"),
    ("amort", "debt.amortizationMonths", "n"),
    ("io", "debt.interestOnlyMonths", "n"),
    ("origFee", "debt.originationFeePercent", "n"),
    ("fundDate", "debt.fundingDate", "d"),
    ("debtNotes", "debt.notes", "t"),
    ("genAt", "provenance.generatedAt", "t"),
    ("genBy", "provenance.generatedBy.name", "t"),
    ("genOrg", "provenance.generatedBy.organization", "t"),
    ("genRole", "provenance.generatedBy.role", "t"),
    ("genEmail", "provenance.generatedBy.email", "t"),
    ("genPhone", "provenance.generatedBy.phone", "t"),
    ("swName", "provenance.software.name", "t"),
    ("swVer", "provenance.software.version", "t"),
    ("confid", "provenance.confidentiality", "t"),
    ("provNotes", "provenance.notes", "t"),
    ("engVersion", "$engine.engineVersion", "t"),
]

LEASE_FIELDS = [
    ("id", "leaseId"), ("tenant", "tenant.name"), ("dba", "tenant.dba"), ("parent", "tenant.parentCompany"),
    ("industry", "tenant.industry"), ("credit", "tenant.creditNotes"),
    ("suite", "suite"), ("spaceType", "spaceType"), ("sf", "leasedSF"),
    ("comm", "commencementDate"), ("exp", "expirationDate"), ("unit", "baseRent.unit"),
    ("escType", "escalation.type"), ("escRate", "escalation.rate"), ("escAmt", "escalation.amount"),
    ("escFreq", "escalation.frequencyMonths"), ("cpiFloor", "escalation.cpiFloorPercent"),
    ("cpiCap", "escalation.cpiCapPercent"),
    ("struct", "reimbursement.structure"), ("share", "reimbursement.proRataSharePercent"),
    ("baseYear", "reimbursement.baseYear"), ("baseAmt", "reimbursement.baseYearExpenseAmount"),
    ("stop", "reimbursement.expenseStopPerSF"), ("admin", "reimbursement.adminFeePercent"),
    ("capPct", "reimbursement.expenseCap.capPercent"), ("capBasis", "reimbursement.expenseCap.basis"),
    ("capBase", "reimbursement.expenseCap.baseYearControllableAmount"),
    ("tiPSF", "tenantImprovements.amountPerSF"), ("tiTot", "tenantImprovements.totalAmount"),
    ("tiDate", "tenantImprovements.fundingDate"),
    ("lcPSF", "leasingCommissions.amountPerSF"), ("lcTot", "leasingCommissions.totalAmount"),
    ("lcPct", "leasingCommissions.percentOfTotalRent"), ("lcDate", "leasingCommissions.fundingDate"),
    ("deposit", "securityDeposit.amount"), ("guarantor", "guarantor"), ("notes", "notes"),
]
for k in range(MS):
    LEASE_FIELDS += [(f"st{k}", f"baseRent.schedule[{k}].startDate"), (f"amt{k}", f"baseRent.schedule[{k}].amount")]
for k in range(MF):
    LEASE_FIELDS += [(f"frs{k}", f"freeRent[{k}].startDate"), (f"fre{k}", f"freeRent[{k}].endDate"),
                     (f"frp{k}", f"freeRent[{k}].percentAbated"), (f"frr{k}", f"freeRent[{k}].abatesReimbursements")]
for k in range(MX):
    LEASE_FIELDS += [(f"x{k}", f"reimbursement.excludedExpenses[{k}]")]
for k in range(MO):
    LEASE_FIELDS += [(f"ot{k}", f"options[{k}].type"), (f"ob{k}", f"options[{k}].rentBasis"),
                     (f"of{k}", f"options[{k}].fixedRent"), (f"op{k}", f"options[{k}].percentOfMarket"),
                     (f"om{k}", f"options[{k}].renewalTermMonths"), (f"oc{k}", f"options[{k}].renewalCount")]

EXP_FIELDS = [("id", "expenseId"), ("name", "name"), ("cat", "category"), ("amt", "amount"),
              ("unit", "amountUnit"), ("rec", "recoverable"), ("ctl", "controllable"),
              ("btl", "belowTheLine"), ("ovr", "growthOverridePercent"), ("notes", "notes")]

PROF_FIELDS = [("amt", "marketRent.amount"), ("unit", "marketRent.unit"), ("term", "termMonths"),
               ("escType", "escalation.type"), ("escRate", "escalation.rate"),
               ("escFreq", "escalation.frequencyMonths"), ("cpiFloor", "escalation.cpiFloorPercent"),
               ("cpiCap", "escalation.cpiCapPercent"), ("struct", "reimbursementStructure"),
               ("down", "downtimeMonths"), ("renProb", "renewalProbabilityPercent"),
               ("nTI", "newTenant.tiPerSF"), ("nLC", "newTenant.lcPercentOfRent"), ("nFree", "newTenant.freeRentMonths"),
               ("rTI", "renewal.tiPerSF"), ("rLC", "renewal.lcPercentOfRent"), ("rFree", "renewal.freeRentMonths"),
               ("renPct", "renewalRentPercentOfMarket"), ("notes", "notes")]

VAC_FIELDS = [("suite", "suite"), ("sf", "sf"), ("spaceType", "spaceType"), ("notes", "notes")]


def build_data(B):
    ws = B.sheet("Data", "7F7F7F")
    D = "Data"
    put(ws, "A1", "Data — typed tables parsed from the Tape (formulas only; do not edit)", F_SUB)
    ws.column_dimensions["A"].width = 18
    ws.column_dimensions["B"].width = 58
    ws.column_dimensions["C"].width = 24
    ws.column_dimensions["D"].width = 16

    # ---- scalars
    r = 3
    header_row(ws, r, 1, ["key", "tape path", "value", "parsed"])
    r += 1
    for key, path, kind in SCALARS:
        ws.cell(row=r, column=1, value=key).font = F_BASE
        ws.cell(row=r, column=2, value=path).font = F_BASE
        ws.cell(row=r, column=3, value=f"={LK(f'B{r}')}").font = F_BASE
        B.name(key, D, "C", r)
        if kind == "d":
            ws.cell(row=r, column=4, value=f"={DK(f'C{r}')}").font = F_BASE
            B.name(key + "K", D, "D", r)
        r += 1
    # presence of whole modules / objects
    pres = {
        "hasDcf": f'IF({B["dr"]}<>"",1,0)',
        "hasDC": f'IF({B["dcCap"]}<>"",1,0)',
        "hasNT": f'IF({B["ntPeriod"]}<>"",1,0)',
        "hasMTM": f'IF({B["mtmDr"]}<>"",1,0)',
        "hasDebt": f'IF({B["loanRate"]}<>"",1,0)',
        "hasTR": f'IF(OR({B["trRate"]}<>"",{B["trAcq"]}<>"",{B["trRev"]}<>"",{B["trId"]}<>"",{B["trEmpty"]}<>""),1,0)',
        "hasEngine": f'IF({B["engVersion"]}<>"",1,0)',
        "startK": f'IF({B["anStartK"]}<>"",{B["anStartK"]},{B["asOfK"]})',
        "startYear": f'INT(({B["anStartK"]}-1)/12)',
        "feeSimple": f'IF({B["interest"]}="fee_simple",1,0)',
    }
    for key, f in pres.items():
        ws.cell(row=r, column=1, value=key).font = F_BASE
        ws.cell(row=r, column=3, value=f"={f}").font = F_BASE
        B.name(key, D, "C", r)
        r += 1
    # startYear must use the effective start key
    ws[B["startYear"].split("!")[1].replace("$", "")].value = f'=IF({B["startK"]}="",0,INT(({B["startK"]}-1)/12))'

    # ---- growth curves: steps + per-year rates (rateForYear)
    r += 1
    curves = [("gMkt", "marketAssumptions.growth.marketRent"),
              ("gExp", "marketAssumptions.growth.expenses"),
              ("gCpi", "marketAssumptions.growth.cpi")]
    put(ws, f"A{r}", "Growth curves (rateForYear): scalar, or steps {fromYear, annualPercent}", F_SUB)
    r += 1
    for key, path in curves:
        header_row(ws, r, 1, [key, "path", "fromYear", "annualPercent"])
        r += 1
        ws.cell(row=r, column=1, value="scalar").font = F_BASE
        ws.cell(row=r, column=2, value=path).font = F_BASE
        ws.cell(row=r, column=3, value=f"={LK(f'B{r}')}").font = F_BASE
        B.name(key + "Scalar", D, "C", r)
        r += 1
        first = r
        for j in range(NC):
            ws.cell(row=r, column=1, value=j).font = F_BASE
            ws.cell(row=r, column=2, value=f"{path}[{j}]").font = F_BASE
            ws.cell(row=r, column=3, value=f'=IF({LK(f"B{r}&{S(chr(46)+"fromYear")}")}="",{BIG},{LK(f"B{r}&{S(chr(46)+"fromYear")}")})').font = F_BASE
            ws.cell(row=r, column=4, value=f'={LK(f"B{r}&{S(chr(46)+"annualPercent")}")}').font = F_BASE
            r += 1
        last = r - 1
        B.n[key + "From"] = f"{D}!$C${first}:$C${last}"
        B.n[key + "Rate"] = f"{D}!$D${first}:$D${last}"
        B.n[key + "From1"] = f"{D}!$C${first}"
        B.n[key + "Rate1"] = f"{D}!$D${first}"
    # per-year table
    r += 1
    header_row(ws, r, 1, ["year", "marketRent %", "expenses %", "cpi %"])
    r += 1
    yfirst = r
    for y in range(1, NY + 1):
        ws.cell(row=r, column=1, value=y).font = F_BASE
        for j, (key, _) in enumerate(curves):
            sc, fr, rt, f1, r1 = (B[key + "Scalar"], B[key + "From"], B[key + "Rate"], B[key + "From1"], B[key + "Rate1"])
            f = (f'=IF(ISNUMBER({sc}),{sc},IF({f1}>={BIG},0,IF(A{r}<{f1},{r1},LOOKUP(A{r},{fr},{rt}))))')
            ws.cell(row=r, column=2 + j, value=f).font = F_BASE
        r += 1
    B.n["yrMkt"] = f"{D}!$B${yfirst}:$B${r-1}"
    B.n["yrExp"] = f"{D}!$C${yfirst}:$C${r-1}"
    B.n["g1Exp"] = f"{D}!$C${yfirst}"
    # cpi used by the model: year-1 rate if a cpi curve exists, else 0 (engine warns and assumes 0)
    ws.cell(row=r, column=1, value="cpiModel").font = F_BASE
    ws.cell(row=r, column=4, value=(
        f'=IF(OR(ISNUMBER({B["gCpiScalar"]}),{B["gCpiFrom1"]}<{BIG}),D{yfirst},0)')).font = F_BASE
    B.name("cpiModel", D, "D", r)
    r += 2

    # ---- horizon (computeAll)
    put(ws, f"A{r}", "Horizon", F_SUB)
    r += 1
    rows = [
        ("H", f'=IF({B["hasDcf"]}=1,IF({B["holdMonths"]}<>"",{B["holdMonths"]},{B["holdYears"]}*12),12)'),
        ("h", None),  # filled below
        ("nProf", "=MAX(TapeKN)"),
    ]
    for key, f in rows:
        ws.cell(row=r, column=1, value=key).font = F_BASE
        B.name(key, D, "C", r)
        if f:
            ws.cell(row=r, column=3, value=f).font = F_BASE
        r += 1
    ws[B["h"].split("!")[1].replace("$", "")].value = f'=MAX({B["H"]}+36,48)'
    r += 1

    # ---- leasing profiles
    put(ws, f"A{r}", "Leasing profiles (marketAssumptions.leasingProfiles, in file order)", F_SUB)
    r += 1
    header_row(ws, r, 1, ["#", "key"] + [f for f, _ in PROF_FIELDS])
    r += 1
    pfirst = r
    for k in range(NP):
        ws.cell(row=r, column=1, value=k + 1).font = F_BASE
        ws.cell(row=r, column=2, value=f'=IFERROR(INDEX(TapeK,MATCH(A{r},TapeKN,0)),"")').font = F_BASE
        for j, (f, p) in enumerate(PROF_FIELDS):
            ws.cell(row=r, column=3 + j, value=(
                f'=IF($B{r}="","",{LK(S("marketAssumptions.leasingProfiles.") + f"&$B{r}&" + S("." + p))})'
            )).font = F_BASE
        r += 1
    B.n["profKeys"] = f"{D}!$B${pfirst}:$B${r-1}"
    for j, (f, _) in enumerate(PROF_FIELDS):
        c = CL(3 + j)
        B.n["P_" + f] = f"{D}!${c}${pfirst}:${c}${r-1}"
    r += 1

    # ---- expenses
    put(ws, f"A{r}", "Expense items (expenses.items) + derived flags + per-lease inclusion masks", F_SUB)
    r += 1
    derived = ["exists", "isPct", "annualCur", "isTax", "annualModel", "fixed", "above", "recAbove",
               "ctlAbove", "below", "dcExcl", "ctlFlag"]
    hdr = ["#"] + [f for f, _ in EXP_FIELDS] + derived + [f"incl L{i+1}" for i in range(NL)]
    header_row(ws, r, 1, hdr)
    r += 1
    efirst = r
    B.n["E_row0"] = efirst
    ecol = {}
    for j, (f, _) in enumerate(EXP_FIELDS):
        ecol[f] = CL(2 + j)
    for j, f in enumerate(derived):
        ecol[f] = CL(2 + len(EXP_FIELDS) + j)
    inc0 = 2 + len(EXP_FIELDS) + len(derived)
    B.n["E_inclCol0"] = inc0
    # tax item for reassessment: explicit expenseId, else first real_estate_taxes item
    for k in range(NE):
        ws.cell(row=r, column=1, value=k).font = F_BASE
        for f, p in EXP_FIELDS:
            ws[f"{ecol[f]}{r}"] = f'={LK(S(f"expenses.items[{k}].{p}"))}'
            ws[f"{ecol[f]}{r}"].font = F_BASE
        e = lambda f: f"${ecol[f]}{r}"
        bsf = B["bsf"]
        ws[f"{ecol['exists']}{r}"] = f'=IF({e("id")}<>"",1,0)'
        ws[f"{ecol['isPct']}{r}"] = f'=IF({e("unit")}="percent_of_egr",1,0)'
        ws[f"{ecol['annualCur']}{r}"] = f'=IF({e("exists")}=0,0,IF({e("unit")}="per_sf_per_year",{e("amt")}*{bsf},IF({e("isPct")}=1,0,{e("amt")})))'
        ws[f"{ecol['isTax']}{r}"] = "=0"  # filled after table bounds known
        ws[f"{ecol['annualModel']}{r}"] = f'=IF(AND({e("isTax")}=1,TR_ACQ=1),TR_BASE,{e("annualCur")})'
        ws[f"{ecol['fixed']}{r}"] = f'=IF(AND({e("exists")}=1,{e("isPct")}=0),1,0)'
        ws[f"{ecol['below']}{r}"] = f'=IF(AND({e("fixed")}=1,{e("btl")}=TRUE),1,0)'
        ws[f"{ecol['above']}{r}"] = f'=IF(AND({e("fixed")}=1,{e("btl")}<>TRUE),1,0)'
        ws[f"{ecol['recAbove']}{r}"] = f'=IF(AND({e("above")}=1,{e("rec")}=TRUE),1,0)'
        ws[f"{ecol['ctlFlag']}{r}"] = (f'=IF({e("ctl")}<>"",IF({e("ctl")}=TRUE,1,0),'
                                       f'IF(OR({e("cat")}="real_estate_taxes",{e("cat")}="insurance",{e("cat")}="utilities"),0,1))')
        ws[f"{ecol['ctlAbove']}{r}"] = f'={e("recAbove")}*{e("ctlFlag")}'
        ws[f"{ecol['dcExcl']}{r}"] = "=0"  # filled below
        r += 1
    elast = r - 1
    for f, c in ecol.items():
        B.n["E_" + f] = f"{D}!${c}${efirst}:${c}${elast}"
    r += 1

    # tax reassessment (resolveTaxReassessment)
    put(ws, f"A{r}", "Tax reassessment (resolveTaxReassessment)", F_SUB)
    r += 1
    tr = [
        ("TR_IDX", f'=IF({B["hasTR"]}=0,0,IFERROR(IF({B["trId"]}<>"",MATCH({B["trId"]},{B["E_id"]},0),MATCH("real_estate_taxes",{B["E_cat"]},0)),0))'),
        ("TR_OK", None),
        ("TR_CUR", None),
        ("TR_RATE", None),
        ("TR_BASE", None),
        ("TR_ACQ", None),
        ("TR_REV", None),
    ]
    for key, f in tr:
        ws.cell(row=r, column=1, value=key).font = F_BASE
        B.name(key, D, "C", r)
        r += 1
    def setc(key, f):
        ws[B[key].split("!")[1].replace("$", "")].value = f
    setc("TR_IDX", tr[0][1])
    price = B["price"]
    setc("TR_OK", f'=IF(AND({B["TR_IDX"]}>0,{price}<>""),1,0)')
    setc("TR_CUR", f'=IF({B["TR_OK"]}=0,0,IF(INDEX({B["E_unit"]},{B["TR_IDX"]})="per_sf_per_year",INDEX({B["E_amt"]},{B["TR_IDX"]})*{B["bsf"]},INDEX({B["E_amt"]},{B["TR_IDX"]})))')
    setc("TR_RATE", f'=IF({B["TR_OK"]}=0,0,IF({B["trRate"]}<>"",{B["trRate"]},{B["TR_CUR"]}/{price}*100))')
    setc("TR_BASE", f'=IF({B["TR_OK"]}=0,0,{price}*{B["TR_RATE"]}/100)')
    setc("TR_ACQ", f'=IF(AND({B["TR_OK"]}=1,{B["trAcq"]}<>FALSE),1,0)')
    setc("TR_REV", f'=IF(AND({B["TR_OK"]}=1,{B["trRev"]}<>FALSE),1,0)')
    for nm in ("TR_ACQ", "TR_BASE", "TR_IDX", "TR_REV", "TR_RATE", "TR_OK"):
        B.wb.defined_names[nm] = DefinedName(nm, attr_text=B[nm])
    for k in range(NE):
        rr = efirst + k
        ws[f"{ecol['isTax']}{rr}"] = f"=IF(TR_IDX={k+1},1,0)"
    r += 1

    # direct-cap excluded expense ids
    put(ws, f"A{r}", "Direct cap: excludeExpenseIds", F_SUB)
    r += 1
    xfirst = r
    for k in range(NDX):
        ws.cell(row=r, column=1, value=k).font = F_BASE
        ws.cell(row=r, column=3, value=f'={LK(S(f"valuation.directCap.excludeExpenseIds[{k}]"))}').font = F_BASE
        r += 1
    B.n["dcExIds"] = f"{D}!$C${xfirst}:$C${r-1}"
    for k in range(NE):
        rr = efirst + k
        ws[f"{ecol['dcExcl']}{rr}"] = f'=IF(AND(${ecol["exists"]}{rr}=1,COUNTIF({B["dcExIds"]},${ecol["id"]}{rr})>0),1,0)'
    ws.cell(row=r, column=1, value="dcHasExcl").font = F_BASE
    ws.cell(row=r, column=3, value=f'=IF(SUMPRODUCT(--({B["dcExIds"]}<>""))>0,1,0)').font = F_BASE
    B.name("dcHasExcl", D, "C", r)
    r += 2

    # direct-cap lump-sum adjustments
    put(ws, f"A{r}", "Direct cap: adjustments", F_SUB)
    r += 1
    header_row(ws, r, 1, ["#", "name", "type", "amount", "signed"])
    r += 1
    afirst = r
    for k in range(NA):
        p = f"valuation.directCap.adjustments[{k}]."
        ws.cell(row=r, column=1, value=k).font = F_BASE
        ws.cell(row=r, column=2, value=f'={LK(S(p + "name"))}').font = F_BASE
        ws.cell(row=r, column=3, value=f'={LK(S(p + "type"))}').font = F_BASE
        ws.cell(row=r, column=4, value=f'={LK(S(p + "amount"))}').font = F_BASE
        ws.cell(row=r, column=5, value=f'=IF(D{r}="",0,IF(C{r}="deduction",-D{r},D{r}))').font = F_BASE
        r += 1
    B.n["adjName"] = f"{D}!$B${afirst}:$B${r-1}"
    B.n["adjSigned"] = f"{D}!$E${afirst}:$E${r-1}"
    r += 1

    # vacant suites
    put(ws, f"A{r}", "Vacant suites (rentRoll.vacantSuites)", F_SUB)
    r += 1
    header_row(ws, r, 1, ["#"] + [f for f, _ in VAC_FIELDS])
    r += 1
    B.n["V_row0"] = r
    for v in range(NV):
        ws.cell(row=r, column=1, value=v).font = F_BASE
        for j, (f, p) in enumerate(VAC_FIELDS):
            ws.cell(row=r, column=2 + j, value=f'={LK(S(f"rentRoll.vacantSuites[{v}].{p}"))}').font = F_BASE
        r += 1
    B.n["V_col"] = {f: CL(2 + j) for j, (f, _) in enumerate(VAC_FIELDS)}
    r += 1

    # leases (wide)
    put(ws, f"A{r}", "Leases (rentRoll.leases) — one row per lease; schedule, free rent, exclusions, options inline", F_SUB)
    r += 1
    header_row(ws, r, 1, ["#"] + [f for f, _ in LEASE_FIELDS])
    r += 1
    B.n["L_row0"] = r
    lcol = {f: CL(2 + j) for j, (f, _) in enumerate(LEASE_FIELDS)}
    B.n["L_col"] = lcol
    for i in range(NL):
        ws.cell(row=r, column=1, value=i).font = F_BASE
        for f, p in LEASE_FIELDS:
            ws[f"{lcol[f]}{r}"] = f'={LK(S(f"rentRoll.leases[{i}].{p}"))}'
        r += 1
    # inclusion masks: expense row k, lease i -> 1 unless lease i excludes the item
    for i in range(NL):
        lr = B["L_row0"] + i
        xr = f"{D}!${lcol['x0']}${lr}:${lcol[f'x{MX-1}']}${lr}"
        c = CL(inc0 + i)
        for k in range(NE):
            rr = efirst + k
            ws[f"{c}{rr}"] = f'=IF(COUNTIF({xr},${ecol["id"]}{rr})>0,0,1)'
    B.n["L_hasExcl"] = None
    for row in ws.iter_rows(min_row=3):
        for c in row:
            if c.font is None or c.font == Font():
                c.font = F_BASE
    ws.freeze_panes = "B4"
    return ws


# =====================================================================
# SpaceParams: one row per space (leases 1..NL, then vacant suites)
# =====================================================================
def build_space_params(B):
    ws = B.sheet("SpaceParams", "7F7F7F")
    SP = "SpaceParams"
    put(ws, "A1", "SpaceParams — per-space parameters (leases, then vacant suites). Formulas only.", F_SUB)
    lc = B["L_col"]
    D = "Data"
    cols = []  # (key, header)

    def C(key):
        return cols.index(key)

    keys = [
        "kind", "src", "exists", "isLease", "label", "sf", "spaceType", "prof", "hasProf",
        # profile
        "mkt0", "T", "D", "p", "renPct", "Fn", "Fr", "tiN", "tiR", "lcN", "lcR", "escR", "freq", "mktNNN", "A",
        # in-place lease
        "mult", "commIdx", "expIdx", "c0", "expiry", "isIP", "t0", "fOK", "p0",
        "optJ", "ov", "mktT0", "optRent", "rate0", "T0", "esc0R", "Fr0", "A0",
        "nSteps", "fs", "fa", "ls", "la", "escMode", "cEscR", "cEscRm", "addM", "cf", "cr0m",
    ] + [f"ss{k}" for k in range(MS)] + [f"sa{k}" for k in range(MS)] + \
        [x for k in range(MF) for x in (f"frs{k}", f"fre{k}", f"frp{k}", f"frr{k}")] + [
        "isNNN", "isMG", "share", "admin", "hasExcl", "hasCap", "capC", "capBasis", "capBase",
        "mgOK", "mgBase", "needRB", "tiAmt", "tiFm", "lcAmt", "lcFm", "inclCol",
    ]
    cols = keys
    col = {k: CL(1 + j) for j, k in enumerate(keys)}
    B.n["SP_col"] = col
    header_row(ws, 4, 1, keys)
    for j in range(len(keys)):
        ws.column_dimensions[CL(1 + j)].width = 11
    ws.column_dimensions[col["label"]].width = 26
    ws.freeze_panes = "F5"
    B.n["SP_row0"] = 5
    h = B["h"]
    gm_row = "MonthlyCF!$F$4:$" + LASTC + "$4"

    for s in range(NS):
        r = 5 + s
        isL = s < NL
        def P(k):
            return f"${col[k]}{r}"
        def put_(k, f):
            c = ws[f"{col[k]}{r}"]
            c.value = f
            c.font = F_BASE
        if isL:
            i = s
            lr = B["L_row0"] + i
            L = lambda f: f"{D}!${lc[f]}${lr}"
            put_("kind", "lease")
            put_("src", i + 1)
            put_("exists", f'=IF({L("id")}<>"",1,0)')
            put_("isLease", 1)
            put_("label", f'=IF({P("exists")}=1,{L("id")}&" "&{L("tenant")},"")')
            put_("sf", f'=IF({P("exists")}=1,{L("sf")},0)')
            put_("spaceType", f'={L("spaceType")}')
        else:
            v = s - NL
            vr = B["V_row0"] + v
            vc = B["V_col"]
            V = lambda f: f"{D}!${vc[f]}${vr}"
            put_("kind", "vacant")
            put_("src", v + 1)
            put_("exists", f'=IF({V("sf")}<>"",1,0)')
            put_("isLease", 0)
            put_("label", f'=IF({P("exists")}=1,"Vacant "&{V("suite")},"")')
            put_("sf", f'=IF({P("exists")}=1,{V("sf")},0)')
            put_("spaceType", f'={V("spaceType")}')
        # profileFor(): exact spaceType key, else the first profile
        put_("prof", f'=IF(OR({P("exists")}=0,{B["nProf"]}=0),0,IF({P("spaceType")}="",1,IFERROR(MATCH({P("spaceType")},{B["profKeys"]},0),1)))')
        put_("hasProf", f'=IF({P("prof")}>0,1,0)')
        PF = lambda f: f'INDEX({B["P_" + f]},{P("prof")})'
        PFn = lambda f, d: f'IF({P("hasProf")}=0,{d},IF({PF(f)}="",{d},{PF(f)}))'
        put_("mkt0", f'=IF({P("hasProf")}=0,0,IF({PF("unit")}="per_sf_per_month",{PF("amt")}*{P("sf")},{PF("amt")}*{P("sf")}/12))')
        put_("T", f'=MAX(1,{PFn("term", 1)})')
        put_("D", f'={PFn("down", 0)}')
        put_("p", f'={PFn("renProb", 0)}/100')
        put_("renPct", f'={PFn("renPct", 100)}/100')
        put_("Fn", f'=MIN({PFn("nFree", 0)},{P("T")})')
        put_("Fr", f'=MIN({PFn("rFree", 0)},{P("T")})')
        put_("tiN", f'={PFn("nTI", 0)}')
        put_("tiR", f'={PFn("rTI", 0)}')
        put_("lcN", f'={PFn("nLC", 0)}/100')
        put_("lcR", f'={PFn("rLC", 0)}/100')
        cpi_p = f'MIN(IF({PF("cpiCap")}="",1E+300,{PF("cpiCap")}),MAX(IF({PF("cpiFloor")}="",-1E+300,{PF("cpiFloor")}),{B["cpiModel"]}))'
        put_("escR", f'=IF({P("hasProf")}=0,0,IF({PF("escType")}="fixed_percent",IF({PF("escRate")}="",0,{PF("escRate")})/100,IF({PF("escType")}="cpi",{cpi_p}/100,0)))')
        put_("freq", f'=MAX(1,{PFn("escFreq", 12)})')
        put_("mktNNN", f'=IF({P("hasProf")}=0,0,IF(OR({PF("struct")}="",{PF("struct")}="nnn",{PF("struct")}="nn"),1,0))')
        put_("A", "=" + ANNUITY(P("T"), P("escR"), P("freq")))
        put_("feeS" if False else "isIP", f'=IF(AND({P("isLease")}=1,{P("exists")}=1,{B["feeSimple"]}=0),1,0)')
        if isL:
            put_("mult", f'=IF({L("unit")}="per_sf_per_month",{P("sf")},IF({L("unit")}="per_sf_per_year",{P("sf")}/12,IF({L("unit")}="total_per_month",1,1/12)))')
            put_("commIdx", f'=IF({P("exists")}=1,{DK(L("comm"))}-{B["startK"]},0)')
            put_("expIdx", f'=IF({P("exists")}=1,{DK(L("exp"))}-{B["startK"]},-1)')
        else:
            put_("mult", 0)
            put_("commIdx", 0)
            put_("expIdx", -1)
        put_("c0", f'=MAX(0,{P("commIdx")})')
        put_("expiry", f'={P("expIdx")}+1')
        put_("t0", f'=IF({P("isIP")}=1,{P("expiry")},0)')
        put_("fOK", f'=IF(AND({P("exists")}=1,{P("hasProf")}=1,{P("t0")}<{h}),1,0)')
        put_("p0", f'=IF({P("isLease")}=1,{P("p")},0)')
        put_("mktT0", f'=IF({P("fOK")}=1,{P("mkt0")}*INDEX({gm_row},{P("t0")}+1),0)')
        if isL:
            types = f"{D}!${lc['ot0']}${lr}:${lc[f'ot{MO-1}']}${lr}"
            put_("optJ", f'=IF({P("isIP")}=0,0,IFERROR(MATCH("renewal",{types},0),0))')
            def OPT(prefix):
                return f'INDEX({D}!${lc[prefix + "0"]}${lr}:${lc[prefix + str(MO-1)]}${lr},{P("optJ")})'
            # resolveRenewalOption(): only stated-rent options (fixed / percent_of_market) override
            put_("ov", f'=IF({P("optJ")}=0,0,IF(AND({OPT("ob")}="fixed",{OPT("of")}<>""),1,IF(AND({OPT("ob")}="percent_of_market",{OPT("op")}<>""),2,0)))')
            put_("optRent", f'=IF({P("ov")}=1,{OPT("of")}*{P("mult")},IF({P("ov")}=2,{OPT("op")}/100*{P("mktT0")},0))')
            put_("T0", f'=IF({P("ov")}>0,MAX(1,IF({OPT("om")}="",{P("T")},{OPT("om")})),{P("T")})')
        else:
            put_("optJ", 0)
            put_("ov", 0)
            put_("optRent", 0)
            put_("T0", f'={P("T")}')
        put_("rate0", f'=IF({P("ov")}>0,MIN({P("optRent")},{P("mktT0")}),{P("renPct")}*{P("mktT0")})')
        put_("esc0R", f'=IF({P("ov")}=1,0,{P("escR")})')
        put_("Fr0", f'=MIN(IF({P("hasProf")}=0,0,IF({PF("rFree")}="",0,{PF("rFree")})),{P("T0")})')
        put_("A0", "=" + ANNUITY(P("T0"), P("esc0R"), P("freq")))
        # contract rent (contractRate)
        if isL:
            for k in range(MS):
                put_(f"ss{k}", f'=IF({L(f"st{k}")}="",{BIG},{DK(L(f"st{k}"))}-{B["startK"]})')
                put_(f"sa{k}", f'=IF({L(f"amt{k}")}="",0,{L(f"amt{k}")}*{P("mult")})')
            ss = f'{P("ss0")}:{P(f"ss{MS-1}")}'
            sa = f'{P("sa0")}:{P(f"sa{MS-1}")}'
            put_("nSteps", f'=COUNTIF({ss},"<{BIG}")')
            put_("fs", f'={P("ss0")}')
            put_("fa", f'={P("sa0")}')
            put_("ls", f'=IF({P("nSteps")}=0,{BIG},INDEX({ss},{P("nSteps")}))')
            put_("la", f'=IF({P("nSteps")}=0,0,INDEX({sa},{P("nSteps")}))')
            put_("escMode", f'=IF(OR({L("escType")}="fixed_percent",{L("escType")}="cpi"),1,IF({L("escType")}="fixed_amount",2,0))')
            cpi_c = lambda base: f'MIN(IF({L("cpiCap")}="",1E+300,{L("cpiCap")}),MAX(IF({L("cpiFloor")}="",-1E+300,{L("cpiFloor")}),{base}))'
            put_("cEscR", f'=IF({L("escType")}="fixed_percent",IF({L("escRate")}="",0,{L("escRate")})/100,IF({L("escType")}="cpi",{cpi_c(B["cpiModel"])}/100,0))')
            put_("cEscRm", f'=IF({L("escType")}="fixed_percent",IF({L("escRate")}="",0,{L("escRate")})/100,IF({L("escType")}="cpi",{cpi_c("0")}/100,0))')
            put_("addM", f'=IF({L("escAmt")}="",0,{L("escAmt")})*{P("mult")}')
            put_("cf", f'=MAX(1,IF({L("escFreq")}="",12,{L("escFreq")}))')
            # in-place rent at month 0 for lease metrics (ctx0 has no CPI assumption -> 0%, clamped)
            put_("cr0m", (f'=IF({P("exists")}=0,0,IF(AND({P("escMode")}>0,0>={P("ls")}),'
                          f'IF({P("escMode")}=2,{P("la")}+{P("addM")}*INT((0-{P("ls")})/{P("cf")}),{P("la")}*(1+{P("cEscRm")})^INT((0-{P("ls")})/{P("cf")})),'
                          f'IF(0<{P("fs")},{P("fa")},LOOKUP(0,{ss},{sa}))))'))
            for k in range(MF):
                put_(f"frs{k}", f'=IF({L(f"frs{k}")}="",{BIG},{DK(L(f"frs{k}"))}-{B["startK"]})')
                put_(f"fre{k}", f'=IF({L(f"fre{k}")}="",-1,{DK(L(f"fre{k}"))}-{B["startK"]})')
                put_(f"frp{k}", f'=IF({L(f"frp{k}")}="",1,{L(f"frp{k}")}/100)')
                put_(f"frr{k}", f'=IF({L(f"frr{k}")}=TRUE,1,0)')
            put_("isNNN", f'=IF(OR({L("struct")}="nnn",{L("struct")}="nn"),1,0)')
            put_("isMG", f'=IF({L("struct")}="mg",1,0)')
            put_("share", f'=IF({P("exists")}=0,0,IF({L("share")}="",{P("sf")}/{B["bsf"]},{L("share")}/100))')
            put_("admin", f'=IF({L("admin")}="",0,{L("admin")}/100)')
            xr = f"{D}!${lc['x0']}${lr}:${lc[f'x{MX-1}']}${lr}"
            put_("hasExcl", f'=IF(SUMPRODUCT(--({xr}<>""))>0,1,0)')
            put_("hasCap", f'=IF(AND({P("isIP")}=1,{P("isNNN")}=1,{L("capPct")}<>""),1,0)')
            put_("capC", f'=IF({L("capPct")}="",0,{L("capPct")}/100)')
            put_("capBasis", f'=IF({L("capBasis")}="non_cumulative",1,IF({L("capBasis")}="cumulative",2,3))')
            # capBase references the lease's own CTRL row at month 0 (filled by SpaceCalc builder)
            put_("capBase", 0)
            put_("mgOK", f'=IF(AND({P("isMG")}=1,OR({L("stop")}<>"",{L("baseAmt")}<>"",{L("baseYear")}<>"")),1,0)')
            put_("mgBase", 0)  # filled by SpaceCalc builder (needs RB at month 0)
            put_("needRB", f'=IF(AND({P("isIP")}=1,OR({P("hasExcl")}=1,{P("admin")}<>0,{P("isMG")}=1)),1,0)')
            put_("tiAmt", f'=IF({P("isIP")}=0,0,IF({L("tiTot")}<>"",{L("tiTot")},IF({L("tiPSF")}<>"",{L("tiPSF")}*{P("sf")},0)))')
            put_("tiFm", f'=IF({L("tiDate")}<>"",MAX(0,{DK(L("tiDate"))}-{B["startK"]}),MAX(1,{P("c0")}))')
            put_("lcAmt", 0)  # filled by SpaceCalc builder (percentOfTotalRent needs the CR row)
            put_("lcFm", f'=IF({L("lcDate")}<>"",MAX(0,{DK(L("lcDate"))}-{B["startK"]}),MAX(1,{P("c0")}))')
            put_("inclCol", B["E_inclCol0"] + i)
        else:
            for k in ["nSteps", "escMode", "cEscR", "cEscRm", "addM", "cr0m", "isNNN", "isMG", "share", "admin",
                      "hasExcl", "hasCap", "capC", "capBase", "mgOK", "mgBase", "needRB", "tiAmt", "lcAmt", "la", "fa"]:
                put_(k, 0)
            put_("fs", BIG)
            put_("ls", BIG)
            put_("cf", 12)
            put_("capBasis", 3)
            put_("tiFm", -1)
            put_("lcFm", -1)
            put_("inclCol", 0)
            for k in range(MS):
                put_(f"ss{k}", BIG)
                put_(f"sa{k}", 0)
            for k in range(MF):
                put_(f"frs{k}", BIG)
                put_(f"fre{k}", -1)
                put_(f"frp{k}", 0)
                put_(f"frr{k}", 0)
    return ws


# =====================================================================
# SpaceCalc: per-space monthly streams
# =====================================================================
BLOCK = ["EL", "N", "DN", "POTG", "FREEG", "OCCG", "R0P", "CR", "IP", "AB", "ABR", "RB", "CTRL", "CEIL",
         "MGR", "POT", "SCHED", "FREE", "OCC", "RSF", "TI", "LC", "CVM"]
BLOCK_DESC = {
    "EL": "rollover events after the first (probability mass)",
    "N": "new-tenant lease starts (mass)",
    "DN": "downtime months (mass)",
    "POTG": "potential rent, rollover leases after the first event",
    "FREEG": "free rent, rollover leases after the first event",
    "OCCG": "occupancy mass, rollover leases after the first event",
    "R0P": "first renewal branch rent (option or market)",
    "CR": "in-place contract rent (unabated)",
    "IP": "in-place lease active (1/0)",
    "AB": "abatement factor (1 = no free rent)",
    "ABR": "abatement also abates reimbursements (1/0)",
    "RB": "lease recoverable expense base (after exclusions)",
    "CTRL": "lease recoverable controllable expenses",
    "CEIL": "expense cap: annual ceiling",
    "MGR": "direct-dollar recoveries (MG, exclusions, admin fee, cap)",
    "POT": "OUT potential base rent",
    "SCHED": "OUT scheduled base rent collected",
    "FREE": "OUT free rent",
    "OCC": "OUT occupied SF",
    "RSF": "OUT SF recovering pro-rata (NNN aggregate)",
    "TI": "OUT tenant improvements",
    "LC": "OUT leasing commissions",
    "CVM": "OUT contract minus market rent",
}
BH = len(BLOCK) + 1  # rows per block incl. title row


def month_header(ws, B, row_m=2, row_h=3):
    put(ws, f"A{row_m}", "month index m", F_BOLD)
    put(ws, f"A{row_h}", "in horizon (m < h)", F_BOLD)
    for m in range(MAXM):
        c = mcol(m)
        ws[f"{c}{row_m}"] = m
        ws[f"{c}{row_m}"].font = F_BOLD
        ws[f"{c}{row_h}"] = f'=IF({c}${row_m}<{B["h"]},1,0)'
        ws[f"{c}{row_h}"].font = F_BASE
        ws.column_dimensions[c].width = 11
    ws.freeze_panes = f"{mcol(0)}4"


def build_space_calc(B, sp_ws):
    ws = B.sheet("SpaceCalc", "7F7F7F")
    put(ws, "A1", "SpaceCalc — monthly streams per space. Rollover is an expected-value recurrence "
                  "equivalent to the engine's two-branch tree (rolloverStreams).", F_SUB)
    month_header(ws, B)
    ws.column_dimensions["A"].width = 30
    ws.column_dimensions["B"].width = 8
    ws.column_dimensions["C"].width = 40
    col = B["SP_col"]
    GM = lambda c: f"MonthlyCF!{c}$4"
    GMR = f"MonthlyCF!$F$4:${LASTC}$4"
    MR = f"$F$2:${LASTC}$2"
    BSF = B["bsf"]
    exp_rows = f"{B['E_row0']}:{B['E_row0'] + NE - 1}"
    e0, e1 = B["E_row0"], B["E_row0"] + NE - 1
    rec_flag = B["E_recAbove"]
    ctl_flag = B["E_ctlAbove"]
    row0 = 5
    B.n["SC_row0"] = row0
    for s in range(NS):
        top = row0 + s * BH
        spr = B["SP_row0"] + s
        P = lambda k: f"SpaceParams!${col[k]}${spr}"
        rw = {k: top + 1 + j for j, k in enumerate(BLOCK)}
        put(ws, f"A{top}", f'=IF({P("label")}="","(space {s+1} unused)",{P("label")})', F_BOLD, fill=FILL_SEC)
        ws[f"B{top}"].fill = FILL_SEC
        ws[f"C{top}"].fill = FILL_SEC
        for k in BLOCK:
            put(ws, f"A{rw[k]}", f"space {s+1}")
            put(ws, f"B{rw[k]}", k)
            put(ws, f"C{rw[k]}", BLOCK_DESC[k], F_NOTE)
        RR = lambda k: f"$F${rw[k]}:${LASTC}${rw[k]}"
        # wire the params that depend on this block's rows
        if s < NL:
            spc = lambda k: sp_ws[f"{col[k]}{spr}"]
            spc("capBase").value = (f'=IF({P("hasCap")}=0,0,IF(Data!${B["L_col"]["capBase"]}${B["L_row0"]+s}<>"",'
                                    f'Data!${B["L_col"]["capBase"]}${B["L_row0"]+s},SpaceCalc!$F${rw["CTRL"]}*12))')
            Lr = lambda f: f'Data!${B["L_col"][f]}${B["L_row0"]+s}'
            spc("mgBase").value = (f'=IF({P("mgOK")}=0,0,IF({Lr("stop")}<>"",{Lr("stop")}*{P("sf")}/12/{P("share")},'
                                   f'IF({Lr("baseAmt")}<>"",{Lr("baseAmt")}/12,'
                                   f'SpaceCalc!$F${rw["RB"]}/(1+{B["g1Exp"]}/100)^MAX(0,{B["startYear"]}-{Lr("baseYear")}))))')
            spc("lcAmt").value = (f'=IF({P("isIP")}=0,0,IF({Lr("lcPct")}<>"",{Lr("lcPct")}/100*SUMPRODUCT(SpaceCalc!{RR("CR")},SpaceCalc!{RR("IP")}),'
                                  f'IF({Lr("lcTot")}<>"",{Lr("lcTot")},IF({Lr("lcPSF")}<>"",{Lr("lcPSF")}*{P("sf")},0))))')
        incl = CL(B["E_inclCol0"] + s) if s < NL else None
        for m in range(MAXM):
            c = mcol(m)
            mm = f"{c}$2"
            inH = f"{c}$3"
            cell = lambda k: f"{c}{rw[k]}"
            def W(k, f):
                ws[f"{c}{rw[k]}"] = "=" + f
            fOK, t0, T0, T, D, p, p0 = P("fOK"), P("t0"), P("T0"), P("T"), P("D"), P("p"), P("p0")
            # rollover event recurrence: events after the first come T0 after the first renewal start,
            # T after every later renewal start or new-tenant start
            W("EL", f'IF({fOK}=1,IF({mm}={t0}+{T0},{p0},0)+IF({mm}-{T}>=0,{p}*INDEX({RR("EL")},{mm}-{T}+1)+INDEX({RR("N")},{mm}-{T}+1),0),0)')
            W("N", f'IF({fOK}=1,IF({mm}-{D}>=0,(1-{p0})*IF({mm}-{D}={t0},1,0)+(1-{p})*INDEX({RR("EL")},{mm}-{D}+1),0),0)')
            W("DN", f'IF(AND({fOK}=1,{D}>0),(1-{p0})*IF(AND({mm}>={t0},{mm}<{t0}+{D}),1,0)+(1-{p})*SUM(INDEX({RR("EL")},MAX(1,{mm}-{D}+2)):INDEX({RR("EL")},{mm}+1)),0)')
            a = f"MAX(1,{mm}-{T}+2)"
            b = f"{mm}+1"
            win = lambda rowk, aa: f"INDEX({RR(rowk)},{aa}):INDEX({RR(rowk)},{b})"
            gmw = lambda aa: f"INDEX({GMR},{aa}):INDEX({GMR},{b})"
            escw = lambda aa: f'(1+{P("escR")})^INT(({mm}-INDEX({MR},{aa}):INDEX({MR},{b}))/{P("freq")})'
            W("POTG", f'IF({fOK}=1,{P("mkt0")}*SUMPRODUCT(({p}*{P("renPct")}*{win("EL", a)}+{win("N", a)})*{gmw(a)}*{escw(a)}),0)')
            aR = f'MAX(1,{mm}-{P("Fr")}+2)'
            aN = f'MAX(1,{mm}-{P("Fn")}+2)'
            W("FREEG", f'IF({fOK}=1,{P("mkt0")}*(IF({P("Fr")}>0,{p}*{P("renPct")}*SUMPRODUCT({win("EL", aR)},{gmw(aR)},{escw(aR)}),0)'
                       f'+IF({P("Fn")}>0,SUMPRODUCT({win("N", aN)},{gmw(aN)},{escw(aN)}),0)),0)')
            W("OCCG", f'IF({fOK}=1,{p}*SUM({win("EL", a)})+SUM({win("N", a)}),0)')
            W("R0P", f'IF(AND({fOK}=1,{mm}>={t0},{mm}<{t0}+{T0}),{p0}*{P("rate0")}*(1+{P("esc0R")})^INT(({mm}-{t0})/{P("freq")}),0)')
            if s < NL:
                ssr = f'SpaceParams!${col["ss0"]}${spr}:${col[f"ss{MS-1}"]}${spr}'
                sar = f'SpaceParams!${col["sa0"]}${spr}:${col[f"sa{MS-1}"]}${spr}'
                W("CR", (f'IF({P("exists")}=0,0,IF(AND({P("escMode")}>0,{mm}>={P("ls")}),'
                         f'IF({P("escMode")}=2,{P("la")}+{P("addM")}*INT(({mm}-{P("ls")})/{P("cf")}),{P("la")}*(1+{P("cEscR")})^INT(({mm}-{P("ls")})/{P("cf")})),'
                         f'IF({mm}<{P("fs")},{P("fa")},LOOKUP({mm},{ssr},{sar}))))'))
                W("IP", f'IF(AND({P("isIP")}=1,{mm}>={P("c0")},{mm}<{P("expiry")}),1,0)')
                prod = "*".join(f'(1-IF(AND({P(f"frs{k}")}<={mm},{mm}<={P(f"fre{k}")}),{P(f"frp{k}")},0))' for k in range(MF))
                W("AB", f'IF({cell("IP")}=1,{prod},1)')
                anyr = ",".join(f'AND({P(f"frs{k}")}<={mm},{mm}<={P(f"fre{k}")},{P(f"frr{k}")}=1)' for k in range(MF))
                W("ABR", f'IF(AND({cell("IP")}=1,OR({anyr})),1,0)')
                W("RB", f'IF({P("needRB")}=1,SUMPRODUCT(ExpCalc!{c}${e0}:{c}${e1},{rec_flag},Data!${incl}${e0}:${incl}${e1}),0)')
                W("CTRL", f'IF({P("hasCap")}=1,SUMPRODUCT(ExpCalc!{c}${e0}:{c}${e1},{ctl_flag},Data!${incl}${e0}:${incl}${e1}),0)')
                prev = f"{mcol(m-1)}{rw['CEIL']}" if m > 0 else "0"
                W("CEIL", (f'IF({P("hasCap")}=0,0,IF({P("capBasis")}=1,IF({mm}<12,{P("capBase")},'
                           f'IF(MOD({mm},12)=0,MIN(INDEX({RR("CTRL")},{mm}-11)*12,INDEX({RR("CEIL")},{mm}-11))*(1+{P("capC")}),{prev})),'
                           f'IF({P("capBasis")}=2,{P("capBase")}*(1+{P("capC")}*INT({mm}/12)),{P("capBase")}*(1+{P("capC")})^INT({mm}/12))))'))
                reimb = f'NOT(AND({cell("ABR")}=1,{cell("AB")}<1))'
                W("MGR", (f'{inH}*IF(AND({cell("IP")}=1,{reimb}),'
                          f'IF({P("isNNN")}=1,IF({P("hasExcl")}=1,{P("share")}*{cell("RB")},0)+{P("admin")}*{P("share")}*{cell("RB")}'
                          f'-IF({P("hasCap")}=1,{P("share")}*MAX(0,{cell("CTRL")}-{cell("CEIL")}/12)*(1+{P("admin")}),0),0)'
                          f'+IF({P("mgOK")}=1,MAX(0,{P("share")}*({cell("RB")}-{P("mgBase")}))*(1+{P("admin")}),0),0)'))
                rsf_ip = (f'IF(AND({cell("IP")}=1,{reimb},{P("isNNN")}=1,{P("hasExcl")}=0),{P("share")}*{BSF},0)')
            else:
                for k in ("CR", "IP", "ABR", "RB", "CTRL", "CEIL", "MGR"):
                    W(k, "0")
                W("AB", "1")
                rsf_ip = "0"
            o0 = f'IF(AND({fOK}=1,{mm}>={t0},{mm}<{t0}+{T0}),{p0},0)'
            free0 = f'IF({mm}-{t0}<{P("Fr0")},{cell("R0P")},0)'
            W("POT", f'{inH}*({cell("CR")}*{cell("IP")}+{cell("POTG")}+{cell("R0P")}+{cell("DN")}*{P("mkt0")}*{GM(c)})')
            W("SCHED", f'{inH}*({cell("CR")}*{cell("AB")}*{cell("IP")}+{cell("POTG")}-{cell("FREEG")}+{cell("R0P")}-{free0})')
            W("FREE", f'{inH}*({cell("CR")}*(1-{cell("AB")})*{cell("IP")}+{cell("FREEG")}+{free0})')
            W("OCC", f'{inH}*{P("sf")}*({cell("IP")}+{cell("OCCG")}+{o0})')
            W("RSF", f'{inH}*({rsf_ip}+{P("mktNNN")}*{P("sf")}*({cell("OCCG")}+{o0}))')
            W("TI", (f'{inH}*({P("sf")}*({P("tiR")}*{p}*{cell("EL")}+{P("tiN")}*{cell("N")})'
                     f'+IF(AND({fOK}=1,{mm}={t0}),{p0}*{P("tiR")}*{P("sf")},0)'
                     f'+IF(AND({P("tiAmt")}>0,{mm}={P("tiFm")}),{P("tiAmt")},0))'))
            W("LC", (f'{inH}*({P("mkt0")}*{GM(c)}*{P("A")}*({P("lcR")}*{p}*{P("renPct")}*{cell("EL")}+{P("lcN")}*{cell("N")})'
                     f'+IF(AND({fOK}=1,{mm}={t0}),{p0}*{P("lcR")}*{P("rate0")}*{P("A0")},0)'
                     f'+IF(AND({P("lcAmt")}>0,{mm}={P("lcFm")}),{P("lcAmt")},0))'))
            W("CVM", f'{inH}*{cell("IP")}*{P("hasProf")}*({cell("CR")}-{P("mkt0")}*{GM(c)})')
    B.n["SC_last"] = row0 + NS * BH - 1
    for row in ws.iter_rows(min_row=row0, max_row=B["SC_last"], min_col=M0, max_col=M0 + MAXM - 1):
        for cc in row:
            cc.font = F_BASE
            cc.number_format = NF_NUM2
    return ws


# =====================================================================
# ExpCalc: monthly expenses per item (expensesAt)
# =====================================================================
def build_exp_calc(B):
    ws = B.sheet("ExpCalc", "7F7F7F")
    put(ws, "A1", "ExpCalc — monthly operating expenses by item (expensesAt). Property-tax reassessment applied when set.", F_SUB)
    month_header(ws, B)
    ws.column_dimensions["A"].width = 28
    ws.column_dimensions["B"].width = 10
    e0 = B["E_row0"]
    D = "Data"
    # Rows mirror Data's expense table rows exactly so SUMPRODUCTs line up.
    for k in range(NE):
        r = e0 + k
        dr = e0 + k
        def E(f):
            return B["E_" + f].split(":")[0].replace(f"${B['E_row0']}", f"${dr}")
        put(ws, f"A{r}", f'=IF({E("exists")}=1,{E("id")}&" "&{E("name")},"")')
        put(ws, f"B{r}", f"item {k+1}", F_NOTE)
        for m in range(MAXM):
            c = mcol(m)
            ws[f"{c}{r}"] = (f'=IF({E("fixed")}=1,{E("annualModel")}/12*IF({E("ovr")}="",MonthlyCF!{c}$5,'
                             f'(1+{E("ovr")}/100)^INT({c}$2/12)),0)')
            ws[f"{c}{r}"].font = F_BASE
            ws[f"{c}{r}"].number_format = NF_NUM2
    agg0 = e0 + NE + 2
    aggs = [("ABOVE", B["E_above"], "above-the-line expenses excl. % of EGR"),
            ("RECOV", B["E_recAbove"], "recoverable above-the-line"),
            ("BELOW", B["E_below"], "below-the-line items"),
            ("DCEXCL", None, "direct-cap excluded items (above the line)")]
    for j, (k, flag, desc) in enumerate(aggs):
        r = agg0 + j
        put(ws, f"A{r}", desc, F_BOLD)
        put(ws, f"B{r}", k, F_BOLD)
        B.n["EX_" + k] = r
        for m in range(MAXM):
            c = mcol(m)
            rng = f"{c}${e0}:{c}${e0+NE-1}"
            if flag:
                f = f"=SUMPRODUCT({rng},{flag})"
            else:
                f = f"=SUMPRODUCT({rng},{B['E_above']},{B['E_dcExcl']})"
            ws[f"{c}{r}"] = f
            ws[f"{c}{r}"].font = F_BASE
            ws[f"{c}{r}"].number_format = NF_NUM2
    # management fee % of EGR and whether it is recoverable
    r = agg0 + len(aggs) + 1
    put(ws, f"A{r}", "management fee (% of EGR, as fraction)", F_BOLD)
    ws[f"C{r}"] = f'=SUMIF({B["E_isPct"]},1,{B["E_amt"]})/100'
    B.name("mgmtPct", "ExpCalc", "C", r)
    put(ws, f"A{r+1}", "management fee recoverable (1/0)", F_BOLD)
    ws[f"C{r+1}"] = f'=IF(SUMPRODUCT({B["E_isPct"]},--({B["E_rec"]}=TRUE))>0,1,0)'
    B.name("mgmtRec", "ExpCalc", "C", r + 1)
    return ws


# =====================================================================
# MonthlyCF
# =====================================================================
CF_ROWS = [
    # key, label
    ("POT", "Potential base rent"), ("SCHED", "Scheduled base rent (collected)"), ("FREE", "Free rent"),
    ("OCC", "Occupied SF"), ("RSF", "SF recovering pro-rata"), ("MGR", "Direct-dollar recoveries"),
    ("TI", "Tenant improvements"), ("LC", "Leasing commissions"), ("CVM", "Contract minus market rent"),
    ("ABOVE", "Operating expenses (fixed, above the line)"), ("RECOV", "Recoverable expenses"),
    ("BELOW", "Below-the-line items"), ("RFRAC", "Recovery fraction"), ("FIXREC", "Fixed recoveries"),
    ("DENOM", "Mgmt-fee gross-up denominator"), ("EGRG", "Gross revenue before vacancy"),
    ("RECOVERIES", "Expense recoveries"), ("EXPVAC", "Explicit vacancy (downtime)"),
    ("GV", "General vacancy loss"), ("CL", "Credit loss"), ("EGR", "Effective gross revenue"),
    ("MGMT", "Management fee"), ("NOI", "Net operating income"), ("CF", "Cash flow before debt"),
    (None, None),
    ("HOLD", "In hold (m < H)"), ("TPV", "Discount time (years)"), ("DF", "Discount factor @ DCF rate"),
    ("MTMDF", "Discount factor @ mark-to-market rate"), ("NTDF", "Discount factor @ near-term rate"),
    (None, None),
    ("BALBEG", "Loan balance, beginning"), ("DS", "Debt service"), ("BAL", "Loan balance, ending"),
    (None, None),
    ("CFU", "Unlevered return vector (j = 0..H)"), ("CFL", "Levered return vector (j = 0..H)"),
]


def build_monthly(B):
    ws = B.sheet("MonthlyCF", "7F7F7F")
    put(ws, "A1", "MonthlyCF — property cash flow by month (buildModel), discounting, debt, return vectors", F_SUB)
    month_header(ws, B)
    ws.column_dimensions["A"].width = 42
    ws.column_dimensions["B"].width = 10
    put(ws, "A4", "Market rent growth factor (growthFactor)", F_BOLD)
    put(ws, "A5", "Expense growth factor", F_BOLD)
    put(ws, "A6", "Analysis year", F_BOLD)
    for m in range(MAXM):
        c = mcol(m)
        if m == 0:
            ws[f"{c}4"] = 1
            ws[f"{c}5"] = 1
        else:
            p = mcol(m - 1)
            ws[f"{c}4"] = f'=IF(MOD({c}$2,12)=0,{p}4*(1+INDEX({B["yrMkt"]},{c}$2/12)/100),{p}4)'
            ws[f"{c}5"] = f'=IF(MOD({c}$2,12)=0,{p}5*(1+INDEX({B["yrExp"]},{c}$2/12)/100),{p}5)'
        ws[f"{c}6"] = f"=INT({c}$2/12)+1"
        for rr in (4, 5, 6):
            ws[f"{c}{rr}"].font = F_BASE
    rows = {}
    r = 8
    for k, lab in CF_ROWS:
        if k:
            rows[k] = r
            put(ws, f"A{r}", lab, F_BOLD if k in ("NOI", "CF", "EGR") else F_BASE)
            put(ws, f"B{r}", k, F_NOTE)
        r += 1
    B.n["CF"] = rows
    SC0, SC1 = 5, 5 + NS * BH - 1
    bsf = B["bsf"]
    gv = f'IF({B["gvPct"]}="",0,{B["gvPct"]})/100'
    cl = f'IF({B["clPct"]}="",0,{B["clPct"]})/100'
    H = B["H"]
    hasDcf = B["hasDcf"]
    timing_annual = f'{B["timing"]}="annual"'
    mid = f'{B["convention"]}="mid"'
    # debt parameters (Valuation sheet names are created later; use Data refs here)
    loan = "LOAN_AMT"
    for m in range(MAXM):
        c = mcol(m)
        mm = f"{c}$2"
        inH = f"{c}$3"
        g = lambda k: f"{c}{rows[k]}"
        def W(k, f, nf=NF_NUM2):
            ws[f"{c}{rows[k]}"] = "=" + f
            ws[f"{c}{rows[k]}"].font = F_BASE
            ws[f"{c}{rows[k]}"].number_format = nf
        for k in ("POT", "SCHED", "FREE", "OCC", "RSF", "MGR", "TI", "LC", "CVM"):
            W(k, f'SUMIF(SpaceCalc!$B${SC0}:$B${SC1},"{k}",SpaceCalc!{c}${SC0}:{c}${SC1})')
        for k in ("ABOVE", "RECOV", "BELOW"):
            W(k, f"{inH}*ExpCalc!{c}${B['EX_' + k]}")
        W("RFRAC", f'IF(N({bsf})=0,0,MIN(1,{g("RSF")}/{bsf}))', NF_PCT)
        W("FIXREC", f'{g("RFRAC")}*{g("RECOV")}+{g("MGR")}')
        W("DENOM", f'IF(1-IF({B["mgmtRec"]}=1,{g("RFRAC")}*{B["mgmtPct"]},0)<=0,1,1-IF({B["mgmtRec"]}=1,{g("RFRAC")}*{B["mgmtPct"]},0))', "0.0000")
        W("EGRG", f'({g("SCHED")}+{g("FIXREC")})/{g("DENOM")}')
        W("RECOVERIES", f'{g("EGRG")}-{g("SCHED")}')
        W("EXPVAC", f'{g("POT")}-{g("SCHED")}-{g("FREE")}')
        W("GV", f'{inH}*MAX(0,{gv}*({g("POT")}+{g("RECOVERIES")})-{g("EXPVAC")})')
        W("CL", f'{cl}*MAX(0,{g("EGRG")}-{g("GV")})')
        W("EGR", f'{g("EGRG")}-{g("GV")}-{g("CL")}')
        W("MGMT", f'{inH}*{B["mgmtPct"]}*{g("EGRG")}')
        W("NOI", f'{g("EGR")}-{g("ABOVE")}-{g("MGMT")}')
        W("CF", f'{g("NOI")}-{g("BELOW")}-{g("TI")}-{g("LC")}')
        W("HOLD", f'IF({mm}<{H},1,0)', "0")
        W("TPV", f'IF({timing_annual},INT({mm}/12)+IF({mid},0.5,1),({mm}+IF({mid},0.5,1))/12)', "0.000")
        W("DF", f'IF({hasDcf}=1,1/(1+{B["dr"]}/100)^{g("TPV")},0)', "0.000000")
        W("MTMDF", f'IF({B["hasMTM"]}=1,1/(1+{B["mtmDr"]}/100)^(({mm}+1)/12),0)', "0.000000")
        W("NTDF", f'IF({B["ntDr"]}="",1,1/(1+{B["ntDr"]}/100)^(({mm}+1)/12))', "0.000000")
        # debt (buildDebt): interest-only through IO or with no amortization, then level payment
        prevbal = f"{mcol(m-1)}{rows['BAL']}" if m > 0 else "0"
        W("BALBEG", f'IF(DEBT_OK=0,0,IF({mm}=DEBT_F0,{loan},IF({mm}>DEBT_F0,{prevbal},0)))')
        W("DS", (f'IF(OR(DEBT_OK=0,{mm}<DEBT_F0),0,IF(OR({mm}-DEBT_F0<DEBT_IO,DEBT_AM=""),{g("BALBEG")}*DEBT_I,'
                 f'{g("BALBEG")}*DEBT_I+MIN({g("BALBEG")},DEBT_PMT-{g("BALBEG")}*DEBT_I)))'))
        W("BAL", (f'IF(OR(DEBT_OK=0,{mm}<DEBT_F0),0,IF(OR({mm}-DEBT_F0<DEBT_IO,DEBT_AM=""),{g("BALBEG")},'
                  f'{g("BALBEG")}-MIN({g("BALBEG")},DEBT_PMT-{g("BALBEG")}*DEBT_I)))'))
        # return vectors indexed j = m: j=0 initial outflow, j=1..H operating cash flow, terminal at j=H
        if m == 0:
            W("CFU", "IF(RET_OK=1,-TOTAL_COST,\"\")")
            W("CFL", "IF(AND(RET_OK=1,DEBT_OK=1),-EQUITY0,\"\")")
        else:
            pc = mcol(m - 1)
            W("CFU", f'IF(AND(RET_OK=1,{mm}<={H}),{pc}{rows["CF"]}+IF({mm}={H},TV_NET,0),"")')
            W("CFL", f'IF(AND(RET_OK=1,DEBT_OK=1,{mm}<={H}),{pc}{rows["CF"]}-{pc}{rows["DS"]}+IF({mm}={H},TV_NET-PAYOFF,0),"")')
    return ws


# =====================================================================
# Valuation (scalar outputs)
# =====================================================================
def rowrange(k, B):
    r = B["CF"][k]
    return f"MonthlyCF!$F${r}:${LASTC}${r}"


def build_valuation(B):
    ws = B.sheet("Valuation", "2F5597")
    V = "Valuation"
    ws.column_dimensions["A"].width = 2
    ws.column_dimensions["B"].width = 58
    ws.column_dimensions["C"].width = 18
    for c in "DEFGH":
        ws.column_dimensions[c].width = 16
    put(ws, "B1", "Valuation, Debt & Returns", F_TITLE)
    put(ws, "B2", '="Computed in this workbook from the Tape · "&Data!$C$5', F_NOTE)
    ws["B2"].value = f'="Computed natively in this workbook from the Tape · "&{B["propName"]}'
    mrow = "MonthlyCF!$F$2:$" + LASTC + "$2"
    M = mrow
    R = lambda k: rowrange(k, B)
    H, h = B["H"], B["h"]
    bsf = B["bsf"]

    def SUMM(k, a, bnd):
        """sum of a MonthlyCF row over months a <= m < bnd"""
        return f"SUMPRODUCT(({M}>={a})*({M}<{bnd}),{R(k)})"

    def AT(k, m):
        return f"INDEX({R(k)},{m}+1)"

    r = 4
    lines = []

    def line(key, label, f, nf=NF_USD, bold=False, note=None, name=None):
        nonlocal r
        put(ws, f"B{r}", label, F_BOLD if bold else F_BASE)
        put(ws, f"C{r}", "=" + f if isinstance(f, str) else f, F_BOLD if bold else F_BASE, nf, align=Alignment(horizontal="right"))
        if note:
            put(ws, f"D{r}", note, F_NOTE)
        if key:
            B.name(key, V, "C", r)
            if name:
                B.wb.defined_names[name] = DefinedName(name, attr_text=B[key])
        r += 1

    def sec(t):
        nonlocal r
        r += 1
        section(ws, r, 2, t, 6)
        r += 1

    # ---------- shared: stabilized NOI at market (stabilizedAnnualNOI) and blended market rent
    sec("Market rent and stabilized NOI")
    sc = B["SP_col"]
    sp0, sp1 = B["SP_row0"], B["SP_row0"] + NS - 1
    spr = lambda k: f"SpaceParams!${sc[k]}${sp0}:${sc[k]}${sp1}"
    line("mktSum0", "Market rent, all spaces at own profiles ($/mo, month 0)",
         f"SUMPRODUCT({spr('mkt0')},{spr('hasProf')})")
    line("mktSF", "SF priced at market", f"SUMPRODUCT({spr('sf')},{spr('hasProf')})", NF_NUM)
    line("blend0", "Blended market rent, building ($/mo, month 0)",
         f'IF({B["nProf"]}=0,"",IF({B["mktSF"]}<=0,0,{B["mktSum0"]}/{B["mktSF"]}*{bsf}))')
    p1nnn = f'IF(OR(INDEX({B["P_struct"]},1)="",INDEX({B["P_struct"]},1)="nnn",INDEX({B["P_struct"]},1)="nn"),1,0)'
    line("stabNNN", "First profile recovers NNN (1/0)", f'IF({B["nProf"]}=0,0,{p1nnn})', "0")
    gvcl = f'(IF({B["gvPct"]}="",0,{B["gvPct"]})+IF({B["clPct"]}="",0,{B["clPct"]}))/100'

    def stab(mexpr):
        rent = f'({B["blend0"]}*INDEX(MonthlyCF!$F$4:${LASTC}$4,{mexpr}+1))'
        rec = f'INDEX(ExpCalc!$F${B["EX_RECOV"]}:${LASTC}${B["EX_RECOV"]},{mexpr}+1)'
        abv = f'INDEX(ExpCalc!$F${B["EX_ABOVE"]}:${LASTC}${B["EX_ABOVE"]},{mexpr}+1)'
        den = f'IF(1-IF({B["mgmtRec"]}=1,{B["stabNNN"]}*{B["mgmtPct"]},0)<=0,1,1-IF({B["mgmtRec"]}=1,{B["stabNNN"]}*{B["mgmtPct"]},0))'
        egr = f'(({rent}+{B["stabNNN"]}*{rec})/{den})'
        return f'IF({B["nProf"]}=0,"",({egr}*(1-{gvcl})-{abv}-{B["mgmtPct"]}*{egr})*12)'
    line("stab0", "Stabilized-at-market NOI (annual, today)", stab("0"), bold=True)
    line("stabH", "Stabilized-at-market NOI (annual, at exit month H)", stab(H))

    # ---------- direct cap (computeDirectCap)
    sec("Direct capitalization")
    hasDC = B["hasDC"]
    line("dcExclAmt", "Excluded expenses added back (year 1)", f'IF(AND({hasDC}=1,{B["dcHasExcl"]}=1,{B["dcBasis"]}="year1"),SUMPRODUCT((ExpCalc!$F$2:${LASTC}$2<12)*ExpCalc!$F${B["EX_DCEXCL"]}:${LASTC}${B["EX_DCEXCL"]}),0)')
    basis = B["dcBasis"]
    raw = (f'IF({basis}="year1",{SUMM("NOI", 0, 12)}+{B["dcExclAmt"]},IF({basis}="in_place",{AT("NOI", 0)}*12,'
           f'IF({basis}="stabilized_at_market",{B["stab0"]},IF(OR({basis}="custom",{basis}="trailing12"),{B["dcCustom"]},""))))')
    line("dcRaw", "Basis NOI before vacancy/below-line adjustments", f'IF({hasDC}=0,"",{raw})')
    addgv = f'IF(AND({B["dcGV"]}=FALSE,{B["dcGV"]}<>"",{basis}<>"custom",{basis}<>"trailing12"),{SUMM("GV", 0, 12)}+{SUMM("CL", 0, 12)},0)'
    btl = f'IF({B["dcBTL"]}=TRUE,{SUMM("BELOW", 0, 12)},0)'
    line("dcOK", "Direct cap computable (1/0)", f'IF(AND({hasDC}=1,{B["dcRaw"]}<>""),1,0)', "0")
    line("dcNOI", "Basis NOI", f'IF({B["dcOK"]}=0,"",{B["dcRaw"]}+{addgv}-{btl})', bold=True)
    line("dcCapR", "Cap rate", f'IF({hasDC}=0,"",{B["dcCap"]}/100)', NF_PCT)
    line("dcGross", "Gross capitalized value", f'IF({B["dcOK"]}=0,"",{B["dcNOI"]}/{B["dcCapR"]})', bold=True)
    line("dcMTM", "Plus: mark-to-market (PV of contract vs market)",
         f'IF(AND({B["dcOK"]}=1,{B["hasMTM"]}=1),SUMPRODUCT({R("CVM")},{R("MTMDF")}),0)')
    P_ = f'MIN({B["ntPeriod"]},{h})'
    nt = lambda expr, flag: (f'IF(AND({B["dcOK"]}=1,{B["hasNT"]}=1,{flag}<>FALSE),'
                             f'SUMPRODUCT(({M}<{P_})*({expr})*{R("NTDF")}),0)')
    line("ntLostV", "Less: near-term downtime lost rent", nt(f'{R("POT")}-{R("SCHED")}-{R("FREE")}', B["ntLost"]))
    line("ntFreeV", "Less: near-term free rent", nt(R("FREE"), B["ntFree"]))
    line("ntTIV", "Less: near-term TI", nt(R("TI"), B["ntTI"]))
    line("ntLCV", "Less: near-term LC", nt(R("LC"), B["ntLC"]))
    line("dcAdj", "Plus: lump-sum adjustments (net)", f'IF({B["dcOK"]}=1,SUM({B["adjSigned"]}),0)')
    line("dcValue", "Indicated value — direct cap",
         f'IF({B["dcOK"]}=0,"",{B["dcGross"]}+{B["dcMTM"]}-{B["ntLostV"]}-{B["ntFreeV"]}-{B["ntTIV"]}-{B["ntLCV"]}+{B["dcAdj"]})',
         bold=True)
    line("dcPSF", "  per SF", f'IF({B["dcOK"]}=0,"",{B["dcValue"]}/{bsf})', NF_USD2)

    # ---------- DCF (computeDCF)
    sec("Discounted cash flow")
    hasDcf = B["hasDcf"]
    tvb = f'IF({B["tvBasis"]}="","forward_year",{B["tvBasis"]})'
    line("tvBasisE", "Terminal NOI basis", f'IF({hasDcf}=0,"",{tvb})', None)
    tnoi = (f'IF({B["tvBasisE"]}="forward_year",{SUMM("NOI", H, H + "+12")},IF({B["tvBasisE"]}="trailing_year",'
            f'{SUMM("NOI", H + "-12", H)},{B["stabH"]}))')
    line("tNOIraw", "Terminal NOI", f'IF(OR({hasDcf}=0,{B["tvMethod"]}<>"direct_cap"),"",{tnoi})')
    line("tNOI", "Terminal NOI after below-the-line", f'IF({B["tNOIraw"]}="","",{B["tNOIraw"]}-IF({B["tvBTL"]}=TRUE,{SUMM("BELOW", H, H + "+12")},0))')
    taxrow = f'INDEX(ExpCalc!$F${B["E_row0"]}:${LASTC}${B["E_row0"] + NE - 1},TR_IDX,0)'
    tfrom = f'IF({B["tvBasisE"]}="trailing_year",{H}-12,{H})'
    line("sellerTax", "Seller's terminal-year property tax (reassessment load)",
         f'IF(OR({B["tNOI"]}="",TR_REV=0),0,SUMPRODUCT(({M}>={tfrom})*({M}<{tfrom}+12),{taxrow}))')
    tg = (f'IF({B["tvMethod"]}="direct_cap",IF(TR_REV=1,({B["tNOI"]}+{B["sellerTax"]})/({B["tvCap"]}/100+{B["TR_RATE"]}/100),'
          f'{B["tNOI"]}/({B["tvCap"]}/100)),IF({B["tvMethod"]}="exit_price_psf",{B["tvPSF"]}*{bsf},'
          f'IF({B["tvMethod"]}="fixed_value",{B["tvFixed"]},IF({B["price"]}="","",{B["price"]}*(1+{B["tvAppr"]}/100)^({H}/12)))))')
    line("tvGross0", "Terminal value before unfunded obligations", f'IF({hasDcf}=0,"",{tg})')
    line("dcfOK", "DCF computable (1/0)", f'IF(AND({hasDcf}=1,{B["tvGross0"]}<>""),1,0)', "0")
    line("unfunded", "Unfunded free rent past exit (deducted)",
         f'IF(AND({B["dcfOK"]}=1,{B["tvUnfunded"]}=TRUE),{SUMM("FREE", H, h)},"")')
    line("tvGross", "Terminal value, gross", f'IF({B["dcfOK"]}=0,"",{B["tvGross0"]}-N({B["unfunded"]}))', bold=True)
    sell = f'IF({B["tvSell"]}="",0,{B["tvSell"]})/100'
    line("tvNet", "Terminal value, net of selling costs", f'IF({B["dcfOK"]}=0,"",{B["tvGross"]}*(1-{sell}))')
    line("tvNetR", "  rounded to $1 (the engine's returns use the rounded figure)", f'IF({B["dcfOK"]}=0,"",INT({B["tvNet"]}+0.5))', name="TV_NET")
    line("pvOp", "PV of operating cash flows", f'IF({B["dcfOK"]}=0,"",SUMPRODUCT({R("CF")},{R("HOLD")},{R("DF")}))')
    line("rRev", "Reversion discount rate", f'IF({hasDcf}=0,"",IF({B["revDr"]}="",{B["dr"]},{B["revDr"]})/100)', NF_PCT)
    line("pvTV", "PV of terminal value", f'IF({B["dcfOK"]}=0,"",{B["tvNet"]}/(1+{B["rRev"]})^({H}/12))')
    line("dcfValue", "Indicated value — DCF", f'IF({B["dcfOK"]}=0,"",{B["pvOp"]}+{B["pvTV"]})', bold=True)
    line("dcfPSF", "  per SF", f'IF({B["dcfOK"]}=0,"",{B["dcfValue"]}/{bsf})', NF_USD2)

    # ---------- debt (buildDebt)
    sec("Debt")
    amt = f'IF({B["loanAmt"]}<>"",{B["loanAmt"]},IF(AND({B["ltv"]}<>"",{B["price"]}<>""),{B["ltv"]}/100*{B["price"]},""))'
    line("loan", "Loan amount", f'IF({B["hasDebt"]}=0,"",{amt})', name="LOAN_AMT")
    line("debtOK", "Debt modeled (1/0)", f'IF(AND({B["hasDebt"]}=1,{B["loan"]}<>""),1,0)', "0", name="DEBT_OK")
    line("debtF0", "Funding month", f'IF({B["fundDateK"]}="",0,MAX(0,{B["fundDateK"]}-{B["startK"]}))', "0", name="DEBT_F0")
    line("debtI", "Monthly interest rate", f'IF({B["hasDebt"]}=0,0,{B["loanRate"]}/100/12)', "0.000000%", name="DEBT_I")
    line("debtIO", "Interest-only months", f'IF({B["io"]}="",0,{B["io"]})', "0", name="DEBT_IO")
    line("debtAM", "Amortization months", f'={B["amort"]}'[1:], "0", name="DEBT_AM")
    line("debtPMT", "Level payment (after IO)",
         f'IF(OR({B["debtOK"]}=0,{B["amort"]}=""),0,{B["loan"]}*{B["debtI"]}/(1-(1+{B["debtI"]})^(-{B["amort"]})))', name="DEBT_PMT")
    line("netProceeds", "Net proceeds after origination fee (rounded to $1, as the engine reuses it)",
         f'IF({B["debtOK"]}=0,"",INT({B["loan"]}*(1-IF({B["origFee"]}="",0,{B["origFee"]})/100)+0.5))')
    line("ds1", "Year-1 debt service", f'IF({B["debtOK"]}=0,"",{SUMM("DS", 0, 12)})')
    line("dscr1", "Year-1 DSCR", f'IF(OR({B["debtOK"]}=0,N({B["ds1"]})<=0),"",{SUMM("NOI", 0, 12)}/{B["ds1"]})', NF_X)
    line("payoff", "Loan payoff at exit (balance at month H-1)",
         f'IF({B["debtOK"]}=0,0,IF({H}>=1,INDEX({R("BAL")},{H}),0))', name="PAYOFF")

    # ---------- returns (computeReturns)
    sec("Returns")
    line("retOK", "Returns computable (purchase price and DCF)", f'IF(AND(N({B["price"]})<>0,{B["dcfOK"]}=1),1,0)', "0", name="RET_OK")
    line("totalCost", "Total cost (price + acquisition costs)",
         f'IF({B["retOK"]}=0,"",{B["price"]}*(1+IF({B["acqPct"]}="",0,{B["acqPct"]})/100))', name="TOTAL_COST")
    line("equity0", "Initial equity", f'IF(OR({B["retOK"]}=0,{B["debtOK"]}=0),"",{B["totalCost"]}-{B["netProceeds"]})', name="EQUITY0")
    line("irrUm", "Unlevered IRR (monthly)", f'IF({B["retOK"]}=0,"",IFERROR(IRR({R("CFU")},0.01),""))', "0.0000%")
    line("irrU", "Unlevered IRR (annualized)", f'IF({B["irrUm"]}="","",(1+{B["irrUm"]})^12-1)', NF_PCT, bold=True)
    line("npvU", "NPV at discount rate (DCF value - total cost)", f'IF({B["retOK"]}=0,"",INT({B["dcfValue"]}+0.5)-{B["totalCost"]})')
    line("distU", "Unlevered distributions", f'IF({B["retOK"]}=0,"",SUM({R("CFU")})+{B["totalCost"]})')
    line("emU", "Unlevered equity multiple", f'IF({B["retOK"]}=0,"",IF({B["totalCost"]}>0,{B["distU"]}/{B["totalCost"]},""))', NF_X)
    line("profitU", "Unlevered profit", f'IF({B["retOK"]}=0,"",SUM({R("CFU")}))')
    line("irrLm", "Levered IRR (monthly)", f'IF(OR({B["retOK"]}=0,{B["debtOK"]}=0),"",IFERROR(IRR({R("CFL")},0.01),""))', "0.0000%")
    line("irrL", "Levered IRR (annualized)", f'IF({B["irrLm"]}="","",(1+{B["irrLm"]})^12-1)', NF_PCT, bold=True)
    line("distL", "Levered distributions", f'IF({B["equity0"]}="","",SUM({R("CFL")})+{B["equity0"]})')
    line("emL", "Levered equity multiple", f'IF({B["equity0"]}="","",IF({B["equity0"]}>0,{B["distL"]}/{B["equity0"]},""))', NF_X)
    line("profitL", "Levered profit", f'IF({B["equity0"]}="","",SUM({R("CFL")}))')

    # ---------- concluded (computeAll)
    sec("Concluded value")
    pick = (f'IF({B["recValue"]}<>"",{B["recValue"]},IF({B["recPrimary"]}="direct_cap",{B["dcValue"]},'
            f'IF({B["recPrimary"]}="dcf",{B["dcfValue"]},IF({B["dcfValue"]}<>"",{B["dcfValue"]},{B["dcValue"]}))))')
    line("concluded", "Concluded value", pick, bold=True)
    src = (f'IF({B["recValue"]}<>"","reconciliation (producer-stated)",IF({B["concluded"]}="","",'
           f'IF(AND({B["recPrimary"]}="direct_cap",{B["dcValue"]}<>""),"computed (direct_cap, workbook)",'
           f'IF(AND({B["recPrimary"]}<>"direct_cap",{B["dcfValue"]}<>""),"computed (dcf, workbook)","computed (direct_cap, workbook)"))))')
    line("concludedSrc", "Source", src, None)

    # ---------- sensitivity (computeSensitivity)
    sec("Sensitivity: DCF value by discount rate (rows) and exit cap (columns)")
    r_hdr = r
    put(ws, f"B{r}", "Discount rate \\ Exit cap", F_BOLD)
    caps_on = f'AND({B["dcfOK"]}=1,{B["tvMethod"]}="direct_cap",{B["tNOI"]}<>"")'
    fixed = (f'IF({B["tvMethod"]}="exit_price_psf",{B["tvPSF"]}*{bsf},IF({B["tvMethod"]}="fixed_value",{B["tvFixed"]},'
             f'IF(AND({B["tvMethod"]}="grown_purchase_price",{B["price"]}<>""),{B["price"]}*(1+{B["tvAppr"]}/100)^({H}/12),"")))')
    B.n["sensCaps"] = []
    B.n["sensDRs"] = []
    for j, dc in enumerate([-0.5, -0.25, 0, 0.25, 0.5]):
        c = CL(3 + j)
        ws[f"{c}{r}"] = f'=IF({caps_on},ROUND({B["tvCap"]}+({dc}),2)/100,IF(AND({B["dcfOK"]}=1,{j}=0),"fixed exit",""))'
        ws[f"{c}{r}"].font = F_BOLD
        ws[f"{c}{r}"].number_format = NF_PCT
        B.n["sensCaps"].append(f"{V}!${c}${r}")
    r += 1
    sens_unf = f'IF({B["tvUnfunded"]}=TRUE,{SUMM("FREE", H, h)},0)'
    for i, dd in enumerate([-1, -0.5, 0, 0.5, 1]):
        put(ws, f"B{r}", f'=IF({B["dcfOK"]}=0,"",ROUND({B["dr"]}+({dd}),2)/100)', F_BOLD, NF_PCT)
        B.n["sensDRs"].append(f"{V}!$B${r}")
        drv = f"$B{r}"
        rrev = f'(IF({B["revDr"]}="",{B["dr"]},{B["revDr"]})/100+({drv}-{B["dr"]}/100))'
        pvop = f'SUMPRODUCT({R("CF")},{R("HOLD")},1/(1+{drv})^{R("TPV")})'
        for j in range(5):
            c = CL(3 + j)
            capc = f"{c}${r_hdr}"
            gross = f'IF({caps_on},{B["tNOI"]}/{capc},{fixed})'
            f = (f'=IF({B["dcfOK"]}=0,"",IF(AND(NOT({caps_on}),{j}<>0),"",IF({gross}="","",'
                 f'{pvop}+({gross}-{sens_unf})*(1-{sell})/(1+{rrev})^({H}/12))))')
            put(ws, f"{c}{r}", f, F_BASE, NF_USD)
        r += 1
    B.n["sensRow0"] = r_hdr + 1
    ws.freeze_panes = "A4"
    return ws


# =====================================================================
# Annual CF (annualTable)
# =====================================================================
ANNUAL = [
    ("scheduledBaseRent", "Scheduled base rent", "SCHED", 1),
    ("freeRent", "Free rent", "FREE", -1),
    ("absorptionVacancy", "Absorption & turnover vacancy", "EXPVAC", -1),
    ("expenseRecoveries", "Expense recoveries", "RECOVERIES", 1),
    ("generalVacancy", "General vacancy", "GV", -1),
    ("creditLoss", "Credit loss", "CL", -1),
    ("effectiveGrossRevenue", "Effective gross revenue", "EGR", 1),
    ("operatingExpenses", "Operating expenses", "ABOVE", -1),
    ("managementFee", "Management fee", "MGMT", -1),
    ("noi", "Net operating income", "NOI", 1),
    ("belowTheLine", "Below-the-line items (reserves)", "BELOW", -1),
    ("tiCosts", "Tenant improvements", "TI", -1),
    ("lcCosts", "Leasing commissions", "LC", -1),
    ("cashFlow", "Cash flow before debt service", "CF", 1),
]


def build_annual(B):
    ws = B.sheet("Annual CF", "2F5597")
    ws.column_dimensions["A"].width = 2
    ws.column_dimensions["B"].width = 34
    put(ws, "B1", "Annual Cash Flow", F_TITLE)
    ws["B2"] = f'=IF({B["propName"]}="","Load a .ore file (see Start Here)",{B["propName"]}&" · analysis start "&TEXT({DATEV(B["anStart"])},"mmm yyyy")&" · hold "&{B["H"]}&" months")'
    ws["B2"].font = F_NOTE
    M = f"MonthlyCF!$F$2:${LASTC}$2"
    H = B["H"]
    r = 4
    put(ws, f"B{r}", "Analysis year", F_HDR, fill=FILL_HDR)
    put(ws, f"B{r+1}", "Months in year", F_BOLD)
    B.n["AN_row"] = {}
    for y in range(NYR):
        c = CL(3 + y)
        ws.column_dimensions[c].width = 13
        put(ws, f"{c}{r}", f'=IF({y}*12<{H},"Year {y+1}","")', F_HDR, align=Alignment(horizontal="right"))
        put(ws, f"{c}{r+1}", f'=IF({y}*12<{H},MIN({H},{y}*12+12)-{y}*12,"")', F_BASE, "0")
    rr = r + 2
    for key, lab, row, sign in ANNUAL:
        bold = key in ("effectiveGrossRevenue", "noi", "cashFlow")
        put(ws, f"B{rr}", lab, F_BOLD if bold else F_BASE, border=B_TOP if bold else None)
        B.n["AN_row"][key] = rr
        for y in range(NYR):
            c = CL(3 + y)
            a, b = f"{y}*12", f"MIN({H},{y}*12+12)"
            f = f'=IF({y}*12<{H},{sign}*SUMPRODUCT(({M}>={a})*({M}<{b}),{rowrange(row, B)}),"")'
            put(ws, f"{c}{rr}", f, F_BOLD if bold else F_BASE, NF_NUM, border=B_TOP if bold else None)
        rr += 1
    yl = CL(3 + NYR - 1)
    ws.conditional_formatting.add(f"C{r}:{yl}{r}", FormulaRule(formula=[f'C${r}<>""'], fill=FILL_HDR))
    for key in ("effectiveGrossRevenue", "noi", "cashFlow"):
        rk = B.n["AN_row"][key]
        for y in range(NYR):
            ws[f"{CL(3 + y)}{rk}"].border = Border()
        ws.conditional_formatting.add(f"C{rk}:{yl}{rk}", FormulaRule(formula=[f'C${r}<>""'], border=B_TOP))
    bridge_end = rr + 2 + len(ANNUAL)
    # dynamic print area: only the years in the hold
    ws.defined_names["_xlnm.Print_Area"] = DefinedName(
        "_xlnm.Print_Area", localSheetId=None,
        attr_text=f"OFFSET('Annual CF'!$A$1,0,0,{bridge_end},2+ROUNDUP({H}/12,0))")
    # NOI bridge, year 1 (annualTable(model, 12))
    rr += 1
    section(ws, rr, 2, "Year-1 NOI bridge (first 12 months, regardless of hold)", 3)
    rr += 1
    B.n["BR_row"] = {}
    for key, lab, row, sign in ANNUAL:
        bold = key in ("effectiveGrossRevenue", "noi", "cashFlow")
        put(ws, f"B{rr}", lab, F_BOLD if bold else F_BASE)
        put(ws, f"C{rr}", f'={sign}*SUMPRODUCT(({M}<12),{rowrange(row, B)})', F_BOLD if bold else F_BASE, NF_NUM)
        B.n["BR_row"][key] = rr
        rr += 1
    ws.freeze_panes = "C5"
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
    ws.print_title_cols = "A:B"
    return ws


# =====================================================================
# Reader sheets
# =====================================================================
def kv(ws, r, label, f, nf=None, bold=False, col="B"):
    vc = CL(ord(col) - 64 + 1)
    put(ws, f"{col}{r}", label, F_BASE)
    put(ws, f"{vc}{r}", f, F_BOLD if bold else F_BASE, nf, align=Alignment(horizontal="left"))


def build_summary(B):
    ws = B.sheet("Summary", "1F3864")
    ws.column_dimensions["A"].width = 2
    ws.column_dimensions["B"].width = 30
    ws.column_dimensions["C"].width = 26
    ws.column_dimensions["D"].width = 3
    ws.column_dimensions["E"].width = 30
    ws.column_dimensions["F"].width = 34
    put(ws, "B1", f'=IF({B["propName"]}="","No deal loaded — see Start Here",{B["propName"]})', F_TITLE)
    put(ws, "B2", f'=IF({B["street"]}="","",{B["street"]}&", "&{B["city"]}&", "&{B["state"]}&" "&{B["zip"]})', F_BASE)
    put(ws, "B3", f'=IF({B["market"]}="","",{B["market"]}&IF({B["submarket"]}="",""," · "&{B["submarket"]}))', F_NOTE)
    r = 5
    section(ws, r, 2, "Property", 2)
    section(ws, r, 5, "Rent roll", 2)
    r += 1
    left = [
        ("Property type", f'={B["propType"]}&IF({B["propSubtype"]}="",""," / "&{B["propSubtype"]})', None),
        ("Tenancy", f'={B["tenancy"]}', None),
        ("Building SF", f'={B["bsf"]}', NF_NUM),
        ("Office SF", f'={B["officeSF"]}', NF_NUM),
        ("Clear height (ft)", f'={B["clearHt"]}', None),
        ("Dock-high / grade doors", f'=IF({B["dockDoors"]}="","",{B["dockDoors"]}&" / "&{B["gradeDoors"]})', None),
        ("Year built", f'={B["yearBuilt"]}', "0"),
        ("Site (acres)", f'={B["siteAcres"]}', "0.00"),
        ("APN", f'={B["apn"]}', None),
        ("Zoning", f'={B["zoning"]}', None),
    ]
    sc = B["SP_col"]
    sp0, sp1 = B["SP_row0"], B["SP_row0"] + NL - 1
    spr = lambda k: f"SpaceParams!${sc[k]}${sp0}:${sc[k]}${sp1}"
    vsf = f"SpaceParams!${sc['sf']}${sp0+NL}:${sc['sf']}${sp1+NV}"
    B.n["occSF"] = f"SUMPRODUCT({spr('sf')},{spr('exists')})"
    B.n["vacSF"] = f"SUM({vsf})"
    right = [
        ("Rent roll as of", f'={DATEV(B["asOf"])}', NF_DATE),
        ("Leases", f'=SUM({spr("exists")})', "0"),
        ("Occupied SF", f'={B["occSF"]}', NF_NUM),
        ("Vacant SF", f'={B["vacSF"]}', NF_NUM),
        ("Occupancy", f'=IF(N({B["bsf"]})=0,"",{B["occSF"]}/{B["bsf"]})', NF_PCT1),
        ("WALT by rent (yrs)", "=LM_WALT_RENT", "0.00"),
        ("WALT by SF (yrs)", "=LM_WALT_SF", "0.00"),
        ("Rolling next 12 mo (rent)", "=LM_ROLL_RENT", NF_PCT1),
        ("In-place rent ($/SF/mo)", "=RENT_WA_IP", NF_USD2),
        ("Market rent ($/SF/mo)", "=RENT_WA_MKT", NF_USD2),
    ]
    for j in range(max(len(left), len(right))):
        if j < len(left):
            kv(ws, r + j, left[j][0], left[j][1], left[j][2])
        if j < len(right):
            kv(ws, r + j, right[j][0], right[j][1], right[j][2], col="E")
    r += max(len(left), len(right)) + 1
    section(ws, r, 2, "Income (workbook-computed)", 2)
    section(ws, r, 5, "Value (workbook-computed)", 2)
    r += 1
    left = [
        ("In-place annual base rent", "=RENT_IP_ANNUAL", NF_USD),
        ("Year-1 NOI", f"='Annual CF'!$C${B['BR_row']['noi']}", NF_USD),
        ("Stabilized NOI at market", f'={B["stab0"]}', NF_USD),
        ("Year-1 cash flow before debt", f"='Annual CF'!$C${B['BR_row']['cashFlow']}", NF_USD),
        ("Purchase price", f'={B["price"]}', NF_USD),
        ("Going-in cap (Y1 NOI / price)", f"=IF(N({B['price']})=0,\"\",'Annual CF'!$C${B['BR_row']['noi']}/{B['price']})", NF_PCT),
        ("Price per SF", f'=IF(N({B["price"]})=0,"",{B["price"]}/{B["bsf"]})', NF_USD2),
    ]
    right = [
        ("Direct cap value", f'={B["dcValue"]}', NF_USD),
        ("DCF value", f'={B["dcfValue"]}', NF_USD),
        ("Concluded value", f'={B["concluded"]}', NF_USD),
        ("  source", f'={B["concludedSrc"]}', None),
        ("Unlevered IRR", f'={B["irrU"]}', NF_PCT),
        ("Levered IRR", f'={B["irrL"]}', NF_PCT),
        ("Year-1 DSCR", f'={B["dscr1"]}', NF_X),
    ]
    for j in range(max(len(left), len(right))):
        if j < len(left):
            kv(ws, r + j, left[j][0], left[j][1], left[j][2], bold=True)
        if j < len(right):
            kv(ws, r + j, right[j][0], right[j][1], right[j][2], col="E", bold=True)
    r += max(len(left), len(right)) + 1
    section(ws, r, 2, "Provenance", 5)
    r += 1
    prov = [
        ("Produced by", f'={B["genBy"]}&IF({B["genOrg"]}="",""," · "&{B["genOrg"]})&IF({B["genRole"]}="",""," ("&{B["genRole"]}&")")'),
        ("Contact", f'={B["genEmail"]}&IF({B["genPhone"]}="",""," · "&{B["genPhone"]})'),
        ("Generated at", f'={B["genAt"]}'),
        ("Software", f'={B["swName"]}&IF({B["swVer"]}="",""," "&{B["swVer"]})'),
        ("Confidentiality", f'={B["confid"]}'),
        ("Format version", f'={B["formatVersion"]}'),
    ]
    for lab, f in prov:
        kv(ws, r, lab, f)
        ws.merge_cells(f"C{r}:F{r}")
        r += 1
    r += 1
    put(ws, f"B{r}", "Description", F_BOLD)
    r += 1
    put(ws, f"B{r}", f'={B["propDesc"]}', F_BASE, align=Alignment(wrap_text=True, vertical="top"))
    ws.merge_cells(f"B{r}:F{r+2}")
    ws.row_dimensions[r].height = 30
    r += 4
    put(ws, f"B{r}", '="Status: "&CHECK_STATUS', F_NOTE)
    ws.page_setup.orientation = "portrait"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 1
    ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
    ws.print_area = f"A1:F{r}"
    return ws


def build_rent_roll(B):
    ws = B.sheet("Rent Roll", "1F3864")
    ws.column_dimensions["A"].width = 3
    put(ws, "B1", "Rent Roll", F_TITLE)
    put(ws, "B2", f'=IF({B["propName"]}="","",{B["propName"]}&" · as of "&TEXT({DATEV(B["asOf"])},"mmm d, yyyy"))', F_NOTE)
    lc = B["L_col"]
    sc = B["SP_col"]
    vc = B["V_col"]
    L0, L1 = B["L_row0"], B["L_row0"] + NL - 1
    S0, S1 = B["SP_row0"], B["SP_row0"] + NL - 1
    V0, V1 = B["V_row0"], B["V_row0"] + NV - 1
    nL = f"SUM(SpaceParams!${sc['exists']}${S0}:${sc['exists']}${S1})"
    nV = f"SUM(SpaceParams!${sc['exists']}${S1+1}:${sc['exists']}${S1+NV})"
    put(ws, "B3", (f'=IF({B["propName"]}="","",{nL}&" leases · "&TEXT(OCC_SF,"#,##0")&" SF leased · "&TEXT(VAC_SF,"#,##0")'
                   f'&" SF vacant · in-place rent "&TEXT(RENT_IP_ANNUAL,"$#,##0")&"/yr · WALT "&TEXT(LM_WALT_RENT,"0.0")&" yrs by rent")'), F_BOLD)
    hdr = ["Lease", "Tenant", "Suite", "Space type", "SF", "% of bldg", "Commence", "Expire", "Rem. yrs",
           "Rent $/SF/mo (today)", "Annual rent (today)", "Escalation", "Reimb.", "Free rent", "Renewal option",
           "TI / LC (unfunded)", "Notes"]
    widths = [10, 30, 8, 14, 11, 9, 11, 11, 8, 11, 13, 16, 8, 16, 20, 14, 60]
    header_row(ws, 5, 2, hdr, widths)
    ws.row_dimensions[5].height = 30
    r0 = 6
    for j in range(NS):
        r = r0 + j
        a = f"$A{r}"
        ws[f"A{r}"] = f"=IF({j}<{nL},{j}+1,IF({j}-{nL}<{nV},-({j}-{nL}+1),0))"
        ws[f"A{r}"].font = Font(name=FONT, size=8, color="FFFFFF")
        L = lambda f: f"INDEX(Data!${lc[f]}${L0}:${lc[f]}${L1},{a})"
        P = lambda k: f"INDEX(SpaceParams!${sc[k]}${S0}:${sc[k]}${S1},{a})"
        V = lambda f: f"INDEX(Data!${vc[f]}${V0}:${vc[f]}${V1},-{a})"
        oj = P("optJ")
        def OPT(prefix):
            return "CHOOSE(" + oj + "," + ",".join(L(f"{prefix}{k}") for k in range(MO)) + ")"
        esc = (f'IF({L("escType")}="fixed_percent",{L("escRate")}&"% / "&IF({L("escFreq")}="",12,{L("escFreq")})&" mo",'
               f'IF({L("escType")}="cpi","CPI"&IF({L("cpiFloor")}="",""," "&{L("cpiFloor")}&"%")&IF({L("cpiCap")}="","","-"&{L("cpiCap")}&"%"),'
               f'IF({L("escType")}="fixed_amount","+"&{L("escAmt")}&" / "&IF({L("escFreq")}="",12,{L("escFreq")})&" mo",IF({L("escType")}="","none",{L("escType")}))))')
        free = (f'IF({L("frs0")}="","",TEXT({DATEV(L("frs0"))},"mmm yy")&" – "&TEXT({DATEV(L("fre0"))},"mmm yy")'
                f'&IF({L("frp0")}="",""," @"&{L("frp0")}&"%")&IF({L("frs1")}<>""," +more",""))')
        opt = (f'IF({oj}=0,"",IF({OPT("om")}="","",ROUND({OPT("om")}/12,1)&" yr @ ")&'
               f'IF({OPT("ob")}="fixed","$"&{OPT("of")},IF({OPT("ob")}="percent_of_market",{OPT("op")}&"% mkt","market")))')
        tilc = f'IF({P("tiAmt")}+{P("lcAmt")}=0,"",{P("tiAmt")}+{P("lcAmt")})'
        bsf = B["bsf"]
        vals = [
            (L("id"), '"VACANT"', None),
            (L("tenant"), '"—"', None),
            (L("suite"), V("suite"), None),
            (L("spaceType"), V("spaceType"), None),
            (L("sf"), V("sf"), NF_NUM),
            (f'{L("sf")}/{bsf}', f'{V("sf")}/{bsf}', NF_PCT1),
            (DATEV(L("comm")), '""', NF_DATE),
            (DATEV(L("exp")), '""', NF_DATE),
            (f'MAX(0,{P("expIdx")}+1)/12', '""', "0.0"),
            (f'{P("cr0m")}/{L("sf")}', '""', NF_USD2),
            (f'{P("cr0m")}*12', '""', NF_USD),
            (esc, '""', None),
            (L("struct"), '""', None),
            (free, '""', None),
            (opt, '""', None),
            (tilc, '""', NF_USD),
            (L("notes"), V("notes"), None),
        ]
        for k, (lf, vf, nf) in enumerate(vals):
            c = ws.cell(row=r, column=2 + k, value=f'=IF({a}=0,"",IF({a}>0,{lf},{vf}))')
            c.font = F_BASE
            if nf:
                c.number_format = nf
    last = r0 + NS - 1
    ws.conditional_formatting.add(f"B{r0}:R{last}", FormulaRule(formula=[f"$A{r0}<>0"], border=B_BOTTOM))
    ws.conditional_formatting.add(f"B{r0}:R{last}", FormulaRule(formula=[f"$A{r0}<0"], font=Font(color="0000FF", italic=True)))
    put(ws, f"B{last+2}", "Leases first, then vacant suites. Rent today = contract rent in the analysis start month, before free rent. "
                         "TI / LC = unfunded in-place obligations.", F_NOTE)
    ws.freeze_panes = f"D{r0}"
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
    ws.print_title_rows = "5:5"
    ws.defined_names["_xlnm.Print_Area"] = DefinedName(
        "_xlnm.Print_Area", localSheetId=None,
        attr_text=f"OFFSET('Rent Roll'!$A$1,0,0,{r0}+{nL}+{nV}+2,18)")
    return ws


def build_expenses(B):
    ws = B.sheet("Expenses", "1F3864")
    ws.column_dimensions["A"].width = 2
    put(ws, "B1", "Operating Expenses", F_TITLE)
    put(ws, "B2", f'=IF({B["propName"]}="","",{B["propName"]}&" · current annual amounts")', F_NOTE)
    hdr = ["ID", "Name", "Category", "Amount", "Unit", "Annual $", "$/SF/yr", "Recoverable", "Controllable",
           "Below line", "Growth", "Notes"]
    header_row(ws, 4, 2, hdr, [10, 26, 18, 12, 14, 13, 9, 11, 11, 9, 9, 50])
    e0 = B["E_row0"]
    r = 5
    for k in range(NE):
        dr = e0 + k
        def E(f):
            return B["E_" + f].split(":")[0].replace(f"${e0}", f"${dr}")
        ex = f'{E("exists")}=0'
        vals = [
            (f'=IF({ex},"",{E("id")})', None), (f'=IF({ex},"",{E("name")})', None),
            (f'=IF({ex},"",{E("cat")})', None), (f'=IF({ex},"",{E("amt")})', NF_NUM2),
            (f'=IF({ex},"",{E("unit")})', None),
            (f'=IF({ex},"",IF({E("isPct")}=1,"% of EGR",{E("annualCur")}))', NF_USD),
            (f'=IF(OR({ex},{E("isPct")}=1),"",{E("annualCur")}/{B["bsf"]})', NF_USD2),
            (f'=IF({ex},"",IF({E("rec")}=TRUE,"yes","no"))', None),
            (f'=IF(OR({ex},{E("rec")}<>TRUE),"",IF({E("ctlFlag")}=1,"yes","no"))', None),
            (f'=IF({ex},"",IF({E("btl")}=TRUE,"yes",""))', None),
            (f'=IF({ex},"",IF({E("ovr")}<>"",{E("ovr")}/100,"curve"))', NF_PCT1),
            (f'=IF({ex},"",{E("notes")})', None),
        ]
        for j, (f, nf) in enumerate(vals):
            c = ws.cell(row=r, column=2 + j, value=f)
            c.font = F_BASE
            c.border = B_BOTTOM
            if nf:
                c.number_format = nf
        r += 1
    put(ws, f"B{r}", "Total above the line (excl. % of EGR)", F_BOLD, border=B_TOP)
    put(ws, f"G{r}", f'=SUMPRODUCT({B["E_annualCur"]},{B["E_above"]})', F_BOLD, NF_USD, border=B_TOP)
    put(ws, f"H{r}", f'=IF(N({B["bsf"]})=0,"",G{r}/{B["bsf"]})', F_BOLD, NF_USD2, border=B_TOP)
    B.n["EXP_ABOVE_ANNUAL"] = f"Expenses!$G${r}"
    put(ws, f"B{r+1}", "Total below the line", F_BASE)
    put(ws, f"G{r+1}", f'=SUMPRODUCT({B["E_annualCur"]},{B["E_below"]})', F_BASE, NF_USD)
    B.n["EXP_BELOW_ANNUAL"] = f"Expenses!$G${r+1}"
    put(ws, f"B{r+2}", "Management fee (% of EGR)", F_BASE)
    put(ws, f"G{r+2}", f'=IF({B["mgmtPct"]}=0,"",{B["mgmtPct"]})', F_BASE, NF_PCT)
    B.n["EXP_MGMT"] = f"Expenses!$G${r+2}"
    put(ws, f"B{r+4}", f'={B["expNotes"]}', F_NOTE)
    ws.freeze_panes = "C5"
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
    return ws


def build_assumptions(B):
    ws = B.sheet("Assumptions", "1F3864")
    ws.column_dimensions["A"].width = 2
    ws.column_dimensions["B"].width = 34
    for c in "CDEFGHIJ":
        ws.column_dimensions[c].width = 15
    put(ws, "B1", "Assumptions", F_TITLE)
    put(ws, "B2", "Everything the calculation uses travels in the file. Shown here as read from the Tape.", F_NOTE)
    r = 4
    section(ws, r, 2, "Growth and credit", 4)
    r += 1
    pct = lambda x: f'=IF({x}="","",{x}/100)'
    items = [
        ("Market rent growth (year 1)", f'=INDEX({B["yrMkt"]},1)/100', NF_PCT),
        ("Market rent growth (year 5)", f'=INDEX({B["yrMkt"]},5)/100', NF_PCT),
        ("Expense growth (year 1)", f'=INDEX({B["yrExp"]},1)/100', NF_PCT),
        ("CPI (model)", f'={B["cpiModel"]}/100', NF_PCT),
        ("General vacancy", pct(B["gvPct"]), NF_PCT),
        ("Credit loss", pct(B["clPct"]), NF_PCT),
    ]
    for lab, f, nf in items:
        kv(ws, r, lab, f, nf)
        r += 1
    r += 1
    section(ws, r, 2, "Leasing profiles", 9)
    r += 1
    labels = [("Market rent", "amt", None), ("Rent unit", "unit", None), ("Term (months)", "term", "0"),
              ("Escalation", "escType", None), ("  rate %", "escRate", "0.00"), ("Reimbursement", "struct", None),
              ("Downtime (months)", "down", "0"), ("Renewal probability %", "renProb", "0"),
              ("Renewal rent % of market", "renPct", "0"),
              ("New tenant: TI $/SF", "nTI", "0.00"), ("New tenant: LC %", "nLC", "0.00"), ("New tenant: free months", "nFree", "0"),
              ("Renewal: TI $/SF", "rTI", "0.00"), ("Renewal: LC %", "rLC", "0.00"), ("Renewal: free months", "rFree", "0")]
    put(ws, f"B{r}", "Profile", F_BOLD)
    pr0 = int(B["profKeys"].split("$")[2].split(":")[0])
    for k in range(NP):
        c = CL(3 + k)
        put(ws, f"{c}{r}", f"=Data!$B${pr0+k}", F_BOLD)
    r += 1
    for lab, f, nf in labels:
        put(ws, f"B{r}", lab)
        col = B["P_" + f].split("$")[1]
        for k in range(NP):
            c = CL(3 + k)
            put(ws, f"{c}{r}", f"=Data!${col}${pr0+k}", F_BASE, nf)
        r += 1
    r += 1
    section(ws, r, 2, "Valuation", 4)
    r += 1
    items = [
        ("Interest appraised", f'={B["interest"]}', None),
        ("Analysis start", f'={DATEV(B["anStart"])}', NF_DATE),
        ("Methods", f'={B["method1"]}&IF({B["method2"]}="",""," · "&{B["method2"]})&IF({B["method3"]}="",""," · "&{B["method3"]})', None),
        ("Purchase price", f'={B["price"]}', NF_USD),
        ("Acquisition costs", pct(B["acqPct"]), NF_PCT),
        ("Hold (months)", f'=IF({B["hasDcf"]}=1,{B["H"]},"")', "0"),
        ("Discount rate", pct(B["dr"]), NF_PCT),
        ("Reversion discount rate", pct(B["revDr"]), NF_PCT),
        ("Discount timing / convention", f'=IF({B["hasDcf"]}=1,IF({B["timing"]}="","monthly",{B["timing"]})&" / "&IF({B["convention"]}="","end",{B["convention"]}),"")', None),
        ("Terminal value method", f'={B["tvMethod"]}', None),
        ("Exit cap rate", pct(B["tvCap"]), NF_PCT),
        ("Terminal NOI basis", f'={B["tvBasis"]}', None),
        ("Selling costs", pct(B["tvSell"]), NF_PCT),
        ("Direct cap rate", pct(B["dcCap"]), NF_PCT),
        ("Direct cap NOI basis", f'={B["dcBasis"]}', None),
        ("Tax reassessment rate", f'=IF(TR_IDX=0,"",{B["TR_RATE"]}/100)', NF_PCT),
    ]
    for lab, f, nf in items:
        kv(ws, r, lab, f, nf)
        r += 1
    r += 1
    section(ws, r, 2, "Debt", 4)
    r += 1
    items = [
        ("Loan amount", f'={B["loan"]}', NF_USD), ("LTV", pct(B["ltv"]), NF_PCT),
        ("Interest rate", pct(B["loanRate"]), NF_PCT), ("Term (months)", f'={B["loanTerm"]}', "0"),
        ("Amortization (months)", f'={B["amort"]}', "0"), ("Interest-only (months)", f'={B["io"]}', "0"),
        ("Origination fee", pct(B["origFee"]), NF_PCT), ("Funding date", f'={DATEV(B["fundDate"])}', NF_DATE),
    ]
    for lab, f, nf in items:
        kv(ws, r, lab, f, nf)
        r += 1
    r += 1
    for lab, key in (("Market notes", "maNotes"), ("Terminal value notes", "tvNotes"), ("Valuation notes", "valNotes"), ("Debt notes", "debtNotes")):
        put(ws, f"B{r}", lab, F_BOLD)
        put(ws, f"C{r}", f'={B[key]}', F_NOTE)
        r += 1
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
    return ws


# =====================================================================
# Lease metrics + rent summary (computeLeaseMetrics, computeAll.rent/expenses)
# =====================================================================
def build_metrics(B, ws):
    """Placed on the Valuation sheet below the sensitivity grid."""
    r = ws.max_row + 3
    section(ws, r, 2, "Occupancy, lease metrics, rent", 6)
    r += 1
    sc = B["SP_col"]
    sp0, sp1 = B["SP_row0"], B["SP_row0"] + NL - 1
    spr = lambda k: f"SpaceParams!${sc[k]}${sp0}:${sc[k]}${sp1}"
    ex, sf, cr, ei = spr("exists"), spr("sf"), spr("cr0m"), spr("expIdx")
    B.n["vacSF"] = f"SUM(SpaceParams!${sc['sf']}${sp1+1}:${sc['sf']}${sp1+NV})"
    rem = f"(({ei}+1>0)*({ei}+1))/12"
    lines = [
        ("OCC_SF", "Occupied SF", f"=SUMPRODUCT({sf},{ex})", NF_NUM),
        ("VAC_SF", "Vacant SF", f"={B['vacSF']}", NF_NUM),
        ("OCC_PCT", "Occupancy %", f'=IF(N({B["bsf"]})=0,"",OCC_SF/{B["bsf"]})', NF_PCT),
        ("RENT_IP_M", "In-place monthly base rent (month 0)", f"=SUMPRODUCT({cr},{ex})", NF_USD),
        ("RENT_IP_ANNUAL", "In-place annual base rent", "=RENT_IP_M*12", NF_USD),
        ("RENT_WA_IP", "In-place WA rent ($/SF/mo)", '=IF(OCC_SF>0,RENT_IP_M/OCC_SF,"")', NF_USD2),
        ("RENT_WA_MKT", "Market WA rent ($/SF/mo)", f'=IF({B["blend0"]}="","",{B["blend0"]}/{B["bsf"]})', NF_USD2),
        ("RENT_GAP", "In-place vs market", '=IF(OR(RENT_WA_IP="",RENT_WA_MKT="",N(RENT_WA_MKT)=0),"",(RENT_WA_IP-RENT_WA_MKT)/RENT_WA_MKT)', NF_PCT),
        ("LM_WALT_RENT", "WALT by rent (years)", f'=IF(RENT_IP_M>0,SUMPRODUCT({rem},{cr}*12,{ex})/(RENT_IP_M*12),"")', "0.00"),
        ("LM_WALT_SF", "WALT by SF (years)", f'=IF(OCC_SF>0,SUMPRODUCT({rem},{sf},{ex})/OCC_SF,"")', "0.00"),
        ("LM_ROLL_RENT", "Rolling next 12 months, % of rent", f'=IF(RENT_IP_M>0,SUMPRODUCT(--({ei}<12),{cr},{ex})/RENT_IP_M,0)', NF_PCT),
        ("LM_ROLL_SF", "Rolling next 12 months, % of SF", f'=IF(OCC_SF>0,SUMPRODUCT(--({ei}<12),{sf},{ex})/OCC_SF,0)', NF_PCT),
        ("EXP_Y0_ABOVE", "Above-line expenses, annual (current, excl. mgmt)", f"={B['EXP_ABOVE_ANNUAL']}", NF_USD),
        ("EXP_Y0_BELOW", "Below-line items, annual (current)", f"={B['EXP_BELOW_ANNUAL']}", NF_USD),
    ]
    for nm, lab, f, nf in lines:
        put(ws, f"B{r}", lab)
        put(ws, f"C{r}", f, F_BASE, nf)
        B.n[nm] = f"Valuation!$C${r}"
        B.wb.defined_names[nm] = DefinedName(nm, attr_text=B[nm])
        r += 1


# =====================================================================
# Check: workbook vs reference engine
# =====================================================================
def build_check(B):
    ws = B.sheet("Check", "00B050")
    ws.column_dimensions["A"].width = 2
    ws.column_dimensions["B"].width = 50
    ws.column_dimensions["C"].width = 16
    ws.column_dimensions["D"].width = 16
    ws.column_dimensions["E"].width = 10
    ws.column_dimensions["F"].width = 10
    ws.column_dimensions["G"].width = 46
    put(ws, "B1", "Check — workbook vs reference engine", F_TITLE)
    put(ws, "B2", ("Every number the reference engine reports, recomputed by this workbook's own formulas. "
                   "Engine values come from the Tape ($engine.* rows, written by `ore excel` / `ore tape --engine`)."), F_NOTE)
    r = 4
    put(ws, f"B{r}", "Overall status", F_SUB)
    status_cell = f"C{r}"
    r += 1
    put(ws, f"B{r}", "Checks passed / compared", F_BASE)
    pass_cell = f"C{r}"
    r += 1
    put(ws, f"B{r}", "Capacity", F_BASE)
    cap_cell = f"C{r}"
    r += 2
    header_row(ws, r, 2, ["Output", "Workbook", "Engine", "Diff", "Result", "Engine path", "Workbook, unrounded"])
    ws.column_dimensions["H"].width = 18
    put(ws, f"B{r-1}", "PASS* = equal before rounding; the value sits on an x.5 boundary and the two floating-point pipelines round it to neighboring units.", F_NOTE)
    r += 1
    first = r
    rows = []

    def add(label, wb_f, path, digits=0):
        rows.append((label, wb_f, path, digits))

    # helpers
    an = B["AN_row"]
    br = B["BR_row"]
    add("Occupancy: occupied SF", "OCC_SF", "occupancy.occupiedSF")
    add("Occupancy: vacant SF", "VAC_SF", "occupancy.vacantSF")
    add("Occupancy %", "OCC_PCT*100", "occupancy.occupancyPercent", 2)
    add("WALT by rent (yrs)", "LM_WALT_RENT", "leaseMetrics.waltYearsByRent", 2)
    add("WALT by SF (yrs)", "LM_WALT_SF", "leaseMetrics.waltYearsBySF", 2)
    add("Roll next 12 mo, % of rent", "LM_ROLL_RENT*100", "leaseMetrics.rollNext12ByRentPercent", 2)
    add("Roll next 12 mo, % of SF", "LM_ROLL_SF*100", "leaseMetrics.rollNext12BySFPercent", 2)
    add("In-place annual base rent", "RENT_IP_ANNUAL", "rent.inPlaceAnnualBaseRent")
    add("In-place WA rent $/SF/mo", "RENT_WA_IP", "rent.inPlaceWARentPerSFPerMonth", 2)
    add("Market rent $/SF/mo", "RENT_WA_MKT", "rent.marketRentPerSFPerMonth", 2)
    add("In-place vs market %", 'IF(RENT_GAP="","",RENT_GAP*100)', "rent.inPlaceVsMarketPercent", 2)
    add("Above-line expenses, annual", "EXP_Y0_ABOVE", "expenses.aboveLineAnnualExclMgmt")
    add("Below-line items, annual", "EXP_Y0_BELOW", "expenses.belowTheLineAnnual")
    add("Management fee % of EGR", f'IF({B["mgmtPct"]}=0,"",{B["mgmtPct"]}*100)', "expenses.managementFeePercentOfEGR", 2)
    add("Year-1 NOI", f"'Annual CF'!$C${br['noi']}", "noi.year1NOI")
    add("Stabilized NOI at market", B["stab0"], "noi.stabilizedAtMarketNOI")
    for key, lab, _, _ in ANNUAL:
        add(f"NOI bridge Y1: {lab}", f"'Annual CF'!$C${br[key]}", f"noiBridgeYear1.{key}")
    for y in range(NYR):
        c = CL(3 + y)
        for key, lab, _, _ in ANNUAL:
            add(f"Year {y+1}: {lab}", f"'Annual CF'!${c}${an[key]}", f"cashFlows.annual[{y}].{key}")
    add("Direct cap: basis NOI", B["dcNOI"], "directCap.basisNOI")
    add("Direct cap: gross value", B["dcGross"], "directCap.grossValue")
    add("Direct cap: indicated value", B["dcValue"], "directCap.indicatedValue")
    add("Direct cap: per SF", B["dcPSF"], "directCap.perSF", 2)
    for lab, key, prefix in (("mark-to-market", "dcMTM", "Mark-to-market"), ("near-term lost rent", "ntLostV", "Near-term downtime"),
                             ("near-term free rent", "ntFreeV", "Near-term free rent"), ("near-term TI", "ntTIV", "Near-term TI"),
                             ("near-term LC", "ntLCV", "Near-term LC")):
        # engine lists deductions as -Math.round(amount)
        wbf = (f'IF({B["dcOK"]}=0,"",IF({B[key]}=0,"",{B[key]}))' if key == "dcMTM"
               else f'IF({B["dcOK"]}=0,"",IF({B[key]}=0,"",-INT({B[key]}+0.5)))')
        add(f"Direct cap adj: {lab}", wbf, f"ADJ:{prefix}")
    add("DCF: PV operating", B["pvOp"], "dcf.pvOperating")
    add("DCF: terminal gross", B["tvGross"], "dcf.terminalGross")
    add("DCF: terminal net", B["tvNet"], "dcf.terminalNet")
    add("DCF: PV terminal", B["pvTV"], "dcf.pvTerminal")
    add("DCF: indicated value", B["dcfValue"], "dcf.indicatedValue")
    add("DCF: per SF", B["dcfPSF"], "dcf.perSF", 2)
    add("DCF: unfunded obligations deducted", B["unfunded"], "dcf.unfundedObligationsDeducted")
    add("Debt: loan amount", B["loan"], "debt.loanAmount")
    add("Debt: net proceeds", B["netProceeds"], "debt.netProceeds")
    add("Debt: year-1 debt service", B["ds1"], "debt.year1DebtService")
    add("Debt: year-1 DSCR", B["dscr1"], "debt.dscrYear1", 2)
    add("Unlevered IRR %", f'IF({B["irrU"]}="","",{B["irrU"]}*100)', "returns.unlevered.irrPercent", 2)
    add("Unlevered NPV at discount rate", B["npvU"], "returns.unlevered.npvAtDiscountRate")
    add("Unlevered equity multiple", B["emU"], "returns.unlevered.equityMultiple", 2)
    add("Unlevered profit", B["profitU"], "returns.unlevered.totalProfit")
    add("Levered IRR %", f'IF({B["irrL"]}="","",{B["irrL"]}*100)', "returns.levered.irrPercent", 2)
    add("Levered equity multiple", B["emL"], "returns.levered.equityMultiple", 2)
    add("Levered initial equity", B["equity0"], "returns.levered.initialEquity")
    add("Levered profit", B["profitL"], "returns.levered.totalProfit")
    for i in range(5):
        for j in range(5):
            cellref = f"Valuation!${CL(3 + j)}${B['sensRow0'] + i}"
            add(f"Sensitivity [{i}][{j}]", cellref, f"sensitivity.values[{i}][{j}]")
    add("Concluded value", B["concluded"], "concluded.value")

    # engine adjustment list -> small lookup table at the right (names + amounts)
    put(ws, "I8", "Engine direct-cap adjustments (from Tape)", F_BOLD)
    adj0 = 9
    for k in range(10):
        p = f"$engine.directCap.adjustmentsApplied[{k}]"
        ws[f"I{adj0+k}"] = f'={LK(S(p + ".name"))}'
        ws[f"J{adj0+k}"] = f'={LK(S(p + ".amount"))}'
        ws[f"I{adj0+k}"].font = F_BASE
        ws[f"J{adj0+k}"].font = F_BASE
        ws[f"J{adj0+k}"].number_format = NF_NUM
    ws.column_dimensions["I"].width = 44
    ws.column_dimensions["J"].width = 14
    adjN = f"$I${adj0}:$I${adj0+9}"
    adjA = f"$J${adj0}:$J${adj0+9}"

    for label, wb_f, path, digits in rows:
        put(ws, f"B{r}", label)
        wb_expr = wb_f if not wb_f.startswith("=") else wb_f[1:]
        # Engine rounds with JavaScript Math.round (halves toward +infinity); Excel ROUND rounds halves away from zero.
        put(ws, f"C{r}", f'=IFERROR(IF(({wb_expr})="","",INT(({wb_expr})*10^{digits}+0.5)/10^{digits}),"")', F_BASE, NF_NUM2 if digits else NF_NUM)
        if path.startswith("ADJ:"):
            prefix = path[4:]
            n = len(prefix)
            eng = f'IF(SUMPRODUCT(--(LEFT({adjN},{n})="{prefix}"))=0,"",SUMPRODUCT(--(LEFT({adjN},{n})="{prefix}"),{adjA}))'
            put(ws, f"D{r}", f"={eng}", F_BASE, NF_NUM)
            put(ws, f"G{r}", f"directCap.adjustmentsApplied[name starts '{prefix}']", F_NOTE)
        else:
            put(ws, f"D{r}", f'={LKN(S("$engine." + path))}', F_BASE, NF_NUM2 if digits else NF_NUM)
            put(ws, f"G{r}", path, F_NOTE)
        put(ws, f"E{r}", f'=IF(AND(ISNUMBER(C{r}),ISNUMBER(D{r})),C{r}-D{r},"")', F_BASE, NF_NUM2 if digits else NF_NUM)
        put(ws, f"H{r}", f'=IFERROR(IF(({wb_expr})="","",{wb_expr}),"")', F_NOTE, "0.000000")
        tol = 0.5 * 10 ** (-digits)
        unit = 1.5 * 10 ** (-digits)
        # PASS*: one rounding unit apart only because the unrounded value sits on an x.5 boundary
        # (spreadsheet and JavaScript floating point differ in the last bit there).
        put(ws, f"F{r}", (f'=IF(AND(C{r}="",D{r}=""),"n/a",IF(HAS_ENGINE=0,"",'
                          f'IF(AND(ISNUMBER(C{r}),ISNUMBER(D{r})),IF(ABS(C{r}-D{r})<{tol},"PASS",'
                          f'IF(AND(ABS(C{r}-D{r})<{unit},ABS(MOD(H{r}*10^{digits},1)-0.5)<0.000001),"PASS*","FAIL")),"FAIL")))'), F_BOLD,
            align=Alignment(horizontal="center"))
        r += 1
    last = r - 1
    B.wb.defined_names["HAS_ENGINE"] = DefinedName("HAS_ENGINE", attr_text=B["hasEngine"])
    rng = f"$F${first}:$F${last}"
    ws[pass_cell] = f'=IF(HAS_ENGINE=0,"",(COUNTIF({rng},"PASS")+COUNTIF({rng},"PASS~*"))&" / "&(COUNTIF({rng},"PASS")+COUNTIF({rng},"PASS~*")+COUNTIF({rng},"FAIL")))'
    ws[pass_cell].font = F_BOLD
    capf = (f'=IF(OR(COUNTA(TapeP)>={TAPE_ROWS},{B["h"]}>{MAXM},'
            f'ISNUMBER(MATCH("rentRoll.leases[{NL}].leaseId",TapeP,0)),ISNUMBER(MATCH("rentRoll.vacantSuites[{NV}].sf",TapeP,0)),'
            f'ISNUMBER(MATCH("expenses.items[{NE}].expenseId",TapeP,0)),{B["nProf"]}>{NP}),'
            f'"OVER CAPACITY — see Start Here","within capacity")')
    ws[cap_cell] = capf
    ws[cap_cell].font = F_BOLD
    ws[status_cell] = (f'=IF(COUNTA(TapeP)=0,"No deal loaded",IF(LEFT({cap_cell},4)="OVER",{cap_cell},'
                       f'IF(HAS_ENGINE=0,"Workbook-only (no engine outputs in Tape to compare)",'
                       f'IF(COUNTIF({rng},"FAIL")=0,"MATCHES ENGINE","DIFFERS FROM ENGINE: "&COUNTIF({rng},"FAIL")&" outputs"))))')
    ws[status_cell].font = F_SUB
    B.wb.defined_names["CHECK_STATUS"] = DefinedName("CHECK_STATUS", attr_text=f"Check!${status_cell[0]}${status_cell[1:]}")
    ws.conditional_formatting.add(rng, CellIsRule(operator="equal", formula=['"PASS"'], fill=FILL_PASS))
    ws.conditional_formatting.add(rng, CellIsRule(operator="equal", formula=['"PASS*"'], fill=FILL_PASS))
    ws.conditional_formatting.add(rng, CellIsRule(operator="equal", formula=['"FAIL"'], fill=FILL_FAIL))
    ws.conditional_formatting.add(status_cell, FormulaRule(formula=[f'LEFT({status_cell},7)="MATCHES"'], fill=FILL_PASS))
    ws.conditional_formatting.add(status_cell, FormulaRule(formula=[f'LEFT({status_cell},7)="DIFFERS"'], fill=FILL_FAIL))
    ws.freeze_panes = f"C{first}"
    B.n["CHK_first"], B.n["CHK_last"] = first, last
    return ws


# =====================================================================
# Start Here
# =====================================================================
def build_start(B, macro):
    ws = B.sheet("Start Here", "C00000")
    ws.column_dimensions["A"].width = 2
    ws.column_dimensions["B"].width = 40
    ws.column_dimensions["C"].width = 110
    put(ws, "B1", "ORE Workbook", F_TITLE)
    put(ws, "B2", f"Open Real Estate (.ore) reader and native-formula engine · workbook {WORKBOOK_VERSION} · mirrors reference engine {ENGINE_VERSION}", F_NOTE)
    if macro:
        put(ws, "B3", "Load", F_BOLD, align=Alignment(vertical="center"))
        ws.row_dimensions[3].height = 33
    put(ws, "B4", "Loaded deal", F_BOLD)
    put(ws, "C4", f'=IF({B["propName"]}="","(none)",{B["propName"]})', F_SUB)
    put(ws, "B5", "Status", F_BOLD)
    put(ws, "C5", "=CHECK_STATUS", F_BOLD)
    r = 7
    section(ws, r, 2, "Load a deal", 2)
    r += 1
    ways = []
    if macro:
        ways.append(("Import button", "Click 'Import .ore file' above (or run the ImportOre macro: Alt+F8 on Windows, "
                                      "Tools > Macro > Macros on Mac). Pick a .ore file; the Tape is replaced and every sheet "
                                      "recalculates. 'Save Tape as .ore' writes the Tape back out as a .ore file. Macros must be "
                                      "enabled; a file downloaded from the web may need right-click > Properties > Unblock first."))
    ways.append(("Command line", "ore excel deal.ore -o deal.xlsx   writes a copy of this workbook with the deal loaded "
                                 "and the reference engine's outputs alongside, so the Check sheet compares the two."))
    ways.append(("Paste a tape", "ore tape deal.ore --engine   prints path<TAB>value rows with a header. Paste at Tape!A1 "
                                 "with Paste Special > Text so dates and IDs stay text."))
    ways.append(("By hand", "Type path/value rows into the Tape sheet. Paths follow the file: rentRoll.leases[0].leasedSF."))
    for a, b in ways:
        put(ws, f"B{r}", a, F_BOLD, align=Alignment(vertical="top"))
        put(ws, f"C{r}", b, F_BASE, align=Alignment(wrap_text=True, vertical="top"))
        ws.row_dimensions[r].height = 14 * (len(b) // 120 + 1) + 4
        r += 1
    r += 1
    section(ws, r, 2, "What is where", 2)
    r += 1
    tabs = [
        ("Summary", "One-page deal summary: property, rent roll stats, income, value, returns, provenance. Prints on one page."),
        ("Rent Roll", "Lease-by-lease abstract: dates, SF, rent today, escalations, reimbursement, free rent, options."),
        ("Expenses", "Operating expense schedule as stated in the file."),
        ("Assumptions", "Growth, leasing profiles, valuation and debt inputs as stated in the file."),
        ("Annual CF", "Annual cash flow over the hold and the year-1 NOI bridge."),
        ("Valuation", "Direct cap, DCF, debt, returns, sensitivity grid, lease metrics."),
        ("Check", "Each workbook output beside the reference engine's, PASS/FAIL. Green means the spreadsheet and the engine agree."),
        ("Tape", "The .ore file as path/value rows. The only input; everything else is formulas."),
        ("Data · SpaceParams · SpaceCalc · ExpCalc · MonthlyCF",
         "The engine, in formulas: parsed tables, per-space monthly streams (in-place lease plus probability-weighted rollover), "
         "monthly expenses, and the monthly property cash flow. Audit any number back to its inputs from here."),
    ]
    for a, b in tabs:
        put(ws, f"B{r}", a, F_BOLD, align=Alignment(vertical="top"))
        put(ws, f"C{r}", b, F_BASE, align=Alignment(wrap_text=True, vertical="top"))
        ws.row_dimensions[r].height = 14 * (len(b) // 120 + 1) + 2
        r += 1
    r += 1
    section(ws, r, 2, "Conventions", 2)
    r += 1
    conv = [
        ("Blue text", "Inputs: the Tape. Nothing else should be typed over."),
        ("Black text", "Formulas."),
        ("Your model", "Link your house model to the reader sheets or the Data tables (stable addresses), then load each new deal; nothing is re-keyed."),
        ("The math", "Formulas mirror the open-source reference engine (engine/src/index.ts). The repo's conformance test "
                     "recalculates this workbook for every example deal and requires it to reproduce the engine's golden outputs."),
        ("Not modeled here", "Engine warnings (disclosures) and the multi-deal portfolio roll-up stay in the engine; run `ore compute` for them."),
    ]
    for a, b in conv:
        put(ws, f"B{r}", a, F_BOLD if a != "Blue text" else Font(name=FONT, size=10, bold=True, color="0000FF"),
            align=Alignment(vertical="top"))
        put(ws, f"C{r}", b, F_BASE, align=Alignment(wrap_text=True, vertical="top"))
        ws.row_dimensions[r].height = 14 * (len(b) // 120 + 1) + 2
        r += 1
    r += 1
    section(ws, r, 2, "Capacity", 2)
    r += 1
    caps = [("Leases", NL), ("Vacant suites", NV), ("Rent steps per lease", MS), ("Free-rent periods per lease", MF),
            ("Expense exclusions per lease", MX), ("Options per lease", MO), ("Expense items", NE), ("Leasing profiles", NP),
            ("Months modeled (hold + 36)", MAXM), ("Tape rows", TAPE_ROWS)]
    for a, b in caps:
        put(ws, f"B{r}", a)
        put(ws, f"C{r}", b, F_BASE, align=Alignment(horizontal="left"))
        r += 1
    put(ws, f"B{r}", "Capacity check", F_BOLD)
    put(ws, f"C{r}", "=Check!$C$6", F_BOLD)
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
    B.n["start_button_row"] = 8
    return ws


def build(path, macro=False):
    B = Book()
    build_tape(B)
    build_data(B)
    sp = build_space_params(B)
    build_exp_calc(B)
    build_monthly(B)  # refers to names defined later (TV_NET etc.) by name only
    build_space_calc(B, sp)
    build_expenses(B)
    val = build_valuation(B)
    build_metrics(B, val)
    build_annual(B)
    build_summary(B)
    build_rent_roll(B)
    build_assumptions(B)
    build_check(B)
    build_start(B, macro)
    order = ["Start Here", "Summary", "Rent Roll", "Expenses", "Assumptions", "Annual CF", "Valuation", "Check",
             "Tape", "Data", "SpaceParams", "SpaceCalc", "ExpCalc", "MonthlyCF"]
    B.wb._sheets = [B.wb[n] for n in order]
    B.wb.active = 0
    for ws in B.wb.worksheets:
        ws.sheet_view.tabSelected = ws.title == "Start Here"
    for ws in B.wb.worksheets:
        for row in ws.iter_rows():
            for c in row:
                if c.value is not None and c.font.name == "Calibri":
                    c.font = F_BASE
    B.wb.calculation.fullCalcOnLoad = True
    B.wb.properties.title = "ORE Workbook"
    B.wb.properties.creator = "ORE (Open Real Estate) project"
    B.wb.save(path)
    return B


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "ORE-Workbook.xlsx"))
    ap.add_argument("--macro", action="store_true", help="Start Here text for the .xlsm (import buttons)")
    a = ap.parse_args()
    build(a.out, macro=a.macro)
    print("wrote", a.out)
