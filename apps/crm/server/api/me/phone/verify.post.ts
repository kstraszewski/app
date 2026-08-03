import { normalizeOpenExpertPhone } from '@openexpert/auth'
import { createError, readBody, setHeader } from 'h3'
import {
  requireFreshPhoneSession,
  throwAuthPhoneError,
} from '~~/server/utils/auth-phone'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const body = await readBody<{ phoneNumber?: unknown, code?: unknown }>(event)
  const phoneNumber = normalizeOpenExpertPhone(body?.phoneNumber)
  const code = typeof body?.code === 'string' ? body.code.trim() : ''
  if (!phoneNumber || !/^\d{6}$/.test(code)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid phone verification input' })
  }

  const runtime = await requireFreshPhoneSession(event)
  try {
    const result = await runtime.auth.api.verifyPhoneNumber({
      body: { phoneNumber, code, updatePhoneNumber: true },
      headers: event.headers,
    })
    return {
      status: result.status,
      phoneNumber,
      phoneNumberVerified: result.user.phoneNumberVerified === true,
    }
  }
  catch (error) {
    throwAuthPhoneError(error)
  }
})
