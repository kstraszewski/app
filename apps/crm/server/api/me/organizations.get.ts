import { hasSuperAdminRole, requireAuthenticatedSession, throwDbError } from '~~/server/utils/crm'

type MembershipRow = {
  role: 'expert' | 'admin'
  organization: {
    id: string
    name: string
    slug: string
  } | null
}

export default defineEventHandler(async (event) => {
  const session = await requireAuthenticatedSession(event)
  const [{ data, error }, superAdmin] = await Promise.all([
    session.dataApi
      .from('organization_memberships')
      .select('role, organization:organizations!organization_memberships_organization_id_fkey!inner(id, name, slug)')
      .eq('user_id', session.userId),
    hasSuperAdminRole(session),
  ])

  throwDbError(error)

  const memberships = ((data ?? []) as MembershipRow[])
    .filter((membership) => membership.organization)
  const organizationIds = memberships.map(membership => membership.organization!.id)
  const [teamAdminsResult, facilityAdminsResult, experimentsAccessResult] = organizationIds.length
    ? await Promise.all([
        session.dataApi
          .from('team_memberships')
          .select('organization_id')
          .eq('user_id', session.userId)
          .eq('role', 'admin')
          .in('organization_id', organizationIds),
        session.dataApi
          .from('facility_memberships')
          .select('organization_id')
          .eq('user_id', session.userId)
          .eq('role', 'admin')
          .in('organization_id', organizationIds),
        session.dataApi
          .from('organization_user_admin_roles')
          .select('organization_id')
          .eq('user_id', session.userId)
          .eq('role_key', 'experiments_access')
          .in('organization_id', organizationIds),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
      ]
  throwDbError(teamAdminsResult.error)
  throwDbError(facilityAdminsResult.error)
  throwDbError(experimentsAccessResult.error)

  const teamAdminOrganizationIds = new Set(
    (teamAdminsResult.data ?? []).map((membership: { organization_id: unknown }) => String(membership.organization_id)),
  )
  const facilityAdminOrganizationIds = new Set(
    (facilityAdminsResult.data ?? []).map((membership: { organization_id: unknown }) => String(membership.organization_id)),
  )
  const experimentsAccessOrganizationIds = new Set(
    (experimentsAccessResult.data ?? []).map((assignment: { organization_id: unknown }) => String(assignment.organization_id)),
  )

  return {
    access: { superAdmin },
    data: memberships
      .map((membership) => {
        const organization = membership.organization!
        const organizationAdmin = membership.role === 'admin'
        const teamAdmin = teamAdminOrganizationIds.has(organization.id)
        const facilityAdmin = facilityAdminOrganizationIds.has(organization.id)

        return {
          ...organization,
          role: membership.role,
          isDefault: organization.id === session.defaultOrganizationId,
          capabilities: {
            organizationAdmin,
            teamAdmin,
            facilityAdmin,
            canManageTeams: organizationAdmin || teamAdmin,
            canUseExperiments: experimentsAccessOrganizationIds.has(organization.id),
          },
        }
      })
      .sort((left, right) => Number(right.isDefault) - Number(left.isDefault)
        || left.name.localeCompare(right.name, 'pl')),
  }
})
