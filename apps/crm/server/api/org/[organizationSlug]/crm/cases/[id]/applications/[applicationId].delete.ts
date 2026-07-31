import { serverDataBackend } from '~~/server/utils/data-api'
import { createError } from 'h3'
import {
  loadCaseBankApplication,
  loadCaseContractSelection,
} from '~~/server/utils/case-bank-applications'
import { assertUuid, requireCrmCase } from '~~/server/utils/case-documents'
import {
  getRequiredParam,
  recordCrmActivity,
  requireCrmSession,
  throwDbError,
} from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const caseId = getRequiredParam(event, 'id')
  const applicationId = getRequiredParam(event, 'applicationId')
  assertUuid(applicationId, 'application id')
  await requireCrmCase(session, caseId)

  const application = await loadCaseBankApplication(session, caseId, applicationId)
  if (!application) {
    throw createError({ statusCode: 404, statusMessage: 'Bank application not found' })
  }

  const contract = await loadCaseContractSelection(session, caseId)
  if (contract?.application_id === applicationId) {
    throw createError({ statusCode: 409, statusMessage: 'The signed bank application cannot be deleted' })
  }
  if (application.status_code !== 'draft') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Only a draft bank application can be deleted; withdraw a submitted application instead',
    })
  }

  const { data: focused, error: focusError } = await session.dataApi
    .from('crm_case_offer_selections')
    .select('offer_id')
    .eq('organization_id', session.organizationId)
    .eq('case_id', caseId)
    .maybeSingle()
  throwDbError(focusError)
  const wasFocused = String(focused?.offer_id ?? '') === String(application.offer_id)

  // Mortgage-application history cannot be deleted through the browser's
  // Data API. The database permits this server-only path for draft rows after
  // the lifecycle and signed-contract checks above.
  const backendData = serverDataBackend(event) as any
  const { data: deleted, error } = await backendData
    .from('crm_item_submissions')
    .delete()
    .eq('organization_id', session.organizationId)
    .eq('case_item_id', application.case_item_id)
    .eq('id', applicationId)
    .select('id')
    .maybeSingle()
  throwDbError(error)
  if (!deleted) {
    throw createError({ statusCode: 404, statusMessage: 'Bank application not found' })
  }

  if (wasFocused) {
    const { data: nextApplication, error: nextError } = await session.dataApi
      .from('crm_case_bank_applications')
      .select('offer_id')
      .eq('organization_id', session.organizationId)
      .eq('case_id', caseId)
      .order('slot', { ascending: true })
      .limit(1)
      .maybeSingle()
    throwDbError(nextError)

    if (nextApplication) {
      const { error: selectionError } = await session.dataApi
        .from('crm_case_offer_selections')
        .upsert({
          organization_id: session.organizationId,
          case_id: caseId,
          offer_id: nextApplication.offer_id,
          selected_by_user_id: session.userId,
          selected_at: new Date().toISOString(),
        }, { onConflict: 'organization_id,case_id' })
      throwDbError(selectionError)
    }
    else {
      const { error: selectionError } = await session.dataApi
        .from('crm_case_offer_selections')
        .delete()
        .eq('organization_id', session.organizationId)
        .eq('case_id', caseId)
      throwDbError(selectionError)
    }
  }

  await recordCrmActivity(session, {
    case_id: caseId,
    case_item_id: String(application.case_item_id),
    activity_type: 'mortgage_application_deleted',
    title: 'Usunięto roboczy wniosek bankowy',
    payload: {
      application_id: applicationId,
      offer_id: application.offer_id,
      bank_id: application.bank_id,
      slot: application.slot,
    },
  })

  return {
    data: {
      id: applicationId,
      offer_id: application.offer_id,
    },
  }
})
