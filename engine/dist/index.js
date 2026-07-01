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
export const ENGINE_VERSION = "0.1.0";
// ---------------------------------------------------------------- utilities
function monthIndex(dateStr, startStr) {
    const [y, m] = dateStr.split("-").map(Number);
    const [sy, sm] = startStr.split("-").map(Number);
    return (y - sy) * 12 + (m - sm);
}
function yearOf(dateStr) {
    return Number(dateStr.split("-")[0]);
}
function monthlyTotal(amount, unit, sf) {
    switch (unit) {
        case "perSFPerMonth": return amount * sf;
        case "perSFPerYear": return (amount * sf) / 12;
        case "totalPerMonth": return amount;
        case "totalPerYear": return amount / 12;
    }
}
function rateForYear(curve, year1based) {
    if (typeof curve === "number")
        return curve;
    let rate = curve[0].annualPercent;
    for (const step of curve)
        if (step.fromYear <= year1based)
            rate = step.annualPercent;
    return rate;
}
/** Compound growth factor from analysis start to month m (annual compounding on anniversaries). */
function growthFactor(curve, m) {
    if (curve == null)
        return 1;
    let f = 1;
    for (let y = 1; y <= Math.floor(m / 12); y++)
        f *= 1 + rateForYear(curve, y) / 100;
    return f;
}
const round0 = (x) => Math.round(x);
const round2 = (x) => Math.round(x * 100) / 100;
function sum(a, from, to) {
    let s = 0;
    for (let i = Math.max(0, from); i < Math.min(a.length, to); i++)
        s += a[i];
    return s;
}
class Warnings {
    list = [];
    seen = new Set();
    add(code, message, dedupeKey) {
        const key = dedupeKey ?? code + message;
        if (this.seen.has(key))
            return;
        this.seen.add(key);
        this.list.push({ code, message });
    }
}
function emptyStreams(h) {
    const z = () => new Array(h).fill(0);
    return { sched: z(), free: z(), pot: z(), occSF: z(), recovNNN: z(), recovMG: z(), ti: z(), lc: z() };
}
function addInto(dst, src, weight, h) {
    for (const k of Object.keys(dst)) {
        for (let m = 0; m < h; m++)
            dst[k][m] += weight * src[k][m];
    }
}
/** Resolve property-tax reassessment config, or null if disabled/inapplicable. */
function resolveTaxReassessment(deal) {
    const tr = deal.valuation?.taxReassessment;
    if (!tr)
        return null;
    const price = deal.valuation?.purchasePrice;
    const items = deal.expenses?.items ?? [];
    const taxItem = tr.expenseId
        ? items.find((i) => i.expenseId === tr.expenseId)
        : items.find((i) => i.category === "real_estate_taxes");
    if (!taxItem || price == null)
        return null;
    const sf = deal.property.physical.buildingSF;
    const currentTaxAnnual = taxItem.amountUnit === "perSFPerYear" ? taxItem.amount * sf : taxItem.amount;
    const rateDerived = tr.effectiveTaxRatePercent == null;
    const ratePct = tr.effectiveTaxRatePercent ?? (currentTaxAnnual / price) * 100;
    return {
        expenseId: taxItem.expenseId,
        ratePct,
        baseAnnual: price * (ratePct / 100),
        currentAnnual: currentTaxAnnual,
        reassessAcq: tr.reassessOnAcquisition !== false,
        reassessRev: tr.reassessAtReversion !== false,
        rateDerived,
    };
}
/** Growth curve for a specific expense item (its override, else the global expense curve). */
function itemGrowthCurve(deal, expenseId) {
    const item = (deal.expenses?.items ?? []).find((i) => i.expenseId === expenseId);
    return item?.growthOverridePercent != null ? item.growthOverridePercent : deal.marketAssumptions?.growth.expenses;
}
function escalationFactor(esc, monthsIntoLease, ctx) {
    if (!esc || esc.type === "none")
        return 1;
    const freq = esc.frequencyMonths ?? 12;
    const k = Math.floor(monthsIntoLease / freq);
    if (k <= 0)
        return 1;
    if (esc.type === "fixed_percent")
        return Math.pow(1 + (esc.rate ?? 0) / 100, k);
    if (esc.type === "cpi") {
        let r = ctx.cpiAnnualPercent;
        if (r == null) {
            ctx.warnings.add("cpi_assumption_missing", "A lease escalates on CPI but marketAssumptions.growth.cpi is absent; 0% CPI assumed.");
            r = 0;
        }
        if (esc.cpiFloorPercent != null)
            r = Math.max(r, esc.cpiFloorPercent);
        if (esc.cpiCapPercent != null)
            r = Math.min(r, esc.cpiCapPercent);
        return Math.pow(1 + r / 100, k);
    }
    return 1; // fixed_amount handled by caller (additive)
}
function profileFor(ctx, spaceType) {
    const profiles = ctx.deal.marketAssumptions?.marketLeasing ?? {};
    const keys = Object.keys(profiles);
    if (keys.length === 0)
        return null;
    if (spaceType && profiles[spaceType])
        return profiles[spaceType];
    if (spaceType && !profiles[spaceType]) {
        ctx.warnings.add("space_type_unmapped", `Space type "${spaceType}" has no market leasing profile; first profile ("${keys[0]}") applied.`, "stu:" + spaceType);
    }
    else if (keys.length > 1) {
        ctx.warnings.add("profile_fallback", `Multiple market leasing profiles and no space-type mapping for a lease; first profile ("${keys[0]}") applied.`);
    }
    return profiles[keys[0]];
}
function marketRate(profile, sf, m, ctx) {
    const base = monthlyTotal(profile.marketRent.amount, profile.marketRent.unit, sf);
    return base * growthFactor(ctx.deal.marketAssumptions?.growth.marketRent, m);
}
/**
 * Expected-value stream from a rollover event at month t, memoized.
 * Renewal branch: lease starts at t (no downtime) at renewal % of market.
 * New-tenant branch: downtime, then a market lease with new-tenant costs.
 * Both branches recurse into the next rollover with full two-branch blending.
 */
function rolloverStreams(t, sf, profile, ctx, memo) {
    const cached = memo.get(t);
    if (cached)
        return cached;
    const h = ctx.horizon;
    const out = emptyStreams(h);
    memo.set(t, out); // set before recursing (cycles impossible: t strictly increases)
    if (t >= h)
        return out;
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
        br.ti[t] += (profile.renewal?.tiPerSF ?? 0) * sf;
        br.lc[t] += ((profile.renewal?.lcPercentOfRent ?? 0) / 100) * termRentTotal(rate0, profile.escalation, T, ctx);
        addInto(br, rolloverStreams(t + T, sf, profile, ctx, memo), 1, h);
        addInto(out, br, p, h);
    }
    // new-tenant branch (weight 1-p)
    if (p < 1) {
        const bn = emptyStreams(h);
        for (let m = t; m < Math.min(t + D, h); m++)
            bn.pot[m] += marketRate(profile, sf, m, ctx); // downtime: potential rent, no occupancy
        const s = t + D;
        if (s < h || true) {
            const rate0 = marketRate(profile, sf, Math.min(s, h - 1), ctx);
            const Fn = profile.newTenant?.freeRentMonths ?? 0;
            leaseSegment(bn, s, T, rate0, Fn, nnn, sf, profile.escalation, ctx);
            if (s < h) {
                bn.ti[s] += (profile.newTenant?.tiPerSF ?? 0) * sf;
                bn.lc[s] += ((profile.newTenant?.lcPercentOfRent ?? 0) / 100) * termRentTotal(rate0, profile.escalation, T, ctx);
            }
            addInto(bn, rolloverStreams(s + T, sf, profile, ctx, memo), 1, h);
        }
        addInto(out, bn, 1 - p, h);
    }
    return out;
}
function resolveRenewalOption(lease, profile, expiry, ctx) {
    const opt = (lease.options ?? []).find((o) => o.type === "renewal");
    if (!opt)
        return null;
    const basis = opt.rentBasis ?? "market";
    if (basis === "market")
        return null;
    const market = marketRate(profile, lease.leasedSF, expiry, ctx);
    let optRent;
    if (basis === "fixed") {
        if (opt.fixedRent == null)
            return null;
        optRent = monthlyTotal(opt.fixedRent, lease.baseRent.unit, lease.leasedSF);
    }
    else if (basis === "percent_of_market") {
        if (opt.percentOfMarket == null)
            return null;
        optRent = (opt.percentOfMarket / 100) * market;
    }
    else {
        return null;
    }
    if ((opt.renewalCount ?? 1) > 1) {
        ctx.warnings.add("renewal_option_multiple", `Lease ${lease.leaseId}: renewal option has renewalCount > 1; the engine applies the option terms to the first renewal only, then reverts to market.`, "ropt-mult:" + lease.leaseId);
    }
    return {
        leaseId: lease.leaseId,
        rate0: Math.min(optRent, market),
        termMonths: opt.renewalTermMonths ?? profile.termMonths,
        isFixed: basis === "fixed",
        belowMarket: optRent < market - 1e-6,
    };
}
/**
 * Rollover at a lease's own expiry when it holds a stated-rent renewal option.
 * Same two-branch blend as rolloverStreams, but the renewal branch uses the
 * contractual option rent and term. Not memoized — the option is one-shot at this
 * expiry; subsequent rollovers recurse into the generic (memoized) market path.
 */
function rolloverWithRenewalOption(t, sf, profile, ctx, memo, ov) {
    const h = ctx.horizon;
    const out = emptyStreams(h);
    if (t >= h)
        return out;
    const p = (profile.renewalProbabilityPercent ?? 0) / 100;
    const T = profile.termMonths;
    const D = profile.downtimeMonths ?? 0;
    const nnn = (profile.reimbursementStructure ?? "NNN") === "NNN" || (profile.reimbursementStructure ?? "NNN") === "NN";
    // renewal branch (weight p): tenant exercises the option — its rent and term
    if (p > 0) {
        const br = emptyStreams(h);
        const esc = ov.isFixed ? undefined : profile.escalation; // a fixed option holds flat over its term
        const Fr = profile.renewal?.freeRentMonths ?? 0;
        leaseSegment(br, t, ov.termMonths, ov.rate0, Fr, nnn, sf, esc, ctx);
        br.ti[t] += (profile.renewal?.tiPerSF ?? 0) * sf;
        br.lc[t] += ((profile.renewal?.lcPercentOfRent ?? 0) / 100) * termRentTotal(ov.rate0, esc, ov.termMonths, ctx);
        addInto(br, rolloverStreams(t + ov.termMonths, sf, profile, ctx, memo), 1, h);
        addInto(out, br, p, h);
    }
    // new-tenant branch (weight 1-p): tenant declines — market re-let (unchanged)
    if (p < 1) {
        const bn = emptyStreams(h);
        for (let m = t; m < Math.min(t + D, h); m++)
            bn.pot[m] += marketRate(profile, sf, m, ctx);
        const s = t + D;
        const rate0 = marketRate(profile, sf, Math.min(s, h - 1), ctx);
        const Fn = profile.newTenant?.freeRentMonths ?? 0;
        leaseSegment(bn, s, T, rate0, Fn, nnn, sf, profile.escalation, ctx);
        if (s < h) {
            bn.ti[s] += (profile.newTenant?.tiPerSF ?? 0) * sf;
            bn.lc[s] += ((profile.newTenant?.lcPercentOfRent ?? 0) / 100) * termRentTotal(rate0, profile.escalation, T, ctx);
        }
        addInto(bn, rolloverStreams(s + T, sf, profile, ctx, memo), 1, h);
        addInto(out, bn, 1 - p, h);
    }
    if (ov.belowMarket && p < 1) {
        ctx.warnings.add("renewal_option_below_market", `Lease ${ov.leaseId}: renewal option is below projected market at expiry; the renewal branch is modeled at the option rent, but renewal probability is the market profile's ${Math.round(p * 100)}% — a rational tenant is likelier to exercise an in-the-money option, so raise renewalProbabilityPercent to reflect it.`, "ropt-bm:" + ov.leaseId);
    }
    return out;
}
/** One occupied lease segment: rent with escalations, free rent at start, occupancy, NNN recovery share. */
function leaseSegment(dst, start, term, rate0, freeMonths, nnn, sf, esc, ctx) {
    for (let m = Math.max(0, start); m < Math.min(start + term, ctx.horizon); m++) {
        const t = m - start;
        let rate = rate0 * escalationFactor(esc, t, ctx);
        if (esc?.type === "fixed_amount")
            rate = rate0; // per-SF fixed-amount steps for market leases not modeled; warn once
        dst.pot[m] += rate;
        dst.occSF[m] += sf;
        if (nnn)
            dst.recovNNN[m] += sf;
        if (t < freeMonths)
            dst.free[m] += rate;
        else
            dst.sched[m] += rate;
    }
    if (esc?.type === "fixed_amount") {
        ctx.warnings.add("market_fixed_amount_escalation", "fixed_amount escalation on a market leasing profile is modeled as flat rent; use fixed_percent for market profiles in v0.1.");
    }
}
function termRentTotal(rate0, esc, term, ctx) {
    let s = 0;
    for (let t = 0; t < term; t++) {
        s += esc?.type === "fixed_amount" ? rate0 : rate0 * escalationFactor(esc, t, ctx);
    }
    return s;
}
// ------------------------------------------------------- in-place contracts
function contractRate(lease, m, ctx) {
    const sched = lease.baseRent.schedule;
    let step = sched[0];
    let found = false;
    for (const s of sched) {
        if (monthIndex(s.startDate, ctx.start) <= m) {
            step = s;
            found = true;
        }
    }
    if (!found) {
        ctx.warnings.add("schedule_starts_late", `Lease ${lease.leaseId}: rent schedule starts after an analysis month; earliest step used.`, "ssl:" + lease.leaseId);
    }
    let rate = monthlyTotal(step.amount, lease.baseRent.unit, lease.leasedSF);
    const esc = lease.escalation;
    const last = sched[sched.length - 1];
    const lastStart = monthIndex(last.startDate, ctx.start);
    if (esc && esc.type !== "none" && lastStart <= m) {
        const base = monthlyTotal(last.amount, lease.baseRent.unit, lease.leasedSF);
        const monthsSince = m - lastStart;
        if (esc.type === "fixed_amount") {
            const k = Math.floor(monthsSince / (esc.frequencyMonths ?? 12));
            rate = base + monthlyTotal(esc.amount ?? 0, lease.baseRent.unit, lease.leasedSF) * k;
        }
        else {
            rate = base * escalationFactor(esc, monthsSince, ctx);
        }
    }
    return rate;
}
function abatement(lease, m, ctx) {
    let factor = 1;
    let abatesReimb = false;
    for (const fr of lease.freeRent ?? []) {
        if (monthIndex(fr.startDate, ctx.start) <= m && m <= monthIndex(fr.endDate, ctx.start)) {
            const pct = (fr.percentAbated ?? 100) / 100;
            factor *= 1 - pct;
            if (fr.abatesReimbursements)
                abatesReimb = true;
        }
    }
    return { rentFactor: factor, abatesReimb };
}
/** Controllable classification: explicit flag, else category default (taxes/insurance/utilities are not controllable). */
function isControllable(item) {
    if (item.controllable != null)
        return item.controllable;
    return !(item.category === "real_estate_taxes" || item.category === "insurance" || item.category === "utilities");
}
function expensesAt(ctx, m, excludeIds) {
    const out = { aboveFixed: 0, recoverableFixed: 0, recoverableControllable: 0, belowLine: 0, mgmtPct: 0, mgmtRecoverable: false };
    const growth = ctx.deal.marketAssumptions?.growth.expenses;
    for (const item of ctx.deal.expenses?.items ?? []) {
        if (excludeIds?.includes(item.expenseId))
            continue;
        if (item.amountUnit === "percentOfEGR") {
            out.mgmtPct += item.amount / 100;
            if (item.recoverable)
                out.mgmtRecoverable = true;
            continue;
        }
        let annual = item.amountUnit === "perSFPerYear" ? item.amount * ctx.buildingSF : item.amount;
        if (ctx.taxOverride && item.expenseId === ctx.taxOverride.expenseId)
            annual = ctx.taxOverride.baseAnnual; // property tax reassessed to purchase price
        const curve = item.growthOverridePercent != null ? item.growthOverridePercent : growth;
        const monthly = (annual / 12) * growthFactor(curve, m);
        if (item.belowTheLine)
            out.belowLine += monthly;
        else {
            out.aboveFixed += monthly;
            if (item.recoverable) {
                out.recoverableFixed += monthly;
                if (isControllable(item))
                    out.recoverableControllable += monthly;
            }
        }
    }
    return out;
}
/** Recoverable fixed expenses for a single lease's recovery base (handles per-lease exclusions). */
function leaseRecovBase(ctx, m, lease) {
    return expensesAt(ctx, m, lease.reimbursement.excludedExpenses).recoverableFixed;
}
/**
 * Annual ceiling on a capped lease's recoverable controllable expenses, per analysis
 * year (1-based, returned 0-indexed). Year 1 equals the base in every basis, so a cap
 * never bites in the base year. Non-cumulative requires the prior year's billed amount,
 * hence the iterative pass.
 */
function capCeilingsAnnual(ctx, lease, years) {
    const cap = lease.reimbursement.expenseCap;
    const excl = lease.reimbursement.excludedExpenses;
    const c = cap.capPercent / 100;
    const basis = cap.basis ?? "cumulative_compounded";
    const base = cap.baseYearControllableAmount ?? expensesAt(ctx, 0, excl).recoverableControllable * 12;
    const actual = (y) => expensesAt(ctx, (y - 1) * 12, excl).recoverableControllable * 12;
    const out = [];
    if (basis === "non_cumulative") {
        let prevPaid = base;
        for (let y = 1; y <= years; y++) {
            const ceiling = y === 1 ? base : prevPaid * (1 + c);
            out.push(ceiling);
            prevPaid = Math.min(actual(y), ceiling);
        }
    }
    else {
        for (let y = 1; y <= years; y++) {
            out.push(basis === "cumulative" ? base * (1 + c * (y - 1)) : base * Math.pow(1 + c, y - 1));
        }
    }
    return out;
}
export function buildModel(deal, horizon, warnings) {
    const start = deal.valuation?.analysisStartDate ?? deal.rentRoll.asOfDate;
    const reassess = resolveTaxReassessment(deal);
    const ctx = {
        deal, start,
        buildingSF: deal.property.physical.buildingSF,
        horizon,
        warnings,
        cpiAnnualPercent: deal.marketAssumptions?.growth.cpi != null
            ? rateForYear(deal.marketAssumptions.growth.cpi, 1) : null,
        taxOverride: reassess?.reassessAcq ? { expenseId: reassess.expenseId, baseAnnual: reassess.baseAnnual } : undefined,
    };
    if (deal.valuation?.taxReassessment && !reassess) {
        warnings.add("tax_reassessment_skipped", "valuation.taxReassessment is set but could not be applied (needs valuation.purchasePrice and a real_estate_taxes expense or a matching expenseId).");
    }
    else if (reassess?.rateDerived) {
        warnings.add("tax_rate_derived", `Property-tax reassessment: effective rate derived from current taxes ÷ purchase price (${round2(reassess.ratePct)}%); this assumes current taxes already reflect the price. State valuation.taxReassessment.effectiveTaxRatePercent for a long-held asset.`);
    }
    if (deal.marketAssumptions?.growth.cpi != null && typeof deal.marketAssumptions.growth.cpi !== "number") {
        warnings.add("cpi_curve_flattened", "CPI growth curve provided; engine v0.1 applies the year-1 CPI rate to CPI lease escalations across all years.");
    }
    const feeSimple = deal.valuation?.interestAppraised === "fee_simple";
    if (feeSimple) {
        warnings.add("fee_simple_basis", "interestAppraised is fee_simple: in-place leases are replaced with market terms from the analysis start.");
    }
    const total = emptyStreams(horizon);
    const mgRecov = new Array(horizon).fill(0);
    const contractVsMarket = new Array(horizon).fill(0);
    // --- in-place leases (or market terms throughout, if fee simple)
    for (const lease of deal.rentRoll.leases) {
        const profile = profileFor(ctx, undefined);
        const memo = new Map();
        if (feeSimple) {
            if (profile)
                addInto(total, rolloverStreams(0, lease.leasedSF, profile, ctx, memo), 1, horizon);
            continue;
        }
        const expiry = monthIndex(lease.expirationDate, ctx.start) + 1; // active through expiration month
        const share = (lease.reimbursement.proRataSharePercent ?? (lease.leasedSF / ctx.buildingSF) * 100) / 100;
        const structure = lease.reimbursement.structure;
        // MG / expense-stop base
        let mgBaseMonthly = null;
        if (structure === "MG") {
            const r = lease.reimbursement;
            if (r.expenseStopPerSF != null) {
                mgBaseMonthly = (r.expenseStopPerSF * lease.leasedSF) / 12 / share; // stop stated per tenant SF; convert to building-level base
                warnings.add("mg_stop_applied", `Lease ${lease.leaseId}: expense-stop recovery computed (share of recoverable expenses above $${r.expenseStopPerSF}/SF/yr).`, "stop:" + lease.leaseId);
            }
            else if (r.baseYearExpenseAmount != null) {
                // exact base-year expenses provided — no deflation estimate, no warning
                mgBaseMonthly = r.baseYearExpenseAmount / 12;
            }
            else if (r.baseYear != null) {
                const yearsBack = yearOf(ctx.start) - r.baseYear;
                const g = rateForYear(deal.marketAssumptions?.growth.expenses ?? 0, 1);
                const recovNow = expensesAt(ctx, 0, r.excludedExpenses).recoverableFixed;
                mgBaseMonthly = recovNow / Math.pow(1 + g / 100, Math.max(0, yearsBack));
                warnings.add("mg_base_year_estimated", `Lease ${lease.leaseId}: ${r.baseYear} base-year expenses estimated by deflating current recoverable expenses at ${g}%/yr; provide the actual base-year amount via reimbursement.baseYearExpenseAmount for precision.`, "mgest:" + lease.leaseId);
            }
            else {
                warnings.add("mg_no_base", `Lease ${lease.leaseId}: MG lease has neither baseYear nor expenseStopPerSF; zero recoveries modeled.`, "mgnb:" + lease.leaseId);
            }
        }
        // admin/management fee markup the lease lets the landlord add to recoveries
        const adminMarkup = 1 + (lease.reimbursement.adminFeePercent ?? 0) / 100;
        // controllable-expense cap: ceilings on the recoverable controllable expenses (NNN/NN)
        const cap = lease.reimbursement.expenseCap;
        const capCeil = cap && (structure === "NNN" || structure === "NN")
            ? capCeilingsAnnual(ctx, lease, Math.ceil(horizon / 12)) : null;
        if (cap && capCeil) {
            ctx.warnings.add("expense_cap_applied", `Lease ${lease.leaseId}: ${cap.capPercent}% ${cap.basis ?? "cumulative_compounded"} cap applied to recoverable controllable expenses (taxes/insurance/utilities uncapped).`, "cap:" + lease.leaseId);
        }
        for (let m = 0; m < Math.min(expiry, horizon); m++) {
            const rate = contractRate(lease, m, ctx);
            const ab = abatement(lease, m, ctx);
            total.pot[m] += rate;
            total.occSF[m] += lease.leasedSF;
            total.sched[m] += rate * ab.rentFactor;
            total.free[m] += rate * (1 - ab.rentFactor);
            const reimbursing = !(ab.abatesReimb && ab.rentFactor < 1);
            if ((structure === "NNN" || structure === "NN") && reimbursing) {
                // Base recovery: an exclusion list forces the direct-dollar path (the
                // aggregate SF-fraction path can't carry it); otherwise stay aggregate so
                // the recoverable-management-fee gross-up still reaches this lease.
                if (lease.reimbursement.excludedExpenses?.length) {
                    mgRecov[m] += share * leaseRecovBase(ctx, m, lease);
                }
                else {
                    total.recovNNN[m] += lease.leasedSF * (share / (lease.leasedSF / ctx.buildingSF)); // normalized SF honoring stated share
                }
                // Admin/management-fee markup on recoverable expenses — additional income
                // the landlord adds on top, taken as direct dollars over the base.
                if (adminMarkup !== 1)
                    mgRecov[m] += share * leaseRecovBase(ctx, m, lease) * (adminMarkup - 1);
                // Controllable-expense cap: subtract the capped-out controllable excess
                // (kept on the aggregate path above so the lease still recovers its mgmt fee).
                if (capCeil) {
                    const ceilingMonthly = capCeil[Math.min(Math.floor(m / 12), capCeil.length - 1)] / 12;
                    const controllableMonthly = expensesAt(ctx, m, lease.reimbursement.excludedExpenses).recoverableControllable;
                    const excess = Math.max(0, controllableMonthly - ceilingMonthly);
                    if (excess > 0)
                        mgRecov[m] -= share * excess * adminMarkup;
                }
            }
            if (structure === "MG" && mgBaseMonthly != null && reimbursing) {
                const recovNow = leaseRecovBase(ctx, m, lease);
                mgRecov[m] += Math.max(0, share * (recovNow - mgBaseMonthly * growthFactor(0, m))) * adminMarkup;
            }
            // Gross: tenant pays gross rent, landlord absorbs operating expenses — no
            // reimbursement (an intentional $0 recovery, not a missing case).
            if (profile)
                contractVsMarket[m] += rate - marketRate(profile, lease.leasedSF, m, ctx);
        }
        // unfunded in-place TI/LC obligations
        const tiAmt = lease.tenantImprovements
            ? (lease.tenantImprovements.totalAmount ?? (lease.tenantImprovements.amountPerSF ?? 0) * lease.leasedSF) : 0;
        if (tiAmt > 0) {
            const fm = lease.tenantImprovements.fundingDate ? Math.max(0, monthIndex(lease.tenantImprovements.fundingDate, ctx.start)) : 1;
            if (fm < horizon)
                total.ti[fm] += tiAmt;
        }
        const lcObj = lease.leasingCommissions;
        if (lcObj) {
            let lcAmt = lcObj.totalAmount ?? (lcObj.amountPerSF != null ? lcObj.amountPerSF * lease.leasedSF : 0);
            if (lcObj.percentOfTotalRent != null) {
                let totRent = 0;
                for (let m = Math.max(0, monthIndex(lease.commencementDate, ctx.start)); m < expiry; m++)
                    totRent += contractRate(lease, m, ctx);
                lcAmt = (lcObj.percentOfTotalRent / 100) * totRent;
            }
            const fm = lcObj.fundingDate ? Math.max(0, monthIndex(lcObj.fundingDate, ctx.start)) : 1;
            if (lcAmt > 0 && fm < horizon)
                total.lc[fm] += lcAmt;
        }
        // rollover after expiry — honor a stated-rent renewal option at this lease's expiry
        if (!feeSimple && expiry < horizon) {
            if (profile) {
                const ov = resolveRenewalOption(lease, profile, expiry, ctx);
                const streams = ov
                    ? rolloverWithRenewalOption(expiry, lease.leasedSF, profile, ctx, memo, ov)
                    : rolloverStreams(expiry, lease.leasedSF, profile, ctx, memo);
                addInto(total, streams, 1, horizon);
            }
            else
                warnings.add("no_market_profile", "No marketAssumptions.marketLeasing profile: expired space produces no rent after expiry.");
        }
    }
    // --- vacant suites: new-tenant lease-up from month 0 (no renewal possibility at the first event)
    for (const suite of deal.rentRoll.vacantSuites ?? []) {
        const profile = profileFor(ctx, suite.spaceType);
        if (!profile) {
            warnings.add("vacant_no_profile", `Vacant suite ${suite.suite ?? "?"} has no market leasing profile; modeled as permanently vacant.`, "vnp:" + (suite.suite ?? "?"));
            continue;
        }
        const memo = new Map();
        const bn = emptyStreams(horizon);
        const D = profile.downtimeMonths ?? 0;
        const nnn = (profile.reimbursementStructure ?? "NNN") !== "MG" && (profile.reimbursementStructure ?? "NNN") !== "Gross";
        for (let m = 0; m < Math.min(D, horizon); m++)
            bn.pot[m] += marketRate(profile, suite.sf, m, ctx);
        const s = D;
        const rate0 = marketRate(profile, suite.sf, Math.min(s, horizon - 1), ctx);
        leaseSegment(bn, s, profile.termMonths, rate0, profile.newTenant?.freeRentMonths ?? 0, nnn, suite.sf, profile.escalation, ctx);
        if (s < horizon) {
            bn.ti[s] += (profile.newTenant?.tiPerSF ?? 0) * suite.sf;
            bn.lc[s] += ((profile.newTenant?.lcPercentOfRent ?? 0) / 100) * termRentTotal(rate0, profile.escalation, profile.termMonths, ctx);
        }
        addInto(bn, rolloverStreams(s + profile.termMonths, suite.sf, profile, ctx, memo), 1, horizon);
        addInto(total, bn, 1, horizon);
    }
    // --- monthly economics
    const gvPct = (deal.marketAssumptions?.generalVacancyPercent ?? 0) / 100;
    const clPct = (deal.marketAssumptions?.creditLossPercent ?? 0) / 100;
    const model = {
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
        const recovFrac = Math.min(1, total.recovNNN[m] / ctx.buildingSF);
        // recoveries (NNN aggregate + MG/excluded direct), mgmt fee circular when recoverable:
        //   EGR = rent + recovFrac*(recovFixed + mgmtRec*mgmtPct*EGR) + mgDirect
        const rentCollected = total.sched[m];
        const fixedRecov = recovFrac * e.recoverableFixed + mgRecov[m];
        const denom = 1 - (e.mgmtRecoverable ? recovFrac * e.mgmtPct : 0);
        const egr = (rentCollected + fixedRecov) / (denom <= 0 ? 1 : denom);
        const recoveries = egr - rentCollected;
        // general vacancy de-duplicated: allowance = max(0, gv% * potential gross − explicit vacancy already modeled)
        const explicitVacancy = total.pot[m] - total.sched[m] - total.free[m];
        const gvLoss = Math.max(0, gvPct * (total.pot[m] + recoveries) - explicitVacancy);
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
        model.cashFlow[m] = noi - e.belowLine - total.ti[m] - total.lc[m];
    }
    return model;
}
// -------------------------------------------------------------- valuation
function stabilizedAnnualNOI(deal, atMonth, warnings) {
    const profiles = deal.marketAssumptions?.marketLeasing ?? {};
    const key = Object.keys(profiles)[0];
    if (!key)
        return null;
    const reassess = resolveTaxReassessment(deal);
    const ctx = {
        deal, start: deal.valuation?.analysisStartDate ?? deal.rentRoll.asOfDate,
        buildingSF: deal.property.physical.buildingSF, horizon: atMonth + 1, warnings,
        cpiAnnualPercent: null,
        taxOverride: reassess?.reassessAcq ? { expenseId: reassess.expenseId, baseAnnual: reassess.baseAnnual } : undefined,
    };
    const profile = profiles[key];
    const rentM = marketRate(profile, ctx.buildingSF, atMonth, ctx);
    const e = expensesAt(ctx, atMonth);
    const nnn = (profile.reimbursementStructure ?? "NNN") === "NNN" || (profile.reimbursementStructure ?? "NNN") === "NN";
    const recovFrac = nnn ? 1 : 0;
    const denom = 1 - (e.mgmtRecoverable ? recovFrac * e.mgmtPct : 0);
    const egr = (rentM + recovFrac * e.recoverableFixed) / (denom <= 0 ? 1 : denom);
    const gv = ((deal.marketAssumptions?.generalVacancyPercent ?? 0) + (deal.marketAssumptions?.creditLossPercent ?? 0)) / 100;
    return (egr * (1 - gv) - e.aboveFixed - e.mgmtPct * egr) * 12;
}
function pvOf(cf, from, to, annualRatePct, timing, convention) {
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
        pv += cf[m] / Math.pow(1 + r, t);
    }
    return pv;
}
export function computeDirectCap(deal, model, warnings) {
    const dc = deal.valuation?.directCap;
    if (!dc)
        return null;
    const sf = deal.property.physical.buildingSF;
    let basisNOI = null;
    if (dc.excludeExpenseIds?.length) {
        // rebuild a small context to price the excluded items in year 1
        const rx = resolveTaxReassessment(deal);
        const ctx = { deal, start: deal.valuation.analysisStartDate, buildingSF: sf, horizon: 12, warnings, cpiAnnualPercent: null, taxOverride: rx?.reassessAcq ? { expenseId: rx.expenseId, baseAnnual: rx.baseAnnual } : undefined };
        let excluded = 0;
        for (let m = 0; m < 12; m++) {
            excluded += expensesAt(ctx, m).aboveFixed - expensesAt(ctx, m, dc.excludeExpenseIds).aboveFixed;
        }
        warnings.add("exclusions_added_back", `directCap.excludeExpenseIds: ${dc.excludeExpenseIds.join(", ")} added back to basis NOI (recovery interaction not re-solved).`);
        basisNOI = (dc.noiBasis === "year1" ? sum(model.noi, 0, 12) : null) ?? null;
        if (basisNOI != null)
            basisNOI += excluded;
    }
    if (basisNOI == null) {
        if (dc.noiBasis === "year1")
            basisNOI = sum(model.noi, 0, 12);
        else if (dc.noiBasis === "inPlace")
            basisNOI = model.noi[0] * 12;
        else if (dc.noiBasis === "stabilizedAtMarket")
            basisNOI = stabilizedAnnualNOI(deal, 0, warnings);
        else if (dc.noiBasis === "custom" || dc.noiBasis === "trailing12")
            basisNOI = dc.customNOI ?? null;
    }
    if (basisNOI == null) {
        warnings.add("direct_cap_incomputable", `Direct cap NOI basis "${dc.noiBasis}" could not be computed from this file.`);
        return null;
    }
    if (dc.applyGeneralVacancy === false && dc.noiBasis !== "custom" && dc.noiBasis !== "trailing12") {
        basisNOI += sum(model.generalVacancyLoss, 0, 12) + sum(model.creditLoss, 0, 12);
    }
    if (dc.deductBelowTheLineItems)
        basisNOI -= sum(model.belowLine, 0, 12);
    let value = basisNOI / (dc.capRatePercent / 100);
    const grossValue = value;
    const applied = [];
    if (dc.markToMarket) {
        const r = dc.markToMarket.discountRatePercent / 100;
        let mtm = 0;
        for (let m = 0; m < model.contractVsMarket.length; m++) {
            mtm += model.contractVsMarket[m] / Math.pow(1 + r, (m + 1) / 12);
        }
        value += mtm;
        applied.push({ name: "Mark-to-market (PV of contract vs market)", amount: round0(mtm) });
    }
    if (dc.nearTermAdjustments) {
        const n = dc.nearTermAdjustments;
        const P = Math.min(n.periodMonths, model.sched.length);
        const r = n.discountRatePercent;
        const df = (m) => (r == null ? 1 : 1 / Math.pow(1 + r / 100, (m + 1) / 12));
        let lost = 0, freeR = 0, ti = 0, lc = 0;
        for (let m = 0; m < P; m++) {
            lost += (model.pot[m] - model.sched[m] - model.free[m]) * df(m);
            freeR += model.free[m] * df(m);
            ti += model.ti[m] * df(m);
            lc += model.lc[m] * df(m);
        }
        const parts = [
            ["downtime lost rent", n.includeDowntimeLostRent !== false, lost],
            ["free rent", n.includeFreeRent !== false, freeR],
            ["TI", n.includeTI !== false, ti],
            ["LC", n.includeLC !== false, lc],
        ];
        for (const [name, on, amt] of parts) {
            if (!on || amt === 0)
                continue;
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
export function computeDCF(deal, model, warnings) {
    const dcf = deal.valuation?.dcf;
    if (!dcf)
        return null;
    const H = dcf.holdPeriodMonths ?? dcf.holdPeriodYears * 12;
    const sf = deal.property.physical.buildingSF;
    const timing = dcf.discountTiming ?? "monthly";
    const convention = dcf.periodConvention ?? "end";
    const tv = dcf.terminalValue;
    let terminalGross = null;
    if (tv.method === "direct_cap") {
        let tNOI = null;
        const basis = tv.noiBasis ?? "forwardYear";
        if (basis === "forwardYear")
            tNOI = sum(model.noi, H, H + 12);
        else if (basis === "trailingYear")
            tNOI = sum(model.noi, H - 12, H);
        else
            tNOI = stabilizedAnnualNOI(deal, H, warnings);
        if (tNOI == null) {
            warnings.add("terminal_incomputable", "Terminal NOI basis could not be computed; DCF skipped.");
            return null;
        }
        if (tv.deductBelowTheLineItems)
            tNOI -= sum(model.belowLine, H, H + 12);
        const rx = resolveTaxReassessment(deal);
        if (rx?.reassessRev) {
            // Load the exit cap by the tax rate so the buyer's taxes reset to the sale
            // price: V = (terminal NOI + seller's terminal property tax) / (cap + rate).
            const from = basis === "trailingYear" ? H - 12 : H;
            const effBase = rx.reassessAcq ? rx.baseAnnual : rx.currentAnnual;
            const curve = itemGrowthCurve(deal, rx.expenseId);
            let sellerTax = 0;
            for (let m = from; m < from + 12; m++)
                sellerTax += (effBase / 12) * growthFactor(curve, m);
            terminalGross = (tNOI + sellerTax) / (tv.capRatePercent / 100 + rx.ratePct / 100);
            warnings.add("tax_reassessment_reversion", `Terminal cap loaded by the ${round2(rx.ratePct)}% effective tax rate so the exit value reflects reassessment to the sale price (Prop 13-style).`);
        }
        else {
            terminalGross = tNOI / (tv.capRatePercent / 100);
        }
    }
    else if (tv.method === "exit_price_psf")
        terminalGross = tv.exitPricePerSF * sf;
    else if (tv.method === "fixed_value")
        terminalGross = tv.fixedValue;
    else {
        if (deal.valuation?.purchasePrice == null) {
            warnings.add("terminal_incomputable", "grown_purchase_price terminal requires purchasePrice.");
            return null;
        }
        terminalGross = deal.valuation.purchasePrice * Math.pow(1 + tv.annualAppreciationPercent / 100, H / 12);
    }
    let unfunded = null;
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
export function buildDebt(deal, model, H, warnings) {
    const d = deal.debt;
    if (!d)
        return null;
    let amount = d.loanAmount ?? null;
    if (amount == null && d.ltvPercent != null) {
        if (deal.valuation?.purchasePrice == null) {
            warnings.add("ltv_needs_price", "debt.ltvPercent requires valuation.purchasePrice; debt skipped.");
            return null;
        }
        amount = (d.ltvPercent / 100) * deal.valuation.purchasePrice;
    }
    if (amount == null)
        return null;
    const start = deal.valuation?.analysisStartDate ?? deal.rentRoll.asOfDate;
    const f0 = d.fundingDate ? Math.max(0, monthIndex(d.fundingDate, start)) : 0;
    const i = d.interestRatePercent / 100 / 12;
    const io = d.interestOnlyMonths ?? 0;
    const horizon = model.cashFlow.length;
    const service = new Array(horizon).fill(0);
    const balance = new Array(horizon).fill(0);
    let bal = amount;
    let pmt = null;
    if (d.termMonths < H) {
        warnings.add("loan_term_lt_hold", `Loan term (${d.termMonths} mo) ends before the hold (${H} mo); per spec, payoff is assumed refinanced on identical terms (schedule continues).`);
    }
    for (let m = f0; m < horizon; m++) {
        const age = m - f0;
        if (age < io || d.amortizationMonths == null) {
            service[m] = bal * i;
        }
        else {
            if (pmt == null)
                pmt = (bal * i) / (1 - Math.pow(1 + i, -(d.amortizationMonths)));
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
function irrAnnual(cashflows) {
    // cashflows[t] at month t (t=0 is the initial outflow). Bisection on monthly rate.
    const npv = (rm) => cashflows.reduce((s, cf, t) => s + cf / Math.pow(1 + rm, t), 0);
    let lo = -0.08, hi = 0.5; // monthly: ~-63%/yr .. ~13000%/yr
    let flo = npv(lo), fhi = npv(hi);
    if (isNaN(flo) || isNaN(fhi) || flo * fhi > 0)
        return null;
    for (let k = 0; k < 200; k++) {
        const mid = (lo + hi) / 2;
        const fm = npv(mid);
        if (flo * fm <= 0) {
            hi = mid;
            fhi = fm;
        }
        else {
            lo = mid;
            flo = fm;
        }
    }
    const rm = (lo + hi) / 2;
    return round2((Math.pow(1 + rm, 12) - 1) * 100);
}
export function computeReturns(deal, model, dcfRes, debt) {
    const v = deal.valuation;
    if (!v?.purchasePrice || !dcfRes)
        return { unlevered: null, levered: null };
    const H = dcfRes.holdMonths;
    const totalCost = v.purchasePrice * (1 + (v.acquisitionCostsPercent ?? 0) / 100);
    const cfU = [-totalCost];
    for (let m = 0; m < H; m++)
        cfU.push(model.cashFlow[m]);
    cfU[H] = cfU[H] + dcfRes.terminalNet;
    const distributionsU = cfU.slice(1).reduce((s, x) => s + x, 0);
    const unlevered = {
        irrPercent: irrAnnual(cfU),
        npvAtDiscountRate: round0(dcfRes.indicatedValue - totalCost),
        equityMultiple: totalCost > 0 ? round2(distributionsU / totalCost) : null,
        totalProfit: round0(cfU.reduce((s, x) => s + x, 0)),
    };
    let levered = null;
    if (debt) {
        const equity0 = totalCost - debt.netProceeds;
        const cfL = [-equity0];
        for (let m = 0; m < H; m++)
            cfL.push(model.cashFlow[m] - debt.service[m]);
        const payoff = debt.balance[H - 1] ?? 0;
        cfL[H] = cfL[H] + dcfRes.terminalNet - payoff;
        levered = {
            irrPercent: irrAnnual(cfL),
            equityMultiple: equity0 > 0 ? round2(cfL.slice(1).reduce((s, x) => s + x, 0) / equity0) : null,
            initialEquity: round0(equity0),
            totalProfit: round0(cfL.reduce((s, x) => s + x, 0)),
        };
    }
    return { unlevered, levered };
}
export function computeSensitivity(deal, model, warnings) {
    const dcf = deal.valuation?.dcf;
    if (!dcf)
        return null;
    const H = dcf.holdPeriodMonths ?? dcf.holdPeriodYears * 12;
    const timing = dcf.discountTiming ?? "monthly";
    const convention = dcf.periodConvention ?? "end";
    const tv = dcf.terminalValue;
    const discounts = [-1, -0.5, 0, 0.5, 1].map((d) => round2(dcf.discountRatePercent + d));
    let tNOI = null;
    if (tv.method === "direct_cap") {
        const basis = tv.noiBasis ?? "forwardYear";
        if (basis === "forwardYear")
            tNOI = sum(model.noi, H, H + 12);
        else if (basis === "trailingYear")
            tNOI = sum(model.noi, H - 12, H);
        else
            tNOI = stabilizedAnnualNOI(deal, H, warnings);
        if (tNOI != null && tv.deductBelowTheLineItems)
            tNOI -= sum(model.belowLine, H, H + 12);
    }
    const caps = tv.method === "direct_cap" && tNOI != null
        ? [-0.5, -0.25, 0, 0.25, 0.5].map((d) => round2(tv.capRatePercent + d))
        : null;
    const unfunded = tv.deductUnfundedObligations ? sum(model.free, H, model.free.length) : 0;
    const fixedGross = tv.method === "exit_price_psf" ? tv.exitPricePerSF * deal.property.physical.buildingSF
        : tv.method === "fixed_value" ? tv.fixedValue
            : tv.method === "grown_purchase_price" && deal.valuation?.purchasePrice != null
                ? deal.valuation.purchasePrice * Math.pow(1 + tv.annualAppreciationPercent / 100, H / 12)
                : null;
    const values = [];
    for (const dr of discounts) {
        const pvOp = pvOf(model.cashFlow, 0, H, dr, timing, convention);
        const rRev = (dcf.reversionDiscountRatePercent ?? dcf.discountRatePercent) + (dr - dcf.discountRatePercent);
        const row = [];
        for (const cap of caps ?? [null]) {
            const gross = cap != null ? tNOI / (cap / 100) : fixedGross;
            if (gross == null)
                return null;
            const net = (gross - unfunded) * (1 - (tv.sellingCostsPercent ?? 0) / 100);
            row.push(round0(pvOp + net / Math.pow(1 + rRev / 100, H / 12)));
        }
        values.push(row);
    }
    return { discountRatesPercent: discounts, exitCapRatesPercent: caps, values };
}
export function annualTable(model, H) {
    const rows = [];
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
function computeLeaseMetrics(deal, start, ctx0) {
    let remRent = 0, totRent = 0, remSF = 0, totSF = 0, rollRent = 0, rollSF = 0;
    for (const lease of deal.rentRoll.leases) {
        const remMonths = Math.max(0, monthIndex(lease.expirationDate, start) + 1);
        const remYears = remMonths / 12;
        const rentAnnual = contractRate(lease, 0, ctx0) * 12;
        const sf = lease.leasedSF;
        remRent += remYears * rentAnnual;
        totRent += rentAnnual;
        remSF += remYears * sf;
        totSF += sf;
        if (monthIndex(lease.expirationDate, start) < 12) {
            rollRent += rentAnnual;
            rollSF += sf;
        }
    }
    return {
        waltYearsByRent: totRent > 0 ? round2(remRent / totRent) : null,
        waltYearsBySF: totSF > 0 ? round2(remSF / totSF) : null,
        rollNext12ByRentPercent: totRent > 0 ? round2((rollRent / totRent) * 100) : 0,
        rollNext12BySFPercent: totSF > 0 ? round2((rollSF / totSF) * 100) : 0,
    };
}
// ------------------------------------------------------------- computeAll
export function computeAll(deal) {
    const warnings = new Warnings();
    const start = deal.valuation?.analysisStartDate ?? deal.rentRoll.asOfDate;
    const sf = deal.property.physical.buildingSF;
    const dcfIn = deal.valuation?.dcf;
    const H = dcfIn ? (dcfIn.holdPeriodMonths ?? dcfIn.holdPeriodYears * 12) : 12;
    if (dcfIn?.discountTiming === "annual") {
        warnings.add("annual_timing", "discountTiming \"annual\": cash flows aggregated by year and discounted annually, per the file.");
    }
    const horizon = Math.max(H + 36, 48);
    const model = buildModel(deal, horizon, warnings);
    // occupancy at asOf
    let occupiedSF = 0;
    for (const l of deal.rentRoll.leases)
        occupiedSF += l.leasedSF;
    let vacantSF = 0;
    for (const v of deal.rentRoll.vacantSuites ?? [])
        vacantSF += v.sf;
    if (Math.abs(occupiedSF + vacantSF - sf) > sf * 0.005) {
        warnings.add("sf_mismatch", `Leased SF (${occupiedSF}) + vacant SF (${vacantSF}) != building SF (${sf}).`);
    }
    // in-place rent at month 0
    const ctx0 = { deal, start, buildingSF: sf, horizon: 1, warnings, cpiAnnualPercent: null };
    let inPlaceMonthly = 0;
    for (const lease of deal.rentRoll.leases)
        inPlaceMonthly += contractRate(lease, 0, ctx0);
    const waInPlace = occupiedSF > 0 ? inPlaceMonthly / occupiedSF : null;
    const profiles = deal.marketAssumptions?.marketLeasing ?? {};
    const pk = Object.keys(profiles)[0];
    const waMarket = pk ? monthlyTotal(profiles[pk].marketRent.amount, profiles[pk].marketRent.unit, 1) : null;
    const gapPct = waInPlace != null && waMarket ? round2(((waInPlace - waMarket) / waMarket) * 100) : null;
    const e0 = expensesAt({ ...ctx0, horizon: 1 }, 0);
    const directCap = computeDirectCap(deal, model, warnings);
    const dcf = computeDCF(deal, model, warnings);
    const debt = buildDebt(deal, model, H, warnings);
    const returns = computeReturns(deal, model, dcf, debt);
    const sensitivity = computeSensitivity(deal, model, warnings);
    let concludedValue = deal.valuation?.reconciliation?.concludedValue ?? null;
    let concludedSource = concludedValue != null ? "reconciliation (producer-stated)" : null;
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
            clearHeightFt: deal.property.physical.clearHeightFt ?? null,
        },
        occupancy: {
            buildingSF: sf, occupiedSF, vacantSF,
            occupancyPercent: round2((occupiedSF / sf) * 100),
        },
        leaseMetrics: computeLeaseMetrics(deal, start, ctx0),
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
        noiBridgeYear1: annualTable(model, 12)[0],
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
export function computePortfolio(entries) {
    const warnings = new Warnings();
    const per = entries.map((e) => ({ label: e.label, deal: e.deal, out: computeAll(e.deal) }));
    for (const p of per) {
        for (const w of p.out.warnings) {
            warnings.add(w.code, `[${p.label}] ${w.message}`, p.label + "|" + w.code + "|" + w.message);
        }
    }
    const starts = new Set(per.map((p) => p.deal.valuation?.analysisStartDate ?? p.deal.rentRoll.asOfDate));
    if (starts.size > 1) {
        warnings.add("start_dates_differ", "Deals have different analysis start dates; combined cash flows are aligned by analysis year index, not calendar year.");
    }
    // ---- totals
    let buildingSF = 0, occupiedSF = 0, vacantSF = 0, inPlaceAnnual = 0, y1NOI = 0;
    let stabSum = 0, stabCount = 0, priceSum = 0, priceCount = 0, concludedSum = 0, concludedCount = 0;
    let mktWeighted = 0, mktSF = 0;
    let waltRentNum = 0, waltRentDen = 0, waltSFNum = 0, waltSFDen = 0, rollRentNum = 0, rollSFNum = 0;
    for (const p of per) {
        buildingSF += p.out.occupancy.buildingSF;
        occupiedSF += p.out.occupancy.occupiedSF;
        vacantSF += p.out.occupancy.vacantSF;
        inPlaceAnnual += p.out.rent.inPlaceAnnualBaseRent;
        y1NOI += p.out.noi.year1NOI;
        const lm = p.out.leaseMetrics, rentI = p.out.rent.inPlaceAnnualBaseRent, sfI = p.out.occupancy.occupiedSF;
        if (lm.waltYearsByRent != null) {
            waltRentNum += lm.waltYearsByRent * rentI;
            waltRentDen += rentI;
        }
        if (lm.waltYearsBySF != null) {
            waltSFNum += lm.waltYearsBySF * sfI;
            waltSFDen += sfI;
        }
        rollRentNum += (lm.rollNext12ByRentPercent / 100) * rentI;
        rollSFNum += (lm.rollNext12BySFPercent / 100) * sfI;
        if (p.out.noi.stabilizedAtMarketNOI != null) {
            stabSum += p.out.noi.stabilizedAtMarketNOI;
            stabCount++;
        }
        if (p.deal.valuation?.purchasePrice != null) {
            priceSum += p.deal.valuation.purchasePrice;
            priceCount++;
        }
        if (p.out.concluded.value != null) {
            concludedSum += p.out.concluded.value;
            concludedCount++;
        }
        if (p.out.rent.marketRentPerSFPerMonth != null) {
            mktWeighted += p.out.rent.marketRentPerSFPerMonth * p.out.occupancy.buildingSF;
            mktSF += p.out.occupancy.buildingSF;
        }
    }
    const waInPlace = occupiedSF > 0 ? inPlaceAnnual / 12 / occupiedSF : null;
    const waMarket = mktSF > 0 ? mktWeighted / mktSF : null;
    const portfolioLeaseMetrics = {
        waltYearsByRent: waltRentDen > 0 ? round2(waltRentNum / waltRentDen) : null,
        waltYearsBySF: waltSFDen > 0 ? round2(waltSFNum / waltSFDen) : null,
        rollNext12ByRentPercent: inPlaceAnnual > 0 ? round2((rollRentNum / inPlaceAnnual) * 100) : 0,
        rollNext12BySFPercent: occupiedSF > 0 ? round2((rollSFNum / occupiedSF) * 100) : 0,
    };
    // ---- combined monthly model (each deal contributes through its own hold)
    const dealHs = per.map((p) => p.deal.valuation?.dcf ? (p.deal.valuation.dcf.holdPeriodMonths ?? p.deal.valuation.dcf.holdPeriodYears * 12) : 12);
    const maxH = Math.max(...dealHs);
    const modelKeys = [
        "sched", "free", "pot", "occSF", "recoveries", "generalVacancyLoss", "creditLoss",
        "egr", "opexFixed", "mgmtFee", "noi", "belowLine", "ti", "lc", "cashFlow", "contractVsMarket",
    ];
    const combined = Object.fromEntries(modelKeys.map((k) => [k, new Array(maxH).fill(0)]));
    // ---- portfolio returns (deals with purchasePrice + computable DCF)
    const cfU = new Array(maxH + 1).fill(0);
    const cfL = new Array(maxH + 1).fill(0);
    let costSum = 0, equitySum = 0, anyDebt = false;
    const includedDeals = [];
    const excludedDeals = [];
    per.forEach((p, i) => {
        const wLocal = new Warnings();
        const H = dealHs[i];
        const model = buildModel(p.deal, Math.max(H + 36, 48), wLocal);
        for (const k of modelKeys) {
            for (let m = 0; m < H; m++)
                combined[k][m] += model[k][m];
        }
        const dcfRes = computeDCF(p.deal, model, wLocal);
        const price = p.deal.valuation?.purchasePrice;
        if (dcfRes && price != null) {
            const cost = price * (1 + (p.deal.valuation?.acquisitionCostsPercent ?? 0) / 100);
            costSum += cost;
            cfU[0] -= cost;
            for (let m = 0; m < H; m++)
                cfU[m + 1] += model.cashFlow[m];
            cfU[H] += dcfRes.terminalNet;
            const debt = buildDebt(p.deal, model, H, wLocal);
            const net = debt?.netProceeds ?? 0;
            if (debt)
                anyDebt = true;
            equitySum += cost - net;
            cfL[0] -= cost - net;
            for (let m = 0; m < H; m++)
                cfL[m + 1] += model.cashFlow[m] - (debt ? debt.service[m] : 0);
            cfL[H] += dcfRes.terminalNet - (debt ? (debt.balance[H - 1] ?? 0) : 0);
            includedDeals.push(p.label);
        }
        else {
            excludedDeals.push(p.label);
        }
    });
    if (excludedDeals.length && includedDeals.length) {
        warnings.add("returns_partial", `Portfolio returns include ${includedDeals.length} of ${per.length} deals; excluded (no purchase price or DCF): ${excludedDeals.join(", ")}.`);
    }
    const distU = cfU.slice(1).reduce((s, x) => s + x, 0);
    const distL = cfL.slice(1).reduce((s, x) => s + x, 0);
    const returns = includedDeals.length === 0 ? null : {
        unlevered: {
            irrPercent: irrAnnual(cfU),
            equityMultiple: costSum > 0 ? round2(distU / costSum) : null,
            totalProfit: round0(cfU.reduce((s, x) => s + x, 0)),
            initialInvestment: round0(costSum),
        },
        levered: anyDebt ? {
            irrPercent: irrAnnual(cfL),
            equityMultiple: equitySum > 0 ? round2(distL / equitySum) : null,
            totalProfit: round0(cfL.reduce((s, x) => s + x, 0)),
            initialEquity: round0(equitySum),
        } : null,
        includedDeals,
        excludedDeals,
    };
    // ---- lease expirations by calendar year (in-place leases) and top tenants
    const expir = new Map();
    const tenants = new Map();
    for (const p of per) {
        const start = p.deal.valuation?.analysisStartDate ?? p.deal.rentRoll.asOfDate;
        for (const lease of p.deal.rentRoll.leases) {
            const expiryMonth = Math.max(0, monthIndex(lease.expirationDate, start));
            const ctx = { deal: p.deal, start, buildingSF: p.deal.property.physical.buildingSF, horizon: expiryMonth + 1, warnings: new Warnings(), cpiAnnualPercent: null };
            const expiringRent = contractRate(lease, expiryMonth, ctx) * 12;
            const year = yearOf(lease.expirationDate);
            const e = expir.get(year) ?? { sf: 0, rent: 0 };
            e.sf += lease.leasedSF;
            e.rent += expiringRent;
            expir.set(year, e);
            const inPlaceRent = contractRate(lease, 0, ctx) * 12;
            const t = tenants.get(lease.tenant.name) ?? { sf: 0, annualRent: 0, earliestExpiration: lease.expirationDate, deals: new Set() };
            t.sf += lease.leasedSF;
            t.annualRent += inPlaceRent;
            if (lease.expirationDate < t.earliestExpiration)
                t.earliestExpiration = lease.expirationDate;
            t.deals.add(p.label);
            tenants.set(lease.tenant.name, t);
        }
    }
    const leaseExpirations = [...expir.entries()].sort((a, b) => a[0] - b[0]).map(([year, e]) => ({
        year,
        sf: round0(e.sf),
        percentOfPortfolioSF: round2((e.sf / buildingSF) * 100),
        expiringAnnualRent: round0(e.rent),
    }));
    const topTenants = [...tenants.entries()]
        .sort((a, b) => b[1].annualRent - a[1].annualRent)
        .slice(0, 10)
        .map(([name, t]) => ({
        name,
        sf: round0(t.sf),
        annualRent: round0(t.annualRent),
        percentOfPortfolioRent: inPlaceAnnual > 0 ? round2((t.annualRent / inPlaceAnnual) * 100) : null,
        earliestExpiration: t.earliestExpiration,
        deals: [...t.deals].sort(),
    }));
    return {
        engineVersion: ENGINE_VERSION,
        dealCount: per.length,
        deals: per.map((p) => ({
            label: p.label,
            name: p.out.property.name,
            cityState: p.out.property.cityState,
            buildingSF: p.out.occupancy.buildingSF,
            occupancyPercent: p.out.occupancy.occupancyPercent,
            inPlaceWARentPerSFPerMonth: p.out.rent.inPlaceWARentPerSFPerMonth,
            inPlaceVsMarketPercent: p.out.rent.inPlaceVsMarketPercent,
            year1NOI: p.out.noi.year1NOI,
            concludedValue: p.out.concluded.value,
            valuePerSF: p.out.concluded.value != null ? round2(p.out.concluded.value / p.out.occupancy.buildingSF) : null,
            unleveredIRRPercent: p.out.returns.unlevered?.irrPercent ?? null,
        })),
        totals: {
            buildingSF: round0(buildingSF),
            occupiedSF: round0(occupiedSF),
            vacantSF: round0(vacantSF),
            occupancyPercent: buildingSF > 0 ? round2((occupiedSF / buildingSF) * 100) : null,
            inPlaceAnnualBaseRent: round0(inPlaceAnnual),
            inPlaceWARentPerSFPerMonth: waInPlace != null ? round2(waInPlace) : null,
            marketWARentPerSFPerMonth: waMarket != null ? round2(waMarket) : null,
            inPlaceVsMarketPercent: waInPlace != null && waMarket ? round2(((waInPlace - waMarket) / waMarket) * 100) : null,
            year1NOI: round0(y1NOI),
            stabilizedAtMarketNOI: stabCount === per.length ? round0(stabSum) : null,
            purchasePrice: priceCount === per.length ? round0(priceSum) : null,
            concludedValue: concludedCount === per.length ? round0(concludedSum) : null,
            concludedValuePerSF: concludedCount === per.length && buildingSF > 0 ? round2(concludedSum / buildingSF) : null,
        },
        leaseMetrics: portfolioLeaseMetrics,
        cashFlows: { annual: annualTable(combined, maxH) },
        returns,
        leaseExpirations,
        topTenants,
        warnings: warnings.list,
    };
}
// ------------------------------------------------------------------ lint
export function lint(deal) {
    const problems = [];
    const d = deal;
    if (typeof deal !== "object" || deal == null)
        return [{ code: "not_object", message: "File is not a JSON object." }];
    if (!d.formatVersion)
        problems.push({ code: "missing", message: "formatVersion is required." });
    else if (!/^0\.1\.\d+$/.test(d.formatVersion))
        problems.push({ code: "version", message: `formatVersion ${d.formatVersion} is not 0.1.x.` });
    if (!d.property)
        problems.push({ code: "missing", message: "property module is required." });
    else if (!d.property.physical?.buildingSF)
        problems.push({ code: "missing", message: "property.physical.buildingSF is required." });
    if (!d.rentRoll)
        problems.push({ code: "missing", message: "rentRoll module is required." });
    else {
        if (!d.rentRoll.asOfDate)
            problems.push({ code: "missing", message: "rentRoll.asOfDate is required." });
        (d.rentRoll.leases ?? []).forEach((l, i) => {
            for (const f of ["leaseId", "tenant", "leasedSF", "commencementDate", "expirationDate", "baseRent", "reimbursement"]) {
                if (l[f] == null)
                    problems.push({ code: "missing", message: `leases[${i}] missing ${f}.` });
            }
        });
    }
    if (!d.marketAssumptions)
        problems.push({ code: "advice", message: "No marketAssumptions: rollover, lease-up, and stabilized values cannot be modeled." });
    if (!d.valuation)
        problems.push({ code: "advice", message: "No valuation module: engine reports operating metrics only." });
    return problems;
}
