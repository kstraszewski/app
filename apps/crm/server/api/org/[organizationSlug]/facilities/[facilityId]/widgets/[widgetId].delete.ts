import { requireCrmSession, throwDbError } from '~~/server/utils/crm'
import { requireFacilityPermission, uuidValue } from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const access = await requireFacilityPermission(session, getRouterParam(event, 'facilityId'), 'view')
  const widgetId = uuidValue(getRouterParam(event, 'widgetId'), 'widgetId')
  const { data: existing, error: existingError } = await session.dataApi
    .from('booking_widgets')
    .select('id, fixed_expert_user_id')
    .eq('organization_id', session.organizationId)
    .eq('facility_id', access.facility.id)
    .eq('id', widgetId)
    .maybeSingle()
  throwDbError(existingError)
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Booking widget not found' })

  const isSelfServiceExpert = !access.canManage
  if (isSelfServiceExpert) {
    const { data: membership, error: membershipError } = await session.dataApi
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

  let deleteQuery = session.dataApi
    .from('booking_widgets')
    .delete()
    .eq('organization_id', session.organizationId)
    .eq('facility_id', access.facility.id)
    .eq('id', widgetId)
  if (isSelfServiceExpert) {
    deleteQuery = deleteQuery.eq('fixed_expert_user_id', session.userId)
  }
  const { data, error } = await deleteQuery
    .select('id')
    .maybeSingle()
  throwDbError(error)
  if (!data) throw createError({ statusCode: 404, statusMessage: 'Booking widget not found' })
  return { ok: true }
})
