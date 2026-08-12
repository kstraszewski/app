import {
  DEFAULT_MORTGAGE_CAPACITY_POLICY,
  validateMortgageCapacityPolicy,
  type CapacityInterestType,
  type MortgageCapacityPolicy,
} from '@openexpert/mortgage'
import { createError } from 'h3'
import type { BookingWidgetType } from '../../shared/types/booking-calculators'

type JsonRecord = Record<string, unknown>

export interface BookingConsentDecision {
  definition_id: string
  version_id: string
  granted: boolean
}

export interface PublicWidgetCatalog {
  widget: {
    key: string
    title: string
    subtitle: string | null
    theme: 'light' | 'dark' | 'auto'
    accentColor: string
    bookingMode: 'facility' | 'expert' | 'both'
    widgetType: BookingWidgetType
    fixedExpertUserId: string | null
  }
  facility: {
    id: string
    name: string
    address: string | null
    timezone: string
  }
  services: Array<{
    id: string
    name: string
    description: string | null
    durationMinutes: number
  }>
  experts: Array<{
    userId: string
    name: string
    avatarUrl?: string | null
    serviceIds?: string[]
  }>
  consents: Array<{
    definitionId: string
    versionId: string
    title: string
    content: string
    purpose: string
    channel: 'email' | 'sms' | 'phone' | 'messaging' | 'other'
    legalBasis: string
    isRequired: boolean
  }>
  capacityPolicy: MortgageCapacityPolicy
  capacityPolicyRevision: number | null
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const datePattern = /^\d{4}-\d{2}-\d{2}$/
const publicKeyPattern = /^[A-Za-z0-9._~-]{8,200}$/
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

export function bookingRecord(input: unknown): JsonRecord {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  return input as JsonRecord
}

function recordValue(input: unknown, field: string): JsonRecord {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw createError({ statusCode: 400, statusMessage: `${field} must be an object` })
  }
  return input as JsonRecord
}

function textValue(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined
  const value = input.trim()
  return value || undefined
}

function requiredField(field: string): never {
  throw createError({ statusCode: 400, statusMessage: `${field} is required` })
}

export function publicWidgetKey(input: unknown): string {
  const value = textValue(input)
  if (!value || !publicKeyPattern.test(value)) {
    throw createError({ statusCode: 404, statusMessage: 'Booking widget not found' })
  }
  return value
}

export function uuidValue(input: unknown, field: string): string {
  const value = textValue(input)
  if (!value || !uuidPattern.test(value)) {
    throw createError({ statusCode: 400, statusMessage: `${field} must be a UUID` })
  }
  return value
}

export function optionalUuidValue(input: unknown, field: string): string | null {
  if (input === null || input === undefined || input === '') return null
  return uuidValue(input, field)
}

export function idempotencyKeyValue(input: unknown): string {
  const value = textValue(input)
  if (!value || !publicKeyPattern.test(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'idempotencyKey must be an 8-200 character token',
    })
  }
  return value
}

export function bookingConsentDecisionsValue(input: unknown): BookingConsentDecision[] {
  if (!Array.isArray(input) || input.length > 100) {
    throw createError({
      statusCode: 400,
      statusMessage: 'consentDecisions must be an array with at most 100 items',
    })
  }
  const decisions = input.map((raw, index) => {
    const decision = recordValue(raw, `consentDecisions[${index}]`)
    return {
      definition_id: uuidValue(
        decision.definitionId ?? decision.definition_id,
        `consentDecisions[${index}].definitionId`,
      ),
      version_id: uuidValue(
        decision.versionId ?? decision.version_id,
        `consentDecisions[${index}].versionId`,
      ),
      granted: booleanValue(decision.granted, `consentDecisions[${index}].granted`),
    }
  })
  if (new Set(decisions.map(decision => decision.definition_id)).size !== decisions.length) {
    throw createError({ statusCode: 400, statusMessage: 'Consent decisions contain duplicates' })
  }
  return decisions
}

export function limitedText(
  input: unknown,
  field: string,
  maxLength: number,
  options: { required?: boolean, nullable?: boolean } = {},
): string | null | undefined {
  if (input === undefined) return options.required
    ? requiredField(field)
    : undefined
  if (input === null || input === '') {
    if (options.required) return requiredField(field)
    return options.nullable ? null : undefined
  }
  if (typeof input !== 'string') {
    throw createError({ statusCode: 400, statusMessage: `${field} must be text` })
  }
  const value = input.trim()
  if (!value) {
    if (options.required) return requiredField(field)
    return options.nullable ? null : undefined
  }
  if (value.length > maxLength) {
    throw createError({ statusCode: 400, statusMessage: `${field} is too long` })
  }
  return value
}

export function booleanValue(input: unknown, field: string): boolean {
  if (typeof input !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: `${field} must be boolean` })
  }
  return input
}

export function integerValue(
  input: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number {
  const value = typeof input === 'number'
    ? input
    : (typeof input === 'string' && input.trim() ? Number(input) : Number.NaN)
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} must be an integer between ${minimum} and ${maximum}`,
    })
  }
  return value
}

export function dateValue(input: unknown, field = 'date'): string {
  const value = textValue(input)
  if (!value || !datePattern.test(value)) {
    throw createError({ statusCode: 400, statusMessage: `${field} must use YYYY-MM-DD` })
  }
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw createError({ statusCode: 400, statusMessage: `${field} is not a valid date` })
  }
  return value
}

export function isoDateTimeValue(input: unknown, field: string): string {
  const value = textValue(input)
  if (!value || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} must be an ISO date-time with a timezone offset`,
    })
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf())) {
    throw createError({ statusCode: 400, statusMessage: `${field} is not a valid date-time` })
  }
  return parsed.toISOString()
}

export function emailValue(
  input: unknown,
  field: string,
  options: { required?: boolean } = {},
): string | null {
  const value = limitedText(input, field, 320, {
    required: options.required,
    nullable: !options.required,
  })
  if (value === null || value === undefined) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw createError({ statusCode: 400, statusMessage: `${field} must be a valid email` })
  }
  return value.toLowerCase()
}

function normalizeOrigin(value: string): string {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error()
    return url.origin
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'origin must be a valid HTTP(S) origin' })
  }
}

export function catalogAllowedOrigins(raw: unknown): string[] {
  const catalog = bookingRecord(raw)
  const privateConfig = bookingRecord(catalog.private ?? catalog._private)
  const widget = bookingRecord(catalog.widget)
  const value = privateConfig.allowedOrigins
    ?? privateConfig.allowed_origins
    ?? widget.allowedOrigins
    ?? widget.allowed_origins
    ?? catalog.allowedOrigins
    ?? catalog.allowed_origins
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item !== 'string') return []
    try {
      return [normalizeOrigin(item)]
    }
    catch {
      return []
    }
  })
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

function sanitizeMortgageCapacityPolicy(value: unknown): MortgageCapacityPolicy {
  const input = recordValue(value, 'settings')
  const unknownKeys = Object.keys(input).filter(key => !policyKeys.has(key as keyof MortgageCapacityPolicy))
  if (unknownKeys.length) {
    throw createError({ statusCode: 400, statusMessage: `Unsupported capacity settings: ${unknownKeys.join(', ')}` })
  }
  if (!Array.isArray(input.minimumSocialMonthly) || input.minimumSocialMonthly.length !== 5) {
    throw createError({ statusCode: 400, statusMessage: 'minimumSocialMonthly must contain five values' })
  }
  const result: MortgageCapacityPolicy = {
    policyAsOf: dateValue(input.policyAsOf, 'policyAsOf'),
    minimumSocialAsOf: dateValue(input.minimumSocialAsOf, 'minimumSocialAsOf'),
    nbpReferenceRateAsOf: dateValue(input.nbpReferenceRateAsOf, 'nbpReferenceRateAsOf'),
    dstiLimitPct: numberValue(input.dstiLimitPct, 'dstiLimitPct'),
    incomeBufferPct: numberValue(input.incomeBufferPct, 'incomeBufferPct'),
    creditLimitMonthlyChargePct: numberValue(input.creditLimitMonthlyChargePct, 'creditLimitMonthlyChargePct'),
    maxLtvPct: numberValue(input.maxLtvPct, 'maxLtvPct'),
    defaultInterestRatePct: numberValue(input.defaultInterestRatePct, 'defaultInterestRatePct'),
    defaultInterestType: String(input.defaultInterestType) as CapacityInterestType,
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
  }
  catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage: error instanceof Error ? error.message : 'Invalid capacity settings',
    })
  }
  return result
}

export function sanitizePublicCatalog(raw: unknown, widgetKey: string): PublicWidgetCatalog {
  const catalog = bookingRecord(raw)
  const widget = bookingRecord(catalog.widget)
  const facility = bookingRecord(catalog.facility)
  const themeValue = ['light', 'dark', 'auto'].includes(String(widget.theme))
    ? String(widget.theme) as 'light' | 'dark' | 'auto'
    : 'auto'
  const addressParts = [
    facility.address,
    facility.address_line1,
    facility.address_line2,
    [facility.postal_code, facility.city].filter(Boolean).join(' '),
  ]
    .filter(value => typeof value === 'string' && value.trim())
    .map(value => String(value).trim())

  const servicesRaw = Array.isArray(catalog.services) ? catalog.services : []
  const expertsRaw = Array.isArray(catalog.experts) ? catalog.experts : []
  const consentsRaw = Array.isArray(catalog.consents) ? catalog.consents : []
  const widgetTypeValue = String(widget.widgetType ?? widget.widget_type ?? 'calendar')
  const widgetType: BookingWidgetType = ['calendar', 'mortgage_capacity', 'mortgage_payment'].includes(widgetTypeValue)
    ? widgetTypeValue as BookingWidgetType
    : 'calendar'
  const fixedExpertUserIdValue = widget.fixedExpertUserId ?? widget.fixed_expert_user_id
  let capacityPolicy = structuredClone(DEFAULT_MORTGAGE_CAPACITY_POLICY)
  const capacityPolicyRaw = catalog.capacityPolicy ?? catalog.capacity_policy
  if (capacityPolicyRaw && typeof capacityPolicyRaw === 'object' && !Array.isArray(capacityPolicyRaw)) {
    try {
      capacityPolicy = sanitizeMortgageCapacityPolicy(capacityPolicyRaw)
    }
    catch (error) {
      console.error('[booking] invalid capacity policy in public widget catalog', error)
    }
  }
  const capacityPolicyRevisionValue = Number(
    catalog.capacityPolicyRevision ?? catalog.capacity_policy_revision ?? 0,
  )
  const capacityPolicyRevision = widgetType === 'mortgage_capacity'
    && Number.isSafeInteger(capacityPolicyRevisionValue)
    && capacityPolicyRevisionValue >= 0
    ? capacityPolicyRevisionValue
    : widgetType === 'mortgage_capacity' ? 0 : null

  return {
    widget: {
      key: widgetKey,
      title: String(widget.title ?? facility.name ?? ''),
      subtitle: typeof widget.subtitle === 'string' && widget.subtitle.trim()
        ? widget.subtitle.trim()
        : null,
      theme: themeValue,
      accentColor: typeof (widget.accentColor ?? widget.accent_color) === 'string'
        ? String(widget.accentColor ?? widget.accent_color)
        : '#2563eb',
      bookingMode: ['facility', 'expert', 'both'].includes(String(widget.bookingMode ?? widget.booking_mode))
        ? String(widget.bookingMode ?? widget.booking_mode) as 'facility' | 'expert' | 'both'
        : 'both',
      widgetType,
      fixedExpertUserId: fixedExpertUserIdValue ? String(fixedExpertUserIdValue) : null,
    },
    facility: {
      id: String(facility.id ?? ''),
      name: String(facility.name ?? ''),
      address: addressParts.length ? addressParts.join(', ') : null,
      timezone: String(facility.timezone ?? 'Europe/Warsaw'),
    },
    services: servicesRaw.flatMap((input) => {
      const service = bookingRecord(input)
      if (!service.id || !service.name) return []
      return [{
        id: String(service.id),
        name: String(service.name),
        description: typeof service.description === 'string' && service.description.trim()
          ? service.description.trim()
          : null,
        durationMinutes: Number(service.durationMinutes ?? service.duration_minutes ?? 0),
      }]
    }),
    experts: expertsRaw.flatMap((input) => {
      const expert = bookingRecord(input)
      const userId = expert.userId ?? expert.user_id
      if (!userId) return []
      const serviceIds = expert.serviceIds ?? expert.service_ids
      return [{
        userId: String(userId),
        name: String(expert.name ?? expert.full_name ?? ''),
        avatarUrl: typeof (expert.avatarUrl ?? expert.avatar_url) === 'string'
          ? String(expert.avatarUrl ?? expert.avatar_url)
          : null,
        ...(Array.isArray(serviceIds) ? { serviceIds: serviceIds.map(String) } : {}),
      }]
    }),
    consents: consentsRaw.flatMap((input) => {
      const consent = bookingRecord(input)
      const definitionId = consent.definitionId ?? consent.definition_id
      const versionId = consent.versionId ?? consent.version_id
      const title = consent.title ?? consent.displayTitle ?? consent.display_title
      const channel = String(consent.channel ?? '')
      if (
        !definitionId
        || !versionId
        || !title
        || !['email', 'sms', 'phone', 'messaging', 'other'].includes(channel)
      ) return []
      return [{
        definitionId: String(definitionId),
        versionId: String(versionId),
        title: String(title),
        content: String(consent.content ?? ''),
        purpose: String(consent.purpose ?? ''),
        channel: channel as 'email' | 'sms' | 'phone' | 'messaging' | 'other',
        legalBasis: String(consent.legalBasis ?? consent.legal_basis ?? ''),
        isRequired: consent.isRequired === true || consent.is_required === true,
      }]
    }),
    capacityPolicy,
    capacityPolicyRevision,
  }
}
