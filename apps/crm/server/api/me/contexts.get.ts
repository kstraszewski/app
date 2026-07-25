import { setHeader } from 'h3'
import { requireAuthIdentity, throwDbError } from '~~/server/utils/crm'

type MembershipRow = {
  role: string | null
  organization: {
    id: string
    name: string
    slug: string
  } | Array<{
    id: string
    name: string
    slug: string
  }> | null
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const identity = await requireAuthIdentity(event)
  const [staffProfileResult, membershipsResult, clientLinksResult] = await Promise.all([
    identity.supabase
      .from('users')
      .select('organization_id')
      .eq('id', identity.userId)
      .maybeSingle(),
    identity.supabase
      .from('organization_memberships')
      .select('role, organization:organizations!inner(id, name, slug)')
      .eq('user_id', identity.userId),
    identity.supabase
      .from('client_account_links')
      .select('*', { count: 'exact', head: true })
      .eq('auth_user_id', identity.userId)
      .is('revoked_at', null),
  ])

  throwDbError(staffProfileResult.error)
  throwDbError(membershipsResult.error)
  throwDbError(clientLinksResult.error)

  const defaultOrganizationId = staffProfileResult.data?.organization_id
    ? String(staffProfileResult.data.organization_id)
    : ''
  const staffOrganizations = ((membershipsResult.data ?? []) as MembershipRow[])
    .flatMap((membership) => {
      const organization = Array.isArray(membership.organization)
        ? membership.organization[0]
        : membership.organization
      if (!organization) return []
      return [{
        id: String(organization.id),
        name: String(organization.name),
        slug: String(organization.slug),
        role: String(membership.role ?? 'expert'),
        isDefault: String(organization.id) === defaultOrganizationId,
      }]
    })
    .sort((left, right) => Number(right.isDefault) - Number(left.isDefault)
      || left.name.localeCompare(right.name, 'pl'))
  const clientLinkCount = clientLinksResult.count ?? 0

  return {
    identity: {
      id: identity.userId,
      email: identity.email,
      fullName: identity.fullName,
    },
    staffOrganizations,
    clientLinkCount,
    hasStaff: staffOrganizations.length > 0,
    hasClient: clientLinkCount > 0,
  }
})
