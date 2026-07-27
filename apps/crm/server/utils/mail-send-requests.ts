import { createError } from 'h3'
import type { CrmSession } from './crm.ts'
import { throwDbError } from './crm.ts'
import {
  gmailSendMessageId,
  gmailSendRequestHash,
  type GmailSendRequestHashInput,
} from './gmail-send.ts'
import type { MailConnectionRow } from './mail-connections.ts'

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

export const mailSendMessageId = (idempotencyKey: string): string => (
  gmailSendMessageId(idempotencyKey)
)

export async function claimMailSendRequest(
  serviceRole: any,
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
    message_id_header: mailSendMessageId(idempotencyKey),
    status: 'pending',
    attempts: 1,
  }
  const inserted = await serviceRole
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
    serviceRole,
    session,
    connection.id,
    idempotencyKey,
  )
  if (existing.request_hash !== requestHash) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Ten identyfikator wysyłki został użyty dla innej wiadomości.',
    })
  }
  if (existing.status !== 'failed') {
    return { row: existing, claimed: false }
  }

  const retried = await serviceRole
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
      serviceRole,
      session,
      connection.id,
      idempotencyKey,
    ),
    claimed: false,
  }
}

export async function enforceMailSendRateLimit(
  serviceRole: any,
  session: CrmSession,
): Promise<void> {
  const now = Date.now()
  const [minute, hour] = await Promise.all([
    serviceRole
      .from('mail_send_requests')
      .select('attempts')
      .eq('organization_id', session.organizationId)
      .eq('owner_user_id', session.userId)
      .gte('updated_at', new Date(now - 60_000).toISOString()),
    serviceRole
      .from('mail_send_requests')
      .select('attempts')
      .eq('organization_id', session.organizationId)
      .eq('owner_user_id', session.userId)
      .gte('updated_at', new Date(now - 60 * 60_000).toISOString()),
  ])
  throwDbError(minute.error)
  throwDbError(hour.error)
  const minuteAttempts = (minute.data ?? []).reduce(
    (total: number, row: { attempts?: number }) => total + Math.max(1, Number(row.attempts) || 0),
    0,
  )
  const hourAttempts = (hour.data ?? []).reduce(
    (total: number, row: { attempts?: number }) => total + Math.max(1, Number(row.attempts) || 0),
    0,
  )
  if (minuteAttempts > 10 || hourAttempts > 100) {
    throw createError({
      statusCode: 429,
      statusMessage: 'Limit wysyłania z CRM został osiągnięty. Spróbuj ponownie później.',
    })
  }
}

export async function markMailSendRequestSent(
  serviceRole: any,
  row: MailSendRequestRow,
  providerMessageId: string,
  providerThreadId: string,
): Promise<void> {
  await updateMailSendRequest(serviceRole, row, {
    status: 'sent',
    provider_message_id: providerMessageId,
    provider_thread_id: providerThreadId,
    error_code: null,
  })
}

export async function markMailSendRequestOutcome(
  serviceRole: any,
  row: MailSendRequestRow,
  status: 'unknown' | 'failed',
  errorCode: string,
): Promise<void> {
  await updateMailSendRequest(serviceRole, row, {
    status,
    error_code: errorCode.slice(0, 100),
  })
}

async function loadMailSendRequest(
  serviceRole: any,
  session: CrmSession,
  connectionId: string,
  idempotencyKey: string,
): Promise<MailSendRequestRow> {
  const result = await serviceRole
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

async function updateMailSendRequest(
  serviceRole: any,
  row: MailSendRequestRow,
  values: Record<string, unknown>,
): Promise<void> {
  const result = await serviceRole
    .from('mail_send_requests')
    .update(values)
    .eq('organization_id', row.organization_id)
    .eq('owner_user_id', row.owner_user_id)
    .eq('connection_id', row.connection_id)
    .eq('id', row.id)
  throwDbError(result.error)
}
