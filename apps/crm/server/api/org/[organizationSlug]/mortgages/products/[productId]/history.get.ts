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

  const { data: revisions, error } = await session.dataApi
    .from('mortgage_product_override_revisions')
    .select('id, revision, action, is_enabled, custom_name, parameters, notes, changed_by, created_at')
    .eq('organization_id', session.organizationId)
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
  throwDbError(error)

  const actorIds = [...new Set((revisions ?? []).map((revision: any) => revision.changed_by))]
  const { data: actors, error: actorsError } = actorIds.length
    ? await session.dataApi.from('users').select('id, full_name, email').in('id', actorIds)
    : { data: [], error: null }
  throwDbError(actorsError)
  const actorById = new Map((actors ?? []).map((actor: any) => [actor.id, actor]))

  return {
    data: (revisions ?? []).map((revision: any) => ({
      ...revision,
      actor: actorById.get(revision.changed_by) ?? null,
    })),
  }
})
