import type {
  DirectoryExpert,
  DirectoryFacility,
  DirectoryFacilityReference,
  DirectoryService,
} from '../../shared/types/directory'
import {
  selectBookableCatalogEntries,
  selectDirectorySourceKeys,
} from './directory-selection.ts'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface DirectoryCatalogService {
  key: string
  value: DirectoryService
}

export interface DirectoryCatalogExpert {
  expertId: string
  name: string
  serviceKeys: string[]
}

export interface DirectoryCatalogSnapshot {
  widgetKey: string
  bookingMode: 'facility' | 'expert' | 'both'
  fixedExpertId: string | null
  facilityKey: string
  facility: DirectoryFacilityReference & { timezone: string }
  services: DirectoryCatalogService[]
  experts: DirectoryCatalogExpert[]
}

export type DirectoryFacilityDraft = Omit<
  DirectoryFacility,
  'organizationSlug' | 'facilitySlug' | 'city' | 'coordinates'
>

export interface DirectoryBuildResult {
  experts: DirectoryExpert[]
  facilities: DirectoryFacilityDraft[]
}

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

function integerValue(value: unknown): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 1440
    ? parsed
    : 0
}

function bookingModeValue(
  value: unknown,
): DirectoryCatalogSnapshot['bookingMode'] {
  return value === 'facility' || value === 'expert' || value === 'both'
    ? value
    : 'both'
}

export function directoryCatalogSnapshot(
  raw: unknown,
  expectedWidgetKey: string,
): DirectoryCatalogSnapshot | null {
  const catalog = recordValue(raw)
  const widget = recordValue(catalog.widget)
  const facility = recordValue(catalog.facility)
  const widgetKey = textValue(widget.key, 80)
  const widgetType = textValue(widget.widgetType ?? widget.widget_type, 40)
  const facilityKey = textValue(facility.id, 80)
  const facilityName = textValue(facility.name, 200)

  if (
    widgetKey !== expectedWidgetKey
    || widgetType !== 'calendar'
    || !uuidPattern.test(widgetKey)
    || !uuidPattern.test(facilityKey)
    || !facilityName
  ) {
    return null
  }

  const services = (Array.isArray(catalog.services) ? catalog.services : [])
    .flatMap((input): DirectoryCatalogService[] => {
      const service = recordValue(input)
      const id = textValue(service.id, 80)
      const name = textValue(service.name, 200)
      if (!uuidPattern.test(id) || !name) return []

      return [{
        key: id,
        value: {
          name,
          durationMinutes: integerValue(
            service.durationMinutes ?? service.duration_minutes,
          ),
        },
      }]
    })

  const availableServiceKeys = new Set(services.map(service => service.key))
  const experts = (Array.isArray(catalog.experts) ? catalog.experts : [])
    .flatMap((input): DirectoryCatalogExpert[] => {
      const expert = recordValue(input)
      const expertId = textValue(expert.userId ?? expert.user_id, 80)
      const name = textValue(expert.name ?? expert.full_name, 200)
      if (!uuidPattern.test(expertId) || !name) return []

      const rawServiceIds = expert.serviceIds ?? expert.service_ids
      const serviceKeys = Array.isArray(rawServiceIds)
        ? [...new Set(rawServiceIds
            .map(serviceId => textValue(serviceId, 80))
            .filter(serviceId => availableServiceKeys.has(serviceId)))]
        : [...availableServiceKeys]

      return [{ expertId, name, serviceKeys }]
    })

  const rawFixedExpertId = textValue(
    widget.fixedExpertUserId ?? widget.fixed_expert_user_id,
    80,
  )
  if (rawFixedExpertId && !uuidPattern.test(rawFixedExpertId)) return null
  const fixedExpertId = rawFixedExpertId || null
  const bookableEntries = selectBookableCatalogEntries(
    services,
    experts,
    fixedExpertId,
  )
  if (!bookableEntries) return null

  return {
    widgetKey,
    bookingMode: bookingModeValue(widget.bookingMode ?? widget.booking_mode),
    fixedExpertId,
    facilityKey,
    facility: {
      name: facilityName,
      address: nullableText(facility.address, 500),
      timezone: textValue(facility.timezone, 100) || 'Europe/Warsaw',
    },
    services: bookableEntries.services,
    experts: bookableEntries.experts,
  }
}

function serviceSort(
  left: DirectoryService,
  right: DirectoryService,
): number {
  return left.name.localeCompare(right.name, 'pl-PL')
    || left.durationMinutes - right.durationMinutes
}

export function buildDirectory(
  catalogs: DirectoryCatalogSnapshot[],
): DirectoryBuildResult {
  const catalogsByWidgetKey = new Map(catalogs.map(catalog => [
    catalog.widgetKey,
    catalog,
  ]))
  const selection = selectDirectorySourceKeys(catalogs.map(catalog => ({
    widgetKey: catalog.widgetKey,
    facilityKey: catalog.facilityKey,
    bookingMode: catalog.bookingMode,
    fixedExpertId: catalog.fixedExpertId,
    expertIds: catalog.experts.map(expert => expert.expertId),
  })))

  return {
    experts: [...selection.expertWidgetKeys]
      .flatMap(([expertId, widgetKey]): DirectoryExpert[] => {
        const catalog = catalogsByWidgetKey.get(widgetKey)
        const expert = catalog?.experts.find(
          candidate => candidate.expertId === expertId,
        )
        if (!catalog || !expert) return []

        const servicesById = new Map(
          catalog.services.map(service => [service.key, service.value]),
        )
        return [{
          expertId,
          name: expert.name,
          services: expert.serviceKeys
            .flatMap(key => servicesById.get(key) ?? [])
            .sort(serviceSort),
          facilities: [{
            name: catalog.facility.name,
            address: catalog.facility.address,
          }],
          widgetKey,
        }]
      })
      .sort((left, right) => left.name.localeCompare(right.name, 'pl-PL')),
    facilities: [...selection.facilityWidgetKeys.values()]
      .flatMap((widgetKey): DirectoryFacilityDraft[] => {
        const catalog = catalogsByWidgetKey.get(widgetKey)
        if (!catalog) return []

        return [{
          facilityId: catalog.facilityKey,
          name: catalog.facility.name,
          address: catalog.facility.address,
          timezone: catalog.facility.timezone,
          services: catalog.services
            .map(service => service.value)
            .sort(serviceSort),
          experts: catalog.experts
            .map(expert => ({ name: expert.name }))
            .sort((left, right) => left.name.localeCompare(right.name, 'pl-PL')),
          widgetKey,
          coverImage: null,
        }]
      })
      .sort((left, right) => left.name.localeCompare(right.name, 'pl-PL')),
  }
}
