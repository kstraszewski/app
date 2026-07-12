import { readBody } from 'h3'
import { asRecord, requireCrmSession, throwDbError } from '~~/server/utils/crm'
import {
  bookingWidgetValues,
  decorateBookingWidget,
  requireFacilityPermission,
  uuidArrayValue,
  uuidValue,
} from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const access = await requireFacilityPermission(session, getRouterParam(event, 'facilityId'), 'view')
  const widgetId = uuidValue(getRouterParam(event, 'widgetId'), 'widgetId')
  const body = asRecord(await readBody(event))
  const { data: existing, error: existingError } = await session.supabase
    .from('booking_widgets')
    .select('*')
    .eq('organization_id', session.organizationId)
    .eq('facility_id', access.facility.id)
    .eq('id', widgetId)
    .maybeSingle()
  throwDbError(existingError)
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Booking widget not found' })

  const isSelfServiceExpert = !access.canManage
  if (isSelfServiceExpert) {
    const { data: membership, error: membershipError } = await session.supabase
      .from('facility_memberships')
      .select('user_id')
      .eq('organization_id', session.organizationId)
      .eq('facility_id', access.facility.id)
      .eq('user_id', session.userId)
      .eq('is_bookable', true)
      .maybeSingle()
    throwDbError(membershipError)
    if (!membership || String(existing.fixed_expert_user_id ?? '') !== session.userId) {
      throw createError({ statusCode: 403, statusMessage: 'Only the fixed expert can manage this widget' })
    }
  }

  if ('fixedExpertUserId' in body || 'fixed_expert_user_id' in body) {
    throw createError({
      statusCode: 400,
      statusMessage: 'The fixed widget expert cannot be changed after creation',
    })
  }

  const patch = bookingWidgetValues(body, { create: false, facilityName: String(access.facility.name) })
  const hasServiceIds = 'serviceIds' in body || 'service_ids' in body
  if (!Object.keys(patch).length && !hasServiceIds) {
    throw createError({ statusCode: 400, statusMessage: 'No supported widget fields provided' })
  }
  if (existing.fixed_expert_user_id) patch.booking_mode = 'expert'

  let serviceIds: string[] | null = null
  if (hasServiceIds) {
    serviceIds = uuidArrayValue(body.serviceIds ?? body.service_ids, 'serviceIds')
    if (serviceIds.length) {
      const { data, error } = await session.supabase
        .from('facility_services')
        .select('service_id')
        .eq('organization_id', session.organizationId)
        .eq('facility_id', access.facility.id)
        .eq('is_active', true)
        .in('service_id', serviceIds)
      throwDbError(error)
      const found = new Set((data ?? []).map((row: any) => String(row.service_id)))
      if (serviceIds.some(serviceId => !found.has(serviceId))) {
        throw createError({ statusCode: 400, statusMessage: 'A selected service is not active at this facility' })
      }
    }
    const fixedExpertUserId = existing.fixed_expert_user_id
      ? String(existing.fixed_expert_user_id)
      : null
    if (fixedExpertUserId && serviceIds.length) {
      const { data, error } = await session.supabase
        .from('facility_service_experts')
        .select('service_id')
        .eq('organization_id', session.organizationId)
        .eq('facility_id', access.facility.id)
        .eq('user_id', fixedExpertUserId)
        .eq('is_active', true)
        .in('service_id', serviceIds)
      throwDbError(error)
      const assigned = new Set((data ?? []).map((row: any) => String(row.service_id)))
      if (serviceIds.some(serviceId => !assigned.has(serviceId))) {
        throw createError({ statusCode: 400, statusMessage: 'A selected service is not assigned to the fixed expert' })
      }
    }
  }

  const { error: updateError } = await session.supabase.rpc('update_booking_widget_configuration', {
    p_organization_id: session.organizationId,
    p_facility_id: access.facility.id,
    p_widget_id: widgetId,
    p_widget_patch: patch,
    p_update_services: hasServiceIds,
    p_service_ids: serviceIds ?? [],
  })
  throwDbError(updateError)

  const [widgetResult, servicesResult] = await Promise.all([
    session.supabase
      .from('booking_widgets')
      .select('*')
      .eq('organization_id', session.organizationId)
      .eq('facility_id', access.facility.id)
      .eq('id', widgetId)
      .single(),
    session.supabase
      .from('booking_widget_services')
      .select('service_id')
      .eq('organization_id', session.organizationId)
      .eq('facility_id', access.facility.id)
      .eq('widget_id', widgetId),
  ])
  throwDbError(widgetResult.error, 404)
  throwDbError(servicesResult.error)
  const widget = widgetResult.data
  serviceIds = (servicesResult.data ?? []).map((row: any) => String(row.service_id))

  return { data: decorateBookingWidget(event, widget, serviceIds ?? []) }
})
