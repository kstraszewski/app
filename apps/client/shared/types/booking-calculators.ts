import type { CapacityInterestType, InstallmentType } from '@openexpert/mortgage'

export const BOOKING_CALCULATOR_SNAPSHOT_VERSION = 1 as const

export type BookingWidgetType = 'calendar' | 'mortgage_capacity' | 'mortgage_payment'

export interface BookingCalendarSnapshot {
  widgetType: 'calendar'
  version: typeof BOOKING_CALCULATOR_SNAPSHOT_VERSION
}

export interface BookingCapacityCalculatorSnapshot {
  widgetType: 'mortgage_capacity'
  version: typeof BOOKING_CALCULATOR_SNAPSHOT_VERSION
  policyRevision: number
  inputs: {
    monthlyNetIncome: number
    householdSize: number
    declaredLivingCosts: number
    existingMonthlyLoanPayments: number
    otherMonthlyObligations: number
    creditCardAndOverdraftLimits: number
    ownContribution: number
    termYears: number
    annualInterestRatePct: number
    interestType: CapacityInterestType
    fixedRateYears: number | null
  }
}

export interface BookingPaymentCalculatorSnapshot {
  widgetType: 'mortgage_payment'
  version: typeof BOOKING_CALCULATOR_SNAPSHOT_VERSION
  inputs: {
    loanAmount: number
    propertyValue: number
    termYears: number
    annualInterestRatePct: number
    installmentType: InstallmentType
  }
}

export type BookingCalculatorSnapshot
  = BookingCapacityCalculatorSnapshot
    | BookingPaymentCalculatorSnapshot

export type BookingWidgetSnapshot = BookingCalendarSnapshot | BookingCalculatorSnapshot
