import { createError, getRouterParam, readBody, setHeader } from 'h3'
import { serverDataBackend } from '~~/server/utils/data-api'
import {
  asRecord,
  requirePortalCaseAccess,
  requiredUuid,
  throwPortalDbError,
} from '~~/server/utils/portal-auth'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const caseId = requiredUuid(getRouterParam(event, 'caseId'), 'caseId')
  const access = await requirePortalCaseAccess(event, caseId)
  const body = asRecord(await readBody(event))
  if (Object.keys(body).some(key => key !== 'message')) {
    throw createError({ statusCode: 400, statusMessage: 'Unsupported message field' })
  }
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (message.length < 2 || message.length > 4000) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Message must contain between 2 and 4000 characters',
    })
  }

  const backend = serverDataBackend(event) as any
  const since = new Date(Date.now() - 60_000).toISOString()
  const recentResult = await backend
    .from('crm_activities')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', access.grant.organizationId)
    .eq('case_id', caseId)
    .eq('actor_auth_user_id', access.session.identity.userId)
    .eq('activity_type', 'client_portal_message')
    .gte('created_at', since)
  throwPortalDbError(recentResult.error, 'could not check message rate limit')
  if ((recentResult.count ?? 0) >= 5) {
    throw createError({ statusCode: 429, statusMessage: 'Too many messages' })
  }

  const activityResult = await backend
    .from('crm_activities')
    .insert({
      organization_id: access.grant.organizationId,
      actor_user_id: null,
      actor_client_person_id: access.link.clientPersonId,
      actor_auth_user_id: access.session.identity.userId,
      client_id: access.grant.clientId,
      case_id: caseId,
      activity_type: 'client_portal_message',
      title: 'Wiadomość od klienta z panelu',
      body: message,
      payload: { source: 'client_portal' },
    })
    .select('id, created_at')
    .single()
  throwPortalDbError(activityResult.error, 'could not save client message')

  return {
    data: {
      id: String(activityResult.data.id),
      createdAt: String(activityResult.data.created_at),
      delivered: true,
    },
  }
})
