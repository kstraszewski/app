import { getRequestURL, getRouterParam, sendRedirect } from 'h3'
import { legacyBookingRedirectUrl } from '#shared/utils/booking-widget-urls'

export default defineEventHandler((event) => {
  const runtimeConfig = useRuntimeConfig(event)
  const clientPortalBaseUrl = String(
    runtimeConfig.public.openexpert.clientPortalBaseUrl || 'http://127.0.0.1:3006',
  )
  const widgetKey = String(getRouterParam(event, 'widgetKey') || '')
  const target = legacyBookingRedirectUrl(
    clientPortalBaseUrl,
    widgetKey,
    getRequestURL(event),
  )

  return sendRedirect(event, target, 307)
})
