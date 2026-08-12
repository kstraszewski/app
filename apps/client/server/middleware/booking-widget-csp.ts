import { setHeader } from 'h3'
import {
  catalogAllowedOrigins,
  publicWidgetKey,
} from '../utils/booking-public.ts'
import { getPublicSchedulingClient } from '../utils/scheduling.ts'

export default defineEventHandler(async (event) => {
  const match = event.path.match(/^\/book\/([^/?#]+)/)
  if (!match?.[1]) return

  let allowedOrigins: string[] = []
  let widgetFound = false
  try {
    const widgetKey = publicWidgetKey(decodeURIComponent(match[1]))
    const dataApi = await getPublicSchedulingClient(event)
    const { data } = await dataApi.rpc('get_booking_widget_catalog', {
      p_widget_token: widgetKey,
    })
    if (data) {
      widgetFound = true
      allowedOrigins = catalogAllowedOrigins(data)
    }
  } catch {
    // Invalid and missing widgets retain the restrictive default. Their public
    // API response supplies the user-facing error without leaking details.
  }

  const frameAncestors = !widgetFound
    ? "'self'"
    : allowedOrigins.length
      ? ["'self'", ...allowedOrigins].join(' ')
      : '*'
  setHeader(event, 'Content-Security-Policy', `frame-ancestors ${frameAncestors}`)
  setHeader(event, 'Referrer-Policy', 'strict-origin-when-cross-origin')
})
