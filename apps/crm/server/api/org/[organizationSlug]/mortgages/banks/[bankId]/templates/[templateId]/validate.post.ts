import { validateTemplateJson } from '@openexpert/multiform'
import { createError, readBody } from 'h3'
import {
  mortgageTemplateJsonBytes,
  mortgageTemplateKey,
} from '~~/server/utils/mortgage-document-templates'
import {
  getRequiredParam,
  requireCrmSession,
  requireSuperAdmin,
} from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  await requireSuperAdmin(session)
  mortgageTemplateKey(getRequiredParam(event, 'templateId'))
  const body = await readBody<{ template?: unknown }>(event)
  if (!body || !Object.prototype.hasOwnProperty.call(body, 'template')) {
    throw createError({ statusCode: 400, statusMessage: 'Brak Template JSON do walidacji.' })
  }

  mortgageTemplateJsonBytes(body.template)
  setHeader(event, 'Cache-Control', 'private, no-store')
  return validateTemplateJson(body.template)
})
