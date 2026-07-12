import { readBody } from 'h3'
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
  requireOrganizationAdmin(session)
  const body = asRecord(await readBody(event))
  const { data, error } = await session.supabase
    .from('team_memberships')
    .update({ role: requiredText(body.role, 'role') })
    .eq('organization_id', session.organizationId)
    .eq('team_id', getRequiredParam(event, 'teamId'))
    .eq('user_id', getRequiredParam(event, 'userId'))
    .select('*')
    .single()

  throwDbError(error, 404)
  return { data }
})
