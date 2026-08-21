import { isOpenExpertSameOriginJsonRequest } from '@openexpert/auth/server'
import { createError, readBody, setHeader, setResponseStatus } from 'h3'
import {
  asRecord,
  requireCrmSession,
  requireOrganizationAdmin,
} from '~~/server/utils/crm'
import { createOrganizationMemberInvitation } from '~~/server/utils/organization-member-invitations'
import { serverAuth } from '~~/server/utils/platform-auth'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const runtime = serverAuth(event)
  if (!isOpenExpertSameOriginJsonRequest(event.headers, runtime.config.baseURL)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }
  const session = await requireCrmSession(event)
  requireOrganizationAdmin(session)
  if (session.organizationKind !== 'application') {
    throw createError({ statusCode: 409, statusMessage: 'Paid seat invitations require an application organization' })
  }

  const body = asRecord(await readBody(event))
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const role = body.role === 'admin' ? 'admin' : body.role === 'expert' ? 'expert' : ''
  const invitedName = typeof body.invitedName === 'string' ? body.invitedName.trim() : ''
  if (!EMAIL_PATTERN.test(email) || email.length > 320) {
    throw createError({ statusCode: 400, statusMessage: 'Valid email is required' })
  }
  if (!role) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid organization role' })
  }
  if (invitedName.length > 200 || /[\p{Cc}\p{Cf}]/u.test(invitedName)) {
    throw createError({ statusCode: 400, statusMessage: 'Invited name is invalid' })
  }

  const result = await createOrganizationMemberInvitation(event, {
    organizationId: session.organizationId,
    organizationName: session.organizationName,
    actorUserId: session.userId,
    email,
    invitedName: invitedName || null,
    role,
  })
  setResponseStatus(event, 201)
  return result
})
