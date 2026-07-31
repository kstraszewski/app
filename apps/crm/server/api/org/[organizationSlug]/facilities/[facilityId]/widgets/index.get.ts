import { requireCrmSession, throwDbError } from '~~/server/utils/crm'
import {
  decorateBookingWidget,
  requireFacilityPermission,
} from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const access = await requireFacilityPermission(session, getRouterParam(event, 'facilityId'), 'view')
  const [widgetsResult, servicesResult] = await Promise.all([
    session.dataApi
      .from('booking_widgets')
      .select('*')
      .eq('organization_id', session.organizationId)
      .eq('facility_id', access.facility.id)
      .order('created_at'),
    session.dataApi
      .from('booking_widget_services')
      .select('widget_id, service_id')
      .eq('organization_id', session.organizationId)
      .eq('facility_id', access.facility.id),
  ])
  throwDbError(widgetsResult.error)
  throwDbError(servicesResult.error)

  const servicesByWidget = new Map<string, string[]>()
  for (const link of servicesResult.data ?? []) {
    const widgetId = String(link.widget_id)
    servicesByWidget.set(widgetId, [...(servicesByWidget.get(widgetId) ?? []), String(link.service_id)])
  }
  return {
    data: (widgetsResult.data ?? []).map((widget: any) => decorateBookingWidget(
      event,
      widget,
      servicesByWidget.get(String(widget.id)) ?? [],
    )),
  }
})
