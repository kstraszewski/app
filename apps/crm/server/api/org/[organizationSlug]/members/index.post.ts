import Stripe from 'stripe'
import { createError, readBody, setHeader } from 'h3'
import {
  asRecord,
  numberValue,
  requireAdministrativePermission,
  requireCrmSession,
  requireOrganizationAdmin,
  requiredText,
  textValue,
  throwDbError,
} from '~~/server/utils/crm'
import { serverDataBackend } from '~~/server/utils/data-api'
import { countLiveOrganizationMemberInvitations } from '~~/server/utils/organization-member-invitations'
import {
  applyStripeSubscriptionSnapshot,
  beginOrganizationMemberSeatChange,
  failOrganizationMemberSeatChange,
  markOrganizationMemberSeatChangePending,
  organizationActiveMemberCount,
  organizationBillingAccount,
  requireStripeBillingBrowserRequest,
  resolveOrganizationSeatTarget,
  updateOrganizationStripeSeatQuantity,
} from '~~/server/utils/stripe-billing'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

function ambiguousStripeMutation(error: unknown): boolean {
  if (
    error instanceof Stripe.errors.StripeConnectionError
    || error instanceof Stripe.errors.StripeAPIError
  ) return true
  return asRecord(asRecord(error).data).stripeMutationMayHaveApplied === true
}

function errorCode(error: unknown): string {
  if (error instanceof Stripe.errors.StripeError) return error.code || error.type
  return textValue(asRecord(error).statusMessage) ?? 'seat_update_failed'
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  requireStripeBillingBrowserRequest(event)
  const session = await requireCrmSession(event)
  if (session.organizationKind === 'application') {
    requireOrganizationAdmin(session)
  }
  else {
    await requireAdministrativePermission(session, 'iam.members.manage')
  }
  const body = asRecord(await readBody(event))
  const email = requiredText(body.email, 'email').toLowerCase()
  const role = textValue(body.role) ?? 'expert'
  if (role !== 'expert' && role !== 'admin') {
    throw createError({ statusCode: 400, statusMessage: 'Invalid organization role' })
  }

  const target = await resolveOrganizationSeatTarget(
    event,
    session.organizationId,
    email,
    session.organizationKind,
  )
  if (session.organizationKind !== 'application') {
    const { data, error } = await session.dataApi.rpc('add_organization_member_by_email', {
      organization_id: session.organizationId,
      email,
      role,
    })
    throwDbError(error, error?.message === 'user_not_found' ? 404 : 500)
    return { status: 'succeeded' as const, data: Array.isArray(data) ? data[0] : data }
  }
  if (target.alreadyMember) {
    const backend = serverDataBackend(event) as any
    const membership = await backend
      .from('organization_memberships')
      .select('user_id, role, created_at')
      .eq('organization_id', session.organizationId)
      .eq('user_id', target.userId)
      .maybeSingle()
    if (membership.error) {
      throw createError({ statusCode: 500, statusMessage: membership.error.message })
    }
    return { status: 'succeeded' as const, data: membership.data ?? { user_id: target.userId } }
  }

  const billingAccount = await organizationBillingAccount(event, session.organizationId)
  const licensedSeats = Number(billingAccount?.licensed_seat_count)
  const [activeMembers, reservedSeats] = await Promise.all([
    organizationActiveMemberCount(event, session.organizationId),
    countLiveOrganizationMemberInvitations(event, session.organizationId),
  ])
  const occupiedSeats = activeMembers + reservedSeats
  const expectedActiveMembers = numberValue(body.expectedActiveMembers)
  const expectedReservedSeats = numberValue(body.expectedReservedSeats)
  const expectedOccupiedSeats = numberValue(body.expectedOccupiedSeats)
  const quotedBillingRequired = body.quotedBillingRequired
  if (
    !Number.isSafeInteger(licensedSeats)
    || licensedSeats < 1
    || occupiedSeats > licensedSeats
  ) {
    throw createError({ statusCode: 409, statusMessage: 'Organization paid seat capacity is out of sync' })
  }

  if (
    !Number.isSafeInteger(expectedActiveMembers)
    || (expectedActiveMembers ?? 0) < 1
    || !Number.isSafeInteger(expectedReservedSeats)
    || (expectedReservedSeats ?? -1) < 0
    || !Number.isSafeInteger(expectedOccupiedSeats)
    || expectedOccupiedSeats !== (expectedActiveMembers ?? 0) + (expectedReservedSeats ?? 0)
    || (quotedBillingRequired !== true && quotedBillingRequired !== false)
  ) {
    throw createError({ statusCode: 400, statusMessage: 'Seat quote confirmation is invalid' })
  }
  const billingRequired = occupiedSeats >= licensedSeats
  if (
    expectedActiveMembers !== activeMembers
    || expectedReservedSeats !== reservedSeats
    || expectedOccupiedSeats !== occupiedSeats
    || quotedBillingRequired !== billingRequired
  ) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Organization seats changed; request a new quote',
    })
  }

  if (billingRequired && reservedSeats > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Pending invitations occupy the remaining paid seats; accept or revoke them first',
    })
  }

  if (!billingRequired) {
    const backend = serverDataBackend(event) as any
    const freeSeat = await backend.rpc('add_organization_member_within_capacity_v1', {
      p_organization_id: session.organizationId,
      p_actor_user_id: session.userId,
      p_target_email: email,
      p_target_role: role,
    })
    if (freeSeat.error) {
      const statusCode = freeSeat.error.code === 'P0002'
        ? 404
        : freeSeat.error.code === '42501'
          ? 403
          : ['23505', '23514'].includes(freeSeat.error.code)
            ? 409
            : 500
      throw createError({ statusCode, statusMessage: freeSeat.error.message })
    }
    return {
      status: 'succeeded' as const,
      data: freeSeat.data,
      usedPrepaidSeat: true,
    }
  }

  const idempotencyKey = requiredText(body.idempotencyKey, 'idempotencyKey')
  const expectedCurrentSeats = numberValue(body.expectedCurrentSeats)
  const prorationDate = numberValue(body.prorationDate)
  if (!UUID_PATTERN.test(idempotencyKey)) {
    throw createError({ statusCode: 400, statusMessage: 'idempotencyKey must be a UUID' })
  }
  if (!Number.isSafeInteger(expectedCurrentSeats) || (expectedCurrentSeats ?? 0) < 1) {
    throw createError({ statusCode: 400, statusMessage: 'expectedCurrentSeats is invalid' })
  }
  if (!Number.isSafeInteger(prorationDate)) {
    throw createError({ statusCode: 400, statusMessage: 'prorationDate is invalid' })
  }
  const currentSeatCount = expectedCurrentSeats as number
  const prorationTimestamp = prorationDate as number
  if (activeMembers !== currentSeatCount || licensedSeats !== currentSeatCount) {
    throw createError({ statusCode: 409, statusMessage: 'Organization seats changed; request a new quote' })
  }

  const claim = await beginOrganizationMemberSeatChange(event, {
    organizationId: session.organizationId,
    actorUserId: session.userId,
    targetEmail: email,
    targetRole: role,
    idempotencyKey,
    expectedCurrentSeats: currentSeatCount,
    prorationDate: prorationTimestamp,
  })
  if (claim.targetUserId !== target.userId || claim.currentSeats !== currentSeatCount) {
    throw createError({ statusCode: 409, statusMessage: 'Seat change claim is stale' })
  }
  if (claim.status === 'failed') {
    throw createError({ statusCode: 409, statusMessage: 'This seat change has failed; request a new quote' })
  }
  if (claim.status === 'succeeded') {
    return { status: 'succeeded' as const, seatChangeId: claim.changeId }
  }
  let seatUpdate
  try {
    seatUpdate = await updateOrganizationStripeSeatQuantity(event, {
      organizationId: session.organizationId,
      seatChangeId: claim.changeId,
      expectedSeatChangeUpdatedAt: claim.updatedAt,
      expectedCurrentSeats: claim.currentSeats,
      nextSeats: claim.targetSeats,
      prorationDate: prorationTimestamp,
      idempotencyKey: claim.stripeIdempotencyKey,
      allowExistingPending: claim.replayed,
    })
  }
  catch (error) {
    const claimLoss = asRecord(asRecord(error).data)
    if (claimLoss.seatMutationClaimLost === true) {
      if (claimLoss.seatChangeStatus === 'failed') {
        throw createError({ statusCode: 409, statusMessage: 'This seat change has failed; request a new quote' })
      }
      if (claimLoss.seatChangeStatus === 'succeeded') {
        return { status: 'succeeded' as const, seatChangeId: claim.changeId }
      }
      return { status: 'processing' as const, seatChangeId: claim.changeId }
    }
    if (ambiguousStripeMutation(error)) {
      await markOrganizationMemberSeatChangePending(event, { changeId: claim.changeId })
      return { status: 'processing' as const, seatChangeId: claim.changeId }
    }
    await failOrganizationMemberSeatChange(
      event,
      claim.changeId,
      errorCode(error),
      textValue(asRecord(error).message) ?? textValue(asRecord(error).statusMessage),
    )
    throw error
  }

  if (seatUpdate.pending) {
    await markOrganizationMemberSeatChangePending(event, {
      changeId: claim.changeId,
      invoiceId: seatUpdate.invoiceId,
      paymentUrl: seatUpdate.paymentUrl,
    })
    return {
      status: seatUpdate.paymentUrl ? 'requires_action' as const : 'processing' as const,
      seatChangeId: claim.changeId,
      paymentUrl: seatUpdate.paymentUrl ?? undefined,
    }
  }

  try {
    const snapshot = await applyStripeSubscriptionSnapshot(
      event,
      seatUpdate.subscription,
      seatUpdate.snapshotEventCreated,
    )
    const backend = serverDataBackend(event) as any
    const membership = await backend
      .from('organization_memberships')
      .select('user_id, role, created_at')
      .eq('organization_id', session.organizationId)
      .eq('user_id', target.userId)
      .maybeSingle()
    if (membership.error) {
      throw createError({ statusCode: 500, statusMessage: membership.error.message })
    }
    if (membership.data) {
      return {
        status: 'succeeded' as const,
        seatChangeId: snapshot.finalizedSeatChangeId ?? claim.changeId,
        data: membership.data,
      }
    }
  }
  catch (error) {
    if (Number(asRecord(error).statusCode) === 409) throw error
    // Stripe is canonical after the update. A signed webhook or reconciliation
    // will retry the database snapshot without charging the customer again.
  }

  return { status: 'processing' as const, seatChangeId: claim.changeId }
})
