import { setHeader } from 'h3'
import {
  requireFreshPhoneSession,
  throwAuthPhoneError,
} from '~~/server/utils/auth-phone'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const runtime = await requireFreshPhoneSession(event)
  try {
    const updateUser = runtime.auth.api.updateUser as unknown as (input: {
      body: { phoneNumber: null }
      headers: Headers
    }) => Promise<unknown>
    await updateUser({
      body: { phoneNumber: null },
      headers: event.headers,
    })
    return { status: true }
  }
  catch (error) {
    throwAuthPhoneError(error)
  }
})
