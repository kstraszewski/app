import {
  createError,
  defineEventHandler,
  getQuery,
  getRouterParam,
  setHeader,
} from 'h3'
import {
  catalogAllowedOrigins,
  optionalUuidValue,
  publicWidgetKey,
  sanitizePublicCatalog,
} from '../../../../utils/booking-public'
import {
  assertPublicBookingRateLimit,
  assertWidgetRequestOrigin,
  getPublicSchedulingClient,
  recordBookingWidgetEvent,
  throwBookingError,
  verifyBookingWidgetPreviewToken,
} from '../../../../utils/scheduling'

export default defineEventHandler(async (event) => {
  const widgetKey = publicWidgetKey(getRouterParam(event, 'widgetKey'))
  const query = getQuery(event)
  const visitId = optionalUuidValue(query.visitId ?? query.visit_id, 'visitId')
  const dataApi = await getPublicSchedulingClient(event)
  const { data, error } = await dataApi.rpc('get_booking_widget_catalog', {
    p_widget_token: widgetKey,
  })
  throwBookingError(error)
  if (!data) throw createError({ statusCode: 404, statusMessage: 'Booking widget not found' })
  await assertPublicBookingRateLimit(event, 'catalog', widgetKey, 120, 60_000)
  assertWidgetRequestOrigin(event, catalogAllowedOrigins(data), widgetKey)
  const isAuthorizedPreview = verifyBookingWidgetPreviewToken(event, widgetKey, query.previewToken)
  if (!isAuthorizedPreview && visitId) {
    await recordBookingWidgetEvent(event, {
      widgetKey,
      visitId,
      eventType: 'widget_view',
      isEmbedded: query.embed === '1',
    })
  }
  setHeader(event, 'Cache-Control', 'no-store')
  return sanitizePublicCatalog(data, widgetKey)
})
