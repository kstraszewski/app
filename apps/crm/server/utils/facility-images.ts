import type { CrmSession } from '~~/server/utils/crm'
import { throwDbError } from '~~/server/utils/crm'

export const facilityImageBucket = 'facility-images'
export const facilityImageLimit = 12
const facilityCoverBatchSize = 80
const facilityImageSignedUrlTtlSeconds = 60 * 60
export const facilityImagePublicSelect = [
  'id',
  'organization_id',
  'facility_id',
  'original_filename',
  'mime_type',
  'size_bytes',
  'width_px',
  'height_px',
  'sort_order',
  'alt_text',
  'uploaded_by',
  'created_at',
  'updated_at',
].join(', ')
const facilityImageStorageSelect = `${facilityImagePublicSelect}, storage_bucket, storage_path`

interface FacilityImageRow {
  id: string
  storage_bucket: string
  storage_path: string
  [key: string]: unknown
}

interface FacilityCoverImageRow {
  id: string
  facility_id: string
  storage_bucket: string
  storage_path: string
  alt_text: string | null
  sort_order: number
  created_at: string
}

export interface SignedFacilityCoverImage {
  thumbnailUrl: string | null
  fallbackUrl: string | null
  alt: string | null
}

export async function listSignedFacilityCoverImages(
  session: CrmSession,
  requestedFacilityIds: string[],
): Promise<Map<string, SignedFacilityCoverImage>> {
  const facilityIds = [...new Set(requestedFacilityIds.filter(Boolean))]
  const coversByFacilityId = new Map<string, SignedFacilityCoverImage>()

  for (let offset = 0; offset < facilityIds.length; offset += facilityCoverBatchSize) {
    const batch = facilityIds.slice(offset, offset + facilityCoverBatchSize)
    const { data, error } = await session.supabase
      .from('facility_images')
      .select('id, facility_id, storage_bucket, storage_path, alt_text, sort_order, created_at')
      .eq('organization_id', session.organizationId)
      .in('facility_id', batch)
      .order('facility_id', { ascending: true })
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
    throwDbError(error)

    const firstImageByFacilityId = new Map<string, FacilityCoverImageRow>()
    for (const image of (data ?? []) as FacilityCoverImageRow[]) {
      if (!firstImageByFacilityId.has(image.facility_id)) {
        firstImageByFacilityId.set(image.facility_id, image)
      }
    }

    await Promise.all([...firstImageByFacilityId.values()].map(async (image) => {
      const storage = session.supabase.storage.from(image.storage_bucket)
      const [thumbnailResult, fallbackResult] = await Promise.all([
        storage.createSignedUrl(image.storage_path, facilityImageSignedUrlTtlSeconds, {
          transform: {
            width: 192,
            height: 144,
            resize: 'cover',
            quality: 72,
          },
        }),
        storage.createSignedUrl(image.storage_path, facilityImageSignedUrlTtlSeconds),
      ])

      if (thumbnailResult.error) {
        console.warn('[facility-images] failed to sign cover thumbnail', {
          imageId: image.id,
          facilityId: image.facility_id,
          message: thumbnailResult.error.message,
        })
      }
      if (fallbackResult.error) {
        console.warn('[facility-images] failed to sign cover fallback', {
          imageId: image.id,
          facilityId: image.facility_id,
          message: fallbackResult.error.message,
        })
      }

      const thumbnailUrl = thumbnailResult.data?.signedUrl ?? null
      const fallbackUrl = fallbackResult.data?.signedUrl ?? null
      if (!thumbnailUrl && !fallbackUrl) return

      coversByFacilityId.set(image.facility_id, {
        thumbnailUrl,
        fallbackUrl,
        alt: image.alt_text,
      })
    }))
  }

  return coversByFacilityId
}

export async function listSignedFacilityImages(
  session: CrmSession,
  facilityId: string,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await session.supabase
    .from('facility_images')
    .select(facilityImageStorageSelect)
    .eq('organization_id', session.organizationId)
    .eq('facility_id', facilityId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
  throwDbError(error)

  return await Promise.all(((data ?? []) as FacilityImageRow[]).map(async (image) => {
    const { data: signed, error: signedError } = await session.supabase.storage
      .from(String(image.storage_bucket))
      .createSignedUrl(String(image.storage_path), facilityImageSignedUrlTtlSeconds)
    if (signedError) {
      console.error('[facility-images] failed to sign image', {
        imageId: image.id,
        message: signedError.message,
      })
    }
    const { storage_bucket: _storageBucket, storage_path: _storagePath, ...publicImage } = image
    return {
      ...publicImage,
      url: signed?.signedUrl ?? null,
    }
  }))
}
