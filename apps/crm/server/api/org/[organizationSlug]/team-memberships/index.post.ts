import { readBody } from 'h3'
import {
  asRecord,
  requireCrmSession,
  requireOrganizationAdmin,
  requiredText,
  throwDbError,
} from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const body = asRecord(await readBody(event))
  const teamId = requiredText(body.team_id, 'team_id')
  requireOrganizationAdmin(session)
  const { data, error } = await session.supabase
    .from('team_memberships')
    .insert({
      organization_id: session.organizationId,
      team_id: teamId,
      user_id: requiredText(body.user_id, 'user_id'),
      role: 'member',
    })
    .select('*')
    .single()

  throwDbError(error)
  return { data }
})
