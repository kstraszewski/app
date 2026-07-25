import {
  createServerClient,
  parseCookieHeader,
  type CookieMethodsServer,
} from '@supabase/ssr'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  createError,
  getHeader,
  setCookie,
  setHeader,
  type H3Event,
} from 'h3'
import type { Database } from '../../../../packages/database/database.types'

type OpenExpertSupabaseClient = SupabaseClient<Database, 'public'>

interface SupabaseEventContext {
  _openexpertSupabaseClient?: OpenExpertSupabaseClient
  _openexpertSupabaseServiceRole?: OpenExpertSupabaseClient
}

interface PublicSupabaseConfig {
  url: string
  key: string
  cookiePrefix: string
  cookieOptions: {
    sameSite: 'lax'
    secure: boolean
  }
}

async function fetchWithRetry(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await fetch(input, init)
    } catch (error) {
      if (init?.signal?.aborted || attempt === 3) throw error
      await new Promise(resolve => setTimeout(resolve, attempt * 100))
    }
  }

  throw new Error('Supabase request failed after retries.')
}

function eventContext(event: H3Event): SupabaseEventContext {
  return event.context as SupabaseEventContext
}

function publicSupabaseConfig(event: H3Event): PublicSupabaseConfig {
  return useRuntimeConfig(event).public.supabase as PublicSupabaseConfig
}

export async function serverSupabaseClient(event: H3Event): Promise<OpenExpertSupabaseClient> {
  const context = eventContext(event)
  if (context._openexpertSupabaseClient) return context._openexpertSupabaseClient

  const config = publicSupabaseConfig(event)
  const cookieMethods: CookieMethodsServer = {
    getAll: () => parseCookieHeader(getHeader(event, 'cookie') ?? '')
      .filter((cookie): cookie is { name: string, value: string } => (
        typeof cookie.value === 'string'
      )),
    setAll: (cookies, headers) => {
      if (event.node.res.headersSent || event.node.res.writableEnded) return

      for (const cookie of cookies) {
        setCookie(event, cookie.name, cookie.value, cookie.options)
      }
      for (const [name, value] of Object.entries(headers)) {
        setHeader(event, name, value)
      }
    },
  }
  const client = createServerClient<Database, 'public'>(
    config.url,
    config.key,
    {
      cookieOptions: {
        ...config.cookieOptions,
        name: config.cookiePrefix,
      },
      cookies: cookieMethods,
      global: {
        fetch: fetchWithRetry,
      },
    },
  )
  context._openexpertSupabaseClient = client

  return client
}

export function serverSupabaseServiceRole(event: H3Event): OpenExpertSupabaseClient {
  const context = eventContext(event)
  if (context._openexpertSupabaseServiceRole) {
    return context._openexpertSupabaseServiceRole
  }

  const config = useRuntimeConfig(event)
  const publicConfig = publicSupabaseConfig(event)
  const secretKey = String(config.supabase.secretKey || '')
  if (!secretKey) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Supabase service role is not configured.',
    })
  }

  const client = createClient<Database, 'public'>(
    publicConfig.url,
    secretKey,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
      global: {
        fetch: fetchWithRetry,
      },
    },
  )
  context._openexpertSupabaseServiceRole = client

  return client
}

export async function serverSupabaseUser(event: H3Event) {
  const client = await serverSupabaseClient(event)
  const { data, error } = await client.auth.getClaims()
  if (error) {
    throw createError({
      statusCode: 401,
      statusMessage: error.message,
    })
  }

  return data?.claims ?? null
}
