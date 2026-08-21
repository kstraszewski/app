import { isOpenExpertSameOriginJsonRequest } from '@openexpert/auth/server'
import { createError, getRouterParam, setHeader } from 'h3'
import { requireCrmSession, requireOrganizationAdmin } from '~~/server/utils/crm'
import { revokeOrganizationMemberInvitation } from '~~/server/utils/organization-member-invitations'
import { serverAuth } from '~~/server/utils/platform-auth'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const runtime = serverAuth(event)
  if (!isOpenExpertSameOriginJsonRequest(event.headers, runtime.config.baseURL)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }
  const session = await requireCrmSession(event)
  requireOrganizationAdmin(session)
  const invitationId = String(getRouterParam(event, 'invitationId') || '')
  if (!UUID_PATTERN.test(invitationId)) {
    throw createError({ statusCode: 404, statusMessage: 'Member invitation not found' })
  }
  return {
    invitation: await revokeOrganizationMemberInvitation(event, {
      organizationId: session.organizationId,
      actorUserId: session.userId,
      invitationId,
    }),
  }
})
