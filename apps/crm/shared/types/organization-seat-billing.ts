import type { OrganizationMemberInvitation } from './organization-member-invitations'
import type { ApplicationBillingPlanCode } from '../organization-billing'

export type OrganizationSeatRole = 'expert' | 'admin'

export type OrganizationPendingSeatChange = {
  id: string
  email: string
  role: OrganizationSeatRole
  status: string
  paymentUrl?: string
  createdAt: string
}

export type OrganizationMemberBillingSummary = {
  perSeat: boolean
  canManageSeats: boolean
  licensedSeats: number
  activeMembers: number
  reservedSeats: number
  unitAmount: number
  currency: string
  monthlyListAmount: number
  renewalAt: string | null
  pendingChanges: OrganizationPendingSeatChange[]
  pendingInvitations: OrganizationMemberInvitation[]
  billingPlanCode?: ApplicationBillingPlanCode | null
  canUpgradeToTeam?: boolean
}

export type OrganizationBillingPlanUpgradeQuote = {
  fromPlanCode: 'individual'
  targetPlanCode: 'team'
  currentSeats: 1
  targetSeats: 3
  targetUnitAmount: number
  currentMonthlySubtotal: number
  nextMonthlySubtotal: number
  immediateAmount: number
  subtotal: number
  discountAmount: number
  taxAmount: number
  total: number
  currency: 'pln'
  renewalAt: string
  prorationDate: number
  expectedSeatRevision: number
  fromStripePriceId: string
  targetStripePriceId: string
}

export type OrganizationBillingPlanUpgradeResponse = {
  status: 'succeeded' | 'requires_action' | 'processing'
  planChangeId: string
  paymentUrl?: string
}

export type OrganizationSeatQuote = {
  targetUserId: string
  billingRequired: boolean
  expectedActiveMembers: number
  expectedReservedSeats: number
  expectedOccupiedSeats: number
  currentSeats: number
  nextSeats: number
  unitAmount: number
  currentMonthlySubtotal: number
  nextMonthlySubtotal: number
  immediateAmount: number
  subtotal: number
  discountAmount: number
  taxAmount: number
  total: number
  renewalAt: string | null
  prorationDate: number
}

export type OrganizationSeatChangeResponse<TData = unknown> = {
  status: 'succeeded' | 'requires_action' | 'processing'
  seatChangeId?: string
  paymentUrl?: string
  data?: TData
}

export type OrganizationBillingInvoice = {
  id: string
  number: string
  status: string
  currency: string
  amountDue: number
  amountPaid: number
  createdAt: string
  periodStart?: string
  periodEnd?: string
  hostedInvoiceUrl?: string
  invoicePdf?: string
}

export type OrganizationBillingHistory = {
  invoices: OrganizationBillingInvoice[]
  upcoming: null | {
    amountDue: number
    currency: string
    dueAt: string
  }
  paymentMethod: null | {
    brand: string
    last4: string
    expMonth: number
    expYear: number
  }
}
