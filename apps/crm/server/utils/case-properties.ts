import type { CrmSession } from '~~/server/utils/crm'
import { throwDbError } from '~~/server/utils/crm'

export const propertyImageBucket = 'crm-property-images'
export const propertyPublicSelect = 'id, case_id, case_item_id, address, city, postal_code, property_type, market_type, price_amount, appraisal_value_amount, currency, area_m2, rooms, listing_title, description, source_url, source_published_at, imported_at, metadata, created_at, updated_at'
export const propertyImagePublicSelect = 'id, property_id, source_url, mime_type, size_bytes, width_px, height_px, sort_order, alt_text, metadata, created_at, updated_at'
const propertyImageStorageSelect = `${propertyImagePublicSelect}, storage_bucket, storage_path`

interface PropertyRow {
  id: string
  [key: string]: unknown
}

interface ImageRow {
  id: string
  property_id: string
  storage_bucket: string
  storage_path: string
  [key: string]: unknown
}

export async function selectCasePropertyIfNone(
  session: CrmSession,
  caseId: string,
  propertyId: string,
  selectedAt = new Date().toISOString(),
): Promise<void> {
  const { error } = await session.supabase
    .from('crm_case_property_selections')
    .upsert({
      organization_id: session.organizationId,
      case_id: caseId,
      property_id: propertyId,
      selected_by_user_id: session.userId,
      selected_at: selectedAt,
    }, {
      onConflict: 'organization_id,case_id',
      ignoreDuplicates: true,
    })
  throwDbError(error)
}

export async function attachSignedPropertyImages<T extends PropertyRow>(
  session: CrmSession,
  properties: T[],
): Promise<Array<T & { images: Array<Record<string, unknown>> }>> {
  const propertyIds = properties.map(property => String(property.id))
  if (!propertyIds.length) return []

  const { data, error } = await session.supabase
    .from('crm_property_images')
    .select(propertyImageStorageSelect)
    .eq('organization_id', session.organizationId)
    .in('property_id', propertyIds)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  throwDbError(error)

  const imageRows = (data ?? []) as ImageRow[]
  const signedImages = await Promise.all(imageRows.map(async (image) => {
    const { data: signed, error: signedError } = await session.supabase.storage
      .from(String(image.storage_bucket))
      .createSignedUrl(String(image.storage_path), 60 * 60)
    if (signedError) {
      console.error('[crm-properties] failed to sign property image', {
        imageId: image.id,
        message: signedError.message,
      })
    }
    const { storage_bucket: _storageBucket, storage_path: _storagePath, ...publicImage } = image
    return { ...publicImage, url: signed?.signedUrl ?? null }
  }))

  const imagesByProperty = new Map<string, Array<Record<string, unknown>>>()
  for (const image of signedImages) {
    const propertyId = String(image.property_id)
    const list = imagesByProperty.get(propertyId) ?? []
    list.push(image)
    imagesByProperty.set(propertyId, list)
  }

  return properties.map(property => ({
    ...property,
    images: imagesByProperty.get(String(property.id)) ?? [],
  }))
}
