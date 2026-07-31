import { serverDataBackend } from '~~/server/utils/data-api'
import { randomUUID } from 'node:crypto'
import {
  getRequestURL,
  readBody,
  setHeader,
  setResponseStatus,
} from 'h3'
import {
  asRecord,
  recordCrmActivity,
  requireCrmSession,
  throwDbError,
} from '~~/server/utils/crm'
import {
  bookingContextWithCrmMeeting,
  createCrmMeetingContext,
  crmMeetingAppointmentSelect,
  normalizeCrmMeetingRecord,
  parseCrmMeetingContext,
} from '~~/server/utils/crm-meetings'
import {
  assertFacilityBookableMemberIds,
  enumValue,
  idempotencyKeyValue,
  isoDateTimeValue,
  limitedText,
  requireFacilityPermission,
  throwBookingError,
  uuidValue,
} from '~~/server/utils/scheduling'

type CaseRequest =
  | { mode: 'create', clientId: string, title: string | null }
  | { mode: 'link', caseId: string }

type ClientContext = {
  clientId: string
  clientPersonId: string
  customerName: string
  customerEmail: string
  customerPhone: string | null
}

type SchedulingContext = {
  timezone: string
  durationMinutes: number
  bufferBeforeMinutes: number
  bufferAfterMinutes: number
}

function meetingUrl(event: Parameters<typeof getRequestURL>[0], appointmentId: string): string {
  const url = new URL('/client/claim', getRequestURL(event).origin)
  url.searchParams.set('appointmentId', appointmentId)
  url.searchParams.set('redirect', `/client/meetings/${encodeURIComponent(appointmentId)}`)
  return url.toString()
}

function parseCaseRequest(input: unknown): CaseRequest {
  const value = asRecord(input)
  const mode = enumValue(value.mode, 'case.mode', ['create', 'link'] as const)
  if (mode === 'create') {
    return {
      mode,
      clientId: uuidValue(value.clientId ?? value.client_id, 'case.clientId'),
      title: limitedText(value.title, 'case.title', 200, { nullable: true }) ?? null,
    }
  }
  return {
    mode,
    caseId: uuidValue(value.id ?? value.caseId ?? value.case_id, 'case.id'),
  }
}

function idempotentMeetingMatches(
  row: Record<string, any>,
  input: {
    timing: 'now' | 'scheduled'
    startsAt: string | null
    facilityId: string
    serviceId: string
    expertUserId: string
    caseRequest: CaseRequest
  },
): boolean {
  const context = parseCrmMeetingContext(row.booking_context)
  if (
    !context
    || String(row.facility_id) !== input.facilityId
    || String(row.service_id) !== input.serviceId
    || String(row.expert_user_id) !== input.expertUserId
    || (input.timing === 'scheduled' && String(row.starts_at) !== input.startsAt)
  ) return false

  if (input.caseRequest.mode === 'create') {
    return context.relationship === 'first'
      && String(row.client_id) === input.caseRequest.clientId
  }
  return context.relationship === 'follow-up'
    && context.caseId === input.caseRequest.caseId
}

async function findIdempotentAppointment(
  backendData: any,
  organizationId: string,
  userId: string,
  idempotencyKey: string,
): Promise<Record<string, any> | null> {
  const result = await backendData
    .from('appointments')
    .select(crmMeetingAppointmentSelect)
    .eq('organization_id', organizationId)
    .eq('created_by_user_id', userId)
    .eq('source', 'staff')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()
  throwDbError(result.error)
  return result.data ?? null
}

async function loadClientContext(
  backendData: any,
  organizationId: string,
  clientId: string,
): Promise<ClientContext> {
  const [clientResult, personResult] = await Promise.all([
    backendData
      .from('crm_clients')
      .select('id, display_name, primary_email, primary_phone')
      .eq('organization_id', organizationId)
      .eq('id', clientId)
      .maybeSingle(),
    backendData
      .from('crm_client_people')
      .select('id, display_name, email, email_normalized, phone, phone_normalized, role, created_at')
      .eq('organization_id', organizationId)
      .eq('client_id', clientId)
      .order('role', { ascending: true })
      .order('created_at')
      .limit(20),
  ])
  throwDbError(clientResult.error)
  throwDbError(personResult.error)
  if (!clientResult.data) {
    throw createError({ statusCode: 404, statusMessage: 'Client not found' })
  }

  const people = personResult.data ?? []
  const person = people.find((item: any) => item.role === 'primary') ?? people[0]
  if (!person) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Client must have a contact person before scheduling a meeting',
    })
  }

  const customerEmail = String(
    person.email_normalized
      || person.email
      || clientResult.data.primary_email
      || '',
  ).trim().toLowerCase()
  if (!customerEmail) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Client email is required for an online meeting',
    })
  }

  return {
    clientId,
    clientPersonId: String(person.id),
    customerName: String(
      person.display_name
        || clientResult.data.display_name
        || 'Klient',
    ),
    customerEmail,
    customerPhone: String(
      person.phone_normalized
        || person.phone
        || clientResult.data.primary_phone
        || '',
    ).trim() || null,
  }
}

async function loadSchedulingContext(
  backendData: any,
  organizationId: string,
  facilityId: string,
  serviceId: string,
  expertUserId: string,
  facility: Record<string, any>,
): Promise<SchedulingContext> {
  const [serviceResult, facilityServiceResult, expertResult, membershipResult] = await Promise.all([
    backendData
      .from('booking_services')
      .select('id, duration_minutes, buffer_before_minutes, buffer_after_minutes')
      .eq('organization_id', organizationId)
      .eq('id', serviceId)
      .eq('is_active', true)
      .maybeSingle(),
    backendData
      .from('facility_services')
      .select('service_id')
      .eq('organization_id', organizationId)
      .eq('facility_id', facilityId)
      .eq('service_id', serviceId)
      .eq('is_active', true)
      .maybeSingle(),
    backendData
      .from('facility_service_experts')
      .select('user_id')
      .eq('organization_id', organizationId)
      .eq('facility_id', facilityId)
      .eq('service_id', serviceId)
      .eq('user_id', expertUserId)
      .eq('is_active', true)
      .maybeSingle(),
    backendData
      .from('facility_memberships')
      .select('user_id')
      .eq('organization_id', organizationId)
      .eq('facility_id', facilityId)
      .eq('user_id', expertUserId)
      .eq('is_bookable', true)
      .maybeSingle(),
  ])
  throwDbError(serviceResult.error)
  throwDbError(facilityServiceResult.error)
  throwDbError(expertResult.error)
  throwDbError(membershipResult.error)

  if (
    facility.is_active === false
    || !serviceResult.data
    || !facilityServiceResult.data
    || !expertResult.data
    || !membershipResult.data
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'The selected expert is not bookable for this service',
    })
  }

  const durationMinutes = Number(serviceResult.data.duration_minutes)
  const bufferBeforeMinutes = Number(serviceResult.data.buffer_before_minutes ?? 0)
  const bufferAfterMinutes = Number(serviceResult.data.buffer_after_minutes ?? 0)
  if (
    !Number.isInteger(durationMinutes)
    || durationMinutes < 1
    || !Number.isInteger(bufferBeforeMinutes)
    || bufferBeforeMinutes < 0
    || !Number.isInteger(bufferAfterMinutes)
    || bufferAfterMinutes < 0
  ) {
    throw createError({ statusCode: 409, statusMessage: 'Booking service configuration is invalid' })
  }

  return {
    timezone: String(facility.timezone || 'Europe/Warsaw'),
    durationMinutes,
    bufferBeforeMinutes,
    bufferAfterMinutes,
  }
}

async function resolveLinkedCase(
  backendData: any,
  organizationId: string,
  caseId: string,
): Promise<{ caseId: string, clientId: string }> {
  const [caseResult, linksResult] = await Promise.all([
    backendData
      .from('crm_cases')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('id', caseId)
      .maybeSingle(),
    backendData
      .from('crm_case_clients')
      .select('client_id, is_primary, created_at')
      .eq('organization_id', organizationId)
      .eq('case_id', caseId)
      .order('is_primary', { ascending: false })
      .order('created_at')
      .limit(1),
  ])
  throwDbError(caseResult.error)
  throwDbError(linksResult.error)
  const link = linksResult.data?.[0]
  if (!caseResult.data || !link) {
    throw createError({ statusCode: 404, statusMessage: 'Case not found' })
  }
  return { caseId, clientId: String(link.client_id) }
}

async function rollbackCase(
  backendData: any,
  organizationId: string,
  caseId: string | null,
): Promise<void> {
  if (!caseId) return
  const result = await backendData
    .from('crm_cases')
    .delete()
    .eq('organization_id', organizationId)
    .eq('id', caseId)
  if (result.error) {
    console.warn('[crm-meetings] failed to roll back case', result.error.message)
  }
}

async function rollbackAppointment(
  backendData: any,
  organizationId: string,
  appointmentId: string,
  updatedAt: string,
): Promise<void> {
  const result = await backendData
    .from('appointments')
    .delete()
    .eq('organization_id', organizationId)
    .eq('id', appointmentId)
    .eq('updated_at', updatedAt)
  if (result.error) {
    console.warn('[crm-meetings] failed to roll back appointment', result.error.message)
  }
}

async function createInstantAppointment(
  event: Parameters<typeof getRequestURL>[0],
  backendData: any,
  input: {
    organizationId: string
    facilityId: string
    serviceId: string
    expertUserId: string
    client: ClientContext
    scheduling: SchedulingContext
    idempotencyKey: string
    notes: string | null
    createdByUserId: string
    bookingContext: Record<string, unknown>
  },
): Promise<Record<string, any>> {
  const appointmentId = randomUUID()
  const startsAt = new Date()
  const endsAt = new Date(startsAt.valueOf() + input.scheduling.durationMinutes * 60_000)
  const busyStartsAt = new Date(
    startsAt.valueOf() - input.scheduling.bufferBeforeMinutes * 60_000,
  )
  const busyEndsAt = new Date(
    endsAt.valueOf() + input.scheduling.bufferAfterMinutes * 60_000,
  )
  const busyPeriod = `[${busyStartsAt.toISOString()},${busyEndsAt.toISOString()})`

  const conflictResult = await backendData
    .from('appointment_resource_reservations')
    .select('id')
    .eq('resource_type', 'expert')
    .eq('resource_id', input.expertUserId)
    .in('status', ['hold', 'confirmed'])
    .overlaps('busy_period', busyPeriod)
    .limit(1)
  throwDbError(conflictResult.error)
  if (conflictResult.data?.length) {
    throw createError({ statusCode: 409, statusMessage: 'This expert already has a booking now' })
  }

  const insertResult = await backendData
    .from('appointments')
    .insert({
      id: appointmentId,
      organization_id: input.organizationId,
      facility_id: input.facilityId,
      service_id: input.serviceId,
      expert_user_id: input.expertUserId,
      client_id: input.client.clientId,
      client_person_id: input.client.clientPersonId,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      timezone: input.scheduling.timezone,
      status: 'confirmed',
      confirmed_at: startsAt.toISOString(),
      customer_name: input.client.customerName,
      customer_email: input.client.customerEmail,
      customer_phone: input.client.customerPhone,
      notes: input.notes,
      source: 'staff',
      idempotency_key: input.idempotencyKey,
      created_by_user_id: input.createdByUserId,
      meeting_mode: 'online',
      meeting_url: meetingUrl(event, appointmentId),
      booking_context: input.bookingContext,
    })
    .select(crmMeetingAppointmentSelect)
    .single()
  if (insertResult.error?.code === '23505') {
    throw createError({
      statusCode: 409,
      statusMessage: 'This meeting request key was already used',
      data: { databaseCode: '23505' },
    })
  }
  if (insertResult.error) throwBookingError(insertResult.error)
  return insertResult.data
}

async function attachScheduledMeetingContext(
  event: Parameters<typeof getRequestURL>[0],
  backendData: any,
  input: {
    organizationId: string
    appointmentId: string
    bookingContext: Record<string, unknown>
    idempotencyInput: Parameters<typeof idempotentMeetingMatches>[1]
  },
): Promise<{ row: Record<string, any>, wonUpdate: boolean }> {
  const currentResult = await backendData
    .from('appointments')
    .select(crmMeetingAppointmentSelect)
    .eq('organization_id', input.organizationId)
    .eq('id', input.appointmentId)
    .maybeSingle()
  throwDbError(currentResult.error)
  const current = currentResult.data
  if (!current) {
    throw createError({ statusCode: 409, statusMessage: 'Appointment was not created' })
  }
  if (parseCrmMeetingContext(current.booking_context)) {
    return { row: current, wonUpdate: false }
  }

  const updateResult = await backendData
    .from('appointments')
    .update({
      booking_context: input.bookingContext,
      meeting_url: meetingUrl(event, input.appointmentId),
    })
    .eq('organization_id', input.organizationId)
    .eq('id', input.appointmentId)
    .eq('updated_at', current.updated_at)
    .select(crmMeetingAppointmentSelect)
    .maybeSingle()
  if (updateResult.error) {
    await rollbackAppointment(
      backendData,
      input.organizationId,
      input.appointmentId,
      String(current.updated_at),
    )
    throwDbError(updateResult.error)
  }
  if (updateResult.data) return { row: updateResult.data, wonUpdate: true }

  const concurrentResult = await backendData
    .from('appointments')
    .select(crmMeetingAppointmentSelect)
    .eq('organization_id', input.organizationId)
    .eq('id', input.appointmentId)
    .maybeSingle()
  throwDbError(concurrentResult.error)
  if (
    !concurrentResult.data
    || !idempotentMeetingMatches(concurrentResult.data, input.idempotencyInput)
  ) {
    throw createError({
      statusCode: 409,
      statusMessage: 'The meeting changed while it was being scheduled',
    })
  }
  return { row: concurrentResult.data, wonUpdate: false }
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const body = asRecord(await readBody(event))
  const timing = enumValue(body.timing, 'timing', ['now', 'scheduled'] as const)
  const caseRequest = parseCaseRequest(body.case)
  const facilityId = uuidValue(body.facilityId ?? body.facility_id, 'facilityId')
  const serviceId = uuidValue(body.serviceId ?? body.service_id, 'serviceId')
  const expertUserId = uuidValue(body.expertUserId ?? body.expert_user_id, 'expertUserId')
  const startsAt = timing === 'scheduled'
    ? isoDateTimeValue(body.startsAt ?? body.starts_at, 'startsAt')
    : null
  const notes = limitedText(body.notes, 'notes', 2_000, { nullable: true }) ?? null
  const idempotencyKey = idempotencyKeyValue(
    body.idempotencyKey ?? body.idempotency_key,
  )

  const facilityAccess = await requireFacilityPermission(session, facilityId, 'view')
  await assertFacilityBookableMemberIds(session, facilityId, [expertUserId])
  const backendData = serverDataBackend(event) as any
  const scheduling = await loadSchedulingContext(
    backendData,
    session.organizationId,
    facilityId,
    serviceId,
    expertUserId,
    facilityAccess.facility,
  )
  const idempotencyInput = {
    timing,
    startsAt,
    facilityId,
    serviceId,
    expertUserId,
    caseRequest,
  }

  const existing = await findIdempotentAppointment(
    backendData,
    session.organizationId,
    session.userId,
    idempotencyKey,
  )
  if (existing) {
    if (!idempotentMeetingMatches(existing, idempotencyInput)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'This meeting request key was already used',
      })
    }
    setHeader(event, 'Cache-Control', 'no-store')
    return {
      data: await normalizeCrmMeetingRecord(
        backendData,
        session.organizationId,
        existing,
      ),
    }
  }

  let createdCaseId: string | null = null
  let caseId: string
  let relationship: 'first' | 'follow-up'
  let client: ClientContext

  if (caseRequest.mode === 'link') {
    const linkedCase = await resolveLinkedCase(
      backendData,
      session.organizationId,
      caseRequest.caseId,
    )
    caseId = linkedCase.caseId
    relationship = 'follow-up'
    client = await loadClientContext(
      backendData,
      session.organizationId,
      linkedCase.clientId,
    )
  } else {
    client = await loadClientContext(
      backendData,
      session.organizationId,
      caseRequest.clientId,
    )
    const caseTitle = caseRequest.title || `Sprawa — ${client.customerName}`
    const caseResult = await session.dataApi.rpc('create_crm_case_simple', {
      p_organization_id: session.organizationId,
      p_title: caseTitle,
      p_client_ids: [client.clientId],
      p_owner_user_id: session.userId,
    })
    throwDbError(caseResult.error, caseResult.error?.code === '22023' ? 400 : 500)
    const caseRow = asRecord(caseResult.data)
    caseId = uuidValue(caseRow.id, 'created case id')
    createdCaseId = caseId
    relationship = 'first'
  }

  const meetingContext = createCrmMeetingContext(caseId, relationship)
  const bookingContext = bookingContextWithCrmMeeting({}, meetingContext)
  let appointment: Record<string, any>

  try {
    if (timing === 'now') {
      try {
        appointment = await createInstantAppointment(event, backendData, {
          organizationId: session.organizationId,
          facilityId,
          serviceId,
          expertUserId,
          client,
          scheduling,
          idempotencyKey,
          notes,
          createdByUserId: session.userId,
          bookingContext,
        })
      } catch (error: any) {
        if (String(error?.data?.databaseCode ?? '') === '23505') {
          const concurrent = await findIdempotentAppointment(
            backendData,
            session.organizationId,
            session.userId,
            idempotencyKey,
          )
          if (concurrent && idempotentMeetingMatches(concurrent, idempotencyInput)) {
            await rollbackCase(backendData, session.organizationId, createdCaseId)
            createdCaseId = null
            appointment = concurrent
          } else {
            throw error
          }
        } else {
          throw error
        }
      }
    } else {
      const bookingResult = await backendData.rpc('create_staff_appointment', {
        p_organization_id: session.organizationId,
        p_facility_id: facilityId,
        p_service_id: serviceId,
        p_expert_user_id: expertUserId,
        p_client_id: client.clientId,
        p_client_person_id: client.clientPersonId,
        p_starts_at: startsAt,
        p_meeting_mode: 'online',
        p_meeting_url: null,
        p_notes: notes,
        p_created_by_user_id: session.userId,
        p_idempotency_key: idempotencyKey,
      })
      if (bookingResult.error) throwBookingError(bookingResult.error)
      const appointmentPayload = asRecord(asRecord(bookingResult.data).appointment)
      const appointmentId = uuidValue(appointmentPayload.id, 'appointment id')
      const attached = await attachScheduledMeetingContext(event, backendData, {
        organizationId: session.organizationId,
        appointmentId,
        bookingContext,
        idempotencyInput,
      })
      if (!idempotentMeetingMatches(attached.row, idempotencyInput)) {
        await rollbackCase(backendData, session.organizationId, createdCaseId)
        createdCaseId = null
        throw createError({
          statusCode: 409,
          statusMessage: 'This meeting request key was already used',
        })
      }
      if (!attached.wonUpdate && createdCaseId) {
        const attachedContext = parseCrmMeetingContext(attached.row.booking_context)
        if (attachedContext?.caseId !== createdCaseId) {
          await rollbackCase(backendData, session.organizationId, createdCaseId)
          createdCaseId = null
        }
      }
      appointment = attached.row
    }
  } catch (error) {
    await rollbackCase(backendData, session.organizationId, createdCaseId)
    throw error
  }

  const meeting = await normalizeCrmMeetingRecord(
    backendData,
    session.organizationId,
    appointment,
  )
  await recordCrmActivity(session, {
    client_id: meeting.clientId,
    case_id: meeting.caseId,
    activity_type: 'meeting_scheduled',
    title: timing === 'now' ? 'Utworzono spotkanie na teraz' : 'Zaplanowano spotkanie',
    body: meeting.serviceName || undefined,
    payload: {
      appointment_id: meeting.id,
      relationship: meeting.relationship,
      starts_at: meeting.startsAt,
    },
  })

  setHeader(event, 'Cache-Control', 'no-store')
  setResponseStatus(event, 201)
  return { data: meeting }
})
