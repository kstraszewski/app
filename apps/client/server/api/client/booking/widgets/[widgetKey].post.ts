import { createHash } from 'node:crypto'
import { createError, readBody, setHeader } from 'h3'
import { bookingCalculationContextValue } from '~~/server/utils/booking-calculators'
import {
  bookingConsentDecisionsValue,
  bookingRecord,
  catalogAllowedOrigins,
  idempotencyKeyValue,
  isoDateTimeValue,
  limitedText,
  optionalUuidValue,
  publicWidgetKey,
  sanitizePublicCatalog,
  uuidValue,
} from '~~/server/utils/booking-public'
import { serverDataBackend } from '~~/server/utils/data-api'
import {
  requireAvailablePortalIdentity,
  throwPortalAccountArchived,
} from '~~/server/utils/portal-auth'
import {
  assertPublicBookingRateLimit,
  assertWidgetRequestOrigin,
  recordBookingWidgetEvent,
  throwBookingError,
} from '~~/server/utils/scheduling'

function bookingConfirmation(
  raw: unknown,
  fallback: { facilityName?: string, serviceName?: string, expertName?: string } = {},
) {
  const result = bookingRecord(raw)
  const appointment = bookingRecord(result.appointment ?? result)
  const expert = bookingRecord(appointment.expert)
  if (!appointment.id || !appointment.status || !(appointment.startsAt ?? appointment.starts_at)) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Booking service returned an invalid appointment',
    })
  }
  return {
    appointment: {
      id: String(appointment.id),
      status: String(appointment.status),
      startsAt: String(appointment.startsAt ?? appointment.starts_at),
      endsAt: String(appointment.endsAt ?? appointment.ends_at ?? ''),
      facilityName: String(
        appointment.facilityName ?? appointment.facility_name ?? fallback.facilityName ?? '',
      ),
      serviceName: String(
        appointment.serviceName ?? appointment.service_name ?? fallback.serviceName ?? '',
      ),
      expertName: String(expert.name ?? fallback.expertName ?? ''),
    },
    portalAccount: {
      linked: bookingRecord(result.portalAccount).linked === true,
    },
  }
}

function throwVerifiedPortalBookingError(
  error: { code?: string, message?: string } | null | undefined,
): void {
  if (!error) return
  const message = String(error.message ?? '')
  if (/verified_portal_identity_required/i.test(message)) {
    throw createError({ statusCode: 403, statusMessage: 'Verified client account required' })
  }
  if (/client_portal_account_is_archived/i.test(message)) {
    throwPortalAccountArchived()
  }
  if (/verified_portal_profile_selection_required/i.test(message)) {
    throw createError({ statusCode: 409, statusMessage: 'Client profile selection required' })
  }
  if (/verified_portal_profile_not_found/i.test(message)) {
    throw createError({ statusCode: 404, statusMessage: 'Client profile not found' })
  }
  if (/verified_portal_profile_(?:phone_required|phone_mismatch|contact_mismatch)/i.test(message)) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Verified portal profile contact mismatch',
    })
  }
  if (/verified_portal_(?:profile_resolution|booking_profile)_mismatch/i.test(message)) {
    throw createError({ statusCode: 409, statusMessage: 'Client profile resolution conflict' })
  }
  if (/client_person_already_linked/i.test(message)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'This client profile is already linked to another account',
    })
  }
  if (/verified_portal_booking_result_invalid/i.test(message)) {
    console.error('[client-booking] database returned an invalid verified result', {
      code: error.code,
    })
    throw createError({ statusCode: 500, statusMessage: 'Booking service is temporarily unavailable' })
  }
  throwBookingError(error)
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const identity = await requireAvailablePortalIdentity(event)
  const widgetKey = publicWidgetKey(getRouterParam(event, 'widgetKey'))
  const body = bookingRecord(await readBody(event))
  const serviceId = uuidValue(body.serviceId ?? body.service_id, 'serviceId')
  const visitId = optionalUuidValue(body.visitId ?? body.visit_id, 'visitId')
  const clientPersonId = optionalUuidValue(
    body.clientPersonId ?? body.client_person_id,
    'clientPersonId',
  )
  const idempotencyKey = idempotencyKeyValue(
    body.idempotencyKey ?? body.idempotency_key,
  )
  const analyticsEventId = createHash('sha256')
    .update(`verified-client-booking-analytics:${identity.userId}:${idempotencyKey}`, 'utf8')
    .digest('hex')
  const requestedExpertUserId = optionalUuidValue(
    body.expertUserId ?? body.expert_user_id ?? body.expertId,
    'expertUserId',
  )
  const startsAt = isoDateTimeValue(body.startsAt ?? body.starts_at, 'startsAt')
  const customerName = limitedText(
    body.customerName ?? body.customer_name,
    'customerName',
    200,
    { required: true },
  ) as string
  const customerPhone = limitedText(
    body.customerPhone ?? body.customer_phone,
    'customerPhone',
    50,
    { required: true },
  ) as string
  const normalizedPhone = customerPhone.replace(/[^0-9]+/g, '')
  if (
    !/^[0-9+().\s-]+$/.test(customerPhone)
    || normalizedPhone.length < 7
    || normalizedPhone.length > 15
  ) {
    throw createError({ statusCode: 422, statusMessage: 'A valid phone number is required' })
  }
  const notes = limitedText(body.notes, 'notes', 2_000, { nullable: true }) ?? null
  const consentDecisions = bookingConsentDecisionsValue(
    body.consentDecisions ?? body.consent_decisions ?? [],
  )
  const rawBookingContext = body.bookingContext ?? body.booking_context ?? null
  const dataApi = serverDataBackend(event) as any

  const catalogResult = await dataApi.rpc('get_booking_widget_catalog', {
    p_widget_token: widgetKey,
  })
  throwBookingError(catalogResult.error)
  if (!catalogResult.data) {
    throw createError({ statusCode: 404, statusMessage: 'Booking widget not found' })
  }
  assertWidgetRequestOrigin(event, catalogAllowedOrigins(catalogResult.data), widgetKey, {
    requireSource: true,
  })
  await assertPublicBookingRateLimit(event, 'booking', widgetKey, 5, 10 * 60_000)

  const catalog = sanitizePublicCatalog(catalogResult.data, widgetKey)
  const service = catalog.services.find(item => item.id === serviceId)
  if (!service) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Service is not available in this widget',
    })
  }
  if (
    catalog.widget.fixedExpertUserId
    && requestedExpertUserId
    && requestedExpertUserId !== catalog.widget.fixedExpertUserId
  ) {
    throw createError({ statusCode: 400, statusMessage: 'Expert is fixed for this widget' })
  }
  if (
    !catalog.widget.fixedExpertUserId
    && catalog.widget.bookingMode === 'expert'
    && !requestedExpertUserId
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'An expert must be selected for this widget',
    })
  }
  const expertUserId = catalog.widget.fixedExpertUserId
    ?? (catalog.widget.bookingMode === 'facility' ? null : requestedExpertUserId)
  if (expertUserId) {
    const expert = catalog.experts.find(item => item.userId === expertUserId)
    if (!expert || (expert.serviceIds && !expert.serviceIds.includes(serviceId))) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Expert is not available for this service',
      })
    }
  }

  const decisionsByDefinition = new Map(
    consentDecisions.map(decision => [decision.definition_id, decision]),
  )
  if (
    consentDecisions.length !== catalog.consents.length
    || catalog.consents.some((consent) => {
      const decision = decisionsByDefinition.get(consent.definitionId)
      return !decision || decision.version_id !== consent.versionId
    })
  ) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Consent definitions changed. Refresh the widget and try again.',
    })
  }
  for (const consent of catalog.consents) {
    const decision = decisionsByDefinition.get(consent.definitionId)
    if (consent.isRequired && !decision?.granted) {
      throw createError({ statusCode: 422, statusMessage: 'Required consents must be granted' })
    }
    if (
      decision?.granted
      && ['sms', 'phone', 'messaging'].includes(consent.channel)
      && !customerPhone
    ) {
      throw createError({
        statusCode: 422,
        statusMessage: 'A phone number is required for the selected consent',
      })
    }
  }

  let bookingContext: Record<string, unknown>
  try {
    bookingContext = bookingCalculationContextValue(
      rawBookingContext,
      catalog.widget.widgetType,
      catalog.capacityPolicy,
      catalog.capacityPolicyRevision,
    )
  } catch (calculationError) {
    const detail = calculationError instanceof Error ? calculationError.message : ''
    if (/policy_revision_changed/i.test(detail)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Calculator settings changed. Recalculate before booking.',
      })
    }
    throw createError({
      statusCode: 422,
      statusMessage: 'The calculator data is invalid. Recalculate and try again.',
    })
  }

  if (visitId) {
    await recordBookingWidgetEvent(event, {
      widgetKey,
      visitId,
      eventType: 'booking_attempt',
      serviceId,
      eventId: analyticsEventId,
      isEmbedded: false,
    })
  }

  const result = await dataApi.rpc('create_verified_portal_booking', {
    p_widget_token: widgetKey,
    p_auth_user_id: identity.userId,
    p_service_id: serviceId,
    p_starts_at: startsAt,
    p_customer_name: customerName,
    p_customer_phone: customerPhone,
    p_idempotency_key: idempotencyKey,
    p_expert_user_id: expertUserId,
    p_notes: notes,
    p_consent_decisions: consentDecisions,
    p_booking_context: bookingContext,
    p_client_person_id: clientPersonId,
  })
  throwVerifiedPortalBookingError(result.error)

  if (visitId) {
    await recordBookingWidgetEvent(event, {
      widgetKey,
      visitId,
      eventType: 'booking_completed',
      serviceId,
      eventId: analyticsEventId,
      isEmbedded: false,
    })
  }

  const rawAppointment = bookingRecord(
    bookingRecord(result.data).appointment ?? result.data,
  )
  const bookedExpert = bookingRecord(rawAppointment.expert)
  const bookedExpertId = String(
    bookedExpert.userId
      ?? bookedExpert.user_id
      ?? rawAppointment.expertUserId
      ?? rawAppointment.expert_user_id
      ?? '',
  )
  const knownExpert = catalog.experts.find(item => item.userId === bookedExpertId)
  return bookingConfirmation(result.data, {
    facilityName: catalog.facility.name,
    serviceName: service.name,
    expertName: knownExpert?.name,
  })
})
