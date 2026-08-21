import Stripe from 'stripe'
import { createError, readBody, setHeader } from 'h3'
import {
  asRecord,
  numberValue,
  requireCrmSession,
  requireOrganizationAdmin,
  requiredText,
  textValue,
} from '~~/server/utils/crm'
import {
  applyStripeSubscriptionSnapshot,
  beginOrganizationPlanUpgrade,
  createOrganizationPlanUpgradeQuote,
  markOrganizationPlanUpgrade,
  requireStripeBillingBrowserRequest,
  updateOrganizationStripePlanToTeam,
} from '~~/server/utils/stripe-billing'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

function ambiguousStripeMutation(error: unknown): boolean {
  return error instanceof Stripe.errors.StripeConnectionError
    || error instanceof Stripe.errors.StripeAPIError
}

function failureCode(error: unknown): string {
  if (error instanceof Stripe.errors.StripeError) return error.code || error.type
  const value = textValue(asRecord(error).statusMessage) || 'plan_upgrade_failed'
  return value.toLowerCase().replace(/[^a-z0-9_.:-]+/gu, '_').slice(0, 120)
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  requireStripeBillingBrowserRequest(event)
  const session = await requireCrmSession(event)
  requireOrganizationAdmin(session)
  if (session.organizationKind !== 'application') {
    throw createError({ statusCode: 409, statusMessage: 'Application organization required' })
  }
  const body = asRecord(await readBody(event))
  const idempotencyKey = requiredText(body.idempotencyKey, 'idempotencyKey')
  const expectedSeatRevision = numberValue(body.expectedSeatRevision)
  const prorationDate = numberValue(body.prorationDate)
  const fromStripePriceId = requiredText(body.fromStripePriceId, 'fromStripePriceId')
  const targetStripePriceId = requiredText(body.targetStripePriceId, 'targetStripePriceId')
  if (
    !UUID_PATTERN.test(idempotencyKey)
    || !Number.isSafeInteger(expectedSeatRevision)
    || (expectedSeatRevision ?? 0) < 1
    || !Number.isSafeInteger(prorationDate)
  ) {
    throw createError({ statusCode: 400, statusMessage: 'Plan upgrade confirmation is invalid' })
  }

  const canonicalQuote = await createOrganizationPlanUpgradeQuote(
    event,
    session.organizationId,
    prorationDate as number,
  )
  if (
    canonicalQuote.expectedSeatRevision !== expectedSeatRevision
    || canonicalQuote.fromStripePriceId !== fromStripePriceId
    || canonicalQuote.targetStripePriceId !== targetStripePriceId
    || canonicalQuote.prorationDate !== prorationDate
  ) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Plan upgrade quote changed; request a new quote before confirming',
    })
  }

  const claim = await beginOrganizationPlanUpgrade(event, {
    organizationId: session.organizationId,
    actorUserId: session.userId,
    clientIdempotencyKey: idempotencyKey,
    expectedSeatRevision: expectedSeatRevision as number,
    fromStripePriceId,
    targetStripePriceId,
    prorationDate: prorationDate as number,
  })
  if (claim.status === 'succeeded') {
    return { status: 'succeeded' as const, planChangeId: claim.changeId }
  }
  if (claim.status === 'failed') {
    throw createError({ statusCode: 409, statusMessage: 'This plan upgrade has failed; request a new quote' })
  }
  if (claim.status === 'pending' && claim.paymentUrl) {
    return {
      status: 'requires_action' as const,
      planChangeId: claim.changeId,
      paymentUrl: claim.paymentUrl,
    }
  }

  let update
  try {
    update = await updateOrganizationStripePlanToTeam(event, {
      organizationId: session.organizationId,
      changeId: claim.changeId,
      expectedUpdatedAt: claim.updatedAt,
      prorationDate: prorationDate as number,
      stripeIdempotencyKey: claim.stripeIdempotencyKey,
      allowExistingPending: claim.replayed,
    })
  }
  catch (error) {
    const data = asRecord(asRecord(error).data)
    if (data.planUpgradeClaimLost === true) {
      if (data.planChangeStatus === 'succeeded') {
        return { status: 'succeeded' as const, planChangeId: claim.changeId }
      }
      if (data.planChangeStatus === 'failed') {
        throw createError({ statusCode: 409, statusMessage: 'This plan upgrade has failed; request a new quote' })
      }
      return { status: 'processing' as const, planChangeId: claim.changeId }
    }
    if (ambiguousStripeMutation(error)) {
      await markOrganizationPlanUpgrade(event, {
        changeId: claim.changeId,
        status: 'pending',
      })
      return { status: 'processing' as const, planChangeId: claim.changeId }
    }
    await markOrganizationPlanUpgrade(event, {
      changeId: claim.changeId,
      status: 'failed',
      failureCode: failureCode(error),
      failureMessage: textValue(asRecord(error).message),
    })
    throw error
  }

  if (update.pending) {
    await markOrganizationPlanUpgrade(event, {
      changeId: claim.changeId,
      status: 'pending',
      invoiceId: update.invoiceId,
      paymentUrl: update.paymentUrl,
    })
    return {
      status: update.paymentUrl ? 'requires_action' as const : 'processing' as const,
      planChangeId: claim.changeId,
      paymentUrl: update.paymentUrl || undefined,
    }
  }

  try {
    await applyStripeSubscriptionSnapshot(
      event,
      update.subscription,
      update.snapshotEventCreated,
    )
    return { status: 'succeeded' as const, planChangeId: claim.changeId }
  }
  catch (error) {
    if (Number(asRecord(error).statusCode) === 409) throw error
    return { status: 'processing' as const, planChangeId: claim.changeId }
  }
})
