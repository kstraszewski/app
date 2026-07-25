import { requireCrmSession, throwDbError } from '~~/server/utils/crm'
import {
  expertBrandProfileSelect,
  profileFromRow,
  profileToRow,
  type ExpertBrandProfileRow,
} from '~~/server/utils/brand'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const body = await readBody(event)
  const values = profileToRow(body)

  const { data, error } = await session.supabase
    .from('expert_brand_profiles')
    .upsert({
      organization_id: session.organizationId,
      user_id: session.userId,
      ...values,
    }, { onConflict: 'organization_id,user_id' })
    .select(expertBrandProfileSelect)
    .single()

  throwDbError(error)

  return {
    data: profileFromRow(session, data as ExpertBrandProfileRow),
    updatedAt: data.updated_at,
  }
})
