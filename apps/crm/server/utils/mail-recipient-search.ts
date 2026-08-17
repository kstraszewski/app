import type {
  MailRecipientCrmSuggestion,
  MailRecipientProviderSuggestion,
  MailThreadSummary,
} from '../../shared/types/mail.ts'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

function text(input: unknown): string {
  return typeof input === 'string' ? input.trim() : ''
}

function record(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
}

function normalized(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('pl-PL')
    .trim()
}

function matchesQuery(values: string[], query: string): boolean {
  const terms = normalized(query).split(/\s+/u).filter(Boolean)
  const haystack = normalized(values.join(' '))
  return terms.every(term => haystack.includes(term))
}

/**
 * Convert the broad CRM list RPC result into the deliberately narrow contract
 * needed by the composer. Notes, tags, phone numbers and ownership metadata
 * never leave the server through recipient search.
 */
export function crmMailRecipientSuggestions(
  rows: readonly Record<string, unknown>[],
  query: string,
  limit: number,
): MailRecipientCrmSuggestion[] {
  const suggestions: MailRecipientCrmSuggestion[] = []
  const seen = new Set<string>()

  for (const row of rows) {
    const clientId = text(row.id)
    const clientLabel = text(row.display_name)
    if (!clientId || !clientLabel) continue

    const matchedPerson = record(row.matchedPerson ?? row.matched_person)
    const primaryPerson = record(row.primaryPerson ?? row.primary_person)
    const candidates = [
      {
        email: text(matchedPerson.email),
        label: text(matchedPerson.display_name),
        personId: text(matchedPerson.id),
      },
      {
        email: text(primaryPerson.email),
        label: text(primaryPerson.display_name),
        personId: text(primaryPerson.id),
      },
      {
        email: text(row.primary_email),
        label: clientLabel,
        personId: '',
      },
    ]

    for (const candidate of candidates) {
      if (!emailPattern.test(candidate.email)) continue
      if (!matchesQuery([clientLabel, candidate.label, candidate.email], query)) continue
      const key = `${clientId}:${candidate.email.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      suggestions.push({
        source: 'crm',
        email: candidate.email,
        label: candidate.label || clientLabel,
        clientId,
        clientLabel,
        ...(candidate.personId ? { personId: candidate.personId } : {}),
      })
      if (suggestions.length >= limit) return suggestions
    }
  }

  return suggestions
}

export function providerMailRecipientSuggestions(
  threads: readonly MailThreadSummary[],
  query: string,
  connectionId: string,
  limit: number,
  accountEmail = '',
): MailRecipientProviderSuggestion[] {
  const suggestions: MailRecipientProviderSuggestion[] = []
  const seen = new Set<string>()
  const ownEmail = accountEmail.trim().toLowerCase()

  for (const thread of threads) {
    for (const participant of thread.participants) {
      const email = text(participant.email)
      if (!emailPattern.test(email)) continue
      if (email.toLowerCase() === ownEmail) continue
      const label = text(participant.name) || text(participant.label) || email
      if (!matchesQuery([label, email], query)) continue
      const key = email.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      suggestions.push({
        source: 'provider',
        email,
        label,
        providerId: `${connectionId}:${key}`,
      })
      if (suggestions.length >= limit) return suggestions
    }
  }

  return suggestions
}
