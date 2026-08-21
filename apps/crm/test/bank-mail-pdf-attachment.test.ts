import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  createInMemoryStorageProvider,
  createStorageClient,
  type StorageClient,
} from '@openexpert/storage'
import {
  bankMailPdfAccessTokenFromCache,
  BankMailPdfProcessingError,
  BankMailPdfTerminalResolutionError,
  gmailAttachmentTokenSha256,
  parseBankMailPdfAttachmentJob,
  parseBankMailPdfFailureResult,
  parseBankMailPdfPreparedImport,
  parseBankMailPdfProofResult,
  parseBankMailPdfPublishedImport,
  processBankMailPdfAttachmentJob,
  recordBankMailPdfDrainOutcome,
  resolveGmailBankPdfSource,
  verifyOpenExpertMockBankEsisPdfText,
  type BankMailPdfAttachmentJob,
  type BankMailPdfProcessorDependencies,
} from '../server/utils/bank-mail-pdf-attachment-core.ts'
import { canonicalBankMailSourceSha256 } from '../server/utils/bank-mail-agent-ingestion-core.ts'
import { bankMailProviderMessageIdentitySha256 } from '../server/utils/bank-mail-agent-status-core.ts'
import { extractBoundedPdfText } from '../server/utils/bounded-pdf-text.ts'
import { persistExactBankMailPdf } from '../server/utils/bank-mail-pdf-storage-core.ts'
import {
  gmailMessageDetail,
  type GmailMessageResource,
} from '../server/utils/gmail-message.ts'
import {
  createOpenExpertMockBankEsisPdf,
  MAX_OPENEXPERT_MOCK_BANK_PDF_BYTES,
  openExpertMockBankEsisDocumentText,
} from '../server/utils/openexpert-mock-bank-documents.ts'
import {
  encodeOpenExpertMockBankPayloadManifest,
  openExpertMockBankFullPayloadSha256,
  openExpertMockBankGenerationContextSha256,
  openExpertMockBankSha256,
  type OpenExpertMockBankPersistedPayloadManifest,
} from '../server/utils/openexpert-mock-bank-payload.ts'

const ids = {
  job: '11111111-1111-4111-8111-111111111111',
  organization: '22222222-2222-4222-8222-222222222222',
  connection: '33333333-3333-4333-8333-333333333333',
  owner: '44444444-4444-4444-8444-444444444444',
  case: '55555555-5555-4555-8555-555555555555',
  application: '66666666-6666-4666-8666-666666666666',
  document: '77777777-7777-4777-8777-777777777777',
  dispatch: '88888888-8888-4888-8888-888888888888',
  payload: '99999999-9999-4999-8999-999999999999',
}
const applicationNumber = 'OEB-20260821-123456'
const archiveBytes = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 7, 8, 9])
const pdfBytes = new TextEncoder().encode('%PDF-1.7\ntrusted\n%%EOF')
const pesel = '85010112345'

function pinnedManifest(): OpenExpertMockBankPersistedPayloadManifest & { version: 2 } {
  const identity = {
    dispatchId: ids.dispatch,
    payloadId: ids.payload,
    applicationId: ids.application,
    applicationNumber,
    kind: 'esis' as const,
    generation: 1,
    generationStartedAt: '2026-08-21T10:00:00.000Z',
  }
  const document: OpenExpertMockBankPersistedPayloadManifest['document'] = {
    pdfFileName: `${applicationNumber}-formularz-ESIS.pdf`,
    issueDate: '2026-08-21',
    validUntil: '2026-09-20',
    decisionOutcome: null,
    applicantNames: ['Konrad Straszewski'],
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
    transport: { provider: 'resend', from: 'bank@openexpert.app', replyTo: null },
    message: {
      to: 'konrad@example.com',
      subject: `ESIS ${applicationNumber}`,
      html: '<p>ESIS</p>',
      text: 'ESIS',
      idempotencyKey: `openexpert-mock-bank/esis/${ids.dispatch}/generation-1`,
      tags: [],
      attachment: {
        filename: `${applicationNumber}-formularz-ESIS.zip`,
        contentType: 'application/zip',
      },
    },
    document,
  }
}

function pinnedManifestBytes(): Uint8Array {
  return encodeOpenExpertMockBankPayloadManifest(pinnedManifest())
}

function rawMessage(input: { id?: string, inline?: boolean } = {}): GmailMessageResource {
  const attachmentBody = input.inline
    ? { data: Buffer.from(archiveBytes).toString('base64url'), size: archiveBytes.byteLength }
    : { attachmentId: 'opaque-attachment-id', size: archiveBytes.byteLength }
  return {
    id: input.id ?? 'gmail-message-1',
    threadId: 'gmail-thread-1',
    internalDate: '1787288400000',
    labelIds: ['INBOX'],
    payload: {
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'From', value: 'OpenExpert Bank <bank@openexpert.app>' },
        { name: 'To', value: 'konrad@example.com' },
        { name: 'Subject', value: `[DEMO] OpenExpert Bank — formularz ESIS — ${applicationNumber}` },
        {
          name: 'Authentication-Results',
          value: 'mx.google.com; dkim=pass header.i=@openexpert.app; spf=pass',
        },
      ],
      parts: [{
        mimeType: 'text/plain',
        body: { data: Buffer.from(`ESIS ${applicationNumber}`).toString('base64url') },
      }, {
        mimeType: 'application/zip',
        filename: `${applicationNumber}-formularz-ESIS.zip`,
        body: attachmentBody,
      }],
    },
  }
}

function job(message = rawMessage()): BankMailPdfAttachmentJob {
  const manifest = pinnedManifest()
  const manifestBytes = encodeOpenExpertMockBankPayloadManifest(manifest)
  return parseBankMailPdfAttachmentJob({
    attachmentJobId: ids.job,
    state: 'downloading',
    leaseToken: 'a'.repeat(64),
    attemptNo: 1,
    leaseExpiresAt: '2026-08-21T12:05:00.000Z',
    organizationId: ids.organization,
    connectionId: ids.connection,
    mailboxOwnerUserId: ids.owner,
    provider: 'google',
    threadReference: 'gmail-thread-1',
    caseId: ids.case,
    applicationId: ids.application,
    dispatchId: ids.dispatch,
    dispatchGeneration: 1,
    dispatchPayloadId: ids.payload,
    dispatchGenerationStartedAt: '2026-08-21T10:00:00.000Z',
    providerMessageIdSha256: bankMailProviderMessageIdentitySha256('google', message.id!),
    intakeSourceSha256: canonicalBankMailSourceSha256(gmailMessageDetail(message)),
    attachmentFileName: `${applicationNumber}-formularz-ESIS.zip`,
    pdfFileName: `${applicationNumber}-formularz-ESIS.pdf`,
    generationContextSha256: manifest.generationContextSha256,
    manifestStorageBucket: 'crm-mock-bank-outbox',
    manifestStoragePath: `${ids.organization}/${ids.application}/${ids.dispatch}/esis/generation-1-${ids.payload}.json`,
    manifestSha256: openExpertMockBankSha256(manifestBytes),
    manifestSizeBytes: manifestBytes.byteLength,
    payloadSha256: openExpertMockBankFullPayloadSha256({ manifestBytes, archiveBytes }),
    archiveSha256: createHash('sha256').update(archiveBytes).digest('hex'),
    archiveSizeBytes: archiveBytes.byteLength,
    applicationNumber,
    issueDate: '2026-08-21',
    validUntil: '2026-09-20T00:00:00.000Z',
    replayed: false,
  })
}

function happyDependencies(
  sourceMessage: GmailMessageResource,
  events: string[],
): BankMailPdfProcessorDependencies {
  const assertNoPesel = (value: unknown) => {
    assert.equal(JSON.stringify(value).includes(pesel), false)
  }
  return {
    now: () => Date.parse('2026-08-21T12:00:00.000Z'),
    async loadManifest() {
      events.push('loadManifest')
      return { bytes: pinnedManifestBytes(), recipientEmail: 'konrad@example.com' }
    },
    async loadMessages() {
      events.push('loadMessages')
      return [sourceMessage]
    },
    async downloadArchive(_job, source) {
      events.push('downloadArchive')
      assert.equal(source.messageId, sourceMessage.id)
      return archiveBytes
    },
    async proveSource(input) {
      events.push('proveSource')
      assert.equal(input.archiveSha256, createHash('sha256').update(archiveBytes).digest('hex'))
      return {
        attachmentJobId: ids.job,
        state: 'unlocking',
        credentialKind: 'primary_pesel',
        credential: pesel,
        replayed: false,
      }
    },
    async extractArchive(input) {
      events.push('extractArchive')
      assert.equal(input.credential, pesel)
      return {
        bytes: pdfBytes,
        fileName: `${applicationNumber}-formularz-ESIS.pdf`,
        mediaType: 'application/pdf',
      }
    },
    async inspectPdf(bytes) {
      events.push('inspectPdf')
      assert.deepEqual(bytes, pdfBytes)
      return {
        pageCount: 2,
        text: openExpertMockBankEsisDocumentText({
          applicationNumber,
          applicantNames: pinnedManifest().document.applicantNames,
          issueDate: '2026-08-21',
          validUntil: '2026-09-20',
          financialTerms: pinnedManifest().document.financialTerms,
        }),
      }
    },
    async beginImport(input) {
      events.push('beginImport')
      assertNoPesel(input)
      return {
        attachmentJobId: ids.job,
        state: 'importing',
        storageBucket: 'crm-case-documents',
        storagePath: `${ids.organization}/${ids.case}/${ids.job}.pdf`,
        fileName: `${applicationNumber}-formularz-ESIS.pdf`,
        replayed: false,
      }
    },
    async persistPdf(input) {
      events.push('persistPdf')
      assertNoPesel(input)
    },
    async publish(input) {
      events.push('publish')
      assertNoPesel(input)
      return {
        attachmentJobId: ids.job,
        state: 'attached',
        resolutionCode: 'openexpert_mock_esis_attached',
        documentId: ids.document,
        fileName: `${applicationNumber}-formularz-ESIS.pdf`,
        completedAt: '2026-08-21T12:02:00.000Z',
        replayed: false,
      }
    },
  }
}

test('resolves exact raw Gmail source before proof and keeps PESEL inside extraction only', async () => {
  const message = rawMessage()
  const events: string[] = []
  const result = await processBankMailPdfAttachmentJob(
    job(message),
    happyDependencies(message, events),
  )
  assert.equal(result.state, 'attached')
  assert.deepEqual(events, [
    'loadManifest',
    'loadMessages',
    'downloadArchive',
    'proveSource',
    'extractArchive',
    'inspectPdf',
    'beginImport',
    'persistPdf',
    'publish',
  ])
})

test('fails closed before attachment fetch when canonical source changed', async () => {
  const original = rawMessage()
  const changed = rawMessage()
  changed.payload!.headers = [
    ...(changed.payload!.headers ?? []).filter(header => header.name !== 'Subject'),
    { name: 'Subject', value: 'changed after canonical intake' },
  ]
  const events: string[] = []
  await assert.rejects(
    processBankMailPdfAttachmentJob(job(original), happyDependencies(changed, events)),
    (error: unknown) => (
      error instanceof BankMailPdfProcessingError
      && error.code === 'source_content_changed'
      && error.retryable === false
    ),
  )
  assert.deepEqual(events, ['loadManifest', 'loadMessages'])
})

test('does not request the unlock secret when Gmail bytes differ from sent dispatch', async () => {
  const message = rawMessage()
  const events: string[] = []
  const dependencies = happyDependencies(message, events)
  dependencies.downloadArchive = async () => Uint8Array.from([...archiveBytes, 10])
  await assert.rejects(
    processBankMailPdfAttachmentJob(job(message), dependencies),
    (error: unknown) => (
      error instanceof BankMailPdfProcessingError
      && error.code === 'archive_hash_mismatch'
      && error.retryable === false
    ),
  )
  assert.deepEqual(events, ['loadManifest', 'loadMessages'])
})

test('rejects a missing or tampered pinned manifest before Gmail or the unlock proof', async () => {
  const message = rawMessage()
  const events: string[] = []
  const dependencies = happyDependencies(message, events)
  dependencies.loadManifest = async () => {
    events.push('loadManifest')
    return {
      bytes: new TextEncoder().encode('{"version":2,"tampered":true}'),
      recipientEmail: 'konrad@example.com',
    }
  }
  await assert.rejects(
    processBankMailPdfAttachmentJob(job(message), dependencies),
    (error: unknown) => error instanceof BankMailPdfProcessingError
      && error.code === 'source_content_changed'
      && !error.retryable,
  )
  assert.deepEqual(events, ['loadManifest'])
})

test('binds the actual Gmail ZIP to the exact pinned manifest full-payload hash before proof', async () => {
  const message = rawMessage()
  const events: string[] = []
  const gmailArchive = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 7, 8, 10])
  const mismatchedJob = {
    ...job(message),
    archiveSha256: openExpertMockBankSha256(gmailArchive),
    archiveSizeBytes: gmailArchive.byteLength,
  }
  const dependencies = happyDependencies(message, events)
  dependencies.downloadArchive = async () => {
    events.push('downloadArchive')
    return gmailArchive
  }
  await assert.rejects(
    processBankMailPdfAttachmentJob(mismatchedJob, dependencies),
    (error: unknown) => error instanceof BankMailPdfProcessingError
      && error.code === 'source_content_changed'
      && !error.retryable,
  )
  assert.deepEqual(events, ['loadManifest', 'loadMessages', 'downloadArchive'])
})

test('rejects a source-proof response scoped to a different attachment job', async () => {
  const message = rawMessage()
  const events: string[] = []
  const dependencies = happyDependencies(message, events)
  dependencies.proveSource = async () => {
    events.push('proveSource')
    return {
      attachmentJobId: '99999999-9999-4999-8999-999999999999',
      state: 'unlocking',
      credentialKind: 'primary_pesel',
      credential: pesel,
      replayed: false,
    }
  }
  await assert.rejects(
    processBankMailPdfAttachmentJob(job(message), dependencies),
    (error: unknown) => error instanceof BankMailPdfProcessingError
      && error.code === 'processing_failed'
      && error.retryable,
  )
  assert.deepEqual(events, ['loadManifest', 'loadMessages', 'downloadArchive', 'proveSource'])
})

test('stops without extraction or failure mutation after a terminal source proof', async () => {
  const message = rawMessage()
  const events: string[] = []
  const dependencies = happyDependencies(message, events)
  dependencies.proveSource = async () => {
    events.push('proveSource')
    return {
      attachmentJobId: ids.job,
      state: 'conflict',
      resolutionCode: 'source_archive_mismatch',
      replayed: false,
    }
  }
  await assert.rejects(
    processBankMailPdfAttachmentJob(job(message), dependencies),
    (error: unknown) => error instanceof BankMailPdfTerminalResolutionError
      && error.result.state === 'conflict'
      && error.result.resolutionCode === 'source_archive_mismatch',
  )
  assert.deepEqual(events, ['loadManifest', 'loadMessages', 'downloadArchive', 'proveSource'])
})

test('performs no provider or storage side effect after the job lease is stale', async () => {
  const message = rawMessage()
  const events: string[] = []
  const dependencies = happyDependencies(message, events)
  dependencies.now = () => Date.parse('2026-08-21T12:05:00.000Z')
  await assert.rejects(
    processBankMailPdfAttachmentJob(job(message), dependencies),
    (error: unknown) => error instanceof BankMailPdfProcessingError
      && error.code === 'processing_failed'
      && error.retryable,
  )
  assert.deepEqual(events, [])
})

test('does not download after the lease expires while resolving the raw Gmail message', async () => {
  const message = rawMessage()
  const events: string[] = []
  const dependencies = happyDependencies(message, events)
  let now = Date.parse('2026-08-21T12:00:00.000Z')
  dependencies.now = () => now
  dependencies.loadMessages = async () => {
    events.push('loadMessages')
    now = Date.parse('2026-08-21T12:05:00.000Z')
    return [message]
  }
  await assert.rejects(
    processBankMailPdfAttachmentJob(job(message), dependencies),
    (error: unknown) => error instanceof BankMailPdfProcessingError
      && error.code === 'processing_failed'
      && error.retryable,
  )
  assert.deepEqual(events, ['loadManifest', 'loadMessages'])
})

test('rejects a structurally parsed PDF whose application reference or dates drift', () => {
  assert.throws(
    () => verifyOpenExpertMockBankEsisPdfText({
      text: 'EUROPEJSKI ZNORMALIZOWANY ARKUSZ INFORMACYJNY (ESIS) Numer wniosku: OEB-20260821-999999 (2026-08-21) (2026-09-20)',
      pageCount: 1,
      applicationNumber,
      issueDate: '2026-08-21',
      validUntil: '2026-09-20T00:00:00.000Z',
      document: pinnedManifest().document,
    }),
    (error: unknown) => error instanceof BankMailPdfProcessingError
      && error.code === 'archive_invalid',
  )
})

test('rejects PDF applicant and financial terms that differ from the pinned manifest', async () => {
  const message = rawMessage()
  const events: string[] = []
  const dependencies = happyDependencies(message, events)
  dependencies.inspectPdf = async () => {
    events.push('inspectPdf')
    const changedDocument = structuredClone(pinnedManifest().document)
    changedDocument.applicantNames = ['Inny Wnioskodawca']
    changedDocument.financialTerms.loanAmount = 499_999
    changedDocument.financialTerms.annualInterestRate = 5.88
    changedDocument.financialTerms.aprc = 6.4
    changedDocument.financialTerms.monthlyInstallment = 2_900
    changedDocument.financialTerms.termMonths = 240
    return {
      pageCount: 2,
      text: openExpertMockBankEsisDocumentText({
        applicationNumber,
        applicantNames: changedDocument.applicantNames,
        issueDate: '2026-08-21',
        validUntil: '2026-09-20',
        financialTerms: changedDocument.financialTerms,
      }),
    }
  }
  await assert.rejects(
    processBankMailPdfAttachmentJob(job(message), dependencies),
    (error: unknown) => error instanceof BankMailPdfProcessingError
      && error.code === 'archive_invalid'
      && !error.retryable,
  )
  assert.deepEqual(events, [
    'loadManifest',
    'loadMessages',
    'downloadArchive',
    'proveSource',
    'extractArchive',
    'inspectPdf',
  ])
})

test('rejects a PDF whose applicants contain the same names in a different canonical order', () => {
  const document = structuredClone(pinnedManifest().document)
  document.applicantNames = ['Anna Żółć', 'Konrad Straszewski']
  const reversedApplicantText = openExpertMockBankEsisDocumentText({
    applicationNumber,
    applicantNames: [...document.applicantNames].reverse(),
    issueDate: '2026-08-21',
    validUntil: '2026-09-20',
    financialTerms: document.financialTerms,
  })

  assert.throws(
    () => verifyOpenExpertMockBankEsisPdfText({
      text: reversedApplicantText,
      pageCount: 2,
      applicationNumber,
      issueDate: '2026-08-21',
      validUntil: '2026-09-20T00:00:00.000Z',
      document,
    }),
    (error: unknown) => error instanceof BankMailPdfProcessingError
      && error.code === 'archive_invalid'
      && !error.retryable,
  )
})

test('hashes external and inline Gmail attachment locators with separate domains', () => {
  const external = resolveGmailBankPdfSource({
    messages: [rawMessage()],
    providerMessageIdSha256: job().providerMessageIdSha256,
    intakeSourceSha256: job().intakeSourceSha256,
    attachmentFileName: job().attachmentFileName,
    archiveSizeBytes: archiveBytes.byteLength,
  })
  const inlineMessage = rawMessage({ id: 'gmail-message-inline', inline: true })
  const inlineJob = job(inlineMessage)
  const inline = resolveGmailBankPdfSource({
    messages: [inlineMessage],
    providerMessageIdSha256: inlineJob.providerMessageIdSha256,
    intakeSourceSha256: inlineJob.intakeSourceSha256,
    attachmentFileName: inlineJob.attachmentFileName,
    archiveSizeBytes: archiveBytes.byteLength,
  })
  assert.match(external.attachmentTokenSha256, /^[0-9a-f]{64}$/u)
  assert.match(inline.attachmentTokenSha256, /^[0-9a-f]{64}$/u)
  assert.notEqual(external.attachmentTokenSha256, inline.attachmentTokenSha256)
  assert.equal(gmailAttachmentTokenSha256(external.attachment), external.attachmentTokenSha256)
})

test('keys access tokens by exact organization, owner and connection', async () => {
  const first = job()
  const second = { ...first, connectionId: '99999999-9999-4999-8999-999999999999' }
  const cache = new Map<string, Promise<string>>()
  let loads = 0
  const firstToken = await bankMailPdfAccessTokenFromCache(first, cache, async () => {
    loads += 1
    return 'token-first'
  })
  const replayedFirst = await bankMailPdfAccessTokenFromCache(first, cache, async () => {
    loads += 1
    return 'wrong-token'
  })
  const secondToken = await bankMailPdfAccessTokenFromCache(second, cache, async () => {
    loads += 1
    return 'token-second'
  })
  assert.equal(firstToken, 'token-first')
  assert.equal(replayedFirst, 'token-first')
  assert.equal(secondToken, 'token-second')
  assert.equal(loads, 2)
})

test('extracts and verifies application/date markers from a real generated ESIS PDF', async () => {
  const fontPath = fileURLToPath(
    new URL('../public/fonts/DMSans-VariableFont_opsz,wght.ttf', import.meta.url),
  )
  const document = await createOpenExpertMockBankEsisPdf({
    applicationNumber,
    applicantNames: ['Konrad Straszewski'],
    issueDate: '2026-08-21',
    validUntil: '2026-09-20',
    financialTerms: {
      loanAmount: 500_000,
      currency: 'PLN',
      annualInterestRate: 5.89,
      aprc: 6.41,
      monthlyInstallment: 2_963.19,
      termMonths: 360,
    },
    fontBytes: new Uint8Array(await readFile(fontPath)),
  })
  const extracted = await extractBoundedPdfText({
    bytes: document.bytes,
    maxBytes: MAX_OPENEXPERT_MOCK_BANK_PDF_BYTES,
  })
  verifyOpenExpertMockBankEsisPdfText({
    ...extracted,
    applicationNumber,
    issueDate: '2026-08-21',
    validUntil: '2026-09-20T00:00:00.000Z',
    document: pinnedManifest().document,
  })
})

test('rejects unexpected begin-import response fields', () => {
  assert.throws(() => parseBankMailPdfPreparedImport({
    attachmentJobId: ids.job,
    state: 'importing',
    storageBucket: 'crm-case-documents',
    storagePath: `${ids.organization}/${ids.case}/${ids.job}.pdf`,
    fileName: `${applicationNumber}-formularz-ESIS.pdf`,
    replayed: false,
    credential: pesel,
  }), /prepare\.keys/u)
})

test('parses every exact success and terminal RPC result shape fail-closed', () => {
  assert.equal(parseBankMailPdfProofResult({
    attachmentJobId: ids.job,
    state: 'failed',
    resolutionCode: 'canonical_link_invalid',
    replayed: false,
  }).state, 'failed')
  assert.equal(parseBankMailPdfPreparedImport({
    attachmentJobId: ids.job,
    state: 'conflict',
    resolutionCode: 'dispatch_generation_changed',
    replayed: false,
  }).state, 'conflict')
  assert.equal(parseBankMailPdfPublishedImport({
    attachmentJobId: ids.job,
    state: 'attached',
    resolutionCode: 'openexpert_mock_esis_attached',
    documentId: ids.document,
    fileName: `${applicationNumber}-formularz-ESIS.pdf`,
    completedAt: '2026-08-21T12:02:00.000Z',
    replayed: false,
  }).state, 'attached')
  assert.equal(parseBankMailPdfPublishedImport({
    attachmentJobId: ids.job,
    state: 'review_required',
    resolutionCode: 'existing_esis_requires_review',
    documentId: null,
    fileName: null,
    completedAt: '2026-08-21T12:02:00.000Z',
    replayed: false,
  }).state, 'review_required')
  assert.equal(parseBankMailPdfFailureResult({
    attachmentJobId: ids.job,
    state: 'retrying',
    resolutionCode: 'provider_unavailable',
    retryAfterSeconds: 60,
    completedAt: null,
    replayed: false,
  }).state, 'retrying')
  assert.equal(parseBankMailPdfFailureResult({
    attachmentJobId: ids.job,
    state: 'attached',
    resolutionCode: 'openexpert_mock_esis_attached',
    retryAfterSeconds: 0,
    completedAt: '2026-08-21T12:02:00.000Z',
    replayed: true,
  }).state, 'attached')
  assert.throws(() => parseBankMailPdfFailureResult({
    attachmentJobId: ids.job,
    state: 'retrying',
    resolutionCode: 'provider_unavailable',
    retryAfterSeconds: 0,
    completedAt: null,
    replayed: false,
  }), /failure\.shape/u)
})

test('counts an attached failure replay as completed after a lost publish response', () => {
  const totals = {
    claimed: 1,
    completed: 0,
    retrying: 0,
    reviewRequired: 0,
    failed: 0,
    conflicts: 0,
  }
  recordBankMailPdfDrainOutcome(totals, 'attached')
  assert.deepEqual(totals, {
    claimed: 1,
    completed: 1,
    retrying: 0,
    reviewRequired: 0,
    failed: 0,
    conflicts: 0,
  })
})

function pdfStorageStub(input: {
  upload: StorageClient['upload']
  download: StorageClient['download']
}): StorageClient {
  return {
    ...input,
    head: async () => null,
    delete: async () => undefined,
    list: async () => ({ objects: [] }),
    createSignedUrl: async () => { throw new Error('unused') },
    createSignedUploadUrl: async () => { throw new Error('unused') },
    getPublicUrl: () => { throw new Error('unused') },
  }
}

test('treats upload failure with no readback as retryable storage unavailability', async () => {
  const storage = pdfStorageStub({
    upload: async () => { throw new Error('provider unavailable') },
    download: async () => null,
  })
  await assert.rejects(
    persistExactBankMailPdf({
      storage,
      path: 'org/case/job.pdf',
      bytes: pdfBytes,
      sha256: createHash('sha256').update(pdfBytes).digest('hex'),
    }),
    (error: unknown) => error instanceof BankMailPdfProcessingError
      && error.code === 'storage_unavailable'
      && error.retryable,
  )
})

test('treats successful upload with missing readback as retryable storage unavailability', async () => {
  const storage = pdfStorageStub({
    upload: async input => ({
      namespace: input.namespace,
      path: input.path,
      access: 'private',
      size: input.size,
      contentType: input.contentType,
    }),
    download: async () => null,
  })
  await assert.rejects(
    persistExactBankMailPdf({
      storage,
      path: 'org/case/job.pdf',
      bytes: pdfBytes,
      sha256: createHash('sha256').update(pdfBytes).digest('hex'),
    }),
    (error: unknown) => error instanceof BankMailPdfProcessingError
      && error.code === 'storage_unavailable'
      && error.retryable,
  )
})

test('recovers from a lost upload response when exact immutable PDF exists', async () => {
  const backing = createStorageClient(createInMemoryStorageProvider())
  const path = 'org/case/job.pdf'
  await backing.upload({
    namespace: 'crm-case-documents',
    path,
    body: pdfBytes,
    contentType: 'application/pdf',
    size: pdfBytes.byteLength,
    overwrite: false,
  })
  const storage = pdfStorageStub({
    upload: async () => { throw new Error('lost response') },
    download: input => backing.download(input),
  })
  await persistExactBankMailPdf({
    storage,
    path,
    bytes: pdfBytes,
    sha256: createHash('sha256').update(pdfBytes).digest('hex'),
  })
})

test('rejects an existing deterministic path with different bytes as a conflict', async () => {
  const backing = createStorageClient(createInMemoryStorageProvider())
  const path = 'org/case/job.pdf'
  const differentPdf = new TextEncoder().encode('%PDF-1.7\ndifferent\n%%EOF')
  await backing.upload({
    namespace: 'crm-case-documents',
    path,
    body: differentPdf,
    contentType: 'application/pdf',
    size: differentPdf.byteLength,
    overwrite: false,
  })
  const storage = pdfStorageStub({
    upload: async () => { throw new Error('precondition failed') },
    download: input => backing.download(input),
  })
  await assert.rejects(
    persistExactBankMailPdf({
      storage,
      path,
      bytes: pdfBytes,
      sha256: createHash('sha256').update(pdfBytes).digest('hex'),
    }),
    (error: unknown) => error instanceof BankMailPdfProcessingError
      && error.code === 'storage_object_conflict'
      && !error.retryable,
  )
})
