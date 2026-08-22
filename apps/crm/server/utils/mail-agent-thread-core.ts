import type { MailMessageDetail } from '../../shared/types/mail.ts'

function normalizedEmail(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase()
}

export function mailAgentMessageMatchesParticipants(
  message: Pick<MailMessageDetail, 'from' | 'to' | 'cc'>,
  participantEmails: string[],
  accountEmail: string,
): boolean {
  const expected = new Set(participantEmails.map(normalizedEmail).filter(Boolean))
  const sent = normalizedEmail(message.from?.email) === normalizedEmail(accountEmail)
  if (sent) {
    return [...message.to, ...message.cc]
      .some(address => expected.has(normalizedEmail(address.email)))
  }
  return expected.has(normalizedEmail(message.from?.email))
}

export function denseMailBodyExcerpt(
  value: string,
  limit: number,
  question?: string,
): { text: string; start: number; truncated: boolean } {
  const boundedLimit = Math.max(1, Math.trunc(limit))
  const text = String(value ?? '')
    .replace(/[\t ]+/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
  const terms = String(question ?? '').toLowerCase().split(/[^\p{L}\p{N}@._-]+/u)
    .filter(term => term.length >= 2)
  const lower = text.toLowerCase()
  const firstMatch = terms
    .map(term => lower.indexOf(term))
    .filter(index => index >= 0)
    .sort((left, right) => left - right)[0]
  const start = firstMatch === undefined
    ? 0
    : Math.max(0, Math.min(text.length - boundedLimit, firstMatch - Math.floor(boundedLimit / 3)))
  return {
    text: text.slice(start, start + boundedLimit),
    start,
    truncated: start > 0 || text.length > start + boundedLimit,
  }
}
