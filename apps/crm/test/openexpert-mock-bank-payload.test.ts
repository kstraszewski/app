import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createInMemoryStorageProvider,
  createStorageClient,
  type StorageClient,
} from '@openexpert/storage'
import {
  decodeOpenExpertMockBankPayloadManifest,
  encodeOpenExpertMockBankPayloadManifest,
  loadOpenExpertMockBankObject,
  MAX_OPENEXPERT_MOCK_BANK_OUTBOX_OBJECT_BYTES,
  openExpertMockBankFullPayloadSha256,
  openExpertMockBankPayloadObjectPaths,
  openExpertMockBankSha256,
  persistOrRecoverOpenExpertMockBankObject,
  type OpenExpertMockBankPersistedPayloadManifest,
} from '../server/utils/openexpert-mock-bank-payload.ts'

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
  return {
    version: 1,
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
    document: {
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
    },
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
