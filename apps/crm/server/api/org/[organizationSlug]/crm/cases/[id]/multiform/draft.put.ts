import { readBody, setHeader } from 'h3'
import {
  saveCaseMultiformDraft,
} from '~~/server/utils/case-multiform-draft'
import {
  caseMultiformSelectionFingerprint,
  parseCaseMultiformDraftPutInput,
} from '~~/server/utils/case-multiform-draft-validation'
import { requireCaseMultiformSelection } from '~~/server/utils/case-multiform'
import { requireCrmSession } from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const selection = await requireCaseMultiformSelection(event)
  const session = await requireCrmSession(event)
  const input = parseCaseMultiformDraftPutInput(await readBody(event))
  const selectionFingerprint = caseMultiformSelectionFingerprint(selection)
  const draft = await saveCaseMultiformDraft(
    session,
    selection.caseId,
    selectionFingerprint,
    input,
  )
  setHeader(event, 'Cache-Control', 'private, no-store')
  return { draft }
})
