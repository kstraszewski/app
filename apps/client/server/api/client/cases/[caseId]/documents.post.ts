import { createHash, randomUUID } from 'node:crypto'
import {
  createError,
  getRouterParam,
  setHeader,
  type H3Event,
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
import {
  analyzePortalIdentityDocument,
  isPortalIdentityDocumentType,
  maxPortalIdentityDocumentAiBytes,
  portalIdentityDocumentAiModel,
  portalIdentityDocumentAiPromptVersion,
  PortalIdentityDocumentAiError,
  resolvePortalIdentityDocumentExtraction,
  type PortalIdentityDocumentMediaType,
} from '~~/server/utils/portal-identity-document-ai'
import { serverStorage } from '~~/server/utils/platform-storage'

function multipartText(
  parts: Awaited<ReturnType<typeof readLimitedMultipartFormData>>,
  name: string,
): string | undefined {
  const part = parts?.find(item => item.name === name && !item.filename)
  const value = part?.data.toString('utf8').trim()
  return value || undefined
}

type PublicIdentityExtraction = {
  status: 'applied' | 'applied_with_review' | 'no_changes' | 'needs_review' | 'unavailable' | 'skipped'
  filledFields: string[]
  reasonCodes: string[]
  model: typeof portalIdentityDocumentAiModel
}

async function extractIdentityData(input: {
  event: H3Event
  backend: any
  organizationId: string
  clientId: string
  personId: string
  documentId: string
  documentType: string
  documentMetadata: Record<string, unknown>
  bytes: Uint8Array
  mimeType: PortalIdentityDocumentMediaType
}): Promise<PublicIdentityExtraction | null> {
  if (!isPortalIdentityDocumentType(input.documentType)) return null
  const attemptedAt = new Date().toISOString()
  let result: PublicIdentityExtraction

  if (input.bytes.byteLength > maxPortalIdentityDocumentAiBytes) {
    result = {
      status: 'skipped',
      filledFields: [],
      reasonCodes: ['file_too_large_for_ai'],
      model: portalIdentityDocumentAiModel,
    }
  }
  else {
    try {
      const personResult = await input.backend
        .from('crm_client_people')
        .select('id, display_name, first_name, last_name, pesel, date_of_birth, metadata, updated_at')
        .eq('organization_id', input.organizationId)
        .eq('client_id', input.clientId)
        .eq('id', input.personId)
        .maybeSingle()
      throwPortalDbError(personResult.error, 'could not load identity extraction person')
      if (!personResult.data) throw new Error('Identity extraction person was not found')
      const person = personResult.data as Record<string, any>
      const runtimeConfig = useRuntimeConfig(input.event)
      const observation = await analyzePortalIdentityDocument({
        bytes: input.bytes,
        mediaType: input.mimeType,
        expectedPersonName: String(person.display_name),
        aiGatewayApiKey: String(runtimeConfig.aiGatewayApiKey ?? ''),
      })
      const resolution = resolvePortalIdentityDocumentExtraction(
        observation,
        {
          displayName: String(person.display_name),
          firstName: person.first_name == null ? null : String(person.first_name),
          lastName: person.last_name == null ? null : String(person.last_name),
          pesel: person.pesel == null ? null : String(person.pesel),
          dateOfBirth: person.date_of_birth == null ? null : String(person.date_of_birth),
          metadata: person.metadata,
        },
        { documentId: input.documentId, extractedAt: attemptedAt },
      )
      let status = resolution.status
      const reasonCodes = [...resolution.reasonCodes]
      if (Object.keys(resolution.personPatch).length) {
        const updateResult = await input.backend
          .from('crm_client_people')
          .update(resolution.personPatch)
          .eq('organization_id', input.organizationId)
          .eq('client_id', input.clientId)
          .eq('id', input.personId)
          .eq('updated_at', String(person.updated_at))
          .select('id')
          .maybeSingle()
        throwPortalDbError(updateResult.error, 'could not apply identity document extraction')
        if (!updateResult.data) {
          status = 'needs_review'
          reasonCodes.push('concurrent_person_update')
        }
      }
      result = {
        status,
        filledFields: status === 'needs_review' ? [] : resolution.filledFields,
        reasonCodes: [...new Set(reasonCodes)],
        model: portalIdentityDocumentAiModel,
      }
    }
    catch (caught) {
      result = {
        status: caught instanceof PortalIdentityDocumentAiError
          && caught.code === 'not_configured'
          ? 'unavailable'
          : 'needs_review',
        filledFields: [],
        reasonCodes: [caught instanceof PortalIdentityDocumentAiError
          ? `ai_${caught.code}`
          : 'processing_failed'],
        model: portalIdentityDocumentAiModel,
      }
    }
  }

  const metadataResult = await input.backend
    .from('crm_documents')
    .update({
      metadata: {
        ...input.documentMetadata,
        identityExtraction: {
          ...result,
          attemptedAt,
          promptVersion: portalIdentityDocumentAiPromptVersion,
        },
      },
    })
    .eq('organization_id', input.organizationId)
    .eq('id', input.documentId)
    .select('id')
    .maybeSingle()
  if (metadataResult.error || !metadataResult.data) {
    console.error('[client-portal] identity extraction metadata update failed', {
      documentId: input.documentId,
    })
  }
  return result
}

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

  const backend = serverDataBackend(event) as any
  const requirementIdInput = multipartText(parts, 'requirementId')
  const requirementId = requirementIdInput
    ? requiredUuid(requirementIdInput, 'requirementId')
    : null
  let requirement: Record<string, any> | null = null
  if (requirementId) {
    if (access.link.person.role !== 'primary') {
      throw createError({ statusCode: 404, statusMessage: 'Document requirement not found' })
    }
    const requirementResult = await backend
      .from('crm_documents')
      .select('id, client_id, case_item_id, submission_id, document_type, name, status_code, uploaded_by_client_person_id')
      .eq('organization_id', access.grant.organizationId)
      .eq('case_id', caseId)
      .eq('id', requirementId)
      .eq('status_code', 'missing')
      .is('uploaded_by_client_person_id', null)
      .maybeSingle()
    throwPortalDbError(requirementResult.error, 'could not load document requirement')
    const candidate = requirementResult.data as Record<string, any> | null
    if (
      !candidate
      || (
        candidate.client_id != null
        && String(candidate.client_id) !== access.grant.clientId
      )
    ) {
      throw createError({ statusCode: 404, statusMessage: 'Document requirement not found' })
    }
    requirement = candidate
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

  const documentValues = {
    organization_id: access.grant.organizationId,
    case_id: caseId,
    client_id: requirement ? requirement.client_id : access.grant.clientId,
    case_item_id: requirement?.case_item_id ?? null,
    submission_id: requirement?.submission_id ?? null,
    document_type: requirement ? String(requirement.document_type) : 'client_upload',
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
    metadata: {
      source: 'client_portal',
      ...(requirement
        ? {
            requirementId: String(requirement.id),
            requirementLabel: String(requirement.name),
          }
        : {}),
    },
  }
  const documentResult = requirement
    ? await backend
        .from('crm_documents')
        .update(documentValues)
        .eq('organization_id', access.grant.organizationId)
        .eq('case_id', caseId)
        .eq('id', requirement.id)
        .eq('status_code', 'missing')
        .is('uploaded_by_client_person_id', null)
        .select('id, name, document_type, status_code, received_at, updated_at')
        .maybeSingle()
    : await backend
        .from('crm_documents')
        .insert(documentValues)
        .select('id, name, document_type, status_code, received_at, updated_at')
        .single()

  if (documentResult.error || !documentResult.data) {
    const cleanup = await storage.from(portalCaseDocumentBucket).remove([storagePath])
    if (cleanup.error) {
      console.error('[client-portal] failed to clean up document object', cleanup.error.message)
    }
    throwPortalDbError(documentResult.error, 'could not save uploaded document metadata')
    if (requirement) {
      throw createError({ statusCode: 409, statusMessage: 'Document requirement has already changed' })
    }
    throw createError({ statusCode: 500, statusMessage: 'Document upload failed' })
  }

  const identityExtraction = await extractIdentityData({
    event,
    backend,
    organizationId: access.grant.organizationId,
    clientId: access.grant.clientId,
    personId: access.link.clientPersonId,
    documentId: String(documentResult.data.id),
    documentType: String(documentResult.data.document_type),
    documentMetadata: documentValues.metadata,
    bytes: file.data,
    mimeType,
  })

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
      ...(identityExtraction
        ? {
            identityExtractionStatus: identityExtraction.status,
            identityExtractionFields: identityExtraction.filledFields,
            identityExtractionModel: identityExtraction.model,
          }
        : {}),
    },
  })
  if (activityResult.error) {
    console.error('[client-portal] document audit activity failed', activityResult.error.message)
  }
  if (identityExtraction && ['applied', 'applied_with_review'].includes(identityExtraction.status)) {
    const extractionActivityResult = await backend.from('crm_activities').insert({
      organization_id: access.grant.organizationId,
      actor_user_id: null,
      actor_client_person_id: access.link.clientPersonId,
      actor_auth_user_id: access.session.identity.userId,
      client_id: access.grant.clientId,
      case_id: caseId,
      activity_type: 'client_portal_identity_data_extracted',
      title: 'Dane osoby uzupełniono automatycznie z dokumentu',
      body: null,
      payload: {
        source: 'client_portal',
        documentId: String(documentResult.data.id),
        status: identityExtraction.status,
        fields: identityExtraction.filledFields,
        model: identityExtraction.model,
        promptVersion: portalIdentityDocumentAiPromptVersion,
      },
    })
    if (extractionActivityResult.error) {
      console.error('[client-portal] identity extraction audit activity failed', {
        documentId: String(documentResult.data.id),
      })
    }
  }

  return {
    data: {
      id: String(documentResult.data.id),
      name: String(documentResult.data.name),
      documentType: String(documentResult.data.document_type),
      statusCode: String(documentResult.data.status_code),
      receivedAt: String(documentResult.data.received_at),
      updatedAt: String(documentResult.data.updated_at),
      identityExtraction,
    },
  }
})
