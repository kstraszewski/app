import { setHeader } from 'h3'
import { serverDataBackend } from '~~/server/utils/data-api'
import {
  requireAuthenticatedSession,
  requireSuperAdmin,
  throwDbError,
} from '~~/server/utils/crm'
import { organizationInvitationBillingDiscountFromRow } from '~~/server/utils/organization-invitations'
import type {
  OrganizationInvitationBillingDiscount,
  SystemOrganizationInvitation,
  SystemOrganizationListItem,
  SystemOrganizationsResponse,
} from '~~/shared/types/system-organizations'
import {
  isBillingAccessGranted,
  type BillingAccessState,
  type OrganizationKind,
} from '~~/shared/organization-billing'

type OrganizationRow = {
  id: string
  name: string
  slug: string
  kind: OrganizationKind
  billing_access_state: BillingAccessState
  created_at: string
}

type MembershipRow = {
  organization_id: string
  user_id: string
  role: string
}

type UserRow = {
  id: string
  email: string
  full_name: string | null
}

type InvitationRow = {
  id: string
  organization_id: string | null
  email_normalized: string
  organization_name: string
  organization_kind: OrganizationKind
  onboarding_source: SystemOrganizationInvitation['onboardingSource']
  initial_seat_count: number
  administrator_name: string | null
  discount_kind: 'percentage' | 'fixed_amount' | null
  discount_percent_off_bps: number | null
  discount_amount_off_minor: number | null
  discount_currency: 'pln' | null
  discount_duration: 'once' | 'repeating' | 'forever' | null
  discount_duration_months: number | null
  status: SystemOrganizationInvitation['status']
  expires_at: string
  sent_at: string | null
  accepted_at: string | null
  completed_at: string | null
  revoked_at: string | null
  created_at: string
  updated_at: string
  delivery_attempts: number
  last_delivery_error: string | null
}

export default defineEventHandler(async (event): Promise<SystemOrganizationsResponse> => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const session = await requireAuthenticatedSession(event)
  await requireSuperAdmin(session)
  const backend = serverDataBackend(event) as any
  const [organizationsResult, membershipsResult, usersResult, invitationsResult] = await Promise.all([
    backend
      .from('organizations')
      .select('id, name, slug, kind, billing_access_state, created_at')
      .order('created_at', { ascending: false }),
    backend
      .from('organization_memberships')
      .select('organization_id, user_id, role'),
    backend
      .from('users')
      .select('id, email, full_name'),
    backend
      .from('organization_onboarding_invitations')
      .select([
        'id',
        'organization_id',
        'email_normalized',
        'organization_name',
        'organization_kind',
        'onboarding_source',
        'initial_seat_count',
        'administrator_name',
        'discount_kind',
        'discount_percent_off_bps',
        'discount_amount_off_minor',
        'discount_currency',
        'discount_duration',
        'discount_duration_months',
        'status',
        'expires_at',
        'sent_at',
        'accepted_at',
        'completed_at',
        'revoked_at',
        'created_at',
        'updated_at',
        'delivery_attempts',
        'last_delivery_error',
      ].join(', '))
      .order('created_at', { ascending: false }),
  ])
  throwDbError(organizationsResult.error)
  throwDbError(membershipsResult.error)
  throwDbError(usersResult.error)
  throwDbError(invitationsResult.error)

  const memberships = (membershipsResult.data ?? []) as MembershipRow[]
  const invitationRows = (invitationsResult.data ?? []) as InvitationRow[]
  const billingDiscountsByOrganization = new Map<
    string,
    OrganizationInvitationBillingDiscount
  >()
  for (const invitation of invitationRows) {
    if (!invitation.organization_id) continue
    const discount = organizationInvitationBillingDiscountFromRow(invitation)
    if (discount) billingDiscountsByOrganization.set(invitation.organization_id, discount)
  }
  const usersById = new Map(
    ((usersResult.data ?? []) as UserRow[]).map(user => [user.id, user]),
  )
  const membershipsByOrganization = new Map<string, MembershipRow[]>()
  for (const membership of memberships) {
    const current = membershipsByOrganization.get(membership.organization_id) ?? []
    current.push(membership)
    membershipsByOrganization.set(membership.organization_id, current)
  }

  const organizations = ((organizationsResult.data ?? []) as OrganizationRow[])
    .map<SystemOrganizationListItem>((organization) => {
      const organizationMemberships = membershipsByOrganization.get(organization.id) ?? []
      const administratorMembership = organizationMemberships.find(membership => membership.role === 'admin')
      const administrator = administratorMembership
        ? usersById.get(administratorMembership.user_id)
        : undefined
      return {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        kind: organization.kind,
        billingAccessState: organization.billing_access_state,
        billingDiscount: billingDiscountsByOrganization.get(organization.id) ?? null,
        memberCount: organizationMemberships.length,
        administratorName: administrator?.full_name ?? null,
        administratorEmail: administrator?.email ?? null,
        createdAt: organization.created_at,
        updatedAt: organization.created_at,
      }
    })

  const now = Date.now()
  const invitations = invitationRows
    .map<SystemOrganizationInvitation>((invitation) => {
      const status = invitation.status === 'pending'
        && Date.parse(invitation.expires_at) <= now
        ? 'expired'
        : invitation.status
      return {
        id: invitation.id,
        email: invitation.email_normalized,
        administratorName: invitation.administrator_name,
        organizationName: invitation.organization_name,
        organizationKind: invitation.organization_kind,
        onboardingSource: invitation.onboarding_source,
        initialSeatCount: Number(invitation.initial_seat_count),
        billingDiscount: organizationInvitationBillingDiscountFromRow(invitation),
        status,
        expiresAt: invitation.expires_at,
        sentAt: invitation.sent_at,
        acceptedAt: invitation.accepted_at,
        completedAt: invitation.completed_at,
        revokedAt: invitation.revoked_at,
        createdAt: invitation.created_at,
        updatedAt: invitation.updated_at,
        deliveryAttempts: Number(invitation.delivery_attempts),
        deliveryFailed: Boolean(invitation.last_delivery_error),
        lastDeliveryError: invitation.last_delivery_error,
      }
    })

  return {
    data: organizations,
    invitations,
    stats: {
      totalOrganizations: organizations.length,
      intermediaryOrganizations: organizations.filter(org => org.kind === 'intermediary').length,
      applicationOrganizations: organizations.filter(org => org.kind === 'application').length,
      pendingInvitations: invitations.filter(invitation => invitation.status === 'pending').length,
      subscriptionRequired: organizations.filter(org => (
        org.kind === 'application' && !isBillingAccessGranted(org.billingAccessState)
      )).length,
    },
  }
})
