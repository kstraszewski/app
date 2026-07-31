import { createError } from 'h3'
import {
  getRequiredParam,
  requireCrmSession,
  requireSafeTeamAdminRemoval,
  throwDbError,
} from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const teamId = getRequiredParam(event, 'teamId')
  const userId = getRequiredParam(event, 'userId')
  await requireSafeTeamAdminRemoval(session, teamId, userId)
  const { data, error } = await session.dataApi
    .from('team_memberships')
    .delete()
    .eq('organization_id', session.organizationId)
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .select('team_id')
    .maybeSingle()

  throwDbError(error)
  if (!data) {
    throw createError({ statusCode: 404, statusMessage: 'Team membership not found' })
  }
  return { ok: true }
})
