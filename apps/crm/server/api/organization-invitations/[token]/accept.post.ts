import { isOpenExpertSameOriginJsonRequest } from '@openexpert/auth/server'
import {
  createError,
  getRouterParam,
  readBody,
  setHeader,
} from 'h3'
import { asRecord, requireAuthIdentity } from '~~/server/utils/crm'
import { serverDataBackend } from '~~/server/utils/data-api'
import {
  hashOrganizationInvitationToken,
  isOrganizationInvitationToken,
} from '~~/server/utils/organization-invitations'
import { serverAuth } from '~~/server/utils/platform-auth'

function acceptanceError(
  error: { code?: string, message?: string } | null | undefined,
): never {
  const code = String(error?.code || '')
  const message = String(error?.message || '')
  if (code === 'P0002' || message === 'invitation_not_found') {
    throw createError({ statusCode: 404, statusMessage: 'Invitation not found' })
  }
  if (message === 'invitation_email_mismatch' || message === 'verified_email_required') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Invitation does not match the authenticated account',
    })
  }
  if (message === 'invitation_expired' || message === 'invitation_not_pending') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Invitation is no longer available',
    })
  }
  console.error('[organization-invitations] acceptance failed', { code })
  throw createError({
    statusCode: 500,
    statusMessage: 'Organization invitation could not be accepted',
  })
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'Referrer-Policy', 'no-referrer')
  const runtime = serverAuth(event)
  if (!isOpenExpertSameOriginJsonRequest(event.headers, runtime.config.baseURL)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  const token = getRouterParam(event, 'token')
  if (!isOrganizationInvitationToken(token)) {
    throw createError({ statusCode: 404, statusMessage: 'Invitation not found' })
  }
  const identity = await requireAuthIdentity(event)
  if (!identity.emailVerified || !identity.email) {
    throw createError({ statusCode: 403, statusMessage: 'Verified email required' })
  }

  const body = asRecord(await readBody(event))
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : ''
  if (fullName.length > 200) {
    throw createError({ statusCode: 400, statusMessage: 'fullName is too long' })
  }

  const backend = serverDataBackend(event) as any
  const result = await backend.rpc('accept_organization_onboarding_invitation', {
    p_token_hash: hashOrganizationInvitationToken(token),
    p_actor_user_id: identity.userId,
    p_full_name: fullName || null,
  })
  if (result.error) acceptanceError(result.error)

  const payload = asRecord(result.data)
  const invitationId = String(payload.invitationId || '')
  const organization = { ...payload }
  delete organization.invitationId
  return { organization, invitationId }
})
