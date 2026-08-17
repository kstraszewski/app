const MAIL_RECIPIENT_SEPARATOR = /[;,\n]+/u
const MAIL_RECIPIENT_PATTERN = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/u

export type MailRecipientSelectionSource = 'crm' | 'manual' | 'provider'

export interface MailRecipientSelection {
  email: string
  label: string
  source: MailRecipientSelectionSource
  clientId?: string
  clientLabel?: string
  personId?: string
  providerId?: string
}

export type MailProviderRecipientSuggestion = MailRecipientSelection & {
  source: 'provider'
}

const MAIL_RECIPIENT_SOURCE_PRIORITY: Record<MailRecipientSelectionSource, number> = {
  manual: 0,
  provider: 1,
  crm: 2,
}

const MAIL_RECIPIENT_SUGGESTION_ORDER: Record<MailRecipientSelectionSource, number> = {
  crm: 0,
  provider: 1,
  manual: 2,
}

export function mailRecipientKey(value: string): string {
  return value.trim().toLocaleLowerCase('en-US')
}

export function mailRecipientMatchesSearch(
  recipient: Pick<MailRecipientSelection, 'email' | 'label' | 'clientLabel'>,
  query: string,
): boolean {
  const normalizedQuery = normalizeMailRecipientSearchValue(query)
  if (!normalizedQuery) return true

  return normalizeMailRecipientSearchValue([
    recipient.label,
    recipient.email,
    recipient.clientLabel,
  ].filter(Boolean).join(' ')).includes(normalizedQuery)
}

function normalizeMailRecipientSearchValue(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .trim()
    .toLocaleLowerCase('pl-PL')
}

/**
 * Identifies the record selected in the recipient picker, rather than only its
 * address. This matters when two CRM clients legitimately share one mailbox.
 */
export function mailRecipientSelectionKey(selection: MailRecipientSelection): string {
  const email = mailRecipientKey(selection.email)
  const identity = selection.source === 'crm'
    ? selection.clientId || selection.personId || selection.label.trim().toLocaleLowerCase('pl-PL')
    : selection.source === 'provider'
      ? selection.providerId || selection.label.trim().toLocaleLowerCase('pl-PL')
      : ''

  return [selection.source, identity, email]
    .map(part => encodeURIComponent(part))
    .join(':')
}

export function splitMailRecipients(value: string | readonly string[]): string[] {
  const values = Array.isArray(value) ? value : [value]
  return values
    .flatMap(entry => entry.split(MAIL_RECIPIENT_SEPARATOR))
    .map(entry => entry.trim())
    .filter(Boolean)
}

export function uniqueMailRecipients(value: string | readonly string[]): string[] {
  const recipients: string[] = []
  const seen = new Set<string>()

  for (const recipient of splitMailRecipients(value)) {
    const key = mailRecipientKey(recipient)
    if (seen.has(key)) continue
    seen.add(key)
    recipients.push(recipient)
  }

  return recipients
}

/**
 * Deduplicates structured choices without losing their first visual position.
 * A CRM identity is authoritative for a matching address, followed by a
 * provider contact and finally a manually entered address.
 */
export function uniqueMailRecipientSelections<T extends MailRecipientSelection>(
  value: readonly T[],
): T[] {
  const selections: T[] = []
  const indexes = new Map<string, number>()

  for (const selection of value) {
    const email = selection.email.trim()
    if (!email) continue

    const normalized = {
      ...selection,
      email,
      label: selection.label.trim() || email,
    } as T
    const key = mailRecipientKey(email)
    const existingIndex = indexes.get(key)

    if (existingIndex === undefined) {
      indexes.set(key, selections.length)
      selections.push(normalized)
      continue
    }

    const existing = selections[existingIndex]
    if (existing && MAIL_RECIPIENT_SOURCE_PRIORITY[normalized.source] > MAIL_RECIPIENT_SOURCE_PRIORITY[existing.source]) {
      selections[existingIndex] = normalized
    }
  }

  return selections
}

/**
 * Deduplicates suggestion records by their real identity. Unlike
 * `uniqueMailRecipientSelections`, this intentionally keeps two CRM records
 * that use the same email address so the user can choose the correct client.
 */
export function uniqueMailRecipientSuggestions<T extends MailRecipientSelection>(
  value: readonly T[],
): T[] {
  const suggestions: T[] = []
  const seen = new Set<string>()

  for (const suggestion of value) {
    const email = suggestion.email.trim()
    if (!email) continue

    const normalized = {
      ...suggestion,
      email,
      label: suggestion.label.trim() || email,
    } as T
    const key = mailRecipientSelectionKey(normalized)
    if (seen.has(key)) continue
    seen.add(key)
    suggestions.push(normalized)
  }

  return suggestions
}

/** Keeps result ordering deterministic: CRM records, provider contacts, raw addresses. */
export function orderMailRecipientSuggestions<T extends MailRecipientSelection>(
  value: readonly T[],
): T[] {
  return uniqueMailRecipientSuggestions(value)
    .map((suggestion, index) => ({ suggestion, index }))
    .sort((left, right) => (
      MAIL_RECIPIENT_SUGGESTION_ORDER[left.suggestion.source]
      - MAIL_RECIPIENT_SUGGESTION_ORDER[right.suggestion.source]
      || left.index - right.index
    ))
    .map(({ suggestion }) => suggestion)
}

/**
 * Resolves an address only when the highest-priority matching identity is
 * unambiguous. Two clients sharing an address must be chosen explicitly.
 */
export function resolveUnambiguousMailRecipientSelection(
  email: string,
  candidates: readonly MailRecipientSelection[],
): MailRecipientSelection | undefined {
  const emailKey = mailRecipientKey(email)
  const matching = uniqueMailRecipientSuggestions(candidates)
    .filter(candidate => mailRecipientKey(candidate.email) === emailKey)
  if (!matching.length) return undefined

  const highestPriority = Math.max(
    ...matching.map(candidate => MAIL_RECIPIENT_SOURCE_PRIORITY[candidate.source]),
  )
  const preferred = matching.filter(candidate => (
    MAIL_RECIPIENT_SOURCE_PRIORITY[candidate.source] === highestPriority
  ))
  return preferred.length === 1 ? preferred[0] : undefined
}

export function resolveMailRecipientSelections(
  recipients: string | readonly string[],
  candidates: readonly MailRecipientSelection[] = [],
): MailRecipientSelection[] {
  return uniqueMailRecipients(recipients).map((email) => {
    const candidate = resolveUnambiguousMailRecipientSelection(email, candidates)
    if (candidate) return candidate
    return {
      email,
      label: email,
      source: 'manual',
    }
  })
}

export function serializeMailRecipients(value: string | readonly string[]): string {
  return uniqueMailRecipients(value).join(', ')
}

export function isValidMailRecipient(value: string): boolean {
  const recipient = value.trim()
  return recipient.length <= 254 && MAIL_RECIPIENT_PATTERN.test(recipient)
}

export function isValidMailRecipientList(value: string | readonly string[]): boolean {
  const recipients = splitMailRecipients(value)
  return recipients.length > 0 && recipients.every(isValidMailRecipient)
}

export function mailRecipientInitials(name: string | null | undefined, email: string): string {
  const words = (name || '')
    .trim()
    .split(/\s+/u)
    .filter(Boolean)

  if (words.length > 1) {
    return `${words[0]?.[0] || ''}${words.at(-1)?.[0] || ''}`.toLocaleUpperCase('pl-PL')
  }
  if (words.length === 1 && words[0]) {
    return words[0].slice(0, 2).toLocaleUpperCase('pl-PL')
  }

  const localPart = email.split('@')[0]?.replace(/[^\p{L}\p{N}]+/gu, ' ').trim() || email
  const localWords = localPart.split(/\s+/u).filter(Boolean)
  if (localWords.length > 1) {
    return `${localWords[0]?.[0] || ''}${localWords.at(-1)?.[0] || ''}`.toLocaleUpperCase('pl-PL')
  }
  return (localWords[0] || '?').slice(0, 2).toLocaleUpperCase('pl-PL')
}
