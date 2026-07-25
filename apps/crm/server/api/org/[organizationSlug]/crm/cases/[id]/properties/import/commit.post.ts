import { createHash, randomUUID } from 'node:crypto'
import { createError, readBody } from 'h3'
import sharp from 'sharp'
import { z } from 'zod'
import {
  attachSignedPropertyImages,
  propertyImageBucket,
  propertyImagePublicSelect,
  propertyPublicSelect,
  selectCasePropertyIfNone,
} from '~~/server/utils/case-properties'
import { caseUuidPattern } from '~~/server/utils/case-identifiers'
import {
  getRequiredParam,
  recordCrmActivity,
  requireCrmSession,
  throwDbError,
} from '~~/server/utils/crm'
import { propertyImportModel } from '~~/server/utils/property-import'
import {
  assertPublicWebUrl,
  downloadPropertyImage,
  parsePublicHttpUrl,
  PROPERTY_IMAGE_BYTE_LIMIT,
} from '~~/server/utils/public-web-content'

const MAX_IMAGES = 8
const MAX_TOTAL_SOURCE_BYTES = 40 * 1024 * 1024

const nullableText = (maximum: number) => z.string().trim().max(maximum).nullable()
const nullablePositive = z.preprocess(
  value => value === 0 || value === '' ? null : value,
  z.number().finite().positive().nullable(),
)
const nullableNonNegative = z.number().finite().nonnegative().nullable()

const commitSchema = z.object({
  propertyId: z.string().uuid().nullable().optional(),
  previewId: z.string().uuid(),
  sourceUrl: z.string().trim().url().max(4096),
  retrievedUrl: z.string().trim().url().max(4096).nullable().optional(),
  extractedAt: z.string().datetime({ offset: true }),
  listingTitle: nullableText(500),
  description: nullableText(50_000),
  address: z.string().trim().min(1).max(500),
  city: nullableText(160),
  postalCode: nullableText(32),
  propertyType: z.enum(['apartment', 'house', 'plot', 'commercial', 'other']).nullable(),
  marketType: z.enum(['primary', 'secondary', 'rental', 'other']).nullable(),
  priceAmount: nullableNonNegative,
  currency: z.string().trim().regex(/^[A-Z]{3}$/u),
  areaM2: nullablePositive,
  rooms: nullablePositive,
  floor: z.number().finite().nullable(),
  buildingFloors: nullablePositive,
  yearBuilt: z.number().int().min(1700).max(2200).nullable(),
  landAreaM2: nullablePositive,
  monthlyFees: nullableNonNegative,
  ownership: nullableText(200),
  condition: nullableText(200),
  heating: nullableText(200),
  externalId: nullableText(200),
  sourcePublishedAt: nullableText(80),
  pricePerM2: nullableNonNegative,
  features: z.array(z.string().trim().min(1).max(200)).max(40),
  confidence: z.number().finite().min(0).max(1),
  warnings: z.array(z.string().trim().min(1).max(500)).max(20),
  images: z.array(z.object({
    url: z.string().trim().url().max(4096),
    alt: nullableText(500).optional(),
  })).max(MAX_IMAGES),
  import: z.object({
    provider: z.enum(['google-generative-ai', 'vercel-ai-gateway']),
    urlContextStatus: nullableText(200).optional(),
    citations: z.array(z.object({
      url: z.string().trim().url().max(4096),
      title: nullableText(500).optional(),
    })).max(20),
  }),
})

function parsedPublishedAt(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function clientError(error: z.ZodError) {
  const issue = error.issues[0]
  return createError({
    statusCode: 400,
    statusMessage: issue?.path.length
      ? `Niepoprawna wartość pola ${issue.path.join('.')}: ${issue.message}`
      : issue?.message ?? 'Niepoprawne dane nieruchomości.',
  })
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const caseId = getRequiredParam(event, 'id')
  if (!caseUuidPattern.test(caseId)) {
    throw createError({ statusCode: 404, statusMessage: 'Case not found' })
  }

  const { data: caseRow, error: caseError } = await session.supabase
    .from('crm_cases')
    .select('id, client_id')
    .eq('organization_id', session.organizationId)
    .eq('id', caseId)
    .maybeSingle()
  throwDbError(caseError)
  if (!caseRow) throw createError({ statusCode: 404, statusMessage: 'Case not found' })

  const parsed = commitSchema.safeParse(await readBody(event))
  if (!parsed.success) throw clientError(parsed.error)
  const body = parsed.data
  const sourceUrl = (await assertPublicWebUrl(body.sourceUrl)).href
  const retrievedUrl = body.retrievedUrl
    ? parsePublicHttpUrl(body.retrievedUrl).href
    : sourceUrl
  const importedAt = new Date().toISOString()
  const propertyId = body.propertyId ?? randomUUID()

  let previousMetadata: Record<string, unknown> = {}
  if (body.propertyId) {
    const { data: existingProperty, error: existingError } = await session.supabase
      .from('crm_properties')
      .select('id, metadata')
      .eq('organization_id', session.organizationId)
      .eq('case_id', caseId)
      .eq('id', body.propertyId)
      .maybeSingle()
    throwDbError(existingError)
    if (!existingProperty) throw createError({ statusCode: 404, statusMessage: 'Property not found' })
    if (existingProperty.metadata && typeof existingProperty.metadata === 'object' && !Array.isArray(existingProperty.metadata)) {
      previousMetadata = existingProperty.metadata as Record<string, unknown>
    }
  }

  const sourceHost = new URL(sourceUrl).hostname
  const metadata = {
    ...previousMetadata,
    import: {
      schemaVersion: 1,
      previewId: body.previewId,
      provider: body.import.provider,
      model: propertyImportModel,
      extractedAt: body.extractedAt,
      importedAt,
      sourceHost,
      canonicalUrl: retrievedUrl,
      urlContextStatus: body.import.urlContextStatus ?? null,
      confidence: body.confidence,
      warnings: body.warnings,
      citations: body.import.citations,
    },
    listing: {
      externalId: body.externalId,
      pricePerM2: body.pricePerM2,
      floor: body.floor,
      buildingFloors: body.buildingFloors,
      yearBuilt: body.yearBuilt,
      landAreaM2: body.landAreaM2,
      monthlyFees: body.monthlyFees,
      ownership: body.ownership,
      condition: body.condition,
      heating: body.heating,
      features: body.features,
    },
  }

  const propertyValues = {
    organization_id: session.organizationId,
    case_id: caseId,
    case_item_id: null,
    address: body.address,
    city: body.city,
    postal_code: body.postalCode,
    property_type: body.propertyType,
    market_type: body.marketType,
    price_amount: body.priceAmount,
    currency: body.currency,
    area_m2: body.areaM2,
    rooms: body.rooms,
    listing_title: body.listingTitle,
    description: body.description,
    source_url: sourceUrl,
    source_published_at: parsedPublishedAt(body.sourcePublishedAt),
    imported_at: importedAt,
    metadata,
  }

  const propertyResult = body.propertyId
    ? await session.supabase
        .from('crm_properties')
        .update(propertyValues)
        .eq('organization_id', session.organizationId)
        .eq('case_id', caseId)
        .eq('id', propertyId)
        .select(propertyPublicSelect)
        .single()
    : await session.supabase
        .from('crm_properties')
        .insert({ id: propertyId, ...propertyValues })
        .select(propertyPublicSelect)
        .single()
  throwDbError(propertyResult.error)
  const property = propertyResult.data
  if (!body.propertyId) {
    await selectCasePropertyIfNone(session, caseId, propertyId, importedAt)
  }

  const { data: existingImages, error: existingImagesError } = await session.supabase
    .from('crm_property_images')
    .select('sha256, sort_order')
    .eq('organization_id', session.organizationId)
    .eq('case_id', caseId)
    .eq('property_id', propertyId)
    .order('sort_order', { ascending: false })
  throwDbError(existingImagesError)
  const knownHashes = new Set((existingImages ?? []).map((image: { sha256: string }) => String(image.sha256)))
  let nextSortOrder = Number(existingImages?.[0]?.sort_order ?? -1) + 1
  let totalSourceBytes = 0
  const imageWarnings: string[] = []
  const savedImages: Array<Record<string, unknown>> = []

  for (const requestedImage of body.images) {
    try {
      const downloaded = await downloadPropertyImage(requestedImage.url)
      totalSourceBytes += downloaded.data.length
      if (totalSourceBytes > MAX_TOTAL_SOURCE_BYTES) {
        imageWarnings.push('Pominięto część zdjęć po osiągnięciu łącznego limitu 40 MiB.')
        break
      }

      const processed = await sharp(downloaded.data, {
        failOn: 'error',
        limitInputPixels: 50_000_000,
      })
        .rotate()
        .resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 86, effort: 4 })
        .toBuffer({ resolveWithObject: true })
      if (!processed.data.length || processed.data.length > PROPERTY_IMAGE_BYTE_LIMIT) {
        throw new Error('Zdjęcie po przetworzeniu przekracza limit 8 MiB.')
      }
      const imageWidth = processed.info.width
      const imageHeight = processed.info.height
      const imageRatio = imageWidth / imageHeight
      if (Math.min(imageWidth, imageHeight) < 240
        || imageWidth * imageHeight < 250_000
        || imageRatio < 0.2
        || imageRatio > 5) {
        throw new Error('Plik jest zbyt mały lub ma proporcje typowe dla ikony albo logo.')
      }

      const sha256 = createHash('sha256').update(processed.data).digest('hex')
      if (knownHashes.has(sha256)) continue
      const storagePath = `${session.organizationId}/${caseId}/${propertyId}/${randomUUID()}.webp`
      const { error: uploadError } = await session.supabase.storage
        .from(propertyImageBucket)
        .upload(storagePath, processed.data, {
          contentType: 'image/webp',
          cacheControl: '31536000',
          upsert: false,
        })
      if (uploadError) throw new Error(uploadError.message || 'Nie udało się zapisać zdjęcia.')

      const { data: imageRow, error: imageError } = await session.supabase
        .from('crm_property_images')
        .insert({
          organization_id: session.organizationId,
          case_id: caseId,
          property_id: propertyId,
          storage_bucket: propertyImageBucket,
          storage_path: storagePath,
          source_url: downloaded.finalUrl,
          mime_type: 'image/webp',
          size_bytes: processed.data.length,
          sha256,
          width_px: imageWidth,
          height_px: imageHeight,
          sort_order: nextSortOrder,
          alt_text: requestedImage.alt ?? body.listingTitle,
          metadata: { originalUrl: requestedImage.url },
        })
        .select(propertyImagePublicSelect)
        .single()

      if (imageError || !imageRow) {
        const { error: cleanupError } = await session.supabase.storage
          .from(propertyImageBucket)
          .remove([storagePath])
        if (cleanupError) {
          console.error('[property-import] failed to clean up image', {
            storagePath,
            message: cleanupError.message,
          })
        }
        throw new Error(imageError?.message || 'Nie udało się zapisać metadanych zdjęcia.')
      }

      knownHashes.add(sha256)
      nextSortOrder += 1
      savedImages.push(imageRow)
    }
    catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Nieznany błąd zdjęcia.'
      imageWarnings.push(`Pominięto zdjęcie: ${message}`)
    }
  }

  await recordCrmActivity(session, {
    client_id: caseRow.client_id,
    case_id: caseId,
    activity_type: body.propertyId ? 'property_import_updated' : 'property_imported',
    title: body.propertyId ? 'Zaktualizowano nieruchomość z ogłoszenia' : 'Zaimportowano nieruchomość z ogłoszenia',
    body: body.address,
    payload: {
      property_id: propertyId,
      source_host: sourceHost,
      model: propertyImportModel,
      saved_image_count: savedImages.length,
    },
  })

  const [propertyWithImages] = await attachSignedPropertyImages(session, [property])
  return {
    data: propertyWithImages,
    warnings: imageWarnings,
  }
})
