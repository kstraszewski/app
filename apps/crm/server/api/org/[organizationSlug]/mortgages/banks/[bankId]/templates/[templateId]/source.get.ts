import { serverDataBackend } from '~~/server/utils/data-api'
import { createError } from 'h3'
import {
  mortgageBackofficeUuid,
  throwMortgageBackofficeDbError,
} from '~~/server/utils/mortgage-backoffice'
import {
  mortgageTemplateKey,
  registeredMortgageTemplate,
} from '~~/server/utils/mortgage-document-templates'
import {
  normalizeMortgageTemplatePdfAsset,
  validateMortgageTemplatePdf,
} from '~~/server/utils/mortgage-template-source'
import {
  getRequiredParam,
  requireCrmSession,
  requireSuperAdmin,
} from '~~/server/utils/crm'

function safeFileName(value: string) {
  return value.replace(/["\\\r\n]/g, '_')
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  await requireSuperAdmin(session)
  const bankId = mortgageBackofficeUuid(getRequiredParam(event, 'bankId'), 'bankId')
  const templateId = mortgageTemplateKey(getRequiredParam(event, 'templateId'))
  const backendData = serverDataBackend(event) as any
  const { data: bank, error: bankError } = await backendData
    .from('mortgage_banks')
    .select('slug')
    .eq('id', bankId)
    .maybeSingle()
  throwMortgageBackofficeDbError(bankError)
  const registered = bank
    ? registeredMortgageTemplate(String(bank.slug), templateId)
    : undefined
  if (!registered) {
    throw createError({ statusCode: 404, statusMessage: 'Nie znaleziono źródłowego formularza PDF.' })
  }

  const rawAsset = await useStorage('assets:mortgage-template-pdfs')
    .getItemRaw(registered.source.fileName)
  const bytes = normalizeMortgageTemplatePdfAsset(rawAsset)
  if (!bytes) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Źródłowy formularz PDF nie został dołączony do wdrożenia CRM.',
    })
  }

  const validation = validateMortgageTemplatePdf(bytes, registered.source.sha256)
  if (!validation.valid) {
    if (validation.reason === 'too_large') {
      throw createError({ statusCode: 413, statusMessage: 'Źródłowy PDF przekracza limit 25 MB.' })
    }
    throw createError({
      statusCode: 500,
      statusMessage: validation.reason === 'checksum_mismatch'
        ? 'Źródłowy PDF nie przeszedł weryfikacji integralności.'
        : 'Źródłowy formularz nie jest poprawnym plikiem PDF.',
    })
  }

  const fileName = safeFileName(registered.source.fileName)
  setHeader(event, 'Content-Type', 'application/pdf')
  setHeader(event, 'Content-Length', bytes.byteLength)
  setHeader(event, 'Content-Disposition', `inline; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`)
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  return bytes
})
