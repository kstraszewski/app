import { createHash, randomUUID } from 'node:crypto'
import {
  createError,
  getRouterParam,
  setHeader,
} from 'h3'
import { serverDataBackend } from '~~/server/utils/data-api'
import {
  hasValidPortalDocumentSignature,
  maxPortalDocumentBytes,
  portalCaseDocumentBucket,
  portalDocumentMimeExtensions,
  readLimitedMultipartFormData,
  safePortalFileName,
  type PortalDocumentMimeType,
} from '~~/server/utils/portal-files'
import {
  requirePortalCaseAccess,
  requiredUuid,
  throwPortalDbError,
} from '~~/server/utils/portal-auth'
import { serverStorage } from '~~/server/utils/platform-storage'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const caseId = requiredUuid(getRouterParam(event, 'caseId'), 'caseId')
  const access = await requirePortalCaseAccess(event, caseId)
  const parts = await readLimitedMultipartFormData(
    event,
    maxPortalDocumentBytes + 1024 * 1024,
  )
  const files = parts?.filter(part => part.name === 'file' && part.filename) ?? []
  if (files.length !== 1 || !files[0]?.data.length) {
    throw createError({ statusCode: 400, statusMessage: 'Exactly one file is required' })
  }
  const file = files[0]
  if (file.data.length > maxPortalDocumentBytes) {
    throw createError({ statusCode: 413, statusMessage: 'File must not exceed 20 MB' })
  }
  if (!file.type || !(file.type in portalDocumentMimeExtensions)) {
    throw createError({ statusCode: 415, statusMessage: 'File must be a PDF, JPEG or PNG' })
  }
  const mimeType = file.type as PortalDocumentMimeType
  if (!hasValidPortalDocumentSignature(mimeType, file.data)) {
    throw createError({ statusCode: 415, statusMessage: 'File contents do not match its MIME type' })
  }

  const extension = portalDocumentMimeExtensions[mimeType]
  const objectId = randomUUID()
  const storagePath = `${access.grant.organizationId}/${caseId}/client/${objectId}.${extension}`
  const name = safePortalFileName(file.filename, `dokument-${objectId}.${extension}`)
  const sha256 = createHash('sha256').update(file.data).digest('hex')
  const receivedAt = new Date().toISOString()
  const storage = serverStorage(event)
  const upload = await storage.from(portalCaseDocumentBucket).upload(
    storagePath,
    file.data,
    { contentType: mimeType, cacheControl: '0', upsert: false },
  )
  if (upload.error) {
    console.error('[client-portal] document storage upload failed', upload.error.message)
    throw createError({ statusCode: 500, statusMessage: 'Document upload failed' })
  }

  const backend = serverDataBackend(event) as any
  const documentResult = await backend
    .from('crm_documents')
    .insert({
      organization_id: access.grant.organizationId,
      client_id: access.grant.clientId,
      case_id: caseId,
      case_item_id: null,
      submission_id: null,
      document_type: 'client_upload',
      name,
      status_code: 'received',
      storage_bucket: portalCaseDocumentBucket,
      storage_path: storagePath,
      received_at: receivedAt,
      uploaded_by_user_id: null,
      uploaded_by_client_person_id: access.link.clientPersonId,
      uploaded_by_auth_user_id: access.session.identity.userId,
      mime_type: mimeType,
      size_bytes: file.data.length,
      sha256,
      metadata: { source: 'client_portal' },
    })
    .select('id, name, document_type, status_code, received_at, updated_at')
    .single()

  if (documentResult.error || !documentResult.data) {
    const cleanup = await storage.from(portalCaseDocumentBucket).remove([storagePath])
    if (cleanup.error) {
      console.error('[client-portal] failed to clean up document object', cleanup.error.message)
    }
    throwPortalDbError(documentResult.error, 'could not save uploaded document metadata')
    throw createError({ statusCode: 500, statusMessage: 'Document upload failed' })
  }

  const activityResult = await backend.from('crm_activities').insert({
    organization_id: access.grant.organizationId,
    actor_user_id: null,
    actor_client_person_id: access.link.clientPersonId,
    actor_auth_user_id: access.session.identity.userId,
    client_id: access.grant.clientId,
    case_id: caseId,
    activity_type: 'client_portal_document_uploaded',
    title: 'Klient przesłał dokument przez panel',
    body: name,
    payload: {
      source: 'client_portal',
      documentId: String(documentResult.data.id),
    },
  })
  if (activityResult.error) {
    console.error('[client-portal] document audit activity failed', activityResult.error.message)
  }

  return {
    data: {
      id: String(documentResult.data.id),
      name: String(documentResult.data.name),
      documentType: String(documentResult.data.document_type),
      statusCode: String(documentResult.data.status_code),
      receivedAt: String(documentResult.data.received_at),
      updatedAt: String(documentResult.data.updated_at),
    },
  }
})
