import { createError, setHeader } from 'h3'
import type { PortalAccountProfile } from '../../../shared/types/portal-account.ts'
import {
  buildPortalAccountConsents,
  loadAllPortalAccountConsentEventPages,
  PortalAccountConsentHistoryLimitError,
  portalAccountScopeKey,
  type PortalAccountConsentDefinitionRow,
  type PortalAccountConsentEventRow,
  type PortalAccountConsentVersionRow,
} from '../../../shared/utils/portal-account.ts'
import { serverDataBackend } from '~~/server/utils/data-api'
import {
  requireLinkedClientPortalSession,
  throwPortalDbError,
} from '~~/server/utils/portal-auth'
import {
  chunkPortalQueryValues,
  runPortalQueryChunks,
} from '~~/server/utils/portal-query'
import { loadPortalExpertBookings } from '~~/server/utils/portal-expert-booking'

interface OrganizationRow {
  id: unknown
  name: unknown
}

interface LifecycleRow {
  auth_user_id: unknown
  organization_id: unknown
  client_id: unknown
  client_person_id: unknown
  status: unknown
  archived_at: unknown
}

function timestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  return Number.isFinite(Date.parse(value)) ? value : null
}

function exactScopeKey(row: {
  organization_id: unknown
  client_id: unknown
  subject_person_id?: unknown
  client_person_id?: unknown
}): string {
  const personId = row.subject_person_id ?? row.client_person_id
  return portalAccountScopeKey(
    typeof row.organization_id === 'string' ? row.organization_id : '',
    typeof row.client_id === 'string' ? row.client_id : '',
    typeof personId === 'string' ? personId : '',
  )
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const session = await requireLinkedClientPortalSession(event)
  const backend = serverDataBackend(event) as any
  const organizationIds = [...new Set(session.links.map(link => link.organizationId))]
  const validScopes = new Set(session.links.map(link => portalAccountScopeKey(
    link.organizationId,
    link.clientId,
    link.clientPersonId,
  )))

  const [organizationsResult, definitionsResult, lifecycleResult, expertBookingResult] = await Promise.all([
    backend
      .from('organizations')
      .select('id, name')
      .in('id', organizationIds),
    backend
      .from('crm_consent_definitions')
      .select('id, organization_id, code, current_version_id')
      .in('organization_id', organizationIds)
      .limit(1_000),
    backend
      .from('client_portal_accounts')
      .select(`
        auth_user_id,
        organization_id,
        client_id,
        client_person_id,
        status,
        archived_at
      `)
      .eq('auth_user_id', session.identity.userId)
      .in('organization_id', organizationIds)
      .limit(500),
    loadPortalExpertBookings(event, session)
      .then(bookings => ({ status: 'available' as const, bookings }))
      .catch((error) => {
        console.error('[client-portal] expert booking section unavailable', {
          message: error instanceof Error ? error.message : String(error),
        })
        return { status: 'unavailable' as const, bookings: [] }
      }),
  ])
  throwPortalDbError(organizationsResult.error, 'could not load account organizations')
  throwPortalDbError(definitionsResult.error, 'could not load consent definitions')
  throwPortalDbError(lifecycleResult.error, 'could not load client portal lifecycle')

  const definitions = (definitionsResult.data ?? []) as PortalAccountConsentDefinitionRow[]
  let events: PortalAccountConsentEventRow[]
  try {
    events = await loadAllPortalAccountConsentEventPages(
      session.links.map(link => ({
        organizationId: link.organizationId,
        clientId: link.clientId,
        clientPersonId: link.clientPersonId,
      })),
      async (scope, from, to) => {
        const result = await backend
          .from('crm_client_consent_events')
          .select(`
            id,
            organization_id,
            client_id,
            subject_person_id,
            definition_id,
            definition_version_id,
            decision,
            source,
            occurred_at
          `)
          .eq('organization_id', scope.organizationId)
          .eq('client_id', scope.clientId)
          .eq('subject_person_id', scope.clientPersonId)
          .order('occurred_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to)
        throwPortalDbError(result.error, 'could not load consent history')
        return (result.data ?? []) as PortalAccountConsentEventRow[]
      },
    )
  }
  catch (error) {
    if (error instanceof PortalAccountConsentHistoryLimitError) {
      throw createError({
        statusCode: 503,
        statusMessage: 'Client portal data set is temporarily too large',
      })
    }
    throw error
  }
  // Keep an application-side exact-scope check as defense in depth even
  // though every page is already queried by a complete tuple.
  events = events.filter(row => validScopes.has(exactScopeKey(row)))
  const versionIds = [...new Set([
    ...definitions.map(row => row.current_version_id),
    ...events.map(row => row.definition_version_id),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0))]
  const versionRowsByChunk = await runPortalQueryChunks(
    chunkPortalQueryValues(versionIds),
    async (ids) => {
      const result = await backend
        .from('crm_consent_definition_versions')
        .select(`
          id,
          organization_id,
          definition_id,
          version,
          display_title,
          content,
          purpose,
          channel,
          legal_basis,
          status,
          sort_order,
          effective_from,
          effective_to,
          is_required
        `)
        .in('id', ids)
        .in('organization_id', organizationIds)
      throwPortalDbError(result.error, 'could not load consent versions')
      return (result.data ?? []) as PortalAccountConsentVersionRow[]
    },
  )
  const versions = versionRowsByChunk.flat()

  const organizationById = new Map(
    ((organizationsResult.data ?? []) as OrganizationRow[]).flatMap((row) => {
      if (typeof row.id !== 'string') return []
      return [[row.id, typeof row.name === 'string' ? row.name : ''] as const]
    }),
  )
  const lifecycleByScope = new Map(
    ((lifecycleResult.data ?? []) as LifecycleRow[]).flatMap((row) => {
      if (
        row.auth_user_id !== session.identity.userId
        || !validScopes.has(exactScopeKey(row))
      ) return []
      return [[exactScopeKey(row), row] as const]
    }),
  )
  const profiles: PortalAccountProfile[] = session.links.map((link) => {
    const lifecycle = lifecycleByScope.get(portalAccountScopeKey(
      link.organizationId,
      link.clientId,
      link.clientPersonId,
    ))
    return {
      organizationId: link.organizationId,
      organizationName: organizationById.get(link.organizationId) || 'OpenExpert',
      clientId: link.clientId,
      clientPersonId: link.clientPersonId,
      displayName: link.person.displayName,
      role: link.person.role,
      status: lifecycle?.status === 'archived'
        ? 'archived' as const
        : 'active' as const,
      archivedAt: timestamp(lifecycle?.archived_at),
    }
  }).sort((left, right) => (
    left.organizationName.localeCompare(right.organizationName, 'pl')
    || left.displayName.localeCompare(right.displayName, 'pl')
  ))

  return {
    data: {
      user: session.identity,
      profiles,
      expertBookingStatus: expertBookingResult.status,
      expertBookings: expertBookingResult.bookings.map(booking => ({
        ...booking,
        organizationName: organizationById.get(booking.organizationId) || 'OpenExpert',
      })),
      consents: buildPortalAccountConsents({
        scopes: session.links.map(link => ({
          organizationId: link.organizationId,
          organizationName: organizationById.get(link.organizationId) || 'OpenExpert',
          clientId: link.clientId,
          clientPersonId: link.clientPersonId,
          personName: link.person.displayName,
        })),
        definitions,
        versions,
        events,
      }),
    },
  }
})
