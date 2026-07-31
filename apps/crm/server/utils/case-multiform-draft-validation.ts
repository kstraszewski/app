import { createHash } from 'node:crypto'
import { createError } from 'h3'

type JsonRecord = Record<string, unknown>

interface CaseMultiformSelectionIdentity {
  applicationIds: readonly string[]
  offerIds: readonly string[]
  templateIds: readonly string[]
}

export interface CaseMultiformDraftPutInput {
  selectionFingerprint: string
  revision: number
  activeStep: number
  intakeAnswers: JsonRecord
  formValues: JsonRecord
  collectionCounts: Record<string, number>
  selectedDocumentIds: string[]
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const selectionFingerprintPattern = /^[0-9a-f]{64}$/u
const allowedBodyKeys = new Set([
  'selectionFingerprint',
  'revision',
  'activeStep',
  'intakeAnswers',
  'formValues',
  'collectionCounts',
  'selectedDocumentIds',
])

const intakeAnswersMaxBytes = 128 * 1024
const formValuesMaxBytes = 1024 * 1024
const collectionCountsMaxBytes = 64 * 1024
const selectedDocumentIdsMaxItems = 250

function badRequest(statusMessage: string): never {
  throw createError({ statusCode: 400, statusMessage })
}

function asJsonRecord(
  value: unknown,
  field: string,
  maxBytes: number,
): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return badRequest(`${field} must be an object`)
  }
  const record = value as JsonRecord
  if (Buffer.byteLength(JSON.stringify(record), 'utf8') > maxBytes) {
    return badRequest(`${field} is too large`)
  }
  return record
}

function parseCollectionCounts(value: unknown): Record<string, number> {
  const record = asJsonRecord(value, 'collectionCounts', collectionCountsMaxBytes)
  if (Object.keys(record).length > 100) {
    return badRequest('collectionCounts has too many entries')
  }
  const counts: Record<string, number> = {}
  for (const [key, count] of Object.entries(record)) {
    if (!key.trim() || key.length > 200) {
      return badRequest('collectionCounts contains an invalid key')
    }
    if (!Number.isInteger(count) || (count as number) < 0 || (count as number) > 100) {
      return badRequest(`collectionCounts.${key} must be an integer between 0 and 100`)
    }
    counts[key] = count as number
  }
  return counts
}

function parseDocumentIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > selectedDocumentIdsMaxItems) {
    return badRequest(`selectedDocumentIds must contain at most ${selectedDocumentIdsMaxItems} UUIDs`)
  }
  const documentIds = value.map((documentId) => {
    if (typeof documentId !== 'string' || !uuidPattern.test(documentId)) {
      return badRequest('selectedDocumentIds contains an invalid UUID')
    }
    return documentId.toLowerCase()
  })
  if (new Set(documentIds).size !== documentIds.length) {
    return badRequest('selectedDocumentIds must not contain duplicates')
  }
  return documentIds
}

export function caseMultiformSelectionFingerprint(
  selection: CaseMultiformSelectionIdentity,
): string {
  return createHash('sha256')
    .update(JSON.stringify({
      applicationIds: [...selection.applicationIds].sort(),
      offerIds: [...selection.offerIds].sort(),
      templateIds: [...selection.templateIds].sort(),
    }))
    .digest('hex')
}

export function parseCaseMultiformDraftPutInput(value: unknown): CaseMultiformDraftPutInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return badRequest('Draft body must be an object')
  }
  const body = value as JsonRecord
  if (Object.keys(body).some(key => !allowedBodyKeys.has(key))) {
    return badRequest('Draft body contains unsupported fields')
  }
  if (
    typeof body.selectionFingerprint !== 'string'
    || !selectionFingerprintPattern.test(body.selectionFingerprint)
  ) {
    return badRequest('selectionFingerprint must be a lowercase SHA-256 digest')
  }
  if (!Number.isInteger(body.revision) || (body.revision as number) < 0 || (body.revision as number) >= 2_147_483_647) {
    return badRequest('revision must be a non-negative integer')
  }
  if (!Number.isInteger(body.activeStep) || (body.activeStep as number) < 1 || (body.activeStep as number) > 5) {
    return badRequest('activeStep must be an integer between 1 and 5')
  }
  return {
    selectionFingerprint: body.selectionFingerprint,
    revision: body.revision as number,
    activeStep: body.activeStep as number,
    intakeAnswers: asJsonRecord(body.intakeAnswers, 'intakeAnswers', intakeAnswersMaxBytes),
    formValues: asJsonRecord(body.formValues, 'formValues', formValuesMaxBytes),
    collectionCounts: parseCollectionCounts(body.collectionCounts),
    selectedDocumentIds: parseDocumentIds(body.selectedDocumentIds),
  }
}
