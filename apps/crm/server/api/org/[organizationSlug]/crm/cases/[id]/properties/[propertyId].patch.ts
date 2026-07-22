import { createError, readBody } from 'h3'
import { propertyPublicSelect } from '~~/server/utils/case-properties'
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

function propertyNotFound(): never {
  throw createError({ statusCode: 404, statusMessage: 'Property not found' })
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const caseId = getRequiredParam(event, 'id')
  const propertyId = getRequiredParam(event, 'propertyId')
  if (!caseUuidPattern.test(caseId)) {
    throw createError({ statusCode: 404, statusMessage: 'Case not found' })
  }
  if (!caseUuidPattern.test(propertyId)) propertyNotFound()

  const body = asRecord(await readBody(event))
  const unsupportedFields = Object.keys(body).filter(field => !editableFields.has(field))
  if (unsupportedFields.length) {
    throw createError({
      statusCode: 400,
      statusMessage: `Unsupported property fields: ${unsupportedFields.join(', ')}`,
    })
  }

  const patch: Record<string, unknown> = {}
  if ('address' in body) patch.address = requiredText(body.address, 'address', 500)
  if ('city' in body) patch.city = nullableText(body.city, 'city', 160)
  if ('postal_code' in body) patch.postal_code = nullableText(body.postal_code, 'postal_code', 32)
  if ('property_type' in body) {
    patch.property_type = nullableText(body.property_type, 'property_type', 100)
  }
  if ('market_type' in body) patch.market_type = marketTypeValue(body.market_type)
  if ('price_amount' in body) {
    patch.price_amount = nullableNonNegativeNumber(
      body.price_amount,
      'price_amount',
      999_999_999_999.99,
    )
  }
  if ('appraisal_value_amount' in body) {
    patch.appraisal_value_amount = nullablePositiveNumber(
      body.appraisal_value_amount,
      'appraisal_value_amount',
      999_999_999_999.99,
    )
  }
  if ('currency' in body) patch.currency = currencyValue(body.currency)
  if ('area_m2' in body) {
    patch.area_m2 = nullableNonNegativeNumber(body.area_m2, 'area_m2', 99_999_999.99)
  }
  if ('rooms' in body) patch.rooms = nullableNonNegativeNumber(body.rooms, 'rooms', 999.9)
  if (!Object.keys(patch).length) {
    throw createError({ statusCode: 400, statusMessage: 'At least one property field is required' })
  }

  const [{ data: caseRow, error: caseError }, { data: property, error: propertyError }] = await Promise.all([
    session.supabase
      .from('crm_cases')
      .select('id, client_id')
      .eq('organization_id', session.organizationId)
      .eq('id', caseId)
      .maybeSingle(),
    session.supabase
      .from('crm_properties')
      .select('id, case_id, case_item_id')
      .eq('organization_id', session.organizationId)
      .eq('id', propertyId)
      .maybeSingle(),
  ])
  throwDbError(caseError)
  throwDbError(propertyError)
  if (!caseRow) {
    throw createError({ statusCode: 404, statusMessage: 'Case not found' })
  }
  if (!property) propertyNotFound()

  const directCaseId = property.case_id ? String(property.case_id) : null
  const caseItemId = property.case_item_id ? String(property.case_item_id) : null
  if (directCaseId && directCaseId !== caseId) propertyNotFound()

  let belongsThroughItem = false
  if (caseItemId) {
    const { data: caseItem, error: caseItemError } = await session.supabase
      .from('crm_case_items')
      .select('id')
      .eq('organization_id', session.organizationId)
      .eq('case_id', caseId)
      .eq('id', caseItemId)
      .maybeSingle()
    throwDbError(caseItemError)
    belongsThroughItem = Boolean(caseItem)
    if (!belongsThroughItem) propertyNotFound()
  }
  if (directCaseId !== caseId && !belongsThroughItem) propertyNotFound()

  let updateQuery = session.supabase
    .from('crm_properties')
    .update(patch)
    .eq('organization_id', session.organizationId)
    .eq('id', propertyId)
  updateQuery = directCaseId === caseId
    ? updateQuery.eq('case_id', caseId)
    : updateQuery.is('case_id', null).eq('case_item_id', caseItemId)

  const { data, error } = await updateQuery
    .select(propertyPublicSelect)
    .maybeSingle()
  throwDbError(error)
  if (!data) propertyNotFound()

  await recordCrmActivity(session, {
    client_id: caseRow.client_id,
    case_id: caseId,
    ...(caseItemId ? { case_item_id: caseItemId } : {}),
    activity_type: 'property_updated',
    title: 'Zaktualizowano nieruchomość',
    body: data.address,
    payload: {
      property_id: data.id,
      changed_fields: Object.keys(patch),
    },
  })

  return { data }
})
