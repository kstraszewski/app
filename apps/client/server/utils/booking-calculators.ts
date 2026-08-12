import {
  calculateMortgage,
  calculateMortgageCapacity,
  type InstallmentType,
  type MortgageCapacityPolicy,
} from '@openexpert/mortgage'
import type { BookingWidgetType } from '../../shared/types/booking-calculators.ts'

type JsonRecord = Record<string, unknown>

function invalid(field: string): never {
  throw new Error(`invalid_booking_calculation:${field}`)
}

function record(value: unknown, field: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field)
  return value as JsonRecord
}

function numberValue(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
  options: { integer?: boolean } = {},
): number {
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || value < minimum
    || value > maximum
    || (options.integer && !Number.isInteger(value))
  ) invalid(field)
  return value
}

function widgetPayload(value: unknown, expectedWidgetType: BookingWidgetType): JsonRecord {
  let serialized = ''
  try {
    serialized = JSON.stringify(value ?? {})
  } catch {
    invalid('payload')
  }
  if (serialized.length > 10_000) invalid('payload_too_large')

  const payload = record(value ?? {}, 'payload')
  if (payload.widgetType !== expectedWidgetType || payload.version !== 1) {
    invalid('widget_type_or_version')
  }
  return payload
}

function calculationError(error: unknown): never {
  if (error instanceof Error && error.message.startsWith('invalid_booking_calculation:')) throw error
  throw new Error(`invalid_booking_calculation:${error instanceof Error ? error.message : 'calculation_failed'}`)
}

export function bookingCalculationContextValue(
  input: unknown,
  expectedWidgetType: BookingWidgetType,
  capacityPolicy: MortgageCapacityPolicy,
  expectedCapacityPolicyRevision: number | null,
): JsonRecord {
  if (expectedWidgetType === 'calendar') {
    if (input != null) widgetPayload(input, expectedWidgetType)
    return { widgetType: 'calendar', version: 1 }
  }

  const payload = widgetPayload(input, expectedWidgetType)
  const inputs = record(payload.inputs, 'inputs')

  try {
    if (expectedWidgetType === 'mortgage_payment') {
      const propertyValue = numberValue(inputs.propertyValue, 'inputs.propertyValue', 1, 1_000_000_000)
      const loanAmount = numberValue(inputs.loanAmount, 'inputs.loanAmount', 1, 1_000_000_000)
      if (loanAmount > propertyValue) invalid('inputs.loanAmount')
      const termYears = numberValue(inputs.termYears, 'inputs.termYears', 1, 35, { integer: true })
      const annualInterestRatePct = numberValue(
        inputs.annualInterestRatePct,
        'inputs.annualInterestRatePct',
        0,
        30,
      )
      const installmentType = inputs.installmentType
      if (installmentType !== 'equal' && installmentType !== 'decreasing') {
        invalid('inputs.installmentType')
      }
      const termMonths = termYears * 12
      const result = calculateMortgage({
        propertyValue,
        loanAmount,
        termMonths,
        installmentType: installmentType as InstallmentType,
        fixedRatePct: annualInterestRatePct,
        fixedPeriodMonths: termMonths,
      })

      return {
        widgetType: expectedWidgetType,
        version: 1,
        result: {
          firstInstallment: result.firstInstallment,
          totalInterest: result.totalInterest,
          totalPayment: result.totalPayment,
          ltvPct: result.ltvPct,
        },
      }
    }

    const policyRevision = numberValue(
      payload.policyRevision,
      'policyRevision',
      0,
      Number.MAX_SAFE_INTEGER,
      { integer: true },
    )
    if (policyRevision !== (expectedCapacityPolicyRevision ?? 0)) {
      invalid('policy_revision_changed')
    }
    const monthlyNetIncome = numberValue(
      inputs.monthlyNetIncome,
      'inputs.monthlyNetIncome',
      0,
      10_000_000,
    )
    const householdSize = numberValue(inputs.householdSize, 'inputs.householdSize', 1, 20, { integer: true })
    const declaredLivingCosts = numberValue(
      inputs.declaredLivingCosts,
      'inputs.declaredLivingCosts',
      0,
      10_000_000,
    )
    const existingMonthlyLoanPayments = numberValue(
      inputs.existingMonthlyLoanPayments,
      'inputs.existingMonthlyLoanPayments',
      0,
      10_000_000,
    )
    const otherMonthlyObligations = numberValue(
      inputs.otherMonthlyObligations,
      'inputs.otherMonthlyObligations',
      0,
      10_000_000,
    )
    const creditCardAndOverdraftLimits = numberValue(
      inputs.creditCardAndOverdraftLimits,
      'inputs.creditCardAndOverdraftLimits',
      0,
      100_000_000,
    )
    const ownContribution = numberValue(inputs.ownContribution, 'inputs.ownContribution', 0, 1_000_000_000)
    const termYears = numberValue(inputs.termYears, 'inputs.termYears', 5, 35, { integer: true })
    const annualInterestRatePct = numberValue(
      inputs.annualInterestRatePct,
      'inputs.annualInterestRatePct',
      0,
      30,
    )
    const interestType = inputs.interestType
    if (!['periodically_fixed', 'variable', 'fixed_for_term'].includes(String(interestType))) {
      invalid('inputs.interestType')
    }
    const fixedRateYears = interestType === 'periodically_fixed'
      ? numberValue(inputs.fixedRateYears, 'inputs.fixedRateYears', 5, termYears, { integer: true })
      : null
    const result = calculateMortgageCapacity({
      monthlyNetIncome,
      householdSize,
      declaredLivingCosts,
      existingMonthlyLoanPayments,
      otherMonthlyObligations,
      creditCardAndOverdraftLimits,
      ownContribution,
      termMonths: termYears * 12,
      annualInterestRatePct,
      interestType: interestType as 'periodically_fixed' | 'variable' | 'fixed_for_term',
      fixedRatePeriodMonths: fixedRateYears == null ? null : fixedRateYears * 12,
    }, capacityPolicy)

    return {
      widgetType: expectedWidgetType,
      version: 1,
      policyRevision,
      policyAsOf: capacityPolicy.policyAsOf,
      result: {
        maximumLoanAmount: result.maximumLoanAmount,
        maximumPropertyValue: result.maximumPropertyValue,
        nominalMonthlyInstallment: result.nominalMonthlyInstallment,
        stressedMonthlyInstallment: result.stressedMonthlyInstallment,
        assessmentRatePct: result.assessmentRatePct,
        ltvPct: result.ltvPct,
        bindingConstraints: result.bindingConstraints,
      },
    }
  } catch (error) {
    calculationError(error)
  }
}
