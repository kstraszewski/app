import { isOpenExpertSameOriginJsonRequest } from '@openexpert/auth/server'
import {
  createError,
  readBody,
  setHeader,
  setResponseStatus,
} from 'h3'
import {
  asRecord,
  requireAuthenticatedSession,
  requireSuperAdmin,
} from '~~/server/utils/crm'
import {
  createOrganizationInvitation,
  type OrganizationInvitationKind,
} from '~~/server/utils/organization-invitations'
import { serverAuth } from '~~/server/utils/platform-auth'
import type { OrganizationInvitationBillingDiscount } from '~~/shared/types/system-organizations'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u
const MAX_FIXED_DISCOUNT_MINOR = 100_000_000

function requiredString(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== 'string') {
    throw createError({ statusCode: 400, statusMessage: `${field} is required` })
  }
  const result = value.trim()
  if (!result || result.length > maxLength || /[\p{Cc}\p{Cf}]/u.test(result)) {
    throw createError({ statusCode: 400, statusMessage: `${field} is invalid` })
  }
  return result
}

function initialSeatCount(value: unknown, organizationKind: OrganizationInvitationKind): number {
  if (value == null) return 1
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < 1
    || value > 100
    || (organizationKind === 'intermediary' && value !== 1)
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'initialSeatCount is invalid',
    })
  }
  return value
}

function rejectUnknownDiscountFields(
  value: Record<string, unknown>,
  allowedFields: readonly string[],
): void {
  if (Object.keys(value).some(field => !allowedFields.includes(field))) {
    throw createError({ statusCode: 400, statusMessage: 'billingDiscount contains an unsupported field' })
  }
}

function billingDiscount(
  value: unknown,
  organizationKind: OrganizationInvitationKind,
): OrganizationInvitationBillingDiscount | null {
  if (value == null) return null
  if (organizationKind !== 'application') {
    throw createError({ statusCode: 400, statusMessage: 'billingDiscount is only available for application organizations' })
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createError({ statusCode: 400, statusMessage: 'billingDiscount is invalid' })
  }

  const input = value as Record<string, unknown>
  const duration = input.duration
  if (duration !== 'once' && duration !== 'repeating' && duration !== 'forever') {
    throw createError({ statusCode: 400, statusMessage: 'billingDiscount.duration is invalid' })
  }
  const durationMonths = duration === 'repeating'
    ? input.durationMonths
    : null
  if (
    duration === 'repeating'
    && (
      typeof durationMonths !== 'number'
      || !Number.isSafeInteger(durationMonths)
      || durationMonths < 1
      || durationMonths > 36
    )
  ) {
    throw createError({ statusCode: 400, statusMessage: 'billingDiscount.durationMonths must be between 1 and 36' })
  }
  if (duration !== 'repeating' && input.durationMonths != null) {
    throw createError({ statusCode: 400, statusMessage: 'billingDiscount.durationMonths is only valid for repeating discounts' })
  }

  if (input.kind === 'percentage') {
    rejectUnknownDiscountFields(input, [
      'kind',
      'percentOffBps',
      'duration',
      'durationMonths',
    ])
    if (
      typeof input.percentOffBps !== 'number'
      || !Number.isSafeInteger(input.percentOffBps)
      || input.percentOffBps < 1
      || input.percentOffBps > 10_000
    ) {
      throw createError({ statusCode: 400, statusMessage: 'billingDiscount.percentOffBps must be between 1 and 10000' })
    }
    return {
      kind: 'percentage',
      percentOffBps: Number(input.percentOffBps),
      duration,
      durationMonths: duration === 'repeating' ? Number(durationMonths) : null,
    }
  }

  if (input.kind === 'fixed_amount') {
    rejectUnknownDiscountFields(input, [
      'kind',
      'amountOffMinor',
      'currency',
      'duration',
      'durationMonths',
    ])
    if (
      typeof input.amountOffMinor !== 'number'
      || !Number.isSafeInteger(input.amountOffMinor)
      || input.amountOffMinor < 1
      || input.amountOffMinor > MAX_FIXED_DISCOUNT_MINOR
      || input.currency !== 'pln'
    ) {
      throw createError({ statusCode: 400, statusMessage: 'billingDiscount fixed amount must be a positive PLN amount' })
    }
    return {
      kind: 'fixed_amount',
      amountOffMinor: Number(input.amountOffMinor),
      currency: 'pln',
      duration,
      durationMonths: duration === 'repeating' ? Number(durationMonths) : null,
    }
  }

  throw createError({ statusCode: 400, statusMessage: 'billingDiscount.kind is invalid' })
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const runtime = serverAuth(event)
  if (!isOpenExpertSameOriginJsonRequest(event.headers, runtime.config.baseURL)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }
  const session = await requireAuthenticatedSession(event)
  await requireSuperAdmin(session)
  const body = asRecord(await readBody(event))

  const email = requiredString(body.email, 'email', 320).toLowerCase()
  if (!EMAIL_PATTERN.test(email)) {
    throw createError({ statusCode: 400, statusMessage: 'email is invalid' })
  }
  const organizationName = requiredString(
    body.organizationName,
    'organizationName',
    160,
  )
  const organizationKind = body.organizationKind
  if (organizationKind !== 'intermediary' && organizationKind !== 'application') {
    throw createError({ statusCode: 400, statusMessage: 'organizationKind is invalid' })
  }
  const administratorName = body.administratorName == null
    || (typeof body.administratorName === 'string' && !body.administratorName.trim())
    ? null
    : requiredString(body.administratorName, 'administratorName', 200)
  const parsedBillingDiscount = billingDiscount(
    body.billingDiscount,
    organizationKind as OrganizationInvitationKind,
  )
  const parsedInitialSeatCount = initialSeatCount(
    body.initialSeatCount,
    organizationKind as OrganizationInvitationKind,
  )

  const issued = await createOrganizationInvitation(event, {
    email,
    organizationName,
    organizationKind: organizationKind as OrganizationInvitationKind,
    onboardingSource: 'superadmin_invitation',
    initialSeatCount: parsedInitialSeatCount,
    administratorName,
    billingDiscount: parsedBillingDiscount,
    invitedByUserId: session.userId,
  })
  setResponseStatus(event, 201)
  return issued
})
