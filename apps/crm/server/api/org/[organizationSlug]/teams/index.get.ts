import {
  requireCrmSession,
  resolveTeamAdminScope,
  throwDbError,
} from '~~/server/utils/crm'

type MemberRow = {
  user_id: string
  role: 'expert' | 'admin'
  user: { id: string; email: string; full_name: string | null; avatar_url: string | null } | null
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const scope = await resolveTeamAdminScope(session)
  const facilityAdminResult = await session.dataApi
    .from('facility_memberships')
    .select('facility_id')
    .eq('organization_id', session.organizationId)
    .eq('user_id', session.userId)
    .eq('role', 'admin')
    .limit(1)
    .maybeSingle()
  throwDbError(facilityAdminResult.error)

  const capabilities = {
    organizationAdmin: scope.organizationAdmin,
    teamAdmin: scope.directAdminTeamIds.length > 0,
    facilityAdmin: Boolean(facilityAdminResult.data),
    canManageTeams: scope.organizationAdmin || scope.directAdminTeamIds.length > 0,
  }
  const organization = {
    id: session.organizationId,
    name: session.organizationName,
    slug: session.organizationSlug,
    role: session.role,
    isDefault: session.organizationId === session.defaultOrganizationId,
    capabilities,
  }
  const access = {
    canCreate: scope.organizationAdmin,
    managedTeamIds: scope.managedTeamIds,
    directAdminTeamIds: scope.directAdminTeamIds,
  }

  if (!scope.managedTeamIds.length) {
    return {
      organization,
      teams: [],
      edges: [],
      memberships: [],
      members: [],
      access,
      meta: { scope: 'none' as const },
    }
  }

  const managedTeamIds = new Set(scope.managedTeamIds)
  const [teamsResult, edgesResult, membershipsResult, membersResult] = await Promise.all([
    session.dataApi
      .from('teams')
      .select('*')
      .eq('organization_id', session.organizationId)
      .in('id', scope.managedTeamIds)
      .order('name'),
    session.dataApi
      .from('team_edges')
      .select('*')
      .eq('organization_id', session.organizationId)
      .order('created_at'),
    session.dataApi
      .from('team_memberships')
      .select('*')
      .eq('organization_id', session.organizationId)
      .in('team_id', scope.managedTeamIds)
      .order('created_at'),
    session.dataApi
      .from('organization_memberships')
      .select('user_id, role, user:users!organization_memberships_user_id_fkey!inner(id, email, full_name, avatar_url)')
      .eq('organization_id', session.organizationId),
  ])

  throwDbError(teamsResult.error)
  throwDbError(edgesResult.error)
  throwDbError(membershipsResult.error)
  throwDbError(membersResult.error)

  const directAdminTeamIds = new Set(scope.directAdminTeamIds)
  return {
    organization,
    teams: (teamsResult.data ?? []).map((team: Record<string, unknown>) => ({
      ...team,
      accessLevel: scope.organizationAdmin
        ? 'organization_admin'
        : directAdminTeamIds.has(String(team.id))
          ? 'team_admin'
          : 'inherited',
    })),
    edges: (edgesResult.data ?? []).filter((edge: Record<string, unknown>) => (
      managedTeamIds.has(String(edge.parent_team_id))
      && managedTeamIds.has(String(edge.child_team_id))
    )),
    memberships: membershipsResult.data ?? [],
    members: ((membersResult.data ?? []) as MemberRow[]).map((membership) => ({
      userId: membership.user_id,
      email: membership.user?.email ?? '',
      fullName: membership.user?.full_name ?? '',
      avatarUrl: membership.user?.avatar_url ?? null,
      role: membership.role,
    })),
    access,
    meta: {
      scope: scope.organizationAdmin ? 'organization' as const : 'managed' as const,
    },
  }
})
