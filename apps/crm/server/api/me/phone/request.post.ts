import { normalizeOpenExpertPhone } from '@openexpert/auth'
import { createError, readBody, setHeader } from 'h3'
import {
  latestDevelopmentPhoneOtp,
  requireFreshPhoneSession,
  throwAuthPhoneError,
} from '~~/server/utils/auth-phone'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const body = await readBody<{ phoneNumber?: unknown }>(event)
  const phoneNumber = normalizeOpenExpertPhone(body?.phoneNumber)
  if (!phoneNumber) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid phone number' })
  }

  const runtime = await requireFreshPhoneSession(event)
  try {
    await runtime.auth.api.sendPhoneNumberOTP({
      body: { phoneNumber },
      headers: event.headers,
    })
  }
  catch (error) {
    throwAuthPhoneError(error)
  }

  const devOtp = await latestDevelopmentPhoneOtp(event, phoneNumber)
  return {
    status: true,
    phoneNumber,
    ...(devOtp ? { devOtp } : {}),
  }
})
