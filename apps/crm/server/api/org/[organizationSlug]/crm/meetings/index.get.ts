import { serverDataBackend } from '~~/server/utils/data-api'
import { setHeader } from 'h3'
import { requireCrmSession, throwDbError } from '~~/server/utils/crm'
import {
  crmMeetingAppointmentSelect,
  normalizeCrmMeetingRecords,
} from '~~/server/utils/crm-meetings'
import { listAccessibleFacilityIds } from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  setHeader(event, 'Cache-Control', 'no-store')

  const facilityIds = await listAccessibleFacilityIds(session)
  if (facilityIds?.length === 0) return { data: [] }

  const backendData = serverDataBackend(event) as any
  let request = backendData
    .from('appointments')
    .select(crmMeetingAppointmentSelect)
    .eq('organization_id', session.organizationId)
    .contains('booking_context', { crmMeeting: { version: 1 } })
    .order('starts_at', { ascending: false })
    .limit(200)
  if (facilityIds) request = request.in('facility_id', facilityIds)

  const result = await request
  throwDbError(result.error)
  return {
    data: await normalizeCrmMeetingRecords(
      backendData,
      session.organizationId,
      result.data ?? [],
    ),
  }
})
