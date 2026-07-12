import { requireAuthenticatedSession, throwDbError } from '~~/server/utils/crm'

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
  const { data, error } = await session.supabase
    .from('organization_memberships')
    .select('role, organization:organizations!inner(id, name, slug)')
    .eq('user_id', session.userId)

  throwDbError(error)

  return {
    data: ((data ?? []) as MembershipRow[])
      .filter((membership) => membership.organization)
      .map((membership) => ({
        ...membership.organization!,
        role: membership.role,
        isDefault: membership.organization!.id === session.defaultOrganizationId,
      }))
      .sort((left, right) => Number(right.isDefault) - Number(left.isDefault)
        || left.name.localeCompare(right.name, 'pl')),
  }
})
