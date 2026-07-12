import { requireCrmSession, throwDbError } from '~~/server/utils/crm'

type MemberRow = {
  user_id: string
  role: 'expert' | 'admin'
  user: { id: string; email: string; full_name: string | null } | null
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const [teamsResult, edgesResult, membershipsResult, membersResult] = await Promise.all([
    session.supabase
      .from('teams')
      .select('*')
      .eq('organization_id', session.organizationId)
      .order('name'),
    session.supabase
      .from('team_edges')
      .select('*')
      .eq('organization_id', session.organizationId)
      .order('created_at'),
    session.supabase
      .from('team_memberships')
      .select('*')
      .eq('organization_id', session.organizationId)
      .order('created_at'),
    session.supabase
      .from('organization_memberships')
      .select('user_id, role, user:users!organization_memberships_user_id_fkey!inner(id, email, full_name)')
      .eq('organization_id', session.organizationId),
  ])

  throwDbError(teamsResult.error)
  throwDbError(edgesResult.error)
  throwDbError(membershipsResult.error)
  throwDbError(membersResult.error)

  return {
    organization: {
      id: session.organizationId,
      name: session.organizationName,
      slug: session.organizationSlug,
      role: session.role,
      isDefault: session.organizationId === session.defaultOrganizationId,
    },
    teams: teamsResult.data ?? [],
    edges: edgesResult.data ?? [],
    memberships: membershipsResult.data ?? [],
    members: ((membersResult.data ?? []) as MemberRow[]).map((membership) => ({
      userId: membership.user_id,
      email: membership.user?.email ?? '',
      fullName: membership.user?.full_name ?? '',
      role: membership.role,
    })),
  }
})
