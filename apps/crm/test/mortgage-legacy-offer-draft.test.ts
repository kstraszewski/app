import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateMortgageOfferV2, validateMortgageOfferV2 } from '@openexpert/mortgage'
import { mortgageLegacyVersionToDraft } from '../server/utils/mortgage-legacy-offer-draft.ts'

const source = {
  id: '69e97fb8-69a9-4664-aa9e-334b3b31706f',
  title: 'Tabela opłat i prowizji',
  source_url: 'https://bank.example/cennik.pdf',
  source_kind: 'pricing_table',
  retrieved_at: '2026-07-12T12:30:00.000Z',
  sha256: 'a'.repeat(64),
}

const legacy = {
  id: 'fa0b9c2b-cffd-4909-994e-0a9ef2e17e41',
  version_key: 'bank-housing-fixed-2026-07-02',
  calculation_date: '2026-07-02',
  interest_type: 'fixed_periodic',
  fixed_rate_pct: 5.96,
  fixed_period_months: 60,
  margin_pct: 1.79,
  reference_rate_code: 'WIBOR 1M',
  reference_rate_pct: 3.78,
  reference_rate_as_of: '2026-07-01',
  min_amount: 50_000,
  max_amount: 1_500_000,
  min_term_months: 60,
  max_term_months: 420,
  max_ltv_pct: 90,
  cost_rules: {
    commissionPct: 2,
    appraisalFee: 500,
    pccFee: 19,
    courtFee: 200,
    accountMonthlyFee: 10,
    cardMonthlyFee: 5,
    lifeInsuranceMonths: 48,
    lifeInsuranceMonthlyRatePct: 0.03,
    propertyInsuranceAnnualRatePct: 0.05,
  },
  requirements: ['Konto z wpływem wynagrodzenia'],
  document_requirements: [],
  assumptions: ['Dane zaimportowane z wersji płaskiej.'],
  unknown_fields: ['ubezpieczenie pomostowe'],
}

test('seeds a reviewable V2 draft from the current legacy publication', () => {
  const seeded = mortgageLegacyVersionToDraft(legacy, source)

  assert.equal(seeded.draftData.schemaVersion, 'openexpert.mortgage-offer/2.0')
  assert.equal(seeded.draftData.ratePlan.phases.length, 2)
  assert.deepEqual(seeded.draftData.ratePlan.phases[0]?.period, {
    from: { kind: 'month', month: 1, edge: 'start' },
    endExclusive: { kind: 'month', month: 61, edge: 'start' },
  })
  assert.equal(seeded.draftData.ratePlan.phases[1]?.formula.kind, 'index_plus_margin')
  assert.equal(seeded.draftData.features[0]?.label, 'Konto z wpływem wynagrodzenia')
  assert.equal(seeded.draftData.presets[0]?.isDefault, true)
  assert.equal(seeded.draftData.documentation.sources[0]?.kind, 'bank_tariff')
  assert.equal(seeded.draftData.costs.find(cost => cost.id === 'commission-percentage')?.state, 'known')
  assert.equal(seeded.draftData.costs.find(cost => cost.id === 'bridge-insurance')?.state, 'unknown')
  assert.equal(validateMortgageOfferV2(seeded.draftData).valid, true)
})

test('keeps changed legacy pricing connected to the V2 calculator', () => {
  const seeded = mortgageLegacyVersionToDraft(legacy, source)
  const scenario = {
    property: { purchasePrice: '600000', appraisalValue: '600000' },
    financing: { amount: '480000', amountMode: 'target_net_proceeds' as const, termMonths: 300, installmentType: 'equal' as const },
    presetId: 'standard',
    selections: {},
    costSettlements: { 'commission-percentage': 'capitalized' as const },
    disbursements: [],
    grace: { mode: 'none' as const },
    events: { mortgageRegistered: { month: 6, edge: 'start' as const } },
  }

  const baseline = calculateMortgageOfferV2(seeded.draftData, scenario)
  const changed = mortgageLegacyVersionToDraft({ ...legacy, fixed_rate_pct: 6.46 }, source)
  const recalculated = calculateMortgageOfferV2(changed.draftData, scenario)
  const baselineFirstPayment = baseline.schedule.find(row => row.month === 1)
  const recalculatedFirstPayment = recalculated.schedule.find(row => row.month === 1)

  assert.equal(baseline.status, 'partial')
  assert.equal(recalculated.status, 'partial')
  assert.ok(Number(recalculatedFirstPayment?.scheduledPayment) > Number(baselineFirstPayment?.scheduledPayment))
  assert.ok(Number(baseline.financedCosts) > 0)
})
