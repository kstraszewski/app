import type Stripe from 'stripe'
import {
  createError,
  getHeader,
  readRawBody,
  setHeader,
} from 'h3'
import { serverDataBackend } from '~~/server/utils/data-api'
import {
  applyOrganizationInvoiceBillingState,
  applyStripeSubscriptionSnapshot,
  bindExpiredOrganizationSeatChangeInvoice,
  checkoutSubscriptionId,
  failOpenOrganizationSeatChange,
  failOrganizationMemberSeatChange,
  invoiceSubscriptionId,
  isInvoiceForSubscriptionUpdate,
  isStripeSeatQuantityMismatchError,
  isStaleStripeSubscriptionSnapshotError,
  matchingOpenOrganizationSeatChangeId,
  markOrganizationInvitationDiscountApplied,
  retrieveAndApplyCurrentStripeSubscription,
  retrieveAndApplyStripeSubscription,
  retrieveCurrentStripeInvoiceSubscriptionContext,
  retrieveCurrentStripeSubscriptionContext,
  stripeBillingClient,
  stripeBillingConfiguration,
  stripeBillingExpectedLivemode,
} from '~~/server/utils/stripe-billing'

type WebhookStatus = 'processing' | 'processed' | 'failed' | 'ignored'
type WebhookClaim =
  | { backend: any, process: true, status: 'processing', attempt: number }
  | { backend: any, process: false, status: WebhookStatus, attempt: null }
const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024

function stripeObjectId(object: Stripe.Event.Data.Object): string | null {
  const value = (object as unknown as { id?: unknown }).id
  return typeof value === 'string' ? value : null
}

async function beginEvent(
  event: Parameters<typeof serverDataBackend>[0],
  stripeEvent: Stripe.Event,
): Promise<WebhookClaim> {
  const backend = serverDataBackend(event) as any
  const existing = await backend
    .from('stripe_webhook_events')
    .select('status, attempts, updated_at')
    .eq('stripe_event_id', stripeEvent.id)
    .maybeSingle()
  if (existing.error) throw createError({ statusCode: 500, statusMessage: existing.error.message })
  const existingStatus = existing.data?.status as WebhookStatus | undefined
  if (existingStatus === 'processed' || existingStatus === 'ignored') {
    return { backend, process: false, status: existingStatus, attempt: null }
  }
  if (existingStatus === 'processing') {
    const updatedAt = Date.parse(String(existing.data.updated_at || ''))
    if (Number.isFinite(updatedAt) && updatedAt > Date.now() - 5 * 60_000) {
      return { backend, process: false, status: existingStatus, attempt: null }
    }
  }

  const row = {
    stripe_event_id: stripeEvent.id,
    event_type: stripeEvent.type,
    stripe_object_id: stripeObjectId(stripeEvent.data.object),
    livemode: stripeEvent.livemode,
    api_version: stripeEvent.api_version || null,
    event_created_at: stripeEvent.created,
    status: 'processing',
    attempts: Number(existing.data?.attempts || 0) + 1,
    last_error: null,
    processed_at: null,
  }
  if (!existing.data) {
    const inserted = await backend.from('stripe_webhook_events').insert(row)
    if (inserted.error) {
      if (String(inserted.error.code || '') === '23505') {
        return { backend, process: false, status: 'processing' as const, attempt: null }
      }
      throw createError({ statusCode: 500, statusMessage: inserted.error.message })
    }
    return { backend, process: true, status: 'processing' as const, attempt: row.attempts }
  }

  let claim = backend
    .from('stripe_webhook_events')
    .update(row)
    .eq('stripe_event_id', stripeEvent.id)
    .eq('status', existingStatus)
    .eq('attempts', Number(existing.data.attempts || 0))
  if (existingStatus === 'processing') {
    claim = claim.eq('updated_at', existing.data.updated_at)
  }
  const persisted = await claim.select('stripe_event_id').maybeSingle()
  if (persisted.error) throw createError({ statusCode: 500, statusMessage: persisted.error.message })
  if (!persisted.data) {
    return { backend, process: false, status: 'processing' as const, attempt: null }
  }
  return { backend, process: true, status: 'processing' as const, attempt: row.attempts }
}

async function finishEvent(
  backend: any,
  eventId: string,
  attempt: number,
  status: 'processed' | 'ignored',
) {
  const result = await backend
    .from('stripe_webhook_events')
    .update({ status, processed_at: new Date().toISOString(), last_error: null })
    .eq('stripe_event_id', eventId)
    .eq('status', 'processing')
    .eq('attempts', attempt)
  if (result.error) throw createError({ statusCode: 500, statusMessage: result.error.message })
}

async function failEvent(backend: any, eventId: string, attempt: number) {
  await backend
    .from('stripe_webhook_events')
    .update({ status: 'failed', processed_at: null, last_error: 'event_processing_failed' })
    .eq('stripe_event_id', eventId)
    .eq('status', 'processing')
    .eq('attempts', attempt)
}

async function matchingSeatChangeForTerminalInvoice(
  event: Parameters<typeof serverDataBackend>[0],
  subscription: Stripe.Subscription,
  organizationId: string,
  invoice: Stripe.Invoice,
  eventCreated: number,
): Promise<
  | { kind: 'seat_change', changeId: string }
  | { kind: 'uncorrelated_subscription_update' }
  | { kind: 'renewal' }
> {
  if (!isInvoiceForSubscriptionUpdate(invoice, subscription, { requireLatest: false })) {
    return { kind: 'renewal' }
  }

  const existingMatch = await matchingOpenOrganizationSeatChangeId(
    event,
    subscription,
    organizationId,
    invoice,
  )
  if (existingMatch) return { kind: 'seat_change', changeId: existingMatch }
  if (subscription.pending_update) return { kind: 'uncorrelated_subscription_update' }

  // Webhook delivery is unordered. If the terminal Invoice event arrives
  // before pending_update_expired, bind the same conservative canonical latest
  // Invoice correlation that the expiry handler would have persisted.
  const binding = await bindExpiredOrganizationSeatChangeInvoice(
    event,
    subscription,
    organizationId,
    eventCreated,
  )
  if (binding?.invoiceId !== invoice.id) {
    return { kind: 'uncorrelated_subscription_update' }
  }

  const boundMatch = await matchingOpenOrganizationSeatChangeId(
    event,
    subscription,
    organizationId,
    invoice,
  )
  return boundMatch
    ? { kind: 'seat_change', changeId: boundMatch }
    : { kind: 'uncorrelated_subscription_update' }
}

async function reapplyCanonicalSubscriptionAfterTerminalInvoice(
  event: Parameters<typeof serverDataBackend>[0],
  input: { organizationId: string, subscriptionId: string, eventCreated: number },
): Promise<void> {
  try {
    await retrieveAndApplyCurrentStripeSubscription(event, input)
  }
  catch (error) {
    // The terminal Invoice ledger/saga transition is already durable. A seat
    // mismatch must remain fail-closed, but it must not make Stripe retry and
    // lose or indefinitely replay that terminal transition.
    if (isStripeSeatQuantityMismatchError(error)) return
    throw error
  }
}

async function processEvent(event: Parameters<typeof serverDataBackend>[0], stripeEvent: Stripe.Event) {
  if (stripeEvent.account || stripeEvent.context) return false
  try {
    switch (stripeEvent.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
    case 'checkout.session.async_payment_failed': {
      const checkout = stripeEvent.data.object as Stripe.Checkout.Session
      const subscriptionId = checkoutSubscriptionId(checkout)
      if (!subscriptionId) return false
      const snapshot = await retrieveAndApplyStripeSubscription(
        event,
        subscriptionId,
        stripeEvent.created,
        checkout.id,
      )
      if (
        stripeEvent.type !== 'checkout.session.async_payment_failed'
        && snapshot.accessState === 'active'
      ) {
        await markOrganizationInvitationDiscountApplied(event, {
          organizationId: snapshot.organizationId,
          checkoutSessionId: checkout.id,
          subscriptionId,
          livemode: snapshot.subscription.livemode,
        })
      }
      return true
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
    case 'customer.subscription.pending_update_applied': {
      const subscription = stripeEvent.data.object as Stripe.Subscription
      await retrieveAndApplyStripeSubscription(event, subscription.id, stripeEvent.created)
      return true
    }
    case 'customer.subscription.pending_update_expired': {
      const subscription = stripeEvent.data.object as Stripe.Subscription
      const context = await retrieveCurrentStripeSubscriptionContext(event, subscription.id)
      // A delayed expiry event from change X must never fail a newer pending
      // change Y on the same subscription.
      if (!context.subscription.pending_update) {
        const expiredInvoice = await bindExpiredOrganizationSeatChangeInvoice(
          event,
          context.subscription,
          context.organizationId,
          stripeEvent.created,
        )
        if (expiredInvoice) {
          await failOpenOrganizationSeatChange(event, {
            organizationId: context.organizationId,
            subscriptionId: subscription.id,
            invoiceId: expiredInvoice.invoiceId,
            eventCreated: stripeEvent.created,
            errorCode: 'stripe_pending_update_expired',
            errorMessage: 'Stripe pending subscription update expired before payment completed',
          })
        }
      }
      await reapplyCanonicalSubscriptionAfterTerminalInvoice(event, {
        organizationId: context.organizationId,
        subscriptionId: subscription.id,
        eventCreated: stripeEvent.created,
      })
      return true
    }
    case 'customer.subscription.deleted': {
      await applyStripeSubscriptionSnapshot(
        event,
        stripeEvent.data.object as Stripe.Subscription,
        stripeEvent.created,
      )
      return true
    }
    case 'invoice.paid':
    case 'invoice.payment_succeeded': {
      const invoice = stripeEvent.data.object as Stripe.Invoice
      const subscriptionId = invoiceSubscriptionId(invoice)
      if (!subscriptionId) return false
      const context = await retrieveCurrentStripeInvoiceSubscriptionContext(event, invoice)
      // Resolve every subscription invoice, including seat-update invoices.
      // This monotonic row prevents an older delayed failure event from
      // resurrecting an anomaly after the seat saga has already completed.
      await applyOrganizationInvoiceBillingState(event, {
        organizationId: context.organizationId,
        subscriptionId,
        invoiceId: invoice.id,
        eventCreated: stripeEvent.created,
        state: 'resolved',
      })
      await reapplyCanonicalSubscriptionAfterTerminalInvoice(event, {
        organizationId: context.organizationId,
        subscriptionId,
        eventCreated: stripeEvent.created,
      })
      return true
    }
    case 'invoice.payment_action_required':
    case 'invoice.payment_failed': {
      const subscriptionId = invoiceSubscriptionId(stripeEvent.data.object as Stripe.Invoice)
      if (!subscriptionId) return false
      await retrieveAndApplyStripeSubscription(event, subscriptionId, stripeEvent.created)
      return true
    }
    case 'invoice.finalization_failed': {
      const invoice = stripeEvent.data.object as Stripe.Invoice
      const subscriptionId = invoiceSubscriptionId(invoice)
      if (!subscriptionId) return false
      const context = await retrieveCurrentStripeInvoiceSubscriptionContext(event, invoice)
      const invoiceClassification = await matchingSeatChangeForTerminalInvoice(
        event,
        context.subscription,
        context.organizationId,
        invoice,
        stripeEvent.created,
      )
      if (invoiceClassification.kind === 'renewal') {
        await applyOrganizationInvoiceBillingState(event, {
          organizationId: context.organizationId,
          subscriptionId,
          invoiceId: invoice.id,
          eventCreated: stripeEvent.created,
          state: 'failed',
          failureKind: 'invoice_finalization_failed',
        })
      }
      await reapplyCanonicalSubscriptionAfterTerminalInvoice(event, {
        organizationId: context.organizationId,
        subscriptionId,
        eventCreated: stripeEvent.created,
      })
      return true
    }
    case 'invoice.marked_uncollectible':
    case 'invoice.voided': {
      const invoice = stripeEvent.data.object as Stripe.Invoice
      const subscriptionId = invoiceSubscriptionId(invoice)
      if (!subscriptionId) return false
      const context = await retrieveCurrentStripeInvoiceSubscriptionContext(event, invoice)
      const invoiceClassification = await matchingSeatChangeForTerminalInvoice(
        event,
        context.subscription,
        context.organizationId,
        invoice,
        stripeEvent.created,
      )
      if (invoiceClassification.kind === 'seat_change') {
        await failOrganizationMemberSeatChange(
          event,
          invoiceClassification.changeId,
          stripeEvent.type === 'invoice.voided'
            ? 'stripe_invoice_voided'
            : 'stripe_invoice_uncollectible',
          stripeEvent.type === 'invoice.voided'
            ? 'Stripe seat invoice was voided'
            : 'Stripe seat invoice was marked uncollectible',
        )
      }
      else if (invoiceClassification.kind === 'renewal') {
        await applyOrganizationInvoiceBillingState(event, {
          organizationId: context.organizationId,
          subscriptionId,
          invoiceId: invoice.id,
          eventCreated: stripeEvent.created,
          state: 'failed',
          failureKind: stripeEvent.type === 'invoice.voided'
            ? 'invoice_voided'
            : 'invoice_uncollectible',
        })
      }
      await reapplyCanonicalSubscriptionAfterTerminalInvoice(event, {
        organizationId: context.organizationId,
        subscriptionId,
        eventCreated: stripeEvent.created,
      })
      return true
    }
      default:
        return false
    }
  }
  catch (error) {
    // Checkout is the only authority allowed to replace a subscription. Late
    // events from an older subscription sharing the same Customer are valid
    // Stripe events, but no longer mutate this organization's billing mirror.
    if (isStaleStripeSubscriptionSnapshotError(error)) return false
    throw error
  }
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const config = stripeBillingConfiguration(event)
  if (!config.webhookSecret) {
    throw createError({ statusCode: 503, statusMessage: 'Stripe webhook secret is not configured' })
  }
  const signature = getHeader(event, 'stripe-signature')
  const contentLength = getHeader(event, 'content-length')
  if (contentLength && (!/^\d+$/u.test(contentLength) || Number(contentLength) > MAX_WEBHOOK_BODY_BYTES)) {
    throw createError({ statusCode: 413, statusMessage: 'Stripe webhook payload is too large' })
  }
  const rawBody = await readRawBody(event, false)
  if (!signature || !rawBody) {
    throw createError({ statusCode: 400, statusMessage: 'Stripe signature and raw body are required' })
  }
  if (rawBody.length > MAX_WEBHOOK_BODY_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'Stripe webhook payload is too large' })
  }

  let stripeEvent: Stripe.Event
  try {
    stripeEvent = stripeBillingClient(event).webhooks.constructEvent(
      rawBody,
      signature,
      config.webhookSecret,
    )
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid Stripe webhook signature' })
  }
  if (stripeEvent.livemode !== stripeBillingExpectedLivemode(event)) {
    throw createError({ statusCode: 400, statusMessage: 'Stripe webhook mode does not match the API key' })
  }

  const claimed = await beginEvent(event, stripeEvent)
  if (!claimed.process) {
    if (claimed.status === 'processing') {
      // Another inline delivery still owns the event. A retryable response is
      // required until that owner reaches a durable processed/ignored state;
      // acknowledging here could lose the event if the first request crashes.
      throw createError({ statusCode: 503, statusMessage: 'Stripe event is already processing' })
    }
    return { received: true, duplicate: true, status: claimed.status }
  }
  try {
    const processed = await processEvent(event, stripeEvent)
    await finishEvent(claimed.backend, stripeEvent.id, claimed.attempt, processed ? 'processed' : 'ignored')
    return { received: true, processed }
  }
  catch {
    await failEvent(claimed.backend, stripeEvent.id, claimed.attempt)
    throw createError({ statusCode: 500, statusMessage: 'Stripe event processing failed' })
  }
})
