import { readBody, setHeader } from 'h3'
import { asRecord } from '~~/server/utils/crm'
import {
  assertPublicBookingRateLimit,
  assertWidgetRequestOrigin,
  booleanValue,
  catalogAllowedOrigins,
  getPublicSchedulingClient,
  limitedText,
  publicWidgetKey,
  recordBookingWidgetEvent,
  sanitizePublicCatalog,
  throwBookingError,
  uuidValue,
  verifyBookingWidgetPreviewToken,
} from '~~/server/utils/scheduling'

const clientEventTypes = [
  'widget_engaged',
  'calculator_started',
  'calculator_completed',
  'service_selected',
  'slot_selected',
  'contact_started',
] as const

type ClientEventType = typeof clientEventTypes[number]

const allowedClientEventTypes = new Set<string>(clientEventTypes)
const serviceScopedClientEvents = new Set<ClientEventType>([
  'service_selected',
  'slot_selected',
  'contact_started',
])

export default defineEventHandler(async (event) => {
  const widgetKey = publicWidgetKey(getRouterParam(event, 'widgetKey'))
  const body = asRecord(await readBody(event))
  const visitId = uuidValue(body.visitId ?? body.visit_id, 'visitId')
  const eventTypeInput = limitedText(
    body.eventType ?? body.event_type,
    'eventType',
    50,
    { required: true },
  ) as string
  if (!allowedClientEventTypes.has(eventTypeInput)) {
    throw createError({ statusCode: 400, statusMessage: 'Unsupported widget analytics event' })
  }
  const eventType = eventTypeInput as ClientEventType
  const rawServiceId = body.serviceId ?? body.service_id
  const requiresService = serviceScopedClientEvents.has(eventType)
  let serviceId: string | null = null
  if (requiresService) {
    serviceId = uuidValue(rawServiceId, 'serviceId')
  } else if (rawServiceId !== undefined && rawServiceId !== null && rawServiceId !== '') {
    throw createError({
      statusCode: 400,
      statusMessage: 'serviceId is not allowed for this widget analytics event',
    })
  }
  const rawIsEmbedded = body.isEmbedded ?? body.is_embedded
  const isEmbedded = rawIsEmbedded === undefined
    ? false
    : booleanValue(rawIsEmbedded, 'isEmbedded')

  const dataApi = await getPublicSchedulingClient(event)
  const catalogResult = await dataApi.rpc('get_booking_widget_catalog', {
    p_widget_token: widgetKey,
  })
  throwBookingError(catalogResult.error)
  if (!catalogResult.data) {
    throw createError({ statusCode: 404, statusMessage: 'Booking widget not found' })
  }
  await assertPublicBookingRateLimit(event, 'analytics', widgetKey, 120, 60_000)
  assertWidgetRequestOrigin(
    event,
    catalogAllowedOrigins(catalogResult.data),
    widgetKey,
    { requireSource: true },
  )
  const catalog = sanitizePublicCatalog(catalogResult.data, widgetKey)
  if (serviceId && !catalog.services.some(service => service.id === serviceId)) {
    throw createError({ statusCode: 400, statusMessage: 'Service is not available in this widget' })
  }
  if (
    catalog.widget.widgetType === 'calendar'
    && (eventType === 'calculator_started' || eventType === 'calculator_completed')
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Calculator events are not available for calendar widgets',
    })
  }

  const isAuthorizedPreview = verifyBookingWidgetPreviewToken(
    event,
    widgetKey,
    body.previewToken ?? body.preview_token,
  )
  if (!isAuthorizedPreview) {
    await recordBookingWidgetEvent(event, {
      widgetKey,
      visitId,
      eventType,
      serviceId,
      isEmbedded,
    })
  }

  setHeader(event, 'Cache-Control', 'no-store')
  return { ok: true, suppressed: isAuthorizedPreview }
})
