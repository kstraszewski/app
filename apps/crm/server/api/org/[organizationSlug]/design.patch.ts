import { normalizeOrganizationDesign } from '#shared/design'
import {
  requireCrmSession,
  requireOrganizationAdmin,
  throwDbError,
} from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  requireOrganizationAdmin(session)

  const body = await readBody(event)
  const settings = normalizeOrganizationDesign(body)
  const updatedAt = new Date().toISOString()
  const { data, error } = await session.supabase
    .from('organization_design_settings')
    .upsert({
      organization_id: session.organizationId,
      settings,
      updated_by: session.userId,
      updated_at: updatedAt,
    }, { onConflict: 'organization_id' })
    .select('settings, updated_at')
    .single()

  throwDbError(error)

  return {
    data: normalizeOrganizationDesign(data.settings),
    updatedAt: data.updated_at,
  }
})
