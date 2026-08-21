import type {
  BillingAccessState,
  OrganizationKind,
} from '../organization-billing'

export const ORGANIZATION_INVITATION_STATUSES = [
  'pending',
  'accepted',
  'completed',
  'expired',
  'revoked',
] as const

export type OrganizationInvitationStatus = typeof ORGANIZATION_INVITATION_STATUSES[number]

export const ORGANIZATION_ONBOARDING_SOURCES = [
  'superadmin_invitation',
  'self_service',
] as const

export type OrganizationOnboardingSource = typeof ORGANIZATION_ONBOARDING_SOURCES[number]

export type OrganizationInvitationBillingDiscount =
  | {
      kind: 'percentage'
      /** Integer percentage expressed in basis points (100 bps = 1%). */
      percentOffBps: number
      duration: 'once' | 'repeating' | 'forever'
      /** Positive integer for repeating discounts, otherwise null. */
      durationMonths: number | null
    }
  | {
      kind: 'fixed_amount'
      /** Integer amount expressed in the currency's minor unit. */
      amountOffMinor: number
      currency: 'pln'
      duration: 'once' | 'repeating' | 'forever'
      /** Positive integer for repeating discounts, otherwise null. */
      durationMonths: number | null
    }

export interface SystemOrganizationListItem {
  id: string
  name: string
  slug: string
  kind: OrganizationKind
  billingAccessState: BillingAccessState
  billingDiscount: OrganizationInvitationBillingDiscount | null
  memberCount: number
  administratorName: string | null
  administratorEmail: string | null
  createdAt: string
  updatedAt: string
}

export interface SystemOrganizationInvitation {
  id: string
  email: string
  administratorName: string | null
  organizationName: string
  organizationKind: OrganizationKind
  onboardingSource: OrganizationOnboardingSource
  initialSeatCount: number
  billingDiscount: OrganizationInvitationBillingDiscount | null
  status: OrganizationInvitationStatus
  expiresAt: string
  sentAt: string | null
  acceptedAt: string | null
  completedAt: string | null
  revokedAt: string | null
  createdAt: string
  updatedAt: string
  deliveryAttempts: number
  deliveryFailed?: boolean
  lastDeliveryError: string | null
  /** Only returned when a token has just been issued or rotated. */
  inviteUrl?: string
}

export interface SystemOrganizationsStats {
  totalOrganizations: number
  intermediaryOrganizations: number
  applicationOrganizations: number
  pendingInvitations: number
  subscriptionRequired: number
}

export interface SystemOrganizationsResponse {
  data: SystemOrganizationListItem[]
  invitations: SystemOrganizationInvitation[]
  stats: SystemOrganizationsStats
}

export interface CreateOrganizationInvitationBody {
  email: string
  organizationName: string
  organizationKind: OrganizationKind
  administratorName?: string
  initialSeatCount?: number
  billingDiscount?: OrganizationInvitationBillingDiscount | null
}

export interface OrganizationInvitationMutationResponse {
  invitation: SystemOrganizationInvitation
  inviteUrl?: string
  delivery: OrganizationInvitationDelivery
}

export interface PublicOrganizationInvitation {
  email: string
  organizationName: string
  organizationKind: OrganizationKind
  onboardingSource: OrganizationOnboardingSource
  initialSeatCount: number
  billingDiscount: OrganizationInvitationBillingDiscount | null
  status: OrganizationInvitationStatus
  expiresAt: string
  sentAt: string | null
  canAccept: boolean
  canResume: boolean
}

export interface PublicOrganizationInvitationResponse {
  invitation: PublicOrganizationInvitation
}

export interface OrganizationInvitationAcceptResponse {
  organization: {
    id: string
    name: string
    slug: string
    kind: OrganizationKind
    billingAccessState: BillingAccessState
    role: 'admin'
    isDefault: boolean
  }
  invitationId: string
}

export interface OrganizationInvitationMagicLinkResponse {
  delivery: OrganizationInvitationDelivery
}

export interface StartApplicationRegistrationBody {
  email: string
  administratorName: string
  organizationName: string
  initialSeatCount: number
}

export interface StartApplicationRegistrationResponse {
  accepted: true
  statusToken: string
}

export type ApplicationRegistrationDeliveryStatus =
  | 'queued'
  | 'sent'
  | 'failed'
  | 'expired'

export interface ApplicationRegistrationDeliveryStatusResponse {
  status: ApplicationRegistrationDeliveryStatus
}

export interface OrganizationInvitationDelivery {
  status: 'sent' | 'failed'
  sentAt: string | null
  attempts: number
}

export interface OrganizationBillingCheckoutResponse {
  url: string
}
