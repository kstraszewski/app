import { createError, readBody } from 'h3'
import {
  asRecord,
  requireCrmSession,
  requireTeamAdmin,
  requiredText,
  textValue,
  throwDbError,
} from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const body = asRecord(await readBody(event))
  const teamId = requiredText(body.team_id, 'team_id')
  await requireTeamAdmin(session, teamId)
  const role = textValue(body.role) ?? 'member'
  if (!['admin', 'member'].includes(role)) {
    throw createError({ statusCode: 400, statusMessage: 'role must be admin or member' })
  }
  const { data, error } = await session.supabase
    .from('team_memberships')
    .insert({
      organization_id: session.organizationId,
      team_id: teamId,
      user_id: requiredText(body.user_id, 'user_id'),
      role,
    })
    .select('*')
    .single()

  throwDbError(error)
  return { data }
})
