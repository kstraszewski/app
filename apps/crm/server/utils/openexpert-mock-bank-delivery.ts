import {
  createTransactionalEmailSender,
  EmailDeliveryError,
} from '@openexpert/email'
import { createError, type H3Event } from 'h3'
import { serverDataBackend } from './data-api.ts'
import { serverStorageClient } from './platform-storage.ts'
import {
  createOpenExpertMockBankCreditDecisionPdf,
  createOpenExpertMockBankEncryptedArchive,
  createOpenExpertMockBankEsisPdf,
  extractOpenExpertMockBankEncryptedArchive,
  MAX_OPENEXPERT_MOCK_BANK_PDF_BYTES,
  openExpertMockBankArchiveFileName,
  openExpertMockBankEsisTextMatchesDocument,
  openExpertMockBankPdfFileName,
  resolveOpenExpertMockBankDocumentDates,
  type OpenExpertMockBankDocumentKind,
} from './openexpert-mock-bank-documents.ts'
import { extractBoundedPdfText } from './bounded-pdf-text.ts'
import {
  OPENEXPERT_MOCK_BANK_EMAIL_TEMPLATE_VERSION,
  openExpertMockBankEmailIdempotencyKey,
} from './openexpert-mock-bank-email.ts'
import {
  assertOpenExpertMockBankManifestDeliveryIdentity,
  deliverOpenExpertMockBankPayloadSnapshot,
  loadCommittedOpenExpertMockBankPayload,
  type OpenExpertMockBankPersistedPayload,
} from './openexpert-mock-bank-delivery-core.ts'
import {
  commitOpenExpertMockBankDispatchPayload,
  renewOpenExpertMockBankDispatchSendLease,
  type OpenExpertMockBankDispatchReservation,
} from './openexpert-mock-bank-dispatch.ts'
import {
  decodeOpenExpertMockBankPayloadManifest,
  encodeOpenExpertMockBankPayloadManifest,
  loadOpenExpertMockBankObject,
  OPENEXPERT_MOCK_BANK_MANIFEST_MEDIA_TYPE,
  openExpertMockBankFullPayloadSha256,
  openExpertMockBankGenerationContextSha256,
  OpenExpertMockBankPayloadError,
  persistOrRecoverOpenExpertMockBankObject,
  type OpenExpertMockBankPayloadIdentity,
  type OpenExpertMockBankPersistedPayloadManifest,
  type OpenExpertMockBankStoredObject,
} from './openexpert-mock-bank-payload.ts'
import {
  loadMortgageDocumentValidationContext,
  type MortgageDocumentValidationContext,
} from './mortgage-document-validation-context.ts'
import {
  openExpertMockBankEmailConfig,
  type OpenExpertMockBankContext,
  type OpenExpertMockBankEmailConfig,
} from './openexpert-mock-bank-service.ts'
import { loadIntermediaryDocumentFont } from './intermediary-documents.ts'
import { renderOpenExpertMockBankEmail } from './system-email-content.ts'

export interface OpenExpertMockBankDeliveryResult {
  providerMessageId: string
  archiveFileName: string
  pdfFileName: string
  issueDate: string
  validUntil: string | null
  decisionOutcome: 'positive' | null
}

function uncommittedPayloadInvalid(): never {
  throw createError({
    statusCode: 409,
    statusMessage: 'crm_mock_bank_uncommitted_payload_invalid',
  })
}

async function uncommittedStorageRead<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  }
  catch (error) {
    if (error instanceof OpenExpertMockBankPayloadError) uncommittedPayloadInvalid()
    throw error
  }
}

function decodeUncommittedManifest(
  bytes: Uint8Array,
  identity: OpenExpertMockBankPayloadIdentity,
): OpenExpertMockBankPersistedPayloadManifest {
  try {
    const manifest = decodeOpenExpertMockBankPayloadManifest(bytes, identity)
    assertOpenExpertMockBankManifestDeliveryIdentity(manifest)
    return manifest
  }
  catch {
    uncommittedPayloadInvalid()
  }
}

function safeProviderDeliveryFailureReason(error: EmailDeliveryError): string {
  return error.message
    .replace(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/giu, '[redacted-email]')
    .replace(/\bre_[a-z0-9_-]+\b/giu, '[redacted-api-key]')
    .replace(/\b\d{11}\b/gu, '[redacted-private-id]')
    .slice(0, 500)
}

function senderConfig(input: {
  runtime: OpenExpertMockBankEmailConfig
  from?: string | null
  replyTo?: string | null
  provider?: 'resend' | 'smtp'
}) {
  return createTransactionalEmailSender({
    apiKey: input.provider === 'smtp' ? undefined : input.runtime.apiKey,
    from: input.from ?? input.runtime.from,
    replyTo: input.replyTo === null ? undefined : input.replyTo ?? input.runtime.replyTo,
    smtp: input.provider === 'resend'
      ? undefined
      : input.runtime.smtp?.host
        ? {
            host: input.runtime.smtp.host,
            port: input.runtime.smtp.port,
            secure: input.runtime.smtp.secure,
            user: input.runtime.smtp.user || undefined,
            password: input.runtime.smtp.password || undefined,
          }
        : undefined,
  })
}

function currentSender(event: H3Event, organizationId: string) {
  const runtime = openExpertMockBankEmailConfig(event, organizationId)
  return { runtime, sender: senderConfig({ runtime }) }
}

export function requireOpenExpertMockBankDeliveryConfigured(
  event: H3Event,
  organizationId: string,
): void {
  if (!currentSender(event, organizationId).sender.isConfigured) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Wysyłka e-mail OpenExpert Banku nie jest skonfigurowana.',
    })
  }
}

function identityFromReservation(
  reservation: OpenExpertMockBankDispatchReservation,
): OpenExpertMockBankPayloadIdentity {
  return {
    dispatchId: reservation.dispatchId,
    payloadId: reservation.payloadId,
    applicationId: reservation.applicationId,
    applicationNumber: reservation.applicationNumber,
    kind: reservation.kind,
    generation: reservation.generation,
    generationStartedAt: reservation.generationStartedAt,
  }
}

function generationDocumentDates(input: {
  context: OpenExpertMockBankContext
  reservation: OpenExpertMockBankDispatchReservation
}) {
  return resolveOpenExpertMockBankDocumentDates({
    now: new Date(input.reservation.generationStartedAt),
    decisionDueAt: input.context.process.decisionDueAt,
  })
}

async function loadEsisGenerationValidation(input: {
  event: H3Event
  organizationId: string
  caseId: string
  context: OpenExpertMockBankContext
  reservation: OpenExpertMockBankDispatchReservation
}): Promise<MortgageDocumentValidationContext> {
  const dates = generationDocumentDates(input)
  const validation = await loadMortgageDocumentValidationContext(
    serverDataBackend(input.event) as any,
    input.organizationId,
    input.caseId,
    input.context.applicationId,
    'esis',
    { validUntil: `${dates.esisValidUntil}T00:00:00.000Z` },
  )
  if (validation.bankId !== String(input.context.application.bank_id)
    || validation.offerId !== String(input.context.application.offer_id)
    || validation.validUntil?.slice(0, 10) !== dates.esisValidUntil
    || validation.loanAmount !== input.context.loanAmount
    || validation.currency !== input.context.currency) {
    throw createError({
      statusCode: 409,
      statusMessage: 'crm_mock_bank_generation_context_changed',
    })
  }
  return validation
}

function sameOrderedText(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function assertManifestGenerationContext(input: {
  manifest: OpenExpertMockBankPersistedPayloadManifest
  context: OpenExpertMockBankContext
  reservation: OpenExpertMockBankDispatchReservation
  validation: MortgageDocumentValidationContext | null
}): void {
  const dates = generationDocumentDates(input)
  const document = input.manifest.document
  const expectedValidUntil = input.manifest.identity.kind === 'esis'
    ? dates.esisValidUntil
    : dates.decisionValidUntil
  const expectedApplicants = input.validation?.expectation.applicantNames
    ?? input.context.applicantNames
  const terms = document.financialTerms
  if (document.issueDate !== dates.issueDate
    || document.validUntil !== expectedValidUntil
    || !sameOrderedText(document.applicantNames, expectedApplicants)
    || terms.loanAmount !== input.context.loanAmount
    || terms.currency !== input.context.currency
    || terms.annualInterestRate !== input.context.interestRatePct
    || terms.aprc !== input.context.aprcPct
    || terms.monthlyInstallment !== input.context.monthlyInstallment
    || terms.termMonths !== input.context.termMonths) {
    throw createError({
      statusCode: 409,
      statusMessage: 'crm_mock_bank_generation_context_changed',
    })
  }
  if (input.manifest.version === 2
    && input.manifest.generationContextSha256 !== openExpertMockBankGenerationContextSha256({
      identity: input.manifest.identity,
      document,
    })) {
    throw createError({ statusCode: 500, statusMessage: 'Hash kontekstu generacji jest niespójny.' })
  }
}

async function buildManifest(input: {
  event: H3Event
  organizationId: string
  context: OpenExpertMockBankContext
  kind: OpenExpertMockBankDocumentKind
  recipientEmail: string
  reservation: OpenExpertMockBankDispatchReservation
  validation: MortgageDocumentValidationContext | null
}): Promise<OpenExpertMockBankPersistedPayloadManifest> {
  const { runtime, sender } = currentSender(input.event, input.organizationId)
  if (!sender.isConfigured || !sender.provider || !runtime.from?.trim()) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Wysyłka e-mail OpenExpert Banku nie jest skonfigurowana.',
    })
  }
  const dates = generationDocumentDates(input)
  const validUntil = input.kind === 'esis' ? dates.esisValidUntil : dates.decisionValidUntil
  const applicantNames = input.validation?.expectation.applicantNames
    ?? input.context.applicantNames
  const template = await renderOpenExpertMockBankEmail({
    kind: input.kind,
    applicationNumber: input.context.applicationNumber,
    applicantNames,
    issueDate: dates.issueDate,
    validUntil,
    ...(input.kind === 'credit_decision' ? { decisionOutcome: 'positive' as const } : {}),
    archiveName: openExpertMockBankArchiveFileName(input.kind, input.context.applicationNumber),
  })
  const identity = identityFromReservation(input.reservation)
  const document: OpenExpertMockBankPersistedPayloadManifest['document'] = {
    pdfFileName: openExpertMockBankPdfFileName(input.kind, input.context.applicationNumber),
    issueDate: dates.issueDate,
    validUntil: input.kind === 'esis' ? dates.esisValidUntil : dates.decisionValidUntil,
    decisionOutcome: input.kind === 'credit_decision' ? 'positive' : null,
    applicantNames: [...applicantNames],
    financialTerms: {
      loanAmount: input.context.loanAmount,
      currency: input.context.currency,
      annualInterestRate: input.context.interestRatePct,
      aprc: input.context.aprcPct,
      monthlyInstallment: input.context.monthlyInstallment,
      termMonths: input.context.termMonths,
    },
  }
  const generationContextSha256 = openExpertMockBankGenerationContextSha256({
    identity,
    document,
  })
  return {
    version: 2,
    generationContextSha256,
    identity,
    transport: {
      provider: sender.provider,
      from: runtime.from.trim(),
      replyTo: runtime.replyTo?.trim() || null,
    },
    message: {
      to: input.recipientEmail,
      ...template,
      idempotencyKey: openExpertMockBankEmailIdempotencyKey(
        input.kind,
        input.reservation.dispatchId,
        input.reservation.generation,
      ),
      tags: [
        {
          name: 'email_type',
          value: input.kind === 'esis' ? 'mock_bank_esis' : 'mock_bank_decision',
        },
        {
          name: 'bank_event',
          value: input.kind === 'esis' ? 'esis_available' : 'credit_decision_issued',
        },
        { name: 'bank_slug', value: 'openexpert_bank' },
        { name: 'template_version', value: String(OPENEXPERT_MOCK_BANK_EMAIL_TEMPLATE_VERSION) },
        { name: 'application_id', value: input.context.applicationId },
      ],
      attachment: {
        filename: openExpertMockBankArchiveFileName(
          input.kind,
          input.context.applicationNumber,
        ),
        contentType: 'application/zip',
      },
    },
    document,
  }
}

async function buildArchive(
  manifest: OpenExpertMockBankPersistedPayloadManifest,
  pesel: string,
): Promise<Uint8Array> {
  const fontBytes = await loadIntermediaryDocumentFont()
  const common = {
    applicationNumber: manifest.identity.applicationNumber,
    applicantNames: manifest.document.applicantNames,
    issueDate: manifest.document.issueDate,
    financialTerms: manifest.document.financialTerms,
    fontBytes,
  }
  const document = manifest.identity.kind === 'esis'
    ? await createOpenExpertMockBankEsisPdf({
        ...common,
        validUntil: manifest.document.validUntil!,
      })
    : await createOpenExpertMockBankCreditDecisionPdf({
        ...common,
        outcome: manifest.document.decisionOutcome ?? 'positive',
        validUntil: manifest.document.validUntil,
      })
  const archive = await createOpenExpertMockBankEncryptedArchive({ document, pesel })
  if (archive.fileName !== manifest.message.attachment.filename
    || archive.entryName !== manifest.document.pdfFileName) {
    throw createError({ statusCode: 500, statusMessage: 'Wygenerowany payload OpenExpert Banku jest niespójny.' })
  }
  return archive.bytes
}

async function assertArchiveMatchesManifest(input: {
  archiveBytes: Uint8Array
  manifest: OpenExpertMockBankPersistedPayloadManifest
  pesel: string
}): Promise<void> {
  let stage:
    | 'archive_extract'
    | 'archive_entry'
    | 'pdf_text_extract'
    | 'pdf_semantic_match' = 'archive_extract'
  try {
    const extracted = await extractOpenExpertMockBankEncryptedArchive({
      bytes: input.archiveBytes,
      kind: input.manifest.identity.kind,
      applicationNumber: input.manifest.identity.applicationNumber,
      pesel: input.pesel,
    })
    stage = 'archive_entry'
    if (extracted.fileName !== input.manifest.document.pdfFileName) {
      throw new TypeError('archive entry mismatch')
    }
    if (input.manifest.identity.kind !== 'esis') return
    stage = 'pdf_text_extract'
    const inspected = await extractBoundedPdfText({
      bytes: extracted.bytes,
      maxBytes: MAX_OPENEXPERT_MOCK_BANK_PDF_BYTES,
    })
    stage = 'pdf_semantic_match'
    if (!openExpertMockBankEsisTextMatchesDocument({
      text: inspected.text,
      pageCount: inspected.pageCount,
      applicationNumber: input.manifest.identity.applicationNumber,
      applicantNames: input.manifest.document.applicantNames,
      issueDate: input.manifest.document.issueDate,
      validUntil: input.manifest.document.validUntil!,
      financialTerms: input.manifest.document.financialTerms,
    })) {
      throw new TypeError('archive document mismatch')
    }
  }
  catch (error) {
    // The document and credential are deliberately absent from telemetry.
    // This bounded stage code distinguishes packaging/runtime failures from
    // semantic mismatches without exposing mail content, names, terms or PESEL.
    console.error('[openexpert-mock-bank] uncommitted payload validation failed', {
      stage,
      error: error instanceof Error ? error.name : 'unknown',
    })
    uncommittedPayloadInvalid()
  }
}

interface OpenExpertMockBankDeliveryDependencies {
  storage: ReturnType<typeof serverStorageClient>
  configuredSender: ReturnType<typeof senderConfig>
  senderForPayload(input: {
    from: string
    replyTo: string | null
    provider: 'resend' | 'smtp'
  }): ReturnType<typeof senderConfig>
  loadGenerationValidation: typeof loadEsisGenerationValidation
  buildPayloadManifest: typeof buildManifest
  buildPayloadArchive: typeof buildArchive
  commitPayload: typeof commitOpenExpertMockBankDispatchPayload
  renewSendLease: typeof renewOpenExpertMockBankDispatchSendLease
}

function defaultDeliveryDependencies(
  event: H3Event,
  organizationId: string,
): OpenExpertMockBankDeliveryDependencies {
  const { runtime, sender } = currentSender(event, organizationId)
  return {
    storage: serverStorageClient(event),
    configuredSender: sender,
    senderForPayload: transport => senderConfig({ runtime, ...transport }),
    loadGenerationValidation: loadEsisGenerationValidation,
    buildPayloadManifest: buildManifest,
    buildPayloadArchive: buildArchive,
    commitPayload: commitOpenExpertMockBankDispatchPayload,
    renewSendLease: renewOpenExpertMockBankDispatchSendLease,
  }
}

async function createOrRecoverPayload(input: {
  event: H3Event
  organizationId: string
  caseId: string
  context: OpenExpertMockBankContext
  kind: OpenExpertMockBankDocumentKind
  recipientEmail: string
  reservation: OpenExpertMockBankDispatchReservation
  requestId: string
}, dependencies: OpenExpertMockBankDeliveryDependencies): Promise<OpenExpertMockBankPersistedPayload> {
  const storage = dependencies.storage
  const identity = identityFromReservation(input.reservation)
  const validation = input.kind === 'esis'
    ? await dependencies.loadGenerationValidation(input)
    : null

  let manifestObject: OpenExpertMockBankStoredObject | null
  manifestObject = await uncommittedStorageRead(() => loadOpenExpertMockBankObject({
    storage,
    path: input.reservation.manifestStoragePath,
    contentType: OPENEXPERT_MOCK_BANK_MANIFEST_MEDIA_TYPE,
  }))
  if (!manifestObject) {
    const generatedManifest = await dependencies.buildPayloadManifest({ ...input, validation })
    manifestObject = await uncommittedStorageRead(() => persistOrRecoverOpenExpertMockBankObject({
      storage,
      path: input.reservation.manifestStoragePath,
      contentType: OPENEXPERT_MOCK_BANK_MANIFEST_MEDIA_TYPE,
      bytes: encodeOpenExpertMockBankPayloadManifest(generatedManifest),
    }))
  }
  // Persist may lose a first-writer race and recover an already stored
  // immutable object. Always decode the stored winner, never keep using the
  // locally generated candidate.
  const manifest = decodeUncommittedManifest(manifestObject.bytes, identity)
  assertManifestGenerationContext({ ...input, manifest, validation })

  let archiveObject: OpenExpertMockBankStoredObject | null
  archiveObject = await uncommittedStorageRead(() => loadOpenExpertMockBankObject({
    storage,
    path: input.reservation.archiveStoragePath,
    contentType: 'application/zip',
  }))
  if (!archiveObject) {
    const generatedArchive = await dependencies.buildPayloadArchive(manifest, input.context.pesel)
    archiveObject = await uncommittedStorageRead(() => persistOrRecoverOpenExpertMockBankObject({
      storage,
      path: input.reservation.archiveStoragePath,
      contentType: 'application/zip',
      bytes: generatedArchive,
    }))
  }
  // A provider-generic upload conflict is recovered by downloading the exact
  // immutable path. Validate that winner before binding its hashes to the
  // ledger; AES salts make comparing it with a freshly generated ZIP invalid.
  await assertArchiveMatchesManifest({
    archiveBytes: archiveObject.bytes,
    manifest,
    pesel: input.context.pesel,
  })
  const payloadSha256 = openExpertMockBankFullPayloadSha256({
    manifestBytes: manifestObject.bytes,
    archiveBytes: archiveObject.bytes,
  })
  const committed = await dependencies.commitPayload({
    event: input.event,
    dispatchId: input.reservation.dispatchId,
    requestId: input.requestId,
    generation: input.reservation.generation,
    manifestSha256: manifestObject.sha256,
    manifestSizeBytes: manifestObject.sizeBytes,
    archiveSha256: archiveObject.sha256,
    archiveSizeBytes: archiveObject.sizeBytes,
    payloadSha256,
    ...(manifest.version === 2 && input.kind === 'esis' && validation
      ? {
          generationContext: {
            organizationId: input.organizationId,
            caseId: input.caseId,
            applicationId: input.context.applicationId,
            kind: 'esis' as const,
            recipientConnectionId: input.reservation.recipientConnectionId!,
            applicantContextSha256: validation.applicantContextSha256,
            bankContextSha256: validation.bankContextSha256,
            expectationSha256: validation.expectationSha256,
            validUntil: `${manifest.document.validUntil}T00:00:00.000Z`,
            generationContextSha256: manifest.generationContextSha256,
          },
        }
      : {}),
  })
  if (committed.payloadSha256 !== payloadSha256
    || committed.manifestSha256 !== manifestObject.sha256
    || committed.archiveSha256 !== archiveObject.sha256) {
    throw createError({ statusCode: 500, statusMessage: 'Commit payloadu OpenExpert Banku jest niespójny.' })
  }
  return { manifest, manifestObject, archiveObject, payloadSha256 }
}

export async function deliverOpenExpertMockBankDocument(input: {
  event: H3Event
  organizationId: string
  caseId: string
  context: OpenExpertMockBankContext
  kind: OpenExpertMockBankDocumentKind
  recipientEmail: string
  reservation: OpenExpertMockBankDispatchReservation
  requestId: string
}): Promise<OpenExpertMockBankDeliveryResult> {
  const dependencies = defaultDeliveryDependencies(input.event, input.organizationId)
  if (!dependencies.configuredSender.isConfigured) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Wysyłka e-mail OpenExpert Banku nie jest skonfigurowana.',
    })
  }

  try {
    return await deliverOpenExpertMockBankPayloadSnapshot({
      committed: Boolean(input.reservation.payloadReadyAt),
      expectedRecipientConnectionId: input.reservation.recipientConnectionId,
      loadCommitted: () => loadCommittedOpenExpertMockBankPayload({
        storage: dependencies.storage,
        reservation: input.reservation,
      }),
      createUncommitted: () => createOrRecoverPayload(input, dependencies),
      senderForPayload: dependencies.senderForPayload,
      renewSendLease: () => dependencies.renewSendLease({
        event: input.event,
        dispatchId: input.reservation.dispatchId,
        requestId: input.requestId,
        generation: input.reservation.generation,
      }),
    })
  }
  catch (error) {
    if (error instanceof EmailDeliveryError) {
      console.error('[openexpert-mock-bank] document email delivery failed', {
        applicationId: input.context.applicationId,
        kind: input.kind,
        generation: input.reservation.generation,
        provider: error.provider,
        retryable: error.retryable,
        statusCode: error.statusCode,
        reason: safeProviderDeliveryFailureReason(error),
      })
      throw createError({
        statusCode: error.retryable ? 503 : 502,
        statusMessage: 'OpenExpert Bank nie mógł wysłać dokumentu. Spróbuj ponownie.',
      })
    }
    throw error
  }
}
