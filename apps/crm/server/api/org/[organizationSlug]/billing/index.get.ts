import { setHeader } from 'h3'
import {
  requireCrmSession,
  requireOrganizationAdmin,
} from '~~/server/utils/crm'
import {
  isStripeBillingConfigured,
  organizationActiveMemberCount,
  organizationBillingAccount,
  stripeBillingConfiguration,
} from '~~/server/utils/stripe-billing'
import { APPLICATION_MONTHLY_PLAN } from '~~/shared/organization-billing'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const session = await requireCrmSession(event, undefined, { allowUnsubscribed: true })
  const account = await organizationBillingAccount(event, session.organizationId)
  const activeMembers = await organizationActiveMemberCount(event, session.organizationId)
  const configuration = stripeBillingConfiguration(event)

  let canManage = true
  try {
    requireOrganizationAdmin(session)
  }
  catch {
    canManage = false
  }

  return {
    organization: {
      id: session.organizationId,
      name: session.organizationName,
      slug: session.organizationSlug,
      kind: session.organizationKind,
      billingAccessState: session.billingAccessState,
    },
    plan: {
      ...APPLICATION_MONTHLY_PLAN,
      displayAmount: '200 zł',
      displayInterval: 'użytkownika / miesiąc',
    },
    demoMode: configuration.demoMode,
    configured: isStripeBillingConfigured(event),
    webhookConfigured: Boolean(configuration.webhookSecret),
    portalConfigured: Boolean(configuration.customerPortalConfigurationId),
    canManage,
    account: account
      ? {
          subscriptionStatus: account.stripe_subscription_status,
          currentPeriodStart: account.current_period_start,
          currentPeriodEnd: account.current_period_end,
          cancelAtPeriodEnd: account.cancel_at_period_end,
          graceUntil: account.grace_until,
          hasCustomer: Boolean(account.stripe_customer_id),
          hasSubscription: Boolean(account.stripe_subscription_id),
          licensedSeats: Number(account.licensed_seat_count ?? activeMembers),
          activeMembers,
          monthlyListAmount: Number(account.licensed_seat_count ?? activeMembers)
            * APPLICATION_MONTHLY_PLAN.unitAmount,
          lastSyncedAt: account.last_synced_at,
        }
      : null,
  }
})
