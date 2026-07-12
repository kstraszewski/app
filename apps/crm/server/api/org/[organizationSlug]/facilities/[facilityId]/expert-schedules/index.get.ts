import { getQuery } from 'h3'
import { requireCrmSession, throwDbError } from '~~/server/utils/crm'
import {
  optionalUuidValue,
  requireFacilityPermission,
} from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const access = await requireFacilityPermission(session, getRouterParam(event, 'facilityId'), 'view')
  const query = getQuery(event)
  const userId = optionalUuidValue(query.userId ?? query.user_id, 'userId')

  let rulesRequest = session.supabase
    .from('expert_availability_rules')
    .select('*')
    .eq('organization_id', session.organizationId)
    .eq('facility_id', access.facility.id)
    .order('user_id')
    .order('weekday')
    .order('starts_at')
  let overridesRequest = session.supabase
    .from('expert_availability_overrides')
    .select('*')
    .eq('organization_id', session.organizationId)
    .eq('facility_id', access.facility.id)
    .order('user_id')
    .order('local_date')
  if (userId) {
    rulesRequest = rulesRequest.eq('user_id', userId)
    overridesRequest = overridesRequest.eq('user_id', userId)
  }

  const [rulesResult, overridesResult] = await Promise.all([rulesRequest, overridesRequest])
  throwDbError(rulesResult.error)
  throwDbError(overridesResult.error)
  return {
    rules: rulesResult.data ?? [],
    overrides: overridesResult.data ?? [],
  }
})
