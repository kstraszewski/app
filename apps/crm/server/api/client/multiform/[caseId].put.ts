import { createError, getRouterParam, readBody, setHeader } from 'h3'
import { saveClientMultiformForm } from '~~/server/utils/client-multiform'

export default defineEventHandler(async (event) => {
  const caseId = getRouterParam(event, 'caseId')
  if (!caseId) throw createError({ statusCode: 404, statusMessage: 'Nie znaleziono formularza.' })
  const body = await readBody(event)
  setHeader(event, 'Cache-Control', 'private, no-store')
  return saveClientMultiformForm(event, caseId, body)
})
