export type ConsentInsightsView = 'clients' | 'statistics' | 'events'

export type ConsentInsightDecision = 'granted' | 'declined' | 'withdrawn'

export type ConsentInsightSubjectStatus =
  | ConsentInsightDecision
  | 'pending'
  | 'no_decision'

export type ConsentCaptureIntent = 'collect' | 'withdraw'

export type ConsentCaptureRequestStatus =
  | 'pending'
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'opened'
  | 'verified'
  | 'accepted'
  | 'declined'
  | 'withdrawn'
  | 'expired'
  | 'cancelled'
  | 'failed'

export interface ConsentInsightsFilters {
  search: string | null
  status: string | null
  dateFrom: string | null
  dateTo: string | null
}

export interface ConsentInsightsPagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface ConsentInsightVersionSummary {
  id: string
  number: number
}

export interface ConsentInsightDefinitionSummary {
  id: string
  code: string
  context: string
  displayTitle: string
  channel: string
  currentVersion: ConsentInsightVersionSummary
}

export interface ConsentInsightClientSummary {
  id: string
  displayName: string
  statusCode: string
}

export interface ConsentInsightSubjectSummary {
  id: string
  displayName: string
  role: string
}

export interface ConsentInsightDecisionSummary {
  id: string
  decision: ConsentInsightDecision
  occurredAt: string
}

export interface ConsentInsightCaptureRequestSummary {
  id: string
  intent: ConsentCaptureIntent
  status: ConsentCaptureRequestStatus
  provider: string | null
  deliveryStatus: string | null
  expiresAt: string
  createdAt: string
  updatedAt: string
  sentAt: string | null
  deliveredAt: string | null
  openedAt: string | null
  verifiedAt: string | null
  decidedAt: string | null
  cancelledAt: string | null
}

export interface ConsentInsightClientItem {
  client: ConsentInsightClientSummary
  subject: ConsentInsightSubjectSummary
  status: ConsentInsightSubjectStatus
  version: ConsentInsightVersionSummary | null
  source: string | null
  method: string | null
  maskedPhone: string | null
  latestDecision: ConsentInsightDecisionSummary | null
  lastRequest: ConsentInsightCaptureRequestSummary | null
  evidencePresent: boolean
  lastActivityAt: string | null
}

export interface ConsentInsightCounts {
  total: number
  granted: number
  declined: number
  withdrawn: number
  pending: number
  noDecision: number
}

export interface ConsentInsightsClientsResponse {
  view: 'clients'
  definition: ConsentInsightDefinitionSummary
  filters: ConsentInsightsFilters
  counts: ConsentInsightCounts
  pagination: ConsentInsightsPagination
  items: ConsentInsightClientItem[]
}

export interface ConsentInsightStatisticsTotals extends ConsentInsightCounts {
  uniqueSubjects: number
  decided: number
  /** Granted / decided, represented as a number between 0 and 1. */
  grantRate: number
}

export interface ConsentInsightDailyTrendPoint {
  date: string
  granted: number
  declined: number
  withdrawn: number
  requests: number
}

export interface ConsentInsightSourceCount {
  source: string
  count: number
}

export interface ConsentInsightSmsFunnel {
  requested: number
  sent: number
  delivered: number
  verified: number
  decided: number
}

export interface ConsentInsightsStatisticsResponse {
  view: 'statistics'
  definition: ConsentInsightDefinitionSummary
  filters: ConsentInsightsFilters
  totals: ConsentInsightStatisticsTotals
  dailyTrend: ConsentInsightDailyTrendPoint[]
  sources: ConsentInsightSourceCount[]
  smsFunnel: ConsentInsightSmsFunnel
}

export type ConsentInsightAuditEventKind = 'decision' | 'capture'

export interface ConsentInsightAuditEvent {
  id: string
  kind: ConsentInsightAuditEventKind
  eventType: string
  occurredAt: string
  client: ConsentInsightClientSummary | null
  subject: ConsentInsightSubjectSummary | null
  requestId: string | null
  version: ConsentInsightVersionSummary | null
  source: string
  method: string | null
  status: string | null
  evidencePresent: boolean
  actorUserId: string | null
}

export interface ConsentInsightsEventsResponse {
  view: 'events'
  definition: ConsentInsightDefinitionSummary
  filters: ConsentInsightsFilters
  pagination: ConsentInsightsPagination
  items: ConsentInsightAuditEvent[]
}

export type ConsentInsightsResponse =
  | ConsentInsightsClientsResponse
  | ConsentInsightsStatisticsResponse
  | ConsentInsightsEventsResponse
