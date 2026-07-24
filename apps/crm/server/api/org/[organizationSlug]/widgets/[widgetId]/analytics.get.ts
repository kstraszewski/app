import { getQuery, setHeader } from 'h3'
import { asRecord, requireCrmSession, throwDbError } from '~~/server/utils/crm'
import { uuidValue } from '~~/server/utils/scheduling'

const allowedRanges = new Set([7, 30, 90])

function localDate(timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function subtractDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const widgetId = uuidValue(getRouterParam(event, 'widgetId'), 'widgetId')
  const requestedDays = Number(getQuery(event).days ?? 30)
  const days = allowedRanges.has(requestedDays) ? requestedDays as 7 | 30 | 90 : 30

  const { data: widget, error: widgetError } = await session.supabase
    .from('booking_widgets')
    .select('id, facility_id')
    .eq('organization_id', session.organizationId)
    .eq('id', widgetId)
    .eq('fixed_expert_user_id', session.userId)
    .maybeSingle()
  throwDbError(widgetError)
  if (!widget) {
    throw createError({ statusCode: 404, statusMessage: 'Booking widget not found' })
  }

  const { data: facility, error: facilityError } = await session.supabase
    .from('facilities')
    .select('timezone')
    .eq('organization_id', session.organizationId)
    .eq('id', widget.facility_id)
    .maybeSingle()
  throwDbError(facilityError)
  if (!facility) {
    throw createError({ statusCode: 404, statusMessage: 'Widget facility not found' })
  }

  const to = localDate(String(facility.timezone || 'Europe/Warsaw'))
  const from = subtractDays(to, days - 1)
  const { data, error } = await session.supabase.rpc('get_booking_widget_analytics', {
    p_organization_id: session.organizationId,
    p_widget_id: widgetId,
    p_from: from,
    p_to: to,
  })
  throwDbError(error)

  setHeader(event, 'Cache-Control', 'no-store')
  return { days, data: asRecord(data) }
})
