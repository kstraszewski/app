import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { invitationBillingDiscountLabel } from '../shared/organization-invitation-discount.ts'

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('invitation discount labels explain percentage, fixed and free-period offers', () => {
  assert.equal(invitationBillingDiscountLabel({
    kind: 'percentage',
    percentOffBps: 2_000,
    duration: 'once',
    durationMonths: null,
  }), '20% zniżki na pierwszą fakturę')

  assert.equal(invitationBillingDiscountLabel({
    kind: 'fixed_amount',
    amountOffMinor: 20_000,
    currency: 'pln',
    duration: 'forever',
    durationMonths: null,
  }), '200 zł zniżki przez cały okres subskrypcji')

  assert.equal(invitationBillingDiscountLabel({
    kind: 'percentage',
    percentOffBps: 10_000,
    duration: 'repeating',
    durationMonths: 3,
  }), '100% zniżki przez 3 miesiące')
})

test('superadmin invitation API validates a typed server-owned discount', () => {
  const endpoint = source('../server/api/system/organization-invitations/index.post.ts')
  assert.match(endpoint, /billingDiscount is only available for application organizations/)
  assert.match(endpoint, /percentOffBps must be between 1 and 10000/)
  assert.match(endpoint, /durationMonths must be between 1 and 36/)
  assert.match(endpoint, /fixed amount must be a positive PLN amount/)
  assert.match(endpoint, /rejectUnknownDiscountFields/)
  assert.match(endpoint, /billingDiscount: parsedBillingDiscount/)
})

test('Checkout pre-applies an assigned Coupon and fences session reuse by offer', () => {
  const checkout = source('../server/api/org/[organizationSlug]/billing/checkout.post.ts')
  const billing = source('../server/utils/stripe-billing.ts')
  const webhook = source('../server/api/stripe/webhook.post.ts')
  const reconcile = source('../server/api/org/[organizationSlug]/billing/reconcile.post.ts')

  assert.match(checkout, /ensureOrganizationInvitationCheckoutDiscount/)
  assert.match(checkout, /discounts: \[\{ coupon: assignedDiscount\.couponId \}\]/)
  assert.match(checkout, /: \{ allow_promotion_codes: true \}/)
  assert.match(checkout, /checkoutSessionCouponId\(checkout\) !== assignedDiscount\.couponId/)
  assert.match(checkout, /invitation_discount_fingerprint/)
  assert.match(checkout, /rememberOrganizationInvitationDiscountCheckout/)
  assert.match(checkout, /payment_method_collection: 'always'/)

  assert.match(billing, /organizationInvitationDiscountFingerprint/)
  assert.match(billing, /applies_to: \{ products: \[expectedProductId\] \}/)
  assert.match(billing, /current\.metadata\?\.organization_invitation_id/)
  assert.match(billing, /current\.metadata\?\.discount_fingerprint/)
  assert.match(billing, /current\.valid/)
  assert.match(billing, /invitation\.discount_status === 'applied'\) return null/)

  assert.match(webhook, /markOrganizationInvitationDiscountApplied/)
  assert.match(reconcile, /markOrganizationInvitationDiscountApplied/)
})

test('invite Coupon consumption is proven against the current canonical Checkout generation', () => {
  const billing = source('../server/utils/stripe-billing.ts')
  const verifierStart = billing.indexOf('async function consumeOrganizationInvitationCheckoutDiscount(')
  const verifierEnd = billing.indexOf('\nexport async function ensureOrganizationInvitationCheckoutDiscount(', verifierStart)
  assert.ok(verifierStart >= 0 && verifierEnd > verifierStart)
  const verifier = billing.slice(verifierStart, verifierEnd)
  const checkoutVerifierStart = billing.indexOf('async function retrieveAndAssertOrganizationInvitationCheckout(')
  const checkoutVerifierEnd = billing.indexOf(
    '\nasync function recoverOrganizationInvitationDiscountCheckoutBinding(',
    checkoutVerifierStart,
  )
  assert.ok(checkoutVerifierStart >= 0 && checkoutVerifierEnd > checkoutVerifierStart)
  const checkoutVerifier = billing.slice(checkoutVerifierStart, checkoutVerifierEnd)

  assert.match(checkoutVerifier, /input\.account\.stripe_checkout_session_id !== input\.checkoutSessionId/)
  assert.match(checkoutVerifier, /input\.account\.stripe_price_id !== input\.price\.id/)
  assert.match(verifier, /checkout\.status !== 'complete'/)
  assert.match(checkoutVerifier, /checkout\.client_reference_id !== input\.organizationId/)
  assert.match(checkoutVerifier, /checkout\.metadata\?\.organization_invitation_id !== input\.invitation\.id/)
  assert.match(checkoutVerifier, /checkout\.metadata\?\.invitation_discount_fingerprint !== input\.fingerprint/)
  assert.match(checkoutVerifier, /checkoutSessionCouponId\(checkout\) !== input\.expectedCouponId/)
  assert.match(checkoutVerifier, /!Number\.isSafeInteger\(line\?\.quantity\)/)
  assert.match(checkoutVerifier, /Number\(line\?\.quantity\) > MAX_LICENSED_SEATS/)
  assert.match(verifier, /subscription\.metadata\.organization_invitation_id !== invitation\.id/)
  assert.match(verifier, /subscription\.metadata\.invitation_discount_fingerprint !== input\.fingerprint/)
  assert.match(verifier, /plan\.priceId !== input\.price\.id/)
  assert.doesNotMatch(verifier, /plan\.quantity !== line\?\.quantity/)
  assert.doesNotMatch(checkoutVerifier, /organizationActiveMemberCount/)

  const canonicalizedAt = verifier.indexOf('await applyStripeSubscriptionSnapshot(')
  const consumedAt = verifier.indexOf('await persistOrganizationInvitationDiscountApplied(')
  assert.ok(canonicalizedAt >= 0 && consumedAt > canonicalizedAt)
})

test('a crash between account B and invitation B persistence safely recovers the exact Checkout', () => {
  const billing = source('../server/utils/stripe-billing.ts')
  const recoveryStart = billing.indexOf('async function recoverOrganizationInvitationDiscountCheckoutBinding(')
  const recoveryEnd = billing.indexOf(
    '\nasync function consumeOrganizationInvitationCheckoutDiscount(',
    recoveryStart,
  )
  assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart)
  const recovery = billing.slice(recoveryStart, recoveryEnd)

  assert.match(recovery, /\['assigned', 'checkout_created'\]\.includes/)
  assert.match(recovery, /invitation\.discount_status === 'assigned'[\s\S]*!account\?\.stripe_checkout_session_id/)
  assert.match(recovery, /account\.stripe_checkout_session_id === invitation\.discount_stripe_checkout_session_id/)
  assert.match(recovery, /retrieveAndAssertOrganizationInvitationCheckout/)
  assert.match(recovery, /checkoutSessionId: account\.stripe_checkout_session_id/)
  assert.match(recovery, /await rememberOrganizationInvitationDiscountCheckout/)
  assert.match(recovery, /rebound\.discount_stripe_checkout_session_id !== checkout\.id/)

  const ensureStart = billing.indexOf('export async function ensureOrganizationInvitationCheckoutDiscount(')
  const ensureEnd = billing.indexOf('\nexport function checkoutSessionCouponId(', ensureStart)
  const ensure = billing.slice(ensureStart, ensureEnd)
  const recoveredAt = ensure.indexOf('invitation = await recoverOrganizationInvitationDiscountCheckoutBinding(')
  const consumedAt = ensure.indexOf('consumeOrganizationInvitationCheckoutDiscount(')
  assert.ok(recoveredAt >= 0 && consumedAt > recoveredAt)
})

test('consumption proof survives 100% Checkout and later cancellation without requiring a current Subscription discount', () => {
  const billing = source('../server/utils/stripe-billing.ts')
  const verifierStart = billing.indexOf('async function consumeOrganizationInvitationCheckoutDiscount(')
  const verifierEnd = billing.indexOf('\nexport async function ensureOrganizationInvitationCheckoutDiscount(', verifierStart)
  const verifier = billing.slice(verifierStart, verifierEnd)

  assert.match(verifier, /checkout\.payment_status === 'paid'/)
  assert.match(verifier, /checkout\.payment_status === 'no_payment_required'/)
  assert.match(verifier, /subscription\.status === 'active'/)
  assert.match(verifier, /subscription\.status === 'trialing'/)
  assert.match(verifier, /latestInvoice\.status === 'paid'/)
  assert.doesNotMatch(verifier, /subscription\.discount/)
})

test('unpaid incomplete grants remain unconsumed but only terminal expiry may create a replacement Checkout', () => {
  const billing = source('../server/utils/stripe-billing.ts')
  const checkout = source('../server/api/org/[organizationSlug]/billing/checkout.post.ts')
  const verifierStart = billing.indexOf('async function consumeOrganizationInvitationCheckoutDiscount(')
  const verifierEnd = billing.indexOf('\nexport async function ensureOrganizationInvitationCheckoutDiscount(', verifierStart)
  const verifier = billing.slice(verifierStart, verifierEnd)

  assert.match(
    verifier,
    /subscription\.status === 'incomplete' \|\| subscription\.status === 'incomplete_expired'/,
  )
  assert.match(verifier, /Completed invitation Checkout requires billing review before retry/)
  assert.match(
    checkout,
    /status === 'incomplete_expired'/,
  )
  assert.match(checkout, /!retryingAssignedInvitationDiscount && status === 'canceled'/)
  const replacementHelperStart = checkout.indexOf('function subscriptionCanBeReplaced(')
  const replacementHelperEnd = checkout.indexOf('\nexport default defineEventHandler', replacementHelperStart)
  assert.doesNotMatch(
    checkout.slice(replacementHelperStart, replacementHelperEnd),
    /status === 'incomplete'/,
  )
  assert.match(
    checkout,
    /subscriptionCanBeReplaced\(subscription\.status, Boolean\(assignedDiscount\)\)/,
  )
  assert.ok(
    (checkout.match(/ensureOrganizationInvitationCheckoutDiscount\(/gu) ?? []).length >= 2,
    'a completed Checkout is verified again immediately before replacement',
  )
  assert.match(checkout, /The completed Checkout Session has no Subscription/)
  assert.match(checkout, /!config\.demoMode \|\| !isStripeResourceMissing\(error\)/)
})

test('ensure, webhook and reconcile share the same consumption verifier', () => {
  const billing = source('../server/utils/stripe-billing.ts')
  const ensureStart = billing.indexOf('export async function ensureOrganizationInvitationCheckoutDiscount(')
  const markStart = billing.indexOf('export async function markOrganizationInvitationDiscountApplied(')
  const accountStart = billing.indexOf('export async function organizationBillingAccount(', markStart)

  assert.ok(ensureStart >= 0 && markStart > ensureStart && accountStart > markStart)
  assert.match(
    billing.slice(ensureStart, markStart),
    /consumeOrganizationInvitationCheckoutDiscount/,
  )
  assert.match(
    billing.slice(markStart, accountStart),
    /consumeOrganizationInvitationCheckoutDiscount/,
  )
})
