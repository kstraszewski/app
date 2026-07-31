import { serverDataBackend } from '~~/server/utils/data-api'
import { getQuery, setHeader } from 'h3'
import {
  dateValue,
  optionalUuidValue,
  requireFacilityPermission,
  throwBookingError,
  uuidValue,
} from '~~/server/utils/scheduling'
import { getRequiredParam, requireCrmSession } from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const facilityId = uuidValue(getRequiredParam(event, 'facilityId'), 'facilityId')
  await requireFacilityPermission(session, facilityId, 'view')

  const query = getQuery(event)
  const serviceId = uuidValue(query.serviceId ?? query.service_id, 'serviceId')
  const expertUserId = optionalUuidValue(
    query.expertUserId ?? query.expert_user_id,
    'expertUserId',
  )
  const localDate = dateValue(query.date ?? query.localDate ?? query.local_date)
  const backendData = serverDataBackend(event) as any
  const { data, error } = await backendData.rpc('get_staff_booking_slots', {
    p_organization_id: session.organizationId,
    p_facility_id: facilityId,
    p_service_id: serviceId,
    p_local_date: localDate,
    p_expert_user_id: expertUserId,
  })
  throwBookingError(error)
  setHeader(event, 'Cache-Control', 'no-store')
  return {
    date: localDate,
    slots: (data ?? []).map((slot: Record<string, unknown>) => ({
      startsAt: String(slot.starts_at ?? ''),
      endsAt: String(slot.ends_at ?? ''),
      expertUserId: String(slot.expert_user_id ?? ''),
      expertName: String(slot.expert_name ?? ''),
    })),
  }
})
