import { requireCrmSession, throwDbError } from '~~/server/utils/crm'
import { decorateBookingWidget, ensureGenericMeetingService } from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const { data: memberships, error: membershipsError } = await session.supabase
    .from('facility_memberships')
    .select('facility_id')
    .eq('organization_id', session.organizationId)
    .eq('user_id', session.userId)
    .eq('is_bookable', true)
  throwDbError(membershipsError)

  const facilityIds = Array.from(new Set<string>(
    (memberships ?? []).map((row: any) => String(row.facility_id)),
  ))
  if (!facilityIds.length) {
    return { currentUserId: session.userId, data: [] }
  }

  await Promise.all(facilityIds.map(facilityId => (
    ensureGenericMeetingService(event, session.organizationId, facilityId)
  )))

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000).toISOString()
  const [
    facilitiesResult,
    facilityServicesResult,
    expertServicesResult,
    servicesResult,
    widgetsResult,
    widgetServicesResult,
    bookingCountsResult,
  ]
    = await Promise.all([
      session.supabase
        .from('facilities')
        .select('id, organization_id, name, slug, description, timezone, address_line1, address_line2, postal_code, city, country_code, phone, email, is_active, created_at, updated_at')
        .eq('organization_id', session.organizationId)
        .eq('is_active', true)
        .in('id', facilityIds)
        .order('name'),
      session.supabase
        .from('facility_services')
        .select('facility_id, service_id, is_active')
        .eq('organization_id', session.organizationId)
        .eq('is_active', true)
        .in('facility_id', facilityIds),
      session.supabase
        .from('facility_service_experts')
        .select('facility_id, service_id, user_id, is_active')
        .eq('organization_id', session.organizationId)
        .eq('user_id', session.userId)
        .eq('is_active', true)
        .in('facility_id', facilityIds),
      session.supabase
        .from('booking_services')
        .select('*')
        .eq('organization_id', session.organizationId)
        .eq('is_active', true)
        .order('name'),
      session.supabase
        .from('booking_widgets')
        .select('*')
        .eq('organization_id', session.organizationId)
        .eq('fixed_expert_user_id', session.userId)
        .in('facility_id', facilityIds)
        .order('created_at', { ascending: false }),
      session.supabase
        .from('booking_widget_services')
        .select('facility_id, widget_id, service_id')
        .eq('organization_id', session.organizationId)
        .in('facility_id', facilityIds),
      session.supabase.rpc('get_personal_booking_widget_counts', {
        p_organization_id: session.organizationId,
        p_expert_user_id: session.userId,
        p_since: thirtyDaysAgo,
      }),
    ])

  for (const result of [
    facilitiesResult,
    facilityServicesResult,
    expertServicesResult,
    servicesResult,
    widgetsResult,
    widgetServicesResult,
    bookingCountsResult,
  ]) throwDbError(result.error)

  const activeFacilityServiceKeys = new Set((facilityServicesResult.data ?? []).map((link: any) => (
    `${String(link.facility_id)}:${String(link.service_id)}`
  )))
  const assignedServiceIdsByFacility = new Map<string, Set<string>>()
  for (const assignment of expertServicesResult.data ?? []) {
    const facilityId = String(assignment.facility_id)
    const serviceId = String(assignment.service_id)
    if (!activeFacilityServiceKeys.has(`${facilityId}:${serviceId}`)) continue
    const assigned = assignedServiceIdsByFacility.get(facilityId) ?? new Set<string>()
    assigned.add(serviceId)
    assignedServiceIdsByFacility.set(facilityId, assigned)
  }

  const servicesById = new Map<string, Record<string, any>>(
    (servicesResult.data ?? []).map((service: any) => [String(service.id), service]),
  )
  const serviceIdsByWidget = new Map<string, string[]>()
  for (const link of widgetServicesResult.data ?? []) {
    const widgetId = String(link.widget_id)
    serviceIdsByWidget.set(widgetId, [
      ...(serviceIdsByWidget.get(widgetId) ?? []),
      String(link.service_id),
    ])
  }

  const bookings30DaysByWidget = new Map<string, number>()
  for (const count of bookingCountsResult.data ?? []) {
    bookings30DaysByWidget.set(String(count.widget_id), Number(count.bookings ?? 0))
  }

  const widgetsByFacility = new Map<string, Record<string, any>[]>()
  for (const widget of widgetsResult.data ?? []) {
    const facilityId = String(widget.facility_id)
    const widgetId = String(widget.id)
    widgetsByFacility.set(facilityId, [
      ...(widgetsByFacility.get(facilityId) ?? []),
      {
        ...decorateBookingWidget(event, widget, serviceIdsByWidget.get(widgetId) ?? []),
        bookings30Days: bookings30DaysByWidget.get(widgetId) ?? 0,
      },
    ])
  }

  return {
    currentUserId: session.userId,
    data: (facilitiesResult.data ?? []).map((facility: any) => {
      const facilityId = String(facility.id)
      const assignedServiceIds = assignedServiceIdsByFacility.get(facilityId) ?? new Set<string>()
      return {
        facility,
        services: [...assignedServiceIds]
          .map(serviceId => servicesById.get(serviceId))
          .filter(Boolean)
          .map(service => ({
            ...service,
            isAvailable: true,
            expertUserIds: [session.userId],
          })),
        widgets: widgetsByFacility.get(facilityId) ?? [],
      }
    }),
  }
})
