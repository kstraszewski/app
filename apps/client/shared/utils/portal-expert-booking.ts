export type PortalExpertBookingMode = 'facility' | 'expert' | 'both'

export interface PortalExpertBookingWidgetSource {
  organizationId: string
  widgetKey: string
}

export interface PortalExpertBookingCandidate {
  organizationId: string
  widgetKey: string
  bookingMode: PortalExpertBookingMode
  fixedExpertId: string | null
  facility: {
    id: string
    name: string
    address: string | null
  }
  services: Array<{
    id: string
    name: string
    durationMinutes: number
  }>
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function textValue(value: unknown, maxLength = 300): string {
  return typeof value === 'string'
    ? value.trim().slice(0, maxLength)
    : ''
}

function nullableText(value: unknown, maxLength = 500): string | null {
  return textValue(value, maxLength) || null
}

function positiveInteger(value: unknown): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 1_440
    ? parsed
    : 0
}

function bookingMode(value: unknown): PortalExpertBookingMode {
  return value === 'facility' || value === 'expert' || value === 'both'
    ? value
    : 'both'
}

export function portalExpertBookingCandidateScore(
  candidate: Pick<PortalExpertBookingCandidate, 'bookingMode' | 'fixedExpertId'>,
  expertId: string,
): number {
  if (candidate.fixedExpertId === expertId) return 40
  if (candidate.fixedExpertId) return 0
  if (candidate.bookingMode === 'expert') return 30
  if (candidate.bookingMode === 'both') return 20
  return 0
}

export function portalExpertBookingCandidate(
  raw: unknown,
  source: PortalExpertBookingWidgetSource,
  expertId: string,
): PortalExpertBookingCandidate | null {
  const catalog = recordValue(raw)
  const widget = recordValue(catalog.widget)
  const facility = recordValue(catalog.facility)
  const widgetKey = textValue(widget.key, 80)
  const widgetType = textValue(widget.widgetType ?? widget.widget_type, 40)
  const facilityId = textValue(facility.id, 80)
  const facilityName = textValue(facility.name, 200)

  if (
    widgetKey !== source.widgetKey
    || !uuidPattern.test(widgetKey)
    || widgetType !== 'calendar'
    || !uuidPattern.test(facilityId)
    || !facilityName
    || !uuidPattern.test(expertId)
  ) return null

  const rawFixedExpertId = textValue(
    widget.fixedExpertUserId ?? widget.fixed_expert_user_id,
    80,
  )
  if (rawFixedExpertId && !uuidPattern.test(rawFixedExpertId)) return null
  const fixedExpertId = rawFixedExpertId || null
  const mode = bookingMode(widget.bookingMode ?? widget.booking_mode)
  if (portalExpertBookingCandidateScore({ bookingMode: mode, fixedExpertId }, expertId) === 0) {
    return null
  }

  const services = (Array.isArray(catalog.services) ? catalog.services : [])
    .flatMap((input): PortalExpertBookingCandidate['services'] => {
      const service = recordValue(input)
      const id = textValue(service.id, 80)
      const name = textValue(service.name, 200)
      if (!uuidPattern.test(id) || !name) return []
      return [{
        id,
        name,
        durationMinutes: positiveInteger(
          service.durationMinutes ?? service.duration_minutes,
        ),
      }]
    })
  const servicesById = new Map(services.map(service => [service.id, service]))
  const expert = (Array.isArray(catalog.experts) ? catalog.experts : [])
    .map(recordValue)
    .find(candidate => (
      textValue(candidate.userId ?? candidate.user_id, 80) === expertId
    ))
  if (!expert) return null

  const rawServiceIds = expert.serviceIds ?? expert.service_ids
  const serviceIds = Array.isArray(rawServiceIds)
    ? [...new Set(rawServiceIds.map(value => textValue(value, 80)))]
    : [...servicesById.keys()]
  const bookableServices = serviceIds
    .flatMap(serviceId => servicesById.get(serviceId) ?? [])
    .sort((left, right) => (
      left.name.localeCompare(right.name, 'pl-PL')
      || left.durationMinutes - right.durationMinutes
    ))
  if (!bookableServices.length) return null

  return {
    organizationId: source.organizationId,
    widgetKey,
    bookingMode: mode,
    fixedExpertId,
    facility: {
      id: facilityId,
      name: facilityName,
      address: nullableText(facility.address, 500),
    },
    services: bookableServices,
  }
}

export function selectPortalExpertBookingCandidate(
  candidates: PortalExpertBookingCandidate[],
  expertId: string,
): PortalExpertBookingCandidate | null {
  return candidates.reduce<PortalExpertBookingCandidate | null>((selected, candidate) => {
    const score = portalExpertBookingCandidateScore(candidate, expertId)
    if (!score) return selected
    if (!selected) return candidate
    const selectedScore = portalExpertBookingCandidateScore(selected, expertId)
    if (score > selectedScore) return candidate
    if (score === selectedScore && candidate.widgetKey.localeCompare(selected.widgetKey) < 0) {
      return candidate
    }
    return selected
  }, null)
}

export function portalExpertBookingPath(widgetKey: string, expertId: string): string {
  if (!uuidPattern.test(widgetKey) || !uuidPattern.test(expertId)) return ''
  const query = new URLSearchParams({ expertId })
  return `/book/${encodeURIComponent(widgetKey)}?${query.toString()}`
}
