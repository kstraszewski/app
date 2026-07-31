import { requireCrmSession, throwDbError } from '~~/server/utils/crm'

type MemberRow = {
  user_id: string
  role: 'expert' | 'admin'
  created_at: string
  user: { email: string; full_name: string | null; avatar_url: string | null } | null
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const role: 'expert' | 'admin' = session.role === 'admin' ? 'admin' : 'expert'
  const [
    membershipsResult,
    administrativeRolesResult,
    teamMembershipsResult,
    facilityMembershipsResult,
  ] = await Promise.all([
    session.dataApi
      .from('organization_memberships')
      .select('user_id, role, created_at, user:users!organization_memberships_user_id_fkey!inner(email, full_name, avatar_url)')
      .eq('organization_id', session.organizationId),
    session.dataApi
      .from('organization_user_admin_roles')
      .select('user_id, role_key')
      .eq('organization_id', session.organizationId),
    session.dataApi
      .from('team_memberships')
      .select('user_id, team:teams!team_memberships_team_fkey!inner(name)')
      .eq('organization_id', session.organizationId),
    session.dataApi
      .from('facility_memberships')
      .select('user_id, facility:facilities!facility_memberships_facility_fkey!inner(name)')
      .eq('organization_id', session.organizationId),
  ])

  throwDbError(membershipsResult.error)
  throwDbError(administrativeRolesResult.error)
  throwDbError(teamMembershipsResult.error)
  throwDbError(facilityMembershipsResult.error)

  const administrativeRolesByUserId = new Map<string, string[]>()
  for (const assignment of administrativeRolesResult.data ?? []) {
    const userId = String(assignment.user_id)
    const roles = administrativeRolesByUserId.get(userId) ?? []
    roles.push(String(assignment.role_key))
    administrativeRolesByUserId.set(userId, roles)
  }

  const teamsByUserId = new Map<string, string[]>()
  for (const membership of teamMembershipsResult.data ?? []) {
    const team = Array.isArray(membership.team) ? membership.team[0] : membership.team
    if (!team?.name) continue
    const userId = String(membership.user_id)
    const teams = teamsByUserId.get(userId) ?? []
    teams.push(String(team.name))
    teamsByUserId.set(userId, teams)
  }

  const facilitiesByUserId = new Map<string, string[]>()
  for (const membership of facilityMembershipsResult.data ?? []) {
    const facility = Array.isArray(membership.facility)
      ? membership.facility[0]
      : membership.facility
    if (!facility?.name) continue
    const userId = String(membership.user_id)
    const facilities = facilitiesByUserId.get(userId) ?? []
    facilities.push(String(facility.name))
    facilitiesByUserId.set(userId, facilities)
  }

  const members = ((membershipsResult.data ?? []) as MemberRow[])
    .map((membership) => {
      const administrativeRoles = administrativeRolesByUserId.get(membership.user_id) ?? []
      if (membership.role === 'admin') administrativeRoles.unshift('organization_admin')
      return {
        userId: membership.user_id,
        email: membership.user?.email ?? '',
        fullName: membership.user?.full_name ?? '',
        avatarUrl: membership.user?.avatar_url ?? null,
        role: membership.role,
        adminRoles: [...new Set(administrativeRoles)],
        status: 'active' as const,
        teams: [...new Set(teamsByUserId.get(membership.user_id) ?? [])].sort((a, b) => (
          a.localeCompare(b, 'pl')
        )),
        facilities: [...new Set(facilitiesByUserId.get(membership.user_id) ?? [])].sort((a, b) => (
          a.localeCompare(b, 'pl')
        )),
        createdAt: membership.created_at,
        lastActivityAt: null,
      }
    })
    .sort((left, right) => {
      if (left.userId === session.userId) return -1
      if (right.userId === session.userId) return 1
      return (left.fullName || left.email).localeCompare(right.fullName || right.email, 'pl')
    })

  const currentUserAdministrativeRoles = administrativeRolesByUserId.get(session.userId) ?? []
  const canAssignOthers = role === 'admin'
    || currentUserAdministrativeRoles.includes('access_admin')
  const capabilities = {
    canManageAccess: canAssignOthers,
    canManageStructure: role === 'admin'
      || currentUserAdministrativeRoles.includes('structure_admin'),
    canReadAudit: role === 'admin'
      || currentUserAdministrativeRoles.includes('access_admin'),
    canRequestPrivacyGrants: role === 'admin'
      || currentUserAdministrativeRoles.includes('access_admin'),
    canApprovePrivacyGrants: role === 'admin'
      || currentUserAdministrativeRoles.includes('access_admin')
      || currentUserAdministrativeRoles.includes('consents_admin'),
  }

  return {
    currentUserId: session.userId,
    role,
    canAssignOthers,
    capabilities,
    members,
  }
})
