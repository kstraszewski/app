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
    session.supabase
      .from('organization_memberships')
      .select('role, organization:organizations!inner(id, name, slug)')
      .eq('user_id', session.userId),
    hasSuperAdminRole(session),
  ])

  throwDbError(error)

  const memberships = ((data ?? []) as MembershipRow[])
    .filter((membership) => membership.organization)
  const organizationIds = memberships.map(membership => membership.organization!.id)
  const [teamAdminsResult, facilityAdminsResult] = organizationIds.length
    ? await Promise.all([
        session.supabase
          .from('team_memberships')
          .select('organization_id')
          .eq('user_id', session.userId)
          .eq('role', 'admin')
          .in('organization_id', organizationIds),
        session.supabase
          .from('facility_memberships')
          .select('organization_id')
          .eq('user_id', session.userId)
          .eq('role', 'admin')
          .in('organization_id', organizationIds),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
      ]
  throwDbError(teamAdminsResult.error)
  throwDbError(facilityAdminsResult.error)

  const teamAdminOrganizationIds = new Set(
    (teamAdminsResult.data ?? []).map((membership: { organization_id: unknown }) => String(membership.organization_id)),
  )
  const facilityAdminOrganizationIds = new Set(
    (facilityAdminsResult.data ?? []).map((membership: { organization_id: unknown }) => String(membership.organization_id)),
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
          },
        }
      })
      .sort((left, right) => Number(right.isDefault) - Number(left.isDefault)
        || left.name.localeCompare(right.name, 'pl')),
  }
})
