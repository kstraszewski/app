import { createHash, randomUUID } from 'node:crypto'
import { serverDataBackend } from '~~/server/utils/data-api'
import { createError, readMultipartFormData } from 'h3'
import sharp from 'sharp'
import { requireCrmSession, throwDbError } from '~~/server/utils/crm'
import {
  facilityImageBucket,
  facilityImageLimit,
  facilityImagePublicSelect,
} from '~~/server/utils/facility-images'
import { requireFacilityPermission } from '~~/server/utils/scheduling'

const maxSourceBytes = 8 * 1024 * 1024
const allowedSourceTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const access = await requireFacilityPermission(session, getRouterParam(event, 'facilityId'), 'manage')
  const facilityId = String(access.facility.id)
  const backendData = serverDataBackend(event) as any

  const parts = await readMultipartFormData(event)
  const image = parts?.find(part => part.name === 'image' && part.filename)
  if (!image?.data?.length) {
    throw createError({ statusCode: 400, statusMessage: 'Image file is required' })
  }
  if (image.data.length > maxSourceBytes) {
    throw createError({ statusCode: 413, statusMessage: 'Image must not exceed 8 MB' })
  }
  if (!image.type || !allowedSourceTypes.has(image.type)) {
    throw createError({
      statusCode: 415,
      statusMessage: 'Image must be a JPEG, PNG or WebP file',
    })
  }

  const countResult = await session.dataApi
    .from('facility_images')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', session.organizationId)
    .eq('facility_id', facilityId)
  throwDbError(countResult.error)
  if ((countResult.count ?? 0) >= facilityImageLimit) {
    throw createError({
      statusCode: 409,
      statusMessage: `A facility can have at most ${facilityImageLimit} images`,
    })
  }

  let processed: {
    data: Buffer
    info: {
      width: number
      height: number
    }
  }
  try {
    processed = await sharp(image.data, {
      failOn: 'error',
      limitInputPixels: 50_000_000,
    })
      .rotate()
      .resize({
        width: 2000,
        height: 2000,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 84, effort: 4 })
      .toBuffer({ resolveWithObject: true })
  } catch {
    throw createError({
      statusCode: 415,
      statusMessage: 'File contents are not a valid supported image',
    })
  }

  if (!processed.data.length || processed.data.length > maxSourceBytes) {
    throw createError({
      statusCode: 413,
      statusMessage: 'Optimized image must not exceed 8 MB',
    })
  }

  const sha256 = createHash('sha256').update(processed.data).digest('hex')
  const duplicateResult = await session.dataApi
    .from('facility_images')
    .select('id')
    .eq('organization_id', session.organizationId)
    .eq('facility_id', facilityId)
    .eq('sha256', sha256)
    .maybeSingle()
  throwDbError(duplicateResult.error)
  if (duplicateResult.data) {
    throw createError({
      statusCode: 409,
      statusMessage: 'This image has already been added to the facility',
    })
  }

  const sortResult = await session.dataApi
    .from('facility_images')
    .select('sort_order')
    .eq('organization_id', session.organizationId)
    .eq('facility_id', facilityId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  throwDbError(sortResult.error)
  const sortOrder = sortResult.data ? Number(sortResult.data.sort_order) + 1 : 0
  const storagePath = `${session.organizationId}/${facilityId}/${randomUUID()}.webp`

  const { error: uploadError } = await backendData.storage
    .from(facilityImageBucket)
    .upload(storagePath, processed.data, {
      cacheControl: '31536000',
      contentType: 'image/webp',
      upsert: false,
    })
  if (uploadError) {
    throw createError({
      statusCode: 500,
      statusMessage: uploadError.message || 'Image upload failed',
    })
  }

  const originalFilename = String(image.filename).trim().slice(0, 255) || 'facility-image'
  const insertResult = await backendData
    .from('facility_images')
    .insert({
      organization_id: session.organizationId,
      facility_id: facilityId,
      storage_bucket: facilityImageBucket,
      storage_path: storagePath,
      original_filename: originalFilename,
      mime_type: 'image/webp',
      size_bytes: processed.data.length,
      sha256,
      width_px: processed.info.width,
      height_px: processed.info.height,
      sort_order: sortOrder,
      alt_text: `${String(access.facility.name)} — zdjęcie placówki`,
      uploaded_by: session.userId,
    })
    .select(facilityImagePublicSelect)
    .single()

  if (insertResult.error || !insertResult.data) {
    const { error: cleanupError } = await backendData.storage
      .from(facilityImageBucket)
      .remove([storagePath])
    if (cleanupError) {
      console.error('[facility-images] failed to clean up image', {
        storagePath,
        message: cleanupError.message,
      })
    }
    throwDbError(insertResult.error)
  }

  const signedResult = await backendData.storage
    .from(facilityImageBucket)
    .createSignedUrl(storagePath, 60 * 60)

  return {
    data: {
      ...insertResult.data,
      url: signedResult.data?.signedUrl ?? null,
    },
  }
})
