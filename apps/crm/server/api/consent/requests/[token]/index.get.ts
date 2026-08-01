import { useRuntimeConfig } from '#imports'
import { createError, getCookie, getRouterParam, setHeader } from 'h3'
import {
  consentVerificationCookieName,
  hashConsentCaptureToken,
  isConsentCaptureActiveStatus,
  isConsentCaptureFinalStatus,
  isConsentCaptureToken,
  maskConsentPhone,
  resolveConsentSmsConfig,
  verifyConsentVerificationProof,
  type ConsentCaptureStatus,
  type ConsentSmsConfig,
  type ConsentSmsRuntimeInput,
} from '~~/server/utils/consent-capture'
import { serverDataBackend } from '~~/server/utils/data-api'

interface CaptureRequestRow {
  id: string
  organization_id: string
  definition_id: string
  definition_version_id: string
  phone_e164: string
  public_token_hash: string
  otp_attempts: number
  max_otp_attempts: number
  intent: 'collect' | 'withdraw'
  status: ConsentCaptureStatus
  expires_at: string
  opened_at: string | null
  verified_at: string | null
  decided_at: string | null
  decision: 'granted' | 'declined' | 'withdrawn' | null
}

function setPublicHeaders(event: Parameters<typeof setHeader>[0]): void {
  setHeader(event, 'Cache-Control', 'no-store, max-age=0')
  setHeader(event, 'Pragma', 'no-cache')
  setHeader(event, 'Referrer-Policy', 'no-referrer')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  setHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
}

function consentSmsConfig(event: Parameters<typeof useRuntimeConfig>[0]): ConsentSmsConfig {
  try {
    return resolveConsentSmsConfig(
      useRuntimeConfig(event).consentSms as ConsentSmsRuntimeInput,
      { production: process.env.NODE_ENV === 'production' },
    )
  } catch {
    throw createError({
      statusCode: 503,
      statusMessage: 'Consent verification is temporarily unavailable',
    })
  }
}

function invalidRequest(): never {
  throw createError({ statusCode: 404, statusMessage: 'Consent request not found' })
}

function throwPublicDbError(error: { code?: string } | null | undefined): void {
  if (!error) return
  console.error('[consent-capture] public request database operation failed', error.code ?? '')
  throw createError({
    statusCode: 500,
    statusMessage: 'Consent request is temporarily unavailable',
  })
}

export default defineEventHandler(async (event) => {
  setPublicHeaders(event)
  const token = getRouterParam(event, 'token')
  if (!isConsentCaptureToken(token)) invalidRequest()

  const config = consentSmsConfig(event)
  const tokenHash = hashConsentCaptureToken(config.otpSecret, token)
  const backendData = serverDataBackend(event) as any
  const requestResult = await backendData
    .from('crm_consent_capture_requests')
    .select(
      'id, organization_id, definition_id, definition_version_id, phone_e164, public_token_hash, otp_attempts, max_otp_attempts, intent, status, expires_at, opened_at, verified_at, decided_at, decision',
    )
    .eq('public_token_hash', tokenHash)
    .maybeSingle()
  throwPublicDbError(requestResult.error)
  if (!requestResult.data) invalidRequest()

  const request = requestResult.data as CaptureRequestRow
  const nowIso = new Date().toISOString()
  if (
    isConsentCaptureActiveStatus(request.status)
    && new Date(request.expires_at).getTime() <= Date.now()
  ) {
    const expiredResult = await backendData
      .from('crm_consent_capture_requests')
      .update({ status: 'expired', updated_at: nowIso })
      .eq('id', request.id)
      .eq('organization_id', request.organization_id)
      .in('status', [
        'pending',
        'queued',
        'sent',
        'delivered',
        'opened',
        'verified',
      ])
      .lte('expires_at', nowIso)
      .select('id')
      .maybeSingle()
    throwPublicDbError(expiredResult.error)
    if (expiredResult.data) {
      request.status = 'expired'
      const eventResult = await backendData
        .from('crm_consent_capture_events')
        .insert({
          organization_id: request.organization_id,
          request_id: request.id,
          event_type: 'expired',
          actor_user_id: null,
          provider_message_id: null,
          metadata: {},
          occurred_at: nowIso,
        })
      throwPublicDbError(eventResult.error)
    }
  }

  if (
    !request.opened_at
    && (request.status === 'sent' || request.status === 'delivered')
  ) {
    const openedResult = await backendData
      .from('crm_consent_capture_requests')
      .update({
        status: 'opened',
        opened_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', request.id)
      .eq('organization_id', request.organization_id)
      .is('opened_at', null)
      .in('status', ['sent', 'delivered'])
      .select('id')
      .maybeSingle()
    throwPublicDbError(openedResult.error)
    if (openedResult.data) {
      request.status = 'opened'
      request.opened_at = nowIso
      const eventResult = await backendData
        .from('crm_consent_capture_events')
        .insert({
          organization_id: request.organization_id,
          request_id: request.id,
          event_type: 'opened',
          actor_user_id: null,
          provider_message_id: null,
          metadata: {},
          occurred_at: nowIso,
        })
      throwPublicDbError(eventResult.error)
    }
  }

  const [versionResult, organizationResult] = await Promise.all([
    backendData
      .from('crm_consent_definition_versions')
      .select(
        'version, display_title, content, purpose, channel, legal_basis, language_code, content_sha256',
      )
      .eq('organization_id', request.organization_id)
      .eq('definition_id', request.definition_id)
      .eq('id', request.definition_version_id)
      .maybeSingle(),
    backendData
      .from('organizations')
      .select('name')
      .eq('id', request.organization_id)
      .maybeSingle(),
  ])
  throwPublicDbError(versionResult.error)
  throwPublicDbError(organizationResult.error)
  if (!versionResult.data || !organizationResult.data) invalidRequest()

  const proof = getCookie(
    event,
    consentVerificationCookieName(request.public_token_hash),
  )
  const hasVerificationProof = request.status === 'verified'
    && verifyConsentVerificationProof(
      config.otpSecret,
      request.id,
      request.public_token_hash,
      proof,
    )
  const attemptsRemaining = Math.max(
    0,
    Number(request.max_otp_attempts) - Number(request.otp_attempts),
  )
  let stage: 'otp' | 'decision' | 'complete' | 'unavailable'
  if (
    request.status === 'accepted'
    || request.status === 'declined'
    || request.status === 'withdrawn'
  ) {
    stage = 'complete'
  } else if (isConsentCaptureFinalStatus(request.status)) {
    stage = 'unavailable'
  } else if (hasVerificationProof) {
    stage = 'decision'
  } else if (attemptsRemaining === 0) {
    stage = 'unavailable'
  } else {
    stage = 'otp'
  }

  return {
    stage,
    status: request.status,
    intent: request.intent,
    expiresAt: request.expires_at,
    maskedPhone: maskConsentPhone(request.phone_e164),
    attemptsRemaining,
    decision: request.decision,
    decidedAt: request.decided_at,
    organizationName: String(organizationResult.data.name ?? 'OpenExpert'),
    consent: {
      version: Number(versionResult.data.version),
      title: String(versionResult.data.display_title),
      content: String(versionResult.data.content),
      purpose: String(versionResult.data.purpose),
      channel: String(versionResult.data.channel),
      legalBasis: String(versionResult.data.legal_basis),
      languageCode: String(versionResult.data.language_code),
      contentSha256: String(versionResult.data.content_sha256),
    },
  }
})
