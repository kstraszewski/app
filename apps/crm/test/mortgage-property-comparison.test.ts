import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateMortgageCatalogVersion,
  type MortgageOfferVersionV2,
} from '@openexpert/mortgage'
import type { SavedCaseOffer } from '../app/types/cases.ts'
import {
  calculatePropertyOfferComparison,
  getFinancingComparisonBaseline,
} from '../app/utils/mortgage-property-comparison.ts'

function offer(
  id: string,
  overrides: {
    currency?: string
    scenario?: Record<string, unknown>
    version?: Record<string, unknown>
  } = {},
): SavedCaseOffer {
  return {
    id,
    case_id: 'case-1',
    bank_id: `bank-${id}`,
    mortgage_product_id: `product-${id}`,
    mortgage_product_version_id: `version-${id}`,
    offer_type: 'mortgage',
    bank_name: `Bank ${id}`,
    product_name: `Hipoteka ${id}`,
    version_key: `version-key-${id}`,
    calculator_version: 'openexpert-mortgage-v1',
    currency: overrides.currency ?? 'PLN',
    loan_amount: 480_000,
    first_installment: null,
    first_monthly_outflow: null,
    cost_first_five_years: null,
    total_cost: null,
    representative_apr_pct: null,
    scenario_snapshot: {
      propertyValue: 600_000,
      loanAmount: 480_000,
      years: 25,
      installmentType: 'equal',
      referenceDelta: 0,
      monthlyOverpayment: 0,
      overpaymentStrategy: 'shorten_term',
      ...overrides.scenario,
    },
    catalog_snapshot: {
      version: {
        fixed_rate_pct: 6,
        fixed_period_months: 60,
        margin_pct: 2,
        reference_rate_pct: 4,
        min_amount: 100_000,
        max_amount: 1_000_000,
        min_term_months: 60,
        max_term_months: 420,
        max_ltv_pct: 80,
        cost_rules: {
          accountMonthlyFee: 10,
          propertyInsuranceAnnualRatePct: 0.1,
        },
        ...overrides.version,
      },
    },
    saved_at: '2026-07-21T12:00:00.000Z',
  }
}

function integratedV2Offer(): MortgageOfferVersionV2 {
  return {
    schemaVersion: 'openexpert.mortgage-offer/2.0',
    currency: 'PLN',
    validity: { effectiveFrom: '2026-07-01', effectiveTo: null, pricingAsOf: '2026-07-01' },
    calculationPolicy: {
      accrual: 'nominal_monthly_12',
      eventOrder: 'openexpert_v2',
      rounding: {
        currencyScale: 2,
        interest: 'half_up_each_period',
        charges: 'half_up_each_charge',
        balance: 'rounded',
      },
    },
    eligibility: {
      minAmount: '100000.00',
      maxAmount: '1000000.00',
      amountBasis: 'gross_loan',
      minTermMonths: 60,
      maxTermMonths: 420,
      allowedInstallmentTypes: ['equal'],
      maxLtvPct: '90.00000',
      ltvDebtBasis: 'gross_loan',
      collateralValueBasis: 'purchase_price',
    },
    ratePlan: {
      phases: [{
        id: 'variable',
        period: { from: { kind: 'month', month: 1, edge: 'start' } },
        formula: {
          kind: 'index_plus_margin',
          indexCode: 'WIBOR3M',
          indexValuePct: '4.00000',
          indexAsOf: '2026-07-01',
          marginPct: '2.00000',
          resetEveryMonths: 3,
        },
      }],
      modifiers: [{
        id: 'insurance-margin-discount',
        sourceFeatureId: 'life-insurance',
        sourceOptionId: 'bank',
        target: 'margin',
        operation: 'add_percentage_points',
        value: '-0.10000',
      }],
    },
    features: [{
      id: 'life-insurance',
      label: 'Ubezpieczenie na życie',
      required: false,
      defaultOptionId: 'none',
      options: [
        { id: 'none', label: 'Bez ubezpieczenia' },
        { id: 'bank', label: 'Ubezpieczenie bankowe' },
      ],
    }],
    presets: [],
    costs: [{
      id: 'origination-commission',
      label: 'Prowizja za udzielenie',
      state: 'known',
      classification: 'credit_cost',
      category: 'commission',
      formula: {
        kind: 'percentage',
        ratePct: '2.00000',
        basis: 'gross_loan_amount',
        ratePeriod: 'per_occurrence',
      },
        timing: { kind: 'once', at: { kind: 'event', event: 'first_disbursement', edge: 'start' } },
      settlement: { allowed: ['cash', 'capitalized'], default: 'cash' },
      includedInApr: true,
    }],
    bridgeInsurance: {
      id: 'bridge-insurance',
      mechanism: {
        kind: 'rate_uplift',
        upliftPctPoints: '1.00000',
        interestTag: 'bridge_uplift_interest',
        period: {
          from: { kind: 'event', event: 'first_disbursement', edge: 'start' },
          endExclusive: { kind: 'event', event: 'mortgage_registered', edge: 'start' },
        },
      },
      refund: {
        kind: 'tagged_amount',
        tag: 'bridge_uplift_interest',
        percentage: '100.00000',
        at: { kind: 'event', event: 'mortgage_registered', edge: 'start' },
        settlement: 'cash_credit',
      },
    },
    disbursementPolicy: {
      maxTranches: 10,
      supportedGraceModes: ['none'],
      paymentRecalculationTriggers: ['rate_change', 'disbursement'],
    },
  }
}

test('uses the selected offer as one shared scenario baseline', () => {
  const first = offer('first', {
    scenario: { propertyValue: 700_000, loanAmount: 500_000, years: 30, installmentType: 'decreasing' },
  })
  const selected = offer('selected')
  const baseline = getFinancingComparisonBaseline([first, selected], selected.id)

  assert.ok(baseline)
  assert.equal(baseline.offerId, selected.id)
  assert.equal(baseline.contributionAmount, 120_000)
  assert.equal(baseline.years, 25)
  assert.equal(baseline.termMonths, 300)
  assert.equal(baseline.installmentType, 'equal')
})

test('recalculates three property prices with a fixed contribution and enforces the LTV limit', () => {
  const bankOffer = offer('bank-offer')
  const baseline = getFinancingComparisonBaseline([bankOffer], bankOffer.id)
  assert.ok(baseline)

  const cheaper = calculatePropertyOfferComparison('property-cheaper', 500_000, bankOffer, baseline)
  const baselinePrice = calculatePropertyOfferComparison('property-baseline', 600_000, bankOffer, baseline)
  const dearer = calculatePropertyOfferComparison('property-dearer', 700_000, bankOffer, baseline)

  assert.deepEqual(
    [cheaper.loanAmount, baselinePrice.loanAmount, dearer.loanAmount],
    [380_000, 480_000, 580_000],
  )
  assert.deepEqual(
    [cheaper.contributionAmount, baselinePrice.contributionAmount, dearer.contributionAmount],
    [120_000, 120_000, 120_000],
  )
  assert.ok(cheaper.firstInstallment! < baselinePrice.firstInstallment!)
  assert.ok(baselinePrice.firstInstallment! < dearer.firstInstallment!)
  assert.ok(cheaper.costFirstFiveYears! < baselinePrice.costFirstFiveYears!)
  assert.ok(baselinePrice.totalCost! < dearer.totalCost!)
  assert.equal(cheaper.ltvPct, 76)
  assert.equal(baselinePrice.ltvPct, 80)
  assert.equal(dearer.ltvPct, 82.86)
  assert.equal(cheaper.status, 'available')
  assert.equal(cheaper.eligibility, 'eligible')
  assert.equal(baselinePrice.status, 'available')
  assert.equal(dearer.status, 'ineligible')
  assert.equal(dearer.eligibility, 'ineligible')
  assert.equal(dearer.eligible, false)
  assert.match(dearer.reasons.join(' '), /LTV 82\.86% przekracza limit oferty 80%/u)
})

test('reports amount, term and currency constraints without using the live catalogue', () => {
  const selected = offer('selected')
  const baseline = getFinancingComparisonBaseline([selected], selected.id)
  assert.ok(baseline)

  const constrained = offer('constrained', {
    version: { min_amount: 500_000, max_term_months: 240 },
  })
  const ineligible = calculatePropertyOfferComparison('property-1', 600_000, constrained, baseline)
  assert.equal(ineligible.status, 'ineligible')
  assert.match(ineligible.reasons.join(' '), /niższa niż minimum/u)
  assert.match(ineligible.reasons.join(' '), /przekracza maksimum oferty \(240 mies\.\)/u)

  const euroOffer = offer('euro', { currency: 'EUR' })
  const invalid = calculatePropertyOfferComparison('property-1', 600_000, euroOffer, baseline)
  assert.equal(invalid.status, 'invalid')
  assert.equal(invalid.firstInstallment, null)
  assert.equal(invalid.totalCost, null)
  assert.match(invalid.reasons.join(' '), /Waluta oferty \(EUR\).*\(PLN\)/u)
})

test('marks a missing property price as invalid', () => {
  const bankOffer = offer('bank-offer')
  const baseline = getFinancingComparisonBaseline([bankOffer], bankOffer.id)
  assert.ok(baseline)

  const comparison = calculatePropertyOfferComparison('property-without-price', null, bankOffer, baseline)
  assert.equal(comparison.status, 'invalid')
  assert.equal(comparison.loanAmount, null)
  assert.equal(comparison.firstMonthlyOutflow, null)
  assert.match(comparison.reasons.join(' '), /nie ma prawidłowej ceny/u)
})

test('replays a frozen V2 offer with cross-sell, financed commission and bridge refund', () => {
  const offerDefinition = integratedV2Offer()
  const bankOffer = offer('integrated-v2', {
    scenario: {
      mortgageRegistrationMonth: 4,
      financeCommission: true,
      selections: { 'life-insurance': 'bank' },
    },
    version: {
      min_amount: 100_000,
      max_amount: 1_000_000,
      min_term_months: 60,
      max_term_months: 420,
      max_ltv_pct: 90,
      offer_definition: offerDefinition,
    },
  })
  const baseline = getFinancingComparisonBaseline([bankOffer], bankOffer.id)
  assert.ok(baseline)
  assert.equal(baseline.mortgageRegistrationMonth, 4)
  assert.equal(baseline.financeCommission, true)
  assert.deepEqual(baseline.selections, { 'life-insurance': 'bank' })

  // A new property keeps the saved contribution (120k), hence a 530k net loan.
  const comparison = calculatePropertyOfferComparison('property-v2', 650_000, bankOffer, baseline)
  const expected = calculateMortgageCatalogVersion(bankOffer.catalog_snapshot.version, {
    propertyValue: 650_000,
    loanAmount: 530_000,
    years: 25,
    installmentType: 'equal',
    referenceDelta: 0,
    monthlyOverpayment: 0,
    overpaymentStrategy: 'shorten_term',
    mortgageRegistrationMonth: 4,
    financeCommission: true,
    selections: { 'life-insurance': 'bank' },
  })
  const withoutCrossSell = calculateMortgageCatalogVersion(bankOffer.catalog_snapshot.version, {
    propertyValue: 650_000,
    loanAmount: 530_000,
    years: 25,
    installmentType: 'equal',
    referenceDelta: 0,
    monthlyOverpayment: 0,
    overpaymentStrategy: 'shorten_term',
    mortgageRegistrationMonth: 4,
    financeCommission: true,
    selections: { 'life-insurance': 'none' },
  })

  assert.equal(expected.status, 'complete')
  assert.equal(expected.grossLoanAmount, 540_816.33)
  assert.equal(expected.financedCosts, 10_816.33)
  assert.equal(expected.schedule[0]?.annualRatePct, 6.9)
  assert.equal(expected.schedule[3]?.annualRatePct, 5.9)
  assert.ok(expected.refunds > 0)
  assert.ok(expected.firstInstallment < withoutCrossSell.firstInstallment)

  assert.equal(comparison.status, 'available')
  assert.equal(comparison.eligibility, 'eligible')
  assert.equal(comparison.eligible, true)
  assert.equal(comparison.loanAmount, 530_000)
  assert.equal(comparison.netLoanAmount, 530_000)
  assert.equal(comparison.grossLoanAmount, 540_816.33)
  assert.equal(comparison.financedCosts, 10_816.33)
  assert.equal(comparison.ltvPct, expected.ltvPct)
  assert.equal(comparison.firstInstallment, expected.firstInstallment)
  assert.equal(comparison.firstMonthlyOutflow, expected.firstTotalOutflow)
  assert.equal(comparison.costFirstFiveYears, expected.costFirstFiveYears)
  assert.equal(comparison.totalCost, expected.totalCost)

  const scenarioSnapshot = comparison.scenarioSnapshot as Record<string, any>
  const calculationSnapshot = comparison.calculationSnapshot as Record<string, any>
  assert.equal(scenarioSnapshot.schemaVersion, 'openexpert.mortgage-application-scenario/1.0')
  assert.equal(scenarioSnapshot.sourceOfferId, bankOffer.id)
  assert.equal(scenarioSnapshot.financing.targetNetProceeds, 530_000)
  assert.equal(scenarioSnapshot.financing.grossLoanAmount, 540_816.33)
  assert.deepEqual(scenarioSnapshot.selections, { 'life-insurance': 'bank' })
  assert.equal(scenarioSnapshot.financeCommission, true)
  assert.equal(calculationSnapshot.schemaVersion, 'openexpert.mortgage-application-calculation/1.0')
  assert.equal(calculationSnapshot.summary.netLoanAmount, 530_000)
  assert.equal(calculationSnapshot.summary.grossLoanAmount, 540_816.33)
  assert.equal(calculationSnapshot.summary.financedCosts, 10_816.33)
})

test('replays a published insurance preset with its margin modifier and linked cost', () => {
  const offerDefinition = integratedV2Offer()
  offerDefinition.presets = [
    {
      id: 'standard',
      label: 'Bez pakietu',
      selections: { 'life-insurance': 'none' },
      isDefault: true,
    },
    {
      id: 'insured',
      label: 'Z ubezpieczeniem bankowym',
      selections: { 'life-insurance': 'bank' },
      isDefault: false,
    },
  ]
  offerDefinition.costs.push({
    id: 'bank-life-insurance',
    label: 'Ubezpieczenie na życie',
    state: 'known',
    classification: 'conditional_cost',
    category: 'life_insurance',
    formula: {
      kind: 'percentage',
      ratePct: '0.03000',
      basis: 'opening_balance_after_draw',
      ratePeriod: 'per_occurrence',
    },
    timing: {
      kind: 'recurring',
      everyMonths: 1,
      period: {
        from: { kind: 'month', month: 1, edge: 'start' },
        endExclusive: { kind: 'month', month: 37, edge: 'start' },
      },
    },
    when: { op: 'selection_is', featureId: 'life-insurance', optionId: 'bank' },
    settlement: { allowed: ['cash'], default: 'cash' },
    includedInApr: true,
  })

  const standardOffer = offer('standard-preset', {
    scenario: {
      presetId: 'standard',
      mortgageRegistrationMonth: 4,
      financeCommission: true,
      selections: {},
    },
    version: { max_ltv_pct: 90, offer_definition: offerDefinition },
  })
  const insuredOffer = offer('insured-preset', {
    scenario: {
      presetId: 'insured',
      mortgageRegistrationMonth: 4,
      financeCommission: true,
      selections: {},
    },
    version: { max_ltv_pct: 90, offer_definition: offerDefinition },
  })
  const baseline = getFinancingComparisonBaseline([standardOffer, insuredOffer], standardOffer.id)
  assert.ok(baseline)
  assert.equal(baseline.presetId, 'standard')

  const standard = calculatePropertyOfferComparison('property-standard', 600_000, standardOffer, baseline)
  const insured = calculatePropertyOfferComparison('property-insured', 600_000, insuredOffer, baseline)

  assert.equal(standard.status, 'available')
  assert.equal(insured.status, 'available')
  assert.ok(insured.firstInstallment! < standard.firstInstallment!)
  assert.ok(insured.firstRecurringCosts! > standard.firstRecurringCosts!)
  assert.ok(insured.costFirstFiveYears! > standard.costFirstFiveYears!)

  const insuredScenario = insured.scenarioSnapshot as Record<string, any>
  const insuredCalculation = insured.calculationSnapshot as Record<string, any>
  assert.equal(insuredScenario.presetId, 'insured')
  assert.equal(insuredScenario.pricing.presetId, 'insured')
  assert.deepEqual(insuredScenario.selections, { 'life-insurance': 'bank' })
  assert.deepEqual(insuredScenario.pricing.selections, { 'life-insurance': 'bank' })
  assert.equal(insuredCalculation.raw.resolvedSelections['life-insurance'], 'bank')
})

test('uses appraisal collateral and gross facility limit for the frozen V2 LTV snapshot', () => {
  const offerDefinition = integratedV2Offer()
  offerDefinition.eligibility.ltvDebtBasis = 'facility_limit'
  offerDefinition.eligibility.collateralValueBasis = 'appraisal_value'
  offerDefinition.eligibility.maxLtvPct = '95.00000'
  const bankOffer = offer('appraisal-facility-v2', {
    scenario: {
      mortgageRegistrationMonth: 4,
      financeCommission: true,
      selections: { 'life-insurance': 'bank' },
    },
    version: { max_ltv_pct: 95, offer_definition: offerDefinition },
  })
  const baseline = getFinancingComparisonBaseline([bankOffer], bankOffer.id)
  assert.ok(baseline)

  const missingAppraisal = calculatePropertyOfferComparison(
    'property-without-appraisal',
    { purchasePrice: 650_000, currency: 'PLN' },
    bankOffer,
    baseline,
  )
  assert.equal(missingAppraisal.status, 'partial')
  assert.equal(missingAppraisal.eligibility, 'unknown')
  assert.match(missingAppraisal.reasons.join(' '), /appraisal value is required/u)

  const comparison = calculatePropertyOfferComparison(
    'property-with-appraisal',
    { purchasePrice: 650_000, appraisalValue: 600_000, currency: 'PLN' },
    bankOffer,
    baseline,
  )
  const expected = calculateMortgageCatalogVersion(bankOffer.catalog_snapshot.version, {
    propertyValue: 650_000,
    appraisalValue: 600_000,
    loanAmount: 530_000,
    years: 25,
    installmentType: 'equal',
    referenceDelta: 0,
    monthlyOverpayment: 0,
    overpaymentStrategy: 'shorten_term',
    mortgageRegistrationMonth: 4,
    financeCommission: true,
    selections: { 'life-insurance': 'bank' },
  })

  assert.equal(comparison.status, 'available')
  assert.equal(comparison.ltvDebtBasis, 'facility_limit')
  assert.equal(comparison.collateralValueBasis, 'appraisal_value')
  assert.equal(comparison.ltvDebtAmount, expected.grossLoanAmount)
  assert.equal(comparison.collateralValueAmount, 600_000)
  assert.equal(comparison.ltvPct, expected.ltvPct)
  assert.equal(comparison.ltvPct, 90.13606)
  const summary = (comparison.calculationSnapshot as Record<string, any>).summary
  assert.equal(summary.ltvDebtAmount, expected.grossLoanAmount)
  assert.equal(summary.collateralValueAmount, 600_000)
})

test('uses the V2 gross-loan amount basis instead of rejecting the net amount with legacy flat limits', () => {
  const offerDefinition = integratedV2Offer()
  offerDefinition.eligibility.minAmount = '485000.00'
  const bankOffer = offer('gross-basis-v2', {
    scenario: {
      mortgageRegistrationMonth: 0,
      financeCommission: true,
      selections: { 'life-insurance': 'none' },
    },
    version: {
      min_amount: 485_000,
      max_ltv_pct: 90,
      offer_definition: offerDefinition,
    },
  })
  const baseline = getFinancingComparisonBaseline([bankOffer], bankOffer.id)
  assert.ok(baseline)

  const expected = calculateMortgageCatalogVersion(bankOffer.catalog_snapshot.version, {
    propertyValue: 600_000,
    loanAmount: 480_000,
    years: 25,
    installmentType: 'equal',
    referenceDelta: 0,
    monthlyOverpayment: 0,
    overpaymentStrategy: 'shorten_term',
    mortgageRegistrationMonth: 0,
    financeCommission: true,
    selections: { 'life-insurance': 'none' },
  })
  const comparison = calculatePropertyOfferComparison('property-gross-basis', 600_000, bankOffer, baseline)

  assert.equal(expected.status, 'complete')
  assert.ok(expected.grossLoanAmount >= 485_000)
  assert.equal(comparison.loanAmount, 480_000)
  assert.equal(comparison.status, 'available')
  assert.equal(comparison.eligibility, 'eligible')
})

test('replays each target offer with its own pricing selections', () => {
  const baselineOffer = offer('baseline-v2', {
    scenario: {
      mortgageRegistrationMonth: 4,
      financeCommission: true,
      selections: { 'life-insurance': 'bank' },
    },
    version: { max_ltv_pct: 90, offer_definition: integratedV2Offer() },
  })
  const targetDefinition = structuredClone(integratedV2Offer())
  targetDefinition.features[0]!.id = 'account-package'
  targetDefinition.features[0]!.defaultOptionId = 'standard'
  targetDefinition.features[0]!.options = [
    { id: 'standard', label: 'Konto standardowe' },
    { id: 'premium', label: 'Konto premium' },
  ]
  targetDefinition.ratePlan.modifiers[0]!.sourceFeatureId = 'account-package'
  targetDefinition.ratePlan.modifiers[0]!.sourceOptionId = 'premium'
  delete targetDefinition.bridgeInsurance
  const targetOffer = offer('target-v2', {
    scenario: {
      financeCommission: false,
      selections: { 'account-package': 'premium' },
    },
    version: { max_ltv_pct: 90, offer_definition: targetDefinition },
  })
  const baseline = getFinancingComparisonBaseline([baselineOffer, targetOffer], baselineOffer.id)
  assert.ok(baseline)

  const comparison = calculatePropertyOfferComparison('property-target', 650_000, targetOffer, baseline)
  const expected = calculateMortgageCatalogVersion(targetOffer.catalog_snapshot.version, {
    propertyValue: 650_000,
    loanAmount: 530_000,
    years: 25,
    installmentType: 'equal',
    referenceDelta: 0,
    monthlyOverpayment: 0,
    overpaymentStrategy: 'shorten_term',
    mortgageRegistrationMonth: null,
    financeCommission: false,
    selections: { 'account-package': 'premium' },
  })

  assert.equal(comparison.status, 'available')
  assert.equal(comparison.firstInstallment, expected.firstInstallment)
  assert.equal(expected.schedule[0]?.annualRatePct, 5.9)
  assert.equal(expected.financedCosts, 0)
})

test('does not expose a partial recalculation as an available property offer', () => {
  const bankOffer = offer('partial-v2', {
    scenario: { financeCommission: true, selections: { 'life-insurance': 'bank' } },
    version: { max_ltv_pct: 90, offer_definition: integratedV2Offer() },
  })
  const baseline = getFinancingComparisonBaseline([bankOffer], bankOffer.id)
  assert.ok(baseline)

  const comparison = calculatePropertyOfferComparison('property-partial', 650_000, bankOffer, baseline)
  assert.equal(comparison.status, 'partial')
  assert.equal(comparison.eligible, false)
  assert.equal(comparison.eligibility, 'unknown')
  assert.match(comparison.reasons.join(' '), /mortgage_registered/u)
})
