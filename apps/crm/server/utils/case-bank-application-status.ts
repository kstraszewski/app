export const mortgageApplicationStatuses = [
  'draft',
  'wyslane',
  'w_analizie',
  'braki',
  'zaakceptowane',
  'odrzucone',
  'wycofane',
] as const

export type MortgageApplicationStatus = typeof mortgageApplicationStatuses[number]

const mortgageApplicationStatusSet = new Set<string>(mortgageApplicationStatuses)

export function isMortgageApplicationStatus(input: unknown): input is MortgageApplicationStatus {
  return typeof input === 'string' && mortgageApplicationStatusSet.has(input)
}

export function mortgageSubmissionStatusPatch(
  current: { submitted_at?: unknown, decision_at?: unknown },
  statusCode: MortgageApplicationStatus,
  now = new Date().toISOString(),
): Record<string, unknown> {
  const patch: Record<string, unknown> = { status_code: statusCode }

  if (statusCode === 'draft') {
    patch.submitted_at = null
    patch.decision_at = null
    return patch
  }

  if (['wyslane', 'w_analizie', 'braki', 'zaakceptowane', 'odrzucone'].includes(statusCode)) {
    patch.submitted_at = typeof current.submitted_at === 'string'
      ? current.submitted_at
      : now
  }

  patch.decision_at = ['zaakceptowane', 'odrzucone', 'wycofane'].includes(statusCode)
    ? now
    : null
  return patch
}
