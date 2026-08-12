import { createError, getRouterParam, setHeader } from 'h3'
import { bookingWidgetPublicUrl } from '#shared/utils/booking-widget-urls'

/**
 * Legacy guard. Customer bookings are authenticated and written atomically by
 * the client panel now; keeping the former anonymous CRM mutation available
 * would let callers bypass that account boundary.
 */
export default defineEventHandler((event) => {
  const widgetKey = String(getRouterParam(event, 'widgetKey') || '')
  const clientBaseUrl = String(
    useRuntimeConfig(event).public.openexpert.clientPortalBaseUrl
      || 'http://127.0.0.1:3006',
  )
  const location = bookingWidgetPublicUrl(clientBaseUrl, widgetKey)
  setHeader(event, 'Cache-Control', 'no-store')
  setHeader(event, 'Location', location)
  throw createError({
    statusCode: 410,
    statusMessage: 'Booking moved to the authenticated client panel',
    data: { location },
  })
})
