import { randomUUID } from 'node:crypto'
import type { H3Event } from 'h3'
import { serverDataBackend } from './data-api'
import { throwDbError } from './crm'
import {
  crmDocumentStorageCleanupBucket,
  executeCrmDocumentStorageCleanupClaim,
  parseCrmDocumentStorageCleanupClaim,
  type CrmDocumentStorageCleanupClaim,
  type CrmDocumentStorageCleanupResult,
} from './crm-document-storage-cleanup-core'

interface CleanupIdentity {
  id: string
  status: string
}

interface CleanupLookup extends CleanupIdentity {
  submissionId: string | null
}

function firstRow(input: unknown): Record<string, unknown> | null {
  if (!Array.isArray(input) || !input.length) return null
  const row = input[0]
  return row && typeof row === 'object' && !Array.isArray(row)
    ? row as Record<string, unknown>
    : null
}

function identity(input: unknown): CleanupIdentity {
  const row = firstRow(input)
  const id = typeof row?.id === 'string' ? row.id : ''
  const status = typeof row?.status === 'string' ? row.status : ''
  if (!id || !status) throw new Error('Document cleanup identity contract is invalid')
  return { id, status }
}

export async function reserveCrmDocumentStorageCleanup(
  backend: any,
  input: {
    organizationId: string
    caseId: string
    applicationId: string
    storagePath: string
  },
): Promise<CleanupIdentity> {
  const result = await backend.rpc('reserve_crm_document_storage_cleanup', {
    p_organization_id: input.organizationId,
    p_case_id: input.caseId,
    p_submission_id: input.applicationId,
    p_storage_bucket: crmDocumentStorageCleanupBucket,
    p_storage_path: input.storagePath,
    p_reservation_ttl: '30 minutes',
  })
  throwDbError(result.error)
  return identity(result.data)
}

export async function activateCrmDocumentStorageCleanup(
  backend: any,
  cleanupId: string,
): Promise<CleanupIdentity> {
  const result = await backend.rpc('activate_crm_document_storage_cleanup', {
    p_id: cleanupId,
  })
  throwDbError(result.error)
  return identity(result.data)
}

export async function retainCrmDocumentStorageCleanup(
  backend: any,
  cleanupId: string,
  documentId: string,
): Promise<void> {
  const result = await backend.rpc('retain_crm_document_storage_cleanup', {
    p_id: cleanupId,
    p_document_id: documentId,
  })
  throwDbError(result.error)
  const retained = identity(result.data)
  if (retained.status !== 'retained') {
    throw new Error('Document cleanup retention contract is invalid')
  }
}

export async function getCrmDocumentStorageCleanupByDocument(
  backend: any,
  input: { organizationId: string, caseId: string, documentId: string },
): Promise<CleanupLookup | null> {
  const result = await backend.rpc('get_crm_document_storage_cleanup_by_document', {
    p_organization_id: input.organizationId,
    p_case_id: input.caseId,
    p_document_id: input.documentId,
  })
  throwDbError(result.error)
  const row = firstRow(result.data)
  if (!row) return null
  const id = typeof row.id === 'string' ? row.id : ''
  const status = typeof row.status === 'string' ? row.status : ''
  const rawSubmissionId = row.submission_id ?? row.submissionId
  const submissionId = rawSubmissionId === null || rawSubmissionId === undefined
    ? null
    : String(rawSubmissionId)
  if (!id || !status) throw new Error('Document cleanup lookup contract is invalid')
  return { id, status, submissionId }
}

async function processClaimedCrmDocumentStorageCleanup(
  backend: any,
  workerId: string,
  claim: CrmDocumentStorageCleanupClaim,
): Promise<CrmDocumentStorageCleanupResult> {
  return executeCrmDocumentStorageCleanupClaim(claim, {
    async prepare() {
      const result = await backend.rpc('prepare_crm_document_storage_cleanup', {
        p_id: claim.id,
        p_worker_id: workerId,
      })
      throwDbError(result.error)
      return result.data
    },
    remove(bucket, path) {
      return backend.storage.from(bucket).remove([path])
    },
    async complete(input) {
      const result = await backend.rpc('complete_crm_document_storage_cleanup', {
        p_id: claim.id,
        p_worker_id: workerId,
        p_succeeded: input.succeeded,
        p_error: input.error,
        p_retry_delay: `${input.retryDelaySeconds} seconds`,
      })
      throwDbError(result.error)
      return identity(result.data)
    },
  })
}

export async function processCrmDocumentStorageCleanupNow(
  backend: any,
  cleanupId: string,
): Promise<CrmDocumentStorageCleanupResult> {
  const workerId = `crm-document-cleanup-immediate:${randomUUID()}`
  const claimResult = await backend.rpc('claim_crm_document_storage_cleanup', {
    p_id: cleanupId,
    p_worker_id: workerId,
    p_lock_timeout: '5 minutes',
  })
  throwDbError(claimResult.error)
  const row = firstRow(claimResult.data)
  if (!row) return { state: 'processing' }
  return processClaimedCrmDocumentStorageCleanup(
    backend,
    workerId,
    parseCrmDocumentStorageCleanupClaim(row),
  )
}

export async function activateAndProcessCrmDocumentStorageCleanup(
  backend: any,
  cleanupId: string,
): Promise<CrmDocumentStorageCleanupResult> {
  const activated = await activateCrmDocumentStorageCleanup(backend, cleanupId)
  if (activated.status === 'completed') return { state: 'completed' }
  if (activated.status === 'retained') return { state: 'retained' }
  return processCrmDocumentStorageCleanupNow(backend, cleanupId)
}

export async function drainCrmDocumentStorageCleanups(
  event: H3Event,
  workerId: string,
  limit: number,
) {
  const boundedLimit = Math.min(25, Math.max(1, Math.trunc(limit)))
  const backend = serverDataBackend(event) as any
  const claimResult = await backend.rpc('claim_crm_document_storage_cleanups', {
    p_worker_id: workerId,
    p_limit: boundedLimit,
    p_lock_timeout: '5 minutes',
  })
  throwDbError(claimResult.error)
  if (!Array.isArray(claimResult.data)) {
    throw new Error('Document cleanup claim contract is invalid')
  }
  const claims: CrmDocumentStorageCleanupClaim[] = (claimResult.data as unknown[])
    .map(parseCrmDocumentStorageCleanupClaim)
  const results: CrmDocumentStorageCleanupResult[] = []
  for (let offset = 0; offset < claims.length; offset += 4) {
    results.push(...await Promise.all(
      claims.slice(offset, offset + 4)
        .map(claim => processClaimedCrmDocumentStorageCleanup(backend, workerId, claim)),
    ))
  }
  return results.reduce((totals, result) => ({
    claimed: totals.claimed,
    completed: totals.completed + (result.state === 'completed' ? 1 : 0),
    retained: totals.retained + (result.state === 'retained' ? 1 : 0),
    failed: totals.failed + (result.state === 'failed' ? 1 : 0),
    pending: totals.pending + (result.state === 'processing' ? 1 : 0),
  }), {
    claimed: claims.length,
    completed: 0,
    retained: 0,
    failed: 0,
    pending: 0,
  })
}
