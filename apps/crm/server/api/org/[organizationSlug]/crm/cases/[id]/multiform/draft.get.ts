import { setHeader } from 'h3'
import { loadCaseMultiformDraft } from '~~/server/utils/case-multiform-draft'
import { caseMultiformSelectionFingerprint } from '~~/server/utils/case-multiform-draft-validation'
import { requireCaseMultiformSelection } from '~~/server/utils/case-multiform'
import { requireCrmSession } from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const selection = await requireCaseMultiformSelection(event)
  const session = await requireCrmSession(event)
  const selectionFingerprint = caseMultiformSelectionFingerprint(selection)
  const draft = await loadCaseMultiformDraft(session, selection.caseId)
  setHeader(event, 'Cache-Control', 'private, no-store')
  return { selectionFingerprint, draft }
})
