import { createClient, type SupabaseClient } from '@supabase/supabase-js'

interface SupabaseEnvironment {
  url: string
  publicKey: string
  serviceKey?: string
}

function firstEnvironmentValue(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return undefined
}

export function getAgentSupabaseEnvironment(options: { requireServiceKey?: boolean } = {}): SupabaseEnvironment {
  const url = firstEnvironmentValue(['NUXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL'])
  const publicKey = firstEnvironmentValue(['NUXT_PUBLIC_SUPABASE_KEY', 'SUPABASE_KEY'])
  const serviceKey = firstEnvironmentValue(['NUXT_SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_KEY'])

  if (!url || !publicKey || publicKey === 'local-development-placeholder') {
    throw new Error('Supabase is not configured for the CRM assistant.')
  }
  if (options.requireServiceKey && !serviceKey) {
    throw new Error('The Supabase service key is not configured for the CRM assistant.')
  }

  return { url, publicKey, ...(serviceKey ? { serviceKey } : {}) }
}

const commonAuthOptions = {
  autoRefreshToken: false,
  detectSessionInUrl: false,
  persistSession: false,
}

export function createAgentUserClient(accessToken: string): SupabaseClient {
  const environment = getAgentSupabaseEnvironment()
  return createClient(environment.url, environment.publicKey, {
    auth: commonAuthOptions,
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  })
}

export function createAgentServiceClient(): SupabaseClient {
  const environment = getAgentSupabaseEnvironment({ requireServiceKey: true })
  return createClient(environment.url, environment.serviceKey!, {
    auth: commonAuthOptions,
  })
}
