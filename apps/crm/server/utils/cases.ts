import { createError } from 'h3'
import { caseUuidPattern } from './case-identifiers'
import { textValue, throwDbError, type CrmSession } from './crm'
import { normalizeCrmSearchQuery } from './search'

const caseSorts = new Set([
  'relevance',
  'updated_desc',
  'updated_asc',
  'created_desc',
  'created_asc',
  'title_asc',
  'title_desc',
  'offers_desc',
])

type QueryRecord = Record<string, unknown>

export interface CaseSearchFilters {
  q?: string
  clientIds?: string[]
  clientMatch: 'any' | 'all'
  bankIds?: string[]
  offerMode: 'all' | 'with' | 'without'
  createdFrom?: string
  createdTo?: string
  updatedFrom?: string
  updatedTo?: string
  sort: 'relevance' | 'updated_desc' | 'updated_asc' | 'created_desc' | 'created_asc' | 'title_asc' | 'title_desc' | 'offers_desc'
  limit: number
  offset: number
  includeFacets: boolean
}

export interface CaseSearchPayload {
  data: Record<string, unknown>[]
  count: number
  pageInfo: {
    hasMore: boolean
    offset: number
    limit: number
  }
  facets: Record<string, unknown> | null
}

function validationError(message: string): never {
  throw createError({ statusCode: 400, statusMessage: message })
}

function rawValues(value: unknown): string[] {
  const inputs = Array.isArray(value) ? value : [value]
  return inputs.flatMap((input) => {
    if (typeof input !== 'string') return []
    return input.split(',')
  }).map(value => value.trim()).filter(Boolean)
}

function queryValues(query: QueryRecord, keys: string[], field: string): string[] {
  const values = [...new Set(keys.flatMap(key => rawValues(query[key])))]
  if (values.length > 100) validationError(`${field} has too many values`)
  if (values.some(value => !caseUuidPattern.test(value))) {
    validationError(`${field} must contain UUIDs`)
  }
  return values
}

function optionalInteger(
  input: unknown,
  field: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (input === undefined || input === null || input === '') return fallback
  const raw = Array.isArray(input) ? input[0] : input
  const value = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    validationError(`${field} must be an integer between ${minimum} and ${maximum}`)
  }
  return value
}

function optionalBoolean(input: unknown, field: string): boolean | undefined {
  if (input === undefined || input === null || input === '') return undefined
  const value = Array.isArray(input) ? input[0] : input
  if (value === true || value === 'true' || value === '1') return true
  if (value === false || value === 'false' || value === '0') return false
  validationError(`${field} must be true or false`)
}

function optionalDateTime(input: unknown, field: string, endOfDay = false): string | undefined {
  const value = textValue(Array.isArray(input) ? input[0] : input)
  if (!value) return undefined
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`)
    : new Date(value)
  if (Number.isNaN(parsed.valueOf())) validationError(`${field} must be a valid date or date-time`)
  return parsed.toISOString()
}

function recordValue(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
}

export function parseCaseSearchFilters(
  query: QueryRecord,
  options: { forceFacets?: boolean } = {},
): CaseSearchFilters {
  const rawQuery = textValue(Array.isArray(query.q) ? query.q[0] : query.q)
  const q = normalizeCrmSearchQuery(rawQuery)
  if (rawQuery && rawQuery.length > 200) validationError('q must not exceed 200 characters')

  const clientIds = queryValues(query, ['client_id', 'client_ids'], 'client_ids')
  const bankIds = queryValues(query, ['bank_id', 'bank_ids'], 'bank_ids')
  const clientMatch = textValue(
    Array.isArray(query.client_match) ? query.client_match[0] : query.client_match,
  ) ?? 'any'
  if (!['any', 'all'].includes(clientMatch)) validationError('client_match is unsupported')

  const offerMode = textValue(
    Array.isArray(query.offer_mode) ? query.offer_mode[0] : query.offer_mode,
  ) ?? 'all'
  if (!['all', 'with', 'without'].includes(offerMode)) validationError('offer_mode is unsupported')

  const createdFrom = optionalDateTime(query.created_from, 'created_from')
  const createdTo = optionalDateTime(query.created_to, 'created_to', true)
  const updatedFrom = optionalDateTime(query.updated_from, 'updated_from')
  const updatedTo = optionalDateTime(query.updated_to, 'updated_to', true)
  if (createdFrom && createdTo && createdFrom > createdTo) {
    validationError('created_from must not be later than created_to')
  }
  if (updatedFrom && updatedTo && updatedFrom > updatedTo) {
    validationError('updated_from must not be later than updated_to')
  }

  const requestedSort = textValue(Array.isArray(query.sort) ? query.sort[0] : query.sort)
    ?? (q ? 'relevance' : 'updated_desc')
  if (!caseSorts.has(requestedSort)) validationError('sort is unsupported')

  const limit = optionalInteger(query.limit ?? query.page_size, 'limit', 25, 1, 100)
  let offset = optionalInteger(query.offset, 'offset', 0, 0, 100_000)
  if (query.page !== undefined) {
    if (query.offset !== undefined) validationError('page cannot be combined with offset')
    const page = optionalInteger(query.page, 'page', 1, 1, 4_001)
    offset = (page - 1) * limit
    if (offset > 100_000) validationError('page is outside the supported range')
  }

  return {
    ...(q ? { q } : {}),
    ...(clientIds.length ? { clientIds } : {}),
    clientMatch: clientMatch as CaseSearchFilters['clientMatch'],
    ...(bankIds.length ? { bankIds } : {}),
    offerMode: offerMode as CaseSearchFilters['offerMode'],
    ...(createdFrom ? { createdFrom } : {}),
    ...(createdTo ? { createdTo } : {}),
    ...(updatedFrom ? { updatedFrom } : {}),
    ...(updatedTo ? { updatedTo } : {}),
    sort: requestedSort as CaseSearchFilters['sort'],
    limit,
    offset,
    includeFacets: options.forceFacets === true
      ? true
      : optionalBoolean(query.include_facets, 'include_facets') ?? false,
  }
}

export async function searchCrmCases(
  session: CrmSession,
  filters: CaseSearchFilters,
): Promise<CaseSearchPayload> {
  const rpcName = filters.q ? 'search_crm_cases_with_context' : 'search_crm_cases'
  const { data, error } = await session.dataApi.rpc(rpcName, {
    p_organization_id: session.organizationId,
    p_filters: filters,
  })
  throwDbError(error, error?.code === '22023' ? 400 : 500)

  const payload = recordValue(data)
  const rows = Array.isArray(payload.data)
    ? payload.data.filter(row => row && typeof row === 'object') as Record<string, unknown>[]
    : []
  const rawPageInfo = recordValue(payload.pageInfo ?? payload.page_info)
  const count = Number(payload.count ?? rows.length)

  return {
    data: rows,
    count: Number.isFinite(count) && count >= 0 ? count : rows.length,
    pageInfo: {
      hasMore: Boolean(rawPageInfo.hasMore ?? rawPageInfo.has_more),
      offset: Number(rawPageInfo.offset ?? filters.offset) || 0,
      limit: Number(rawPageInfo.limit ?? filters.limit) || filters.limit,
    },
    facets: payload.facets && typeof payload.facets === 'object' && !Array.isArray(payload.facets)
      ? payload.facets as Record<string, unknown>
      : null,
  }
}
