import { getQuery, setHeader } from 'h3'
import {
  assertPublicBookingRateLimit,
  assertWidgetRequestOrigin,
  catalogAllowedOrigins,
  getPublicSchedulingClient,
  publicWidgetKey,
  recordBookingWidgetEvent,
  sanitizePublicCatalog,
  throwBookingError,
  verifyBookingWidgetPreviewToken,
} from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const widgetKey = publicWidgetKey(getRouterParam(event, 'widgetKey'))
  const query = getQuery(event)
  const supabase = await getPublicSchedulingClient(event)
  const { data, error } = await supabase.rpc('get_booking_widget_catalog', {
    p_widget_token: widgetKey,
  })
  throwBookingError(error)
  if (!data) throw createError({ statusCode: 404, statusMessage: 'Booking widget not found' })
  await assertPublicBookingRateLimit(event, 'catalog', widgetKey, 120, 60_000)
  assertWidgetRequestOrigin(event, catalogAllowedOrigins(data), widgetKey)
  const isAuthorizedPreview = verifyBookingWidgetPreviewToken(event, widgetKey, query.previewToken)
  if (!isAuthorizedPreview) {
    await recordBookingWidgetEvent(event, {
      widgetKey,
      eventType: 'widget_view',
      isEmbedded: query.embed === '1',
    })
  }
  setHeader(event, 'Cache-Control', 'no-store')
  return sanitizePublicCatalog(data, widgetKey)
})
