import { serverSupabaseServiceRole } from '#supabase/server'
import { getQuery, setHeader } from 'h3'
import { requireCrmSession, throwDbError } from '~~/server/utils/crm'
import {
  listSignedFacilityCoverImages,
  type SignedFacilityCoverImage,
} from '~~/server/utils/facility-images'
import { listAccessibleFacilityIds } from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const includeCover = getQuery(event).includeCover === 'true'
  setHeader(event, 'Cache-Control', 'private, no-store')
  const accessibleIds = await listAccessibleFacilityIds(session)
  if (accessibleIds?.length === 0) {
    return {
      data: [],
      role: session.role,
      canCreate: false,
      defaultFacilityId: null,
    }
  }

  let request = session.supabase
    .from('facilities')
    .select('id, organization_id, name, slug, description, timezone, address_line1, address_line2, postal_code, city, country_code, phone, email, is_active, created_at, updated_at')
    .eq('organization_id', session.organizationId)
    .order('is_active', { ascending: false })
    .order('name')
  if (accessibleIds) request = request.in('id', accessibleIds)

  const serviceRole = serverSupabaseServiceRole(event) as any
  const [facilitiesResult, preferencesResult] = await Promise.all([
    request,
    serviceRole
      .from('organization_user_preferences')
      .select('default_facility_id')
      .eq('organization_id', session.organizationId)
      .eq('user_id', session.userId)
      .maybeSingle(),
  ])
  throwDbError(facilitiesResult.error)
  throwDbError(preferencesResult.error)

  const facilities = facilitiesResult.data ?? []
  let responseFacilities = facilities
  if (includeCover) {
    let coversByFacilityId = new Map<string, SignedFacilityCoverImage>()
    try {
      coversByFacilityId = await listSignedFacilityCoverImages(
        session,
        facilities.map((facility: any) => String(facility.id)),
      )
    } catch (coverError: unknown) {
      console.error('[facilities] failed to load cover images', coverError)
    }

    responseFacilities = facilities.map((facility: any) => {
      const cover = coversByFacilityId.get(String(facility.id))
      return {
        ...facility,
        coverImage: cover
          ? {
              thumbnailUrl: cover.thumbnailUrl,
              fallbackUrl: cover.fallbackUrl,
              alt: cover.alt?.trim() || `${String(facility.name)} — zdjęcie placówki`,
            }
          : null,
      }
    })
  }
  const requestedDefaultId = preferencesResult.data?.default_facility_id
    ? String(preferencesResult.data.default_facility_id)
    : null
  const defaultFacilityId = requestedDefaultId
    && facilities.some((facility: any) => (
      String(facility.id) === requestedDefaultId && facility.is_active === true
    ))
    ? requestedDefaultId
    : null

  return {
    data: responseFacilities,
    role: session.role,
    canCreate: session.role === 'admin',
    defaultFacilityId,
  }
})
