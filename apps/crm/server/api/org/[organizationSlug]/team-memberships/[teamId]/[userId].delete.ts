import {
  getRequiredParam,
  requireCrmSession,
  requireOrganizationAdmin,
  throwDbError,
} from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const teamId = getRequiredParam(event, 'teamId')
  requireOrganizationAdmin(session)
  const { error } = await session.supabase
    .from('team_memberships')
    .delete()
    .eq('organization_id', session.organizationId)
    .eq('team_id', teamId)
    .eq('user_id', getRequiredParam(event, 'userId'))

  throwDbError(error)
  return { ok: true }
})
