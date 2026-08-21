import { createError, readBody, setHeader } from 'h3'
import {
  asRecord,
  requireCrmSession,
  requireOrganizationAdmin,
} from '~~/server/utils/crm'
import {
  checkoutSubscriptionId,
  markOrganizationInvitationDiscountApplied,
  organizationBillingAccount,
  reconcileExpiredOrganizationPlanUpgrade,
  reconcileExpiredOrganizationSeatChange,
  requireStripeBillingBrowserRequest,
  retrieveAndApplyStripeSubscription,
  stripeBillingClient,
} from '~~/server/utils/stripe-billing'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  requireStripeBillingBrowserRequest(event)
  const session = await requireCrmSession(event, undefined, { allowUnsubscribed: true })
  requireOrganizationAdmin(session)
  if (session.organizationKind !== 'application') {
    throw createError({ statusCode: 409, statusMessage: 'This organization does not use Stripe Billing' })
  }

  const body = asRecord(await readBody(event))
  const requestedSessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
  const account = await organizationBillingAccount(event, session.organizationId)
  let subscriptionId: string | null = null
  let checkoutSessionId: string | null = null

  if (requestedSessionId) {
    if (!/^cs_(?:test_|live_)?[A-Za-z0-9]+$/u.test(requestedSessionId)) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid Stripe Checkout Session ID' })
    }
    if (!account || requestedSessionId !== account.stripe_checkout_session_id) {
      throw createError({ statusCode: 404, statusMessage: 'Stripe Checkout Session was not found' })
    }
    const checkout = await stripeBillingClient(event).checkout.sessions.retrieve(requestedSessionId)
    const checkoutOrganizationId = String(
      checkout.client_reference_id || checkout.metadata?.organization_id || '',
    )
    const checkoutCustomerId = typeof checkout.customer === 'string'
      ? checkout.customer
      : checkout.customer?.id
    if (
      checkout.mode !== 'subscription'
      || checkoutOrganizationId !== session.organizationId
      || checkoutCustomerId !== account.stripe_customer_id
      || checkout.livemode !== account.livemode
    ) {
      throw createError({ statusCode: 404, statusMessage: 'Stripe Checkout Session was not found' })
    }
    subscriptionId = checkoutSubscriptionId(checkout)
    checkoutSessionId = checkout.id
  }
  else {
    subscriptionId = account?.stripe_subscription_id || null
    // Without a Checkout Session supplied and verified in this request, only
    // the already-bound subscription is eligible for reconciliation.
    checkoutSessionId = null
  }

  if (!subscriptionId) {
    return {
      synchronized: false,
      billingAccessState: session.billingAccessState,
      reason: 'subscription_not_available',
    }
  }

  const result = await retrieveAndApplyStripeSubscription(
    event,
    subscriptionId,
    Number(account?.last_stripe_event_created_at || 0),
    checkoutSessionId,
  )
  const recoveredSeatChange = await reconcileExpiredOrganizationSeatChange(
    event,
    result.subscription,
    result.organizationId,
  )
  const recoveredPlanUpgrade = await reconcileExpiredOrganizationPlanUpgrade(
    event,
    result.subscription,
    result.organizationId,
  )
  const appliedCheckoutSessionId = checkoutSessionId
    || account?.stripe_checkout_session_id
    || null
  if (appliedCheckoutSessionId && result.accessState === 'active') {
    await markOrganizationInvitationDiscountApplied(event, {
      organizationId: result.organizationId,
      checkoutSessionId: appliedCheckoutSessionId,
      subscriptionId,
      livemode: result.subscription.livemode,
    })
  }
  return {
    synchronized: true,
    billingAccessState: result.accessState,
    replayed: result.replayed,
    recoveredSeatChange,
    recoveredPlanUpgrade,
  }
})
