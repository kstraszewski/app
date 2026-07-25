import { readBody } from 'h3'
import {
  asRecord,
  requireCrmSession,
  requireFacilityAdminMembership,
  requireTeamAdmin,
  throwDbError,
} from '~~/server/utils/crm'
import { uuidValue } from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const facilityId = uuidValue(getRouterParam(event, 'facilityId'), 'facilityId')
  const body = asRecord(await readBody(event))
  const teamId = uuidValue(body.teamId ?? body.team_id, 'teamId')
  await Promise.all([
    requireTeamAdmin(session, teamId),
    requireFacilityAdminMembership(session, facilityId),
  ])

  const [teamResult, facilityResult] = await Promise.all([
    session.supabase
      .from('teams')
      .select('id')
      .eq('organization_id', session.organizationId)
      .eq('id', teamId)
      .maybeSingle(),
    session.supabase
      .from('facilities')
      .select('id')
      .eq('organization_id', session.organizationId)
      .eq('id', facilityId)
      .maybeSingle(),
  ])
  const { data: team, error: teamError } = teamResult
  throwDbError(teamError)
  if (!team) throw createError({ statusCode: 404, statusMessage: 'Team not found' })
  throwDbError(facilityResult.error)
  if (!facilityResult.data) throw createError({ statusCode: 404, statusMessage: 'Facility not found' })

  const { data, error } = await session.supabase
    .from('team_facilities')
    .insert({
      organization_id: session.organizationId,
      team_id: teamId,
      facility_id: facilityId,
    })
    .select('*')
    .single()
  throwDbError(error)
  return { data }
})
