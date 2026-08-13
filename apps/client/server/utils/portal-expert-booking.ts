import type { H3Event } from 'h3'
import type {
  PortalAccountExpertBooking,
} from '../../shared/types/portal-account.ts'
import {
  portalExpertBookingCandidate,
  portalExpertBookingCandidateScore,
  portalExpertBookingPath,
  selectPortalExpertBookingCandidate,
  type PortalExpertBookingCandidate,
} from '../../shared/utils/portal-expert-booking.ts'
import { serverDataBackend } from './data-api'
import { loadGrantedScopes } from './portal-cases'
import {
  loadPublicPortalExperts,
  portalExpertScopeKey,
} from './portal-experts'
import type { ClientPortalSession } from './portal-auth'
import { throwPortalDbError } from './portal-auth'
import {
  chunkPortalQueryValues,
  enforcePortalRowLimit,
  runPortalQueryChunks,
} from './portal-query'

type Row = Record<string, any>

const widgetCandidatesPerExpert = 6

function pairKey(first: string, second: string): string {
  return JSON.stringify([first, second])
}

function tripleKey(first: string, second: string, third: string): string {
  return JSON.stringify([first, second, third])
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function rawWidgetScore(row: Row, expertId: string): number {
  const fixedExpertId = textValue(row.fixed_expert_user_id) || null
  return portalExpertBookingCandidateScore({
    bookingMode: row.booking_mode === 'expert' || row.booking_mode === 'facility'
      ? row.booking_mode
      : 'both',
    fixedExpertId,
  }, expertId)
}

export async function loadPortalExpertBookings(
  event: H3Event,
  session: ClientPortalSession,
): Promise<Array<Omit<PortalAccountExpertBooking, 'organizationName'>>> {
  if (!session.links.length) return []

  const backend = serverDataBackend(event) as any
  const exactClientScopes = new Set(session.links.map(link => pairKey(
    link.organizationId,
    link.clientId,
  )))
  const clientIds = [...new Set(session.links.map(link => link.clientId))]
  const grantedScopes = await loadGrantedScopes(event, session)
  const caseIds = [...new Set(grantedScopes.map(scope => scope.grant.caseId))]
  const exactCaseScopes = new Set(grantedScopes.map(scope => pairKey(
    scope.grant.organizationId,
    scope.grant.caseId,
  )))

  const [clientOwnerRowsByChunk, caseOwnerRowsByChunk] = await Promise.all([
    runPortalQueryChunks(chunkPortalQueryValues(clientIds), async (ids) => {
      const result = await backend
        .from('crm_clients')
        .select('id, organization_id, owner_user_id')
        .in('id', ids)
      throwPortalDbError(result.error, 'could not load client expert assignments')
      return (result.data ?? []) as Row[]
    }),
    runPortalQueryChunks(chunkPortalQueryValues(caseIds), async (ids) => {
      const result = await backend
        .from('crm_cases')
        .select('id, organization_id, owner_user_id')
        .in('id', ids)
      throwPortalDbError(result.error, 'could not load case expert assignments')
      return (result.data ?? []) as Row[]
    }),
  ])

  const references = new Map<string, { organizationId: string, userId: string }>()
  // A case owner is the expert the client currently knows from the portal.
  // The CRM client owner is a fallback for profiles without a shared case.
  for (const row of caseOwnerRowsByChunk.flat()) {
    const organizationId = textValue(row.organization_id)
    const caseId = textValue(row.id)
    const userId = textValue(row.owner_user_id)
    if (!userId || !exactCaseScopes.has(pairKey(organizationId, caseId))) continue
    references.set(pairKey(organizationId, userId), { organizationId, userId })
  }
  for (const row of clientOwnerRowsByChunk.flat()) {
    const organizationId = textValue(row.organization_id)
    const clientId = textValue(row.id)
    const userId = textValue(row.owner_user_id)
    if (!userId || !exactClientScopes.has(pairKey(organizationId, clientId))) continue
    references.set(pairKey(organizationId, userId), { organizationId, userId })
  }
  if (!references.size) return []

  const scopedExperts = [...references.values()]
  const userIds = [...new Set(scopedExperts.map(reference => reference.userId))]
  const organizationIds = [...new Set(scopedExperts.map(reference => reference.organizationId))]
  const publicExpertsPromise = loadPublicPortalExperts(event, scopedExperts)
  const assignmentRowsByChunk = await runPortalQueryChunks(
    chunkPortalQueryValues(userIds),
    async (ids) => {
      const result = await backend
        .from('facility_service_experts')
        .select('organization_id, facility_id, user_id')
        .in('organization_id', organizationIds)
        .in('user_id', ids)
        .eq('is_active', true)
      throwPortalDbError(result.error, 'could not load expert booking assignments')
      return (result.data ?? []) as Row[]
    },
  )

  const exactExpertScopes = new Set(scopedExperts.map(reference => pairKey(
    reference.organizationId,
    reference.userId,
  )))
  const assignmentScopes = new Set<string>()
  const facilityScopes = new Set<string>()
  for (const row of enforcePortalRowLimit(assignmentRowsByChunk.flat(), 2_000)) {
    const organizationId = textValue(row.organization_id)
    const facilityId = textValue(row.facility_id)
    const userId = textValue(row.user_id)
    if (!exactExpertScopes.has(pairKey(organizationId, userId))) continue
    assignmentScopes.add(tripleKey(organizationId, facilityId, userId))
    facilityScopes.add(pairKey(organizationId, facilityId))
  }

  const facilityIds = [...new Set(
    [...facilityScopes].map((value) => {
      const parsed = JSON.parse(value) as [string, string]
      return parsed[1]
    }),
  )]
  if (!facilityIds.length) {
    await publicExpertsPromise
    return []
  }

  const widgetRowsByChunk = await runPortalQueryChunks(
    chunkPortalQueryValues(facilityIds),
    async (ids) => {
      const result = await backend
        .from('booking_widgets')
        .select(`
          organization_id,
          facility_id,
          public_token,
          booking_mode,
          fixed_expert_user_id
        `)
        .in('organization_id', organizationIds)
        .in('facility_id', ids)
        .eq('is_active', true)
        .eq('widget_type', 'calendar')
        .order('public_token')
      throwPortalDbError(result.error, 'could not load expert booking widgets')
      return (result.data ?? []) as Row[]
    },
  )
  const widgetRows = enforcePortalRowLimit(widgetRowsByChunk.flat(), 1_000).filter(row => facilityScopes.has(pairKey(
    textValue(row.organization_id),
    textValue(row.facility_id),
  )))
  const publicExperts = await publicExpertsPromise
  const catalogPromises = new Map<string, Promise<unknown | null>>()

  function loadCatalog(widgetKey: string): Promise<unknown | null> {
    const existing = catalogPromises.get(widgetKey)
    if (existing) return existing
    const promise = backend.rpc('get_booking_widget_catalog', {
      p_widget_token: widgetKey,
    }).then((result: { data?: unknown, error?: { code?: string, message?: string } | null }) => {
      if (!result.error) return result.data ?? null
      console.error('[client-portal] expert booking catalog unavailable', {
        widgetKey,
        code: String(result.error.code ?? ''),
        message: String(result.error.message ?? ''),
      })
      return null
    })
    catalogPromises.set(widgetKey, promise)
    return promise
  }

  const bookings = await Promise.all(scopedExperts.map(async (reference) => {
    const expert = publicExperts.get(portalExpertScopeKey(
      reference.organizationId,
      reference.userId,
    ))
    if (!expert) return null

    const rawCandidates = widgetRows
      .filter(row => (
        textValue(row.organization_id) === reference.organizationId
        && assignmentScopes.has(tripleKey(
          reference.organizationId,
          textValue(row.facility_id),
          reference.userId,
        ))
        && rawWidgetScore(row, reference.userId) > 0
      ))
      .sort((left, right) => (
        rawWidgetScore(right, reference.userId) - rawWidgetScore(left, reference.userId)
        || textValue(left.public_token).localeCompare(textValue(right.public_token))
      ))
      .slice(0, widgetCandidatesPerExpert)

    const candidates = (await Promise.all(rawCandidates.map(async (row) => {
      const widgetKey = textValue(row.public_token)
      const catalog = await loadCatalog(widgetKey)
      return portalExpertBookingCandidate(catalog, {
        organizationId: reference.organizationId,
        widgetKey,
      }, reference.userId)
    }))).filter((candidate): candidate is PortalExpertBookingCandidate => Boolean(candidate))
    const selected = selectPortalExpertBookingCandidate(candidates, reference.userId)
    if (!selected) return null

    return {
      organizationId: reference.organizationId,
      expert: {
        id: expert.id,
        name: expert.name,
        avatarUrl: expert.avatarUrl,
        professionalTitle: expert.professionalTitle,
      },
      facility: selected.facility,
      services: selected.services,
      bookingPath: portalExpertBookingPath(selected.widgetKey, reference.userId),
    }
  }))

  return bookings.filter((booking): booking is Omit<PortalAccountExpertBooking, 'organizationName'> => (
    Boolean(booking?.bookingPath)
  ))
}
