import { readBody } from 'h3'
import {
  asRecord,
  requireAdministrativePermission,
  requireCrmSession,
  throwDbError,
} from '~~/server/utils/crm'
import {
  assertFacilityBookableMemberIds,
  bookingServiceValues,
  booleanValue,
  optionalUuidValue,
  requireFacilityPermission,
  uuidArrayValue,
} from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const access = await requireFacilityPermission(session, getRouterParam(event, 'facilityId'), 'manage')
  const body = asRecord(await readBody(event))
  const existingServiceId = optionalUuidValue(body.serviceId ?? body.service_id, 'serviceId')
  const expertUserIds = body.expertUserIds === undefined && body.expert_user_ids === undefined
    ? []
    : uuidArrayValue(body.expertUserIds ?? body.expert_user_ids, 'expertUserIds')
  await assertFacilityBookableMemberIds(session, access.facility.id, expertUserIds)

  let service: any
  let createdServiceId: string | null = null
  if (existingServiceId) {
    const { data, error } = await session.supabase
      .from('booking_services')
      .select('*')
      .eq('organization_id', session.organizationId)
      .eq('id', existingServiceId)
      .maybeSingle()
    throwDbError(error)
    if (!data) throw createError({ statusCode: 404, statusMessage: 'Booking service not found' })
    service = data
  } else {
    await requireAdministrativePermission(session, 'structure.manage')
    const { data, error } = await session.supabase
      .from('booking_services')
      .insert({
        organization_id: session.organizationId,
        ...bookingServiceValues(body, { create: true }),
      })
      .select('*')
      .single()
    throwDbError(error)
    service = data
    createdServiceId = String(data.id)
  }

  const isAvailable = body.isAvailable === undefined && body.is_available === undefined
    ? true
    : booleanValue(body.isAvailable ?? body.is_available, 'isAvailable')
  const linkResult = await session.supabase
    .from('facility_services')
    .upsert({
      organization_id: session.organizationId,
      facility_id: access.facility.id,
      service_id: service.id,
      is_active: isAvailable,
    }, { onConflict: 'organization_id,facility_id,service_id' })
    .select('*')
    .single()
  if (linkResult.error) {
    if (createdServiceId) {
      await session.supabase
        .from('booking_services')
        .delete()
        .eq('organization_id', session.organizationId)
        .eq('id', createdServiceId)
    }
    throwDbError(linkResult.error)
  }

  if (expertUserIds.length) {
    const { error } = await session.supabase.from('facility_service_experts').insert(
      expertUserIds.map(userId => ({
        organization_id: session.organizationId,
        facility_id: access.facility.id,
        service_id: service.id,
        user_id: userId,
        is_active: true,
      })),
    )
    if (error) {
      await session.supabase
        .from('facility_services')
        .delete()
        .eq('organization_id', session.organizationId)
        .eq('facility_id', access.facility.id)
        .eq('service_id', service.id)
      if (createdServiceId) {
        await session.supabase
          .from('booking_services')
          .delete()
          .eq('organization_id', session.organizationId)
          .eq('id', createdServiceId)
      }
      throwDbError(error)
    }
  }

  return {
    data: {
      ...service,
      isAvailable,
      expertUserIds,
    },
  }
})
