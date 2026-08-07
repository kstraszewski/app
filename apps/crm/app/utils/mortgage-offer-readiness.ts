export function isMortgageOfferApplicationReady(status: unknown): boolean {
  return status === 'complete' || status === 'partial'
}
