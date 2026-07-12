export type CapacityInterestType = 'periodically_fixed' | 'variable' | 'fixed_for_term'

export type CapacityBindingConstraint = 'dsti' | 'minimum_social' | 'ltv'

export interface MortgageCapacityPolicy {
  policyAsOf: string
  minimumSocialAsOf: string
  nbpReferenceRateAsOf: string
  dstiLimitPct: number
  incomeBufferPct: number
  creditLimitMonthlyChargePct: number
  maxLtvPct: number
  defaultInterestRatePct: number
  defaultInterestType: CapacityInterestType
  defaultFixedRatePeriodMonths: number
  nbpReferenceRatePct: number
  variableRateVolatilityBufferPct: number
  minimumSocialMonthly: [number, number, number, number, number]
  minimumSocialAdditionalPerson: number
}

export interface MortgageCapacityScenario {
  monthlyNetIncome: number
  householdSize: number
  declaredLivingCosts: number
  existingMonthlyLoanPayments: number
  otherMonthlyObligations: number
  creditCardAndOverdraftLimits: number
  ownContribution: number
  termMonths: number
  annualInterestRatePct: number
  interestType: CapacityInterestType
  fixedRatePeriodMonths?: number | null
}

export interface MortgageCapacityCalculation {
  maximumLoanAmount: number
  maximumPropertyValue: number
  nominalMonthlyInstallment: number
  stressedMonthlyInstallment: number
  maximumAssessedInstallment: number
  maximumInstallmentByDsti: number
  maximumInstallmentByResidualIncome: number
  capacityByIncome: number
  capacityByLtv: number
  recognizedMonthlyIncome: number
  incomeBufferAmount: number
  minimumSocialCosts: number
  assessedLivingCosts: number
  existingMonthlyDebtService: number
  creditLimitMonthlyCharge: number
  disposableIncomeAfterStressedInstallment: number
  assessedDstiPct: number
  rateBufferPct: number
  assessmentRatePct: number
  assessmentTermMonths: number
  contractTermMonths: number
  ltvPct: number
  bindingConstraints: CapacityBindingConstraint[]
  declaredCostsRaisedToMinimum: boolean
  termCappedForAssessment: boolean
}

export const MORTGAGE_CAPACITY_REGULATORY_RULES = Object.freeze({
  asOf: '2026-07-12',
  minimumRateBufferPct: 2.5,
  variableRateAnchorPct: 5,
  periodicallyFixedMinimumMonths: 60,
  maxAssessmentTermMonths: 300,
  maxContractTermMonths: 420,
  resultRoundingStep: 1000,
})

export const DEFAULT_MORTGAGE_CAPACITY_POLICY: MortgageCapacityPolicy = {
  policyAsOf: '2026-07-12',
  minimumSocialAsOf: '2025-12-31',
  nbpReferenceRateAsOf: '2026-07-08',
  // Rekomendacja S treats 40% and 50% as warning thresholds, not statutory
  // limits. The MVP deliberately uses the more conservative threshold.
  dstiLimitPct: 40,
  // KNF requires banks to model a fall in disposable income but does not set
  // the percentage. Ten percent is an explicit OpenExpert model assumption.
  incomeBufferPct: 10,
  // The treatment of granted card and overdraft limits is a bank policy.
  creditLimitMonthlyChargePct: 5,
  // The simple MVP does not model the additional protection required above
  // 80% LTV, so its policy cannot use the conditional 90% KNF variant.
  maxLtvPct: 80,
  defaultInterestRatePct: 6,
  defaultInterestType: 'periodically_fixed',
  defaultFixedRatePeriodMonths: 60,
  nbpReferenceRatePct: 3.75,
  variableRateVolatilityBufferPct: 0,
  // IPiSS, Q4 2025. For a three-person household the more conservative
  // two-adults-plus-older-child basket is used.
  minimumSocialMonthly: [1966.23, 3304.19, 5177.28, 6280.84, 7758.30],
  minimumSocialAdditionalPerson: 1551.66,
}

const EPSILON = 0.01

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function assertFiniteInRange(value: number, field: string, min: number, max: number): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${field} must be between ${min} and ${max}`)
  }
}

function assertDate(value: string, field: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  const parsed = match ? new Date(`${value}T00:00:00Z`) : null
  if (
    !match
    || !parsed
    || Number.isNaN(parsed.getTime())
    || parsed.getUTCFullYear() !== Number(match[1])
    || parsed.getUTCMonth() + 1 !== Number(match[2])
    || parsed.getUTCDate() !== Number(match[3])
  ) {
    throw new Error(`${field} must use YYYY-MM-DD`)
  }
}

export function validateMortgageCapacityPolicy(policy: MortgageCapacityPolicy): void {
  assertDate(policy.policyAsOf, 'policyAsOf')
  assertDate(policy.minimumSocialAsOf, 'minimumSocialAsOf')
  assertDate(policy.nbpReferenceRateAsOf, 'nbpReferenceRateAsOf')
  assertFiniteInRange(policy.dstiLimitPct, 'dstiLimitPct', 1, 100)
  assertFiniteInRange(policy.incomeBufferPct, 'incomeBufferPct', 0, 50)
  assertFiniteInRange(policy.creditLimitMonthlyChargePct, 'creditLimitMonthlyChargePct', 0, 100)
  assertFiniteInRange(policy.maxLtvPct, 'maxLtvPct', 1, 80)
  assertFiniteInRange(policy.defaultInterestRatePct, 'defaultInterestRatePct', 0, 50)
  assertFiniteInRange(policy.defaultFixedRatePeriodMonths, 'defaultFixedRatePeriodMonths', 60, 420)
  if (!Number.isInteger(policy.defaultFixedRatePeriodMonths)) {
    throw new Error('defaultFixedRatePeriodMonths must be an integer')
  }
  if (!['periodically_fixed', 'variable', 'fixed_for_term'].includes(policy.defaultInterestType)) {
    throw new Error('defaultInterestType is unsupported')
  }
  assertFiniteInRange(policy.nbpReferenceRatePct, 'nbpReferenceRatePct', 0, 30)
  if (![0, 1.5].includes(policy.variableRateVolatilityBufferPct)) {
    throw new Error('variableRateVolatilityBufferPct must be 0 or 1.5')
  }
  if (!Array.isArray(policy.minimumSocialMonthly) || policy.minimumSocialMonthly.length !== 5) {
    throw new Error('minimumSocialMonthly must contain five household amounts')
  }
  policy.minimumSocialMonthly.forEach((amount, index) => {
    assertFiniteInRange(amount, `minimumSocialMonthly[${index}]`, 0, 100_000)
  })
  assertFiniteInRange(policy.minimumSocialAdditionalPerson, 'minimumSocialAdditionalPerson', 0, 100_000)
}

function validateScenario(input: MortgageCapacityScenario, policy: MortgageCapacityPolicy): void {
  assertFiniteInRange(input.monthlyNetIncome, 'monthlyNetIncome', 0, 10_000_000)
  if (!Number.isInteger(input.householdSize) || input.householdSize < 1 || input.householdSize > 20) {
    throw new Error('householdSize must be an integer between 1 and 20')
  }
  assertFiniteInRange(input.declaredLivingCosts, 'declaredLivingCosts', 0, 10_000_000)
  assertFiniteInRange(input.existingMonthlyLoanPayments, 'existingMonthlyLoanPayments', 0, 10_000_000)
  assertFiniteInRange(input.otherMonthlyObligations, 'otherMonthlyObligations', 0, 10_000_000)
  assertFiniteInRange(input.creditCardAndOverdraftLimits, 'creditCardAndOverdraftLimits', 0, 100_000_000)
  assertFiniteInRange(input.ownContribution, 'ownContribution', 0, 1_000_000_000)
  assertFiniteInRange(input.annualInterestRatePct, 'annualInterestRatePct', 0, 100)
  if (!Number.isInteger(input.termMonths) || input.termMonths < 12 || input.termMonths > MORTGAGE_CAPACITY_REGULATORY_RULES.maxContractTermMonths) {
    throw new Error('termMonths must be an integer between 12 and 420')
  }
  if (!['periodically_fixed', 'variable', 'fixed_for_term'].includes(input.interestType)) {
    throw new Error('interestType is unsupported')
  }
  if (input.interestType === 'periodically_fixed') {
    const fixedMonths = input.fixedRatePeriodMonths ?? policy.defaultFixedRatePeriodMonths
    if (!Number.isInteger(fixedMonths) || fixedMonths < MORTGAGE_CAPACITY_REGULATORY_RULES.periodicallyFixedMinimumMonths || fixedMonths > input.termMonths) {
      throw new Error('fixedRatePeriodMonths must be an integer between 60 and termMonths')
    }
  }
}

export function calculateMortgageRateBuffer(
  input: Pick<MortgageCapacityScenario, 'interestType' | 'termMonths' | 'fixedRatePeriodMonths'>,
  policy: MortgageCapacityPolicy,
): number {
  validateMortgageCapacityPolicy(policy)
  if (input.interestType === 'fixed_for_term') return 0

  if (input.interestType === 'variable') {
    return Math.max(
      MORTGAGE_CAPACITY_REGULATORY_RULES.variableRateAnchorPct - policy.nbpReferenceRatePct,
      MORTGAGE_CAPACITY_REGULATORY_RULES.minimumRateBufferPct,
    ) + policy.variableRateVolatilityBufferPct
  }

  const term = input.termMonths
  const fixedMonths = input.fixedRatePeriodMonths ?? policy.defaultFixedRatePeriodMonths
  if (fixedMonths >= term || term <= MORTGAGE_CAPACITY_REGULATORY_RULES.periodicallyFixedMinimumMonths) return 0
  const denominator = term - MORTGAGE_CAPACITY_REGULATORY_RULES.periodicallyFixedMinimumMonths
  return MORTGAGE_CAPACITY_REGULATORY_RULES.minimumRateBufferPct
    * (term - fixedMonths)
    / denominator
}

export function minimumSocialForHousehold(
  householdSize: number,
  policy: MortgageCapacityPolicy,
): number {
  validateMortgageCapacityPolicy(policy)
  if (!Number.isInteger(householdSize) || householdSize < 1 || householdSize > 20) {
    throw new Error('householdSize must be an integer between 1 and 20')
  }
  if (householdSize <= policy.minimumSocialMonthly.length) {
    return money(policy.minimumSocialMonthly[householdSize - 1] ?? 0)
  }
  return money(
    (policy.minimumSocialMonthly.at(-1) ?? 0)
    + (householdSize - policy.minimumSocialMonthly.length) * policy.minimumSocialAdditionalPerson,
  )
}

function annuityPayment(principal: number, annualRatePct: number, months: number): number {
  if (principal <= 0 || months <= 0) return 0
  const monthlyRate = annualRatePct / 100 / 12
  if (Math.abs(monthlyRate) < 1e-12) return principal / months
  return principal * monthlyRate / (1 - (1 + monthlyRate) ** -months)
}

function principalFromAnnuity(payment: number, annualRatePct: number, months: number): number {
  if (payment <= 0 || months <= 0) return 0
  const monthlyRate = annualRatePct / 100 / 12
  if (Math.abs(monthlyRate) < 1e-12) return payment * months
  return payment * (1 - (1 + monthlyRate) ** -months) / monthlyRate
}

function floorToStep(value: number, step: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.floor((value + EPSILON) / step) * step
}

export function calculateMortgageCapacity(
  input: MortgageCapacityScenario,
  policy: MortgageCapacityPolicy = DEFAULT_MORTGAGE_CAPACITY_POLICY,
): MortgageCapacityCalculation {
  validateMortgageCapacityPolicy(policy)
  validateScenario(input, policy)

  const assessmentTermMonths = Math.min(
    input.termMonths,
    MORTGAGE_CAPACITY_REGULATORY_RULES.maxAssessmentTermMonths,
  )
  const rateBufferPct = calculateMortgageRateBuffer(input, policy)
  const assessmentRatePct = input.annualInterestRatePct + rateBufferPct
  const disposableIncomeBeforeBuffer = Math.max(0, input.monthlyNetIncome - input.otherMonthlyObligations)
  const recognizedMonthlyIncome = disposableIncomeBeforeBuffer * (1 - policy.incomeBufferPct / 100)
  const incomeBufferAmount = disposableIncomeBeforeBuffer - recognizedMonthlyIncome
  const minimumSocialCosts = minimumSocialForHousehold(input.householdSize, policy)
  const assessedLivingCosts = Math.max(input.declaredLivingCosts, minimumSocialCosts)
  const creditLimitMonthlyCharge = input.creditCardAndOverdraftLimits * policy.creditLimitMonthlyChargePct / 100
  const creditMonthlyDebtService = input.existingMonthlyLoanPayments + creditLimitMonthlyCharge
  const existingMonthlyDebtService = creditMonthlyDebtService + input.otherMonthlyObligations

  const maximumInstallmentByDsti = Math.max(
    0,
    input.monthlyNetIncome * policy.dstiLimitPct / 100 - existingMonthlyDebtService,
  )
  const maximumInstallmentByResidualIncome = Math.max(
    0,
    recognizedMonthlyIncome - assessedLivingCosts - creditMonthlyDebtService,
  )
  const maximumAssessedInstallment = Math.min(
    maximumInstallmentByDsti,
    maximumInstallmentByResidualIncome,
  )
  const capacityByIncome = floorToStep(
    principalFromAnnuity(maximumAssessedInstallment, assessmentRatePct, assessmentTermMonths),
    MORTGAGE_CAPACITY_REGULATORY_RULES.resultRoundingStep,
  )
  const ltvFraction = policy.maxLtvPct / 100
  const capacityByLtv = floorToStep(
    input.ownContribution * ltvFraction / (1 - ltvFraction),
    MORTGAGE_CAPACITY_REGULATORY_RULES.resultRoundingStep,
  )
  const maximumLoanAmount = Math.min(capacityByIncome, capacityByLtv)
  const stressedMonthlyInstallment = annuityPayment(
    maximumLoanAmount,
    assessmentRatePct,
    assessmentTermMonths,
  )
  const nominalMonthlyInstallment = annuityPayment(
    maximumLoanAmount,
    input.annualInterestRatePct,
    input.termMonths,
  )
  const assessedDstiPct = input.monthlyNetIncome > 0
    ? (existingMonthlyDebtService + stressedMonthlyInstallment) / input.monthlyNetIncome * 100
    : 0
  const maximumPropertyValue = maximumLoanAmount + input.ownContribution
  const ltvPct = maximumPropertyValue > 0 ? maximumLoanAmount / maximumPropertyValue * 100 : 0
  const bindingConstraints: CapacityBindingConstraint[] = []

  if (capacityByLtv <= capacityByIncome + EPSILON) bindingConstraints.push('ltv')
  if (capacityByIncome <= capacityByLtv + EPSILON) {
    if (maximumInstallmentByDsti <= maximumInstallmentByResidualIncome + EPSILON) bindingConstraints.push('dsti')
    if (maximumInstallmentByResidualIncome <= maximumInstallmentByDsti + EPSILON) bindingConstraints.push('minimum_social')
  }

  return {
    maximumLoanAmount: money(maximumLoanAmount),
    maximumPropertyValue: money(maximumPropertyValue),
    nominalMonthlyInstallment: money(nominalMonthlyInstallment),
    stressedMonthlyInstallment: money(stressedMonthlyInstallment),
    maximumAssessedInstallment: money(maximumAssessedInstallment),
    maximumInstallmentByDsti: money(maximumInstallmentByDsti),
    maximumInstallmentByResidualIncome: money(maximumInstallmentByResidualIncome),
    capacityByIncome: money(capacityByIncome),
    capacityByLtv: money(capacityByLtv),
    recognizedMonthlyIncome: money(recognizedMonthlyIncome),
    incomeBufferAmount: money(incomeBufferAmount),
    minimumSocialCosts,
    assessedLivingCosts: money(assessedLivingCosts),
    existingMonthlyDebtService: money(existingMonthlyDebtService),
    creditLimitMonthlyCharge: money(creditLimitMonthlyCharge),
    disposableIncomeAfterStressedInstallment: money(
      recognizedMonthlyIncome - assessedLivingCosts - creditMonthlyDebtService - stressedMonthlyInstallment,
    ),
    assessedDstiPct: money(assessedDstiPct),
    rateBufferPct,
    assessmentRatePct: money(assessmentRatePct),
    assessmentTermMonths,
    contractTermMonths: input.termMonths,
    ltvPct: money(ltvPct),
    bindingConstraints,
    declaredCostsRaisedToMinimum: input.declaredLivingCosts + EPSILON < minimumSocialCosts,
    termCappedForAssessment: assessmentTermMonths < input.termMonths,
  }
}
