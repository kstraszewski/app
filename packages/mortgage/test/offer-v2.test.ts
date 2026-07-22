import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateMortgageOfferV2,
  compileMortgageOfferV2,
} from '../src/offer-v2.ts'
import type {
  MortgageCostRuleV2,
  MortgageOfferVersionV2,
  MortgageScenarioV2,
} from '../src/types-v2.ts'

function offer(overrides: Partial<MortgageOfferVersionV2> = {}): MortgageOfferVersionV2 {
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
      minAmount: '1.00',
      maxAmount: null,
      amountBasis: 'gross_loan',
      minTermMonths: 1,
      maxTermMonths: 600,
      allowedInstallmentTypes: ['equal', 'decreasing'],
      maxLtvPct: '100.00000',
      ltvDebtBasis: 'gross_loan',
      collateralValueBasis: 'purchase_price',
    },
    ratePlan: {
      phases: [{
        id: 'fixed',
        period: { from: { kind: 'month', month: 1, edge: 'start' } },
        formula: { kind: 'fixed', ratePct: '6.00000' },
      }],
      modifiers: [],
    },
    features: [],
    presets: [],
    costs: [],
    disbursementPolicy: {
      maxTranches: 10,
      supportedGraceModes: ['none', 'interest_only', 'capitalize_interest'],
      paymentRecalculationTriggers: ['rate_change', 'disbursement', 'grace_end', 'lower_payment_overpayment'],
    },
    ...overrides,
  }
}

function scenario(overrides: Partial<MortgageScenarioV2> = {}): MortgageScenarioV2 {
  return {
    property: { purchasePrice: '600000.00' },
    financing: { amount: '400000.00', amountMode: 'target_net_proceeds', termMonths: 300, installmentType: 'equal' },
    selections: {},
    costSettlements: {},
    disbursements: [{ id: 'purchase', month: 0, netAmount: '400000.00' }],
    grace: { mode: 'none' },
    events: {},
    overpaymentStrategy: 'shorten_term',
    ...overrides,
  }
}

function commission(basis: 'net_loan_amount' | 'gross_loan_amount'): MortgageCostRuleV2 {
  return {
    id: 'origination_commission',
    label: 'Prowizja',
    state: 'known',
    classification: 'credit_cost',
    category: 'commission',
    formula: { kind: 'percentage', ratePct: '2.00000', basis, ratePeriod: 'per_occurrence' },
    timing: { kind: 'once', at: { kind: 'event', event: 'first_disbursement', edge: 'start' } },
    settlement: { allowed: ['cash', 'capitalized'], default: 'capitalized' },
    includedInApr: true,
  }
}

function number(value: string): number {
  return Number(value)
}

function assertLedger(result: ReturnType<typeof calculateMortgageOfferV2>): void {
  for (const row of result.schedule) {
    const expected = number(row.openingBalance)
      + number(row.netDisbursements)
      + number(row.capitalizedCosts)
      + number(row.capitalizedInterest)
      - number(row.scheduledPrincipal)
      - number(row.overpayment)
      - number(row.principalCredits)
    assert.ok(Math.abs(expected - number(row.closingBalance)) < 0.011, `ledger mismatch in month ${row.month}`)
  }
}

test('finances a 2% commission based on the net loan', () => {
  const result = calculateMortgageOfferV2(offer({ costs: [commission('net_loan_amount')] }), scenario())
  assert.equal(result.status, 'complete')
  assert.equal(result.netLoanAmount, '400000.00')
  assert.equal(result.grossLoanAmount, '408000.00')
  assert.equal(result.financedCosts, '8000.00')
  assert.equal(result.schedule[0]?.closingBalance, '408000.00')
  assert.equal(result.totals.creditCosts, '8000.00')
  assert.equal(result.totals.initialCashRequired, '0.00')
  assertLedger(result)
})

test('solves a financed 2% commission based on the gross loan', () => {
  const result = calculateMortgageOfferV2(offer({ costs: [commission('gross_loan_amount')] }), scenario())
  assert.equal(result.status, 'complete')
  assert.equal(result.netLoanAmount, '400000.00')
  assert.equal(result.grossLoanAmount, '408163.27')
  assert.equal(result.financedCosts, '8163.27')
  assert.equal(result.schedule[0]?.closingBalance, '408163.27')
  assertLedger(result)
})

test('solves a gross facility with a financed fee based on the actual net disbursement', () => {
  const drawFee: MortgageCostRuleV2 = {
    ...commission('net_loan_amount'),
    formula: {
      kind: 'percentage',
      ratePct: '2.00000',
      basis: 'current_disbursement',
      ratePeriod: 'per_occurrence',
    },
  }
  const result = calculateMortgageOfferV2(offer({ costs: [drawFee] }), scenario({
    financing: { amount: '500000.00', amountMode: 'gross_facility', termMonths: 300, installmentType: 'equal' },
    disbursements: [],
  }))

  assert.equal(result.status, 'complete')
  assert.equal(result.grossLoanAmount, '500000.00')
  assert.equal(result.netLoanAmount, '490196.08')
  assert.equal(result.financedCosts, '9803.92')
  assert.equal(result.componentTotals.origination_commission, '9803.92')
  assert.equal(result.schedule[0]?.closingBalance, '500000.00')
  assert.equal(result.totals.repaidPrincipal, '500000.00')
  assertLedger(result)
})

test('keeps a cash commission outside gross principal and initialises required cash', () => {
  const cashCommission = commission('net_loan_amount')
  cashCommission.settlement.default = 'cash'
  const result = calculateMortgageOfferV2(offer({ costs: [cashCommission] }), scenario())
  assert.equal(result.grossLoanAmount, '400000.00')
  assert.equal(result.totals.cashCosts, '8000.00')
  assert.equal(result.totals.initialCashRequired, '8000.00')
  assert.equal(result.schedule[0]?.closingBalance, '400000.00')
})

test('solves a financed per-disbursement cost with the selections active at each tranche', () => {
  const trancheCost: MortgageCostRuleV2 = {
    id: 'second-tranche-fee',
    label: 'Opłata za aktywną transzę',
    state: 'known',
    classification: 'credit_cost',
    category: 'other',
    formula: { kind: 'fixed', amount: '1000.00' },
    timing: { kind: 'per_disbursement' },
    when: { op: 'selection_is', featureId: 'tranche-fee', optionId: 'on' },
    settlement: { allowed: ['capitalized'], default: 'capitalized' },
    includedInApr: true,
  }
  const result = calculateMortgageOfferV2(offer({
    features: [{
      id: 'tranche-fee', label: 'Opłata transzowa', required: true, defaultOptionId: 'off',
      options: [{ id: 'off', label: 'Wyłączona' }, { id: 'on', label: 'Włączona' }],
    }],
    costs: [trancheCost],
  }), scenario({
    selectionEvents: [{ month: 6, featureId: 'tranche-fee', optionId: 'on' }],
    disbursements: [
      { id: 'first', month: 0, netAmount: '200000.00' },
      { id: 'second', month: 6, netAmount: '200000.00' },
    ],
  }))

  assert.equal(result.status, 'complete')
  assert.equal(result.netLoanAmount, '400000.00')
  assert.equal(result.grossLoanAmount, '401000.00')
  assert.equal(result.financedCosts, '1000.00')
  assert.equal(result.totals.capitalizedCosts, '1000.00')
  assert.equal(result.componentTotals['second-tranche-fee'], '1000.00')
  assertLedger(result)
})

test('rejects a non-cash recurring cost until a future-financing model exists', () => {
  const recurring: MortgageCostRuleV2 = {
    id: 'financed-monthly-insurance',
    label: 'Kredytowane ubezpieczenie miesięczne',
    state: 'known',
    classification: 'credit_cost',
    category: 'life_insurance',
    formula: { kind: 'fixed', amount: '100.00' },
    timing: {
      kind: 'recurring',
      everyMonths: 1,
      period: { from: { kind: 'month', month: 1, edge: 'start' } },
    },
    settlement: { allowed: ['cash', 'capitalized'], default: 'cash' },
    includedInApr: true,
  }
  const result = calculateMortgageOfferV2(offer({ costs: [recurring] }), scenario())

  assert.equal(result.status, 'unsupported')
  assert.equal(result.schedule.length, 0)
  assert.ok(result.issues.some(entry => entry.code === 'non_cash_recurring_cost_unsupported'))
})

test('rejects a dynamically reversed recurring cost period', () => {
  const recurring: MortgageCostRuleV2 = {
    id: 'reversed-period-cost',
    label: 'Koszt z odwróconym okresem',
    state: 'known',
    classification: 'credit_cost',
    category: 'other',
    formula: { kind: 'fixed', amount: '100.00' },
    timing: {
      kind: 'recurring',
      everyMonths: 1,
      period: {
        from: { kind: 'event', event: 'mortgage_registered', edge: 'start' },
        endExclusive: { kind: 'event', event: 'last_disbursement', edge: 'start' },
      },
    },
    settlement: { allowed: ['cash'], default: 'cash' },
    includedInApr: true,
  }
  const result = calculateMortgageOfferV2(offer({ costs: [recurring] }), scenario({
    events: { mortgageRegistered: { month: 12, edge: 'start' } },
  }))

  assert.equal(result.status, 'unsupported')
  assert.equal(result.schedule.length, 0)
  assert.ok(result.issues.some(entry => entry.code === 'invalid_resolved_active_period_order'))
})

test('rounds a half-cent charge half-up', () => {
  const halfCentCost: MortgageCostRuleV2 = {
    id: 'half-cent',
    label: 'Koszt graniczny',
    state: 'known',
    classification: 'credit_cost',
    category: 'other',
    formula: { kind: 'fixed', amount: '1.005' },
    timing: { kind: 'once', at: { kind: 'month', month: 0, edge: 'start' } },
    settlement: { allowed: ['cash'], default: 'cash' },
    includedInApr: true,
  }
  const result = calculateMortgageOfferV2(offer({ costs: [halfCentCost] }), scenario())
  assert.equal(result.totals.cashCosts, '1.01')
  assert.equal(result.componentTotals['half-cent'], '1.01')
})

test('recalculates an equal installment only for configured payment triggers', () => {
  const phases = [
    {
      id: 'first-year',
      period: {
        from: { kind: 'month' as const, month: 1, edge: 'start' as const },
        endExclusive: { kind: 'month' as const, month: 13, edge: 'start' as const },
      },
      formula: { kind: 'fixed' as const, ratePct: '6.00000' },
    },
    {
      id: 'after-first-year',
      period: { from: { kind: 'month' as const, month: 13, edge: 'start' as const } },
      formula: { kind: 'fixed' as const, ratePct: '8.00000' },
    },
  ]
  const base = {
    ratePlan: { phases, modifiers: [] },
    disbursementPolicy: {
      ...offer().disbursementPolicy,
      paymentRecalculationTriggers: [],
    },
  }
  const input = scenario({
    financing: { amount: '400000.00', amountMode: 'target_net_proceeds', termMonths: 24, installmentType: 'equal' },
  })
  const unchanged = calculateMortgageOfferV2(offer(base), input)
  const recalculated = calculateMortgageOfferV2(offer({
    ...base,
    disbursementPolicy: {
      ...base.disbursementPolicy,
      paymentRecalculationTriggers: ['rate_change'],
    },
  }), input)

  assert.equal(unchanged.status, 'complete')
  assert.equal(unchanged.schedule[13]?.scheduledPayment, unchanged.schedule[12]?.scheduledPayment)
  assert.ok(number(recalculated.schedule[13]!.scheduledPayment) > number(recalculated.schedule[12]!.scheduledPayment))
})

test('preserves the shortened payoff horizon when an equal installment is recalculated', () => {
  const result = calculateMortgageOfferV2(offer({
    ratePlan: {
      phases: [
        {
          id: 'before-reset',
          period: {
            from: { kind: 'month', month: 1, edge: 'start' },
            endExclusive: { kind: 'month', month: 61, edge: 'start' },
          },
          formula: { kind: 'fixed', ratePct: '6.00000' },
        },
        {
          id: 'after-reset',
          period: { from: { kind: 'month', month: 61, edge: 'start' } },
          formula: { kind: 'fixed', ratePct: '6.00001' },
        },
      ],
      modifiers: [],
    },
  }), scenario({
    oneOffOverpayments: { 12: '100000.00' },
    overpaymentStrategy: 'shorten_term',
  }))

  const paidOffMonth = result.schedule.find(row => row.month > 0 && number(row.closingBalance) === 0)?.month
  assert.equal(result.status, 'complete')
  assert.equal(paidOffMonth, 181)
  assert.ok(number(result.schedule[61]!.scheduledPayment) > 2500)
  assertLedger(result)
})

test('preserves the shortened payoff horizon for decreasing installments after a rate reset', () => {
  const result = calculateMortgageOfferV2(offer({
    ratePlan: {
      phases: [
        {
          id: 'before-reset',
          period: {
            from: { kind: 'month', month: 1, edge: 'start' },
            endExclusive: { kind: 'month', month: 61, edge: 'start' },
          },
          formula: { kind: 'fixed', ratePct: '6.00000' },
        },
        {
          id: 'after-reset',
          period: { from: { kind: 'month', month: 61, edge: 'start' } },
          formula: { kind: 'fixed', ratePct: '6.00001' },
        },
      ],
      modifiers: [],
    },
  }), scenario({
    financing: { amount: '400000.00', amountMode: 'target_net_proceeds', termMonths: 300, installmentType: 'decreasing' },
    oneOffOverpayments: { 12: '100000.00' },
    overpaymentStrategy: 'shorten_term',
  }))

  const paidOffMonth = result.schedule.find(row => row.month > 0 && number(row.closingBalance) === 0)?.month
  assert.equal(result.status, 'complete')
  assert.equal(paidOffMonth, 226)
  assert.ok(number(result.schedule[61]!.scheduledPrincipal) > 1300)
  assertLedger(result)
})

test('applies a cross-sell margin reduction and the linked balance insurance cost', () => {
  const crossSellOffer = offer({
    ratePlan: {
      phases: [{
        id: 'variable',
        period: { from: { kind: 'month', month: 1, edge: 'start' } },
        formula: {
          kind: 'index_plus_margin', indexCode: 'WIBOR3M', indexValuePct: '4.00000',
          indexAsOf: '2026-01-01', marginPct: '2.00000', resetEveryMonths: 3,
        },
      }],
      modifiers: [{
        id: 'insurance-margin-benefit', sourceFeatureId: 'life-insurance', sourceOptionId: 'bank',
        target: 'margin', operation: 'add_percentage_points', value: '-0.10000',
      }],
    },
    features: [{
      id: 'life-insurance', label: 'Ubezpieczenie życia', required: true, defaultOptionId: 'none',
      options: [{ id: 'none', label: 'Bez ubezpieczenia' }, { id: 'bank', label: 'Ubezpieczenie bankowe' }],
    }],
    presets: [{ id: 'insured', label: 'Z ubezpieczeniem', selections: { 'life-insurance': 'bank' }, isDefault: false }],
    costs: [{
      id: 'bank-life-insurance', label: 'Ubezpieczenie życia', state: 'known', classification: 'conditional_cost',
      category: 'life_insurance',
      formula: { kind: 'percentage', ratePct: '0.03000', basis: 'opening_balance_after_draw', ratePeriod: 'per_occurrence' },
      timing: {
        kind: 'recurring', everyMonths: 1,
        period: {
          from: { kind: 'month', month: 1, edge: 'start' },
          endExclusive: { kind: 'month', month: 37, edge: 'start' },
        },
      },
      when: { op: 'selection_is', featureId: 'life-insurance', optionId: 'bank' },
      settlement: { allowed: ['cash'], default: 'cash' }, includedInApr: true,
    }],
  })
  const without = calculateMortgageOfferV2(crossSellOffer, scenario({ selections: { 'life-insurance': 'none' } }))
  const withInsurance = calculateMortgageOfferV2(crossSellOffer, scenario({ presetId: 'insured' }))
  assert.equal(without.schedule[1]?.annualRatePct, '6.00000')
  assert.equal(withInsurance.schedule[1]?.annualRatePct, '5.90000')
  assert.ok(number(withInsurance.schedule[1]!.scheduledPayment) < number(without.schedule[1]!.scheduledPayment))
  assert.equal(withInsurance.schedule[1]?.cashCosts, '120.00')
  assert.equal(withInsurance.resolvedSelections['life-insurance'], 'bank')
  assert.ok(withInsurance.resolutionTrace.some(entry => entry.sourceId === 'life-insurance.bank'))
})

test('applies a margin modifier only after a fixed phase', () => {
  const phased = offer({
    ratePlan: {
      phases: [
        {
          id: 'fixed-five-years',
          period: {
            from: { kind: 'month', month: 1, edge: 'start' },
            endExclusive: { kind: 'month', month: 61, edge: 'start' },
          },
          formula: { kind: 'fixed', ratePct: '5.00000' },
        },
        {
          id: 'variable-after-five-years',
          period: { from: { kind: 'month', month: 61, edge: 'start' } },
          formula: {
            kind: 'index_plus_margin', indexCode: 'WIBOR3M', indexValuePct: '4.00000',
            indexAsOf: '2026-01-01', marginPct: '2.00000', resetEveryMonths: 3,
          },
        },
      ],
      modifiers: [{ id: 'margin-discount', target: 'margin', operation: 'add_percentage_points', value: '-0.10000' }],
    },
  })
  const result = calculateMortgageOfferV2(phased, scenario())
  assert.equal(result.schedule[1]?.annualRatePct, '5.00000')
  assert.equal(result.schedule[60]?.annualRatePct, '5.00000')
  assert.equal(result.schedule[61]?.annualRatePct, '5.90000')
})

test('changes margin, installment and conditional costs after a cross-sell breach event', () => {
  const dynamicOffer = offer({
    ratePlan: {
      phases: [{
        id: 'variable',
        period: { from: { kind: 'month', month: 1, edge: 'start' } },
        formula: {
          kind: 'index_plus_margin', indexCode: 'WIBOR3M', indexValuePct: '4.00000',
          indexAsOf: '2026-01-01', marginPct: '2.00000', resetEveryMonths: 3,
        },
      }],
      modifiers: [{
        id: 'breach-margin-uplift', sourceFeatureId: 'insurance', sourceOptionId: 'breach',
        target: 'margin', operation: 'add_percentage_points', value: '0.10000',
      }],
    },
    features: [{
      id: 'insurance', label: 'Ubezpieczenie', required: true, defaultOptionId: 'bank',
      options: [
        { id: 'bank', label: 'Polisa bankowa', monitoringEveryMonths: 1, breachOptionId: 'breach' },
        { id: 'breach', label: 'Warunek niespełniony' },
      ],
    }],
    costs: [{
      id: 'insurance-premium', label: 'Składka', state: 'known', classification: 'conditional_cost',
      category: 'life_insurance',
      formula: { kind: 'fixed', amount: '100.00' },
      timing: { kind: 'recurring', everyMonths: 1, period: { from: { kind: 'month', month: 1, edge: 'start' } } },
      when: { op: 'selection_is', featureId: 'insurance', optionId: 'bank' },
      settlement: { allowed: ['cash'], default: 'cash' }, includedInApr: true,
    }],
  })
  const result = calculateMortgageOfferV2(dynamicOffer, scenario({
    selections: { insurance: 'bank' },
    selectionEvents: [{ month: 13, featureId: 'insurance', optionId: 'breach' }],
  }))

  assert.equal(result.status, 'complete')
  assert.equal(result.schedule[12]?.annualRatePct, '6.00000')
  assert.equal(result.schedule[12]?.cashCosts, '100.00')
  assert.equal(result.schedule[13]?.annualRatePct, '6.10000')
  assert.equal(result.schedule[13]?.cashCosts, '0.00')
  assert.ok(number(result.schedule[13]!.scheduledPayment) > number(result.schedule[12]!.scheduledPayment))
  assert.equal(result.resolvedSelections.insurance, 'breach')
  assert.ok(result.resolutionTrace.some(entry => entry.month === 13 && entry.sourceId === 'insurance.breach'))
})

test('rejects conflicting rate setters activated by a later selection event', () => {
  const conflictingOffer = offer({
    features: [{
      id: 'insurance', label: 'Ubezpieczenie', required: true, defaultOptionId: 'bank',
      options: [{ id: 'bank', label: 'Polisa bankowa' }, { id: 'breach', label: 'Warunek niespełniony' }],
    }],
    ratePlan: {
      phases: offer().ratePlan.phases,
      modifiers: [
        {
          id: 'breach-rate-a', sourceFeatureId: 'insurance', sourceOptionId: 'breach',
          target: 'fixed_rate', operation: 'set_percent', value: '6.10000',
        },
        {
          id: 'breach-rate-b', sourceFeatureId: 'insurance', sourceOptionId: 'breach',
          target: 'fixed_rate', operation: 'set_percent', value: '6.20000',
        },
      ],
    },
  })
  const compiled = compileMortgageOfferV2(conflictingOffer, scenario({
    selections: { insurance: 'bank' },
    selectionEvents: [{ month: 13, featureId: 'insurance', optionId: 'breach' }],
  }))

  assert.equal(compiled.status, 'unsupported')
  assert.ok(compiled.issues.some(entry => (
    entry.code === 'conflicting_rate_setters'
    && entry.path === 'ratePlan.modifiers.month.13.fixed_rate'
  )))
})

test('supports set and additive rate modifiers for an explicit period', () => {
  const modifierPeriod = {
    from: { kind: 'month' as const, month: 1, edge: 'start' as const },
    endExclusive: { kind: 'month' as const, month: 13, edge: 'start' as const },
  }
  const result = calculateMortgageOfferV2(offer({
    ratePlan: {
      phases: offer().ratePlan.phases,
      modifiers: [
        { id: 'introductory-rate', target: 'fixed_rate', operation: 'set_percent', value: '5.00000', period: modifierPeriod },
        { id: 'nominal-uplift', target: 'nominal_rate', operation: 'add_percentage_points', value: '0.20000', period: modifierPeriod },
      ],
    },
  }), scenario())
  assert.equal(result.schedule[1]?.annualRatePct, '5.20000')
  assert.equal(result.schedule[12]?.annualRatePct, '5.20000')
  assert.equal(result.schedule[13]?.annualRatePct, '6.00000')
})

test('tags bridge uplift interest and refunds that exact amount in cash', () => {
  const bridgeOffer = offer({
    bridgeInsurance: {
      id: 'bridge',
      mechanism: {
        kind: 'rate_uplift', upliftPctPoints: '1.00000', interestTag: 'bridge_uplift_interest',
        period: {
          from: { kind: 'event', event: 'first_disbursement', edge: 'start' },
          endExclusive: { kind: 'event', event: 'mortgage_registered', edge: 'start' },
        },
      },
      refund: {
        kind: 'tagged_amount', tag: 'bridge_uplift_interest', percentage: '100.00000',
        at: { kind: 'event', event: 'mortgage_registered', edge: 'start' }, settlement: 'cash_credit',
      },
    },
  })
  const result = calculateMortgageOfferV2(bridgeOffer, scenario({ events: { mortgageRegistered: { month: 4, edge: 'start' } } }))
  const tagged = result.schedule.slice(1, 4).reduce((sum, row) => sum + number(row.bridgeTaggedInterest), 0)
  assert.equal(result.schedule[1]?.annualRatePct, '7.00000')
  assert.equal(result.schedule[4]?.annualRatePct, '6.00000')
  assert.equal(number(result.schedule[4]!.cashRefunds), Math.round(tagged * 100) / 100)
  assert.equal(result.totals.refunds, result.componentTotals.bridge_refund)
  assertLedger(result)
})

test('marks an unknown mortgage registration event partial instead of ending uplift at zero', () => {
  const bridgeOffer = offer({
    bridgeInsurance: {
      id: 'bridge',
      mechanism: {
        kind: 'rate_uplift', upliftPctPoints: '1.00000', interestTag: 'bridge_uplift_interest',
        period: {
          from: { kind: 'event', event: 'first_disbursement', edge: 'start' },
          endExclusive: { kind: 'event', event: 'mortgage_registered', edge: 'start' },
        },
      },
      refund: {
        kind: 'tagged_amount', tag: 'bridge_uplift_interest', percentage: '100.00000',
        at: { kind: 'event', event: 'mortgage_registered', edge: 'start' }, settlement: 'principal_credit',
      },
    },
  })
  const compiled = compileMortgageOfferV2(bridgeOffer, scenario())
  const result = calculateMortgageOfferV2(bridgeOffer, scenario())
  assert.equal(compiled.status, 'partial')
  assert.equal(result.status, 'partial')
  assert.equal(result.schedule[1]?.annualRatePct, '7.00000')
  assert.equal(result.totals.refunds, '0.00')
  assert.ok(result.issues.some(entry => entry.code === 'missing_event_mortgage_registered'))
})

test('rejects a mortgage registration event after maturity', () => {
  const compiled = compileMortgageOfferV2(offer(), scenario({
    events: { mortgageRegistered: { month: 301, edge: 'start' } },
  }))

  assert.equal(compiled.status, 'unsupported')
  assert.ok(compiled.issues.some(entry => (
    entry.code === 'invalid_integer'
    && entry.path === 'scenario.events.mortgageRegistered.month'
  )))
})

test('rejects an unsupported mortgage registration timeline edge', () => {
  const compiled = compileMortgageOfferV2(offer(), scenario({
    events: { mortgageRegistered: { month: 0, edge: 'middle' as 'start' } },
  }))

  assert.equal(compiled.status, 'unsupported')
  assert.ok(compiled.issues.some(entry => (
    entry.code === 'invalid_enum_value'
    && entry.path === 'scenario.events.mortgageRegistered.edge'
  )))
})

test('fails closed for end-of-month registration because V2 events are start-of-month only', () => {
  const compiled = compileMortgageOfferV2(offer(), scenario({
    events: { mortgageRegistered: { month: 4, edge: 'end' as 'start' } },
  }))

  assert.equal(compiled.status, 'unsupported')
  assert.ok(compiled.issues.some(entry => (
    entry.code === 'invalid_enum_value'
    && entry.path === 'scenario.events.mortgageRegistered.edge'
  )))
})

test('treats mortgage registration before a later first disbursement as no bridge period', () => {
  const bridgeOffer = offer({
    bridgeInsurance: {
      id: 'bridge',
      mechanism: {
        kind: 'rate_uplift', upliftPctPoints: '1.00000', interestTag: 'bridge_uplift_interest',
        period: {
          from: { kind: 'event', event: 'first_disbursement', edge: 'start' },
          endExclusive: { kind: 'event', event: 'mortgage_registered', edge: 'start' },
        },
      },
      refund: {
        kind: 'tagged_amount', tag: 'bridge_uplift_interest', percentage: '100.00000',
        at: { kind: 'event', event: 'mortgage_registered', edge: 'start' }, settlement: 'cash_credit',
      },
    },
  })
  const result = calculateMortgageOfferV2(bridgeOffer, scenario({
    disbursements: [{ id: 'purchase', month: 3, netAmount: '400000.00' }],
    events: { mortgageRegistered: { month: 2, edge: 'start' } },
  }))

  assert.equal(result.status, 'complete')
  assert.equal(result.schedule[3]?.annualRatePct, '6.00000')
  assert.equal(result.componentTotals.bridge_uplift_interest, undefined)
  assert.equal(result.totals.refunds, '0.00')
  assertLedger(result)
})

test('treats registration at month zero as already registered when the loan starts', () => {
  const bridgeOffer = offer({
    bridgeInsurance: {
      id: 'bridge',
      mechanism: {
        kind: 'rate_uplift', upliftPctPoints: '1.00000', interestTag: 'bridge_uplift_interest',
        period: {
          from: { kind: 'event', event: 'first_disbursement', edge: 'start' },
          endExclusive: { kind: 'event', event: 'mortgage_registered', edge: 'start' },
        },
      },
      refund: {
        kind: 'tagged_amount', tag: 'bridge_uplift_interest', percentage: '100.00000',
        at: { kind: 'event', event: 'mortgage_registered', edge: 'start' }, settlement: 'cash_credit',
      },
    },
  })
  const result = calculateMortgageOfferV2(bridgeOffer, scenario({
    events: { mortgageRegistered: { month: 0, edge: 'start' } },
  }))

  assert.equal(result.status, 'complete')
  assert.equal(result.schedule[1]?.annualRatePct, '6.00000')
  assert.equal(result.componentTotals.bridge_uplift_interest, undefined)
  assert.equal(result.totals.refunds, '0.00')
})

test('can apply the exact bridge refund as a principal credit', () => {
  const bridgeOffer = offer({
    bridgeInsurance: {
      id: 'bridge',
      mechanism: {
        kind: 'rate_uplift', upliftPctPoints: '1.00000', interestTag: 'bridge_uplift_interest',
        period: {
          from: { kind: 'event', event: 'first_disbursement', edge: 'start' },
          endExclusive: { kind: 'event', event: 'mortgage_registered', edge: 'start' },
        },
      },
      refund: {
        kind: 'tagged_amount', tag: 'bridge_uplift_interest', percentage: '100.00000',
        at: { kind: 'event', event: 'mortgage_registered', edge: 'start' }, settlement: 'principal_credit',
      },
    },
  })
  const result = calculateMortgageOfferV2(bridgeOffer, scenario({ events: { mortgageRegistered: { month: 4, edge: 'start' } } }))
  assert.equal(result.schedule[4]?.cashRefunds, '0.00')
  assert.ok(number(result.schedule[4]!.principalCredits) > 0)
  assert.equal(result.totals.refunds, result.schedule[4]?.principalCredits)
  assertLedger(result)
})

test('rejects bridge uplift without a tagged refund', () => {
  const validation = compileMortgageOfferV2(offer({
    bridgeInsurance: {
      id: 'bridge',
      mechanism: {
        kind: 'rate_uplift', upliftPctPoints: '1.00000', interestTag: 'bridge_uplift_interest',
        period: {
          from: { kind: 'event', event: 'first_disbursement', edge: 'start' },
          endExclusive: { kind: 'event', event: 'mortgage_registered', edge: 'start' },
        },
      },
      refund: { kind: 'none' },
    },
  }), scenario({ events: { mortgageRegistered: { month: 4, edge: 'start' } } }))

  assert.equal(validation.status, 'unsupported')
  assert.ok(validation.issues.some(entry => entry.code === 'missing_bridge_refund'))
})

test('rejects a partial bridge refund and an open-ended bridge period', () => {
  const validation = compileMortgageOfferV2(offer({
    bridgeInsurance: {
      id: 'bridge',
      mechanism: {
        kind: 'rate_uplift', upliftPctPoints: '1.00000', interestTag: 'bridge_uplift_interest',
        period: { from: { kind: 'event', event: 'first_disbursement', edge: 'start' } },
      },
      refund: {
        kind: 'tagged_amount', tag: 'bridge_uplift_interest', percentage: '50.00000',
        at: { kind: 'event', event: 'mortgage_registered', edge: 'start' }, settlement: 'cash_credit',
      },
    },
  }), scenario({ events: { mortgageRegistered: { month: 4, edge: 'start' } } }))

  assert.equal(validation.status, 'unsupported')
  assert.ok(validation.issues.some(entry => entry.code === 'missing_bridge_period_end'))
  assert.ok(validation.issues.some(entry => entry.code === 'partial_bridge_refund_unsupported'))
})

test('rejects a bridge refund scheduled before the uplift period ends', () => {
  const result = calculateMortgageOfferV2(offer({
    bridgeInsurance: {
      id: 'bridge',
      mechanism: {
        kind: 'rate_uplift', upliftPctPoints: '1.00000', interestTag: 'bridge_uplift_interest',
        period: {
          from: { kind: 'event', event: 'first_disbursement', edge: 'start' },
          endExclusive: { kind: 'event', event: 'mortgage_registered', edge: 'start' },
        },
      },
      refund: {
        kind: 'tagged_amount', tag: 'bridge_uplift_interest', percentage: '100.00000',
        at: { kind: 'month', month: 2, edge: 'start' }, settlement: 'cash_credit',
      },
    },
  }), scenario({ events: { mortgageRegistered: { month: 4, edge: 'start' } } }))

  assert.equal(result.status, 'unsupported')
  assert.equal(result.schedule.length, 0)
  assert.ok(result.issues.some(entry => entry.code === 'bridge_refund_before_period_end'))
})

test('rejects a bridge refund that resolves after the loan term', () => {
  const result = calculateMortgageOfferV2(offer({
    bridgeInsurance: {
      id: 'bridge',
      mechanism: {
        kind: 'rate_uplift', upliftPctPoints: '1.00000', interestTag: 'bridge_uplift_interest',
        period: {
          from: { kind: 'event', event: 'first_disbursement', edge: 'start' },
          endExclusive: { kind: 'event', event: 'mortgage_registered', edge: 'start' },
        },
      },
      refund: {
        kind: 'tagged_amount', tag: 'bridge_uplift_interest', percentage: '100.00000',
        at: { kind: 'event', event: 'mortgage_registered', offsetMonths: 400, edge: 'start' }, settlement: 'cash_credit',
      },
    },
  }), scenario({ events: { mortgageRegistered: { month: 4, edge: 'start' } } }))

  assert.equal(result.status, 'unsupported')
  assert.equal(result.schedule.length, 0)
  assert.ok(result.issues.some(entry => entry.code === 'bridge_refund_outside_term'))
})

test('fails closed when a principal-credit bridge refund cannot be fully applied', () => {
  const result = calculateMortgageOfferV2(offer({
    bridgeInsurance: {
      id: 'bridge',
      mechanism: {
        kind: 'rate_uplift', upliftPctPoints: '1.00000', interestTag: 'bridge_uplift_interest',
        period: {
          from: { kind: 'event', event: 'first_disbursement', edge: 'start' },
          endExclusive: { kind: 'event', event: 'mortgage_registered', edge: 'end' },
        },
      },
      refund: {
        kind: 'tagged_amount', tag: 'bridge_uplift_interest', percentage: '100.00000',
        at: { kind: 'event', event: 'mortgage_registered', edge: 'end' }, settlement: 'principal_credit',
      },
    },
  }), scenario({
    financing: { amount: '400000.00', amountMode: 'target_net_proceeds', termMonths: 12, installmentType: 'equal' },
    events: { mortgageRegistered: { month: 12, edge: 'start' } },
  }))

  assert.equal(result.status, 'unsupported')
  assert.ok(result.issues.some(entry => entry.code === 'incomplete_bridge_refund'))
})

test('rejects a bridge mechanism with reversed event semantics', () => {
  const result = calculateMortgageOfferV2(offer({
    bridgeInsurance: {
      id: 'bridge',
      mechanism: {
        kind: 'rate_uplift', upliftPctPoints: '1.00000', interestTag: 'bridge_uplift_interest',
        period: {
          from: { kind: 'event', event: 'mortgage_registered', edge: 'start' },
          endExclusive: { kind: 'event', event: 'first_disbursement', edge: 'start' },
        },
      },
      refund: {
        kind: 'tagged_amount', tag: 'bridge_uplift_interest', percentage: '100.00000',
        at: { kind: 'event', event: 'first_disbursement', edge: 'start' }, settlement: 'cash_credit',
      },
    },
  }), scenario({ events: { mortgageRegistered: { month: 4, edge: 'start' } } }))

  assert.equal(result.status, 'unsupported')
  assert.equal(result.schedule.length, 0)
  assert.ok(result.issues.some(entry => entry.code === 'invalid_bridge_period_start'))
  assert.ok(result.issues.some(entry => entry.code === 'invalid_bridge_period_end'))
})

test('does not treat an unknown cost as zero-priced complete data', () => {
  const unknownCost: MortgageCostRuleV2 = {
    id: 'unknown-bank-insurance', label: 'Nieznane ubezpieczenie', state: 'unknown', classification: 'conditional_cost',
    category: 'life_insurance', timing: { kind: 'once', at: { kind: 'month', month: 0, edge: 'start' } },
    settlement: { allowed: ['cash'], default: 'cash' }, includedInApr: true,
  }
  const result = calculateMortgageOfferV2(offer({ costs: [unknownCost] }), scenario())
  assert.equal(result.status, 'partial')
  assert.equal(result.totals.cashCosts, '0.00')
  assert.ok(result.issues.some(entry => entry.code === 'unknown_cost'))
})

test('uses gross principal for LTV eligibility when configured', () => {
  const result = calculateMortgageOfferV2(offer({
    eligibility: {
      ...offer().eligibility,
      maxLtvPct: '80.00000',
      ltvDebtBasis: 'gross_loan',
    },
    costs: [commission('net_loan_amount')],
  }), scenario({ property: { purchasePrice: '500000.00' } }))
  assert.equal(result.ltvPct, '81.60000')
  assert.equal(result.status, 'ineligible')
  assert.ok(result.issues.some(entry => entry.code === 'ltv_ineligible'))
})

test('uses the configured net LTV basis consistently while solving financed conditional costs', () => {
  const ltvConditional: MortgageCostRuleV2 = {
    id: 'high-ltv-fee',
    label: 'Dopłata za wysokie LTV',
    state: 'known',
    classification: 'credit_cost',
    category: 'other',
    formula: { kind: 'fixed', amount: '1000.00' },
    timing: { kind: 'once', at: { kind: 'event', event: 'first_disbursement', edge: 'start' } },
    when: { op: 'compare', field: 'ltv_pct', comparator: 'gt', value: '80.50000' },
    settlement: { allowed: ['capitalized'], default: 'capitalized' },
    includedInApr: true,
  }
  const result = calculateMortgageOfferV2(offer({
    eligibility: { ...offer().eligibility, ltvDebtBasis: 'net_loan' },
    costs: [commission('net_loan_amount'), ltvConditional],
  }), scenario({ property: { purchasePrice: '500000.00' } }))

  assert.equal(result.status, 'complete')
  assert.equal(result.ltvPct, '80.00000')
  assert.equal(result.grossLoanAmount, '408000.00')
  assert.equal(result.componentTotals['high-ltv-fee'], undefined)
  assertLedger(result)
})

test('rejects lower-payment overpayments when the offer does not recalculate after them', () => {
  const result = calculateMortgageOfferV2(offer({
    disbursementPolicy: {
      ...offer().disbursementPolicy,
      paymentRecalculationTriggers: ['rate_change', 'disbursement', 'grace_end'],
    },
  }), scenario({ monthlyOverpayment: '500.00', overpaymentStrategy: 'lower_payment' }))

  assert.equal(result.status, 'ineligible')
  assert.ok(result.issues.some(entry => entry.code === 'lower_payment_overpayment_not_supported'))
})

test('fully repays decreasing installments and preserves ledger invariants', () => {
  const result = calculateMortgageOfferV2(offer(), scenario({
    financing: { amount: '400000.00', amountMode: 'target_net_proceeds', termMonths: 120, installmentType: 'decreasing' },
  }))
  assert.equal(result.status, 'complete')
  assert.equal(result.schedule.at(-1)?.closingBalance, '0.00')
  assertLedger(result)
})

test('supports tranches with interest-only grace and replans after the final draw', () => {
  const result = calculateMortgageOfferV2(offer(), scenario({
    financing: { amount: '400000.00', amountMode: 'target_net_proceeds', termMonths: 120, installmentType: 'equal' },
    disbursements: [
      { id: 'first', month: 0, netAmount: '200000.00' },
      { id: 'second', month: 6, netAmount: '200000.00' },
    ],
    grace: {
      mode: 'interest_only',
      period: {
        from: { kind: 'month', month: 1, edge: 'start' },
        endExclusive: { kind: 'month', month: 7, edge: 'start' },
      },
    },
  }))
  assert.equal(result.status, 'complete')
  assert.equal(result.schedule[1]?.scheduledPrincipal, '0.00')
  assert.equal(result.schedule[6]?.netDisbursements, '200000.00')
  assert.equal(result.schedule[6]?.scheduledPrincipal, '0.00')
  assert.ok(number(result.schedule[7]!.scheduledPrincipal) > 0)
  assert.equal(result.schedule.at(-1)?.closingBalance, '0.00')
  assertLedger(result)
})
