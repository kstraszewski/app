import { createError } from 'h3'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../../../packages/database/database.types'
import type {
  DirectoryCoordinates,
} from '../../shared/types/directory'

const FACILITY_BATCH_SIZE = 80

type ServiceRoleClient = SupabaseClient<Database, 'public'>

interface FacilityMetadataRow {
  id: string
  organization_id: string
  slug: string
  city: string | null
  latitude: number | null
  longitude: number | null
}

export interface DirectoryFacilityMetadata {
  organizationSlug: string
  facilitySlug: string
  city: string | null
  coordinates: DirectoryCoordinates | null
}

export interface DirectoryAddressParts {
  addressLine1: string | null
  addressLine2: string | null
  postalCode: string | null
  city: string | null
  countryCode: string | null
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  return value.trim().slice(0, maxLength) || null
}

export function directoryCoordinates(
  latitude: unknown,
  longitude: unknown,
): DirectoryCoordinates | null {
  if (
    typeof latitude !== 'number'
    || !Number.isFinite(latitude)
    || latitude < -90
    || latitude > 90
    || typeof longitude !== 'number'
    || !Number.isFinite(longitude)
    || longitude < -180
    || longitude > 180
  ) {
    return null
  }

  return { latitude, longitude }
}

export function formatDirectoryAddress(parts: DirectoryAddressParts): string | null {
  const street = [
    cleanText(parts.addressLine1, 300),
    cleanText(parts.addressLine2, 300),
  ].filter(Boolean).join(', ')
  const locality = [
    cleanText(parts.postalCode, 30),
    cleanText(parts.city, 200),
  ].filter(Boolean).join(' ')

  return [
    street,
    locality,
    cleanText(parts.countryCode, 2),
  ].filter(Boolean).join(', ') || null
}

function directoryUnavailable(): never {
  throw createError({
    statusCode: 503,
    statusMessage: 'Katalog jest chwilowo niedostępny.',
  })
}

export async function loadDirectoryFacilityMetadata(
  serviceRole: ServiceRoleClient,
  facilities: Array<{ facilityId: string }>,
): Promise<Map<string, DirectoryFacilityMetadata>> {
  const facilityIds = [...new Set(
    facilities.map(facility => facility.facilityId).filter(Boolean),
  )]
  if (!facilityIds.length) return new Map()

  const rows: FacilityMetadataRow[] = []
  for (let start = 0; start < facilityIds.length; start += FACILITY_BATCH_SIZE) {
    const batch = facilityIds.slice(start, start + FACILITY_BATCH_SIZE)
    const { data, error } = await serviceRole
      .from('facilities')
      .select('id, organization_id, slug, city, latitude, longitude')
      .in('id', batch)
      .eq('is_active', true)

    if (error) {
      console.error('[directory] facility metadata query failed', {
        code: error.code,
        message: error.message,
        facilityCount: batch.length,
      })
      directoryUnavailable()
    }
    rows.push(...((data ?? []) as FacilityMetadataRow[]))
  }

  if (rows.length !== facilityIds.length) {
    console.error('[directory] published facility rows are incomplete', {
      expectedFacilityCount: facilityIds.length,
      rowCount: rows.length,
    })
    directoryUnavailable()
  }

  const organizationIds = [...new Set(rows.map(row => row.organization_id))]
  const { data: organizations, error: organizationsError } = await serviceRole
    .from('organizations')
    .select('id, slug')
    .in('id', organizationIds)

  if (organizationsError) {
    console.error('[directory] organization slug query failed', {
      code: organizationsError.code,
      message: organizationsError.message,
      organizationCount: organizationIds.length,
    })
    directoryUnavailable()
  }

  const organizationSlugs = new Map(
    (organizations ?? []).map(organization => [
      organization.id,
      organization.slug,
    ]),
  )
  const metadata = new Map<string, DirectoryFacilityMetadata>()

  for (const row of rows) {
    const organizationSlug = organizationSlugs.get(row.organization_id)?.trim()
    const facilitySlug = row.slug.trim()
    if (!organizationSlug || !facilitySlug) continue

    metadata.set(row.id, {
      organizationSlug,
      facilitySlug,
      city: cleanText(row.city, 200),
      coordinates: directoryCoordinates(row.latitude, row.longitude),
    })
  }

  if (metadata.size !== facilityIds.length) {
    console.error('[directory] published facility metadata is incomplete', {
      expectedFacilityCount: facilityIds.length,
      metadataCount: metadata.size,
    })
    directoryUnavailable()
  }

  return metadata
}
