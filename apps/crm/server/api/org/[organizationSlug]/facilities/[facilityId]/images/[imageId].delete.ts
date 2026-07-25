import { serverSupabaseServiceRole } from '#supabase/server'
import { requireCrmSession, throwDbError } from '~~/server/utils/crm'
import { requireFacilityPermission, uuidValue } from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const access = await requireFacilityPermission(session, getRouterParam(event, 'facilityId'), 'manage')
  const imageId = uuidValue(getRouterParam(event, 'imageId'), 'imageId')
  const serviceRole = serverSupabaseServiceRole(event) as any

  const imageResult = await session.supabase
    .from('facility_images')
    .select('id, storage_bucket, storage_path')
    .eq('organization_id', session.organizationId)
    .eq('facility_id', String(access.facility.id))
    .eq('id', imageId)
    .maybeSingle()
  throwDbError(imageResult.error)
  if (!imageResult.data) {
    throw createError({ statusCode: 404, statusMessage: 'Facility image not found' })
  }

  const deleteResult = await serviceRole
    .from('facility_images')
    .delete()
    .eq('organization_id', session.organizationId)
    .eq('facility_id', String(access.facility.id))
    .eq('id', imageId)
  throwDbError(deleteResult.error)

  const { error: removeError } = await serviceRole.storage
    .from(String(imageResult.data.storage_bucket))
    .remove([String(imageResult.data.storage_path)])
  if (removeError) {
    console.warn('[facility-images] failed to remove image object', {
      imageId,
      message: removeError.message,
    })
  }

  return { removed: true }
})
