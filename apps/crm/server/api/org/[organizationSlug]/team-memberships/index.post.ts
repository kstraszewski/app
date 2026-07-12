import { readBody } from 'h3'
import {
  asRecord,
  requireCrmSession,
  requireOrganizationAdmin,
  requiredText,
  textValue,
  throwDbError,
} from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  requireOrganizationAdmin(session)
  const body = asRecord(await readBody(event))
  const { data, error } = await session.supabase
    .from('team_memberships')
    .insert({
      organization_id: session.organizationId,
      team_id: requiredText(body.team_id, 'team_id'),
      user_id: requiredText(body.user_id, 'user_id'),
      role: textValue(body.role) ?? 'member',
    })
    .select('*')
    .single()

  throwDbError(error)
  return { data }
})
