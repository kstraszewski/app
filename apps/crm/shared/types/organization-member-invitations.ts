export type OrganizationMemberInvitationStatus =
  | 'pending'
  | 'accepted'
  | 'expired'
  | 'revoked'

export type OrganizationMemberInvitationRole = 'expert' | 'admin'

export type OrganizationMemberInvitation = {
  id: string
  organizationId: string
  organizationName?: string
  organizationSlug?: string
  email: string
  invitedName: string | null
  role: OrganizationMemberInvitationRole
  status: OrganizationMemberInvitationStatus
  invitedByUserId?: string
  acceptedByUserId?: string | null
  expiresAt: string
  sentAt: string | null
  acceptedAt: string | null
  revokedAt: string | null
  revision: number
  deliveryAttempts: number
  deliveryFailed: boolean
  lastDeliveryError: string | null
  createdAt: string
  updatedAt: string
  canAccept?: boolean
  canResume?: boolean
}

export type OrganizationMemberInvitationDelivery = {
  status: 'sent' | 'failed'
  sentAt: string | null
  attempts: number
}

export type OrganizationMemberInvitationIssueResponse = {
  invitation: OrganizationMemberInvitation
  delivery: OrganizationMemberInvitationDelivery
}

export type PublicOrganizationMemberInvitationResponse = {
  invitation: Pick<
    OrganizationMemberInvitation,
    | 'email'
    | 'invitedName'
    | 'role'
    | 'status'
    | 'organizationName'
    | 'organizationSlug'
    | 'expiresAt'
    | 'sentAt'
    | 'canAccept'
    | 'canResume'
  >
}

export type OrganizationMemberInvitationAcceptResponse = {
  accepted: true
  replayed: boolean
  membershipCreated: boolean
  invitationId: string
  organizationId: string
  organizationName: string
  organizationSlug: string
  userId: string
  role: OrganizationMemberInvitationRole
}
