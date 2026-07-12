import { readBody } from 'h3'
import {
  asRecord,
  requireCrmSession,
  requireOrganizationAdmin,
  requiredText,
  textValue,
  throwDbError,
} from '~~/server/utils/crm'

function teamSlug(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  requireOrganizationAdmin(session)
  const body = asRecord(await readBody(event))
  const name = requiredText(body.name, 'name')
  const slug = teamSlug(textValue(body.slug) ?? name)
  if (!slug) requiredText(slug, 'slug')

  const { data, error } = await session.supabase
    .from('teams')
    .insert({
      organization_id: session.organizationId,
      name,
      slug,
      kind: textValue(body.kind) ?? 'team',
      description: textValue(body.description) ?? null,
    })
    .select('*')
    .single()

  throwDbError(error)
  return { data }
})
