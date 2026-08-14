const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const crmDocumentStorageCleanupBucket = 'crm-case-documents'
export const crmDocumentStorageCleanupFailureCode = 'crm_document_storage_delete_failed'

export interface CrmDocumentStorageCleanupClaim {
  id: string
  organizationId: string
  caseId: string
  documentId: string | null
  storageBucket: typeof crmDocumentStorageCleanupBucket
  storagePath: string
  attempts: number
}

export interface CrmDocumentStorageCleanupPreparation {
  id: string
  action: 'delete_blob' | 'retained'
  documentId: string | null
  storageBucket: typeof crmDocumentStorageCleanupBucket | null
  storagePath: string | null
}

export interface CrmDocumentStorageCleanupResult {
  state: 'completed' | 'failed' | 'retained' | 'processing'
}

export interface CrmDocumentStorageCleanupOperations {
  prepare: () => Promise<unknown>
  remove: (bucket: string, path: string) => Promise<{ error?: unknown }>
  complete: (input: {
    succeeded: boolean
    error: string | null
    retryDelaySeconds: number
  }) => Promise<{ status: string }>
}

function record(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
}

function uuid(input: unknown, field: string): string {
  const value = typeof input === 'string' ? input.toLowerCase() : ''
  if (!uuidPattern.test(value)) throw new Error(`Invalid cleanup ${field}`)
  return value
}

function optionalUuid(input: unknown, field: string): string | null {
  return input === null || input === undefined ? null : uuid(input, field)
}

function pathForScope(input: unknown, organizationId: string, caseId: string): string {
  const value = typeof input === 'string' ? input : ''
  const prefix = `${organizationId}/${caseId}/`
  const segments = value.split('/')
  if (
    !value.startsWith(prefix)
    || value.length <= prefix.length
    || value.length > 1024
    || value.includes('\\')
    || value.includes('\0')
    || /[\u0000-\u001f\u007f]/u.test(value)
    || segments.some(segment => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error('Invalid cleanup storagePath')
  }
  return value
}

export function parseCrmDocumentStorageCleanupClaim(
  input: unknown,
): CrmDocumentStorageCleanupClaim {
  const row = record(input)
  const id = uuid(row.id, 'id')
  const organizationId = uuid(
    row.organization_id ?? row.organizationId,
    'organizationId',
  )
  const caseId = uuid(row.case_id ?? row.caseId, 'caseId')
  const documentId = optionalUuid(row.document_id ?? row.documentId, 'documentId')
  const storageBucket = row.storage_bucket ?? row.storageBucket
  if (storageBucket !== crmDocumentStorageCleanupBucket) {
    throw new Error('Invalid cleanup storageBucket')
  }
  const attempts = Number(row.attempts)
  if (!Number.isSafeInteger(attempts) || attempts < 1) {
    throw new Error('Invalid cleanup attempts')
  }
  return {
    id,
    organizationId,
    caseId,
    documentId,
    storageBucket,
    storagePath: pathForScope(
      row.storage_path ?? row.storagePath,
      organizationId,
      caseId,
    ),
    attempts,
  }
}

export function parseCrmDocumentStorageCleanupPreparation(
  input: unknown,
  claim: CrmDocumentStorageCleanupClaim,
): CrmDocumentStorageCleanupPreparation {
  const payload = record(input)
  const id = uuid(payload.id, 'preparation id')
  if (id !== claim.id) throw new Error('Cleanup preparation id mismatch')
  if (payload.action === 'retained') {
    return {
      id,
      action: 'retained',
      documentId: uuid(payload.documentId ?? payload.document_id, 'retained documentId'),
      storageBucket: null,
      storagePath: null,
    }
  }
  if (payload.action !== 'delete_blob') {
    throw new Error('Invalid cleanup preparation action')
  }
  const storageBucket = payload.storageBucket ?? payload.storage_bucket
  if (storageBucket !== claim.storageBucket) {
    throw new Error('Cleanup preparation bucket mismatch')
  }
  const storagePath = pathForScope(
    payload.storagePath ?? payload.storage_path,
    claim.organizationId,
    claim.caseId,
  )
  if (storagePath !== claim.storagePath) {
    throw new Error('Cleanup preparation path mismatch')
  }
  return {
    id,
    action: 'delete_blob',
    documentId: claim.documentId,
    storageBucket,
    storagePath,
  }
}

export function crmDocumentStorageCleanupRetryDelaySeconds(attempts: number): number {
  const normalizedAttempts = Number.isSafeInteger(attempts) && attempts > 0
    ? attempts
    : 1
  const exponent = Math.min(normalizedAttempts - 1, 11)
  return Math.min(24 * 60 * 60, 30 * (2 ** exponent))
}

export async function executeCrmDocumentStorageCleanupClaim(
  claim: CrmDocumentStorageCleanupClaim,
  operations: CrmDocumentStorageCleanupOperations,
): Promise<CrmDocumentStorageCleanupResult> {
  try {
    const preparation = parseCrmDocumentStorageCleanupPreparation(
      await operations.prepare(),
      claim,
    )
    if (preparation.action === 'retained') return { state: 'retained' }

    const removal = await operations.remove(
      preparation.storageBucket!,
      preparation.storagePath!,
    )
    if (removal.error) throw new Error(crmDocumentStorageCleanupFailureCode)

    const completion = await operations.complete({
      succeeded: true,
      error: null,
      retryDelaySeconds: 30,
    })
    if (completion.status === 'completed') return { state: 'completed' }
    if (completion.status === 'pending') return { state: 'processing' }
    throw new Error('Invalid successful cleanup completion status')
  }
  catch {
    try {
      await operations.complete({
        succeeded: false,
        error: crmDocumentStorageCleanupFailureCode,
        retryDelaySeconds: crmDocumentStorageCleanupRetryDelaySeconds(claim.attempts),
      })
    }
    catch {
      // A missing completion acknowledgement leaves the database lease as the
      // durable retry mechanism; callers still receive a conservative failure.
    }
    return { state: 'failed' }
  }
}
