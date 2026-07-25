import { readBody } from 'h3'
import { asRecord, requireCrmSession, throwDbError } from '~~/server/utils/crm'
import {
  assertBookingWidgetDirectoryEligibility,
  assertFacilityBookableMemberIds,
  bookingWidgetValues,
  decorateBookingWidget,
  requireFacilityPermission,
  uuidArrayValue,
} from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const access = await requireFacilityPermission(session, getRouterParam(event, 'facilityId'), 'view')
  const body = asRecord(await readBody(event))
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
    if (!membership) {
      throw createError({ statusCode: 403, statusMessage: 'Bookable facility expert required' })
    }
  }

  const widgetValues = bookingWidgetValues(body, {
    create: true,
    facilityName: String(access.facility.name),
  })
  assertBookingWidgetDirectoryEligibility({
    isActive: Boolean(widgetValues.is_active),
    isDirectoryListed: Boolean(widgetValues.is_directory_listed),
    widgetType: widgetValues.widget_type as 'calendar' | 'mortgage_capacity' | 'mortgage_payment',
  })
  const requestedFixedExpertUserId = widgetValues.fixed_expert_user_id as string | null
  const fixedExpertUserId = isSelfServiceExpert
    ? session.userId
    : requestedFixedExpertUserId
  if (fixedExpertUserId) {
    if (!isSelfServiceExpert) {
      await assertFacilityBookableMemberIds(session, access.facility.id, [fixedExpertUserId])
    }
    widgetValues.fixed_expert_user_id = fixedExpertUserId
    widgetValues.booking_mode = 'expert'
  }

  const serviceIds = body.serviceIds === undefined && body.service_ids === undefined
    ? []
    : uuidArrayValue(body.serviceIds ?? body.service_ids, 'serviceIds')
  if (!serviceIds.length) {
    throw createError({ statusCode: 400, statusMessage: 'At least one service is required for a booking widget' })
  }
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

  const { data: widget, error } = await session.supabase
    .from('booking_widgets')
    .insert({
      organization_id: session.organizationId,
      facility_id: access.facility.id,
      ...widgetValues,
      created_by_user_id: session.userId,
    })
    .select('*')
    .single()
  throwDbError(error)

  if (serviceIds.length) {
    const { error: linksError } = await session.supabase.from('booking_widget_services').insert(
      serviceIds.map(serviceId => ({
        organization_id: session.organizationId,
        facility_id: access.facility.id,
        widget_id: widget.id,
        service_id: serviceId,
      })),
    )
    if (linksError) {
      await session.supabase
        .from('booking_widgets')
        .delete()
        .eq('organization_id', session.organizationId)
        .eq('id', widget.id)
      throwDbError(linksError)
    }
  }

  return { data: decorateBookingWidget(event, widget, serviceIds) }
})
