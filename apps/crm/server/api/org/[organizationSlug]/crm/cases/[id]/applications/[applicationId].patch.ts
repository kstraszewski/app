import { createError, readBody } from 'h3'
import {
  assertSupportedFields,
  loadCaseBankApplication,
  loadCaseContractSelection,
  mortgageApplicationStatus,
} from '~~/server/utils/case-bank-applications'
import { mortgageSubmissionStatusPatch } from '~~/server/utils/case-bank-application-status'
import { assertUuid, requireCrmCase } from '~~/server/utils/case-documents'
import {
  asRecord,
  getRequiredParam,
  recordCrmActivity,
  requireCrmSession,
  throwDbError,
} from '~~/server/utils/crm'

function notesValue(input: unknown): string | null {
  if (input === null || input === '') return null
  if (typeof input !== 'string' || input.trim().length > 5_000) {
    throw createError({ statusCode: 400, statusMessage: 'notes must be text up to 5000 characters or null' })
  }
  return input.trim() || null
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const caseId = getRequiredParam(event, 'id')
  const applicationId = getRequiredParam(event, 'applicationId')
  assertUuid(applicationId, 'application id')
  await requireCrmCase(session, caseId)

  const body = asRecord(await readBody(event))
  assertSupportedFields(body, ['status_code', 'notes'])
  const statusCode = mortgageApplicationStatus(body.status_code)

  const current = await loadCaseBankApplication(session, caseId, applicationId)
  if (!current) {
    throw createError({ statusCode: 404, statusMessage: 'Bank application not found' })
  }
  if (await loadCaseContractSelection(session, caseId)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'A signed credit process cannot be changed',
    })
  }
  const patch = mortgageSubmissionStatusPatch(current, statusCode)
  if ('notes' in body) patch.notes = notesValue(body.notes)

  const { data: updated, error } = await session.dataApi
    .from('crm_item_submissions')
    .update(patch)
    .eq('organization_id', session.organizationId)
    .eq('case_item_id', current.case_item_id)
    .eq('id', applicationId)
    .select('id')
    .maybeSingle()
  throwDbError(error)
  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: 'Bank application not found' })
  }

  const data = await loadCaseBankApplication(session, caseId, applicationId)
  if (!data) {
    throw createError({ statusCode: 500, statusMessage: 'Updated bank application cannot be loaded' })
  }

  await recordCrmActivity(session, {
    case_id: caseId,
    case_item_id: String(current.case_item_id),
    submission_id: applicationId,
    activity_type: 'mortgage_application_status_changed',
    title: 'Zmieniono status wniosku bankowego',
    body: typeof patch.notes === 'string' ? patch.notes : undefined,
    payload: {
      application_id: applicationId,
      previous_status_code: current.status_code,
      status_code: statusCode,
    },
  })

  return { data }
})
