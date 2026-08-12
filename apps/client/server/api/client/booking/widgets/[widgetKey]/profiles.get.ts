import { setHeader } from 'h3'
import { bookingProfilesForOrganization } from '~~/server/utils/booking-profiles'
import { publicWidgetKey } from '~~/server/utils/booking-public'
import { serverDataBackend } from '~~/server/utils/data-api'
import { loadClientPortalSession } from '~~/server/utils/portal-auth'
import { throwBookingError } from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const widgetKey = publicWidgetKey(getRouterParam(event, 'widgetKey'))
  const session = await loadClientPortalSession(event)
  const backend = serverDataBackend(event) as any
  const widgetResult = await backend
    .from('booking_widgets')
    .select('organization_id')
    .eq('public_token', widgetKey)
    .eq('is_active', true)
    .maybeSingle()
  throwBookingError(widgetResult.error)
  if (!widgetResult.data?.organization_id) {
    throw createError({ statusCode: 404, statusMessage: 'Booking widget not found' })
  }

  return {
    profiles: bookingProfilesForOrganization(
      session.links,
      String(widgetResult.data.organization_id),
    ),
  }
})
