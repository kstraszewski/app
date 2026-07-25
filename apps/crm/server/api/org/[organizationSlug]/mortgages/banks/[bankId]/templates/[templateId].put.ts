import { serverSupabaseServiceRole } from '#supabase/server'
import { createError, readBody } from 'h3'
import {
  mortgageBackofficeRevision,
  mortgageBackofficeUuid,
  throwMortgageBackofficeDbError,
} from '~~/server/utils/mortgage-backoffice'
import {
  mortgageTemplateContentSha256,
  mortgageTemplateKey,
  validateMortgageTemplateForBank,
} from '~~/server/utils/mortgage-document-templates'
import {
  getRequiredParam,
  requireCrmSession,
  requireSuperAdmin,
} from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  await requireSuperAdmin(session)
  const bankId = mortgageBackofficeUuid(getRequiredParam(event, 'bankId'), 'bankId')
  const templateId = mortgageTemplateKey(getRequiredParam(event, 'templateId'))
  const body = await readBody<{ expectedRevision?: unknown, template?: unknown }>(event)
  const expectedRevision = mortgageBackofficeRevision(body?.expectedRevision)
  if (!body || !Object.prototype.hasOwnProperty.call(body, 'template')) {
    throw createError({ statusCode: 400, statusMessage: 'Brak Template JSON do zapisania.' })
  }

  const serviceRole = serverSupabaseServiceRole(event) as any
  const { data: bank, error: bankError } = await serviceRole
    .from('mortgage_banks')
    .select('id, slug')
    .eq('id', bankId)
    .maybeSingle()
  throwMortgageBackofficeDbError(bankError)
  if (!bank) {
    throw createError({ statusCode: 404, statusMessage: 'Nie znaleziono instytucji finansowej.' })
  }

  const { template, validation } = validateMortgageTemplateForBank(
    body.template,
    String(bank.slug),
    templateId,
  )
  const contentSha256 = mortgageTemplateContentSha256(template)
  const { data, error } = await serviceRole.rpc('save_mortgage_document_template_draft', {
    p_bank_id: bankId,
    p_template_key: templateId,
    p_label: template.label,
    p_source_file_name: template.source.fileName,
    p_source_sha256: template.source.sha256,
    p_registry_version: template.version,
    p_template_json: template,
    p_validation_report: {
      ...validation,
      contentSha256,
    },
    p_expected_revision: expectedRevision,
    p_actor_user_id: session.userId,
  })
  throwMortgageBackofficeDbError(error, 'Nie udało się zapisać szkicu Template JSON.')

  setHeader(event, 'Cache-Control', 'private, no-store')
  return {
    data,
    validation,
    contentSha256,
  }
})
