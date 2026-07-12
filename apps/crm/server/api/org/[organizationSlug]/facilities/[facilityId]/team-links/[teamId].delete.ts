import { requireCrmSession, throwDbError } from '~~/server/utils/crm'
import { requireFacilityPermission, uuidValue } from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const access = await requireFacilityPermission(session, getRouterParam(event, 'facilityId'), 'manage')
  const teamId = uuidValue(getRouterParam(event, 'teamId'), 'teamId')

  const { data, error } = await session.supabase
    .from('team_facilities')
    .delete()
    .eq('organization_id', session.organizationId)
    .eq('facility_id', access.facility.id)
    .eq('team_id', teamId)
    .select('team_id')
    .maybeSingle()
  throwDbError(error)
  if (!data) throw createError({ statusCode: 404, statusMessage: 'Facility team link not found' })
  return { ok: true }
})
