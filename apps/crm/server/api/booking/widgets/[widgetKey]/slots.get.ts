import { getQuery, setHeader } from 'h3'
import { asRecord } from '~~/server/utils/crm'
import {
  assertPublicBookingRateLimit,
  assertWidgetRequestOrigin,
  catalogAllowedOrigins,
  dateValue,
  getPublicSchedulingClient,
  optionalUuidValue,
  publicWidgetKey,
  recordBookingWidgetEvent,
  sanitizePublicCatalog,
  throwBookingError,
  uuidValue,
  verifyBookingWidgetPreviewToken,
} from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const widgetKey = publicWidgetKey(getRouterParam(event, 'widgetKey'))
  const query = getQuery(event)
  const date = dateValue(query.date)
  const serviceId = uuidValue(query.serviceId ?? query.service_id, 'serviceId')
  const visitId = optionalUuidValue(query.visitId ?? query.visit_id, 'visitId')
  const requestedExpertUserId = optionalUuidValue(query.expertId ?? query.expertUserId ?? query.expert_user_id, 'expertId')
  const supabase = await getPublicSchedulingClient(event)

  const catalogResult = await supabase.rpc('get_booking_widget_catalog', { p_widget_token: widgetKey })
  throwBookingError(catalogResult.error)
  if (!catalogResult.data) throw createError({ statusCode: 404, statusMessage: 'Booking widget not found' })
  await assertPublicBookingRateLimit(event, 'slots', widgetKey, 120, 60_000)
  assertWidgetRequestOrigin(event, catalogAllowedOrigins(catalogResult.data), widgetKey)
  const catalog = sanitizePublicCatalog(catalogResult.data, widgetKey)
  if (!catalog.services.some(service => service.id === serviceId)) {
    throw createError({ statusCode: 400, statusMessage: 'Service is not available in this widget' })
  }
  if (
    catalog.widget.fixedExpertUserId
    && requestedExpertUserId
    && requestedExpertUserId !== catalog.widget.fixedExpertUserId
  ) {
    throw createError({ statusCode: 400, statusMessage: 'Expert is fixed for this widget' })
  }
  const expertUserId = catalog.widget.fixedExpertUserId
    ?? (catalog.widget.bookingMode === 'facility' ? null : requestedExpertUserId)
  if (!catalog.widget.fixedExpertUserId && catalog.widget.bookingMode === 'expert' && !expertUserId) {
    setHeader(event, 'Cache-Control', 'no-store')
    return { date, timezone: catalog.facility.timezone, slots: [] }
  }
  if (expertUserId) {
    const expert = catalog.experts.find(item => item.userId === expertUserId)
    if (!expert || (expert.serviceIds && !expert.serviceIds.includes(serviceId))) {
      throw createError({ statusCode: 400, statusMessage: 'Expert is not available for this service' })
    }
  }
  const isAuthorizedPreview = verifyBookingWidgetPreviewToken(event, widgetKey, query.previewToken)
  if (!isAuthorizedPreview && visitId) {
    await recordBookingWidgetEvent(event, {
      widgetKey,
      visitId,
      eventType: 'availability_search',
      serviceId,
      isEmbedded: query.embed === '1',
    })
  }

  const { data, error } = await supabase.rpc('get_booking_widget_slots', {
    p_widget_token: widgetKey,
    p_service_id: serviceId,
    p_starts_on: date,
    p_ends_on: date,
    p_expert_user_id: expertUserId,
  })
  throwBookingError(error)
  const expertNames = new Map(catalog.experts.map(expert => [expert.userId, expert.name]))
  const expertSlots = (Array.isArray(data) ? data : []).flatMap((input) => {
    const row = asRecord(input)
    const startsAt = row.starts_at ?? row.startsAt
    const endsAt = row.ends_at ?? row.endsAt
    const userId = row.expert_user_id ?? row.expertUserId
    if (!startsAt || !endsAt || !userId) return []
    return [{
      startsAt: String(startsAt),
      endsAt: String(endsAt),
      expertUserId: String(userId),
      expertName: String(row.expert_name ?? row.expertName ?? expertNames.get(String(userId)) ?? ''),
    }]
  })
  const aggregateExperts = !catalog.widget.fixedExpertUserId && (
    catalog.widget.bookingMode === 'facility'
    || (catalog.widget.bookingMode === 'both' && !requestedExpertUserId)
  )
  const slots = aggregateExperts
    ? [...new Map(expertSlots.map(slot => [
        `${slot.startsAt}/${slot.endsAt}`,
        { ...slot, expertUserId: '', expertName: 'Dowolny dostępny ekspert' },
      ])).values()]
    : expertSlots
  if (!isAuthorizedPreview && visitId && slots.length > 0) {
    await recordBookingWidgetEvent(event, {
      widgetKey,
      visitId,
      eventType: 'availability_found',
      serviceId,
      isEmbedded: query.embed === '1',
    })
  }
  setHeader(event, 'Cache-Control', 'no-store')
  return { date, timezone: catalog.facility.timezone, slots }
})
