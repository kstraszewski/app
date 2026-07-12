import { requireCrmSession } from '~~/server/utils/crm'
import { requireFacilityPermission } from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const access = await requireFacilityPermission(session, getRouterParam(event, 'facilityId'), 'view')

  return {
    data: access.facility,
    access: {
      source: access.source,
      role: access.role,
      canManage: access.canManage,
    },
  }
})
