export function normalizeDirectoryQuery(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('pl-PL')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replaceAll('ł', 'l')
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
