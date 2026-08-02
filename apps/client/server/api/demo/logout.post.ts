import {
  createError,
  getHeader,
  getRequestURL,
  setHeader,
} from 'h3'
import { assertDemoEnabled, endDemoSession } from '~~/server/utils/demo-auth'

export default defineEventHandler((event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  assertDemoEnabled(event)
  const origin = getHeader(event, 'origin')
  if (origin) {
    try {
      if (new URL(origin).origin !== getRequestURL(event).origin) {
        throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
      }
    }
    catch (error) {
      if ((error as { statusCode?: number }).statusCode === 403) throw error
      throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
    }
  }
  endDemoSession(event)
  return { ok: true }
})
