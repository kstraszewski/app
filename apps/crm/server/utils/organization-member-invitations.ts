import { createError, type H3Event } from 'h3'
import type {
  OrganizationMemberInvitation,
  OrganizationMemberInvitationDelivery,
  OrganizationMemberInvitationRole,
  OrganizationMemberInvitationStatus,
} from '~~/shared/types/organization-member-invitations'
import {
  createOrganizationMemberInvitationToken,
  hashOrganizationMemberInvitationToken,
  isOrganizationMemberInvitationToken,
} from '../lib/organization-member-invitation-token'
import { serverDataBackend } from './data-api'
import { serverOrganizationInvitationAuth } from './platform-auth'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const MEMBER_INVITATION_SELECT = [
  'id',
  'organization_id',
  'email_normalized',
  'invited_name',
  'role',
  'status',
  'invited_by_user_id',
  'accepted_by_user_id',
  'expires_at',
  'sent_at',
  'accepted_at',
  'revoked_at',
  'revision',
  'delivery_attempts',
  'last_delivery_error',
  'created_at',
  'updated_at',
].join(', ')

type MemberInvitationRow = {
  id: string
  organization_id: string
  email_normalized: string
  invited_name: string | null
  role: OrganizationMemberInvitationRole
  status: OrganizationMemberInvitationStatus
  invited_by_user_id: string
  accepted_by_user_id: string | null
  expires_at: string
  sent_at: string | null
  accepted_at: string | null
  revoked_at: string | null
  revision: number
  delivery_attempts: number
  last_delivery_error: string | null
  created_at: string
  updated_at: string
}

type RpcInvitation = {
  id?: unknown
  organizationId?: unknown
  email?: unknown
  invitedName?: unknown
  role?: unknown
  status?: unknown
  invitedByUserId?: unknown
  acceptedByUserId?: unknown
  expiresAt?: unknown
  sentAt?: unknown
  acceptedAt?: unknown
  revokedAt?: unknown
  revision?: unknown
  deliveryAttempts?: unknown
  lastDeliveryError?: unknown
  createdAt?: unknown
  updatedAt?: unknown
}

interface OrganizationInvitationRuntimeConfig {
  enabled?: boolean
  baseUrl?: string
  basePath?: string
  ttlSeconds?: number
}

function invitationConfiguration(event: H3Event) {
  const config = useRuntimeConfig(event)
    .organizationInvitations as OrganizationInvitationRuntimeConfig
  const baseUrl = String(config?.baseUrl || '').replace(/\/+$/u, '')
  const basePath = String(config?.basePath || '/api/organization-auth').trim()
  const ttlSeconds = Number(config?.ttlSeconds)
  let parsedBaseUrl: URL
  try {
    parsedBaseUrl = new URL(baseUrl)
  }
  catch {
    throw createError({
      statusCode: 503,
      statusMessage: 'Member invitations are temporarily unavailable',
    })
  }
  if (
    config?.enabled !== true
    || !['http:', 'https:'].includes(parsedBaseUrl.protocol)
    || parsedBaseUrl.username
    || parsedBaseUrl.password
    || basePath !== '/api/organization-auth'
    || !Number.isSafeInteger(ttlSeconds)
    || ttlSeconds < 5 * 60
    || ttlSeconds > 30 * 24 * 60 * 60
  ) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Member invitations are temporarily unavailable',
    })
  }
  return { baseUrl, ttlSeconds }
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function invitationFromRow(
  row: MemberInvitationRow,
  organization?: { name?: unknown, slug?: unknown } | null,
): OrganizationMemberInvitation {
  const expiresAt = String(row.expires_at)
  const live = row.status === 'pending' && new Date(expiresAt).getTime() > Date.now()
  const effectiveStatus: OrganizationMemberInvitationStatus = row.status === 'pending' && !live
    ? 'expired'
    : row.status
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    organizationName: organization ? String(organization.name || '') : undefined,
    organizationSlug: organization ? String(organization.slug || '') : undefined,
    email: String(row.email_normalized),
    invitedName: nullableString(row.invited_name),
    role: row.role === 'admin' ? 'admin' : 'expert',
    status: effectiveStatus,
    invitedByUserId: String(row.invited_by_user_id),
    acceptedByUserId: nullableString(row.accepted_by_user_id),
    expiresAt,
    sentAt: nullableString(row.sent_at),
    acceptedAt: nullableString(row.accepted_at),
    revokedAt: nullableString(row.revoked_at),
    revision: Number(row.revision),
    deliveryAttempts: Number(row.delivery_attempts),
    deliveryFailed: Boolean(row.last_delivery_error),
    lastDeliveryError: nullableString(row.last_delivery_error),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    canAccept: live,
    canResume: effectiveStatus === 'accepted',
  }
}

function invitationFromRpc(value: RpcInvitation): OrganizationMemberInvitation {
  const status = String(value.status || '') as OrganizationMemberInvitationStatus
  const expiresAt = String(value.expiresAt || '')
  if (
    !UUID_PATTERN.test(String(value.id || ''))
    || !UUID_PATTERN.test(String(value.organizationId || ''))
    || !['pending', 'accepted', 'expired', 'revoked'].includes(status)
    || !['expert', 'admin'].includes(String(value.role || ''))
    || !Number.isFinite(Date.parse(expiresAt))
  ) {
    throw createError({ statusCode: 500, statusMessage: 'Member invitation response is invalid' })
  }
  const row: MemberInvitationRow = {
    id: String(value.id),
    organization_id: String(value.organizationId),
    email_normalized: String(value.email || ''),
    invited_name: nullableString(value.invitedName),
    role: value.role === 'admin' ? 'admin' : 'expert',
    status,
    invited_by_user_id: String(value.invitedByUserId || ''),
    accepted_by_user_id: nullableString(value.acceptedByUserId),
    expires_at: expiresAt,
    sent_at: nullableString(value.sentAt),
    accepted_at: nullableString(value.acceptedAt),
    revoked_at: nullableString(value.revokedAt),
    revision: Number(value.revision),
    delivery_attempts: Number(value.deliveryAttempts),
    last_delivery_error: nullableString(value.lastDeliveryError),
    created_at: String(value.createdAt || new Date().toISOString()),
    updated_at: String(value.updatedAt || new Date().toISOString()),
  }
  return invitationFromRow(row)
}

function databaseError(error: { code?: string, message?: string } | null | undefined): never {
  const code = String(error?.code || '')
  const message = String(error?.message || '')
  if (message === 'organization_seat_capacity_exhausted') {
    throw createError({
      statusCode: 409,
      statusMessage: 'No already-paid seat is available for an invitation',
    })
  }
  if (message === 'member_invitation_already_pending') {
    throw createError({ statusCode: 409, statusMessage: 'An invitation for this email is already pending' })
  }
  if (message === 'organization_member_already_exists') {
    throw createError({ statusCode: 409, statusMessage: 'This user already belongs to the organization' })
  }
  if (code === 'P0002') {
    throw createError({ statusCode: 404, statusMessage: 'Member invitation not found' })
  }
  if (code === '42501') {
    throw createError({ statusCode: 403, statusMessage: 'Member invitation is not allowed' })
  }
  if (['23505', '23514', '40001'].includes(code)) {
    throw createError({ statusCode: 409, statusMessage: message || 'Member invitation changed' })
  }
  console.error('[organization-member-invitations] database operation failed', { code })
  throw createError({ statusCode: 500, statusMessage: 'Member invitation is temporarily unavailable' })
}

function deliveryErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '')
  return message.slice(0, 2_000) || 'Unknown member invitation delivery error'
}

export function organizationMemberInvitationUrl(event: H3Event, token: string): string {
  if (!isOrganizationMemberInvitationToken(token)) {
    throw new TypeError('Organization member invitation token is invalid')
  }
  const { baseUrl } = invitationConfiguration(event)
  const url = new URL('/member-invitation', `${baseUrl}/`)
  url.searchParams.set('token', token)
  return url.href
}

async function recordDelivery(
  event: H3Event,
  invitation: OrganizationMemberInvitation,
  result: { sentAt: string | null, error: string | null },
): Promise<void> {
  const backend = serverDataBackend(event) as any
  const recorded = await backend.rpc('record_organization_member_invitation_delivery_v1', {
    p_invitation_id: invitation.id,
    p_expected_revision: invitation.revision,
    p_sent_at: result.sentAt,
    p_error: result.error,
  })
  if (recorded.error) {
    console.error('[organization-member-invitations] delivery result was not persisted', {
      code: String(recorded.error.code || ''),
    })
  }
}

export async function sendOrganizationMemberInvitationMagicLink(
  event: H3Event,
  invitation: OrganizationMemberInvitation,
  token: string,
): Promise<OrganizationMemberInvitationDelivery> {
  const invitationUrl = organizationMemberInvitationUrl(event, token)
  const loginUrl = new URL('/login', invitationUrl)
  loginUrl.searchParams.set('email', invitation.email)
  const destination = new URL(invitationUrl)
  loginUrl.searchParams.set('redirect', `${destination.pathname}${destination.search}`)

  try {
    const runtime = serverOrganizationInvitationAuth(event)
    await runtime.auth.api.signInMagicLink({
      body: {
        email: invitation.email,
        name: invitation.invitedName || undefined,
        callbackURL: invitationUrl,
        newUserCallbackURL: invitationUrl,
        errorCallbackURL: loginUrl.href,
        metadata: {
          organizationMemberInvitation: true,
          memberInvitationId: invitation.id,
          organizationName: invitation.organizationName,
          role: invitation.role,
          expiresAt: invitation.expiresAt,
        },
      },
      headers: new Headers({ origin: runtime.config.baseURL }),
    })
    const sentAt = new Date().toISOString()
    await recordDelivery(event, invitation, { sentAt, error: null })
    return { status: 'sent', sentAt, attempts: invitation.deliveryAttempts }
  }
  catch (error) {
    await recordDelivery(event, invitation, {
      sentAt: null,
      error: deliveryErrorMessage(error),
    })
    console.error('[organization-member-invitations] magic-link delivery failed', {
      name: error instanceof Error ? error.name : 'UnknownError',
    })
    return { status: 'failed', sentAt: null, attempts: invitation.deliveryAttempts }
  }
}

export async function createOrganizationMemberInvitation(
  event: H3Event,
  input: {
    organizationId: string
    organizationName: string
    actorUserId: string
    email: string
    invitedName?: string | null
    role: OrganizationMemberInvitationRole
  },
) {
  const { ttlSeconds } = invitationConfiguration(event)
  const token = createOrganizationMemberInvitationToken()
  const backend = serverDataBackend(event) as any
  const result = await backend.rpc('create_organization_member_invitation_v1', {
    p_organization_id: input.organizationId,
    p_actor_user_id: input.actorUserId,
    p_email: input.email,
    p_role: input.role,
    p_invited_name: input.invitedName || null,
    p_token_hash: hashOrganizationMemberInvitationToken(token),
    p_expires_at: new Date(Date.now() + ttlSeconds * 1_000).toISOString(),
  })
  if (result.error) databaseError(result.error)
  const invitation = invitationFromRpc(result.data ?? {})
  invitation.organizationName = input.organizationName
  const delivery = await sendOrganizationMemberInvitationMagicLink(event, invitation, token)
  return {
    invitation: {
      ...invitation,
      sentAt: delivery.sentAt,
      deliveryFailed: delivery.status === 'failed',
      lastDeliveryError: delivery.status === 'failed' ? 'Invitation delivery failed' : null,
    },
    delivery,
  }
}

export async function resendOrganizationMemberInvitation(
  event: H3Event,
  input: {
    organizationId: string
    organizationName: string
    actorUserId: string
    invitationId: string
  },
) {
  const { ttlSeconds } = invitationConfiguration(event)
  const token = createOrganizationMemberInvitationToken()
  const backend = serverDataBackend(event) as any
  const result = await backend.rpc('resend_organization_member_invitation_v1', {
    p_organization_id: input.organizationId,
    p_actor_user_id: input.actorUserId,
    p_invitation_id: input.invitationId,
    p_token_hash: hashOrganizationMemberInvitationToken(token),
    p_expires_at: new Date(Date.now() + ttlSeconds * 1_000).toISOString(),
  })
  if (result.error) databaseError(result.error)
  const invitation = invitationFromRpc(result.data ?? {})
  invitation.organizationName = input.organizationName
  const delivery = await sendOrganizationMemberInvitationMagicLink(event, invitation, token)
  return {
    invitation: {
      ...invitation,
      sentAt: delivery.sentAt,
      deliveryFailed: delivery.status === 'failed',
      lastDeliveryError: delivery.status === 'failed' ? 'Invitation delivery failed' : null,
    },
    delivery,
  }
}

export async function revokeOrganizationMemberInvitation(
  event: H3Event,
  input: { organizationId: string, actorUserId: string, invitationId: string },
): Promise<OrganizationMemberInvitation> {
  const backend = serverDataBackend(event) as any
  const result = await backend.rpc('revoke_organization_member_invitation_v1', {
    p_organization_id: input.organizationId,
    p_actor_user_id: input.actorUserId,
    p_invitation_id: input.invitationId,
  })
  if (result.error) databaseError(result.error)
  return invitationFromRpc(result.data ?? {})
}

export async function listOrganizationMemberInvitations(
  event: H3Event,
  organizationId: string,
): Promise<OrganizationMemberInvitation[]> {
  const backend = serverDataBackend(event) as any
  const result = await backend
    .from('organization_member_invitations')
    .select(MEMBER_INVITATION_SELECT)
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (result.error) databaseError(result.error)
  return ((result.data ?? []) as MemberInvitationRow[]).map(row => invitationFromRow(row))
}

export async function countLiveOrganizationMemberInvitations(
  event: H3Event,
  organizationId: string,
): Promise<number> {
  const backend = serverDataBackend(event) as any
  const result = await backend
    .from('organization_member_invitations')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
  if (result.error) databaseError(result.error)
  const count = Number(result.count ?? 0)
  if (!Number.isSafeInteger(count) || count < 0 || count > 1_000) {
    throw createError({ statusCode: 500, statusMessage: 'Member reservation count is invalid' })
  }
  return count
}

export async function findOrganizationMemberInvitationByToken(
  event: H3Event,
  token: unknown,
): Promise<OrganizationMemberInvitation | null> {
  invitationConfiguration(event)
  if (!isOrganizationMemberInvitationToken(token)) return null
  const backend = serverDataBackend(event) as any
  const invitationResult = await backend
    .from('organization_member_invitations')
    .select(`${MEMBER_INVITATION_SELECT}, organization:organizations!inner(name, slug)`)
    .eq('token_hash', hashOrganizationMemberInvitationToken(token))
    .maybeSingle()
  if (invitationResult.error) databaseError(invitationResult.error)
  if (!invitationResult.data) return null
  const data = invitationResult.data as MemberInvitationRow & {
    organization?: { name?: unknown, slug?: unknown } | Array<{ name?: unknown, slug?: unknown }>
  }
  const organization = Array.isArray(data.organization)
    ? data.organization[0]
    : data.organization
  return invitationFromRow(data, organization)
}

export {
  createOrganizationMemberInvitationToken,
  hashOrganizationMemberInvitationToken,
  isOrganizationMemberInvitationToken,
}
