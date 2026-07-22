export type DecimalString = string
export type MortgageCurrencyV2 = 'PLN'
export type MortgageInstallmentTypeV2 = 'equal' | 'decreasing'
export type MortgageOverpaymentStrategyV2 = 'shorten_term' | 'lower_payment'

export type MortgageTimelineEventV2 =
  | 'first_disbursement'
  | 'last_disbursement'
  | 'mortgage_registered'

export type TimelineAnchorV2 =
  | { kind: 'month', month: number, edge: 'start' | 'end' }
  | {
      kind: 'event'
      event: MortgageTimelineEventV2
      offsetMonths?: number
      edge: 'start' | 'end'
    }

export interface ActivePeriodV2 {
  from: TimelineAnchorV2
  endExclusive?: TimelineAnchorV2
}

export interface MortgageEvidenceReferenceV2 {
  sourceId: string
  locator?: string
  note?: string
}

export type MortgageConditionFieldV2 =
  | 'net_loan_amount'
  | 'gross_loan_amount'
  | 'term_months'
  | 'ltv_pct'
  | 'property_value'

export type MortgageConditionV2 =
  | { op: 'selection_is', featureId: string, optionId: string }
  | {
      op: 'compare'
      field: MortgageConditionFieldV2
      comparator: 'lt' | 'lte' | 'eq' | 'gte' | 'gt'
      value: DecimalString
    }
  | { op: 'all' | 'any', conditions: MortgageConditionV2[] }
  | { op: 'not', condition: MortgageConditionV2 }

export interface FixedRateFormulaV2 {
  kind: 'fixed'
  ratePct: DecimalString
}

export interface IndexedRateFormulaV2 {
  kind: 'index_plus_margin'
  indexCode: string
  indexValuePct: DecimalString
  indexAsOf: string
  marginPct: DecimalString
  resetEveryMonths: number | null
  indexFloorPct?: DecimalString
  nominalFloorPct?: DecimalString
  nominalCapPct?: DecimalString
}

export interface RatePhaseV2 {
  id: string
  period: ActivePeriodV2
  formula: FixedRateFormulaV2 | IndexedRateFormulaV2
  evidenceRefs?: MortgageEvidenceReferenceV2[]
}

export interface RateModifierV2 {
  id: string
  sourceFeatureId?: string
  sourceOptionId?: string
  target: 'fixed_rate' | 'margin' | 'nominal_rate'
  operation: 'add_percentage_points' | 'set_percent'
  value: DecimalString
  period?: ActivePeriodV2
  when?: MortgageConditionV2
  evidenceRefs?: MortgageEvidenceReferenceV2[]
}

export interface MortgageFeatureOptionV2 {
  id: string
  label: string
  description?: string
  obligations?: string[]
  monitoringEveryMonths?: number
  breachOptionId?: string
  evidenceRefs?: MortgageEvidenceReferenceV2[]
}

export interface MortgageFeatureV2 {
  id: string
  label: string
  required: boolean
  defaultOptionId?: string
  options: MortgageFeatureOptionV2[]
  evidenceRefs?: MortgageEvidenceReferenceV2[]
}

export interface MortgagePricingPresetV2 {
  id: string
  label: string
  selections: Record<string, string>
  isDefault: boolean
}

export type MortgageCostBasisV2 =
  | 'net_loan_amount'
  | 'gross_loan_amount'
  | 'facility_limit'
  | 'property_value'
  | 'original_gross_principal'
  | 'opening_balance_after_draw'
  | 'closing_balance'
  | 'current_disbursement'

export type MortgageCostFormulaV2 =
  | { kind: 'fixed', amount: DecimalString }
  | {
      kind: 'percentage'
      ratePct: DecimalString
      basis: MortgageCostBasisV2
      ratePeriod: 'per_occurrence' | 'annualized'
      minimum?: DecimalString
      maximum?: DecimalString
    }
  | { kind: 'sum', terms: MortgageCostFormulaV2[] }

export type MortgageCostSettlementV2 =
  | 'cash'
  | 'capitalized'
  | 'withheld_from_disbursement'

export interface MortgageCostRuleV2 {
  id: string
  label: string
  state: 'known' | 'not_applicable' | 'unknown'
  classification: 'credit_cost' | 'transaction_cost' | 'conditional_cost' | 'informational'
  category:
    | 'commission'
    | 'appraisal'
    | 'court'
    | 'tax'
    | 'account'
    | 'card'
    | 'life_insurance'
    | 'property_insurance'
    | 'bridge_insurance'
    | 'other'
  formula?: MortgageCostFormulaV2
  timing:
    | { kind: 'once', at: TimelineAnchorV2 }
    | { kind: 'recurring', period: ActivePeriodV2, everyMonths: number }
    | { kind: 'per_disbursement', period?: ActivePeriodV2 }
  when?: MortgageConditionV2
  settlement: {
    allowed: MortgageCostSettlementV2[]
    default: MortgageCostSettlementV2
  }
  includedInApr: boolean
  evidenceRefs?: MortgageEvidenceReferenceV2[]
}

export interface MortgageBridgeInsuranceV2 {
  id: string
  mechanism: {
    kind: 'rate_uplift'
    upliftPctPoints: DecimalString
    period: ActivePeriodV2
    interestTag: 'bridge_uplift_interest'
  }
  refund:
    | { kind: 'none' }
    | {
        kind: 'tagged_amount'
        tag: 'bridge_uplift_interest'
        percentage: DecimalString
        at: TimelineAnchorV2
        settlement: 'cash_credit' | 'principal_credit'
      }
  evidenceRefs?: MortgageEvidenceReferenceV2[]
}

export interface MortgageOfferVersionV2 {
  schemaVersion: 'openexpert.mortgage-offer/2.0'
  currency: MortgageCurrencyV2
  validity: {
    effectiveFrom: string
    effectiveTo: string | null
    pricingAsOf: string
  }
  calculationPolicy: {
    accrual: 'nominal_monthly_12' | 'actual_365_fixed'
    eventOrder: 'openexpert_v2'
    rounding: {
      currencyScale: 2
      interest: 'half_up_each_period'
      charges: 'half_up_each_charge'
      balance: 'rounded' | 'high_precision'
    }
  }
  eligibility: {
    minAmount: DecimalString
    maxAmount: DecimalString | null
    amountBasis: 'net_loan' | 'gross_loan' | 'facility_limit'
    minTermMonths: number
    maxTermMonths: number
    allowedInstallmentTypes: MortgageInstallmentTypeV2[]
    maxLtvPct: DecimalString
    ltvDebtBasis: 'net_loan' | 'gross_loan' | 'facility_limit'
    collateralValueBasis:
      | 'purchase_price'
      | 'appraisal_value'
      | 'lower_of_purchase_and_appraisal'
    evidenceRefs?: MortgageEvidenceReferenceV2[]
  }
  ratePlan: {
    phases: RatePhaseV2[]
    modifiers: RateModifierV2[]
  }
  features: MortgageFeatureV2[]
  presets: MortgagePricingPresetV2[]
  costs: MortgageCostRuleV2[]
  bridgeInsurance?: MortgageBridgeInsuranceV2
  disbursementPolicy: {
    maxTranches: number
    supportedGraceModes: MortgageGraceModeV2[]
    paymentRecalculationTriggers: Array<
      'rate_change' | 'disbursement' | 'grace_end' | 'lower_payment_overpayment'
    >
    evidenceRefs?: MortgageEvidenceReferenceV2[]
  }
}

export type MortgageGraceModeV2 = 'none' | 'interest_only' | 'capitalize_interest'

export interface MortgageScenarioV2 {
  property: {
    purchasePrice: DecimalString
    appraisalValue?: DecimalString
  }
  financing: {
    amount: DecimalString
    amountMode: 'target_net_proceeds' | 'gross_facility'
    termMonths: number
    installmentType: MortgageInstallmentTypeV2
  }
  presetId?: string
  selections: Record<string, string>
  selectionEvents?: Array<{
    month: number
    featureId: string
    optionId: string
  }>
  costSettlements: Record<string, MortgageCostSettlementV2>
  disbursements: Array<{
    id: string
    month: number
    netAmount: DecimalString
  }>
  grace: {
    mode: MortgageGraceModeV2
    period?: ActivePeriodV2
  }
  events: {
    mortgageRegistered?: { month: number, edge: 'start' }
  }
  referenceRateShocksPctPoints?: Record<string, DecimalString>
  monthlyOverpayment?: DecimalString
  oneOffOverpayments?: Record<number, DecimalString>
  overpaymentStrategy?: MortgageOverpaymentStrategyV2
}

export type MortgageCalculationIssueKindV2 =
  | 'error'
  | 'incomplete'
  | 'ineligible'
  | 'warning'

export interface MortgageCalculationIssueV2 {
  kind: MortgageCalculationIssueKindV2
  code: string
  path: string
  message: string
}

export type MortgageCalculationStatusV2 =
  | 'complete'
  | 'partial'
  | 'ineligible'
  | 'unsupported'

export interface MortgageResolutionTraceEntryV2 {
  month?: number
  sourceId: string
  kind: 'selection' | 'rate' | 'cost' | 'eligibility' | 'refund' | 'assumption'
  message: string
  value?: DecimalString
}

export interface MortgageScheduleRowV2 {
  month: number
  annualRatePct: DecimalString
  openingBalance: DecimalString
  netDisbursements: DecimalString
  capitalizedCosts: DecimalString
  capitalizedInterest: DecimalString
  scheduledPayment: DecimalString
  scheduledPrincipal: DecimalString
  interest: DecimalString
  bridgeTaggedInterest: DecimalString
  overpayment: DecimalString
  cashCosts: DecimalString
  cashRefunds: DecimalString
  principalCredits: DecimalString
  borrowerCashOutflow: DecimalString
  closingBalance: DecimalString
  costBreakdown: Record<string, DecimalString>
}

export interface MortgageCashFlowV2 {
  month: number
  sourceId: string
  category:
    | 'net_disbursement'
    | 'principal'
    | 'interest'
    | 'cost'
    | 'overpayment'
    | 'refund'
  direction: 'borrower_inflow' | 'borrower_outflow' | 'balance_adjustment'
  amount: DecimalString
}

export interface MortgageCalculationV2 {
  status: MortgageCalculationStatusV2
  issues: MortgageCalculationIssueV2[]
  netLoanAmount: DecimalString
  grossLoanAmount: DecimalString
  financedCosts: DecimalString
  ltvPct: DecimalString
  resolvedSelections: Record<string, string>
  totals: {
    repaidPrincipal: DecimalString
    interest: DecimalString
    cashCosts: DecimalString
    oneOffCashCosts: DecimalString
    recurringCashCosts: DecimalString
    capitalizedCosts: DecimalString
    creditCosts: DecimalString
    transactionCosts: DecimalString
    conditionalCosts: DecimalString
    aprEligibleNonInterestCosts: DecimalString
    initialCashRequired: DecimalString
    refunds: DecimalString
    borrowerTotalOutflow: DecimalString
    borrowingCostOverNetAmount: DecimalString
    costFirstFiveYears: DecimalString
  }
  componentTotals: Record<string, DecimalString>
  schedule: MortgageScheduleRowV2[]
  cashFlows: MortgageCashFlowV2[]
  resolutionTrace: MortgageResolutionTraceEntryV2[]
}

/**
 * Internal normalized plan. It intentionally uses numbers: V2 has no runtime
 * decimal dependency yet. Public inputs/outputs remain decimal strings and all
 * charged money is rounded half-up at each period. This limits exact parity
 * with banks that use higher-precision balances or other day-count conventions.
 */
export interface CompiledMortgagePlanV2 {
  offer: MortgageOfferVersionV2
  scenario: MortgageScenarioV2
  status: MortgageCalculationStatusV2
  issues: MortgageCalculationIssueV2[]
  trace: MortgageResolutionTraceEntryV2[]
  selections: Record<string, string>
  netLoanAmount: number
  grossLoanAmount: number
  initialFinancedCosts: number
  propertyValue: number
  ltvPct: number
  disbursements: Array<{ id: string, month: number, netAmount: number }>
  costSettlements: Record<string, MortgageCostSettlementV2>
}

export interface MortgageOfferValidationV2 {
  valid: boolean
  issues: MortgageCalculationIssueV2[]
}

export interface MortgageOfferCompileResultV2 {
  status: MortgageCalculationStatusV2
  issues: MortgageCalculationIssueV2[]
  plan: CompiledMortgagePlanV2 | null
}
