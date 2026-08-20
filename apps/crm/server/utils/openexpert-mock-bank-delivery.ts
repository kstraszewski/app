import {
  createTransactionalEmailSender,
  EmailDeliveryError,
} from '@openexpert/email'
import { createError, type H3Event } from 'h3'
import { serverStorageClient } from './platform-storage.ts'
import {
  createOpenExpertMockBankCreditDecisionPdf,
  createOpenExpertMockBankEncryptedArchive,
  createOpenExpertMockBankEsisPdf,
  openExpertMockBankArchiveFileName,
  openExpertMockBankPdfFileName,
  resolveOpenExpertMockBankDocumentDates,
  verifyOpenExpertMockBankEncryptedArchive,
  type OpenExpertMockBankDocumentKind,
} from './openexpert-mock-bank-documents.ts'
import {
  OPENEXPERT_MOCK_BANK_EMAIL_TEMPLATE_VERSION,
  openExpertMockBankEmailIdempotencyKey,
  openExpertMockBankEmailTemplate,
} from './openexpert-mock-bank-email.ts'
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
  persistOrRecoverOpenExpertMockBankObject,
  discardEmptyUncommittedOpenExpertMockBankObject,
  type OpenExpertMockBankPayloadIdentity,
  type OpenExpertMockBankPersistedPayloadManifest,
  type OpenExpertMockBankStoredObject,
} from './openexpert-mock-bank-payload.ts'
import {
  openExpertMockBankEmailConfig,
  type OpenExpertMockBankContext,
  type OpenExpertMockBankEmailConfig,
} from './openexpert-mock-bank-service.ts'
import { loadIntermediaryDocumentFont } from './intermediary-documents.ts'

export interface OpenExpertMockBankDeliveryResult {
  providerMessageId: string
  archiveFileName: string
  pdfFileName: string
  issueDate: string
  validUntil: string | null
  decisionOutcome: 'positive' | null
}

interface PersistedPayload {
  manifest: OpenExpertMockBankPersistedPayloadManifest
  manifestObject: OpenExpertMockBankStoredObject
  archiveObject: OpenExpertMockBankStoredObject
  payloadSha256: string
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

function buildManifest(input: {
  event: H3Event
  organizationId: string
  context: OpenExpertMockBankContext
  kind: OpenExpertMockBankDocumentKind
  recipientEmail: string
  reservation: OpenExpertMockBankDispatchReservation
}): OpenExpertMockBankPersistedPayloadManifest {
  const { runtime, sender } = currentSender(input.event, input.organizationId)
  if (!sender.isConfigured || !sender.provider || !runtime.from?.trim()) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Wysyłka e-mail OpenExpert Banku nie jest skonfigurowana.',
    })
  }
  const dates = resolveOpenExpertMockBankDocumentDates({
    now: new Date(input.reservation.generationStartedAt),
    decisionDueAt: input.context.process.decisionDueAt,
  })
  const template = openExpertMockBankEmailTemplate({
    kind: input.kind,
    applicationNumber: input.context.applicationNumber,
    applicantNames: input.context.applicantNames,
    issueDate: dates.issueDate,
    validUntil: input.kind === 'esis' ? dates.esisValidUntil : dates.decisionValidUntil,
    ...(input.kind === 'credit_decision' ? { decisionOutcome: 'positive' as const } : {}),
  })
  return {
    version: 1,
    identity: identityFromReservation(input.reservation),
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
    document: {
      pdfFileName: openExpertMockBankPdfFileName(input.kind, input.context.applicationNumber),
      issueDate: dates.issueDate,
      validUntil: input.kind === 'esis' ? dates.esisValidUntil : dates.decisionValidUntil,
      decisionOutcome: input.kind === 'credit_decision' ? 'positive' : null,
      applicantNames: [...input.context.applicantNames],
      financialTerms: {
        loanAmount: input.context.loanAmount,
        currency: input.context.currency,
        annualInterestRate: input.context.interestRatePct,
        aprc: input.context.aprcPct,
        monthlyInstallment: input.context.monthlyInstallment,
        termMonths: input.context.termMonths,
      },
    },
  }
}

function assertManifestDeliveryIdentity(
  manifest: OpenExpertMockBankPersistedPayloadManifest,
): void {
  const expectedIdempotencyKey = openExpertMockBankEmailIdempotencyKey(
    manifest.identity.kind,
    manifest.identity.dispatchId,
    manifest.identity.generation,
  )
  if (manifest.message.idempotencyKey !== expectedIdempotencyKey
    || manifest.message.attachment.filename !== openExpertMockBankArchiveFileName(
      manifest.identity.kind,
      manifest.identity.applicationNumber,
    )
    || manifest.document.pdfFileName !== openExpertMockBankPdfFileName(
      manifest.identity.kind,
      manifest.identity.applicationNumber,
    )) {
    throw createError({ statusCode: 500, statusMessage: 'Utrwalony payload OpenExpert Banku jest niespójny.' })
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

async function loadCommittedPayload(input: {
  event: H3Event
  organizationId: string
  reservation: OpenExpertMockBankDispatchReservation
}): Promise<PersistedPayload> {
  const storage = serverStorageClient(input.event)
  const [manifestObject, archiveObject] = await Promise.all([
    loadOpenExpertMockBankObject({
      storage,
      path: input.reservation.manifestStoragePath,
      contentType: OPENEXPERT_MOCK_BANK_MANIFEST_MEDIA_TYPE,
      expectedSha256: input.reservation.manifestSha256,
      expectedSizeBytes: input.reservation.manifestSizeBytes,
    }),
    loadOpenExpertMockBankObject({
      storage,
      path: input.reservation.archiveStoragePath,
      contentType: 'application/zip',
      expectedSha256: input.reservation.archiveSha256,
      expectedSizeBytes: input.reservation.archiveSizeBytes,
    }),
  ])
  if (!manifestObject || !archiveObject || !input.reservation.payloadSha256) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Utrwalony payload OpenExpert Banku jest chwilowo niedostępny.',
    })
  }
  const manifest = decodeOpenExpertMockBankPayloadManifest(
    manifestObject.bytes,
    identityFromReservation(input.reservation),
  )
  assertManifestDeliveryIdentity(manifest)
  const payloadSha256 = openExpertMockBankFullPayloadSha256({
    manifestBytes: manifestObject.bytes,
    archiveBytes: archiveObject.bytes,
  })
  if (payloadSha256 !== input.reservation.payloadSha256) {
    throw createError({ statusCode: 500, statusMessage: 'Hash payloadu OpenExpert Banku jest niespójny.' })
  }
  return { manifest, manifestObject, archiveObject, payloadSha256 }
}

async function createOrRecoverPayload(input: {
  event: H3Event
  organizationId: string
  context: OpenExpertMockBankContext
  kind: OpenExpertMockBankDocumentKind
  recipientEmail: string
  reservation: OpenExpertMockBankDispatchReservation
  requestId: string
}): Promise<PersistedPayload> {
  const storage = serverStorageClient(input.event)
  const identity = identityFromReservation(input.reservation)

  await Promise.all([
    discardEmptyUncommittedOpenExpertMockBankObject({
      storage,
      path: input.reservation.manifestStoragePath,
    }),
    discardEmptyUncommittedOpenExpertMockBankObject({
      storage,
      path: input.reservation.archiveStoragePath,
    }),
  ])

  let manifestObject = await loadOpenExpertMockBankObject({
    storage,
    path: input.reservation.manifestStoragePath,
    contentType: OPENEXPERT_MOCK_BANK_MANIFEST_MEDIA_TYPE,
  })
  if (!manifestObject) {
    manifestObject = await persistOrRecoverOpenExpertMockBankObject({
      storage,
      path: input.reservation.manifestStoragePath,
      contentType: OPENEXPERT_MOCK_BANK_MANIFEST_MEDIA_TYPE,
      bytes: encodeOpenExpertMockBankPayloadManifest(buildManifest(input)),
    })
  }
  const manifest = decodeOpenExpertMockBankPayloadManifest(manifestObject.bytes, identity)
  assertManifestDeliveryIdentity(manifest)

  let archiveObject = await loadOpenExpertMockBankObject({
    storage,
    path: input.reservation.archiveStoragePath,
    contentType: 'application/zip',
  })
  if (!archiveObject) {
    archiveObject = await persistOrRecoverOpenExpertMockBankObject({
      storage,
      path: input.reservation.archiveStoragePath,
      contentType: 'application/zip',
      bytes: await buildArchive(manifest, input.context.pesel),
    })
  }
  // A provider-generic upload conflict is recovered by downloading the exact
  // immutable path. Validate that winner before binding its hashes to the
  // ledger; AES salts make comparing it with a freshly generated ZIP invalid.
  await verifyOpenExpertMockBankEncryptedArchive({
    bytes: archiveObject.bytes,
    kind: manifest.identity.kind,
    applicationNumber: manifest.identity.applicationNumber,
    pesel: input.context.pesel,
  })
  const payloadSha256 = openExpertMockBankFullPayloadSha256({
    manifestBytes: manifestObject.bytes,
    archiveBytes: archiveObject.bytes,
  })
  const committed = await commitOpenExpertMockBankDispatchPayload({
    event: input.event,
    dispatchId: input.reservation.dispatchId,
    requestId: input.requestId,
    generation: input.reservation.generation,
    manifestSha256: manifestObject.sha256,
    manifestSizeBytes: manifestObject.sizeBytes,
    archiveSha256: archiveObject.sha256,
    archiveSizeBytes: archiveObject.sizeBytes,
    payloadSha256,
  })
  if (committed.payloadSha256 !== payloadSha256
    || committed.manifestSha256 !== manifestObject.sha256
    || committed.archiveSha256 !== archiveObject.sha256) {
    throw createError({ statusCode: 500, statusMessage: 'Commit payloadu OpenExpert Banku jest niespójny.' })
  }
  return { manifest, manifestObject, archiveObject, payloadSha256 }
}

async function persistedPayload(input: {
  event: H3Event
  organizationId: string
  context: OpenExpertMockBankContext
  kind: OpenExpertMockBankDocumentKind
  recipientEmail: string
  reservation: OpenExpertMockBankDispatchReservation
  requestId: string
}): Promise<PersistedPayload> {
  return input.reservation.payloadReadyAt
    ? loadCommittedPayload(input)
    : createOrRecoverPayload(input)
}

export async function deliverOpenExpertMockBankDocument(input: {
  event: H3Event
  organizationId: string
  context: OpenExpertMockBankContext
  kind: OpenExpertMockBankDocumentKind
  recipientEmail: string
  reservation: OpenExpertMockBankDispatchReservation
  requestId: string
}): Promise<OpenExpertMockBankDeliveryResult> {
  requireOpenExpertMockBankDeliveryConfigured(input.event, input.organizationId)
  const payload = await persistedPayload(input)
  const runtime = openExpertMockBankEmailConfig(input.event, input.organizationId)
  const sender = senderConfig({
    runtime,
    from: payload.manifest.transport.from,
    replyTo: payload.manifest.transport.replyTo,
    provider: payload.manifest.transport.provider,
  })
  if (!sender.isConfigured || sender.provider !== payload.manifest.transport.provider) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Transport utrwalonej wiadomości OpenExpert Banku nie jest już dostępny.',
    })
  }

  const renewed = await renewOpenExpertMockBankDispatchSendLease({
    event: input.event,
    dispatchId: input.reservation.dispatchId,
    requestId: input.requestId,
    generation: input.reservation.generation,
  })
  if (!renewed.shouldSend
    || renewed.payloadSha256 !== payload.payloadSha256
    || renewed.recipientConnectionId !== input.reservation.recipientConnectionId) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Wysyłka OpenExpert Banku utraciła aktualną rezerwację.',
    })
  }

  try {
    const result = await sender.send({
      to: payload.manifest.message.to,
      subject: payload.manifest.message.subject,
      html: payload.manifest.message.html,
      text: payload.manifest.message.text,
      idempotencyKey: payload.manifest.message.idempotencyKey,
      tags: payload.manifest.message.tags,
      attachments: [{
        filename: payload.manifest.message.attachment.filename,
        content: payload.archiveObject.bytes,
        contentType: payload.manifest.message.attachment.contentType,
      }],
    })
    if (result.status !== 'sent') {
      throw createError({
        statusCode: 503,
        statusMessage: 'Wysyłka e-mail OpenExpert Banku nie jest skonfigurowana.',
      })
    }
    return {
      providerMessageId: result.id,
      archiveFileName: payload.manifest.message.attachment.filename,
      pdfFileName: payload.manifest.document.pdfFileName,
      issueDate: payload.manifest.document.issueDate,
      validUntil: payload.manifest.document.validUntil,
      decisionOutcome: payload.manifest.document.decisionOutcome === 'positive' ? 'positive' : null,
    }
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
