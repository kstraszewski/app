export interface ClientAppointmentEmailEvidence {
  authEmail: unknown
  emailConfirmedAt: string | null | undefined
  appointmentEmail: unknown
  personEmailNormalized: unknown
}

export function normalizeClientEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function confirmedClientEmail(
  authEmail: unknown,
  emailConfirmedAt: string | null | undefined,
): string {
  return emailConfirmedAt ? normalizeClientEmail(authEmail) : ''
}

export function hasMatchingVerifiedClientEmail(
  evidence: ClientAppointmentEmailEvidence,
): boolean {
  const confirmedEmail = confirmedClientEmail(
    evidence.authEmail,
    evidence.emailConfirmedAt,
  )
  const appointmentEmail = normalizeClientEmail(evidence.appointmentEmail)
  const personEmail = typeof evidence.personEmailNormalized === 'string'
    ? evidence.personEmailNormalized
    : ''

  return Boolean(
    confirmedEmail
    && confirmedEmail === appointmentEmail
    && confirmedEmail === personEmail,
  )
}

export function appointmentMatchesVerifiedContact(
  verifiedContactNormalized: unknown,
  appointmentEmail: unknown,
): boolean {
  if (typeof verifiedContactNormalized !== 'string') return false
  if (
    !verifiedContactNormalized
    || verifiedContactNormalized !== normalizeClientEmail(verifiedContactNormalized)
  ) return false

  return verifiedContactNormalized === normalizeClientEmail(appointmentEmail)
}
