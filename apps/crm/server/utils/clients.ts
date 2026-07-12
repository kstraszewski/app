import { createError } from 'h3'
import { textValue, throwDbError, type CrmSession } from './crm'

export const clientUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ownerModes = new Set(['all', 'assigned', 'unassigned'])
const consentDecisions = new Set(['granted', 'declined', 'withdrawn', 'unknown'])
const clientSorts = new Set([
  'updated_desc',
  'updated_asc',
  'created_desc',
  'created_asc',
  'name_asc',
  'name_desc',
])

type QueryRecord = Record<string, unknown>

export interface ClientSearchCursor {
  value: string
  id: string
}

export interface ClientSearchFilters {
  q?: string
  statusCodes?: string[]
  ownerUserIds?: string[]
  ownerMode: 'all' | 'assigned' | 'unassigned'
  tagsAny?: string[]
  tagsAll?: string[]
  leadSources?: string[]
  createdFrom?: string
  createdTo?: string
  updatedFrom?: string
  updatedTo?: string
  hasEmail?: boolean
  hasPhone?: boolean
  consentDefinitionId?: string
  consentDecision?: 'granted' | 'declined' | 'withdrawn' | 'unknown'
  sort: 'updated_desc' | 'updated_asc' | 'created_desc' | 'created_asc' | 'name_asc' | 'name_desc'
  limit: number
  offset: number
  cursor?: ClientSearchCursor
  includeFacets: boolean
}

export interface ClientSearchPayload {
  data: Record<string, unknown>[]
  count: number
  pageInfo: {
    hasMore: boolean
    nextCursor: ClientSearchCursor | null
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

function queryValues(
  query: QueryRecord,
  keys: string[],
  field: string,
  maximumValues = 100,
  maximumLength = 200,
): string[] {
  const values = [...new Set(keys.flatMap(key => rawValues(query[key])))]
  if (values.length > maximumValues) validationError(`${field} has too many values`)
  if (values.some(value => value.length > maximumLength)) {
    validationError(`${field} contains a value that is too long`)
  }
  return values
}

function optionalBoolean(input: unknown, field: string): boolean | undefined {
  if (input === undefined || input === null || input === '') return undefined
  const value = Array.isArray(input) ? input[0] : input
  if (value === true || value === 'true' || value === '1') return true
  if (value === false || value === 'false' || value === '0') return false
  validationError(`${field} must be true or false`)
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

function optionalDateTime(input: unknown, field: string, endOfDay = false): string | undefined {
  const value = textValue(Array.isArray(input) ? input[0] : input)
  if (!value) return undefined
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`)
    : new Date(value)
  if (Number.isNaN(parsed.valueOf())) validationError(`${field} must be a valid date or date-time`)
  return parsed.toISOString()
}

function parseCursor(input: unknown): ClientSearchCursor | undefined {
  const raw = textValue(Array.isArray(input) ? input[0] : input)
  if (!raw) return undefined
  if (raw.length > 2_000) validationError('cursor is too long')

  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    try {
      value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    } catch {
      validationError('cursor is invalid')
    }
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    validationError('cursor is invalid')
  }
  const cursor = value as Record<string, unknown>
  const cursorValue = textValue(cursor.value)
  const id = textValue(cursor.id)
  if (!cursorValue || cursorValue.length > 500 || !id || !clientUuidPattern.test(id)) {
    validationError('cursor is invalid')
  }
  return { value: cursorValue, id }
}

function parseSort(query: QueryRecord): ClientSearchFilters['sort'] {
  const rawSort = textValue(Array.isArray(query.sort) ? query.sort[0] : query.sort) ?? 'updated_at'
  if (clientSorts.has(rawSort)) return rawSort as ClientSearchFilters['sort']

  const direction = textValue(Array.isArray(query.direction) ? query.direction[0] : query.direction) ?? 'desc'
  if (!['asc', 'desc'].includes(direction)) validationError('direction must be asc or desc')
  const fieldToSort: Record<string, [string, string]> = {
    updated_at: ['updated_asc', 'updated_desc'],
    created_at: ['created_asc', 'created_desc'],
    display_name: ['name_asc', 'name_desc'],
    name: ['name_asc', 'name_desc'],
  }
  const candidate = fieldToSort[rawSort]?.[direction === 'asc' ? 0 : 1]
  if (!candidate || !clientSorts.has(candidate)) {
    validationError('sort is unsupported')
  }
  return candidate as ClientSearchFilters['sort']
}

function assertRange(from: string | undefined, to: string | undefined, field: string): void {
  if (from && to && new Date(from) > new Date(to)) {
    validationError(`${field}_from must not be later than ${field}_to`)
  }
}

export function parseClientSearchFilters(
  query: QueryRecord,
  session: Pick<CrmSession, 'userId'>,
  options: { forceFacets?: boolean } = {},
): ClientSearchFilters {
  const q = textValue(Array.isArray(query.q) ? query.q[0] : query.q)
  if (q && q.length > 200) validationError('q must not exceed 200 characters')

  const statusCodes = queryValues(query, ['status_code', 'status_codes', 'status'], 'status_code', 50, 80)
  const tagsAny = queryValues(query, ['tags_any', 'tags', 'tag'], 'tags_any', 50, 80)
  const tagsAll = queryValues(query, ['tags_all'], 'tags_all', 50, 80)
  const leadSources = queryValues(query, ['lead_source', 'lead_sources'], 'lead_source', 50, 200)

  const rawOwnerIds = queryValues(query, ['owner_user_id', 'owner_user_ids'], 'owner_user_id', 100, 40)
  const explicitOwnerMode = textValue(
    Array.isArray(query.owner_mode) ? query.owner_mode[0] : query.owner_mode,
  )
  let ownerMode = explicitOwnerMode ?? 'all'
  let ownerUserIds = rawOwnerIds
  if (rawOwnerIds.includes('mine')) {
    ownerUserIds = [...new Set(rawOwnerIds.map(value => value === 'mine' ? session.userId : value))]
  }
  if (ownerUserIds.includes('all')) ownerUserIds = ownerUserIds.filter(value => value !== 'all')
  if (ownerUserIds.includes('unassigned')) {
    if (ownerUserIds.length > 1) {
      validationError('unassigned cannot be combined with owner UUIDs')
    }
    ownerMode = 'unassigned'
    ownerUserIds = []
  }
  if (!ownerModes.has(ownerMode)) validationError('owner_mode is unsupported')
  if (ownerUserIds.some(value => !clientUuidPattern.test(value))) {
    validationError('owner_user_id must contain organization member UUIDs')
  }
  if (ownerMode === 'unassigned' && ownerUserIds.length) {
    validationError('owner_user_id cannot be combined with owner_mode=unassigned')
  }

  const consentDefinitionId = textValue(
    Array.isArray(query.consent_definition_id)
      ? query.consent_definition_id[0]
      : query.consent_definition_id,
  )
  if (consentDefinitionId && !clientUuidPattern.test(consentDefinitionId)) {
    validationError('consent_definition_id must be a UUID')
  }
  let consentDecision = textValue(
    Array.isArray(query.consent_decision) ? query.consent_decision[0] : query.consent_decision,
  )
  if (consentDecision === 'missing') consentDecision = 'unknown'
  if (consentDecision && !consentDecisions.has(consentDecision)) {
    validationError('consent_decision is unsupported')
  }
  if (consentDecision && !consentDefinitionId) {
    validationError('consent_definition_id is required with consent_decision')
  }

  const createdFrom = optionalDateTime(query.created_from, 'created_from')
  const createdTo = optionalDateTime(query.created_to, 'created_to', true)
  const updatedFrom = optionalDateTime(query.updated_from, 'updated_from')
  const updatedTo = optionalDateTime(query.updated_to, 'updated_to', true)
  assertRange(createdFrom, createdTo, 'created')
  assertRange(updatedFrom, updatedTo, 'updated')

  const limit = optionalInteger(query.limit ?? query.page_size, 'limit', 50, 1, 100)
  let offset = optionalInteger(query.offset, 'offset', 0, 0, 100_000)
  const page = optionalInteger(query.page, 'page', 1, 1, 2_001)
  if (query.page !== undefined) {
    if (query.offset !== undefined) validationError('page cannot be combined with offset')
    offset = (page - 1) * limit
    if (offset > 100_000) validationError('page is outside the supported range')
  }
  const cursor = parseCursor(query.cursor)
  if (cursor && offset > 0) validationError('cursor cannot be combined with a positive offset')
  let hasEmail = optionalBoolean(query.has_email, 'has_email')
  let hasPhone = optionalBoolean(query.has_phone, 'has_phone')
  const contact = textValue(Array.isArray(query.contact) ? query.contact[0] : query.contact)
  if (contact) {
    if (hasEmail !== undefined || hasPhone !== undefined) {
      validationError('contact cannot be combined with has_email or has_phone')
    }
    if (contact === 'email') hasEmail = true
    else if (contact === 'phone') hasPhone = true
    else if (contact === 'both') {
      hasEmail = true
      hasPhone = true
    } else if (contact === 'none') {
      hasEmail = false
      hasPhone = false
    } else {
      validationError('contact must be email, phone, both or none')
    }
  }

  const filters: ClientSearchFilters = {
    ...(q ? { q } : {}),
    ...(statusCodes.length ? { statusCodes } : {}),
    ...(ownerUserIds.length ? { ownerUserIds } : {}),
    ownerMode: ownerMode as ClientSearchFilters['ownerMode'],
    ...(tagsAny.length ? { tagsAny } : {}),
    ...(tagsAll.length ? { tagsAll } : {}),
    ...(leadSources.length ? { leadSources } : {}),
    ...(createdFrom ? { createdFrom } : {}),
    ...(createdTo ? { createdTo } : {}),
    ...(updatedFrom ? { updatedFrom } : {}),
    ...(updatedTo ? { updatedTo } : {}),
    ...(hasEmail === undefined ? {} : { hasEmail }),
    ...(hasPhone === undefined ? {} : { hasPhone }),
    ...(consentDefinitionId ? { consentDefinitionId } : {}),
    ...(consentDecision
      ? { consentDecision: consentDecision as ClientSearchFilters['consentDecision'] }
      : {}),
    sort: parseSort(query),
    limit,
    offset,
    ...(cursor ? { cursor } : {}),
    includeFacets: options.forceFacets === true
      ? true
      : optionalBoolean(query.include_facets, 'include_facets') ?? false,
  }
  return filters
}

function recordValue(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
}

export async function searchCrmClients(
  session: CrmSession,
  filters: ClientSearchFilters,
): Promise<ClientSearchPayload> {
  const { data, error } = await session.supabase.rpc('search_crm_clients', {
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
  const nextCursorValue = rawPageInfo.nextCursor ?? rawPageInfo.next_cursor
  const nextCursorRecord = recordValue(nextCursorValue)
  const nextCursor = textValue(nextCursorRecord.value)
    && textValue(nextCursorRecord.id)
    && clientUuidPattern.test(String(nextCursorRecord.id))
    ? {
        value: String(nextCursorRecord.value),
        id: String(nextCursorRecord.id),
      }
    : null

  return {
    data: rows,
    count: Number.isFinite(count) && count >= 0 ? count : rows.length,
    pageInfo: {
      hasMore: Boolean(rawPageInfo.hasMore ?? rawPageInfo.has_more),
      nextCursor,
      offset: Number(rawPageInfo.offset ?? filters.offset) || 0,
      limit: Number(rawPageInfo.limit ?? filters.limit) || filters.limit,
    },
    facets: payload.facets && typeof payload.facets === 'object' && !Array.isArray(payload.facets)
      ? payload.facets as Record<string, unknown>
      : null,
  }
}
