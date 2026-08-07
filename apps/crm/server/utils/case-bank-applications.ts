import { createError, type H3Event } from 'h3'
import { serverDataBackend } from './data-api'
import {
  isMortgageApplicationStatus,
  mortgageApplicationStatuses,
  type MortgageApplicationStatus,
} from './case-bank-application-status'
import { throwDbError, type CrmSession } from './crm'

const applicationSelect = [
  'submission_id',
  'organization_id',
  'case_id',
  'case_item_id',
  'offer_id',
  'bank_id',
  'property_id',
  'slot',
  'created_by_user_id',
  'created_at',
  'snapshot_status',
  'snapshot_schema_version',
  'calculator_version',
  'comparison_baseline_offer_id',
  'scenario_snapshot',
  'calculation_snapshot',
  'purchase_price_amount',
  'appraisal_value_amount',
  'net_loan_amount',
  'gross_loan_amount',
  'financed_costs',
  'ltv_debt_basis',
  'collateral_value_basis',
  'ltv_debt_amount',
  'collateral_value_amount',
  'ltv_pct',
  'first_installment',
  'first_monthly_outflow',
  'cost_first_five_years',
  'total_cost',
  'calculated_at',
].join(', ')

const submissionSelect = [
  'id',
  'case_item_id',
  'status_code',
  'external_reference',
  'submitted_at',
  'decision_at',
  'offered_amount',
  'currency',
  'notes',
  'metadata',
  'created_at',
  'updated_at',
].join(', ')

export function mortgageApplicationStatus(input: unknown): MortgageApplicationStatus {
  if (!isMortgageApplicationStatus(input)) {
    throw createError({
      statusCode: 400,
      statusMessage: `status_code must be one of: ${mortgageApplicationStatuses.join(', ')}`,
    })
  }
  return input as MortgageApplicationStatus
}

export function assertSupportedFields(
  body: Record<string, unknown>,
  allowedFields: readonly string[],
): void {
  const allowed = new Set(allowedFields)
  const unsupported = Object.keys(body).filter(field => !allowed.has(field))
  if (unsupported.length) {
    throw createError({
      statusCode: 400,
      statusMessage: `Unsupported fields: ${unsupported.join(', ')}`,
    })
  }
}

export function throwBankApplicationDbError(
  error: { message?: string, code?: string } | null | undefined,
): void {
  if (!error) return
  const code = String(error.code ?? '')
  if (code === 'P0002') {
    throw createError({ statusCode: 404, statusMessage: error.message || 'Bank application not found' })
  }
  if (code === '23505' || code === '23514' || code === '40001') {
    throw createError({ statusCode: 409, statusMessage: error.message || 'Bank application conflict' })
  }
  throwDbError(error)
}

export async function loadCaseBankApplication(
  session: CrmSession,
  caseId: string,
  applicationId: string,
): Promise<Record<string, unknown> | null> {
  const { data: application, error: applicationError } = await session.dataApi
    .from('crm_case_bank_applications')
    .select(applicationSelect)
    .eq('organization_id', session.organizationId)
    .eq('case_id', caseId)
    .eq('submission_id', applicationId)
    .maybeSingle()
  throwDbError(applicationError)
  if (!application) return null

  const { data: submission, error: submissionError } = await session.dataApi
    .from('crm_item_submissions')
    .select(submissionSelect)
    .eq('organization_id', session.organizationId)
    .eq('case_item_id', application.case_item_id)
    .eq('id', application.submission_id)
    .maybeSingle()
  throwDbError(submissionError)
  if (!submission) {
    throw createError({ statusCode: 500, statusMessage: 'Bank application submission is missing' })
  }

  return {
    id: application.submission_id,
    ...application,
    status_code: submission.status_code,
    external_reference: submission.external_reference,
    submitted_at: submission.submitted_at,
    decision_at: submission.decision_at,
    offered_amount: submission.offered_amount,
    currency: submission.currency,
    notes: submission.notes,
    metadata: submission.metadata,
    submission_created_at: submission.created_at,
    updated_at: submission.updated_at,
  }
}

export async function createDraftCaseBankApplication(
  event: H3Event,
  session: CrmSession,
  caseId: string,
  offerId: string,
): Promise<Record<string, unknown>> {
  const backendData = serverDataBackend(event) as any
  const { data: created, error } = await backendData.rpc('create_crm_case_bank_application', {
    target_organization_id: session.organizationId,
    target_case_id: caseId,
    target_offer_id: offerId,
    target_property_id: null,
  })
  throwBankApplicationDbError(error)

  const createdApplication = Array.isArray(created) ? created[0] : created
  const applicationId = String(createdApplication?.submission_id ?? '')
  if (!applicationId) {
    throw createError({ statusCode: 500, statusMessage: 'Bank application was not returned' })
  }

  const application = await loadCaseBankApplication(session, caseId, applicationId)
  if (!application) {
    throw createError({ statusCode: 500, statusMessage: 'Created bank application cannot be loaded' })
  }
  return application
}

export async function loadCaseContractSelection(
  session: CrmSession,
  caseId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await session.dataApi
    .from('crm_case_contract_selections')
    .select('application_id, signed_by_user_id, signed_at')
    .eq('organization_id', session.organizationId)
    .eq('case_id', caseId)
    .maybeSingle()
  throwDbError(error)
  return data ?? null
}
