import { useRuntimeConfig } from '#imports'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { getOpenExpertTrustedClientIp } from '@openexpert/auth/server'
import {
  createError,
  getHeader,
  getRequestURL,
  setHeader,
  type H3Event,
} from 'h3'
import { serverDataBackend } from './data-api'

export async function getPublicSchedulingClient(event: H3Event): Promise<any> {
  return serverDataBackend(event) as any
}

export function throwBookingError(error: { code?: string, message?: string } | null | undefined): void {
  if (!error) return
  const message = String(error.message ?? '')
  if (/idempotency_key_reused/i.test(message)) {
    throw createError({ statusCode: 409, statusMessage: 'This booking request key was already used' })
  }
  if (/customer_contact_matches_multiple_clients/i.test(message)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'The contact details match more than one client. Contact the facility to book.',
    })
  }
  if (/consent_(?:catalogue|definition)_is_stale/i.test(message)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Consent definitions changed. Refresh the widget and try again.',
    })
  }
  if (/required_consent_not_granted|consent_contact_value_is_required/i.test(message)) {
    throw createError({
      statusCode: 422,
      statusMessage: 'The consent decisions do not match the provided contact data',
    })
  }
  if (/customer_phone_is_required/i.test(message)) {
    throw createError({ statusCode: 422, statusMessage: 'A phone number is required for this booking' })
  }
  if (/invalid_booking_(?:calculation|context)|customer_(?:phone|email)_is_required/i.test(message)) {
    throw createError({ statusCode: 422, statusMessage: 'The booking contact or calculation data is invalid' })
  }
  if (
    error.code === '23P01'
    || error.code === '23505'
    || /booking_conflict|slot_(?:unavailable|already_booked)|appointment_conflict|no_available_expert|facility_closed/i.test(message)
  ) {
    throw createError({ statusCode: 409, statusMessage: 'This slot is no longer available' })
  }
  if (error.code === '22P02' || /widget_not_found|widget_inactive/i.test(message)) {
    throw createError({ statusCode: 404, statusMessage: 'Booking widget not found' })
  }
  if (
    /service_not_available|expert_not_available|outside_booking_window|booking_widget_(?:requires_expert|does_not_allow_expert_selection|is_fixed_to_another_expert)|invalid_booking_(?:request|replay_request)/i.test(message)
  ) {
    throw createError({ statusCode: 400, statusMessage: 'The selected booking option is not available' })
  }
  if (/invalid_staff_booking_request|expert_not_bookable_for_service/i.test(message)) {
    throw createError({ statusCode: 400, statusMessage: 'The staff booking request is invalid' })
  }
  if (/facility_membership_required/i.test(message)) {
    throw createError({ statusCode: 403, statusMessage: 'Facility access is required' })
  }
  if (/booking_widget_origin_not_allowed/i.test(message)) {
    throw createError({ statusCode: 403, statusMessage: 'Widget origin is not allowed' })
  }
  if (/crm_client_person_not_found/i.test(message)) {
    throw createError({ statusCode: 404, statusMessage: 'Client person not found' })
  }
  if (/crm_client_not_found/i.test(message)) {
    throw createError({ statusCode: 404, statusMessage: 'Client not found' })
  }
  if (/facility_(?:service_)?not_found/i.test(message)) {
    throw createError({ statusCode: 404, statusMessage: 'Facility booking configuration not found' })
  }
  console.error('[booking] database operation failed', {
    code: error.code,
    message: error.message,
  })
  throw createError({ statusCode: 500, statusMessage: 'Booking service is temporarily unavailable' })
}

export async function assertPublicBookingRateLimit(
  event: H3Event,
  scope: 'catalog' | 'slots' | 'booking' | 'analytics',
  widgetKey: string,
  limit: number,
  windowMs: number,
): Promise<void> {
  const config = useRuntimeConfig(event)
  const rateLimitConfig = config.bookingSecurity as {
    trustProxy?: boolean | string
    trustedIpHeaders?: string
    rateLimitSecret?: string
  }
  const trustProxy = rateLimitConfig?.trustProxy === true || rateLimitConfig?.trustProxy === 'true'
  const clientAddress = getOpenExpertTrustedClientIp({
    headers: event.headers,
    directAddress: event.node.req.socket.remoteAddress,
    trustedHeaderNames: trustProxy
      ? String(rateLimitConfig?.trustedIpHeaders || '')
          .split(',')
          .map(header => header.trim().toLowerCase())
          .filter(Boolean)
      : [],
  })
  const rateLimitSecret = rateLimitConfig?.rateLimitSecret || 'openexpert-booking-rate-limit'
  const clientKey = createHmac('sha256', rateLimitSecret)
    .update(clientAddress, 'utf8')
    .digest('base64url')
  const dataApi = await getPublicSchedulingClient(event)
  const { data, error } = await dataApi.rpc('consume_booking_rate_limit', {
    p_widget_token: widgetKey,
    p_scope: scope,
    p_client_key: clientKey,
    p_limit: limit,
    p_window_seconds: Math.max(1, Math.ceil(windowMs / 1_000)),
  })
  throwBookingError(error)
  const retryAfter = Number(data ?? 0)
  if (retryAfter > 0) {
    setHeader(event, 'Retry-After', retryAfter)
    throw createError({ statusCode: 429, statusMessage: 'Too many booking requests. Try again later.' })
  }
}

function bookingPreviewSecret(event: H3Event): string {
  const config = useRuntimeConfig(event)
  const bookingSecurity = config.bookingSecurity as { rateLimitSecret?: string }
  const secret = bookingSecurity?.rateLimitSecret
  if (!secret) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Booking preview is temporarily unavailable',
    })
  }
  return secret
}

export function verifyBookingWidgetPreviewToken(
  event: H3Event,
  widgetKey: string,
  input: unknown,
): boolean {
  if (typeof input !== 'string') return false
  const [expiresAtRaw, signature, ...rest] = input.split('.')
  if (rest.length || !expiresAtRaw || !signature || !/^\d{10}$/.test(expiresAtRaw)) return false
  const expiresAt = Number(expiresAtRaw)
  const now = Math.floor(Date.now() / 1_000)
  if (!Number.isSafeInteger(expiresAt) || expiresAt < now || expiresAt > now + 16 * 60) return false
  const expected = createHmac('sha256', bookingPreviewSecret(event))
    .update(`booking-preview:${widgetKey}:${expiresAt}`, 'utf8')
    .digest('base64url')
  const receivedBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  return receivedBuffer.length === expectedBuffer.length
    && timingSafeEqual(receivedBuffer, expectedBuffer)
}

function normalizeOrigin(value: string): string {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error()
    return url.origin
  }
  catch {
    throw createError({ statusCode: 403, statusMessage: 'Widget origin is not allowed' })
  }
}

export function assertWidgetRequestOrigin(
  event: H3Event,
  allowedOrigins: string[],
  widgetKey: string,
  options: { requireSource?: boolean } = {},
): void {
  const originHeader = getHeader(event, 'origin')
  const refererHeader = getHeader(event, 'referer')
  const requestUrl = getRequestURL(event)

  let sourceOrigin: string | null = null
  let refererUrl: URL | null = null
  try {
    if (originHeader && originHeader !== 'null') sourceOrigin = normalizeOrigin(originHeader)
    if (refererHeader) {
      refererUrl = new URL(refererHeader)
      sourceOrigin ??= refererUrl.origin
    }
  }
  catch {
    throw createError({ statusCode: 403, statusMessage: 'Widget origin is not allowed' })
  }

  if (!sourceOrigin) {
    if (options.requireSource) {
      throw createError({ statusCode: 403, statusMessage: 'Widget request source is required' })
    }
    return
  }

  if (sourceOrigin === requestUrl.origin) {
    if (!refererUrl || refererUrl.pathname.startsWith(`/book/${encodeURIComponent(widgetKey)}`)) return
    return
  }

  if (!allowedOrigins.includes(sourceOrigin)) {
    throw createError({ statusCode: 403, statusMessage: 'Widget origin is not allowed' })
  }
  setHeader(event, 'Access-Control-Allow-Origin', sourceOrigin)
  setHeader(event, 'Vary', 'Origin')
}

export type BookingWidgetAnalyticsEvent
  = 'widget_view'
    | 'widget_engaged'
    | 'calculator_started'
    | 'calculator_completed'
    | 'service_selected'
    | 'availability_search'
    | 'availability_found'
    | 'slot_selected'
    | 'contact_started'
    | 'booking_attempt'
    | 'booking_completed'

export async function recordBookingWidgetEvent(
  event: H3Event,
  input: {
    widgetKey: string
    visitId: string
    eventType: BookingWidgetAnalyticsEvent
    serviceId?: string | null
    eventId?: string | null
    isEmbedded?: boolean
  },
): Promise<void> {
  try {
    const dataApi = await getPublicSchedulingClient(event)
    const { error } = await dataApi.rpc('record_booking_widget_event', {
      p_widget_token: input.widgetKey,
      p_visit_id: input.visitId,
      p_event_type: input.eventType,
      p_service_id: input.serviceId ?? null,
      p_event_id: input.eventId ?? null,
      p_is_embedded: input.isEmbedded === true,
    })
    if (error) {
      console.error('[booking] widget analytics event was not recorded', {
        eventType: input.eventType,
        code: error.code,
      })
    }
  }
  catch (error) {
    console.error('[booking] widget analytics event failed', {
      eventType: input.eventType,
      message: error instanceof Error ? error.message : 'unknown error',
    })
  }
}
