import { requireCrmSession, throwDbError } from '~~/server/utils/crm'
import { requireFacilityPermission } from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const access = await requireFacilityPermission(session, getRouterParam(event, 'facilityId'), 'view')
  const [hoursResult, overridesResult] = await Promise.all([
    session.dataApi
      .from('facility_opening_hours')
      .select('*')
      .eq('organization_id', session.organizationId)
      .eq('facility_id', access.facility.id)
      .order('weekday')
      .order('opens_at'),
    session.dataApi
      .from('facility_opening_overrides')
      .select('*')
      .eq('organization_id', session.organizationId)
      .eq('facility_id', access.facility.id)
      .order('local_date'),
  ])
  throwDbError(hoursResult.error)
  throwDbError(overridesResult.error)
  return {
    openingHours: hoursResult.data ?? [],
    overrides: overridesResult.data ?? [],
  }
})
