import {
  getRequiredParam,
  requireCrmSession,
  requireSuperAdmin,
  throwDbError,
} from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  await requireSuperAdmin(session)
  const productId = getRequiredParam(event, 'productId')

  const { data, error } = await session.dataApi
    .from('mortgage_product_overrides')
    .delete()
    .eq('organization_id', session.organizationId)
    .eq('product_id', productId)
    .select('id')
    .maybeSingle()

  throwDbError(error)
  return { reset: Boolean(data) }
})
