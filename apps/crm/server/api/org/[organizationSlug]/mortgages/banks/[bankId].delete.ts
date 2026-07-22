import {
  getRequiredParam,
  requireCrmSession,
  requireSuperAdmin,
  throwDbError,
} from '~~/server/utils/crm'

const logoBucket = 'mortgage-bank-logos'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  await requireSuperAdmin(session)
  const bankId = getRequiredParam(event, 'bankId')

  const { data, error } = await session.supabase
    .from('mortgage_bank_overrides')
    .delete()
    .eq('organization_id', session.organizationId)
    .eq('bank_id', bankId)
    .select('id, logo_path')
    .maybeSingle()
  throwDbError(error)

  if (data?.logo_path) {
    const { error: removeError } = await session.supabase.storage.from(logoBucket).remove([data.logo_path])
    if (removeError) console.warn('[mortgages] failed to remove reset bank logo', removeError.message)
  }

  return { reset: Boolean(data) }
})
