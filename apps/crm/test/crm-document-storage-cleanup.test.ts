import assert from 'node:assert/strict'
import test from 'node:test'
import {
  crmDocumentStorageCleanupRetryDelaySeconds,
  executeCrmDocumentStorageCleanupClaim,
  parseCrmDocumentStorageCleanupClaim,
  parseCrmDocumentStorageCleanupPreparation,
} from '../server/utils/crm-document-storage-cleanup-core.ts'

const cleanupId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const caseId = '33333333-3333-4333-8333-333333333333'
const documentId = '44444444-4444-4444-8444-444444444444'
const storagePath = `${organizationId}/${caseId}/source.pdf`

function claim(overrides: Record<string, unknown> = {}) {
  return {
    id: cleanupId,
    organization_id: organizationId,
    case_id: caseId,
    document_id: documentId,
    storage_bucket: 'crm-case-documents',
    storage_path: storagePath,
    attempts: 1,
    ...overrides,
  }
}

test('accepts only a CRM document cleanup claim pinned to its exact object scope', () => {
  assert.deepEqual(parseCrmDocumentStorageCleanupClaim(claim()), {
    id: cleanupId,
    organizationId,
    caseId,
    documentId,
    storageBucket: 'crm-case-documents',
    storagePath,
    attempts: 1,
  })

  assert.throws(() => parseCrmDocumentStorageCleanupClaim(claim({ attempts: 0 })))
  assert.throws(() => parseCrmDocumentStorageCleanupClaim(claim({
    storage_bucket: 'public-assets',
  })))
  assert.throws(() => parseCrmDocumentStorageCleanupClaim(claim({
    storage_path: `${organizationId}/55555555-5555-4555-8555-555555555555/source.pdf`,
  })))
  assert.throws(() => parseCrmDocumentStorageCleanupClaim(claim({
    storage_path: `${organizationId}/${caseId}/folder\\source.pdf`,
  })))
  assert.throws(() => parseCrmDocumentStorageCleanupClaim(claim({
    storage_path: `${organizationId}/${caseId}/../source.pdf`,
  })))
})

test('requires preparation output to match the claimed bucket and path exactly', () => {
  const parsedClaim = parseCrmDocumentStorageCleanupClaim(claim())
  assert.deepEqual(parseCrmDocumentStorageCleanupPreparation({
    id: cleanupId,
    action: 'delete_blob',
    storageBucket: 'crm-case-documents',
    storagePath,
  }, parsedClaim), {
    id: cleanupId,
    action: 'delete_blob',
    documentId,
    storageBucket: 'crm-case-documents',
    storagePath,
  })

  assert.throws(() => parseCrmDocumentStorageCleanupPreparation({
    id: cleanupId,
    action: 'delete_blob',
    storageBucket: 'crm-case-documents',
    storagePath: `${organizationId}/${caseId}/another.pdf`,
  }, parsedClaim))
})

test('accepts a retained reconciliation only with a valid document id', () => {
  const parsedClaim = parseCrmDocumentStorageCleanupClaim(claim())
  assert.deepEqual(parseCrmDocumentStorageCleanupPreparation({
    id: cleanupId,
    action: 'retained',
    documentId,
  }, parsedClaim), {
    id: cleanupId,
    action: 'retained',
    documentId,
    storageBucket: null,
    storagePath: null,
  })
  assert.throws(() => parseCrmDocumentStorageCleanupPreparation({
    id: cleanupId,
    action: 'retained',
    documentId: 'not-a-uuid',
  }, parsedClaim))
})

test('uses bounded exponential retry delays without exhausting deletion attempts', () => {
  assert.equal(crmDocumentStorageCleanupRetryDelaySeconds(1), 30)
  assert.equal(crmDocumentStorageCleanupRetryDelaySeconds(2), 60)
  assert.equal(crmDocumentStorageCleanupRetryDelaySeconds(12), 61_440)
  assert.equal(crmDocumentStorageCleanupRetryDelaySeconds(13), 61_440)
  assert.equal(crmDocumentStorageCleanupRetryDelaySeconds(Number.NaN), 30)
})

test('completes a prepared deletion using only the exact claimed object', async () => {
  const parsedClaim = parseCrmDocumentStorageCleanupClaim(claim())
  const calls: unknown[] = []
  const result = await executeCrmDocumentStorageCleanupClaim(parsedClaim, {
    async prepare() {
      calls.push('prepare')
      return {
        id: cleanupId,
        action: 'delete_blob',
        storageBucket: 'crm-case-documents',
        storagePath,
      }
    },
    async remove(bucket, path) {
      calls.push(['remove', bucket, path])
      return {}
    },
    async complete(input) {
      calls.push(['complete', input])
      return { status: 'completed' }
    },
  })

  assert.deepEqual(result, { state: 'completed' })
  assert.deepEqual(calls, [
    'prepare',
    ['remove', 'crm-case-documents', storagePath],
    ['complete', { succeeded: true, error: null, retryDelaySeconds: 30 }],
  ])
})

test('keeps a failed provider deletion retryable with a controlled error', async () => {
  const parsedClaim = parseCrmDocumentStorageCleanupClaim(claim({ attempts: 3 }))
  const completions: unknown[] = []
  const result = await executeCrmDocumentStorageCleanupClaim(parsedClaim, {
    async prepare() {
      return {
        id: cleanupId,
        action: 'delete_blob',
        storageBucket: 'crm-case-documents',
        storagePath,
      }
    },
    async remove() {
      return { error: new Error('provider response containing an unsafe path') }
    },
    async complete(input) {
      completions.push(input)
      return { status: 'failed' }
    },
  })

  assert.deepEqual(result, { state: 'failed' })
  assert.deepEqual(completions, [{
    succeeded: false,
    error: 'crm_document_storage_delete_failed',
    retryDelaySeconds: 120,
  }])
})

test('never calls Storage when database reconciliation retains a pinned document', async () => {
  const parsedClaim = parseCrmDocumentStorageCleanupClaim(claim())
  let removed = false
  let completed = false
  const result = await executeCrmDocumentStorageCleanupClaim(parsedClaim, {
    async prepare() {
      return { id: cleanupId, action: 'retained', documentId }
    },
    async remove() {
      removed = true
      return {}
    },
    async complete() {
      completed = true
      return { status: 'completed' }
    },
  })

  assert.deepEqual(result, { state: 'retained' })
  assert.equal(removed, false)
  assert.equal(completed, false)
})

test('keeps a first successful remove pending for a delayed verification pass', async () => {
  const parsedClaim = parseCrmDocumentStorageCleanupClaim(claim())
  const result = await executeCrmDocumentStorageCleanupClaim(parsedClaim, {
    async prepare() {
      return {
        id: cleanupId,
        action: 'delete_blob',
        storageBucket: 'crm-case-documents',
        storagePath,
      }
    },
    async remove() {
      return {}
    },
    async complete() {
      return { status: 'pending' }
    },
  })
  assert.deepEqual(result, { state: 'processing' })
})
