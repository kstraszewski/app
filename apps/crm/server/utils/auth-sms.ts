import { randomUUID } from 'node:crypto'
import type {
  OpenExpertAuthPhoneMessage,
  OpenExpertAuthPhoneMessageKind,
} from '@openexpert/auth'

export type AuthSmsProvider = 'local' | 'http'

export interface AuthSmsRuntimeConfig {
  enabled?: unknown
  provider?: unknown
  demoAutoFill?: unknown
  gatewayUrl?: unknown
  gatewayToken?: unknown
  sender?: unknown
  ttlSeconds?: unknown
  maxOtpAttempts?: unknown
}

export interface AuthSmsConfig {
  enabled: boolean
  provider: AuthSmsProvider
  demoAutoFill: boolean
  gatewayUrl: string
  gatewayToken: string
  sender: string
  ttlSeconds: number
  maxOtpAttempts: number
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  return fallback
}

function integerValue(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback
}

export function resolveAuthSmsConfig(
  input: AuthSmsRuntimeConfig,
  options: { production?: boolean } = {},
): AuthSmsConfig {
  const production = options.production === true
  const provider = text(input.provider) || (production ? 'http' : 'local')
  if (provider !== 'local' && provider !== 'http') {
    throw new TypeError('Auth SMS provider must be local or http')
  }

  const config: AuthSmsConfig = {
    enabled: booleanValue(input.enabled, !production),
    provider,
    demoAutoFill: !production && booleanValue(input.demoAutoFill, provider === 'local'),
    gatewayUrl: text(input.gatewayUrl),
    gatewayToken: text(input.gatewayToken),
    sender: text(input.sender) || 'OpenExpert',
    ttlSeconds: integerValue(input.ttlSeconds, 5 * 60, 60, 60 * 60),
    maxOtpAttempts: integerValue(input.maxOtpAttempts, 5, 1, 10),
  }

  if (config.enabled && production && config.provider !== 'http') {
    throw new TypeError('Production phone authentication requires the HTTP SMS provider')
  }
  if (config.enabled && config.provider === 'http') {
    const gateway = new URL(config.gatewayUrl)
    if (!['http:', 'https:'].includes(gateway.protocol)) {
      throw new TypeError('Auth SMS gateway must use HTTP or HTTPS')
    }
    if (production && gateway.protocol !== 'https:') {
      throw new TypeError('Production auth SMS gateway must use HTTPS')
    }
    if (!config.gatewayToken) throw new TypeError('Auth SMS gateway token is missing')
  }
  return config
}

export function authSmsBody(
  kind: OpenExpertAuthPhoneMessageKind,
  code: string,
  ttlSeconds: number,
): string {
  const minutes = Math.max(1, Math.ceil(ttlSeconds / 60))
  const action = kind === 'phone-password-reset'
    ? 'ustawienia nowego hasła'
    : 'logowania lub potwierdzenia numeru'
  return `OpenExpert: kod ${action}: ${code}. Ważny ${minutes} min. Nie podawaj go nikomu.`
}

export async function sendAuthSms(
  config: AuthSmsConfig,
  message: OpenExpertAuthPhoneMessage,
): Promise<void> {
  if (!config.enabled) throw new Error('Phone authentication is not configured')
  if (config.provider === 'local') return

  let response: Response
  try {
    response = await fetch(config.gatewayUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${config.gatewayToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: message.to,
        from: config.sender,
        message: authSmsBody(message.kind, message.code, config.ttlSeconds),
        clientReference: `auth-${randomUUID()}`,
      }),
      signal: AbortSignal.timeout(10_000),
    })
  }
  catch {
    throw new Error('Auth SMS gateway is unavailable')
  }

  if (!response.ok) {
    throw new Error(`Auth SMS gateway rejected the message (${response.status})`)
  }
}
