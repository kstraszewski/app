import { createError, type H3Event } from 'h3'
import { selectPreferredPortalGrantScope } from '../../shared/utils/portal-grant-scope.ts'
import { serverDataBackend } from './data-api'
import { serverAuthSession } from './platform-auth'
import { chunkPortalQueryValues, runPortalQueryChunks } from './portal-query'

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export interface PortalIdentity {
  userId: string
  email: string
  name: string
}

export interface PortalClientLink {
  organizationId: string
  clientId: string
  clientPersonId: string
  verifiedEmail: string
  person: {
    id: string
    clientId: string
    organizationId: string
    displayName: string
    role: string
  }
}

export interface PortalGrant {
  organizationId: string
  caseId: string
  clientId: string
  clientPersonId: string
  portalEnabled: boolean
  multiformEnabled: boolean
  portalEnabledAt: string | null
  multiformEnabledAt: string | null
  revokedAt: string | null
  revision: number
}

export interface ClientPortalSession {
  identity: PortalIdentity
  links: PortalClientLink[]
}

export interface PortalCaseAccess {
  session: ClientPortalSession
  link: PortalClientLink
  grant: PortalGrant
}

export interface PortalGrantScope {
  link: PortalClientLink
  grant: PortalGrant
}

interface PortalLinkRow {
  organization_id: unknown
  client_id: unknown
  client_person_id: unknown
  verification_method: unknown
  verified_contact_normalized: unknown
}

interface PortalPersonRow {
  id: unknown
  organization_id: unknown
  client_id: unknown
  display_name: unknown
  role: unknown
  email_normalized: unknown
}

interface PortalGrantRow {
  organization_id: unknown
  case_id: unknown
  client_id: unknown
  client_person_id: unknown
  portal_enabled: unknown
  multiform_enabled: unknown
  portal_enabled_at: unknown
  multiform_enabled_at: unknown
  revoked_at: unknown
  revision: unknown
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function normalizeClientEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function requiredUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw createError({ statusCode: 400, statusMessage: `${field} is invalid` })
  }
  return value.toLowerCase()
}

export function throwPortalDbError(
  error: { code?: string, message?: string } | null | undefined,
  context: string,
): void {
  if (!error) return
  console.error(`[client-portal] ${context}`, {
    code: String(error.code ?? ''),
    message: String(error.message ?? ''),
  })
  throw createError({
    statusCode: error.code === '23505' ? 409 : 500,
    statusMessage: error.code === '23505'
      ? 'The requested client access is already linked'
      : 'Client portal data is temporarily unavailable',
  })
}

export async function requirePortalIdentity(event: H3Event): Promise<PortalIdentity> {
  const authSession = await serverAuthSession(event)
  if (!authSession?.user?.id) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }
  const email = normalizeClientEmail(authSession.user.email)
  if (!authSession.user.emailVerified || !email) {
    throw createError({ statusCode: 403, statusMessage: 'Verified email required' })
  }
  return {
    userId: String(authSession.user.id),
    email,
    name: String(authSession.user.name ?? '').trim(),
  }
}

function grantFromRow(row: PortalGrantRow): PortalGrant {
  return {
    organizationId: String(row.organization_id),
    caseId: String(row.case_id),
    clientId: String(row.client_id),
    clientPersonId: String(row.client_person_id),
    portalEnabled: row.portal_enabled === true,
    multiformEnabled: row.multiform_enabled === true,
    portalEnabledAt: row.portal_enabled_at ? String(row.portal_enabled_at) : null,
    multiformEnabledAt: row.multiform_enabled_at
      ? String(row.multiform_enabled_at)
      : null,
    revokedAt: row.revoked_at ? String(row.revoked_at) : null,
    revision: Number(row.revision),
  }
}

export async function loadClientPortalSession(
  event: H3Event,
): Promise<ClientPortalSession> {
  const identity = await requirePortalIdentity(event)
  const backend = serverDataBackend(event) as any
  const linksResult = await backend
    .from('client_account_links')
    .select(`
      organization_id,
      client_id,
      client_person_id,
      verification_method,
      verified_contact_normalized
    `)
    .eq('auth_user_id', identity.userId)
    .is('revoked_at', null)
    .limit(100)
  throwPortalDbError(linksResult.error, 'could not load account links')

  const candidateLinks = (linksResult.data ?? []) as PortalLinkRow[]
  const personIds = [...new Set(candidateLinks.map(row => String(row.client_person_id)))]
  if (!personIds.length) return { identity, links: [] }

  const peopleResult = await backend
    .from('crm_client_people')
    .select('id, organization_id, client_id, display_name, role, email_normalized')
    .in('id', personIds)
  throwPortalDbError(peopleResult.error, 'could not validate linked CRM people')

  const personByScope = new Map<string, PortalPersonRow>()
  for (const person of (peopleResult.data ?? []) as PortalPersonRow[]) {
    personByScope.set(JSON.stringify([
      String(person.organization_id),
      String(person.client_id),
      String(person.id),
    ]), person)
  }

  const links: PortalClientLink[] = []
  for (const row of candidateLinks) {
    const organizationId = String(row.organization_id)
    const clientId = String(row.client_id)
    const clientPersonId = String(row.client_person_id)
    const verifiedEmail = normalizeClientEmail(row.verified_contact_normalized)
    const person = personByScope.get(JSON.stringify([
      organizationId,
      clientId,
      clientPersonId,
    ]))

    if (
      row.verification_method !== 'email'
      || verifiedEmail !== identity.email
      || normalizeClientEmail(person?.email_normalized) !== identity.email
    ) continue

    links.push({
      organizationId,
      clientId,
      clientPersonId,
      verifiedEmail,
      person: {
        id: clientPersonId,
        clientId,
        organizationId,
        displayName: String(person?.display_name ?? ''),
        role: String(person?.role ?? ''),
      },
    })
  }

  return { identity, links }
}

export async function requireLinkedClientPortalSession(
  event: H3Event,
): Promise<ClientPortalSession> {
  const session = await loadClientPortalSession(event)
  if (!session.links.length) {
    throw createError({ statusCode: 403, statusMessage: 'Client portal activation required' })
  }
  return session
}

export async function requirePortalCaseAccess(
  event: H3Event,
  caseIdInput: unknown,
): Promise<PortalCaseAccess> {
  const caseId = requiredUuid(caseIdInput, 'caseId')
  const session = await loadClientPortalSession(event)
  if (!session.links.length) {
    throw createError({ statusCode: 404, statusMessage: 'Case not found' })
  }

  const backend = serverDataBackend(event) as any
  const linkedPersonIds = [...new Set(
    session.links.map(link => link.clientPersonId),
  )]
  const grantRowsByChunk = await runPortalQueryChunks(
    chunkPortalQueryValues(linkedPersonIds),
    async (personIds) => {
      const result = await backend
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
        .eq('case_id', caseId)
        .in('client_person_id', personIds)
        .eq('portal_enabled', true)
        .is('revoked_at', null)
        .limit(personIds.length)
      throwPortalDbError(result.error, 'could not load case grant')
      return (result.data ?? []) as PortalGrantRow[]
    },
  )
  const grantRows = grantRowsByChunk.flat()

  const candidates: PortalGrantScope[] = []
  for (const row of grantRows) {
    const grant = grantFromRow(row)
    const link = session.links.find(candidate => (
      candidate.organizationId === grant.organizationId
      && candidate.clientId === grant.clientId
      && candidate.clientPersonId === grant.clientPersonId
    ))
    if (link) candidates.push({ link, grant })
  }

  const selected = selectPreferredPortalGrantScope(candidates)
  if (selected) return { session, ...selected }

  throw createError({ statusCode: 404, statusMessage: 'Case not found' })
}

export function publicGrant(grant: PortalGrant) {
  return {
    portalEnabled: grant.portalEnabled,
    multiformEnabled: grant.multiformEnabled,
    portalEnabledAt: grant.portalEnabledAt,
    multiformEnabledAt: grant.multiformEnabledAt,
  }
}
