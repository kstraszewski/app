import { createHash } from 'node:crypto'
import {
  type StorageClient,
} from '@openexpert/storage'
import {
  assertOpenExpertMockBankApplicationNumber,
  assertOpenExpertMockBankRequestId,
  OPENEXPERT_MOCK_BANK_ARCHIVE_MEDIA_TYPE,
  type OpenExpertMockBankDecisionOutcome,
  type OpenExpertMockBankDocumentKind,
  type OpenExpertMockBankFinancialTerms,
} from './openexpert-mock-bank-documents.ts'

export const OPENEXPERT_MOCK_BANK_OUTBOX_NAMESPACE = 'crm-mock-bank-outbox' as const
export const OPENEXPERT_MOCK_BANK_MANIFEST_MEDIA_TYPE = 'application/json' as const
export const OPENEXPERT_MOCK_BANK_PAYLOAD_VERSION = 1 as const
export const MAX_OPENEXPERT_MOCK_BANK_OUTBOX_OBJECT_BYTES = 5 * 1024 * 1024
export const MAX_OPENEXPERT_MOCK_BANK_MANIFEST_BYTES = 256 * 1024

const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u

export interface OpenExpertMockBankPayloadIdentity {
  dispatchId: string
  payloadId: string
  applicationId: string
  applicationNumber: string
  kind: OpenExpertMockBankDocumentKind
  generation: number
  generationStartedAt: string
}

export interface OpenExpertMockBankPersistedPayloadManifest {
  version: typeof OPENEXPERT_MOCK_BANK_PAYLOAD_VERSION
  identity: OpenExpertMockBankPayloadIdentity
  transport: {
    provider: 'resend' | 'smtp'
    from: string
    replyTo: string | null
  }
  message: {
    to: string
    subject: string
    html: string
    text: string
    idempotencyKey: string
    tags: Array<{ name: string, value: string }>
    attachment: {
      filename: string
      contentType: typeof OPENEXPERT_MOCK_BANK_ARCHIVE_MEDIA_TYPE
    }
  }
  document: {
    pdfFileName: string
    issueDate: string
    validUntil: string | null
    decisionOutcome: OpenExpertMockBankDecisionOutcome | null
    applicantNames: string[]
    financialTerms: OpenExpertMockBankFinancialTerms
  }
}

export interface OpenExpertMockBankStoredObject {
  bytes: Uint8Array
  sha256: string
  sizeBytes: number
}

function invalid(message: string): never {
  throw new TypeError(`Nieprawidłowy payload OpenExpert Banku: ${message}`)
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], field: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    invalid(`${field} zawiera nieoczekiwane pola`)
  }
}

function text(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string' || !value || value.length > maximum || /[\u0000\u000d]/u.test(value)) {
    invalid(field)
  }
  return value
}

function line(value: unknown, field: string, maximum: number): string {
  const result = text(value, field, maximum)
  if (result.trim() !== result || /[\u000a\u2028\u2029]/u.test(result)) invalid(field)
  return result
}

function positiveInteger(value: unknown, field: string, maximum = Number.MAX_SAFE_INTEGER): number {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) invalid(field)
  return result
}

function finiteNumber(value: unknown, field: string): number {
  const result = Number(value)
  if (typeof value !== 'number' || !Number.isFinite(result) || result < 0) invalid(field)
  return result
}

function nullableLine(value: unknown, field: string, maximum: number): string | null {
  return value === null ? null : line(value, field, maximum)
}

function dateOnly(value: unknown, field: string): string {
  const result = line(value, field, 10)
  if (!DATE_ONLY_PATTERN.test(result)
    || new Date(`${result}T00:00:00.000Z`).toISOString().slice(0, 10) !== result) {
    invalid(field)
  }
  return result
}

function assertIdentity(
  value: unknown,
  expected?: OpenExpertMockBankPayloadIdentity,
): OpenExpertMockBankPayloadIdentity {
  const input = record(value, 'identity')
  exactKeys(input, [
    'dispatchId',
    'payloadId',
    'applicationId',
    'applicationNumber',
    'kind',
    'generation',
    'generationStartedAt',
  ], 'identity')
  const kind = input.kind
  if (kind !== 'esis' && kind !== 'credit_decision') invalid('identity.kind')
  const generationStartedAt = line(input.generationStartedAt, 'identity.generationStartedAt', 40)
  if (!Number.isFinite(Date.parse(generationStartedAt))) invalid('identity.generationStartedAt')
  const result: OpenExpertMockBankPayloadIdentity = {
    dispatchId: assertOpenExpertMockBankRequestId(input.dispatchId),
    payloadId: assertOpenExpertMockBankRequestId(input.payloadId),
    applicationId: assertOpenExpertMockBankRequestId(input.applicationId),
    applicationNumber: assertOpenExpertMockBankApplicationNumber(input.applicationNumber),
    kind,
    generation: positiveInteger(input.generation, 'identity.generation'),
    generationStartedAt,
  }
  if (expected && (
    result.dispatchId !== expected.dispatchId
    || result.payloadId !== expected.payloadId
    || result.applicationId !== expected.applicationId
    || result.applicationNumber !== expected.applicationNumber
    || result.kind !== expected.kind
    || result.generation !== expected.generation
    || result.generationStartedAt !== expected.generationStartedAt
  )) {
    invalid('identity nie odpowiada rezerwacji')
  }
  return result
}

function assertFinancialTerms(value: unknown): OpenExpertMockBankFinancialTerms {
  const input = record(value, 'document.financialTerms')
  exactKeys(input, [
    'loanAmount',
    'currency',
    'annualInterestRate',
    'aprc',
    'monthlyInstallment',
    'termMonths',
  ], 'document.financialTerms')
  const currency = line(input.currency, 'document.financialTerms.currency', 3)
  if (!/^[A-Z]{3}$/u.test(currency)) invalid('document.financialTerms.currency')
  return {
    loanAmount: finiteNumber(input.loanAmount, 'document.financialTerms.loanAmount'),
    currency,
    annualInterestRate: finiteNumber(
      input.annualInterestRate,
      'document.financialTerms.annualInterestRate',
    ),
    aprc: finiteNumber(input.aprc, 'document.financialTerms.aprc'),
    monthlyInstallment: finiteNumber(
      input.monthlyInstallment,
      'document.financialTerms.monthlyInstallment',
    ),
    termMonths: positiveInteger(input.termMonths, 'document.financialTerms.termMonths', 600),
  }
}

export function assertOpenExpertMockBankPayloadManifest(
  value: unknown,
  expectedIdentity?: OpenExpertMockBankPayloadIdentity,
): OpenExpertMockBankPersistedPayloadManifest {
  const input = record(value, 'root')
  exactKeys(input, ['version', 'identity', 'transport', 'message', 'document'], 'root')
  if (input.version !== OPENEXPERT_MOCK_BANK_PAYLOAD_VERSION) invalid('version')
  const identity = assertIdentity(input.identity, expectedIdentity)

  const transportInput = record(input.transport, 'transport')
  exactKeys(transportInput, ['provider', 'from', 'replyTo'], 'transport')
  const provider = transportInput.provider
  if (provider !== 'resend' && provider !== 'smtp') invalid('transport.provider')
  const transport: OpenExpertMockBankPersistedPayloadManifest['transport'] = {
    provider,
    from: line(transportInput.from, 'transport.from', 320),
    replyTo: nullableLine(transportInput.replyTo, 'transport.replyTo', 320),
  }

  const messageInput = record(input.message, 'message')
  exactKeys(messageInput, [
    'to', 'subject', 'html', 'text', 'idempotencyKey', 'tags', 'attachment',
  ], 'message')
  const attachmentInput = record(messageInput.attachment, 'message.attachment')
  exactKeys(attachmentInput, ['filename', 'contentType'], 'message.attachment')
  if (attachmentInput.contentType !== OPENEXPERT_MOCK_BANK_ARCHIVE_MEDIA_TYPE) {
    invalid('message.attachment.contentType')
  }
  if (!Array.isArray(messageInput.tags) || messageInput.tags.length > 10) {
    invalid('message.tags')
  }
  const tags = messageInput.tags.map((tag, index) => {
    const tagInput = record(tag, `message.tags.${index}`)
    exactKeys(tagInput, ['name', 'value'], `message.tags.${index}`)
    return {
      name: line(tagInput.name, `message.tags.${index}.name`, 256),
      value: line(tagInput.value, `message.tags.${index}.value`, 256),
    }
  })
  const message = {
    to: line(messageInput.to, 'message.to', 320),
    subject: line(messageInput.subject, 'message.subject', 998),
    html: text(messageInput.html, 'message.html', 100_000),
    text: text(messageInput.text, 'message.text', 100_000),
    idempotencyKey: line(messageInput.idempotencyKey, 'message.idempotencyKey', 256),
    tags,
    attachment: {
      filename: line(attachmentInput.filename, 'message.attachment.filename', 255),
      contentType: OPENEXPERT_MOCK_BANK_ARCHIVE_MEDIA_TYPE,
    },
  }

  const documentInput = record(input.document, 'document')
  exactKeys(documentInput, [
    'pdfFileName',
    'issueDate',
    'validUntil',
    'decisionOutcome',
    'applicantNames',
    'financialTerms',
  ], 'document')
  if (!Array.isArray(documentInput.applicantNames)
    || documentInput.applicantNames.length < 1
    || documentInput.applicantNames.length > 20) {
    invalid('document.applicantNames')
  }
  const applicantNames = documentInput.applicantNames.map((name, index) => (
    line(name, `document.applicantNames.${index}`, 200)
  ))
  const decisionOutcome = documentInput.decisionOutcome
  if (decisionOutcome !== null && decisionOutcome !== 'positive' && decisionOutcome !== 'negative') {
    invalid('document.decisionOutcome')
  }
  if ((identity.kind === 'esis') !== (decisionOutcome === null)) {
    invalid('document.decisionOutcome nie odpowiada rodzajowi dokumentu')
  }
  const validUntil = documentInput.validUntil === null
    ? null
    : dateOnly(documentInput.validUntil, 'document.validUntil')
  if ((identity.kind === 'esis' || decisionOutcome === 'positive') && !validUntil) {
    invalid('document.validUntil')
  }

  return {
    version: OPENEXPERT_MOCK_BANK_PAYLOAD_VERSION,
    identity,
    transport,
    message,
    document: {
      pdfFileName: line(documentInput.pdfFileName, 'document.pdfFileName', 255),
      issueDate: dateOnly(documentInput.issueDate, 'document.issueDate'),
      validUntil,
      decisionOutcome,
      applicantNames,
      financialTerms: assertFinancialTerms(documentInput.financialTerms),
    },
  }
}

export function encodeOpenExpertMockBankPayloadManifest(
  value: OpenExpertMockBankPersistedPayloadManifest,
): Uint8Array {
  const manifest = assertOpenExpertMockBankPayloadManifest(value, value.identity)
  const bytes = new TextEncoder().encode(JSON.stringify(manifest))
  if (bytes.byteLength > MAX_OPENEXPERT_MOCK_BANK_MANIFEST_BYTES) invalid('manifest jest za duży')
  return bytes
}

export function decodeOpenExpertMockBankPayloadManifest(
  bytes: Uint8Array,
  expectedIdentity?: OpenExpertMockBankPayloadIdentity,
): OpenExpertMockBankPersistedPayloadManifest {
  if (!(bytes instanceof Uint8Array)
    || bytes.byteLength < 2
    || bytes.byteLength > MAX_OPENEXPERT_MOCK_BANK_MANIFEST_BYTES) {
    invalid('manifest ma nieprawidłowy rozmiar')
  }
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  }
  catch {
    invalid('manifest nie jest poprawnym JSON UTF-8')
  }
  return assertOpenExpertMockBankPayloadManifest(value, expectedIdentity)
}

export function openExpertMockBankPayloadObjectPaths(
  input: OpenExpertMockBankPayloadIdentity & { organizationId: string },
): { manifestPath: string, archivePath: string } {
  const { organizationId: rawOrganizationId, ...rawIdentity } = input
  const organizationId = assertOpenExpertMockBankRequestId(rawOrganizationId)
  const identity = assertIdentity(rawIdentity, rawIdentity)
  const prefix = [
    organizationId,
    identity.applicationId,
    identity.dispatchId,
    identity.kind,
    `generation-${identity.generation}-${identity.payloadId}`,
  ].join('/')
  return {
    manifestPath: `${prefix}.json`,
    archivePath: `${prefix}.zip`,
  }
}

export function openExpertMockBankSha256(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array)) invalid('hashowane dane nie są bajtami')
  return createHash('sha256').update(bytes).digest('hex')
}

export function openExpertMockBankFullPayloadSha256(input: {
  manifestBytes: Uint8Array
  archiveBytes: Uint8Array
}): string {
  return createHash('sha256')
    .update('openexpert-mock-bank/full-payload/v1\0', 'utf8')
    .update(input.manifestBytes)
    .update('\0', 'utf8')
    .update(input.archiveBytes)
    .digest('hex')
}

function assertSha256(value: string, field: string): string {
  if (!SHA256_PATTERN.test(value)) invalid(field)
  return value
}

async function streamBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!(value instanceof Uint8Array)) invalid('obiekt storage nie zwrócił bajtów')
      total += value.byteLength
      if (total > MAX_OPENEXPERT_MOCK_BANK_OUTBOX_OBJECT_BYTES) {
        await reader.cancel('openexpert-mock-bank-object-size-limit')
        invalid('obiekt storage przekracza limit')
      }
      chunks.push(value)
    }
  }
  finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function downloadObject(
  storage: StorageClient,
  path: string,
  contentType: string,
): Promise<OpenExpertMockBankStoredObject | null> {
  const result = await storage.download({
    namespace: OPENEXPERT_MOCK_BANK_OUTBOX_NAMESPACE,
    path,
  })
  if (!result) return null
  if (result.object.contentType !== contentType) invalid('content-type obiektu storage')
  if (!Number.isSafeInteger(result.object.size)
    || result.object.size < 1
    || result.object.size > MAX_OPENEXPERT_MOCK_BANK_OUTBOX_OBJECT_BYTES) {
    invalid('zadeklarowany rozmiar obiektu storage')
  }
  const bytes = await streamBytes(result.stream)
  if (result.object.size !== bytes.byteLength) invalid('rozmiar obiektu storage')
  return {
    bytes,
    sha256: openExpertMockBankSha256(bytes),
    sizeBytes: bytes.byteLength,
  }
}

export async function persistOrRecoverOpenExpertMockBankObject(input: {
  storage: StorageClient
  path: string
  contentType: typeof OPENEXPERT_MOCK_BANK_MANIFEST_MEDIA_TYPE
    | typeof OPENEXPERT_MOCK_BANK_ARCHIVE_MEDIA_TYPE
  bytes: Uint8Array
}): Promise<OpenExpertMockBankStoredObject> {
  if (!(input.bytes instanceof Uint8Array)
    || input.bytes.byteLength < 1
    || input.bytes.byteLength > MAX_OPENEXPERT_MOCK_BANK_OUTBOX_OBJECT_BYTES) {
    invalid('zapisywany obiekt ma nieprawidłowy rozmiar')
  }
  try {
    await input.storage.upload({
      namespace: OPENEXPERT_MOCK_BANK_OUTBOX_NAMESPACE,
      path: input.path,
      body: input.bytes,
      contentType: input.contentType,
      size: input.bytes.byteLength,
      overwrite: false,
    })
  }
  catch (error) {
    // S3/MinIO and Vercel Blob do not expose the same conflict error class.
    // An immutable object at this exact path is the recovery record; use it
    // after any upload failure, and surface the original failure if no object
    // actually exists.
    const recovered = await downloadObject(input.storage, input.path, input.contentType)
    if (recovered) return recovered
    throw error
  }
  const stored = await downloadObject(input.storage, input.path, input.contentType)
  if (!stored) invalid('obiekt zniknął po zapisie')
  return stored
}

/**
 * Repairs only an uncommitted zero-byte object left by an incompatible storage
 * adapter. Once payload hashes are committed this path is never called, so an
 * immutable, valid first writer remains authoritative.
 */
export async function discardEmptyUncommittedOpenExpertMockBankObject(input: {
  storage: StorageClient
  path: string
}): Promise<boolean> {
  const object = await input.storage.head({
    namespace: OPENEXPERT_MOCK_BANK_OUTBOX_NAMESPACE,
    path: input.path,
  })
  if (!object || object.size !== 0) return false
  await input.storage.delete({
    namespace: OPENEXPERT_MOCK_BANK_OUTBOX_NAMESPACE,
    path: input.path,
  })
  return true
}

export async function loadOpenExpertMockBankObject(input: {
  storage: StorageClient
  path: string
  contentType: typeof OPENEXPERT_MOCK_BANK_MANIFEST_MEDIA_TYPE
    | typeof OPENEXPERT_MOCK_BANK_ARCHIVE_MEDIA_TYPE
  expectedSha256?: string | null
  expectedSizeBytes?: number | null
}): Promise<OpenExpertMockBankStoredObject | null> {
  const stored = await downloadObject(input.storage, input.path, input.contentType)
  if (!stored) return null
  if (input.expectedSha256 && stored.sha256 !== assertSha256(input.expectedSha256, 'sha256')) {
    invalid('hash obiektu storage nie zgadza się z ledgerem')
  }
  if (input.expectedSizeBytes !== undefined
    && input.expectedSizeBytes !== null
    && stored.sizeBytes !== positiveInteger(input.expectedSizeBytes, 'sizeBytes')) {
    invalid('rozmiar obiektu storage nie zgadza się z ledgerem')
  }
  return stored
}
