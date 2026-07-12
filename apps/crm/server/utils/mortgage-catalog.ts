import { createError } from 'h3'

export const mortgageOverrideParameterKeys = [
  'effective_from',
  'effective_to',
  'calculation_date',
  'data_status',
  'completeness_score',
  'interest_type',
  'fixed_rate_pct',
  'fixed_period_months',
  'margin_pct',
  'reference_rate_code',
  'reference_rate_pct',
  'reference_rate_as_of',
  'representative_apr_pct',
  'min_amount',
  'max_amount',
  'min_term_months',
  'max_term_months',
  'max_ltv_pct',
  'is_eco',
  'cost_rules',
  'requirements',
  'representative_example',
  'assumptions',
  'unknown_fields',
] as const

type MortgageOverrideParameterKey = typeof mortgageOverrideParameterKeys[number]
type JsonRecord = Record<string, unknown>

const parameterKeySet = new Set<string>(mortgageOverrideParameterKeys)
const dateKeys = ['effective_from', 'effective_to', 'calculation_date', 'reference_rate_as_of'] as const
const nullableNumberRules: Record<string, { min: number, max: number, integer?: boolean }> = {
  fixed_rate_pct: { min: 0, max: 100 },
  fixed_period_months: { min: 1, max: 600, integer: true },
  margin_pct: { min: -20, max: 100 },
  reference_rate_pct: { min: -20, max: 100 },
  representative_apr_pct: { min: 0, max: 100 },
  min_amount: { min: 0, max: 1_000_000_000 },
  max_amount: { min: 0, max: 1_000_000_000 },
  min_term_months: { min: 1, max: 600, integer: true },
  max_term_months: { min: 1, max: 600, integer: true },
  max_ltv_pct: { min: 0, max: 200 },
}
const costRuleKeys = new Set([
  'commissionPct',
  'appraisalFee',
  'pccFee',
  'courtFee',
  'accountMonthlyFee',
  'cardMonthlyFee',
  'propertyInsuranceAnnualRatePct',
  'lifeInsuranceMonthlyRatePct',
  'lifeInsuranceMonths',
])

function recordValue(value: unknown, field: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createError({ statusCode: 400, statusMessage: `${field} must be an object` })
  }
  return value as JsonRecord
}

function finiteNumber(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) {
    throw createError({ statusCode: 400, statusMessage: `${field} must be a finite number` })
  }
  return parsed
}

function nullableText(value: unknown, field: string, maxLength = 200): string | null {
  if (value === null || value === '') return null
  if (typeof value !== 'string') {
    throw createError({ statusCode: 400, statusMessage: `${field} must be text or null` })
  }
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.length > maxLength) {
    throw createError({ statusCode: 400, statusMessage: `${field} is too long` })
  }
  return trimmed
}

function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > 100) {
    throw createError({ statusCode: 400, statusMessage: `${field} must be a list with at most 100 entries` })
  }
  return value.map((entry) => {
    if (typeof entry !== 'string' || !entry.trim() || entry.trim().length > 500) {
      throw createError({ statusCode: 400, statusMessage: `${field} contains an invalid entry` })
    }
    return entry.trim()
  })
}

function sanitizeCostRules(value: unknown): JsonRecord {
  const source = recordValue(value, 'cost_rules')
  const result: JsonRecord = {}
  for (const [key, rawValue] of Object.entries(source)) {
    if (!costRuleKeys.has(key)) {
      throw createError({ statusCode: 400, statusMessage: `Unsupported cost rule: ${key}` })
    }
    if (rawValue === null || rawValue === '') {
      result[key] = null
      continue
    }
    const parsed = finiteNumber(rawValue, `cost_rules.${key}`)
    if (parsed < 0 || parsed > 1_000_000_000 || (key === 'lifeInsuranceMonths' && !Number.isInteger(parsed))) {
      throw createError({ statusCode: 400, statusMessage: `cost_rules.${key} is outside the allowed range` })
    }
    result[key] = parsed
  }
  return result
}

export function sanitizeMortgageOverrideParameters(value: unknown): Record<MortgageOverrideParameterKey, unknown> | JsonRecord {
  const source = recordValue(value ?? {}, 'parameters')
  const unknownKeys = Object.keys(source).filter(key => !parameterKeySet.has(key))
  if (unknownKeys.length) {
    throw createError({ statusCode: 400, statusMessage: `Unsupported mortgage parameters: ${unknownKeys.join(', ')}` })
  }

  const result: JsonRecord = {}
  for (const key of dateKeys) {
    if (!(key in source)) continue
    const parsed = nullableText(source[key], key, 10)
    if (parsed !== null && !/^\d{4}-\d{2}-\d{2}$/.test(parsed)) {
      throw createError({ statusCode: 400, statusMessage: `${key} must use YYYY-MM-DD` })
    }
    result[key] = parsed
  }

  if ('data_status' in source) {
    if (!['confirmed', 'inferred', 'draft'].includes(String(source.data_status))) {
      throw createError({ statusCode: 400, statusMessage: 'Unsupported data_status' })
    }
    result.data_status = source.data_status
  }
  if ('interest_type' in source) {
    if (!['fixed_periodic', 'variable'].includes(String(source.interest_type))) {
      throw createError({ statusCode: 400, statusMessage: 'Unsupported interest_type' })
    }
    result.interest_type = source.interest_type
  }
  if ('completeness_score' in source) {
    const parsed = finiteNumber(source.completeness_score, 'completeness_score')
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
      throw createError({ statusCode: 400, statusMessage: 'completeness_score must be an integer from 0 to 100' })
    }
    result.completeness_score = parsed
  }
  if ('is_eco' in source) {
    if (typeof source.is_eco !== 'boolean') {
      throw createError({ statusCode: 400, statusMessage: 'is_eco must be boolean' })
    }
    result.is_eco = source.is_eco
  }

  for (const [key, rule] of Object.entries(nullableNumberRules)) {
    if (!(key in source)) continue
    if (source[key] === null || source[key] === '') {
      result[key] = null
      continue
    }
    const parsed = finiteNumber(source[key], key)
    if (parsed < rule.min || parsed > rule.max || (rule.integer && !Number.isInteger(parsed))) {
      throw createError({ statusCode: 400, statusMessage: `${key} is outside the allowed range` })
    }
    result[key] = parsed
  }

  if ('reference_rate_code' in source) {
    result.reference_rate_code = nullableText(source.reference_rate_code, 'reference_rate_code', 40)
  }
  if ('cost_rules' in source) result.cost_rules = sanitizeCostRules(source.cost_rules)
  if ('requirements' in source) result.requirements = stringList(source.requirements, 'requirements')
  if ('assumptions' in source) result.assumptions = stringList(source.assumptions, 'assumptions')
  if ('unknown_fields' in source) result.unknown_fields = stringList(source.unknown_fields, 'unknown_fields')
  if ('representative_example' in source) {
    const example = recordValue(source.representative_example, 'representative_example')
    if (JSON.stringify(example).length > 20_000) {
      throw createError({ statusCode: 400, statusMessage: 'representative_example is too large' })
    }
    result.representative_example = example
  }

  return result
}

export function mergeMortgageVersion(baseVersion: JsonRecord, parameters: unknown): JsonRecord {
  const safeParameters = parameters && typeof parameters === 'object' && !Array.isArray(parameters)
    ? parameters as JsonRecord
    : {}
  return { ...baseVersion, ...safeParameters }
}
