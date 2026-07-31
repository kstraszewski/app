import { readBody, setHeader } from 'h3'
import { createHash } from 'node:crypto'
import { asRecord } from '~~/server/utils/crm'
import { bookingCalculationContextValue } from '~~/server/utils/booking-calculators'
import {
  assertPublicBookingRateLimit,
  assertWidgetRequestOrigin,
  bookingConsentDecisionsValue,
  catalogAllowedOrigins,
  emailValue,
  getPublicSchedulingClient,
  idempotencyKeyValue,
  isoDateTimeValue,
  limitedText,
  optionalUuidValue,
  publicWidgetKey,
  recordBookingWidgetEvent,
  sanitizePublicCatalog,
  throwBookingError,
  uuidValue,
  verifyBookingWidgetPreviewToken,
} from '~~/server/utils/scheduling'

function canonicalJson(value: unknown, depth = 0): string {
  if (depth > 50) {
    throw createError({ statusCode: 400, statusMessage: 'Booking payload is too deeply nested' })
  }
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw createError({ statusCode: 400, statusMessage: 'Booking payload contains an invalid number' })
    }
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => canonicalJson(item, depth + 1)).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(record[key], depth + 1)}`)
      .join(',')}}`
  }
  throw createError({ statusCode: 400, statusMessage: 'Booking payload is not valid JSON' })
}

function bookingRequestFingerprint(intent: Record<string, unknown>): string {
  const canonical = canonicalJson(intent)
  if (canonical.length > 32_000) {
    throw createError({ statusCode: 400, statusMessage: 'Booking payload is too large' })
  }
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

function bookingConfirmation(
  raw: unknown,
  fallback: { facilityName?: string; serviceName?: string; expertName?: string } = {},
) {
  const result = asRecord(raw)
  const appointment = asRecord(result.appointment ?? result)
  const expert = asRecord(appointment.expert)
  if (!appointment.id || !appointment.status || !(appointment.startsAt ?? appointment.starts_at)) {
    throw createError({ statusCode: 500, statusMessage: 'Booking service returned an invalid appointment' })
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
  }
}

export default defineEventHandler(async (event) => {
  const widgetKey = publicWidgetKey(getRouterParam(event, 'widgetKey'))
  const body = asRecord(await readBody(event))
  const serviceId = uuidValue(body.serviceId ?? body.service_id, 'serviceId')
  const visitId = optionalUuidValue(body.visitId ?? body.visit_id, 'visitId')
  const idempotencyKey = idempotencyKeyValue(body.idempotencyKey ?? body.idempotency_key)
  const analyticsEventId = createHash('sha256')
    .update(`booking-widget-analytics:${idempotencyKey}`, 'utf8')
    .digest('hex')
  const requestedExpertUserId = optionalUuidValue(
    body.expertUserId ?? body.expert_user_id ?? body.expertId,
    'expertUserId',
  )
  const startsAt = isoDateTimeValue(body.startsAt ?? body.starts_at, 'startsAt')
  const customerName = limitedText(body.customerName ?? body.customer_name, 'customerName', 200, { required: true }) as string
  const customerEmail = emailValue(body.customerEmail ?? body.customer_email, 'customerEmail', { required: true }) as string
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
  const requestFingerprint = bookingRequestFingerprint({
    fingerprintVersion: 1,
    widgetToken: widgetKey,
    serviceId,
    startsAt,
    customerName,
    customerEmail,
    customerPhone,
    requestedExpertUserId,
    notes,
    consentDecisions: [...consentDecisions].sort((left, right) => (
      left.definition_id.localeCompare(right.definition_id)
      || left.version_id.localeCompare(right.version_id)
    )),
    bookingContext: rawBookingContext,
  })
  const dataApi = await getPublicSchedulingClient(event)

  const catalogResult = await dataApi.rpc('get_booking_widget_catalog', { p_widget_token: widgetKey })
  throwBookingError(catalogResult.error)
  if (!catalogResult.data) throw createError({ statusCode: 404, statusMessage: 'Booking widget not found' })
  assertWidgetRequestOrigin(event, catalogAllowedOrigins(catalogResult.data), widgetKey)
  await assertPublicBookingRateLimit(event, 'booking', widgetKey, 5, 10 * 60_000)
  const isEmbedded = body.isEmbedded === true || body.is_embedded === true
  const isAuthorizedPreview = verifyBookingWidgetPreviewToken(
    event,
    widgetKey,
    body.previewToken ?? body.preview_token,
  )
  if (isAuthorizedPreview) {
    throw createError({ statusCode: 403, statusMessage: 'Booking is disabled in preview mode' })
  }
  const replayResult = await dataApi.rpc('replay_widget_booking', {
    p_widget_token: widgetKey,
    p_idempotency_key: idempotencyKey,
    p_request_fingerprint: requestFingerprint,
  })
  throwBookingError(replayResult.error)
  if (replayResult.data) {
    if (!isAuthorizedPreview && visitId) {
      await recordBookingWidgetEvent(event, {
        widgetKey,
        visitId,
        eventType: 'booking_completed',
        serviceId,
        eventId: analyticsEventId,
        isEmbedded,
      })
    }
    setHeader(event, 'Cache-Control', 'no-store')
    return bookingConfirmation(replayResult.data)
  }
  const catalog = sanitizePublicCatalog(catalogResult.data, widgetKey)
  const service = catalog.services.find(item => item.id === serviceId)
  if (!service) throw createError({ statusCode: 400, statusMessage: 'Service is not available in this widget' })
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
    throw createError({ statusCode: 400, statusMessage: 'An expert must be selected for this widget' })
  }
  const expertUserId = catalog.widget.fixedExpertUserId
    ?? (catalog.widget.bookingMode === 'facility' ? null : requestedExpertUserId)
  if (expertUserId) {
    const expert = catalog.experts.find(item => item.userId === expertUserId)
    if (!expert || (expert.serviceIds && !expert.serviceIds.includes(serviceId))) {
      throw createError({ statusCode: 400, statusMessage: 'Expert is not available for this service' })
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
    const requiresPhone = ['sms', 'phone', 'messaging'].includes(consent.channel)
    if (decision?.granted && requiresPhone && !customerPhone) {
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
  } catch (error) {
    const calculationError = error instanceof Error ? error.message : ''
    if (/policy_revision_changed/i.test(calculationError)) {
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

  if (!isAuthorizedPreview && visitId) {
    await recordBookingWidgetEvent(event, {
      widgetKey,
      visitId,
      eventType: 'booking_attempt',
      serviceId,
      eventId: analyticsEventId,
      isEmbedded,
    })
  }

  const { data, error } = await dataApi.rpc('create_widget_booking', {
    p_widget_token: widgetKey,
    p_service_id: serviceId,
    p_starts_at: startsAt,
    p_customer_name: customerName,
    p_customer_email: customerEmail,
    p_idempotency_key: idempotencyKey,
    p_customer_phone: customerPhone,
    p_expert_user_id: expertUserId,
    p_notes: notes,
    p_consent_decisions: consentDecisions,
    p_booking_context: bookingContext,
    p_request_fingerprint: requestFingerprint,
  })
  throwBookingError(error)
  if (!isAuthorizedPreview && visitId) {
    await recordBookingWidgetEvent(event, {
      widgetKey,
      visitId,
      eventType: 'booking_completed',
      serviceId,
      eventId: analyticsEventId,
      isEmbedded,
    })
  }
  const rawAppointment = asRecord(asRecord(data).appointment ?? data)
  const expert = asRecord(rawAppointment.expert)
  const bookedExpertId = String(expert.userId ?? expert.user_id ?? rawAppointment.expertUserId ?? rawAppointment.expert_user_id ?? '')
  const knownExpert = catalog.experts.find(item => item.userId === bookedExpertId)

  setHeader(event, 'Cache-Control', 'no-store')
  return bookingConfirmation(data, {
    facilityName: catalog.facility.name,
    serviceName: service.name,
    expertName: knownExpert?.name,
  })
})
