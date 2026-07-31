import { createError } from 'h3'
import {
  assertUuid,
  caseDocumentBucket,
  requireCrmCase,
} from '~~/server/utils/case-documents'
import { getRequiredParam, requireCrmSession, throwDbError } from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const caseId = getRequiredParam(event, 'id')
  const documentId = getRequiredParam(event, 'documentId')
  assertUuid(documentId, 'documentId')
  await requireCrmCase(session, caseId)

  const { data: document, error } = await session.dataApi
    .from('crm_documents')
    .select('id, storage_bucket, storage_path')
    .eq('organization_id', session.organizationId)
    .eq('case_id', caseId)
    .eq('id', documentId)
    .maybeSingle()
  throwDbError(error)
  if (!document) throw createError({ statusCode: 404, statusMessage: 'Document not found' })
  if (document.storage_bucket !== caseDocumentBucket || !document.storage_path) {
    throw createError({ statusCode: 409, statusMessage: 'Document is not managed by CRM storage' })
  }

  const storagePath = String(document.storage_path)
  if (!storagePath.startsWith(`${session.organizationId}/${caseId}/`)) {
    throw createError({ statusCode: 409, statusMessage: 'Document storage path is outside this case' })
  }
  const { error: removeError } = await session.dataApi.storage
    .from(caseDocumentBucket)
    .remove([storagePath])
  if (removeError) {
    throw createError({ statusCode: 500, statusMessage: removeError.message || 'Document delete failed' })
  }

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
  return { data: deleted }
})
