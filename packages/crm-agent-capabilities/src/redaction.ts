const EMAIL_PATTERN = /[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/giu
const POLISH_IDENTIFIER_PATTERN = /(?<![\d+])(?:\d[\s-]?){9,10}\d(?!\d)/gu
const PHONE_PATTERN = /(?<![\p{L}\d])(?:\+?48[\s-]?)?(?:\d[\s-]?){8}\d(?!\d)/gu

/** Defense in depth for user-authored labels which may contain pasted PII. */
export function redactSensitiveText(value: string): string {
  return value
    .replace(EMAIL_PATTERN, '[REDACTED_EMAIL]')
    .replace(POLISH_IDENTIFIER_PATTERN, '[REDACTED_IDENTIFIER]')
    .replace(PHONE_PATTERN, '[REDACTED_PHONE]')
}
