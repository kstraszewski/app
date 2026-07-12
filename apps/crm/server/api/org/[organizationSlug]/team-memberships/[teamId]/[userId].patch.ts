import { createError, readBody } from 'h3'
import {
  asRecord,
  getRequiredParam,
  requireCrmSession,
  requireTeamAdmin,
  requiredText,
  throwDbError,
} from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const teamId = getRequiredParam(event, 'teamId')
  await requireTeamAdmin(session, teamId)
  const body = asRecord(await readBody(event))
  const role = requiredText(body.role, 'role')
  if (!['admin', 'member'].includes(role)) {
    throw createError({ statusCode: 400, statusMessage: 'role must be admin or member' })
  }
  const { data, error } = await session.supabase
    .from('team_memberships')
    .update({ role })
    .eq('organization_id', session.organizationId)
    .eq('team_id', teamId)
    .eq('user_id', getRequiredParam(event, 'userId'))
    .select('*')
    .single()

  throwDbError(error, 404)
  return { data }
})
