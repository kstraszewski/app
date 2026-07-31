import { createError, getRouterParam } from 'h3'
import type { DirectoryFacilityDetail } from '#shared/types/directory'
import {
  directoryCatalogSnapshot,
  type DirectoryCatalogSnapshot,
} from '../../../../utils/directory-catalog'
import {
  buildDirectoryFacilityDetail,
  directoryRouteSlug,
  selectDirectoryFacilityCatalog,
  type DirectoryFacilityDetailRow,
  type DirectoryOpeningHourRow,
  type DirectoryServiceDetailRow,
} from '../../../../utils/directory-facility-detail'
import { loadDirectoryFacilityGallery } from '../../../../utils/directory-cover-images'
import { serverDataBackend } from '../../../../utils/data-api'

function directoryNotFound(): never {
  throw createError({
    statusCode: 404,
    statusMessage: 'Nie znaleziono placówki.',
  })
}

function directoryUnavailable(
  operation: string,
  error: { code?: string, message?: string },
): never {
  console.error(`[directory] ${operation} failed`, {
    code: error.code,
    message: error.message,
  })
  throw createError({
    statusCode: 503,
    statusMessage: 'Katalog jest chwilowo niedostępny.',
  })
}

export default defineCachedEventHandler(async (
  event,
): Promise<DirectoryFacilityDetail> => {
  const organizationSlug = directoryRouteSlug(
    getRouterParam(event, 'organizationSlug'),
  )
  const facilitySlug = directoryRouteSlug(
    getRouterParam(event, 'facilitySlug'),
  )
  if (!organizationSlug || !facilitySlug) directoryNotFound()

  const backendData = serverDataBackend(event)
  const organizationResult = await backendData
    .from('organizations')
    .select('id')
    .eq('slug', organizationSlug)
    .maybeSingle()
  if (organizationResult.error) {
    directoryUnavailable('facility organization lookup', organizationResult.error)
  }
  if (!organizationResult.data) directoryNotFound()

  const organizationId = organizationResult.data.id
  const facilityIdentityResult = await backendData
    .from('facilities')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('slug', facilitySlug)
    .eq('is_active', true)
    .maybeSingle()
  if (facilityIdentityResult.error) {
    directoryUnavailable('facility identity lookup', facilityIdentityResult.error)
  }
  if (!facilityIdentityResult.data) directoryNotFound()

  const facilityId = facilityIdentityResult.data.id
  // This is the public exposure gate. No description, contact, opening hours,
  // gallery or staff data is read until an explicitly listed calendar widget
  // has also produced a valid, bookable public catalog.
  const widgetResult = await backendData
    .from('booking_widgets')
    .select('public_token')
    .eq('organization_id', organizationId)
    .eq('facility_id', facilityId)
    .eq('is_active', true)
    .eq('is_directory_listed', true)
    .eq('widget_type', 'calendar')
    .order('public_token')
  if (widgetResult.error) {
    directoryUnavailable('listed facility widget lookup', widgetResult.error)
  }
  if (!widgetResult.data?.length) directoryNotFound()

  let rpcFailureCount = 0
  const catalogResults = await Promise.all(
    widgetResult.data.map(async ({ public_token: widgetKey }) => {
      const { data, error } = await backendData.rpc(
        'get_booking_widget_catalog',
        { p_widget_token: widgetKey },
      )
      if (error) {
        rpcFailureCount += 1
        console.error('[directory] facility catalog RPC failed', {
          widgetKey,
          code: error.code,
          message: error.message,
        })
        return null
      }
      return directoryCatalogSnapshot(data, widgetKey)
    }),
  )
  const catalogs = catalogResults.filter(
    (catalog): catalog is DirectoryCatalogSnapshot => Boolean(catalog),
  )
  if (!catalogs.length && rpcFailureCount > 0) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Katalog jest chwilowo niedostępny.',
    })
  }

  const catalog = selectDirectoryFacilityCatalog(catalogs, facilityId)
  if (!catalog) directoryNotFound()

  const serviceIds = catalog.services.map(service => service.key)
  const [facilityResult, openingHoursResult, servicesResult] = await Promise.all([
    backendData
      .from('facilities')
      .select(`
        id,
        organization_id,
        name,
        slug,
        description,
        timezone,
        address_line1,
        address_line2,
        postal_code,
        city,
        country_code,
        latitude,
        longitude,
        phone,
        email
      `)
      .eq('organization_id', organizationId)
      .eq('id', facilityId)
      .eq('is_active', true)
      .single(),
    backendData
      .from('facility_opening_hours')
      .select('weekday, opens_at, closes_at')
      .eq('organization_id', organizationId)
      .eq('facility_id', facilityId)
      .eq('is_active', true)
      .order('weekday')
      .order('opens_at'),
    backendData
      .from('booking_services')
      .select('id, slug, name, description, duration_minutes')
      .eq('organization_id', organizationId)
      .eq('is_active', true)
      .in('id', serviceIds)
      .order('name'),
  ])

  if (facilityResult.error) {
    directoryUnavailable('published facility detail query', facilityResult.error)
  }
  if (openingHoursResult.error) {
    directoryUnavailable('published facility hours query', openingHoursResult.error)
  }
  if (servicesResult.error) {
    directoryUnavailable('published facility services query', servicesResult.error)
  }

  let gallery
  try {
    gallery = await loadDirectoryFacilityGallery(
      backendData,
      organizationId,
      facilityId,
      facilityResult.data.name,
    )
  }
  catch (error) {
    console.error('[directory] published facility gallery failed', {
      facilityId,
      message: error instanceof Error ? error.message : String(error),
    })
    throw createError({
      statusCode: 503,
      statusMessage: 'Katalog jest chwilowo niedostępny.',
    })
  }

  return buildDirectoryFacilityDetail({
    organizationSlug,
    facility: facilityResult.data as DirectoryFacilityDetailRow,
    catalog,
    openingHours: (openingHoursResult.data ?? []) as DirectoryOpeningHourRow[],
    services: (servicesResult.data ?? []) as DirectoryServiceDetailRow[],
    gallery,
  })
}, {
  name: 'public-directory-facility',
  maxAge: 5 * 60,
  staleMaxAge: 10 * 60,
  swr: true,
})
