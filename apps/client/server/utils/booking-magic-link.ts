const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u

export const BOOKING_MAGIC_LINK_RESPONSE_FLOOR_MS = 600

export interface BookingMagicLinkIntent {
  email: string
  widgetKey: string
  expertId: string | null
  serviceId: string | null
  date: string | null
}

interface BookingWidgetCatalog {
  widget?: {
    key?: unknown
  }
  experts?: unknown
  services?: unknown
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function normalizeBookingMagicLinkEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  if (!email || email.length > 320 || !EMAIL_PATTERN.test(email)) return null
  return email
}

export function normalizeBookingMagicLinkUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const uuid = value.trim().toLowerCase()
  return UUID_PATTERN.test(uuid) ? uuid : null
}

export function normalizeBookingMagicLinkDate(value: unknown): string | null {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
    ? value
    : null
}

/**
 * Parses only the values the booking auth flow accepts. A browser-provided
 * callback URL is deliberately not part of the result, so callers cannot turn
 * the magic-link endpoint into an open redirect.
 */
export function parseBookingMagicLinkIntent(
  value: unknown,
): BookingMagicLinkIntent | null {
  const input = record(value)
  if (!input) return null

  const email = normalizeBookingMagicLinkEmail(input.email)
  const widgetKey = normalizeBookingMagicLinkUuid(input.widgetKey)
  if (!email || !widgetKey) return null

  return {
    email,
    widgetKey,
    expertId: normalizeBookingMagicLinkUuid(input.expertId),
    serviceId: normalizeBookingMagicLinkUuid(input.serviceId),
    date: normalizeBookingMagicLinkDate(input.date),
  }
}

function catalogIds(value: unknown, field: 'id' | 'userId'): Set<string> {
  if (!Array.isArray(value)) return new Set()
  return new Set(value.flatMap((candidate) => {
    const item = record(candidate)
    const id = normalizeBookingMagicLinkUuid(item?.[field])
    return id ? [id] : []
  }))
}

/**
 * Builds a same-origin callback for an active catalog returned by the booking
 * RPC. Only selections that actually occur in that catalog survive.
 */
export function buildBookingMagicLinkCallbackPath(
  intent: BookingMagicLinkIntent,
  catalogValue: unknown,
): string | null {
  const catalog = record(catalogValue) as BookingWidgetCatalog | null
  const widget = record(catalog?.widget)
  if (normalizeBookingMagicLinkUuid(widget?.key) !== intent.widgetKey) return null

  const query = new URLSearchParams()
  const expertIds = catalogIds(catalog?.experts, 'userId')
  const serviceIds = catalogIds(catalog?.services, 'id')
  if (intent.expertId && expertIds.has(intent.expertId)) {
    query.set('expertId', intent.expertId)
  }
  if (intent.serviceId && serviceIds.has(intent.serviceId)) {
    query.set('serviceId', intent.serviceId)
  }
  if (intent.date) query.set('date', intent.date)

  const path = `/book/${encodeURIComponent(intent.widgetKey)}`
  const search = query.toString()
  return search ? `${path}?${search}` : path
}

export function bookingMagicLinkResponseDelay(
  startedAt: number,
  now = Date.now(),
): number {
  if (!Number.isFinite(startedAt) || !Number.isFinite(now)) {
    return BOOKING_MAGIC_LINK_RESPONSE_FLOOR_MS
  }
  const elapsed = Math.max(0, now - startedAt)
  return Math.max(0, BOOKING_MAGIC_LINK_RESPONSE_FLOOR_MS - elapsed)
}
