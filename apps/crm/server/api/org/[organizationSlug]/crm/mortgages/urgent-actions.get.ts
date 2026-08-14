import { createError } from 'h3'
import { requireCrmSession, throwDbError } from '~~/server/utils/crm'
import {
  countDeliveredRecipients,
  mortgageUrgentActionCounts,
  requiredMortgageRecipientIds,
  resolveMortgageUrgentActions,
  type MortgageUrgentActionSource,
  type MortgageUrgentArtifact,
} from '~~/server/utils/mortgage-urgent-actions'

type Row = Record<string, any>

const processSelect = [
  'case_id',
  'application_id',
  'stage',
  'decision_due_at',
  'decision_received_at',
  'closed_at',
].join(', ')

const artifactSelect = [
  'id',
  'case_id',
  'application_id',
  'kind',
  'version',
  'received_at',
  'valid_until',
  'decision_outcome',
].join(', ')

function uniqueValues(rows: Row[], key: string) {
  return [...new Set(rows.flatMap((row) => {
    const value = row[key]
    return value ? [String(value)] : []
  }))]
}

function latestArtifacts(rows: Row[]) {
  const latest = new Map<string, Row>()
  for (const row of rows) {
    const key = `${String(row.application_id)}:${String(row.kind)}`
    const current = latest.get(key)
    if (!current || Number(row.version) > Number(current.version)) latest.set(key, row)
  }
  return latest
}

function artifactSummary(row: Row | undefined): MortgageUrgentArtifact | null {
  if (!row) return null
  const kind = String(row.kind)
  if (kind !== 'esis' && kind !== 'credit_decision') return null
  const outcome = String(row.decision_outcome ?? '')
  return {
    id: String(row.id),
    kind,
    receivedAt: row.received_at ? String(row.received_at) : null,
    validUntil: row.valid_until ? String(row.valid_until) : null,
    decisionOutcome: outcome === 'positive' || outcome === 'negative' ? outcome : null,
  }
}

function values(rows: Row[], key: string) {
  return rows.flatMap((row) => {
    const value = row[key]
    return value ? [String(value)] : []
  })
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const generatedAt = new Date()

  const processesResult = await session.dataApi
    .from('crm_mortgage_application_processes')
    .select(processSelect)
    .eq('organization_id', session.organizationId)
    .is('closed_at', null)
    .neq('stage', 'completed')
    .neq('stage', 'closed')
    .order('updated_at', { ascending: false })
    .limit(1_000)
  throwDbError(processesResult.error)

  const processes = (processesResult.data ?? []) as Row[]
  if (processes.length === 1_000) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Too many active mortgage processes to calculate a complete dashboard',
    })
  }
  if (!processes.length) {
    return {
      data: [],
      counts: { total: 0, critical: 0, warning: 0, info: 0 },
      generatedAt: generatedAt.toISOString(),
    }
  }

  const applicationIds = uniqueValues(processes, 'application_id')
  const caseIds = uniqueValues(processes, 'case_id')
  const preApplicationCaseIds = uniqueValues(
    processes.filter(process => String(process.stage) === 'pre_application'),
    'case_id',
  )
  const frozenPartyApplicationIds = uniqueValues(
    processes.filter(process => String(process.stage) !== 'pre_application'),
    'application_id',
  )
  const [applicationsResult, casesResult, artifactsResult, caseClientsResult, partiesResult, consentsResult] = await Promise.all([
    session.dataApi
      .from('crm_case_bank_applications')
      .select('submission_id, case_id, case_item_id, bank_id')
      .eq('organization_id', session.organizationId)
      .in('submission_id', applicationIds),
    session.dataApi
      .from('crm_cases')
      .select('id, title, owner_user_id')
      .eq('organization_id', session.organizationId)
      .in('id', caseIds),
    session.dataApi
      .from('crm_mortgage_application_artifacts')
      .select(artifactSelect)
      .eq('organization_id', session.organizationId)
      .in('application_id', applicationIds)
      .order('version', { ascending: false })
      .limit(5_000),
    preApplicationCaseIds.length
      ? session.dataApi
          .from('crm_case_clients')
          .select('case_id, client_id')
          .eq('organization_id', session.organizationId)
          .in('case_id', preApplicationCaseIds)
      : Promise.resolve({ data: [], error: null }),
    frozenPartyApplicationIds.length
      ? session.dataApi
          .from('crm_mortgage_application_parties')
          .select('case_id, application_id, client_id, role, frozen_at')
          .eq('organization_id', session.organizationId)
          .in('application_id', frozenPartyApplicationIds)
      : Promise.resolve({ data: [], error: null }),
    frozenPartyApplicationIds.length
      ? session.dataApi
          .from('crm_mortgage_early_decision_consents')
          .select('id, application_id, client_id, decision, captured_at, created_at')
          .eq('organization_id', session.organizationId)
          .in('application_id', frozenPartyApplicationIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  throwDbError(applicationsResult.error)
  throwDbError(casesResult.error)
  throwDbError(artifactsResult.error)
  throwDbError(caseClientsResult.error)
  throwDbError(partiesResult.error)
  throwDbError(consentsResult.error)

  const applications = (applicationsResult.data ?? []) as Row[]
  const cases = (casesResult.data ?? []) as Row[]
  const artifacts = (artifactsResult.data ?? []) as Row[]
  const caseClients = (caseClientsResult.data ?? []) as Row[]
  const applicationParties = (partiesResult.data ?? []) as Row[]
  const applicationConsents = (consentsResult.data ?? []) as Row[]
  if (artifacts.length === 5_000) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Too many mortgage artifacts to calculate a complete dashboard',
    })
  }
  const itemIds = uniqueValues(applications, 'case_item_id')
  const bankIds = uniqueValues(applications, 'bank_id')
  const currentArtifactByKey = latestArtifacts(artifacts)
  const currentArtifactIds = [...currentArtifactByKey.values()].map(row => String(row.id))

  const [caseItemsResult, banksResult, deliveriesResult] = await Promise.all([
    itemIds.length
      ? session.dataApi
          .from('crm_case_items')
          .select('id, owner_user_id')
          .eq('organization_id', session.organizationId)
          .in('id', itemIds)
      : Promise.resolve({ data: [], error: null }),
    bankIds.length
      ? session.dataApi
          .from('mortgage_banks')
          .select('id, name')
          .in('id', bankIds)
      : Promise.resolve({ data: [], error: null }),
    currentArtifactIds.length
      ? session.dataApi
          .from('crm_mortgage_artifact_deliveries')
          .select('artifact_id, application_id, recipient_client_id, delivered_at')
          .eq('organization_id', session.organizationId)
          .in('artifact_id', currentArtifactIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  throwDbError(caseItemsResult.error)
  throwDbError(banksResult.error)
  throwDbError(deliveriesResult.error)

  const applicationById = new Map(applications.map(row => [String(row.submission_id), row]))
  const caseById = new Map(cases.map(row => [String(row.id), row]))
  const itemById = new Map(((caseItemsResult.data ?? []) as Row[]).map(row => [String(row.id), row]))
  const bankById = new Map(((banksResult.data ?? []) as Row[]).map(row => [String(row.id), row]))
  const clientsByCase = Map.groupBy(caseClients, row => String(row.case_id))
  const partiesByApplication = Map.groupBy(applicationParties, row => String(row.application_id))
  const consentsByApplication = Map.groupBy(applicationConsents, row => String(row.application_id))
  const deliveriesByArtifact = Map.groupBy(
    (deliveriesResult.data ?? []) as Row[],
    row => String(row.artifact_id),
  )

  const sources = processes.flatMap<MortgageUrgentActionSource>((process) => {
    const applicationId = String(process.application_id)
    const application = applicationById.get(applicationId)
    const caseRow = caseById.get(String(process.case_id))
    if (!application || !caseRow) return []

    const item = itemById.get(String(application.case_item_id))
    const ownsProcess = String(item?.owner_user_id ?? '') === session.userId
      || String(caseRow.owner_user_id ?? '') === session.userId
    if (session.role !== 'admin' && !ownsProcess) return []

    const esisArtifact = artifactSummary(currentArtifactByKey.get(`${applicationId}:esis`))
    const decisionArtifact = artifactSummary(currentArtifactByKey.get(`${applicationId}:credit_decision`))
    const caseRecipients = clientsByCase.get(String(process.case_id)) ?? []
    const frozenParties = partiesByApplication.get(applicationId) ?? []
    const consents = consentsByApplication.get(applicationId) ?? []
    const esisDeliveries = esisArtifact ? deliveriesByArtifact.get(esisArtifact.id) ?? [] : []
    const decisionDeliveries = decisionArtifact ? deliveriesByArtifact.get(decisionArtifact.id) ?? [] : []
    const bank = bankById.get(String(application.bank_id))
    const requiredRecipientIds = requiredMortgageRecipientIds(
      String(process.stage),
      values(caseRecipients, 'client_id'),
      values(frozenParties, 'client_id'),
    )
    const effectiveConsentByClient = new Map<string, Row>()
    for (const consent of consents) {
      const clientId = String(consent.client_id ?? '')
      const capturedAt = Date.parse(String(consent.captured_at ?? ''))
      if (!requiredRecipientIds.includes(clientId)
        || !Number.isFinite(capturedAt)
        || capturedAt > generatedAt.getTime()) continue
      const current = effectiveConsentByClient.get(clientId)
      const consentOrder = `${String(consent.captured_at ?? '')}:${String(consent.created_at ?? '')}:${String(consent.id ?? '')}`
      const currentOrder = current
        ? `${String(current.captured_at ?? '')}:${String(current.created_at ?? '')}:${String(current.id ?? '')}`
        : ''
      if (!current || consentOrder > currentOrder) effectiveConsentByClient.set(clientId, consent)
    }

    return [{
      caseId: String(process.case_id),
      caseTitle: String(caseRow.title || 'Sprawa hipoteczna'),
      applicationId,
      bankId: application.bank_id ? String(application.bank_id) : null,
      bankName: String(bank?.name || 'Bank'),
      stage: String(process.stage),
      decisionDueAt: process.decision_due_at ? String(process.decision_due_at) : null,
      decisionReceivedAt: process.decision_received_at ? String(process.decision_received_at) : null,
      requiredRecipientCount: requiredRecipientIds.length,
      esisDeliveryCount: countDeliveredRecipients(
        requiredRecipientIds,
        values(esisDeliveries, 'recipient_client_id'),
      ),
      decisionDeliveryCount: countDeliveredRecipients(
        requiredRecipientIds,
        values(decisionDeliveries, 'recipient_client_id'),
      ),
      earlyDecisionConsentCount: [...effectiveConsentByClient.values()]
        .filter(consent => String(consent.decision) === 'granted').length,
      esisArtifact,
      decisionArtifact,
    }]
  })

  const actions = resolveMortgageUrgentActions(sources, {
    now: generatedAt,
    organizationSlug: session.organizationSlug,
  })

  return {
    data: actions.slice(0, 12),
    counts: mortgageUrgentActionCounts(actions),
    generatedAt: generatedAt.toISOString(),
  }
})
