import type { MailBankAgentReanalysisState } from '../../shared/types/mail.ts'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const gmailReferencePattern = /^[A-Za-z0-9_-]{1,4096}$/u
const ledgerStates = new Set<BankMailReanalysisLedgerState>([
  'queued',
  'leased',
  'session_bound',
  'completed',
  'failed',
])

export interface BankMailReanalysisRequest {
  connectionId: string
  threadId: string
  messageId: string
}

export type BankMailReanalysisLedgerState =
  | 'queued'
  | 'leased'
  | 'session_bound'
  | 'completed'
  | 'failed'

export interface BankMailReanalysisOperation {
  requestId: string
  intakeId: string
  state: BankMailReanalysisLedgerState
  attemptNo: number
  accepted: boolean
  shouldDispatch: boolean
  retryAfterSeconds: number
  replayed: boolean
}

export function parseBankMailReanalysisRequest(value: unknown): BankMailReanalysisRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Nieprawidłowe zapytanie o ponowną analizę wiadomości.')
  }
  const input = value as Record<string, unknown>
  const allowedFields = new Set(['connectionId', 'threadId', 'messageId'])
  if (Object.keys(input).some(key => !allowedFields.has(key))) {
    throw new TypeError('Zapytanie o ponowną analizę zawiera nieobsługiwane pole.')
  }

  const connectionId = stringValue(input.connectionId).toLowerCase()
  const threadId = stringValue(input.threadId)
  const messageId = stringValue(input.messageId)
  if (!uuidPattern.test(connectionId)) {
    throw new TypeError('Nieprawidłowe połączenie pocztowe.')
  }
  if (!gmailReferencePattern.test(threadId)) {
    throw new TypeError('Nieprawidłowy identyfikator wątku Gmail.')
  }
  if (!gmailReferencePattern.test(messageId)) {
    throw new TypeError('Nieprawidłowy identyfikator wiadomości Gmail.')
  }
  return { connectionId, threadId, messageId }
}

export function parseBankMailReanalysisOperation(
  value: unknown,
): BankMailReanalysisOperation {
  const candidate = Array.isArray(value) ? value[0] : value
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new TypeError('Nieprawidłowa odpowiedź ponownej analizy wiadomości.')
  }
  const row = candidate as Record<string, unknown>
  const requestId = stringValue(row.requestId).toLowerCase()
  const intakeId = stringValue(row.intakeId).toLowerCase()
  const state = stringValue(row.state) as BankMailReanalysisLedgerState
  const attemptNo = Number(row.attemptNo)
  const retryAfterSeconds = Number(row.retryAfterSeconds)
  const accepted = row.accepted === true
  const shouldDispatch = row.shouldDispatch === true
  const replayed = row.replayed === true
  if (
    !uuidPattern.test(requestId)
    || !uuidPattern.test(intakeId)
    || !ledgerStates.has(state)
    || !Number.isSafeInteger(attemptNo)
    || attemptNo < 1
    || attemptNo > 1_000
    || !Number.isSafeInteger(retryAfterSeconds)
    || retryAfterSeconds < 0
    || retryAfterSeconds > 86_400
    || typeof row.accepted !== 'boolean'
    || typeof row.shouldDispatch !== 'boolean'
    || typeof row.replayed !== 'boolean'
    || (accepted && (replayed || state !== 'queued' || !shouldDispatch))
    || (shouldDispatch && state !== 'queued' && state !== 'leased')
  ) {
    throw new TypeError('Nieprawidłowa odpowiedź ponownej analizy wiadomości.')
  }
  return {
    requestId,
    intakeId,
    state,
    attemptNo,
    accepted,
    shouldDispatch,
    retryAfterSeconds,
    replayed,
  }
}

export function publicBankMailReanalysisState(
  state: BankMailReanalysisLedgerState,
): MailBankAgentReanalysisState {
  if (state === 'completed' || state === 'failed') return state
  return 'processing'
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
