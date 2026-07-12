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
  requireOrganizationAdmin(session)
  const body = asRecord(await readBody(event))
  const { data, error } = await session.supabase.rpc('add_team_edge', {
    organization_id: session.organizationId,
    parent_team_id: requiredText(body.parent_team_id, 'parent_team_id'),
    child_team_id: requiredText(body.child_team_id, 'child_team_id'),
  })

  throwDbError(error)
  return { data: Array.isArray(data) ? data[0] : data }
})
