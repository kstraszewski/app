import { serverSupabaseServiceRole } from '#supabase/server'
import { readBody, setHeader } from 'h3'
import { asRecord, requireCrmSession, throwDbError } from '~~/server/utils/crm'
import { optionalUuidValue, requireFacilityPermission } from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const body = asRecord(await readBody(event))
  if (!('defaultFacilityId' in body) && !('default_facility_id' in body)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'defaultFacilityId is required',
    })
  }

  const defaultFacilityId = optionalUuidValue(
    body.defaultFacilityId ?? body.default_facility_id,
    'defaultFacilityId',
  )
  if (defaultFacilityId) {
    const access = await requireFacilityPermission(session, defaultFacilityId, 'view')
    if (access.facility.is_active !== true) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Default facility must be active',
      })
    }
  }

  const serviceRole = serverSupabaseServiceRole(event) as any
  const { data: preferences, error } = await serviceRole
    .from('organization_user_preferences')
    .upsert({
      organization_id: session.organizationId,
      user_id: session.userId,
      default_facility_id: defaultFacilityId,
    }, { onConflict: 'organization_id,user_id' })
    .select('default_facility_id')
    .single()
  throwDbError(error)
  setHeader(event, 'Cache-Control', 'private, no-store')

  return {
    defaultFacilityId: preferences?.default_facility_id
      ? String(preferences.default_facility_id)
      : null,
  }
})
