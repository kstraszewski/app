import type {
  EmailDeliveryResult,
  TransactionalEmailInput,
} from '@openexpert/email'
import type { StorageClient } from '@openexpert/storage'
import { createError } from 'h3'
import {
  openExpertMockBankArchiveFileName,
  openExpertMockBankPdfFileName,
} from './openexpert-mock-bank-documents.ts'
import { openExpertMockBankEmailIdempotencyKey } from './openexpert-mock-bank-email.ts'
import {
  decodeOpenExpertMockBankPayloadManifest,
  loadOpenExpertMockBankObject,
  OPENEXPERT_MOCK_BANK_MANIFEST_MEDIA_TYPE,
  openExpertMockBankFullPayloadSha256,
  type OpenExpertMockBankPayloadIdentity,
  type OpenExpertMockBankPersistedPayloadManifest,
  type OpenExpertMockBankStoredObject,
} from './openexpert-mock-bank-payload.ts'

export interface OpenExpertMockBankCommittedReservation extends OpenExpertMockBankPayloadIdentity {
  recipientConnectionId: string | null
  manifestStoragePath: string
  manifestSha256: string | null
  manifestSizeBytes: number | null
  archiveStoragePath: string
  archiveSha256: string | null
  archiveSizeBytes: number | null
  payloadSha256: string | null
  payloadReadyAt: string | null
}

export interface OpenExpertMockBankPersistedPayload {
  manifest: OpenExpertMockBankPersistedPayloadManifest
  manifestObject: OpenExpertMockBankStoredObject
  archiveObject: OpenExpertMockBankStoredObject
  payloadSha256: string
}

export interface OpenExpertMockBankSnapshotSender {
  isConfigured: boolean
  provider: 'resend' | 'smtp' | null
  send(input: TransactionalEmailInput): Promise<EmailDeliveryResult>
}

export interface OpenExpertMockBankSnapshotDeliveryResult {
  providerMessageId: string
  archiveFileName: string
  pdfFileName: string
  issueDate: string
  validUntil: string | null
  decisionOutcome: 'positive' | null
}

export function assertOpenExpertMockBankManifestDeliveryIdentity(
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
    throw createError({
      statusCode: 500,
      statusMessage: 'Utrwalony payload OpenExpert Banku jest niespójny.',
    })
  }
}

export async function loadCommittedOpenExpertMockBankPayload(input: {
  storage: StorageClient
  reservation: OpenExpertMockBankCommittedReservation
}): Promise<OpenExpertMockBankPersistedPayload> {
  const [manifestObject, archiveObject] = await Promise.all([
    loadOpenExpertMockBankObject({
      storage: input.storage,
      path: input.reservation.manifestStoragePath,
      contentType: OPENEXPERT_MOCK_BANK_MANIFEST_MEDIA_TYPE,
      expectedSha256: input.reservation.manifestSha256,
      expectedSizeBytes: input.reservation.manifestSizeBytes,
    }),
    loadOpenExpertMockBankObject({
      storage: input.storage,
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
    {
      dispatchId: input.reservation.dispatchId,
      payloadId: input.reservation.payloadId,
      applicationId: input.reservation.applicationId,
      applicationNumber: input.reservation.applicationNumber,
      kind: input.reservation.kind,
      generation: input.reservation.generation,
      generationStartedAt: input.reservation.generationStartedAt,
    },
  )
  assertOpenExpertMockBankManifestDeliveryIdentity(manifest)
  const payloadSha256 = openExpertMockBankFullPayloadSha256({
    manifestBytes: manifestObject.bytes,
    archiveBytes: archiveObject.bytes,
  })
  if (payloadSha256 !== input.reservation.payloadSha256) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Hash payloadu OpenExpert Banku jest niespójny.',
    })
  }
  return { manifest, manifestObject, archiveObject, payloadSha256 }
}

/**
 * Selects the immutable committed snapshot before any mutable generation path,
 * then renews the lease and sends exactly those bytes. The current application
 * context is deliberately absent from this boundary.
 */
export async function deliverOpenExpertMockBankPayloadSnapshot(input: {
  committed: boolean
  expectedRecipientConnectionId: string | null
  loadCommitted(): Promise<OpenExpertMockBankPersistedPayload>
  createUncommitted(): Promise<OpenExpertMockBankPersistedPayload>
  senderForPayload(transport: {
    from: string
    replyTo: string | null
    provider: 'resend' | 'smtp'
  }): OpenExpertMockBankSnapshotSender
  renewSendLease(): Promise<{
    shouldSend: boolean
    payloadSha256: string | null
    recipientConnectionId: string | null
  }>
}): Promise<OpenExpertMockBankSnapshotDeliveryResult> {
  const payload = input.committed
    ? await input.loadCommitted()
    : await input.createUncommitted()
  const sender = input.senderForPayload(payload.manifest.transport)
  if (!sender.isConfigured || sender.provider !== payload.manifest.transport.provider) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Transport utrwalonej wiadomości OpenExpert Banku nie jest już dostępny.',
    })
  }

  const renewed = await input.renewSendLease()
  if (!renewed.shouldSend
    || renewed.payloadSha256 !== payload.payloadSha256
    || renewed.recipientConnectionId !== input.expectedRecipientConnectionId) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Wysyłka OpenExpert Banku utraciła aktualną rezerwację.',
    })
  }

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
