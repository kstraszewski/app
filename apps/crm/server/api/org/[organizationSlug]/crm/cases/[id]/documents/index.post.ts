import { createHash, randomUUID } from 'node:crypto'
import { createError, readMultipartFormData } from 'h3'
import {
  caseDocumentBucket,
  caseDocumentMimeExtensions,
  caseDocumentPublicSelect,
  hasValidCaseDocumentSignature,
  maxCaseDocumentBytes,
  requireCrmCase,
  resolveOfferRequirement,
  resolveRequirementClient,
  safeOriginalFileName,
  type CaseDocumentMimeType,
} from '~~/server/utils/case-documents'
import { getRequiredParam, requireCrmSession, throwDbError } from '~~/server/utils/crm'

function multipartText(
  parts: Awaited<ReturnType<typeof readMultipartFormData>>,
  name: string,
): string | undefined {
  const part = parts?.find(item => item.name === name && !item.filename)
  const value = part?.data.toString('utf8').trim()
  return value || undefined
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const caseId = getRequiredParam(event, 'id')
  await requireCrmCase(session, caseId)

  const parts = await readMultipartFormData(event)
  if (!parts) throw createError({ statusCode: 400, statusMessage: 'Multipart form data is required' })
  const files = parts.filter(part => part.name === 'file' && part.filename)
  if (files.length !== 1 || !files[0]?.data.length) {
    throw createError({ statusCode: 400, statusMessage: 'Exactly one file is required' })
  }
  const file = files[0]
  const documentType = multipartText(parts, 'documentType')
  if (!documentType || documentType.length > 100) {
    throw createError({ statusCode: 400, statusMessage: 'documentType is required' })
  }
  const clientId = multipartText(parts, 'clientId')
  const offerId = multipartText(parts, 'offerId')

  const {
    offerId: validatedOfferId,
    applicationId,
    caseItemId,
    requirement,
  } = await resolveOfferRequirement(
    session,
    caseId,
    documentType,
    offerId,
  )
  const validatedClientId = await resolveRequirementClient(session, caseId, requirement, clientId)

  let supersedesDocumentId: string | null = null
  if (!requirement.multiple) {
    let existingQuery = session.dataApi
      .from('crm_documents')
      .select('id')
      .eq('organization_id', session.organizationId)
      .eq('case_id', caseId)
      .eq('document_type', documentType)
      .order('created_at', { ascending: false })
      .limit(1)
    existingQuery = validatedClientId
      ? existingQuery.eq('client_id', validatedClientId)
      : existingQuery.is('client_id', null)
    existingQuery = requirement.itemKind === 'bank_document'
      ? existingQuery.eq('submission_id', applicationId)
      : existingQuery.is('submission_id', null)
    const { data: existingDocuments, error: existingError } = await existingQuery
    throwDbError(existingError)
    supersedesDocumentId = existingDocuments?.[0]?.id
      ? String(existingDocuments[0].id)
      : null
  }

  if (file.data.length > maxCaseDocumentBytes) {
    throw createError({ statusCode: 413, statusMessage: 'File must not exceed 25 MiB' })
  }
  if (!file.type || !(file.type in caseDocumentMimeExtensions)) {
    throw createError({ statusCode: 415, statusMessage: 'File must be a PDF, JPEG or PNG' })
  }
  const mimeType = file.type as CaseDocumentMimeType
  if (!requirement.allowedMimeTypes.includes(mimeType)) {
    throw createError({
      statusCode: 415,
      statusMessage: 'File format is not allowed for this checklist item',
    })
  }
  if (!hasValidCaseDocumentSignature(mimeType, file.data)) {
    throw createError({ statusCode: 415, statusMessage: 'File contents do not match its MIME type' })
  }

  const extension = caseDocumentMimeExtensions[mimeType]
  const storagePath = `${session.organizationId}/${caseId}/${randomUUID()}.${extension}`
  const sha256 = createHash('sha256').update(file.data).digest('hex')
  const originalName = safeOriginalFileName(file.filename, `${documentType}.${extension}`)
  const receivedAt = new Date().toISOString()

  const { error: uploadError } = await session.dataApi.storage
    .from(caseDocumentBucket)
    .upload(storagePath, file.data, {
      contentType: mimeType,
      cacheControl: '0',
      upsert: false,
    })
  if (uploadError) {
    throw createError({ statusCode: 500, statusMessage: uploadError.message || 'Document upload failed' })
  }

  const { data, error } = await session.dataApi
    .from('crm_documents')
    .insert({
      organization_id: session.organizationId,
      case_id: caseId,
      case_item_id: requirement.itemKind === 'bank_document' ? caseItemId : null,
      submission_id: requirement.itemKind === 'bank_document' ? applicationId : null,
      client_id: validatedClientId,
      document_type: documentType,
      name: originalName,
      status_code: 'received',
      storage_bucket: caseDocumentBucket,
      storage_path: storagePath,
      uploaded_by_user_id: session.userId,
      mime_type: mimeType,
      size_bytes: file.data.length,
      sha256,
      received_at: receivedAt,
      metadata: {
        uploadedForOfferId: validatedOfferId,
        requirementLabel: requirement.label,
        ...(supersedesDocumentId ? { supersedesDocumentId } : {}),
      },
    })
    .select(caseDocumentPublicSelect)
    .single()

  if (error || !data) {
    const { error: cleanupError } = await session.dataApi.storage
      .from(caseDocumentBucket)
      .remove([storagePath])
    if (cleanupError) {
      console.error('[crm-documents] failed to clean up object after metadata insert error', {
        storagePath,
        message: cleanupError.message,
      })
    }
    throwDbError(error)
    throw createError({ statusCode: 500, statusMessage: 'Document metadata could not be saved' })
  }

  return { data }
})
