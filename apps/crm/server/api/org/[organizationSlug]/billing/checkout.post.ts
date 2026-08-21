import { createError, setHeader } from 'h3'
import Stripe from 'stripe'
import {
  requireCrmSession,
  requireOrganizationAdmin,
} from '~~/server/utils/crm'
import {
  applicationBillingPrice,
  checkoutSessionCouponId,
  checkoutSubscriptionId,
  ensureOrganizationInvitationCheckoutDiscount,
  ensureOrganizationStripeCustomer,
  isStripeResourceMissing,
  organizationActiveMemberCount,
  organizationBillingAccount,
  organizationCheckoutSeatTarget,
  rememberOrganizationInvitationDiscountCheckout,
  rememberCheckoutSession,
  requireStripeBillingBrowserRequest,
  stripeBillingClient,
  stripeBillingConfiguration,
} from '~~/server/utils/stripe-billing'
import { isBillingAccessGranted } from '~~/shared/organization-billing'

function billingUrl(baseUrl: string, slug: string, query: string): string {
  return `${baseUrl}/org/${encodeURIComponent(slug)}/settings/billing?${query}`
}

function subscriptionCanBeReplaced(
  status: string,
  retryingAssignedInvitationDiscount: boolean,
): boolean {
  // `incomplete` is not terminal: its first Invoice can still be paid and
  // activate the old Subscription. A replacement Checkout is safe only after
  // Stripe has made it `incomplete_expired`. Likewise, a canceled Subscription
  // with a still-unconsumed invite grant needs billing review instead of a
  // second discounted generation.
  return status === 'incomplete_expired'
    || (!retryingAssignedInvitationDiscount && status === 'canceled')
}

function checkoutConfigurationError(error: unknown): never {
  if (
    error instanceof Stripe.errors.StripeInvalidRequestError
    && /head office address|automatic tax/iu.test(error.message)
  ) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Stripe Tax must be configured before live Checkout can be used',
    })
  }
  throw error
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  requireStripeBillingBrowserRequest(event)
  const session = await requireCrmSession(event, undefined, { allowUnsubscribed: true })
  requireOrganizationAdmin(session)
  if (session.organizationKind !== 'application') {
    throw createError({ statusCode: 409, statusMessage: 'This organization does not require a subscription' })
  }
  if (isBillingAccessGranted(session.billingAccessState)) {
    throw createError({ statusCode: 409, statusMessage: 'The organization already has billing access' })
  }

  const stripe = stripeBillingClient(event)
  const config = stripeBillingConfiguration(event)
  if (!config.demoMode && !config.webhookSecret) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Stripe webhook must be configured before live Checkout can be used',
    })
  }
  const existing = await organizationBillingAccount(event, session.organizationId)
  const activeMembers = await organizationActiveMemberCount(event, session.organizationId)
  const checkoutSeatTarget = await organizationCheckoutSeatTarget(
    event,
    session.organizationId,
    activeMembers,
    existing,
  )
  const expectedSeats = checkoutSeatTarget.seats
  const billingPlanCode = checkoutSeatTarget.billingPlanCode
  const price = await applicationBillingPrice(event, billingPlanCode)
  let assignedDiscount = await ensureOrganizationInvitationCheckoutDiscount(
    event,
    session.organizationId,
    price,
  )
  if (existing?.stripe_checkout_session_id) {
    try {
      const checkout = await stripe.checkout.sessions.retrieve(existing.stripe_checkout_session_id, {
        expand: ['line_items.data.price', 'discounts.coupon'],
      })
      if (checkout.status === 'open' && checkout.url) {
        const checkoutCustomerId = typeof checkout.customer === 'string'
          ? checkout.customer
          : checkout.customer?.id
        const checkoutLinePrice = checkout.line_items?.data[0]?.price
        const checkoutLinePriceId = typeof checkoutLinePrice === 'string'
          ? checkoutLinePrice
          : checkoutLinePrice?.id
        if (
          checkout.mode !== 'subscription'
          || checkout.client_reference_id !== session.organizationId
          || checkoutCustomerId !== existing.stripe_customer_id
          || checkout.livemode !== price.livemode
          || checkout.line_items?.data.length !== 1
          || checkout.line_items.data[0]?.quantity !== expectedSeats
          || checkoutLinePriceId !== price.id
          || checkout.metadata?.billing_plan_code !== billingPlanCode
          || checkout.metadata?.plan_code !== price.metadata.plan_code
          || (assignedDiscount
            && (
              checkoutSessionCouponId(checkout) !== assignedDiscount.couponId
              || checkout.metadata?.organization_invitation_id !== assignedDiscount.invitationId
              || checkout.metadata?.invitation_discount_fingerprint !== assignedDiscount.fingerprint
            ))
        ) {
          await stripe.checkout.sessions.expire(checkout.id)
        }
        else {
          if (assignedDiscount) {
            await rememberOrganizationInvitationDiscountCheckout(event, {
              organizationId: session.organizationId,
              invitationId: assignedDiscount.invitationId,
              couponId: assignedDiscount.couponId,
              checkoutSessionId: checkout.id,
              livemode: checkout.livemode,
            })
          }
          return { url: checkout.url, reused: true }
        }
      }
      const completedSubscriptionId = checkoutSubscriptionId(checkout)
      if (checkout.status === 'complete' && !completedSubscriptionId) {
        throw createError({
          statusCode: 409,
          statusMessage: 'The completed Checkout Session has no Subscription',
        })
      }
      if (checkout.status === 'complete' && completedSubscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(completedSubscriptionId)
        if (assignedDiscount) {
          // Close the state-change window between the verifier's first Stripe
          // read and this completed-session read. A just-paid/activated first
          // Subscription must consume the grant before any replacement is
          // allowed to carry the Coupon again.
          assignedDiscount = await ensureOrganizationInvitationCheckoutDiscount(
            event,
            session.organizationId,
            price,
          )
        }
        if (!subscriptionCanBeReplaced(subscription.status, Boolean(assignedDiscount))) {
          throw createError({
            statusCode: 409,
            statusMessage: 'The completed Checkout Session already has a subscription',
          })
        }
      }
    }
    catch (error) {
      // Test data can be removed between demo runs. Transient Stripe errors
      // must propagate, otherwise a retry could create a second Checkout.
      if (!config.demoMode || !isStripeResourceMissing(error)) throw error
    }
  }

  if (existing?.stripe_subscription_id) {
    try {
      const subscription = await stripe.subscriptions.retrieve(existing.stripe_subscription_id)
      if (!subscriptionCanBeReplaced(subscription.status, Boolean(assignedDiscount))) {
        throw createError({
          statusCode: 409,
          statusMessage: 'The existing subscription must be managed in the Stripe customer portal',
        })
      }
    }
    catch (error) {
      if (!config.demoMode || !isStripeResourceMissing(error)) throw error
    }
  }

  const customerId = await ensureOrganizationStripeCustomer(event, session)
  const integrationSuffix = session.organizationId.replace(/-/gu, '').slice(-8).padStart(8, '0')
  let checkout: Stripe.Checkout.Session
  try {
    checkout = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: session.organizationId,
      line_items: [{ price: price.id, quantity: expectedSeats }],
      ...(assignedDiscount
        ? { discounts: [{ coupon: assignedDiscount.couponId }] }
        : { allow_promotion_codes: true }),
      payment_method_collection: 'always',
      payment_method_types: ['card'],
      billing_address_collection: 'required',
      // Production demo intentionally uses Stripe test mode without requiring
      // legal company data. Live Checkout remains fail-closed on Stripe Tax.
      automatic_tax: { enabled: !config.demoMode },
      customer_update: {
        address: 'auto',
        name: 'auto',
      },
      integration_identifier: `openexpert_${integrationSuffix}`,
      locale: 'pl',
      metadata: {
        organization_id: session.organizationId,
        organization_slug: session.organizationSlug,
        plan_code: billingPlanCode,
        billing_plan_code: billingPlanCode,
        billing_model: 'per_seat_v2',
        purchased_seat_count: String(expectedSeats),
        ...(assignedDiscount
          ? {
              organization_invitation_id: assignedDiscount.invitationId,
              invitation_discount_fingerprint: assignedDiscount.fingerprint,
            }
          : {}),
      },
      subscription_data: {
        metadata: {
          organization_id: session.organizationId,
          organization_slug: session.organizationSlug,
          plan_code: billingPlanCode,
          billing_plan_code: billingPlanCode,
          billing_model: 'per_seat_v2',
          purchased_seat_count: String(expectedSeats),
          ...(assignedDiscount
            ? {
                organization_invitation_id: assignedDiscount.invitationId,
                invitation_discount_fingerprint: assignedDiscount.fingerprint,
              }
            : {}),
        },
      },
      success_url: billingUrl(
        config.baseUrl,
        session.organizationSlug,
        'checkout=success&session_id={CHECKOUT_SESSION_ID}',
      ),
      cancel_url: billingUrl(config.baseUrl, session.organizationSlug, 'checkout=cancelled'),
    }, {
      idempotencyKey: [
      'openexpert-checkout',
      session.organizationId,
      existing?.stripe_checkout_session_id
        ? `after-${existing.stripe_checkout_session_id}`
        : 'initial',
      assignedDiscount
        ? `invite-${assignedDiscount.invitationId}-${assignedDiscount.fingerprint.slice(0, 12)}`
        : 'promotion-codes-v1',
      `seats-${expectedSeats}`,
      `plan-${billingPlanCode}`,
      checkoutSeatTarget.invitationId
        ? `registration-${checkoutSeatTarget.invitationId}`
        : 'membership-capacity',
      ].join('-'),
    })
  }
  catch (error) {
    checkoutConfigurationError(error)
  }

  if (assignedDiscount) {
    const verifiedCheckout = await stripe.checkout.sessions.retrieve(checkout.id, {
      expand: ['discounts.coupon'],
    })
    if (
      checkoutSessionCouponId(verifiedCheckout) !== assignedDiscount.couponId
      || verifiedCheckout.metadata?.organization_invitation_id !== assignedDiscount.invitationId
      || verifiedCheckout.metadata?.invitation_discount_fingerprint !== assignedDiscount.fingerprint
    ) {
      if (verifiedCheckout.status === 'open') {
        await stripe.checkout.sessions.expire(verifiedCheckout.id)
      }
      throw createError({ statusCode: 502, statusMessage: 'Stripe Checkout did not apply the assigned invitation discount' })
    }
  }

  if (!checkout.url) {
    throw createError({ statusCode: 502, statusMessage: 'Stripe Checkout URL is unavailable' })
  }
  await rememberCheckoutSession(event, {
    organizationId: session.organizationId,
    customerId,
    checkoutSessionId: checkout.id,
    priceId: price.id,
    billingPlanCode,
    livemode: checkout.livemode,
  })
  if (assignedDiscount) {
    await rememberOrganizationInvitationDiscountCheckout(event, {
      organizationId: session.organizationId,
      invitationId: assignedDiscount.invitationId,
      couponId: assignedDiscount.couponId,
      checkoutSessionId: checkout.id,
      livemode: checkout.livemode,
    })
  }
  return { url: checkout.url, reused: false }
})
