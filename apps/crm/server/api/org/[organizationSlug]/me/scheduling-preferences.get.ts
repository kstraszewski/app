import { serverDataBackend } from '~~/server/utils/data-api'
import { setHeader } from 'h3'
import { requireCrmSession, throwDbError } from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  setHeader(event, 'Cache-Control', 'private, no-store')

  const backendData = serverDataBackend(event) as any
  const { data: preferences, error: preferencesError } = await backendData
    .from('organization_user_preferences')
    .select('default_facility_id')
    .eq('organization_id', session.organizationId)
    .eq('user_id', session.userId)
    .maybeSingle()
  throwDbError(preferencesError)

  const requestedFacilityId = preferences?.default_facility_id
    ? String(preferences.default_facility_id)
    : null
  if (!requestedFacilityId) {
    return { defaultFacilityId: null }
  }

  // The preference can become stale when a facility is disabled or the user
  // loses its membership. Querying with the authenticated client applies the
  // normal facility visibility policy and keeps that stale value out of UI.
  const { data: facility, error: facilityError } = await session.dataApi
    .from('facilities')
    .select('id')
    .eq('organization_id', session.organizationId)
    .eq('id', requestedFacilityId)
    .eq('is_active', true)
    .maybeSingle()
  throwDbError(facilityError)

  return {
    defaultFacilityId: facility ? String(facility.id) : null,
  }
})
