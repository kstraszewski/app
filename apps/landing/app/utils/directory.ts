export function normalizeDirectoryQuery(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('pl-PL')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replaceAll('ł', 'l')
}

export function directoryHydrationData<T>(
  isHydrating: boolean,
  payloadData: Record<string, unknown>,
  key: string,
): T | undefined {
  // Directory payloads contain expiring signed image URLs. Reuse them only
  // while hydrating the matching SSR response, never on a later client visit.
  return isHydrating
    ? payloadData[key] as T | undefined
    : undefined
}

export function directoryBookingUrl(
  crmBaseUrl: string,
  widgetKey: string,
  expertId?: string,
): string {
  const baseUrl = new URL(crmBaseUrl)
  const bookingUrl = new URL(`/book/${encodeURIComponent(widgetKey)}`, baseUrl.origin)
  if (expertId) bookingUrl.searchParams.set('expertId', expertId)
  return bookingUrl.toString()
}
