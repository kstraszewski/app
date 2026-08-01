import { useRuntimeConfig } from '#imports'
import {
  createError,
  getCookie,
  getRouterParam,
  readBody,
  setCookie,
  setHeader,
} from 'h3'
import {
  consentCaptureActiveStatuses,
  consentVerificationCookieName,
  createConsentVerificationProof,
  hashConsentCaptureToken,
  isConsentCaptureActiveStatus,
  isConsentCaptureOtp,
  isConsentCaptureToken,
  resolveConsentSmsConfig,
  verifyConsentCaptureOtp,
  verifyConsentVerificationProof,
  type ConsentCaptureStatus,
  type ConsentSmsConfig,
  type ConsentSmsRuntimeInput,
} from '~~/server/utils/consent-capture'
import { serverDataBackend } from '~~/server/utils/data-api'
import { asRecord } from '~~/server/utils/crm'

interface VerificationRequestRow {
  id: string
  organization_id: string
  public_token_hash: string
  otp_hash: string
  otp_attempts: number
  max_otp_attempts: number
  status: ConsentCaptureStatus
  expires_at: string
  verified_at: string | null
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
  console.error('[consent-capture] OTP database operation failed', error.code ?? '')
  throw createError({
    statusCode: 500,
    statusMessage: 'Consent verification is temporarily unavailable',
  })
}

export default defineEventHandler(async (event) => {
  setPublicHeaders(event)
  const token = getRouterParam(event, 'token')
  if (!isConsentCaptureToken(token)) invalidRequest()

  const body = asRecord(await readBody(event))
  if (!isConsentCaptureOtp(body.code)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'code must contain exactly 6 digits',
    })
  }

  const config = consentSmsConfig(event)
  const tokenHash = hashConsentCaptureToken(config.otpSecret, token)
  const backendData = serverDataBackend(event) as any
  const requestResult = await backendData
    .from('crm_consent_capture_requests')
    .select(
      'id, organization_id, public_token_hash, otp_hash, otp_attempts, max_otp_attempts, status, expires_at, verified_at',
    )
    .eq('public_token_hash', tokenHash)
    .maybeSingle()
  throwPublicDbError(requestResult.error)
  if (!requestResult.data) invalidRequest()

  const request = requestResult.data as VerificationRequestRow
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

  if (!isConsentCaptureActiveStatus(request.status)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Consent request can no longer be verified',
    })
  }

  const verificationCookie = consentVerificationCookieName(request.public_token_hash)
  const currentProof = getCookie(event, verificationCookie)
  const attempts = Number(request.otp_attempts)
  const maxAttempts = Number(request.max_otp_attempts)
  const attachVerificationCookie = () => {
    const maxAge = Math.max(
      1,
      Math.floor((new Date(request.expires_at).getTime() - now.getTime()) / 1_000),
    )
    setCookie(
      event,
      verificationCookie,
      createConsentVerificationProof(
        config.otpSecret,
        request.id,
        request.public_token_hash,
      ),
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: `/api/consent/requests/${encodeURIComponent(token)}`,
        maxAge,
      },
    )
  }

  if (
    request.status === 'verified'
    && verifyConsentVerificationProof(
      config.otpSecret,
      request.id,
      request.public_token_hash,
      currentProof,
    )
  ) {
    return {
      ok: true,
      status: 'verified',
      expiresAt: request.expires_at,
      attemptsRemaining: Math.max(
        0,
        maxAttempts - attempts,
      ),
    }
  }

  if (request.status === 'verified') {
    if (!verifyConsentCaptureOtp(
      config.otpSecret,
      request.id,
      body.code,
      request.otp_hash,
    )) {
      const nextAttempts = Math.min(maxAttempts, attempts + 1)
      const locked = nextAttempts >= maxAttempts
      const recoveryUpdateResult = await backendData
        .from('crm_consent_capture_requests')
        .update({
          otp_attempts: nextAttempts,
          ...(locked
            ? { status: 'failed', delivery_status: 'otp_locked' }
            : {}),
          updated_at: nowIso,
        })
        .eq('id', request.id)
        .eq('organization_id', request.organization_id)
        .eq('otp_attempts', attempts)
        .eq('status', 'verified')
        .select('id')
        .maybeSingle()
      throwPublicDbError(recoveryUpdateResult.error)
      if (!recoveryUpdateResult.data) {
        throw createError({
          statusCode: 409,
          statusMessage: 'Consent verification state changed; try again',
        })
      }

      const recoveryEventResult = await backendData
        .from('crm_consent_capture_events')
        .insert({
          organization_id: request.organization_id,
          request_id: request.id,
          event_type: locked ? 'otp_locked' : 'otp_rejected',
          actor_user_id: null,
          provider_message_id: null,
          metadata: {
            attemptNumber: nextAttempts,
            attemptsRemaining: Math.max(0, maxAttempts - nextAttempts),
            recovery: true,
          },
          occurred_at: nowIso,
        })
      throwPublicDbError(recoveryEventResult.error)
      throw createError({
        statusCode: locked ? 429 : 422,
        statusMessage: locked ? 'OTP attempt limit reached' : 'Verification code is incorrect',
      })
    }

    // Recover safely if the previous response was interrupted after the
    // database reached `verified` but before the proof cookie was delivered.
    const existingEventResult = await backendData
      .from('crm_consent_capture_events')
      .select('id')
      .eq('organization_id', request.organization_id)
      .eq('request_id', request.id)
      .eq('event_type', 'otp_verified')
      .limit(1)
      .maybeSingle()
    throwPublicDbError(existingEventResult.error)
    if (!existingEventResult.data) {
      const recoveredEventResult = await backendData
        .from('crm_consent_capture_events')
        .insert({
          organization_id: request.organization_id,
          request_id: request.id,
          event_type: 'otp_verified',
          actor_user_id: null,
          provider_message_id: null,
          metadata: { attemptNumber: attempts, recovered: true },
          occurred_at: request.verified_at ?? nowIso,
        })
      throwPublicDbError(recoveredEventResult.error)
    }
    attachVerificationCookie()
    return {
      ok: true,
      status: 'verified',
      expiresAt: request.expires_at,
      attemptsRemaining: Math.max(0, maxAttempts - attempts),
    }
  }

  if (!Number.isInteger(attempts) || !Number.isInteger(maxAttempts) || attempts >= maxAttempts) {
    throw createError({ statusCode: 429, statusMessage: 'OTP attempt limit reached' })
  }

  const nextAttempts = attempts + 1
  const validOtp = verifyConsentCaptureOtp(
    config.otpSecret,
    request.id,
    body.code,
    request.otp_hash,
  )
  if (!validOtp) {
    const locked = nextAttempts >= maxAttempts
    const updateResult = await backendData
      .from('crm_consent_capture_requests')
      .update({
        otp_attempts: nextAttempts,
        ...(locked
          ? { status: 'failed', delivery_status: 'otp_locked' }
          : {}),
        updated_at: nowIso,
      })
      .eq('id', request.id)
      .eq('organization_id', request.organization_id)
      .eq('otp_attempts', attempts)
      .in('status', [...consentCaptureActiveStatuses])
      .select('id')
      .maybeSingle()
    throwPublicDbError(updateResult.error)
    if (!updateResult.data) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Consent verification state changed; try again',
      })
    }

    const eventResult = await backendData
      .from('crm_consent_capture_events')
      .insert({
        organization_id: request.organization_id,
        request_id: request.id,
        event_type: locked ? 'otp_locked' : 'otp_rejected',
        actor_user_id: null,
        provider_message_id: null,
        metadata: {
          attemptNumber: nextAttempts,
          attemptsRemaining: Math.max(0, maxAttempts - nextAttempts),
        },
        occurred_at: nowIso,
      })
    throwPublicDbError(eventResult.error)
    throw createError({
      statusCode: locked ? 429 : 422,
      statusMessage: locked ? 'OTP attempt limit reached' : 'Verification code is incorrect',
    })
  }

  const verifiedAt = request.verified_at ?? nowIso
  const verifiedResult = await backendData
    .from('crm_consent_capture_requests')
    .update({
      status: 'verified',
      otp_attempts: nextAttempts,
      verified_at: verifiedAt,
      updated_at: nowIso,
    })
    .eq('id', request.id)
    .eq('organization_id', request.organization_id)
    .eq('otp_attempts', attempts)
    .in('status', [...consentCaptureActiveStatuses])
    .select('id')
    .maybeSingle()
  throwPublicDbError(verifiedResult.error)
  if (!verifiedResult.data) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Consent verification state changed; try again',
    })
  }

  const eventResult = await backendData
    .from('crm_consent_capture_events')
    .insert({
      organization_id: request.organization_id,
      request_id: request.id,
      event_type: 'otp_verified',
      actor_user_id: null,
      provider_message_id: null,
      metadata: { attemptNumber: nextAttempts },
      occurred_at: nowIso,
    })
  throwPublicDbError(eventResult.error)

  attachVerificationCookie()

  return {
    ok: true,
    status: 'verified',
    expiresAt: request.expires_at,
    attemptsRemaining: Math.max(0, maxAttempts - nextAttempts),
  }
})
