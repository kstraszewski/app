import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto'
import { useRuntimeConfig } from '#imports'
import { createError, getHeader, getRequestURL, type H3Event } from 'h3'

export type CalendarProviderName = 'google' | 'microsoft'

interface CalendarOAuthClientConfig {
  clientId?: string
  clientSecret?: string
  redirectUri?: string
  tenant?: string
}

interface CalendarProviderRuntimeConfig {
  encryptionKey?: string
  google?: CalendarOAuthClientConfig
  microsoft?: CalendarOAuthClientConfig
}

export interface CalendarOAuthTokenSet {
  accessToken: string
  refreshToken: string | null
  expiresAt: string | null
  scopes: string[]
}

export interface ProviderCalendar {
  id: string
  name: string
  isPrimary: boolean
  canWrite: boolean
}

export interface ProviderIdentity {
  accountId: string
  email: string
  displayName: string
  calendars: ProviderCalendar[]
}

export interface ProviderBusyBlock {
  calendarId: string
  externalEventId: string
  startsAt: string
  endsAt: string
}

export interface ProviderEventInput {
  appointmentId: string
  calendarId: string
  externalEventId?: string | null
  etag?: string | null
  title: string
  startsAt: string
  endsAt: string
  timezone: string
  location?: string | null
}

export interface ProviderEventResult {
  externalEventId: string
  etag: string | null
}

const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.freebusy',
  'https://www.googleapis.com/auth/calendar.events',
]

const MICROSOFT_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'User.Read',
  'Calendars.ReadWrite',
]

function calendarConfig(event: H3Event): CalendarProviderRuntimeConfig {
  return useRuntimeConfig(event).calendarOAuth as CalendarProviderRuntimeConfig
}

function providerConfig(event: H3Event, provider: CalendarProviderName) {
  const config = calendarConfig(event)
  const providerValue = config[provider]
  if (!providerValue?.clientId || !providerValue.clientSecret || !config.encryptionKey) {
    throw createError({
      statusCode: 503,
      statusMessage: `${provider === 'google' ? 'Google Calendar' : 'Microsoft Outlook'} OAuth is not configured`,
    })
  }
  return {
    clientId: providerValue.clientId,
    clientSecret: providerValue.clientSecret,
    redirectUri: providerValue.redirectUri,
    tenant: providerValue.tenant,
    encryptionKey: config.encryptionKey,
  }
}

export function calendarProviderAvailability(event: H3Event) {
  const config = calendarConfig(event)
  return {
    google: Boolean(config.encryptionKey && config.google?.clientId && config.google.clientSecret),
    microsoft: Boolean(config.encryptionKey && config.microsoft?.clientId && config.microsoft.clientSecret),
  }
}

export function calendarOAuthState(): string {
  return randomBytes(32).toString('base64url')
}

export function calendarOAuthPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url')
  return { verifier, challenge }
}

export function calendarOAuthCallbackUrl(event: H3Event, provider: CalendarProviderName): string {
  const configured = calendarConfig(event)[provider]?.redirectUri
  if (configured) return configured

  const requestUrl = getRequestURL(event)
  const forwardedHost = getHeader(event, 'x-forwarded-host')
  const forwardedProto = getHeader(event, 'x-forwarded-proto')
  const origin = forwardedHost
    ? `${forwardedProto || requestUrl.protocol.replace(':', '')}://${forwardedHost}`
    : requestUrl.origin
  return `${origin}/api/calendar/oauth/${provider}/callback`
}

export function calendarAuthorizationUrl(
  event: H3Event,
  provider: CalendarProviderName,
  state: string,
  codeChallenge: string,
): string {
  const config = providerConfig(event, provider)
  const redirectUri = calendarOAuthCallbackUrl(event, provider)

  if (provider === 'google') {
    const query = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      scope: GOOGLE_SCOPES.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    })
    return `https://accounts.google.com/o/oauth2/v2/auth?${query}`
  }

  const tenant = config.tenant || 'common'
  const query = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    response_mode: 'query',
    scope: MICROSOFT_SCOPES.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })
  return `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize?${query}`
}

export async function exchangeCalendarOAuthCode(
  event: H3Event,
  provider: CalendarProviderName,
  code: string,
  codeVerifier: string,
): Promise<CalendarOAuthTokenSet> {
  const config = providerConfig(event, provider)
  const redirectUri = calendarOAuthCallbackUrl(event, provider)
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
  })

  let endpoint: string
  if (provider === 'google') {
    endpoint = 'https://oauth2.googleapis.com/token'
  } else {
    endpoint = `https://login.microsoftonline.com/${encodeURIComponent(config.tenant || 'common')}/oauth2/v2.0/token`
    body.set('scope', MICROSOFT_SCOPES.join(' '))
  }

  const token = await providerJson<{
    access_token?: string
    refresh_token?: string
    expires_in?: number
    scope?: string
  }>(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  }, 'OAuth token exchange')

  if (!token.access_token) {
    throw createError({ statusCode: 502, statusMessage: 'Calendar provider returned no access token' })
  }

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? null,
    expiresAt: token.expires_in
      ? new Date(Date.now() + Math.max(0, token.expires_in - 60) * 1000).toISOString()
      : null,
    scopes: (token.scope || (provider === 'google' ? GOOGLE_SCOPES : MICROSOFT_SCOPES).join(' '))
      .split(/\s+/)
      .filter(Boolean),
  }
}

export async function refreshCalendarOAuthToken(
  event: H3Event,
  provider: CalendarProviderName,
  refreshToken: string,
): Promise<CalendarOAuthTokenSet> {
  const config = providerConfig(event, provider)
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })
  let endpoint: string

  if (provider === 'google') {
    endpoint = 'https://oauth2.googleapis.com/token'
  } else {
    endpoint = `https://login.microsoftonline.com/${encodeURIComponent(config.tenant || 'common')}/oauth2/v2.0/token`
    body.set('scope', MICROSOFT_SCOPES.join(' '))
  }

  const token = await providerJson<{
    access_token?: string
    refresh_token?: string
    expires_in?: number
    scope?: string
  }>(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  }, 'OAuth token refresh')

  if (!token.access_token) {
    throw createError({ statusCode: 502, statusMessage: 'Calendar provider returned no access token' })
  }

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? refreshToken,
    expiresAt: token.expires_in
      ? new Date(Date.now() + Math.max(0, token.expires_in - 60) * 1000).toISOString()
      : null,
    scopes: (token.scope || '').split(/\s+/).filter(Boolean),
  }
}

export async function fetchProviderIdentity(
  provider: CalendarProviderName,
  accessToken: string,
): Promise<ProviderIdentity> {
  const headers = { authorization: `Bearer ${accessToken}` }

  if (provider === 'google') {
    const [profile, calendarResponse] = await Promise.all([
      providerJson<{ sub?: string; email?: string; name?: string }>(
        'https://www.googleapis.com/oauth2/v3/userinfo', { headers }, 'Google profile',
      ),
      providerJson<{ items?: Array<{ id?: string; summary?: string; primary?: boolean; accessRole?: string }> }>(
        'https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader',
        { headers },
        'Google calendar list',
      ),
    ])
    return {
      accountId: profile.sub || profile.email || '',
      email: profile.email || '',
      displayName: profile.name || profile.email || 'Google Calendar',
      calendars: (calendarResponse.items ?? []).flatMap(calendar => calendar.id ? [{
        id: calendar.id,
        name: calendar.summary || calendar.id,
        isPrimary: Boolean(calendar.primary),
        canWrite: ['owner', 'writer'].includes(calendar.accessRole || ''),
      }] : []),
    }
  }

  const [profile, calendarResponse] = await Promise.all([
    providerJson<{ id?: string; displayName?: string; mail?: string; userPrincipalName?: string }>(
      'https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName',
      { headers },
      'Microsoft profile',
    ),
    providerJson<{ value?: Array<{ id?: string; name?: string; canEdit?: boolean; isDefaultCalendar?: boolean }> }>(
      'https://graph.microsoft.com/v1.0/me/calendars?$select=id,name,canEdit,isDefaultCalendar',
      { headers: { ...headers, Prefer: 'IdType="ImmutableId"' } },
      'Microsoft calendar list',
    ),
  ])
  return {
    accountId: profile.id || profile.userPrincipalName || '',
    email: profile.mail || profile.userPrincipalName || '',
    displayName: profile.displayName || profile.mail || profile.userPrincipalName || 'Microsoft Outlook',
    calendars: (calendarResponse.value ?? []).flatMap(calendar => calendar.id ? [{
      id: calendar.id,
      name: calendar.name || calendar.id,
      isPrimary: Boolean(calendar.isDefaultCalendar),
      canWrite: Boolean(calendar.canEdit),
    }] : []),
  }
}

export async function fetchProviderBusyBlocks(
  provider: CalendarProviderName,
  accessToken: string,
  calendarIds: string[],
  startsAt: string,
  endsAt: string,
): Promise<ProviderBusyBlock[]> {
  const uniqueCalendarIds = [...new Set(calendarIds.filter(Boolean))]
  if (!uniqueCalendarIds.length) return []
  const headers = { authorization: `Bearer ${accessToken}` }

  if (provider === 'google') {
    const result: ProviderBusyBlock[] = []
    for (let index = 0; index < uniqueCalendarIds.length; index += 50) {
      const batch = uniqueCalendarIds.slice(index, index + 50)
      const response = await providerJson<{
        calendars?: Record<string, {
          busy?: Array<{ start?: string; end?: string }>
          errors?: Array<{ reason?: string }>
        }>
      }>('https://www.googleapis.com/calendar/v3/freeBusy', {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          timeMin: startsAt,
          timeMax: endsAt,
          items: batch.map(id => ({ id })),
        }),
      }, 'Google Calendar free/busy')

      for (const [calendarId, calendar] of Object.entries(response.calendars ?? {})) {
        if (calendar.errors?.length) {
          throw createError({ statusCode: 502, statusMessage: 'Google Calendar returned incomplete free/busy data' })
        }
        for (const busy of calendar.busy ?? []) {
          if (!busy.start || !busy.end) continue
          result.push({
            calendarId,
            externalEventId: createHash('sha256')
              .update(`${calendarId}\0${busy.start}\0${busy.end}`)
              .digest('hex'),
            startsAt: busy.start,
            endsAt: busy.end,
          })
        }
      }
    }
    return result
  }

  const result: ProviderBusyBlock[] = []
  for (const calendarId of uniqueCalendarIds) {
    const query = new URLSearchParams({
      startDateTime: startsAt,
      endDateTime: endsAt,
      '$select': 'id,start,end,showAs,isCancelled',
      '$top': '1000',
    })
    let url: string | null = `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendarId)}/calendarView?${query}`
    while (url) {
      const page: {
        value?: Array<{
          id?: string
          showAs?: string
          isCancelled?: boolean
          start?: { dateTime?: string; timeZone?: string }
          end?: { dateTime?: string; timeZone?: string }
        }>
        '@odata.nextLink'?: string
      } = await providerJson(url, {
        headers: { ...headers, Prefer: 'outlook.timezone="UTC", IdType="ImmutableId"' },
      }, 'Microsoft calendar view')
      for (const event of page.value ?? []) {
        if (!event.id || event.isCancelled || event.showAs === 'free' || !event.start?.dateTime || !event.end?.dateTime) continue
        result.push({
          calendarId,
          externalEventId: event.id,
          startsAt: normalizeGraphDate(event.start.dateTime),
          endsAt: normalizeGraphDate(event.end.dateTime),
        })
      }
      url = page['@odata.nextLink'] ?? null
    }
  }
  return result
}

export async function writeProviderAppointmentEvent(
  provider: CalendarProviderName,
  accessToken: string,
  input: ProviderEventInput,
): Promise<ProviderEventResult> {
  const authorization = { authorization: `Bearer ${accessToken}` }

  if (provider === 'google') {
    const externalEventId = input.externalEventId || googleEventId(input.appointmentId)
    const endpoint = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(externalEventId)}?sendUpdates=none`
    const payload = {
      summary: input.title,
      location: input.location || undefined,
      visibility: 'private',
      transparency: 'opaque',
      start: { dateTime: input.startsAt, timeZone: input.timezone },
      end: { dateTime: input.endsAt, timeZone: input.timezone },
      extendedProperties: { private: { openexpertAppointmentId: input.appointmentId } },
    }

    if (!input.externalEventId) {
      const createUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events?sendUpdates=none`
      const createResponse = await fetch(createUrl, {
        method: 'POST',
        headers: { ...authorization, 'content-type': 'application/json' },
        body: JSON.stringify({ id: externalEventId, ...payload }),
      })
      if (createResponse.status === 409) {
        const recovered = await providerJson<{ id?: string; etag?: string }>(endpoint, {
          method: 'PATCH',
          headers: { ...authorization, 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }, 'Google event retry recovery')
        return { externalEventId: recovered.id || externalEventId, etag: recovered.etag ?? null }
      }
      if (!createResponse.ok) {
        await createResponse.text().catch(() => '')
        throw createError({
          statusCode: 502,
          statusMessage: `Google event creation failed with HTTP ${createResponse.status}`,
        })
      }
      const created = await createResponse.json() as { id?: string; etag?: string }
      return { externalEventId: created.id || externalEventId, etag: created.etag ?? null }
    }

    const updated = await providerJson<{ id?: string; etag?: string }>(endpoint, {
      method: 'PATCH',
      headers: {
        ...authorization,
        'content-type': 'application/json',
        ...(input.etag ? { 'if-match': input.etag } : {}),
      },
      body: JSON.stringify(payload),
    }, 'Google event update')
    return { externalEventId: updated.id || externalEventId, etag: updated.etag ?? null }
  }

  const base = `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(input.calendarId)}/events`
  const payload = {
    subject: input.title,
    sensitivity: 'private',
    showAs: 'busy',
    ...(!input.externalEventId ? { transactionId: input.appointmentId } : {}),
    start: { dateTime: graphUtcDateTime(input.startsAt), timeZone: 'UTC' },
    end: { dateTime: graphUtcDateTime(input.endsAt), timeZone: 'UTC' },
    location: input.location ? { displayName: input.location } : undefined,
  }
  const updated = await providerJson<{ id?: string; '@odata.etag'?: string }>(
    input.externalEventId ? `${base}/${encodeURIComponent(input.externalEventId)}` : base,
    {
      method: input.externalEventId ? 'PATCH' : 'POST',
      headers: {
        ...authorization,
        'content-type': 'application/json',
        Prefer: 'IdType="ImmutableId"',
        ...(input.etag ? { 'if-match': input.etag } : {}),
      },
      body: JSON.stringify(payload),
    },
    input.externalEventId ? 'Microsoft event update' : 'Microsoft event creation',
  )
  if (!updated.id && !input.externalEventId) {
    throw createError({ statusCode: 502, statusMessage: 'Microsoft returned no event ID' })
  }
  return { externalEventId: updated.id || input.externalEventId || '', etag: updated['@odata.etag'] ?? null }
}

export async function deleteProviderAppointmentEvent(
  provider: CalendarProviderName,
  accessToken: string,
  calendarId: string,
  externalEventId: string,
): Promise<void> {
  const url = provider === 'google'
    ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(externalEventId)}?sendUpdates=none`
    : `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(externalEventId)}`
  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(provider === 'microsoft' ? { Prefer: 'IdType="ImmutableId"' } : {}),
    },
  })
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    await response.text().catch(() => '')
    throw createError({ statusCode: 502, statusMessage: `Calendar event deletion failed with HTTP ${response.status}` })
  }
}

function normalizeGraphDate(value: string): string {
  return /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`
}

function graphUtcDateTime(value: string): string {
  return new Date(value).toISOString().replace(/\.\d{3}Z$/, '')
}

function googleEventId(value: string): string {
  const alphabet = '0123456789abcdefghijklmnopqrstuv'
  const bytes = createHash('sha256').update(`openexpert:${value}`).digest()
  let bits = 0
  let buffer = 0
  let result = ''
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      result += alphabet[(buffer >>> bits) & 31]
    }
  }
  if (bits) result += alphabet[(buffer << (5 - bits)) & 31]
  return result
}

function encryptionKey(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest()
}

export function encryptCalendarToken(event: H3Event, value: string | null): string | null {
  if (!value) return null
  const secret = calendarConfig(event).encryptionKey
  if (!secret) throw createError({ statusCode: 503, statusMessage: 'Calendar token encryption is not configured' })
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.')
}

export function decryptCalendarToken(event: H3Event, value: string | null | undefined): string | null {
  if (!value) return null
  const secret = calendarConfig(event).encryptionKey
  if (!secret) throw createError({ statusCode: 503, statusMessage: 'Calendar token encryption is not configured' })
  const [version, ivValue, tagValue, encryptedValue] = value.split('.')
  if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue) {
    throw createError({ statusCode: 500, statusMessage: 'Stored calendar token has an invalid format' })
  }
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      encryptionKey(secret),
      Buffer.from(ivValue, 'base64url'),
    )
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    throw createError({ statusCode: 500, statusMessage: 'Stored calendar token cannot be decrypted' })
  }
}

async function providerJson<T>(
  url: string,
  init: RequestInit,
  operation: string,
): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    await response.text().catch(() => '')
    throw createError({
      statusCode: 502,
      statusMessage: `${operation} failed with HTTP ${response.status}`,
    })
  }
  return await response.json() as T
}
