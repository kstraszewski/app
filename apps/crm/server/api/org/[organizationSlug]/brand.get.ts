import { cloneDefaultOrganizationDesign, normalizeOrganizationDesign } from '#shared/design'
import { requireCrmSession, throwDbError } from '~~/server/utils/crm'
import {
  expertBrandProfileSelect,
  profileFromRow,
  type ExpertBrandProfileRow,
} from '~~/server/utils/brand'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const [profileResult, designResult] = await Promise.all([
    session.supabase
      .from('expert_brand_profiles')
      .select(expertBrandProfileSelect)
      .eq('organization_id', session.organizationId)
      .eq('user_id', session.userId)
      .maybeSingle(),
    session.supabase
      .from('organization_design_settings')
      .select('settings, updated_at')
      .eq('organization_id', session.organizationId)
      .maybeSingle(),
  ])

  throwDbError(profileResult.error)
  throwDbError(designResult.error)

  return {
    data: {
      profile: profileFromRow(session, profileResult.data as ExpertBrandProfileRow | null),
      design: designResult.data
        ? normalizeOrganizationDesign(designResult.data.settings)
        : cloneDefaultOrganizationDesign(),
    },
    permissions: {
      canEditProfile: true,
      canEditVisualIdentity: session.role === 'admin',
    },
    updatedAt: profileResult.data?.updated_at ?? null,
    visualIdentityUpdatedAt: designResult.data?.updated_at ?? null,
  }
})
