const e164Pattern = /^\+[1-9]\d{7,14}$/

/**
 * Normalizes phone numbers stored by the identity service. Polish local
 * numbers are accepted as a convenience; every stored value is E.164.
 */
export function normalizeOpenExpertPhone(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const raw = input.trim()
  if (!raw || raw.length > 50 || /[A-Za-z]/.test(raw)) return null

  const compact = raw.replace(/[\s().-]+/g, '')
  let candidate: string
  if (compact.startsWith('+')) {
    candidate = compact
  }
  else if (compact.startsWith('00')) {
    candidate = `+${compact.slice(2)}`
  }
  else if (/^\d{9}$/.test(compact)) {
    candidate = `+48${compact}`
  }
  else if (/^48\d{9}$/.test(compact)) {
    candidate = `+${compact}`
  }
  else {
    return null
  }

  return e164Pattern.test(candidate) ? candidate : null
}

export function maskOpenExpertPhone(input: unknown): string {
  const normalized = normalizeOpenExpertPhone(input)
  if (!normalized) return '••• ••• •••'
  return `${normalized.slice(0, 3)} ••• ••• ${normalized.slice(-3)}`
}
