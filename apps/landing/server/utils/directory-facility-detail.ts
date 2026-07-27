import type {
  DirectoryFacilityDetail,
  DirectoryFacilityDetailService,
  DirectoryFacilityGalleryImage,
  DirectoryFacilityOpeningHour,
} from '../../shared/types/directory'
import type { DirectoryCatalogSnapshot } from './directory-catalog'
import {
  directoryCoordinates,
  formatDirectoryAddress,
} from './directory-facilities.ts'
import { selectDirectorySourceKeys } from './directory-selection.ts'

const routeSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export interface DirectoryFacilityDetailRow {
  id: string
  organization_id: string
  name: string
  slug: string
  description: string | null
  timezone: string
  address_line1: string | null
  address_line2: string | null
  postal_code: string | null
  city: string | null
  country_code: string
  latitude: number | null
  longitude: number | null
  phone: string | null
  email: string | null
}

export interface DirectoryOpeningHourRow {
  weekday: number
  opens_at: string
  closes_at: string
}

export interface DirectoryServiceDetailRow {
  id: string
  slug: string
  name: string
  description: string | null
  duration_minutes: number
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.trim().slice(0, maxLength)
    : ''
}

function nullableText(value: unknown, maxLength: number): string | null {
  return cleanText(value, maxLength) || null
}

export function directoryRouteSlug(value: unknown): string | null {
  const slug = cleanText(value, 101)
  return slug.length <= 100 && routeSlugPattern.test(slug)
    ? slug
    : null
}

export function selectDirectoryFacilityCatalog(
  catalogs: DirectoryCatalogSnapshot[],
  facilityId: string,
): DirectoryCatalogSnapshot | null {
  const selection = selectDirectorySourceKeys(catalogs.map(catalog => ({
    widgetKey: catalog.widgetKey,
    facilityKey: catalog.facilityKey,
    bookingMode: catalog.bookingMode,
    fixedExpertId: catalog.fixedExpertId,
    expertIds: catalog.experts.map(expert => expert.expertId),
  })))
  const widgetKey = selection.facilityWidgetKeys.get(facilityId)
  return catalogs.find(catalog => catalog.widgetKey === widgetKey) ?? null
}

function detailServices(
  catalog: DirectoryCatalogSnapshot,
  rows: DirectoryServiceDetailRow[],
): DirectoryFacilityDetailService[] {
  const allowedServiceIds = new Set(
    catalog.services.map(service => service.key),
  )

  return rows
    .filter(row => allowedServiceIds.has(row.id))
    .map(row => ({
      serviceId: row.id,
      slug: cleanText(row.slug, 200),
      name: cleanText(row.name, 200),
      description: nullableText(row.description, 4_000),
      durationMinutes: Number.isSafeInteger(row.duration_minutes)
        ? Math.max(0, Math.min(1440, row.duration_minutes))
        : 0,
    }))
    .filter(service => service.serviceId && service.slug && service.name)
    .sort((left, right) => (
      left.name.localeCompare(right.name, 'pl-PL')
      || left.serviceId.localeCompare(right.serviceId)
    ))
}

function detailOpeningHours(
  rows: DirectoryOpeningHourRow[],
): DirectoryFacilityOpeningHour[] {
  return rows
    .filter(row => (
      Number.isSafeInteger(row.weekday)
      && row.weekday >= 0
      && row.weekday <= 6
      && cleanText(row.opens_at, 20)
      && cleanText(row.closes_at, 20)
    ))
    .map(row => ({
      weekday: row.weekday,
      opensAt: cleanText(row.opens_at, 20),
      closesAt: cleanText(row.closes_at, 20),
    }))
    .sort((left, right) => (
      left.weekday - right.weekday
      || left.opensAt.localeCompare(right.opensAt)
      || left.closesAt.localeCompare(right.closesAt)
    ))
}

export function buildDirectoryFacilityDetail(input: {
  organizationSlug: string
  facility: DirectoryFacilityDetailRow
  catalog: DirectoryCatalogSnapshot
  openingHours: DirectoryOpeningHourRow[]
  services: DirectoryServiceDetailRow[]
  gallery: DirectoryFacilityGalleryImage[]
}): DirectoryFacilityDetail {
  const services = detailServices(input.catalog, input.services)
  const publishedServiceIds = new Set(
    services.map(service => service.serviceId),
  )
  const facility = input.facility

  return {
    facilityId: facility.id,
    organizationSlug: input.organizationSlug,
    facilitySlug: facility.slug,
    name: cleanText(facility.name, 200),
    description: nullableText(facility.description, 8_000),
    address: formatDirectoryAddress({
      addressLine1: facility.address_line1,
      addressLine2: facility.address_line2,
      postalCode: facility.postal_code,
      city: facility.city,
      countryCode: facility.country_code,
    }),
    addressLine1: nullableText(facility.address_line1, 300),
    addressLine2: nullableText(facility.address_line2, 300),
    postalCode: nullableText(facility.postal_code, 30),
    city: nullableText(facility.city, 200),
    countryCode: cleanText(facility.country_code, 2) || 'PL',
    timezone: cleanText(facility.timezone, 100) || 'Europe/Warsaw',
    coordinates: directoryCoordinates(
      facility.latitude,
      facility.longitude,
    ),
    contact: {
      phone: nullableText(facility.phone, 80),
      email: nullableText(facility.email, 320),
    },
    openingHours: detailOpeningHours(input.openingHours),
    gallery: input.gallery,
    services,
    experts: input.catalog.experts
      .map(expert => ({
        expertId: expert.expertId,
        name: cleanText(expert.name, 200),
        serviceIds: expert.serviceKeys.filter(
          serviceId => publishedServiceIds.has(serviceId),
        ),
      }))
      .filter(expert => expert.name && expert.serviceIds.length > 0)
      .sort((left, right) => (
        left.name.localeCompare(right.name, 'pl-PL')
        || left.expertId.localeCompare(right.expertId)
      )),
    widgetKey: input.catalog.widgetKey,
  }
}
