import type { CrmSession } from '~~/server/utils/crm'
import { throwDbError } from '~~/server/utils/crm'

export const facilityImageBucket = 'facility-images'
export const facilityImageLimit = 12
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
      .createSignedUrl(String(image.storage_path), 60 * 60)
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
