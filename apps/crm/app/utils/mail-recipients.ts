const MAIL_RECIPIENT_SEPARATOR = /[;,\n]+/u
const MAIL_RECIPIENT_PATTERN = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/u

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
    const key = recipient.toLocaleLowerCase('en-US')
    if (seen.has(key)) continue
    seen.add(key)
    recipients.push(recipient)
  }

  return recipients
}

export function serializeMailRecipients(value: string | readonly string[]): string {
  return uniqueMailRecipients(value).join(', ')
}

export function isValidMailRecipient(value: string): boolean {
  const recipient = value.trim()
  return recipient.length <= 254 && MAIL_RECIPIENT_PATTERN.test(recipient)
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
