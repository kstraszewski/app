import { createError, setHeader, type H3Event } from 'h3'
import type { CrmSession } from './crm.ts'
import { throwDbError } from './crm.ts'
import { gmailSendRequestHash, type GmailSendRequestHashInput } from './gmail-send.ts'
import type { MailConnectionRow } from './mail-connections.ts'
import {
  connectionBoundMailMessageId,
  mailSendCanRecoverWithoutNewAttempt,
} from './mail-send-idempotency.ts'
import { consumeMailSendRateLimit } from './mail-send-rate-limit.ts'

export interface MailSendRequestRow {
  id: string
  organization_id: string
  owner_user_id: string
  connection_id: string
  idempotency_key: string
  request_hash: string
  message_id_header: string
  status: 'pending' | 'sent' | 'unknown' | 'failed'
  provider_message_id: string | null
  provider_thread_id: string | null
  attempts: number
  error_code: string | null
  created_at: string
  updated_at: string
}

export const mailSendRequestHash = (input: GmailSendRequestHashInput): string => (
  gmailSendRequestHash(input)
)

export function mailSendMessageId(connectionId: string, idempotencyKey: string): string {
  return connectionBoundMailMessageId(connectionId, idempotencyKey)
}

/**
 * Existing non-failed requests bypass the limiter so a replay can reconcile a
 * durable provider outcome. Every new row and every retry after a definitive
 * failure first consumes the shared atomic rate-limit buckets.
 */
export async function claimRateLimitedMailSendRequest(
  event: H3Event,
  backendData: any,
  session: CrmSession,
  connection: MailConnectionRow,
  idempotencyKey: string,
  requestHash: string,
): Promise<{ row: MailSendRequestRow; claimed: boolean }> {
  const existing = await findMailSendRequest(
    backendData,
    session,
    connection.id,
    idempotencyKey,
  )
  if (existing) {
    assertMailSendRequestHash(existing, requestHash)
    if (mailSendCanRecoverWithoutNewAttempt(existing.status)) {
      return { row: existing, claimed: false }
    }
  }

  const rateLimit = await consumeMailSendRateLimit(event, session.userId)
  if (!rateLimit.allowed) {
    // A same-key request may have won the race while this request was waiting
    // for the atomic limiter. Let that idempotent replay recover instead of
    // turning it into an unrelated 429.
    const raced = await findMailSendRequest(
      backendData,
      session,
      connection.id,
      idempotencyKey,
    )
    if (raced) {
      assertMailSendRequestHash(raced, requestHash)
      if (mailSendCanRecoverWithoutNewAttempt(raced.status)) {
        return { row: raced, claimed: false }
      }
    }
    setHeader(event, 'Retry-After', rateLimit.retryAfterSeconds)
    throw createError({
      statusCode: 429,
      statusMessage: 'Limit wysyłania z CRM został osiągnięty. Spróbuj ponownie później.',
    })
  }

  return claimMailSendRequest(
    backendData,
    session,
    connection,
    idempotencyKey,
    requestHash,
  )
}

async function claimMailSendRequest(
  backendData: any,
  session: CrmSession,
  connection: MailConnectionRow,
  idempotencyKey: string,
  requestHash: string,
): Promise<{ row: MailSendRequestRow; claimed: boolean }> {
  const values = {
    organization_id: session.organizationId,
    owner_user_id: session.userId,
    connection_id: connection.id,
    idempotency_key: idempotencyKey,
    request_hash: requestHash,
    message_id_header: mailSendMessageId(connection.id, idempotencyKey),
    status: 'pending',
    attempts: 1,
  }
  const inserted = await backendData
    .from('mail_send_requests')
    .insert(values)
    .select('*')
    .single()
  if (!inserted.error && inserted.data) {
    return { row: inserted.data as MailSendRequestRow, claimed: true }
  }
  if (String(inserted.error?.code ?? '') !== '23505') {
    throwDbError(inserted.error)
  }

  const existing = await loadMailSendRequest(
    backendData,
    session,
    connection.id,
    idempotencyKey,
  )
  assertMailSendRequestHash(existing, requestHash)
  if (existing.status !== 'failed') {
    return { row: existing, claimed: false }
  }

  const retried = await backendData
    .from('mail_send_requests')
    .update({
      status: 'pending',
      attempts: existing.attempts + 1,
      error_code: null,
    })
    .eq('organization_id', session.organizationId)
    .eq('owner_user_id', session.userId)
    .eq('connection_id', connection.id)
    .eq('idempotency_key', idempotencyKey)
    .eq('status', 'failed')
    .select('*')
    .maybeSingle()
  throwDbError(retried.error)
  if (retried.data) {
    return { row: retried.data as MailSendRequestRow, claimed: true }
  }
  return {
    row: await loadMailSendRequest(
      backendData,
      session,
      connection.id,
      idempotencyKey,
    ),
    claimed: false,
  }
}

export async function markMailSendRequestSent(
  backendData: any,
  row: MailSendRequestRow,
  providerMessageId: string,
  providerThreadId: string,
): Promise<void> {
  await updateMailSendRequest(backendData, row, {
    status: 'sent',
    provider_message_id: providerMessageId,
    provider_thread_id: providerThreadId,
    error_code: null,
  })
}

export async function markMailSendRequestProviderAccepted(
  backendData: any,
  row: MailSendRequestRow,
  providerMessageId: string,
  providerThreadId: string,
): Promise<void> {
  await updateMailSendRequest(backendData, row, {
    provider_message_id: providerMessageId,
    provider_thread_id: providerThreadId,
    error_code: null,
  })
}

export async function markMailSendRequestOutcome(
  backendData: any,
  row: MailSendRequestRow,
  status: 'unknown' | 'failed',
  errorCode: string,
): Promise<void> {
  await updateMailSendRequest(backendData, row, {
    status,
    error_code: errorCode.slice(0, 100),
  })
}

async function loadMailSendRequest(
  backendData: any,
  session: CrmSession,
  connectionId: string,
  idempotencyKey: string,
): Promise<MailSendRequestRow> {
  const result = await backendData
    .from('mail_send_requests')
    .select('*')
    .eq('organization_id', session.organizationId)
    .eq('owner_user_id', session.userId)
    .eq('connection_id', connectionId)
    .eq('idempotency_key', idempotencyKey)
    .single()
  throwDbError(result.error)
  return result.data as MailSendRequestRow
}

async function findMailSendRequest(
  backendData: any,
  session: CrmSession,
  connectionId: string,
  idempotencyKey: string,
): Promise<MailSendRequestRow | null> {
  const result = await backendData
    .from('mail_send_requests')
    .select('*')
    .eq('organization_id', session.organizationId)
    .eq('owner_user_id', session.userId)
    .eq('connection_id', connectionId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()
  throwDbError(result.error)
  return result.data ? result.data as MailSendRequestRow : null
}

function assertMailSendRequestHash(
  row: MailSendRequestRow,
  requestHash: string,
): void {
  if (row.request_hash === requestHash) return
  throw createError({
    statusCode: 409,
    statusMessage: 'Ten identyfikator wysyłki został użyty dla innej wiadomości.',
  })
}

async function updateMailSendRequest(
  backendData: any,
  row: MailSendRequestRow,
  values: Record<string, unknown>,
): Promise<void> {
  const result = await backendData
    .from('mail_send_requests')
    .update(values)
    .eq('organization_id', row.organization_id)
    .eq('owner_user_id', row.owner_user_id)
    .eq('connection_id', row.connection_id)
    .eq('id', row.id)
  throwDbError(result.error)
}
