import type {
  MortgageConditionV2,
  MortgageCostSettlementV2,
  MortgageInstallmentTypeV2,
  MortgageOfferVersionV2,
  MortgageScenarioV2,
} from '@openexpert/mortgage'

export interface MortgagePublicationScenario {
  id: string
  description: string
  scenario: MortgageScenarioV2
}

export interface MortgagePublicationScenarioMatrix {
  scenarios: MortgagePublicationScenario[]
  issues: Array<{
    kind: 'error'
    code: string
    path: string
    message: string
  }>
}

const MAX_PUBLICATION_SCENARIOS = 4_096

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values.filter(Number.isFinite).map(value => Math.round(value * 100) / 100))]
    .sort((left, right) => left - right)
}

function objectCombinations<TValue extends string>(
  axes: Array<Array<Record<string, TValue>>>,
  limit = MAX_PUBLICATION_SCENARIOS,
): { values: Array<Record<string, TValue>>, overflow: boolean } {
  let values: Array<Record<string, TValue>> = [{}]
  for (const axis of axes) {
    const next: Array<Record<string, TValue>> = []
    for (const base of values) {
      for (const choice of axis) {
        next.push({ ...base, ...choice })
        if (next.length > limit) return { values: next.slice(0, limit), overflow: true }
      }
    }
    values = next
  }
  return { values, overflow: false }
}

function collectConditionBoundaries(
  condition: MortgageConditionV2 | undefined,
  result: { amounts: number[], terms: number[], propertyValues: number[], ltvValues: number[] },
): void {
  if (!condition) return
  if (condition.op === 'compare') {
    const value = finiteNumber(condition.value, Number.NaN)
    if (!Number.isFinite(value)) return
    if (condition.field === 'term_months') result.terms.push(value - 1, value, value + 1)
    else if (condition.field === 'property_value') result.propertyValues.push(value - 0.01, value, value + 0.01)
    else if (condition.field === 'ltv_pct') result.ltvValues.push(value - 0.01, value, value + 0.01)
    else result.amounts.push(value - 0.01, value, value + 0.01)
    return
  }
  if (condition.op === 'not') return collectConditionBoundaries(condition.condition, result)
  if (condition.op === 'all' || condition.op === 'any') {
    condition.conditions.forEach(child => collectConditionBoundaries(child, result))
  }
}

function splitDisbursements(amount: number, count: number, termMonths: number): MortgageScenarioV2['disbursements'] {
  const totalCents = Math.round(amount * 100)
  const baseCents = Math.floor(totalCents / count)
  let allocatedCents = 0
  return Array.from({ length: count }, (_, index) => {
    const cents = index === count - 1 ? totalCents - allocatedCents : baseCents
    allocatedCents += cents
    const month = count === 1 ? 0 : Math.floor(index * Math.max(0, termMonths - 1) / (count - 1))
    return { id: `publication-tranche-${index + 1}`, month, netAmount: (cents / 100).toFixed(2) }
  })
}

function referencesMortgageRegistration(offer: MortgageOfferVersionV2): boolean {
  return Boolean(offer.bridgeInsurance) || JSON.stringify(offer).includes('mortgage_registered')
}

export function buildMortgagePublicationScenarioMatrix(
  offer: MortgageOfferVersionV2,
): MortgagePublicationScenarioMatrix {
  const issues: MortgagePublicationScenarioMatrix['issues'] = []
  const minAmount = Math.max(1, finiteNumber(offer.eligibility.minAmount, 1))
  const configuredMaxAmount = offer.eligibility.maxAmount == null
    ? null
    : finiteNumber(offer.eligibility.maxAmount, minAmount)
  const minTerm = Math.max(1, Math.round(finiteNumber(offer.eligibility.minTermMonths, 1)))
  const maxTerm = Math.max(minTerm, Math.round(finiteNumber(offer.eligibility.maxTermMonths, minTerm)))
  const conditionBoundaries = { amounts: [] as number[], terms: [] as number[], propertyValues: [] as number[], ltvValues: [] as number[] }
  offer.ratePlan.modifiers.forEach(modifier => collectConditionBoundaries(modifier.when, conditionBoundaries))
  offer.costs.forEach(cost => collectConditionBoundaries(cost.when, conditionBoundaries))

  const amountWithinLimits = (value: number) => value >= minAmount
    && (configuredMaxAmount == null || value <= configuredMaxAmount)
  const representativeAmount = configuredMaxAmount == null
    ? Math.max(100_000, minAmount)
    : Math.min(configuredMaxAmount, Math.max(100_000, minAmount))
  const amounts = uniqueNumbers([
    minAmount,
    representativeAmount,
    ...(configuredMaxAmount == null ? [] : [configuredMaxAmount]),
    ...conditionBoundaries.amounts,
  ]).filter(amountWithinLimits)
  const terms = uniqueNumbers([
    minTerm,
    maxTerm,
    ...conditionBoundaries.terms,
  ]).filter(value => Number.isInteger(value) && value >= minTerm && value <= maxTerm)
  const installmentTypes = [...new Set(offer.eligibility.allowedInstallmentTypes)] as MortgageInstallmentTypeV2[]

  const selectionMatrix = objectCombinations(offer.features.map(feature => {
    const options = feature.options.map(option => ({ [feature.id]: option.id }))
    return feature.required ? options : [{}, ...options]
  }))
  const settlementMatrix = objectCombinations(offer.costs
    .filter(cost => cost.state === 'known')
    .map(cost => cost.settlement.allowed.map(settlement => ({ [cost.id]: settlement }))))

  if (selectionMatrix.overflow || settlementMatrix.overflow) {
    issues.push({
      kind: 'error',
      code: 'publication_matrix_too_large',
      path: selectionMatrix.overflow ? 'features' : 'costs',
      message: 'The offer defines too many independent option combinations for exhaustive publication validation. Split it into separate products or reduce the number of freely combinable variants.',
    })
    return { scenarios: [], issues }
  }

  const estimatedCommercialScenarios = Math.max(1, amounts.length)
    * Math.max(1, terms.length)
    * Math.max(1, installmentTypes.length)
    * Math.max(1, selectionMatrix.values.length)
    * Math.max(1, settlementMatrix.values.length)
    * 2
  if (estimatedCommercialScenarios > MAX_PUBLICATION_SCENARIOS) {
    issues.push({
      kind: 'error',
      code: 'publication_matrix_too_large',
      path: '',
      message: `The exhaustive publication matrix contains ${estimatedCommercialScenarios} scenarios; the supported limit is ${MAX_PUBLICATION_SCENARIOS}. Split the configuration into separate offers or reduce independent variants.`,
    })
    return { scenarios: [], issues }
  }

  const scenarios: MortgagePublicationScenario[] = []
  const fingerprints = new Set<string>()
  const registrationRequired = referencesMortgageRegistration(offer)
  const defaultSelections: Record<string, string> = {
    ...(offer.presets.find(preset => preset.isDefault)?.selections ?? {}),
  }
  for (const feature of offer.features) {
    if (!(feature.id in defaultSelections) && feature.defaultOptionId) defaultSelections[feature.id] = feature.defaultOptionId
  }
  const defaultSettlements = Object.fromEntries(offer.costs
    .filter(cost => cost.state === 'known')
    .map(cost => [cost.id, cost.settlement.default])) as Record<string, MortgageCostSettlementV2>

  const pushScenario = (description: string, scenario: MortgageScenarioV2): void => {
    const fingerprint = JSON.stringify(scenario)
    if (fingerprints.has(fingerprint)) return
    if (scenarios.length >= MAX_PUBLICATION_SCENARIOS) {
      if (!issues.some(issue => issue.code === 'publication_matrix_too_large')) {
        issues.push({
          kind: 'error',
          code: 'publication_matrix_too_large',
          path: '',
          message: `The exhaustive publication matrix exceeds the supported limit of ${MAX_PUBLICATION_SCENARIOS} scenarios. Split the configuration into separate offers or reduce independent variants.`,
        })
      }
      return
    }
    fingerprints.add(fingerprint)
    scenarios.push({ id: `scenario-${scenarios.length + 1}`, description, scenario })
  }

  const propertyValueFor = (amount: number): number => {
    const maxLtv = Math.max(0.01, finiteNumber(offer.eligibility.maxLtvPct, 80))
    return Math.ceil(Math.max(amount * 1.25, amount * 100 / maxLtv * 1.1) * 100) / 100
  }
  const scenarioFor = (input: {
    amount: number
    amountMode: MortgageScenarioV2['financing']['amountMode']
    termMonths: number
    installmentType: MortgageInstallmentTypeV2
    selections: Record<string, string>
    costSettlements: Record<string, MortgageCostSettlementV2>
    propertyValue?: number
  }): MortgageScenarioV2 => {
    const propertyValue = input.propertyValue ?? propertyValueFor(input.amount)
    return {
      property: { purchasePrice: String(propertyValue), appraisalValue: String(propertyValue) },
      financing: {
        amount: String(input.amount),
        amountMode: input.amountMode,
        termMonths: input.termMonths,
        installmentType: input.installmentType,
      },
      selections: input.selections,
      costSettlements: input.costSettlements,
      disbursements: [],
      grace: { mode: 'none' },
      events: registrationRequired
        ? { mortgageRegistered: { month: Math.min(6, input.termMonths), edge: 'start' } }
        : {},
    }
  }

  for (const amount of amounts) {
    for (const termMonths of terms) {
      for (const installmentType of installmentTypes) {
        for (const selections of selectionMatrix.values) {
          for (const costSettlements of settlementMatrix.values) {
            for (const amountMode of ['target_net_proceeds', 'gross_facility'] as const) {
              pushScenario(
                `${amountMode}, ${amount}, ${termMonths} months, ${installmentType}`,
                scenarioFor({ amount, amountMode, termMonths, installmentType, selections, costSettlements }),
              )
            }
          }
        }
      }
    }
  }

  const baseAmount = representativeAmount
  const baseTerm = maxTerm
  const baseInstallment = installmentTypes[0] ?? 'equal'
  const base = () => scenarioFor({
    amount: baseAmount,
    amountMode: 'target_net_proceeds',
    termMonths: baseTerm,
    installmentType: baseInstallment,
    selections: defaultSelections,
    costSettlements: defaultSettlements,
  })

  if (registrationRequired) {
    for (const month of uniqueNumbers([0, 1, 6, Math.max(0, baseTerm - 1), baseTerm])) {
      const scenario = base()
      scenario.events = { mortgageRegistered: { month, edge: 'start' } }
      pushScenario(`mortgage registration at month ${month}`, scenario)
    }
  }

  for (const feature of offer.features) {
    for (const [index, fromOption] of feature.options.entries()) {
      const toOption = feature.options.find(option => option.id === fromOption.breachOptionId)
        ?? feature.options[(index + 1) % feature.options.length]
      if (!toOption || toOption.id === fromOption.id) continue
      const scenario = base()
      scenario.selections = { ...scenario.selections, [feature.id]: fromOption.id }
      scenario.selectionEvents = [{
        month: Math.min(Math.max(1, baseTerm - 1), 13),
        featureId: feature.id,
        optionId: toOption.id,
      }]
      pushScenario(`${feature.id}: ${fromOption.id} changes to ${toOption.id}`, scenario)
    }
  }

  const trancheCount = Math.min(Math.max(1, offer.disbursementPolicy.maxTranches), 12)
  if (trancheCount > 1) {
    const scenario = base()
    scenario.disbursements = splitDisbursements(baseAmount, trancheCount, baseTerm)
    pushScenario(`${trancheCount} disbursement tranches`, scenario)
  }

  for (const graceMode of offer.disbursementPolicy.supportedGraceModes) {
    if (graceMode === 'none') continue
    const scenario = base()
    scenario.grace = {
      mode: graceMode,
      period: {
        from: { kind: 'month', month: 1, edge: 'start' },
        endExclusive: { kind: 'month', month: Math.min(baseTerm + 1, 7), edge: 'start' },
      },
    }
    pushScenario(`${graceMode} grace`, scenario)
  }

  for (const propertyValue of uniqueNumbers(conditionBoundaries.propertyValues).filter(value => value > 0)) {
    pushScenario(`property value boundary ${propertyValue}`, scenarioFor({
      amount: baseAmount,
      amountMode: 'target_net_proceeds',
      termMonths: baseTerm,
      installmentType: baseInstallment,
      selections: defaultSelections,
      costSettlements: defaultSettlements,
      propertyValue,
    }))
  }
  for (const ltv of uniqueNumbers(conditionBoundaries.ltvValues).filter(value => value > 0)) {
    const propertyValue = Math.round(baseAmount * 100 / ltv * 100) / 100
    pushScenario(`LTV boundary ${ltv}`, scenarioFor({
      amount: baseAmount,
      amountMode: 'target_net_proceeds',
      termMonths: baseTerm,
      installmentType: baseInstallment,
      selections: defaultSelections,
      costSettlements: defaultSettlements,
      propertyValue,
    }))
  }

  return { scenarios, issues }
}
