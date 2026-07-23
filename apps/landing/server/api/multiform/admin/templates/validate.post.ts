import { validateTemplateJson } from '@openexpert/multiform'

const maxTemplateBytes = 2 * 1024 * 1024

export default defineEventHandler(async (event) => {
  const contentLength = Number(getRequestHeader(event, 'content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxTemplateBytes) {
    throw createError({
      statusCode: 413,
      statusMessage: 'Template JSON może mieć maksymalnie 2 MB.',
    })
  }

  const body = await readBody<{ template?: unknown }>(event)
  if (!body || !Object.prototype.hasOwnProperty.call(body, 'template')) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Brak pola template do walidacji.',
    })
  }

  const serialized = JSON.stringify(body.template)
  if (new TextEncoder().encode(serialized).byteLength > maxTemplateBytes) {
    throw createError({
      statusCode: 413,
      statusMessage: 'Template JSON może mieć maksymalnie 2 MB.',
    })
  }

  setHeader(event, 'Cache-Control', 'no-store')
  return validateTemplateJson(body.template)
})

