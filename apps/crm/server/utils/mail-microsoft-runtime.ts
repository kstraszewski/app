import { useRuntimeConfig } from '#imports'
import { getHeader, getRequestURL, type H3Event } from 'h3'
import {
  exchangeMicrosoftMailOAuthCode as exchangeCode,
  microsoftMailAuthorizationUrl as authorizationUrl,
  microsoftMailProviderAvailability as providerAvailability,
  refreshMicrosoftMailOAuthToken as refreshToken,
  type MicrosoftMailOAuthConfig,
  type MicrosoftMailOAuthTokenSet,
} from './mail-microsoft.ts'

export function microsoftMailRuntimeConfig(event: H3Event): MicrosoftMailOAuthConfig {
  const config = useRuntimeConfig(event).mailOAuth as {
    microsoft?: MicrosoftMailOAuthConfig
  }
  return {
    ...config.microsoft,
    redirectUri: config.microsoft?.redirectUri || microsoftMailOAuthCallbackUrl(event),
    tenant: config.microsoft?.tenant || 'common',
  }
}

export function microsoftMailRuntimeAvailability(event: H3Event): boolean {
  return providerAvailability(microsoftMailRuntimeConfig(event))
}

export function microsoftMailOAuthCallbackUrl(event: H3Event): string {
  const configured = (
    useRuntimeConfig(event).mailOAuth as { microsoft?: MicrosoftMailOAuthConfig }
  ).microsoft?.redirectUri
  if (configured) return configured

  const requestUrl = getRequestURL(event)
  const forwardedHost = getHeader(event, 'x-forwarded-host')
  const forwardedProto = getHeader(event, 'x-forwarded-proto')
  const origin = forwardedHost
    ? `${forwardedProto || requestUrl.protocol.replace(':', '')}://${forwardedHost}`
    : requestUrl.origin
  return `${origin}/api/mail/oauth/microsoft/callback`
}

export function microsoftMailRuntimeAuthorizationUrl(
  event: H3Event,
  state: string,
  codeChallenge: string,
  loginHint?: string,
): string {
  return authorizationUrl(microsoftMailRuntimeConfig(event), {
    state,
    codeChallenge,
    loginHint,
    prompt: 'select_account',
  })
}

export function exchangeMicrosoftMailRuntimeCode(
  event: H3Event,
  code: string,
  codeVerifier: string,
): Promise<MicrosoftMailOAuthTokenSet> {
  return exchangeCode(microsoftMailRuntimeConfig(event), {
    code,
    codeVerifier,
  })
}

export function refreshMicrosoftMailRuntimeToken(
  event: H3Event,
  token: string,
): Promise<MicrosoftMailOAuthTokenSet> {
  return refreshToken(microsoftMailRuntimeConfig(event), token)
}
