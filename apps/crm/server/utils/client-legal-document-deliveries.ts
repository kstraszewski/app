import { createHash, randomInt, randomUUID } from 'node:crypto'
import {
  createTransactionalEmailSender,
  EmailDeliveryError,
  normalizeTransactionalEmailAddress,
} from '@openexpert/email'
import type { H3Event } from 'h3'
import {
  intermediarySettingsReadiness,
  normalizeIntermediarySettings,
} from '../../shared/intermediary-settings.ts'
import { serverDataBackend } from './data-api'
import {
  CLIENT_LEGAL_DOCUMENTS_EMAIL_TEMPLATE_VERSION,
  clientLegalDocumentsEmailTemplate,
} from './client-legal-documents-email.ts'
import { INTERMEDIARY_DOCUMENT_GENERATOR_VERSION } from './intermediary-document-content.ts'
import {
  OfiSinglePageOverflowError,
  RodoSinglePageOverflowError,
} from './intermediary-document-pdf.ts'
import { createIntermediaryDocument } from './intermediary-documents.ts'
import { serverStorageClient } from './platform-storage'

const legalDocumentDeliveryConcurrency = 2
const legalDocumentNudgeLimit = 5
const legalDocumentNamespace = 'crm-legal-documents' as const
const maxLegalDocumentBytes = 5 * 1024 * 1024
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const sha256Pattern = /^[0-9a-f]{64}$/u
const emailInTextPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu

interface LegalDocumentEmailRuntimeConfig {
  apiKey?: string
  from?: string
  replyTo?: string
  smtp?: {
    host?: string
    port?: number
    secure?: boolean
    user?: string
    password?: string
  }
}

interface StoredDocumentReference {
  path: string | null
  sha256: string | null
  sizeBytes: number | null
}

interface ClientLegalDocumentDeliveryJob {
  id: string
  organizationId: string
  clientId: string
  recipientEmail: string | null
  intermediarySettingsRevision: number
  generatorVersion: number
  emailTemplateVersion: number
  idempotencyKey: string
  provider: string | null
  providerMessageId: string | null
  attempts: number
  maxAttempts: number
  createdAt: string
  ofi: StoredDocumentReference
  rodo: StoredDocumentReference
}

interface LegalDocumentAsset {
  bytes: Uint8Array
  path: string
  sha256: string
  sizeBytes: number
}

interface LegalDocumentAssets {
  ofi: LegalDocumentAsset
  rodo: LegalDocumentAsset
}

type LegalDocumentOutcome =
  | 'sent'
  | 'failed'
  | 'blocked_missing_email'
  | 'blocked_incomplete_settings'

interface LegalDocumentProcessResult {
  completed: number
  delivered: number
  failed: number
  blocked: number
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Legal document delivery contract is invalid: ${field} is required`)
  }
  return value.trim()
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function requiredUuid(value: unknown, field: string): string {
  const normalized = requiredString(value, field).toLowerCase()
  if (!uuidPattern.test(normalized)) {
    throw new Error(`Legal document delivery contract is invalid: ${field} must be a UUID`)
  }
  return normalized
}

function safeInteger(value: unknown, field: string, minimum = 0): number {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(number) || number < minimum) {
    throw new Error(`Legal document delivery contract is invalid: ${field} must be an integer`)
  }
  return number
}

function optionalSafeInteger(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === '') return null
  return safeInteger(value, field)
}

function isoDate(value: unknown, field: string): string {
  const parsed = new Date(requiredString(value, field))
  if (Number.isNaN(parsed.valueOf())) {
    throw new Error(`Legal document delivery contract is invalid: ${field} must be a date-time`)
  }
  return parsed.toISOString()
}

function documentReference(row: Record<string, unknown>, kind: 'ofi' | 'rodo') {
  const sha256 = optionalString(row[`${kind}_sha256`])?.toLowerCase() ?? null
  return {
    path: optionalString(row[`${kind}_storage_path`]),
    sha256: sha256 && sha256Pattern.test(sha256) ? sha256 : null,
    sizeBytes: optionalSafeInteger(row[`${kind}_size_bytes`], `${kind}_size_bytes`),
  }
}

function mapClientLegalDocumentDeliveryJob(input: unknown): ClientLegalDocumentDeliveryJob {
  const row = asRecord(input)
  return {
    id: requiredUuid(row.id, 'id'),
    organizationId: requiredUuid(row.organization_id, 'organization_id'),
    clientId: requiredUuid(row.client_id, 'client_id'),
    recipientEmail: optionalString(row.recipient_email),
    intermediarySettingsRevision: safeInteger(
      row.intermediary_settings_revision,
      'intermediary_settings_revision',
      1,
    ),
    generatorVersion: safeInteger(row.generator_version, 'generator_version', 1),
    emailTemplateVersion: safeInteger(
      row.email_template_version,
      'email_template_version',
      1,
    ),
    idempotencyKey: requiredString(row.idempotency_key, 'idempotency_key'),
    provider: optionalString(row.provider),
    providerMessageId: optionalString(row.provider_message_id),
    attempts: safeInteger(row.attempts, 'attempts', 1),
    maxAttempts: safeInteger(row.max_attempts, 'max_attempts', 1),
    createdAt: isoDate(row.created_at, 'created_at'),
    ofi: documentReference(row, 'ofi'),
    rodo: documentReference(row, 'rodo'),
  }
}

function legalDocumentDbError(
  error: { code?: string, message?: string } | null | undefined,
  operation: string,
): void {
  if (!error) return
  const code = String(error.code ?? 'unknown')
  throw new Error(`Legal document delivery ${operation} failed (database code ${code})`)
}

function legalDocumentEmailSender(event: H3Event) {
  const email = useRuntimeConfig(event).authEmail as LegalDocumentEmailRuntimeConfig
  return createTransactionalEmailSender({
    apiKey: email.apiKey,
    from: email.from,
    replyTo: email.replyTo,
    smtp: email.smtp?.host
      ? {
          host: email.smtp.host,
          port: email.smtp.port,
          secure: email.smtp.secure,
          user: email.smtp.user || undefined,
          password: email.smtp.password || undefined,
        }
      : undefined,
  })
}

function safeErrorSummary(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(emailInTextPattern, '[redacted-email]')
    .replace(/[\u0000-\u001F\u007F-\u009F]/gu, ' ')
    .slice(0, 1_000)
}

export function clientLegalDocumentRetryDelaySeconds(
  attempts: number,
  maxAttempts: number,
): number {
  if (attempts >= maxAttempts) return 6 * 60 * 60
  const exponent = Math.min(Math.max(0, attempts - 1), 10)
  const uncappedSeconds = 30 * (2 ** exponent)
  const jitterPermille = randomInt(800, 1_201)
  return Math.max(
    1,
    Math.min(6 * 60 * 60, Math.round(uncappedSeconds * jitterPermille / 1_000)),
  )
}

function documentPath(job: ClientLegalDocumentDeliveryJob, kind: 'ofi' | 'rodo'): string {
  return `${job.organizationId}/${job.clientId}/${job.id}/${kind}.pdf`
}

async function bytesFromStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value?.byteLength) continue
      size += value.byteLength
      if (size > maxLegalDocumentBytes) {
        throw new Error('Stored legal document exceeds the configured size limit')
      }
      chunks.push(value)
    }
  }
  finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function reusableStoredDocument(
  event: H3Event,
  expectedPath: string,
  reference: StoredDocumentReference,
): Promise<LegalDocumentAsset | null> {
  if (
    reference.path !== expectedPath
    || !reference.sha256
    || !reference.sizeBytes
  ) {
    return null
  }

  const downloaded = await serverStorageClient(event).download({
    namespace: legalDocumentNamespace,
    path: expectedPath,
  })
  if (!downloaded) return null

  const bytes = await bytesFromStream(downloaded.stream)
  if (bytes.byteLength !== reference.sizeBytes) return null
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (sha256 !== reference.sha256) return null
  return { bytes, path: expectedPath, sha256, sizeBytes: bytes.byteLength }
}

async function persistDocument(
  event: H3Event,
  job: ClientLegalDocumentDeliveryJob,
  kind: 'ofi' | 'rodo',
  bytes: Uint8Array,
  sha256: string,
): Promise<LegalDocumentAsset> {
  const path = documentPath(job, kind)
  await serverStorageClient(event).upload({
    namespace: legalDocumentNamespace,
    path,
    body: bytes,
    size: bytes.byteLength,
    contentType: 'application/pdf',
    // A retry may encounter the exact deterministic object left by a worker
    // that crashed before recording its metadata. A first attempt must never
    // overwrite an object at an unexpected colliding key.
    overwrite: job.attempts > 1,
  })
  return { bytes, path, sha256, sizeBytes: bytes.byteLength }
}

async function loadPinnedSettingsAndDesign(
  backend: any,
  job: ClientLegalDocumentDeliveryJob,
) {
  const [revisionResult, designResult] = await Promise.all([
    backend
      .from('organization_intermediary_setting_revisions')
      .select('settings')
      .eq('organization_id', job.organizationId)
      .eq('revision', job.intermediarySettingsRevision)
      .maybeSingle(),
    backend
      .from('organization_design_settings')
      .select('settings')
      .eq('organization_id', job.organizationId)
      .maybeSingle(),
  ])
  legalDocumentDbError(revisionResult.error, 'settings revision lookup')
  legalDocumentDbError(designResult.error, 'design lookup')
  return {
    settings: revisionResult.data?.settings ?? null,
    design: designResult.data?.settings,
  }
}

async function generateOrReuseDocuments(
  event: H3Event,
  job: ClientLegalDocumentDeliveryJob,
  settings: unknown,
  design: unknown,
  organizationName: string,
): Promise<LegalDocumentAssets> {
  const expectedOfiPath = documentPath(job, 'ofi')
  const expectedRodoPath = documentPath(job, 'rodo')
  const [storedOfi, storedRodo] = await Promise.all([
    reusableStoredDocument(event, expectedOfiPath, job.ofi),
    reusableStoredDocument(event, expectedRodoPath, job.rodo),
  ])

  const [ofi, rodo] = await Promise.all([
    storedOfi
      ? Promise.resolve(storedOfi)
      : createIntermediaryDocument({
          kind: 'ofi',
          settings,
          design,
          organizationName,
          revision: job.intermediarySettingsRevision,
          generatedAt: job.createdAt,
        }).then(document => persistDocument(
          event,
          job,
          'ofi',
          document.bytes,
          document.sha256,
        )),
    storedRodo
      ? Promise.resolve(storedRodo)
      : createIntermediaryDocument({
          kind: 'rodo',
          settings,
          design,
          organizationName,
          revision: job.intermediarySettingsRevision,
          generatedAt: job.createdAt,
        }).then(document => persistDocument(
          event,
          job,
          'rodo',
          document.bytes,
          document.sha256,
        )),
  ])
  return { ofi, rodo }
}

async function completeClientLegalDocumentDelivery(
  backend: any,
  input: {
    job: ClientLegalDocumentDeliveryJob
    workerId: string
    outcome: LegalDocumentOutcome
    error: string | null
    retryDelaySeconds?: number
    provider?: string | null
    providerMessageId?: string | null
    documents?: LegalDocumentAssets | null
  },
): Promise<void> {
  const result = await backend.rpc('complete_client_legal_document_delivery', {
    p_delivery_id: input.job.id,
    p_worker_id: input.workerId,
    p_outcome: input.outcome,
    p_error: input.error,
    p_retry_delay_seconds: input.retryDelaySeconds ?? 0,
    p_provider: input.provider ?? null,
    p_provider_message_id: input.providerMessageId ?? null,
    p_ofi_sha256: input.documents?.ofi.sha256 ?? null,
    p_ofi_size_bytes: input.documents?.ofi.sizeBytes ?? null,
    p_ofi_storage_path: input.documents?.ofi.path ?? null,
    p_rodo_sha256: input.documents?.rodo.sha256 ?? null,
    p_rodo_size_bytes: input.documents?.rodo.sizeBytes ?? null,
    p_rodo_storage_path: input.documents?.rodo.path ?? null,
  })
  legalDocumentDbError(result.error, 'completion')
}

async function blockClientLegalDocumentDelivery(
  backend: any,
  job: ClientLegalDocumentDeliveryJob,
  workerId: string,
  outcome: Extract<LegalDocumentOutcome, `blocked_${string}`>,
  error: string,
): Promise<LegalDocumentProcessResult> {
  await completeClientLegalDocumentDelivery(backend, {
    job,
    workerId,
    outcome,
    error,
  })
  return { completed: 1, delivered: 0, failed: 0, blocked: 1 }
}

async function processClientLegalDocumentDelivery(
  event: H3Event,
  backend: any,
  workerId: string,
  job: ClientLegalDocumentDeliveryJob,
): Promise<LegalDocumentProcessResult> {
  let documents: LegalDocumentAssets | null = null
  let provider: string | null = null
  let providerMessageId: string | null = null
  try {
    if (!job.recipientEmail) {
      return await blockClientLegalDocumentDelivery(
        backend,
        job,
        workerId,
        'blocked_missing_email',
        'recipient_email_unavailable',
      )
    }

    let recipientEmail: string
    try {
      recipientEmail = normalizeTransactionalEmailAddress(job.recipientEmail)
    }
    catch {
      return await blockClientLegalDocumentDelivery(
        backend,
        job,
        workerId,
        'blocked_missing_email',
        'recipient_email_invalid',
      )
    }

    if (
      job.generatorVersion !== INTERMEDIARY_DOCUMENT_GENERATOR_VERSION
      || job.emailTemplateVersion !== CLIENT_LEGAL_DOCUMENTS_EMAIL_TEMPLATE_VERSION
    ) {
      throw new Error('Unsupported legal document generator or email template version')
    }

    const pinned = await loadPinnedSettingsAndDesign(backend, job)
    if (!pinned.settings) {
      return await blockClientLegalDocumentDelivery(
        backend,
        job,
        workerId,
        'blocked_incomplete_settings',
        'intermediary_settings_revision_unavailable',
      )
    }

    const settings = normalizeIntermediarySettings(pinned.settings)
    const readiness = intermediarySettingsReadiness(settings)
    if (!readiness.ofi.ready || !readiness.rodo.ready) {
      return await blockClientLegalDocumentDelivery(
        backend,
        job,
        workerId,
        'blocked_incomplete_settings',
        'intermediary_settings_incomplete',
      )
    }

    // `settings` comes from the pinned immutable revision, so the lender names
    // embedded in OFI cannot drift when an organization later changes banks.
    const organizationName = settings.intermediary.legalName
    try {
      documents = await generateOrReuseDocuments(
        event,
        job,
        settings,
        pinned.design,
        organizationName,
      )
    }
    catch (error) {
      if (
        error instanceof OfiSinglePageOverflowError
        || error instanceof RodoSinglePageOverflowError
      ) {
        return await blockClientLegalDocumentDelivery(
          backend,
          job,
          workerId,
          'blocked_incomplete_settings',
          error instanceof RodoSinglePageOverflowError
            ? 'rodo_single_page_overflow'
            : 'ofi_single_page_overflow',
        )
      }
      throw error
    }

    // A previous attempt may have received a definitive provider id and then
    // failed while recording `sent`. In that case the email was accepted; the
    // durable record can be finalized without submitting the message again.
    if (job.provider && job.providerMessageId) {
      await completeClientLegalDocumentDelivery(backend, {
        job,
        workerId,
        outcome: 'sent',
        error: null,
        provider: job.provider,
        providerMessageId: job.providerMessageId,
        documents,
      })
      return { completed: 1, delivered: 1, failed: 0, blocked: 0 }
    }

    const sender = legalDocumentEmailSender(event)
    provider = sender.provider
    const template = clientLegalDocumentsEmailTemplate({ organizationName })
    const delivery = await sender.send({
      to: recipientEmail,
      subject: template.subject,
      html: template.html,
      text: template.text,
      idempotencyKey: job.idempotencyKey,
      tags: [
        { name: 'email_type', value: 'client_legal_documents' },
        { name: 'organization_id', value: job.organizationId },
        { name: 'delivery_id', value: job.id },
      ],
      attachments: [
        {
          filename: 'OFI.pdf',
          content: documents.ofi.bytes,
          contentType: 'application/pdf',
        },
        {
          filename: 'RODO.pdf',
          content: documents.rodo.bytes,
          contentType: 'application/pdf',
        },
      ],
    })
    if (delivery.status !== 'sent') {
      throw new EmailDeliveryError(`Email transport is not configured: ${delivery.reason}`)
    }
    providerMessageId = delivery.id

    await completeClientLegalDocumentDelivery(backend, {
      job,
      workerId,
      outcome: 'sent',
      error: null,
      provider,
      providerMessageId,
      documents,
    })
    return { completed: 1, delivered: 1, failed: 0, blocked: 0 }
  }
  catch (error) {
    const errorSummary = safeErrorSummary(error)
    try {
      await completeClientLegalDocumentDelivery(backend, {
        job,
        workerId,
        outcome: 'failed',
        error: errorSummary,
        retryDelaySeconds: clientLegalDocumentRetryDelaySeconds(
          job.attempts,
          job.maxAttempts,
        ),
        provider: error instanceof EmailDeliveryError
          ? error.provider ?? provider
          : provider,
        providerMessageId,
        documents,
      })
    }
    catch (completionError) {
      console.error('[crm-legal-documents] could not release failed delivery', {
        deliveryId: job.id,
        message: safeErrorSummary(completionError),
      })
    }
    return { completed: 0, delivered: 0, failed: 1, blocked: 0 }
  }
}

export async function drainClientLegalDocumentDeliveries(
  event: H3Event,
  workerId: string,
  limit: number,
) {
  const boundedLimit = Math.min(10, Math.max(1, Math.trunc(limit)))
  const backend = serverDataBackend(event) as any
  const claimResult = await backend.rpc('claim_client_legal_document_deliveries', {
    p_worker_id: workerId,
    p_limit: boundedLimit,
  })
  legalDocumentDbError(claimResult.error, 'claim')
  if (!Array.isArray(claimResult.data)) {
    throw new Error('Legal document delivery contract is invalid: claim must return an array')
  }
  const jobs: ClientLegalDocumentDeliveryJob[] = (claimResult.data as unknown[])
    .map(mapClientLegalDocumentDeliveryJob)

  const results: LegalDocumentProcessResult[] = []
  for (let offset = 0; offset < jobs.length; offset += legalDocumentDeliveryConcurrency) {
    results.push(...await Promise.all(
      jobs.slice(offset, offset + legalDocumentDeliveryConcurrency)
        .map(job => processClientLegalDocumentDelivery(event, backend, workerId, job)),
    ))
  }

  return results.reduce<{
    claimed: number
    completed: number
    delivered: number
    failed: number
    blocked: number
  }>((totals, result) => ({
    claimed: totals.claimed,
    completed: totals.completed + result.completed,
    delivered: totals.delivered + result.delivered,
    failed: totals.failed + result.failed,
    blocked: totals.blocked + result.blocked,
  }), {
    claimed: jobs.length,
    completed: 0,
    delivered: 0,
    failed: 0,
    blocked: 0,
  })
}

/**
 * Best-effort low-latency nudge for callers that have just created a client.
 * Scheduled outbox draining remains the durable fallback.
 */
export async function nudgeClientLegalDocumentDeliveries(event: H3Event): Promise<void> {
  try {
    const result = await drainClientLegalDocumentDeliveries(
      event,
      `crm-client-legal-documents-nudge:${randomUUID()}`,
      legalDocumentNudgeLimit,
    )
    if (result.failed) {
      console.warn('[crm-legal-documents] delivery nudge left failed jobs', {
        claimed: result.claimed,
        failed: result.failed,
      })
    }
  }
  catch (error) {
    console.warn('[crm-legal-documents] delivery nudge failed', {
      message: safeErrorSummary(error),
    })
  }
}
