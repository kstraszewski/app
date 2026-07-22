import { createError, setHeader } from 'h3'
import {
  assertUuid,
  caseDocumentBucket,
  caseDocumentStorageSelect,
  requireCrmCase,
  safeOriginalFileName,
} from '~~/server/utils/case-documents'
import { getRequiredParam, requireCrmSession, throwDbError } from '~~/server/utils/crm'

function attachmentHeader(fileName: string): string {
  const safeName = safeOriginalFileName(fileName, 'document')
  const asciiName = safeName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const caseId = getRequiredParam(event, 'id')
  const documentId = getRequiredParam(event, 'documentId')
  assertUuid(documentId, 'documentId')
  await requireCrmCase(session, caseId)

  const { data: document, error } = await session.supabase
    .from('crm_documents')
    .select(caseDocumentStorageSelect)
    .eq('organization_id', session.organizationId)
    .eq('case_id', caseId)
    .eq('id', documentId)
    .maybeSingle()
  throwDbError(error)
  if (!document) throw createError({ statusCode: 404, statusMessage: 'Document not found' })
  if (
    document.storage_bucket !== caseDocumentBucket
    || !document.storage_path
    || !String(document.storage_path).startsWith(`${session.organizationId}/${caseId}/`)
    || !document.mime_type
  ) {
    throw createError({ statusCode: 409, statusMessage: 'Document file is not available in CRM storage' })
  }

  const { data: file, error: downloadError } = await session.supabase.storage
    .from(caseDocumentBucket)
    .download(String(document.storage_path))
  if (downloadError || !file) {
    throw createError({ statusCode: 404, statusMessage: 'Document file not found' })
  }
  const bytes = Buffer.from(await file.arrayBuffer())

  setHeader(event, 'Content-Type', String(document.mime_type))
  setHeader(event, 'Content-Length', bytes.byteLength)
  setHeader(event, 'Content-Disposition', attachmentHeader(String(document.name)))
  setHeader(event, 'Cache-Control', 'private, no-store, max-age=0')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  return bytes
})
