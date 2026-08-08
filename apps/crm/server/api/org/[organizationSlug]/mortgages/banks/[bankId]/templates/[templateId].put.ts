import { serverDataBackend } from '~~/server/utils/data-api'
import { createError, readBody } from 'h3'
import {
  mortgageBackofficeRevision,
  mortgageBackofficeUuid,
  throwMortgageBackofficeDbError,
} from '~~/server/utils/mortgage-backoffice'
import {
  mortgageTemplateContentSha256,
  mortgageTemplateKey,
  registeredMortgageTemplate,
  validateMortgageTemplateForBank,
} from '~~/server/utils/mortgage-document-templates'
import { mortgageDocumentTemplateSourceDescriptor } from '~~/server/utils/mortgage-document-template-source'
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

  const backendData = serverDataBackend(event) as any
  const [bankResult, templateResult] = await Promise.all([
    backendData
      .from('mortgage_banks')
      .select('id, slug')
      .eq('id', bankId)
      .maybeSingle(),
    backendData
      .from('mortgage_document_templates')
      .select('source_file_id, source_file_version_id, source_file_name, source_sha256')
      .eq('bank_id', bankId)
      .eq('template_key', templateId)
      .maybeSingle(),
  ])
  const { data: bank, error: bankError } = bankResult
  throwMortgageBackofficeDbError(bankError)
  throwMortgageBackofficeDbError(templateResult.error)
  if (!bank) {
    throw createError({ statusCode: 404, statusMessage: 'Nie znaleziono instytucji finansowej.' })
  }

  const bankSlug = String(bank.slug)
  const registered = registeredMortgageTemplate(bankSlug, templateId)
  const { template, validation } = validateMortgageTemplateForBank(
    body.template,
    bankSlug,
    templateId,
    mortgageDocumentTemplateSourceDescriptor(bankSlug, templateResult.data, registered),
  )
  const contentSha256 = mortgageTemplateContentSha256(template)
  const { data, error } = await backendData.rpc('save_mortgage_document_template_draft', {
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
