import { serverDataBackend } from '~~/server/utils/data-api'
import { createError, readBody } from 'h3'
import {
  mortgageBackofficeRevision,
  mortgageBackofficeUuid,
  throwMortgageBackofficeDbError,
} from '~~/server/utils/mortgage-backoffice'
import {
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
  const body = await readBody<{ expectedRevision?: unknown }>(event)
  const expectedRevision = mortgageBackofficeRevision(body?.expectedRevision)
  const backendData = serverDataBackend(event) as any

  const [bankResult, templateResult] = await Promise.all([
    backendData
      .from('mortgage_banks')
      .select('id, slug')
      .eq('id', bankId)
      .maybeSingle(),
    backendData
      .from('mortgage_document_templates')
      .select('draft_json, draft_revision')
      .eq('bank_id', bankId)
      .eq('template_key', templateId)
      .maybeSingle(),
  ])
  throwMortgageBackofficeDbError(bankResult.error)
  throwMortgageBackofficeDbError(templateResult.error)
  if (!bankResult.data) {
    throw createError({ statusCode: 404, statusMessage: 'Nie znaleziono instytucji finansowej.' })
  }
  if (!templateResult.data?.draft_json) {
    throw createError({ statusCode: 404, statusMessage: 'Nie ma szkicu do opublikowania.' })
  }
  if (Number(templateResult.data.draft_revision) !== expectedRevision) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Szkic zmienił się w innej sesji. Odśwież edytor.',
    })
  }

  const { validation } = validateMortgageTemplateForBank(
    templateResult.data.draft_json,
    String(bankResult.data.slug),
    templateId,
  )
  if (!validation.summary.activationReady) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Template nie jest gotowy do aktywacji. Zatwierdź wszystkie mapowania i pokrycie PDF-u.',
      data: { validation },
    })
  }

  const { data, error } = await backendData.rpc('publish_mortgage_document_template_draft', {
    p_bank_id: bankId,
    p_template_key: templateId,
    p_expected_revision: expectedRevision,
    p_actor_user_id: session.userId,
  })
  throwMortgageBackofficeDbError(error, 'Nie udało się opublikować Template JSON.')

  setHeader(event, 'Cache-Control', 'private, no-store')
  return { data, validation }
})
