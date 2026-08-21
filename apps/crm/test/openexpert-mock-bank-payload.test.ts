import assert from 'node:assert/strict'
import test from 'node:test'
import type { TransactionalEmailInput } from '@openexpert/email'
import {
  createInMemoryStorageProvider,
  createStorageClient,
  type StorageClient,
} from '@openexpert/storage'
import {
  deliverOpenExpertMockBankPayloadSnapshot,
  loadCommittedOpenExpertMockBankPayload,
} from '../server/utils/openexpert-mock-bank-delivery-core.ts'
import type { OpenExpertMockBankDispatchReservation } from '../server/utils/openexpert-mock-bank-dispatch.ts'
import {
  decodeOpenExpertMockBankPayloadManifest,
  encodeOpenExpertMockBankPayloadManifest,
  loadOpenExpertMockBankObject,
  MAX_OPENEXPERT_MOCK_BANK_OUTBOX_OBJECT_BYTES,
  openExpertMockBankFullPayloadSha256,
  openExpertMockBankGenerationContextSha256,
  OpenExpertMockBankPayloadError,
  openExpertMockBankPayloadObjectPaths,
  openExpertMockBankSha256,
  persistOrRecoverOpenExpertMockBankObject,
  type OpenExpertMockBankPersistedPayloadManifest,
} from '../server/utils/openexpert-mock-bank-payload.ts'
import type { OpenExpertMockBankContext } from '../server/utils/openexpert-mock-bank-service.ts'

const identity = {
  dispatchId: '3e89f378-c125-4842-927e-98201bbcb9f0',
  payloadId: '9bc02176-7104-4a4f-92cf-f8b509db6eaa',
  applicationId: '9427198c-bf6c-4b2d-8530-68a5117c5679',
  applicationNumber: 'OEB-20260819-123456',
  kind: 'esis' as const,
  generation: 2,
  generationStartedAt: '2026-08-19T10:15:00.000Z',
}

function manifest(): OpenExpertMockBankPersistedPayloadManifest {
  const document: OpenExpertMockBankPersistedPayloadManifest['document'] = {
    pdfFileName: 'OEB-20260819-123456-formularz-ESIS.pdf',
    issueDate: '2026-08-19',
    validUntil: '2026-09-18',
    decisionOutcome: null,
    applicantNames: ['Anna Ściśle Tajna'],
    financialTerms: {
      loanAmount: 500_000,
      currency: 'PLN',
      annualInterestRate: 5.89,
      aprc: 6.41,
      monthlyInstallment: 2_963.19,
      termMonths: 360,
    },
  }
  return {
    version: 2,
    generationContextSha256: openExpertMockBankGenerationContextSha256({ identity, document }),
    identity,
    transport: {
      provider: 'resend',
      from: 'OpenExpert Bank <bank@example.test>',
      replyTo: null,
    },
    message: {
      to: 'expert@example.test',
      subject: 'Formularz informacyjny ESIS – OEB-20260819-123456',
      html: '<html lang="pl"><body><h1>ESIS</h1></body></html>',
      text: 'ESIS',
      idempotencyKey: `openexpert-mock-bank/esis/${identity.dispatchId}/generation-2`,
      tags: [
        { name: 'email_type', value: 'mock_bank_esis' },
        { name: 'application_id', value: identity.applicationId },
      ],
      attachment: {
        filename: 'OEB-20260819-123456-formularz-ESIS.zip',
        contentType: 'application/zip',
      },
    },
    document,
  }
}

test('freezes exact message metadata without persisting the PESEL password', () => {
  const value = manifest()
  const bytes = encodeOpenExpertMockBankPayloadManifest(value)
  const decoded = decodeOpenExpertMockBankPayloadManifest(bytes, identity)

  assert.deepEqual(decoded, value)
  assert.equal(new TextDecoder().decode(bytes).includes('85010112345'), false)
  assert.deepEqual(openExpertMockBankPayloadObjectPaths({
    organizationId: '5ad17548-6b42-4387-9982-a7c720281d18',
    ...identity,
  }), {
    manifestPath: `5ad17548-6b42-4387-9982-a7c720281d18/${identity.applicationId}/${identity.dispatchId}/esis/generation-2-${identity.payloadId}.json`,
    archivePath: `5ad17548-6b42-4387-9982-a7c720281d18/${identity.applicationId}/${identity.dispatchId}/esis/generation-2-${identity.payloadId}.zip`,
  })
})

test('keeps legacy v1 manifests readable but pins every v2 rendered field', () => {
  const current = manifest()
  if (current.version !== 2) throw new TypeError('expected manifest v2')
  const { generationContextSha256: _, ...withoutHash } = current
  const legacy: OpenExpertMockBankPersistedPayloadManifest = {
    ...withoutHash,
    version: 1,
  }
  assert.deepEqual(
    decodeOpenExpertMockBankPayloadManifest(
      encodeOpenExpertMockBankPayloadManifest(legacy),
      identity,
    ),
    legacy,
  )

  const changed = structuredClone(current)
  changed.document.financialTerms.aprc = 6.9
  assert.throws(
    () => encodeOpenExpertMockBankPayloadManifest(changed),
    /generationContextSha256/u,
  )
})

test('generation-context digest has the PostgreSQL-compatible Unicode and numeric golden vector', () => {
  const current = manifest()
  if (current.version !== 2) throw new TypeError('expected manifest v2')
  const document = structuredClone(current.document)
  document.applicantNames = ['Żaneta Łęcka', 'Michał O\'Connor']
  document.financialTerms.loanAmount = 500_000.00
  document.financialTerms.annualInterestRate = 0.00001
  document.financialTerms.aprc = 6.90000
  document.financialTerms.monthlyInstallment = 2_963.10
  assert.equal(
    openExpertMockBankGenerationContextSha256({
      identity: {
        ...identity,
        generationStartedAt: '2026-08-19T12:15:00.123+02:00',
      },
      document,
    }),
    'd8aecee0a6bc474e22574e0c3119600a88fab5fe4b2209fffe01d5806551f713',
  )
})

test('full payload hash binds every manifest byte and every encrypted archive byte', () => {
  const manifestBytes = encodeOpenExpertMockBankPayloadManifest(manifest())
  const firstArchive = Uint8Array.from([0x50, 0x4b, 1, 2, 3])
  const secondArchive = Uint8Array.from([0x50, 0x4b, 1, 2, 4])
  const firstHash = openExpertMockBankFullPayloadSha256({ manifestBytes, archiveBytes: firstArchive })

  assert.match(firstHash, /^[0-9a-f]{64}$/u)
  assert.equal(
    openExpertMockBankFullPayloadSha256({ manifestBytes, archiveBytes: firstArchive }),
    firstHash,
  )
  assert.notEqual(
    openExpertMockBankFullPayloadSha256({ manifestBytes, archiveBytes: secondArchive }),
    firstHash,
  )
  const changed = manifest()
  changed.message.to = 'other@example.test'
  assert.notEqual(
    openExpertMockBankFullPayloadSha256({
      manifestBytes: encodeOpenExpertMockBankPayloadManifest(changed),
      archiveBytes: firstArchive,
    }),
    firstHash,
  )
})

test('committed retry sends the exact pinned snapshot after current context changes', async () => {
  const storage = createStorageClient(createInMemoryStorageProvider())
  const pinned = manifest()
  const manifestBytes = encodeOpenExpertMockBankPayloadManifest(pinned)
  const archiveBytes = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 9, 8, 7])
  const manifestPath = `${identity.applicationId}/${identity.payloadId}.json`
  const archivePath = `${identity.applicationId}/${identity.payloadId}.zip`
  await storage.upload({
    namespace: 'crm-mock-bank-outbox',
    path: manifestPath,
    body: manifestBytes,
    contentType: 'application/json',
  })
  await storage.upload({
    namespace: 'crm-mock-bank-outbox',
    path: archivePath,
    body: archiveBytes,
    contentType: 'application/zip',
  })
  const payloadSha256 = openExpertMockBankFullPayloadSha256({ manifestBytes, archiveBytes })
  const recipientConnectionId = 'c43adb0c-bf38-45ce-80fe-40110c39020b'
  const reservation: OpenExpertMockBankDispatchReservation = {
    ...identity,
    state: 'claimed',
    shouldSend: true,
    attempts: 2,
    createdAt: '2026-08-19T10:15:00.000Z',
    leaseExpiresAt: '2026-08-19T10:20:00.000Z',
    recipientConnectionId,
    manifestStorageBucket: 'crm-mock-bank-outbox',
    manifestStoragePath: manifestPath,
    manifestSha256: openExpertMockBankSha256(manifestBytes),
    manifestSizeBytes: manifestBytes.byteLength,
    archiveStorageBucket: 'crm-mock-bank-outbox',
    archiveStoragePath: archivePath,
    archiveSha256: openExpertMockBankSha256(archiveBytes),
    archiveSizeBytes: archiveBytes.byteLength,
    payloadSha256,
    payloadReadyAt: '2026-08-19T10:16:00.000Z',
    providerMessageId: null,
    errorCode: null,
    sentAt: null,
    failedAt: null,
  }
  const changedContext: OpenExpertMockBankContext = {
    organizationId: '5ad17548-6b42-4387-9982-a7c720281d18',
    application: { bank_id: 'changed-bank', offer_id: 'changed-offer' },
    applicationId: identity.applicationId,
    applicationNumber: identity.applicationNumber,
    applicantNames: ['Zmieniony Wnioskodawca'],
    primaryApplicantName: 'Zmieniony Wnioskodawca',
    primaryClientId: 'fca53588-943b-448d-b313-f45b7e2de830',
    pesel: '85010112345',
    productName: 'Zmieniona oferta',
    currency: 'EUR',
    loanAmount: 1,
    termMonths: 1,
    interestRatePct: 99,
    aprcPct: 99,
    monthlyInstallment: 1,
    process: {
      stage: 'edited_after_commit',
      revision: 99,
      applicationSubmittedAt: '2026-08-19T10:17:00.000Z',
      completenessConfirmedAt: null,
      decisionDueAt: '2026-08-31',
    },
  }
  const sent: TransactionalEmailInput[] = []
  const sender = {
    isConfigured: true,
    provider: 'resend' as const,
    async send(input: TransactionalEmailInput) {
      sent.push(input)
      return { status: 'sent' as const, id: 'provider-message-a' }
    },
  }
  const forbiddenCalls: string[] = []
  let renewCalls = 0
  const result = await deliverOpenExpertMockBankPayloadSnapshot({
    committed: true,
    expectedRecipientConnectionId: reservation.recipientConnectionId,
    loadCommitted: () => loadCommittedOpenExpertMockBankPayload({ storage, reservation }),
    async createUncommitted() {
      forbiddenCalls.push(
        'loadGenerationValidation',
        'buildPayloadManifest',
        'buildPayloadArchive',
        'commitPayload',
      )
      throw new Error('committed retry must not use the mutable generation path')
    },
    senderForPayload(transport) {
      assert.deepEqual(transport, pinned.transport)
      return sender
    },
    async renewSendLease() {
      renewCalls += 1
      return reservation
    },
  })

  assert.deepEqual(forbiddenCalls, [])
  assert.equal(renewCalls, 1)
  assert.equal(sent.length, 1)
  assert.equal(sent[0]?.to, pinned.message.to)
  assert.equal(sent[0]?.idempotencyKey, pinned.message.idempotencyKey)
  assert.deepEqual(sent[0]?.attachments?.[0]?.content, archiveBytes)
  assert.equal(JSON.stringify(sent[0]).includes(changedContext.primaryApplicantName), false)
  assert.equal(JSON.stringify(sent[0]).includes(changedContext.pesel), false)
  assert.deepEqual(result, {
    providerMessageId: 'provider-message-a',
    archiveFileName: pinned.message.attachment.filename,
    pdfFileName: pinned.document.pdfFileName,
    issueDate: pinned.document.issueDate,
    validUntil: pinned.document.validUntil,
    decisionOutcome: null,
  })
})

test('does not renew or send when uncommitted generation context changes before commit', async () => {
  let committedLoadCalls = 0
  let senderFactoryCalls = 0
  let renewCalls = 0
  let sendCalls = 0

  await assert.rejects(
    deliverOpenExpertMockBankPayloadSnapshot({
      committed: false,
      expectedRecipientConnectionId: 'c43adb0c-bf38-45ce-80fe-40110c39020b',
      async loadCommitted() {
        committedLoadCalls += 1
        throw new Error('unreachable committed path')
      },
      async createUncommitted() {
        throw new Error('crm_mock_bank_generation_context_changed')
      },
      senderForPayload() {
        senderFactoryCalls += 1
        return {
          isConfigured: true,
          provider: 'resend',
          async send() {
            sendCalls += 1
            return { status: 'sent', id: 'unexpected-message' }
          },
        }
      },
      async renewSendLease() {
        renewCalls += 1
        return {
          shouldSend: true,
          payloadSha256: 'a'.repeat(64),
          recipientConnectionId: 'c43adb0c-bf38-45ce-80fe-40110c39020b',
        }
      },
    }),
    /crm_mock_bank_generation_context_changed/u,
  )

  assert.equal(committedLoadCalls, 0)
  assert.equal(senderFactoryCalls, 0)
  assert.equal(renewCalls, 0)
  assert.equal(sendCalls, 0)
})

test('recovers the immutable stored bytes even when upload reports a provider-generic error', async () => {
  const storage = createStorageClient(createInMemoryStorageProvider())
  const path = '5ad17548-6b42-4387-9982-a7c720281d18/persisted.zip'
  const persistedBytes = Uint8Array.from([0x50, 0x4b, 9, 8, 7])
  await storage.upload({
    namespace: 'crm-mock-bank-outbox',
    path,
    body: persistedBytes,
    contentType: 'application/zip',
  })
  const providerGenericConflict: StorageClient = {
    upload: async () => { throw new Error('Precondition failed') },
    head: input => storage.head(input),
    download: input => storage.download(input),
    delete: input => storage.delete(input),
    list: input => storage.list(input),
    createSignedUrl: input => storage.createSignedUrl(input),
    createSignedUploadUrl: input => storage.createSignedUploadUrl(input),
    getPublicUrl: input => storage.getPublicUrl(input),
  }

  const recovered = await persistOrRecoverOpenExpertMockBankObject({
    storage: providerGenericConflict,
    path,
    contentType: 'application/zip',
    bytes: Uint8Array.from([0x50, 0x4b, 1, 1, 1]),
  })
  assert.deepEqual(recovered.bytes, persistedBytes)
  assert.equal(recovered.sha256, openExpertMockBankSha256(persistedBytes))

  await assert.rejects(
    loadOpenExpertMockBankObject({
      storage,
      path,
      contentType: 'application/zip',
      expectedSha256: '0'.repeat(64),
      expectedSizeBytes: persistedBytes.byteLength,
    }),
    /hash obiektu storage/u,
  )

  const oversizedChunk = new Uint8Array(
    Math.floor(MAX_OPENEXPERT_MOCK_BANK_OUTBOX_OBJECT_BYTES / 2) + 1,
  )
  const lyingSizeStorage: StorageClient = {
    ...providerGenericConflict,
    download: async () => ({
      object: {
        namespace: 'crm-mock-bank-outbox',
        path,
        access: 'private',
        size: 1,
        contentType: 'application/zip',
      },
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(oversizedChunk)
          controller.enqueue(oversizedChunk)
          controller.close()
        },
      }),
    }),
  }
  await assert.rejects(
    loadOpenExpertMockBankObject({
      storage: lyingSizeStorage,
      path,
      contentType: 'application/zip',
    }),
    /obiekt storage przekracza limit/u,
  )
})

test('rejects a zero-byte immutable winner without deleting or reusing its path', async () => {
  let deleteCalls = 0
  const storage = {
    download: async ({ path }: { path: string }) => ({
      object: {
        namespace: 'crm-mock-bank-outbox' as const,
        path,
        access: 'private' as const,
        size: 0,
        contentType: 'application/zip',
      },
      stream: new ReadableStream<Uint8Array>({
        start(controller) { controller.close() },
      }),
    }),
    delete: async () => { deleteCalls += 1 },
  } as StorageClient

  await assert.rejects(
    loadOpenExpertMockBankObject({
      storage,
      path: 'generation-1-losing-writer.zip',
      contentType: 'application/zip',
    }),
    (error: unknown) => error instanceof OpenExpertMockBankPayloadError,
  )
  assert.equal(deleteCalls, 0)
})
