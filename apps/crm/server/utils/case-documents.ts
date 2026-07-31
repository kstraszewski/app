import {
  applicableDocumentRequirements,
  parseDocumentRequirement,
  type DocumentRequirement,
  type DocumentRequirementMimeType,
} from '#shared/document-requirements'
import { createError } from 'h3'
import { caseUuidPattern } from './case-identifiers'
import { asRecord, throwDbError, type CrmSession } from './crm'

export const caseDocumentBucket = 'crm-case-documents'
export const maxCaseDocumentBytes = 25 * 1024 * 1024
export const caseDocumentPublicSelect = 'id, organization_id, client_id, case_id, case_item_id, submission_id, document_type, name, status_code, uploaded_by_user_id, mime_type, size_bytes, sha256, received_at, verified_at, metadata, created_at, updated_at'
export const caseDocumentStorageSelect = `${caseDocumentPublicSelect}, storage_bucket, storage_path`

export const caseDocumentMimeExtensions = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
} as const satisfies Record<DocumentRequirementMimeType, string>

export type CaseDocumentMimeType = keyof typeof caseDocumentMimeExtensions

export function documentRequirementsFromSnapshot(
  snapshot: unknown,
  scenarioSnapshot?: unknown,
): DocumentRequirement[] {
  const version = asRecord(asRecord(snapshot).version)
  if (!Array.isArray(version.document_requirements)) return []
  const requirements = version.document_requirements
    .map(parseDocumentRequirement)
    .filter((requirement): requirement is DocumentRequirement => requirement !== null)
  return applicableDocumentRequirements(requirements, scenarioSnapshot)
}

export function hasValidCaseDocumentSignature(type: CaseDocumentMimeType, data: Buffer): boolean {
  if (type === 'application/pdf') {
    return data.length >= 5 && data.subarray(0, 5).toString('ascii') === '%PDF-'
  }
  if (type === 'image/jpeg') {
    return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
  }
  return data.length >= 8
    && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
}

export function safeOriginalFileName(input: unknown, fallback: string): string {
  if (typeof input !== 'string') return fallback
  const normalized = input
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]/g, '-')
    .trim()
  return normalized ? normalized.slice(0, 240) : fallback
}

export function assertUuid(value: string, field: string): void {
  if (!caseUuidPattern.test(value)) {
    throw createError({ statusCode: 400, statusMessage: `${field} must be a UUID` })
  }
}

export async function requireCrmCase(session: CrmSession, caseId: string): Promise<void> {
  assertUuid(caseId, 'case id')
  const { data, error } = await session.dataApi
    .from('crm_cases')
    .select('id')
    .eq('organization_id', session.organizationId)
    .eq('id', caseId)
    .maybeSingle()
  throwDbError(error)
  if (!data) throw createError({ statusCode: 404, statusMessage: 'Case not found' })
}

export async function resolveOfferRequirement(
  session: CrmSession,
  caseId: string,
  documentType: string,
  requestedOfferId?: string,
): Promise<{ offerId: string, applicationId: string, caseItemId: string, requirement: DocumentRequirement }> {
  let offerId = requestedOfferId
  if (offerId) assertUuid(offerId, 'offerId')
  if (!offerId) {
    const { data: selection, error: selectionError } = await session.dataApi
      .from('crm_case_offer_selections')
      .select('offer_id')
      .eq('organization_id', session.organizationId)
      .eq('case_id', caseId)
      .maybeSingle()
    throwDbError(selectionError)
    offerId = selection?.offer_id ? String(selection.offer_id) : undefined
  }
  if (!offerId) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Select an offer or provide offerId before uploading documents',
    })
  }

  const { data: application, error: applicationError } = await session.dataApi
    .from('crm_case_bank_applications')
    .select('submission_id, case_item_id, scenario_snapshot')
    .eq('organization_id', session.organizationId)
    .eq('case_id', caseId)
    .eq('offer_id', offerId)
    .maybeSingle()
  throwDbError(applicationError)
  if (!application) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Saved offer is not part of the active bank applications',
    })
  }
  const { data: offer, error: offerError } = await session.dataApi
    .from('crm_case_offer_snapshots')
    .select('id, catalog_snapshot, scenario_snapshot')
    .eq('organization_id', session.organizationId)
    .eq('case_id', caseId)
    .eq('id', offerId)
    .maybeSingle()
  throwDbError(offerError)
  if (!offer) throw createError({ statusCode: 404, statusMessage: 'Saved offer not found' })

  const requirement = documentRequirementsFromSnapshot(
    offer.catalog_snapshot,
    application.scenario_snapshot ?? offer.scenario_snapshot,
  )
    .find(item => item.code === documentType)
  if (!requirement) {
    throw createError({
      statusCode: 422,
      statusMessage: 'documentType is not applicable to this saved offer scenario',
    })
  }
  if (!requirement.allowedMimeTypes.length) {
    throw createError({
      statusCode: 422,
      statusMessage: 'This checklist item does not accept uploaded files',
    })
  }
  if (
    !['client_document', 'bank_document'].includes(requirement.itemKind)
    || (requirement.itemKind === 'bank_document' && requirement.templateId)
  ) {
    throw createError({
      statusCode: 422,
      statusMessage: 'This checklist item is completed without uploading a source file',
    })
  }
  return {
    offerId,
    applicationId: String(application.submission_id),
    caseItemId: String(application.case_item_id),
    requirement,
  }
}

export async function resolveRequirementClient(
  session: CrmSession,
  caseId: string,
  requirement: DocumentRequirement,
  requestedClientId?: string,
): Promise<string | null> {
  if (requestedClientId) assertUuid(requestedClientId, 'clientId')

  if (requirement.scope === 'primary_applicant') {
    const { data: primaryClient, error } = await session.dataApi
      .from('crm_case_clients')
      .select('client_id')
      .eq('organization_id', session.organizationId)
      .eq('case_id', caseId)
      .eq('is_primary', true)
      .maybeSingle()
    throwDbError(error)
    if (!primaryClient) {
      throw createError({ statusCode: 409, statusMessage: 'Case has no primary applicant' })
    }
    const primaryClientId = String(primaryClient.client_id)
    if (requestedClientId && requestedClientId !== primaryClientId) {
      throw createError({ statusCode: 422, statusMessage: 'clientId must identify the primary applicant' })
    }
    return primaryClientId
  }

  if (requirement.scope === 'each_applicant' && !requestedClientId) {
    throw createError({ statusCode: 400, statusMessage: 'clientId is required for this checklist item' })
  }
  if (requirement.scope === 'case') {
    if (requestedClientId) {
      throw createError({ statusCode: 422, statusMessage: 'clientId is not allowed for a case checklist item' })
    }
    return null
  }
  if (!requestedClientId) return null

  const { data: linkedClient, error } = await session.dataApi
    .from('crm_case_clients')
    .select('client_id')
    .eq('organization_id', session.organizationId)
    .eq('case_id', caseId)
    .eq('client_id', requestedClientId)
    .maybeSingle()
  throwDbError(error)
  if (!linkedClient) {
    throw createError({ statusCode: 404, statusMessage: 'Client is not linked to this case' })
  }
  return requestedClientId
}
