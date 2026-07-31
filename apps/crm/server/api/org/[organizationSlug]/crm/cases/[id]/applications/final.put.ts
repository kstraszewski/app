import { createError, readBody } from 'h3'
import {
  assertSupportedFields,
  loadCaseBankApplication,
  throwBankApplicationDbError,
} from '~~/server/utils/case-bank-applications'
import { assertUuid, requireCrmCase } from '~~/server/utils/case-documents'
import {
  asRecord,
  getRequiredParam,
  recordCrmActivity,
  requireCrmSession,
  requiredText,
} from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const caseId = getRequiredParam(event, 'id')
  const body = asRecord(await readBody(event))
  assertSupportedFields(body, ['application_id'])

  const applicationId = requiredText(body.application_id, 'application_id')
  assertUuid(applicationId, 'application_id')
  await requireCrmCase(session, caseId)

  const application = await loadCaseBankApplication(session, caseId, applicationId)
  if (!application) {
    throw createError({ statusCode: 404, statusMessage: 'Bank application not found' })
  }
  if (application.status_code !== 'zaakceptowane') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Only an accepted bank application can be signed',
    })
  }

  const { data, error } = await session.dataApi.rpc('sign_crm_case_contract', {
    target_organization_id: session.organizationId,
    target_case_id: caseId,
    target_application_id: applicationId,
  })
  throwBankApplicationDbError(error)
  const contract = Array.isArray(data) ? data[0] : data
  if (!contract) {
    throw createError({ statusCode: 500, statusMessage: 'Signed contract was not returned' })
  }

  await recordCrmActivity(session, {
    case_id: caseId,
    case_item_id: String(application.case_item_id),
    submission_id: applicationId,
    activity_type: 'mortgage_contract_signed',
    title: 'Podpisano umowę kredytową',
    payload: {
      application_id: applicationId,
      offer_id: application.offer_id,
      bank_id: application.bank_id,
      property_id: application.property_id,
    },
  })

  return { data: contract }
})
