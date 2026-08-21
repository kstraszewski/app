import { createError, readBody, setHeader } from 'h3'
import {
  asRecord,
  requireAdministrativePermission,
  requireCrmSession,
  requireOrganizationAdmin,
  requiredText,
  textValue,
} from '~~/server/utils/crm'
import { countLiveOrganizationMemberInvitations } from '~~/server/utils/organization-member-invitations'
import {
  createOrganizationSeatQuote,
  organizationActiveMemberCount,
  organizationBillingAccount,
  requireStripeBillingBrowserRequest,
  resolveOrganizationSeatTarget,
} from '~~/server/utils/stripe-billing'

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

  const [target, activeMembers, billingAccount, reservedSeats] = await Promise.all([
    resolveOrganizationSeatTarget(
      event,
      session.organizationId,
      email,
      session.organizationKind,
    ),
    organizationActiveMemberCount(event, session.organizationId),
    session.organizationKind === 'application'
      ? organizationBillingAccount(event, session.organizationId)
      : Promise.resolve(null),
    session.organizationKind === 'application'
      ? countLiveOrganizationMemberInvitations(event, session.organizationId)
      : Promise.resolve(0),
  ])
  const addsSeat = !target.alreadyMember
  if (session.organizationKind === 'application' && !addsSeat) {
    throw createError({ statusCode: 409, statusMessage: 'user_already_member' })
  }
  const licensedSeats = session.organizationKind === 'application'
    ? Number(billingAccount?.licensed_seat_count)
    : activeMembers
  const occupiedSeats = activeMembers + reservedSeats
  if (
    session.organizationKind === 'application'
    && (
      !Number.isSafeInteger(licensedSeats)
      || licensedSeats < occupiedSeats
      || licensedSeats < 1
    )
  ) {
    throw createError({ statusCode: 409, statusMessage: 'Organization paid seat capacity is out of sync' })
  }
  const billingRequired = session.organizationKind === 'application'
    && addsSeat
    && occupiedSeats >= licensedSeats
  if (billingRequired && reservedSeats > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Pending invitations occupy the remaining paid seats; accept or revoke them first',
    })
  }
  const currentSeats = session.organizationKind === 'application'
    ? licensedSeats
    : activeMembers
  const increasesPaidCapacity = billingRequired
    || (session.organizationKind !== 'application' && addsSeat)
  return createOrganizationSeatQuote(event, {
    organizationId: session.organizationId,
    targetUserId: target.userId,
    billingRequired,
    expectedActiveMembers: activeMembers,
    expectedReservedSeats: reservedSeats,
    expectedOccupiedSeats: occupiedSeats,
    currentSeats,
    nextSeats: currentSeats + (increasesPaidCapacity ? 1 : 0),
  })
})
