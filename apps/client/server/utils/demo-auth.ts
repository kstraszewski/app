import {
  deleteCookie,
  getCookie,
  setCookie,
  type H3Event,
} from 'h3'
import {
  createDemoSessionToken,
  DEMO_SESSION_TTL_SECONDS,
  demoAccessCodeMatchesHash,
  isDemoAccessCodeHash,
  verifyDemoSessionToken,
} from '../../shared/utils/demo-session.ts'

const DEMO_COOKIE = 'openexpert-demo-session'

interface DemoConfig {
  enabled?: boolean | string
  passwordHash?: string
  sessionSecret?: string
}

function configuredDemo(event: H3Event): Required<DemoConfig> | null {
  const config = useRuntimeConfig(event).demo as DemoConfig
  const enabled = config?.enabled === true || config?.enabled === 'true'
  if (!enabled) return null

  const passwordHash = String(config.passwordHash || '')
  const sessionSecret = String(config.sessionSecret || '')
  if (!isDemoAccessCodeHash(passwordHash) || sessionSecret.length < 32) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Wersja demonstracyjna jest chwilowo niedostępna',
    })
  }

  return { enabled: true, passwordHash, sessionSecret }
}

export function assertDemoEnabled(event: H3Event): Required<DemoConfig> {
  const config = configuredDemo(event)
  if (!config) {
    throw createError({ statusCode: 404, statusMessage: 'Page not found' })
  }
  return config
}

export function demoPasswordMatches(event: H3Event, provided: string): boolean {
  return demoAccessCodeMatchesHash(provided, assertDemoEnabled(event).passwordHash)
}

export function hasDemoSession(event: H3Event): boolean {
  const config = assertDemoEnabled(event)
  return verifyDemoSessionToken(
    config.sessionSecret,
    getCookie(event, DEMO_COOKIE),
  )
}

export function startDemoSession(event: H3Event): void {
  const config = assertDemoEnabled(event)
  const expiresAt = Math.floor(Date.now() / 1_000) + DEMO_SESSION_TTL_SECONDS
  setCookie(
    event,
    DEMO_COOKIE,
    createDemoSessionToken(config.sessionSecret, expiresAt),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: DEMO_SESSION_TTL_SECONDS,
    },
  )
}

export function endDemoSession(event: H3Event): void {
  deleteCookie(event, DEMO_COOKIE, {
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  })
}
