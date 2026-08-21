import { isOpenExpertSameOriginJsonRequest } from '@openexpert/auth/server'
import { createError, getRouterParam, setHeader } from 'h3'
import {
  requireAuthenticatedSession,
  requireSuperAdmin,
} from '~~/server/utils/crm'
import { revokeOrganizationInvitation } from '~~/server/utils/organization-invitations'
import { serverAuth } from '~~/server/utils/platform-auth'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const runtime = serverAuth(event)
  if (!isOpenExpertSameOriginJsonRequest(event.headers, runtime.config.baseURL)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }
  const session = await requireAuthenticatedSession(event)
  await requireSuperAdmin(session)
  const invitation = await revokeOrganizationInvitation(
    event,
    String(getRouterParam(event, 'invitationId') || ''),
  )
  return { invitation }
})
