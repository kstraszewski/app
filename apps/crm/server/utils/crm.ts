import { serverSupabaseClient, serverSupabaseUser } from '#supabase/server'
import { useRuntimeConfig } from '#imports'
import { createError, getRouterParam, type H3Event } from 'h3'

type CrmSupabaseClient = any

export interface CrmSession {
  supabase: CrmSupabaseClient
  userId: string
  organizationId: string
  email: string
  role: string
}

export async function requireCrmSession(event: H3Event): Promise<CrmSession> {
  const openexpertConfig = useRuntimeConfig(event).public.openexpert as { hasSupabaseConfig?: boolean }
  if (!openexpertConfig.hasSupabaseConfig) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Supabase is not configured',
    })
  }

  const claims = await serverSupabaseUser(event)
  const userId = typeof claims?.sub === 'string' ? claims.sub : null
  if (!userId) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }

  const supabase = await serverSupabaseClient(event) as CrmSupabaseClient
  const { data: profile, error } = await supabase
    .from('users')
    .select('id, organization_id, email, role')
    .eq('id', userId)
    .single()

  if (error || !profile?.organization_id) {
    throw createError({
      statusCode: 403,
      statusMessage: 'CRM profile is missing for the authenticated user',
    })
  }

  return {
    supabase,
    userId,
    organizationId: String(profile.organization_id),
    email: String(profile.email ?? ''),
    role: String(profile.role ?? 'expert'),
  }
}

export function getRequiredParam(event: H3Event, name: string): string {
  const value = getRouterParam(event, name)
  if (!value) {
    throw createError({ statusCode: 400, statusMessage: `Missing route param: ${name}` })
  }
  return value
}

export function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  return input as Record<string, unknown>
}

export function textValue(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined
  const value = input.trim()
  return value.length ? value : undefined
}

export function requiredText(input: unknown, field: string): string {
  const value = textValue(input)
  if (!value) {
    throw createError({ statusCode: 400, statusMessage: `${field} is required` })
  }
  return value
}

export function numberValue(input: unknown): number | undefined {
  if (typeof input === 'number' && Number.isFinite(input)) return input
  if (typeof input === 'string' && input.trim()) {
    const parsed = Number(input)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

export function stringArrayValue(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return input.map(textValue).filter((value): value is string => Boolean(value))
}

export function throwDbError(error: { message?: string } | null | undefined, statusCode = 500): void {
  if (!error) return
  throw createError({
    statusCode,
    statusMessage: error.message || 'Database operation failed',
  })
}

export function defaultItemStatus(domain?: string): string {
  if (domain === 'insurance') return 'analiza_potrzeb'
  if (domain === 'real_estate') return 'przyjecie'
  return 'kwalifikacja'
}

export async function resolveProductType(
  session: CrmSession,
  body: Record<string, unknown>,
): Promise<{ id: string; domain: string; name: string }> {
  const productTypeId = textValue(body.product_type_id)
  const productTypeCode = textValue(body.product_type_code)

  let query = session.supabase
    .from('crm_product_types')
    .select('id, domain, name')
    .eq('is_active', true)
    .limit(1)

  if (productTypeId) query = query.eq('id', productTypeId)
  else if (productTypeCode) query = query.eq('code', productTypeCode)
  else {
    throw createError({
      statusCode: 400,
      statusMessage: 'product_type_id or product_type_code is required',
    })
  }

  const { data, error } = await query.single()
  if (error || !data) {
    throw createError({ statusCode: 404, statusMessage: 'Product type not found' })
  }

  return {
    id: String(data.id),
    domain: String(data.domain),
    name: String(data.name),
  }
}

export async function recordCrmActivity(
  session: CrmSession,
  activity: {
    client_id?: string
    case_id?: string
    case_item_id?: string
    submission_id?: string
    activity_type: string
    title: string
    body?: string
    payload?: Record<string, unknown>
  },
): Promise<void> {
  const { error } = await session.supabase.from('crm_activities').insert({
    organization_id: session.organizationId,
    actor_user_id: session.userId,
    client_id: activity.client_id ?? null,
    case_id: activity.case_id ?? null,
    case_item_id: activity.case_item_id ?? null,
    submission_id: activity.submission_id ?? null,
    activity_type: activity.activity_type,
    title: activity.title,
    body: activity.body ?? null,
    payload: activity.payload ?? {},
  })

  if (error) {
    console.warn('[crm] failed to record activity', error.message)
  }
}
