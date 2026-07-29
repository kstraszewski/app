import { readBody } from 'h3'
import {
  loadConsentDefinitions,
  parseConsentDefinitionCreate,
} from '~~/server/utils/consents'
import {
  asRecord,
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
  const input = parseConsentDefinitionCreate(asRecord(await readBody(event)))
  if (input.status === 'published') {
    await requireAdministrativePermission(
      session,
      'compliance.consents.definitions.publish',
    )
  }

  const { data: definitionId, error } = await session.supabase.rpc(
    'create_crm_consent_definition',
    {
      p_organization_id: session.organizationId,
      p_code: input.code,
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
    },
  )
  throwDbError(error)
  if (typeof definitionId !== 'string') {
    throwDbError({ message: 'Consent definition RPC returned no identifier' })
    return
  }

  const [definition] = await loadConsentDefinitions(session, {
    definitionId,
  })
  if (!definition) {
    throwDbError({ message: 'Created consent definition could not be read' })
    return
  }

  return { data: definition }
})
