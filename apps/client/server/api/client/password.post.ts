import { createError, readBody, setHeader } from 'h3'
import { serverAuth } from '~~/server/utils/platform-auth'
import {
  asRecord,
  requireLinkedClientPortalSession,
} from '~~/server/utils/portal-auth'

function errorStatus(error: unknown): number {
  const candidate = error as { status?: unknown, statusCode?: unknown } | null
  const value = Number(candidate?.statusCode ?? candidate?.status)
  return Number.isInteger(value) ? value : 0
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const session = await requireLinkedClientPortalSession(event)
  const body = asRecord(await readBody(event))
  const password = typeof body.password === 'string' ? body.password : ''
  if (
    password.length < 10
    || password.length > 128
    || !/[a-z]/u.test(password)
    || !/[A-Z]/u.test(password)
    || !/[0-9]/u.test(password)
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Password must contain 10–128 characters, upper and lower case letters, and a number',
    })
  }

  const runtime = serverAuth(event)
  const existing = await runtime.pool.query(
    `select 1
       from ${runtime.config.databaseSchema}.accounts
      where user_id = $1
        and provider_id = 'credential'
        and password is not null
      limit 1`,
    [session.identity.userId],
  )
  if (existing.rowCount) {
    throw createError({ statusCode: 409, statusMessage: 'Password is already set' })
  }

  try {
    await runtime.auth.api.setPassword({
      body: { newPassword: password },
      headers: event.headers,
    })
  }
  catch (error) {
    const status = errorStatus(error)
    if (status === 401 || status === 403) {
      throw createError({
        statusCode: 401,
        statusMessage: 'Fresh authentication required',
      })
    }
    if (status === 400) {
      throw createError({ statusCode: 409, statusMessage: 'Password is already set' })
    }
    throw error
  }

  return { status: true }
})
