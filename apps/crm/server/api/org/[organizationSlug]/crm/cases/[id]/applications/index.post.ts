import { serverDataBackend } from '~~/server/utils/data-api'
import { createError, readBody } from 'h3'
import type { SavedCaseOffer } from '~~/app/types/cases'
import {
  calculatePropertyOfferComparison,
  getFinancingComparisonBaseline,
} from '~~/app/utils/mortgage-property-comparison'
import {
  assertSupportedFields,
  loadCaseBankApplication,
  loadCaseContractSelection,
  throwBankApplicationDbError,
} from '~~/server/utils/case-bank-applications'
import { assertUuid, requireCrmCase } from '~~/server/utils/case-documents'
import {
  asRecord,
  getRequiredParam,
  recordCrmActivity,
  requireCrmSession,
  requiredText,
  throwDbError,
} from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const caseId = getRequiredParam(event, 'id')
  const body = asRecord(await readBody(event))
  assertSupportedFields(body, ['offer_id', 'property_id'])

  const offerId = requiredText(body.offer_id, 'offer_id')
  assertUuid(offerId, 'offer_id')
  await requireCrmCase(session, caseId)

  if (await loadCaseContractSelection(session, caseId)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'A credit agreement has already been signed for this CRM case',
    })
  }

  let propertyId: string | null = null
  if ('property_id' in body) {
    propertyId = requiredText(body.property_id, 'property_id')
    assertUuid(propertyId, 'property_id')
  }
  else {
    const { data: selection, error: selectionError } = await session.dataApi
      .from('crm_case_property_selections')
      .select('property_id')
      .eq('organization_id', session.organizationId)
      .eq('case_id', caseId)
      .maybeSingle()
    throwDbError(selectionError)
    propertyId = selection?.property_id ? String(selection.property_id) : null
  }

  if (!propertyId) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Select a property before creating a bank application',
    })
  }

  let created
  let error
  let replaySummary: Record<string, unknown> | null = null
  {
    const [offersResult, selectionResult, propertyResult] = await Promise.all([
      session.dataApi
        .from('crm_case_offer_snapshots')
        .select('id, offer_type, currency, loan_amount, scenario_snapshot, catalog_snapshot, calculation_snapshot, saved_at')
        .eq('organization_id', session.organizationId)
        .eq('case_id', caseId)
        .order('saved_at', { ascending: false }),
      session.dataApi
        .from('crm_case_offer_selections')
        .select('offer_id')
        .eq('organization_id', session.organizationId)
        .eq('case_id', caseId)
        .maybeSingle(),
      session.dataApi
        .from('crm_properties')
        .select('id, price_amount, appraisal_value_amount, currency, updated_at')
        .eq('organization_id', session.organizationId)
        .eq('case_id', caseId)
        .eq('id', propertyId)
        .maybeSingle(),
    ])
    throwDbError(offersResult.error)
    throwDbError(selectionResult.error)
    throwDbError(propertyResult.error)
    if (!propertyResult.data) {
      throw createError({ statusCode: 404, statusMessage: 'Property not found in this CRM case' })
    }

    const offers = (offersResult.data ?? []) as Array<Pick<
      SavedCaseOffer,
      'id' | 'offer_type' | 'currency' | 'loan_amount' | 'scenario_snapshot' | 'catalog_snapshot' | 'calculation_snapshot'
    >>
    const targetOffer = offers.find(offer => String(offer.id) === offerId)
    if (!targetOffer) {
      throw createError({ statusCode: 404, statusMessage: 'Saved mortgage offer not found' })
    }
    const baseline = getFinancingComparisonBaseline(
      offers,
      selectionResult.data?.offer_id ? String(selectionResult.data.offer_id) : null,
    )
    if (!baseline) {
      throw createError({ statusCode: 422, statusMessage: 'The financing comparison baseline is incomplete' })
    }

    const comparison = calculatePropertyOfferComparison(
      propertyId,
      {
        purchasePrice: propertyResult.data.price_amount,
        appraisalValue: propertyResult.data.appraisal_value_amount,
        currency: propertyResult.data.currency,
      },
      targetOffer,
      baseline,
    )
    if (
      comparison.status !== 'available'
      || comparison.eligibility !== 'eligible'
      || !comparison.scenarioSnapshot
      || !comparison.calculationSnapshot
    ) {
      throw createError({
        statusCode: 422,
        statusMessage: comparison.status === 'partial'
          ? 'The property or offer is missing data required for a complete mortgage application calculation'
          : 'This property does not meet the frozen mortgage offer rules',
        data: { reasons: comparison.reasons },
      })
    }

    const scenarioSnapshot = structuredClone(comparison.scenarioSnapshot)
    scenarioSnapshot.property = {
      ...asRecord(scenarioSnapshot.property),
      propertyUpdatedAt: String(propertyResult.data.updated_at),
    }
    replaySummary = {
      baseline_offer_id: baseline.offerId,
      net_loan_amount: comparison.netLoanAmount,
      gross_loan_amount: comparison.grossLoanAmount,
      financed_costs: comparison.financedCosts,
      ltv_pct: comparison.ltvPct,
    }
    const backendData = serverDataBackend(event) as any
    const snapshotResult = await backendData.rpc('create_crm_case_bank_application_snapshot', {
      target_organization_id: session.organizationId,
      target_case_id: caseId,
      target_offer_id: offerId,
      target_property_id: propertyId,
      target_actor_user_id: session.userId,
      expected_property_updated_at: String(propertyResult.data.updated_at),
      target_scenario_snapshot: scenarioSnapshot,
      target_calculation_snapshot: comparison.calculationSnapshot,
    })
    created = snapshotResult.data
    error = snapshotResult.error
  }
  throwBankApplicationDbError(error)

  const createdApplication = Array.isArray(created) ? created[0] : created
  const applicationId = String(createdApplication?.submission_id ?? '')
  if (!applicationId) {
    throw createError({ statusCode: 500, statusMessage: 'Bank application was not returned' })
  }
  const data = await loadCaseBankApplication(session, caseId, applicationId)
  if (!data) {
    throw createError({ statusCode: 500, statusMessage: 'Created bank application cannot be loaded' })
  }

  await recordCrmActivity(session, {
    case_id: caseId,
    case_item_id: String(data.case_item_id),
    submission_id: applicationId,
    activity_type: 'mortgage_application_created',
    title: 'Dodano wniosek do banku',
    payload: {
      application_id: applicationId,
      offer_id: offerId,
      bank_id: data.bank_id,
      property_id: propertyId,
      slot: data.slot,
      ...(replaySummary ?? {}),
    },
  })

  return { data }
})
