import { createError, setHeader } from 'h3'
import {
  requireCrmSession,
  requireOrganizationAdmin,
} from '~~/server/utils/crm'
import {
  organizationBillingAccount,
  requireStripeBillingBrowserRequest,
  stripeBillingClient,
  stripeBillingConfiguration,
} from '~~/server/utils/stripe-billing'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  requireStripeBillingBrowserRequest(event)
  const session = await requireCrmSession(event, undefined, { allowUnsubscribed: true })
  requireOrganizationAdmin(session)
  if (session.organizationKind !== 'application') {
    throw createError({ statusCode: 409, statusMessage: 'This organization does not use Stripe Billing' })
  }

  const account = await organizationBillingAccount(event, session.organizationId)
  if (!account?.stripe_customer_id) {
    throw createError({ statusCode: 409, statusMessage: 'Stripe customer is not available yet' })
  }
  const config = stripeBillingConfiguration(event)
  if (!config.customerPortalConfigurationId) {
    throw createError({
      statusCode: 503,
      statusMessage: 'A seat-safe Stripe customer portal configuration is required',
    })
  }
  const stripe = stripeBillingClient(event)
  const portalConfiguration = await stripe.billingPortal.configurations.retrieve(
    config.customerPortalConfigurationId,
  )
  if (!portalConfiguration.active || portalConfiguration.features.subscription_update.enabled) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Stripe customer portal must not allow subscription updates',
    })
  }
  const portal = await stripe.billingPortal.sessions.create({
    customer: account.stripe_customer_id,
    configuration: portalConfiguration.id,
    locale: 'pl',
    return_url: `${config.baseUrl}/org/${encodeURIComponent(session.organizationSlug)}/settings/billing?portal=return`,
  })
  return { url: portal.url }
})
