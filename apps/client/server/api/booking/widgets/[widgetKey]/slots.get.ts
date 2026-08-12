import {
  createError,
  defineEventHandler,
  getQuery,
  getRouterParam,
  setHeader,
} from 'h3'
import {
  addDaysToIsoDate,
  BOOKING_WEEK_DAYS,
  bookingDateRange,
  isoDateForTimestamp,
  NEXT_AVAILABLE_SLOT_SEARCH_DAYS,
} from '../../../../../app/utils/booking-slots'
import {
  bookingRecord,
  catalogAllowedOrigins,
  dateValue,
  integerValue,
  optionalUuidValue,
  publicWidgetKey,
  sanitizePublicCatalog,
  uuidValue,
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
  const date = dateValue(query.date)
  const serviceId = uuidValue(query.serviceId ?? query.service_id, 'serviceId')
  const visitId = optionalUuidValue(query.visitId ?? query.visit_id, 'visitId')
  const requestedExpertUserId = optionalUuidValue(
    query.expertId ?? query.expertUserId ?? query.expert_user_id,
    'expertId',
  )
  const findNextAvailable = query.nextAvailable === '1'
  const days = query.days === undefined
    ? 1
    : integerValue(query.days, 'days', 1, BOOKING_WEEK_DAYS)
  const requestedRange = bookingDateRange(date, days)
  const dataApi = await getPublicSchedulingClient(event)

  const catalogResult = await dataApi.rpc('get_booking_widget_catalog', {
    p_widget_token: widgetKey,
  })
  throwBookingError(catalogResult.error)
  if (!catalogResult.data) {
    throw createError({ statusCode: 404, statusMessage: 'Booking widget not found' })
  }
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
    return {
      date: requestedRange.date,
      endDate: requestedRange.endDate,
      timezone: catalog.facility.timezone,
      slots: [],
    }
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

  const expertNames = new Map(catalog.experts.map(expert => [expert.userId, expert.name]))
  async function loadExpertSlots(startsOn: string, endsOn: string) {
    const { data, error } = await dataApi.rpc('get_booking_widget_slots', {
      p_widget_token: widgetKey,
      p_service_id: serviceId,
      p_starts_on: startsOn,
      p_ends_on: endsOn,
      p_expert_user_id: expertUserId,
    })
    throwBookingError(error)
    return (Array.isArray(data) ? data : []).flatMap((input) => {
      const row = bookingRecord(input)
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
  }

  const initialEndDate = findNextAvailable
    ? addDaysToIsoDate(date, NEXT_AVAILABLE_SLOT_SEARCH_DAYS)
    : requestedRange.endDate
  let expertSlots = await loadExpertSlots(date, initialEndDate)
  const resolvedDate = findNextAvailable && expertSlots[0]
    ? isoDateForTimestamp(expertSlots[0].startsAt, catalog.facility.timezone)
    : date
  const resolvedRange = bookingDateRange(resolvedDate, days)
  if (findNextAvailable && expertSlots.length > 0 && resolvedRange.endDate > initialEndDate) {
    expertSlots = await loadExpertSlots(resolvedRange.date, resolvedRange.endDate)
  }
  const rangedExpertSlots = expertSlots.filter((slot) => {
    const slotDate = isoDateForTimestamp(slot.startsAt, catalog.facility.timezone)
    return slotDate >= resolvedRange.date && slotDate <= resolvedRange.endDate
  })
  const aggregateExperts = !catalog.widget.fixedExpertUserId && (
    catalog.widget.bookingMode === 'facility'
    || (catalog.widget.bookingMode === 'both' && !requestedExpertUserId)
  )
  const slots = aggregateExperts
    ? [...new Map(rangedExpertSlots.map(slot => [
        `${slot.startsAt}/${slot.endsAt}`,
        { ...slot, expertUserId: '', expertName: 'Dowolny dostępny ekspert' },
      ])).values()]
    : rangedExpertSlots
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
  return {
    date: resolvedRange.date,
    endDate: resolvedRange.endDate,
    timezone: catalog.facility.timezone,
    slots,
  }
})
