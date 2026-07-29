import { useRuntimeConfig } from '#imports'
import { createError, readMultipartFormData } from 'h3'
import {
  ingestMortgageBankFile,
  mortgageBankFileMaximumBytes,
  mortgageBankFileOptionalUuid,
  mortgageBankFileTitleFromName,
  mortgageBankFileUuid,
  requireMortgageBankFileAdmin,
} from '~~/server/utils/mortgage-bank-files'

function fieldValue(parts: Awaited<ReturnType<typeof readMultipartFormData>>, name: string) {
  const part = parts?.find(item => item.name === name && !item.filename)
  return part ? Buffer.from(part.data).toString('utf8').trim() : null
}

export default defineEventHandler(async (event) => {
  const { session, serviceRole } = await requireMortgageBankFileAdmin(event)
  const parts = await readMultipartFormData(event)
  if (!parts?.length) {
    throw createError({ statusCode: 400, statusMessage: 'Multipart form data is required' })
  }

  const bankId = mortgageBankFileUuid(fieldValue(parts, 'bankId'), 'bankId')
  const categoryId = mortgageBankFileOptionalUuid(fieldValue(parts, 'categoryId'), 'categoryId')
  const productId = mortgageBankFileOptionalUuid(fieldValue(parts, 'productId'), 'productId')
  const sourcePageUrl = fieldValue(parts, 'sourcePageUrl')
  const effectiveFrom = fieldValue(parts, 'effectiveFrom')
  const effectiveTo = fieldValue(parts, 'effectiveTo')
  const titleOverride = fieldValue(parts, 'title')
  const files = parts.filter(part => part.name === 'files' && part.filename)

  if (!files.length || files.length > 8) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Upload between 1 and 8 bank files at once',
    })
  }
  if (files.some(file => !file.data.byteLength || file.data.byteLength > mortgageBankFileMaximumBytes)) {
    throw createError({ statusCode: 413, statusMessage: 'A bank file exceeds the size limit' })
  }

  const runtimeConfig = useRuntimeConfig(event)
  const results = []
  for (const file of files) {
    const fileName = String(file.filename)
    const mimeType = String(file.type || 'application/octet-stream').toLowerCase()
    const title = files.length === 1 && titleOverride
      ? titleOverride
      : mortgageBankFileTitleFromName(fileName)

    results.push(await ingestMortgageBankFile(serviceRole, {
      bankId,
      title,
      categoryId,
      productId,
      sourcePageUrl,
      effectiveFrom,
      effectiveTo,
      originalFileName: fileName,
      mimeType,
      bytes: new Uint8Array(file.data),
      actorUserId: session.userId,
      googleApiKey: String(runtimeConfig.googleGenerativeAiApiKey || ''),
    }))
  }

  return {
    uploaded: results.length,
    results,
  }
})
