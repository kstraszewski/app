import { serverSupabaseServiceRole } from '#supabase/server'
import { createError, getRouterParam } from 'h3'
import { requireCrmSession, throwDbError } from '~~/server/utils/crm'
import {
  brandAssetBucket,
  expertBrandProfileSelect,
  profileFromRow,
  type ExpertBrandProfileRow,
} from '~~/server/utils/brand'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const kind = getRouterParam(event, 'kind')
  if (kind !== 'portrait') {
    throw createError({ statusCode: 404, statusMessage: 'Expert profile asset type not found' })
  }

  const serviceRole = serverSupabaseServiceRole(event) as any
  const existing = await serviceRole
    .from('expert_brand_profiles')
    .select('portrait_path')
    .eq('organization_id', session.organizationId)
    .eq('user_id', session.userId)
    .maybeSingle()
  throwDbError(existing.error)

  if (!existing.data) {
    return { data: profileFromRow(session, null), updatedAt: null }
  }

  const result = await serviceRole
    .from('expert_brand_profiles')
    .update({ portrait_path: null })
    .eq('organization_id', session.organizationId)
    .eq('user_id', session.userId)
    .select(expertBrandProfileSelect)
    .single()
  throwDbError(result.error)

  const oldPath = existing.data.portrait_path
  if (oldPath) {
    const cleanup = await serviceRole.storage.from(brandAssetBucket).remove([oldPath])
    if (cleanup.error) console.warn('[brand] failed to remove asset', cleanup.error.message)
  }

  return {
    data: profileFromRow(session, result.data as ExpertBrandProfileRow),
    updatedAt: result.data.updated_at,
  }
})
