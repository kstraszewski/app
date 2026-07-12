import { readBody } from 'h3'
import { asRecord, requireCrmSession, requiredText, textValue, throwDbError } from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const body = asRecord(await readBody(event))

  const { data, error } = await session.supabase
    .from('crm_providers')
    .insert({
      organization_id: session.organizationId,
      kind: textValue(body.kind) ?? 'other',
      name: requiredText(body.name, 'name'),
      tax_id: textValue(body.tax_id) ?? null,
      contact_email: textValue(body.contact_email) ?? null,
      contact_phone: textValue(body.contact_phone) ?? null,
      website: textValue(body.website) ?? null,
      metadata: asRecord(body.metadata),
    })
    .select('*')
    .single()

  throwDbError(error)

  return { data }
})

