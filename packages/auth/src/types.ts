export const OPENEXPERT_AUTHENTICATED_ROLE = 'authenticated' as const

export interface OpenExpertAuthUser {
  id: string
  name: string
  email: string
  emailVerified: boolean
  image: string | null
  phoneNumber: string | null
  phoneNumberVerified: boolean
  twoFactorEnabled: boolean
  createdAt: Date
  updatedAt: Date
}

export type OpenExpertAuthPhoneMessageKind =
  | 'phone-verification'
  | 'phone-password-reset'

export interface OpenExpertAuthPhoneMessage {
  kind: OpenExpertAuthPhoneMessageKind
  to: string
  code: string
  request?: Request
}

export interface OpenExpertAuthPhoneSender {
  send(message: OpenExpertAuthPhoneMessage): Promise<void>
}

export interface OpenExpertAuthPhoneOptions {
  sender: OpenExpertAuthPhoneSender
  expiresIn?: number
  allowedAttempts?: number
}

export interface OpenExpertAuthPasskeyOptions {
  /** Effective WebAuthn relying-party domain, without scheme or port. */
  rpID: string
  /** Exact browser origin or origins allowed to complete a WebAuthn ceremony. */
  origin: string | string[]
  rpName?: string
}

export interface OpenExpertAuthClaims {
  sub: string
  role: typeof OPENEXPERT_AUTHENTICATED_ROLE
  email: string
  emailVerified: boolean
}

export interface OpenExpertEmailUser {
  id: string
  name: string
  email: string
}

export type OpenExpertAuthEmail =
  | {
      kind: 'email-verification'
      to: string
      user: OpenExpertEmailUser
      url: string
      token: string
      request?: Request
    }
  | {
      kind: 'password-reset'
      to: string
      user: OpenExpertEmailUser
      url: string
      token: string
      request?: Request
    }
  | {
      kind: 'magic-link'
      to: string
      url: string
      token: string
      metadata?: Record<string, unknown>
      request?: Request
    }

export interface OpenExpertAuthEmailSender {
  send(message: OpenExpertAuthEmail): Promise<void>
}

export interface OpenExpertAuthSocialProviderConfig {
  clientId: string | string[]
  clientSecret: string
  /**
   * Social providers are an additional sign-in method for an already
   * activated OpenExpert identity. Keep provider sign-up disabled by default.
   */
  disableSignUp?: boolean
}

export interface OpenExpertAuthSocialProvidersConfig {
  google?: OpenExpertAuthSocialProviderConfig
  apple?: OpenExpertAuthSocialProviderConfig
}

export interface OpenExpertAuthConfig {
  appName?: string
  baseURL: string
  basePath?: string
  secret: string
  databaseURL: string
  databaseSchema?: string
  trustedOrigins?: string[]
  cookiePrefix?: string
  cookieDomain?: string
  disableSignUp?: boolean
  requireEmailVerification?: boolean
  minPasswordLength?: number
  maxPasswordLength?: number
  bcryptCost?: number
  sessionExpiresIn?: number
  sessionUpdateAge?: number
  verificationExpiresIn?: number
  resetPasswordExpiresIn?: number
  magicLinkExpiresIn?: number
  magicLinkDisableSignUp?: boolean
  jwtExpiresIn?: number
  jwksRotationInterval?: number
  jwksGracePeriod?: number
  socialProviders?: OpenExpertAuthSocialProvidersConfig
}
