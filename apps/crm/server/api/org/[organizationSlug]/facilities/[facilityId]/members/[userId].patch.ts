import { readBody } from 'h3'
import { asRecord, requireCrmSession, throwDbError } from '~~/server/utils/crm'
import {
  booleanValue,
  enumValue,
  integerValue,
  requireFacilityPermission,
  uuidValue,
} from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const access = await requireFacilityPermission(session, getRouterParam(event, 'facilityId'), 'manage')
  const userId = uuidValue(getRouterParam(event, 'userId'), 'userId')
  const body = asRecord(await readBody(event))
  const patch: Record<string, unknown> = {}
  if ('role' in body) patch.role = enumValue(body.role, 'role', ['admin', 'member'] as const)
  if ('isBookable' in body || 'is_bookable' in body) patch.is_bookable = booleanValue(body.isBookable ?? body.is_bookable, 'isBookable')
  if ('bookingPriority' in body || 'booking_priority' in body) patch.booking_priority = integerValue(body.bookingPriority ?? body.booking_priority, 'bookingPriority', 0, 10_000)
  if (!Object.keys(patch).length) {
    throw createError({ statusCode: 400, statusMessage: 'No supported membership fields provided' })
  }

  const { data, error } = await session.supabase
    .from('facility_memberships')
    .update(patch)
    .eq('organization_id', session.organizationId)
    .eq('facility_id', access.facility.id)
    .eq('user_id', userId)
    .select('*')
    .single()
  throwDbError(error, 404)
  return { data }
})
