export type ClientMultiformJsonRecord = Record<string, unknown>

export interface ClientMultiformVerifiedLink {
  organizationId: string
  clientId: string
  clientPersonId: string
  verifiedEmail: string
}

type DatabaseRecord = Record<string, any>

function asRecord(value: unknown): ClientMultiformJsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as ClientMultiformJsonRecord
    : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function normalizedEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function verifiedClientMultiformLinks(
  identityEmail: unknown,
  emailVerified: boolean,
  rows: DatabaseRecord[],
): ClientMultiformVerifiedLink[] {
  const email = normalizedEmail(identityEmail)
  if (!emailVerified || !email) return []

  return rows.flatMap((row) => {
    const storedEmail = typeof row.verified_contact_normalized === 'string'
      ? row.verified_contact_normalized
      : ''
    const verifiedEmail = normalizedEmail(storedEmail)
    if (
      row.verification_method !== 'email'
      || storedEmail !== verifiedEmail
      || verifiedEmail !== email
    ) return []
    return [{
      organizationId: String(row.organization_id),
      clientId: String(row.client_id),
      clientPersonId: String(row.client_person_id),
      verifiedEmail,
    }]
  })
}

function conditionMatches(values: ClientMultiformJsonRecord, condition: unknown): boolean {
  const source = asRecord(condition)
  const key = text(source.canonicalKey)
  if (!key) return false
  const actual = values[key]
  if (actual === undefined || actual === null || actual === '') return false
  const expected = Array.isArray(source.equals) ? source.equals : [source.equals]
  return expected.map(String).includes(String(actual))
}

export function invalidClientMultiformFieldKeys(
  fields: DatabaseRecord[],
  values: ClientMultiformJsonRecord,
): string[] {
  const isVisible = (field: DatabaseRecord) => (
    (!field.visibleWhen || conditionMatches(values, field.visibleWhen))
    && (
      !Array.isArray(field.applicableWhenAny)
      || field.applicableWhenAny.length === 0
      || field.applicableWhenAny.some((condition: unknown) => conditionMatches(values, condition))
    )
  )
  const isRequired = (field: DatabaseRecord) => (
    field.required === true
    || Boolean(field.requiredWhen && conditionMatches(values, field.requiredWhen))
  )

  return fields.flatMap((field) => {
    if (!isVisible(field)) return []
    const value = values[text(field.key)]
    const missing = field.type === 'checkbox'
      ? value !== true
      : value === undefined || value === null || String(value).trim() === ''
    if (missing) return isRequired(field) ? [text(field.key)] : []

    const rawValue = String(value).trim()
    const validation = asRecord(field.validation)
    if (typeof validation.maxLength === 'number' && rawValue.length > validation.maxLength) {
      return [text(field.key)]
    }
    if (typeof validation.pattern === 'string') {
      try {
        if (!new RegExp(validation.pattern).test(rawValue)) return [text(field.key)]
      }
      catch {
        return [text(field.key)]
      }
    }
    if (['number', 'currency', 'integer', 'decimal'].includes(String(field.type))) {
      const numeric = Number(rawValue.replace(',', '.'))
      if (!Number.isFinite(numeric)) return [text(field.key)]
      if (typeof validation.min === 'number' && numeric < validation.min) return [text(field.key)]
      if (typeof validation.max === 'number' && numeric > validation.max) return [text(field.key)]
      if (validation.integer === true && !Number.isInteger(numeric)) return [text(field.key)]
    }
    return []
  })
}

export function sanitizeClientMultiformField(
  field: DatabaseRecord,
  applicantPrefix: string,
  currentValues: ClientMultiformJsonRecord,
): DatabaseRecord | null {
  const sanitized = { ...field }
  const conditionIsOwned = (condition: unknown) => (
    text(asRecord(condition).canonicalKey).startsWith(applicantPrefix)
  )

  if (sanitized.visibleWhen && !conditionIsOwned(sanitized.visibleWhen)) {
    if (!conditionMatches(currentValues, sanitized.visibleWhen)) return null
    delete sanitized.visibleWhen
  }

  if (Array.isArray(sanitized.applicableWhenAny) && sanitized.applicableWhenAny.length) {
    const owned = sanitized.applicableWhenAny.filter(conditionIsOwned)
    const externalMatches = sanitized.applicableWhenAny
      .filter((condition: unknown) => !conditionIsOwned(condition))
      .some((condition: unknown) => conditionMatches(currentValues, condition))
    if (externalMatches) delete sanitized.applicableWhenAny
    else if (owned.length) sanitized.applicableWhenAny = owned
    else return null
  }

  if (sanitized.requiredWhen && !conditionIsOwned(sanitized.requiredWhen)) {
    if (conditionMatches(currentValues, sanitized.requiredWhen)) sanitized.required = true
    delete sanitized.requiredWhen
  }

  return sanitized
}

export function mergeOwnedClientMultiformValues(
  currentValues: ClientMultiformJsonRecord,
  submittedValues: ClientMultiformJsonRecord,
  allowedKeys: ReadonlySet<string>,
): { values: ClientMultiformJsonRecord, unknownKey: string | null } {
  const unknownKey = Object.keys(submittedValues).find(key => !allowedKeys.has(key)) ?? null
  if (unknownKey) return { values: currentValues, unknownKey }
  return { values: { ...currentValues, ...submittedValues }, unknownKey: null }
}
