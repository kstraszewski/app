import {
  getRequiredParam,
  requireCrmSession,
  requireOrganizationAdmin,
  throwDbError,
} from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  requireOrganizationAdmin(session)
  const productId = getRequiredParam(event, 'productId')

  const { data, error } = await session.supabase
    .from('mortgage_product_overrides')
    .delete()
    .eq('organization_id', session.organizationId)
    .eq('product_id', productId)
    .select('id')
    .maybeSingle()

  throwDbError(error)
  return { reset: Boolean(data) }
})
