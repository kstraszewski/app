import { createError, readBody } from 'h3'
import {
  asRecord,
  getRequiredParam,
  requireCrmSession,
  requireSuperAdmin,
  throwDbError,
} from '~~/server/utils/crm'

function nullableText(value: unknown, field: string, maxLength: number): string | null {
  if (value === null || value === '') return null
  if (typeof value !== 'string') {
    throw createError({ statusCode: 400, statusMessage: `${field} must be text or null` })
  }
  const result = value.trim()
  if (!result) return null
  if (result.length > maxLength) {
    throw createError({ statusCode: 400, statusMessage: `${field} is too long` })
  }
  return result
}

function nullableWebsiteUrl(value: unknown): string | null {
  const result = nullableText(value, 'custom_website_url', 500)
  if (!result) return null
  try {
    const url = new URL(result)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol')
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'custom_website_url must be a valid HTTP(S) URL' })
  }
  return result
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  await requireSuperAdmin(session)
  const bankId = getRequiredParam(event, 'bankId')
  const body = asRecord(await readBody(event))

  const { data: bank, error: bankError } = await session.supabase
    .from('mortgage_banks')
    .select('id')
    .eq('id', bankId)
    .maybeSingle()
  throwDbError(bankError)
  if (!bank) throw createError({ statusCode: 404, statusMessage: 'Financial institution not found' })

  const { data: existing, error: existingError } = await session.supabase
    .from('mortgage_bank_overrides')
    .select('is_enabled, custom_name, custom_website_url, logo_path, notes')
    .eq('organization_id', session.organizationId)
    .eq('bank_id', bankId)
    .maybeSingle()
  throwDbError(existingError)

  const isEnabled = 'is_enabled' in body ? body.is_enabled : (existing?.is_enabled ?? true)
  if (typeof isEnabled !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'is_enabled must be boolean' })
  }

  const values = {
    is_enabled: isEnabled,
    custom_name: 'custom_name' in body
      ? nullableText(body.custom_name, 'custom_name', 200)
      : existing?.custom_name ?? null,
    custom_website_url: 'custom_website_url' in body
      ? nullableWebsiteUrl(body.custom_website_url)
      : existing?.custom_website_url ?? null,
    notes: 'notes' in body
      ? nullableText(body.notes, 'notes', 4_000)
      : existing?.notes ?? null,
  }

  const { data, error } = existing
    ? await session.supabase
        .from('mortgage_bank_overrides')
        .update(values)
        .eq('organization_id', session.organizationId)
        .eq('bank_id', bankId)
        .select('*')
        .single()
    : await session.supabase
        .from('mortgage_bank_overrides')
        .insert({ organization_id: session.organizationId, bank_id: bankId, ...values })
        .select('*')
        .single()

  throwDbError(error)
  return { data }
})
