import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateMortgageCatalogVersion,
  isMortgageOfferV2,
} from '../src/catalog.ts'
import type {
  MortgageCalculationV2,
  MortgageOfferVersionV2,
} from '../src/types-v2.ts'

function integratedOffer(): MortgageOfferVersionV2 {
  return {
    schemaVersion: 'openexpert.mortgage-offer/2.0',
    currency: 'PLN',
    validity: {
      effectiveFrom: '2026-07-01',
      effectiveTo: null,
      pricingAsOf: '2026-07-01',
    },
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
        id: 'bank-insurance-margin-discount',
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
    costs: [
      {
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
      },
      {
        id: 'bank-life-insurance',
        label: 'Ubezpieczenie na życie banku',
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
        when: {
          op: 'selection_is',
          featureId: 'life-insurance',
          optionId: 'bank',
        },
        settlement: { allowed: ['cash'], default: 'cash' },
        includedInApr: true,
      },
    ],
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

function catalogVersion(offer = integratedOffer()): Record<string, unknown> {
  return {
    version_key: 'integration-v2-2026-07-01',
    variant: {
      id: 'variant-insurance',
      pricing_config: offer,
    },
  }
}

const baseScenario = {
  propertyValue: 600_000,
  loanAmount: 480_000,
  years: 25,
  installmentType: 'equal' as const,
  referenceDelta: 0,
  monthlyOverpayment: 0,
  overpaymentStrategy: 'shorten_term' as const,
  mortgageRegistrationMonth: 4,
  selections: { 'life-insurance': 'bank' },
  financeCommission: true,
}

test('catalog V2 adapter preserves cross-sell, financed commission and bridge refund semantics', () => {
  const version = catalogVersion()
  const insured = calculateMortgageCatalogVersion(version, baseScenario)
  const withoutInsurance = calculateMortgageCatalogVersion(version, {
    ...baseScenario,
    selections: { 'life-insurance': 'none' },
  })

  assert.equal(isMortgageOfferV2(version), true)
  assert.equal(insured.engineVersion, 'openexpert-mortgage-v2.0.0')
  assert.equal(insured.status, 'complete')
  assert.equal(insured.issues.length, 0)

  // Gross-based 2% commission: gross = net / (1 - 2%).
  assert.equal(insured.netLoanAmount, 480_000)
  assert.equal(insured.grossLoanAmount, 489_795.92)
  assert.equal(insured.financedCosts, 9_795.92)
  assert.equal(insured.initialCashRequired, 0)
  assert.equal(insured.totalPrincipal, insured.grossLoanAmount)

  // 4% index + 2% margin - 0.1pp cross-sell + 1pp bridge until registration.
  assert.equal(insured.schedule[0]?.annualRatePct, 6.9)
  assert.equal(withoutInsurance.schedule[0]?.annualRatePct, 7)
  assert.equal(insured.schedule[3]?.annualRatePct, 5.9)
  assert.equal(insured.schedule[0]?.recurringCosts, 146.94)
  assert.ok(insured.firstInstallment < withoutInsurance.firstInstallment)
  assert.equal(insured.firstTotalOutflow, insured.firstInstallment + insured.firstRecurringCosts)

  const bridgeMonths = insured.schedule.slice(0, 3)
  const registrationMonth = insured.schedule.find(row => row.month === 4)
  assert.ok(bridgeMonths.every(row => row.annualRatePct === 6.9))
  assert.ok(registrationMonth)
  assert.ok(registrationMonth.refunds > 0)
  assert.equal(insured.refunds, registrationMonth.refunds)

  const raw = insured.raw as MortgageCalculationV2
  const taggedInterest = raw.schedule
    .filter(row => row.month >= 1 && row.month < 4)
    .reduce((sum, row) => sum + Number(row.bridgeTaggedInterest), 0)
  assert.equal(insured.refunds, Math.round(taggedInterest * 100) / 100)
  assert.equal(raw.resolvedSelections['life-insurance'], 'bank')
  assert.ok(raw.resolutionTrace.some(entry => entry.sourceId === 'life-insurance.bank'))

  // Common adapter totals must retain the V2 cash-flow identity.
  assert.equal(
    insured.totalCost,
    Math.round((insured.totalPayment - insured.netLoanAmount) * 100) / 100,
  )
})

test('catalog V2 finances commission by withholding it when capitalization is unavailable', () => {
  const offer = integratedOffer()
  const commission = offer.costs.find(cost => cost.category === 'commission')
  assert.ok(commission)
  commission.settlement = {
    allowed: ['cash', 'withheld_from_disbursement'],
    default: 'cash',
  }

  const financed = calculateMortgageCatalogVersion(catalogVersion(offer), baseScenario)
  const cash = calculateMortgageCatalogVersion(catalogVersion(offer), {
    ...baseScenario,
    financeCommission: false,
  })

  assert.equal(financed.status, 'complete')
  assert.equal(financed.netLoanAmount, 480_000)
  assert.equal(financed.grossLoanAmount, 489_795.92)
  assert.equal(financed.financedCosts, 9_795.92)
  assert.equal(financed.initialCashRequired, 0)
  assert.equal(cash.grossLoanAmount, 480_000)
  assert.equal(cash.financedCosts, 0)
  assert.equal(cash.initialCashRequired, 9_600)
})

test('catalog V2 adapter reports a missing bridge registration as partial', () => {
  const result = calculateMortgageCatalogVersion(catalogVersion(), {
    ...baseScenario,
    mortgageRegistrationMonth: null,
  })

  assert.equal(result.status, 'partial')
  assert.equal(result.refunds, 0)
  assert.ok(result.issues.some(issue => issue.code === 'missing_event_mortgage_registered'))
})

test('catalog V2 adapter keeps appraisal distinct and fails closed when its LTV basis requires it', () => {
  const appraisalOffer = integratedOffer()
  appraisalOffer.eligibility.ltvDebtBasis = 'facility_limit'
  appraisalOffer.eligibility.collateralValueBasis = 'lower_of_purchase_and_appraisal'
  appraisalOffer.eligibility.maxLtvPct = '95.00000'
  const version = catalogVersion(appraisalOffer)

  const missing = calculateMortgageCatalogVersion(version, baseScenario)
  assert.equal(missing.status, 'partial')
  assert.ok(missing.issues.some(issue => issue.code === 'missing_appraisal'))

  const calculated = calculateMortgageCatalogVersion(version, {
    ...baseScenario,
    propertyValue: 600_000,
    appraisalValue: 550_000,
  })
  assert.equal(calculated.status, 'complete')
  assert.equal(calculated.grossLoanAmount, 489_795.92)
  assert.equal(calculated.ltvPct, 89.0538)
})

test('catalog V2 purchase-price LTV remains complete without an appraisal', () => {
  const calculated = calculateMortgageCatalogVersion(catalogVersion(), baseScenario)

  assert.equal(calculated.status, 'complete')
  assert.ok(!calculated.issues.some(issue => issue.code === 'missing_appraisal'))
})

test('catalog adapter fails closed for a future mortgage-offer schema', () => {
  const version = {
    calculator_schema_version: 2,
    offer_definition: { schemaVersion: 'openexpert.mortgage-offer/2.1' },
    unknown_fields: [],
  }

  const result = calculateMortgageCatalogVersion(version, baseScenario)

  assert.equal(isMortgageOfferV2(version), false)
  assert.equal(result.engineVersion, 'openexpert-mortgage-v2.0.0')
  assert.equal(result.status, 'unsupported')
  assert.equal(result.firstInstallment, 0)
  assert.ok(result.issues.some(issue => issue.code === 'unsupported_schema'))
})

test('catalog adapter fails closed for a malformed exact V2 definition without throwing', () => {
  const version = {
    calculator_schema_version: 2,
    offer_definition: { schemaVersion: 'openexpert.mortgage-offer/2.0' },
    unknown_fields: [],
  }

  const result = calculateMortgageCatalogVersion(version, baseScenario)

  assert.equal(isMortgageOfferV2(version), false)
  assert.equal(result.status, 'unsupported')
  assert.ok(result.issues.some(issue => issue.code === 'invalid_offer_shape'))
})

test('catalog adapter keeps an explicit legacy schema on the legacy engine', () => {
  const version = {
    offer_definition: { schemaVersion: 'openexpert.mortgage-offer/legacy' },
    fixed_rate_pct: 5,
    fixed_period_months: 300,
    margin_pct: null,
    reference_rate_pct: null,
    cost_rules: {},
    unknown_fields: [],
  }

  const result = calculateMortgageCatalogVersion(version, baseScenario)

  assert.equal(isMortgageOfferV2(version), false)
  assert.equal(result.engineVersion, 'openexpert-mortgage-v1')
  assert.equal(result.status, 'complete')
  assert.ok(result.firstInstallment > 0)
})
