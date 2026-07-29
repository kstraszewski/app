import { setHeader } from 'h3'
import {
  getRequiredParam,
  requireAdministrativePermission,
  requireCrmSession,
  requireOrganizationMember,
  throwDbError,
} from '~~/server/utils/crm'
import { uuidValue } from '~~/server/utils/scheduling'

type MembershipRow = {
  user_id: string
  role: 'expert' | 'admin'
  user: {
    id: string
    full_name: string | null
    email: string
    avatar_url: string | null
  } | null
}

type AssignmentRow = {
  user_id: string
  role_key: string
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const userId = uuidValue(getRequiredParam(event, 'userId'), 'userId')
  setHeader(event, 'Cache-Control', 'private, no-store')

  await requireOrganizationMember(session, userId)
  await requireAdministrativePermission(session, 'privacy.grants.request')

  const permissionsResult = await session.supabase
    .from('administrative_role_permissions')
    .select('role_key')
    .eq('permission_key', 'privacy.grants.approve')
  throwDbError(permissionsResult.error)

  const eligibleRoleKeys = Array.from(new Set<string>(
    ((permissionsResult.data ?? []) as Array<{ role_key: unknown }>)
      .map(row => String(row.role_key)),
  ))
  const directRoleKeys = eligibleRoleKeys.filter(roleKey => roleKey !== 'organization_admin')

  const [membershipsResult, assignmentsResult] = await Promise.all([
    session.supabase
      .from('organization_memberships')
      .select(`
        user_id,
        role,
        user:users!organization_memberships_user_id_fkey!inner(
          id,
          full_name,
          email,
          avatar_url
        )
      `)
      .eq('organization_id', session.organizationId),
    directRoleKeys.length
      ? session.supabase
          .from('organization_user_admin_roles')
          .select('user_id, role_key')
          .eq('organization_id', session.organizationId)
          .in('role_key', directRoleKeys)
      : Promise.resolve({ data: [], error: null }),
  ])
  throwDbError(membershipsResult.error)
  throwDbError(assignmentsResult.error)

  const assignmentsByUserId = new Map<string, Set<string>>()
  for (const assignment of (assignmentsResult.data ?? []) as AssignmentRow[]) {
    const roles = assignmentsByUserId.get(String(assignment.user_id)) ?? new Set<string>()
    roles.add(String(assignment.role_key))
    assignmentsByUserId.set(String(assignment.user_id), roles)
  }

  const excludedUserIds = new Set([session.userId, userId])
  const candidates = ((membershipsResult.data ?? []) as MembershipRow[])
    .flatMap((membership) => {
      const candidateUserId = String(membership.user_id)
      const directRoles = assignmentsByUserId.get(candidateUserId) ?? new Set<string>()
      const roleKeys = [
        ...(
          membership.role === 'admin'
          && eligibleRoleKeys.includes('organization_admin')
            ? ['organization_admin']
            : []
        ),
        ...Array.from(directRoles),
      ]
      if (excludedUserIds.has(candidateUserId) || !roleKeys.length || !membership.user) {
        return []
      }
      return [{
        userId: candidateUserId,
        fullName: String(membership.user.full_name || membership.user.email),
        email: String(membership.user.email),
        avatarUrl: membership.user.avatar_url === null
          ? null
          : String(membership.user.avatar_url),
        roleKeys: roleKeys.sort(),
      }]
    })
    .sort((left, right) => left.fullName.localeCompare(right.fullName, 'pl'))

  return { data: candidates }
})
