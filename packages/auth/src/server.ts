import { createHash } from 'node:crypto'
import { passkey } from '@better-auth/passkey'
import {
  betterAuth,
  type BetterAuthOptions,
  type BetterAuthPlugin,
} from 'better-auth'
import { createAuthMiddleware, freshSessionMiddleware } from 'better-auth/api'
import { jwt, magicLink, phoneNumber, twoFactor } from 'better-auth/plugins'
import { Pool, type PoolConfig } from 'pg'

import { createDefaultBcryptPasswordStrategy } from './password.ts'
import { normalizeOpenExpertPhone } from './phone.ts'
import { createOpenExpertBetterAuthRateLimitStorage } from './rate-limit.ts'
import {
  openExpertPasskeyOptionsPlugin,
  openExpertPasswordPolicyPlugin,
  requireOpenExpertPasskeyUserVerification,
} from './security.ts'
import {
  OPENEXPERT_AUTHENTICATED_ROLE,
  type OpenExpertAuthClaims,
  type OpenExpertAuthConfig,
  type OpenExpertAuthEmailSender,
  type OpenExpertAuthPasskeyOptions,
  type OpenExpertAuthPhoneOptions,
  type OpenExpertAuthUser,
} from './types.ts'

const DEFAULT_SCHEMA = 'identity'
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SCHEMA_PATTERN = /^[a-z_][a-z0-9_]*$/
const HEADER_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
const MAGIC_LINK_NAMESPACE_PATTERN = /^[a-z0-9][a-z0-9:_-]{0,63}$/

export function hashOpenExpertMagicLinkToken(namespace: string, token: string): string {
  return createHash('sha256')
    .update(`openexpert:${namespace}\0${token}`)
    .digest('hex')
}

export {
  createOpenExpertBetterAuthRateLimitStorage,
  consumeOpenExpertAuthRateLimit,
  createOpenExpertAuthRateLimitBuckets,
  type OpenExpertAuthRateLimitBucket,
  type OpenExpertAuthRateLimitDecision,
  type OpenExpertAuthRateLimitInput,
} from './rate-limit.ts'
export { scheduleOpenExpertBackgroundTask } from './background.ts'
export {
  getOpenExpertTrustedClientIp,
  isOpenExpertSameOriginJsonRequest,
} from './request-security.ts'

const sensitiveAuthMethodPlugin = {
  id: 'openexpert-sensitive-auth-methods',
  hooks: {
    before: [{
      matcher(context) {
        const body = context.body as Record<string, unknown> | undefined
        return context.path === '/link-social'
          || context.path === '/passkey/delete-passkey'
          || context.path === '/passkey/update-passkey'
          || (
            context.path === '/update-user'
            && body != null
            && Object.hasOwn(body, 'phoneNumber')
          )
          || (
            context.path === '/phone-number/verify'
            && body?.updatePhoneNumber === true
          )
      },
      handler: createAuthMiddleware(async (context) => {
        await freshSessionMiddleware(context)
      }),
    }],
  },
} satisfies BetterAuthPlugin

export interface CreateOpenExpertAuthOptions {
  config: OpenExpertAuthConfig
  emailSender: OpenExpertAuthEmailSender
  phone?: OpenExpertAuthPhoneOptions
  passkey?: OpenExpertAuthPasskeyOptions
  pool?: Pool
  poolOptions?: Omit<PoolConfig, 'connectionString'>
  scheduleBackgroundTask?: (promise: Promise<unknown>) => void
}

function normalizeConfig(config: OpenExpertAuthConfig) {
  const databaseSchema = config.databaseSchema ?? DEFAULT_SCHEMA
  if (!SCHEMA_PATTERN.test(databaseSchema)) {
    throw new TypeError('databaseSchema must be a lowercase PostgreSQL identifier')
  }
  if (config.secret.length < 32) {
    throw new TypeError('Better Auth secret must contain at least 32 characters')
  }
  let databaseURL: URL
  try {
    databaseURL = new URL(config.databaseURL)
  }
  catch {
    throw new TypeError('Better Auth database URL must be an absolute PostgreSQL URL')
  }
  if (!['postgres:', 'postgresql:'].includes(databaseURL.protocol)) {
    throw new TypeError('Better Auth database URL must use postgres or postgresql')
  }
  const ipAddressHeaders = [...new Set((config.ipAddressHeaders ?? []).map(
    header => header.trim().toLowerCase(),
  ))]
  if (ipAddressHeaders.some(header => !HEADER_NAME_PATTERN.test(header))) {
    throw new TypeError('Better Auth IP address headers must be valid HTTP header names')
  }
  const sessionFreshAge = config.sessionFreshAge ?? 10 * 60
  if (
    !Number.isSafeInteger(sessionFreshAge)
    || sessionFreshAge < 60
    || sessionFreshAge > 60 * 60
  ) {
    throw new TypeError('Session fresh age must be between 60 and 3600 seconds')
  }
  const magicLinkTokenNamespace = config.magicLinkTokenNamespace ?? 'primary'
  if (!MAGIC_LINK_NAMESPACE_PATTERN.test(magicLinkTokenNamespace)) {
    throw new TypeError('Magic-link token namespace is invalid')
  }

  return {
    ...config,
    databaseURL: databaseURL.href,
    ipAddressHeaders,
    appName: config.appName ?? 'OpenExpert',
    basePath: config.basePath ?? '/api/auth',
    databaseSchema,
    cookiePrefix: config.cookiePrefix ?? 'openexpert',
    disableSignUp: config.disableSignUp ?? false,
    requireEmailVerification: config.requireEmailVerification ?? true,
    minPasswordLength: config.minPasswordLength ?? 10,
    maxPasswordLength: config.maxPasswordLength ?? 128,
    bcryptCost: config.bcryptCost ?? 10,
    sessionExpiresIn: config.sessionExpiresIn ?? 60 * 60 * 24 * 7,
    sessionUpdateAge: config.sessionUpdateAge ?? 60 * 60 * 24,
    sessionFreshAge,
    verificationExpiresIn: config.verificationExpiresIn ?? 60 * 60,
    resetPasswordExpiresIn: config.resetPasswordExpiresIn ?? 60 * 60,
    magicLinkExpiresIn: config.magicLinkExpiresIn ?? 60 * 60,
    magicLinkDisableSignUp: config.magicLinkDisableSignUp ?? false,
    magicLinkTokenNamespace,
    jwtExpiresIn: config.jwtExpiresIn ?? 60 * 60,
    jwksRotationInterval: config.jwksRotationInterval ?? 60 * 60 * 24 * 30,
    jwksGracePeriod: config.jwksGracePeriod ?? 60 * 60 * 24 * 30,
  }
}

function createPool(
  config: ReturnType<typeof normalizeConfig>,
  options: CreateOpenExpertAuthOptions,
) {
  if (options.pool) return { pool: options.pool, ownsPool: false }

  const existingOptions = options.poolOptions?.options?.trim()
  const searchPath = `-c search_path=${config.databaseSchema},public`
  const pool = new Pool({
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
    ...options.poolOptions,
    connectionString: config.databaseURL,
    options: existingOptions ? `${existingOptions} ${searchPath}` : searchPath,
  })
  return { pool, ownsPool: true }
}

function emailUser(user: { id: string; name: string; email: string }) {
  return { id: user.id, name: user.name, email: user.email }
}

function socialProviders(
  config: ReturnType<typeof normalizeConfig>,
): NonNullable<BetterAuthOptions['socialProviders']> {
  const providers: NonNullable<BetterAuthOptions['socialProviders']> = {}

  if (config.socialProviders?.google) {
    providers.google = {
      ...config.socialProviders.google,
      disableSignUp: config.socialProviders.google.disableSignUp ?? true,
    }
  }
  if (config.socialProviders?.apple) {
    providers.apple = {
      ...config.socialProviders.apple,
      disableSignUp: config.socialProviders.apple.disableSignUp ?? true,
    }
  }

  return providers
}

export function createOpenExpertAuth(options: CreateOpenExpertAuthOptions) {
  const config = normalizeConfig(options.config)
  const { pool, ownsPool } = createPool(config, options)
  const send = options.emailSender.send.bind(options.emailSender)
  const configuredSocialProviders = socialProviders(config)
  const phoneExpiresIn = options.phone?.expiresIn ?? 5 * 60
  const phoneAllowedAttempts = options.phone?.allowedAttempts ?? 5
  if (!Number.isInteger(phoneExpiresIn) || phoneExpiresIn < 60 || phoneExpiresIn > 60 * 60) {
    throw new TypeError('Phone OTP expiry must be between 60 and 3600 seconds')
  }
  if (!Number.isInteger(phoneAllowedAttempts) || phoneAllowedAttempts < 1 || phoneAllowedAttempts > 10) {
    throw new TypeError('Phone OTP allowed attempts must be between 1 and 10')
  }

  const phonePlugin = options.phone
    ? phoneNumber({
        otpLength: 6,
        expiresIn: phoneExpiresIn,
        allowedAttempts: phoneAllowedAttempts,
        requireVerification: true,
        phoneNumberValidator: phoneNumber => (
          normalizeOpenExpertPhone(phoneNumber) === phoneNumber
        ),
        sendOTP: ({ phoneNumber, code }, context) => options.phone!.sender.send({
          kind: 'phone-verification',
          to: phoneNumber,
          code,
          request: context?.request,
        }),
        sendPasswordResetOTP: ({ phoneNumber, code }, context) => options.phone!.sender.send({
          kind: 'phone-password-reset',
          to: phoneNumber,
          code,
          request: context?.request,
        }),
        schema: {
          user: {
            modelName: 'users',
            fields: {
              phoneNumber: 'phone_number',
              phoneNumberVerified: 'phone_number_verified',
            },
          },
        },
      })
    : null

  const passkeyPlugin = options.passkey
    ? passkey({
        rpID: options.passkey.rpID,
        rpName: options.passkey.rpName ?? config.appName,
        origin: options.passkey.origin,
        authenticatorSelection: {
          residentKey: 'required',
          userVerification: 'required',
        },
        registration: {
          afterVerification({ verification }) {
            requireOpenExpertPasskeyUserVerification(
              verification.verified
                ? verification.registrationInfo?.userVerified
                : false,
            )
          },
        },
        authentication: {
          afterVerification({ verification }) {
            requireOpenExpertPasskeyUserVerification(
              verification.verified
                ? verification.authenticationInfo.userVerified
                : false,
            )
          },
        },
        advanced: {
          webAuthnChallengeCookie: 'passkey_challenge',
        },
        schema: {
          passkey: {
            modelName: 'passkeys',
            fields: {
              publicKey: 'public_key',
              userId: 'user_id',
              credentialID: 'credential_id',
              deviceType: 'device_type',
              backedUp: 'backed_up',
              createdAt: 'created_at',
            },
          },
        },
      })
    : null

  const coreOptions = {
    appName: config.appName,
    baseURL: config.baseURL,
    basePath: config.basePath,
    secret: config.secret,
    trustedOrigins: [config.baseURL, ...(config.trustedOrigins ?? [])],
    database: pool,
    socialProviders: configuredSocialProviders,
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      storage: 'database',
      customStorage: createOpenExpertBetterAuthRateLimitStorage({
        pool,
        databaseSchema: config.databaseSchema,
      }),
      modelName: 'rate_limits',
      fields: {
        key: 'key',
        count: 'count',
        lastRequest: 'last_request',
      },
    },
    user: {
      modelName: 'users',
      fields: {
        name: 'name',
        email: 'email',
        emailVerified: 'email_verified',
        image: 'image',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    session: {
      modelName: 'sessions',
      fields: {
        userId: 'user_id',
        expiresAt: 'expires_at',
        token: 'token',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
      expiresIn: config.sessionExpiresIn,
      updateAge: config.sessionUpdateAge,
      freshAge: config.sessionFreshAge,
    },
    account: {
      modelName: 'accounts',
      updateAccountOnSignIn: true,
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        allowDifferentEmails: false,
        allowUnlinkingAll: false,
        updateUserInfoOnLink: false,
      },
      fields: {
        userId: 'user_id',
        accountId: 'account_id',
        providerId: 'provider_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        scope: 'scope',
        password: 'password',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    verification: {
      modelName: 'verifications',
      fields: {
        identifier: 'identifier',
        value: 'value',
        expiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: config.disableSignUp,
      requireEmailVerification: config.requireEmailVerification,
      minPasswordLength: config.minPasswordLength,
      maxPasswordLength: config.maxPasswordLength,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: config.resetPasswordExpiresIn,
      password: createDefaultBcryptPasswordStrategy(config.bcryptCost),
      sendResetPassword: ({ user, url, token }, request) =>
        send({
          kind: 'password-reset',
          to: user.email,
          user: emailUser(user),
          url,
          token,
          request,
        }),
    },
    emailVerification: {
      expiresIn: config.verificationExpiresIn,
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: ({ user, url, token }, request) =>
        send({
          kind: 'email-verification',
          to: user.email,
          user: emailUser(user),
          url,
          token,
          request,
        }),
    },
    advanced: {
      cookiePrefix: config.cookiePrefix,
      useSecureCookies: config.baseURL.startsWith('https://'),
      ...(config.cookieDomain
        ? {
            crossSubDomainCookies: {
              enabled: true,
              domain: config.cookieDomain,
            },
          }
        : {}),
      defaultCookieAttributes: {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: config.baseURL.startsWith('https://'),
      },
      ipAddress: {
        ipAddressHeaders: config.ipAddressHeaders,
      },
      database: { generateId: 'uuid' as const },
      ...(options.scheduleBackgroundTask
        ? { backgroundTasks: { handler: options.scheduleBackgroundTask } }
        : {}),
    },
  } satisfies BetterAuthOptions

  const auth = betterAuth({
    ...coreOptions,
    plugins: [
      openExpertPasswordPolicyPlugin,
      sensitiveAuthMethodPlugin,
      magicLink({
        expiresIn: config.magicLinkExpiresIn,
        disableSignUp: config.magicLinkDisableSignUp,
        storeToken: {
          type: 'custom-hasher',
          hash: async token => hashOpenExpertMagicLinkToken(
            config.magicLinkTokenNamespace,
            token,
          ),
        },
        sendMagicLink: ({ email, url, token, metadata }, context) =>
          send({
            kind: 'magic-link',
            to: email,
            url,
            token,
            metadata,
            request: context?.request,
          }),
      }),
      ...(phonePlugin ? [phonePlugin] : []),
      ...(passkeyPlugin ? [openExpertPasskeyOptionsPlugin] : []),
      ...(passkeyPlugin ? [passkeyPlugin] : []),
      twoFactor({
        issuer: config.appName,
        twoFactorTable: 'two_factors',
        schema: {
          user: {
            fields: {
              twoFactorEnabled: 'two_factor_enabled',
            },
          },
          twoFactor: {
            fields: {
              userId: 'user_id',
              backupCodes: 'backup_codes',
              failedVerificationCount: 'failed_verification_count',
              lockedUntil: 'locked_until',
            },
          },
        },
      }),
      jwt({
        schema: {
          jwks: {
            modelName: 'jwks',
            fields: {
              publicKey: 'public_key',
              privateKey: 'private_key',
              createdAt: 'created_at',
              expiresAt: 'expires_at',
            },
          },
        },
        jwks: {
          keyPairConfig: { alg: 'ES256' },
          rotationInterval: config.jwksRotationInterval,
          gracePeriod: config.jwksGracePeriod,
        },
        jwt: {
          issuer: config.baseURL,
          audience: config.baseURL,
          expirationTime: `${config.jwtExpiresIn}s`,
          definePayload: ({ user }) => ({
            sub: user.id,
            role: OPENEXPERT_AUTHENTICATED_ROLE,
          }),
        },
      }),
    ],
  })

  return {
    auth,
    pool,
    config,
    async dispose() {
      if (ownsPool) await pool.end()
    },
  }
}

export type OpenExpertAuthRuntime = ReturnType<typeof createOpenExpertAuth>
export type OpenExpertAuth = OpenExpertAuthRuntime['auth']
export type OpenExpertSession = Awaited<
  ReturnType<OpenExpertAuth['api']['getSession']>
>

export function getOpenExpertClaims(
  session: NonNullable<OpenExpertSession>,
): OpenExpertAuthClaims {
  return {
    sub: session.user.id,
    role: OPENEXPERT_AUTHENTICATED_ROLE,
    email: session.user.email,
    emailVerified: session.user.emailVerified,
  }
}

export async function getOpenExpertSession(
  runtime: OpenExpertAuthRuntime,
  headers: Headers,
) {
  const session = await runtime.auth.api.getSession({ headers })
  if (!session) return null
  return { ...session, claims: getOpenExpertClaims(session) }
}

export async function getOpenExpertExternalJwt(
  runtime: OpenExpertAuthRuntime,
  headers: Headers,
): Promise<string> {
  const sessionHeaders = new Headers(headers)
  sessionHeaders.delete('authorization')
  return (await runtime.auth.api.getToken({ headers: sessionHeaders })).token
}

/**
 * @deprecated This is a Better Auth external-service JWT, not the
 * OpenExpert Data API/PostgREST token signed by the separate Ed25519 signer.
 */
export const getOpenExpertDataToken = getOpenExpertExternalJwt

export async function getOpenExpertUserById(
  runtime: OpenExpertAuthRuntime,
  userId: string,
): Promise<OpenExpertAuthUser | null> {
  if (!UUID_PATTERN.test(userId)) throw new TypeError('userId must be a UUID')
  const schema = runtime.config.databaseSchema
  const result = await runtime.pool.query<OpenExpertAuthUser>(
    `select id, name, email, email_verified as "emailVerified",
            (to_jsonb(auth_user)->>'email_verified_at')::timestamptz
              as "emailVerifiedAt",
            image,
            phone_number as "phoneNumber",
            phone_number_verified as "phoneNumberVerified",
            two_factor_enabled as "twoFactorEnabled",
            created_at as "createdAt", updated_at as "updatedAt"
       from ${schema}.users as auth_user
      where id = $1
      limit 1`,
    [userId],
  )
  return result.rows[0] ?? null
}
