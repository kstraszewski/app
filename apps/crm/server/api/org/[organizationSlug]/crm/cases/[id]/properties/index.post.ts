import { createError, readBody } from 'h3'
import { propertyPublicSelect, selectCasePropertyIfNone } from '~~/server/utils/case-properties'
import { caseUuidPattern } from '~~/server/utils/case-identifiers'
import {
  asRecord,
  getRequiredParam,
  numberValue,
  recordCrmActivity,
  requireCrmSession,
  throwDbError,
} from '~~/server/utils/crm'

const editableFields = new Set([
  'address',
  'city',
  'postal_code',
  'property_type',
  'market_type',
  'price_amount',
  'appraisal_value_amount',
  'currency',
  'area_m2',
  'rooms',
])
const marketTypes = new Set(['primary', 'secondary', 'rental', 'other'])
function requiredText(input: unknown, field: string, maxLength: number): string {
  if (typeof input !== 'string' || !input.trim()) {
    throw createError({ statusCode: 400, statusMessage: `${field} is required` })
  }
  const value = input.trim()
  if (value.length > maxLength) {
    throw createError({ statusCode: 400, statusMessage: `${field} is too long` })
  }
  return value
}

function nullableText(input: unknown, field: string, maxLength: number): string | null {
  if (input === null || input === '') return null
  if (typeof input !== 'string') {
    throw createError({ statusCode: 400, statusMessage: `${field} must be text or null` })
  }
  const value = input.trim()
  if (!value) return null
  if (value.length > maxLength) {
    throw createError({ statusCode: 400, statusMessage: `${field} is too long` })
  }
  return value
}

function nullableNonNegativeNumber(
  input: unknown,
  field: string,
  maximum: number,
): number | null {
  if (input === null || input === '') return null
  const value = numberValue(input)
  if (value === undefined || value < 0 || value > maximum) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} must be a non-negative number not greater than ${maximum}`,
    })
  }
  return value
}

function nullablePositiveNumber(
  input: unknown,
  field: string,
  maximum: number,
): number | null {
  const value = nullableNonNegativeNumber(input, field, maximum)
  if (value !== null && value <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} must be greater than zero`,
    })
  }
  return value
}

function currencyValue(input: unknown): string {
  const value = requiredText(input, 'currency', 3).toUpperCase()
  if (!/^[A-Z]{3}$/.test(value)) {
    throw createError({ statusCode: 400, statusMessage: 'currency must be a 3-letter code' })
  }
  return value
}

function marketTypeValue(input: unknown): string | null {
  const value = nullableText(input, 'market_type', 32)
  if (value && !marketTypes.has(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'market_type must be primary, secondary, rental or other',
    })
  }
  return value
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const caseId = getRequiredParam(event, 'id')
  if (!caseUuidPattern.test(caseId)) {
    throw createError({ statusCode: 404, statusMessage: 'Case not found' })
  }

  const body = asRecord(await readBody(event))
  const unsupportedFields = Object.keys(body).filter(field => !editableFields.has(field))
  if (unsupportedFields.length) {
    throw createError({
      statusCode: 400,
      statusMessage: `Unsupported property fields: ${unsupportedFields.join(', ')}`,
    })
  }

  const { data: caseRow, error: caseError } = await session.dataApi
    .from('crm_cases')
    .select('id, client_id')
    .eq('organization_id', session.organizationId)
    .eq('id', caseId)
    .maybeSingle()
  throwDbError(caseError)
  if (!caseRow) {
    throw createError({ statusCode: 404, statusMessage: 'Case not found' })
  }

  const marketType = body.market_type === undefined ? null : marketTypeValue(body.market_type)
  const { data, error } = await session.dataApi
    .from('crm_properties')
    .insert({
      organization_id: session.organizationId,
      case_id: caseId,
      case_item_id: null,
      address: requiredText(body.address, 'address', 500),
      city: body.city === undefined ? null : nullableText(body.city, 'city', 160),
      postal_code: body.postal_code === undefined
        ? null
        : nullableText(body.postal_code, 'postal_code', 32),
      property_type: body.property_type === undefined
        ? null
        : nullableText(body.property_type, 'property_type', 100),
      market_type: marketType,
      price_amount: body.price_amount === undefined
        ? null
        : nullableNonNegativeNumber(body.price_amount, 'price_amount', 999_999_999_999.99),
      appraisal_value_amount: body.appraisal_value_amount === undefined
        ? null
        : nullablePositiveNumber(body.appraisal_value_amount, 'appraisal_value_amount', 999_999_999_999.99),
      currency: body.currency === undefined ? 'PLN' : currencyValue(body.currency),
      area_m2: body.area_m2 === undefined
        ? null
        : nullableNonNegativeNumber(body.area_m2, 'area_m2', 99_999_999.99),
      rooms: body.rooms === undefined
        ? null
        : nullableNonNegativeNumber(body.rooms, 'rooms', 999.9),
    })
    .select(propertyPublicSelect)
    .single()
  throwDbError(error)

  await selectCasePropertyIfNone(session, caseId, String(data.id), String(data.created_at))

  await recordCrmActivity(session, {
    client_id: caseRow.client_id,
    case_id: caseId,
    activity_type: 'property_created',
    title: 'Dodano nieruchomość',
    body: data.address,
    payload: { property_id: data.id },
  })

  return { data }
})
