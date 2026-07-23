import { createHash } from 'node:crypto'
import { getTemplate } from '@openexpert/multiform'
import { DEMO_TEMPLATE_IDS } from '@openexpert/multiform/demo'
import { createError, getRouterParam, setHeader } from 'h3'
import { readMultiformAsset } from '../../../utils/multiform-api'

function quotedFileName(fileName: string) {
  return fileName.replace(/["\\\r\n]/g, '_')
}

const DEMO_TEMPLATE_ID_SET = new Set<string>(DEMO_TEMPLATE_IDS)

export default defineEventHandler(async (event) => {
  const templateId = getRouterParam(event, 'templateId')?.trim()
  const template = templateId && DEMO_TEMPLATE_ID_SET.has(templateId)
    ? getTemplate(templateId)
    : undefined
  if (!template) {
    throw createError({ statusCode: 404, statusMessage: 'Nie znaleziono testowego PDF-u.' })
  }

  const bytes = await readMultiformAsset(
    'assets:multiform-mocks',
    template.source.fileName,
  )
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (sha256 !== template.source.sha256) {
    throw createError({ statusCode: 500, statusMessage: 'Testowy PDF nie przeszedł weryfikacji integralności.' })
  }

  const safeFileName = quotedFileName(template.source.fileName)
  setHeader(event, 'Content-Type', 'application/pdf')
  setHeader(event, 'Content-Length', String(bytes.byteLength))
  setHeader(event, 'Content-Disposition', `inline; filename="${safeFileName}"; filename*=UTF-8''${encodeURIComponent(safeFileName)}`)
  setHeader(event, 'Cache-Control', 'public, max-age=3600')
  setHeader(event, 'ETag', `"${sha256}"`)
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  return bytes
})
