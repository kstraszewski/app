import { createError, type H3Event } from 'h3'
import {
  BANK_MAIL_PDF_CLAIM_SOURCE,
  BANK_MAIL_PDF_FAILURE_SOURCE,
  BANK_MAIL_PDF_IMPORT_SOURCE,
  BANK_MAIL_PDF_PROOF_SOURCE,
  BANK_MAIL_PDF_PUBLISH_SOURCE,
  BANK_MAIL_PDF_WORKER_PRESET,
  BANK_MAIL_PDF_WORKER_SERVICE_ID,
  BankMailPdfProcessingError,
  BankMailPdfTerminalResolutionError,
  bankMailPdfAccessTokenFromCache,
  parseBankMailPdfAttachmentJobs,
  parseBankMailPdfFailureResult,
  parseBankMailPdfPreparedImport,
  parseBankMailPdfProofResult,
  parseBankMailPdfPublishedImport,
  processBankMailPdfAttachmentJob,
  recordBankMailPdfDrainOutcome,
  type BankMailPdfAttachmentJob,
  type BankMailPdfAttachmentDrainResult,
  type BankMailPdfFailureCode,
  type BankMailPdfFailureResult,
  type BankMailPdfProcessorDependencies,
} from './bank-mail-pdf-attachment-core.ts'
import { serverDataBackend } from './data-api.ts'
import {
  activeMailAccessToken,
  type MailConnectionRow,
} from './mail-connections.ts'
import {
  fetchGmailBankThreadMessageResources,
  fetchGmailNamedAttachment,
} from './mail-providers.ts'
import { extractBoundedPdfText } from './bounded-pdf-text.ts'
import {
  extractOpenExpertMockBankEncryptedArchive,
  MAX_OPENEXPERT_MOCK_BANK_PDF_BYTES,
} from './openexpert-mock-bank-documents.ts'
import {
  loadOpenExpertMockBankObject,
  OPENEXPERT_MOCK_BANK_MANIFEST_MEDIA_TYPE,
} from './openexpert-mock-bank-payload.ts'
import { persistExactBankMailPdf } from './bank-mail-pdf-storage-core.ts'
import { serverScopedBackendDataClient } from './platform-data.ts'
import { serverStorageClient } from './platform-storage.ts'

const WORKER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/u
const CLAIM_LOCK_TIMEOUT_SECONDS = 5 * 60

type ScopedSource =
  | typeof BANK_MAIL_PDF_PROOF_SOURCE
  | typeof BANK_MAIL_PDF_IMPORT_SOURCE
  | typeof BANK_MAIL_PDF_PUBLISH_SOURCE
  | typeof BANK_MAIL_PDF_FAILURE_SOURCE

function workerId(value: string): string {
  if (!WORKER_ID_PATTERN.test(value)) {
    throw createError({ statusCode: 500, statusMessage: 'Invalid bank-mail PDF worker identity' })
  }
  return value
}

function rpcData(result: {
  data: unknown
  error: { message?: string, code?: string } | null
}): unknown {
  if (result.error) {
    throw createError({
      statusCode: result.error.code === '42501' ? 403 : 503,
      statusMessage: 'Bank-mail PDF database operation failed',
    })
  }
  return result.data
}

function scopedClient(
  event: H3Event,
  source: ScopedSource,
  worker: string,
  job: BankMailPdfAttachmentJob,
  extraClaims: Readonly<Record<string, unknown>> = {},
) {
  return serverScopedBackendDataClient(event, {
    source,
    serviceId: BANK_MAIL_PDF_WORKER_SERVICE_ID,
    preset: BANK_MAIL_PDF_WORKER_PRESET,
    organizationId: job.organizationId,
    connectionId: job.connectionId,
    mailboxOwnerUserId: job.mailboxOwnerUserId,
    attachmentJobId: job.attachmentJobId,
    workerId: worker,
    ...extraClaims,
  }) as any
}

async function claimBankMailPdfAttachmentJobs(
  event: H3Event,
  rawWorkerId: string,
  limit: number,
): Promise<BankMailPdfAttachmentJob[]> {
  const normalizedWorkerId = workerId(rawWorkerId)
  // One PDF may consume most of the five-minute database lease. Claim only
  // one job so a later item never starts with an already-stale lease.
  void limit
  const boundedLimit = 1
  const client = serverScopedBackendDataClient(event, {
    source: BANK_MAIL_PDF_CLAIM_SOURCE,
    serviceId: BANK_MAIL_PDF_WORKER_SERVICE_ID,
    preset: BANK_MAIL_PDF_WORKER_PRESET,
    workerId: normalizedWorkerId,
  }) as any
  const result = await client.rpc('claim_bank_mail_agent_pdf_attachment_jobs', {
    p_worker_id: normalizedWorkerId,
    p_limit: boundedLimit,
    p_lock_timeout_seconds: CLAIM_LOCK_TIMEOUT_SECONDS,
  })
  return parseBankMailPdfAttachmentJobs(rpcData(result))
}

async function loadWorkerMailConnection(
  event: H3Event,
  job: BankMailPdfAttachmentJob,
): Promise<{ backend: any, connection: MailConnectionRow }> {
  const backend = serverDataBackend(event) as any
  const result = await backend
    .from('mail_connections')
    .select('*')
    .eq('organization_id', job.organizationId)
    .eq('owner_user_id', job.mailboxOwnerUserId)
    .eq('id', job.connectionId)
    .eq('provider', 'google')
    .maybeSingle()
  if (result.error || !result.data) {
    throw new BankMailPdfProcessingError('mail_connection_unavailable', true)
  }
  const connection = result.data as MailConnectionRow
  if (
    connection.organization_id !== job.organizationId
    || connection.owner_user_id !== job.mailboxOwnerUserId
    || connection.id !== job.connectionId
    || connection.provider !== 'google'
    || connection.status !== 'active'
  ) {
    throw new BankMailPdfProcessingError('mail_connection_unavailable', true)
  }
  return { backend, connection }
}

function gmailFailure(error: unknown): BankMailPdfProcessingError {
  if (error instanceof BankMailPdfProcessingError) return error
  const statusCode = Number((error as { statusCode?: number })?.statusCode)
  return new BankMailPdfProcessingError(
    [400, 401, 403, 404, 409].includes(statusCode)
      ? 'mail_connection_unavailable'
      : 'gmail_unavailable',
    true,
  )
}

function gmailAttachmentFailure(error: unknown): BankMailPdfProcessingError {
  if (error instanceof BankMailPdfProcessingError) return error
  const statusCode = Number((error as { statusCode?: number })?.statusCode)
  if (statusCode === 404) return new BankMailPdfProcessingError('attachment_missing', false)
  if (statusCode === 409) return new BankMailPdfProcessingError('attachment_ambiguous', false)
  if (statusCode === 412 || statusCode === 422) {
    return new BankMailPdfProcessingError('attachment_locator_invalid', false)
  }
  return gmailFailure(error)
}

function processorDependencies(
  event: H3Event,
  rawWorkerId: string,
  pinnedJob: BankMailPdfAttachmentJob,
  accessTokenCache: Map<string, Promise<string>>,
): BankMailPdfProcessorDependencies {
  const normalizedWorkerId = workerId(rawWorkerId)

  const accessToken = (job: BankMailPdfAttachmentJob) => {
    if (job.attachmentJobId !== pinnedJob.attachmentJobId
      || job.organizationId !== pinnedJob.organizationId
      || job.connectionId !== pinnedJob.connectionId
      || job.mailboxOwnerUserId !== pinnedJob.mailboxOwnerUserId) {
      throw new BankMailPdfProcessingError('processing_failed', true)
    }
    return bankMailPdfAccessTokenFromCache(job, accessTokenCache, () => (
      loadWorkerMailConnection(event, job)
        .then(({ backend, connection }) => activeMailAccessToken(event, backend, connection))
        .catch((error) => { throw gmailFailure(error) })
    ))
  }

  return {
    async loadManifest(job) {
      let connection: MailConnectionRow
      try {
        connection = (await loadWorkerMailConnection(event, job)).connection
      }
      catch (error) {
        throw gmailFailure(error)
      }
      try {
        const stored = await loadOpenExpertMockBankObject({
          storage: serverStorageClient(event),
          path: job.manifestStoragePath,
          contentType: OPENEXPERT_MOCK_BANK_MANIFEST_MEDIA_TYPE,
          expectedSha256: job.manifestSha256,
          expectedSizeBytes: job.manifestSizeBytes,
        })
        if (!stored) {
          throw new BankMailPdfProcessingError('storage_unavailable', true)
        }
        return { bytes: stored.bytes, recipientEmail: connection.account_email }
      }
      catch (error) {
        if (error instanceof BankMailPdfProcessingError) throw error
        if (error instanceof TypeError) {
          throw new BankMailPdfProcessingError('source_content_changed', false)
        }
        throw new BankMailPdfProcessingError('storage_unavailable', true)
      }
    },
    async loadMessages(job) {
      try {
        return await fetchGmailBankThreadMessageResources(
          await accessToken(job),
          job.threadReference,
        )
      }
      catch (error) {
        throw gmailFailure(error)
      }
    },
    async downloadArchive(job, source) {
      try {
        const downloaded = await fetchGmailNamedAttachment(
          await accessToken(job),
          source.messageId,
          {
            filename: source.attachment.filename,
            mimeType: source.attachment.mimeType,
            size: source.attachment.size,
            attachmentId: source.attachment.attachmentId,
            inlineData: source.attachment.inlineData,
          },
        )
        return downloaded.bytes
      }
      catch (error) {
        throw gmailAttachmentFailure(error)
      }
    },
    async proveSource({ job, source, archiveSha256, archiveSizeBytes }) {
      const proofClaims = {
        intakeSourceSha256: job.intakeSourceSha256,
        attachmentOrdinal: source.attachmentOrdinal,
        attachmentTokenSha256: source.attachmentTokenSha256,
        archiveSha256,
        archiveSizeBytes,
        generationContextSha256: job.generationContextSha256,
        manifestSha256: job.manifestSha256,
        manifestSizeBytes: job.manifestSizeBytes,
        payloadSha256: job.payloadSha256,
      }
      const client = scopedClient(
        event,
        BANK_MAIL_PDF_PROOF_SOURCE,
        normalizedWorkerId,
        job,
        proofClaims,
      )
      const result = await client.rpc('prove_bank_mail_agent_pdf_attachment_source', {
        p_attachment_job_id: job.attachmentJobId,
        p_lease_token: job.leaseToken,
        p_intake_source_sha256: proofClaims.intakeSourceSha256,
        p_attachment_ordinal: proofClaims.attachmentOrdinal,
        p_attachment_token_sha256: proofClaims.attachmentTokenSha256,
        p_archive_sha256: proofClaims.archiveSha256,
        p_archive_size_bytes: proofClaims.archiveSizeBytes,
      })
      return parseBankMailPdfProofResult(rpcData(result))
    },
    extractArchive({ job, archiveBytes, credential }) {
      return extractOpenExpertMockBankEncryptedArchive({
        bytes: archiveBytes,
        kind: 'esis',
        applicationNumber: job.applicationNumber,
        pesel: credential,
      })
    },
    async inspectPdf(pdfBytes) {
      try {
        return await extractBoundedPdfText({
          bytes: pdfBytes,
          maxBytes: MAX_OPENEXPERT_MOCK_BANK_PDF_BYTES,
        })
      }
      catch {
        throw new BankMailPdfProcessingError('archive_invalid', false)
      }
    },
    async beginImport({ job, pdfSha256, pdfSizeBytes }) {
      const client = scopedClient(
        event,
        BANK_MAIL_PDF_IMPORT_SOURCE,
        normalizedWorkerId,
        job,
        {
          pdfSha256,
          pdfSizeBytes,
          validUntil: job.validUntil,
        },
      )
      const result = await client.rpc('begin_bank_mail_agent_pdf_attachment_import', {
        p_attachment_job_id: job.attachmentJobId,
        p_lease_token: job.leaseToken,
        p_pdf_sha256: pdfSha256,
        p_pdf_size_bytes: pdfSizeBytes,
        p_valid_until: job.validUntil,
      })
      return parseBankMailPdfPreparedImport(rpcData(result))
    },
    async persistPdf({ prepared, pdfBytes, pdfSha256 }) {
      await persistExactBankMailPdf({
        storage: serverStorageClient(event),
        path: prepared.storagePath,
        bytes: pdfBytes,
        sha256: pdfSha256,
      })
    },
    async publish(job) {
      const client = scopedClient(event, BANK_MAIL_PDF_PUBLISH_SOURCE, normalizedWorkerId, job)
      let lastError: unknown = null
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const result = await client.rpc('publish_bank_mail_agent_pdf_attachment', {
            p_attachment_job_id: job.attachmentJobId,
            p_lease_token: job.leaseToken,
          })
          return parseBankMailPdfPublishedImport(rpcData(result))
        }
        catch (error) {
          lastError = error
        }
      }
      void lastError
      throw new BankMailPdfProcessingError('publish_unavailable', true)
    },
  }
}

function failure(error: unknown): { code: BankMailPdfFailureCode, retryable: boolean } {
  if (error instanceof BankMailPdfProcessingError) {
    return { code: error.code, retryable: error.retryable }
  }
  return { code: 'processing_failed', retryable: true }
}

async function failBankMailPdfAttachmentJob(
  event: H3Event,
  rawWorkerId: string,
  job: BankMailPdfAttachmentJob,
  input: { code: BankMailPdfFailureCode, retryable: boolean },
): Promise<BankMailPdfFailureResult> {
  const normalizedWorkerId = workerId(rawWorkerId)
  const retryAfterSeconds = input.retryable
    ? Math.min(3_600, 60 * (2 ** Math.min(5, Math.max(0, job.attemptNo - 1))))
    : 0
  const failureClaims = {
    failureCode: input.code,
    retryable: input.retryable,
    retryAfterSeconds,
  }
  const client = scopedClient(
    event,
    BANK_MAIL_PDF_FAILURE_SOURCE,
    normalizedWorkerId,
    job,
    failureClaims,
  )
  const result = await client.rpc('fail_bank_mail_agent_pdf_attachment', {
    p_attachment_job_id: job.attachmentJobId,
    p_lease_token: job.leaseToken,
    p_failure_code: failureClaims.failureCode,
    p_retryable: failureClaims.retryable,
    p_retry_after_seconds: failureClaims.retryAfterSeconds,
  })
  const parsed = parseBankMailPdfFailureResult(rpcData(result))
  if (parsed.attachmentJobId !== job.attachmentJobId) {
    throw new BankMailPdfProcessingError('processing_failed', true)
  }
  return parsed
}

export async function drainBankMailPdfAttachmentJobs(
  event: H3Event,
  rawWorkerId: string,
  limit = 1,
): Promise<BankMailPdfAttachmentDrainResult> {
  const normalizedWorkerId = workerId(rawWorkerId)
  const jobs = await claimBankMailPdfAttachmentJobs(event, normalizedWorkerId, limit)
  const accessTokenCache = new Map<string, Promise<string>>()
  const totals: BankMailPdfAttachmentDrainResult = {
    claimed: jobs.length,
    completed: 0,
    retrying: 0,
    reviewRequired: 0,
    failed: 0,
    conflicts: 0,
  }

  for (const job of jobs) {
    try {
      await processBankMailPdfAttachmentJob(
        job,
        processorDependencies(event, normalizedWorkerId, job, accessTokenCache),
      )
      totals.completed += 1
    }
    catch (error) {
      if (error instanceof BankMailPdfTerminalResolutionError) {
        recordBankMailPdfDrainOutcome(totals, error.result.state)
        continue
      }
      const result = await failBankMailPdfAttachmentJob(
        event,
        normalizedWorkerId,
        job,
        failure(error),
      )
      recordBankMailPdfDrainOutcome(totals, result.state)
    }
  }
  return totals
}
