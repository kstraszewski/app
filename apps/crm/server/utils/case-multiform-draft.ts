import { createError } from 'h3'
import type { CaseMultiformDraftPutInput } from './case-multiform-draft-validation'
import { throwDbError, type CrmSession } from './crm'

type JsonRecord = Record<string, unknown>

interface CaseMultiformDraftRow {
  organization_id: string
  case_id: string
  selection_fingerprint: string
  revision: number
  active_step: number
  intake_answers: unknown
  form_values: unknown
  collection_counts: unknown
  selected_document_ids: unknown
  updated_by_user_id: string | null
  created_at: string
  updated_at: string
}

export interface CaseMultiformDraft {
  organizationId: string
  caseId: string
  selectionFingerprint: string
  revision: number
  activeStep: number
  intakeAnswers: JsonRecord
  formValues: JsonRecord
  collectionCounts: Record<string, number>
  selectedDocumentIds: string[]
  updatedByUserId: string | null
  createdAt: string
  updatedAt: string
}

const draftSelect = [
  'organization_id',
  'case_id',
  'selection_fingerprint',
  'revision',
  'active_step',
  'intake_answers',
  'form_values',
  'collection_counts',
  'selected_document_ids',
  'updated_by_user_id',
  'created_at',
  'updated_at',
].join(', ')

function rowRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function rowCollectionCounts(value: unknown): Record<string, number> {
  const record = rowRecord(value)
  return Object.fromEntries(
    Object.entries(record)
      .filter((entry): entry is [string, number] => Number.isInteger(entry[1])),
  )
}

function rowDocumentIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((documentId): documentId is string => typeof documentId === 'string')
    : []
}

function mapDraft(row: CaseMultiformDraftRow): CaseMultiformDraft {
  return {
    organizationId: String(row.organization_id),
    caseId: String(row.case_id),
    selectionFingerprint: String(row.selection_fingerprint),
    revision: Number(row.revision),
    activeStep: Number(row.active_step),
    intakeAnswers: rowRecord(row.intake_answers),
    formValues: rowRecord(row.form_values),
    collectionCounts: rowCollectionCounts(row.collection_counts),
    selectedDocumentIds: rowDocumentIds(row.selected_document_ids),
    updatedByUserId: row.updated_by_user_id ? String(row.updated_by_user_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function revisionConflict(currentRevision: number | null): never {
  throw createError({
    statusCode: 409,
    statusMessage: currentRevision === null
      ? 'Szkic został usunięty. Odśwież formularz i spróbuj ponownie.'
      : `Szkic został zmieniony w innej karcie (aktualna rewizja: ${currentRevision}).`,
    data: { currentRevision },
  })
}

export async function loadCaseMultiformDraft(
  session: CrmSession,
  caseId: string,
): Promise<CaseMultiformDraft | null> {
  const { data, error } = await session.dataApi
    .from('crm_case_multiform_drafts')
    .select(draftSelect)
    .eq('organization_id', session.organizationId)
    .eq('case_id', caseId)
    .maybeSingle()
  throwDbError(error)
  return data ? mapDraft(data as CaseMultiformDraftRow) : null
}

export async function saveCaseMultiformDraft(
  session: CrmSession,
  caseId: string,
  currentSelectionFingerprint: string,
  input: CaseMultiformDraftPutInput,
): Promise<CaseMultiformDraft> {
  if (input.selectionFingerprint !== currentSelectionFingerprint) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Wybrane wnioski bankowe zmieniły się. Odśwież formularz przed zapisem.',
      data: { selectionFingerprint: currentSelectionFingerprint },
    })
  }

  if (input.selectedDocumentIds.length) {
    const { data: documents, error: documentsError } = await session.dataApi
      .from('crm_documents')
      .select('id')
      .eq('organization_id', session.organizationId)
      .eq('case_id', caseId)
      .in('id', input.selectedDocumentIds)
    throwDbError(documentsError)
    if (new Set((documents ?? []).map((document: { id: unknown }) => String(document.id))).size !== input.selectedDocumentIds.length) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Każdy wybrany dokument musi należeć do tej sprawy.',
      })
    }
  }

  const values = {
    selection_fingerprint: currentSelectionFingerprint,
    active_step: input.activeStep,
    intake_answers: input.intakeAnswers,
    form_values: input.formValues,
    collection_counts: input.collectionCounts,
    selected_document_ids: input.selectedDocumentIds,
    updated_by_user_id: session.userId,
  }

  if (input.revision === 0) {
    const { data, error } = await session.dataApi
      .from('crm_case_multiform_drafts')
      .insert({
        organization_id: session.organizationId,
        case_id: caseId,
        revision: 1,
        ...values,
      })
      .select(draftSelect)
      .single()
    if (error?.code === '23505') {
      const current = await loadCaseMultiformDraft(session, caseId)
      return revisionConflict(current?.revision ?? null)
    }
    throwDbError(error)
    return mapDraft(data as CaseMultiformDraftRow)
  }

  const { data, error } = await session.dataApi
    .from('crm_case_multiform_drafts')
    .update({
      revision: input.revision + 1,
      ...values,
    })
    .eq('organization_id', session.organizationId)
    .eq('case_id', caseId)
    .eq('revision', input.revision)
    .select(draftSelect)
    .maybeSingle()
  throwDbError(error)
  if (data) return mapDraft(data as CaseMultiformDraftRow)

  const current = await loadCaseMultiformDraft(session, caseId)
  return revisionConflict(current?.revision ?? null)
}
