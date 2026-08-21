import {
  consumeOpenExpertAuthRateLimit,
  getOpenExpertTrustedClientIp,
  isOpenExpertSameOriginJsonRequest,
} from '@openexpert/auth/server'
import {
  createError,
  getRouterParam,
  setHeader,
} from 'h3'
import {
  findOrganizationInvitationByToken,
  hashOrganizationInvitationToken,
  isOrganizationInvitationToken,
  sendOrganizationInvitationMagicLink,
} from '~~/server/utils/organization-invitations'
import { serverOrganizationInvitationAuth } from '~~/server/utils/platform-auth'

const RESPONSE_FLOOR_MS = 600

async function waitForResponseFloor(startedAt: number): Promise<void> {
  const remaining = RESPONSE_FLOOR_MS - (Date.now() - startedAt)
  if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining))
}

export default defineEventHandler(async (event) => {
  const startedAt = Date.now()
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'Referrer-Policy', 'no-referrer')

  try {
    const runtime = serverOrganizationInvitationAuth(event)
    if (!isOpenExpertSameOriginJsonRequest(event.headers, runtime.config.baseURL)) {
      throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
    }

    const token = getRouterParam(event, 'token')
    const identifier = isOrganizationInvitationToken(token)
      ? hashOrganizationInvitationToken(token)
      : 'invalid'
    const rateLimit = await consumeOpenExpertAuthRateLimit({
      pool: runtime.pool,
      databaseSchema: runtime.config.databaseSchema,
      keySecret: runtime.config.secret,
      scope: 'crm:organization-invitation-magic-link',
      ipAddress: getOpenExpertTrustedClientIp({
        headers: event.headers,
        directAddress: event.node.req.socket.remoteAddress,
        trustedHeaderNames: runtime.config.ipAddressHeaders,
      }),
      identifier,
    })
    if (!rateLimit.allowed) {
      setHeader(event, 'Retry-After', rateLimit.retryAfterSeconds)
      throw createError({
        statusCode: 429,
        statusMessage: 'Too many invitation link requests',
      })
    }

    if (!isOrganizationInvitationToken(token)) {
      throw createError({ statusCode: 404, statusMessage: 'Invitation not found' })
    }
    const invitation = await findOrganizationInvitationByToken(event, token)
    if (!invitation || invitation.status !== 'pending') {
      throw createError({ statusCode: 404, statusMessage: 'Invitation not found' })
    }
    const delivery = await sendOrganizationInvitationMagicLink(event, invitation, token)
    return { delivery }
  }
  finally {
    await waitForResponseFloor(startedAt)
  }
})
