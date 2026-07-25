import { createError } from 'h3'
import {
  getRequiredParam,
  requireCrmSession,
  requireTeamView,
  throwDbError,
} from '~~/server/utils/crm'
import { uuidValue } from '~~/server/utils/scheduling'

type Row = Record<string, any>
type OrganizationMemberRow = {
  user_id: string
  user: { id: string; email: string; full_name: string | null } | null
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const teamId = uuidValue(getRequiredParam(event, 'teamId'), 'teamId')
  const scope = await requireTeamView(session, teamId)
  const directAdminTeamIds = new Set(scope.directAdminTeamIds)
  const managedTeamIds = new Set(scope.managedTeamIds)

  const [
    teamResult,
    membershipsResult,
    facilityLinksResult,
    edgesResult,
    facilityAdminResult,
  ] = await Promise.all([
    session.supabase
      .from('teams')
      .select('*')
      .eq('organization_id', session.organizationId)
      .eq('id', teamId)
      .maybeSingle(),
    session.supabase
      .from('team_memberships')
      .select('*')
      .eq('organization_id', session.organizationId)
      .eq('team_id', teamId)
      .order('created_at'),
    session.supabase
      .from('team_facilities')
      .select('*')
      .eq('organization_id', session.organizationId)
      .eq('team_id', teamId)
      .order('created_at'),
    session.supabase
      .from('team_edges')
      .select('*')
      .eq('organization_id', session.organizationId)
      .or(`parent_team_id.eq.${teamId},child_team_id.eq.${teamId}`),
    session.supabase
      .from('facility_memberships')
      .select('facility_id')
      .eq('organization_id', session.organizationId)
      .eq('user_id', session.userId)
      .eq('role', 'admin')
      .limit(1)
      .maybeSingle(),
  ])

  throwDbError(teamResult.error)
  throwDbError(membershipsResult.error)
  throwDbError(facilityLinksResult.error)
  throwDbError(edgesResult.error)
  throwDbError(facilityAdminResult.error)
  if (!teamResult.data) {
    throw createError({ statusCode: 404, statusMessage: 'Team not found' })
  }

  const memberships = (membershipsResult.data ?? []) as Row[]
  const userIds = [...new Set(memberships.map(membership => String(membership.user_id)))]
  const facilityIds = [...new Set(
    ((facilityLinksResult.data ?? []) as Row[]).map(link => String(link.facility_id)),
  )]
  const visibleEdges = ((edgesResult.data ?? []) as Row[]).filter(edge => (
    managedTeamIds.has(String(edge.parent_team_id))
    && managedTeamIds.has(String(edge.child_team_id))
  ))
  const relatedTeamIds = [...new Set(visibleEdges.flatMap(edge => [
    String(edge.parent_team_id),
    String(edge.child_team_id),
  ]).filter(id => id !== teamId))]

  const [organizationMembersResult, facilitiesResult, relatedTeamsResult] = await Promise.all([
    userIds.length
      ? session.supabase
          .from('organization_memberships')
          .select('user_id, user:users!organization_memberships_user_id_fkey!inner(id, email, full_name)')
          .eq('organization_id', session.organizationId)
          .in('user_id', userIds)
      : Promise.resolve({ data: [], error: null }),
    facilityIds.length
      ? session.supabase
          .from('facilities')
          .select('*')
          .eq('organization_id', session.organizationId)
          .in('id', facilityIds)
          .order('name')
      : Promise.resolve({ data: [], error: null }),
    relatedTeamIds.length
      ? session.supabase
          .from('teams')
          .select('*')
          .eq('organization_id', session.organizationId)
          .in('id', relatedTeamIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  throwDbError(organizationMembersResult.error)
  throwDbError(facilitiesResult.error)
  throwDbError(relatedTeamsResult.error)

  const usersById = new Map(
    ((organizationMembersResult.data ?? []) as OrganizationMemberRow[])
      .map(membership => [String(membership.user_id), membership.user] as const),
  )
  const relatedTeamsById = new Map(
    ((relatedTeamsResult.data ?? []) as Row[])
      .map(team => [String(team.id), team] as const),
  )
  const accessLevel = scope.organizationAdmin
    ? 'organization_admin'
    : directAdminTeamIds.has(teamId)
      ? 'team_admin'
      : 'inherited'
  const capabilities = {
    organizationAdmin: scope.organizationAdmin,
    teamAdmin: scope.directAdminTeamIds.length > 0,
    facilityAdmin: Boolean(facilityAdminResult.data),
    canManageTeams: scope.organizationAdmin || scope.directAdminTeamIds.length > 0,
  }

  const members = memberships.map((membership) => {
    const userId = String(membership.user_id)
    const user = usersById.get(userId)
    return {
      membership,
      user: {
        id: String(user?.id ?? userId),
        email: String(user?.email ?? ''),
        fullName: String(user?.full_name ?? ''),
      },
    }
  })
  const children = visibleEdges
    .filter(edge => String(edge.parent_team_id) === teamId)
    .map(edge => relatedTeamsById.get(String(edge.child_team_id)))
    .filter((team): team is Row => Boolean(team))
  const parents = visibleEdges
    .filter(edge => String(edge.child_team_id) === teamId)
    .map(edge => relatedTeamsById.get(String(edge.parent_team_id)))
    .filter((team): team is Row => Boolean(team))
  const facilities = (facilitiesResult.data ?? []) as Row[]

  return {
    data: {
      team: {
        ...teamResult.data,
        accessLevel,
      },
      members,
      facilities,
      parents,
      children,
      stats: {
        memberCount: members.length,
        adminCount: memberships.filter(membership => membership.role === 'admin').length,
        facilityCount: facilities.length,
        childTeamCount: children.length,
      },
    },
    access: {
      canView: true as const,
      canManage: scope.organizationAdmin || directAdminTeamIds.has(teamId),
      canDelete: scope.organizationAdmin,
      canManageStructure: scope.organizationAdmin,
    },
    organization: {
      id: session.organizationId,
      name: session.organizationName,
      slug: session.organizationSlug,
      role: session.role,
      isDefault: session.organizationId === session.defaultOrganizationId,
      capabilities,
    },
  }
})
