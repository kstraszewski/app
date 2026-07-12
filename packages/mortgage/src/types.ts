export type InstallmentType = 'equal' | 'decreasing'
export type OverpaymentStrategy = 'shorten_term' | 'lower_payment'

export interface MortgageCostRules {
  commissionPct?: number | null
  appraisalFee?: number | null
  pccFee?: number | null
  courtFee?: number | null
  accountMonthlyFee?: number | null
  cardMonthlyFee?: number | null
  propertyInsuranceAnnualRatePct?: number | null
  lifeInsuranceMonthlyRatePct?: number | null
  lifeInsuranceMonths?: number | null
}

export interface MortgageScenario {
  loanAmount: number
  propertyValue: number
  termMonths: number
  installmentType: InstallmentType
  fixedRatePct?: number | null
  fixedPeriodMonths?: number | null
  marginPct?: number | null
  referenceRatePct?: number | null
  referenceRateDeltaPct?: number
  monthlyOverpayment?: number
  overpaymentStrategy?: OverpaymentStrategy
  oneOffOverpayments?: Record<number, number>
  costRules?: MortgageCostRules
}

export interface MortgageScheduleRow {
  month: number
  annualRatePct: number
  openingBalance: number
  installment: number
  principal: number
  interest: number
  overpayment: number
  recurringCosts: number
  closingBalance: number
}

export interface MortgageCalculation {
  ltvPct: number
  initialCosts: number
  firstInstallment: number
  firstRecurringCosts: number
  firstTotalOutflow: number
  postFixedInstallment: number | null
  paidOffMonth: number
  totalPrincipal: number
  totalInterest: number
  totalOverpayments: number
  totalRecurringCosts: number
  totalCost: number
  totalPayment: number
  costFirstFiveYears: number
  schedule: MortgageScheduleRow[]
}
