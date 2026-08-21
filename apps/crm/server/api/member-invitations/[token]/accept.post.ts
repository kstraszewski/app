import { isOpenExpertSameOriginJsonRequest } from '@openexpert/auth/server'
import { createError, getRouterParam, setHeader } from 'h3'
import { requireAuthIdentity } from '~~/server/utils/crm'
import { serverDataBackend } from '~~/server/utils/data-api'
import {
  hashOrganizationMemberInvitationToken,
  isOrganizationMemberInvitationToken,
} from '~~/server/utils/organization-member-invitations'
import { serverAuth } from '~~/server/utils/platform-auth'

function acceptanceError(error: { code?: string, message?: string } | null | undefined): never {
  const code = String(error?.code || '')
  const message = String(error?.message || '')
  if (code === 'P0002') {
    throw createError({ statusCode: 404, statusMessage: 'Member invitation not found' })
  }
  if (message === 'member_invitation_verified_email_mismatch') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Invitation does not match the verified account',
    })
  }
  if (
    message === 'member_invitation_not_pending'
    || message === 'organization_seat_capacity_exhausted'
    || code === '23514'
  ) {
    throw createError({ statusCode: 409, statusMessage: 'Member invitation is no longer available' })
  }
  if (code === '42501') {
    throw createError({ statusCode: 403, statusMessage: 'Active application access is required' })
  }
  console.error('[organization-member-invitations] acceptance failed', { code })
  throw createError({ statusCode: 500, statusMessage: 'Member invitation could not be accepted' })
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'Referrer-Policy', 'no-referrer')
  const runtime = serverAuth(event)
  if (!isOpenExpertSameOriginJsonRequest(event.headers, runtime.config.baseURL)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }
  const token = getRouterParam(event, 'token')
  if (!isOrganizationMemberInvitationToken(token)) {
    throw createError({ statusCode: 404, statusMessage: 'Member invitation not found' })
  }
  const identity = await requireAuthIdentity(event)
  if (!identity.emailVerified || !identity.email) {
    throw createError({ statusCode: 403, statusMessage: 'Verified email required' })
  }

  const backend = serverDataBackend(event) as any
  const result = await backend.rpc('accept_organization_member_invitation_v1', {
    p_token_hash: hashOrganizationMemberInvitationToken(token),
    p_actor_user_id: identity.userId,
  })
  if (result.error) acceptanceError(result.error)
  if (result.data?.accepted !== true) {
    throw createError({ statusCode: 409, statusMessage: 'Member invitation has expired' })
  }
  return result.data
})
