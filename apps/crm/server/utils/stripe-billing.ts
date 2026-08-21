import { createHash } from 'node:crypto'
import Stripe from 'stripe'
import { isOpenExpertSameOriginJsonRequest } from '@openexpert/auth/server'
import { createError, type H3Event } from 'h3'
import {
  APPLICATION_MONTHLY_PLAN,
  BILLING_ACCESS_STATES,
  stripeSubscriptionAccessState,
  type BillingAccessState,
} from '~~/shared/organization-billing'
import type {
  OrganizationBillingHistory,
  OrganizationBillingInvoice,
  OrganizationSeatQuote,
} from '~~/shared/types/organization-seat-billing'
import type { OrganizationInvitationBillingDiscount } from '~~/shared/types/system-organizations'
import { invitationBillingDiscountLabel } from '~~/shared/organization-invitation-discount'
import type { CrmSession } from './crm'
import { serverDataBackend } from './data-api'
import { organizationInvitationBillingDiscountFromRow } from './organization-invitations'

interface StripeBillingRuntimeConfig {
  baseUrl?: string
  demoMode?: boolean
  secretKey?: string
  webhookSecret?: string
  applicationMonthlyPriceId?: string
  customerPortalConfigurationId?: string
}

export interface OrganizationBillingAccountRow {
  organization_id: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  stripe_checkout_session_id: string | null
  stripe_price_id: string | null
  stripe_subscription_item_id?: string | null
  licensed_seat_count?: number | null
  seat_revision?: number | null
  stripe_subscription_status: string | null
  livemode: boolean
  current_period_start: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  grace_until: string | null
  last_stripe_event_created_at: number
  last_synced_at: string | null
  created_at: string
  updated_at: string
}

export interface StripeSubscriptionSeatPlan {
  priceId: string
  subscriptionItemId: string
  quantity: number
  currentPeriodStart: string
  currentPeriodEnd: string
  currentPeriodStartTimestamp: number
  currentPeriodEndTimestamp: number
}

export interface StripeSeatUpdateResult {
  subscription: Stripe.Subscription
  plan: StripeSubscriptionSeatPlan
  invoiceId: string | null
  paymentUrl: string | null
  pending: boolean
  snapshotEventCreated: number
}

interface OrganizationInvitationDiscountRow {
  id: string
  organization_id: string | null
  organization_kind: 'intermediary' | 'application'
  status: 'pending' | 'accepted' | 'completed' | 'expired' | 'revoked'
  discount_kind: 'percentage' | 'fixed_amount' | null
  discount_percent_off_bps: number | null
  discount_amount_off_minor: number | null
  discount_currency: 'pln' | null
  discount_duration: 'once' | 'repeating' | 'forever' | null
  discount_duration_months: number | null
  discount_status: 'assigned' | 'checkout_created' | 'applied' | 'revoked' | null
  discount_stripe_coupon_id: string | null
  discount_stripe_checkout_session_id: string | null
  discount_stripe_subscription_id: string | null
  discount_livemode: boolean | null
  discount_applied_at: string | null
}

export interface OrganizationInvitationCheckoutDiscount {
  invitationId: string
  couponId: string
  fingerprint: string
  label: string
}

const PRICE_LOOKUP_KEY = 'openexpert_application_monthly_pln_inclusive_v2'
const STALE_STRIPE_SUBSCRIPTION_STATUS = 'Stripe subscription is not current for billing account'
const STRIPE_SEAT_QUANTITY_MISMATCH_STATUS = 'Stripe seat quantity does not match organization membership'
const GRACE_PERIOD_DAYS = 7
export const MAX_LICENSED_SEATS = 1_000
const STRIPE_API_VERSION = '2026-07-29.dahlia' as const

let cachedStripe: { secretKey: string, client: Stripe } | undefined
let cachedPrice: { secretKey: string, configuredPriceId: string, price: Stripe.Price } | undefined

const ORGANIZATION_INVITATION_DISCOUNT_SELECT = [
  'id',
  'organization_id',
  'organization_kind',
  'status',
  'discount_kind',
  'discount_percent_off_bps',
  'discount_amount_off_minor',
  'discount_currency',
  'discount_duration',
  'discount_duration_months',
  'discount_status',
  'discount_stripe_coupon_id',
  'discount_stripe_checkout_session_id',
  'discount_stripe_subscription_id',
  'discount_livemode',
  'discount_applied_at',
].join(', ')

function normalizedConfig(event: H3Event) {
  const raw = useRuntimeConfig(event).billing as StripeBillingRuntimeConfig
  const baseUrl = String(raw?.baseUrl || '').replace(/\/$/u, '')
  const secretKey = String(raw?.secretKey || '').trim()
  const webhookSecret = String(raw?.webhookSecret || '').trim()
  const applicationMonthlyPriceId = String(raw?.applicationMonthlyPriceId || '').trim()
  const customerPortalConfigurationId = String(raw?.customerPortalConfigurationId || '').trim()
  const demoMode = raw?.demoMode !== false
  return {
    baseUrl,
    secretKey,
    webhookSecret,
    applicationMonthlyPriceId,
    customerPortalConfigurationId,
    demoMode,
  }
}

function isTestSecretKey(value: string): boolean {
  return value.startsWith('sk_test_')
    || value.startsWith('rk_test_')
    || value.startsWith('rkcs_test_')
}

function isLiveSecretKey(value: string): boolean {
  return value.startsWith('sk_live_') || value.startsWith('rk_live_')
}

function isHttpBaseUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:')
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
  }
  catch {
    return false
  }
}

function configurationError(statusMessage: string): never {
  throw createError({ statusCode: 503, statusMessage })
}

export function stripeBillingConfiguration(event: H3Event) {
  return normalizedConfig(event)
}

export function isStripeBillingConfigured(event: H3Event): boolean {
  const config = normalizedConfig(event)
  return isHttpBaseUrl(config.baseUrl)
    && (isTestSecretKey(config.secretKey) || isLiveSecretKey(config.secretKey))
    && (!config.demoMode || isTestSecretKey(config.secretKey))
    && (config.demoMode || Boolean(config.webhookSecret))
    && (config.demoMode || Boolean(config.applicationMonthlyPriceId))
}

export function requireStripeBillingBrowserRequest(event: H3Event): void {
  const config = normalizedConfig(event)
  const headers = new Headers(event.headers)
  const contentType = headers.get('content-type')
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase()
  if (contentType && contentType !== 'application/json') {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }
  // The checkout and portal calls deliberately have an empty body. Supplying
  // the JSON media type to the shared check keeps those calls same-origin-only
  // while still rejecting cross-site HTML forms and non-JSON request bodies.
  if (!contentType) headers.set('content-type', 'application/json')
  if (!isOpenExpertSameOriginJsonRequest(headers, config.baseUrl)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }
}

export function stripeBillingExpectedLivemode(event: H3Event): boolean {
  const config = normalizedConfig(event)
  if (isTestSecretKey(config.secretKey)) return false
  if (isLiveSecretKey(config.secretKey)) return true
  configurationError('Stripe Billing key has an invalid format')
}

export function isStripeResourceMissing(error: unknown): boolean {
  return error instanceof Stripe.errors.StripeInvalidRequestError
    && error.code === 'resource_missing'
}

export function stripeBillingClient(event: H3Event): Stripe {
  const config = normalizedConfig(event)
  if (!config.secretKey) configurationError('Stripe Billing key is not configured')
  if (!isHttpBaseUrl(config.baseUrl)) configurationError('CRM billing base URL is invalid')
  if (!isTestSecretKey(config.secretKey) && !isLiveSecretKey(config.secretKey)) {
    configurationError('Stripe Billing key has an invalid format')
  }
  if (config.demoMode && !isTestSecretKey(config.secretKey)) {
    configurationError('Stripe demo mode requires a test-mode key')
  }
  if (cachedStripe?.secretKey === config.secretKey) return cachedStripe.client

  const client = new Stripe(config.secretKey, {
    apiVersion: STRIPE_API_VERSION,
    appInfo: {
      name: 'OpenExpert CRM',
      version: 'organization-billing-v1',
    },
  })
  cachedStripe = { secretKey: config.secretKey, client }
  return client
}

function assertApplicationMonthlyPrice(
  price: Stripe.Price,
  options: { requireActive: boolean } = { requireActive: true },
): Stripe.Price {
  const recurring = price.recurring
  if (
    (options.requireActive && !price.active)
    || price.currency !== APPLICATION_MONTHLY_PLAN.currency
    || price.unit_amount !== APPLICATION_MONTHLY_PLAN.unitAmount
    || price.tax_behavior !== 'inclusive'
    || price.type !== 'recurring'
    || price.billing_scheme !== 'per_unit'
    || price.custom_unit_amount !== null
    || price.tiers_mode !== null
    || price.transform_quantity !== null
    || recurring?.interval !== APPLICATION_MONTHLY_PLAN.interval
    || recurring.interval_count !== APPLICATION_MONTHLY_PLAN.intervalCount
    || recurring.usage_type !== 'licensed'
  ) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Configured Stripe Price must be a fixed 200 PLN monthly per-seat price',
    })
  }
  return price
}

export async function applicationMonthlyPrice(event: H3Event): Promise<Stripe.Price> {
  const config = normalizedConfig(event)
  const stripe = stripeBillingClient(event)
  if (
    cachedPrice?.secretKey === config.secretKey
    && cachedPrice.configuredPriceId === config.applicationMonthlyPriceId
  ) return cachedPrice.price

  let price: Stripe.Price | undefined
  if (config.applicationMonthlyPriceId) {
    const retrieved = await stripe.prices.retrieve(config.applicationMonthlyPriceId)
    if (!('deleted' in retrieved && retrieved.deleted)) price = retrieved as Stripe.Price
  }
  else if (config.demoMode) {
    const existing = await stripe.prices.list({
      active: true,
      lookup_keys: [PRICE_LOOKUP_KEY],
      limit: 10,
    })
    price = existing.data.find(candidate => {
      try {
        assertApplicationMonthlyPrice(candidate)
        return true
      }
      catch {
        return false
      }
    })

    if (!price) {
      const product = await stripe.products.create({
        name: 'OpenExpert — miejsce w Aplikacji',
        description: 'Miesięczna licencja użytkownika organizacji typu Aplikacja.',
        metadata: { plan_code: APPLICATION_MONTHLY_PLAN.code },
      }, { idempotencyKey: 'openexpert-application-product-v1' })
      price = await stripe.prices.create({
        active: true,
        currency: APPLICATION_MONTHLY_PLAN.currency,
        unit_amount: APPLICATION_MONTHLY_PLAN.unitAmount,
        tax_behavior: 'inclusive',
        product: product.id,
        lookup_key: PRICE_LOOKUP_KEY,
        recurring: {
          interval: APPLICATION_MONTHLY_PLAN.interval,
          interval_count: APPLICATION_MONTHLY_PLAN.intervalCount,
        },
        metadata: { plan_code: APPLICATION_MONTHLY_PLAN.code },
      }, { idempotencyKey: 'openexpert-application-monthly-price-inclusive-v2' })
    }
  }
  else {
    configurationError('Stripe monthly Price ID is not configured')
  }

  if (!price) configurationError('Stripe monthly Price could not be loaded')
  const validated = assertApplicationMonthlyPrice(price)
  cachedPrice = {
    secretKey: config.secretKey,
    configuredPriceId: config.applicationMonthlyPriceId,
    price: validated,
  }
  return validated
}

function invitationDiscountCanonicalValue(discount: OrganizationInvitationBillingDiscount): string {
  return [
    'application_monthly',
    discount.kind,
    discount.kind === 'percentage' ? discount.percentOffBps : discount.amountOffMinor,
    discount.kind === 'fixed_amount' ? discount.currency : '',
    discount.duration,
    discount.duration === 'repeating' ? discount.durationMonths : '',
  ].join('|')
}

export function organizationInvitationDiscountFingerprint(
  discount: OrganizationInvitationBillingDiscount,
): string {
  return createHash('sha256')
    .update(invitationDiscountCanonicalValue(discount), 'utf8')
    .digest('hex')
}

export function organizationInvitationStripeCouponId(
  invitationId: string,
  discount: OrganizationInvitationBillingDiscount,
): string {
  const normalizedInvitationId = invitationId.replaceAll('-', '')
  if (!/^[0-9a-f]{32}$/iu.test(normalizedInvitationId)) {
    throw createError({ statusCode: 500, statusMessage: 'Organization invitation discount is invalid' })
  }
  return `oe_inv_${normalizedInvitationId}_${organizationInvitationDiscountFingerprint(discount).slice(0, 12)}`
}

function organizationInvitationDiscountRow(
  value: unknown,
): OrganizationInvitationDiscountRow {
  return value as OrganizationInvitationDiscountRow
}

async function findOrganizationInvitationDiscount(
  event: H3Event,
  organizationId: string,
): Promise<OrganizationInvitationDiscountRow | null> {
  const backend = serverDataBackend(event) as any
  const result = await backend
    .from('organization_onboarding_invitations')
    .select(ORGANIZATION_INVITATION_DISCOUNT_SELECT)
    .eq('organization_id', organizationId)
    .maybeSingle()
  if (result.error) {
    throw createError({ statusCode: 500, statusMessage: 'Organization invitation discount is unavailable' })
  }
  return result.data ? organizationInvitationDiscountRow(result.data) : null
}

function invitationDiscountTerms(
  invitation: OrganizationInvitationDiscountRow,
): OrganizationInvitationBillingDiscount | null {
  return organizationInvitationBillingDiscountFromRow(invitation)
}

function stripePriceProductId(price: Stripe.Price): string {
  const productId = typeof price.product === 'string'
    ? price.product
    : price.product?.id
  if (!productId || !productId.startsWith('prod_')) {
    throw createError({ statusCode: 503, statusMessage: 'Configured Stripe Product is invalid' })
  }
  return productId
}

function stripeCouponId(value: Stripe.Coupon | Stripe.DeletedCoupon | string | null | undefined): string | null {
  if (!value) return null
  return typeof value === 'string' ? value : value.id
}

function assertInvitationStripeCoupon(
  coupon: Stripe.Coupon | Stripe.DeletedCoupon,
  input: {
    expectedCouponId: string
    expectedLivemode: boolean
    expectedProductId: string
    invitationId: string
    fingerprint: string
    discount: OrganizationInvitationBillingDiscount
  },
): Stripe.Coupon {
  if ('deleted' in coupon && coupon.deleted) {
    throw createError({ statusCode: 409, statusMessage: 'Assigned Stripe coupon was deleted' })
  }
  const current = coupon as Stripe.Coupon
  const products = current.applies_to?.products ?? []
  const expectedPercentOff = input.discount.kind === 'percentage'
    ? input.discount.percentOffBps / 100
    : null
  const expectedAmountOff = input.discount.kind === 'fixed_amount'
    ? input.discount.amountOffMinor
    : null
  const expectedCurrency = input.discount.kind === 'fixed_amount'
    ? input.discount.currency
    : null
  if (
    current.id !== input.expectedCouponId
    || current.livemode !== input.expectedLivemode
    || !current.valid
    || current.duration !== input.discount.duration
    || (current.duration === 'repeating'
      ? current.duration_in_months !== input.discount.durationMonths
      : current.duration_in_months != null)
    || current.percent_off !== expectedPercentOff
    || current.amount_off !== expectedAmountOff
    || current.currency !== expectedCurrency
    || products.length !== 1
    || products[0] !== input.expectedProductId
    || current.metadata?.organization_invitation_id !== input.invitationId
    || current.metadata?.discount_fingerprint !== input.fingerprint
    || (current.redeem_by !== null && current.redeem_by <= Math.floor(Date.now() / 1_000))
    || (current.max_redemptions !== null
      && current.times_redeemed >= current.max_redemptions)
  ) {
    throw createError({ statusCode: 409, statusMessage: 'Assigned Stripe coupon does not match the invitation offer' })
  }
  return current
}

async function persistInvitationStripeCoupon(
  event: H3Event,
  invitation: OrganizationInvitationDiscountRow,
  coupon: Stripe.Coupon,
): Promise<void> {
  if (
    invitation.discount_stripe_coupon_id === coupon.id
    && invitation.discount_livemode === coupon.livemode
  ) return
  if (
    invitation.discount_stripe_coupon_id
    || invitation.discount_livemode !== null
    || invitation.discount_status !== 'assigned'
  ) {
    throw createError({ statusCode: 409, statusMessage: 'Invitation discount changed while Stripe Checkout was prepared' })
  }

  const backend = serverDataBackend(event) as any
  const result = await backend
    .from('organization_onboarding_invitations')
    .update({
      discount_stripe_coupon_id: coupon.id,
      discount_livemode: coupon.livemode,
    })
    .eq('id', invitation.id)
    .eq('discount_status', 'assigned')
    .is('discount_stripe_coupon_id', null)
    .is('discount_livemode', null)
    .select('id')
    .maybeSingle()
  if (result.error) {
    throw createError({ statusCode: 500, statusMessage: 'Assigned Stripe coupon could not be saved' })
  }
  if (result.data) return

  const current = await findOrganizationInvitationDiscount(event, String(invitation.organization_id))
  if (
    !current
    || current.discount_stripe_coupon_id !== coupon.id
    || current.discount_livemode !== coupon.livemode
  ) {
    throw createError({ statusCode: 409, statusMessage: 'Invitation discount changed concurrently' })
  }
}

function checkoutLinePriceId(line: Stripe.LineItem | undefined): string | null {
  if (!line?.price) return null
  return typeof line.price === 'string' ? line.price : line.price.id
}

async function retrieveAndAssertOrganizationInvitationCheckout(
  event: H3Event,
  input: {
    organizationId: string
    invitation: OrganizationInvitationDiscountRow
    fingerprint: string
    expectedCouponId: string
    price: Stripe.Price
    account: OrganizationBillingAccountRow
    checkoutSessionId: string
  },
): Promise<Stripe.Checkout.Session | null> {
  if (
    !input.account.stripe_customer_id
    || input.account.stripe_checkout_session_id !== input.checkoutSessionId
    || input.account.stripe_price_id !== input.price.id
    || input.account.livemode !== input.invitation.discount_livemode
  ) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Invitation discount is not bound to the current billing Checkout',
    })
  }

  let checkout: Stripe.Checkout.Session
  try {
    checkout = await stripeBillingClient(event).checkout.sessions.retrieve(input.checkoutSessionId, {
      expand: ['line_items.data.price', 'discounts.coupon'],
    })
  }
  catch (error) {
    // Stripe test objects can be removed while resetting the local demo. Live
    // references are durable correlation data and therefore fail closed.
    if (normalizedConfig(event).demoMode && isStripeResourceMissing(error)) return null
    throw error
  }

  const lineItems = checkout.line_items
  const line = lineItems?.data[0]
  const checkoutCustomerId = stripeObjectId(checkout.customer)
  if (
    checkout.id !== input.checkoutSessionId
    || checkout.mode !== 'subscription'
    || !['open', 'complete', 'expired'].includes(String(checkout.status))
    || checkout.client_reference_id !== input.organizationId
    || checkout.metadata?.organization_id !== input.organizationId
    || checkout.metadata?.organization_invitation_id !== input.invitation.id
    || checkout.metadata?.invitation_discount_fingerprint !== input.fingerprint
    || checkout.metadata?.plan_code !== APPLICATION_MONTHLY_PLAN.code
    || checkout.metadata?.billing_model !== 'per_seat_v1'
    || checkoutCustomerId !== input.account.stripe_customer_id
    || checkout.livemode !== input.account.livemode
    || !lineItems
    || lineItems.has_more
    || lineItems.data.length !== 1
    || checkoutLinePriceId(line) !== input.price.id
    || !Number.isSafeInteger(line?.quantity)
    || Number(line?.quantity) < 1
    || Number(line?.quantity) > MAX_LICENSED_SEATS
    || checkoutSessionCouponId(checkout) !== input.expectedCouponId
  ) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Invitation discount Checkout does not match the assigned offer',
    })
  }
  return checkout
}

async function recoverOrganizationInvitationDiscountCheckoutBinding(
  event: H3Event,
  input: {
    organizationId: string
    invitation: OrganizationInvitationDiscountRow
    fingerprint: string
    expectedCouponId: string
    price: Stripe.Price
  },
): Promise<OrganizationInvitationDiscountRow> {
  const invitation = input.invitation
  if (!['assigned', 'checkout_created'].includes(String(invitation.discount_status))) {
    return invitation
  }
  // Normal pre-Checkout provisioning starts in `assigned` without external
  // identifiers. Recovery starts only after the deterministic Coupon/mode was
  // persisted and a current billing Session exists.
  if (
    invitation.discount_status === 'assigned'
    && (!invitation.discount_stripe_coupon_id || invitation.discount_livemode === null)
  ) return invitation
  const account = await organizationBillingAccount(event, input.organizationId)
  if (
    invitation.discount_status === 'assigned'
    && !account?.stripe_checkout_session_id
  ) return invitation
  if (
    invitation.organization_id !== input.organizationId
    || invitation.organization_kind !== 'application'
    || !['accepted', 'completed'].includes(invitation.status)
    || invitation.discount_stripe_coupon_id !== input.expectedCouponId
    || invitation.discount_livemode !== input.price.livemode
    || invitation.discount_livemode !== stripeBillingExpectedLivemode(event)
  ) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Invitation discount Checkout recovery correlation is inconsistent',
    })
  }
  if (
    account?.stripe_checkout_session_id
    && account.stripe_checkout_session_id === invitation.discount_stripe_checkout_session_id
  ) return invitation
  if (!account?.stripe_checkout_session_id) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Invitation discount has no current billing Checkout',
    })
  }

  // Crash recovery for the two-step Session saga: the billing account is
  // written before the invitation projection. Adopt B only after Stripe proves
  // that B is the exact current Session carrying this immutable invite offer.
  const checkout = await retrieveAndAssertOrganizationInvitationCheckout(event, {
    organizationId: input.organizationId,
    invitation,
    fingerprint: input.fingerprint,
    expectedCouponId: input.expectedCouponId,
    price: input.price,
    account,
    checkoutSessionId: account.stripe_checkout_session_id,
  })
  if (!checkout) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Current invitation Checkout could not be verified',
    })
  }
  await rememberOrganizationInvitationDiscountCheckout(event, {
    organizationId: input.organizationId,
    invitationId: invitation.id,
    couponId: input.expectedCouponId,
    checkoutSessionId: checkout.id,
    livemode: checkout.livemode,
  })
  const rebound = await findOrganizationInvitationDiscount(event, input.organizationId)
  if (
    !rebound
    || rebound.id !== invitation.id
    || rebound.discount_status !== 'checkout_created'
    || rebound.discount_stripe_checkout_session_id !== checkout.id
    || rebound.discount_livemode !== checkout.livemode
  ) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Invitation discount Checkout recovery lost a concurrent update',
    })
  }
  return rebound
}

async function consumeOrganizationInvitationCheckoutDiscount(
  event: H3Event,
  input: {
    organizationId: string
    invitation: OrganizationInvitationDiscountRow
    fingerprint: string
    expectedCouponId: string
    price: Stripe.Price
    expectedCheckoutSessionId?: string
    expectedSubscriptionId?: string
    expectedLivemode?: boolean
  },
): Promise<boolean> {
  const invitation = input.invitation
  if (invitation.discount_status !== 'checkout_created') return false
  const checkoutSessionId = invitation.discount_stripe_checkout_session_id
  if (
    invitation.organization_id !== input.organizationId
    || invitation.organization_kind !== 'application'
    || !['accepted', 'completed'].includes(invitation.status)
    || !checkoutSessionId
    || invitation.discount_stripe_coupon_id !== input.expectedCouponId
    || invitation.discount_livemode === null
    || invitation.discount_livemode !== input.price.livemode
    || invitation.discount_livemode !== stripeBillingExpectedLivemode(event)
    || (input.expectedCheckoutSessionId
      && checkoutSessionId !== input.expectedCheckoutSessionId)
    || (input.expectedLivemode !== undefined
      && invitation.discount_livemode !== input.expectedLivemode)
  ) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Invitation discount Checkout correlation is inconsistent',
    })
  }

  // The billing account is the current Checkout generation fence. A stale
  // invitation projection must never inspect (or consume) a previous Session
  // after the account has already advanced to a replacement Checkout.
  const account = await organizationBillingAccount(event, input.organizationId)
  if (!account) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Invitation discount has no billing account',
    })
  }
  const checkout = await retrieveAndAssertOrganizationInvitationCheckout(event, {
    organizationId: input.organizationId,
    invitation,
    fingerprint: input.fingerprint,
    expectedCouponId: input.expectedCouponId,
    price: input.price,
    account,
    checkoutSessionId,
  })
  if (!checkout) return false
  const checkoutCustomerId = stripeObjectId(checkout.customer)

  if (checkout.status !== 'complete') {
    if (checkout.status !== 'open' && checkout.status !== 'expired') {
      throw createError({ statusCode: 409, statusMessage: 'Invitation Checkout status is invalid' })
    }
    return false
  }
  const subscriptionId = checkoutSubscriptionId(checkout)
  if (!subscriptionId || (
    input.expectedSubscriptionId
    && subscriptionId !== input.expectedSubscriptionId
  )) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Completed invitation Checkout has no matching Subscription',
    })
  }

  const subscription = await stripeBillingClient(event).subscriptions.retrieve(subscriptionId, {
    expand: ['items.data.price', 'latest_invoice'],
  })
  const plan = await stripeSubscriptionSeatPlan(event, subscription, input.organizationId)
  if (
    subscription.id !== subscriptionId
    || stripeObjectId(subscription.customer) !== checkoutCustomerId
    || subscription.livemode !== checkout.livemode
    || subscription.metadata.organization_id !== input.organizationId
    || subscription.metadata.organization_invitation_id !== invitation.id
    || subscription.metadata.invitation_discount_fingerprint !== input.fingerprint
    || subscription.metadata.plan_code !== APPLICATION_MONTHLY_PLAN.code
    || subscription.metadata.billing_model !== 'per_seat_v1'
    || plan.priceId !== input.price.id
  ) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Invitation discount Subscription does not match its Checkout',
    })
  }

  const checkoutPaymentSettled = checkout.payment_status === 'paid'
    || checkout.payment_status === 'no_payment_required'
  const subscriptionActivated = subscription.status === 'active'
    || subscription.status === 'trialing'
  let latestInvoicePaid = false
  if (!checkoutPaymentSettled && !subscriptionActivated) {
    const latestInvoice = await expandedLatestInvoice(event, subscription)
    if (latestInvoice) {
      const latestInvoiceId = stripeObjectId(subscription.latest_invoice)
      if (
        latestInvoice.id !== latestInvoiceId
        || invoiceSubscriptionId(latestInvoice) !== subscription.id
        || stripeObjectId(latestInvoice.customer) !== checkoutCustomerId
        || latestInvoice.livemode !== subscription.livemode
      ) {
        throw createError({
          statusCode: 409,
          statusMessage: 'Invitation discount Subscription invoice is inconsistent',
        })
      }
      latestInvoicePaid = latestInvoice.status === 'paid'
    }
  }

  if (!checkoutPaymentSettled && !subscriptionActivated && !latestInvoicePaid) {
    // Keep the grant unconsumed while Stripe is still resolving the unpaid
    // first Subscription. Checkout replacement is permitted only after the
    // terminal `incomplete_expired` state; `incomplete` must first be paid or
    // expire. Other completed-but-unpaid states (notably a manually canceled
    // open invoice) fail closed instead of silently granting a second discount.
    if (subscription.status === 'incomplete' || subscription.status === 'incomplete_expired') {
      return false
    }
    throw createError({
      statusCode: 409,
      statusMessage: 'Completed invitation Checkout requires billing review before retry',
    })
  }

  const accountEventCreated = Number(account.last_stripe_event_created_at || 0)
  if (!Number.isSafeInteger(accountEventCreated) || accountEventCreated < 0) {
    throw createError({ statusCode: 409, statusMessage: 'Stripe billing snapshot timestamp is invalid' })
  }

  // First make the exact Checkout/Subscription pair canonical in the billing
  // account. The invitation transition follows and is fenced again by the DB
  // trigger, so a concurrent replacement cannot consume the wrong generation.
  const snapshot = await applyStripeSubscriptionSnapshot(
    event,
    subscription,
    accountEventCreated,
    checkout.id,
  )
  if (snapshot.organizationId !== input.organizationId) {
    throw createError({ statusCode: 409, statusMessage: 'Invitation billing snapshot is inconsistent' })
  }
  await persistOrganizationInvitationDiscountApplied(event, {
    organizationId: input.organizationId,
    checkoutSessionId: checkout.id,
    subscriptionId: subscription.id,
    livemode: subscription.livemode,
  })
  return true
}

export async function ensureOrganizationInvitationCheckoutDiscount(
  event: H3Event,
  organizationId: string,
  price: Stripe.Price,
): Promise<OrganizationInvitationCheckoutDiscount | null> {
  let invitation = await findOrganizationInvitationDiscount(event, organizationId)
  if (!invitation || !invitation.discount_kind) return null
  if (
    invitation.organization_id !== organizationId
    || invitation.organization_kind !== 'application'
    || !['accepted', 'completed'].includes(invitation.status)
    || !invitation.discount_status
    || invitation.discount_status === 'revoked'
  ) {
    throw createError({ statusCode: 409, statusMessage: 'Invitation discount is not available for this organization' })
  }

  // An invitation grant is applied to the first successfully activated
  // subscription only. Its Stripe duration controls how many invoices inside
  // that subscription are discounted; a later re-subscribe requires a new
  // explicit offer instead of silently granting the onboarding coupon again.
  if (invitation.discount_status === 'applied') return null

  const discount = invitationDiscountTerms(invitation)
  if (!discount) {
    throw createError({ statusCode: 500, statusMessage: 'Invitation discount terms are incomplete' })
  }
  const fingerprint = organizationInvitationDiscountFingerprint(discount)
  const expectedCouponId = organizationInvitationStripeCouponId(invitation.id, discount)
  const durationInMonths = discount.duration === 'repeating'
    ? discount.durationMonths
    : null
  if (
    discount.duration === 'repeating'
    && (!Number.isSafeInteger(durationInMonths) || Number(durationInMonths) < 1)
  ) {
    throw createError({ statusCode: 500, statusMessage: 'Invitation discount duration is incomplete' })
  }
  if (
    invitation.discount_stripe_coupon_id
    && invitation.discount_stripe_coupon_id !== expectedCouponId
  ) {
    throw createError({ statusCode: 409, statusMessage: 'Invitation Stripe coupon is inconsistent' })
  }

  invitation = await recoverOrganizationInvitationDiscountCheckoutBinding(event, {
    organizationId,
    invitation,
    fingerprint,
    expectedCouponId,
    price,
  })

  if (await consumeOrganizationInvitationCheckoutDiscount(event, {
    organizationId,
    invitation,
    fingerprint,
    expectedCouponId,
    price,
  })) return null

  const stripe = stripeBillingClient(event)
  const expectedProductId = stripePriceProductId(price)
  let coupon: Stripe.Coupon | Stripe.DeletedCoupon
  try {
    coupon = await stripe.coupons.retrieve(expectedCouponId)
  }
  catch (error) {
    if (!isStripeResourceMissing(error)) throw error
    coupon = await stripe.coupons.create({
      id: expectedCouponId,
      name: invitationBillingDiscountLabel(discount).slice(0, 40),
      duration: discount.duration,
      ...(discount.duration === 'repeating'
        ? { duration_in_months: Number(durationInMonths) }
        : {}),
      ...(discount.kind === 'percentage'
        ? { percent_off: discount.percentOffBps / 100 }
        : {
            amount_off: discount.amountOffMinor,
            currency: discount.currency,
          }),
      applies_to: { products: [expectedProductId] },
      metadata: {
        organization_invitation_id: invitation.id,
        organization_id: organizationId,
        plan_code: APPLICATION_MONTHLY_PLAN.code,
        discount_fingerprint: fingerprint,
      },
    }, {
      idempotencyKey: `openexpert-invitation-coupon-${invitation.id}-${fingerprint.slice(0, 12)}`,
    })
  }

  const validated = assertInvitationStripeCoupon(coupon, {
    expectedCouponId,
    expectedLivemode: price.livemode,
    expectedProductId,
    invitationId: invitation.id,
    fingerprint,
    discount,
  })
  await persistInvitationStripeCoupon(event, invitation, validated)
  return {
    invitationId: invitation.id,
    couponId: validated.id,
    fingerprint,
    label: invitationBillingDiscountLabel(discount),
  }
}

export function checkoutSessionCouponId(session: Stripe.Checkout.Session): string | null {
  const discounts = (session as unknown as {
    discounts?: Array<{
      coupon?: Stripe.Coupon | Stripe.DeletedCoupon | string | null
      promotion_code?: string | { id?: string } | null
    }> | null
  }).discounts ?? []
  if (discounts.length !== 1 || discounts[0]?.promotion_code) return null
  return stripeCouponId(discounts[0]?.coupon)
}

export async function rememberOrganizationInvitationDiscountCheckout(
  event: H3Event,
  input: {
    organizationId: string
    invitationId: string
    couponId: string
    checkoutSessionId: string
    livemode: boolean
  },
): Promise<void> {
  const invitation = await findOrganizationInvitationDiscount(event, input.organizationId)
  if (
    !invitation
    || invitation.id !== input.invitationId
    || invitation.discount_stripe_coupon_id !== input.couponId
    || invitation.discount_livemode !== input.livemode
    || !['assigned', 'checkout_created'].includes(String(invitation.discount_status))
  ) {
    throw createError({ statusCode: 409, statusMessage: 'Invitation discount cannot be bound to this Checkout Session' })
  }
  if (
    invitation.discount_status === 'checkout_created'
    && invitation.discount_stripe_checkout_session_id === input.checkoutSessionId
  ) return

  const backend = serverDataBackend(event) as any
  const result = await backend
    .from('organization_onboarding_invitations')
    .update({
      discount_status: 'checkout_created',
      discount_stripe_checkout_session_id: input.checkoutSessionId,
      discount_stripe_subscription_id: null,
      discount_applied_at: null,
    })
    .eq('id', invitation.id)
    .in('discount_status', ['assigned', 'checkout_created'])
    .eq('discount_stripe_coupon_id', input.couponId)
    .eq('discount_livemode', input.livemode)
    .select('id, discount_stripe_checkout_session_id')
    .maybeSingle()
  if (result.error) {
    throw createError({ statusCode: 500, statusMessage: 'Invitation discount Checkout Session could not be saved' })
  }
  if (!result.data) {
    const current = await findOrganizationInvitationDiscount(event, input.organizationId)
    if (
      current?.discount_status !== 'checkout_created'
      || current.discount_stripe_checkout_session_id !== input.checkoutSessionId
    ) {
      throw createError({ statusCode: 409, statusMessage: 'Invitation discount changed concurrently' })
    }
  }
}

async function persistOrganizationInvitationDiscountApplied(
  event: H3Event,
  input: {
    organizationId: string
    checkoutSessionId: string
    subscriptionId: string
    livemode: boolean
  },
): Promise<void> {
  const invitation = await findOrganizationInvitationDiscount(event, input.organizationId)
  if (!invitation?.discount_kind) return
  if (
    invitation.discount_status === 'applied'
    && invitation.discount_stripe_checkout_session_id === input.checkoutSessionId
    && invitation.discount_stripe_subscription_id === input.subscriptionId
    && invitation.discount_livemode === input.livemode
  ) return
  if (
    invitation.discount_status !== 'checkout_created'
    || invitation.discount_stripe_checkout_session_id !== input.checkoutSessionId
    || invitation.discount_livemode !== input.livemode
  ) {
    throw createError({ statusCode: 409, statusMessage: 'Applied Stripe discount does not match the invitation grant' })
  }

  const backend = serverDataBackend(event) as any
  const result = await backend
    .from('organization_onboarding_invitations')
    .update({
      discount_status: 'applied',
      discount_stripe_subscription_id: input.subscriptionId,
      discount_applied_at: new Date().toISOString(),
    })
    .eq('id', invitation.id)
    .eq('discount_status', 'checkout_created')
    .eq('discount_stripe_checkout_session_id', input.checkoutSessionId)
    .eq('discount_livemode', input.livemode)
    .select('id')
    .maybeSingle()
  if (result.error) {
    throw createError({ statusCode: 500, statusMessage: 'Applied invitation discount could not be saved' })
  }
  if (!result.data) {
    const current = await findOrganizationInvitationDiscount(event, input.organizationId)
    if (
      current?.discount_status !== 'applied'
      || current.discount_stripe_checkout_session_id !== input.checkoutSessionId
      || current.discount_stripe_subscription_id !== input.subscriptionId
    ) {
      throw createError({ statusCode: 409, statusMessage: 'Invitation discount changed concurrently' })
    }
  }
}

export async function markOrganizationInvitationDiscountApplied(
  event: H3Event,
  input: {
    organizationId: string
    checkoutSessionId: string
    subscriptionId: string
    livemode: boolean
  },
): Promise<void> {
  let invitation = await findOrganizationInvitationDiscount(event, input.organizationId)
  if (!invitation?.discount_kind) return
  if (
    invitation.discount_status === 'applied'
    && invitation.discount_stripe_checkout_session_id === input.checkoutSessionId
    && invitation.discount_stripe_subscription_id === input.subscriptionId
    && invitation.discount_livemode === input.livemode
  ) return
  if (
    !['assigned', 'checkout_created'].includes(String(invitation.discount_status))
    || invitation.discount_livemode !== input.livemode
  ) {
    throw createError({ statusCode: 409, statusMessage: 'Applied Stripe discount does not match the invitation grant' })
  }

  const discount = invitationDiscountTerms(invitation)
  if (!discount) {
    throw createError({ statusCode: 500, statusMessage: 'Invitation discount terms are incomplete' })
  }
  const fingerprint = organizationInvitationDiscountFingerprint(discount)
  const expectedCouponId = organizationInvitationStripeCouponId(invitation.id, discount)
  const price = await applicationMonthlyPrice(event)
  invitation = await recoverOrganizationInvitationDiscountCheckoutBinding(event, {
    organizationId: input.organizationId,
    invitation,
    fingerprint,
    expectedCouponId,
    price,
  })
  if (invitation.discount_stripe_checkout_session_id !== input.checkoutSessionId) {
    throw createError({ statusCode: 409, statusMessage: 'Applied Stripe discount does not match the current Checkout' })
  }
  const consumed = await consumeOrganizationInvitationCheckoutDiscount(event, {
    organizationId: input.organizationId,
    invitation,
    fingerprint,
    expectedCouponId,
    price,
    expectedCheckoutSessionId: input.checkoutSessionId,
    expectedSubscriptionId: input.subscriptionId,
    expectedLivemode: input.livemode,
  })
  if (!consumed) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Invitation discount has no successful Checkout consumption proof',
    })
  }
}

export async function organizationBillingAccount(
  event: H3Event,
  organizationId: string,
): Promise<OrganizationBillingAccountRow | null> {
  const backend = serverDataBackend(event) as any
  const result = await backend
    .from('organization_billing_accounts')
    .select('*')
    .eq('organization_id', organizationId)
    .maybeSingle()
  if (result.error) throw createError({ statusCode: 500, statusMessage: result.error.message })
  return result.data as OrganizationBillingAccountRow | null
}

export async function organizationCheckoutSeatTarget(
  event: H3Event,
  organizationId: string,
  activeMembers: number,
  account?: OrganizationBillingAccountRow | null,
): Promise<{ seats: number, invitationId: string | null }> {
  if (
    !Number.isSafeInteger(activeMembers)
    || activeMembers < 1
    || activeMembers > MAX_LICENSED_SEATS
  ) {
    throw createError({ statusCode: 409, statusMessage: 'Organization member count is invalid' })
  }

  const licensedSeats = Number(account?.licensed_seat_count)
  if (account?.stripe_subscription_item_id) {
    if (
      !Number.isSafeInteger(licensedSeats)
      || licensedSeats < activeMembers
      || licensedSeats > MAX_LICENSED_SEATS
    ) {
      throw createError({ statusCode: 409, statusMessage: 'Organization paid seat capacity is invalid' })
    }
    return { seats: licensedSeats, invitationId: null }
  }

  const backend = serverDataBackend(event) as any
  const invitation = await backend
    .from('organization_onboarding_invitations')
    .select('id, initial_seat_count')
    .eq('organization_id', organizationId)
    .eq('organization_kind', 'application')
    .in('status', ['accepted', 'completed'])
    .limit(1)
    .maybeSingle()
  if (invitation.error) {
    throw createError({ statusCode: 500, statusMessage: invitation.error.message })
  }
  if (!invitation.data) {
    // Compatibility with the historical direct /onboarding path is limited to
    // its original one-owner shape. Multi-seat Checkout always needs the
    // immutable registration/invitation authority checked again by 0078.
    if (activeMembers !== 1) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Multi-seat Checkout requires a registration seat offer',
      })
    }
    return { seats: 1, invitationId: null }
  }

  const requestedSeats = Number(invitation.data.initial_seat_count)
  if (
    !Number.isSafeInteger(requestedSeats)
    || requestedSeats < activeMembers
    || requestedSeats > MAX_LICENSED_SEATS
  ) {
    throw createError({ statusCode: 409, statusMessage: 'Registration seat capacity is invalid' })
  }
  return {
    seats: requestedSeats,
    invitationId: String(invitation.data.id),
  }
}

export async function ensureOrganizationStripeCustomer(
  event: H3Event,
  session: CrmSession,
): Promise<string> {
  const stripe = stripeBillingClient(event)
  const backend = serverDataBackend(event) as any
  const existing = await organizationBillingAccount(event, session.organizationId)

  if (existing?.stripe_customer_id) {
    const customer = await stripe.customers.retrieve(existing.stripe_customer_id)
    if (!customer.deleted) return customer.id
  }

  const customer = await stripe.customers.create({
    email: session.email || undefined,
    name: session.organizationName,
    preferred_locales: ['pl'],
    metadata: {
      organization_id: session.organizationId,
      organization_slug: session.organizationSlug,
    },
  }, {
    idempotencyKey: existing?.stripe_customer_id
      ? `openexpert-organization-customer-${session.organizationId}-after-${existing.stripe_customer_id}`
      : `openexpert-organization-customer-${session.organizationId}-initial`,
  })

  const upsert = await backend
    .from('organization_billing_accounts')
    .upsert({
      organization_id: session.organizationId,
      stripe_customer_id: customer.id,
      livemode: customer.livemode,
    }, { onConflict: 'organization_id' })
  if (upsert.error) throw createError({ statusCode: 500, statusMessage: upsert.error.message })
  return customer.id
}

export async function rememberCheckoutSession(
  event: H3Event,
  input: {
    organizationId: string
    customerId: string
    checkoutSessionId: string
    priceId: string
    livemode: boolean
  },
): Promise<void> {
  const backend = serverDataBackend(event) as any
  const result = await backend
    .from('organization_billing_accounts')
    .upsert({
      organization_id: input.organizationId,
      stripe_customer_id: input.customerId,
      stripe_checkout_session_id: input.checkoutSessionId,
      stripe_price_id: input.priceId,
      livemode: input.livemode,
    }, { onConflict: 'organization_id' })
  if (result.error) throw createError({ statusCode: 500, statusMessage: result.error.message })
}

function stripeObjectId(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null
  return typeof value === 'string' ? value : value.id
}

function timestamp(value: number): string {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw createError({ statusCode: 409, statusMessage: 'Stripe subscription period is invalid' })
  }
  const date = new Date(value * 1000)
  if (!Number.isFinite(date.getTime())) {
    throw createError({ statusCode: 409, statusMessage: 'Stripe subscription period is invalid' })
  }
  return date.toISOString()
}

export async function stripeSubscriptionSeatPlan(
  event: H3Event,
  subscription: Stripe.Subscription,
  organizationId: string,
): Promise<StripeSubscriptionSeatPlan> {
  if (subscription.items.has_more || subscription.items.data.length !== 1) {
    throw createError({ statusCode: 409, statusMessage: 'Stripe subscription must contain one item' })
  }
  const item = subscription.items.data[0]
  const quantity = item?.quantity
  if (
    !item
    || !Number.isSafeInteger(quantity)
    || (quantity ?? 0) < 1
    || (quantity ?? 0) > MAX_LICENSED_SEATS
  ) {
    throw createError({ statusCode: 409, statusMessage: 'Stripe subscription quantity is invalid' })
  }
  const config = normalizedConfig(event)
  const expectedPriceId = config.applicationMonthlyPriceId
    || (await organizationBillingAccount(event, organizationId))?.stripe_price_id
    || (await applicationMonthlyPrice(event)).id
  if (item.price.id !== expectedPriceId || item.price.livemode !== subscription.livemode) {
    throw createError({ statusCode: 409, statusMessage: 'Stripe subscription Price does not match the application plan' })
  }
  assertApplicationMonthlyPrice(item.price, { requireActive: false })
  const legacyPeriod = subscription as unknown as {
    current_period_start?: number
    current_period_end?: number
  }
  const currentPeriodStart = item.current_period_start ?? legacyPeriod.current_period_start
  const currentPeriodEnd = item.current_period_end ?? legacyPeriod.current_period_end
  if (
    currentPeriodStart === undefined
    || currentPeriodEnd === undefined
    || currentPeriodEnd <= currentPeriodStart
  ) {
    throw createError({ statusCode: 409, statusMessage: 'Stripe subscription period is invalid' })
  }
  return {
    priceId: item.price.id,
    subscriptionItemId: item.id,
    quantity: quantity as number,
    currentPeriodStart: timestamp(currentPeriodStart),
    currentPeriodEnd: timestamp(currentPeriodEnd),
    currentPeriodStartTimestamp: currentPeriodStart,
    currentPeriodEndTimestamp: currentPeriodEnd,
  }
}

export async function organizationActiveMemberCount(
  event: H3Event,
  organizationId: string,
): Promise<number> {
  const backend = serverDataBackend(event) as any
  const result = await backend
    .from('organization_memberships')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
  if (result.error) throw createError({ statusCode: 500, statusMessage: result.error.message })
  const count = Number(result.count ?? 0)
  if (!Number.isSafeInteger(count) || count < 0 || count > MAX_LICENSED_SEATS) {
    throw createError({ statusCode: 409, statusMessage: 'Organization member count is invalid' })
  }
  return count
}

export async function resolveOrganizationSeatTarget(
  event: H3Event,
  organizationId: string,
  email: string,
  organizationKind: 'intermediary' | 'application',
): Promise<{ userId: string, email: string, alreadyMember: boolean }> {
  const normalizedEmail = email.trim().toLowerCase()
  if (
    normalizedEmail.length < 3
    || normalizedEmail.length > 320
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalizedEmail)
  ) {
    throw createError({ statusCode: 400, statusMessage: 'Valid email is required' })
  }
  const backend = serverDataBackend(event) as any
  if (organizationKind === 'application') {
    const result = await backend.rpc('resolve_organization_member_seat_target_v1', {
      p_organization_id: organizationId,
      p_target_email: normalizedEmail,
    })
    if (result.error) {
      const statusCode = result.error.code === 'P0002'
        ? 404
        : result.error.code === '42501'
          ? 409
          : 500
      throw createError({ statusCode, statusMessage: result.error.message })
    }
    const payload = (result.data ?? {}) as Record<string, unknown>
    const userId = String(payload.targetUserId || '')
    const resolvedEmail = String(payload.targetEmail || '')
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(userId)
      || resolvedEmail !== normalizedEmail
      || typeof payload.alreadyMember !== 'boolean'
    ) {
      throw createError({ statusCode: 500, statusMessage: 'Seat target lookup is invalid' })
    }
    return {
      userId,
      email: resolvedEmail,
      alreadyMember: payload.alreadyMember,
    }
  }
  const userResult = await backend
    .from('users')
    .select('id, email')
    .eq('email', normalizedEmail)
    .limit(1)
    .maybeSingle()
  if (userResult.error) throw createError({ statusCode: 500, statusMessage: userResult.error.message })
  if (!userResult.data?.id) {
    throw createError({ statusCode: 404, statusMessage: 'User not found' })
  }
  const membershipResult = await backend
    .from('organization_memberships')
    .select('user_id')
    .eq('organization_id', organizationId)
    .eq('user_id', userResult.data.id)
    .maybeSingle()
  if (membershipResult.error) {
    throw createError({ statusCode: 500, statusMessage: membershipResult.error.message })
  }
  return {
    userId: String(userResult.data.id),
    email: String(userResult.data.email || normalizedEmail),
    alreadyMember: Boolean(membershipResult.data),
  }
}

export interface OrganizationSeatChangeClaim {
  changeId: string
  targetUserId: string
  currentSeats: number
  targetSeats: number
  stripeIdempotencyKey: string
  invoiceId: string | null
  paymentUrl: string | null
  status: 'prepared' | 'pending' | 'succeeded' | 'failed'
  replayed: boolean
  updatedAt: string
}

export async function beginOrganizationMemberSeatChange(
  event: H3Event,
  input: {
    organizationId: string
    actorUserId: string
    targetEmail: string
    targetRole: 'expert' | 'admin'
    idempotencyKey: string
    expectedCurrentSeats: number
    prorationDate: number
  },
): Promise<OrganizationSeatChangeClaim> {
  const backend = serverDataBackend(event) as any
  const result = await backend.rpc('begin_organization_member_seat_change_v1', {
    p_organization_id: input.organizationId,
    p_actor_user_id: input.actorUserId,
    p_target_email: input.targetEmail,
    p_target_role: input.targetRole,
    p_idempotency_key: input.idempotencyKey,
    p_expected_seat_count: input.expectedCurrentSeats,
    p_proration_date: new Date(input.prorationDate * 1000).toISOString(),
  })
  if (result.error) throw createError({ statusCode: 409, statusMessage: result.error.message })
  const payload = (result.data ?? {}) as Record<string, unknown>
  const claim = {
    changeId: String(payload.changeId || ''),
    targetUserId: String(payload.targetUserId || ''),
    currentSeats: Number(payload.currentSeatCount),
    targetSeats: Number(payload.targetSeatCount),
    stripeIdempotencyKey: String(payload.stripeIdempotencyKey || ''),
    invoiceId: typeof payload.stripeInvoiceId === 'string' ? payload.stripeInvoiceId : null,
    paymentUrl: typeof payload.paymentUrl === 'string' ? payload.paymentUrl : null,
    status: String(payload.status || '') as OrganizationSeatChangeClaim['status'],
    replayed: payload.replayed === true,
    // Preserve PostgreSQL microseconds: this value is an opaque CAS revision,
    // not a JavaScript millisecond timestamp.
    updatedAt: String(payload.updatedAt || ''),
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(claim.changeId)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(claim.targetUserId)
    || !Number.isSafeInteger(claim.currentSeats)
    || !Number.isSafeInteger(claim.targetSeats)
    || claim.targetSeats !== claim.currentSeats + 1
    || !claim.stripeIdempotencyKey
    || claim.stripeIdempotencyKey.length > 255
    || !['prepared', 'pending', 'succeeded', 'failed'].includes(claim.status)
    || (Boolean(claim.paymentUrl) && !claim.invoiceId)
    || !Number.isFinite(Date.parse(claim.updatedAt))
  ) {
    throw createError({ statusCode: 500, statusMessage: 'Seat change claim is invalid' })
  }
  return claim
}

interface OrganizationSeatStripeMutationClaim {
  claimed: boolean
  status: OrganizationSeatChangeClaim['status']
  updatedAt: string
}

async function claimOrganizationMemberSeatStripeMutation(
  event: H3Event,
  input: { changeId: string, expectedUpdatedAt: string },
): Promise<OrganizationSeatStripeMutationClaim> {
  const backend = serverDataBackend(event) as any
  const result = await backend.rpc('claim_organization_member_seat_stripe_update_v1', {
    p_seat_change_id: input.changeId,
    p_expected_updated_at: input.expectedUpdatedAt,
  })
  if (result.error) throw createError({ statusCode: 500, statusMessage: result.error.message })
  const payload = (result.data ?? {}) as Record<string, unknown>
  const claim = {
    claimed: payload.claimed === true,
    status: String(payload.status || '') as OrganizationSeatChangeClaim['status'],
    // Keep the exact database representation for any later CAS.
    updatedAt: String(payload.updatedAt || ''),
  }
  if (
    !['prepared', 'pending', 'succeeded', 'failed'].includes(claim.status)
    || !Number.isFinite(Date.parse(claim.updatedAt))
  ) {
    throw createError({ statusCode: 500, statusMessage: 'Seat mutation claim is invalid' })
  }
  return claim
}

export async function markOrganizationMemberSeatChangePending(
  event: H3Event,
  input: { changeId: string, invoiceId?: string | null, paymentUrl?: string | null },
): Promise<{
  status: OrganizationSeatChangeClaim['status']
  invoiceId: string | null
  paymentUrl: string | null
}> {
  const backend = serverDataBackend(event) as any
  if (input.paymentUrl && !input.invoiceId) {
    throw createError({ statusCode: 500, statusMessage: 'Seat payment URL requires an Invoice ID' })
  }
  const invoiceId = input.invoiceId || null
  const paymentUrl = invoiceId ? input.paymentUrl || null : null
  const result = await backend.rpc('mark_organization_member_seat_change_v1', {
    p_seat_change_id: input.changeId,
    p_status: 'pending',
    p_failure_code: null,
    p_failure_message: null,
    p_stripe_invoice_id: invoiceId,
    p_payment_url: paymentUrl,
  })
  if (result.error) throw createError({ statusCode: 500, statusMessage: result.error.message })
  const payload = (result.data ?? {}) as Record<string, unknown>
  const status = String(payload.status || '') as OrganizationSeatChangeClaim['status']
  const persistedInvoiceId = typeof payload.stripeInvoiceId === 'string'
    ? payload.stripeInvoiceId
    : null
  const persistedPaymentUrl = typeof payload.paymentUrl === 'string'
    ? payload.paymentUrl
    : null
  if (
    !['prepared', 'pending', 'succeeded', 'failed'].includes(status)
    || (persistedPaymentUrl !== null && persistedInvoiceId === null)
  ) {
    throw createError({ statusCode: 500, statusMessage: 'Seat payment reference result is invalid' })
  }
  return {
    status,
    invoiceId: persistedInvoiceId,
    paymentUrl: persistedPaymentUrl,
  }
}

export async function failOrganizationMemberSeatChange(
  event: H3Event,
  changeId: string,
  errorCode: string,
  errorMessage?: string,
): Promise<void> {
  const backend = serverDataBackend(event) as any
  const normalizedErrorCode = errorCode
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/gu, '_')
    .replace(/^[^a-z]+/u, '')
    .slice(0, 120) || 'seat_update_failed'
  const result = await backend.rpc('mark_organization_member_seat_change_v1', {
    p_seat_change_id: changeId,
    p_status: 'failed',
    p_failure_code: normalizedErrorCode,
    p_failure_message: errorMessage?.slice(0, 500) ?? null,
    p_stripe_invoice_id: null,
    p_payment_url: null,
  })
  if (result.error) throw createError({ statusCode: 500, statusMessage: result.error.message })
}

async function failStaleOrganizationMemberSeatChange(
  event: H3Event,
  input: {
    changeId: string
    expectedUpdatedAt: string
    staleBefore: string
    errorCode: string
    errorMessage: string
  },
): Promise<boolean> {
  const backend = serverDataBackend(event) as any
  const result = await backend.rpc('fail_stale_organization_member_seat_change_v1', {
    p_seat_change_id: input.changeId,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_stale_before: input.staleBefore,
    p_failure_code: input.errorCode,
    p_failure_message: input.errorMessage,
  })
  if (result.error) throw createError({ statusCode: 500, statusMessage: result.error.message })
  const payload = (result.data ?? {}) as Record<string, unknown>
  if (typeof payload.failed !== 'boolean') {
    throw createError({ statusCode: 500, statusMessage: 'Seat recovery result is invalid' })
  }
  return payload.failed
}

export async function failOpenOrganizationSeatChange(
  event: H3Event,
  input: {
    organizationId: string
    subscriptionId: string
    invoiceId?: string
    eventCreated?: number
    errorCode: string
    errorMessage: string
  },
): Promise<boolean> {
  const backend = serverDataBackend(event) as any
  if (
    input.eventCreated !== undefined
    && (!Number.isSafeInteger(input.eventCreated) || input.eventCreated <= 0)
  ) {
    throw createError({ statusCode: 500, statusMessage: 'Stripe terminal event timestamp is invalid' })
  }
  let query = backend
    .from('organization_billing_seat_changes')
    .select('id, stripe_invoice_id, created_at')
    .eq('organization_id', input.organizationId)
    .eq('stripe_subscription_id', input.subscriptionId)
    .in('status', ['prepared', 'pending'])
    .order('created_at', { ascending: true })
    .limit(1)
  if (input.eventCreated !== undefined) {
    query = query.lte('created_at', new Date(input.eventCreated * 1000).toISOString())
  }
  const result = await query.maybeSingle()
  if (result.error) throw createError({ statusCode: 500, statusMessage: result.error.message })
  if (!result.data?.id) return false
  // Invoice terminal events are only authoritative for the seat change that
  // recorded that exact invoice. An unrelated voided invoice on the same
  // subscription must not cancel an ambiguous/prepared seat change.
  if (
    input.invoiceId
    && result.data.stripe_invoice_id !== input.invoiceId
  ) return false
  await failOrganizationMemberSeatChange(
    event,
    String(result.data.id),
    input.errorCode,
    input.errorMessage,
  )
  return true
}

export async function retrieveOrganizationStripeSubscription(
  event: H3Event,
  organizationId: string,
): Promise<{
  account: OrganizationBillingAccountRow
  subscription: Stripe.Subscription
  plan: StripeSubscriptionSeatPlan
}> {
  const account = await organizationBillingAccount(event, organizationId)
  if (!account?.stripe_customer_id || !account.stripe_subscription_id) {
    throw createError({ statusCode: 409, statusMessage: 'Active Stripe subscription is required' })
  }
  const subscription = await stripeBillingClient(event).subscriptions.retrieve(
    account.stripe_subscription_id,
    { expand: ['items.data.price', 'latest_invoice'] },
  )
  const customerId = stripeObjectId(subscription.customer)
  if (
    customerId !== account.stripe_customer_id
    || subscription.livemode !== account.livemode
    || subscription.livemode !== stripeBillingExpectedLivemode(event)
  ) {
    throw createError({ statusCode: 409, statusMessage: 'Stripe subscription account is inconsistent' })
  }
  const metadataOrganizationId = String(subscription.metadata.organization_id || '').trim()
  if (metadataOrganizationId && metadataOrganizationId !== organizationId) {
    throw createError({ statusCode: 409, statusMessage: 'Stripe subscription organization is inconsistent' })
  }
  return {
    account,
    subscription,
    plan: await stripeSubscriptionSeatPlan(event, subscription, organizationId),
  }
}

function validateProrationDate(plan: StripeSubscriptionSeatPlan, value: number): number {
  const now = Math.floor(Date.now() / 1000)
  if (
    !Number.isSafeInteger(value)
    || value < plan.currentPeriodStartTimestamp
    || value >= plan.currentPeriodEndTimestamp
    || value < now - 10 * 60
    || value > now + 60
  ) {
    throw createError({ statusCode: 409, statusMessage: 'Seat quote has expired' })
  }
  return value
}

function sumAmounts(values: Array<{ amount: number }> | null | undefined): number {
  return (values ?? []).reduce((total, value) => total + Number(value.amount || 0), 0)
}

async function invoicePreviewLines(
  stripe: Stripe,
  preview: Stripe.Invoice,
): Promise<Stripe.InvoiceLineItem[]> {
  if (!preview.lines.has_more) return preview.lines.data
  return stripe.invoices
    .listLineItems(preview.id, { limit: 100 })
    .autoPagingToArray({ limit: 300 })
}

function prorationAmounts(lines: Stripe.InvoiceLineItem[]) {
  const prorations = lines.filter(
    line => line.parent?.subscription_item_details?.proration === true,
  )
  const subtotal = prorations.reduce((total, line) => total + line.subtotal, 0)
  const discountAmount = prorations.reduce(
    (total, line) => total + sumAmounts(line.discount_amounts),
    0,
  )
  const taxAmount = prorations.reduce(
    (total, line) => total + sumAmounts(line.taxes),
    0,
  )
  const exclusiveTaxAmount = prorations.reduce(
    (total, line) => total + sumAmounts(
      line.taxes?.filter(tax => tax.tax_behavior === 'exclusive'),
    ),
    0,
  )
  return {
    count: prorations.length,
    subtotal,
    discountAmount,
    taxAmount,
    total: subtotal - discountAmount + exclusiveTaxAmount,
  }
}

export async function createOrganizationSeatQuote(
  event: H3Event,
  input: {
    organizationId: string
    targetUserId: string
    billingRequired: boolean
    expectedActiveMembers: number
    expectedReservedSeats: number
    expectedOccupiedSeats: number
    currentSeats: number
    nextSeats: number
    prorationDate?: number
  },
): Promise<OrganizationSeatQuote> {
  if (
    !Number.isSafeInteger(input.currentSeats)
    || !Number.isSafeInteger(input.nextSeats)
    || !Number.isSafeInteger(input.expectedActiveMembers)
    || !Number.isSafeInteger(input.expectedReservedSeats)
    || !Number.isSafeInteger(input.expectedOccupiedSeats)
    || input.expectedActiveMembers < 1
    || input.expectedReservedSeats < 0
    || input.expectedOccupiedSeats !== input.expectedActiveMembers + input.expectedReservedSeats
    || input.expectedOccupiedSeats > input.currentSeats
    || input.currentSeats < 1
    || ![input.currentSeats, input.currentSeats + 1].includes(input.nextSeats)
    || (input.billingRequired && input.nextSeats !== input.currentSeats + 1)
    || input.nextSeats > MAX_LICENSED_SEATS
  ) {
    throw createError({ statusCode: 409, statusMessage: 'Requested seat quantity is invalid' })
  }

  const unitAmount = APPLICATION_MONTHLY_PLAN.unitAmount
  if (!input.billingRequired) {
    return {
      targetUserId: input.targetUserId,
      billingRequired: false,
      expectedActiveMembers: input.expectedActiveMembers,
      expectedReservedSeats: input.expectedReservedSeats,
      expectedOccupiedSeats: input.expectedOccupiedSeats,
      currentSeats: input.currentSeats,
      nextSeats: input.nextSeats,
      unitAmount: 0,
      currentMonthlySubtotal: 0,
      nextMonthlySubtotal: 0,
      immediateAmount: 0,
      subtotal: 0,
      discountAmount: 0,
      taxAmount: 0,
      total: 0,
      renewalAt: null,
      prorationDate: Math.floor(Date.now() / 1000),
    }
  }

  const { account, subscription, plan } = await retrieveOrganizationStripeSubscription(
    event,
    input.organizationId,
  )
  if (!['active', 'trialing'].includes(subscription.status) || subscription.cancel_at_period_end) {
    throw createError({ statusCode: 409, statusMessage: 'Stripe subscription cannot add seats' })
  }
  if (subscription.pending_update) {
    throw createError({ statusCode: 409, statusMessage: 'Another seat payment is pending' })
  }
  if (plan.quantity !== input.currentSeats) {
    throw createError({ statusCode: 409, statusMessage: 'Stripe seat quantity is out of sync' })
  }
  const prorationDate = validateProrationDate(
    plan,
    input.prorationDate ?? Math.floor(Date.now() / 1000),
  )
  const stripe = stripeBillingClient(event)
  const [prorationPreview, currentRecurringPreview, nextRecurringPreview] = await Promise.all([
    stripe.invoices.createPreview({
      customer: account.stripe_customer_id || undefined,
      subscription: subscription.id,
      subscription_details: {
        items: [{ id: plan.subscriptionItemId, quantity: input.nextSeats }],
        proration_behavior: 'always_invoice',
        proration_date: prorationDate,
      },
    }),
    stripe.invoices.createPreview({
      customer: account.stripe_customer_id || undefined,
      subscription: subscription.id,
      preview_mode: 'recurring',
    }),
    stripe.invoices.createPreview({
      customer: account.stripe_customer_id || undefined,
      subscription: subscription.id,
      preview_mode: 'recurring',
      subscription_details: {
        items: [{ id: plan.subscriptionItemId, quantity: input.nextSeats }],
      },
    }),
  ])
  if (
    prorationPreview.currency !== APPLICATION_MONTHLY_PLAN.currency
    || currentRecurringPreview.currency !== APPLICATION_MONTHLY_PLAN.currency
    || nextRecurringPreview.currency !== APPLICATION_MONTHLY_PLAN.currency
  ) {
    throw createError({ statusCode: 409, statusMessage: 'Stripe seat quote currency is invalid' })
  }
  const immediate = prorationAmounts(await invoicePreviewLines(stripe, prorationPreview))
  if (immediate.count === 0) {
    throw createError({ statusCode: 409, statusMessage: 'Stripe seat quote has no proration lines' })
  }
  return {
    targetUserId: input.targetUserId,
    billingRequired: true,
    expectedActiveMembers: input.expectedActiveMembers,
    expectedReservedSeats: input.expectedReservedSeats,
    expectedOccupiedSeats: input.expectedOccupiedSeats,
    currentSeats: input.currentSeats,
    nextSeats: input.nextSeats,
    unitAmount,
    currentMonthlySubtotal: currentRecurringPreview.total,
    nextMonthlySubtotal: nextRecurringPreview.total,
    // `amount_due` is what Stripe will actually attempt to collect after
    // customer balance, pending invoice items and invoice-level rounding.
    // The invoice totals keep the UI breakdown consistent with that charge.
    immediateAmount: prorationPreview.amount_due,
    subtotal: prorationPreview.subtotal,
    discountAmount: sumAmounts(prorationPreview.total_discount_amounts),
    taxAmount: sumAmounts(prorationPreview.total_taxes),
    total: prorationPreview.total,
    renewalAt: plan.currentPeriodEnd,
    prorationDate,
  }
}

async function expandedLatestInvoice(
  event: H3Event,
  subscription: Stripe.Subscription,
): Promise<Stripe.Invoice | null> {
  if (!subscription.latest_invoice) return null
  if (typeof subscription.latest_invoice !== 'string') return subscription.latest_invoice
  return stripeBillingClient(event).invoices.retrieve(subscription.latest_invoice)
}

export function isInvoiceForSubscriptionUpdate(
  invoice: Stripe.Invoice,
  subscription: Stripe.Subscription,
  options: { requireLatest: boolean },
): boolean {
  const subscriptionCustomerId = stripeObjectId(subscription.customer)
  return invoice.billing_reason === 'subscription_update'
    && invoiceSubscriptionId(invoice) === subscription.id
    && Boolean(subscriptionCustomerId)
    && stripeObjectId(invoice.customer) === subscriptionCustomerId
    && invoice.livemode === subscription.livemode
    && (
      !options.requireLatest
      || stripeObjectId(subscription.latest_invoice) === invoice.id
    )
}

function actionableInvoicePaymentUrl(invoice: Stripe.Invoice): string | null {
  const value = invoice.hosted_invoice_url
  if (
    !value
    || invoice.status !== 'open'
    || invoice.collection_method !== 'charge_automatically'
    || invoice.amount_remaining <= 0
    || value.length > 2_000
  ) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return null
    return value
  }
  catch {
    return null
  }
}

async function hydrateOpenOrganizationSeatChangePayment(
  event: H3Event,
  subscription: Stripe.Subscription,
  organizationId: string,
  plan: StripeSubscriptionSeatPlan,
): Promise<boolean> {
  const pendingItems = subscription.pending_update?.subscription_items
  const pendingItem = pendingItems?.length === 1 ? pendingItems[0] : undefined
  const pendingQuantity = pendingItem?.quantity
  if (
    !pendingItem
    || pendingItem.id !== plan.subscriptionItemId
    || stripeObjectId(pendingItem.price) !== plan.priceId
    || !Number.isSafeInteger(pendingQuantity)
    || pendingQuantity !== plan.quantity + 1
  ) return false

  const invoice = await expandedLatestInvoice(event, subscription)
  const paymentUrl = invoice ? actionableInvoicePaymentUrl(invoice) : null
  if (
    !invoice
    || !isInvoiceForSubscriptionUpdate(invoice, subscription, { requireLatest: true })
  ) return false

  const backend = serverDataBackend(event) as any
  const openChange = await backend
    .from('organization_billing_seat_changes')
    .select('id, stripe_invoice_id')
    .eq('organization_id', organizationId)
    .eq('stripe_subscription_id', subscription.id)
    .eq('stripe_subscription_item_id', plan.subscriptionItemId)
    .eq('expected_seat_count', plan.quantity)
    .eq('target_seat_count', pendingQuantity)
    .in('status', ['prepared', 'pending'])
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (openChange.error) {
    throw createError({ statusCode: 500, statusMessage: openChange.error.message })
  }
  if (
    !openChange.data?.id
    || (
      openChange.data.stripe_invoice_id
      && openChange.data.stripe_invoice_id !== invoice.id
    )
  ) return false

  const persisted = await markOrganizationMemberSeatChangePending(event, {
    changeId: String(openChange.data.id),
    invoiceId: invoice.id,
    paymentUrl,
  })
  return persisted.invoiceId === invoice.id
}

export async function matchingOpenOrganizationSeatChangeId(
  event: H3Event,
  subscription: Stripe.Subscription,
  organizationId: string,
  invoice: Stripe.Invoice,
): Promise<string | null> {
  if (!isInvoiceForSubscriptionUpdate(invoice, subscription, { requireLatest: false })) {
    return null
  }
  const backend = serverDataBackend(event) as any
  const exactInvoice = await backend
    .from('organization_billing_seat_changes')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('stripe_subscription_id', subscription.id)
    .eq('stripe_invoice_id', invoice.id)
    .limit(1)
    .maybeSingle()
  if (exactInvoice.error) {
    throw createError({ statusCode: 500, statusMessage: exactInvoice.error.message })
  }
  if (exactInvoice.data?.id) return String(exactInvoice.data.id)

  if (stripeObjectId(subscription.latest_invoice) !== invoice.id) return null

  const plan = await stripeSubscriptionSeatPlan(event, subscription, organizationId)
  const pendingItems = subscription.pending_update?.subscription_items
  const pendingItem = pendingItems?.length === 1 ? pendingItems[0] : undefined
  const pendingQuantity = pendingItem?.quantity
  if (
    !pendingItem
    || pendingItem.id !== plan.subscriptionItemId
    || stripeObjectId(pendingItem.price) !== plan.priceId
    || !Number.isSafeInteger(pendingQuantity)
    || pendingQuantity !== plan.quantity + 1
  ) return null

  const pendingChange = await backend
    .from('organization_billing_seat_changes')
    .select('id, stripe_invoice_id')
    .eq('organization_id', organizationId)
    .eq('stripe_subscription_id', subscription.id)
    .eq('stripe_subscription_item_id', plan.subscriptionItemId)
    .eq('expected_seat_count', plan.quantity)
    .eq('target_seat_count', pendingQuantity)
    .in('status', ['prepared', 'pending'])
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (pendingChange.error) {
    throw createError({ statusCode: 500, statusMessage: pendingChange.error.message })
  }
  if (
    pendingChange.data?.id
    && (
      !pendingChange.data.stripe_invoice_id
      || pendingChange.data.stripe_invoice_id === invoice.id
    )
  ) {
    const persisted = await markOrganizationMemberSeatChangePending(event, {
      changeId: String(pendingChange.data.id),
      invoiceId: invoice.id,
      paymentUrl: actionableInvoicePaymentUrl(invoice),
    })
    if (persisted.invoiceId === invoice.id) return String(pendingChange.data.id)
  }
  return null
}

export async function bindExpiredOrganizationSeatChangeInvoice(
  event: H3Event,
  subscription: Stripe.Subscription,
  organizationId: string,
  eventCreated: number,
): Promise<{ changeId: string, invoiceId: string } | null> {
  if (
    subscription.pending_update
    || !Number.isSafeInteger(eventCreated)
    || eventCreated <= 0
  ) return null

  const invoice = await expandedLatestInvoice(event, subscription)
  if (
    !invoice
    || !Number.isSafeInteger(invoice.created)
    || invoice.created <= 0
    || invoice.created > eventCreated
    || !isInvoiceForSubscriptionUpdate(invoice, subscription, { requireLatest: true })
  ) return null

  const plan = await stripeSubscriptionSeatPlan(event, subscription, organizationId)
  const backend = serverDataBackend(event) as any
  const openChange = await backend
    .from('organization_billing_seat_changes')
    .select('id, stripe_invoice_id, created_at, proration_date')
    .eq('organization_id', organizationId)
    .eq('stripe_subscription_id', subscription.id)
    .eq('stripe_subscription_item_id', plan.subscriptionItemId)
    .eq('expected_seat_count', plan.quantity)
    .eq('target_seat_count', plan.quantity + 1)
    .in('status', ['prepared', 'pending'])
    .lte('created_at', new Date(eventCreated * 1000).toISOString())
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (openChange.error) {
    throw createError({ statusCode: 500, statusMessage: openChange.error.message })
  }
  if (
    !openChange.data?.id
    || (
      openChange.data.stripe_invoice_id
      && openChange.data.stripe_invoice_id !== invoice.id
    )
  ) return null

  const invoiceCreatedMs = invoice.created * 1000
  const changeCreatedMs = Date.parse(String(openChange.data.created_at))
  const prorationDateMs = Date.parse(String(openChange.data.proration_date))
  if (
    !Number.isSafeInteger(invoiceCreatedMs)
    || !Number.isSafeInteger(changeCreatedMs)
    || !Number.isSafeInteger(prorationDateMs)
    // Stripe Invoice timestamps are second-granularity, while saga timestamps
    // retain milliseconds. Do not floor the saga: invoice X from second S must
    // not be attached to saga Y created later within that same second.
    // Date.parse truncates PostgreSQL microseconds. Equality is therefore also
    // ambiguous and must remain uncorrelated rather than risk binding X to Y.
    || invoiceCreatedMs <= changeCreatedMs
    || invoiceCreatedMs <= prorationDateMs
  ) return null

  const persisted = await markOrganizationMemberSeatChangePending(event, {
    changeId: String(openChange.data.id),
    invoiceId: invoice.id,
    paymentUrl: actionableInvoicePaymentUrl(invoice),
  })
  if (persisted.invoiceId !== invoice.id) return null
  return {
    changeId: String(openChange.data.id),
    invoiceId: invoice.id,
  }
}

export async function reconcileExpiredOrganizationSeatChange(
  event: H3Event,
  subscription: Stripe.Subscription,
  organizationId: string,
): Promise<boolean> {
  if (subscription.pending_update) return false
  const plan = await stripeSubscriptionSeatPlan(event, subscription, organizationId)
  const backend = serverDataBackend(event) as any
  const reconciliationNow = Date.now()
  const cutoff = new Date(reconciliationNow - 10 * 60_000).toISOString()
  const openChange = await backend
    .from('organization_billing_seat_changes')
    .select('id, stripe_invoice_id, created_at, updated_at')
    .eq('organization_id', organizationId)
    .eq('stripe_subscription_id', subscription.id)
    .eq('stripe_subscription_item_id', plan.subscriptionItemId)
    .eq('expected_seat_count', plan.quantity)
    .eq('target_seat_count', plan.quantity + 1)
    .in('status', ['prepared', 'pending'])
    .lte('updated_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (openChange.error) {
    throw createError({ statusCode: 500, statusMessage: openChange.error.message })
  }
  if (!openChange.data?.id) return false

  let invoiceId = typeof openChange.data.stripe_invoice_id === 'string'
    ? openChange.data.stripe_invoice_id
    : null
  let invoiceBoundDuringReconciliation = false
  const failObservedChange = () => failStaleOrganizationMemberSeatChange(event, {
    changeId: String(openChange.data.id),
    // Pass the original PostgreSQL timestamp through unchanged. This is the
    // fence against a concurrent request touching the saga before Stripe.
    expectedUpdatedAt: String(openChange.data.updated_at),
    staleBefore: cutoff,
    errorCode: 'stripe_pending_update_missing',
    errorMessage: 'Stripe no longer reports the pending seat update',
  })

  if (!invoiceId) {
    // An ambiguous Stripe response or delayed webhook can leave an invoice-less
    // saga after pending_update disappears. Persist a conservatively correlated
    // canonical Invoice before terminal recovery so a later terminal webhook is
    // still classified as this seat change, not as a renewal anomaly.
    const binding = await bindExpiredOrganizationSeatChangeInvoice(
      event,
      subscription,
      organizationId,
      Math.floor(reconciliationNow / 1000),
    )
    if (binding) {
      // Never use a canonical invoice discovered for a different concurrent
      // saga to authorize failure of the stale row observed above.
      if (binding.changeId !== String(openChange.data.id)) return false
      invoiceId = binding.invoiceId
      invoiceBoundDuringReconciliation = true
    }
  }

  if (invoiceId) {
    const stripe = stripeBillingClient(event)
    const invoice = await stripe.invoices.retrieve(invoiceId)
    if (!isInvoiceForSubscriptionUpdate(invoice, subscription, { requireLatest: false })) {
      throw createError({ statusCode: 409, statusMessage: 'Stripe seat recovery invoice is inconsistent' })
    }
    if (invoice.status === 'paid') {
      // A paid invoice may be slightly ahead of the subscription projection.
      // Keep the saga open so the next canonical snapshot can add membership.
      return false
    }
    // Never void an open invoice from a manual request: the card payment or
    // SCA confirmation may be in flight. Stripe terminal state is authoritative.
    if (!['void', 'uncollectible'].includes(String(invoice.status))) {
      return false
    }

    if (invoiceBoundDuringReconciliation) {
      // Binding intentionally touches the row, so its old updated_at can no
      // longer satisfy the stale CAS. The exact persisted terminal Invoice is
      // now the fence; one-shot claim semantics prevent any second mutation.
      await failOrganizationMemberSeatChange(
        event,
        String(openChange.data.id),
        invoice.status === 'void'
          ? 'stripe_invoice_voided'
          : 'stripe_invoice_uncollectible',
        invoice.status === 'void'
          ? 'Stripe seat invoice was voided'
          : 'Stripe seat invoice was marked uncollectible',
      )
      return true
    }
  }

  return failObservedChange()
}

export async function applyOrganizationInvoiceBillingState(
  event: H3Event,
  input: {
    organizationId: string
    subscriptionId: string
    invoiceId: string
    eventCreated: number
    state: 'failed' | 'resolved'
    failureKind?: string
  },
): Promise<void> {
  const backend = serverDataBackend(event) as any
  const result = await backend.rpc('apply_organization_invoice_billing_state_v1', {
    p_organization_id: input.organizationId,
    p_stripe_subscription_id: input.subscriptionId,
    p_stripe_invoice_id: input.invoiceId,
    p_event_created: input.eventCreated,
    p_state: input.state,
    p_failure_kind: input.state === 'failed' ? input.failureKind : null,
  })
  if (result.error) throw createError({ statusCode: 500, statusMessage: result.error.message })
}

export async function updateOrganizationStripeSeatQuantity(
  event: H3Event,
  input: {
    organizationId: string
    seatChangeId: string
    expectedSeatChangeUpdatedAt: string
    expectedCurrentSeats: number
    nextSeats: number
    prorationDate: number
    idempotencyKey: string
    allowExistingPending?: boolean
  },
): Promise<StripeSeatUpdateResult> {
  if (
    !Number.isSafeInteger(input.expectedCurrentSeats)
    || !Number.isSafeInteger(input.nextSeats)
    || input.expectedCurrentSeats < 1
    || input.nextSeats !== input.expectedCurrentSeats + 1
    || input.nextSeats > MAX_LICENSED_SEATS
  ) {
    throw createError({ statusCode: 409, statusMessage: 'Requested seat quantity is invalid' })
  }
  const { account, subscription, plan } = await retrieveOrganizationStripeSubscription(
    event,
    input.organizationId,
  )
  const snapshotEventCreated = Number(account.last_stripe_event_created_at || 0)
  if (!Number.isSafeInteger(snapshotEventCreated) || snapshotEventCreated < 0) {
    throw createError({ statusCode: 500, statusMessage: 'Stripe snapshot timestamp is invalid' })
  }
  if (!['active', 'trialing'].includes(subscription.status) || subscription.cancel_at_period_end) {
    throw createError({ statusCode: 409, statusMessage: 'Stripe subscription cannot add seats' })
  }
  if (input.allowExistingPending && plan.quantity === input.nextSeats && !subscription.pending_update) {
    return {
      subscription,
      plan,
      invoiceId: null,
      paymentUrl: null,
      pending: false,
      snapshotEventCreated,
    }
  }
  if (subscription.pending_update) {
    const pendingItems = subscription.pending_update.subscription_items
    const pendingItem = pendingItems?.length === 1 ? pendingItems[0] : undefined
    if (
      !input.allowExistingPending
      || !pendingItem
      || pendingItem.id !== plan.subscriptionItemId
      || pendingItem.price.id !== plan.priceId
      || pendingItem.quantity !== input.nextSeats
    ) {
      throw createError({ statusCode: 409, statusMessage: 'Another seat payment is pending' })
    }
    const invoice = await expandedLatestInvoice(event, subscription)
    const correlatedInvoice = invoice
      && isInvoiceForSubscriptionUpdate(invoice, subscription, { requireLatest: true })
      ? invoice
      : null
    const paymentUrl = correlatedInvoice
      ? actionableInvoicePaymentUrl(correlatedInvoice)
      : null
    return {
      subscription,
      plan,
      invoiceId: correlatedInvoice?.id ?? null,
      paymentUrl,
      pending: true,
      snapshotEventCreated,
    }
  }
  if (plan.quantity !== input.expectedCurrentSeats) {
    throw createError({ statusCode: 409, statusMessage: 'Stripe seat quantity changed; request a new quote' })
  }
  const prorationDate = validateProrationDate(plan, input.prorationDate)
  const mutationClaim = await claimOrganizationMemberSeatStripeMutation(event, {
    changeId: input.seatChangeId,
    expectedUpdatedAt: input.expectedSeatChangeUpdatedAt,
  })
  if (!mutationClaim.claimed) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Seat change was updated by another request',
      data: {
        seatMutationClaimLost: true,
        seatChangeStatus: mutationClaim.status,
      },
    })
  }
  const updated = await stripeBillingClient(event).subscriptions.update(subscription.id, {
    items: [{ id: plan.subscriptionItemId, quantity: input.nextSeats }],
    payment_behavior: 'pending_if_incomplete',
    proration_behavior: 'always_invoice',
    proration_date: prorationDate,
    expand: ['items.data.price', 'latest_invoice'],
  }, { idempotencyKey: input.idempotencyKey })
  try {
    const updatedPlan = await stripeSubscriptionSeatPlan(event, updated, input.organizationId)
    if (!updated.pending_update && updatedPlan.quantity !== input.nextSeats) {
      throw new Error('Stripe did not apply the requested seat quantity')
    }
    if (updated.pending_update && updatedPlan.quantity !== input.expectedCurrentSeats) {
      throw new Error('Stripe pending seat update is inconsistent')
    }
    const invoice = updated.pending_update
      ? await expandedLatestInvoice(event, updated)
      : null
    if (
      invoice
      && !isInvoiceForSubscriptionUpdate(invoice, updated, { requireLatest: true })
    ) {
      throw new Error('Stripe seat invoice is inconsistent')
    }
    const paymentUrl = invoice ? actionableInvoicePaymentUrl(invoice) : null
    return {
      subscription: updated,
      plan: updatedPlan,
      invoiceId: invoice?.id ?? null,
      paymentUrl,
      pending: Boolean(updated.pending_update),
      snapshotEventCreated,
    }
  }
  catch (error) {
    if (
      error instanceof Stripe.errors.StripeConnectionError
      || error instanceof Stripe.errors.StripeAPIError
    ) throw error
    throw createError({
      statusCode: 502,
      statusMessage: 'Stripe seat update result could not be verified',
      data: { stripeMutationMayHaveApplied: true },
      cause: error,
    })
  }
}

function invoiceDate(value: number | null | undefined): string | undefined {
  if (!value || !Number.isSafeInteger(value)) return undefined
  return new Date(value * 1000).toISOString()
}

function billingInvoice(invoice: Stripe.Invoice): OrganizationBillingInvoice {
  return {
    id: invoice.id,
    number: invoice.number ?? invoice.id,
    status: invoice.status ?? 'unknown',
    currency: invoice.currency,
    amountDue: invoice.amount_due,
    amountPaid: invoice.amount_paid,
    createdAt: timestamp(invoice.created),
    periodStart: invoiceDate(invoice.period_start),
    periodEnd: invoiceDate(invoice.period_end),
    hostedInvoiceUrl: invoice.hosted_invoice_url || undefined,
    invoicePdf: invoice.invoice_pdf || undefined,
  }
}

function cardSummary(paymentMethod: Stripe.PaymentMethod | null): OrganizationBillingHistory['paymentMethod'] {
  if (!paymentMethod?.card) return null
  return {
    brand: paymentMethod.card.brand,
    last4: paymentMethod.card.last4,
    expMonth: paymentMethod.card.exp_month,
    expYear: paymentMethod.card.exp_year,
  }
}

export async function organizationStripeBillingHistory(
  event: H3Event,
  organizationId: string,
): Promise<OrganizationBillingHistory> {
  const { account, subscription, plan } = await retrieveOrganizationStripeSubscription(
    event,
    organizationId,
  )
  const stripe = stripeBillingClient(event)
  const invoicesPromise = stripe.invoices.list({
    customer: account.stripe_customer_id || undefined,
    limit: 20,
  })
  const upcomingPromise = stripe.invoices.createPreview({
    customer: account.stripe_customer_id || undefined,
    subscription: subscription.id,
  }).catch((error: unknown) => {
    if (
      error instanceof Stripe.errors.StripeInvalidRequestError
      && error.code === 'invoice_upcoming_none'
    ) return null
    throw error
  })

  let paymentMethod: Stripe.PaymentMethod | null = null
  const subscriptionPaymentMethod = subscription.default_payment_method
  if (typeof subscriptionPaymentMethod === 'string') {
    paymentMethod = await stripe.paymentMethods.retrieve(subscriptionPaymentMethod)
  }
  else if (subscriptionPaymentMethod?.object === 'payment_method') {
    paymentMethod = subscriptionPaymentMethod
  }
  if (!paymentMethod && account.stripe_customer_id) {
    const customer = await stripe.customers.retrieve(account.stripe_customer_id, {
      expand: ['invoice_settings.default_payment_method'],
    })
    if (!customer.deleted) {
      const customerPaymentMethod = customer.invoice_settings.default_payment_method
      if (typeof customerPaymentMethod === 'string') {
        paymentMethod = await stripe.paymentMethods.retrieve(customerPaymentMethod)
      }
      else if (customerPaymentMethod?.object === 'payment_method') {
        paymentMethod = customerPaymentMethod
      }
    }
  }
  if (paymentMethod) {
    const paymentMethodCustomerId = stripeObjectId(paymentMethod.customer)
    if (
      paymentMethodCustomerId !== account.stripe_customer_id
      || paymentMethod.livemode !== account.livemode
    ) {
      throw createError({ statusCode: 409, statusMessage: 'Stripe payment method is inconsistent' })
    }
  }

  const [invoices, upcoming] = await Promise.all([invoicesPromise, upcomingPromise])
  return {
    invoices: invoices.data
      .filter(invoice => invoice.livemode === account.livemode)
      .map(billingInvoice),
    upcoming: upcoming
      ? {
          amountDue: upcoming.amount_due,
          currency: upcoming.currency,
          dueAt: invoiceDate(upcoming.next_payment_attempt) ?? plan.currentPeriodEnd,
        }
      : null,
    paymentMethod: cardSummary(paymentMethod),
  }
}

async function subscriptionOrganizationId(
  event: H3Event,
  subscription: Stripe.Subscription,
  checkoutSessionId?: string | null,
): Promise<string> {
  const metadataOrganizationId = String(subscription.metadata.organization_id || '').trim()
  const backend = serverDataBackend(event) as any
  const customerId = stripeObjectId(subscription.customer)
  if (!customerId) {
    throw createError({ statusCode: 409, statusMessage: 'Stripe customer is missing' })
  }

  const result = await backend
    .from('organization_billing_accounts')
    .select('organization_id, stripe_customer_id, stripe_subscription_id, stripe_checkout_session_id')
    .eq('stripe_customer_id', customerId)
    .limit(1)
    .maybeSingle()
  if (result.error || !result.data?.organization_id) {
    throw createError({ statusCode: 404, statusMessage: 'Stripe subscription organization was not found' })
  }
  const organizationId = String(result.data.organization_id)
  if (metadataOrganizationId && metadataOrganizationId !== organizationId) {
    throw createError({ statusCode: 409, statusMessage: 'Stripe subscription organization is inconsistent' })
  }
  const storedSubscriptionId = typeof result.data.stripe_subscription_id === 'string'
    ? result.data.stripe_subscription_id
    : null
  const storedCheckoutSessionId = typeof result.data.stripe_checkout_session_id === 'string'
    ? result.data.stripe_checkout_session_id
    : null
  const replacementFromCurrentCheckout = Boolean(
    checkoutSessionId
    && checkoutSessionId === storedCheckoutSessionId,
  )
  if (
    (!replacementFromCurrentCheckout && storedSubscriptionId !== subscription.id)
    || (checkoutSessionId && checkoutSessionId !== storedCheckoutSessionId)
  ) {
    throw createError({ statusCode: 409, statusMessage: STALE_STRIPE_SUBSCRIPTION_STATUS })
  }
  return organizationId
}

export function isStaleStripeSubscriptionSnapshotError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'statusMessage' in error
    && error.statusMessage === STALE_STRIPE_SUBSCRIPTION_STATUS
}

export function isStripeSeatQuantityMismatchError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'statusMessage' in error
    && error.statusMessage === STRIPE_SEAT_QUANTITY_MISMATCH_STATUS
}

export async function applyStripeSubscriptionSnapshot(
  event: H3Event,
  subscription: Stripe.Subscription,
  eventCreated: number,
  checkoutSessionId?: string | null,
): Promise<{
  organizationId: string
  accessState: BillingAccessState
  replayed: boolean
  finalizedSeatChangeId?: string
  memberAdded?: boolean
  currentSeats?: number
}> {
  if (!Number.isSafeInteger(eventCreated) || eventCreated < 0) {
    throw createError({ statusCode: 409, statusMessage: 'Stripe event timestamp is invalid' })
  }
  const normalizedEventCreated = Math.trunc(eventCreated)
  const organizationId = await subscriptionOrganizationId(event, subscription, checkoutSessionId)
  const customerId = stripeObjectId(subscription.customer)
  if (!customerId) throw createError({ statusCode: 409, statusMessage: 'Stripe customer is missing' })
  const plan = await stripeSubscriptionSeatPlan(event, subscription, organizationId)
  const accessState = stripeSubscriptionAccessState(subscription.status)
  const graceUntil = accessState === 'grace'
    // A failed renewal moves current_period_end to the end of the newly
    // invoiced period, so it cannot anchor grace without granting ~a month.
    // The DB preserves this first past_due deadline across later retries.
    ? timestamp(normalizedEventCreated + GRACE_PERIOD_DAYS * 24 * 60 * 60)
    : null
  const backend = serverDataBackend(event) as any
  const result = await backend.rpc('apply_organization_billing_and_seat_snapshot_v1', {
    p_organization_id: organizationId,
    p_stripe_customer_id: customerId,
    p_stripe_subscription_id: subscription.id,
    p_stripe_checkout_session_id: checkoutSessionId || null,
    p_stripe_price_id: plan.priceId,
    p_subscription_status: subscription.status,
    p_livemode: subscription.livemode,
    p_current_period_start: plan.currentPeriodStart,
    p_current_period_end: plan.currentPeriodEnd,
    p_cancel_at_period_end: subscription.cancel_at_period_end,
    p_grace_until: graceUntil,
    p_event_created: normalizedEventCreated,
    p_stripe_subscription_item_id: plan.subscriptionItemId,
    p_quantity: plan.quantity,
  })
  if (result.error) throw createError({ statusCode: 500, statusMessage: result.error.message })
  const payload = (result.data ?? {}) as Record<string, unknown>
  if (payload.subscriptionAccepted === false) {
    throw createError({ statusCode: 409, statusMessage: STALE_STRIPE_SUBSCRIPTION_STATUS })
  }
  const persistedAccessState = payload.billingAccessState
  if (
    typeof persistedAccessState !== 'string'
    || !(BILLING_ACCESS_STATES as readonly string[]).includes(persistedAccessState)
  ) {
    throw createError({ statusCode: 500, statusMessage: 'Billing snapshot returned an invalid access state' })
  }
  if (
    !payload.seatSnapshot
    || typeof payload.seatSnapshot !== 'object'
    || Array.isArray(payload.seatSnapshot)
  ) {
    throw createError({ statusCode: 500, statusMessage: 'Seat snapshot is missing' })
  }
  const seatPayload = payload.seatSnapshot as Record<string, unknown>
  if (seatPayload.mismatch === true) {
    throw createError({
      statusCode: 409,
      statusMessage: STRIPE_SEAT_QUANTITY_MISMATCH_STATUS,
    })
  }
  const licensedSeatCount = Number(seatPayload.licensedSeatCount)
  if (
    !Number.isSafeInteger(licensedSeatCount)
    || licensedSeatCount < 1
    || licensedSeatCount > MAX_LICENSED_SEATS
  ) {
    throw createError({ statusCode: 500, statusMessage: 'Seat snapshot returned an invalid quantity' })
  }
  await hydrateOpenOrganizationSeatChangePayment(
    event,
    subscription,
    organizationId,
    plan,
  )
  return {
    organizationId,
    accessState: persistedAccessState as BillingAccessState,
    replayed: payload.replayed === true,
    finalizedSeatChangeId: typeof seatPayload.completedSeatChangeId === 'string'
      ? seatPayload.completedSeatChangeId
      : undefined,
    memberAdded: seatPayload.membershipCreated === true,
    currentSeats: licensedSeatCount,
  }
}

export async function retrieveAndApplyStripeSubscription(
  event: H3Event,
  subscriptionId: string,
  eventCreated: number,
  checkoutSessionId?: string | null,
) {
  const subscription = await stripeBillingClient(event).subscriptions.retrieve(subscriptionId, {
    expand: ['items.data.price'],
  })
  const snapshot = await applyStripeSubscriptionSnapshot(
    event,
    subscription,
    eventCreated,
    checkoutSessionId,
  )
  return { ...snapshot, subscription }
}

export async function retrieveCurrentStripeSubscriptionContext(
  event: H3Event,
  subscriptionId: string,
): Promise<{
  organizationId: string
  subscriptionId: string
  subscription: Stripe.Subscription
}> {
  const subscription = await stripeBillingClient(event).subscriptions.retrieve(subscriptionId, {
    expand: ['items.data.price'],
  })
  const organizationId = await subscriptionOrganizationId(event, subscription)
  const account = await organizationBillingAccount(event, organizationId)
  if (
    !account
    || account.stripe_subscription_id !== subscription.id
    || account.stripe_customer_id !== stripeObjectId(subscription.customer)
    || account.livemode !== subscription.livemode
    || subscription.livemode !== stripeBillingExpectedLivemode(event)
  ) {
    throw createError({ statusCode: 409, statusMessage: STALE_STRIPE_SUBSCRIPTION_STATUS })
  }
  // Validate the canonical Price/item/period/quantity before any Invoice
  // ledger transition. The context is read-only: it must not project seats or
  // access until the terminal state has been durably recorded.
  await stripeSubscriptionSeatPlan(event, subscription, organizationId)
  return { organizationId, subscriptionId, subscription }
}

export async function retrieveCurrentStripeInvoiceSubscriptionContext(
  event: H3Event,
  invoice: Stripe.Invoice,
): Promise<{
  organizationId: string
  subscriptionId: string
  subscription: Stripe.Subscription
}> {
  const subscriptionId = invoiceSubscriptionId(invoice)
  if (!subscriptionId) {
    throw createError({ statusCode: 409, statusMessage: 'Stripe invoice subscription is missing' })
  }
  const context = await retrieveCurrentStripeSubscriptionContext(event, subscriptionId)
  if (
    stripeObjectId(invoice.customer) !== stripeObjectId(context.subscription.customer)
    || invoice.livemode !== context.subscription.livemode
  ) {
    throw createError({ statusCode: 409, statusMessage: 'Stripe invoice subscription is inconsistent' })
  }
  return context
}

export async function retrieveAndApplyCurrentStripeSubscription(
  event: H3Event,
  input: { organizationId: string, subscriptionId: string, eventCreated: number },
) {
  const account = await organizationBillingAccount(event, input.organizationId)
  if (!account || account.stripe_subscription_id !== input.subscriptionId) {
    throw createError({ statusCode: 409, statusMessage: STALE_STRIPE_SUBSCRIPTION_STATUS })
  }
  const accountEventCreated = Number(account.last_stripe_event_created_at || 0)
  if (
    !Number.isSafeInteger(input.eventCreated)
    || input.eventCreated <= 0
    || !Number.isSafeInteger(accountEventCreated)
    || accountEventCreated < 0
  ) {
    throw createError({ statusCode: 409, statusMessage: 'Stripe event timestamp is invalid' })
  }
  return retrieveAndApplyStripeSubscription(
    event,
    input.subscriptionId,
    Math.max(input.eventCreated, accountEventCreated),
  )
}

export function checkoutSubscriptionId(session: Stripe.Checkout.Session): string | null {
  return stripeObjectId(session.subscription as string | { id: string } | null)
}

export function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const legacySubscription = (invoice as unknown as {
    subscription?: string | Stripe.Subscription | null
  }).subscription
  return stripeObjectId(
    invoice.parent?.subscription_details?.subscription ?? legacySubscription,
  )
}
