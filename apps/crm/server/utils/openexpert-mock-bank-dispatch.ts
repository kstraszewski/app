import { createError, type H3Event } from 'h3'
import { serverDataBackend } from './data-api.ts'
import {
  assertOpenExpertMockBankApplicationNumber,
  assertOpenExpertMockBankRequestId,
  type OpenExpertMockBankDocumentKind,
} from './openexpert-mock-bank-documents.ts'
import { asRecord, throwDbError, type CrmSession } from './crm.ts'

export interface OpenExpertMockBankDispatchReservation {
  dispatchId: string
  applicationId: string
  applicationNumber: string
  kind: OpenExpertMockBankDocumentKind
  state: 'claimed' | 'in_progress' | 'sent'
  shouldSend: boolean
  generation: number
  generationStartedAt: string
  attempts: number
  createdAt: string
  leaseExpiresAt: string | null
  recipientConnectionId: string | null
  payloadId: string
  manifestStorageBucket: 'crm-mock-bank-outbox'
  manifestStoragePath: string
  manifestSha256: string | null
  manifestSizeBytes: number | null
  archiveStorageBucket: 'crm-mock-bank-outbox'
  archiveStoragePath: string
  archiveSha256: string | null
  archiveSizeBytes: number | null
  payloadSha256: string | null
  payloadReadyAt: string | null
  providerMessageId: string | null
  errorCode: string | null
  sentAt: string | null
  failedAt: string | null
}

export interface OpenExpertMockBankPayloadCleanupJob {
  jobId: string
  claimToken: string
  storageBucket: 'crm-mock-bank-outbox'
  storagePath: string
  objectSha256: string | null
  attempts: number
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/u

function requiredText(value: unknown, field: string): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) {
    throw createError({ statusCode: 500, statusMessage: `Mock bank dispatch is invalid (${field})` })
  }
  return text
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function optionalUuid(value: unknown, field: string): string | null {
  const result = optionalText(value)
  if (!result) return null
  try {
    return assertOpenExpertMockBankRequestId(result)
  }
  catch {
    throw createError({ statusCode: 500, statusMessage: `Mock bank dispatch is invalid (${field})` })
  }
}

function positiveInteger(value: unknown, field: string): number {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 1) {
    throw createError({ statusCode: 500, statusMessage: `Mock bank dispatch is invalid (${field})` })
  }
  return number
}

function optionalPositiveInteger(value: unknown, field: string): number | null {
  return value === null || value === undefined ? null : positiveInteger(value, field)
}

function timestamp(value: unknown, field: string): string {
  const result = requiredText(value, field)
  if (!Number.isFinite(Date.parse(result))) {
    throw createError({ statusCode: 500, statusMessage: `Mock bank dispatch is invalid (${field})` })
  }
  return result
}

function optionalTimestamp(value: unknown, field: string): string | null {
  const result = optionalText(value)
  if (result && !Number.isFinite(Date.parse(result))) {
    throw createError({ statusCode: 500, statusMessage: `Mock bank dispatch is invalid (${field})` })
  }
  return result
}

function optionalSha256(value: unknown, field: string): string | null {
  const result = optionalText(value)
  if (result && !SHA256_PATTERN.test(result)) {
    throw createError({ statusCode: 500, statusMessage: `Mock bank dispatch is invalid (${field})` })
  }
  return result
}

function parseReservation(value: unknown): OpenExpertMockBankDispatchReservation {
  const row = asRecord(value)
  const kind = row.kind
  const state = row.state
  if (kind !== 'esis' && kind !== 'credit_decision') {
    throw createError({ statusCode: 500, statusMessage: 'Mock bank dispatch returned an invalid kind' })
  }
  if (state !== 'claimed' && state !== 'in_progress' && state !== 'sent') {
    throw createError({ statusCode: 500, statusMessage: 'Mock bank dispatch returned an invalid state' })
  }
  const shouldSend = row.shouldSend === true
  if (shouldSend !== (state === 'claimed')) {
    throw createError({ statusCode: 500, statusMessage: 'Mock bank dispatch returned an invalid claim' })
  }
  const createdAt = timestamp(row.createdAt, 'createdAt')
  const generationStartedAt = timestamp(row.generationStartedAt, 'generationStartedAt')
  const manifestStorageBucket = requiredText(row.manifestStorageBucket, 'manifestStorageBucket')
  const archiveStorageBucket = requiredText(row.archiveStorageBucket, 'archiveStorageBucket')
  if (manifestStorageBucket !== 'crm-mock-bank-outbox'
    || archiveStorageBucket !== 'crm-mock-bank-outbox') {
    throw createError({ statusCode: 500, statusMessage: 'Mock bank dispatch returned an invalid storage bucket' })
  }
  const manifestSha256 = optionalSha256(row.manifestSha256, 'manifestSha256')
  const manifestSizeBytes = optionalPositiveInteger(row.manifestSizeBytes, 'manifestSizeBytes')
  const archiveSha256 = optionalSha256(row.archiveSha256, 'archiveSha256')
  const archiveSizeBytes = optionalPositiveInteger(row.archiveSizeBytes, 'archiveSizeBytes')
  const payloadSha256 = optionalSha256(row.payloadSha256, 'payloadSha256')
  const payloadReadyAt = optionalTimestamp(row.payloadReadyAt, 'payloadReadyAt')
  const payloadParts = [
    manifestSha256,
    manifestSizeBytes,
    archiveSha256,
    archiveSizeBytes,
    payloadSha256,
    payloadReadyAt,
  ]
  if (payloadParts.some(value => value === null) && payloadParts.some(value => value !== null)) {
    throw createError({ statusCode: 500, statusMessage: 'Mock bank dispatch returned a partial payload commit' })
  }
  const reservation: OpenExpertMockBankDispatchReservation = {
    dispatchId: assertOpenExpertMockBankRequestId(requiredText(row.dispatchId, 'dispatchId')),
    applicationId: assertOpenExpertMockBankRequestId(requiredText(row.applicationId, 'applicationId')),
    applicationNumber: assertOpenExpertMockBankApplicationNumber(row.applicationNumber),
    kind,
    state,
    shouldSend,
    generation: positiveInteger(row.generation, 'generation'),
    generationStartedAt,
    attempts: positiveInteger(row.attempts, 'attempts'),
    createdAt,
    leaseExpiresAt: optionalTimestamp(row.leaseExpiresAt, 'leaseExpiresAt'),
    recipientConnectionId: optionalUuid(row.recipientConnectionId, 'recipientConnectionId'),
    payloadId: assertOpenExpertMockBankRequestId(requiredText(row.payloadId, 'payloadId')),
    manifestStorageBucket,
    manifestStoragePath: requiredText(row.manifestStoragePath, 'manifestStoragePath'),
    manifestSha256,
    manifestSizeBytes,
    archiveStorageBucket,
    archiveStoragePath: requiredText(row.archiveStoragePath, 'archiveStoragePath'),
    archiveSha256,
    archiveSizeBytes,
    payloadSha256,
    payloadReadyAt,
    providerMessageId: optionalText(row.providerMessageId),
    errorCode: optionalText(row.errorCode),
    sentAt: optionalTimestamp(row.sentAt, 'sentAt'),
    failedAt: optionalTimestamp(row.failedAt, 'failedAt'),
  }
  if (reservation.state === 'claimed' && !reservation.recipientConnectionId) {
    throw createError({ statusCode: 500, statusMessage: 'Mock bank dispatch has no recipient binding' })
  }
  return reservation
}

export async function reserveOpenExpertMockBankDispatch(input: {
  event: H3Event
  session: CrmSession
  caseId: string
  applicationId: string
  kind: OpenExpertMockBankDocumentKind
  requestId: string
  recipientConnectionId: string
  forceResend?: boolean
}): Promise<OpenExpertMockBankDispatchReservation> {
  const backendData = serverDataBackend(input.event) as any
  const result = await backendData.rpc('reserve_crm_mock_bank_dispatch', {
    p_organization_id: input.session.organizationId,
    p_case_id: input.caseId,
    p_application_id: input.applicationId,
    p_kind: input.kind,
    p_request_id: assertOpenExpertMockBankRequestId(input.requestId),
    p_requested_by_user_id: input.session.userId,
    p_recipient_connection_id: input.recipientConnectionId,
    p_force_resend: input.forceResend === true,
  })
  throwDbError(result.error)
  return parseReservation(result.data)
}

export async function commitOpenExpertMockBankDispatchPayload(input: {
  event: H3Event
  dispatchId: string
  requestId: string
  generation: number
  manifestSha256: string
  manifestSizeBytes: number
  archiveSha256: string
  archiveSizeBytes: number
  payloadSha256: string
}): Promise<OpenExpertMockBankDispatchReservation> {
  const backendData = serverDataBackend(input.event) as any
  const result = await backendData.rpc('commit_crm_mock_bank_dispatch_payload', {
    p_dispatch_id: assertOpenExpertMockBankRequestId(input.dispatchId),
    p_request_id: assertOpenExpertMockBankRequestId(input.requestId),
    p_generation: positiveInteger(input.generation, 'generation'),
    p_manifest_sha256: input.manifestSha256,
    p_manifest_size_bytes: positiveInteger(input.manifestSizeBytes, 'manifestSizeBytes'),
    p_archive_sha256: input.archiveSha256,
    p_archive_size_bytes: positiveInteger(input.archiveSizeBytes, 'archiveSizeBytes'),
    p_payload_sha256: input.payloadSha256,
  })
  throwDbError(result.error)
  return parseReservation(result.data)
}

export async function renewOpenExpertMockBankDispatchSendLease(input: {
  event: H3Event
  dispatchId: string
  requestId: string
  generation: number
}): Promise<OpenExpertMockBankDispatchReservation> {
  const backendData = serverDataBackend(input.event) as any
  const result = await backendData.rpc('renew_crm_mock_bank_dispatch_send_lease', {
    p_dispatch_id: assertOpenExpertMockBankRequestId(input.dispatchId),
    p_request_id: assertOpenExpertMockBankRequestId(input.requestId),
    p_generation: positiveInteger(input.generation, 'generation'),
  })
  throwDbError(result.error)
  return parseReservation(result.data)
}

export async function finalizeOpenExpertMockBankDispatch(input: {
  event: H3Event
  dispatchId: string
  requestId: string
  status: 'sent' | 'failed'
  providerMessageId?: string
  errorCode?: string
}): Promise<OpenExpertMockBankDispatchReservation> {
  const backendData = serverDataBackend(input.event) as any
  const result = await backendData.rpc('finalize_crm_mock_bank_dispatch', {
    p_dispatch_id: assertOpenExpertMockBankRequestId(input.dispatchId),
    p_request_id: assertOpenExpertMockBankRequestId(input.requestId),
    p_status: input.status,
    p_provider_message_id: input.providerMessageId ?? null,
    p_error_code: input.errorCode ?? null,
  })
  throwDbError(result.error)
  return parseReservation(result.data)
}

function parseCleanupJob(value: unknown): OpenExpertMockBankPayloadCleanupJob {
  const row = asRecord(value)
  const storageBucket = requiredText(row.storageBucket, 'storageBucket')
  if (storageBucket !== 'crm-mock-bank-outbox') {
    throw createError({ statusCode: 500, statusMessage: 'Mock bank cleanup returned an invalid bucket' })
  }
  return {
    jobId: assertOpenExpertMockBankRequestId(requiredText(row.jobId, 'jobId')),
    claimToken: assertOpenExpertMockBankRequestId(requiredText(row.claimToken, 'claimToken')),
    storageBucket,
    storagePath: requiredText(row.storagePath, 'storagePath'),
    objectSha256: optionalSha256(row.objectSha256, 'objectSha256'),
    attempts: positiveInteger(row.attempts, 'attempts'),
  }
}

export async function claimOpenExpertMockBankPayloadCleanupJobs(input: {
  event: H3Event
  limit?: number
}): Promise<OpenExpertMockBankPayloadCleanupJob[]> {
  const backendData = serverDataBackend(input.event) as any
  const result = await backendData.rpc('claim_crm_mock_bank_payload_cleanup_jobs', {
    p_limit: input.limit ?? 4,
  })
  throwDbError(result.error)
  if (!Array.isArray(result.data)) {
    throw createError({ statusCode: 500, statusMessage: 'Mock bank cleanup returned invalid jobs' })
  }
  return result.data.map(parseCleanupJob)
}

export async function finalizeOpenExpertMockBankPayloadCleanupJob(input: {
  event: H3Event
  jobId: string
  claimToken: string
  succeeded: boolean
  errorCode?: string
}): Promise<void> {
  const backendData = serverDataBackend(input.event) as any
  const result = await backendData.rpc('finalize_crm_mock_bank_payload_cleanup_job', {
    p_job_id: assertOpenExpertMockBankRequestId(input.jobId),
    p_claim_token: assertOpenExpertMockBankRequestId(input.claimToken),
    p_succeeded: input.succeeded,
    p_error_code: input.errorCode ?? null,
  })
  throwDbError(result.error)
}

export function assertOpenExpertMockBankDispatchClaim(
  reservation: OpenExpertMockBankDispatchReservation,
  expected: { applicationId: string, applicationNumber: string, kind: OpenExpertMockBankDocumentKind },
) {
  if (reservation.applicationId !== expected.applicationId
    || reservation.applicationNumber !== expected.applicationNumber
    || reservation.kind !== expected.kind) {
    throw createError({ statusCode: 500, statusMessage: 'Mock bank dispatch scope is invalid' })
  }
  if (reservation.state === 'in_progress') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Wysyłka tego dokumentu już trwa. Odczekaj chwilę i odśwież sprawę.',
    })
  }
}
