import { createError, readBody } from 'h3'
import {
  fillCaseMultiformDocument,
  requireCaseMultiformSelection,
} from '~~/server/utils/case-multiform'

export default defineEventHandler(async (event) => {
  const selection = await requireCaseMultiformSelection(event)
  const templateId = getRouterParam(event, 'templateId')?.trim()
  if (!templateId) {
    throw createError({ statusCode: 400, statusMessage: 'Brakuje identyfikatora formularza.' })
  }
  const body = await readBody<Record<string, unknown>>(event)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Dane formularza są nieprawidłowe.' })
  }
  const variant = body.variant === 'blank' ? 'blank' : 'filled'
  return fillCaseMultiformDocument(event, selection, {
    templateId,
    variant,
    values: body.values,
    collectionCounts: body.collectionCounts,
  })
})
