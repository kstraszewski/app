import {
  createError,
  getHeader,
  getRequestURL,
  setResponseHeader,
  type H3Event,
} from 'h3'

export function setPrivateMailResponseHeaders(event: H3Event): void {
  setResponseHeader(event, 'cache-control', 'private, no-store, max-age=0')
  setResponseHeader(event, 'pragma', 'no-cache')
  setResponseHeader(event, 'expires', '0')
  setResponseHeader(event, 'referrer-policy', 'no-referrer')
  setResponseHeader(event, 'x-content-type-options', 'nosniff')
}

export function requireSameOriginMailRequest(event: H3Event): void {
  const origin = getHeader(event, 'origin')
  if (!origin) {
    throw createError({ statusCode: 403, statusMessage: 'Brak nagłówka Origin.' })
  }

  const requestUrl = getRequestURL(event)
  const allowedOrigins = new Set([requestUrl.origin])
  const forwardedHost = getHeader(event, 'x-forwarded-host')?.split(',')[0]?.trim()
  const forwardedProto = getHeader(event, 'x-forwarded-proto')?.split(',')[0]?.trim()
  if (forwardedHost && /^https?$/u.test(forwardedProto || '')) {
    allowedOrigins.add(`${forwardedProto}://${forwardedHost}`)
  }

  let normalizedOrigin = ''
  try {
    normalizedOrigin = new URL(origin).origin
  } catch {
    // Invalid origins are rejected below.
  }
  const fetchSite = getHeader(event, 'sec-fetch-site')
  if (
    !allowedOrigins.has(normalizedOrigin)
    || (fetchSite && fetchSite !== 'same-origin')
  ) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Żądanie pochodzi z niedozwolonej strony.',
    })
  }
}
