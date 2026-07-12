import { setHeader } from 'h3'
import {
  catalogAllowedOrigins,
  getPublicSchedulingClient,
  publicWidgetKey,
} from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const match = event.path.match(/^\/book\/([^/?#]+)/)
  if (!match?.[1]) return

  let allowedOrigins: string[] = []
  let widgetFound = false
  try {
    const widgetKey = publicWidgetKey(decodeURIComponent(match[1]))
    const supabase = await getPublicSchedulingClient(event)
    const { data } = await supabase.rpc('get_booking_widget_catalog', { p_widget_token: widgetKey })
    if (data) {
      widgetFound = true
      allowedOrigins = catalogAllowedOrigins(data)
    }
  } catch {
    // A missing or invalid widget still gets the restrictive default. The page
    // API will return the appropriate public error without exposing details.
  }

  const frameAncestors = !widgetFound
    ? "'self'"
    : allowedOrigins.length
      ? ["'self'", ...allowedOrigins].join(' ')
      : '*'
  setHeader(event, 'Content-Security-Policy', `frame-ancestors ${frameAncestors}`)
  setHeader(event, 'Referrer-Policy', 'strict-origin-when-cross-origin')
})
