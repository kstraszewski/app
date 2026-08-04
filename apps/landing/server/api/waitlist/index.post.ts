import {
  createEmailService,
  EmailDeliveryError,
  normalizeTransactionalEmailAddress,
  type EmailDeliveryResult,
} from '@openexpert/email'
import {
  consumeOpenExpertAuthRateLimit,
  getOpenExpertTrustedClientIp,
  isOpenExpertSameOriginJsonRequest,
} from '@openexpert/auth/server'
import { serverDataBackend } from '../../utils/data-api'
import { serverAuth } from '../../utils/platform-auth'
import { createError, readBody, setHeader } from 'h3'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const siteUrl = String(config.public.openexpert.siteUrl || '')
  if (!isOpenExpertSameOriginJsonRequest(event.headers, siteUrl)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  const body = await readBody<{ email?: unknown }>(event)
  let email: string
  try {
    email = normalizeTransactionalEmailAddress(
      typeof body?.email === 'string' ? body.email : '',
    ).toLowerCase()
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'Podaj poprawny adres email.' })
  }

  const authRuntime = serverAuth(event)
  const rateLimit = await consumeOpenExpertAuthRateLimit({
    pool: authRuntime.pool,
    databaseSchema: authRuntime.config.databaseSchema,
    keySecret: authRuntime.config.secret,
    scope: 'landing:waitlist',
    ipAddress: getOpenExpertTrustedClientIp({
      headers: event.headers,
      directAddress: event.node.req.socket.remoteAddress,
      trustedHeaderNames: authRuntime.config.ipAddressHeaders,
    }),
    identifier: email,
    windowMs: 60 * 60 * 1_000,
    ipMax: 20,
    identifierMax: 3,
    pairMax: 3,
  })
  if (!rateLimit.allowed) {
    setHeader(event, 'Retry-After', rateLimit.retryAfterSeconds)
    throw createError({
      statusCode: 429,
      statusMessage: 'Zbyt wiele prób zapisu. Spróbuj ponownie później.',
    })
  }

  const surveyToken = crypto.randomUUID()
  const dataApi = serverDataBackend(event)
  const { data, error } = await dataApi
    .from('waitlist')
    .upsert(
      {
        email,
        survey_token: surveyToken,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'email' },
    )
    .select('id, survey_token')
    .single()

  if (error) {
    throw createError({ statusCode: 500, statusMessage: 'Nie udało się zapisać adresu.' })
  }

  const emailService = createEmailService(config.resend)
  let emailDelivery: EmailDeliveryResult | { status: 'failed' }

  try {
    emailDelivery = await emailService.sendWaitlistConfirmation({
      to: email,
      waitlistId: data.id,
      siteUrl,
    })
  } catch (emailError) {
    console.error('Waitlist confirmation email failed', {
      name: emailError instanceof Error ? emailError.name : 'UnknownError',
      provider: emailError instanceof EmailDeliveryError
        ? emailError.provider
        : undefined,
      statusCode: emailError instanceof EmailDeliveryError
        ? emailError.statusCode
        : undefined,
    })
    emailDelivery = { status: 'failed' }
  }

  return {
    registered: true,
    surveyToken: data.survey_token,
    emailDelivery,
  }
})
