import { readBody } from 'h3'
import { asRecord, requireCrmSession, throwDbError } from '~~/server/utils/crm'
import {
  assertFacilityBookableMemberIds,
  availabilityOverridesPayload,
  availabilityRulesPayload,
  requireFacilityPermission,
  uuidValue,
} from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const facilityId = getRouterParam(event, 'facilityId')
  const body = asRecord(await readBody(event))
  const userId = uuidValue(body.userId ?? body.user_id ?? session.userId, 'userId')
  const access = await requireFacilityPermission(
    session,
    facilityId,
    userId === session.userId ? 'view' : 'manage',
  )
  await assertFacilityBookableMemberIds(session, access.facility.id, [userId])
  const rules = availabilityRulesPayload(body.rules)
  const overrides = availabilityOverridesPayload(body.overrides)

  const { error } = await session.supabase.rpc('replace_expert_availability', {
    p_organization_id: session.organizationId,
    p_facility_id: access.facility.id,
    p_user_id: userId,
    p_rules: rules,
    p_overrides: overrides,
  })
  throwDbError(error)

  const [rulesResult, overridesResult] = await Promise.all([
    session.supabase
      .from('expert_availability_rules')
      .select('*')
      .eq('organization_id', session.organizationId)
      .eq('facility_id', access.facility.id)
      .eq('user_id', userId)
      .order('weekday')
      .order('starts_at'),
    session.supabase
      .from('expert_availability_overrides')
      .select('*')
      .eq('organization_id', session.organizationId)
      .eq('facility_id', access.facility.id)
      .eq('user_id', userId)
      .order('local_date'),
  ])
  throwDbError(rulesResult.error)
  throwDbError(overridesResult.error)
  return { rules: rulesResult.data ?? [], overrides: overridesResult.data ?? [] }
})
