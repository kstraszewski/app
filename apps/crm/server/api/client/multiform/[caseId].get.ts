import { createError, getRouterParam, setHeader } from 'h3'
import { loadClientMultiformForm } from '~~/server/utils/client-multiform'

export default defineEventHandler(async (event) => {
  const caseId = getRouterParam(event, 'caseId')
  if (!caseId) throw createError({ statusCode: 404, statusMessage: 'Nie znaleziono formularza.' })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return loadClientMultiformForm(event, caseId)
})
