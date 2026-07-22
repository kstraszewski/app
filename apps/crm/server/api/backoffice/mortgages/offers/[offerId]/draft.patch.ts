import { readBody } from 'h3'
import {
  mortgageBackofficeRevision,
  mortgageBackofficeUuid,
  mortgageOfferDraftData,
  requireMortgageBackoffice,
  throwMortgageBackofficeDbError,
} from '~~/server/utils/mortgage-backoffice'
import { asRecord, getRequiredParam } from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const { session, serviceRole } = await requireMortgageBackoffice(event)
  const offerId = mortgageBackofficeUuid(getRequiredParam(event, 'offerId'), 'offerId')
  const body = asRecord(await readBody(event))
  const expectedRevision = mortgageBackofficeRevision(body.expectedRevision)
  const draftData = mortgageOfferDraftData(body.draftData)

  const { data: savedData, error: saveError } = await serviceRole.rpc(
    'save_mortgage_product_draft_v2',
    {
      p_product_id: offerId,
      p_expected_revision: expectedRevision,
      p_draft_data: draftData,
      p_actor_user_id: session.userId,
    },
  )
  throwMortgageBackofficeDbError(saveError)
  const draft = asRecord(savedData)

  return {
    data: {
      id: draft.draftId,
      revision: Number(draft.draftRevision),
      status: 'draft',
      draftData: draft.draftData,
      updatedAt: draft.draftUpdatedAt,
      updatedBy: draft.draftUpdatedBy,
    },
  }
})
