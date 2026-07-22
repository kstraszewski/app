import { calculateMortgage } from './calculator.ts'
import { calculateMortgageOfferV2, validateMortgageOfferV2 } from './offer-v2.ts'
import type { InstallmentType, MortgageCalculation, OverpaymentStrategy } from './types.ts'
import type {
  MortgageCalculationIssueV2,
  MortgageCalculationV2,
  MortgageCostRuleV2,
  MortgageCostSettlementV2,
  MortgageOfferVersionV2,
  MortgageOverpaymentStrategyV2,
} from './types-v2.ts'

type JsonRecord = Record<string, any>

const MORTGAGE_OFFER_SCHEMA_V2 = 'openexpert.mortgage-offer/2.0'
const MORTGAGE_OFFER_SCHEMA_LEGACY = 'openexpert.mortgage-offer/legacy'

type MortgageCatalogVersionClassification =
  | { kind: 'legacy' }
  | { kind: 'v2', offer: MortgageOfferVersionV2 }
  | { kind: 'unsupported', issues: MortgageCalculationIssueV2[] }

export interface MortgageCatalogScenario {
  propertyValue: number
  appraisalValue?: number | null
  loanAmount: number
  years: number
  installmentType: InstallmentType
  referenceDelta: number
  monthlyOverpayment: number
  overpaymentStrategy: OverpaymentStrategy
  mortgageRegistrationMonth?: number | null
  presetId?: string
  selections?: Record<string, string>
  selectionEvents?: Array<{ month: number, featureId: string, optionId: string }>
  costSettlements?: Record<string, MortgageCostSettlementV2>
  financeCommission?: boolean
}

export interface MortgageCatalogCalculationSummary {
  engineVersion: 'openexpert-mortgage-v1' | 'openexpert-mortgage-v2.0.0'
  status: 'complete' | 'partial' | 'ineligible' | 'unsupported'
  issues: MortgageCalculationIssueV2[]
  ltvPct: number
  netLoanAmount: number
  grossLoanAmount: number
  financedCosts: number
  capitalizedCosts: number
  initialCosts: number
  initialCashRequired: number
  firstInstallment: number
  firstRecurringCosts: number
  firstTotalOutflow: number
  postFixedInstallment: number | null
  paidOffMonth: number
  totalPrincipal: number
  totalInterest: number
  totalRecurringCosts: number
  creditCosts: number
  transactionCosts: number
  conditionalCosts: number
  aprEligibleNonInterestCosts: number
  refunds: number
  totalCost: number
  totalPayment: number
  costFirstFiveYears: number
  schedule: Array<{
    month: number
    annualRatePct: number
    openingBalance: number
    installment: number
    principal: number
    interest: number
    overpayment: number
    recurringCosts: number
    refunds: number
    closingBalance: number
  }>
  raw: MortgageCalculation | MortgageCalculationV2
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function numeric(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function decimal(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return String(value)
}

function classifyVersion(version: unknown): MortgageCatalogVersionClassification {
  const source = record(version)
  const rawDefinition = source.offer_definition ?? source.variant?.pricing_config
  if (rawDefinition == null) return { kind: 'legacy' }

  const definition = record(rawDefinition)
  if (definition.schemaVersion === MORTGAGE_OFFER_SCHEMA_LEGACY) return { kind: 'legacy' }
  if (definition.schemaVersion !== MORTGAGE_OFFER_SCHEMA_V2) {
    return {
      kind: 'unsupported',
      issues: [{
        kind: 'error',
        code: 'unsupported_schema',
        path: 'schemaVersion',
        message: 'Unsupported mortgage offer schema.',
      }],
    }
  }

  try {
    const offer = definition as MortgageOfferVersionV2
    const validation = validateMortgageOfferV2(offer)
    return validation.valid
      ? { kind: 'v2', offer }
      : { kind: 'unsupported', issues: validation.issues }
  } catch {
    return {
      kind: 'unsupported',
      issues: [{
        kind: 'error',
        code: 'invalid_offer_shape',
        path: '',
        message: 'The mortgage offer structure is incomplete or malformed.',
      }],
    }
  }
}

function unsupportedSummary(issues: MortgageCalculationIssueV2[]): MortgageCatalogCalculationSummary {
  const raw: MortgageCalculationV2 = {
    status: 'unsupported',
    issues,
    netLoanAmount: '0.00',
    grossLoanAmount: '0.00',
    financedCosts: '0.00',
    ltvPct: '0.00000',
    resolvedSelections: {},
    totals: {
      repaidPrincipal: '0.00',
      interest: '0.00',
      cashCosts: '0.00',
      oneOffCashCosts: '0.00',
      recurringCashCosts: '0.00',
      capitalizedCosts: '0.00',
      creditCosts: '0.00',
      transactionCosts: '0.00',
      conditionalCosts: '0.00',
      aprEligibleNonInterestCosts: '0.00',
      initialCashRequired: '0.00',
      refunds: '0.00',
      borrowerTotalOutflow: '0.00',
      borrowingCostOverNetAmount: '0.00',
      costFirstFiveYears: '0.00',
    },
    componentTotals: {},
    schedule: [],
    cashFlows: [],
    resolutionTrace: [],
  }

  return {
    engineVersion: 'openexpert-mortgage-v2.0.0',
    status: 'unsupported',
    issues,
    ltvPct: 0,
    netLoanAmount: 0,
    grossLoanAmount: 0,
    financedCosts: 0,
    capitalizedCosts: 0,
    initialCosts: 0,
    initialCashRequired: 0,
    firstInstallment: 0,
    firstRecurringCosts: 0,
    firstTotalOutflow: 0,
    postFixedInstallment: null,
    paidOffMonth: 0,
    totalPrincipal: 0,
    totalInterest: 0,
    totalRecurringCosts: 0,
    creditCosts: 0,
    transactionCosts: 0,
    conditionalCosts: 0,
    aprEligibleNonInterestCosts: 0,
    refunds: 0,
    totalCost: 0,
    totalPayment: 0,
    costFirstFiveYears: 0,
    schedule: [],
    raw,
  }
}

function referenceShocks(
  offer: MortgageOfferVersionV2,
  deltaPctPoints: number,
): Record<string, string> {
  return Object.fromEntries(offer.ratePlan.phases.flatMap((phase) => (
    phase.formula.kind === 'index_plus_margin'
      ? [[phase.formula.indexCode, decimal(deltaPctPoints)] as const]
      : []
  )))
}

function resolvedSettlements(
  offer: MortgageOfferVersionV2,
  scenario: MortgageCatalogScenario,
): Record<string, MortgageCostSettlementV2> {
  const result = { ...(scenario.costSettlements ?? {}) }
  if (scenario.financeCommission === undefined) return result
  for (const cost of offer.costs) {
    if (cost.category !== 'commission') continue
    result[cost.id] = preferredCommissionSettlement(cost, scenario.financeCommission)
  }
  return result
}

function preferredCommissionSettlement(
  cost: MortgageCostRuleV2,
  financeCommission: boolean,
): MortgageCostSettlementV2 {
  const preferences: MortgageCostSettlementV2[] = financeCommission
    ? ['capitalized', 'withheld_from_disbursement']
    : ['cash']
  return preferences.find(settlement => cost.settlement.allowed.includes(settlement))
    ?? cost.settlement.default
}

function v2Summary(
  offer: MortgageOfferVersionV2,
  scenario: MortgageCatalogScenario,
  deltaPctPoints: number,
): MortgageCatalogCalculationSummary {
  const termMonths = Math.round(scenario.years * 12)
  const calculation = calculateMortgageOfferV2(offer, {
    property: {
      purchasePrice: decimal(scenario.propertyValue),
      ...(scenario.appraisalValue == null
        ? {}
        : { appraisalValue: decimal(scenario.appraisalValue) }),
    },
    financing: {
      amount: decimal(scenario.loanAmount),
      amountMode: 'target_net_proceeds',
      termMonths,
      installmentType: scenario.installmentType,
    },
    ...(scenario.presetId ? { presetId: scenario.presetId } : {}),
    selections: scenario.selections ?? {},
    selectionEvents: scenario.selectionEvents ?? [],
    costSettlements: resolvedSettlements(offer, scenario),
    disbursements: [],
    grace: { mode: 'none' },
    events: scenario.mortgageRegistrationMonth == null
      ? {}
      : { mortgageRegistered: { month: Math.round(scenario.mortgageRegistrationMonth), edge: 'start' } },
    referenceRateShocksPctPoints: referenceShocks(offer, deltaPctPoints),
    monthlyOverpayment: decimal(Math.max(0, scenario.monthlyOverpayment)),
    overpaymentStrategy: scenario.overpaymentStrategy as MortgageOverpaymentStrategyV2,
  })
  const first = calculation.schedule.find(row => row.month === 1) ?? calculation.schedule[0]
  const fixedEnd = offer.ratePlan.phases
    .filter(phase => phase.formula.kind === 'fixed' && phase.period.endExclusive?.kind === 'month')
    .map(phase => phase.period.endExclusive!.kind === 'month' ? phase.period.endExclusive!.month : 0)
    .sort((a, b) => a - b)[0]
  const postFixed = fixedEnd == null
    ? null
    : calculation.schedule.find(row => row.month >= fixedEnd)
  const totalPayment = numeric(calculation.totals.borrowerTotalOutflow)
  const netLoan = numeric(calculation.netLoanAmount)

  return {
    engineVersion: 'openexpert-mortgage-v2.0.0',
    status: calculation.status,
    issues: calculation.issues,
    ltvPct: numeric(calculation.ltvPct),
    netLoanAmount: netLoan,
    grossLoanAmount: numeric(calculation.grossLoanAmount),
    financedCosts: numeric(calculation.financedCosts),
    capitalizedCosts: numeric(calculation.totals.capitalizedCosts),
    initialCosts: numeric(calculation.totals.initialCashRequired) + numeric(calculation.financedCosts),
    initialCashRequired: numeric(calculation.totals.initialCashRequired),
    firstInstallment: numeric(first?.scheduledPayment),
    firstRecurringCosts: numeric(first?.cashCosts),
    firstTotalOutflow: numeric(first?.borrowerCashOutflow),
    postFixedInstallment: postFixed ? numeric(postFixed.scheduledPayment) : null,
    paidOffMonth: calculation.schedule.find(row => row.month > 0 && numeric(row.openingBalance) > 0 && numeric(row.closingBalance) === 0)?.month
      ?? calculation.schedule.at(-1)?.month
      ?? 0,
    totalPrincipal: numeric(calculation.totals.repaidPrincipal),
    totalInterest: numeric(calculation.totals.interest),
    totalRecurringCosts: numeric(calculation.totals.recurringCashCosts),
    creditCosts: numeric(calculation.totals.creditCosts),
    transactionCosts: numeric(calculation.totals.transactionCosts),
    conditionalCosts: numeric(calculation.totals.conditionalCosts),
    aprEligibleNonInterestCosts: numeric(calculation.totals.aprEligibleNonInterestCosts),
    refunds: numeric(calculation.totals.refunds),
    totalCost: numeric(calculation.totals.borrowingCostOverNetAmount),
    totalPayment,
    costFirstFiveYears: numeric(calculation.totals.costFirstFiveYears),
    schedule: calculation.schedule.filter(row => row.month > 0).map(row => ({
      month: row.month,
      annualRatePct: numeric(row.annualRatePct),
      openingBalance: numeric(row.openingBalance),
      installment: numeric(row.scheduledPayment),
      principal: numeric(row.scheduledPrincipal),
      interest: numeric(row.interest),
      overpayment: numeric(row.overpayment),
      recurringCosts: numeric(row.cashCosts),
      refunds: numeric(row.cashRefunds) + numeric(row.principalCredits),
      closingBalance: numeric(row.closingBalance),
    })),
    raw: calculation,
  }
}

function legacySummary(version: JsonRecord, scenario: MortgageCatalogScenario): MortgageCatalogCalculationSummary {
  const nullable = (value: unknown) => value == null ? null : Number(value)
  const calculation = calculateMortgage({
    loanAmount: scenario.loanAmount,
    propertyValue: scenario.propertyValue,
    termMonths: Math.round(scenario.years * 12),
    installmentType: scenario.installmentType,
    fixedRatePct: nullable(version.fixed_rate_pct),
    fixedPeriodMonths: nullable(version.fixed_period_months),
    marginPct: nullable(version.margin_pct),
    referenceRatePct: nullable(version.reference_rate_pct),
    referenceRateDeltaPct: scenario.referenceDelta,
    monthlyOverpayment: scenario.monthlyOverpayment,
    overpaymentStrategy: scenario.overpaymentStrategy,
    costRules: record(version.cost_rules),
  })
  return {
    engineVersion: 'openexpert-mortgage-v1',
    status: Array.isArray(version.unknown_fields) && version.unknown_fields.length ? 'partial' : 'complete',
    issues: [],
    ltvPct: calculation.ltvPct,
    netLoanAmount: scenario.loanAmount,
    grossLoanAmount: scenario.loanAmount,
    financedCosts: 0,
    capitalizedCosts: 0,
    initialCosts: calculation.initialCosts,
    initialCashRequired: calculation.initialCosts,
    firstInstallment: calculation.firstInstallment,
    firstRecurringCosts: calculation.firstRecurringCosts,
    firstTotalOutflow: calculation.firstTotalOutflow,
    postFixedInstallment: calculation.postFixedInstallment,
    paidOffMonth: calculation.paidOffMonth,
    totalPrincipal: calculation.totalPrincipal,
    totalInterest: calculation.totalInterest,
    totalRecurringCosts: calculation.totalRecurringCosts,
    creditCosts: calculation.totalCost,
    transactionCosts: 0,
    conditionalCosts: 0,
    aprEligibleNonInterestCosts: calculation.totalCost,
    refunds: 0,
    totalCost: calculation.totalCost,
    totalPayment: calculation.totalPayment,
    costFirstFiveYears: calculation.costFirstFiveYears,
    schedule: calculation.schedule.map(row => ({ ...row, refunds: 0 })),
    raw: calculation,
  }
}

export function calculateMortgageCatalogVersion(
  version: unknown,
  scenario: MortgageCatalogScenario,
  additionalReferenceShockPctPoints = 0,
): MortgageCatalogCalculationSummary {
  const normalizedScenario = {
    ...scenario,
    referenceDelta: scenario.referenceDelta + additionalReferenceShockPctPoints,
  }
  const classification = classifyVersion(version)
  if (classification.kind === 'legacy') return legacySummary(record(version), normalizedScenario)
  if (classification.kind === 'unsupported') return unsupportedSummary(classification.issues)
  try {
    return v2Summary(classification.offer, normalizedScenario, normalizedScenario.referenceDelta)
  } catch {
    return unsupportedSummary([{
      kind: 'error',
      code: 'invalid_offer_shape',
      path: '',
      message: 'The mortgage offer structure is incomplete or malformed.',
    }])
  }
}

export function isMortgageOfferV2(version: unknown): boolean {
  return classifyVersion(version).kind === 'v2'
}
