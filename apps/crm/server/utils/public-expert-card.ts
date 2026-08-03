export type PublicDirectoryBookingMode = 'facility' | 'expert' | 'both'

export interface PublicDirectoryWidgetSource {
  organizationId: string
  widgetKey: string
}

export interface PublicDirectoryCardCandidate {
  organizationId: string
  widgetKey: string
  bookingMode: PublicDirectoryBookingMode
  fixedExpertId: string | null
  name: string
  avatarUrl: string | null
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

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 1440
    ? parsed
    : 0
}

function bookingMode(value: unknown): PublicDirectoryBookingMode {
  return value === 'facility' || value === 'expert' || value === 'both'
    ? value
    : 'both'
}

function candidateScore(candidate: PublicDirectoryCardCandidate, expertId: string): number {
  if (candidate.fixedExpertId === expertId) return 40
  if (candidate.bookingMode === 'expert') return 30
  if (candidate.bookingMode === 'both') return 20
  return 0
}

export function publicDirectoryExpertCardEligible(
  candidate: PublicDirectoryCardCandidate,
  expertId: string,
): boolean {
  return candidateScore(candidate, expertId) > 0
}

export function publicDirectoryCardCandidate(
  raw: unknown,
  source: PublicDirectoryWidgetSource,
  expertId: string,
): PublicDirectoryCardCandidate | null {
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
  ) return null

  const rawFixedExpertId = textValue(
    widget.fixedExpertUserId ?? widget.fixed_expert_user_id,
    80,
  )
  if (rawFixedExpertId && !uuidPattern.test(rawFixedExpertId)) return null
  const fixedExpertId = rawFixedExpertId || null
  if (fixedExpertId && fixedExpertId !== expertId) return null

  const services = (Array.isArray(catalog.services) ? catalog.services : [])
    .flatMap((input): PublicDirectoryCardCandidate['services'] => {
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
    .find((candidate) => (
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

  const candidate: PublicDirectoryCardCandidate = {
    organizationId: source.organizationId,
    widgetKey,
    bookingMode: bookingMode(widget.bookingMode ?? widget.booking_mode),
    fixedExpertId,
    name: textValue(expert.name ?? expert.full_name, 200) || 'Ekspert',
    avatarUrl: nullableText(expert.avatarUrl ?? expert.avatar_url, 2_000),
    facility: {
      id: facilityId,
      name: facilityName,
      address: nullableText(facility.address, 500),
    },
    services: bookableServices,
  }

  return candidate
}

export function selectPublicDirectoryCard(
  candidates: PublicDirectoryCardCandidate[],
  expertId: string,
): PublicDirectoryCardCandidate | null {
  return candidates
    .filter(candidate => publicDirectoryExpertCardEligible(candidate, expertId))
    .reduce<PublicDirectoryCardCandidate | null>((selected, candidate) => {
      if (!selected) return candidate
      const selectedScore = candidateScore(selected, expertId)
      const candidateValue = candidateScore(candidate, expertId)
      if (candidateValue > selectedScore) return candidate
      if (candidateValue === selectedScore && candidate.widgetKey.localeCompare(selected.widgetKey) < 0) {
        return candidate
      }
      return selected
    }, null)
}
