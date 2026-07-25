import { randomUUID } from 'node:crypto'
import { serverSupabaseServiceRole } from '#supabase/server'
import { createError, getRouterParam, readMultipartFormData } from 'h3'
import sharp from 'sharp'
import { requireCrmSession, throwDbError } from '~~/server/utils/crm'
import {
  brandAssetBucket,
  defaultExpertBrandProfile,
  expertBrandProfileSelect,
  profileFromRow,
  profileToRow,
  type ExpertBrandProfileRow,
} from '~~/server/utils/brand'

const maxSourceBytes = 5 * 1024 * 1024
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const kind = getRouterParam(event, 'kind')
  if (kind !== 'portrait') {
    throw createError({ statusCode: 404, statusMessage: 'Expert profile asset type not found' })
  }

  const parts = await readMultipartFormData(event)
  const image = parts?.find(part => part.name === 'image' && part.filename)
  if (!image?.data?.length) {
    throw createError({ statusCode: 400, statusMessage: 'Image file is required' })
  }
  if (image.data.length > maxSourceBytes) {
    throw createError({ statusCode: 413, statusMessage: 'Image must not exceed 5 MB' })
  }
  if (!image.type || !allowedTypes.has(image.type)) {
    throw createError({ statusCode: 415, statusMessage: 'Image must be a PNG, JPEG or WebP file' })
  }

  let processed: Buffer
  try {
    const pipeline = sharp(image.data, {
      failOn: 'error',
      limitInputPixels: 40_000_000,
    }).rotate()
    processed = await pipeline
      .resize({ width: 1400, height: 1750, fit: 'cover', position: 'attention', withoutEnlargement: true })
      .webp({ quality: 86, effort: 4 })
      .toBuffer()
  } catch {
    throw createError({ statusCode: 415, statusMessage: 'File is not a valid supported image' })
  }

  const serviceRole = serverSupabaseServiceRole(event) as any
  const existingResult = await serviceRole
    .from('expert_brand_profiles')
    .select('portrait_path')
    .eq('organization_id', session.organizationId)
    .eq('user_id', session.userId)
    .maybeSingle()
  throwDbError(existingResult.error)

  const storagePath = `${session.organizationId}/${session.userId}/${kind}/${randomUUID()}.webp`
  const uploadResult = await serviceRole.storage
    .from(brandAssetBucket)
    .upload(storagePath, processed, {
      cacheControl: '31536000',
      contentType: 'image/webp',
      upsert: false,
    })
  if (uploadResult.error) {
    throw createError({ statusCode: 500, statusMessage: uploadResult.error.message || 'Brand asset upload failed' })
  }

  const result = await serviceRole
    .from('expert_brand_profiles')
    .upsert({
      organization_id: session.organizationId,
      user_id: session.userId,
      ...(existingResult.data ? {} : profileToRow(defaultExpertBrandProfile(session))),
      portrait_path: storagePath,
    }, { onConflict: 'organization_id,user_id' })
    .select(expertBrandProfileSelect)
    .single()

  if (result.error || !result.data) {
    await serviceRole.storage.from(brandAssetBucket).remove([storagePath])
    throwDbError(result.error)
  }

  const oldPath = existingResult.data?.portrait_path
  if (oldPath && oldPath !== storagePath) {
    const cleanup = await serviceRole.storage.from(brandAssetBucket).remove([oldPath])
    if (cleanup.error) console.warn('[brand] failed to remove replaced asset', cleanup.error.message)
  }

  return {
    data: profileFromRow(session, result.data as ExpertBrandProfileRow),
    updatedAt: result.data.updated_at,
  }
})
