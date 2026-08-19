export const OPENEXPERT_MOCK_BANK_LOGO_PATH = '/assets/openexpert-bank.svg' as const

export function resolveMortgageBankLogoUrl(
  bankSlug: unknown,
  catalogLogoUrl: unknown,
): string | null {
  if (bankSlug === 'openexpert-bank') return OPENEXPERT_MOCK_BANK_LOGO_PATH
  return typeof catalogLogoUrl === 'string' && catalogLogoUrl.trim()
    ? catalogLogoUrl
    : null
}
