import { serverSupabaseServiceRole } from '#supabase/server'
import { readBody } from 'h3'
import { asRecord, requireCrmSession, throwDbError } from '~~/server/utils/crm'
import {
  assertBookingWidgetDirectoryEligibility,
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
  const hasDirectoryListing = 'isDirectoryListed' in body || 'is_directory_listed' in body
  const requestedDirectoryListing = hasDirectoryListing
    ? Boolean(patch.is_directory_listed)
    : Boolean(
        existing.is_directory_listed
        && existing.is_active
        && existing.widget_type === 'calendar',
      )
  delete patch.is_directory_listed

  if (!Object.keys(patch).length && !hasServiceIds && !hasDirectoryListing) {
    throw createError({ statusCode: 400, statusMessage: 'No supported widget fields provided' })
  }
  if (existing.fixed_expert_user_id) patch.booking_mode = 'expert'

  const effectiveIsActive = patch.is_active === undefined
    ? Boolean(existing.is_active)
    : Boolean(patch.is_active)
  const effectiveWidgetType = String(
    patch.widget_type ?? existing.widget_type ?? 'calendar',
  ) as 'calendar' | 'mortgage_capacity' | 'mortgage_payment'
  const directoryEligible = effectiveIsActive && effectiveWidgetType === 'calendar'
  if (hasDirectoryListing && requestedDirectoryListing) {
    assertBookingWidgetDirectoryEligibility({
      isActive: effectiveIsActive,
      isDirectoryListed: true,
      widgetType: effectiveWidgetType,
    })
  }

  let directoryListingUpdate: boolean | null = hasDirectoryListing
    ? requestedDirectoryListing
    : null
  if (!directoryEligible && Boolean(existing.is_directory_listed)) {
    directoryListingUpdate = false
  } else if (
    !hasDirectoryListing
    && !Boolean(existing.is_active)
    && Boolean(existing.is_directory_listed)
    && patch.is_active === true
  ) {
    // Do not silently restore a stale legacy listing when a widget is re-enabled.
    directoryListingUpdate = false
  }

  // This is deliberately created only after the organization/facility scope
  // and either admin access or fixed-expert ownership plus bookable membership
  // checks above have passed.
  // The authenticated RLS write path also requires fixed experts to have
  // created the widget themselves, while this endpoint already permits them
  // to manage an admin-created widget assigned permanently to their profile.
  const updateDirectoryListing = async (isDirectoryListed: boolean) => {
    const serviceRole = serverSupabaseServiceRole(event) as any
    const { data, error } = await serviceRole
      .from('booking_widgets')
      .update({ is_directory_listed: isDirectoryListed })
      .eq('organization_id', session.organizationId)
      .eq('facility_id', access.facility.id)
      .eq('id', widgetId)
      .select('id')
      .maybeSingle()
    throwDbError(error)
    if (!data) {
      throw createError({ statusCode: 404, statusMessage: 'Booking widget not found' })
    }
  }

  const disableDirectoryBeforeConfigurationUpdate = (
    directoryListingUpdate === false
    && Boolean(existing.is_directory_listed)
  )
  if (disableDirectoryBeforeConfigurationUpdate) {
    // Privacy-safe ordering ensures an explicit opt-out takes effect even if
    // another requested configuration change is later rejected.
    await updateDirectoryListing(false)
  }

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

  if (
    directoryListingUpdate !== null
    && !disableDirectoryBeforeConfigurationUpdate
    && directoryListingUpdate !== Boolean(existing.is_directory_listed)
  ) {
    await updateDirectoryListing(directoryListingUpdate)
  }

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
