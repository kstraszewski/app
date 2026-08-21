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
import {
  APPLICATION_BILLING_PLANS,
  isApplicationBillingPlanCode,
} from '~~/shared/organization-billing'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const session = await requireCrmSession(event, undefined, { allowUnsubscribed: true })
  const account = await organizationBillingAccount(event, session.organizationId)
  const activeMembers = await organizationActiveMemberCount(event, session.organizationId)
  const configuration = stripeBillingConfiguration(event)
  const billingPlanCode = isApplicationBillingPlanCode(account?.billing_plan_code)
    ? account.billing_plan_code
    : 'legacy_per_seat'
  const billingPlan = APPLICATION_BILLING_PLANS[billingPlanCode]

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
      ...billingPlan,
      displayAmount: `${billingPlan.unitAmount / 100} zł`,
      displayInterval: billingPlanCode === 'individual'
        ? 'miesiąc + VAT'
        : billingPlanCode === 'team'
          ? 'użytkownika / miesiąc + VAT'
          : 'użytkownika / miesiąc (plan historyczny)',
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
            * billingPlan.unitAmount,
          billingPlanCode,
          canUpgradeToTeam: billingPlanCode === 'individual'
            && ['active', 'trialing'].includes(String(account.stripe_subscription_status)),
          lastSyncedAt: account.last_synced_at,
        }
      : null,
  }
})
