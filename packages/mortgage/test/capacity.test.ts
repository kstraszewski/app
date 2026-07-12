import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateMortgageCapacity,
  calculateMortgageRateBuffer,
  DEFAULT_MORTGAGE_CAPACITY_POLICY,
  minimumSocialForHousehold,
  validateMortgageCapacityPolicy,
} from '../src/capacity.ts'

const policy = structuredClone(DEFAULT_MORTGAGE_CAPACITY_POLICY)

test('uses the current KNF buffer formulas for each interest-rate type', () => {
  assert.equal(calculateMortgageRateBuffer({
    interestType: 'periodically_fixed',
    termMonths: 300,
    fixedRatePeriodMonths: 60,
  }, policy), 2.5)
  assert.equal(calculateMortgageRateBuffer({
    interestType: 'periodically_fixed',
    termMonths: 300,
    fixedRatePeriodMonths: 120,
  }, policy), 1.875)
  assert.equal(calculateMortgageRateBuffer({
    interestType: 'periodically_fixed',
    termMonths: 420,
    fixedRatePeriodMonths: 64,
  }, policy), 2.5 * 356 / 360)
  assert.equal(calculateMortgageRateBuffer({
    interestType: 'fixed_for_term',
    termMonths: 300,
    fixedRatePeriodMonths: 300,
  }, policy), 0)
  assert.equal(calculateMortgageRateBuffer({
    interestType: 'variable',
    termMonths: 300,
    fixedRatePeriodMonths: null,
  }, policy), 2.5)
})

test('only accepts the two KNF volatility-buffer states', () => {
  assert.doesNotThrow(() => validateMortgageCapacityPolicy({
    ...policy,
    variableRateVolatilityBufferPct: 1.5,
  }))
  assert.throws(
    () => validateMortgageCapacityPolicy({
      ...policy,
      variableRateVolatilityBufferPct: 0.5,
    }),
    /must be 0 or 1\.5/,
  )
})

test('rejects calendar dates that only look like ISO dates', () => {
  assert.throws(
    () => validateMortgageCapacityPolicy({
      ...policy,
      policyAsOf: '2026-02-31',
    }),
    /must use YYYY-MM-DD/,
  )
})

test('uses the IPiSS household basket and extrapolates only above five people', () => {
  assert.equal(minimumSocialForHousehold(1, policy), 1966.23)
  assert.equal(minimumSocialForHousehold(3, policy), 5177.28)
  assert.equal(minimumSocialForHousehold(6, policy), 9309.96)
})

test('assesses a contract longer than 25 years on no more than 25 years', () => {
  const input = {
    monthlyNetIncome: 18_000,
    householdSize: 2,
    declaredLivingCosts: 4_000,
    existingMonthlyLoanPayments: 0,
    otherMonthlyObligations: 0,
    creditCardAndOverdraftLimits: 0,
    ownContribution: 1_000_000,
    annualInterestRatePct: 6,
    interestType: 'periodically_fixed' as const,
    fixedRatePeriodMonths: 60,
  }
  const twentyFiveYears = calculateMortgageCapacity({ ...input, termMonths: 300 }, policy)
  const thirtyFiveYears = calculateMortgageCapacity({ ...input, termMonths: 420 }, policy)

  assert.equal(thirtyFiveYears.assessmentTermMonths, 300)
  assert.equal(thirtyFiveYears.capacityByIncome, twentyFiveYears.capacityByIncome)
  assert.equal(thirtyFiveYears.termCappedForAssessment, true)
  assert.ok(thirtyFiveYears.nominalMonthlyInstallment < twentyFiveYears.nominalMonthlyInstallment)
})

test('applies the higher of declared costs and the minimum-social basket', () => {
  const base = {
    monthlyNetIncome: 14_000,
    householdSize: 4,
    existingMonthlyLoanPayments: 0,
    otherMonthlyObligations: 0,
    creditCardAndOverdraftLimits: 0,
    ownContribution: 500_000,
    termMonths: 300,
    annualInterestRatePct: 6,
    interestType: 'periodically_fixed' as const,
    fixedRatePeriodMonths: 60,
  }
  const understated = calculateMortgageCapacity({ ...base, declaredLivingCosts: 2_000 }, policy)
  const atMinimum = calculateMortgageCapacity({ ...base, declaredLivingCosts: 6280.84 }, policy)

  assert.equal(understated.assessedLivingCosts, 6280.84)
  assert.equal(understated.capacityByIncome, atMinimum.capacityByIncome)
  assert.equal(understated.declaredCostsRaisedToMinimum, true)
})

test('takes the lower of income capacity and the LTV contribution cap', () => {
  const result = calculateMortgageCapacity({
    monthlyNetIncome: 20_000,
    householdSize: 2,
    declaredLivingCosts: 4_000,
    existingMonthlyLoanPayments: 0,
    otherMonthlyObligations: 0,
    creditCardAndOverdraftLimits: 0,
    ownContribution: 100_000,
    termMonths: 300,
    annualInterestRatePct: 6,
    interestType: 'periodically_fixed',
    fixedRatePeriodMonths: 60,
  }, policy)

  assert.equal(result.capacityByLtv, 400_000)
  assert.equal(result.maximumLoanAmount, 400_000)
  assert.equal(result.maximumPropertyValue, 500_000)
  assert.deepEqual(result.bindingConstraints, ['ltv'])
})

test('existing payments and granted limits reduce capacity', () => {
  const base = {
    monthlyNetIncome: 12_000,
    householdSize: 2,
    declaredLivingCosts: 4_000,
    otherMonthlyObligations: 0,
    ownContribution: 500_000,
    termMonths: 300,
    annualInterestRatePct: 6,
    interestType: 'periodically_fixed' as const,
    fixedRatePeriodMonths: 60,
  }
  const withoutDebt = calculateMortgageCapacity({
    ...base,
    existingMonthlyLoanPayments: 0,
    creditCardAndOverdraftLimits: 0,
  }, policy)
  const withDebt = calculateMortgageCapacity({
    ...base,
    existingMonthlyLoanPayments: 800,
    creditCardAndOverdraftLimits: 10_000,
  }, policy)

  assert.equal(withDebt.creditLimitMonthlyCharge, 500)
  assert.equal(withDebt.existingMonthlyDebtService, 1300)
  assert.ok(withDebt.capacityByIncome < withoutDebt.capacityByIncome)
})

test('returns zero loan capacity without contribution in the standard 80% LTV variant', () => {
  const result = calculateMortgageCapacity({
    monthlyNetIncome: 12_000,
    householdSize: 1,
    declaredLivingCosts: 2_500,
    existingMonthlyLoanPayments: 0,
    otherMonthlyObligations: 0,
    creditCardAndOverdraftLimits: 0,
    ownContribution: 0,
    termMonths: 300,
    annualInterestRatePct: 6,
    interestType: 'periodically_fixed',
    fixedRatePeriodMonths: 60,
  }, policy)

  assert.equal(result.maximumLoanAmount, 0)
  assert.deepEqual(result.bindingConstraints, ['ltv'])
})
