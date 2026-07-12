import { readBody } from 'h3'
import { asRecord, requireCrmSession, throwDbError } from '~~/server/utils/crm'
import {
  assertFacilityBookableMemberIds,
  bookingServiceValues,
  booleanValue,
  requireFacilityPermission,
  uuidArrayValue,
  uuidValue,
} from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const access = await requireFacilityPermission(session, getRouterParam(event, 'facilityId'), 'manage')
  const serviceId = uuidValue(getRouterParam(event, 'serviceId'), 'serviceId')
  const body = asRecord(await readBody(event))

  const { data: link, error: linkError } = await session.supabase
    .from('facility_services')
    .select('*')
    .eq('organization_id', session.organizationId)
    .eq('facility_id', access.facility.id)
    .eq('service_id', serviceId)
    .maybeSingle()
  throwDbError(linkError)
  if (!link) throw createError({ statusCode: 404, statusMessage: 'Facility service not found' })

  const serviceFieldNames = [
    'name', 'slug', 'description', 'durationMinutes', 'duration_minutes',
    'bufferBeforeMinutes', 'buffer_before_minutes', 'bufferAfterMinutes', 'buffer_after_minutes',
    'slotIntervalMinutes', 'slot_interval_minutes', 'minNoticeMinutes', 'min_notice_minutes',
    'maxAdvanceDays', 'max_advance_days', 'isActive', 'is_active',
  ]
  const updatesGlobalService = serviceFieldNames.some(field => field in body)
  if (updatesGlobalService && session.role !== 'admin') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Organization admin required to edit shared service details',
    })
  }

  const servicePatch = updatesGlobalService
    ? bookingServiceValues(body, { create: false })
    : {}

  let isAvailable = Boolean(link.is_active)
  const updatesAvailability = 'isAvailable' in body || 'is_available' in body
  if (updatesAvailability) {
    isAvailable = booleanValue(body.isAvailable ?? body.is_available, 'isAvailable')
  }

  let expertUserIds: string[] | null = null
  const updatesExperts = 'expertUserIds' in body || 'expert_user_ids' in body
  if (updatesExperts) {
    expertUserIds = uuidArrayValue(body.expertUserIds ?? body.expert_user_ids, 'expertUserIds')
    await assertFacilityBookableMemberIds(session, access.facility.id, expertUserIds)
  }

  const { error: updateError } = await session.supabase.rpc('update_facility_service_configuration', {
    p_organization_id: session.organizationId,
    p_facility_id: access.facility.id,
    p_service_id: serviceId,
    p_service_patch: servicePatch,
    p_update_availability: updatesAvailability,
    p_is_available: isAvailable,
    p_update_experts: updatesExperts,
    p_expert_user_ids: expertUserIds ?? [],
  })
  throwDbError(updateError)

  const { data: service, error: serviceError } = await session.supabase
    .from('booking_services')
    .select('*')
    .eq('organization_id', session.organizationId)
    .eq('id', serviceId)
    .single()
  throwDbError(serviceError, 404)
  if (!expertUserIds) {
    const { data, error } = await session.supabase
      .from('facility_service_experts')
      .select('user_id')
      .eq('organization_id', session.organizationId)
      .eq('facility_id', access.facility.id)
      .eq('service_id', serviceId)
      .eq('is_active', true)
    throwDbError(error)
    expertUserIds = (data ?? []).map((row: any) => String(row.user_id))
  }
  return { data: { ...service, isAvailable, expertUserIds } }
})
