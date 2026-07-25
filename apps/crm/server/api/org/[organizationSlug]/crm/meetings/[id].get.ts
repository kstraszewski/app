import { serverSupabaseServiceRole } from '#supabase/server'
import { setHeader } from 'h3'
import {
  getRequiredParam,
  requireCrmSession,
  throwDbError,
} from '~~/server/utils/crm'
import {
  crmMeetingAppointmentSelect,
  isCrmMeetingUuid,
  normalizeCrmMeetingRecord,
} from '~~/server/utils/crm-meetings'
import { requireFacilityPermission } from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const id = getRequiredParam(event, 'id')
  if (!isCrmMeetingUuid(id)) {
    throw createError({ statusCode: 404, statusMessage: 'Meeting not found' })
  }

  const serviceRole = serverSupabaseServiceRole(event) as any
  const result = await serviceRole
    .from('appointments')
    .select(crmMeetingAppointmentSelect)
    .eq('organization_id', session.organizationId)
    .eq('id', id)
    .contains('booking_context', { crmMeeting: { version: 1 } })
    .maybeSingle()
  throwDbError(result.error)
  if (!result.data) {
    throw createError({ statusCode: 404, statusMessage: 'Meeting not found' })
  }

  await requireFacilityPermission(session, String(result.data.facility_id), 'view')
  setHeader(event, 'Cache-Control', 'no-store')
  return {
    data: await normalizeCrmMeetingRecord(
      serviceRole,
      session.organizationId,
      result.data,
    ),
  }
})
