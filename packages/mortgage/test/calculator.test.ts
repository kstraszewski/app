import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateMortgage } from '../src/calculator.ts'

test('calculates an equal-installment loan and fully repays principal', () => {
  const result = calculateMortgage({
    loanAmount: 400_000,
    propertyValue: 500_000,
    termMonths: 300,
    installmentType: 'equal',
    fixedRatePct: 6,
    fixedPeriodMonths: 60,
    referenceRatePct: 4,
    marginPct: 2,
  })
  assert.equal(result.ltvPct, 80)
  assert.equal(result.paidOffMonth, 300)
  assert.ok(Math.abs(result.totalPrincipal - 400_000) < 0.1)
  assert.ok(result.firstInstallment > 2_500 && result.firstInstallment < 2_600)
})

test('switches the payment after the fixed-rate period', () => {
  const result = calculateMortgage({
    loanAmount: 340_000,
    propertyValue: 510_000,
    termMonths: 300,
    installmentType: 'equal',
    fixedRatePct: 5.81,
    fixedPeriodMonths: 60,
    referenceRatePct: 3.78,
    marginPct: 1.75,
  })
  // The bank example may differ by a few grosz because of its payment-date
  // convention; the engine uses a standard monthly annuity convention.
  assert.ok(Math.abs(result.firstInstallment - 2151.24) < 0.1)
  assert.ok(result.postFixedInstallment !== null)
  assert.ok(result.postFixedInstallment! < result.firstInstallment)
})

test('monthly overpayment shortens the loan and reduces interest', () => {
  const base = {
    loanAmount: 500_000,
    propertyValue: 700_000,
    termMonths: 360,
    installmentType: 'equal' as const,
    fixedRatePct: 6,
    fixedPeriodMonths: 60,
    referenceRatePct: 4,
    marginPct: 2,
  }
  const without = calculateMortgage(base)
  const withOverpayment = calculateMortgage({ ...base, monthlyOverpayment: 1_000 })
  assert.ok(withOverpayment.paidOffMonth < without.paidOffMonth)
  assert.ok(withOverpayment.totalInterest < without.totalInterest)
  assert.equal(withOverpayment.firstTotalOutflow, withOverpayment.firstInstallment + 1_000)
})

test('includes known upfront and recurring costs', () => {
  const result = calculateMortgage({
    loanAmount: 100_000,
    propertyValue: 200_000,
    termMonths: 12,
    installmentType: 'decreasing',
    referenceRatePct: 4,
    marginPct: 2,
    costRules: {
      commissionPct: 1,
      appraisalFee: 500,
      accountMonthlyFee: 10,
      cardMonthlyFee: 5,
      propertyInsuranceAnnualRatePct: 0.1,
    },
  })
  assert.equal(result.initialCosts, 1500)
  assert.ok(Math.abs(result.totalRecurringCosts - 380) < 0.1)
  assert.equal(result.schedule.at(-1)?.closingBalance, 0)
})
