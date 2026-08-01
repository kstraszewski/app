import { randomUUID } from 'node:crypto'
import { useRuntimeConfig } from '#imports'
import { createError, readBody, setHeader } from 'h3'
import {
  buildConsentSmsBody,
  consentCaptureActiveStatuses,
  consentCaptureDemoUrl,
  consentCapturePublicUrl,
  generateConsentCaptureOtp,
  generateConsentCaptureToken,
  hashConsentCaptureOtp,
  hashConsentCaptureToken,
  isConsentCaptureUuid,
  maskConsentPhone,
  normalizeConsentPhone,
  resolveConsentSmsConfig,
  sendConsentSms,
  type ConsentCaptureIntent,
  type ConsentSmsConfig,
  type ConsentSmsRuntimeInput,
  type ConsentSmsSendResult,
} from '~~/server/utils/consent-capture'
import { serverDataBackend } from '~~/server/utils/data-api'
import {
  asRecord,
  getRequiredParam,
  hasAdministrativePermission,
  requireCrmSession,
  textValue,
  throwDbError,
} from '~~/server/utils/crm'

function consentSmsConfig(event: Parameters<typeof useRuntimeConfig>[0]): ConsentSmsConfig {
  try {
    return resolveConsentSmsConfig(
      useRuntimeConfig(event).consentSms as ConsentSmsRuntimeInput,
      { production: process.env.NODE_ENV === 'production' },
    )
  } catch {
    throw createError({
      statusCode: 503,
      statusMessage: 'Consent SMS delivery is not configured',
    })
  }
}

function requiredUuid(input: unknown, field: string): string {
  if (!isConsentCaptureUuid(input)) {
    throw createError({ statusCode: 400, statusMessage: `${field} must be a UUID` })
  }
  return input
}

function captureIntent(input: unknown): ConsentCaptureIntent {
  if (input === undefined || input === null || input === '') return 'collect'
  if (input !== 'collect' && input !== 'withdraw') {
    throw createError({
      statusCode: 400,
      statusMessage: 'intent must be collect or withdraw',
    })
  }
  return input
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store, max-age=0')
  setHeader(event, 'Pragma', 'no-cache')

  const session = await requireCrmSession(event)
  const definitionId = requiredUuid(getRequiredParam(event, 'consentId'), 'consentId')
  const body = asRecord(await readBody(event))
  const clientId = requiredUuid(body.clientId, 'clientId')
  const subjectPersonId = requiredUuid(body.subjectPersonId, 'subjectPersonId')
  const intent = captureIntent(body.intent)
  const config = consentSmsConfig(event)

  const clientResult = await session.dataApi
    .from('crm_clients')
    .select('id, owner_user_id, primary_phone')
    .eq('organization_id', session.organizationId)
    .eq('id', clientId)
    .maybeSingle()
  throwDbError(clientResult.error)
  if (!clientResult.data) {
    throw createError({ statusCode: 404, statusMessage: 'Client not found' })
  }

  const ownsClient = String(clientResult.data.owner_user_id ?? '') === session.userId
  if (
    !ownsClient
    && !await hasAdministrativePermission(
      session,
      'compliance.consents.definitions.manage',
    )
  ) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Client ownership or consent management permission is required',
    })
  }

  const [personResult, definitionResult, latestDecisionResult] = await Promise.all([
    session.dataApi
      .from('crm_client_people')
      .select('id, client_id, role, phone')
      .eq('organization_id', session.organizationId)
      .eq('client_id', clientId)
      .eq('id', subjectPersonId)
      .maybeSingle(),
    session.dataApi
      .from('crm_consent_definitions')
      .select('id, current_version_id')
      .eq('organization_id', session.organizationId)
      .eq('id', definitionId)
      .maybeSingle(),
    session.dataApi
      .from('crm_client_consent_events')
      .select('decision, definition_version_id, occurred_at')
      .eq('organization_id', session.organizationId)
      .eq('client_id', clientId)
      .eq('subject_person_id', subjectPersonId)
      .eq('definition_id', definitionId)
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  throwDbError(personResult.error)
  throwDbError(definitionResult.error)
  throwDbError(latestDecisionResult.error)
  if (!personResult.data) {
    throw createError({ statusCode: 404, statusMessage: 'Client person not found' })
  }
  if (!definitionResult.data) {
    throw createError({ statusCode: 404, statusMessage: 'Consent definition not found' })
  }

  const now = new Date()
  const nowIso = now.toISOString()
  const latestDecision = textValue(latestDecisionResult.data?.decision)
  if (intent === 'withdraw' && latestDecision !== 'granted') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Only a currently granted consent can be withdrawn',
    })
  }
  if (intent === 'collect' && latestDecision === 'granted') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Consent is already granted; create a withdrawal request instead',
    })
  }

  const targetVersionId = intent === 'withdraw'
    ? textValue(latestDecisionResult.data?.definition_version_id)
    : textValue(definitionResult.data.current_version_id)
  if (!targetVersionId) {
    throw createError({
      statusCode: 409,
      statusMessage: intent === 'withdraw'
        ? 'The granted consent version could not be resolved'
        : 'Consent definition has no current version',
    })
  }

  let versionQuery = session.dataApi
    .from('crm_consent_definition_versions')
    .select('id, display_title, content_sha256')
    .eq('organization_id', session.organizationId)
    .eq('definition_id', definitionId)
    .eq('id', targetVersionId)
  if (intent === 'collect') {
    versionQuery = versionQuery
      .eq('status', 'published')
      .lte('effective_from', nowIso)
      .or(`effective_to.is.null,effective_to.gt.${nowIso}`)
  }
  const versionResult = await versionQuery.maybeSingle()
  throwDbError(versionResult.error)
  if (!versionResult.data) {
    throw createError({
      statusCode: 409,
      statusMessage: intent === 'withdraw'
        ? 'The version of the granted consent is no longer available'
        : 'Consent definition has no currently published version',
    })
  }

  const personPhone = textValue(personResult.data.phone)
  const phone = normalizeConsentPhone(
    personPhone
    ?? (String(personResult.data.role) === 'primary'
      ? textValue(clientResult.data.primary_phone)
      : undefined),
  )
  if (!phone) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Client person needs a valid mobile phone number',
    })
  }

  const backendData = serverDataBackend(event) as any
  const activeRequestResult = await backendData
    .from('crm_consent_capture_requests')
    .select('id, intent, status, phone_e164, created_at, expires_at')
    .eq('organization_id', session.organizationId)
    .eq('client_id', clientId)
    .eq('subject_person_id', subjectPersonId)
    .eq('definition_id', definitionId)
    .in('status', [...consentCaptureActiveStatuses])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  throwDbError(activeRequestResult.error)

  const activeRequest = activeRequestResult.data as null | {
    id: string
    intent: ConsentCaptureIntent
    status: string
    phone_e164: string
    created_at: string
    expires_at: string
  }
  const resendCooldownMs = 60_000
  if (
    !config.demoAutoFill
    && activeRequest
    && activeRequest.intent === intent
    && new Date(activeRequest.expires_at).getTime() > now.getTime()
    && now.getTime() - new Date(activeRequest.created_at).getTime() < resendCooldownMs
  ) {
    return {
      data: {
        id: activeRequest.id,
        status: activeRequest.status,
        intent: activeRequest.intent,
        expiresAt: activeRequest.expires_at,
        maskedPhone: maskConsentPhone(activeRequest.phone_e164),
        reused: true,
      },
    }
  }

  const requestId = randomUUID()
  const publicToken = generateConsentCaptureToken()
  const otp = generateConsentCaptureOtp()
  const tokenHash = hashConsentCaptureToken(config.otpSecret, publicToken)
  const otpHash = hashConsentCaptureOtp(config.otpSecret, requestId, otp)
  const expiresAt = new Date(now.getTime() + config.ttlSeconds * 1_000).toISOString()
  const publicUrl = consentCapturePublicUrl(config.publicBaseUrl, publicToken)
  const smsBody = buildConsentSmsBody({
    intent,
    otp,
    publicUrl,
    ttlSeconds: config.ttlSeconds,
  })

  let cancelledRows: Array<{ id: unknown }> = []
  if (activeRequest) {
    // Cancel only the row observed by this request. A broad status update can
    // otherwise cancel a newer request created by a concurrent handler and
    // cause both SMS messages to be delivered with one dead link.
    const cancelledResult = await backendData
      .from('crm_consent_capture_requests')
      .update({
        status: 'cancelled',
        cancelled_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', activeRequest.id)
      .eq('organization_id', session.organizationId)
      .in('status', [...consentCaptureActiveStatuses])
      .select('id')
    throwDbError(cancelledResult.error)
    cancelledRows = (cancelledResult.data ?? []) as Array<{ id: unknown }>
  }

  async function recordCancellationEvents(replacementRequestId: string) {
    if (!cancelledRows.length) return
    const cancellationEvents = cancelledRows.map(row => ({
      organization_id: session.organizationId,
      request_id: String(row.id),
      event_type: 'cancelled_by_replacement',
      actor_user_id: session.userId,
      provider_message_id: null,
      metadata: { replacementRequestId },
      occurred_at: nowIso,
    }))
    const cancellationEventsResult = await backendData
      .from('crm_consent_capture_events')
      .insert(cancellationEvents)
    throwDbError(cancellationEventsResult.error)
  }

  const requestResult = await backendData
    .from('crm_consent_capture_requests')
    .insert({
      id: requestId,
      organization_id: session.organizationId,
      client_id: clientId,
      subject_person_id: subjectPersonId,
      definition_id: definitionId,
      definition_version_id: String(versionResult.data.id),
      requested_by_user_id: session.userId,
      phone_e164: phone,
      public_token_hash: tokenHash,
      otp_hash: otpHash,
      otp_attempts: 0,
      max_otp_attempts: config.maxOtpAttempts,
      intent,
      status: 'queued',
      expires_at: expiresAt,
      provider: config.provider,
      provider_message_id: null,
      delivery_status: 'queued',
      // Keep the lifecycle on the application clock. PostgreSQL can be a few
      // milliseconds ahead of the Node process, which otherwise makes a fast
      // local SMS delivery appear to predate the database-generated request time.
      requested_at: nowIso,
      evidence_reference: `consent-capture:${requestId}`,
      metadata: {
        version: 1,
        source: 'staff_sms_api',
        definitionContentSha256: String(versionResult.data.content_sha256 ?? ''),
        ...(config.demoAutoFill ? { demoMode: 'sms-auto-fill' } : {}),
      },
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select('id')
    .single()
  if (requestResult.error?.code === '23505') {
    // Another handler won the unique active-request race. Reuse that request
    // instead of delivering a second OTP that could immediately become stale.
    const concurrentRequestResult = await backendData
      .from('crm_consent_capture_requests')
      .select('id, intent, status, phone_e164, expires_at')
      .eq('organization_id', session.organizationId)
      .eq('client_id', clientId)
      .eq('subject_person_id', subjectPersonId)
      .eq('definition_id', definitionId)
      .in('status', [...consentCaptureActiveStatuses])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    throwDbError(concurrentRequestResult.error)
    if (concurrentRequestResult.data) {
      await recordCancellationEvents(String(concurrentRequestResult.data.id))
      return {
        data: {
          id: String(concurrentRequestResult.data.id),
          status: String(concurrentRequestResult.data.status),
          intent: String(concurrentRequestResult.data.intent),
          expiresAt: String(concurrentRequestResult.data.expires_at),
          maskedPhone: maskConsentPhone(String(concurrentRequestResult.data.phone_e164)),
          reused: true,
        },
      }
    }
  }
  throwDbError(requestResult.error)
  await recordCancellationEvents(requestId)

  const queuedEventResult = await backendData
    .from('crm_consent_capture_events')
    .insert({
      organization_id: session.organizationId,
      request_id: requestId,
      event_type: 'sms_queued',
      actor_user_id: session.userId,
      provider_message_id: null,
      metadata: {
        provider: config.provider,
        ...(config.demoAutoFill ? { simulated: true } : {}),
      },
      occurred_at: nowIso,
    })
  if (queuedEventResult.error) {
    await backendData
      .from('crm_consent_capture_requests')
      .update({ status: 'failed', delivery_status: 'audit_failed', updated_at: new Date().toISOString() })
      .eq('id', requestId)
    throwDbError(queuedEventResult.error)
  }

  const outboxResult = await backendData
    .from('crm_sms_outbox')
    .insert({
      organization_id: session.organizationId,
      request_id: requestId,
      destination: phone,
      body: '[redacted: transient consent SMS]',
      provider: config.provider,
      status: 'queued',
      attempts: 0,
      available_at: nowIso,
      queued_at: nowIso,
    })
    .select('id')
    .single()
  if (outboxResult.error) {
    await backendData
      .from('crm_consent_capture_requests')
      .update({ status: 'failed', delivery_status: 'outbox_failed', updated_at: new Date().toISOString() })
      .eq('id', requestId)
    throwDbError(outboxResult.error)
  }

  let delivery: ConsentSmsSendResult
  try {
    delivery = await sendConsentSms(config, {
      requestId,
      destination: phone,
      body: smsBody,
    })
  } catch (deliveryError) {
    const failedAt = new Date().toISOString()
    const safeError = deliveryError instanceof Error
      ? deliveryError.message.slice(0, 500)
      : 'Consent SMS delivery failed'
    await Promise.all([
      backendData
        .from('crm_sms_outbox')
        .update({
          status: 'failed',
          attempts: 1,
          body: '[redacted after delivery attempt]',
          failed_at: failedAt,
          last_error: safeError,
          updated_at: failedAt,
        })
        .eq('id', String(outboxResult.data.id)),
      backendData
        .from('crm_consent_capture_requests')
        .update({
          status: 'failed',
          delivery_status: 'failed',
          updated_at: failedAt,
        })
        .eq('id', requestId),
      backendData
        .from('crm_consent_capture_events')
        .insert({
          organization_id: session.organizationId,
          request_id: requestId,
          event_type: 'sms_failed',
          actor_user_id: session.userId,
          provider_message_id: null,
          metadata: { provider: config.provider },
          occurred_at: failedAt,
        }),
    ])
    throw createError({
      statusCode: 502,
      statusMessage: 'Consent SMS could not be delivered',
    })
  }

  const sentAt = new Date().toISOString()
  const [outboxUpdate, requestUpdate, sentEvent] = await Promise.all([
    backendData
      .from('crm_sms_outbox')
      .update({
        status: 'sent',
        attempts: 1,
        body: '[redacted after delivery attempt]',
        provider_message_id: delivery.providerMessageId,
        sent_at: sentAt,
        last_error: null,
        updated_at: sentAt,
      })
      .eq('id', String(outboxResult.data.id))
      .in('status', ['queued', 'processing']),
    backendData
      .from('crm_consent_capture_requests')
      .update({
        status: 'sent',
        provider_message_id: delivery.providerMessageId,
        delivery_status: 'sent',
        sent_at: sentAt,
        updated_at: sentAt,
      })
      .eq('id', requestId)
      .eq('status', 'queued'),
    backendData
      .from('crm_consent_capture_events')
      .insert({
        organization_id: session.organizationId,
        request_id: requestId,
        event_type: 'sms_sent',
        actor_user_id: session.userId,
        provider_message_id: delivery.providerMessageId,
        metadata: {
          provider: delivery.provider,
          ...(config.demoAutoFill ? { simulated: true } : {}),
        },
        occurred_at: sentAt,
      }),
  ])
  throwDbError(outboxUpdate.error)
  throwDbError(requestUpdate.error)
  throwDbError(sentEvent.error)

  const localDevelopment = process.env.NODE_ENV !== 'production'
    && config.provider === 'local'
  const demoUrl = config.demoAutoFill
    ? consentCaptureDemoUrl(publicUrl, otp)
    : null
  return {
    data: {
      id: requestId,
      status: 'sent',
      intent,
      expiresAt,
      maskedPhone: maskConsentPhone(phone),
      ...(localDevelopment ? { devOtp: otp, devUrl: publicUrl } : {}),
      ...(demoUrl ? { demoUrl } : {}),
    },
  }
})
