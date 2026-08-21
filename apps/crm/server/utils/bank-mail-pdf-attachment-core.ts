import { createHash } from 'node:crypto'
import {
  gmailMessageAttachmentSources,
  gmailMessageDetail,
  type GmailAttachmentSource,
  type GmailMessageResource,
} from './gmail-message.ts'
import { canonicalBankMailSourceSha256 } from './bank-mail-agent-ingestion-core.ts'
import { bankMailProviderMessageIdentitySha256 } from './bank-mail-agent-status-core.ts'
import type {
  OpenExpertMockBankExtractedDocument,
} from './openexpert-mock-bank-documents.ts'
import { openExpertMockBankEsisTextMatchesDocument } from './openexpert-mock-bank-documents.ts'
import {
  decodeOpenExpertMockBankPayloadManifest,
  openExpertMockBankFullPayloadSha256,
  type OpenExpertMockBankPersistedPayloadManifest,
} from './openexpert-mock-bank-payload.ts'
import { MAX_GMAIL_BANK_ATTACHMENT_BYTES } from './gmail-attachment-core.ts'

export const BANK_MAIL_PDF_WORKER_SERVICE_ID = 'openexpert-crm-bank-mail-pdf-worker' as const
export const BANK_MAIL_PDF_WORKER_PRESET = 'bank-mail-pdf-attachment' as const
export const BANK_MAIL_PDF_CLAIM_SOURCE = 'crm-bank-mail-pdf-claim-v1' as const
export const BANK_MAIL_PDF_PROOF_SOURCE = 'crm-bank-mail-pdf-proof-v1' as const
export const BANK_MAIL_PDF_IMPORT_SOURCE = 'crm-bank-mail-pdf-import-v1' as const
export const BANK_MAIL_PDF_PUBLISH_SOURCE = 'crm-bank-mail-pdf-publish-v1' as const
export const BANK_MAIL_PDF_FAILURE_SOURCE = 'crm-bank-mail-pdf-failure-v1' as const

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const LEASE_TOKEN_PATTERN = /^[0-9a-f]{64}$/u
const APPLICATION_NUMBER_PATTERN = /^OEB-\d{8}-\d{6}$/u
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u

export interface BankMailPdfAttachmentJob {
  attachmentJobId: string
  state: 'downloading'
  leaseToken: string
  attemptNo: number
  leaseExpiresAt: string
  organizationId: string
  connectionId: string
  mailboxOwnerUserId: string
  provider: 'google'
  threadReference: string
  caseId: string
  applicationId: string
  dispatchId: string
  dispatchGeneration: number
  dispatchPayloadId: string
  dispatchGenerationStartedAt: string
  providerMessageIdSha256: string
  intakeSourceSha256: string
  attachmentFileName: string
  pdfFileName: string
  generationContextSha256: string
  manifestStorageBucket: 'crm-mock-bank-outbox'
  manifestStoragePath: string
  manifestSha256: string
  manifestSizeBytes: number
  payloadSha256: string
  archiveSha256: string
  archiveSizeBytes: number
  applicationNumber: string
  issueDate: string
  validUntil: string
  replayed: boolean
}

export interface BankMailPdfTerminalResolution {
  attachmentJobId: string
  state: 'failed' | 'conflict'
  resolutionCode: string
  replayed: false
}

export interface BankMailPdfProofSuccess {
  attachmentJobId: string
  state: 'unlocking'
  credentialKind: 'primary_pesel'
  credential: string
  replayed: boolean
}

export type BankMailPdfProofResult =
  | BankMailPdfProofSuccess
  | BankMailPdfTerminalResolution

export interface BankMailPdfPreparedImportSuccess {
  attachmentJobId: string
  state: 'importing'
  storageBucket: 'crm-case-documents'
  storagePath: string
  fileName: string
  replayed: boolean
}

export type BankMailPdfPreparedImport =
  | BankMailPdfPreparedImportSuccess
  | BankMailPdfTerminalResolution

export interface BankMailPdfPublishedImportSuccess {
  attachmentJobId: string
  state: 'attached'
  resolutionCode: string
  documentId: string
  fileName: string
  completedAt: string
  replayed: boolean
}

export interface BankMailPdfPublishedTerminal {
  attachmentJobId: string
  state: 'review_required' | 'failed' | 'conflict'
  resolutionCode: string
  documentId: null
  fileName: null
  completedAt: string
  replayed: boolean
}

export type BankMailPdfPublishedImport =
  | BankMailPdfPublishedImportSuccess
  | BankMailPdfPublishedTerminal

export type BankMailPdfFailureCode =
  | BankMailPdfSourceFailureCode
  | 'archive_hash_mismatch'
  | 'archive_invalid'
  | 'mail_connection_unavailable'
  | 'gmail_unavailable'
  | 'storage_object_conflict'
  | 'storage_unavailable'
  | 'publish_unavailable'
  | 'processing_failed'

export interface BankMailPdfFailureResult {
  attachmentJobId: string
  state: 'retrying' | 'review_required' | 'failed' | 'conflict' | 'attached'
  resolutionCode: string
  retryAfterSeconds: number
  completedAt: string | null
  replayed: boolean
}

export interface BankMailPdfAttachmentDrainResult {
  claimed: number
  completed: number
  retrying: number
  reviewRequired: number
  failed: number
  conflicts: number
}

export function recordBankMailPdfDrainOutcome(
  totals: BankMailPdfAttachmentDrainResult,
  state: BankMailPdfFailureResult['state'],
): void {
  if (state === 'attached') totals.completed += 1
  else if (state === 'retrying') totals.retrying += 1
  else if (state === 'review_required') totals.reviewRequired += 1
  else if (state === 'conflict') totals.conflicts += 1
  else totals.failed += 1
}

export class BankMailPdfProcessingError extends Error {
  readonly code: BankMailPdfFailureCode
  readonly retryable: boolean

  constructor(code: BankMailPdfFailureCode, retryable: boolean) {
    super(code)
    this.name = 'BankMailPdfProcessingError'
    this.code = code
    this.retryable = retryable
  }
}

export class BankMailPdfTerminalResolutionError extends Error {
  readonly result: {
    state: 'review_required' | 'failed' | 'conflict'
    resolutionCode: string
  }

  constructor(result: {
    state: 'review_required' | 'failed' | 'conflict'
    resolutionCode: string
  }) {
    super(result.resolutionCode)
    this.name = 'BankMailPdfTerminalResolutionError'
    this.result = result
  }
}

export function bankMailPdfConnectionCacheKey(
  job: Pick<BankMailPdfAttachmentJob, 'organizationId' | 'mailboxOwnerUserId' | 'connectionId'>,
): string {
  return [job.organizationId, job.mailboxOwnerUserId, job.connectionId].join('\u001f')
}

export function bankMailPdfAccessTokenFromCache(
  job: Pick<BankMailPdfAttachmentJob, 'organizationId' | 'mailboxOwnerUserId' | 'connectionId'>,
  cache: Map<string, Promise<string>>,
  load: () => Promise<string>,
): Promise<string> {
  const key = bankMailPdfConnectionCacheKey(job)
  const existing = cache.get(key)
  if (existing) return existing
  const pending = load()
  cache.set(key, pending)
  return pending
}

type UnknownRecord = Record<string, unknown>

function record(value: unknown, field: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Invalid bank-mail PDF contract (${field})`)
  }
  return value as UnknownRecord
}

function exactKeys(value: UnknownRecord, expected: readonly string[], field: string): void {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  if (actual.length !== sortedExpected.length
    || actual.some((key, index) => key !== sortedExpected[index])) {
    throw new TypeError(`Invalid bank-mail PDF contract (${field}.keys)`)
  }
}

function text(value: unknown, field: string, maximum = 4_096): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > maximum
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    throw new TypeError(`Invalid bank-mail PDF contract (${field})`)
  }
  return value
}

function uuid(value: unknown, field: string): string {
  const result = text(value, field, 36).toLowerCase()
  if (!UUID_PATTERN.test(result)) throw new TypeError(`Invalid bank-mail PDF contract (${field})`)
  return result
}

function sha256(value: unknown, field: string): string {
  const result = text(value, field, 64)
  if (!SHA256_PATTERN.test(result)) throw new TypeError(`Invalid bank-mail PDF contract (${field})`)
  return result
}

function timestamp(value: unknown, field: string): string {
  const result = text(value, field, 40)
  if (!Number.isFinite(Date.parse(result))) {
    throw new TypeError(`Invalid bank-mail PDF contract (${field})`)
  }
  return result
}

function positiveInteger(value: unknown, field: string, maximum: number): number {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) {
    throw new TypeError(`Invalid bank-mail PDF contract (${field})`)
  }
  return result
}

export function parseBankMailPdfAttachmentJob(value: unknown): BankMailPdfAttachmentJob {
  const row = record(value, 'job')
  exactKeys(row, [
    'attachmentJobId',
    'state',
    'leaseToken',
    'attemptNo',
    'leaseExpiresAt',
    'organizationId',
    'connectionId',
    'mailboxOwnerUserId',
    'provider',
    'threadReference',
    'caseId',
    'applicationId',
    'dispatchId',
    'dispatchGeneration',
    'dispatchPayloadId',
    'dispatchGenerationStartedAt',
    'providerMessageIdSha256',
    'intakeSourceSha256',
    'attachmentFileName',
    'pdfFileName',
    'generationContextSha256',
    'manifestStorageBucket',
    'manifestStoragePath',
    'manifestSha256',
    'manifestSizeBytes',
    'payloadSha256',
    'archiveSha256',
    'archiveSizeBytes',
    'applicationNumber',
    'issueDate',
    'validUntil',
    'replayed',
  ], 'job')
  if (row.state !== 'downloading'
    || row.provider !== 'google'
    || row.manifestStorageBucket !== 'crm-mock-bank-outbox'
    || typeof row.replayed !== 'boolean') {
    throw new TypeError('Invalid bank-mail PDF contract (job.state)')
  }
  const leaseToken = text(row.leaseToken, 'job.leaseToken', 64)
  if (!LEASE_TOKEN_PATTERN.test(leaseToken)) {
    throw new TypeError('Invalid bank-mail PDF contract (job.leaseToken)')
  }
  const applicationNumber = text(row.applicationNumber, 'job.applicationNumber', 19)
  if (!APPLICATION_NUMBER_PATTERN.test(applicationNumber)) {
    throw new TypeError('Invalid bank-mail PDF contract (job.applicationNumber)')
  }
  const issueDate = text(row.issueDate, 'job.issueDate', 10)
  if (!DATE_ONLY_PATTERN.test(issueDate)
    || new Date(`${issueDate}T00:00:00.000Z`).toISOString().slice(0, 10) !== issueDate) {
    throw new TypeError('Invalid bank-mail PDF contract (job.issueDate)')
  }
  const attachmentFileName = text(row.attachmentFileName, 'job.attachmentFileName', 255)
  const pdfFileName = text(row.pdfFileName, 'job.pdfFileName', 255)
  if (!attachmentFileName.endsWith('.zip') || !pdfFileName.endsWith('.pdf')) {
    throw new TypeError('Invalid bank-mail PDF contract (job.fileName)')
  }
  const organizationId = uuid(row.organizationId, 'job.organizationId')
  const applicationId = uuid(row.applicationId, 'job.applicationId')
  const dispatchId = uuid(row.dispatchId, 'job.dispatchId')
  const dispatchGeneration = positiveInteger(
    row.dispatchGeneration,
    'job.dispatchGeneration',
    1_000_000,
  )
  const dispatchPayloadId = uuid(row.dispatchPayloadId, 'job.dispatchPayloadId')
  const manifestStoragePath = text(row.manifestStoragePath, 'job.manifestStoragePath', 1_024)
  if (manifestStoragePath !== [
    organizationId,
    applicationId,
    dispatchId,
    'esis',
    `generation-${dispatchGeneration}-${dispatchPayloadId}.json`,
  ].join('/')) {
    throw new TypeError('Invalid bank-mail PDF contract (job.manifestStoragePath)')
  }
  return {
    attachmentJobId: uuid(row.attachmentJobId, 'job.attachmentJobId'),
    state: 'downloading',
    leaseToken,
    attemptNo: positiveInteger(row.attemptNo, 'job.attemptNo', 100),
    leaseExpiresAt: timestamp(row.leaseExpiresAt, 'job.leaseExpiresAt'),
    organizationId,
    connectionId: uuid(row.connectionId, 'job.connectionId'),
    mailboxOwnerUserId: uuid(row.mailboxOwnerUserId, 'job.mailboxOwnerUserId'),
    provider: 'google',
    threadReference: text(row.threadReference, 'job.threadReference'),
    caseId: uuid(row.caseId, 'job.caseId'),
    applicationId,
    dispatchId,
    dispatchGeneration,
    dispatchPayloadId,
    dispatchGenerationStartedAt: new Date(timestamp(
      row.dispatchGenerationStartedAt,
      'job.dispatchGenerationStartedAt',
    )).toISOString(),
    providerMessageIdSha256: sha256(row.providerMessageIdSha256, 'job.providerMessageIdSha256'),
    intakeSourceSha256: sha256(row.intakeSourceSha256, 'job.intakeSourceSha256'),
    attachmentFileName,
    pdfFileName,
    generationContextSha256: sha256(
      row.generationContextSha256,
      'job.generationContextSha256',
    ),
    manifestStorageBucket: 'crm-mock-bank-outbox',
    manifestStoragePath,
    manifestSha256: sha256(row.manifestSha256, 'job.manifestSha256'),
    manifestSizeBytes: positiveInteger(
      row.manifestSizeBytes,
      'job.manifestSizeBytes',
      256 * 1_024,
    ),
    payloadSha256: sha256(row.payloadSha256, 'job.payloadSha256'),
    archiveSha256: sha256(row.archiveSha256, 'job.archiveSha256'),
    archiveSizeBytes: positiveInteger(
      row.archiveSizeBytes,
      'job.archiveSizeBytes',
      MAX_GMAIL_BANK_ATTACHMENT_BYTES,
    ),
    applicationNumber,
    issueDate,
    validUntil: new Date(timestamp(row.validUntil, 'job.validUntil')).toISOString(),
    replayed: row.replayed,
  }
}

export function parseBankMailPdfAttachmentJobs(value: unknown): BankMailPdfAttachmentJob[] {
  if (!Array.isArray(value) || value.length > 10) {
    throw new TypeError('Invalid bank-mail PDF contract (jobs)')
  }
  const jobs = value.map(parseBankMailPdfAttachmentJob)
  if (new Set(jobs.map(job => job.attachmentJobId)).size !== jobs.length) {
    throw new TypeError('Invalid bank-mail PDF contract (jobs.duplicate)')
  }
  return jobs
}

function parseBankMailPdfTerminalResolution(
  row: UnknownRecord,
  field: string,
): BankMailPdfTerminalResolution {
  exactKeys(row, ['attachmentJobId', 'state', 'resolutionCode', 'replayed'], field)
  if ((row.state !== 'failed' && row.state !== 'conflict') || row.replayed !== false) {
    throw new TypeError(`Invalid bank-mail PDF contract (${field}.terminal)`)
  }
  return {
    attachmentJobId: uuid(row.attachmentJobId, `${field}.attachmentJobId`),
    state: row.state,
    resolutionCode: text(row.resolutionCode, `${field}.resolutionCode`, 100),
    replayed: false,
  }
}

export function parseBankMailPdfProofResult(value: unknown): BankMailPdfProofResult {
  const row = record(value, 'proof')
  if (row.state === 'failed' || row.state === 'conflict') {
    return parseBankMailPdfTerminalResolution(row, 'proof')
  }
  exactKeys(row, [
    'attachmentJobId', 'state', 'credentialKind', 'credential', 'replayed',
  ], 'proof')
  if (row.state !== 'unlocking'
    || row.credentialKind !== 'primary_pesel'
    || typeof row.replayed !== 'boolean') {
    throw new TypeError('Invalid bank-mail PDF contract (proof.state)')
  }
  const credential = typeof row.credential === 'string' ? row.credential : ''
  if (!/^\d{11}$/u.test(credential)) {
    throw new TypeError('Invalid bank-mail PDF contract (proof.credential)')
  }
  return {
    attachmentJobId: uuid(row.attachmentJobId, 'proof.attachmentJobId'),
    state: 'unlocking',
    credentialKind: 'primary_pesel',
    credential,
    replayed: row.replayed,
  }
}

export function parseBankMailPdfPreparedImport(value: unknown): BankMailPdfPreparedImport {
  const row = record(value, 'prepare')
  if (row.state === 'failed' || row.state === 'conflict') {
    return parseBankMailPdfTerminalResolution(row, 'prepare')
  }
  exactKeys(row, [
    'attachmentJobId', 'state', 'storageBucket', 'storagePath', 'fileName', 'replayed',
  ], 'prepare')
  if (
    row.state !== 'importing'
    || row.storageBucket !== 'crm-case-documents'
    || typeof row.replayed !== 'boolean'
  ) {
    throw new TypeError('Invalid bank-mail PDF contract (prepare.state)')
  }
  return {
    attachmentJobId: uuid(row.attachmentJobId, 'prepare.attachmentJobId'),
    state: 'importing',
    storageBucket: 'crm-case-documents',
    storagePath: text(row.storagePath, 'prepare.storagePath', 1_024),
    fileName: text(row.fileName, 'prepare.fileName', 255),
    replayed: row.replayed,
  }
}

export function parseBankMailPdfPublishedImport(value: unknown): BankMailPdfPublishedImport {
  const row = record(value, 'publish')
  exactKeys(row, [
    'attachmentJobId', 'state', 'resolutionCode', 'documentId', 'fileName',
    'completedAt', 'replayed',
  ], 'publish')
  const attachmentJobId = uuid(row.attachmentJobId, 'publish.attachmentJobId')
  const resolutionCode = text(row.resolutionCode, 'publish.resolutionCode', 100)
  const completedAt = timestamp(row.completedAt, 'publish.completedAt')
  if (row.state === 'review_required' || row.state === 'failed' || row.state === 'conflict') {
    if (row.documentId !== null || row.fileName !== null || typeof row.replayed !== 'boolean') {
      throw new TypeError('Invalid bank-mail PDF contract (publish.terminal)')
    }
    return {
      attachmentJobId,
      state: row.state,
      resolutionCode,
      documentId: null,
      fileName: null,
      completedAt,
      replayed: row.replayed,
    }
  }
  if (row.state !== 'attached' || typeof row.replayed !== 'boolean') {
    throw new TypeError('Invalid bank-mail PDF contract (publish.state)')
  }
  return {
    attachmentJobId,
    state: 'attached',
    resolutionCode,
    documentId: uuid(row.documentId, 'publish.documentId'),
    fileName: text(row.fileName, 'publish.fileName', 255),
    completedAt,
    replayed: row.replayed,
  }
}

export function parseBankMailPdfFailureResult(value: unknown): BankMailPdfFailureResult {
  const row = record(value, 'failure')
  exactKeys(row, [
    'attachmentJobId', 'state', 'resolutionCode', 'retryAfterSeconds',
    'completedAt', 'replayed',
  ], 'failure')
  if (
    row.state !== 'retrying'
    && row.state !== 'review_required'
    && row.state !== 'failed'
    && row.state !== 'conflict'
    && row.state !== 'attached'
  ) {
    throw new TypeError('Invalid bank-mail PDF contract (failure.state)')
  }
  if (typeof row.replayed !== 'boolean') {
    throw new TypeError('Invalid bank-mail PDF contract (failure.replayed)')
  }
  const retryAfterSeconds = Number(row.retryAfterSeconds)
  if (!Number.isSafeInteger(retryAfterSeconds)
    || retryAfterSeconds < 0
    || retryAfterSeconds > 3_600) {
    throw new TypeError('Invalid bank-mail PDF contract (failure.retryAfterSeconds)')
  }
  const completedAt = row.completedAt === null
    ? null
    : timestamp(row.completedAt, 'failure.completedAt')
  if ((row.state === 'retrying' && (retryAfterSeconds < 1 || completedAt !== null))
    || (row.state !== 'retrying' && (retryAfterSeconds !== 0 || completedAt === null))) {
    throw new TypeError('Invalid bank-mail PDF contract (failure.shape)')
  }
  return {
    attachmentJobId: uuid(row.attachmentJobId, 'failure.attachmentJobId'),
    state: row.state,
    resolutionCode: text(row.resolutionCode, 'failure.resolutionCode', 100),
    retryAfterSeconds,
    completedAt,
    replayed: row.replayed,
  }
}

export interface BankMailPdfProcessorDependencies {
  now?(): number
  loadManifest(job: BankMailPdfAttachmentJob): Promise<{
    bytes: Uint8Array
    recipientEmail: string
  }>
  loadMessages(job: BankMailPdfAttachmentJob): Promise<readonly GmailMessageResource[]>
  downloadArchive(
    job: BankMailPdfAttachmentJob,
    source: ResolvedGmailBankPdfSource,
  ): Promise<Uint8Array>
  proveSource(input: {
    job: BankMailPdfAttachmentJob
    source: ResolvedGmailBankPdfSource
    archiveSha256: string
    archiveSizeBytes: number
  }): Promise<BankMailPdfProofResult>
  extractArchive(input: {
    job: BankMailPdfAttachmentJob
    archiveBytes: Uint8Array
    credential: string
  }): Promise<OpenExpertMockBankExtractedDocument>
  inspectPdf(pdfBytes: Uint8Array): Promise<{ pageCount: number, text: string }>
  beginImport(input: {
    job: BankMailPdfAttachmentJob
    pdfSha256: string
    pdfSizeBytes: number
  }): Promise<BankMailPdfPreparedImport>
  persistPdf(input: {
    job: BankMailPdfAttachmentJob
    prepared: BankMailPdfPreparedImportSuccess
    pdfBytes: Uint8Array
    pdfSha256: string
  }): Promise<void>
  publish(job: BankMailPdfAttachmentJob): Promise<BankMailPdfPublishedImport>
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function assertLeaseActive(
  job: BankMailPdfAttachmentJob,
  dependencies: BankMailPdfProcessorDependencies,
  minimumRemainingMilliseconds = 0,
): void {
  const now = dependencies.now?.() ?? Date.now()
  if (Date.parse(job.leaseExpiresAt) <= now + minimumRemainingMilliseconds) {
    throw new BankMailPdfProcessingError('processing_failed', true)
  }
}

export function verifyOpenExpertMockBankEsisPdfText(input: {
  text: string
  pageCount: number
  applicationNumber: string
  issueDate: string
  validUntil: string
  document: OpenExpertMockBankPersistedPayloadManifest['document']
}): void {
  const validUntilDate = input.validUntil.slice(0, 10)
  if (!openExpertMockBankEsisTextMatchesDocument({
    text: input.text,
    pageCount: input.pageCount,
    applicationNumber: input.applicationNumber,
    applicantNames: input.document.applicantNames,
    issueDate: input.issueDate,
    validUntil: validUntilDate,
    financialTerms: input.document.financialTerms,
  })) {
    throw new BankMailPdfProcessingError('archive_invalid', false)
  }
}

export async function processBankMailPdfAttachmentJob(
  job: BankMailPdfAttachmentJob,
  dependencies: BankMailPdfProcessorDependencies,
): Promise<BankMailPdfPublishedImportSuccess> {
  assertLeaseActive(job, dependencies)
  let manifestBytes: Uint8Array
  let recipientEmail: string
  let pinnedManifest: Extract<OpenExpertMockBankPersistedPayloadManifest, { version: 2 }>
  try {
    const loaded = await dependencies.loadManifest(job)
    manifestBytes = loaded.bytes
    recipientEmail = loaded.recipientEmail.trim().toLocaleLowerCase('en-US')
    if (!(manifestBytes instanceof Uint8Array)
      || manifestBytes.byteLength !== job.manifestSizeBytes
      || digest(manifestBytes) !== job.manifestSha256
      || !recipientEmail) {
      throw new TypeError('manifest mismatch')
    }
    const manifest = decodeOpenExpertMockBankPayloadManifest(manifestBytes, {
      dispatchId: job.dispatchId,
      payloadId: job.dispatchPayloadId,
      applicationId: job.applicationId,
      applicationNumber: job.applicationNumber,
      kind: 'esis',
      generation: job.dispatchGeneration,
      generationStartedAt: job.dispatchGenerationStartedAt,
    })
    if (manifest.version !== 2
      || manifest.generationContextSha256 !== job.generationContextSha256
      || manifest.message.to.trim().toLocaleLowerCase('en-US') !== recipientEmail
      || manifest.message.attachment.filename !== job.attachmentFileName
      || manifest.document.pdfFileName !== job.pdfFileName
      || manifest.document.issueDate !== job.issueDate
      || `${manifest.document.validUntil}T00:00:00.000Z` !== job.validUntil) {
      throw new TypeError('manifest context mismatch')
    }
    pinnedManifest = manifest
  }
  catch (error) {
    if (error instanceof BankMailPdfProcessingError) throw error
    throw new BankMailPdfProcessingError('source_content_changed', false)
  }
  assertLeaseActive(job, dependencies)
  let source: ResolvedGmailBankPdfSource
  try {
    source = resolveGmailBankPdfSource({
      messages: await dependencies.loadMessages(job),
      providerMessageIdSha256: job.providerMessageIdSha256,
      intakeSourceSha256: job.intakeSourceSha256,
      attachmentFileName: job.attachmentFileName,
      archiveSizeBytes: job.archiveSizeBytes,
    })
  }
  catch (error) {
    if (error instanceof BankMailPdfSourceError) {
      throw new BankMailPdfProcessingError(error.code, false)
    }
    throw error
  }

  // Resolving the raw Gmail message can consume most of the lease on a slow
  // mailbox. Fence the attachment fetch separately so an expired worker never
  // performs another provider side effect.
  assertLeaseActive(job, dependencies)
  const archiveBytes = await dependencies.downloadArchive(job, source)
  const archiveSha256 = digest(archiveBytes)
  if (
    archiveBytes.byteLength !== job.archiveSizeBytes
    || archiveSha256 !== job.archiveSha256
  ) {
    throw new BankMailPdfProcessingError('archive_hash_mismatch', false)
  }
  if (openExpertMockBankFullPayloadSha256({
    manifestBytes,
    archiveBytes,
  }) !== job.payloadSha256) {
    throw new BankMailPdfProcessingError('source_content_changed', false)
  }

  assertLeaseActive(job, dependencies)
  let proofResult: BankMailPdfProofResult | null = await dependencies.proveSource({
    job,
    source,
    archiveSha256,
    archiveSizeBytes: archiveBytes.byteLength,
  })
  if (proofResult.attachmentJobId !== job.attachmentJobId) {
    throw new BankMailPdfProcessingError('processing_failed', true)
  }
  if (proofResult.state !== 'unlocking') {
    throw new BankMailPdfTerminalResolutionError(proofResult)
  }
  let credential: string | null = proofResult.credential
  proofResult = null
  let extracted: OpenExpertMockBankExtractedDocument
  try {
    extracted = await dependencies.extractArchive({
      job,
      archiveBytes,
      credential,
    })
  }
  catch {
    throw new BankMailPdfProcessingError('archive_invalid', false)
  }
  finally {
    credential = null
  }
  if (
    extracted.fileName !== job.pdfFileName
    || extracted.mediaType !== 'application/pdf'
    || !(extracted.bytes instanceof Uint8Array)
  ) {
    throw new BankMailPdfProcessingError('archive_invalid', false)
  }

  const pdfSha256 = digest(extracted.bytes)
  verifyOpenExpertMockBankEsisPdfText({
    ...await dependencies.inspectPdf(extracted.bytes),
    applicationNumber: job.applicationNumber,
    issueDate: job.issueDate,
    validUntil: job.validUntil,
    document: pinnedManifest.document,
  })
  assertLeaseActive(job, dependencies)
  const prepared = await dependencies.beginImport({
    job,
    pdfSha256,
    pdfSizeBytes: extracted.bytes.byteLength,
  })
  if (prepared.attachmentJobId !== job.attachmentJobId) {
    throw new BankMailPdfProcessingError('processing_failed', true)
  }
  if (prepared.state !== 'importing') {
    throw new BankMailPdfTerminalResolutionError(prepared)
  }
  if (prepared.fileName !== job.pdfFileName) {
    throw new BankMailPdfProcessingError('processing_failed', true)
  }
  assertLeaseActive(job, dependencies, 5_000)
  await dependencies.persistPdf({
    job,
    prepared,
    pdfBytes: extracted.bytes,
    pdfSha256,
  })
  assertLeaseActive(job, dependencies)
  const published = await dependencies.publish(job)
  if (published.attachmentJobId !== job.attachmentJobId) {
    throw new BankMailPdfProcessingError('processing_failed', true)
  }
  if (published.state !== 'attached') {
    throw new BankMailPdfTerminalResolutionError(published)
  }
  return published
}

export type BankMailPdfSourceFailureCode =
  | 'source_message_missing'
  | 'source_message_ambiguous'
  | 'source_content_changed'
  | 'attachment_missing'
  | 'attachment_ambiguous'
  | 'attachment_locator_invalid'

export class BankMailPdfSourceError extends Error {
  readonly code: BankMailPdfSourceFailureCode

  constructor(code: BankMailPdfSourceFailureCode) {
    super(code)
    this.name = 'BankMailPdfSourceError'
    this.code = code
  }
}

export interface ResolvedGmailBankPdfSource {
  messageId: string
  attachmentOrdinal: number
  attachmentTokenSha256: string
  attachment: GmailAttachmentSource
}

function sha256DomainSeparated(domain: string, value: string): string {
  return createHash('sha256')
    .update(domain, 'utf8')
    .update('\0', 'utf8')
    .update(value, 'utf8')
    .digest('hex')
}

export function gmailAttachmentTokenSha256(source: GmailAttachmentSource): string {
  if (Boolean(source.attachmentId) === Boolean(source.inlineData)) {
    throw new BankMailPdfSourceError('attachment_locator_invalid')
  }
  return source.attachmentId
    ? sha256DomainSeparated('gmail-attachment-id/v1', source.attachmentId)
    : sha256DomainSeparated('gmail-inline-data/v1', source.inlineData!)
}

export function resolveGmailBankPdfSource(input: {
  messages: readonly GmailMessageResource[]
  providerMessageIdSha256: string
  intakeSourceSha256: string
  attachmentFileName: string
  archiveSizeBytes: number
  attachmentMimeType?: string
}): ResolvedGmailBankPdfSource {
  const matchingMessages = input.messages.filter(message => (
    bankMailProviderMessageIdentitySha256('google', String(message.id ?? ''))
      === input.providerMessageIdSha256
  ))
  if (!matchingMessages.length) throw new BankMailPdfSourceError('source_message_missing')
  if (matchingMessages.length !== 1) throw new BankMailPdfSourceError('source_message_ambiguous')

  const message = matchingMessages[0]!
  const detail = gmailMessageDetail(message)
  if (canonicalBankMailSourceSha256(detail) !== input.intakeSourceSha256) {
    throw new BankMailPdfSourceError('source_content_changed')
  }

  const expectedMimeType = (input.attachmentMimeType ?? 'application/zip').toLowerCase()
  const attachments = gmailMessageAttachmentSources(message)
  const candidates = attachments
    .map((attachment, attachmentOrdinal) => ({ attachment, attachmentOrdinal }))
    .filter(candidate => (
      candidate.attachment.filename === input.attachmentFileName
      && candidate.attachment.mimeType.toLowerCase() === expectedMimeType
      && candidate.attachment.size === input.archiveSizeBytes
    ))
  if (!candidates.length) throw new BankMailPdfSourceError('attachment_missing')
  if (candidates.length !== 1) throw new BankMailPdfSourceError('attachment_ambiguous')

  const candidate = candidates[0]!
  return {
    messageId: detail.id,
    attachmentOrdinal: candidate.attachmentOrdinal,
    attachmentTokenSha256: gmailAttachmentTokenSha256(candidate.attachment),
    attachment: candidate.attachment,
  }
}
