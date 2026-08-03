import { normalizeOpenExpertPhone } from '@openexpert/auth'
import { createError, getQuery, setHeader } from 'h3'
import {
  latestDevelopmentPhoneOtp,
  phoneDemoEnabled,
} from '~~/server/utils/auth-phone'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  if (!phoneDemoEnabled(event)) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  const query = getQuery(event)
  const phoneNumber = normalizeOpenExpertPhone(query.phoneNumber)
  const purpose = query.purpose === 'password-reset' ? 'password-reset' : 'verification'
  if (!phoneNumber) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid phone number' })
  }
  const identifier = purpose === 'password-reset'
    ? `${phoneNumber}-request-password-reset`
    : phoneNumber
  return { code: await latestDevelopmentPhoneOtp(event, identifier) }
})
