export type RentUnit = "perSFPerMonth" | "perSFPerYear" | "totalPerMonth" | "totalPerYear";
export type ReimbursementStructure = "NNN" | "NN" | "MG" | "Gross";
export type GrowthCurve = number | {
    fromYear: number;
    annualPercent: number;
}[];
export interface OreFile {
    $schema?: string;
    formatVersion: string;
    property: Property;
    rentRoll: RentRoll;
    expenses?: Expenses;
    marketAssumptions?: MarketAssumptions;
    valuation?: Valuation;
    debt?: Debt;
    provenance?: unknown;
}
export interface Property {
    name: string;
    propertyType: string;
    propertySubtype?: string;
    tenancy?: "single" | "multi";
    description?: string;
    address: {
        street1: string;
        city: string;
        state: string;
        postalCode: string;
        county?: string;
        country?: string;
    };
    location?: {
        latitude?: number;
        longitude?: number;
        market?: string;
        submarket?: string;
    };
    parcels?: {
        apn: string;
        landAcres?: number;
        zoning?: string;
    }[];
    siteAreaAcres?: number;
    physical: {
        buildingSF: number;
        officeSF?: number;
        clearHeightFt?: number;
        dockHighDoors?: number;
        gradeLevelDoors?: number;
        yearBuilt?: number;
        yearRenovated?: number;
        coverageRatio?: number;
        [k: string]: unknown;
    };
    notes?: string;
}
export interface RentRoll {
    asOfDate: string;
    leases: Lease[];
    vacantSuites?: VacantSuite[];
    notes?: string;
}
export interface Lease {
    leaseId: string;
    tenant: {
        name: string;
        dba?: string;
        parentCompany?: string;
        industry?: string;
        creditNotes?: string;
    };
    suite?: string;
    spaceType?: string;
    leasedSF: number;
    commencementDate: string;
    expirationDate: string;
    baseRent: {
        unit: RentUnit;
        schedule: {
            startDate: string;
            amount: number;
        }[];
    };
    escalation?: Escalation;
    reimbursement: Reimbursement;
    freeRent?: {
        startDate: string;
        endDate: string;
        percentAbated?: number;
        abatesReimbursements?: boolean;
    }[];
    tenantImprovements?: {
        amountPerSF?: number;
        totalAmount?: number;
        fundingDate?: string;
    };
    leasingCommissions?: {
        amountPerSF?: number;
        totalAmount?: number;
        percentOfTotalRent?: number;
        fundingDate?: string;
    };
    options?: {
        type: string;
        [k: string]: unknown;
    }[];
    securityDeposit?: {
        amount: number;
        form?: string;
    };
    guarantor?: string;
    notes?: string;
}
export interface Escalation {
    type: "fixed_percent" | "fixed_amount" | "cpi" | "none";
    rate?: number;
    amount?: number;
    frequencyMonths?: number;
    cpiFloorPercent?: number;
    cpiCapPercent?: number;
}
export interface Reimbursement {
    structure: ReimbursementStructure;
    proRataSharePercent?: number;
    baseYear?: number;
    baseYearExpenseAmount?: number;
    expenseStopPerSF?: number;
    adminFeePercent?: number;
    excludedExpenses?: string[];
    expenseCap?: ExpenseCap;
    notes?: string;
}
export interface ExpenseCap {
    capPercent: number;
    basis?: "non_cumulative" | "cumulative" | "cumulative_compounded";
    baseYearControllableAmount?: number;
}
export interface VacantSuite {
    suite?: string;
    sf: number;
    spaceType?: string;
    notes?: string;
}
export interface Expenses {
    items: ExpenseItem[];
    notes?: string;
}
export interface ExpenseItem {
    expenseId: string;
    name: string;
    category?: string;
    amount: number;
    amountUnit: "totalPerYear" | "perSFPerYear" | "percentOfEGR";
    recoverable: boolean;
    controllable?: boolean;
    belowTheLine?: boolean;
    growthOverridePercent?: number;
    notes?: string;
}
export interface MarketAssumptions {
    asOfDate?: string;
    growth: {
        marketRent: GrowthCurve;
        expenses: GrowthCurve;
        cpi?: GrowthCurve;
    };
    generalVacancyPercent?: number;
    creditLossPercent?: number;
    marketLeasing: Record<string, LeasingProfile>;
    notes?: string;
}
export interface LeasingProfile {
    marketRent: {
        amount: number;
        unit: "perSFPerMonth" | "perSFPerYear";
    };
    termMonths: number;
    escalation?: Escalation;
    reimbursementStructure?: ReimbursementStructure;
    downtimeMonths: number;
    renewalProbabilityPercent: number;
    newTenant?: LeasingCosts;
    renewal?: LeasingCosts;
    renewalRentPercentOfMarket?: number;
    notes?: string;
}
export interface LeasingCosts {
    tiPerSF?: number;
    lcPercentOfRent?: number;
    freeRentMonths?: number;
}
export interface Valuation {
    analysisStartDate: string;
    valueDate?: string;
    interestAppraised?: "fee_simple" | "leased_fee" | "leasehold";
    valuePremise?: string;
    purpose?: string;
    methods: ("dcf" | "direct_cap" | "sales_comparison" | "cost")[];
    purchasePrice?: number;
    acquisitionCostsPercent?: number;
    dcf?: Dcf;
    directCap?: DirectCap;
    salesComparison?: unknown;
    costApproach?: unknown;
    reconciliation?: {
        concludedValue: number;
        concludedValuePerSF?: number;
        primaryMethod?: string;
        notes?: string;
    };
    taxReassessment?: TaxReassessment;
    notes?: string;
}
export interface TaxReassessment {
    effectiveTaxRatePercent?: number;
    reassessOnAcquisition?: boolean;
    reassessAtReversion?: boolean;
    expenseId?: string;
}
export interface Dcf {
    holdPeriodYears?: number;
    holdPeriodMonths?: number;
    discountRatePercent: number;
    reversionDiscountRatePercent?: number;
    discountTiming?: "monthly" | "annual";
    periodConvention?: "end" | "mid";
    terminalValue: TerminalValue;
    notes?: string;
}
export interface TerminalValue {
    method: "direct_cap" | "exit_price_psf" | "fixed_value" | "grown_purchase_price";
    capRatePercent?: number;
    noiBasis?: "forwardYear" | "trailingYear" | "stabilizedAtMarket";
    deductBelowTheLineItems?: boolean;
    exitPricePerSF?: number;
    fixedValue?: number;
    annualAppreciationPercent?: number;
    sellingCostsPercent?: number;
    deductUnfundedObligations?: boolean;
    notes?: string;
}
export interface DirectCap {
    capRatePercent: number;
    noiBasis: "year1" | "inPlace" | "stabilizedAtMarket" | "trailing12" | "custom";
    customNOI?: number;
    applyGeneralVacancy?: boolean;
    deductBelowTheLineItems?: boolean;
    excludeExpenseIds?: string[];
    nearTermAdjustments?: {
        periodMonths: number;
        includeDowntimeLostRent?: boolean;
        includeFreeRent?: boolean;
        includeTI?: boolean;
        includeLC?: boolean;
        discountRatePercent?: number;
        notes?: string;
    };
    markToMarket?: {
        discountRatePercent: number;
        notes?: string;
    };
    adjustments?: {
        name: string;
        type: "deduction" | "addition";
        amount: number;
        category?: string;
        notes?: string;
    }[];
    notes?: string;
}
export interface Debt {
    loanAmount?: number;
    ltvPercent?: number;
    interestRatePercent: number;
    rateType?: "fixed";
    termMonths: number;
    amortizationMonths?: number;
    interestOnlyMonths?: number;
    originationFeePercent?: number;
    fundingDate?: string;
    notes?: string;
}
export interface Warning {
    code: string;
    message: string;
}
