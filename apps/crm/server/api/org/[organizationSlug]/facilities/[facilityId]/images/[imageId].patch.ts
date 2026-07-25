import { serverSupabaseServiceRole } from '#supabase/server'
import { readBody } from 'h3'
import { asRecord, requireCrmSession, throwDbError } from '~~/server/utils/crm'
import { requireFacilityPermission, uuidValue } from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const access = await requireFacilityPermission(
    session,
    getRouterParam(event, 'facilityId'),
    'manage',
  )
  const imageId = uuidValue(getRouterParam(event, 'imageId'), 'imageId')
  const body = asRecord(await readBody(event))
  if (body.isCover !== true) {
    throw createError({
      statusCode: 400,
      statusMessage: 'isCover must be true',
    })
  }

  // The service-role client is created only after the scoped manage check.
  // The RPC itself is transactional, so concurrent cover changes cannot leave
  // duplicate or partial sort ordering behind.
  const serviceRole = serverSupabaseServiceRole(event)
  const { error } = await serviceRole.rpc('set_facility_cover_image', {
    p_organization_id: session.organizationId,
    p_facility_id: String(access.facility.id),
    p_image_id: imageId,
  })
  if (error?.code === 'P0002' || error?.message?.includes('facility_image_not_found')) {
    throw createError({ statusCode: 404, statusMessage: 'Facility image not found' })
  }
  throwDbError(error)

  return { updated: true }
})
