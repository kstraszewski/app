import {
  getRequiredParam,
  requireAdministrativePermission,
  requireCrmSession,
  throwDbError,
} from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  await requireAdministrativePermission(session, 'structure.manage')
  const { error } = await session.supabase
    .from('team_edges')
    .delete()
    .eq('organization_id', session.organizationId)
    .eq('parent_team_id', getRequiredParam(event, 'parentTeamId'))
    .eq('child_team_id', getRequiredParam(event, 'childTeamId'))

  throwDbError(error)
  return { ok: true }
})
