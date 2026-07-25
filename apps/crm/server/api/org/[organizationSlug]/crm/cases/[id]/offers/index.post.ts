import {
  calculateMortgageCatalogVersion,
  type InstallmentType,
  type OverpaymentStrategy,
} from '@openexpert/mortgage'
import { serverSupabaseServiceRole } from '#supabase/server'
import { createError, readBody } from 'h3'
import { caseUuidPattern } from '~~/server/utils/case-identifiers'
import {
  asRecord,
  getRequiredParam,
  requireCrmSession,
  requiredText,
  throwDbError,
} from '~~/server/utils/crm'
import {
  isMortgageCalculationShortlistable,
  mortgageCalculationSnapshot,
} from '~~/server/utils/mortgage-case-offers'
import { loadMortgageCatalog } from '~~/server/utils/mortgage-catalog'

function finiteNumber(
  input: unknown,
  field: string,
  options: { min?: number, max?: number, integer?: boolean } = {},
): number {
  const value = typeof input === 'number' ? input : Number(input)
  if (
    !Number.isFinite(value)
    || (options.integer && !Number.isInteger(value))
    || (options.min !== undefined && value < options.min)
    || (options.max !== undefined && value > options.max)
  ) {
    throw createError({ statusCode: 400, statusMessage: `${field} is invalid` })
  }
  return value
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const caseId = getRequiredParam(event, 'id')
  const body = asRecord(await readBody(event))
  const productId = requiredText(body.source_product_id, 'source_product_id')
  if (!caseUuidPattern.test(productId)) {
    throw createError({ statusCode: 400, statusMessage: 'source_product_id must be a UUID' })
  }

  const { data: caseRow, error: caseError } = await session.supabase
    .from('crm_cases')
    .select('id')
    .eq('organization_id', session.organizationId)
    .eq('id', caseId)
    .maybeSingle()
  throwDbError(caseError)
  if (!caseRow) throw createError({ statusCode: 404, statusMessage: 'Case not found' })

  const scenarioInput = asRecord(body.scenario)
  const installmentType = String(scenarioInput.installmentType ?? '')
  if (!['equal', 'decreasing'].includes(installmentType)) {
    throw createError({ statusCode: 400, statusMessage: 'installmentType is invalid' })
  }
  const overpaymentStrategy = String(scenarioInput.overpaymentStrategy ?? 'shorten_term')
  if (!['shorten_term', 'lower_payment'].includes(overpaymentStrategy)) {
    throw createError({ statusCode: 400, statusMessage: 'overpaymentStrategy is invalid' })
  }
  const rawSelectionEvents = scenarioInput.selectionEvents ?? []
  if (!Array.isArray(rawSelectionEvents) || rawSelectionEvents.length > 100) {
    throw createError({ statusCode: 400, statusMessage: 'selectionEvents must be a list with at most 100 entries' })
  }

  const scenario = {
    propertyValue: finiteNumber(scenarioInput.propertyValue, 'propertyValue', { min: 1, max: 1_000_000_000 }),
    appraisalValue: scenarioInput.appraisalValue == null || scenarioInput.appraisalValue === ''
      ? null
      : finiteNumber(scenarioInput.appraisalValue, 'appraisalValue', { min: 1, max: 1_000_000_000 }),
    loanAmount: finiteNumber(scenarioInput.loanAmount, 'loanAmount', { min: 1, max: 1_000_000_000 }),
    years: finiteNumber(scenarioInput.years, 'years', { min: 1, max: 50, integer: true }),
    installmentType: installmentType as InstallmentType,
    referenceDelta: finiteNumber(scenarioInput.referenceDelta ?? 0, 'referenceDelta', { min: -20, max: 20 }),
    monthlyOverpayment: finiteNumber(scenarioInput.monthlyOverpayment ?? 0, 'monthlyOverpayment', { min: 0, max: 1_000_000_000 }),
    overpaymentStrategy: overpaymentStrategy as OverpaymentStrategy,
    mortgageRegistrationMonth: finiteNumber(scenarioInput.mortgageRegistrationMonth ?? 0, 'mortgageRegistrationMonth', { min: 0, max: 600, integer: true }),
    financeCommission: scenarioInput.financeCommission !== false,
    selections: Object.fromEntries(Object.entries(asRecord(scenarioInput.selections)).map(([featureId, optionId]) => {
      if (!/^[a-zA-Z0-9._-]{1,120}$/.test(featureId) || typeof optionId !== 'string' || !/^[a-zA-Z0-9._-]{1,120}$/.test(optionId)) {
        throw createError({ statusCode: 400, statusMessage: 'selections contains an invalid feature option' })
      }
      return [featureId, optionId]
    })),
    selectionEvents: rawSelectionEvents.map((rawEvent, index) => {
      const selectionEvent = asRecord(rawEvent)
      const featureId = String(selectionEvent.featureId ?? '')
      const optionId = String(selectionEvent.optionId ?? '')
      if (!/^[a-zA-Z0-9._-]{1,120}$/.test(featureId) || !/^[a-zA-Z0-9._-]{1,120}$/.test(optionId)) {
        throw createError({ statusCode: 400, statusMessage: `selectionEvents[${index}] has an invalid feature option` })
      }
      return {
        month: finiteNumber(selectionEvent.month, `selectionEvents[${index}].month`, { min: 1, max: 600, integer: true }),
        featureId,
        optionId,
      }
    }),
  }

  const catalog = await loadMortgageCatalog(session)
  const product = catalog.products.find(item => String(item.id) === productId)
  if (!product) throw createError({ statusCode: 404, statusMessage: 'Mortgage product not found' })

  const version = asRecord(product.version)
  const baseVersion = asRecord(product.baseVersion)
  const bank = asRecord(product.bank)
  const override = asRecord(product.override)
  const bankOverride = asRecord(bank.override)
  const requestedVersionKey = requiredText(body.source_version_key, 'source_version_key')
  const requestedRevision = asRecord(body.catalog_revision)
  const currentProductRevision = Number(override.revision ?? 0)
  const currentBankRevision = Number(bankOverride.revision ?? 0)
  if (
    requestedVersionKey !== String(version.version_key ?? '')
    || Number(requestedRevision.product ?? 0) !== currentProductRevision
    || Number(requestedRevision.bank ?? 0) !== currentBankRevision
  ) {
    throw createError({
      statusCode: 409,
      statusMessage: 'The mortgage catalogue changed. Refresh the comparison before saving.',
    })
  }

  const n = (value: unknown) => value == null ? null : Number(value)
  const calculation = calculateMortgageCatalogVersion(version, scenario)
  const stress = calculateMortgageCatalogVersion(version, scenario, 2)
  const termMonths = scenario.years * 12
  const maxLtv = n(version.max_ltv_pct)
  const isV2 = Number(version.calculator_schema_version ?? 1) >= 2
    && asRecord(version.offer_definition).schemaVersion === 'openexpert.mortgage-offer/2.0'
  const legacyLimitsEligible = isV2 || ((n(version.min_amount) === null || scenario.loanAmount >= n(version.min_amount)!)
    && (n(version.max_amount) === null || scenario.loanAmount <= n(version.max_amount)!)
    && (n(version.min_term_months) === null || termMonths >= n(version.min_term_months)!)
    && (n(version.max_term_months) === null || termMonths <= n(version.max_term_months)!)
    && (maxLtv === null || calculation.ltvPct <= maxLtv))
  if (!isMortgageCalculationShortlistable(calculation.status, legacyLimitsEligible)) {
    throw createError({
      statusCode: 422,
      statusMessage: calculation.status === 'ineligible' || !legacyLimitsEligible
        ? 'The scenario does not meet this mortgage offer eligibility rules.'
        : 'The mortgage offer configuration cannot be calculated.',
      data: { issues: calculation.issues },
    })
  }

  // Persist frozen offer snapshots only through the authenticated server
  // route. Direct Data API inserts are revoked at the database level so a
  // browser cannot replace the catalogue payload that will later be replayed
  // for a bank application.
  const serviceRole = serverSupabaseServiceRole(event) as any
  const { data, error } = await serviceRole
    .from('crm_case_offer_snapshots')
    .insert({
      organization_id: session.organizationId,
      case_id: caseId,
      bank_id: bank.id ?? null,
      mortgage_product_id: product.id,
      mortgage_product_version_id: baseVersion.id ?? null,
      saved_by_user_id: session.userId,
      offer_type: 'mortgage',
      bank_name: String(bank.name ?? 'Bank'),
      product_name: String(product.name ?? 'Kredyt hipoteczny'),
      version_key: String(version.version_key ?? ''),
      calculator_version: calculation.engineVersion,
      currency: 'PLN',
      loan_amount: scenario.loanAmount,
      first_installment: calculation.firstInstallment,
      first_monthly_outflow: calculation.firstTotalOutflow,
      cost_first_five_years: calculation.costFirstFiveYears,
      total_cost: calculation.totalCost,
      representative_apr_pct: n(version.representative_apr_pct),
      scenario_snapshot: scenario,
      catalog_snapshot: product,
      calculation_snapshot: mortgageCalculationSnapshot(
        calculation.raw as unknown as Record<string, unknown>,
        calculation.status,
        calculation.issues,
      ),
      stress_snapshot: mortgageCalculationSnapshot(
        stress.raw as unknown as Record<string, unknown>,
        stress.status,
        stress.issues,
      ),
    })
    .select('id, case_id, bank_id, mortgage_product_id, mortgage_product_version_id, offer_type, bank_name, product_name, version_key, calculator_version, currency, loan_amount, first_installment, first_monthly_outflow, cost_first_five_years, total_cost, representative_apr_pct, scenario_snapshot, catalog_snapshot, calculation_snapshot, saved_at')
    .single()
  throwDbError(error)
  return { data: { ...data, calculation_status: calculation.status } }
})
