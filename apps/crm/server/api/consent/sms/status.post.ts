import { createHash, timingSafeEqual } from 'node:crypto'
import { useRuntimeConfig } from '#imports'
import { createError, getHeader, readBody, setHeader } from 'h3'
import { isConsentCaptureUuid } from '~~/server/utils/consent-capture'
import { serverDataBackend } from '~~/server/utils/data-api'
import { asRecord, textValue } from '~~/server/utils/crm'

type ProviderStatus = 'delivered' | 'failed'

interface ProviderStatusRequestRow {
  id: string
  organization_id: string
  status: string
  delivery_status: string | null
  provider_message_id: string | null
  delivered_at: string | null
}

function setWebhookHeaders(event: Parameters<typeof setHeader>[0]): void {
  setHeader(event, 'Cache-Control', 'no-store, max-age=0')
  setHeader(event, 'Pragma', 'no-cache')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
}

function securelyEqualText(left: string, right: string): boolean {
  const leftHash = createHash('sha256').update(left, 'utf8').digest()
  const rightHash = createHash('sha256').update(right, 'utf8').digest()
  return timingSafeEqual(leftHash, rightHash)
}

function requireGatewayAuthorization(event: Parameters<typeof getHeader>[0]): void {
  const config = useRuntimeConfig(event).consentSms as { gatewayToken?: unknown }
  const gatewayToken = textValue(config?.gatewayToken)
  if (!gatewayToken) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Consent SMS status callback is not configured',
    })
  }

  const authorization = getHeader(event, 'authorization') ?? ''
  if (!securelyEqualText(authorization, `Bearer ${gatewayToken}`)) {
    setHeader(event, 'WWW-Authenticate', 'Bearer')
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }
}

function providerMessageId(input: unknown): string {
  const value = textValue(input)
  if (!value || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'providerMessageId is invalid',
    })
  }
  return value
}

function providerStatus(input: unknown): ProviderStatus {
  if (input !== 'delivered' && input !== 'failed') {
    throw createError({
      statusCode: 400,
      statusMessage: 'status must be delivered or failed',
    })
  }
  return input
}

function throwWebhookDbError(error: { message?: string } | null | undefined): void {
  if (!error) return
  console.error('[consent-sms-status] database operation failed')
  throw createError({
    statusCode: 500,
    statusMessage: 'Consent SMS status could not be recorded',
  })
}

export default defineEventHandler(async (event) => {
  setWebhookHeaders(event)
  requireGatewayAuthorization(event)

  const body = asRecord(await readBody(event))
  if (!isConsentCaptureUuid(body.requestId)) {
    throw createError({ statusCode: 400, statusMessage: 'requestId must be a UUID' })
  }
  const requestId = body.requestId
  const messageId = providerMessageId(body.providerMessageId)
  const status = providerStatus(body.status)
  const backendData = serverDataBackend(event) as any

  const requestResult = await backendData
    .from('crm_consent_capture_requests')
    .select(
      'id, organization_id, status, delivery_status, provider_message_id, delivered_at',
    )
    .eq('id', requestId)
    .maybeSingle()
  throwWebhookDbError(requestResult.error)
  if (!requestResult.data) {
    throw createError({ statusCode: 404, statusMessage: 'Consent request not found' })
  }

  const request = requestResult.data as ProviderStatusRequestRow
  if (
    request.provider_message_id
    && request.provider_message_id !== messageId
  ) {
    throw createError({ statusCode: 404, statusMessage: 'Consent request not found' })
  }

  const nowIso = new Date().toISOString()
  const eventType = status === 'delivered' ? 'sms_delivered' : 'sms_delivery_failed'

  // Provider callbacks may arrive out of order. A late failure must never
  // downgrade a delivery that has already been confirmed.
  if (status === 'failed' && (request.status === 'delivered' || request.delivered_at)) {
    return {
      ok: true,
      status: 'delivered',
      duplicate: true,
      ignored: 'late_failure_after_delivery',
    }
  }

  const eventResult = await backendData
    .from('crm_consent_capture_events')
    .select('id')
    .eq('request_id', request.id)
    .eq('event_type', eventType)
    .eq('provider_message_id', messageId)
    .limit(1)
    .maybeSingle()
  throwWebhookDbError(eventResult.error)

  const preserveWorkflowStatus = [
    'delivered',
    'opened',
    'verified',
    'accepted',
    'declined',
    'withdrawn',
    'expired',
    'cancelled',
  ].includes(request.status)
  const otpLocked = request.status === 'failed' && request.delivery_status === 'otp_locked'
  const nextRequestStatus = preserveWorkflowStatus || otpLocked
    ? request.status
    : status === 'delivered'
      ? 'delivered'
      : 'failed'

  const [requestUpdate, outboxUpdate] = await Promise.all([
    backendData
      .from('crm_consent_capture_requests')
      .update({
        status: nextRequestStatus,
        delivery_status: status,
        provider_message_id: messageId,
        ...(status === 'delivered'
          ? { delivered_at: request.delivered_at ?? nowIso }
          : {}),
        updated_at: nowIso,
      })
      .eq('id', request.id)
      .eq('organization_id', request.organization_id),
    backendData
      .from('crm_sms_outbox')
      .update({
        status,
        body: '[redacted after delivery attempt]',
        provider_message_id: messageId,
        ...(status === 'delivered'
          ? { delivered_at: request.delivered_at ?? nowIso }
          : { failed_at: nowIso }),
        last_error: status === 'failed'
          ? 'Provider reported delivery failure'
          : null,
        updated_at: nowIso,
      })
      .eq('request_id', request.id)
      .eq('organization_id', request.organization_id),
  ])
  throwWebhookDbError(requestUpdate.error)
  throwWebhookDbError(outboxUpdate.error)

  if (!eventResult.data) {
    const insertEventResult = await backendData
      .from('crm_consent_capture_events')
      .insert({
        organization_id: request.organization_id,
        request_id: request.id,
        event_type: eventType,
        actor_user_id: null,
        provider_message_id: messageId,
        metadata: { source: 'provider_status_webhook' },
        occurred_at: nowIso,
      })
    throwWebhookDbError(insertEventResult.error)
  }

  return {
    ok: true,
    status,
    duplicate: Boolean(eventResult.data),
  }
})
