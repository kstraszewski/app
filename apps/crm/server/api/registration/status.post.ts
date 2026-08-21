import {
  createError,
  readBody,
  setHeader,
} from 'h3'
import { isOpenExpertSameOriginJsonRequest } from '@openexpert/auth/server'
import { verifyRegistrationDeliveryStatusToken } from '~~/server/lib/registration-delivery-status-token'
import { serverDataBackend } from '~~/server/utils/data-api'
import { serverOrganizationInvitationAuth } from '~~/server/utils/platform-auth'
import type { ApplicationRegistrationDeliveryStatusResponse } from '~~/shared/types/system-organizations'

const STALLED_DELIVERY_MS = 90_000

interface DeliveryStatusRow {
  status: 'pending' | 'accepted' | 'completed' | 'expired' | 'revoked'
  sent_at: string | null
  delivery_attempts: number
  last_delivery_error: string | null
  expires_at: string
  updated_at: string
}

export default defineEventHandler(async (
  event,
): Promise<ApplicationRegistrationDeliveryStatusResponse> => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'Referrer-Policy', 'no-referrer')

  const runtime = serverOrganizationInvitationAuth(event)
  if (!isOpenExpertSameOriginJsonRequest(event.headers, runtime.config.baseURL)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }
  const body = await readBody<unknown>(event)
  const token = body && typeof body === 'object' && !Array.isArray(body)
    ? (body as { token?: unknown }).token
    : undefined
  const receipt = verifyRegistrationDeliveryStatusToken(token, runtime.config.secret)
  if (!receipt) {
    throw createError({ statusCode: 404, statusMessage: 'Registration request not found' })
  }

  const backend = serverDataBackend(event) as any
  const result = await backend
    .from('organization_onboarding_invitations')
    .select('status, sent_at, delivery_attempts, last_delivery_error, expires_at, updated_at')
    .eq('id', receipt.invitationId)
    .maybeSingle()
  if (result.error) {
    console.error('[self-service-registration] delivery status lookup failed', {
      invitationId: receipt.invitationId,
      code: String(result.error.code || ''),
    })
    throw createError({
      statusCode: 503,
      statusMessage: 'Registration status is temporarily unavailable',
    })
  }
  if (!result.data) {
    throw createError({ statusCode: 404, statusMessage: 'Registration request not found' })
  }

  const row = result.data as DeliveryStatusRow
  if (row.sent_at || row.status === 'accepted' || row.status === 'completed') {
    return { status: 'sent' }
  }
  if (
    row.status === 'expired'
    || row.status === 'revoked'
    || Date.parse(row.expires_at) <= Date.now()
  ) {
    return { status: 'expired' }
  }
  if (row.last_delivery_error) return { status: 'failed' }

  const updatedAt = Date.parse(row.updated_at)
  if (
    Number(row.delivery_attempts) > 0
    && Number.isFinite(updatedAt)
    && Date.now() - updatedAt > STALLED_DELIVERY_MS
  ) {
    console.error('[self-service-registration] delivery attempt stalled', {
      invitationId: receipt.invitationId,
      attempts: Number(row.delivery_attempts),
    })
    return { status: 'failed' }
  }
  return { status: 'queued' }
})
