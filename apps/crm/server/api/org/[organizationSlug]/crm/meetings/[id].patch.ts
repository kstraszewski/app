import { serverDataBackend } from '~~/server/utils/data-api'
import { readBody, setHeader } from 'h3'
import {
  asRecord,
  getRequiredParam,
  recordCrmActivity,
  requireCrmSession,
  throwDbError,
} from '~~/server/utils/crm'
import {
  bookingContextWithCrmMeeting,
  CRM_MEETING_PROCESS_STEPS,
  crmMeetingAppointmentSelect,
  isCrmMeetingUuid,
  normalizeCrmMeetingRecord,
  parseCrmMeetingContext,
  type CrmMeetingContext,
  type CrmMeetingSharedState,
} from '~~/server/utils/crm-meetings'
import {
  enumValue,
  optionalUuidValue,
  requireFacilityPermission,
  uuidArrayValue,
} from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const id = getRequiredParam(event, 'id')
  if (!isCrmMeetingUuid(id)) {
    throw createError({ statusCode: 404, statusMessage: 'Meeting not found' })
  }

  const body = asRecord(await readBody(event))
  const action = enumValue(body.action, 'action', ['start', 'end', 'publish'] as const)
  const backendData = serverDataBackend(event) as any
  const appointmentResult = await backendData
    .from('appointments')
    .select(crmMeetingAppointmentSelect)
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

  if (
    (action === 'start' && context.status === 'live')
    || (action === 'end' && context.status === 'ended')
  ) {
    setHeader(event, 'Cache-Control', 'no-store')
    return {
      data: await normalizeCrmMeetingRecord(
        backendData,
        session.organizationId,
        appointment,
      ),
    }
  }
  if (appointment.status === 'cancelled') {
    throw createError({ statusCode: 409, statusMessage: 'A cancelled meeting cannot be changed' })
  }

  const now = new Date().toISOString()
  let nextContext: CrmMeetingContext
  if (action === 'start') {
    if (context.status !== 'scheduled') {
      throw createError({ statusCode: 409, statusMessage: 'Only a scheduled meeting can be started' })
    }
    nextContext = {
      ...context,
      status: 'live',
      startedAt: now,
      endedAt: null,
    }
  } else if (action === 'end') {
    if (context.status !== 'live') {
      throw createError({ statusCode: 409, statusMessage: 'Only a live meeting can be ended' })
    }
    nextContext = {
      ...context,
      status: 'ended',
      endedAt: now,
    }
  } else {
    if (context.status !== 'live') {
      throw createError({
        statusCode: 409,
        statusMessage: 'Materials can be published only during a live meeting',
      })
    }
    const kind = enumValue(
      body.kind,
      'kind',
      ['none', 'mortgage-process', 'mortgage-offers'] as const,
    )
    let shared: CrmMeetingSharedState

    if (kind === 'none') {
      shared = {
        kind,
        processStepId: null,
        offerIds: [],
        activeOfferId: null,
        updatedAt: now,
      }
    } else if (kind === 'mortgage-process') {
      const processStepId = enumValue(
        body.processStepId ?? body.process_step_id,
        'processStepId',
        CRM_MEETING_PROCESS_STEPS,
      )
      shared = {
        kind,
        processStepId,
        offerIds: [],
        activeOfferId: null,
        updatedAt: now,
      }
    } else {
      const offerIds = uuidArrayValue(
        body.offerIds ?? body.offer_ids,
        'offerIds',
        3,
      )
      if (!offerIds.length) {
        throw createError({
          statusCode: 400,
          statusMessage: 'At least one offer is required',
        })
      }
      const activeOfferId = optionalUuidValue(
        body.activeOfferId ?? body.active_offer_id,
        'activeOfferId',
      )
      if (activeOfferId && !offerIds.includes(activeOfferId)) {
        throw createError({
          statusCode: 400,
          statusMessage: 'activeOfferId must be one of offerIds',
        })
      }

      const offersResult = await backendData
        .from('crm_case_offer_snapshots')
        .select('id')
        .eq('organization_id', session.organizationId)
        .eq('case_id', context.caseId)
        .in('id', offerIds)
      throwDbError(offersResult.error)
      const foundOfferIds = new Set(
        (offersResult.data ?? []).map((offer: any) => String(offer.id)),
      )
      if (offerIds.some(offerId => !foundOfferIds.has(offerId))) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Every published offer must belong to the meeting case',
        })
      }

      shared = {
        kind,
        processStepId: null,
        offerIds,
        activeOfferId,
        updatedAt: now,
      }
    }
    nextContext = { ...context, shared }
  }

  const updateResult = await backendData
    .from('appointments')
    .update({
      booking_context: bookingContextWithCrmMeeting(
        appointment.booking_context,
        nextContext,
      ),
    })
    .eq('organization_id', session.organizationId)
    .eq('id', id)
    .eq('updated_at', appointment.updated_at)
    .select(crmMeetingAppointmentSelect)
    .maybeSingle()
  throwDbError(updateResult.error)
  if (!updateResult.data) {
    throw createError({
      statusCode: 409,
      statusMessage: 'The meeting changed. Refresh it and try again.',
    })
  }

  const meeting = await normalizeCrmMeetingRecord(
    backendData,
    session.organizationId,
    updateResult.data,
  )
  const activity = action === 'start'
    ? { activity_type: 'meeting_started', title: 'Rozpoczęto spotkanie' }
    : action === 'end'
      ? { activity_type: 'meeting_ended', title: 'Zakończono spotkanie' }
      : { activity_type: 'meeting_materials_published', title: 'Udostępniono materiały na spotkaniu' }
  await recordCrmActivity(session, {
    client_id: meeting.clientId,
    case_id: meeting.caseId,
    ...activity,
    payload: {
      appointment_id: meeting.id,
      shared_kind: meeting.shared.kind,
      offer_ids: meeting.shared.offerIds,
      process_step_id: meeting.shared.processStepId,
    },
  })

  setHeader(event, 'Cache-Control', 'no-store')
  return { data: meeting }
})
