import {
  getRequiredParam,
  requireAdministrativePermission,
  requireCrmSession,
  throwDbError,
} from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  await requireAdministrativePermission(session, 'structure.manage')
  const teamId = getRequiredParam(event, 'teamId')
  const { error } = await session.supabase
    .from('teams')
    .delete()
    .eq('organization_id', session.organizationId)
    .eq('id', teamId)

  throwDbError(error)
  return { ok: true }
})
