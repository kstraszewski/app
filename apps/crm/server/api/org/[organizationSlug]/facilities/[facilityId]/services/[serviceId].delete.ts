import { requireCrmSession, throwDbError } from '~~/server/utils/crm'
import { requireFacilityPermission, uuidValue } from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const access = await requireFacilityPermission(session, getRouterParam(event, 'facilityId'), 'manage')
  const serviceId = uuidValue(getRouterParam(event, 'serviceId'), 'serviceId')
  const { data, error } = await session.supabase
    .from('facility_services')
    .delete()
    .eq('organization_id', session.organizationId)
    .eq('facility_id', access.facility.id)
    .eq('service_id', serviceId)
    .select('service_id')
    .maybeSingle()
  throwDbError(error)
  if (!data) throw createError({ statusCode: 404, statusMessage: 'Facility service not found' })
  return { ok: true }
})
