// ORE reference engine — v0.1.
//
// Pure functions, zero UI/runtime dependencies; compiles to a single ESM file
// that runs identically in Node and the browser. Replaces the thin calc kernel
// and closes its disclosed simplifications:
//   - MG leases: base-year / expense-stop recoveries computed (base year
//     estimated by deflating current expenses at the expense growth rate)
//   - rollover: true two-branch (renewal vs new tenant) expected-value
//     blending, memoized, with branch-correct timing of downtime, free rent,
//     and TI/LC (split, not lumped)
//   - general vacancy: de-duplicated against explicit modeled downtime
//   - DCF: mid-period and annual discounting conventions; unfunded free-rent
//     obligations deducted at exit when requested
//   - debt: full amortization schedule, levered cash flows, levered returns
//
// Conformance: engine outputs are locked by the golden files in
// engine/golden/. Any methodology change must re-lock goldens consciously.

import type {
  OreFile, Lease, LeasingProfile, Escalation, GrowthCurve, Warning,
  DirectCap, Dcf, Debt, RentUnit,
} from "./types.js";

export const ENGINE_VERSION = "0.1.0";

// ---------------------------------------------------------------- utilities

function monthIndex(dateStr: string, startStr: string): number {
  const [y, m] = dateStr.split("-").map(Number) as [number, number];
  const [sy, sm] = startStr.split("-").map(Number) as [number, number];
  return (y - sy) * 12 + (m - sm);
}

function yearOf(dateStr: string): number {
  return Number(dateStr.split("-")[0]);
}

function monthlyTotal(amount: number, unit: RentUnit | "perSFPerMonth" | "perSFPerYear", sf: number): number {
  switch (unit) {
    case "perSFPerMonth": return amount * sf;
    case "perSFPerYear": return (amount * sf) / 12;
    case "totalPerMonth": return amount;
    case "totalPerYear": return amount / 12;
  }
}

function rateForYear(curve: GrowthCurve, year1based: number): number {
  if (typeof curve === "number") return curve;
  let rate = curve[0]!.annualPercent;
  for (const step of curve) if (step.fromYear <= year1based) rate = step.annualPercent;
  return rate;
}

/** Compound growth factor from analysis start to month m (annual compounding on anniversaries). */
function growthFactor(curve: GrowthCurve | undefined, m: number): number {
  if (curve == null) return 1;
  let f = 1;
  for (let y = 1; y <= Math.floor(m / 12); y++) f *= 1 + rateForYear(curve, y) / 100;
  return f;
}

const round0 = (x: number) => Math.round(x);
const round2 = (x: number) => Math.round(x * 100) / 100;

function sum(a: number[], from: number, to: number): number {
  let s = 0;
  for (let i = Math.max(0, from); i < Math.min(a.length, to); i++) s += a[i]!;
  return s;
}

class Warnings {
  list: Warning[] = [];
  private seen = new Set<string>();
  add(code: string, message: string, dedupeKey?: string) {
    const key = dedupeKey ?? code + message;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.list.push({ code, message });
  }
}

// ----------------------------------------------------------- space streams
//
// Each space (a lease's premises or a vacant suite) produces monthly arrays:
//   sched   — expected base rent, unabated, for occupied (expected) months
//   free    — expected abated rent (free rent value)
//   pot     — potential base rent if fully occupied (vacancy base)
//   occSF   — expected occupied SF
//   recovNNN— expected SF recovering pro-rata (NNN/NN structures)
//   recovMG — direct recovery dollars (MG base-year / expense-stop leases)
//   ti, lc  — leasing costs (split)

interface Streams {
  sched: number[]; free: number[]; pot: number[]; occSF: number[];
  recovNNN: number[]; recovMG: number[]; ti: number[]; lc: number[];
}

function emptyStreams(h: number): Streams {
  const z = () => new Array<number>(h).fill(0);
  return { sched: z(), free: z(), pot: z(), occSF: z(), recovNNN: z(), recovMG: z(), ti: z(), lc: z() };
}

function addInto(dst: Streams, src: Streams, weight: number, h: number) {
  for (const k of Object.keys(dst) as (keyof Streams)[]) {
    for (let m = 0; m < h; m++) dst[k][m]! += weight * src[k][m]!;
  }
}

interface EngineCtx {
  deal: OreFile;
  start: string;
  buildingSF: number;
  horizon: number;
  warnings: Warnings;
  cpiAnnualPercent: number | null;
}

function escalationFactor(esc: Escalation | undefined, monthsIntoLease: number, ctx: EngineCtx): number {
  if (!esc || esc.type === "none") return 1;
  const freq = esc.frequencyMonths ?? 12;
  const k = Math.floor(monthsIntoLease / freq);
  if (k <= 0) return 1;
  if (esc.type === "fixed_percent") return Math.pow(1 + (esc.rate ?? 0) / 100, k);
  if (esc.type === "cpi") {
    let r = ctx.cpiAnnualPercent;
    if (r == null) {
      ctx.warnings.add("cpi_assumption_missing", "A lease escalates on CPI but marketAssumptions.growth.cpi is absent; 0% CPI assumed.");
      r = 0;
    }
    if (esc.cpiFloorPercent != null) r = Math.max(r, esc.cpiFloorPercent);
    if (esc.cpiCapPercent != null) r = Math.min(r, esc.cpiCapPercent);
    return Math.pow(1 + r / 100, k);
  }
  return 1; // fixed_amount handled by caller (additive)
}

function profileFor(ctx: EngineCtx, spaceType: string | undefined): LeasingProfile | null {
  const profiles = ctx.deal.marketAssumptions?.marketLeasing ?? {};
  const keys = Object.keys(profiles);
  if (keys.length === 0) return null;
  if (spaceType && profiles[spaceType]) return profiles[spaceType]!;
  if (spaceType && !profiles[spaceType]) {
    ctx.warnings.add("space_type_unmapped", `Space type "${spaceType}" has no market leasing profile; first profile ("${keys[0]}") applied.`, "stu:" + spaceType);
  } else if (keys.length > 1) {
    ctx.warnings.add("profile_fallback", `Multiple market leasing profiles and no space-type mapping for a lease; first profile ("${keys[0]}") applied.`);
  }
  return profiles[keys[0]!]!;
}

function marketRate(profile: LeasingProfile, sf: number, m: number, ctx: EngineCtx): number {
  const base = monthlyTotal(profile.marketRent.amount, profile.marketRent.unit, sf);
  return base * growthFactor(ctx.deal.marketAssumptions?.growth.marketRent, m);
}

/**
 * Expected-value stream from a rollover event at month t, memoized.
 * Renewal branch: lease starts at t (no downtime) at renewal % of market.
 * New-tenant branch: downtime, then a market lease with new-tenant costs.
 * Both branches recurse into the next rollover with full two-branch blending.
 */
function rolloverStreams(t: number, sf: number, profile: LeasingProfile, ctx: EngineCtx, memo: Map<number, Streams>): Streams {
  const cached = memo.get(t);
  if (cached) return cached;
  const h = ctx.horizon;
  const out = emptyStreams(h);
  memo.set(t, out); // set before recursing (cycles impossible: t strictly increases)
  if (t >= h) return out;

  const p = (profile.renewalProbabilityPercent ?? 0) / 100;
  const T = profile.termMonths;
  const D = profile.downtimeMonths ?? 0;
  const nnn = (profile.reimbursementStructure ?? "NNN") === "NNN" || (profile.reimbursementStructure ?? "NNN") === "NN";
  if ((profile.reimbursementStructure ?? "NNN") === "MG") {
    ctx.warnings.add("market_mg_simplified", "MG market leasing profile: first-calendar-year base year means near-zero recoveries early in each market lease; engine models zero recoveries for market MG leases.");
  }

  // renewal branch (weight p)
  if (p > 0) {
    const br = emptyStreams(h);
    const rate0 = ((profile.renewalRentPercentOfMarket ?? 100) / 100) * marketRate(profile, sf, t, ctx);
    const Fr = profile.renewal?.freeRentMonths ?? 0;
    leaseSegment(br, t, T, rate0, Fr, nnn, sf, profile.escalation, ctx);
    br.ti[t]! += (profile.renewal?.tiPerSF ?? 0) * sf;
    br.lc[t]! += ((profile.renewal?.lcPercentOfRent ?? 0) / 100) * termRentTotal(rate0, profile.escalation, T, ctx);
    addInto(br, rolloverStreams(t + T, sf, profile, ctx, memo), 1, h);
    addInto(out, br, p, h);
  }

  // new-tenant branch (weight 1-p)
  if (p < 1) {
    const bn = emptyStreams(h);
    for (let m = t; m < Math.min(t + D, h); m++) bn.pot[m]! += marketRate(profile, sf, m, ctx); // downtime: potential rent, no occupancy
    const s = t + D;
    if (s < h || true) {
      const rate0 = marketRate(profile, sf, Math.min(s, h - 1), ctx);
      const Fn = profile.newTenant?.freeRentMonths ?? 0;
      leaseSegment(bn, s, T, rate0, Fn, nnn, sf, profile.escalation, ctx);
      if (s < h) {
        bn.ti[s]! += (profile.newTenant?.tiPerSF ?? 0) * sf;
        bn.lc[s]! += ((profile.newTenant?.lcPercentOfRent ?? 0) / 100) * termRentTotal(rate0, profile.escalation, T, ctx);
      }
      addInto(bn, rolloverStreams(s + T, sf, profile, ctx, memo), 1, h);
    }
    addInto(out, bn, 1 - p, h);
  }
  return out;
}

/** One occupied lease segment: rent with escalations, free rent at start, occupancy, NNN recovery share. */
function leaseSegment(dst: Streams, start: number, term: number, rate0: number, freeMonths: number, nnn: boolean, sf: number, esc: Escalation | undefined, ctx: EngineCtx) {
  for (let m = Math.max(0, start); m < Math.min(start + term, ctx.horizon); m++) {
    const t = m - start;
    let rate = rate0 * escalationFactor(esc, t, ctx);
    if (esc?.type === "fixed_amount") rate = rate0; // per-SF fixed-amount steps for market leases not modeled; warn once
    dst.pot[m]! += rate;
    dst.occSF[m]! += sf;
    if (nnn) dst.recovNNN[m]! += sf;
    if (t < freeMonths) dst.free[m]! += rate;
    else dst.sched[m]! += rate;
  }
  if (esc?.type === "fixed_amount") {
    ctx.warnings.add("market_fixed_amount_escalation", "fixed_amount escalation on a market leasing profile is modeled as flat rent; use fixed_percent for market profiles in v0.1.");
  }
}

function termRentTotal(rate0: number, esc: Escalation | undefined, term: number, ctx: EngineCtx): number {
  let s = 0;
  for (let t = 0; t < term; t++) {
    s += esc?.type === "fixed_amount" ? rate0 : rate0 * escalationFactor(esc, t, ctx);
  }
  return s;
}

// ------------------------------------------------------- in-place contracts

function contractRate(lease: Lease, m: number, ctx: EngineCtx): number {
  const sched = lease.baseRent.schedule;
  let step = sched[0]!;
  let found = false;
  for (const s of sched) {
    if (monthIndex(s.startDate, ctx.start) <= m) { step = s; found = true; }
  }
  if (!found) {
    ctx.warnings.add("schedule_starts_late", `Lease ${lease.leaseId}: rent schedule starts after an analysis month; earliest step used.`, "ssl:" + lease.leaseId);
  }
  let rate = monthlyTotal(step.amount, lease.baseRent.unit, lease.leasedSF);
  const esc = lease.escalation;
  const last = sched[sched.length - 1]!;
  const lastStart = monthIndex(last.startDate, ctx.start);
  if (esc && esc.type !== "none" && lastStart <= m) {
    const base = monthlyTotal(last.amount, lease.baseRent.unit, lease.leasedSF);
    const monthsSince = m - lastStart;
    if (esc.type === "fixed_amount") {
      const k = Math.floor(monthsSince / (esc.frequencyMonths ?? 12));
      rate = base + monthlyTotal(esc.amount ?? 0, lease.baseRent.unit, lease.leasedSF) * k;
    } else {
      rate = base * escalationFactor(esc, monthsSince, ctx);
    }
  }
  return rate;
}

function abatement(lease: Lease, m: number, ctx: EngineCtx): { rentFactor: number; abatesReimb: boolean } {
  let factor = 1;
  let abatesReimb = false;
  for (const fr of lease.freeRent ?? []) {
    if (monthIndex(fr.startDate, ctx.start) <= m && m <= monthIndex(fr.endDate, ctx.start)) {
      const pct = (fr.percentAbated ?? 100) / 100;
      factor *= 1 - pct;
      if (fr.abatesReimbursements) abatesReimb = true;
    }
  }
  return { rentFactor: factor, abatesReimb };
}

// --------------------------------------------------------------- expenses

interface ExpenseMonth {
  aboveFixed: number;          // above-the-line non-mgmt expenses (all)
  recoverableFixed: number;    // recoverable subset (non-mgmt)
  belowLine: number;
  mgmtPct: number;             // percentOfEGR, as fraction
  mgmtRecoverable: boolean;
}

function expensesAt(ctx: EngineCtx, m: number, excludeIds?: string[]): ExpenseMonth {
  const out: ExpenseMonth = { aboveFixed: 0, recoverableFixed: 0, belowLine: 0, mgmtPct: 0, mgmtRecoverable: false };
  const growth = ctx.deal.marketAssumptions?.growth.expenses;
  for (const item of ctx.deal.expenses?.items ?? []) {
    if (excludeIds?.includes(item.expenseId)) continue;
    if (item.amountUnit === "percentOfEGR") {
      out.mgmtPct += item.amount / 100;
      if (item.recoverable) out.mgmtRecoverable = true;
      continue;
    }
    const annual = item.amountUnit === "perSFPerYear" ? item.amount * ctx.buildingSF : item.amount;
    const curve = item.growthOverridePercent != null ? item.growthOverridePercent : growth;
    const monthly = (annual / 12) * growthFactor(curve, m);
    if (item.belowTheLine) out.belowLine += monthly;
    else {
      out.aboveFixed += monthly;
      if (item.recoverable) out.recoverableFixed += monthly;
    }
  }
  return out;
}

/** Recoverable fixed expenses for a single lease's recovery base (handles per-lease exclusions). */
function leaseRecovBase(ctx: EngineCtx, m: number, lease: Lease): number {
  return expensesAt(ctx, m, lease.reimbursement.excludedExpenses).recoverableFixed;
}

// ------------------------------------------------------------ the model

export interface MonthlyModel {
  sched: number[]; free: number[]; pot: number[]; occSF: number[];
  recoveries: number[]; generalVacancyLoss: number[]; creditLoss: number[];
  egr: number[]; opexFixed: number[]; mgmtFee: number[]; noi: number[];
  belowLine: number[]; ti: number[]; lc: number[]; cashFlow: number[];
  contractVsMarket: number[];
}

export function buildModel(deal: OreFile, horizon: number, warnings: Warnings): MonthlyModel {
  const start = deal.valuation?.analysisStartDate ?? deal.rentRoll.asOfDate;
  const ctx: EngineCtx = {
    deal, start,
    buildingSF: deal.property.physical.buildingSF,
    horizon,
    warnings,
    cpiAnnualPercent: deal.marketAssumptions?.growth.cpi != null
      ? rateForYear(deal.marketAssumptions.growth.cpi, 1) : null,
  };
  if (deal.marketAssumptions?.growth.cpi != null && typeof deal.marketAssumptions.growth.cpi !== "number") {
    warnings.add("cpi_curve_flattened", "CPI growth curve provided; engine v0.1 applies the year-1 CPI rate to CPI lease escalations across all years.");
  }
  const feeSimple = deal.valuation?.interestAppraised === "fee_simple";
  if (feeSimple) {
    warnings.add("fee_simple_basis", "interestAppraised is fee_simple: in-place leases are replaced with market terms from the analysis start.");
  }

  const total = emptyStreams(horizon);
  const mgRecov = new Array<number>(horizon).fill(0);
  const contractVsMarket = new Array<number>(horizon).fill(0);

  // --- in-place leases (or market terms throughout, if fee simple)
  for (const lease of deal.rentRoll.leases) {
    const profile = profileFor(ctx, undefined);
    const memo = new Map<number, Streams>();
    if (feeSimple) {
      if (profile) addInto(total, rolloverStreams(0, lease.leasedSF, profile, ctx, memo), 1, horizon);
      continue;
    }
    const expiry = monthIndex(lease.expirationDate, ctx.start) + 1; // active through expiration month
    const share = (lease.reimbursement.proRataSharePercent ?? (lease.leasedSF / ctx.buildingSF) * 100) / 100;
    const structure = lease.reimbursement.structure;

    // MG / expense-stop base
    let mgBaseMonthly: number | null = null;
    if (structure === "MG") {
      const r = lease.reimbursement;
      if (r.expenseStopPerSF != null) {
        mgBaseMonthly = (r.expenseStopPerSF * lease.leasedSF) / 12 / share; // stop stated per tenant SF; convert to building-level base
        warnings.add("mg_stop_applied", `Lease ${lease.leaseId}: expense-stop recovery computed (share of recoverable expenses above $${r.expenseStopPerSF}/SF/yr).`, "stop:" + lease.leaseId);
      } else if (r.baseYear != null) {
        const yearsBack = yearOf(ctx.start) - r.baseYear;
        const g = rateForYear(deal.marketAssumptions?.growth.expenses ?? 0, 1);
        const recovNow = expensesAt(ctx, 0, r.excludedExpenses).recoverableFixed;
        mgBaseMonthly = recovNow / Math.pow(1 + g / 100, Math.max(0, yearsBack));
        warnings.add("mg_base_year_estimated", `Lease ${lease.leaseId}: ${r.baseYear} base-year expenses estimated by deflating current recoverable expenses at ${g}%/yr; provide actuals via expenseStopPerSF for precision.`, "mgest:" + lease.leaseId);
      } else {
        warnings.add("mg_no_base", `Lease ${lease.leaseId}: MG lease has neither baseYear nor expenseStopPerSF; zero recoveries modeled.`, "mgnb:" + lease.leaseId);
      }
    }
    if (lease.reimbursement.adminFeePercent) {
      warnings.add("admin_fee_not_modeled", `Lease ${lease.leaseId}: reimbursement.adminFeePercent not modeled in engine v0.1.`, "adm:" + lease.leaseId);
    }

    for (let m = 0; m < Math.min(expiry, horizon); m++) {
      const rate = contractRate(lease, m, ctx);
      const ab = abatement(lease, m, ctx);
      total.pot[m]! += rate;
      total.occSF[m]! += lease.leasedSF;
      total.sched[m]! += rate * ab.rentFactor;
      total.free[m]! += rate * (1 - ab.rentFactor);
      const reimbursing = !(ab.abatesReimb && ab.rentFactor < 1);
      if ((structure === "NNN" || structure === "NN") && reimbursing) {
        // per-lease exclusions: recover share of (recoverable − excluded)
        if (lease.reimbursement.excludedExpenses?.length) {
          mgRecov[m]! += share * leaseRecovBase(ctx, m, lease); // direct dollars, bypasses aggregate frac
        } else {
          total.recovNNN[m]! += lease.leasedSF * (share / (lease.leasedSF / ctx.buildingSF)); // normalized SF honoring stated share
        }
      }
      if (structure === "MG" && mgBaseMonthly != null && reimbursing) {
        const recovNow = leaseRecovBase(ctx, m, lease);
        mgRecov[m]! += Math.max(0, share * (recovNow - mgBaseMonthly * growthFactor(0, m)));
      }
      if (profile) contractVsMarket[m]! += rate - marketRate(profile, lease.leasedSF, m, ctx);
    }

    // unfunded in-place TI/LC obligations
    const tiAmt = lease.tenantImprovements
      ? (lease.tenantImprovements.totalAmount ?? (lease.tenantImprovements.amountPerSF ?? 0) * lease.leasedSF) : 0;
    if (tiAmt > 0) {
      const fm = lease.tenantImprovements!.fundingDate ? Math.max(0, monthIndex(lease.tenantImprovements!.fundingDate, ctx.start)) : 1;
      if (fm < horizon) total.ti[fm]! += tiAmt;
    }
    const lcObj = lease.leasingCommissions;
    if (lcObj) {
      let lcAmt = lcObj.totalAmount ?? (lcObj.amountPerSF != null ? lcObj.amountPerSF * lease.leasedSF : 0);
      if (lcObj.percentOfTotalRent != null) {
        let totRent = 0;
        for (let m = Math.max(0, monthIndex(lease.commencementDate, ctx.start)); m < expiry; m++) totRent += contractRate(lease, m, ctx);
        lcAmt = (lcObj.percentOfTotalRent / 100) * totRent;
      }
      const fm = lcObj.fundingDate ? Math.max(0, monthIndex(lcObj.fundingDate, ctx.start)) : 1;
      if (lcAmt > 0 && fm < horizon) total.lc[fm]! += lcAmt;
    }

    // rollover after expiry
    if (!feeSimple && expiry < horizon) {
      if (profile) addInto(total, rolloverStreams(expiry, lease.leasedSF, profile, ctx, memo), 1, horizon);
      else warnings.add("no_market_profile", "No marketAssumptions.marketLeasing profile: expired space produces no rent after expiry.");
    }
  }

  // --- vacant suites: new-tenant lease-up from month 0 (no renewal possibility at the first event)
  for (const suite of deal.rentRoll.vacantSuites ?? []) {
    const profile = profileFor(ctx, suite.spaceType);
    if (!profile) {
      warnings.add("vacant_no_profile", `Vacant suite ${suite.suite ?? "?"} has no market leasing profile; modeled as permanently vacant.`, "vnp:" + (suite.suite ?? "?"));
      continue;
    }
    const memo = new Map<number, Streams>();
    const bn = emptyStreams(horizon);
    const D = profile.downtimeMonths ?? 0;
    const nnn = (profile.reimbursementStructure ?? "NNN") !== "MG" && (profile.reimbursementStructure ?? "NNN") !== "Gross";
    for (let m = 0; m < Math.min(D, horizon); m++) bn.pot[m]! += marketRate(profile, suite.sf, m, ctx);
    const s = D;
    const rate0 = marketRate(profile, suite.sf, Math.min(s, horizon - 1), ctx);
    leaseSegment(bn, s, profile.termMonths, rate0, profile.newTenant?.freeRentMonths ?? 0, nnn, suite.sf, profile.escalation, ctx);
    if (s < horizon) {
      bn.ti[s]! += (profile.newTenant?.tiPerSF ?? 0) * suite.sf;
      bn.lc[s]! += ((profile.newTenant?.lcPercentOfRent ?? 0) / 100) * termRentTotal(rate0, profile.escalation, profile.termMonths, ctx);
    }
    addInto(bn, rolloverStreams(s + profile.termMonths, suite.sf, profile, ctx, memo), 1, horizon);
    addInto(total, bn, 1, horizon);
  }

  // --- monthly economics
  const gvPct = (deal.marketAssumptions?.generalVacancyPercent ?? 0) / 100;
  const clPct = (deal.marketAssumptions?.creditLossPercent ?? 0) / 100;

  const model: MonthlyModel = {
    sched: total.sched, free: total.free, pot: total.pot, occSF: total.occSF,
    recoveries: new Array(horizon).fill(0), generalVacancyLoss: new Array(horizon).fill(0),
    creditLoss: new Array(horizon).fill(0), egr: new Array(horizon).fill(0),
    opexFixed: new Array(horizon).fill(0), mgmtFee: new Array(horizon).fill(0),
    noi: new Array(horizon).fill(0), belowLine: new Array(horizon).fill(0),
    ti: total.ti, lc: total.lc, cashFlow: new Array(horizon).fill(0),
    contractVsMarket,
  };

  for (let m = 0; m < horizon; m++) {
    const e = expensesAt(ctx, m);
    const recovFrac = Math.min(1, total.recovNNN[m]! / ctx.buildingSF);
    // recoveries (NNN aggregate + MG/excluded direct), mgmt fee circular when recoverable:
    //   EGR = rent + recovFrac*(recovFixed + mgmtRec*mgmtPct*EGR) + mgDirect
    const rentCollected = total.sched[m]!;
    const fixedRecov = recovFrac * e.recoverableFixed + mgRecov[m]!;
    const denom = 1 - (e.mgmtRecoverable ? recovFrac * e.mgmtPct : 0);
    const egr = (rentCollected + fixedRecov) / (denom <= 0 ? 1 : denom);
    const recoveries = egr - rentCollected;
    // general vacancy de-duplicated: allowance = max(0, gv% * potential gross − explicit vacancy already modeled)
    const explicitVacancy = total.pot[m]! - total.sched[m]! - total.free[m]!;
    const gvLoss = Math.max(0, gvPct * (total.pot[m]! + recoveries) - explicitVacancy);
    const clLoss = clPct * Math.max(0, egr - gvLoss);
    const egrNet = egr - gvLoss - clLoss;
    const mgmt = e.mgmtPct * egr;
    const noi = egrNet - e.aboveFixed - mgmt;

    model.recoveries[m] = recoveries;
    model.generalVacancyLoss[m] = gvLoss;
    model.creditLoss[m] = clLoss;
    model.egr[m] = egrNet;
    model.opexFixed[m] = e.aboveFixed;
    model.mgmtFee[m] = mgmt;
    model.noi[m] = noi;
    model.belowLine[m] = e.belowLine;
    model.cashFlow[m] = noi - e.belowLine - total.ti[m]! - total.lc[m]!;
  }
  return model;
}

// -------------------------------------------------------------- valuation

function stabilizedAnnualNOI(deal: OreFile, atMonth: number, warnings: Warnings): number | null {
  const profiles = deal.marketAssumptions?.marketLeasing ?? {};
  const key = Object.keys(profiles)[0];
  if (!key) return null;
  const ctx: EngineCtx = {
    deal, start: deal.valuation?.analysisStartDate ?? deal.rentRoll.asOfDate,
    buildingSF: deal.property.physical.buildingSF, horizon: atMonth + 1, warnings,
    cpiAnnualPercent: null,
  };
  const profile = profiles[key]!;
  const rentM = marketRate(profile, ctx.buildingSF, atMonth, ctx);
  const e = expensesAt(ctx, atMonth);
  const nnn = (profile.reimbursementStructure ?? "NNN") === "NNN" || (profile.reimbursementStructure ?? "NNN") === "NN";
  const recovFrac = nnn ? 1 : 0;
  const denom = 1 - (e.mgmtRecoverable ? recovFrac * e.mgmtPct : 0);
  const egr = (rentM + recovFrac * e.recoverableFixed) / (denom <= 0 ? 1 : denom);
  const gv = ((deal.marketAssumptions?.generalVacancyPercent ?? 0) + (deal.marketAssumptions?.creditLossPercent ?? 0)) / 100;
  return (egr * (1 - gv) - e.aboveFixed - e.mgmtPct * egr) * 12;
}

function pvOf(cf: number[], from: number, to: number, annualRatePct: number, timing: "monthly" | "annual", convention: "end" | "mid"): number {
  const r = annualRatePct / 100;
  if (timing === "annual") {
    let pv = 0;
    for (let y = 0; y * 12 < to - from; y++) {
      const cfy = sum(cf, from + y * 12, Math.min(to, from + (y + 1) * 12));
      const t = convention === "mid" ? y + 0.5 : y + 1;
      pv += cfy / Math.pow(1 + r, t);
    }
    return pv;
  }
  let pv = 0;
  for (let m = from; m < to; m++) {
    const t = convention === "mid" ? (m - from + 0.5) / 12 : (m - from + 1) / 12;
    pv += cf[m]! / Math.pow(1 + r, t);
  }
  return pv;
}

export interface DirectCapResult {
  basis: string; basisNOI: number; capRatePercent: number; grossValue: number;
  adjustmentsApplied: { name: string; amount: number }[];
  indicatedValue: number; perSF: number;
}

export function computeDirectCap(deal: OreFile, model: MonthlyModel, warnings: Warnings): DirectCapResult | null {
  const dc: DirectCap | undefined = deal.valuation?.directCap;
  if (!dc) return null;
  const sf = deal.property.physical.buildingSF;
  let basisNOI: number | null = null;

  if (dc.excludeExpenseIds?.length) {
    // rebuild a small context to price the excluded items in year 1
    const ctx: EngineCtx = { deal, start: deal.valuation!.analysisStartDate, buildingSF: sf, horizon: 12, warnings, cpiAnnualPercent: null };
    let excluded = 0;
    for (let m = 0; m < 12; m++) {
      excluded += expensesAt(ctx, m).aboveFixed - expensesAt(ctx, m, dc.excludeExpenseIds).aboveFixed;
    }
    warnings.add("exclusions_added_back", `directCap.excludeExpenseIds: ${dc.excludeExpenseIds.join(", ")} added back to basis NOI (recovery interaction not re-solved).`);
    basisNOI = (dc.noiBasis === "year1" ? sum(model.noi, 0, 12) : null as never) ?? null;
    if (basisNOI != null) basisNOI += excluded;
  }

  if (basisNOI == null) {
    if (dc.noiBasis === "year1") basisNOI = sum(model.noi, 0, 12);
    else if (dc.noiBasis === "inPlace") basisNOI = model.noi[0]! * 12;
    else if (dc.noiBasis === "stabilizedAtMarket") basisNOI = stabilizedAnnualNOI(deal, 0, warnings);
    else if (dc.noiBasis === "custom" || dc.noiBasis === "trailing12") basisNOI = dc.customNOI ?? null;
  }
  if (basisNOI == null) {
    warnings.add("direct_cap_incomputable", `Direct cap NOI basis "${dc.noiBasis}" could not be computed from this file.`);
    return null;
  }
  if (dc.applyGeneralVacancy === false && dc.noiBasis !== "custom" && dc.noiBasis !== "trailing12") {
    basisNOI += sum(model.generalVacancyLoss, 0, 12) + sum(model.creditLoss, 0, 12);
  }
  if (dc.deductBelowTheLineItems) basisNOI -= sum(model.belowLine, 0, 12);

  let value = basisNOI / (dc.capRatePercent / 100);
  const grossValue = value;
  const applied: { name: string; amount: number }[] = [];

  if (dc.markToMarket) {
    const r = dc.markToMarket.discountRatePercent / 100;
    let mtm = 0;
    for (let m = 0; m < model.contractVsMarket.length; m++) {
      mtm += model.contractVsMarket[m]! / Math.pow(1 + r, (m + 1) / 12);
    }
    value += mtm;
    applied.push({ name: "Mark-to-market (PV of contract vs market)", amount: round0(mtm) });
  }
  if (dc.nearTermAdjustments) {
    const n = dc.nearTermAdjustments;
    const P = Math.min(n.periodMonths, model.sched.length);
    const r = n.discountRatePercent;
    const df = (m: number) => (r == null ? 1 : 1 / Math.pow(1 + r / 100, (m + 1) / 12));
    let lost = 0, freeR = 0, ti = 0, lc = 0;
    for (let m = 0; m < P; m++) {
      lost += (model.pot[m]! - model.sched[m]! - model.free[m]!) * df(m);
      freeR += model.free[m]! * df(m);
      ti += model.ti[m]! * df(m);
      lc += model.lc[m]! * df(m);
    }
    const parts: [string, boolean, number][] = [
      ["downtime lost rent", n.includeDowntimeLostRent !== false, lost],
      ["free rent", n.includeFreeRent !== false, freeR],
      ["TI", n.includeTI !== false, ti],
      ["LC", n.includeLC !== false, lc],
    ];
    for (const [name, on, amt] of parts) {
      if (!on || amt === 0) continue;
      value -= amt;
      applied.push({ name: `Near-term ${name} (${n.periodMonths} mo${r != null ? ", PV" : ""})`, amount: -round0(amt) });
    }
  }
  for (const adj of deal.valuation?.directCap?.adjustments ?? []) {
    const signed = adj.type === "deduction" ? -adj.amount : adj.amount;
    value += signed;
    applied.push({ name: adj.name, amount: round0(signed) });
  }
  return {
    basis: dc.noiBasis, basisNOI: round0(basisNOI), capRatePercent: dc.capRatePercent,
    grossValue: round0(grossValue), adjustmentsApplied: applied,
    indicatedValue: round0(value), perSF: round2(value / sf),
  };
}

export interface DcfResult {
  holdMonths: number; discountRatePercent: number; reversionDiscountRatePercent: number;
  pvOperating: number; terminalGross: number; terminalNet: number; pvTerminal: number;
  indicatedValue: number; perSF: number;
  unfundedObligationsDeducted: number | null;
}

export function computeDCF(deal: OreFile, model: MonthlyModel, warnings: Warnings): DcfResult | null {
  const dcf: Dcf | undefined = deal.valuation?.dcf;
  if (!dcf) return null;
  const H = dcf.holdPeriodMonths ?? dcf.holdPeriodYears! * 12;
  const sf = deal.property.physical.buildingSF;
  const timing = dcf.discountTiming ?? "monthly";
  const convention = dcf.periodConvention ?? "end";
  const tv = dcf.terminalValue;

  let terminalGross: number | null = null;
  if (tv.method === "direct_cap") {
    let tNOI: number | null = null;
    const basis = tv.noiBasis ?? "forwardYear";
    if (basis === "forwardYear") tNOI = sum(model.noi, H, H + 12);
    else if (basis === "trailingYear") tNOI = sum(model.noi, H - 12, H);
    else tNOI = stabilizedAnnualNOI(deal, H, warnings);
    if (tNOI == null) { warnings.add("terminal_incomputable", "Terminal NOI basis could not be computed; DCF skipped."); return null; }
    if (tv.deductBelowTheLineItems) tNOI -= sum(model.belowLine, H, H + 12);
    terminalGross = tNOI / (tv.capRatePercent! / 100);
  } else if (tv.method === "exit_price_psf") terminalGross = tv.exitPricePerSF! * sf;
  else if (tv.method === "fixed_value") terminalGross = tv.fixedValue!;
  else {
    if (deal.valuation?.purchasePrice == null) { warnings.add("terminal_incomputable", "grown_purchase_price terminal requires purchasePrice."); return null; }
    terminalGross = deal.valuation.purchasePrice * Math.pow(1 + tv.annualAppreciationPercent! / 100, H / 12);
  }

  let unfunded: number | null = null;
  if (tv.deductUnfundedObligations) {
    unfunded = sum(model.free, H, model.free.length); // remaining free rent on leases extending past sale, face value
    terminalGross -= unfunded;
  }
  const terminalNet = terminalGross * (1 - (tv.sellingCostsPercent ?? 0) / 100);
  const pvOperating = pvOf(model.cashFlow, 0, H, dcf.discountRatePercent, timing, convention);
  const rRev = dcf.reversionDiscountRatePercent ?? dcf.discountRatePercent;
  const pvTerminal = terminalNet / Math.pow(1 + rRev / 100, H / 12);
  const value = pvOperating + pvTerminal;
  return {
    holdMonths: H, discountRatePercent: dcf.discountRatePercent, reversionDiscountRatePercent: rRev,
    pvOperating: round0(pvOperating), terminalGross: round0(terminalGross), terminalNet: round0(terminalNet),
    pvTerminal: round0(pvTerminal), indicatedValue: round0(value), perSF: round2(value / sf),
    unfundedObligationsDeducted: unfunded != null ? round0(unfunded) : null,
  };
}

// ------------------------------------------------------------------ debt

export interface DebtSchedule {
  loanAmount: number; netProceeds: number; fundingMonth: number;
  service: number[]; balance: number[]; // by month index
  year1DebtService: number | null; dscrYear1: number | null;
}

export function buildDebt(deal: OreFile, model: MonthlyModel, H: number, warnings: Warnings): DebtSchedule | null {
  const d: Debt | undefined = deal.debt;
  if (!d) return null;
  let amount = d.loanAmount ?? null;
  if (amount == null && d.ltvPercent != null) {
    if (deal.valuation?.purchasePrice == null) {
      warnings.add("ltv_needs_price", "debt.ltvPercent requires valuation.purchasePrice; debt skipped.");
      return null;
    }
    amount = (d.ltvPercent / 100) * deal.valuation.purchasePrice;
  }
  if (amount == null) return null;
  const start = deal.valuation?.analysisStartDate ?? deal.rentRoll.asOfDate;
  const f0 = d.fundingDate ? Math.max(0, monthIndex(d.fundingDate, start)) : 0;
  const i = d.interestRatePercent / 100 / 12;
  const io = d.interestOnlyMonths ?? 0;
  const horizon = model.cashFlow.length;
  const service = new Array<number>(horizon).fill(0);
  const balance = new Array<number>(horizon).fill(0);
  let bal = amount;
  let pmt: number | null = null;
  if (d.termMonths < H) {
    warnings.add("loan_term_lt_hold", `Loan term (${d.termMonths} mo) ends before the hold (${H} mo); per spec, payoff is assumed refinanced on identical terms (schedule continues).`);
  }
  for (let m = f0; m < horizon; m++) {
    const age = m - f0;
    if (age < io || d.amortizationMonths == null) {
      service[m] = bal * i;
    } else {
      if (pmt == null) pmt = (bal * i) / (1 - Math.pow(1 + i, -(d.amortizationMonths)));
      const interest = bal * i;
      const principal = Math.min(bal, pmt - interest);
      service[m] = interest + principal;
      bal -= principal;
    }
    balance[m] = bal;
  }
  const y1 = sum(service, 0, 12);
  const noiY1 = sum(model.noi, 0, 12);
  return {
    loanAmount: round0(amount),
    netProceeds: round0(amount * (1 - (d.originationFeePercent ?? 0) / 100)),
    fundingMonth: f0,
    service, balance,
    year1DebtService: round0(y1),
    dscrYear1: y1 > 0 ? round2(noiY1 / y1) : null,
  };
}

// --------------------------------------------------------------- returns

function irrAnnual(cashflows: number[]): number | null {
  // cashflows[t] at month t (t=0 is the initial outflow). Bisection on monthly rate.
  const npv = (rm: number) => cashflows.reduce((s, cf, t) => s + cf / Math.pow(1 + rm, t), 0);
  let lo = -0.08, hi = 0.5; // monthly: ~-63%/yr .. ~13000%/yr
  let flo = npv(lo), fhi = npv(hi);
  if (isNaN(flo) || isNaN(fhi) || flo * fhi > 0) return null;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (flo * fm <= 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  const rm = (lo + hi) / 2;
  return round2((Math.pow(1 + rm, 12) - 1) * 100);
}

export interface ReturnsResult {
  unlevered: { irrPercent: number | null; npvAtDiscountRate: number | null; equityMultiple: number | null; totalProfit: number | null } | null;
  levered: { irrPercent: number | null; equityMultiple: number | null; initialEquity: number; totalProfit: number | null } | null;
}

export function computeReturns(deal: OreFile, model: MonthlyModel, dcfRes: DcfResult | null, debt: DebtSchedule | null): ReturnsResult {
  const v = deal.valuation;
  if (!v?.purchasePrice || !dcfRes) return { unlevered: null, levered: null };
  const H = dcfRes.holdMonths;
  const totalCost = v.purchasePrice * (1 + (v.acquisitionCostsPercent ?? 0) / 100);

  const cfU: number[] = [-totalCost];
  for (let m = 0; m < H; m++) cfU.push(model.cashFlow[m]!);
  cfU[H] = cfU[H]! + dcfRes.terminalNet;
  const distributionsU = cfU.slice(1).reduce((s, x) => s + x, 0);
  const unlevered = {
    irrPercent: irrAnnual(cfU),
    npvAtDiscountRate: round0(dcfRes.indicatedValue - totalCost),
    equityMultiple: totalCost > 0 ? round2(distributionsU / totalCost) : null,
    totalProfit: round0(cfU.reduce((s, x) => s + x, 0)),
  };

  let levered: ReturnsResult["levered"] = null;
  if (debt) {
    const equity0 = totalCost - debt.netProceeds;
    const cfL: number[] = [-equity0];
    for (let m = 0; m < H; m++) cfL.push(model.cashFlow[m]! - debt.service[m]!);
    const payoff = debt.balance[H - 1] ?? 0;
    cfL[H] = cfL[H]! + dcfRes.terminalNet - payoff;
    levered = {
      irrPercent: irrAnnual(cfL),
      equityMultiple: equity0 > 0 ? round2(cfL.slice(1).reduce((s, x) => s + x, 0) / equity0) : null,
      initialEquity: round0(equity0),
      totalProfit: round0(cfL.reduce((s, x) => s + x, 0)),
    };
  }
  return { unlevered, levered };
}

// ------------------------------------------------------------ sensitivity

export interface SensitivityResult {
  discountRatesPercent: number[];
  exitCapRatesPercent: number[] | null;
  values: number[][]; // rows: discount rates; cols: exit caps (or single col)
}

export function computeSensitivity(deal: OreFile, model: MonthlyModel, warnings: Warnings): SensitivityResult | null {
  const dcf = deal.valuation?.dcf;
  if (!dcf) return null;
  const H = dcf.holdPeriodMonths ?? dcf.holdPeriodYears! * 12;
  const timing = dcf.discountTiming ?? "monthly";
  const convention = dcf.periodConvention ?? "end";
  const tv = dcf.terminalValue;
  const discounts = [-1, -0.5, 0, 0.5, 1].map((d) => round2(dcf.discountRatePercent + d));

  let tNOI: number | null = null;
  if (tv.method === "direct_cap") {
    const basis = tv.noiBasis ?? "forwardYear";
    if (basis === "forwardYear") tNOI = sum(model.noi, H, H + 12);
    else if (basis === "trailingYear") tNOI = sum(model.noi, H - 12, H);
    else tNOI = stabilizedAnnualNOI(deal, H, warnings);
    if (tNOI != null && tv.deductBelowTheLineItems) tNOI -= sum(model.belowLine, H, H + 12);
  }
  const caps = tv.method === "direct_cap" && tNOI != null
    ? [-0.5, -0.25, 0, 0.25, 0.5].map((d) => round2(tv.capRatePercent! + d))
    : null;

  const unfunded = tv.deductUnfundedObligations ? sum(model.free, H, model.free.length) : 0;
  const fixedGross = tv.method === "exit_price_psf" ? tv.exitPricePerSF! * deal.property.physical.buildingSF
    : tv.method === "fixed_value" ? tv.fixedValue!
    : tv.method === "grown_purchase_price" && deal.valuation?.purchasePrice != null
      ? deal.valuation.purchasePrice * Math.pow(1 + tv.annualAppreciationPercent! / 100, H / 12)
      : null;

  const values: number[][] = [];
  for (const dr of discounts) {
    const pvOp = pvOf(model.cashFlow, 0, H, dr, timing, convention);
    const rRev = (dcf.reversionDiscountRatePercent ?? dcf.discountRatePercent) + (dr - dcf.discountRatePercent);
    const row: number[] = [];
    for (const cap of caps ?? [null]) {
      const gross = cap != null ? tNOI! / (cap / 100) : fixedGross;
      if (gross == null) return null;
      const net = (gross - unfunded) * (1 - (tv.sellingCostsPercent ?? 0) / 100);
      row.push(round0(pvOp + net / Math.pow(1 + rRev / 100, H / 12)));
    }
    values.push(row);
  }
  return { discountRatesPercent: discounts, exitCapRatesPercent: caps, values };
}

// -------------------------------------------------------- annual rollup

export interface AnnualRow {
  year: number; months: number;
  scheduledBaseRent: number; freeRent: number; absorptionVacancy: number;
  expenseRecoveries: number; generalVacancy: number; creditLoss: number;
  effectiveGrossRevenue: number; operatingExpenses: number; managementFee: number;
  noi: number; belowTheLine: number; tiCosts: number; lcCosts: number; cashFlow: number;
}

function annualTable(model: MonthlyModel, H: number): AnnualRow[] {
  const rows: AnnualRow[] = [];
  for (let y = 0; y * 12 < H; y++) {
    const a = y * 12, b = Math.min(H, a + 12);
    rows.push({
      year: y + 1, months: b - a,
      scheduledBaseRent: round0(sum(model.sched, a, b)),
      freeRent: round0(-sum(model.free, a, b)),
      absorptionVacancy: round0(-(sum(model.pot, a, b) - sum(model.sched, a, b) - sum(model.free, a, b))),
      expenseRecoveries: round0(sum(model.recoveries, a, b)),
      generalVacancy: round0(-sum(model.generalVacancyLoss, a, b)),
      creditLoss: round0(-sum(model.creditLoss, a, b)),
      effectiveGrossRevenue: round0(sum(model.egr, a, b)),
      operatingExpenses: round0(-sum(model.opexFixed, a, b)),
      managementFee: round0(-sum(model.mgmtFee, a, b)),
      noi: round0(sum(model.noi, a, b)),
      belowTheLine: round0(-sum(model.belowLine, a, b)),
      tiCosts: round0(-sum(model.ti, a, b)),
      lcCosts: round0(-sum(model.lc, a, b)),
      cashFlow: round0(sum(model.cashFlow, a, b)),
    });
  }
  return rows;
}

// ------------------------------------------------------------- computeAll

export function computeAll(deal: OreFile) {
  const warnings = new Warnings();
  const start = deal.valuation?.analysisStartDate ?? deal.rentRoll.asOfDate;
  const sf = deal.property.physical.buildingSF;
  const dcfIn = deal.valuation?.dcf;
  const H = dcfIn ? (dcfIn.holdPeriodMonths ?? dcfIn.holdPeriodYears! * 12) : 12;
  if (dcfIn?.discountTiming === "annual") {
    warnings.add("annual_timing", "discountTiming \"annual\": cash flows aggregated by year and discounted annually, per the file.");
  }
  const horizon = Math.max(H + 36, 48);
  const model = buildModel(deal, horizon, warnings);

  // occupancy at asOf
  let occupiedSF = 0;
  for (const l of deal.rentRoll.leases) occupiedSF += l.leasedSF;
  let vacantSF = 0;
  for (const v of deal.rentRoll.vacantSuites ?? []) vacantSF += v.sf;
  if (Math.abs(occupiedSF + vacantSF - sf) > sf * 0.005) {
    warnings.add("sf_mismatch", `Leased SF (${occupiedSF}) + vacant SF (${vacantSF}) != building SF (${sf}).`);
  }

  // in-place rent at month 0
  const ctx0: EngineCtx = { deal, start, buildingSF: sf, horizon: 1, warnings, cpiAnnualPercent: null };
  let inPlaceMonthly = 0;
  for (const lease of deal.rentRoll.leases) inPlaceMonthly += contractRate(lease, 0, ctx0);
  const waInPlace = occupiedSF > 0 ? inPlaceMonthly / occupiedSF : null;

  const profiles = deal.marketAssumptions?.marketLeasing ?? {};
  const pk = Object.keys(profiles)[0];
  const waMarket = pk ? monthlyTotal(profiles[pk]!.marketRent.amount, profiles[pk]!.marketRent.unit, 1) : null;
  const gapPct = waInPlace != null && waMarket ? round2(((waInPlace - waMarket) / waMarket) * 100) : null;

  const e0 = expensesAt({ ...ctx0, horizon: 1 }, 0);
  const directCap = computeDirectCap(deal, model, warnings);
  const dcf = computeDCF(deal, model, warnings);
  const debt = buildDebt(deal, model, H, warnings);
  const returns = computeReturns(deal, model, dcf, debt);
  const sensitivity = computeSensitivity(deal, model, warnings);

  let concludedValue: number | null = deal.valuation?.reconciliation?.concludedValue ?? null;
  let concludedSource: string | null = concludedValue != null ? "reconciliation (producer-stated)" : null;
  if (concludedValue == null) {
    const pm = deal.valuation?.reconciliation?.primaryMethod;
    const pick = pm === "direct_cap" ? directCap : pm === "dcf" ? dcf : (dcf ?? directCap);
    if (pick) {
      concludedValue = pick.indicatedValue;
      concludedSource = `computed (${pick === dcf ? "dcf" : "direct_cap"}, engine)`;
    }
  }

  const stabNOI = stabilizedAnnualNOI(deal, 0, warnings);

  return {
    engineVersion: ENGINE_VERSION,
    property: {
      name: deal.property.name,
      cityState: `${deal.property.address.city}, ${deal.property.address.state}`,
      market: deal.property.location?.market ?? null,
      submarket: deal.property.location?.submarket ?? null,
      buildingSF: sf,
      yearBuilt: deal.property.physical.yearBuilt ?? null,
      clearHeightFt: (deal.property.physical.clearHeightFt as number | undefined) ?? null,
    },
    occupancy: {
      buildingSF: sf, occupiedSF, vacantSF,
      occupancyPercent: round2((occupiedSF / sf) * 100),
    },
    rent: {
      inPlaceAnnualBaseRent: round0(inPlaceMonthly * 12),
      inPlaceWARentPerSFPerMonth: waInPlace != null ? round2(waInPlace) : null,
      marketRentPerSFPerMonth: waMarket != null ? round2(waMarket) : null,
      inPlaceVsMarketPercent: gapPct,
    },
    expenses: {
      aboveLineAnnualExclMgmt: round0(e0.aboveFixed * 12),
      belowTheLineAnnual: round0(e0.belowLine * 12),
      managementFeePercentOfEGR: e0.mgmtPct > 0 ? round2(e0.mgmtPct * 100) : null,
    },
    noi: {
      year1NOI: round0(sum(model.noi, 0, 12)),
      stabilizedAtMarketNOI: stabNOI != null ? round0(stabNOI) : null,
    },
    noiBridgeYear1: annualTable(model, 12)[0]!,
    cashFlows: { annual: annualTable(model, H) },
    directCap, dcf, debt: debt ? {
      loanAmount: debt.loanAmount, netProceeds: debt.netProceeds,
      year1DebtService: debt.year1DebtService, dscrYear1: debt.dscrYear1,
    } : null,
    returns, sensitivity,
    concluded: { value: concludedValue != null ? round0(concludedValue) : null, source: concludedSource },
    warnings: warnings.list,
  };
}

export type EngineOutput = ReturnType<typeof computeAll>;

// ------------------------------------------------------------------ lint

export function lint(deal: unknown): Warning[] {
  const problems: Warning[] = [];
  const d = deal as OreFile;
  if (typeof deal !== "object" || deal == null) return [{ code: "not_object", message: "File is not a JSON object." }];
  if (!d.formatVersion) problems.push({ code: "missing", message: "formatVersion is required." });
  else if (!/^0\.1\.\d+$/.test(d.formatVersion)) problems.push({ code: "version", message: `formatVersion ${d.formatVersion} is not 0.1.x.` });
  if (!d.property) problems.push({ code: "missing", message: "property module is required." });
  else if (!d.property.physical?.buildingSF) problems.push({ code: "missing", message: "property.physical.buildingSF is required." });
  if (!d.rentRoll) problems.push({ code: "missing", message: "rentRoll module is required." });
  else {
    if (!d.rentRoll.asOfDate) problems.push({ code: "missing", message: "rentRoll.asOfDate is required." });
    (d.rentRoll.leases ?? []).forEach((l, i) => {
      for (const f of ["leaseId", "tenant", "leasedSF", "commencementDate", "expirationDate", "baseRent", "reimbursement"] as const) {
        if (l[f] == null) problems.push({ code: "missing", message: `leases[${i}] missing ${f}.` });
      }
    });
  }
  if (!d.marketAssumptions) problems.push({ code: "advice", message: "No marketAssumptions: rollover, lease-up, and stabilized values cannot be modeled." });
  if (!d.valuation) problems.push({ code: "advice", message: "No valuation module: engine reports operating metrics only." });
  return problems;
}
