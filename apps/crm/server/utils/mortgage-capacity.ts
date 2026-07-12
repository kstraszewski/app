import {
  DEFAULT_MORTGAGE_CAPACITY_POLICY,
  validateMortgageCapacityPolicy,
  type CapacityInterestType,
  type MortgageCapacityPolicy,
} from '@openexpert/mortgage'
import { createError } from 'h3'

type JsonRecord = Record<string, unknown>

const policyKeys = new Set<keyof MortgageCapacityPolicy>([
  'policyAsOf',
  'minimumSocialAsOf',
  'nbpReferenceRateAsOf',
  'dstiLimitPct',
  'incomeBufferPct',
  'creditLimitMonthlyChargePct',
  'maxLtvPct',
  'defaultInterestRatePct',
  'defaultInterestType',
  'defaultFixedRatePeriodMonths',
  'nbpReferenceRatePct',
  'variableRateVolatilityBufferPct',
  'minimumSocialMonthly',
  'minimumSocialAdditionalPerson',
])

function recordValue(value: unknown, field: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createError({ statusCode: 400, statusMessage: `${field} must be an object` })
  }
  return value as JsonRecord
}

function numberValue(value: unknown, field: string): number {
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw createError({ statusCode: 400, statusMessage: `${field} must be a finite number` })
  }
  if (typeof value === 'string' && value.trim() === '') {
    throw createError({ statusCode: 400, statusMessage: `${field} must be a finite number` })
  }
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) {
    throw createError({ statusCode: 400, statusMessage: `${field} must be a finite number` })
  }
  return parsed
}

function dateValue(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw createError({ statusCode: 400, statusMessage: `${field} must use YYYY-MM-DD` })
  }
  return value
}

export function sanitizeMortgageCapacityPolicy(value: unknown): MortgageCapacityPolicy {
  const input = recordValue(value, 'settings')
  const unknownKeys = Object.keys(input).filter(key => !policyKeys.has(key as keyof MortgageCapacityPolicy))
  if (unknownKeys.length) {
    throw createError({ statusCode: 400, statusMessage: `Unsupported capacity settings: ${unknownKeys.join(', ')}` })
  }

  if (!Array.isArray(input.minimumSocialMonthly) || input.minimumSocialMonthly.length !== 5) {
    throw createError({ statusCode: 400, statusMessage: 'minimumSocialMonthly must contain five values' })
  }
  const defaultInterestType = String(input.defaultInterestType) as CapacityInterestType
  const result: MortgageCapacityPolicy = {
    policyAsOf: dateValue(input.policyAsOf, 'policyAsOf'),
    minimumSocialAsOf: dateValue(input.minimumSocialAsOf, 'minimumSocialAsOf'),
    nbpReferenceRateAsOf: dateValue(input.nbpReferenceRateAsOf, 'nbpReferenceRateAsOf'),
    dstiLimitPct: numberValue(input.dstiLimitPct, 'dstiLimitPct'),
    incomeBufferPct: numberValue(input.incomeBufferPct, 'incomeBufferPct'),
    creditLimitMonthlyChargePct: numberValue(input.creditLimitMonthlyChargePct, 'creditLimitMonthlyChargePct'),
    maxLtvPct: numberValue(input.maxLtvPct, 'maxLtvPct'),
    defaultInterestRatePct: numberValue(input.defaultInterestRatePct, 'defaultInterestRatePct'),
    defaultInterestType,
    defaultFixedRatePeriodMonths: numberValue(input.defaultFixedRatePeriodMonths, 'defaultFixedRatePeriodMonths'),
    nbpReferenceRatePct: numberValue(input.nbpReferenceRatePct, 'nbpReferenceRatePct'),
    variableRateVolatilityBufferPct: numberValue(input.variableRateVolatilityBufferPct, 'variableRateVolatilityBufferPct'),
    minimumSocialMonthly: input.minimumSocialMonthly.map((amount, index) => (
      numberValue(amount, `minimumSocialMonthly[${index}]`)
    )) as MortgageCapacityPolicy['minimumSocialMonthly'],
    minimumSocialAdditionalPerson: numberValue(input.minimumSocialAdditionalPerson, 'minimumSocialAdditionalPerson'),
  }

  try {
    validateMortgageCapacityPolicy(result)
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage: error instanceof Error ? error.message : 'Invalid capacity settings',
    })
  }
  return result
}

export function mortgageCapacityPolicyFromRow(row: JsonRecord): MortgageCapacityPolicy {
  return sanitizeMortgageCapacityPolicy({
    policyAsOf: row.policy_as_of,
    minimumSocialAsOf: row.minimum_social_as_of,
    nbpReferenceRateAsOf: row.nbp_reference_rate_as_of,
    dstiLimitPct: row.dsti_limit_pct,
    incomeBufferPct: row.income_buffer_pct,
    creditLimitMonthlyChargePct: row.credit_limit_monthly_charge_pct,
    maxLtvPct: row.max_ltv_pct,
    defaultInterestRatePct: row.default_interest_rate_pct,
    defaultInterestType: row.default_interest_type,
    defaultFixedRatePeriodMonths: row.default_fixed_rate_period_months,
    nbpReferenceRatePct: row.nbp_reference_rate_pct,
    variableRateVolatilityBufferPct: row.variable_rate_volatility_buffer_pct,
    minimumSocialMonthly: [
      row.minimum_social_1_person,
      row.minimum_social_2_people,
      row.minimum_social_3_people,
      row.minimum_social_4_people,
      row.minimum_social_5_people,
    ],
    minimumSocialAdditionalPerson: row.minimum_social_additional_person,
  })
}

export function mortgageCapacityPolicyToRow(policy: MortgageCapacityPolicy): JsonRecord {
  return {
    policy_as_of: policy.policyAsOf,
    minimum_social_as_of: policy.minimumSocialAsOf,
    nbp_reference_rate_as_of: policy.nbpReferenceRateAsOf,
    dsti_limit_pct: policy.dstiLimitPct,
    income_buffer_pct: policy.incomeBufferPct,
    credit_limit_monthly_charge_pct: policy.creditLimitMonthlyChargePct,
    max_ltv_pct: policy.maxLtvPct,
    default_interest_rate_pct: policy.defaultInterestRatePct,
    default_interest_type: policy.defaultInterestType,
    default_fixed_rate_period_months: policy.defaultFixedRatePeriodMonths,
    nbp_reference_rate_pct: policy.nbpReferenceRatePct,
    variable_rate_volatility_buffer_pct: policy.variableRateVolatilityBufferPct,
    minimum_social_1_person: policy.minimumSocialMonthly[0],
    minimum_social_2_people: policy.minimumSocialMonthly[1],
    minimum_social_3_people: policy.minimumSocialMonthly[2],
    minimum_social_4_people: policy.minimumSocialMonthly[3],
    minimum_social_5_people: policy.minimumSocialMonthly[4],
    minimum_social_additional_person: policy.minimumSocialAdditionalPerson,
  }
}

export function defaultMortgageCapacityPolicy(): MortgageCapacityPolicy {
  return structuredClone(DEFAULT_MORTGAGE_CAPACITY_POLICY)
}

export function capacityNotes(value: unknown): string | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'notes must be text or null' })
  }
  const notes = value.trim()
  if (notes.length > 4000) {
    throw createError({ statusCode: 400, statusMessage: 'notes are too long' })
  }
  return notes || null
}

export function capacityExpectedRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw createError({ statusCode: 400, statusMessage: 'expectedRevision must be a non-negative integer' })
  }
  return value
}
