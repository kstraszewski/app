import { requireCrmSession, throwDbError } from '~~/server/utils/crm'

type MemberRow = {
  user_id: string
  role: 'expert' | 'admin'
  user: { email: string; full_name: string | null } | null
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const role: 'expert' | 'admin' = session.role === 'admin' ? 'admin' : 'expert'
  const { data, error } = await session.supabase
    .from('organization_memberships')
    .select('user_id, role, user:users!inner(email, full_name)')
    .eq('organization_id', session.organizationId)

  throwDbError(error)

  const members = ((data ?? []) as MemberRow[])
    .map(membership => ({
      userId: membership.user_id,
      email: membership.user?.email ?? '',
      fullName: membership.user?.full_name ?? '',
      role: membership.role,
    }))
    .sort((left, right) => {
      if (left.userId === session.userId) return -1
      if (right.userId === session.userId) return 1
      return (left.fullName || left.email).localeCompare(right.fullName || right.email, 'pl')
    })

  return {
    currentUserId: session.userId,
    role,
    canAssignOthers: role === 'admin',
    members,
  }
})
