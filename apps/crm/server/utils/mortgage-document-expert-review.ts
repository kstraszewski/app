import { createHash } from 'node:crypto'
import { createError } from 'h3'

export const mortgageDocumentExpertOverrideMinLength = 20
export const mortgageDocumentExpertOverrideMaxLength = 1_000
export const mortgageDocumentExpertReviewMetadataKey = 'mortgageDocumentExpertReview'

const disallowedControlCharacters = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u
const sha256Pattern = /^[0-9a-f]{64}$/u

export function mortgageDocumentExpertOverrideReasonSha256(reason: string): string {
  return createHash('sha256').update(reason, 'utf8').digest('hex')
}

export function normalizeMortgageDocumentExpertOverrideReason(
  input: string | undefined,
  allowed: boolean,
): string | null {
  if (!input) return null
  if (!allowed) {
    throw createError({
      statusCode: 400,
      statusMessage: 'expertOverrideReason is supported only for ESIS and credit decisions',
    })
  }

  const reason = input.replace(/\r\n?/gu, '\n').trim()
  if (reason.length < mortgageDocumentExpertOverrideMinLength) {
    throw createError({
      statusCode: 400,
      statusMessage: `Uzasadnienie ręcznej weryfikacji musi mieć co najmniej ${mortgageDocumentExpertOverrideMinLength} znaków.`,
    })
  }
  if (reason.length > mortgageDocumentExpertOverrideMaxLength) {
    throw createError({
      statusCode: 400,
      statusMessage: `Uzasadnienie ręcznej weryfikacji nie może przekraczać ${mortgageDocumentExpertOverrideMaxLength} znaków.`,
    })
  }
  if (disallowedControlCharacters.test(reason)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Uzasadnienie ręcznej weryfikacji zawiera niedozwolone znaki sterujące.',
    })
  }
  return reason
}

export function withMortgageDocumentExpertReviewMetadata(
  artifact: Record<string, unknown>,
  expertOverrideReason: string | null,
): Record<string, unknown> {
  const metadata = artifact.metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw createError({ statusCode: 400, statusMessage: 'artifact.metadata must be a JSON object' })
  }
  const normalizedMetadata = metadata as Record<string, unknown>
  if (Object.hasOwn(normalizedMetadata, mortgageDocumentExpertReviewMetadataKey)) {
    throw createError({
      statusCode: 400,
      statusMessage: `artifact.metadata.${mortgageDocumentExpertReviewMetadataKey} is server-controlled`,
    })
  }

  return {
    ...artifact,
    metadata: {
      ...normalizedMetadata,
      ...(expertOverrideReason
        ? {
            [mortgageDocumentExpertReviewMetadataKey]: {
              overrideReasonSha256: mortgageDocumentExpertOverrideReasonSha256(expertOverrideReason),
            },
          }
        : {}),
    },
  }
}

export function withoutMortgageDocumentExpertReviewMetadata(
  artifact: Record<string, unknown>,
): {
  artifact: Record<string, unknown>
  overrideReasonSha256: string | null
} {
  const metadata = artifact.metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw createError({ statusCode: 409, statusMessage: 'Prior artifact metadata is invalid' })
  }
  const normalizedMetadata = metadata as Record<string, unknown>
  const expertReview = normalizedMetadata[mortgageDocumentExpertReviewMetadataKey]
  if (expertReview === undefined) {
    return { artifact, overrideReasonSha256: null }
  }
  if (!expertReview || typeof expertReview !== 'object' || Array.isArray(expertReview)) {
    throw createError({ statusCode: 409, statusMessage: 'Prior expert review metadata is invalid' })
  }
  const expertReviewRecord = expertReview as Record<string, unknown>
  if (Object.keys(expertReviewRecord).length !== 1
    || typeof expertReviewRecord.overrideReasonSha256 !== 'string'
    || !sha256Pattern.test(expertReviewRecord.overrideReasonSha256)) {
    throw createError({ statusCode: 409, statusMessage: 'Prior expert review metadata is invalid' })
  }

  const metadataWithoutExpertReview = { ...normalizedMetadata }
  delete metadataWithoutExpertReview[mortgageDocumentExpertReviewMetadataKey]
  return {
    artifact: {
      ...artifact,
      metadata: metadataWithoutExpertReview,
    },
    overrideReasonSha256: expertReviewRecord.overrideReasonSha256,
  }
}
