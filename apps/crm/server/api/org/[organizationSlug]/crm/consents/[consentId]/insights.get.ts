import type {
  ConsentInsightSubjectStatus,
  ConsentInsightsClientsResponse,
  ConsentInsightsEventsResponse,
  ConsentInsightsFilters,
  ConsentInsightsResponse,
  ConsentInsightsStatisticsResponse,
  ConsentInsightsView,
} from '~~/app/types/consent-insights'
import { serverDataBackend } from '~~/server/utils/data-api'
import {
  aggregateConsentInsightStatistics,
  buildConsentInsightAuditEvents,
  buildConsentSubjectInsights,
  consentInsightCounts,
  consentInsightDefinitionSummary,
  filterConsentSubjectInsights,
  type ConsentInsightCaptureEventRow,
  type ConsentInsightCaptureRequestRow,
  type ConsentInsightClientRow,
  type ConsentInsightDecisionRow,
  type ConsentInsightDefinitionRow,
  type ConsentInsightPersonRow,
  type ConsentInsightVersionRow,
} from '~~/server/utils/consent-insights'
import {
  getRequiredParam,
  requireAdministrativePermission,
  requireCrmSession,
  throwDbError,
} from '~~/server/utils/crm'
import { createError, getQuery, setHeader } from 'h3'

type BackendData = any

interface DataResult<T> {
  data: T[] | null
  error: { message?: string, code?: string } | null
}

interface ParsedQuery {
  view: ConsentInsightsView
  page: number
  limit: number
  filters: ConsentInsightsFilters
  subjectStatus: ConsentInsightSubjectStatus | null
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const viewValues = new Set<ConsentInsightsView>(['clients', 'statistics', 'events'])
const subjectStatusValues = new Set<ConsentInsightSubjectStatus>([
  'granted',
  'declined',
  'withdrawn',
  'pending',
  'no_decision',
])
const rowBatchSize = 500
const maximumRowsPerDataset = 100_000
const requestIdChunkSize = 100
const emptyUuid = '00000000-0000-0000-0000-000000000000'

function badRequest(statusMessage: string): never {
  throw createError({ statusCode: 400, statusMessage })
}

function singleQueryValue(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') return badRequest(`${field} must occur only once`)
  return value
}

function integerQueryValue(
  value: unknown,
  field: string,
  fallback: number,
  maximum: number,
): number {
  const raw = singleQueryValue(value, field)
  if (raw === undefined || raw === '') return fallback
  if (!/^\d+$/.test(raw)) return badRequest(`${field} must be an integer`)
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    return badRequest(`${field} must be between 1 and ${maximum}`)
  }
  return parsed
}

function dateQueryValue(value: unknown, field: 'dateFrom' | 'dateTo'): string | null {
  const rawValue = singleQueryValue(value, field)
  if (rawValue === undefined || rawValue.trim() === '') return null
  const raw = rawValue.trim()
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  let parsed: Date
  if (dateOnly) {
    parsed = new Date(`${raw}T${field === 'dateFrom' ? '00:00:00.000' : '23:59:59.999'}Z`)
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
      return badRequest(`${field} must be a valid date`)
    }
  } else {
    if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)) {
      return badRequest(`${field} must include a timezone offset`)
    }
    parsed = new Date(raw)
  }
  if (!Number.isFinite(parsed.getTime())) return badRequest(`${field} must be a valid date`)
  return parsed.toISOString()
}

function parseQuery(query: Record<string, unknown>): ParsedQuery {
  const rawView = singleQueryValue(query.view, 'view') ?? 'clients'
  if (!viewValues.has(rawView as ConsentInsightsView)) {
    return badRequest('view must be one of: clients, statistics, events')
  }
  const view = rawView as ConsentInsightsView
  const rawSearch = singleQueryValue(query.search, 'search')?.trim() ?? ''
  if (rawSearch.length > 200) return badRequest('search must contain at most 200 characters')

  const rawStatusValue = singleQueryValue(query.status, 'status')?.trim().toLocaleLowerCase('en-US') ?? ''
  const rawStatus = rawStatusValue === 'all' ? '' : rawStatusValue
  if (rawStatus && !/^[a-z0-9][a-z0-9_.:-]{0,63}$/.test(rawStatus)) {
    return badRequest('status has an unsupported format')
  }
  if (
    rawStatus
    && view !== 'events'
    && !subjectStatusValues.has(rawStatus as ConsentInsightSubjectStatus)
  ) {
    return badRequest('status must be one of: granted, declined, withdrawn, pending, no_decision')
  }

  const dateFrom = dateQueryValue(query.dateFrom, 'dateFrom')
  const dateTo = dateQueryValue(query.dateTo, 'dateTo')
  if (dateFrom && dateTo && Date.parse(dateFrom) > Date.parse(dateTo)) {
    return badRequest('dateFrom must not be later than dateTo')
  }

  const page = integerQueryValue(query.page, 'page', 1, 10_000)
  const limit = integerQueryValue(query.limit, 'limit', 25, 100)
  if ((page - 1) * limit > maximumRowsPerDataset) {
    return badRequest(`page and limit must not address more than ${maximumRowsPerDataset} rows`)
  }

  return {
    view,
    page,
    limit,
    filters: {
      search: rawSearch || null,
      status: rawStatus || null,
      dateFrom,
      dateTo,
    },
    subjectStatus: rawStatus && view !== 'events'
      ? rawStatus as ConsentInsightSubjectStatus
      : null,
  }
}

async function loadAllRows<T>(
  queryPage: (from: number, to: number) => PromiseLike<DataResult<T>>,
  dataset: string,
  maximumRows = maximumRowsPerDataset,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += rowBatchSize) {
    const result = await queryPage(from, from + rowBatchSize - 1)
    throwDbError(result.error)
    const batch = result.data ?? []
    if (rows.length + batch.length > maximumRows) {
      throw createError({
        statusCode: 413,
        statusMessage: `${dataset} exceeds the safe aggregation limit of ${maximumRows} rows`,
      })
    }
    rows.push(...batch)
    if (batch.length < rowBatchSize) return rows
  }
}

function withDateRange(
  query: BackendData,
  column: string,
  filters: ConsentInsightsFilters,
): BackendData {
  let ranged = query
  if (filters.dateFrom) ranged = ranged.gte(column, filters.dateFrom)
  if (filters.dateTo) ranged = ranged.lte(column, filters.dateTo)
  return ranged
}

async function loadPeople(backendData: BackendData, organizationId: string) {
  return loadAllRows<ConsentInsightPersonRow>(
    (from, to) => backendData
      .from('crm_client_people')
      .select('id, client_id, display_name, role, phone, email')
      .eq('organization_id', organizationId)
      .order('id', { ascending: true })
      .range(from, to),
    'CRM client people',
  )
}

async function loadClients(backendData: BackendData, organizationId: string) {
  return loadAllRows<ConsentInsightClientRow>(
    (from, to) => backendData
      .from('crm_clients')
      .select('id, display_name, status_code, primary_phone, primary_email')
      .eq('organization_id', organizationId)
      .order('id', { ascending: true })
      .range(from, to),
    'CRM clients',
  )
}

async function loadDecisions(input: {
  backendData: BackendData
  organizationId: string
  definitionId: string
  filters?: ConsentInsightsFilters
}) {
  return loadAllRows<ConsentInsightDecisionRow>(
    (from, to) => {
      let query = input.backendData
        .from('crm_client_consent_events')
        .select(`
          id,
          client_id,
          subject_person_id,
          definition_version_id,
          decision,
          source,
          contact_value,
          evidence_reference,
          metadata,
          recorded_by_user_id,
          occurred_at
        `)
        .eq('organization_id', input.organizationId)
        .eq('definition_id', input.definitionId)
      if (input.filters) query = withDateRange(query, 'occurred_at', input.filters)
      return query
        .order('occurred_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)
    },
    'Consent decisions',
  )
}

async function loadCaptureRequests(input: {
  backendData: BackendData
  organizationId: string
  definitionId: string
}) {
  return loadAllRows<ConsentInsightCaptureRequestRow>(
    (from, to) => input.backendData
      .from('crm_consent_capture_requests')
      .select(`
        id,
        client_id,
        subject_person_id,
        definition_version_id,
        requested_by_user_id,
        phone_e164,
        intent,
        status,
        provider,
        delivery_status,
        sent_at,
        delivered_at,
        opened_at,
        verified_at,
        decided_at,
        cancelled_at,
        decision,
        evidence_reference,
        metadata,
        expires_at,
        created_at,
        updated_at
      `)
      .eq('organization_id', input.organizationId)
      .eq('definition_id', input.definitionId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
    'Consent capture requests',
  )
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

async function loadCaptureEvents(input: {
  backendData: BackendData
  organizationId: string
  requestIds: string[]
  filters: ConsentInsightsFilters
}): Promise<ConsentInsightCaptureEventRow[]> {
  const result: ConsentInsightCaptureEventRow[] = []
  const requestIdChunks = chunks(
    input.requestIds.length ? input.requestIds : [emptyUuid],
    requestIdChunkSize,
  )
  for (const requestIds of requestIdChunks) {
    const rows = await loadAllRows<ConsentInsightCaptureEventRow>(
      (from, to) => {
        let query = input.backendData
          .from('crm_consent_capture_events')
          .select('id, request_id, event_type, actor_user_id, occurred_at')
          .eq('organization_id', input.organizationId)
          .in('request_id', requestIds)
        query = withDateRange(query, 'occurred_at', input.filters)
        return query
          .order('occurred_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to)
      },
      'Consent capture events',
      maximumRowsPerDataset - result.length,
    )
    result.push(...rows.map(row => ({ ...row, metadata: null })))
  }
  return result
}

function pagination(page: number, limit: number, total: number) {
  return {
    page,
    limit,
    total,
    totalPages: total ? Math.ceil(total / limit) : 0,
  }
}

export default defineEventHandler(async (event): Promise<ConsentInsightsResponse> => {
  const session = await requireCrmSession(event)
  await requireAdministrativePermission(
    session,
    'compliance.consents.audit.read',
  )
  setHeader(event, 'Cache-Control', 'private, no-store')

  const consentId = getRequiredParam(event, 'consentId').toLocaleLowerCase('en-US')
  if (!uuidPattern.test(consentId)) {
    throw createError({ statusCode: 404, statusMessage: 'Consent definition not found' })
  }
  const parsed = parseQuery(getQuery(event) as Record<string, unknown>)
  const backendData = serverDataBackend(event) as BackendData

  const [definitionResult, versionsResult] = await Promise.all([
    backendData
      .from('crm_consent_definitions')
      .select('id, code, context, current_version_id')
      .eq('organization_id', session.organizationId)
      .eq('id', consentId)
      .maybeSingle(),
    backendData
      .from('crm_consent_definition_versions')
      .select('id, definition_id, version, display_title, channel')
      .eq('organization_id', session.organizationId)
      .eq('definition_id', consentId)
      .order('version', { ascending: false }),
  ])
  throwDbError(definitionResult.error)
  throwDbError(versionsResult.error)
  if (!definitionResult.data) {
    throw createError({ statusCode: 404, statusMessage: 'Consent definition not found' })
  }

  const definitionRow = definitionResult.data as ConsentInsightDefinitionRow
  const versions = (versionsResult.data ?? []) as ConsentInsightVersionRow[]
  const definition = consentInsightDefinitionSummary(definitionRow, versions)

  const [people, clients, requests] = await Promise.all([
    loadPeople(backendData, session.organizationId),
    loadClients(backendData, session.organizationId),
    loadCaptureRequests({
      backendData,
      organizationId: session.organizationId,
      definitionId: consentId,
    }),
  ])

  if (parsed.view === 'events') {
    const [decisions, captureEvents] = await Promise.all([
      loadDecisions({
        backendData,
        organizationId: session.organizationId,
        definitionId: consentId,
        filters: parsed.filters,
      }),
      loadCaptureEvents({
        backendData,
        organizationId: session.organizationId,
        requestIds: requests.map(request => request.id),
        filters: parsed.filters,
      }),
    ])
    const items = buildConsentInsightAuditEvents({
      clients,
      people,
      versions,
      decisions,
      requests,
      captureEvents,
      filters: {
        search: parsed.filters.search,
        status: parsed.filters.status,
        dateFrom: parsed.filters.dateFrom,
        dateTo: parsed.filters.dateTo,
      },
    })
    const offset = (parsed.page - 1) * parsed.limit
    const response: ConsentInsightsEventsResponse = {
      view: 'events',
      definition,
      filters: parsed.filters,
      pagination: pagination(parsed.page, parsed.limit, items.length),
      items: items.slice(offset, offset + parsed.limit),
    }
    return response
  }

  const decisions = await loadDecisions({
    backendData,
    organizationId: session.organizationId,
    definitionId: consentId,
  })
  const records = buildConsentSubjectInsights({
    people,
    clients,
    decisions,
    requests,
    versions,
  })
  if (parsed.view === 'statistics') {
    const recordsForStatistics = filterConsentSubjectInsights(records, {
      search: parsed.filters.search,
      status: parsed.subjectStatus,
      dateFrom: null,
      dateTo: null,
    })
    const statistics = aggregateConsentInsightStatistics({
      records: recordsForStatistics,
      decisions,
      requests,
      range: {
        dateFrom: parsed.filters.dateFrom,
        dateTo: parsed.filters.dateTo,
      },
    })
    const response: ConsentInsightsStatisticsResponse = {
      view: 'statistics',
      definition,
      filters: parsed.filters,
      ...statistics,
    }
    return response
  }

  const recordsWithoutStatus = filterConsentSubjectInsights(records, {
    search: parsed.filters.search,
    status: null,
    dateFrom: parsed.filters.dateFrom,
    dateTo: parsed.filters.dateTo,
  })
  const filteredRecords = parsed.subjectStatus
    ? recordsWithoutStatus.filter(record => record.item.status === parsed.subjectStatus)
    : recordsWithoutStatus

  const offset = (parsed.page - 1) * parsed.limit
  const response: ConsentInsightsClientsResponse = {
    view: 'clients',
    definition,
    filters: parsed.filters,
    counts: consentInsightCounts(recordsWithoutStatus),
    pagination: pagination(parsed.page, parsed.limit, filteredRecords.length),
    items: filteredRecords
      .slice(offset, offset + parsed.limit)
      .map(record => record.item),
  }
  return response
})
