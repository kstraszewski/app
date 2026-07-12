import {
  getRequiredParam,
  requireCrmSession,
  requireOrganizationAdmin,
  throwDbError,
} from '~~/server/utils/crm'

const logoBucket = 'mortgage-bank-logos'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  requireOrganizationAdmin(session)
  const bankId = getRequiredParam(event, 'bankId')

  const { data: existing, error: existingError } = await session.supabase
    .from('mortgage_bank_overrides')
    .select('logo_path')
    .eq('organization_id', session.organizationId)
    .eq('bank_id', bankId)
    .maybeSingle()
  throwDbError(existingError)
  if (!existing?.logo_path) return { removed: false }

  const oldPath = existing.logo_path
  const { error } = await session.supabase
    .from('mortgage_bank_overrides')
    .update({ logo_path: null })
    .eq('organization_id', session.organizationId)
    .eq('bank_id', bankId)
  throwDbError(error)

  const { error: removeError } = await session.supabase.storage.from(logoBucket).remove([oldPath])
  if (removeError) console.warn('[mortgages] failed to remove bank logo', removeError.message)

  return { removed: true }
})
