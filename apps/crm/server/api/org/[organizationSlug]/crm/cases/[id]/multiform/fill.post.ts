import { createError, readBody } from 'h3'
import {
  fillCaseMultiform,
  requireCaseMultiformSelection,
} from '~~/server/utils/case-multiform'

export default defineEventHandler(async (event) => {
  const selection = await requireCaseMultiformSelection(event)
  const body = await readBody<Record<string, unknown>>(event)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Dane formularza są nieprawidłowe.' })
  }
  return fillCaseMultiform(event, selection, {
    values: body.values,
    collectionCounts: body.collectionCounts,
    documentIds: body.documentIds,
  })
})
