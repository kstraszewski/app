import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateMortgageOfferV2, type MortgageOfferVersionV2 } from '@openexpert/mortgage'
import { buildMortgagePublicationScenarioMatrix } from '../server/utils/mortgage-publication-scenarios.ts'

function offer(): MortgageOfferVersionV2 {
  return {
    schemaVersion: 'openexpert.mortgage-offer/2.0',
    currency: 'PLN',
    validity: { effectiveFrom: '2026-01-01', effectiveTo: null, pricingAsOf: '2026-01-01' },
    calculationPolicy: {
      accrual: 'nominal_monthly_12',
      eventOrder: 'openexpert_v2',
      rounding: { currencyScale: 2, interest: 'half_up_each_period', charges: 'half_up_each_charge', balance: 'rounded' },
    },
    eligibility: {
      minAmount: '100000',
      maxAmount: '100001',
      amountBasis: 'net_loan',
      minTermMonths: 12,
      maxTermMonths: 13,
      allowedInstallmentTypes: ['equal', 'decreasing'],
      maxLtvPct: '80',
      ltvDebtBasis: 'net_loan',
      collateralValueBasis: 'lower_of_purchase_and_appraisal',
    },
    ratePlan: {
      phases: [{
        id: 'variable',
        period: { from: { kind: 'month', month: 1, edge: 'start' } },
        formula: {
          kind: 'index_plus_margin',
          indexCode: 'POLSTR_3M',
          indexValuePct: '4',
          indexAsOf: '2026-01-01',
          marginPct: '2',
          resetEveryMonths: 3,
        },
      }],
      modifiers: [{
        id: 'insurance-discount',
        sourceFeatureId: 'insurance',
        sourceOptionId: 'bank',
        target: 'margin',
        operation: 'add_percentage_points',
        value: '-0.1',
      }],
    },
    features: [{
      id: 'insurance',
      label: 'Ubezpieczenie',
      required: true,
      defaultOptionId: 'none',
      options: [
        { id: 'none', label: 'Bez ubezpieczenia' },
        { id: 'bank', label: 'Ubezpieczenie bankowe', breachOptionId: 'none' },
      ],
    }],
    presets: [{ id: 'standard', label: 'Standard', selections: { insurance: 'none' }, isDefault: true }],
    costs: [{
      id: 'commission',
      label: 'Prowizja',
      state: 'known',
      classification: 'credit_cost',
      category: 'commission',
      formula: { kind: 'percentage', ratePct: '2', basis: 'net_loan_amount', ratePeriod: 'per_occurrence' },
      timing: { kind: 'once', at: { kind: 'event', event: 'first_disbursement', edge: 'start' } },
      settlement: { allowed: ['cash', 'capitalized'], default: 'cash' },
      includedInApr: true,
    }],
    disbursementPolicy: {
      maxTranches: 2,
      supportedGraceModes: ['none', 'interest_only', 'capitalize_interest'],
      paymentRecalculationTriggers: ['rate_change', 'disbursement', 'grace_end'],
    },
  }
}

test('covers variants, settlements, amount modes, installments, tranches and grace before publication', () => {
  const matrix = buildMortgagePublicationScenarioMatrix(offer())
  assert.deepEqual(matrix.issues, [])
  assert.ok(matrix.scenarios.some(item => item.scenario.selections.insurance === 'bank'))
  assert.ok(matrix.scenarios.some(item => item.scenario.costSettlements.commission === 'capitalized'))
  assert.ok(matrix.scenarios.some(item => item.scenario.financing.amountMode === 'gross_facility'))
  assert.ok(matrix.scenarios.some(item => item.scenario.financing.installmentType === 'decreasing'))
  assert.ok(matrix.scenarios.some(item => item.scenario.disbursements.length === 2))
  assert.ok(matrix.scenarios.some(item => item.scenario.grace.mode === 'interest_only'))
  assert.ok(matrix.scenarios.some(item => item.scenario.grace.mode === 'capitalize_interest'))

  for (const item of matrix.scenarios) {
    const result = calculateMortgageOfferV2(offer(), item.scenario)
    assert.equal(
      result.issues.some(issue => issue.kind === 'error' || issue.kind === 'incomplete'),
      false,
      `${item.description}: ${JSON.stringify(result.issues)}`,
    )
  }
})

test('blocks publication when independent option combinations exceed the exhaustive limit', () => {
  const complexOffer = offer()
  complexOffer.features = Array.from({ length: 13 }, (_, index) => ({
    id: `feature-${index}`,
    label: `Feature ${index}`,
    required: false,
    options: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ],
  }))
  complexOffer.ratePlan.modifiers = []
  complexOffer.presets = []

  const matrix = buildMortgagePublicationScenarioMatrix(complexOffer)
  assert.equal(matrix.scenarios.length, 0)
  assert.equal(matrix.issues[0]?.code, 'publication_matrix_too_large')
})
