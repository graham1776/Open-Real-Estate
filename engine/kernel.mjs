// ORE thin calculation kernel — the seed of the reference engine.
//
// Deliberately simplified: monthly cash grid, expected-value rollover blending,
// narrow outputs, and a first-class `warnings` array that names every
// simplification applied to the file at hand. Golden files lock this kernel's
// behavior; the hardened TypeScript engine replaces it function-by-function
// and must either reproduce or consciously revise each golden.
//
// Pure ES module, zero dependencies, no build step — importable by the browser
// demo and Node alike.

// ---------- date / month helpers ----------

function monthIndex(dateStr, startStr) {
  const [y, m] = dateStr.split("-").map(Number);
  const [sy, sm] = startStr.split("-").map(Number);
  return (y - sy) * 12 + (m - sm);
}

// ---------- unit normalization ----------

function monthlyTotal(amount, unit, sf) {
  switch (unit) {
    case "perSFPerMonth": return amount * sf;
    case "perSFPerYear": return (amount * sf) / 12;
    case "totalPerMonth": return amount;
    case "totalPerYear": return amount / 12;
    default: throw new Error(`unknown rent unit ${unit}`);
  }
}

// ---------- growth curves ----------

function rateForYear(curve, year1based) {
  if (typeof curve === "number") return curve;
  let rate = curve[0].annualPercent;
  for (const step of curve) if (step.fromYear <= year1based) rate = step.annualPercent;
  return rate;
}

// Compound factor from analysis start to month m (annual compounding on anniversaries).
function growthFactor(curve, m) {
  if (curve == null) return 1;
  let f = 1;
  for (let y = 1; y <= Math.floor(m / 12); y++) f *= 1 + rateForYear(curve, y) / 100;
  return f;
}

// ---------- per-lease contract rent ----------

function contractMonthlyRate(lease, m, start, warnings, warned) {
  const sched = lease.baseRent.schedule;
  const sf = lease.leasedSF;
  let step = null;
  for (const s of sched) if (monthIndex(s.startDate, start) <= m) step = s;
  if (!step) {
    step = sched[0];
    if (!warned.has(lease.leaseId + ":early")) {
      warned.add(lease.leaseId + ":early");
      warnings.push({ code: "schedule_starts_late", message: `Lease ${lease.leaseId}: rent schedule starts after an analysis month; earliest step used.` });
    }
  }
  let rate = monthlyTotal(step.amount, lease.baseRent.unit, sf);
  const esc = lease.escalation;
  const lastStep = sched[sched.length - 1];
  if (esc && esc.type !== "none" && monthIndex(lastStep.startDate, start) <= m) {
    const freq = esc.frequencyMonths ?? 12;
    const k = Math.floor((m - monthIndex(lastStep.startDate, start)) / freq);
    if (k > 0) {
      const base = monthlyTotal(lastStep.amount, lease.baseRent.unit, sf);
      if (esc.type === "fixed_percent") rate = base * Math.pow(1 + esc.rate / 100, k);
      else if (esc.type === "fixed_amount") rate = base + monthlyTotal(esc.amount, lease.baseRent.unit, sf) * k;
      else if (esc.type === "cpi") {
        rate = base * Math.pow(1 + cpiRate(esc, k) / 100, k);
      }
    }
  }
  return rate;

  function cpiRate(e, _k) {
    let r = typeof kernelCpi === "number" ? kernelCpi : 2.5;
    if (e.cpiFloorPercent != null) r = Math.max(r, e.cpiFloorPercent);
    if (e.cpiCapPercent != null) r = Math.min(r, e.cpiCapPercent);
    return r;
  }
}

let kernelCpi = null; // set per-run from marketAssumptions.growth.cpi

function freeRentFactor(lease, m, start) {
  let f = 1;
  for (const fr of lease.freeRent ?? []) {
    if (monthIndex(fr.startDate, start) <= m && m <= monthIndex(fr.endDate, start)) {
      f *= 1 - (fr.percentAbated ?? 100) / 100;
    }
  }
  return f;
}

// ---------- per-space streams ----------
//
// A "space" is a lease's premises or a vacant suite. Each space produces, per
// month: expected base rent, expected occupancy (0..1), NNN/NN recovery share,
// abated rent, and rollover costs (TI + LC, expected-value blended).

function profileFor(deal, spaceType, warnings, warned) {
  const profiles = deal.marketAssumptions?.marketLeasing ?? {};
  const keys = Object.keys(profiles);
  if (keys.length === 0) return null;
  if (spaceType && profiles[spaceType]) return profiles[spaceType];
  if (keys.length > 1 && !warned.has("profile")) {
    warned.add("profile");
    warnings.push({ code: "profile_fallback", message: `Multiple market leasing profiles and no space-type mapping; first profile ("${keys[0]}") applied.` });
  }
  return profiles[keys[0]];
}

function marketMonthlyRate(profile, sf, m, growth) {
  const base = monthlyTotal(profile.marketRent.amount, profile.marketRent.unit, sf);
  return base * growthFactor(growth, m);
}

// Market-lease phase from `from` (lease start or rollover point) to horizon.
// First cycle may blend renewal/new outcomes; vacant lease-up is new-tenant only.
function marketPhase(arr, from, sf, profile, growth, horizon, firstIsRollover) {
  const T = profile.termMonths;
  const D = profile.downtimeMonths ?? 0;
  const p = firstIsRollover ? (profile.renewalProbabilityPercent ?? 0) / 100 : 0;
  const Fn = profile.newTenant?.freeRentMonths ?? 0;
  const Fr = profile.renewal?.freeRentMonths ?? 0;
  const renewPct = (profile.renewalRentPercentOfMarket ?? 100) / 100;
  const esc = profile.escalation;

  let cursor = from;
  let first = firstIsRollover;
  while (cursor < horizon) {
    const pr = first ? p : (profile.renewalProbabilityPercent ?? 0) / 100;
    const startRate = marketMonthlyRate(profile, sf, cursor, growth);
    const end = Math.min(cursor + T, horizon);
    for (let m = cursor; m < end; m++) {
      const t = m - cursor;
      const escFactor = escGrowth(esc, t);
      const renewRent = t < Fr ? 0 : renewPct * startRate * escFactor;
      const newRent = t < D || t < D + Fn ? 0 : startRate * escFactor;
      arr.rent[m] += pr * renewRent + (1 - pr) * newRent;
      arr.occ[m] += pr + (1 - pr) * (t >= D ? 1 : 0);
      arr.recovShare[m] += isNNNish(profile.reimbursementStructure ?? "NNN") ? (pr + (1 - pr) * (t >= D ? 1 : 0)) * (sf / arr.buildingSF) : 0;
      // abated rent (free rent value) for near-term deduction reporting
      const renewAbate = t < Fr ? renewPct * startRate * escFactor : 0;
      const newAbate = t >= D && t < D + Fn ? startRate * escFactor : 0;
      arr.abated[m] += pr * renewAbate + (1 - pr) * newAbate;
    }
    // blended leasing costs at cycle start
    const termRent = startRate * T; // un-escalated approximation
    const costNew = (profile.newTenant?.tiPerSF ?? 0) * sf + ((profile.newTenant?.lcPercentOfRent ?? 0) / 100) * termRent;
    const costRen = (profile.renewal?.tiPerSF ?? 0) * sf + ((profile.renewal?.lcPercentOfRent ?? 0) / 100) * termRent;
    if (cursor < horizon) arr.costs[cursor] += pr * costRen + (1 - pr) * costNew;
    cursor += T;
    first = false;
  }

  function escGrowth(e, t) {
    if (!e || e.type === "none") return 1;
    const freq = e.frequencyMonths ?? 12;
    const k = Math.floor(t / freq);
    if (e.type === "fixed_percent") return Math.pow(1 + e.rate / 100, k);
    if (e.type === "fixed_amount") return 1; // amount-based steps not modeled in kernel
    if (e.type === "cpi") return Math.pow(1 + (typeof kernelCpi === "number" ? kernelCpi : 2.5) / 100, k);
    return 1;
  }
}

function isNNNish(structure) {
  return structure === "NNN" || structure === "NN";
}

// ---------- expense schedule ----------

function expenseTotals(deal, m, expGrowth) {
  let aboveFixed = 0, belowLine = 0, recoverableFixed = 0;
  let mgmtPct = 0, mgmtRecoverable = false;
  for (const item of deal.expenses?.items ?? []) {
    if (item.amountUnit === "percentOfEGR") {
      mgmtPct += item.amount / 100;
      if (item.recoverable) mgmtRecoverable = true;
      continue;
    }
    const annual = item.amountUnit === "perSFPerYear" ? item.amount * deal.property.physical.buildingSF : item.amount;
    const curve = item.growthOverridePercent != null ? item.growthOverridePercent : expGrowth;
    const grown = (annual / 12) * growthFactor(curve, m);
    if (item.belowTheLine) belowLine += grown;
    else {
      aboveFixed += grown;
      if (item.recoverable) recoverableFixed += grown;
    }
  }
  return { aboveFixed, belowLine, recoverableFixed, mgmtPct, mgmtRecoverable };
}

// ---------- the monthly grid ----------

export function buildGrid(deal, horizon, warnings) {
  const start = deal.valuation?.analysisStartDate ?? deal.rentRoll.asOfDate;
  const buildingSF = deal.property.physical.buildingSF;
  const growth = deal.marketAssumptions?.growth ?? {};
  kernelCpi = typeof growth.cpi === "number" ? growth.cpi : growth.cpi ? rateForYear(growth.cpi, 1) : null;
  const warned = new Set();

  const arr = {
    buildingSF,
    rent: new Array(horizon).fill(0),
    abated: new Array(horizon).fill(0),
    occ: new Array(horizon).fill(0),
    recovShare: new Array(horizon).fill(0),
    costs: new Array(horizon).fill(0),
    contractVsMarket: new Array(horizon).fill(0),
  };

  for (const lease of deal.rentRoll.leases) {
    const expiry = monthIndex(lease.expirationDate, start) + 1; // active through expiration month
    const profile = profileFor(deal, null, warnings, warned);
    if (lease.reimbursement.structure === "MG" || lease.reimbursement.structure === "Gross") {
      if (!warned.has(lease.leaseId + ":mg")) {
        warned.add(lease.leaseId + ":mg");
        warnings.push({ code: "mg_recovery_zero", message: `Lease ${lease.leaseId} (${lease.reimbursement.structure}): kernel models zero recoveries (base-year delta not computed); full engine will compute base-year/stop recoveries.` });
      }
    }
    const share = (lease.reimbursement.proRataSharePercent ?? (lease.leasedSF / buildingSF) * 100) / 100;
    for (let m = 0; m < Math.min(expiry, horizon); m++) {
      const rate = contractMonthlyRate(lease, m, start, warnings, warned);
      const ff = freeRentFactor(lease, m, start);
      arr.rent[m] += rate * ff;
      arr.abated[m] += rate * (1 - ff);
      arr.occ[m] += 1;
      if (isNNNish(lease.reimbursement.structure)) arr.recovShare[m] += share;
      if (profile) arr.contractVsMarket[m] += rate - marketMonthlyRate(profile, lease.leasedSF, m, growth.marketRent);
    }
    if (expiry < horizon) {
      if (profile) marketPhase(arr, expiry, lease.leasedSF, profile, growth.marketRent, horizon, true);
      else if (!warned.has("noprofile")) {
        warned.add("noprofile");
        warnings.push({ code: "no_market_profile", message: "No marketAssumptions.marketLeasing profile: expired space produces no rent after expiry." });
      }
    }
  }

  for (const suite of deal.rentRoll.vacantSuites ?? []) {
    const profile = profileFor(deal, suite.spaceType, warnings, warned);
    if (!profile) {
      warnings.push({ code: "vacant_no_profile", message: `Vacant suite ${suite.suite ?? "?"} has no matching market leasing profile; modeled as permanently vacant.` });
      continue;
    }
    marketPhase(arr, 0, suite.sf, profile, growth.marketRent, horizon, false);
  }

  // monthly economics
  const genVac = ((deal.marketAssumptions?.generalVacancyPercent ?? 0) + (deal.marketAssumptions?.creditLossPercent ?? 0)) / 100;
  if (genVac > 0 && !warned.has("genvac")) {
    warned.add("genvac");
    warnings.push({ code: "general_vacancy_simplified", message: "General vacancy + credit loss applied to all revenue including months already in modeled downtime (kernel does not de-duplicate); full engine will exclude explicit downtime from the base." });
  }

  arr.noi = new Array(horizon).fill(0);
  arr.cashFlow = new Array(horizon).fill(0);
  arr.egr = new Array(horizon).fill(0);
  for (let m = 0; m < horizon; m++) {
    const e = expenseTotals(deal, m, growth.expenses);
    const recovFrac = Math.min(arr.recovShare[m], 1);
    // EGR = rent + recoveries; mgmt fee % of EGR may itself be recoverable
    const denom = 1 - (e.mgmtRecoverable ? recovFrac * e.mgmtPct : 0);
    const egr = (arr.rent[m] + recovFrac * e.recoverableFixed) / (denom === 0 ? 1 : denom);
    const mgmt = e.mgmtPct * egr;
    const egrNet = egr * (1 - genVac);
    const noi = egrNet - e.aboveFixed - mgmt;
    arr.egr[m] = egr;
    arr.noi[m] = noi;
    arr.cashFlow[m] = noi - e.belowLine - arr.costs[m];
  }
  return arr;
}

// ---------- valuation ----------

function sum(a, from, to) {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i] ?? 0;
  return s;
}

function stabilizedAnnualNOI(deal, atMonth, warnings) {
  const growth = deal.marketAssumptions?.growth ?? {};
  const warned = new Set();
  const profiles = deal.marketAssumptions?.marketLeasing ?? {};
  const keys = Object.keys(profiles);
  if (keys.length === 0) return null;
  const buildingSF = deal.property.physical.buildingSF;
  // all space at the (single fallback) profile's market rent, grown
  const profile = profiles[keys[0]];
  const rentM = marketMonthlyRate(profile, buildingSF, atMonth, growth.marketRent);
  const e = expenseTotals(deal, atMonth, growth.expenses);
  const recovFrac = isNNNish(profile.reimbursementStructure ?? "NNN") ? 1 : 0;
  const denom = 1 - (e.mgmtRecoverable ? recovFrac * e.mgmtPct : 0);
  const egr = (rentM + recovFrac * e.recoverableFixed) / (denom === 0 ? 1 : denom);
  const genVac = ((deal.marketAssumptions?.generalVacancyPercent ?? 0) + (deal.marketAssumptions?.creditLossPercent ?? 0)) / 100;
  const noiM = egr * (1 - genVac) - e.aboveFixed - e.mgmtPct * egr;
  return noiM * 12;
}

function pvMonthly(cf, ratePct, horizon) {
  const r = ratePct / 100;
  let pv = 0;
  for (let m = 0; m < horizon; m++) pv += cf[m] / Math.pow(1 + r, (m + 1) / 12);
  return pv;
}

export function computeDirectCap(deal, grid, warnings) {
  const dc = deal.valuation?.directCap;
  if (!dc) return null;
  let basisNOI = null;
  const basis = dc.noiBasis;
  if (basis === "year1") basisNOI = sum(grid.noi, 0, 12);
  else if (basis === "inPlace") basisNOI = grid.noi[0] * 12;
  else if (basis === "stabilizedAtMarket") basisNOI = stabilizedAnnualNOI(deal, 0, warnings);
  else if (basis === "custom" || basis === "trailing12") basisNOI = dc.customNOI ?? null;
  if (basisNOI == null) {
    warnings.push({ code: "direct_cap_incomputable", message: `Direct cap NOI basis "${basis}" could not be computed from this file.` });
    return null;
  }
  if (dc.deductBelowTheLineItems) {
    const e = expenseTotals(deal, 0, deal.marketAssumptions?.growth?.expenses);
    basisNOI -= e.belowLine * 12;
  }
  if (dc.excludeExpenseIds?.length) {
    warnings.push({ code: "exclusions_not_applied", message: "directCap.excludeExpenseIds present; kernel does not re-compute NOI with exclusions (full engine will)." });
  }
  let value = basisNOI / (dc.capRatePercent / 100);
  const applied = [];

  if (dc.markToMarket) {
    const horizon = grid.contractVsMarket.length;
    const r = dc.markToMarket.discountRatePercent / 100;
    let mtm = 0;
    for (let m = 0; m < horizon; m++) mtm += grid.contractVsMarket[m] / Math.pow(1 + r, (m + 1) / 12);
    value += mtm;
    applied.push({ name: "Mark-to-market (PV of contract vs market)", amount: Math.round(mtm) });
  }
  if (dc.nearTermAdjustments) {
    const n = dc.nearTermAdjustments;
    const P = Math.min(n.periodMonths, grid.rent.length);
    const r = n.discountRatePercent != null ? n.discountRatePercent / 100 : null;
    const df = (m) => (r == null ? 1 : 1 / Math.pow(1 + r, (m + 1) / 12));
    let ded = 0;
    for (let m = 0; m < P; m++) {
      if (n.includeDowntimeLostRent !== false) {
        // lost gross rent: market rate on the expected-vacant fraction of the building
        const vacFrac = Math.max(0, 1 - (grid.occSF ? grid.occSF[m] / grid.buildingSF : 1));
        ded += vacFrac * marketRateWholeBuilding(deal, m) * df(m);
      }
      if (n.includeFreeRent !== false) ded += grid.abated[m] * df(m);
      if (n.includeTI !== false || n.includeLC !== false) ded += grid.costs[m] * df(m); // kernel does not split TI from LC
    }
    value -= ded;
    applied.push({ name: `Near-term costs (${n.periodMonths} mo${r != null ? ", PV" : ", face"})`, amount: -Math.round(ded) });
    if (n.includeTI === false || n.includeLC === false) {
      warnings.push({ code: "ti_lc_not_split", message: "Kernel deducts TI+LC together; per-component toggles honored only jointly (full engine will split)." });
    }
  }
  for (const adj of dc.adjustments ?? []) {
    const signed = adj.type === "deduction" ? -adj.amount : adj.amount;
    value += signed;
    applied.push({ name: adj.name, amount: Math.round(signed) });
  }
  return {
    basis,
    basisNOI: Math.round(basisNOI),
    capRatePercent: dc.capRatePercent,
    grossValue: Math.round(basisNOI / (dc.capRatePercent / 100)),
    adjustmentsApplied: applied,
    indicatedValue: Math.round(value),
    perSF: round2(value / deal.property.physical.buildingSF),
  };

  function marketRateWholeBuilding(d, m) {
    const profiles = d.marketAssumptions?.marketLeasing ?? {};
    const k = Object.keys(profiles)[0];
    if (!k) return 0;
    return marketMonthlyRate(profiles[k], d.property.physical.buildingSF, m, d.marketAssumptions?.growth?.marketRent);
  }
}

export function computeDCF(deal, grid, warnings) {
  const dcf = deal.valuation?.dcf;
  if (!dcf) return null;
  const H = dcf.holdPeriodMonths ?? dcf.holdPeriodYears * 12;
  if (dcf.periodConvention === "mid") {
    warnings.push({ code: "mid_period_unsupported", message: "periodConvention \"mid\" not supported by kernel; end-of-period used (full engine will support mid-period)." });
  }
  if (dcf.discountTiming === "annual") {
    warnings.push({ code: "annual_timing_approximated", message: "discountTiming \"annual\" approximated with monthly-equivalent discounting in kernel." });
  }
  const tv = dcf.terminalValue;
  let terminalGross = null;
  if (tv.method === "direct_cap") {
    let tNOI = null;
    if ((tv.noiBasis ?? "forwardYear") === "forwardYear") tNOI = sum(grid.noi, H, H + 12);
    else if (tv.noiBasis === "trailingYear") tNOI = sum(grid.noi, H - 12, H);
    else if (tv.noiBasis === "stabilizedAtMarket") tNOI = stabilizedAnnualNOI(deal, H, warnings);
    if (tNOI == null) {
      warnings.push({ code: "terminal_incomputable", message: "Terminal NOI basis could not be computed; DCF skipped." });
      return null;
    }
    if (tv.deductBelowTheLineItems) {
      const e = expenseTotals(deal, H, deal.marketAssumptions?.growth?.expenses);
      tNOI -= e.belowLine * 12;
    }
    terminalGross = tNOI / (tv.capRatePercent / 100);
  } else if (tv.method === "exit_price_psf") terminalGross = tv.exitPricePerSF * deal.property.physical.buildingSF;
  else if (tv.method === "fixed_value") terminalGross = tv.fixedValue;
  else if (tv.method === "grown_purchase_price") {
    if (deal.valuation.purchasePrice == null) {
      warnings.push({ code: "terminal_incomputable", message: "grown_purchase_price terminal requires purchasePrice." });
      return null;
    }
    terminalGross = deal.valuation.purchasePrice * Math.pow(1 + tv.annualAppreciationPercent / 100, H / 12);
  }
  if (tv.deductUnfundedObligations) {
    warnings.push({ code: "unfunded_obligations_not_deducted", message: "terminalValue.deductUnfundedObligations not computed by kernel (full engine will deduct TI/LC/free rent on leases extending past sale)." });
  }
  const terminalNet = terminalGross * (1 - (tv.sellingCostsPercent ?? 0) / 100);
  const pvOperating = pvMonthly(grid.cashFlow, dcf.discountRatePercent, H);
  const rRev = dcf.reversionDiscountRatePercent ?? dcf.discountRatePercent;
  const pvTerminal = terminalNet / Math.pow(1 + rRev / 100, H / 12);
  const value = pvOperating + pvTerminal;
  return {
    holdMonths: H,
    discountRatePercent: dcf.discountRatePercent,
    reversionDiscountRatePercent: rRev,
    pvOperating: Math.round(pvOperating),
    terminalGross: Math.round(terminalGross),
    terminalNet: Math.round(terminalNet),
    pvTerminal: Math.round(pvTerminal),
    indicatedValue: Math.round(value),
    perSF: round2(value / deal.property.physical.buildingSF),
  };
}

// ---------- top-level summary metrics ----------

function round2(x) {
  return Math.round(x * 100) / 100;
}

export function computeAll(deal) {
  const warnings = [];
  const start = deal.valuation?.analysisStartDate ?? deal.rentRoll.asOfDate;
  const buildingSF = deal.property.physical.buildingSF;

  const dcf = deal.valuation?.dcf;
  const holdM = dcf ? (dcf.holdPeriodMonths ?? dcf.holdPeriodYears * 12) : 0;
  const horizon = Math.max(holdM + 12, 24);
  const grid = buildGrid(deal, horizon, warnings);

  // SF-weighted occupancy at asOf
  let occupiedSF = 0;
  for (const l of deal.rentRoll.leases) occupiedSF += l.leasedSF;
  let vacantSF = 0;
  for (const v of deal.rentRoll.vacantSuites ?? []) vacantSF += v.sf;
  if (Math.abs(occupiedSF + vacantSF - buildingSF) > buildingSF * 0.005) {
    warnings.push({ code: "sf_mismatch", message: `Leased SF (${occupiedSF}) + vacant SF (${vacantSF}) != building SF (${buildingSF}).` });
  }
  // expected occupied SF per month (SF-weighted), for near-term lost-rent math
  grid.occSF = new Array(horizon).fill(0);
  {
    const warned = new Set();
    const growth = deal.marketAssumptions?.growth ?? {};
    for (const lease of deal.rentRoll.leases) {
      const expiry = monthIndex(lease.expirationDate, start) + 1;
      const profile = profileFor(deal, null, [], warned);
      const p = profile ? (profile.renewalProbabilityPercent ?? 0) / 100 : 0;
      const D = profile?.downtimeMonths ?? 0;
      for (let m = 0; m < horizon; m++) {
        if (m < expiry) grid.occSF[m] += lease.leasedSF;
        else if (profile) {
          const t = (m - expiry) % profile.termMonths;
          const cyc = Math.floor((m - expiry) / profile.termMonths);
          const pr = cyc === 0 ? p : (profile.renewalProbabilityPercent ?? 0) / 100;
          grid.occSF[m] += lease.leasedSF * (pr + (1 - pr) * (t >= D ? 1 : 0));
        }
      }
    }
    for (const suite of deal.rentRoll.vacantSuites ?? []) {
      const profile = profileFor(deal, suite.spaceType, [], warned);
      if (!profile) continue;
      const D = profile.downtimeMonths ?? 0;
      const p = (profile.renewalProbabilityPercent ?? 0) / 100;
      for (let m = 0; m < horizon; m++) {
        if (m < D) continue;
        const t = (m - D) % profile.termMonths;
        const cyc = Math.floor((m - D) / profile.termMonths);
        grid.occSF[m] += suite.sf * (cyc === 0 ? 1 : p + (1 - p) * (t >= D ? 1 : 0));
      }
    }
  }

  // in-place rent at month 0
  const warned = new Set();
  let inPlaceMonthly = 0;
  for (const lease of deal.rentRoll.leases) {
    inPlaceMonthly += contractMonthlyRate(lease, 0, start, warnings, warned);
  }
  const waInPlace = occupiedSF > 0 ? inPlaceMonthly / occupiedSF : null;

  // market comparison
  const profiles = deal.marketAssumptions?.marketLeasing ?? {};
  const pk = Object.keys(profiles)[0];
  let waMarket = null, gapPct = null;
  if (pk) {
    const prof = profiles[pk];
    waMarket = monthlyTotal(prof.marketRent.amount, prof.marketRent.unit, 1);
    if (waInPlace != null && waMarket > 0) gapPct = round2(((waInPlace - waMarket) / waMarket) * 100);
  }

  const e0 = expenseTotals(deal, 0, deal.marketAssumptions?.growth?.expenses);
  const directCap = computeDirectCap(deal, grid, warnings);
  const dcfOut = computeDCF(deal, grid, warnings);

  const year1NOI = Math.round(sum(grid.noi, 0, 12));
  const stabNOI = stabilizedAnnualNOI(deal, 0, warnings);

  let concludedValue = deal.valuation?.reconciliation?.concludedValue ?? null;
  let concludedSource = concludedValue != null ? "reconciliation (producer-stated)" : null;
  if (concludedValue == null) {
    const pm = deal.valuation?.reconciliation?.primaryMethod;
    const pick = pm === "direct_cap" ? directCap : pm === "dcf" ? dcfOut : (dcfOut ?? directCap);
    if (pick) {
      concludedValue = pick.indicatedValue;
      concludedSource = `computed (${pick === dcfOut ? "dcf" : "direct_cap"}, kernel)`;
    }
  }

  return {
    kernelVersion: "0.1.0-kernel",
    property: {
      name: deal.property.name,
      cityState: `${deal.property.address.city}, ${deal.property.address.state}`,
      market: deal.property.location?.market ?? null,
      submarket: deal.property.location?.submarket ?? null,
      buildingSF,
      yearBuilt: deal.property.physical.yearBuilt ?? null,
      clearHeightFt: deal.property.physical.clearHeightFt ?? null,
    },
    occupancy: {
      buildingSF,
      occupiedSF,
      vacantSF,
      occupancyPercent: round2((occupiedSF / buildingSF) * 100),
    },
    rent: {
      inPlaceAnnualBaseRent: Math.round(inPlaceMonthly * 12),
      inPlaceWARentPerSFPerMonth: waInPlace != null ? round2(waInPlace) : null,
      marketRentPerSFPerMonth: waMarket != null ? round2(waMarket) : null,
      inPlaceVsMarketPercent: gapPct,
    },
    expenses: {
      aboveLineAnnualExclMgmt: Math.round(e0.aboveFixed * 12),
      belowTheLineAnnual: Math.round(e0.belowLine * 12),
      managementFeePercentOfEGR: e0.mgmtPct > 0 ? round2(e0.mgmtPct * 100) : null,
    },
    noi: {
      year1NOI,
      stabilizedAtMarketNOI: stabNOI != null ? Math.round(stabNOI) : null,
    },
    directCap,
    dcf: dcfOut,
    concluded: { value: concludedValue != null ? Math.round(concludedValue) : null, source: concludedSource },
    warnings,
  };
}

// ---------- structural lint (pre-schema sanity for the demo) ----------

export function lint(deal) {
  const problems = [];
  if (typeof deal !== "object" || deal == null) return [{ code: "not_object", message: "File is not a JSON object." }];
  if (!deal.formatVersion) problems.push({ code: "missing", message: "formatVersion is required." });
  else if (!/^0\.1\.\d+$/.test(deal.formatVersion)) problems.push({ code: "version", message: `formatVersion ${deal.formatVersion} is not 0.1.x.` });
  if (!deal.property) problems.push({ code: "missing", message: "property module is required." });
  else if (!deal.property.physical?.buildingSF) problems.push({ code: "missing", message: "property.physical.buildingSF is required." });
  if (!deal.rentRoll) problems.push({ code: "missing", message: "rentRoll module is required." });
  else {
    if (!deal.rentRoll.asOfDate) problems.push({ code: "missing", message: "rentRoll.asOfDate is required." });
    for (const [i, l] of (deal.rentRoll.leases ?? []).entries()) {
      for (const f of ["leaseId", "tenant", "leasedSF", "commencementDate", "expirationDate", "baseRent", "reimbursement"]) {
        if (l[f] == null) problems.push({ code: "missing", message: `leases[${i}] missing ${f}.` });
      }
    }
  }
  if (!deal.marketAssumptions) problems.push({ code: "advice", message: "No marketAssumptions: rollover, lease-up, and stabilized values cannot be modeled." });
  if (!deal.valuation) problems.push({ code: "advice", message: "No valuation module: kernel reports operating metrics only." });
  return problems;
}
