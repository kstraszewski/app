import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { jwt, magicLink } from 'better-auth/plugins'
import { Pool, type PoolConfig } from 'pg'

import { getBearerToken } from './headers.ts'
import { createDefaultBcryptPasswordStrategy } from './password.ts'
import {
  OPENEXPERT_AUTHENTICATED_ROLE,
  type OpenExpertAuthClaims,
  type OpenExpertAuthConfig,
  type OpenExpertAuthEmailSender,
  type OpenExpertAuthUser,
} from './types.ts'

const DEFAULT_SCHEMA = 'identity'
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SCHEMA_PATTERN = /^[a-z_][a-z0-9_]*$/

export interface CreateOpenExpertAuthOptions {
  config: OpenExpertAuthConfig
  emailSender: OpenExpertAuthEmailSender
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

  return {
    ...config,
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
    verificationExpiresIn: config.verificationExpiresIn ?? 60 * 60,
    resetPasswordExpiresIn: config.resetPasswordExpiresIn ?? 60 * 60,
    magicLinkExpiresIn: config.magicLinkExpiresIn ?? 60 * 60,
    magicLinkDisableSignUp: config.magicLinkDisableSignUp ?? false,
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

  const coreOptions = {
    appName: config.appName,
    baseURL: config.baseURL,
    basePath: config.basePath,
    secret: config.secret,
    trustedOrigins: [config.baseURL, ...(config.trustedOrigins ?? [])],
    database: pool,
    socialProviders: configuredSocialProviders,
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
      database: { generateId: 'uuid' as const },
      ...(options.scheduleBackgroundTask
        ? { backgroundTasks: { handler: options.scheduleBackgroundTask } }
        : {}),
    },
  } satisfies BetterAuthOptions

  const auth = betterAuth({
    ...coreOptions,
    plugins: [
      magicLink({
        expiresIn: config.magicLinkExpiresIn,
        disableSignUp: config.magicLinkDisableSignUp,
        storeToken: 'hashed',
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
  const bearer = getBearerToken(headers)
  if (bearer) return bearer
  return (await runtime.auth.api.getToken({ headers })).token
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
    `select id, name, email, email_verified as "emailVerified", image,
            created_at as "createdAt", updated_at as "updatedAt"
       from ${schema}.users
      where id = $1
      limit 1`,
    [userId],
  )
  return result.rows[0] ?? null
}
