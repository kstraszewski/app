import { createHash } from 'node:crypto'
import {
  CANONICAL_COLLECTIONS,
  CANONICAL_FIELDS,
  getTemplateBySourceSha256,
  type CanonicalFieldKey,
} from '@openexpert/multiform'
import {
  createError,
  getRequestHeader,
  getRequestIP,
  readMultipartFormData,
  setResponseHeader,
  type H3Event,
} from 'h3'
import {
  generateTemplateDraft,
  MultiformPdfInputError,
  TEMPLATE_GENERATOR_MODEL,
} from '../../../utils/multiform-template-generator'
import { toUiField } from '../../../utils/multiform-api'

const maxPdfBytes = 15 * 1024 * 1024
const maxRequestBytes = 16 * 1024 * 1024
const maxPdfFiles = 5
const rateLimitCount = 5
const rateLimitWindowMs = 60 * 60 * 1000
const maxRateLimitBuckets = 10_000

interface RateLimitBucket {
  count: number
  windowStartedAt: number
}

const rateLimitBuckets = new Map<string, RateLimitBucket>()
let lastRateLimitSweep = 0

function sweepExpiredRateLimits(now: number) {
  if (now - lastRateLimitSweep < 60_000 && rateLimitBuckets.size < maxRateLimitBuckets) return

  for (const [key, bucket] of rateLimitBuckets) {
    if (now - bucket.windowStartedAt >= rateLimitWindowMs) rateLimitBuckets.delete(key)
  }
  lastRateLimitSweep = now

  while (rateLimitBuckets.size >= maxRateLimitBuckets) {
    const oldestKey = rateLimitBuckets.keys().next().value
    if (typeof oldestKey !== 'string') break
    rateLimitBuckets.delete(oldestKey)
  }
}

function consumeRateLimit(event: H3Event) {
  const now = Date.now()
  sweepExpiredRateLimits(now)

  const clientAddress = getRequestIP(event, { xForwardedFor: true }) || 'unknown'
  const key = createHash('sha256').update(clientAddress).digest('hex')
  const existing = rateLimitBuckets.get(key)
  const bucket = !existing || now - existing.windowStartedAt >= rateLimitWindowMs
    ? { count: 0, windowStartedAt: now }
    : existing

  if (bucket.count >= rateLimitCount) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((bucket.windowStartedAt + rateLimitWindowMs - now) / 1000),
    )
    setResponseHeader(event, 'Retry-After', retryAfterSeconds)
    throw createError({
      statusCode: 429,
      statusMessage: 'Limit generatora to 5 analiz na godzinę. Spróbuj ponownie później.',
    })
  }

  bucket.count += 1
  rateLimitBuckets.set(key, bucket)
}

function assertRequestSize(event: H3Event) {
  const contentLength = Number(getRequestHeader(event, 'content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxRequestBytes) {
    throw createError({
      statusCode: 413,
      statusMessage: 'Żądanie może mieć maksymalnie 16 MB.',
    })
  }
}

function hasPdfSignature(data: Uint8Array) {
  const prefix = data.subarray(0, Math.min(data.length, 1024))
  for (let index = 0; index <= prefix.length - 5; index += 1) {
    if (
      prefix[index] === 0x25
      && prefix[index + 1] === 0x50
      && prefix[index + 2] === 0x44
      && prefix[index + 3] === 0x46
      && prefix[index + 4] === 0x2D
    ) return true
  }
  return false
}

export default defineEventHandler(async (event) => {
  assertRequestSize(event)
  consumeRateLimit(event)

  const parts = await readMultipartFormData(event)
  const uploadedFiles = parts?.filter(part => (
    (part.name === 'file' || part.name === 'files') && part.filename
  )) ?? []

  if (uploadedFiles.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Dodaj co najmniej jeden plik PDF.' })
  }
  if (uploadedFiles.length > maxPdfFiles) {
    throw createError({ statusCode: 413, statusMessage: `Możesz przeanalizować maksymalnie ${maxPdfFiles} PDF-ów naraz.` })
  }

  const uniqueFiles = [...new Map(uploadedFiles.map(file => (
    [createHash('sha256').update(file.data).digest('hex'), file]
  ))).values()]

  for (const file of uniqueFiles) {
    if (!file.filename || !file.data?.length) {
      throw createError({ statusCode: 400, statusMessage: 'Każdy PDF musi zawierać dane.' })
    }
    if (file.data.length > maxPdfBytes) {
      throw createError({ statusCode: 413, statusMessage: `Plik ${file.filename} przekracza limit 15 MB.` })
    }
    if (file.type !== 'application/pdf' && !file.filename.toLowerCase().endsWith('.pdf')) {
      throw createError({ statusCode: 415, statusMessage: `Plik ${file.filename} nie jest PDF-em.` })
    }
    if (!hasPdfSignature(file.data)) {
      throw createError({ statusCode: 415, statusMessage: `Plik ${file.filename} nie ma prawidłowej sygnatury PDF.` })
    }
  }

  try {
    const templates = await Promise.all(uniqueFiles.map((file) => {
      const safeFileName = file.filename!
        .replace(/[\u0000-\u001F\u007F]/g, '_')
        .slice(0, 180)
      return generateTemplateDraft(safeFileName, new Uint8Array(file.data))
    }))

    const fieldUsage = new Map<CanonicalFieldKey, Set<string>>()
    const mappedFieldUsage = new Map<CanonicalFieldKey, Set<string>>()
    for (const template of templates) {
      for (const binding of template.bindings) {
        const key = binding.canonicalKey as CanonicalFieldKey
        const usedBy = fieldUsage.get(key) ?? new Set<string>()
        usedBy.add(template.id)
        fieldUsage.set(key, usedBy)

        if (binding.target.kind !== 'unmapped') {
          const mappedBy = mappedFieldUsage.get(key) ?? new Set<string>()
          mappedBy.add(template.id)
          mappedFieldUsage.set(key, mappedBy)
        }
      }
    }

    const canonicalFormFields = CANONICAL_FIELDS
      .filter(field => fieldUsage.has(field.canonicalKey))
      .map(field => ({
        ...toUiField(field),
        templateIds: [...(fieldUsage.get(field.canonicalKey) ?? [])],
        mappedTemplateIds: [...(mappedFieldUsage.get(field.canonicalKey) ?? [])],
      }))
    const documentSpecificFields = templates.flatMap(template => template.documentSpecificFields)
    const fields = [...canonicalFormFields, ...documentSpecificFields]
    const bundleHash = createHash('sha256')
      .update(templates.map(template => template.source.sha256).sort().join(':'))
      .digest('hex')
      .slice(0, 12)
    const approvedTemplates = templates.map(template => (
      getTemplateBySourceSha256(template.source.sha256)
    ))
    const fillReadyTemplates = approvedTemplates.filter(template => (
      template
      && template.coverage.status === 'complete'
      && template.coverage.mappedTargetCount === template.coverage.inScopeTargetCount
    ))
    const approvedTemplateIds = fillReadyTemplates.flatMap(template => (
      template ? [template.id] : []
    ))
    const canFillWithReviewedMappings = fillReadyTemplates.length === templates.length

    return {
      schemaVersion: 1,
      id: `multiform-bundle-${bundleHash}`,
      status: 'draft' as const,
      templates,
      form: {
        id: `shared-form-${bundleHash}`,
        label: 'Wspólny formularz danych klienta',
        fields,
        collections: CANONICAL_COLLECTIONS
          .filter(collection => canonicalFormFields.some(field => field.collection?.key === collection.key))
          .map(collection => ({
            ...collection,
            requiredRelativeKeys: [...collection.requiredRelativeKeys],
          })),
        fieldCount: fields.length,
        requiredFieldCount: fields.filter(field => field.required).length,
        deduplicationKey: 'canonicalKey' as const,
      },
      generation: {
        model: TEMPLATE_GENERATOR_MODEL,
        generatedAt: new Date().toISOString(),
        documentCount: templates.length,
      },
      printExport: {
        canFill: canFillWithReviewedMappings,
        approvedTemplateIds,
        approvedDocumentCount: approvedTemplateIds.length,
        reviewRequiredDocumentCount: templates.length - approvedTemplateIds.length,
        sourceVerification: 'sha256' as const,
        message: canFillWithReviewedMappings
          ? 'Każdy PDF jest identyczny z dokumentem, którego pełny inwentarz, mapowanie i wydruk zostały ręcznie zweryfikowane.'
          : 'Co najmniej jeden PDF nie ma jeszcze pełnego, zatwierdzonego pokrycia. Eksport pozostaje zablokowany do czasu klasyfikacji każdego targetu i weryfikacji podglądu.',
      },
      warnings: [
        'Każdy template oraz wspólny formularz są draftem i wymagają zatwierdzenia mapowań przed nanoszeniem danych na PDF.',
        'Pole, którego AI nie potrafi bezpiecznie scalić, pozostaje osobnym polem dokumentu — żaden wykryty target AcroForm nie jest cicho pomijany.',
        ...(canFillWithReviewedMappings
          ? ['Do nanoszenia danych zostaną użyte ręcznie zweryfikowane mapowania rozpoznane po SHA-256, a nie draft AI.']
          : []),
      ],
    }
  }
  catch (error) {
    if (error instanceof MultiformPdfInputError) {
      throw createError({
        statusCode: error.statusCode,
        statusMessage: error.message,
      })
    }

    throw createError({
      statusCode: 502,
      statusMessage: 'Nie udało się przeanalizować PDF-u przez AI Gateway.',
    })
  }
})
