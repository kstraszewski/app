import { createError, readBody } from 'h3'
import {
  asRecord,
  getRequiredParam,
  requireCrmSession,
  requireSafeTeamAdminRemoval,
  requireTeamAdmin,
  requiredText,
  throwDbError,
} from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const teamId = getRequiredParam(event, 'teamId')
  const body = asRecord(await readBody(event))
  const role = requiredText(body.role, 'role')
  if (role !== 'member' && role !== 'admin') {
    throw createError({ statusCode: 400, statusMessage: 'Team membership role must be admin or member' })
  }
  const userId = getRequiredParam(event, 'userId')
  if (role === 'member') {
    await requireSafeTeamAdminRemoval(session, teamId, userId)
  } else {
    await requireTeamAdmin(session, teamId)
  }
  const { data, error } = await session.supabase
    .from('team_memberships')
    .update({ role })
    .eq('organization_id', session.organizationId)
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .select('*')
    .single()

  throwDbError(error, 404)
  return { data }
})
