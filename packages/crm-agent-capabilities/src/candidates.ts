import type { AgentPrincipal } from './principal.ts'
import type {
  ApplicationCandidate,
  CaseCandidate,
  GetCaseMatchContextInput,
  SearchCaseCandidatesInput,
} from './schemas.ts'
import {
  dataApiRecord,
  dataApiRows,
  requireDataApiResult,
  type DataApiClientLike,
  type DataApiQueryLike,
  type DataApiRow,
} from './client.ts'
import { deriveCapabilityScope } from './principal.ts'
import { redactSensitiveText } from './redaction.ts'
import {
  CaseCandidateSchema,
  GetCaseMatchContextInputSchema,
  SearchCaseCandidatesInputSchema,
} from './schemas.ts'

const UUID_SCHEMA = /^(?:[0-9a-f]{8})-(?:[0-9a-f]{4})-(?:[1-8][0-9a-f]{3})-(?:[89ab][0-9a-f]{3})-(?:[0-9a-f]{12})$/iu

function identifier(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return UUID_SCHEMA.test(normalized) ? normalized : null
}

function text(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null
  const normalized = redactSensitiveText(value.trim().replace(/\s+/gu, ' '))
  return normalized ? normalized.slice(0, maximum) : null
}

function unique(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

function organizationQuery(
  dataApi: DataApiClientLike,
  table: string,
  columns: string,
  organizationId: string,
): DataApiQueryLike {
  return dataApi
    .from(table)
    .select(columns)
    .eq('organization_id', organizationId)
}

function ownerScopedQuery(
  query: DataApiQueryLike,
  ownerUserId: string | null,
): DataApiQueryLike {
  return ownerUserId ? query.eq('owner_user_id', ownerUserId) : query
}

function orderedIds(primary: readonly string[], secondary: readonly string[]): string[] {
  return unique([...primary, ...secondary])
}

interface HydrateCaseCandidatesInput {
  applicationId?: string
  caseIds: string[]
  dataApi: DataApiClientLike
  limit: number
  principal: AgentPrincipal
}

async function hydrateCaseCandidates({
  applicationId,
  caseIds,
  dataApi,
  limit,
  principal,
}: HydrateCaseCandidatesInput): Promise<CaseCandidate[]> {
  if (!caseIds.length) return []

  const scope = deriveCapabilityScope(principal)
  const boundedCaseIds = caseIds.slice(0, 24)
  let casesQuery = organizationQuery(
    dataApi,
    'crm_cases',
    'id, title, status_code, owner_user_id, updated_at',
    scope.organizationId,
  ).in('id', boundedCaseIds)
  casesQuery = ownerScopedQuery(casesQuery, scope.ownerUserId)
  const caseRows = dataApiRows(await requireDataApiResult(casesQuery, 'case candidate lookup failed'))
  const casesById = new Map(caseRows.flatMap((row) => {
    const id = identifier(row.id)
    return id ? [[id, row] as const] : []
  }))
  const eligibleCaseIds = boundedCaseIds.filter(id => casesById.has(id))
  if (!eligibleCaseIds.length) return []

  let applicationsQuery = organizationQuery(
    dataApi,
    'crm_case_bank_applications',
    'submission_id, case_id, bank_id, offer_id, slot',
    scope.organizationId,
  ).in('case_id', eligibleCaseIds)
  if (applicationId) applicationsQuery = applicationsQuery.eq('submission_id', applicationId)

  const [caseLinksValue, applicationsValue] = await Promise.all([
    requireDataApiResult(
      organizationQuery(
        dataApi,
        'crm_case_clients',
        'case_id, client_id, is_primary',
        scope.organizationId,
      ).in('case_id', eligibleCaseIds),
      'case applicant lookup failed',
    ),
    requireDataApiResult(applicationsQuery, 'bank application lookup failed'),
  ])
  const caseLinks = dataApiRows(caseLinksValue)
  const applicationRows = dataApiRows(applicationsValue)
  const clientIds = unique(caseLinks.map(row => identifier(row.client_id)))
  const submissionIds = unique(applicationRows.map(row => identifier(row.submission_id)))
  const offerIds = unique(applicationRows.map(row => identifier(row.offer_id)))

  let clientsPromise: Promise<unknown> = Promise.resolve([])
  if (clientIds.length) {
    let clientsQuery = organizationQuery(
      dataApi,
      'crm_clients',
      'id, display_name, owner_user_id',
      scope.organizationId,
    ).in('id', clientIds)
    clientsQuery = ownerScopedQuery(clientsQuery, scope.ownerUserId)
    clientsPromise = requireDataApiResult(clientsQuery, 'applicant lookup failed')
  }

  const [clientsValue, submissionsValue, offersValue] = await Promise.all([
    clientsPromise,
    submissionIds.length
      ? requireDataApiResult(
          organizationQuery(
            dataApi,
            'crm_item_submissions',
            'id, status_code, external_reference, submitted_at, decision_at, updated_at',
            scope.organizationId,
          ).in('id', submissionIds),
          'application status lookup failed',
        )
      : Promise.resolve([]),
    offerIds.length
      ? requireDataApiResult(
          organizationQuery(
            dataApi,
            'crm_case_offer_snapshots',
            'id, case_id, bank_id, bank_name, product_name',
            scope.organizationId,
          ).in('id', offerIds),
          'bank snapshot lookup failed',
        )
      : Promise.resolve([]),
  ])

  const clientsById = new Map(dataApiRows(clientsValue).flatMap((row) => {
    const id = identifier(row.id)
    return id ? [[id, row] as const] : []
  }))
  const submissionsById = new Map(dataApiRows(submissionsValue).flatMap((row) => {
    const id = identifier(row.id)
    return id ? [[id, row] as const] : []
  }))
  const offersById = new Map(dataApiRows(offersValue).flatMap((row) => {
    const id = identifier(row.id)
    return id ? [[id, row] as const] : []
  }))

  const linksByCaseId = new Map<string, DataApiRow[]>()
  for (const link of caseLinks) {
    const caseId = identifier(link.case_id)
    if (!caseId || !casesById.has(caseId)) continue
    const group = linksByCaseId.get(caseId) ?? []
    group.push(link)
    linksByCaseId.set(caseId, group)
  }

  const applicationsByCaseId = new Map<string, DataApiRow[]>()
  for (const application of applicationRows) {
    const caseId = identifier(application.case_id)
    if (!caseId || !casesById.has(caseId)) continue
    const group = applicationsByCaseId.get(caseId) ?? []
    group.push(application)
    applicationsByCaseId.set(caseId, group)
  }

  return eligibleCaseIds.flatMap((caseId) => {
    const crmCase = casesById.get(caseId)
    const caseTitle = text(crmCase?.title, 300)
    const caseStatusCode = text(crmCase?.status_code, 80)
    const updatedAt = text(crmCase?.updated_at, 100)
    if (!crmCase || !caseTitle || !caseStatusCode || !updatedAt) return []

    const applicantDisplayNames = unique(
      (linksByCaseId.get(caseId) ?? [])
        .sort((left, right) => Number(Boolean(right.is_primary)) - Number(Boolean(left.is_primary)))
        .map(link => identifier(link.client_id))
        .map(clientId => text(clientId ? clientsById.get(clientId)?.display_name : null, 300)),
    ).slice(0, 20)

    const applications: ApplicationCandidate[] = (applicationsByCaseId.get(caseId) ?? [])
      .sort((left, right) => Number(left.slot ?? 99) - Number(right.slot ?? 99))
      .flatMap((application) => {
        const submissionId = identifier(application.submission_id)
        const bankId = identifier(application.bank_id)
        const offerId = identifier(application.offer_id)
        const submission = submissionId ? submissionsById.get(submissionId) : undefined
        const offer = offerId ? offersById.get(offerId) : undefined
        const statusCode = text(submission?.status_code, 80)
        const applicationUpdatedAt = text(submission?.updated_at, 100)
        if (!submissionId || !bankId || !submission || !statusCode || !applicationUpdatedAt) return []
        return [{
          applicationId: submissionId,
          bankId,
          bankName: text(offer?.bank_name, 300),
          productName: text(offer?.product_name, 300),
          statusCode,
          externalReference: text(submission.external_reference, 200),
          submittedAt: text(submission.submitted_at, 100),
          decisionAt: text(submission.decision_at, 100),
          updatedAt: applicationUpdatedAt,
        }]
      })
      .slice(0, 24)

    if (applicationId && !applications.some(application => application.applicationId === applicationId)) {
      return []
    }

    return [CaseCandidateSchema.parse({
      caseId,
      caseTitle,
      caseStatusCode,
      updatedAt,
      applicantDisplayNames,
      applications,
    })]
  }).slice(0, limit)
}

export interface SearchCaseCandidatesArgs extends SearchCaseCandidatesInput {
  dataApi: DataApiClientLike
  principal: AgentPrincipal
}

/**
 * Searches the existing CRM index, then re-loads every hit through explicit
 * organization and (for bank mail) owner filters before returning an allowlist
 * DTO. Raw Omni Search records are never exposed to the caller.
 */
export async function searchCaseCandidates({
  dataApi,
  principal,
  ...rawInput
}: SearchCaseCandidatesArgs): Promise<CaseCandidate[]> {
  const input = SearchCaseCandidatesInputSchema.parse(rawInput)
  const scope = deriveCapabilityScope(principal)
  const searchValue = await requireDataApiResult(
    dataApi.rpc('search_crm_omnisearch', {
      p_organization_id: scope.organizationId,
      p_query: input.query,
      p_limit: input.limit,
    }),
    'CRM candidate search failed',
  )
  const payload = dataApiRecord(searchValue)
  const applicationHits = dataApiRows(payload.documents)
    .filter(row => row.record_type === 'application')
  const directApplicationCaseIds = unique(applicationHits.map(row => identifier(row.case_id)))
  const directCaseIds = unique(dataApiRows(payload.cases).map(row => identifier(row.id)))
  const rawClientIds = unique(dataApiRows(payload.clients).map(row => identifier(row.id)))

  let linkedCaseIds: string[] = []
  if (rawClientIds.length) {
    let clientsQuery = organizationQuery(
      dataApi,
      'crm_clients',
      'id, owner_user_id',
      scope.organizationId,
    ).in('id', rawClientIds)
    clientsQuery = ownerScopedQuery(clientsQuery, scope.ownerUserId)
    const allowedClientIds = unique(
      dataApiRows(await requireDataApiResult(clientsQuery, 'client candidate scope check failed'))
        .map(row => identifier(row.id)),
    )
    if (allowedClientIds.length) {
      linkedCaseIds = unique(dataApiRows(await requireDataApiResult(
        organizationQuery(
          dataApi,
          'crm_case_clients',
          'case_id, client_id',
          scope.organizationId,
        ).in('client_id', allowedClientIds).limit(input.limit * 4),
        'client case lookup failed',
      )).map(row => identifier(row.case_id)))
    }
  }

  const rankedCaseIds = orderedIds(
    directApplicationCaseIds,
    orderedIds(directCaseIds, linkedCaseIds),
  )
  return hydrateCaseCandidates({
    caseIds: rankedCaseIds,
    dataApi,
    limit: input.limit,
    principal,
  })
}

export interface GetCaseMatchContextArgs extends GetCaseMatchContextInput {
  dataApi: DataApiClientLike
  principal: AgentPrincipal
}

export async function getCaseMatchContext({
  dataApi,
  principal,
  ...rawInput
}: GetCaseMatchContextArgs): Promise<CaseCandidate | null> {
  const input = GetCaseMatchContextInputSchema.parse(rawInput)
  const candidates = await hydrateCaseCandidates({
    applicationId: input.applicationId,
    caseIds: [input.caseId],
    dataApi,
    limit: 1,
    principal,
  })
  return candidates[0] ?? null
}
