import {
  createEmptyIntermediarySettings,
  intermediarySettingsReadiness,
  normalizeIntermediarySettings,
} from '#shared/intermediary-settings'
import { requireCrmSession, throwDbError } from '~~/server/utils/crm'
import { resolveIntermediaryLenders } from '~~/server/utils/intermediary-lenders'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const [{ data, error }, lenders] = await Promise.all([
    session.dataApi
      .from('organization_intermediary_settings')
      .select('settings, revision, updated_at')
      .eq('organization_id', session.organizationId)
      .maybeSingle(),
    resolveIntermediaryLenders(session.dataApi),
  ])

  throwDbError(error)

  const settings = data
    ? normalizeIntermediarySettings(data.settings)
    : createEmptyIntermediarySettings()

  return {
    data: settings,
    lenders,
    readiness: intermediarySettingsReadiness(settings),
    isConfigured: Boolean(data),
    revision: data?.revision ?? 0,
    updatedAt: data?.updated_at ?? null,
    canEdit: session.role === 'admin',
  }
})
