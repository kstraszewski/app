import {
  CRM_AGENT_MAIL_ACCESS,
  CRM_AGENT_MAIL_ATTACHMENT_REFERENCE_MAX_LENGTH,
} from '../../shared/types/agent-mail.ts'
import type { CrmAgentCaller } from './caller.ts'
import { signAgentActingUserDataApiToken } from './data-api.ts'

const responseByteLimit = 1_000_000

function firstEnvironmentValue(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return undefined
}

export function normalizeCrmAgentMailServiceUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value.trim())
  }
  catch {
    throw new Error('Adres usługi pocztowej CRM jest nieprawidłowy.')
  }
  const localHttp = url.protocol === 'http:'
    && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !localHttp) {
    throw new Error('Usługa pocztowa CRM wymaga HTTPS.')
  }
  if (
    url.username
    || url.password
    || url.search
    || url.hash
    || (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new Error('Adres usługi pocztowej CRM musi wskazywać jej główny origin.')
  }
  return url.origin
}

function crmAgentMailServiceUrl(): string {
  const configured = firstEnvironmentValue([
    'CRM_AGENT_MAIL_SERVICE_URL',
    'NUXT_PUBLIC_CRM_BASE_URL',
    'BETTER_AUTH_URL',
    'NUXT_AUTH_BASE_URL',
  ])
  if (configured) return normalizeCrmAgentMailServiceUrl(configured)
  if (process.env.NODE_ENV !== 'production') return 'http://127.0.0.1:3004'
  throw new Error('Usługa pocztowa CRM nie jest skonfigurowana dla Agenta AI.')
}

function combinedAbortSignal(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(75_000)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

function serviceToken(caller: CrmAgentCaller): string {
  return signAgentActingUserDataApiToken(caller.userId, {
    [CRM_AGENT_MAIL_ACCESS.purposeClaim]: CRM_AGENT_MAIL_ACCESS.purpose,
    [CRM_AGENT_MAIL_ACCESS.organizationIdClaim]: caller.organizationId,
    [CRM_AGENT_MAIL_ACCESS.organizationSlugClaim]: caller.organizationSlug,
  })
}

function errorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const record = payload as Record<string, unknown>
  for (const key of ['statusMessage', 'message']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 500)
  }
  return null
}

async function readBoundedResponseText(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > responseByteLimit) {
    await response.body?.cancel().catch(() => {})
    throw new Error('Usługa pocztowa zwróciła zbyt dużą odpowiedź.')
  }
  if (!response.body) return ''

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (!value?.byteLength) continue
      total += value.byteLength
      if (total > responseByteLimit) {
        await reader.cancel().catch(() => {})
        throw new Error('Usługa pocztowa zwróciła zbyt dużą odpowiedź.')
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
  return new TextDecoder().decode(bytes)
}

type CrmAgentMailApiPath =
  | '/api/internal/crm-agent-mail/search'
  | '/api/internal/crm-agent-mail/threads'
  | '/api/internal/crm-agent-mail/attachment'

function responseRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function boundedResponseString(value: unknown, maximum: number): value is string {
  return typeof value === 'string'
    && value.length <= maximum
    && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value)
}

function boundedNullableResponseString(value: unknown, maximum: number): boolean {
  return value === null || boundedResponseString(value, maximum)
}

function nonNegativeResponseInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum
}

function invalidMailApiResponse(): never {
  throw new Error('Usługa pocztowa zwróciła niezgodną odpowiedź.')
}

function validateAddress(value: unknown): void {
  const address = responseRecord(value)
  if (
    !address
    || !boundedResponseString(address.name, 500)
    || !boundedNullableResponseString(address.email, 320)
    || !boundedResponseString(address.label, 500)
  ) invalidMailApiResponse()
}

function validateAttachmentSummary(value: unknown): void {
    const attachment = responseRecord(value)
    if (
      !attachment
      || !boundedResponseString(attachment.reference, CRM_AGENT_MAIL_ATTACHMENT_REFERENCE_MAX_LENGTH)
      || !/^[A-Za-z0-9_-]+$/u.test(attachment.reference)
      || !boundedResponseString(attachment.fileName, 500)
      || !boundedResponseString(attachment.mimeType, 255)
      || !nonNegativeResponseInteger(attachment.sizeBytes)
  ) invalidMailApiResponse()
}

function validateSearchThread(value: unknown): void {
  const thread = responseRecord(value)
  if (!thread) invalidMailApiResponse()
  const folders = Array.isArray(thread.folders) ? thread.folders : null
  const matchedEmails = Array.isArray(thread.matchedEmails) ? thread.matchedEmails : null
  const participants = Array.isArray(thread.participants) ? thread.participants : null
  if (
    !boundedResponseString(thread.reference, CRM_AGENT_MAIL_ATTACHMENT_REFERENCE_MAX_LENGTH)
    || !/^[A-Za-z0-9_-]+$/u.test(String(thread.reference))
    || !boundedResponseString(thread.mailbox, 320)
    || !['google', 'microsoft', 'imap'].includes(String(thread.provider))
    || !folders
    || folders.length > 2
    || folders.some(folder => !['inbox', 'sent'].includes(String(folder)))
    || ![
      'manual_link',
      'sent_from_context',
      'bank_mail_agent',
      'participant_email',
      'mailbox_search',
    ].includes(String(thread.matchReason))
    || !matchedEmails
    || matchedEmails.length > 12
    || matchedEmails.some(email => !boundedResponseString(email, 320))
    || !participants
    || participants.length > 20
    || !boundedResponseString(thread.subject, 500)
    || !boundedNullableResponseString(thread.latestAt, 64)
    || !nonNegativeResponseInteger(thread.listedMessageCount, 100_000)
    || !boundedResponseString(thread.snippet, 600)
    || typeof thread.hasAttachments !== 'boolean'
    || !boundedResponseString(thread.url, 2_000)
    || !/^\/org\/[a-z0-9-]+\/mail$/u.test(String(thread.url))
  ) invalidMailApiResponse()
  for (const participant of participants) validateAddress(participant)
}

function validateSearchResponse(data: Record<string, unknown>): void {
  const threads = Array.isArray(data.threads) ? data.threads : null
  const context = data.context === null ? null : responseRecord(data.context)
  const coverage = responseRecord(data.coverage)
  if (
    !['all', 'inbox', 'sent'].includes(String(data.folder))
    || !['any', 'with_attachments'].includes(String(data.attachmentFilter))
    || !boundedNullableResponseString(data.query, 500)
    || !boundedNullableResponseString(data.participantEmail, 320)
    || !('context' in data)
    || (context !== null && (
      !['client', 'case'].includes(String(context.type))
      || !boundedResponseString(context.id, 36)
      || !boundedResponseString(context.label, 500)
      || !nonNegativeResponseInteger(context.emailCount, 100_000)
      || typeof context.emailsTruncated !== 'boolean'
    ))
    || !nonNegativeResponseInteger(data.searchedAccountCount, 5)
    || !nonNegativeResponseInteger(data.partialFailureCount, 1_000)
    || !coverage
    || typeof coverage.complete !== 'boolean'
    || !boundedNullableResponseString(coverage.nextCursor, CRM_AGENT_MAIL_ATTACHMENT_REFERENCE_MAX_LENGTH)
    || (coverage.nextCursor !== null && !/^v2\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(String(coverage.nextCursor)))
    || !nonNegativeResponseInteger(coverage.omittedLinkedThreadCount, 100)
    || !nonNegativeResponseInteger(coverage.omittedResultCount, 1_000)
    || ![
      'complete',
      'more_available',
      'partial_failure',
      'context_email_limit',
      'linked_window_limit',
      'result_window_limit',
      'continuation_unavailable',
    ].includes(String(coverage.reason))
    || !threads
    || threads.length > 12
  ) invalidMailApiResponse()
  for (const thread of threads) validateSearchThread(thread)
}

function validateThreadMessage(value: unknown): void {
  const message = responseRecord(value)
  if (!message) invalidMailApiResponse()
  const from = message.from === null ? null : responseRecord(message.from)
  const to = Array.isArray(message.to) ? message.to : null
  const cc = Array.isArray(message.cc) ? message.cc : null
  const attachments = Array.isArray(message.attachments) ? message.attachments : null
  if (
    !nonNegativeResponseInteger(message.ordinal, 100_000)
    || Number(message.ordinal) < 1
    || !['received', 'sent', 'other'].includes(String(message.direction))
    || !('from' in message)
    || (message.from !== null && !from)
    || !to
    || to.length > 10
    || !cc
    || cc.length > 10
    || !boundedResponseString(message.subject, 500)
    || !boundedNullableResponseString(message.sentAt, 64)
    || !boundedResponseString(message.bodyExcerpt, 2_400)
    || !nonNegativeResponseInteger(message.bodyExcerptStart, 500_000)
    || typeof message.bodyTruncated !== 'boolean'
    || !['pass', 'fail', 'unknown'].includes(String(message.authentication))
    || typeof message.replyToMismatch !== 'boolean'
    || !attachments
    || attachments.length > 8
    || !nonNegativeResponseInteger(message.omittedAttachmentCount, 10_000)
  ) invalidMailApiResponse()
  if (from) validateAddress(from)
  for (const address of [...to, ...cc]) validateAddress(address)
  for (const attachment of attachments) validateAttachmentSummary(attachment)
}

function validateThreadResponse(data: Record<string, unknown>): void {
  const threads = Array.isArray(data.threads) ? data.threads : null
  if (
    !nonNegativeResponseInteger(data.requestedThreadCount, 4)
    || Number(data.requestedThreadCount) < 1
    || !nonNegativeResponseInteger(data.readThreadCount, 4)
    || !nonNegativeResponseInteger(data.failureCount, 4)
    || Number(data.readThreadCount) + Number(data.failureCount) !== Number(data.requestedThreadCount)
    || !threads
    || threads.length !== Number(data.readThreadCount)
  ) invalidMailApiResponse()
  let totalMessages = 0
  for (const value of threads) {
    const thread = responseRecord(value)
    const messages = Array.isArray(thread?.messages) ? thread.messages : null
    if (
      !thread
      || !nonNegativeResponseInteger(thread.rank, 4)
      || Number(thread.rank) < 1
      || !boundedResponseString(thread.mailbox, 320)
      || !['google', 'microsoft', 'imap'].includes(String(thread.provider))
      || !boundedResponseString(thread.subject, 500)
      || !nonNegativeResponseInteger(thread.providerMessageCount, 100_000)
      || !nonNegativeResponseInteger(thread.matchedMessageCountInWindow, 48)
      || !nonNegativeResponseInteger(thread.filteredMessageCount, 48)
      || !nonNegativeResponseInteger(thread.returnedMessageCount, 48)
      || !nonNegativeResponseInteger(thread.omittedMessageCount, 100_000)
      || !messages
      || messages.length !== Number(thread.returnedMessageCount)
      || !boundedResponseString(thread.url, 2_000)
      || !/^\/org\/[a-z0-9-]+\/mail$/u.test(String(thread.url))
    ) invalidMailApiResponse()
    totalMessages += messages.length
    for (const message of messages) validateThreadMessage(message)
  }
  if (totalMessages > 48) invalidMailApiResponse()
}

function validateAttachmentResponse(data: Record<string, unknown>): void {
  const source = responseRecord(data.source)
  const extraction = responseRecord(data.extraction)
  const excerpts = Array.isArray(extraction?.excerpts) ? extraction.excerpts : null
  if (
    !boundedResponseString(data.fileName, 500)
    || !boundedResponseString(data.mimeType, 255)
    || !nonNegativeResponseInteger(data.sizeBytes)
    || !source
    || !boundedResponseString(source.mailbox, 320)
    || !boundedNullableResponseString(source.sender, 500)
    || !boundedResponseString(source.subject, 500)
    || !boundedNullableResponseString(source.sentAt, 64)
    || !extraction
    || !['extracted', 'no_text', 'unsupported'].includes(String(extraction.status))
    || !boundedResponseString(extraction.kind, 64)
    || !(extraction.pageCount === null || nonNegativeResponseInteger(extraction.pageCount, 100_000))
    || typeof extraction.truncated !== 'boolean'
    || !boundedNullableResponseString(extraction.reason, 500)
    || !excerpts
    || excerpts.length > 5
  ) invalidMailApiResponse()

  for (const value of excerpts) {
    const excerpt = responseRecord(value)
    if (
      !excerpt
      || !boundedNullableResponseString(excerpt.locator, 100)
      || !boundedResponseString(excerpt.text, 1_600)
    ) invalidMailApiResponse()
  }
}

export function validateCrmAgentMailApiResponse(
  path: CrmAgentMailApiPath,
  payload: unknown,
): unknown {
  const response = responseRecord(payload)
  const data = responseRecord(response?.data)
  if (!data) invalidMailApiResponse()
  if (path === '/api/internal/crm-agent-mail/search') validateSearchResponse(data)
  else if (path === '/api/internal/crm-agent-mail/threads') validateThreadResponse(data)
  else validateAttachmentResponse(data)
  return payload
}

export async function callCrmAgentMailApi<T>(
  caller: CrmAgentCaller,
  path: CrmAgentMailApiPath,
  body: Record<string, unknown>,
  abortSignal?: AbortSignal,
): Promise<T> {
  const target = new URL(path, `${crmAgentMailServiceUrl()}/`)
  let response: Response
  try {
    response = await fetch(target, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${serviceToken(caller)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: combinedAbortSignal(abortSignal),
    })
  }
  catch (error) {
    if (abortSignal?.aborted) throw new Error('Odczyt poczty został anulowany.')
    throw new Error('Poczta OpenExpert jest chwilowo niedostępna.')
  }

  const raw = await readBoundedResponseText(response)
  let payload: unknown = null
  try {
    payload = raw ? JSON.parse(raw) : null
  }
  catch {
    throw new Error('Usługa pocztowa zwróciła nieprawidłową odpowiedź.')
  }
  if (!response.ok) {
    throw new Error(errorMessage(payload) ?? 'Nie udało się odczytać poczty OpenExpert.')
  }
  return validateCrmAgentMailApiResponse(path, payload) as T
}
