import { createError, readBody } from 'h3'
import {
  asRecord,
  getRequiredParam,
  requireCrmSession,
  requireOrganizationAdmin,
  requiredText,
  throwDbError,
} from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const teamId = getRequiredParam(event, 'teamId')
  requireOrganizationAdmin(session)
  const body = asRecord(await readBody(event))
  const role = requiredText(body.role, 'role')
  if (role !== 'member') {
    throw createError({ statusCode: 400, statusMessage: 'Team membership role must be member' })
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
