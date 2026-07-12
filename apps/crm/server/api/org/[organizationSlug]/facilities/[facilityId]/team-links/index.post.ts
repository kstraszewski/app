import { readBody } from 'h3'
import { asRecord, requireCrmSession, throwDbError } from '~~/server/utils/crm'
import { requireFacilityPermission, uuidValue } from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const access = await requireFacilityPermission(session, getRouterParam(event, 'facilityId'), 'manage')
  const body = asRecord(await readBody(event))
  const teamId = uuidValue(body.teamId ?? body.team_id, 'teamId')

  const { data: team, error: teamError } = await session.supabase
    .from('teams')
    .select('id')
    .eq('organization_id', session.organizationId)
    .eq('id', teamId)
    .maybeSingle()
  throwDbError(teamError)
  if (!team) throw createError({ statusCode: 404, statusMessage: 'Team not found' })

  const { data, error } = await session.supabase
    .from('team_facilities')
    .insert({
      organization_id: session.organizationId,
      team_id: teamId,
      facility_id: access.facility.id,
    })
    .select('*')
    .single()
  throwDbError(error)
  return { data }
})
