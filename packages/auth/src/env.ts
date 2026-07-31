import type { OpenExpertAuthConfig } from './types.ts'

export type OpenExpertAuthEnvironment = Record<string, string | undefined>

export class OpenExpertAuthConfigurationError extends Error {
  readonly issues: readonly string[]

  constructor(issues: readonly string[]) {
    super(`Invalid OpenExpert auth configuration: ${issues.join('; ')}`)
    this.name = 'OpenExpertAuthConfigurationError'
    this.issues = issues
  }
}

function booleanValue(
  env: OpenExpertAuthEnvironment,
  name: string,
  fallback: boolean,
  issues: string[],
) {
  const value = env[name]?.trim().toLowerCase()
  if (!value) return fallback
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  issues.push(`${name} must be true or false`)
  return fallback
}

function integerValue(
  env: OpenExpertAuthEnvironment,
  name: string,
  fallback: number,
  issues: string[],
) {
  const value = env[name]?.trim()
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    issues.push(`${name} must be a positive integer`)
    return fallback
  }
  return parsed
}

export function readOpenExpertAuthEnv(
  env: OpenExpertAuthEnvironment,
): OpenExpertAuthConfig {
  const issues: string[] = []
  const baseURL = env.BETTER_AUTH_URL?.trim() ?? ''
  const secret = env.BETTER_AUTH_SECRET?.trim() ?? ''
  const databaseURL = env.DATABASE_URL?.trim() ?? ''

  if (!baseURL) issues.push('BETTER_AUTH_URL is required')
  if (!secret) issues.push('BETTER_AUTH_SECRET is required')
  if (!databaseURL) issues.push('DATABASE_URL is required')

  try {
    const url = new URL(baseURL)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      issues.push('BETTER_AUTH_URL must use http or https')
    }
  } catch {
    if (baseURL) issues.push('BETTER_AUTH_URL must be an absolute URL')
  }

  try {
    const url = new URL(databaseURL)
    if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
      issues.push('DATABASE_URL must be a PostgreSQL URL')
    }
  } catch {
    if (databaseURL) issues.push('DATABASE_URL must be an absolute PostgreSQL URL')
  }

  if (secret && secret.length < 32) {
    issues.push('BETTER_AUTH_SECRET must contain at least 32 characters')
  }

  const disableSignUp = booleanValue(
    env,
    'BETTER_AUTH_DISABLE_SIGN_UP',
    false,
    issues,
  )
  const requireEmailVerification = booleanValue(
    env,
    'BETTER_AUTH_REQUIRE_EMAIL_VERIFICATION',
    true,
    issues,
  )
  const magicLinkDisableSignUp = booleanValue(
    env,
    'BETTER_AUTH_MAGIC_LINK_DISABLE_SIGN_UP',
    false,
    issues,
  )
  const minPasswordLength = integerValue(
    env,
    'BETTER_AUTH_MIN_PASSWORD_LENGTH',
    10,
    issues,
  )
  const bcryptCost = integerValue(
    env,
    'BETTER_AUTH_BCRYPT_COST',
    10,
    issues,
  )
  const sessionExpiresIn = integerValue(
    env,
    'BETTER_AUTH_SESSION_EXPIRES_IN',
    60 * 60 * 24 * 7,
    issues,
  )
  const jwtExpiresIn = integerValue(
    env,
    'BETTER_AUTH_JWT_EXPIRES_IN',
    60 * 60,
    issues,
  )

  if (issues.length) throw new OpenExpertAuthConfigurationError(issues)

  return {
    appName: env.BETTER_AUTH_APP_NAME?.trim() || 'OpenExpert',
    baseURL,
    basePath: env.BETTER_AUTH_BASE_PATH?.trim() || '/api/auth',
    secret,
    databaseURL,
    databaseSchema: env.BETTER_AUTH_DATABASE_SCHEMA?.trim() || 'identity',
    trustedOrigins: (env.BETTER_AUTH_TRUSTED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    cookiePrefix: env.BETTER_AUTH_COOKIE_PREFIX?.trim() || 'openexpert',
    cookieDomain: env.BETTER_AUTH_COOKIE_DOMAIN?.trim() || undefined,
    disableSignUp,
    requireEmailVerification,
    magicLinkDisableSignUp,
    minPasswordLength,
    bcryptCost,
    sessionExpiresIn,
    jwtExpiresIn,
  }
}
