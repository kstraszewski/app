import { readBody } from 'h3'
import { asRecord, requireCrmSession, requiredText, textValue, throwDbError } from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const body = asRecord(await readBody(event))
  const name = requiredText(body.name, 'name')
  const code = textValue(body.code)
    ?? name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

  const { data, error } = await session.supabase
    .from('crm_product_types')
    .insert({
      organization_id: session.organizationId,
      domain: textValue(body.domain) ?? 'other',
      code,
      name,
      description: textValue(body.description) ?? null,
      is_system: false,
      is_active: true,
      metadata: asRecord(body.metadata),
    })
    .select('*')
    .single()

  throwDbError(error)

  return { data }
})

