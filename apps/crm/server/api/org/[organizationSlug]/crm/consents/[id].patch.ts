import { readBody } from 'h3'
import {
  loadConsentDefinitions,
  parseConsentDefinitionUpdate,
} from '~~/server/utils/consents'
import {
  asRecord,
  getRequiredParam,
  requireAdministrativePermission,
  requireCrmSession,
  throwDbError,
} from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  await requireAdministrativePermission(
    session,
    'compliance.consents.definitions.manage',
  )
  const definitionId = getRequiredParam(event, 'id')

  const [existing] = await loadConsentDefinitions(session, { definitionId })
  if (!existing) {
    throwDbError({ message: 'Consent definition not found' }, 404)
    return
  }

  const input = parseConsentDefinitionUpdate(asRecord(await readBody(event)), existing)
  if (input.status === 'published') {
    await requireAdministrativePermission(
      session,
      'compliance.consents.definitions.publish',
    )
  }
  const { error } = await session.dataApi.rpc('update_crm_consent_definition', {
    p_definition_id: definitionId,
    p_organization_id: session.organizationId,
    p_internal_name: input.internal_name,
    p_display_title: input.display_title,
    p_content: input.content,
    p_purpose: input.purpose,
    p_channel: input.channel,
    p_legal_basis: input.legal_basis,
    p_is_required: input.is_required,
    p_status: input.status,
    p_sort_order: input.sort_order,
    p_language_code: input.language_code,
    p_effective_from: input.effective_from,
    p_effective_to: input.effective_to,
    p_change_note: input.change_note,
  })

  if (error?.code === 'P0002' || error?.message?.includes('consent_definition_not_found')) {
    throwDbError(error, 404)
  }
  throwDbError(error)

  const [definition] = await loadConsentDefinitions(session, { definitionId })
  if (!definition) {
    throwDbError({ message: 'Consent definition not found' }, 404)
    return
  }

  return { data: definition }
})
