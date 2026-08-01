import type {
  ConsentCaptureIntent,
  ConsentCaptureRequestStatus,
  ConsentInsightAuditEvent,
  ConsentInsightClientItem,
  ConsentInsightClientSummary,
  ConsentInsightCounts,
  ConsentInsightDailyTrendPoint,
  ConsentInsightDecision,
  ConsentInsightDefinitionSummary,
  ConsentInsightSmsFunnel,
  ConsentInsightSourceCount,
  ConsentInsightStatisticsTotals,
  ConsentInsightSubjectStatus,
  ConsentInsightSubjectSummary,
  ConsentInsightVersionSummary,
} from '../../app/types/consent-insights.ts'

export interface ConsentInsightDefinitionRow {
  id: string
  code: string
  context: string
  current_version_id: string
}

export interface ConsentInsightVersionRow {
  id: string
  definition_id: string
  version: number
  display_title: string
  channel: string
}

export interface ConsentInsightClientRow {
  id: string
  display_name: string
  status_code: string
  primary_phone: string | null
  primary_email: string | null
}

export interface ConsentInsightPersonRow {
  id: string
  client_id: string
  display_name: string
  role: string
  phone: string | null
  email: string | null
}

export interface ConsentInsightDecisionRow {
  id: string
  client_id: string
  subject_person_id: string
  definition_version_id: string
  decision: ConsentInsightDecision
  source: string
  contact_value: string | null
  evidence_reference: string | null
  metadata: unknown
  recorded_by_user_id: string | null
  occurred_at: string
}

export interface ConsentInsightCaptureRequestRow {
  id: string
  client_id: string
  subject_person_id: string
  definition_version_id: string
  requested_by_user_id: string | null
  phone_e164: string
  intent: ConsentCaptureIntent
  status: ConsentCaptureRequestStatus
  provider: string | null
  delivery_status: string | null
  sent_at: string | null
  delivered_at: string | null
  opened_at: string | null
  verified_at: string | null
  decided_at: string | null
  cancelled_at: string | null
  decision: ConsentInsightDecision | null
  evidence_reference: string | null
  metadata: unknown
  expires_at: string
  created_at: string
  updated_at: string
}

export interface ConsentInsightCaptureEventRow {
  id: string
  request_id: string
  event_type: string
  actor_user_id: string | null
  metadata: unknown
  occurred_at: string
}

export interface ConsentSubjectInsightRecord {
  item: ConsentInsightClientItem
  searchText: string
}

export interface ConsentInsightRange {
  dateFrom: string | null
  dateTo: string | null
}

const activeRequestStatuses = new Set<ConsentCaptureRequestStatus>([
  'pending',
  'queued',
  'sent',
  'delivered',
  'opened',
  'verified',
])

const sentRequestStatuses = new Set<ConsentCaptureRequestStatus>([
  'sent',
  'delivered',
  'opened',
  'verified',
  'accepted',
  'declined',
  'withdrawn',
])

const deliveredRequestStatuses = new Set<ConsentCaptureRequestStatus>([
  'delivered',
  'opened',
  'verified',
  'accepted',
  'declined',
  'withdrawn',
])

const verifiedRequestStatuses = new Set<ConsentCaptureRequestStatus>([
  'verified',
  'accepted',
  'declined',
  'withdrawn',
])

const decidedRequestStatuses = new Set<ConsentCaptureRequestStatus>([
  'accepted',
  'declined',
  'withdrawn',
])

function timestamp(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY
}

function newerThan(left: string | null | undefined, right: string | null | undefined): boolean {
  return timestamp(left) > timestamp(right)
}

function latestTimestamp(values: Array<string | null | undefined>): string | null {
  let latest: string | null = null
  for (const value of values) {
    if (value && (latest === null || newerThan(value, latest))) latest = value
  }
  return latest
}

function metadataMethod(input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const record = input as Record<string, unknown>
  for (const key of ['method', 'capture_method', 'verification_method']) {
    const value = record[key]
    if (
      typeof value === 'string'
      && value.length <= 64
      && /^[a-z0-9][a-z0-9_.:-]*$/i.test(value)
    ) {
      return value
    }
  }
  return null
}

function hasEvidence(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function requestDecision(request: ConsentInsightCaptureRequestRow): ConsentInsightDecision | null {
  if (request.decision) return request.decision
  if (request.status === 'accepted') return 'granted'
  if (request.status === 'declined') return 'declined'
  if (request.status === 'withdrawn') return 'withdrawn'
  return null
}

function matchingCaptureRequestForDecision(
  requests: ConsentInsightCaptureRequestRow[],
  decision: ConsentInsightDecisionRow,
): ConsentInsightCaptureRequestRow | null {
  const occurredAt = timestamp(decision.occurred_at)
  return requests
    .filter(request => (
      requestDecision(request) === decision.decision
      && request.definition_version_id === decision.definition_version_id
      && Boolean(request.decided_at)
    ))
    .sort((left, right) => (
      Math.abs(timestamp(left.decided_at) - occurredAt)
      - Math.abs(timestamp(right.decided_at) - occurredAt)
      || timestamp(right.decided_at) - timestamp(left.decided_at)
      || right.id.localeCompare(left.id)
    ))[0] ?? null
}

function versionSummary(
  versionById: Map<string, ConsentInsightVersionRow>,
  versionId: string | null | undefined,
): ConsentInsightVersionSummary | null {
  if (!versionId) return null
  const version = versionById.get(versionId)
  if (!version) return null
  return { id: version.id, number: version.version }
}

function clientSummary(client: ConsentInsightClientRow): ConsentInsightClientSummary {
  return {
    id: client.id,
    displayName: client.display_name,
    statusCode: client.status_code,
  }
}

function subjectSummary(person: ConsentInsightPersonRow): ConsentInsightSubjectSummary {
  return {
    id: person.id,
    displayName: person.display_name,
    role: person.role,
  }
}

export function normalizeConsentInsightSearch(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('pl-PL')
    .trim()
}

export function maskConsentInsightPhone(value: string | null | undefined): string | null {
  if (!value) return null
  const digits = value.replace(/\D/g, '')
  if (!digits) return null
  if (digits.length <= 3) return '•'.repeat(digits.length)
  return `••• ••• ${digits.slice(-3)}`
}

export function consentInsightDefinitionSummary(
  definition: ConsentInsightDefinitionRow,
  versions: ConsentInsightVersionRow[],
): ConsentInsightDefinitionSummary {
  const current = versions.find(version => version.id === definition.current_version_id)
  if (!current) {
    throw new Error('Consent definition current version is missing')
  }
  return {
    id: definition.id,
    code: definition.code,
    context: definition.context,
    displayTitle: current.display_title,
    channel: current.channel,
    currentVersion: { id: current.id, number: current.version },
  }
}

export function buildConsentSubjectInsights(input: {
  people: ConsentInsightPersonRow[]
  clients: ConsentInsightClientRow[]
  decisions: ConsentInsightDecisionRow[]
  requests: ConsentInsightCaptureRequestRow[]
  versions: ConsentInsightVersionRow[]
  now?: Date
}): ConsentSubjectInsightRecord[] {
  const nowTimestamp = input.now?.getTime() ?? Date.now()
  const clientById = new Map(input.clients.map(client => [client.id, client]))
  const versionById = new Map(input.versions.map(version => [version.id, version]))
  const decisionsBySubject = new Map<string, ConsentInsightDecisionRow[]>()
  const requestsBySubject = new Map<string, ConsentInsightCaptureRequestRow[]>()

  for (const decision of input.decisions) {
    const rows = decisionsBySubject.get(decision.subject_person_id) ?? []
    rows.push(decision)
    decisionsBySubject.set(decision.subject_person_id, rows)
  }
  for (const request of input.requests) {
    const rows = requestsBySubject.get(request.subject_person_id) ?? []
    rows.push(request)
    requestsBySubject.set(request.subject_person_id, rows)
  }

  for (const rows of decisionsBySubject.values()) {
    rows.sort((left, right) => (
      timestamp(right.occurred_at) - timestamp(left.occurred_at)
      || right.id.localeCompare(left.id)
    ))
  }
  for (const rows of requestsBySubject.values()) {
    rows.sort((left, right) => (
      timestamp(right.created_at) - timestamp(left.created_at)
      || right.id.localeCompare(left.id)
    ))
  }

  const result: ConsentSubjectInsightRecord[] = []
  for (const person of input.people) {
    const client = clientById.get(person.client_id)
    if (!client) continue

    const subjectDecisions = decisionsBySubject.get(person.id) ?? []
    const subjectRequests = requestsBySubject.get(person.id) ?? []
    const latestDecision = subjectDecisions[0] ?? null
    const lastRequest = subjectRequests[0] ?? null
    const lastRequestExpired = Boolean(
      lastRequest
      && activeRequestStatuses.has(lastRequest.status)
      && timestamp(lastRequest.expires_at) <= nowTimestamp,
    )
    const pendingRequest = lastRequest
      && activeRequestStatuses.has(lastRequest.status)
      && !lastRequestExpired
      && (!latestDecision || newerThan(lastRequest.created_at, latestDecision.occurred_at))
      ? lastRequest
      : null
    const fallbackRequestDecision = !latestDecision && lastRequest
      ? requestDecision(lastRequest)
      : null

    let status: ConsentInsightSubjectStatus = 'no_decision'
    if (pendingRequest) status = 'pending'
    else if (latestDecision) status = latestDecision.decision
    else if (fallbackRequestDecision) status = fallbackRequestDecision

    const matchingDecisionRequest = latestDecision
      ? matchingCaptureRequestForDecision(subjectRequests, latestDecision)
      : null
    const stateRequest = pendingRequest ?? matchingDecisionRequest ?? (
      fallbackRequestDecision ? lastRequest : null
    )
    const stateVersionId = pendingRequest?.definition_version_id
      ?? latestDecision?.definition_version_id
      ?? stateRequest?.definition_version_id
      ?? null
    const source = pendingRequest || fallbackRequestDecision
      ? 'sms_verification'
      : latestDecision?.source ?? null
    const method = latestDecision
      ? metadataMethod(latestDecision.metadata)
        ?? (matchingDecisionRequest ? 'sms_otp' : null)
      : stateRequest
        ? 'sms_otp'
        : null
    const maskedPhone = maskConsentInsightPhone(
      lastRequest?.phone_e164
      ?? latestDecision?.contact_value
      ?? person.phone
      ?? client.primary_phone,
    )
    const evidencePresent = hasEvidence(latestDecision?.evidence_reference)
      || Boolean(
        stateRequest
        && decidedRequestStatuses.has(stateRequest.status)
        && hasEvidence(stateRequest.evidence_reference),
      )
    const lastActivityAt = latestTimestamp([
      latestDecision?.occurred_at,
      lastRequest?.created_at,
      lastRequest?.updated_at,
      lastRequest?.sent_at,
      lastRequest?.delivered_at,
      lastRequest?.opened_at,
      lastRequest?.verified_at,
      lastRequest?.decided_at,
      lastRequest?.cancelled_at,
      lastRequestExpired ? lastRequest?.expires_at : null,
    ])

    const item: ConsentInsightClientItem = {
      client: clientSummary(client),
      subject: subjectSummary(person),
      status,
      version: versionSummary(versionById, stateVersionId),
      source,
      method,
      maskedPhone,
      latestDecision: latestDecision
        ? {
            id: latestDecision.id,
            decision: latestDecision.decision,
            occurredAt: latestDecision.occurred_at,
          }
        : null,
      lastRequest: lastRequest
        ? {
            id: lastRequest.id,
            intent: lastRequest.intent,
            status: lastRequestExpired ? 'expired' : lastRequest.status,
            provider: lastRequest.provider,
            deliveryStatus: lastRequest.delivery_status,
            expiresAt: lastRequest.expires_at,
            createdAt: lastRequest.created_at,
            updatedAt: lastRequest.updated_at,
            sentAt: lastRequest.sent_at,
            deliveredAt: lastRequest.delivered_at,
            openedAt: lastRequest.opened_at,
            verifiedAt: lastRequest.verified_at,
            decidedAt: lastRequest.decided_at,
            cancelledAt: lastRequest.cancelled_at,
          }
        : null,
      evidencePresent,
      lastActivityAt,
    }

    result.push({
      item,
      searchText: normalizeConsentInsightSearch([
        client.id,
        client.display_name,
        client.status_code,
        client.primary_email,
        client.primary_phone,
        person.id,
        person.display_name,
        person.role,
        person.email,
        person.phone,
        status,
        source,
        method,
        lastRequest?.id,
        lastRequestExpired ? 'expired' : lastRequest?.status,
      ].filter(Boolean).join(' ')),
    })
  }

  return result.sort((left, right) => (
    timestamp(right.item.lastActivityAt) - timestamp(left.item.lastActivityAt)
    || left.item.client.displayName.localeCompare(right.item.client.displayName, 'pl')
    || left.item.subject.displayName.localeCompare(right.item.subject.displayName, 'pl')
    || left.item.subject.id.localeCompare(right.item.subject.id)
  ))
}

export function inConsentInsightRange(
  value: string | null,
  range: ConsentInsightRange,
): boolean {
  if (!range.dateFrom && !range.dateTo) return true
  if (!value) return false
  const valueTimestamp = timestamp(value)
  if (range.dateFrom && valueTimestamp < timestamp(range.dateFrom)) return false
  if (range.dateTo && valueTimestamp > timestamp(range.dateTo)) return false
  return true
}

export function filterConsentSubjectInsights(
  records: ConsentSubjectInsightRecord[],
  filters: ConsentInsightRange & {
    search: string | null
    status: ConsentInsightSubjectStatus | null
  },
): ConsentSubjectInsightRecord[] {
  const search = filters.search ? normalizeConsentInsightSearch(filters.search) : null
  return records.filter(record => (
    (!search || record.searchText.includes(search))
    && (!filters.status || record.item.status === filters.status)
    && inConsentInsightRange(record.item.lastActivityAt, filters)
  ))
}

export function consentInsightCounts(
  records: ConsentSubjectInsightRecord[],
): ConsentInsightCounts {
  const counts: ConsentInsightCounts = {
    total: records.length,
    granted: 0,
    declined: 0,
    withdrawn: 0,
    pending: 0,
    noDecision: 0,
  }
  for (const { item } of records) {
    if (item.status === 'no_decision') counts.noDecision += 1
    else counts[item.status] += 1
  }
  return counts
}

function dailyTrendPoint(date: string): ConsentInsightDailyTrendPoint {
  return { date, granted: 0, declined: 0, withdrawn: 0, requests: 0 }
}

function statusReached(
  request: ConsentInsightCaptureRequestRow,
  statuses: Set<ConsentCaptureRequestStatus>,
  timestampValue: string | null,
): boolean {
  return Boolean(timestampValue) || statuses.has(request.status)
}

export function aggregateConsentInsightStatistics(input: {
  records: ConsentSubjectInsightRecord[]
  decisions: ConsentInsightDecisionRow[]
  requests: ConsentInsightCaptureRequestRow[]
  range: ConsentInsightRange
}): {
  totals: ConsentInsightStatisticsTotals
  dailyTrend: ConsentInsightDailyTrendPoint[]
  sources: ConsentInsightSourceCount[]
  smsFunnel: ConsentInsightSmsFunnel
} {
  const counts = consentInsightCounts(input.records)
  const decided = counts.granted + counts.declined + counts.withdrawn
  const subjectIds = new Set(input.records.map(record => record.item.subject.id))
  const daily = new Map<string, ConsentInsightDailyTrendPoint>()
  const sourceCounts = new Map<string, number>()
  const funnel: ConsentInsightSmsFunnel = {
    requested: 0,
    sent: 0,
    delivered: 0,
    verified: 0,
    decided: 0,
  }

  for (const decision of input.decisions) {
    if (
      !subjectIds.has(decision.subject_person_id)
      || !inConsentInsightRange(decision.occurred_at, input.range)
    ) continue
    const date = decision.occurred_at.slice(0, 10)
    const point = daily.get(date) ?? dailyTrendPoint(date)
    point[decision.decision] += 1
    daily.set(date, point)
    sourceCounts.set(
      decision.source,
      (sourceCounts.get(decision.source) ?? 0) + 1,
    )
  }

  for (const request of input.requests) {
    if (
      !subjectIds.has(request.subject_person_id)
      || !inConsentInsightRange(request.created_at, input.range)
    ) continue
    funnel.requested += 1
    if (statusReached(request, sentRequestStatuses, request.sent_at)) funnel.sent += 1
    if (statusReached(request, deliveredRequestStatuses, request.delivered_at)) funnel.delivered += 1
    if (statusReached(request, verifiedRequestStatuses, request.verified_at)) funnel.verified += 1
    if (
      Boolean(request.decided_at)
      || Boolean(request.decision)
      || decidedRequestStatuses.has(request.status)
    ) funnel.decided += 1

    const date = request.created_at.slice(0, 10)
    const point = daily.get(date) ?? dailyTrendPoint(date)
    point.requests += 1
    daily.set(date, point)
  }

  return {
    totals: {
      ...counts,
      uniqueSubjects: counts.total,
      decided,
      grantRate: decided ? Number((counts.granted / decided).toFixed(6)) : 0,
    },
    dailyTrend: Array.from(daily.values()).sort((left, right) => left.date.localeCompare(right.date)),
    sources: Array.from(sourceCounts, ([source, count]) => ({ source, count }))
      .sort((left, right) => right.count - left.count || left.source.localeCompare(right.source)),
    smsFunnel: funnel,
  }
}

function requestMethod(request: ConsentInsightCaptureRequestRow): string {
  return metadataMethod(request.metadata) ?? 'sms_otp'
}

function captureEventStatus(
  eventType: string,
  request: ConsentInsightCaptureRequestRow,
): string {
  const normalizedStatuses: Record<string, string> = {
    requested: 'pending',
    sms_queued: 'queued',
    sms_sent: 'sent',
    sms_delivered: 'delivered',
    otp_verified: 'verified',
    cancelled_by_replacement: 'cancelled',
    sms_failed: 'failed',
    decision_recorded: request.status,
  }
  return normalizedStatuses[eventType] ?? eventType
}

function auditEventSearchText(event: ConsentInsightAuditEvent): string {
  return normalizeConsentInsightSearch([
    event.id,
    event.eventType,
    event.kind,
    event.source,
    event.method,
    event.status,
    event.requestId,
    event.client?.id,
    event.client?.displayName,
    event.client?.statusCode,
    event.subject?.id,
    event.subject?.displayName,
    event.subject?.role,
  ].filter(Boolean).join(' '))
}

function auditEventMatchesStatus(event: ConsentInsightAuditEvent, status: string | null): boolean {
  if (!status) return true
  if (event.kind === status || event.eventType === status || event.status === status) return true
  if (status === 'granted' && (event.eventType === 'accepted' || event.status === 'accepted')) {
    return true
  }
  if (status === 'pending' && event.status) {
    return activeRequestStatuses.has(event.status as ConsentCaptureRequestStatus)
  }
  return false
}

export function buildConsentInsightAuditEvents(input: {
  clients: ConsentInsightClientRow[]
  people: ConsentInsightPersonRow[]
  versions: ConsentInsightVersionRow[]
  decisions: ConsentInsightDecisionRow[]
  requests: ConsentInsightCaptureRequestRow[]
  captureEvents: ConsentInsightCaptureEventRow[]
  filters: ConsentInsightRange & {
    search: string | null
    status: string | null
  }
}): ConsentInsightAuditEvent[] {
  const clientById = new Map(input.clients.map(client => [client.id, client]))
  const personById = new Map(input.people.map(person => [person.id, person]))
  const versionById = new Map(input.versions.map(version => [version.id, version]))
  const requestById = new Map(input.requests.map(request => [request.id, request]))
  const requestsBySubject = new Map<string, ConsentInsightCaptureRequestRow[]>()
  for (const request of input.requests) {
    const rows = requestsBySubject.get(request.subject_person_id) ?? []
    rows.push(request)
    requestsBySubject.set(request.subject_person_id, rows)
  }

  const events: ConsentInsightAuditEvent[] = []
  for (const decision of input.decisions) {
    if (!inConsentInsightRange(decision.occurred_at, input.filters)) continue
    const client = clientById.get(decision.client_id)
    const person = personById.get(decision.subject_person_id)
    const matchingRequest = matchingCaptureRequestForDecision(
      requestsBySubject.get(decision.subject_person_id) ?? [],
      decision,
    )
    events.push({
      id: `decision:${decision.id}`,
      kind: 'decision',
      eventType: decision.decision,
      occurredAt: decision.occurred_at,
      client: client ? clientSummary(client) : null,
      subject: person ? subjectSummary(person) : null,
      requestId: matchingRequest?.id ?? null,
      version: versionSummary(versionById, decision.definition_version_id),
      source: decision.source,
      method: metadataMethod(decision.metadata)
        ?? (matchingRequest ? requestMethod(matchingRequest) : null),
      status: decision.decision,
      evidencePresent: hasEvidence(decision.evidence_reference)
        || hasEvidence(matchingRequest?.evidence_reference),
      actorUserId: decision.recorded_by_user_id,
    })
  }

  for (const captureEvent of input.captureEvents) {
    if (!inConsentInsightRange(captureEvent.occurred_at, input.filters)) continue
    const request = requestById.get(captureEvent.request_id)
    if (!request) continue
    const client = clientById.get(request.client_id)
    const person = personById.get(request.subject_person_id)
    events.push({
      id: `capture:${captureEvent.id}`,
      kind: 'capture',
      eventType: captureEvent.event_type,
      occurredAt: captureEvent.occurred_at,
      client: client ? clientSummary(client) : null,
      subject: person ? subjectSummary(person) : null,
      requestId: request.id,
      version: versionSummary(versionById, request.definition_version_id),
      source: 'sms_verification',
      method: requestMethod(request),
      status: captureEventStatus(captureEvent.event_type, request),
      // Evidence is attached when the request reaches its final decision.
      // Do not retroactively mark earlier delivery/open/OTP events as complete
      // merely because the request was decided later.
      evidencePresent: captureEvent.event_type === 'decision_recorded'
        && hasEvidence(request.evidence_reference),
      actorUserId: captureEvent.actor_user_id,
    })
  }

  const search = input.filters.search
    ? normalizeConsentInsightSearch(input.filters.search)
    : null
  return events
    .filter(event => (
      (!search || auditEventSearchText(event).includes(search))
      && auditEventMatchesStatus(event, input.filters.status)
    ))
    .sort((left, right) => (
      timestamp(right.occurredAt) - timestamp(left.occurredAt)
      || right.id.localeCompare(left.id)
    ))
}
