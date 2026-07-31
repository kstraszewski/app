import { requireCrmSession, throwDbError } from '~~/server/utils/crm'
import {
  createBookingWidgetPreviewToken,
  decorateBookingWidget,
  uuidValue,
} from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const widgetId = uuidValue(getRouterParam(event, 'widgetId'), 'widgetId')

  const { data: widget, error: widgetError } = await session.dataApi
    .from('booking_widgets')
    .select('*')
    .eq('organization_id', session.organizationId)
    .eq('id', widgetId)
    .eq('fixed_expert_user_id', session.userId)
    .maybeSingle()
  throwDbError(widgetError)
  if (!widget) {
    throw createError({ statusCode: 404, statusMessage: 'Booking widget not found' })
  }

  const facilityId = String(widget.facility_id)
  const [
    facilityResult,
    facilityServicesResult,
    expertServicesResult,
    servicesResult,
    widgetServicesResult,
  ] = await Promise.all([
    session.dataApi
      .from('facilities')
      .select('id, organization_id, name, slug, description, timezone, address_line1, address_line2, postal_code, city, country_code, phone, email, is_active, created_at, updated_at')
      .eq('organization_id', session.organizationId)
      .eq('id', facilityId)
      .maybeSingle(),
    session.dataApi
      .from('facility_services')
      .select('service_id, is_active')
      .eq('organization_id', session.organizationId)
      .eq('facility_id', facilityId)
      .eq('is_active', true),
    session.dataApi
      .from('facility_service_experts')
      .select('service_id, is_active')
      .eq('organization_id', session.organizationId)
      .eq('facility_id', facilityId)
      .eq('user_id', session.userId)
      .eq('is_active', true),
    session.dataApi
      .from('booking_services')
      .select('*')
      .eq('organization_id', session.organizationId)
      .eq('is_active', true)
      .order('name'),
    session.dataApi
      .from('booking_widget_services')
      .select('service_id')
      .eq('organization_id', session.organizationId)
      .eq('facility_id', facilityId)
      .eq('widget_id', widgetId),
  ])

  for (const result of [
    facilityResult,
    facilityServicesResult,
    expertServicesResult,
    servicesResult,
    widgetServicesResult,
  ]) throwDbError(result.error)

  if (!facilityResult.data) {
    throw createError({ statusCode: 404, statusMessage: 'Widget facility not found' })
  }

  const facilityServiceIds = new Set(
    (facilityServicesResult.data ?? []).map((row: any) => String(row.service_id)),
  )
  const expertServiceIds = new Set(
    (expertServicesResult.data ?? []).map((row: any) => String(row.service_id)),
  )
  const services = (servicesResult.data ?? [])
    .filter((service: any) => (
      facilityServiceIds.has(String(service.id))
      && expertServiceIds.has(String(service.id))
    ))
    .map((service: any) => ({
      ...service,
      isAvailable: true,
      expertUserIds: [session.userId],
    }))
  const allowedServiceIds = new Set(services.map((service: any) => String(service.id)))
  const serviceIds = (widgetServicesResult.data ?? [])
    .map((row: any) => String(row.service_id))
    .filter((serviceId: string) => allowedServiceIds.has(serviceId))

  return {
    currentUserId: session.userId,
    facility: facilityResult.data,
    services,
    previewToken: createBookingWidgetPreviewToken(event, String(widget.public_token)),
    widget: decorateBookingWidget(event, widget, serviceIds),
  }
})
