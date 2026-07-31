import { requireCrmSession, throwDbError } from '~~/server/utils/crm'
import { requireFacilityPermission } from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const access = await requireFacilityPermission(session, getRouterParam(event, 'facilityId'), 'view')
  const { data: memberships, error } = await session.dataApi
    .from('facility_memberships')
    .select('*')
    .eq('organization_id', session.organizationId)
    .eq('facility_id', access.facility.id)
    .order('role')
    .order('booking_priority')
  throwDbError(error)

  const userIds = (memberships ?? []).map((row: any) => String(row.user_id))
  const { data: users, error: usersError } = userIds.length
    ? await session.dataApi.from('users').select('id, email, full_name, avatar_url').in('id', userIds)
    : { data: [], error: null }
  throwDbError(usersError)
  const usersById = new Map((users ?? []).map((user: any) => [String(user.id), user]))

  return {
    data: (memberships ?? []).map((membership: any) => ({
      ...membership,
      user: usersById.get(String(membership.user_id)) ?? null,
    })),
  }
})
