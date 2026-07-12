import { setHeader } from 'h3'
import {
  assertPublicBookingRateLimit,
  assertWidgetRequestOrigin,
  catalogAllowedOrigins,
  getPublicSchedulingClient,
  publicWidgetKey,
  sanitizePublicCatalog,
  throwBookingError,
} from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const widgetKey = publicWidgetKey(getRouterParam(event, 'widgetKey'))
  const supabase = await getPublicSchedulingClient(event)
  const { data, error } = await supabase.rpc('get_booking_widget_catalog', {
    p_widget_token: widgetKey,
  })
  throwBookingError(error)
  if (!data) throw createError({ statusCode: 404, statusMessage: 'Booking widget not found' })
  await assertPublicBookingRateLimit(event, 'catalog', widgetKey, 120, 60_000)
  assertWidgetRequestOrigin(event, catalogAllowedOrigins(data), widgetKey)
  setHeader(event, 'Cache-Control', 'no-store')
  return sanitizePublicCatalog(data, widgetKey)
})
