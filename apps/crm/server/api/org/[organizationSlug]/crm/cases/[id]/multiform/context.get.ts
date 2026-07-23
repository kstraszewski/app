import {
  loadCaseMultiformContext,
  requireCaseMultiformSelection,
} from '~~/server/utils/case-multiform'

export default defineEventHandler(async (event) => {
  const selection = await requireCaseMultiformSelection(event)
  return loadCaseMultiformContext(event, selection)
})
