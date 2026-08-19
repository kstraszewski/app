import { createError, type H3Event } from 'h3'
import { selectPreferredPortalGrantScope } from '../../shared/utils/portal-grant-scope.ts'
import { serverDataBackend } from './data-api'
import {
  buildPortalCaseAction,
  isSafePortalDocumentSummary,
} from './portal-dashboard'
import {
  loadPublicPortalExperts,
  portalExpertScopeKey,
} from './portal-experts'
import {
  loadClientPortalSession,
  publicGrant,
  throwPortalDbError,
  type ClientPortalSession,
  type PortalClientLink,
  type PortalGrant,
} from './portal-auth'
import {
  chunkPortalQueryValues,
  runPortalQueryChunks,
} from './portal-query'

type Row = Record<string, any>

export interface GrantedScope {
  grant: PortalGrant
  link: PortalClientLink
}

interface PersonCaseUnit {
  personId: string
  caseIds: string[]
}

interface ClientCaseUnit {
  organizationId: string
  clientId: string
  caseIds: string[]
}

interface SafeTimelineItem {
  id: string
  kind: 'action' | 'document' | 'message' | 'status' | 'multiform'
  title: string
  body?: string
  createdAt: string
  isNew?: boolean
  author?: {
    name: string
    avatarUrl?: string | null
    role?: 'client' | 'expert'
  }
  action?: {
    kind: 'upload_document' | 'complete_multiform'
    label: string
    to?: string
  }
}

const steps = [
  ['analysis', 'Analiza potrzeb'],
  ['documents', 'Kompletowanie dokumentów'],
  ['banks', 'Analiza banków'],
  ['applications', 'Złożenie wniosków'],
  ['decision', 'Decyzja'],
] as const

function indexById(rows: Row[]): Map<string, Row> {
  return new Map(rows.map(row => [String(row.id), row]))
}

function isNew(createdAt: string): boolean {
  const created = Date.parse(createdAt)
  return Number.isFinite(created) && Date.now() - created < 7 * 24 * 60 * 60 * 1000
}

function progressSteps(progressInput: unknown) {
  const progress = Math.max(0, Math.min(100, Number(progressInput) || 0))
  if (progress >= 100) {
    return steps.map(([id, label]) => ({ id, label, status: 'completed' as const }))
  }
  const currentIndex = Math.min(steps.length - 1, Math.floor(progress / 20))
  return steps.map(([id, label], index) => ({
    id,
    label,
    status: index < currentIndex
      ? 'completed' as const
      : index === currentIndex
        ? 'current' as const
        : 'waiting' as const,
  }))
}

function documentTimeline(document: Row): SafeTimelineItem {
  const verified = Boolean(document.verified_at)
  const received = Boolean(document.received_at)
  const createdAt = String(
    document.verified_at
      ?? document.received_at
      ?? document.updated_at,
  )
  return {
    id: `document:${String(document.id)}`,
    kind: 'document',
    title: verified
      ? `Dokument zweryfikowany: ${String(document.name)}`
      : received
        ? `Dokument odebrany: ${String(document.name)}`
        : `Dokument oczekuje na uzupełnienie: ${String(document.name)}`,
    body: verified
      ? 'Ekspert potwierdził poprawność dokumentu.'
      : received
        ? 'Dokument jest bezpiecznie zapisany i czeka na weryfikację.'
        : 'Ekspert poinformuje Cię, jak bezpiecznie przekazać ten dokument.',
    createdAt,
    isNew: isNew(createdAt),
  }
}

function publicPortalDocument(document: Row) {
  const missing = String(document.status_code) === 'missing'
  const verified = !missing && Boolean(document.verified_at)
  return {
    id: String(document.id),
    name: String(document.name),
    documentType: String(document.document_type),
    status: missing
      ? 'missing' as const
      : verified
        ? 'verified' as const
        : 'received' as const,
    receivedAt: document.received_at ? String(document.received_at) : null,
    verifiedAt: document.verified_at ? String(document.verified_at) : null,
    updatedAt: String(document.updated_at),
    canDownload: !missing && Boolean(document.uploaded_by_client_person_id),
  }
}

async function loadPagedPortalRows(
  fetchPage: (from: number, to: number) => any,
  errorContext: string,
  options: { pageSize?: number, maxRows?: number } = {},
): Promise<Row[]> {
  const pageSize = options.pageSize ?? 500
  const maxRows = options.maxRows ?? 10_000
  const rows: Row[] = []
  let offset = 0

  for (;;) {
    const remaining = maxRows - rows.length
    const requestedRows = Math.min(pageSize, remaining + 1)
    const result = await fetchPage(offset, offset + requestedRows - 1)
    throwPortalDbError(result.error, errorContext)
    const page = (result.data ?? []) as Row[]
    if (rows.length + page.length > maxRows) {
      throw createError({
        statusCode: 503,
        statusMessage: 'Client portal data set is temporarily too large',
      })
    }
    rows.push(...page)
    if (page.length < requestedRows) break
    offset += page.length
  }

  return rows
}

async function loadPortalRowsInChunks(
  values: string[],
  fetchChunk: (chunk: string[]) => any,
  errorContext: string,
): Promise<Row[]> {
  const rowsByChunk = await runPortalQueryChunks(
    chunkPortalQueryValues(values),
    async (chunk) => {
      const result = await fetchChunk(chunk)
      throwPortalDbError(result.error, errorContext)
      return (result.data ?? []) as Row[]
    },
  )
  return rowsByChunk.flat()
}

function personCaseUnits(scopes: GrantedScope[]): PersonCaseUnit[] {
  const caseIdsByPerson = new Map<string, string[]>()
  for (const { grant, link } of scopes) {
    const caseIds = caseIdsByPerson.get(link.clientPersonId) ?? []
    caseIds.push(grant.caseId)
    caseIdsByPerson.set(link.clientPersonId, caseIds)
  }
  return [...caseIdsByPerson].flatMap(([personId, caseIds]) => (
    chunkPortalQueryValues([...new Set(caseIds)]).map(chunk => ({
      personId,
      caseIds: chunk,
    }))
  ))
}

function primaryClientCaseUnits(scopes: GrantedScope[]): ClientCaseUnit[] {
  const casesByClient = new Map<string, ClientCaseUnit>()
  for (const { grant, link } of scopes) {
    if (link.person.role !== 'primary') continue
    const key = JSON.stringify([grant.organizationId, grant.clientId])
    const unit = casesByClient.get(key) ?? {
      organizationId: grant.organizationId,
      clientId: grant.clientId,
      caseIds: [],
    }
    unit.caseIds.push(grant.caseId)
    casesByClient.set(key, unit)
  }
  return [...casesByClient.values()].flatMap(unit => (
    chunkPortalQueryValues([...new Set(unit.caseIds)]).map(caseIds => ({
      ...unit,
      caseIds,
    }))
  ))
}

async function loadPagedPortalPersonCaseRows(
  units: PersonCaseUnit[],
  fetchPage: (unit: PersonCaseUnit, from: number, to: number) => any,
  errorContext: string,
  maxRows: number,
): Promise<Row[]> {
  const rows: Row[] = []
  for (const unit of units) {
    const pageRows = await loadPagedPortalRows(
      (from, to) => fetchPage(unit, from, to),
      errorContext,
      { maxRows: maxRows - rows.length },
    )
    rows.push(...pageRows)
  }
  return rows
}

async function loadVisiblePortalDocuments(
  backend: any,
  scopes: GrantedScope[],
): Promise<Row[]> {
  const maxRows = 10_000
  const ownDocuments = await loadPagedPortalPersonCaseRows(
    personCaseUnits(scopes),
    (unit, from, to) => backend
      .from('crm_documents')
      .select(`
        id,
        organization_id,
        case_id,
        client_id,
        uploaded_by_client_person_id,
        document_type,
        name,
        status_code,
        received_at,
        verified_at,
        updated_at
      `)
      .in('case_id', unit.caseIds)
      .eq('uploaded_by_client_person_id', unit.personId)
      .order('updated_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to),
    'could not load safe document summaries',
    maxRows,
  )
  const missingDocuments: Row[] = []
  for (const unit of primaryClientCaseUnits(scopes)) {
    const rows = await loadPagedPortalRows(
      (from, to) => backend
        .from('crm_documents')
        .select(`
          id,
          organization_id,
          case_id,
          client_id,
          uploaded_by_client_person_id,
          document_type,
          name,
          status_code,
          received_at,
          verified_at,
          updated_at
        `)
        .eq('organization_id', unit.organizationId)
        .in('case_id', unit.caseIds)
        .is('uploaded_by_client_person_id', null)
        .eq('status_code', 'missing')
        .or(`client_id.is.null,client_id.eq.${unit.clientId}`)
        .order('updated_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to),
      'could not load missing document summaries',
      { maxRows: maxRows - ownDocuments.length - missingDocuments.length },
    )
    missingDocuments.push(...rows)
  }
  return [...ownDocuments, ...missingDocuments]
}

async function loadVisiblePortalMessages(
  backend: any,
  scopes: GrantedScope[],
): Promise<Row[]> {
  return loadPagedPortalPersonCaseRows(
    personCaseUnits(scopes),
    (unit, from, to) => backend
      .from('crm_activities')
      .select(`
        id,
        organization_id,
        case_id,
        client_id,
        actor_client_person_id,
        activity_type,
        title,
        body,
        created_at
      `)
      .in('case_id', unit.caseIds)
      .eq('actor_client_person_id', unit.personId)
      .eq('activity_type', 'client_portal_message')
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to),
    'could not load client portal messages',
    10_000,
  )
}

export async function loadGrantedScopes(
  event: H3Event,
  session: ClientPortalSession,
): Promise<GrantedScope[]> {
  if (!session.links.length) return []
  const backend = serverDataBackend(event) as any
  const clientPersonIds = [...new Set(session.links.map(link => link.clientPersonId))]
  const linkByScope = new Map(session.links.map(link => [
    JSON.stringify([link.organizationId, link.clientId, link.clientPersonId]),
    link,
  ]))
  const grantRows: Row[] = []
  for (const personIds of chunkPortalQueryValues(clientPersonIds)) {
    const rows = await loadPagedPortalRows((from, to) => backend
        .from('client_portal_case_grants')
        .select(`
          organization_id,
          case_id,
          client_id,
          client_person_id,
          portal_enabled,
          multiform_enabled,
          portal_enabled_at,
          multiform_enabled_at,
          revoked_at,
          revision
        `)
        .in('client_person_id', personIds)
        .eq('portal_enabled', true)
        .is('revoked_at', null)
        .order('updated_at', { ascending: false })
        .order('case_id', { ascending: true })
        .range(from, to),
      'could not list case grants',
      { maxRows: 1_000 - grantRows.length },
    )
    grantRows.push(...rows)
  }

  const deduplicated = new Map<string, GrantedScope>()
  for (const row of grantRows) {
    const organizationId = String(row.organization_id)
    const clientId = String(row.client_id)
    const clientPersonId = String(row.client_person_id)
    const link = linkByScope.get(JSON.stringify([
      organizationId,
      clientId,
      clientPersonId,
    ]))
    if (!link) continue
    const grant: PortalGrant = {
      organizationId,
      caseId: String(row.case_id),
      clientId,
      clientPersonId,
      portalEnabled: row.portal_enabled === true,
      multiformEnabled: row.multiform_enabled === true,
      portalEnabledAt: row.portal_enabled_at ? String(row.portal_enabled_at) : null,
      multiformEnabledAt: row.multiform_enabled_at
        ? String(row.multiform_enabled_at)
        : null,
      revokedAt: row.revoked_at ? String(row.revoked_at) : null,
      revision: Number(row.revision),
    }
    const caseScopeKey = JSON.stringify([
      grant.organizationId,
      grant.caseId,
    ])
    const existing = deduplicated.get(caseScopeKey)
    const candidate = { grant, link }
    // One Auth identity may legitimately link to multiple CRM people that
    // share an email. A case still appears once; prefer its primary person
    // because only that role can receive Multiwniosek access. Use the same
    // stable selector as detail/write endpoints so their personas cannot drift.
    deduplicated.set(
      caseScopeKey,
      selectPreferredPortalGrantScope(existing ? [existing, candidate] : [candidate])!,
    )
  }
  return [...deduplicated.values()]
}

export async function loadPortalCases(
  event: H3Event,
  providedSession?: ClientPortalSession,
) {
  const session = providedSession ?? await loadClientPortalSession(event)
  const grantedScopes = await loadGrantedScopes(event, session)
  if (!grantedScopes.length) return { session, cases: [] }

  const backend = serverDataBackend(event) as any
  const caseIds = [...new Set(grantedScopes.map(scope => scope.grant.caseId))]
  const organizationIds = [...new Set(
    grantedScopes.map(scope => scope.grant.organizationId),
  )]

  const [
    caseRows,
    organizationRows,
    documents,
    portalActivities,
    multiformDraftRows,
  ] = await Promise.all([
    loadPortalRowsInChunks(caseIds, ids => backend
      .from('crm_cases')
      .select(`
        id,
        organization_id,
        client_id,
        owner_user_id,
        title,
        status_code,
        progress_percent,
        opened_at,
        closed_at,
        created_at,
        updated_at
      `)
      .in('id', ids),
    'could not load shared cases'),
    loadPortalRowsInChunks(organizationIds, ids => backend
      .from('organizations')
      .select('id, name, slug')
      .in('id', ids),
    'could not load case organizations'),
    loadVisiblePortalDocuments(backend, grantedScopes),
    loadVisiblePortalMessages(backend, grantedScopes),
    loadPortalRowsInChunks(caseIds, ids => backend
      .from('crm_case_multiform_drafts')
      .select(`
        organization_id,
        case_id,
        client_portal_step,
        client_portal_completed_at,
        updated_at
      `)
      .in('case_id', ids),
    'could not load multiform status'),
  ])

  const cases = indexById(caseRows)
  const organizations = indexById(organizationRows)
  const publicExperts = await loadPublicPortalExperts(event, grantedScopes.flatMap(({ grant }) => {
    const ownerUserId = cases.get(grant.caseId)?.owner_user_id
    return ownerUserId
      ? [{ organizationId: grant.organizationId, userId: String(ownerUserId) }]
      : []
  }))
  const multiformDrafts = new Map(
    multiformDraftRows.map(row => [
      JSON.stringify([String(row.organization_id), String(row.case_id)]),
      row,
    ]),
  )

  const safeCases = grantedScopes.flatMap(({ grant, link }) => {
    const row = cases.get(grant.caseId)
    if (
      !row
      || String(row.organization_id) !== grant.organizationId
    ) return []
    const organization = organizations.get(grant.organizationId)
    if (!organization) return []
    const expert = row.owner_user_id
      ? publicExperts.get(portalExpertScopeKey(
          grant.organizationId,
          String(row.owner_user_id),
        ))
      : undefined
    const expertName = expert?.name ?? 'Twój ekspert'
    const expertAvatar = expert?.avatarUrl ?? null
    const caseDocuments = documents.filter(document => isSafePortalDocumentSummary({
      organizationId: document.organization_id,
      caseId: document.case_id,
      clientId: document.client_id,
      uploadedByClientPersonId: document.uploaded_by_client_person_id,
      statusCode: document.status_code,
    }, {
      organizationId: grant.organizationId,
      caseId: grant.caseId,
      clientId: grant.clientId,
      clientPersonId: link.person.id,
      clientPersonRole: link.person.role,
    }))
    const uploadedDocuments = caseDocuments.filter(document => (
      String(document.status_code) !== 'missing'
    ))
    const missingDocuments = caseDocuments.filter(document => (
      String(document.status_code) === 'missing'
    ))
    const multiformDraft = multiformDrafts.get(JSON.stringify([
      grant.organizationId,
      grant.caseId,
    ]))
    const multiformEligible = link.person.role === 'primary'
    const canSeeMultiformState = grant.multiformEnabled && multiformEligible
    const multiformCompletedAt = canSeeMultiformState
      && multiformDraft?.client_portal_completed_at
      ? String(multiformDraft.client_portal_completed_at)
      : null
    const action = buildPortalCaseAction({
      caseId: grant.caseId,
      statusCode: String(row.status_code ?? ''),
      closedAt: row.closed_at ? String(row.closed_at) : null,
      progressPercent: Number(row.progress_percent) || 0,
      missingDocumentCount: missingDocuments.length,
      multiformEnabled: grant.multiformEnabled,
      multiformEligible,
      multiformCompletedAt,
    })

    const timeline: SafeTimelineItem[] = caseDocuments.map(documentTimeline)
    for (const activity of portalActivities) {
      if (
        String(activity.organization_id) !== grant.organizationId
        || String(activity.case_id) !== grant.caseId
        || String(activity.client_id) !== grant.clientId
        || String(activity.actor_client_person_id) !== link.person.id
      ) continue
      const createdAt = String(activity.created_at)
      timeline.push({
        id: `message:${String(activity.id)}`,
        kind: 'message',
        title: 'Wiadomość wysłana do eksperta',
        body: String(activity.body ?? ''),
        createdAt,
        isNew: isNew(createdAt),
        author: {
          name: link.person.displayName || 'Klient',
          role: 'client',
        },
      })
    }
    if (grant.multiformEnabledAt) {
      timeline.push({
        id: `multiform:${grant.caseId}:${grant.revision}`,
        kind: 'multiform',
        title: 'Ekspert udostępnił formularz Multiwniosku',
        body: 'Uzupełnij bezpieczny formularz. Odpowiedzi trafią bezpośrednio do prowadzącego eksperta.',
        createdAt: grant.multiformEnabledAt,
        isNew: isNew(grant.multiformEnabledAt),
        author: { name: expertName, avatarUrl: expertAvatar, role: 'expert' },
        ...(grant.multiformEnabled && multiformEligible && !multiformCompletedAt
          ? {
              action: {
                kind: 'complete_multiform' as const,
                label: 'Uzupełnij formularz',
                to: `/cases/${grant.caseId}/multiform`,
              },
            }
          : {}),
      })
    }
    if (grant.portalEnabledAt) {
      timeline.push({
        id: `portal:${grant.caseId}`,
        kind: 'status',
        title: 'Panel sprawy został udostępniony',
        body: 'Od tej chwili najważniejsze informacje o sprawie są dostępne w tym panelu.',
        createdAt: grant.portalEnabledAt,
        author: { name: expertName, avatarUrl: expertAvatar, role: 'expert' },
      })
    }
    const openedAt = String(row.opened_at ?? row.created_at ?? row.updated_at)
    timeline.push({
      id: `opened:${grant.caseId}`,
      kind: 'status',
      title: 'Rozpoczęto prowadzenie sprawy',
      createdAt: openedAt,
      author: { name: expertName, avatarUrl: expertAvatar, role: 'expert' },
    })
    timeline.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    const visibleTimeline = timeline.slice(0, 100)

    return [{
      id: grant.caseId,
      title: String(row.title),
      subtitle: `Sprawę prowadzi ${expertName}`,
      statusCode: String(row.status_code ?? ''),
      openedAt,
      closedAt: row.closed_at ? String(row.closed_at) : null,
      updatedAt: String(row.updated_at),
      organization: {
        id: grant.organizationId,
        name: String(organization.name),
        slug: String(organization.slug),
      },
      expert: {
        id: expert?.id ?? '',
        name: expertName,
        avatarUrl: expertAvatar,
        role: expert?.role ?? 'expert',
        professionalTitle: expert?.professionalTitle ?? null,
        contact: expert?.contact ?? null,
      },
      clientPerson: {
        id: link.person.id,
        displayName: link.person.displayName,
      },
      grant: publicGrant(grant),
      progressPercent: Math.max(0, Math.min(100, Number(row.progress_percent) || 0)),
      steps: progressSteps(row.progress_percent),
      documents: {
        total: caseDocuments.length,
        uploaded: uploadedDocuments.length,
        pending: missingDocuments.length,
        items: caseDocuments.map(publicPortalDocument),
      },
      multiform: {
        enabled: grant.multiformEnabled,
        eligible: multiformEligible,
        completed: canSeeMultiformState && Boolean(multiformCompletedAt),
        completedAt: multiformCompletedAt,
        activeStep: canSeeMultiformState && multiformDraft?.client_portal_step
          ? Number(multiformDraft.client_portal_step)
          : null,
        updatedAt: canSeeMultiformState && multiformDraft?.updated_at
          ? String(multiformDraft.updated_at)
          : null,
      },
      action,
      timeline: visibleTimeline,
    }]
  })

  safeCases.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  return { session, cases: safeCases }
}
