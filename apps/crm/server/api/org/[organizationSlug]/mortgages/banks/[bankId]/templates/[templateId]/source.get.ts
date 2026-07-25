import { serverSupabaseServiceRole } from '#supabase/server'
import { useRuntimeConfig } from '#imports'
import { createError, type H3Event } from 'h3'
import {
  mortgageBackofficeUuid,
  throwMortgageBackofficeDbError,
} from '~~/server/utils/mortgage-backoffice'
import {
  mortgageTemplateKey,
  registeredMortgageTemplate,
} from '~~/server/utils/mortgage-document-templates'
import {
  getRequiredParam,
  requireCrmSession,
  requireSuperAdmin,
} from '~~/server/utils/crm'

const maxPdfBytes = 25 * 1024 * 1024

function safeFileName(value: string) {
  return value.replace(/["\\\r\n]/g, '_')
}

function multiformPdfUrl(event: H3Event, templateId: string) {
  const configured = String(useRuntimeConfig(event).multiformServiceUrl || '').trim()
  let base: URL
  try {
    base = new URL(configured)
  }
  catch {
    throw createError({ statusCode: 503, statusMessage: 'Usługa Multiwniosku nie jest skonfigurowana.' })
  }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) {
    throw createError({ statusCode: 503, statusMessage: 'Adres usługi Multiwniosku jest nieprawidłowy.' })
  }
  base.pathname = `${base.pathname.replace(/\/+$/g, '')}/`
  base.search = ''
  base.hash = ''
  return new URL(`api/multiform/demo-pdfs/${encodeURIComponent(templateId)}`, base)
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  await requireSuperAdmin(session)
  const bankId = mortgageBackofficeUuid(getRequiredParam(event, 'bankId'), 'bankId')
  const templateId = mortgageTemplateKey(getRequiredParam(event, 'templateId'))
  const serviceRole = serverSupabaseServiceRole(event) as any
  const { data: bank, error: bankError } = await serviceRole
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

  let response: Response
  try {
    response = await fetch(multiformPdfUrl(event, templateId), {
      headers: { accept: 'application/pdf' },
      redirect: 'error',
    })
  }
  catch {
    throw createError({ statusCode: 502, statusMessage: 'Nie udało się pobrać PDF-u z usługi Multiwniosku.' })
  }
  if (!response.ok) {
    throw createError({
      statusCode: response.status === 404 ? 404 : 502,
      statusMessage: response.status === 404
        ? 'Nie znaleziono źródłowego formularza PDF.'
        : 'Usługa Multiwniosku nie zwróciła poprawnego PDF-u.',
    })
  }
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxPdfBytes) {
    throw createError({ statusCode: 413, statusMessage: 'Źródłowy PDF przekracza limit 25 MB.' })
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > maxPdfBytes) {
    throw createError({ statusCode: 413, statusMessage: 'Źródłowy PDF przekracza limit 25 MB.' })
  }
  if (
    bytes.byteLength < 5
    || bytes[0] !== 0x25
    || bytes[1] !== 0x50
    || bytes[2] !== 0x44
    || bytes[3] !== 0x46
    || bytes[4] !== 0x2D
  ) {
    throw createError({ statusCode: 502, statusMessage: 'Usługa Multiwniosku zwróciła nieprawidłowy PDF.' })
  }

  const fileName = safeFileName(registered.source.fileName)
  setHeader(event, 'Content-Type', 'application/pdf')
  setHeader(event, 'Content-Length', bytes.byteLength)
  setHeader(event, 'Content-Disposition', `inline; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`)
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  return bytes
})
