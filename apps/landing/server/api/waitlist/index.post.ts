import { createEmailService, type EmailDeliveryResult } from '@openexpert/email'
import { serverDataBackend } from '../../utils/data-api'
import { createError, getRequestURL, readBody } from 'h3'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default defineEventHandler(async (event) => {
  const body = await readBody<{ email?: unknown }>(event)
  const email = typeof body?.email === 'string'
    ? body.email.trim().toLowerCase()
    : ''

  if (!emailPattern.test(email) || email.length > 320) {
    throw createError({ statusCode: 400, statusMessage: 'Podaj poprawny adres email.' })
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

  const config = useRuntimeConfig(event)
  const emailService = createEmailService(config.resend)
  let emailDelivery: EmailDeliveryResult | { status: 'failed' }

  try {
    emailDelivery = await emailService.sendWaitlistConfirmation({
      to: email,
      waitlistId: data.id,
      siteUrl: getRequestURL(event).origin,
    })
  } catch (emailError) {
    console.error('Waitlist confirmation email failed:', emailError)
    emailDelivery = { status: 'failed' }
  }

  return {
    registered: true,
    surveyToken: data.survey_token,
    emailDelivery,
  }
})
