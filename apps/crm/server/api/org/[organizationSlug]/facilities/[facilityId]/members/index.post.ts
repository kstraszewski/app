import { readBody } from 'h3'
import { asRecord, requireCrmSession, throwDbError } from '~~/server/utils/crm'
import {
  assertOrganizationMemberIds,
  booleanValue,
  integerValue,
  requireFacilityPermission,
  uuidValue,
} from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const access = await requireFacilityPermission(session, getRouterParam(event, 'facilityId'), 'manage')
  const body = asRecord(await readBody(event))
  const userId = uuidValue(body.userId ?? body.user_id, 'userId')
  await assertOrganizationMemberIds(session, [userId])

  const { data, error } = await session.dataApi
    .from('facility_memberships')
    .upsert({
      organization_id: session.organizationId,
      facility_id: access.facility.id,
      user_id: userId,
      role: 'member',
      is_bookable: body.isBookable === undefined && body.is_bookable === undefined
        ? true
        : booleanValue(body.isBookable ?? body.is_bookable, 'isBookable'),
      booking_priority: body.bookingPriority === undefined && body.booking_priority === undefined
        ? 100
        : integerValue(body.bookingPriority ?? body.booking_priority, 'bookingPriority', 0, 10_000),
    }, { onConflict: 'organization_id,facility_id,user_id' })
    .select('*')
    .single()
  throwDbError(error)
  return { data }
})
