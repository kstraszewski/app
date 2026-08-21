import { createHash } from 'node:crypto'
import type {
  MailBankAgentState,
  MailBankAgentStatus,
  MailProviderId,
} from '../../shared/types/mail.ts'

export const MAX_BANK_MAIL_AGENT_STATUS_MESSAGES = 50
export const MAX_BANK_MAIL_PROVIDER_MESSAGE_ID_CHARACTERS = 4_096

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const sha256Pattern = /^[0-9a-f]{64}$/u
const supportedStates = new Set<MailBankAgentState>([
  'processing',
  'review_required',
  'completed',
  'failed',
])

export interface BankMailAgentStatusRequest {
  connectionId: string
  messageIds: string[]
}

export interface BankMailAgentStatusIdentity {
  messageId: string
  sha256: string
}

export interface ImapStableMessageIdentity {
  mailbox: string
  uidValidity: string
  uid: number
}

export function parseBankMailAgentStatusRequest(value: unknown): BankMailAgentStatusRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Nieprawidłowe zapytanie o stan analizy wiadomości.')
  }
  const input = value as Record<string, unknown>
  const allowedFields = new Set(['connectionId', 'messageIds'])
  if (Object.keys(input).some(key => !allowedFields.has(key))) {
    throw new TypeError('Zapytanie o stan analizy zawiera nieobsługiwane pole.')
  }

  const connectionId = String(input.connectionId ?? '').trim()
  if (!uuidPattern.test(connectionId)) {
    throw new TypeError('Nieprawidłowe połączenie pocztowe.')
  }
  if (!Array.isArray(input.messageIds)) {
    throw new TypeError('Brakuje identyfikatorów wiadomości.')
  }

  const messageIds = [...new Set(input.messageIds.map((value) => {
    if (typeof value !== 'string') {
      throw new TypeError('Nieprawidłowy identyfikator wiadomości.')
    }
    const messageId = value.trim()
    if (
      !messageId
      || messageId.length > MAX_BANK_MAIL_PROVIDER_MESSAGE_ID_CHARACTERS
      || /[\u0000-\u001F\u007F]/u.test(messageId)
    ) {
      throw new TypeError('Nieprawidłowy identyfikator wiadomości.')
    }
    return messageId
  }))]
  if (!messageIds.length || messageIds.length > MAX_BANK_MAIL_AGENT_STATUS_MESSAGES) {
    throw new TypeError('Nieprawidłowa liczba wiadomości do sprawdzenia.')
  }
  return { connectionId, messageIds }
}

/**
 * Produces the exact PII-free identity stored by the bank-mail intake ledger.
 * Google and Microsoft expose immutable message IDs. IMAP needs the canonical
 * mailbox/UIDVALIDITY/UID tuple because its encrypted route reference is
 * intentionally randomized on every listing.
 */
export function bankMailProviderMessageIdentitySha256(
  provider: MailProviderId,
  providerMessageId: string,
  imapIdentity?: ImapStableMessageIdentity,
): string {
  const messageId = providerMessageId.trim()
  if (
    !messageId
    || messageId.length > MAX_BANK_MAIL_PROVIDER_MESSAGE_ID_CHARACTERS
    || /[\u0000-\u001F\u007F]/u.test(messageId)
  ) {
    throw new TypeError('Nieprawidłowy identyfikator wiadomości.')
  }

  let stableIdentity = messageId
  if (provider === 'imap') {
    const mailbox = String(imapIdentity?.mailbox ?? '')
    const uidValidity = String(imapIdentity?.uidValidity ?? '')
    const uid = Number(imapIdentity?.uid)
    if (
      !mailbox
      || mailbox.length > 1_024
      || /[\u0000-\u001F\u007F]/u.test(mailbox)
      || !/^\d{1,40}$/u.test(uidValidity)
      || !Number.isSafeInteger(uid)
      || uid < 1
    ) {
      throw new TypeError('Nieprawidłowa tożsamość wiadomości IMAP.')
    }
    stableIdentity = `${mailbox}\u001f${uidValidity}\u001f${uid}`
  }

  return createHash('sha256').update(stableIdentity, 'utf8').digest('hex')
}

export function mapBankMailAgentStatuses(
  identities: readonly BankMailAgentStatusIdentity[],
  value: unknown,
): MailBankAgentStatus[] {
  if (!Array.isArray(value)) throw new TypeError('Nieprawidłowa odpowiedź stanu analizy.')
  const messageIdsByHash = new Map<string, string[]>()
  for (const identity of identities) {
    const messageIds = messageIdsByHash.get(identity.sha256) ?? []
    if (!messageIds.includes(identity.messageId)) messageIds.push(identity.messageId)
    messageIdsByHash.set(identity.sha256, messageIds)
  }
  const statuses: MailBankAgentStatus[] = []
  const seen = new Set<string>()

  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    const sha256 = String(row.providerMessageIdSha256 ?? '')
    const state = String(row.state ?? '') as MailBankAgentState
    const messageIds = sha256Pattern.test(sha256) ? messageIdsByHash.get(sha256) : undefined
    if (!messageIds || !supportedStates.has(state)) continue
    for (const messageId of messageIds) {
      if (seen.has(messageId)) continue
      seen.add(messageId)
      statuses.push({ messageId, state })
    }
  }
  return statuses
}
