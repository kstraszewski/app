import { createHash } from 'node:crypto'
import { createError } from 'h3'
import type {
  MailContextScope,
  MailContextScopeType,
  MailProviderId,
  MailThreadSummary,
} from '../../shared/types/mail.ts'
import { openImapMessageReference } from './mail-imap-smtp.ts'
import { decodeMicrosoftThreadReference } from './mail-microsoft.ts'
import { mailThreadBlindParticipants } from './mail-message-blind-recipients.ts'

export const MAX_MAIL_CONTEXT_EMAILS = 12
export const MAX_MAIL_CONTEXT_THREAD_REFERENCE_CHARACTERS = 4_096
export const MAX_MAIL_CONTEXT_CLIENT_SCOPES = 10
export const MAX_MAIL_CONTEXT_CASE_SCOPES = 1

export function parseMailContextScope(value: unknown): MailContextScope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidContextError()
  }
  const record = value as Record<string, unknown>
  if (Object.keys(record).some(key => key !== 'type' && key !== 'id')) {
    throw invalidContextError()
  }
  const type = String(record.type ?? '').trim() as MailContextScopeType
  const id = String(record.id ?? '').trim().toLowerCase()
  if ((type !== 'client' && type !== 'case') || !isUuid(id)) {
    throw invalidContextError()
  }
  return { type, id }
}

/**
 * Parses, deduplicates and orders all CRM scopes carried by a composer send.
 * Keeping the result canonical is important because it is included in the
 * idempotency hash of the logical send request.
 */
export function parseMailContextScopes(value: unknown): MailContextScope[] {
  if (!Array.isArray(value)) throw invalidContextError()

  const unique = new Map<string, MailContextScope>()
  for (const item of value) {
    const scope = parseMailContextScope(item)
    unique.set(`${scope.type}:${scope.id}`, scope)
  }

  const scopes = [...unique.values()]
  const clientCount = scopes.filter(scope => scope.type === 'client').length
  const caseCount = scopes.filter(scope => scope.type === 'case').length
  if (
    clientCount > MAX_MAIL_CONTEXT_CLIENT_SCOPES
    || caseCount > MAX_MAIL_CONTEXT_CASE_SCOPES
  ) throw invalidContextError()

  return scopes.sort((left, right) => {
    if (left.type !== right.type) return left.type === 'case' ? -1 : 1
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  })
}

/** Returns selected clients that do not belong to the selected case. */
export function unrelatedMailContextClientIds(
  scopes: readonly MailContextScope[],
  relationship: {
    linkedClientIds: readonly unknown[]
    fallbackClientId?: unknown
  },
): string[] {
  if (!scopes.some(scope => scope.type === 'case')) return []

  const related = new Set(
    [relationship.fallbackClientId, ...relationship.linkedClientIds]
      .map(value => String(value ?? '').trim().toLowerCase())
      .filter(isUuid),
  )
  return scopes
    .filter((scope): scope is MailContextScope & { type: 'client' } => scope.type === 'client')
    .map(scope => scope.id)
    .filter(id => !related.has(id))
}

export function normalizeMailContextEmails(
  values: unknown[],
  limit = MAX_MAIL_CONTEXT_EMAILS,
): { emails: string[]; emailCount: number; truncated: boolean } {
  const unique = new Map<string, string>()
  for (const value of values) {
    const email = normalizedMailContextEmail(value)
    if (email && !unique.has(email)) unique.set(email, email)
  }
  const all = [...unique.values()]
  const boundedLimit = Math.max(1, Math.min(MAX_MAIL_CONTEXT_EMAILS, Math.trunc(limit)))
  return {
    emails: all.slice(0, boundedLimit),
    emailCount: all.length,
    truncated: all.length > boundedLimit,
  }
}

export function mailContextSearchQuery(
  provider: Exclude<MailProviderId, 'imap'>,
  emails: string[],
  search = '',
): string {
  const normalizedSearch = String(search ?? '').trim()
  if (!normalizedSearch) return mailContextSearchPlan(provider, emails).query

  // Leave enough space for both filters so provider-side search keeps the
  // customer constraint instead of falling back to a broad mailbox search.
  const separatorLength = provider === 'google' ? 1 : 11 // `(...) AND (...)`
  const plan = mailContextSearchPlan(provider, emails, 500 - normalizedSearch.length - separatorLength)
  if (!plan.query) return normalizedSearch
  return provider === 'google'
    ? `${plan.query} ${normalizedSearch}`
    : `(${plan.query}) AND (${normalizedSearch})`
}

export function mailContextSearchPlan(
  provider: MailProviderId,
  emails: string[],
  maxQueryCharacters = 500,
): { emails: string[]; query: string; truncated: boolean } {
  const normalized = normalizeMailContextEmails(emails).emails
  if (provider === 'imap') {
    return { emails: normalized, query: '', truncated: false }
  }
  const selected: string[] = []
  for (const email of normalized) {
    const candidate = [...selected, email]
    const query = provider === 'google'
      ? `{${candidate.join(' ')}}`
      : candidate.map(value => `participants:${value}`).join(' OR ')
    if (query.length > maxQueryCharacters) break
    selected.push(email)
  }
  const query = provider === 'google'
    ? selected.length ? `{${selected.join(' ')}}` : ''
    : selected.map(value => `participants:${value}`).join(' OR ')
  return {
    emails: selected,
    query,
    truncated: selected.length < normalized.length,
  }
}

export function mailContextThreadKeyHash(
  provider: MailProviderId,
  threadReference: string,
  referenceSecret: string,
): string {
  const reference = normalizedMailContextThreadReference(threadReference)
  let providerKey: string
  if (provider === 'google') {
    providerKey = reference
  }
  else if (provider === 'microsoft') {
    try {
      const decoded = decodeMicrosoftThreadReference(reference, referenceSecret)
      providerKey = decoded.conversationId || decoded.anchorMessageId
    }
    catch {
      throw invalidThreadReferenceError()
    }
  }
  else {
    try {
      const decoded = openImapMessageReference(reference, referenceSecret)
      providerKey = decoded.messageId
        ? `message:${decoded.messageId}`
        : `uid:${decoded.mailbox}\0${decoded.uidValidity}\0${decoded.uid}`
    }
    catch {
      if (!/^imap_[A-Za-z0-9_-]{32,128}$/u.test(reference)) {
        throw invalidThreadReferenceError()
      }
      providerKey = `fallback:${reference}`
    }
  }
  return createHash('sha256')
    .update(`openexpert/mail-context-thread/v1\0${provider}\0${providerKey}`, 'utf8')
    .digest('hex')
}

export function mailContextMatchedEmails(
  thread: MailThreadSummary,
  contextEmails: string[],
): string[] {
  const expected = new Set(normalizeMailContextEmails(contextEmails).emails)
  const matched = [...thread.participants, ...mailThreadBlindParticipants(thread)]
    .map(participant => normalizedMailContextEmail(participant.email))
    .filter((email): email is string => Boolean(email && expected.has(email)))
  return [...new Set(matched)]
}

export function normalizedMailContextThreadReference(value: string): string {
  const reference = String(value ?? '').trim()
  if (
    !reference
    || reference.length > MAX_MAIL_CONTEXT_THREAD_REFERENCE_CHARACTERS
    || !/^[A-Za-z0-9_-]+$/u.test(reference)
  ) throw invalidThreadReferenceError()
  return reference
}

export function normalizedMailContextEmail(value: unknown): string | null {
  const email = String(value ?? '').trim().toLowerCase()
  if (
    !email
    || email.length > 254
    || /[\u0000-\u0020\u007F]/u.test(email)
    || !/^[^@]+@[^@]+$/u.test(email)
  ) return null
  return email
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value)
}

function invalidContextError() {
  return createError({ statusCode: 400, statusMessage: 'Nieprawidłowy kontekst poczty.' })
}

function invalidThreadReferenceError() {
  return createError({ statusCode: 400, statusMessage: 'Nieprawidłowy identyfikator wątku.' })
}
