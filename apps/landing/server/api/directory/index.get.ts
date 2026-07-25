import { createError, setResponseHeader } from 'h3'
import type {
  DirectoryExpert,
  DirectoryFacility,
  DirectoryFacilityReference,
  DirectoryPayload,
  DirectoryService,
} from '#shared/types/directory'
import {
  selectBookableCatalogEntries,
  selectDirectorySourceKeys,
} from '../../utils/directory-selection'
import { loadDirectoryCoverImages } from '../../utils/directory-cover-images'
import { serverSupabaseServiceRole } from '../../utils/supabase'

const WIDGET_PAGE_SIZE = 200
const RPC_BATCH_SIZE = 20
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface CatalogService {
  key: string
  value: DirectoryService
}

interface CatalogExpert {
  expertId: string
  name: string
  serviceKeys: string[]
}

interface CatalogSnapshot {
  widgetKey: string
  bookingMode: 'facility' | 'expert' | 'both'
  fixedExpertId: string | null
  facilityKey: string
  facility: DirectoryFacilityReference & { timezone: string }
  services: CatalogService[]
  experts: CatalogExpert[]
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

function bookingModeValue(value: unknown): CatalogSnapshot['bookingMode'] {
  return value === 'facility' || value === 'expert' || value === 'both'
    ? value
    : 'both'
}

function catalogSnapshot(raw: unknown, expectedWidgetKey: string): CatalogSnapshot | null {
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
    .flatMap((input): CatalogService[] => {
      const service = recordValue(input)
      const id = textValue(service.id, 80)
      const name = textValue(service.name, 200)
      if (!uuidPattern.test(id) || !name) return []

      return [{
        key: id,
        value: {
          name,
          durationMinutes: integerValue(service.durationMinutes ?? service.duration_minutes),
        },
      }]
    })

  const availableServiceKeys = new Set(services.map(service => service.key))
  const experts = (Array.isArray(catalog.experts) ? catalog.experts : [])
    .flatMap((input): CatalogExpert[] => {
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
  // A listed widget without at least one valid expert–service pair would only
  // lead visitors to an unavailable booking screen.
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

function serviceSort(left: DirectoryService, right: DirectoryService): number {
  return left.name.localeCompare(right.name, 'pl-PL')
    || left.durationMinutes - right.durationMinutes
}

function buildDirectory(catalogs: CatalogSnapshot[]): Omit<DirectoryPayload, 'generatedAt'> {
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
        const expert = catalog?.experts.find(candidate => candidate.expertId === expertId)
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
      .flatMap((widgetKey): DirectoryFacility[] => {
        const catalog = catalogsByWidgetKey.get(widgetKey)
        if (!catalog) return []

        return [{
          facilityId: catalog.facilityKey,
          name: catalog.facility.name,
          address: catalog.facility.address,
          timezone: catalog.facility.timezone,
          services: catalog.services.map(service => service.value).sort(serviceSort),
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

export default defineEventHandler(async (event): Promise<DirectoryPayload> => {
  const serviceRole = serverSupabaseServiceRole(event)
  const widgetKeys: string[] = []

  for (let from = 0; ; from += WIDGET_PAGE_SIZE) {
    const { data, error } = await serviceRole
      .from('booking_widgets')
      .select('public_token')
      .eq('is_active', true)
      // The opt-in column is introduced by the directory migration. Keep this
      // query usable before the generated database types are refreshed.
      .eq('is_directory_listed' as never, true)
      .eq('widget_type', 'calendar')
      .order('public_token')
      .range(from, from + WIDGET_PAGE_SIZE - 1)

    if (error) {
      console.error('[directory] active calendar widgets query failed', {
        code: error.code,
        message: error.message,
      })
      throw createError({
        statusCode: 503,
        statusMessage: 'Katalog jest chwilowo niedostępny.',
      })
    }

    const pageKeys = (data ?? [])
      .map(row => textValue(row.public_token, 80))
      .filter(key => uuidPattern.test(key))
    widgetKeys.push(...pageKeys)
    if ((data ?? []).length < WIDGET_PAGE_SIZE) break
  }

  const catalogs: CatalogSnapshot[] = []
  let rpcFailureCount = 0

  for (let start = 0; start < widgetKeys.length; start += RPC_BATCH_SIZE) {
    const batch = widgetKeys.slice(start, start + RPC_BATCH_SIZE)
    const results = await Promise.all(batch.map(async (widgetKey) => {
      const { data, error } = await serviceRole.rpc('get_booking_widget_catalog', {
        p_widget_token: widgetKey,
      })

      if (error) {
        rpcFailureCount += 1
        console.error('[directory] booking widget catalog RPC failed', {
          widgetKey,
          code: error.code,
          message: error.message,
        })
        return null
      }

      return catalogSnapshot(data, widgetKey)
    }))

    catalogs.push(...results.filter((catalog): catalog is CatalogSnapshot => Boolean(catalog)))
  }

  if (widgetKeys.length > 0 && catalogs.length === 0 && rpcFailureCount > 0) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Katalog jest chwilowo niedostępny.',
    })
  }

  setResponseHeader(
    event,
    'Cache-Control',
    'no-store',
  )

  const directory = buildDirectory(catalogs)
  const coverImages = await loadDirectoryCoverImages(
    serviceRole,
    directory.facilities,
  )

  return {
    generatedAt: new Date().toISOString(),
    ...directory,
    facilities: directory.facilities.map(facility => ({
      ...facility,
      coverImage: coverImages.get(facility.facilityId) ?? null,
    })),
  }
})
