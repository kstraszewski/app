function bookingPortalOrigin(baseUrl: string): string {
  const url = new URL(baseUrl)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('Booking portal base URL must use HTTP or HTTPS')
  }
  return url.origin
}

export function bookingWidgetPublicUrl(baseUrl: string, widgetKey: string): string {
  return new URL(
    `/book/${encodeURIComponent(widgetKey)}`,
    bookingPortalOrigin(baseUrl),
  ).toString()
}

export function bookingWidgetEmbedUrl(baseUrl: string, widgetKey: string): string {
  const url = new URL(bookingWidgetPublicUrl(baseUrl, widgetKey))
  url.searchParams.set('embed', '1')
  return url.toString()
}

export function bookingWidgetScriptUrl(baseUrl: string): string {
  return new URL('/booking-widget.js', bookingPortalOrigin(baseUrl)).toString()
}

export function legacyBookingRedirectUrl(
  baseUrl: string,
  widgetKey: string,
  requestUrl: string | URL,
): string {
  const target = new URL(bookingWidgetPublicUrl(baseUrl, widgetKey))
  target.search = new URL(requestUrl).search
  return target.toString()
}
