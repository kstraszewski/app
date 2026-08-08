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
import { loadMortgageDocumentTemplateSource } from '~~/server/utils/mortgage-document-template-source'
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
  const [bankResult, templateResult] = await Promise.all([
    backendData
      .from('mortgage_banks')
      .select('slug')
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
  const registered = bank
    ? registeredMortgageTemplate(String(bank.slug), templateId)
    : undefined
  if (!registered && !templateResult.data?.source_file_version_id) {
    throw createError({ statusCode: 404, statusMessage: 'Nie znaleziono źródłowego formularza PDF.' })
  }

  const source = await loadMortgageDocumentTemplateSource(
    backendData,
    templateResult.data,
    registered,
  )
  const bytes = source.bytes

  const fileName = safeFileName(source.fileName)
  setHeader(event, 'Content-Type', 'application/pdf')
  setHeader(event, 'Content-Length', bytes.byteLength)
  setHeader(event, 'Content-Disposition', `inline; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`)
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  return bytes
})
