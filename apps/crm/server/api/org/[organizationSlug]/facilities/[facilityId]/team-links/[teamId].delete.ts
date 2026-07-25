import {
  requireCrmSession,
  requireFacilityAdminMembership,
  requireTeamAdmin,
  throwDbError,
} from '~~/server/utils/crm'
import { uuidValue } from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const facilityId = uuidValue(getRouterParam(event, 'facilityId'), 'facilityId')
  const teamId = uuidValue(getRouterParam(event, 'teamId'), 'teamId')
  await Promise.all([
    requireTeamAdmin(session, teamId),
    requireFacilityAdminMembership(session, facilityId),
  ])

  const { data, error } = await session.supabase
    .from('team_facilities')
    .delete()
    .eq('organization_id', session.organizationId)
    .eq('facility_id', facilityId)
    .eq('team_id', teamId)
    .select('team_id')
    .maybeSingle()
  throwDbError(error)
  if (!data) throw createError({ statusCode: 404, statusMessage: 'Facility team link not found' })
  return { ok: true }
})
