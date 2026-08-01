import { useRuntimeConfig } from '#imports'
import {
  createError,
  deleteCookie,
  getCookie,
  getRouterParam,
  readBody,
  setHeader,
} from 'h3'
import {
  consentCaptureActiveStatuses,
  consentVerificationCookieName,
  consentDecisionAllowed,
  hashConsentCaptureToken,
  isConsentCaptureActiveStatus,
  isConsentCaptureToken,
  resolveConsentSmsConfig,
  verifyConsentVerificationProof,
  type ConsentCaptureDecision,
  type ConsentCaptureIntent,
  type ConsentCaptureStatus,
  type ConsentSmsConfig,
  type ConsentSmsRuntimeInput,
} from '~~/server/utils/consent-capture'
import { serverDataBackend } from '~~/server/utils/data-api'
import { asRecord } from '~~/server/utils/crm'

interface DecisionRequestRow {
  id: string
  organization_id: string
  public_token_hash: string
  intent: ConsentCaptureIntent
  status: ConsentCaptureStatus
  expires_at: string
  verified_at: string | null
  decided_at: string | null
  decision: ConsentCaptureDecision | null
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
  console.error('[consent-capture] decision database operation failed', error.code ?? '')
  throw createError({
    statusCode: 500,
    statusMessage: 'Consent decision could not be saved',
  })
}

function finalDecisionForStatus(status: ConsentCaptureStatus): ConsentCaptureDecision | null {
  if (status === 'accepted') return 'granted'
  if (status === 'declined') return 'declined'
  if (status === 'withdrawn') return 'withdrawn'
  return null
}

export default defineEventHandler(async (event) => {
  setPublicHeaders(event)
  const token = getRouterParam(event, 'token')
  if (!isConsentCaptureToken(token)) invalidRequest()

  const body = asRecord(await readBody(event))
  const config = consentSmsConfig(event)
  const tokenHash = hashConsentCaptureToken(config.otpSecret, token)
  const backendData = serverDataBackend(event) as any
  const requestResult = await backendData
    .from('crm_consent_capture_requests')
    .select(
      'id, organization_id, public_token_hash, intent, status, expires_at, verified_at, decided_at, decision',
    )
    .eq('public_token_hash', tokenHash)
    .maybeSingle()
  throwPublicDbError(requestResult.error)
  if (!requestResult.data) invalidRequest()

  const request = requestResult.data as DecisionRequestRow
  if (!consentDecisionAllowed(request.intent, body.decision)) {
    throw createError({
      statusCode: 400,
      statusMessage: request.intent === 'withdraw'
        ? 'decision must be withdrawn'
        : 'decision must be granted or declined',
    })
  }
  const decision = body.decision
  const completedDecision = request.decision ?? finalDecisionForStatus(request.status)
  if (completedDecision) {
    if (completedDecision !== decision) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Consent request already has a different final decision',
      })
    }
    return {
      ok: true,
      status: request.status,
      decision: completedDecision,
      decidedAt: request.decided_at,
    }
  }

  const now = new Date()
  const nowIso = now.toISOString()
  if (new Date(request.expires_at).getTime() <= now.getTime()) {
    if (isConsentCaptureActiveStatus(request.status)) {
      const expiredResult = await backendData
        .from('crm_consent_capture_requests')
        .update({ status: 'expired', updated_at: nowIso })
        .eq('id', request.id)
        .eq('organization_id', request.organization_id)
        .in('status', [...consentCaptureActiveStatuses])
        .lte('expires_at', nowIso)
        .select('id')
        .maybeSingle()
      throwPublicDbError(expiredResult.error)
      if (expiredResult.data) {
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
    throw createError({ statusCode: 410, statusMessage: 'Consent request has expired' })
  }

  if (request.status !== 'verified' || !request.verified_at) {
    throw createError({ statusCode: 409, statusMessage: 'OTP verification is required' })
  }
  const verificationCookie = consentVerificationCookieName(request.public_token_hash)
  const proof = getCookie(event, verificationCookie)
  if (!verifyConsentVerificationProof(
    config.otpSecret,
    request.id,
    request.public_token_hash,
    proof,
  )) {
    throw createError({ statusCode: 401, statusMessage: 'OTP verification is required' })
  }

  const completionResult = await backendData.rpc(
    'complete_crm_consent_capture_request',
    {
      p_request_id: request.id,
      p_decision: decision,
    },
  )
  if (completionResult.error) {
    const conflict = completionResult.error.code === '23514'
      || completionResult.error.code === 'P0001'
      || completionResult.error.message?.includes('consent_capture_')
    throw createError({
      statusCode: conflict ? 409 : 500,
      statusMessage: conflict
        ? 'Consent request could not be completed in its current state'
        : 'Consent decision could not be saved',
    })
  }

  const completedResult = await backendData
    .from('crm_consent_capture_requests')
    .select('status, decision, decided_at')
    .eq('id', request.id)
    .eq('organization_id', request.organization_id)
    .single()
  throwPublicDbError(completedResult.error)
  if (!completedResult.data) {
    throw createError({ statusCode: 500, statusMessage: 'Consent decision could not be saved' })
  }

  deleteCookie(event, verificationCookie, {
    path: `/api/consent/requests/${encodeURIComponent(token)}`,
  })
  return {
    ok: true,
    status: String(completedResult.data.status),
    decision: String(completedResult.data.decision),
    decidedAt: completedResult.data.decided_at
      ? String(completedResult.data.decided_at)
      : nowIso,
  }
})
