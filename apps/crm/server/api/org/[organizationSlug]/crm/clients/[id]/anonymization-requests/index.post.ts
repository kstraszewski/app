import { readBody, setHeader } from 'h3'
import {
  parseClientAnonymizationRequestCreateInput,
  throwClientAnonymizationRequestDbError,
} from '~~/server/utils/client-anonymization-requests'
import {
  getRequiredParam,
  requireCrmSession,
} from '~~/server/utils/crm'
import { uuidValue } from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const clientId = uuidValue(getRequiredParam(event, 'id'), 'id')
  const input = parseClientAnonymizationRequestCreateInput(
    await readBody(event),
  )

  setHeader(event, 'Cache-Control', 'private, no-store')

  const { data, error } = await session.dataApi.rpc(
    'create_crm_client_anonymization_request',
    {
      p_organization_id: session.organizationId,
      p_client_id: clientId,
      p_subject_person_id: input.subjectPersonId,
      p_request_channel: input.requestChannel,
      p_requested_at: input.requestedAt,
      p_justification: input.justification,
      p_idempotency_key: input.idempotencyKey,
    },
  )
  throwClientAnonymizationRequestDbError(error)

  return data
})
