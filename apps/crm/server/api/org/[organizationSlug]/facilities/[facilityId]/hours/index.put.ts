import { readBody } from 'h3'
import { asRecord, requireCrmSession, throwDbError } from '~~/server/utils/crm'
import {
  openingHoursPayload,
  openingOverridesPayload,
  requireFacilityPermission,
} from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const access = await requireFacilityPermission(session, getRouterParam(event, 'facilityId'), 'manage')
  const body = asRecord(await readBody(event))
  const openingHours = openingHoursPayload(body.openingHours ?? body.opening_hours)
  const overrides = openingOverridesPayload(body.overrides)

  const { error } = await session.supabase.rpc('replace_facility_opening_hours', {
    p_organization_id: session.organizationId,
    p_facility_id: access.facility.id,
    p_hours: openingHours,
    p_overrides: overrides,
  })
  throwDbError(error)

  const [hoursResult, overridesResult] = await Promise.all([
    session.supabase
      .from('facility_opening_hours')
      .select('*')
      .eq('organization_id', session.organizationId)
      .eq('facility_id', access.facility.id)
      .order('weekday')
      .order('opens_at'),
    session.supabase
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
