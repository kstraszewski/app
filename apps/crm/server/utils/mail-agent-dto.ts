import type { CrmAgentMailAddressSummary } from '../../shared/types/agent-mail.ts'
import type { MailAddress } from '../../shared/types/mail.ts'
import { stripUnsafeMailDisplayControls } from '../../shared/utils/mail-security.ts'

/**
 * Provider-controlled strings cross the EVE service boundary only after a
 * final, centralized size/control-character clamp. Provider adapters already
 * sanitize display data, but this boundary must remain safe independently.
 */
export function boundedMailAgentText(value: unknown, maximum: number): string {
  return stripUnsafeMailDisplayControls(String(value ?? '')).slice(0, maximum)
}

export function boundedMailAgentNullableText(
  value: unknown,
  maximum: number,
): string | null {
  return value === null || value === undefined
    ? null
    : boundedMailAgentText(value, maximum)
}

export function boundedMailAgentEmail(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const email = boundedMailAgentText(value, 254).trim().toLowerCase()
  return /^[^\s@<>]+@[^\s@<>]+$/u.test(email) ? email : null
}

/**
 * Keep exact hidden-recipient matching internal. A BCC address may select a
 * thread, but it must never cross the EVE boundary as a reported match unless
 * the provider also exposes it as a regular participant.
 */
export function visibleMailAgentMatchedEmails(
  values: Iterable<unknown>,
  participants: ReadonlyArray<Pick<MailAddress, 'email'>>,
): string[] {
  const visibleEmails = new Set(
    participants
      .map(participant => boundedMailAgentEmail(participant.email))
      .filter((email): email is string => email !== null),
  )
  const result: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const email = boundedMailAgentEmail(value)
    if (!email || !visibleEmails.has(email) || seen.has(email)) continue
    seen.add(email)
    result.push(email)
  }
  return result
}

export function boundedMailAgentCount(
  value: unknown,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.min(maximum, Math.max(0, Math.trunc(number)))
}

export function boundedMailAgentAddress(value: MailAddress): CrmAgentMailAddressSummary {
  const email = boundedMailAgentEmail(value.email)
  const name = boundedMailAgentText(value.name, 500)
  const label = boundedMailAgentText(value.label, 500) || email || name
  return { name, email, label }
}
