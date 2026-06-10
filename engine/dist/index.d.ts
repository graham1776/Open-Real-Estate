import type { OreFile, Warning } from "./types.js";
export declare const ENGINE_VERSION = "0.1.0";
declare class Warnings {
    list: Warning[];
    private seen;
    add(code: string, message: string, dedupeKey?: string): void;
}
export interface MonthlyModel {
    sched: number[];
    free: number[];
    pot: number[];
    occSF: number[];
    recoveries: number[];
    generalVacancyLoss: number[];
    creditLoss: number[];
    egr: number[];
    opexFixed: number[];
    mgmtFee: number[];
    noi: number[];
    belowLine: number[];
    ti: number[];
    lc: number[];
    cashFlow: number[];
    contractVsMarket: number[];
}
export declare function buildModel(deal: OreFile, horizon: number, warnings: Warnings): MonthlyModel;
export interface DirectCapResult {
    basis: string;
    basisNOI: number;
    capRatePercent: number;
    grossValue: number;
    adjustmentsApplied: {
        name: string;
        amount: number;
    }[];
    indicatedValue: number;
    perSF: number;
}
export declare function computeDirectCap(deal: OreFile, model: MonthlyModel, warnings: Warnings): DirectCapResult | null;
export interface DcfResult {
    holdMonths: number;
    discountRatePercent: number;
    reversionDiscountRatePercent: number;
    pvOperating: number;
    terminalGross: number;
    terminalNet: number;
    pvTerminal: number;
    indicatedValue: number;
    perSF: number;
    unfundedObligationsDeducted: number | null;
}
export declare function computeDCF(deal: OreFile, model: MonthlyModel, warnings: Warnings): DcfResult | null;
export interface DebtSchedule {
    loanAmount: number;
    netProceeds: number;
    fundingMonth: number;
    service: number[];
    balance: number[];
    year1DebtService: number | null;
    dscrYear1: number | null;
}
export declare function buildDebt(deal: OreFile, model: MonthlyModel, H: number, warnings: Warnings): DebtSchedule | null;
export interface ReturnsResult {
    unlevered: {
        irrPercent: number | null;
        npvAtDiscountRate: number | null;
        equityMultiple: number | null;
        totalProfit: number | null;
    } | null;
    levered: {
        irrPercent: number | null;
        equityMultiple: number | null;
        initialEquity: number;
        totalProfit: number | null;
    } | null;
}
export declare function computeReturns(deal: OreFile, model: MonthlyModel, dcfRes: DcfResult | null, debt: DebtSchedule | null): ReturnsResult;
export interface SensitivityResult {
    discountRatesPercent: number[];
    exitCapRatesPercent: number[] | null;
    values: number[][];
}
export declare function computeSensitivity(deal: OreFile, model: MonthlyModel, warnings: Warnings): SensitivityResult | null;
export interface AnnualRow {
    year: number;
    months: number;
    scheduledBaseRent: number;
    freeRent: number;
    absorptionVacancy: number;
    expenseRecoveries: number;
    generalVacancy: number;
    creditLoss: number;
    effectiveGrossRevenue: number;
    operatingExpenses: number;
    managementFee: number;
    noi: number;
    belowTheLine: number;
    tiCosts: number;
    lcCosts: number;
    cashFlow: number;
}
export declare function computeAll(deal: OreFile): {
    engineVersion: string;
    property: {
        name: string;
        cityState: string;
        market: string | null;
        submarket: string | null;
        buildingSF: number;
        yearBuilt: number | null;
        clearHeightFt: number | null;
    };
    occupancy: {
        buildingSF: number;
        occupiedSF: number;
        vacantSF: number;
        occupancyPercent: number;
    };
    rent: {
        inPlaceAnnualBaseRent: number;
        inPlaceWARentPerSFPerMonth: number | null;
        marketRentPerSFPerMonth: number | null;
        inPlaceVsMarketPercent: number | null;
    };
    expenses: {
        aboveLineAnnualExclMgmt: number;
        belowTheLineAnnual: number;
        managementFeePercentOfEGR: number | null;
    };
    noi: {
        year1NOI: number;
        stabilizedAtMarketNOI: number | null;
    };
    noiBridgeYear1: AnnualRow;
    cashFlows: {
        annual: AnnualRow[];
    };
    directCap: DirectCapResult | null;
    dcf: DcfResult | null;
    debt: {
        loanAmount: number;
        netProceeds: number;
        year1DebtService: number | null;
        dscrYear1: number | null;
    } | null;
    returns: ReturnsResult;
    sensitivity: SensitivityResult | null;
    concluded: {
        value: number | null;
        source: string | null;
    };
    warnings: Warning[];
};
export type EngineOutput = ReturnType<typeof computeAll>;
export declare function lint(deal: unknown): Warning[];
export {};
