import { createError } from 'h3'
import {
  loadCaseBankApplication,
  requireCaseBankApplicationManager,
} from '~~/server/utils/case-bank-applications'
import {
  assertUuid,
  caseDocumentBucket,
  requireCrmCase,
} from '~~/server/utils/case-documents'
import {
  activateAndProcessCrmDocumentStorageCleanup,
  getCrmDocumentStorageCleanupByDocument,
} from '~~/server/utils/crm-document-storage-cleanup'
import { serverDataBackend } from '~~/server/utils/data-api'
import { getRequiredParam, requireCrmSession, throwDbError } from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const caseId = getRequiredParam(event, 'id')
  const documentId = getRequiredParam(event, 'documentId')
  assertUuid(documentId, 'documentId')
  await requireCrmCase(session, caseId)
  const backendData = serverDataBackend(event) as any

  const { data: document, error } = await session.dataApi
    .from('crm_documents')
    .select('id, submission_id, storage_bucket, storage_path')
    .eq('organization_id', session.organizationId)
    .eq('case_id', caseId)
    .eq('id', documentId)
    .maybeSingle()
  throwDbError(error)

  // A prior request may already have committed metadata deletion before its
  // Storage call failed (or before the response reached the browser). The
  // tombstone keeps both authorization scope and the opaque object path so an
  // identical DELETE remains retryable instead of becoming a terminal 404.
  const existingCleanup = document
    ? null
    : await getCrmDocumentStorageCleanupByDocument(backendData, {
        organizationId: session.organizationId,
        caseId,
        documentId,
      })
  if (!document && !existingCleanup) {
    throw createError({ statusCode: 404, statusMessage: 'Document not found' })
  }

  const submissionId = document?.submission_id
    ? String(document.submission_id)
    : existingCleanup?.submissionId
  if (submissionId) {
    const application = await loadCaseBankApplication(
      session,
      caseId,
      submissionId,
    )
    if (application) {
      await requireCaseBankApplicationManager(session, caseId, application)
    }
  }

  if (!document) {
    if (existingCleanup!.status === 'completed') {
      return { data: { id: documentId }, cleanupPending: false }
    }
    if (existingCleanup!.status === 'retained') {
      throw createError({
        statusCode: 409,
        statusMessage: 'Document cleanup is retained by the legal ledger',
      })
    }
    const cleanup = await activateAndProcessCrmDocumentStorageCleanup(
      backendData,
      existingCleanup!.id,
    )
    if (cleanup.state === 'failed') {
      throw createError({ statusCode: 500, statusMessage: 'Document object cleanup failed' })
    }
    return {
      data: { id: documentId },
      cleanupPending: cleanup.state === 'processing',
    }
  }

  const artifactResult = await session.dataApi
    .from('crm_mortgage_application_artifacts')
    .select('id')
    .eq('organization_id', session.organizationId)
    .eq('case_id', caseId)
    .eq('document_id', documentId)
    .limit(1)
    .maybeSingle()
  throwDbError(artifactResult.error)
  if (artifactResult.data) {
    throw createError({
      statusCode: 409,
      statusMessage: 'A document pinned in the mortgage legal ledger cannot be deleted',
    })
  }

  if (document.storage_bucket !== caseDocumentBucket || !document.storage_path) {
    throw createError({ statusCode: 409, statusMessage: 'Document is not managed by CRM storage' })
  }

  const storagePath = String(document.storage_path)
  if (!storagePath.startsWith(`${session.organizationId}/${caseId}/`)) {
    throw createError({ statusCode: 409, statusMessage: 'Document storage path is outside this case' })
  }
  // Delete metadata first. Its RESTRICT foreign key is the final race-safe
  // guard against removing a blob concurrently pinned as a legal artifact.
  const { data: deleted, error: deleteError } = await session.dataApi
    .from('crm_documents')
    .delete()
    .eq('organization_id', session.organizationId)
    .eq('case_id', caseId)
    .eq('id', documentId)
    .eq('storage_bucket', caseDocumentBucket)
    .eq('storage_path', storagePath)
    .select('id')
    .maybeSingle()
  throwDbError(deleteError)
  if (!deleted) {
    throw createError({ statusCode: 409, statusMessage: 'Document metadata changed during deletion' })
  }

  const cleanupJob = await getCrmDocumentStorageCleanupByDocument(backendData, {
    organizationId: session.organizationId,
    caseId,
    documentId,
  })
  if (!cleanupJob) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Document cleanup intent was not recorded',
    })
  }
  const cleanup = await activateAndProcessCrmDocumentStorageCleanup(
    backendData,
    cleanupJob.id,
  )
  if (cleanup.state === 'failed') {
    throw createError({ statusCode: 500, statusMessage: 'Document object cleanup failed' })
  }
  return {
    data: deleted,
    cleanupPending: cleanup.state === 'processing',
  }
})
