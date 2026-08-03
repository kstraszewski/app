import { serverDataBackend } from '~~/server/utils/data-api'
import { setHeader } from 'h3'
import {
  getRequiredParam,
  requireCrmSession,
  throwDbError,
} from '~~/server/utils/crm'
import {
  isCrmMeetingUuid,
  normalizeCrmMeetingPreparation,
  parseCrmMeetingContext,
} from '~~/server/utils/crm-meetings'
import { requireFacilityPermission } from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const id = getRequiredParam(event, 'id')
  if (!isCrmMeetingUuid(id)) {
    throw createError({ statusCode: 404, statusMessage: 'Meeting not found' })
  }

  const backendData = serverDataBackend(event) as any
  const appointmentResult = await backendData
    .from('appointments')
    .select('id, facility_id, booking_context')
    .eq('organization_id', session.organizationId)
    .eq('id', id)
    .contains('booking_context', { crmMeeting: { version: 1 } })
    .maybeSingle()
  throwDbError(appointmentResult.error)
  const appointment = appointmentResult.data
  if (!appointment) {
    throw createError({ statusCode: 404, statusMessage: 'Meeting not found' })
  }

  await requireFacilityPermission(session, String(appointment.facility_id), 'view')
  const context = parseCrmMeetingContext(appointment.booking_context)
  if (!context) {
    throw createError({ statusCode: 404, statusMessage: 'Meeting not found' })
  }

  const preparationResult = await backendData
    .from('crm_case_meeting_preparations')
    .select('case_id, appointment_id, answers, revision, completed_at, updated_at')
    .eq('organization_id', session.organizationId)
    .eq('case_id', context.caseId)
    .eq('appointment_id', id)
    .maybeSingle()
  throwDbError(preparationResult.error)

  setHeader(event, 'Cache-Control', 'no-store')
  return {
    data: preparationResult.data
      ? normalizeCrmMeetingPreparation(preparationResult.data)
      : null,
  }
})
