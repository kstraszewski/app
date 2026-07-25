import { requireCrmSession } from '~~/server/utils/crm'
import {
  facilityImageLimit,
  listSignedFacilityImages,
} from '~~/server/utils/facility-images'
import { requireFacilityPermission } from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const access = await requireFacilityPermission(session, getRouterParam(event, 'facilityId'), 'view')
  const data = await listSignedFacilityImages(session, String(access.facility.id))

  return {
    data,
    limit: facilityImageLimit,
  }
})
