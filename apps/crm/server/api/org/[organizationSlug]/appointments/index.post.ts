import { serverDataBackend } from '~~/server/utils/data-api'
import { readBody, setHeader, setResponseStatus } from 'h3'
import { asRecord, requireCrmSession, throwDbError } from '~~/server/utils/crm'
import {
  assertFacilityBookableMemberIds,
  enumValue,
  idempotencyKeyValue,
  isoDateTimeValue,
  limitedText,
  optionalUuidValue,
  requireFacilityPermission,
  throwBookingError,
  uuidValue,
} from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const body = asRecord(await readBody(event))
  const facilityId = uuidValue(body.facilityId ?? body.facility_id, 'facilityId')
  const serviceId = uuidValue(body.serviceId ?? body.service_id, 'serviceId')
  const expertUserId = uuidValue(body.expertUserId ?? body.expert_user_id, 'expertUserId')
  const clientId = uuidValue(body.clientId ?? body.client_id, 'clientId')
  const clientPersonId = optionalUuidValue(
    body.clientPersonId ?? body.client_person_id,
    'clientPersonId',
  )
  const meetingMode = enumValue(
    body.meetingMode ?? body.meeting_mode ?? 'office',
    'meetingMode',
    ['office', 'online'] as const,
  )
  const meetingUrl = limitedText(
    body.meetingUrl ?? body.meeting_url,
    'meetingUrl',
    2_000,
    { nullable: true },
  ) ?? null
  if (meetingMode === 'office' && meetingUrl) {
    throw createError({
      statusCode: 400,
      statusMessage: 'meetingUrl is only available for online meetings',
    })
  }
  if (meetingUrl) {
    try {
      const url = new URL(meetingUrl)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new Error('Unsupported meeting URL')
      }
    } catch {
      throw createError({
        statusCode: 400,
        statusMessage: 'meetingUrl must be a valid HTTP(S) URL',
      })
    }
  }
  const startsAt = isoDateTimeValue(body.startsAt ?? body.starts_at, 'startsAt')
  const notes = limitedText(body.notes, 'notes', 2_000, { nullable: true }) ?? null
  const idempotencyKey = idempotencyKeyValue(body.idempotencyKey ?? body.idempotency_key)

  await requireFacilityPermission(session, facilityId, 'view')
  await assertFacilityBookableMemberIds(session, facilityId, [expertUserId])

  const backendData = serverDataBackend(event) as any
  const clientRequest = backendData
    .from('crm_clients')
    .select('id')
    .eq('organization_id', session.organizationId)
    .eq('id', clientId)
    .maybeSingle()
  const personRequest = clientPersonId
    ? backendData
        .from('crm_client_people')
        .select('id')
        .eq('organization_id', session.organizationId)
        .eq('client_id', clientId)
        .eq('id', clientPersonId)
        .maybeSingle()
    : Promise.resolve({ data: null, error: null })
  const [clientResult, personResult] = await Promise.all([clientRequest, personRequest])
  throwDbError(clientResult.error)
  throwDbError(personResult.error)
  if (!clientResult.data) {
    throw createError({ statusCode: 404, statusMessage: 'Client not found' })
  }
  if (clientPersonId && !personResult.data) {
    throw createError({ statusCode: 400, statusMessage: 'Client person does not belong to the selected client' })
  }

  const { data, error } = await backendData.rpc('create_staff_appointment', {
    p_organization_id: session.organizationId,
    p_facility_id: facilityId,
    p_service_id: serviceId,
    p_expert_user_id: expertUserId,
    p_client_id: clientId,
    p_client_person_id: clientPersonId,
    p_starts_at: startsAt,
    p_meeting_mode: meetingMode,
    p_meeting_url: meetingUrl,
    p_notes: notes,
    p_created_by_user_id: session.userId,
    p_idempotency_key: idempotencyKey,
  })
  throwBookingError(error)
  setHeader(event, 'Cache-Control', 'no-store')
  setResponseStatus(event, 201)
  return data
})
