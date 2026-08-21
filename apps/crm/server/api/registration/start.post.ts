import {
  consumeOpenExpertAuthRateLimit,
  getOpenExpertTrustedClientIp,
  isOpenExpertSameOriginJsonRequest,
  scheduleOpenExpertBackgroundTask,
} from '@openexpert/auth/server'
import {
  createError,
  readBody,
  setHeader,
} from 'h3'
import { createOrganizationInvitation } from '~~/server/utils/organization-invitations'
import { serverOrganizationInvitationAuth } from '~~/server/utils/platform-auth'
import type {
  StartApplicationRegistrationBody,
  StartApplicationRegistrationResponse,
} from '~~/shared/types/system-organizations'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u
const RESPONSE_FLOOR_MS = 600
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1_000

interface UntrustedRegistrationBody {
  email?: unknown
  administratorName?: unknown
  organizationName?: unknown
  initialSeatCount?: unknown
}

function requiredString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw createError({ statusCode: 400, statusMessage: `${field} is required` })
  }
  const result = value.trim()
  if (!result || result.length > maxLength || /[\p{Cc}\p{Cf}]/u.test(result)) {
    throw createError({ statusCode: 400, statusMessage: `${field} is invalid` })
  }
  return result
}

function untrustedBody(value: unknown): UntrustedRegistrationBody {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createError({ statusCode: 400, statusMessage: 'Request body is invalid' })
  }
  return value as UntrustedRegistrationBody
}

function normalizedEmailCandidate(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().slice(0, 320)
    : ''
}

function registrationBody(value: UntrustedRegistrationBody): StartApplicationRegistrationBody {
  const email = requiredString(value.email, 'email', 320).toLowerCase()
  if (!EMAIL_PATTERN.test(email)) {
    throw createError({ statusCode: 400, statusMessage: 'email is invalid' })
  }

  const initialSeatCount = value.initialSeatCount
  if (
    typeof initialSeatCount !== 'number'
    || !Number.isSafeInteger(initialSeatCount)
    || initialSeatCount < 1
    || initialSeatCount > 100
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'initialSeatCount must be between 1 and 100',
    })
  }

  return {
    email,
    administratorName: requiredString(
      value.administratorName,
      'administratorName',
      200,
    ),
    organizationName: requiredString(value.organizationName, 'organizationName', 160),
    initialSeatCount,
  }
}

async function waitForResponseFloor(startedAt: number): Promise<void> {
  const remaining = RESPONSE_FLOOR_MS - (Date.now() - startedAt)
  if (remaining > 0) {
    await new Promise(resolve => setTimeout(resolve, remaining))
  }
}

export default defineEventHandler(async (event): Promise<StartApplicationRegistrationResponse> => {
  const startedAt = Date.now()
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'Referrer-Policy', 'no-referrer')

  try {
    const runtime = serverOrganizationInvitationAuth(event)
    if (!isOpenExpertSameOriginJsonRequest(event.headers, runtime.config.baseURL)) {
      throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
    }

    const bodyValue = await readBody<unknown>(event)
    const emailCandidate = bodyValue && typeof bodyValue === 'object' && !Array.isArray(bodyValue)
      ? (bodyValue as UntrustedRegistrationBody).email
      : undefined
    const rateLimit = await consumeOpenExpertAuthRateLimit({
      pool: runtime.pool,
      databaseSchema: runtime.config.databaseSchema,
      keySecret: runtime.config.secret,
      scope: 'crm:self-service-registration',
      ipAddress: getOpenExpertTrustedClientIp({
        headers: event.headers,
        directAddress: event.node.req.socket.remoteAddress,
        trustedHeaderNames: runtime.config.ipAddressHeaders,
      }),
      identifier: normalizedEmailCandidate(emailCandidate),
      windowMs: RATE_LIMIT_WINDOW_MS,
      pairMax: 3,
      identifierMax: 5,
      ipMax: 20,
    })
    if (!rateLimit.allowed) {
      setHeader(event, 'Retry-After', rateLimit.retryAfterSeconds)
      setHeader(event, 'X-Retry-After', String(rateLimit.retryAfterSeconds))
      throw createError({
        statusCode: 429,
        statusMessage: 'Too many registration requests',
      })
    }

    const rawBody = untrustedBody(bodyValue)
    const body = registrationBody(rawBody)

    const creationTask = createOrganizationInvitation(event, {
      email: body.email,
      administratorName: body.administratorName,
      organizationName: body.organizationName,
      organizationKind: 'application',
      onboardingSource: 'self_service',
      initialSeatCount: body.initialSeatCount,
      billingDiscount: null,
      invitedByUserId: null,
    }).then(() => undefined).catch((error) => {
      console.error('[self-service-registration] registration start failed', {
        name: error instanceof Error ? error.name : 'UnknownError',
      })
    })
    scheduleOpenExpertBackgroundTask(creationTask, event.waitUntil.bind(event))

    return { accepted: true }
  }
  finally {
    await waitForResponseFloor(startedAt)
  }
})
