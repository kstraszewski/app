export type MortgageCalculationStatus =
  | 'complete'
  | 'partial'
  | 'ineligible'
  | 'unsupported'

export function isMortgageCalculationShortlistable(
  status: MortgageCalculationStatus,
  limitsEligible: boolean,
): boolean {
  return limitsEligible && (status === 'complete' || status === 'partial')
}

export function mortgageCalculationSnapshot(
  raw: Record<string, unknown>,
  status: MortgageCalculationStatus,
  issues: unknown[],
): Record<string, unknown> {
  return {
    ...raw,
    status,
    issues,
  }
}
