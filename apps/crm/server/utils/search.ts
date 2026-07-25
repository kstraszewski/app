const formattedIdentifierPattern = /^[+\d\s()./-]+$/

/**
 * Keep natural-language queries readable, but compact identifiers so phone,
 * PESEL, NIP, REGON and KRS searches work independently of punctuation.
 */
export function normalizeCrmSearchQuery(input: string | undefined): string | undefined {
  const value = input?.trim().replace(/\s+/g, ' ')
  if (!value) return undefined

  if (formattedIdentifierPattern.test(value)) {
    const digits = value.replace(/\D/g, '')
    if (digits.length >= 3) return digits
  }

  return value
}
