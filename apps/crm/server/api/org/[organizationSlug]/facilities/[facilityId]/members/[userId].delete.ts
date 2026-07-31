import { requireCrmSession, throwDbError } from '~~/server/utils/crm'
import { requireFacilityPermission, uuidValue } from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const access = await requireFacilityPermission(session, getRouterParam(event, 'facilityId'), 'manage')
  const userId = uuidValue(getRouterParam(event, 'userId'), 'userId')
  const { data, error } = await session.dataApi
    .from('facility_memberships')
    .delete()
    .eq('organization_id', session.organizationId)
    .eq('facility_id', access.facility.id)
    .eq('user_id', userId)
    .select('user_id')
    .maybeSingle()
  throwDbError(error)
  if (!data) throw createError({ statusCode: 404, statusMessage: 'Facility member not found' })
  return { ok: true }
})
