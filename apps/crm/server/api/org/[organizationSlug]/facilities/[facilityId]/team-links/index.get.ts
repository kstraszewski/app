import { requireCrmSession, throwDbError } from '~~/server/utils/crm'
import { requireFacilityPermission } from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const access = await requireFacilityPermission(session, getRouterParam(event, 'facilityId'), 'view')
  const { data: links, error } = await session.dataApi
    .from('team_facilities')
    .select('*')
    .eq('organization_id', session.organizationId)
    .eq('facility_id', access.facility.id)
    .order('created_at')
  throwDbError(error)
  const teamIds = (links ?? []).map((link: any) => String(link.team_id))
  const { data: teams, error: teamsError } = teamIds.length
    ? await session.dataApi.from('teams').select('id, name, slug, kind').eq('organization_id', session.organizationId).in('id', teamIds)
    : { data: [], error: null }
  throwDbError(teamsError)
  const teamsById = new Map((teams ?? []).map((team: any) => [String(team.id), team]))
  return {
    data: (links ?? []).map((link: any) => ({
      ...link,
      team: teamsById.get(String(link.team_id)) ?? null,
    })),
  }
})
