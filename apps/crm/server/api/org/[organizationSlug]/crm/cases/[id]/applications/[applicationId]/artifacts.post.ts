import { createHash, randomUUID } from 'node:crypto'
import { createError, getRequestHeader, readMultipartFormData } from 'h3'
import {
  loadCaseBankApplication,
  requireCaseBankApplicationManager,
} from '~~/server/utils/case-bank-applications'
import {
  caseDocumentBucket,
  caseDocumentPublicSelect,
  hasValidCaseDocumentSignature,
  assertUuid,
  requireCrmCase,
  safeOriginalFileName,
} from '~~/server/utils/case-documents'
import {
  mortgageArtifactReplayFingerprint,
  normalizeMortgageArtifactPayload,
  normalizeMortgageDeliveries,
} from '~~/server/utils/mortgage-artifact-command'
import { executeMortgageArtifactAttachmentCommand } from '~~/server/utils/mortgage-application-process'
import {
  analyzeMortgageDocumentPdf,
  maxMortgageAiPdfBytes,
  MortgageDocumentAiValidationError,
  type MortgageDocumentValidationResult,
} from '~~/server/utils/mortgage-document-ai-validation'
import {
  mortgageDocumentValidationPiiFreeObservations,
  runOrReplayMortgageDocumentAiAttempt,
  type MortgageDocumentAiAttemptScope,
} from '~~/server/utils/mortgage-document-ai-attempt'
import {
  mortgageDocumentExpertOverrideReasonSha256,
  normalizeMortgageDocumentExpertOverrideReason,
  withoutMortgageDocumentExpertReviewMetadata,
  withMortgageDocumentExpertReviewMetadata,
} from '~~/server/utils/mortgage-document-expert-review'
import { loadMortgageDocumentValidationContext } from '~~/server/utils/mortgage-document-validation-context'
import {
  activateAndProcessCrmDocumentStorageCleanup,
  reserveCrmDocumentStorageCleanup,
  retainCrmDocumentStorageCleanup,
} from '~~/server/utils/crm-document-storage-cleanup'
import { serverDataBackend } from '~~/server/utils/data-api'
import {
  asRecord,
  getRequiredParam,
  recordCrmActivity,
  requireCrmSession,
  throwDbError,
} from '~~/server/utils/crm'

const artifactKinds = ['esis', 'credit_decision', 'draft_credit_agreement'] as const
type ArtifactKind = typeof artifactKinds[number]
type AiValidatedArtifactKind = Extract<ArtifactKind, 'esis' | 'credit_decision'>
// Vercel rejects function request bodies above 4.5 MB. Keep enough room for
// the multipart envelope around a 4 MiB PDF and reject before buffering it.
const maxArtifactRequestBytes = 4_400_000
const allowedMultipartFields = new Set([
  'file',
  'kind',
  'commandId',
  'expectedRevision',
  'artifact',
  'deliveries',
  'expertOverrideReason',
])

const documentTypeByKind: Record<ArtifactKind, string> = {
  esis: 'mortgage_esis',
  credit_decision: 'mortgage_credit_decision',
  draft_credit_agreement: 'mortgage_draft_credit_agreement',
}

const activityByKind: Record<ArtifactKind, string> = {
  esis: 'Załączono ESIS otrzymany z banku',
  credit_decision: 'Załączono decyzję kredytową otrzymaną z banku',
  draft_credit_agreement: 'Załączono projekt umowy kredytowej',
}

const aiValidationReasonLabels: Record<string, string> = {
  document_empty: 'dokument jest pusty',
  document_unreadable: 'dokument jest nieczytelny',
  document_partially_readable: 'część dokumentu jest nieczytelna',
  wrong_document_kind: 'załączono inny rodzaj dokumentu',
  document_kind_unconfirmed: 'nie udało się potwierdzić rodzaju dokumentu',
  wrong_bank: 'dokument pochodzi z innego banku',
  bank_unconfirmed: 'nie udało się potwierdzić banku',
  no_applicant_match: 'dokument nie dotyczy wskazanych wnioskodawców',
  applicant_match_incomplete: 'nie potwierdzono wszystkich wnioskodawców',
  applicant_match_unconfirmed: 'nie udało się potwierdzić wnioskodawców',
  decision_outcome_mismatch: 'wynik decyzji nie zgadza się z formularzem',
  decision_outcome_unconfirmed: 'nie udało się potwierdzić wyniku decyzji',
  valid_until_mismatch: 'data ważności nie zgadza się z formularzem',
  valid_until_unconfirmed: 'nie udało się potwierdzić daty ważności',
  loan_amount_mismatch: 'kwota różni się od danych sprawy',
  loan_amount_unconfirmed: 'nie udało się potwierdzić kwoty',
  currency_mismatch: 'waluta różni się od danych sprawy',
  missing_required_sections: 'brakuje wymaganych sekcji',
  document_anomaly: 'wykryto niespójność dokumentu',
  inconsistent_observation: 'wyniki odczytu są niespójne',
  low_confidence: 'pewność analizy jest zbyt niska',
}

type MultipartParts = Awaited<ReturnType<typeof readMultipartFormData>>

function multipartText(parts: MultipartParts, name: string): string | undefined {
  const part = parts?.find(item => item.name === name && !item.filename)
  const value = part?.data.toString('utf8').trim()
  return value || undefined
}

function artifactKind(input: string | undefined): ArtifactKind {
  if (!input || !artifactKinds.includes(input as ArtifactKind)) {
    throw createError({
      statusCode: 400,
      statusMessage: `kind must be one of: ${artifactKinds.join(', ')}`,
    })
  }
  return input as ArtifactKind
}

function isAiValidatedArtifactKind(kind: ArtifactKind): kind is AiValidatedArtifactKind {
  return kind === 'esis' || kind === 'credit_decision'
}

function jsonValue(input: string | undefined, field: string): unknown {
  if (!input) return {}
  try {
    return JSON.parse(input) as unknown
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: `${field} must be valid JSON` })
  }
}

interface ArtifactReplay {
  result: Record<string, unknown>
  document: Record<string, unknown>
}

interface ArtifactReplayScope {
  organizationId: string
  caseId: string
  applicationId: string
  commandId: string
  baseFingerprint: string
  expertOverrideReasonSha256: string | null
  fingerprint?: string
}

const replayFingerprintMismatchCode = 'mortgage_artifact_replay_fingerprint_mismatch'

function replayFingerprintMismatch(): never {
  throw createError({
    statusCode: 409,
    statusMessage: 'commandId was reused with different artifact data',
    data: { code: replayFingerprintMismatchCode },
  })
}

async function loadArtifactReplay(
  dataApi: any,
  scope: ArtifactReplayScope,
): Promise<ArtifactReplay | null> {
  const existingEventResult = await dataApi
    .from('crm_mortgage_application_events')
    .select('event_type, payload')
    .eq('organization_id', scope.organizationId)
    .eq('case_id', scope.caseId)
    .eq('application_id', scope.applicationId)
    .eq('command_id', scope.commandId)
    .maybeSingle()
  throwDbError(existingEventResult.error)
  if (!existingEventResult.data) return null

  const eventRow = asRecord(existingEventResult.data)
  const payload = asRecord(eventRow.payload)
  const priorResult = asRecord(payload.result)
  const priorCommand = asRecord(payload.command)
  const artifactId = typeof priorResult.artifactId === 'string' ? priorResult.artifactId : ''
  if (eventRow.event_type !== 'artifact_attached' || !artifactId) {
    throw createError({ statusCode: 409, statusMessage: 'commandId was already used for another operation' })
  }

  const existingArtifactResult = await dataApi
    .from('crm_mortgage_application_artifacts')
    .select('kind, document_id, document_sha256')
    .eq('organization_id', scope.organizationId)
    .eq('case_id', scope.caseId)
    .eq('application_id', scope.applicationId)
    .eq('id', artifactId)
    .maybeSingle()
  throwDbError(existingArtifactResult.error)
  const existingArtifact = existingArtifactResult.data as Record<string, unknown> | null
  if (!existingArtifact) {
    throw createError({ statusCode: 409, statusMessage: 'The prior artifact command has an incomplete legal ledger' })
  }

  let priorFingerprint = ''
  let priorBaseFingerprint = ''
  let priorOverrideReasonSha256: string | null = null
  try {
    priorFingerprint = mortgageArtifactReplayFingerprint({
      kind: existingArtifact.kind,
      sha256: existingArtifact.document_sha256,
      command: priorCommand,
    })
    const priorBaseCommand = withoutMortgageDocumentExpertReviewMetadata(priorCommand)
    priorOverrideReasonSha256 = priorBaseCommand.overrideReasonSha256
    priorBaseFingerprint = mortgageArtifactReplayFingerprint({
      kind: existingArtifact.kind,
      sha256: existingArtifact.document_sha256,
      command: priorBaseCommand.artifact,
    })
  }
  catch {
    throw createError({ statusCode: 409, statusMessage: 'The prior artifact command cannot be safely replayed' })
  }
  if (scope.fingerprint) {
    if (priorFingerprint !== scope.fingerprint) replayFingerprintMismatch()
  }
  else if (priorBaseFingerprint !== scope.baseFingerprint
    || (priorOverrideReasonSha256 !== null
      && priorOverrideReasonSha256 !== scope.expertOverrideReasonSha256)) {
    replayFingerprintMismatch()
  }
  if (priorCommand.documentId !== existingArtifact.document_id) {
    throw createError({ statusCode: 409, statusMessage: 'The prior artifact command does not match its pinned document' })
  }

  const existingDocumentResult = await dataApi
    .from('crm_documents')
    .select(caseDocumentPublicSelect)
    .eq('organization_id', scope.organizationId)
    .eq('case_id', scope.caseId)
    .eq('id', String(existingArtifact.document_id))
    .single()
  throwDbError(existingDocumentResult.error)
  return {
    result: priorResult,
    document: existingDocumentResult.data as Record<string, unknown>,
  }
}

async function cleanupUnpinnedReplayUpload(
  backendData: any,
  cleanupId: string,
): Promise<boolean> {
  const cleanup = await activateAndProcessCrmDocumentStorageCleanup(backendData, cleanupId)
  if (cleanup.state === 'retained') {
    console.error('[mortgage-artifacts] replay-conflict cleanup found a legal-ledger pin')
    return false
  }
  if (cleanup.state === 'failed' || cleanup.state === 'processing') {
    console.warn('[mortgage-artifacts] replay-conflict object cleanup remains durably queued')
  }
  return true
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const caseId = getRequiredParam(event, 'id')
  const applicationId = getRequiredParam(event, 'applicationId')
  assertUuid(applicationId, 'application id')
  await requireCrmCase(session, caseId)

  const contentLength = Number(getRequestHeader(event, 'content-length'))
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
    throw createError({ statusCode: 411, statusMessage: 'Content-Length is required for mortgage artifact uploads' })
  }
  if (contentLength > maxArtifactRequestBytes) {
    throw createError({ statusCode: 413, statusMessage: 'Multipart request is too large' })
  }

  const application = await loadCaseBankApplication(session, caseId, applicationId)
  if (!application) {
    throw createError({ statusCode: 404, statusMessage: 'Bank application not found' })
  }
  await requireCaseBankApplicationManager(session, caseId, application)
  // The canonical validation context RPC is service-only. Authorization is
  // deliberately completed before this backend client can read applicant names.
  const backendData = serverDataBackend(event) as any

  const parts = await readMultipartFormData(event)
  if (!parts) throw createError({ statusCode: 400, statusMessage: 'Multipart form data is required' })
  if (parts.length > allowedMultipartFields.size) {
    throw createError({ statusCode: 400, statusMessage: 'Too many multipart fields' })
  }
  for (const part of parts) {
    if (!part.name || !allowedMultipartFields.has(part.name)) {
      throw createError({ statusCode: 400, statusMessage: `Unsupported multipart field: ${part.name ?? '(unnamed)'}` })
    }
    if (!part.filename && part.data.length > 65_536) {
      throw createError({ statusCode: 413, statusMessage: `Multipart field ${part.name} is too large` })
    }
    if (parts.filter(candidate => candidate.name === part.name).length > 1) {
      throw createError({ statusCode: 400, statusMessage: `Multipart field ${part.name} must occur once` })
    }
  }
  const files = parts.filter(part => part.name === 'file' && part.filename)
  if (files.length !== 1 || !files[0]?.data.length) {
    throw createError({ statusCode: 400, statusMessage: 'Exactly one PDF file is required' })
  }
  const file = files[0]
  if (file.data.length > maxMortgageAiPdfBytes) {
    throw createError({ statusCode: 413, statusMessage: 'Plik PDF nie może przekraczać 4 MiB.' })
  }
  if (file.type !== 'application/pdf' || !hasValidCaseDocumentSignature('application/pdf', file.data)) {
    throw createError({ statusCode: 415, statusMessage: 'The source document must be a valid PDF' })
  }

  const kind = artifactKind(multipartText(parts, 'kind'))
  const commandId = multipartText(parts, 'commandId')
  const expectedRevision = Number(multipartText(parts, 'expectedRevision'))
  if (!commandId) throw createError({ statusCode: 400, statusMessage: 'commandId is required' })
  assertUuid(commandId, 'commandId')
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw createError({ statusCode: 400, statusMessage: 'expectedRevision must be a non-negative integer' })
  }

  const normalizedArtifact = normalizeMortgageArtifactPayload(
    jsonValue(multipartText(parts, 'artifact'), 'artifact'),
  )
  const expertOverrideReason = normalizeMortgageDocumentExpertOverrideReason(
    multipartText(parts, 'expertOverrideReason'),
    isAiValidatedArtifactKind(kind),
  )
  const artifactWithoutExpertReview = withMortgageDocumentExpertReviewMetadata(
    normalizedArtifact,
    null,
  )
  const deliveries = normalizeMortgageDeliveries(
    jsonValue(multipartText(parts, 'deliveries') ?? '[]', 'deliveries'),
  )

  const documentType = documentTypeByKind[kind]
  const sha256 = createHash('sha256').update(file.data).digest('hex')
  const baseReplayFingerprint = mortgageArtifactReplayFingerprint({
    kind,
    sha256,
    command: { type: 'attach_artifact', kind, ...artifactWithoutExpertReview, deliveries },
  })
  const expertOverrideReasonSha256 = expertOverrideReason
    ? mortgageDocumentExpertOverrideReasonSha256(expertOverrideReason)
    : null
  const earlyReplayScope: ArtifactReplayScope = {
    organizationId: session.organizationId,
    caseId,
    applicationId,
    commandId,
    baseFingerprint: baseReplayFingerprint,
    expertOverrideReasonSha256,
  }
  const existingReplay = await loadArtifactReplay(session.dataApi, earlyReplayScope)
  if (existingReplay) {
    return { data: { ...existingReplay.result, document: existingReplay.document } }
  }

  let aiValidation: MortgageDocumentValidationResult | null = null
  let aiValidationContext: Awaited<ReturnType<typeof loadMortgageDocumentValidationContext>> | null = null
  let aiAttemptId: string | null = null
  if (isAiValidatedArtifactKind(kind)) {
    aiValidationContext = await loadMortgageDocumentValidationContext(
      backendData,
      session.organizationId,
      caseId,
      applicationId,
      kind,
      artifactWithoutExpertReview,
    )
    const attemptScope: MortgageDocumentAiAttemptScope = {
      organizationId: session.organizationId,
      caseId,
      applicationId,
      actorUserId: session.userId,
      kind,
      sourceSha256: sha256,
      applicantContextSha256: aiValidationContext.applicantContextSha256,
      bankContextSha256: aiValidationContext.bankContextSha256,
      expectationSha256: aiValidationContext.expectationSha256,
      decisionOutcome: aiValidationContext.decisionOutcome,
      validUntil: aiValidationContext.validUntil,
    }
    const attempt = await runOrReplayMortgageDocumentAiAttempt(
      backendData,
      attemptScope,
      async () => {
        const runtimeConfig = useRuntimeConfig(event)
        try {
          return await analyzeMortgageDocumentPdf({
            bytes: file.data,
            expectation: aiValidationContext!.expectation,
            aiGatewayApiKey: String(runtimeConfig.aiGatewayApiKey ?? '').trim(),
          })
        }
        catch (error) {
          if (error instanceof MortgageDocumentAiValidationError && error.code === 'invalid_input') {
            throw createError({
              statusCode: 400,
              statusMessage: 'Dane dokumentu wymagane do automatycznej analizy są niepełne lub nieprawidłowe.',
            })
          }
          console.error('[mortgage-artifacts] AI validation unavailable', {
            errorName: error instanceof Error ? error.name : 'UnknownError',
          })
          throw createError({
            statusCode: 503,
            statusMessage: 'Automatyczna analiza dokumentu jest chwilowo niedostępna. Plik nie został zapisany — spróbuj ponownie po dwóch minutach.',
          })
        }
      },
    )
    if (attempt.state === 'in_progress') {
      throw createError({
        statusCode: 409,
        statusMessage: 'Ten dokument jest już analizowany. Odczekaj chwilę i spróbuj ponownie — plik pozostanie w formularzu.',
        data: {
          code: 'mortgage_document_analysis_in_progress',
          leaseExpiresAt: attempt.leaseExpiresAt,
        },
      })
    }
    aiAttemptId = attempt.attemptId
    aiValidation = attempt.validation
    if (aiValidation.verdict === 'rejected'
      || (aiValidation.verdict === 'needs_review' && !expertOverrideReason)) {
      const reasonCodes = aiValidation.reasonCodes.slice(0, 5)
      const reasonLabels = reasonCodes.map(
        code => aiValidationReasonLabels[code] ?? 'dokument wymaga dodatkowej weryfikacji',
      )
      const reasons = reasonLabels.length
        ? ` Wykryte problemy: ${reasonLabels.join('; ')}.`
        : ''
      const requiresExpertOverride = aiValidation.verdict === 'needs_review'
      throw createError({
        statusCode: 422,
        statusMessage: `${aiValidation.safeSummary}${reasons} Plik nie został zapisany.`,
        data: {
          code: requiresExpertOverride
            ? 'mortgage_document_needs_review'
            : 'mortgage_document_rejected',
          verdict: aiValidation.verdict,
          requiresExpertOverride,
          safeSummary: aiValidation.safeSummary,
          reasonCodes,
          reasonLabels,
        },
      })
    }
  }

  const expertOverrideApplied = aiValidation?.verdict === 'needs_review'
  const artifact = withMortgageDocumentExpertReviewMetadata(
    artifactWithoutExpertReview,
    expertOverrideApplied ? expertOverrideReason : null,
  )
  const replayScope: ArtifactReplayScope = {
    ...earlyReplayScope,
    fingerprint: mortgageArtifactReplayFingerprint({
      kind,
      sha256,
      command: { type: 'attach_artifact', kind, ...artifact, deliveries },
    }),
  }

  const storagePath = `${session.organizationId}/${caseId}/${randomUUID()}.pdf`
  const receivedAt = new Date().toISOString()
  const originalName = safeOriginalFileName(file.filename, `${documentType}.pdf`)
  // Reserve the opaque object path before crossing the Storage boundary. A
  // provider can persist bytes and still lose its response; the scheduled
  // worker will reconcile this intent with the document/artifact ledger.
  const cleanupIntent = await reserveCrmDocumentStorageCleanup(backendData, {
    organizationId: session.organizationId,
    caseId,
    applicationId,
    storagePath,
  })

  const { error: uploadError } = await backendData.storage
    .from(caseDocumentBucket)
    .upload(storagePath, file.data, {
      contentType: 'application/pdf',
      cacheControl: '0',
      upsert: false,
    })
  if (uploadError) {
    await activateAndProcessCrmDocumentStorageCleanup(backendData, cleanupIntent.id)
      .catch(() => undefined)
    throw createError({ statusCode: 500, statusMessage: 'Document upload failed' })
  }

  const documentResult = await backendData
    .from('crm_documents')
    .insert({
      organization_id: session.organizationId,
      case_id: caseId,
      case_item_id: application.case_item_id,
      submission_id: applicationId,
      client_id: null,
      document_type: documentType,
      name: originalName,
      status_code: 'received',
      storage_bucket: caseDocumentBucket,
      storage_path: storagePath,
      uploaded_by_user_id: session.userId,
      mime_type: 'application/pdf',
      size_bytes: file.data.length,
      sha256,
      received_at: receivedAt,
      metadata: {
        mortgageArtifactKind: kind,
        mortgageArtifactCommandId: commandId,
        uploadedForApplicationId: applicationId,
      },
    })
    .select(caseDocumentPublicSelect)
    .single()

  if (documentResult.error || !documentResult.data) {
    await activateAndProcessCrmDocumentStorageCleanup(backendData, cleanupIntent.id)
      .catch(() => undefined)
    throwDbError(documentResult.error)
    throw createError({ statusCode: 500, statusMessage: 'Document metadata could not be saved' })
  }

  if (aiValidation && aiValidationContext && aiAttemptId) {
    const validationResult = await backendData
      .from('crm_mortgage_document_ai_validations')
      .insert({
        ai_attempt_id: aiAttemptId,
        organization_id: session.organizationId,
        case_id: caseId,
        application_id: applicationId,
        document_id: documentResult.data.id,
        expected_kind: kind,
        source_sha256: sha256,
        applicant_context_sha256: aiValidationContext.applicantContextSha256,
        bank_context_sha256: aiValidationContext.bankContextSha256,
        expectation_sha256: aiValidationContext.expectationSha256,
        validated_bank_id: aiValidationContext.bankId,
        validated_offer_id: aiValidationContext.offerId,
        validated_decision_outcome: aiValidationContext.decisionOutcome,
        validated_valid_until: aiValidationContext.validUntil,
        validated_loan_amount: aiValidationContext.loanAmount,
        validated_currency: aiValidationContext.currency,
        verdict: aiValidation.verdict,
        provider: aiValidation.provider,
        model: aiValidation.model,
        prompt_version: aiValidation.promptVersion,
        confidence: aiValidation.confidence,
        reason_codes: aiValidation.reasonCodes,
        pii_free_observations: mortgageDocumentValidationPiiFreeObservations(aiValidation),
        expert_override_reason: expertOverrideApplied ? expertOverrideReason : null,
        expert_overridden_by_user_id: expertOverrideApplied ? session.userId : null,
      })
      .select('id')
      .single()
    if (validationResult.error || !validationResult.data) {
      await activateAndProcessCrmDocumentStorageCleanup(backendData, cleanupIntent.id)
        .catch(() => undefined)
      throwDbError(validationResult.error)
      throw createError({ statusCode: 500, statusMessage: 'Wynik analizy dokumentu nie mógł zostać zapisany.' })
    }
  }

  let result: Awaited<ReturnType<typeof executeMortgageArtifactAttachmentCommand>>
  try {
    result = await executeMortgageArtifactAttachmentCommand(
      event,
      session,
      caseId,
      applicationId,
      {
        commandId,
        expectedRevision,
        command: {
          ...artifact,
          type: 'attach_artifact',
          kind,
          documentId: String(documentResult.data.id),
          deliveries,
        },
      },
    )

  }
  catch (error) {
    // The RPC may have committed even if its response was interrupted. Resolve
    // the command ledger before considering any cleanup of the uploaded file.
    let committedReplay: ArtifactReplay | null = null
    try {
      committedReplay = await loadArtifactReplay(backendData, replayScope)
    }
    catch (replayError) {
      try {
        await cleanupUnpinnedReplayUpload(
          backendData,
          cleanupIntent.id,
        )
      }
      catch {
        console.error('[mortgage-artifacts] replay-conflict cleanup failed before pin state was resolved')
      }
      throw replayError
    }
    if (committedReplay) {
      // Two identical requests can both finish AI analysis and upload before
      // the first command commits. The replay belongs to only one document;
      // remove the losing request's unpinned PDF and validation before return.
      if (String(committedReplay.document.id) !== String(documentResult.data.id)) {
        let cleaned = false
        try {
          cleaned = await cleanupUnpinnedReplayUpload(
            backendData,
            cleanupIntent.id,
          )
        }
        catch {
          console.error('[mortgage-artifacts] concurrent replay cleanup failed before pin state was resolved')
        }
        if (!cleaned) {
          throw error
        }
      }
      else {
        await retainCrmDocumentStorageCleanup(
          backendData,
          cleanupIntent.id,
          String(documentResult.data.id),
        ).catch(() => {
          console.warn('[mortgage-artifacts] artifact cleanup intent awaits ledger reconciliation')
        })
      }
      return { data: { ...committedReplay.result, document: committedReplay.document } }
    }

    // The cleanup worker owns the final pin check and metadata deletion in one
    // transaction. If a concurrent command committed, preparation retains the
    // document; otherwise the durable job removes it and retries Storage.
    await activateAndProcessCrmDocumentStorageCleanup(backendData, cleanupIntent.id)
      .catch(() => {
        console.warn('[mortgage-artifacts] uploaded object cleanup remains durably queued')
      })
    throw error
  }

  await retainCrmDocumentStorageCleanup(
    backendData,
    cleanupIntent.id,
    String(documentResult.data.id),
  ).catch(() => {
    // The artifact FK is already the source of truth. A retained-intent write
    // lost at this point is reconciled safely by the scheduled worker.
    console.warn('[mortgage-artifacts] artifact cleanup intent awaits ledger reconciliation')
  })

  // The artifact and its pinned file are already part of the legal ledger.
  // A secondary activity-feed failure must never remove that source file.
  try {
    await recordCrmActivity(session, {
      case_id: caseId,
      case_item_id: String(application.case_item_id),
      submission_id: applicationId,
      activity_type: 'mortgage_application_artifact_attached',
      title: activityByKind[kind],
      payload: {
        application_id: applicationId,
        artifact_id: result.artifactId,
        artifact_kind: kind,
        document_id: documentResult.data.id,
        ai_validation: aiValidation
          ? {
              verdict: aiValidation.verdict,
              provider: aiValidation.provider,
              model: aiValidation.model,
              prompt_version: aiValidation.promptVersion,
              confidence: aiValidation.confidence,
              reason_codes: aiValidation.reasonCodes,
              expert_override_applied: aiValidation.verdict === 'needs_review',
            }
          : null,
        revision: result.revision,
      },
    })
  }
  catch (error) {
    console.error('[mortgage-artifacts] failed to record secondary CRM activity', error)
  }

  return {
    data: {
      ...result,
      document: documentResult.data,
      aiValidation: aiValidation
        ? {
            verdict: aiValidation.verdict,
            provider: aiValidation.provider,
            model: aiValidation.model,
            promptVersion: aiValidation.promptVersion,
            confidence: aiValidation.confidence,
            reasonCodes: aiValidation.reasonCodes,
            expertOverrideApplied: aiValidation.verdict === 'needs_review',
          }
        : null,
    },
  }
})
