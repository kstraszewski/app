import { cloneDefaultOrganizationDesign, normalizeOrganizationDesign } from '#shared/design'
import { requireCrmSession, throwDbError } from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const { data, error } = await session.dataApi
    .from('organization_design_settings')
    .select('settings, updated_at')
    .eq('organization_id', session.organizationId)
    .maybeSingle()

  throwDbError(error)

  return {
    data: data ? normalizeOrganizationDesign(data.settings) : cloneDefaultOrganizationDesign(),
    canEdit: session.role === 'admin',
    updatedAt: data?.updated_at ?? null,
  }
})
