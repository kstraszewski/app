import type {
  ActivePeriodV2,
  CompiledMortgagePlanV2,
  DecimalString,
  MortgageCalculationIssueV2,
  MortgageCalculationStatusV2,
  MortgageCalculationV2,
  MortgageCashFlowV2,
  MortgageConditionV2,
  MortgageCostBasisV2,
  MortgageCostFormulaV2,
  MortgageCostRuleV2,
  MortgageCostSettlementV2,
  MortgageOfferCompileResultV2,
  MortgageOfferValidationV2,
  MortgageOfferVersionV2,
  MortgageResolutionTraceEntryV2,
  MortgageScheduleRowV2,
  MortgageScenarioV2,
  TimelineAnchorV2,
} from './types-v2.ts'

const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/
const MONEY_EPSILON = 0.0000001

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasRuntimeOfferShape(value: unknown): value is MortgageOfferVersionV2 {
  if (!isRecord(value)) return false
  if (
    !isRecord(value.validity)
    || !isRecord(value.calculationPolicy)
    || !isRecord(value.calculationPolicy.rounding)
    || !isRecord(value.eligibility)
    || !isRecord(value.ratePlan)
    || !isRecord(value.disbursementPolicy)
    || !Array.isArray(value.eligibility.allowedInstallmentTypes)
    || !Array.isArray(value.ratePlan.phases)
    || !Array.isArray(value.ratePlan.modifiers)
    || !Array.isArray(value.features)
    || !Array.isArray(value.presets)
    || !Array.isArray(value.costs)
    || !Array.isArray(value.disbursementPolicy.supportedGraceModes)
    || !Array.isArray(value.disbursementPolicy.paymentRecalculationTriggers)
  ) return false
  if (value.features.some((feature: unknown) => !isRecord(feature) || !Array.isArray(feature.options))) return false
  if (value.presets.some((preset: unknown) => !isRecord(preset) || !isRecord(preset.selections))) return false
  if (value.ratePlan.phases.some((phase: unknown) => !isRecord(phase) || !isRecord(phase.period) || !isRecord(phase.formula))) return false
  if (value.ratePlan.modifiers.some((modifier: unknown) => !isRecord(modifier))) return false
  if (value.costs.some((cost: unknown) => (
    !isRecord(cost)
    || !isRecord(cost.timing)
    || !isRecord(cost.settlement)
    || !Array.isArray(cost.settlement.allowed)
    || (cost.formula !== undefined && !isRecord(cost.formula))
  ))) return false
  if (value.bridgeInsurance !== undefined && (
    !isRecord(value.bridgeInsurance)
    || !isRecord(value.bridgeInsurance.mechanism)
    || !isRecord(value.bridgeInsurance.mechanism.period)
    || !isRecord(value.bridgeInsurance.refund)
  )) return false
  return true
}

function enumValue(
  value: unknown,
  allowed: readonly unknown[],
  path: string,
  issues: MortgageCalculationIssueV2[],
): boolean {
  if (allowed.includes(value)) return true
  issue(issues, { kind: 'error', code: 'invalid_enum_value', path, message: `${path} contains an unsupported value.` })
  return false
}

// V2 intentionally has no decimal runtime dependency yet. Inputs and outputs
// are decimal strings, while the engine uses finite JS numbers and applies
// half-up currency rounding to every charged amount and schedule period.
// Bank schedules retaining sub-grosz balances can therefore differ by cents.
function roundHalfUp(value: number, scale: number): number {
  const factor = 10 ** scale
  const sign = value < 0 ? -1 : 1
  const scaled = Math.abs(value) * factor
  const binaryTolerance = Number.EPSILON * Math.max(1, scaled) * 4
  return sign * Math.floor(scaled + 0.5 + binaryTolerance) / factor
}

function money(value: number): number {
  return roundHalfUp(value, 2)
}

function moneyText(value: number): DecimalString {
  return money(value).toFixed(2)
}

function rateText(value: number): DecimalString {
  return roundHalfUp(value, 5).toFixed(5)
}

function issue(
  issues: MortgageCalculationIssueV2[],
  value: MortgageCalculationIssueV2,
): void {
  if (!issues.some(item => item.code === value.code && item.path === value.path)) issues.push(value)
}

function decimal(
  value: unknown,
  path: string,
  issues: MortgageCalculationIssueV2[],
  options: { min?: number, max?: number } = {},
): number | null {
  if (typeof value !== 'string' || !DECIMAL_PATTERN.test(value)) {
    issue(issues, { kind: 'error', code: 'invalid_decimal', path, message: `${path} must be a decimal string.` })
    return null
  }
  const parsed = Number(value)
  if (
    !Number.isFinite(parsed)
    || (options.min !== undefined && parsed < options.min)
    || (options.max !== undefined && parsed > options.max)
  ) {
    issue(issues, { kind: 'error', code: 'decimal_out_of_range', path, message: `${path} is outside the supported range.` })
    return null
  }
  return parsed
}

function integer(
  value: unknown,
  path: string,
  issues: MortgageCalculationIssueV2[],
  min: number,
  max: number,
): number | null {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    issue(issues, { kind: 'error', code: 'invalid_integer', path, message: `${path} must be an integer from ${min} to ${max}.` })
    return null
  }
  return value as number
}

function isoDate(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function validateAnchor(
  anchor: TimelineAnchorV2,
  path: string,
  issues: MortgageCalculationIssueV2[],
): void {
  if (!anchor || typeof anchor !== 'object') {
    issue(issues, { kind: 'error', code: 'invalid_timeline_anchor', path, message: 'A timeline anchor is required.' })
    return
  }
  if (anchor.edge !== 'start' && anchor.edge !== 'end') {
    issue(issues, { kind: 'error', code: 'invalid_timeline_edge', path: `${path}.edge`, message: 'A timeline edge must be start or end.' })
  }
  if (anchor.kind === 'month') {
    integer(anchor.month, `${path}.month`, issues, 0, 600)
    return
  }
  if (anchor.kind !== 'event' || !['first_disbursement', 'last_disbursement', 'mortgage_registered'].includes(anchor.event)) {
    issue(issues, { kind: 'error', code: 'invalid_timeline_event', path, message: 'The timeline event is unsupported.' })
    return
  }
  if (anchor.offsetMonths !== undefined) integer(anchor.offsetMonths, `${path}.offsetMonths`, issues, -600, 600)
}

function staticBoundary(anchor: TimelineAnchorV2): number | null {
  if (anchor.kind === 'month') return anchor.month + (anchor.edge === 'end' ? 1 : 0)
  if (anchor.event === 'first_disbursement') return (anchor.offsetMonths ?? 0) + (anchor.edge === 'end' ? 1 : 0)
  return null
}

function validatePeriod(
  period: ActivePeriodV2,
  path: string,
  issues: MortgageCalculationIssueV2[],
): void {
  if (!period || typeof period !== 'object' || !period.from) {
    issue(issues, { kind: 'error', code: 'invalid_active_period', path, message: 'An active period requires a start anchor.' })
    return
  }
  validateAnchor(period.from, `${path}.from`, issues)
  if (!period.endExclusive) return
  validateAnchor(period.endExclusive, `${path}.endExclusive`, issues)
  const from = staticBoundary(period.from)
  const end = staticBoundary(period.endExclusive)
  if (from !== null && end !== null && end <= from) {
    issue(issues, { kind: 'error', code: 'invalid_active_period_order', path, message: 'The end of an active period must be after its start.' })
  }
}

function validateCondition(
  condition: MortgageConditionV2 | undefined,
  path: string,
  offer: MortgageOfferVersionV2,
  issues: MortgageCalculationIssueV2[],
): void {
  if (!condition) return
  if (!isRecord(condition)) {
    issue(issues, { kind: 'error', code: 'invalid_condition', path, message: 'A condition must be an object.' })
    return
  }
  if (condition.op === 'selection_is') {
    if (typeof condition.featureId !== 'string' || typeof condition.optionId !== 'string') {
      issue(issues, { kind: 'error', code: 'invalid_selection_condition', path, message: 'A selection condition requires featureId and optionId.' })
      return
    }
    const feature = offer.features.find(item => item.id === condition.featureId)
    if (!feature || !feature.options.some(option => option.id === condition.optionId)) {
      issue(issues, { kind: 'error', code: 'unknown_condition_selection', path, message: 'A condition references an unknown feature option.' })
    }
    return
  }
  if (condition.op === 'not') {
    if (!isRecord(condition.condition)) {
      issue(issues, { kind: 'error', code: 'invalid_not_condition', path, message: 'A not condition requires a nested condition.' })
      return
    }
    validateCondition(condition.condition, `${path}.condition`, offer, issues)
    return
  }
  if (condition.op === 'all' || condition.op === 'any') {
    if (!Array.isArray(condition.conditions)) {
      issue(issues, { kind: 'error', code: 'invalid_condition_group', path, message: 'A condition group requires a conditions array.' })
      return
    }
    if (!condition.conditions.length) {
      issue(issues, { kind: 'error', code: 'empty_condition_group', path, message: 'A condition group must contain at least one condition.' })
    }
    condition.conditions.forEach((entry, index) => validateCondition(entry, `${path}.conditions.${index}`, offer, issues))
    return
  }
  if (condition.op === 'compare') {
    enumValue(condition.field, ['net_loan_amount', 'gross_loan_amount', 'term_months', 'ltv_pct', 'property_value'], `${path}.field`, issues)
    enumValue(condition.comparator, ['lt', 'lte', 'eq', 'gte', 'gt'], `${path}.comparator`, issues)
    decimal(condition.value, `${path}.value`, issues)
    return
  }
  issue(issues, { kind: 'error', code: 'unsupported_condition_operator', path: `${path}.op`, message: 'The condition operator is unsupported.' })
}

function statusFromIssues(issues: MortgageCalculationIssueV2[]): MortgageCalculationStatusV2 {
  if (issues.some(item => item.kind === 'error')) return 'unsupported'
  if (issues.some(item => item.kind === 'ineligible')) return 'ineligible'
  if (issues.some(item => item.kind === 'incomplete')) return 'partial'
  return 'complete'
}

export function validateMortgageOfferV2(offer: MortgageOfferVersionV2): MortgageOfferValidationV2 {
  const issues: MortgageCalculationIssueV2[] = []
  if (!hasRuntimeOfferShape(offer)) {
    issue(issues, { kind: 'error', code: 'invalid_offer_shape', path: '', message: 'The mortgage offer structure is incomplete or malformed.' })
    return { valid: false, issues }
  }
  if (offer.schemaVersion !== 'openexpert.mortgage-offer/2.0') {
    issue(issues, { kind: 'error', code: 'unsupported_schema', path: 'schemaVersion', message: 'Unsupported mortgage offer schema.' })
  }
  enumValue(offer.currency, ['PLN'], 'currency', issues)
  enumValue(offer.calculationPolicy.eventOrder, ['openexpert_v2'], 'calculationPolicy.eventOrder', issues)
  enumValue(offer.calculationPolicy.rounding.currencyScale, [2], 'calculationPolicy.rounding.currencyScale', issues)
  enumValue(offer.calculationPolicy.rounding.interest, ['half_up_each_period'], 'calculationPolicy.rounding.interest', issues)
  enumValue(offer.calculationPolicy.rounding.charges, ['half_up_each_charge'], 'calculationPolicy.rounding.charges', issues)
  enumValue(offer.calculationPolicy.rounding.balance, ['rounded', 'high_precision'], 'calculationPolicy.rounding.balance', issues)
  if (!isoDate(offer.validity.effectiveFrom)) issue(issues, { kind: 'error', code: 'invalid_effective_from', path: 'validity.effectiveFrom', message: 'The effective-from date is invalid.' })
  if (offer.validity.effectiveTo !== null && !isoDate(offer.validity.effectiveTo)) issue(issues, { kind: 'error', code: 'invalid_effective_to', path: 'validity.effectiveTo', message: 'The effective-to date is invalid.' })
  if (!isoDate(offer.validity.pricingAsOf)) issue(issues, { kind: 'error', code: 'invalid_pricing_as_of', path: 'validity.pricingAsOf', message: 'The pricing observation date is invalid.' })
  if (offer.validity.effectiveTo && offer.validity.effectiveTo < offer.validity.effectiveFrom) {
    issue(issues, { kind: 'error', code: 'invalid_validity_range', path: 'validity', message: 'The offer validity end cannot precede its start.' })
  }

  const minAmount = decimal(offer.eligibility.minAmount, 'eligibility.minAmount', issues, { min: 0 })
  const maxAmount = offer.eligibility.maxAmount === null
    ? null
    : decimal(offer.eligibility.maxAmount, 'eligibility.maxAmount', issues, { min: 0 })
  if (minAmount !== null && maxAmount !== null && maxAmount < minAmount) {
    issue(issues, { kind: 'error', code: 'invalid_amount_range', path: 'eligibility.maxAmount', message: 'The maximum amount cannot be below the minimum amount.' })
  }
  decimal(offer.eligibility.maxLtvPct, 'eligibility.maxLtvPct', issues, { min: 0 })
  enumValue(offer.eligibility.amountBasis, ['net_loan', 'gross_loan', 'facility_limit'], 'eligibility.amountBasis', issues)
  enumValue(offer.eligibility.ltvDebtBasis, ['net_loan', 'gross_loan', 'facility_limit'], 'eligibility.ltvDebtBasis', issues)
  enumValue(offer.eligibility.collateralValueBasis, ['purchase_price', 'appraisal_value', 'lower_of_purchase_and_appraisal'], 'eligibility.collateralValueBasis', issues)
  integer(offer.eligibility.minTermMonths, 'eligibility.minTermMonths', issues, 1, 600)
  integer(offer.eligibility.maxTermMonths, 'eligibility.maxTermMonths', issues, 1, 600)
  if (offer.eligibility.maxTermMonths < offer.eligibility.minTermMonths) {
    issue(issues, { kind: 'error', code: 'invalid_term_range', path: 'eligibility.maxTermMonths', message: 'The maximum term cannot be below the minimum term.' })
  }
  if (!offer.eligibility.allowedInstallmentTypes.length) {
    issue(issues, { kind: 'error', code: 'missing_installment_type', path: 'eligibility.allowedInstallmentTypes', message: 'At least one installment type must be available.' })
  }
  for (const [index, installmentType] of offer.eligibility.allowedInstallmentTypes.entries()) {
    enumValue(installmentType, ['equal', 'decreasing'], `eligibility.allowedInstallmentTypes.${index}`, issues)
  }
  if (new Set(offer.eligibility.allowedInstallmentTypes).size !== offer.eligibility.allowedInstallmentTypes.length) {
    issue(issues, { kind: 'error', code: 'duplicate_installment_type', path: 'eligibility.allowedInstallmentTypes', message: 'Installment types must be unique.' })
  }
  integer(offer.disbursementPolicy.maxTranches, 'disbursementPolicy.maxTranches', issues, 1, 100)
  for (const [index, graceMode] of offer.disbursementPolicy.supportedGraceModes.entries()) {
    enumValue(graceMode, ['none', 'interest_only', 'capitalize_interest'], `disbursementPolicy.supportedGraceModes.${index}`, issues)
  }
  for (const [index, trigger] of offer.disbursementPolicy.paymentRecalculationTriggers.entries()) {
    enumValue(trigger, ['rate_change', 'disbursement', 'grace_end', 'lower_payment_overpayment'], `disbursementPolicy.paymentRecalculationTriggers.${index}`, issues)
  }
  if (!offer.disbursementPolicy.supportedGraceModes.includes('none')) {
    issue(issues, { kind: 'error', code: 'missing_no_grace_mode', path: 'disbursementPolicy.supportedGraceModes', message: 'A mortgage offer must support calculation without a grace period.' })
  }
  if (new Set(offer.disbursementPolicy.paymentRecalculationTriggers).size !== offer.disbursementPolicy.paymentRecalculationTriggers.length) {
    issue(issues, { kind: 'error', code: 'duplicate_recalculation_trigger', path: 'disbursementPolicy.paymentRecalculationTriggers', message: 'Payment-recalculation triggers must be unique.' })
  }
  if (offer.calculationPolicy.accrual !== 'nominal_monthly_12') {
    issue(issues, { kind: 'error', code: 'unsupported_accrual', path: 'calculationPolicy.accrual', message: 'The dependency-free V2 engine currently supports nominal_monthly_12 accrual only.' })
  }
  if (offer.calculationPolicy.rounding.balance === 'high_precision') {
    issue(issues, { kind: 'error', code: 'unsupported_high_precision_balance', path: 'calculationPolicy.rounding.balance', message: 'High-precision balances cannot be published until the engine has a decimal runtime.' })
  }

  const featureIds = new Set<string>()
  for (const [index, feature] of offer.features.entries()) {
    if (typeof feature.id !== 'string' || !feature.id || featureIds.has(feature.id)) {
      issue(issues, { kind: 'error', code: 'duplicate_feature', path: `features.${index}.id`, message: 'Feature ids must be present and unique.' })
    }
    featureIds.add(feature.id)
    const optionIds = new Set(feature.options.map(option => isRecord(option) && typeof option.id === 'string' ? option.id : ''))
    if (feature.options.some(option => !isRecord(option) || typeof option.label !== 'string') || optionIds.size !== feature.options.length || optionIds.has('')) {
      issue(issues, { kind: 'error', code: 'duplicate_feature_option', path: `features.${index}.options`, message: 'Feature option ids must be present and unique.' })
    }
    if (feature.defaultOptionId && !optionIds.has(feature.defaultOptionId)) {
      issue(issues, { kind: 'error', code: 'unknown_default_option', path: `features.${index}.defaultOptionId`, message: 'The default feature option does not exist.' })
    }
    for (const [optionIndex, option] of feature.options.entries()) {
      if (option.monitoringEveryMonths !== undefined) {
        integer(option.monitoringEveryMonths, `features.${index}.options.${optionIndex}.monitoringEveryMonths`, issues, 1, 600)
      }
      if (option.breachOptionId && (!optionIds.has(option.breachOptionId) || option.breachOptionId === option.id)) {
        issue(issues, {
          kind: 'error',
          code: 'invalid_breach_option',
          path: `features.${index}.options.${optionIndex}.breachOptionId`,
          message: 'A breach option must reference a different option in the same feature.',
        })
      }
    }
  }

  const phaseIds = new Set<string>()
  for (const [index, phase] of offer.ratePlan.phases.entries()) {
    if (!phase.id || phaseIds.has(phase.id)) {
      issue(issues, { kind: 'error', code: 'duplicate_rate_phase', path: `ratePlan.phases.${index}.id`, message: 'Rate phase ids must be present and unique.' })
    }
    phaseIds.add(phase.id)
    validatePeriod(phase.period, `ratePlan.phases.${index}.period`, issues)
    if (phase.formula.kind === 'fixed') {
      decimal(phase.formula.ratePct, `ratePlan.phases.${index}.formula.ratePct`, issues, { min: 0, max: 100 })
    } else if (phase.formula.kind === 'index_plus_margin') {
      decimal(phase.formula.indexValuePct, `ratePlan.phases.${index}.formula.indexValuePct`, issues, { min: -100, max: 100 })
      decimal(phase.formula.marginPct, `ratePlan.phases.${index}.formula.marginPct`, issues, { min: -100, max: 100 })
      if (typeof phase.formula.indexCode !== 'string' || !phase.formula.indexCode.trim()) issue(issues, { kind: 'error', code: 'missing_index_code', path: `ratePlan.phases.${index}.formula.indexCode`, message: 'An indexed phase requires an index code.' })
      if (!isoDate(phase.formula.indexAsOf)) issue(issues, { kind: 'error', code: 'invalid_index_as_of', path: `ratePlan.phases.${index}.formula.indexAsOf`, message: 'The index observation date is invalid.' })
      if (phase.formula.resetEveryMonths !== null) integer(phase.formula.resetEveryMonths, `ratePlan.phases.${index}.formula.resetEveryMonths`, issues, 1, 600)
      if (phase.formula.indexFloorPct !== undefined) decimal(phase.formula.indexFloorPct, `ratePlan.phases.${index}.formula.indexFloorPct`, issues, { min: -100, max: 100 })
      if (phase.formula.nominalFloorPct !== undefined) decimal(phase.formula.nominalFloorPct, `ratePlan.phases.${index}.formula.nominalFloorPct`, issues, { min: 0, max: 100 })
      if (phase.formula.nominalCapPct !== undefined) decimal(phase.formula.nominalCapPct, `ratePlan.phases.${index}.formula.nominalCapPct`, issues, { min: 0, max: 100 })
      if (phase.formula.nominalFloorPct !== undefined && phase.formula.nominalCapPct !== undefined && Number(phase.formula.nominalCapPct) < Number(phase.formula.nominalFloorPct)) {
        issue(issues, { kind: 'error', code: 'invalid_nominal_rate_bounds', path: `ratePlan.phases.${index}.formula`, message: 'The nominal rate cap cannot be below its floor.' })
      }
    } else {
      issue(issues, { kind: 'error', code: 'unsupported_rate_formula', path: `ratePlan.phases.${index}.formula`, message: 'The rate formula is unsupported.' })
    }
  }
  if (!offer.ratePlan.phases.length) {
    issue(issues, { kind: 'error', code: 'missing_rate_phase', path: 'ratePlan.phases', message: 'At least one rate phase is required.' })
  }
  const maxTimelineMonth = Number.isInteger(offer.eligibility.maxTermMonths)
    ? Math.min(600, Math.max(1, offer.eligibility.maxTermMonths))
    : 600
  const staticallyResolvablePhases = offer.ratePlan.phases.every(phase => (
    staticBoundary(phase.period.from) !== null
    && (!phase.period.endExclusive || staticBoundary(phase.period.endExclusive) !== null)
  ))
  if (staticallyResolvablePhases) {
    for (let month = 1; month <= maxTimelineMonth; month += 1) {
      const active = offer.ratePlan.phases.filter((phase) => {
        const from = staticBoundary(phase.period.from)!
        const end = phase.period.endExclusive ? staticBoundary(phase.period.endExclusive)! : Number.POSITIVE_INFINITY
        return month >= from && month < end
      })
      if (active.length !== 1) {
        issue(issues, {
          kind: 'error',
          code: active.length ? 'overlapping_rate_phases' : 'rate_phase_gap',
          path: `ratePlan.phases.month.${month}`,
          message: `Month ${month} must resolve to exactly one rate phase.`,
        })
        break
      }
    }
  }

  for (const [index, modifier] of offer.ratePlan.modifiers.entries()) {
    enumValue(modifier.target, ['fixed_rate', 'margin', 'nominal_rate'], `ratePlan.modifiers.${index}.target`, issues)
    enumValue(modifier.operation, ['add_percentage_points', 'set_percent'], `ratePlan.modifiers.${index}.operation`, issues)
    decimal(modifier.value, `ratePlan.modifiers.${index}.value`, issues, { min: -100, max: 100 })
    if (modifier.period) validatePeriod(modifier.period, `ratePlan.modifiers.${index}.period`, issues)
    if (modifier.sourceFeatureId) {
      const feature = offer.features.find(item => item.id === modifier.sourceFeatureId)
      if (!feature || (modifier.sourceOptionId && !feature.options.some(option => option.id === modifier.sourceOptionId))) {
        issue(issues, { kind: 'error', code: 'unknown_modifier_feature', path: `ratePlan.modifiers.${index}`, message: 'A rate modifier references an unknown feature option.' })
      }
    } else if (modifier.sourceOptionId) {
      issue(issues, { kind: 'error', code: 'modifier_option_without_feature', path: `ratePlan.modifiers.${index}.sourceOptionId`, message: 'A source option requires a source feature.' })
    }
    validateCondition(modifier.when, `ratePlan.modifiers.${index}.when`, offer, issues)
  }

  const presetIds = new Set<string>()
  for (const [index, preset] of offer.presets.entries()) {
    if (!preset.id || presetIds.has(preset.id)) issue(issues, { kind: 'error', code: 'duplicate_preset', path: `presets.${index}.id`, message: 'Pricing preset ids must be present and unique.' })
    presetIds.add(preset.id)
    for (const [featureId, optionId] of Object.entries(preset.selections)) {
      const feature = offer.features.find(item => item.id === featureId)
      if (!feature || !feature.options.some(option => option.id === optionId)) {
        issue(issues, { kind: 'error', code: 'invalid_preset_selection', path: `presets.${index}.selections.${featureId}`, message: 'A pricing preset references an unknown feature option.' })
      }
    }
  }
  if (offer.presets.filter(preset => preset.isDefault).length > 1) {
    issue(issues, { kind: 'error', code: 'multiple_default_presets', path: 'presets', message: 'Only one pricing preset may be the default.' })
  }
  const defaultPreset = offer.presets.find(preset => preset.isDefault)
  for (const [index, feature] of offer.features.entries()) {
    if (feature.required && !feature.defaultOptionId && !defaultPreset?.selections[feature.id]) {
      issue(issues, { kind: 'error', code: 'required_feature_without_default', path: `features.${index}`, message: 'A required feature needs a default option or a default preset selection.' })
    }
  }

  const costIds = new Set<string>()
  for (const [index, cost] of offer.costs.entries()) {
    enumValue(cost.state, ['known', 'not_applicable', 'unknown'], `costs.${index}.state`, issues)
    enumValue(cost.classification, ['credit_cost', 'transaction_cost', 'conditional_cost', 'informational'], `costs.${index}.classification`, issues)
    enumValue(cost.category, ['commission', 'appraisal', 'court', 'tax', 'account', 'card', 'life_insurance', 'property_insurance', 'bridge_insurance', 'other'], `costs.${index}.category`, issues)
    enumValue(cost.timing.kind, ['once', 'recurring', 'per_disbursement'], `costs.${index}.timing.kind`, issues)
    enumValue(cost.settlement.default, ['cash', 'capitalized', 'withheld_from_disbursement'], `costs.${index}.settlement.default`, issues)
    for (const [settlementIndex, settlement] of cost.settlement.allowed.entries()) {
      enumValue(settlement, ['cash', 'capitalized', 'withheld_from_disbursement'], `costs.${index}.settlement.allowed.${settlementIndex}`, issues)
    }
    if (typeof cost.includedInApr !== 'boolean') {
      issue(issues, { kind: 'error', code: 'invalid_apr_classification', path: `costs.${index}.includedInApr`, message: 'The APR classification flag must be boolean.' })
    }
    if (!cost.id || costIds.has(cost.id)) {
      issue(issues, { kind: 'error', code: 'duplicate_cost', path: `costs.${index}.id`, message: 'Cost ids must be present and unique.' })
    }
    costIds.add(cost.id)
    if (cost.state === 'known' && !cost.formula) {
      issue(issues, { kind: 'error', code: 'known_cost_without_formula', path: `costs.${index}.formula`, message: 'A known cost requires a formula.' })
    }
    if (cost.state === 'unknown') {
      issue(issues, { kind: 'incomplete', code: 'unknown_cost', path: `costs.${index}`, message: `Cost ${cost.label} is unknown and is not treated as zero.` })
    }
    if (!cost.settlement.allowed.includes(cost.settlement.default)) {
      issue(issues, { kind: 'error', code: 'invalid_cost_settlement', path: `costs.${index}.settlement`, message: 'The default settlement must be allowed.' })
    }
    if (!cost.settlement.allowed.length) {
      issue(issues, { kind: 'error', code: 'missing_cost_settlement', path: `costs.${index}.settlement.allowed`, message: 'A cost must allow at least one settlement method.' })
    }
    validateCondition(cost.when, `costs.${index}.when`, offer, issues)
    if (cost.state === 'known' && cost.formula) validateFormula(cost.formula, `costs.${index}.formula`, issues)
    if (cost.timing.kind === 'once') {
      validateAnchor(cost.timing.at, `costs.${index}.timing.at`, issues)
      if (cost.state === 'known' && cost.timing.at.edge === 'end') {
        issue(issues, { kind: 'error', code: 'unsupported_cost_end_edge', path: `costs.${index}.timing.at.edge`, message: 'V2 currently supports start-edge one-off charges only.' })
      }
      const canBeFinanced = cost.settlement.allowed.some(settlement => settlement !== 'cash')
      const atFirstDisbursementStart = cost.timing.at.kind === 'event'
        && cost.timing.at.event === 'first_disbursement'
        && (cost.timing.at.offsetMonths ?? 0) === 0
        && cost.timing.at.edge === 'start'
      if (cost.state === 'known' && canBeFinanced && !atFirstDisbursementStart) {
        issue(issues, {
          kind: 'error',
          code: 'unsupported_financed_once_timing',
          path: `costs.${index}.timing.at`,
          message: 'A one-off cost that may be financed must be charged exactly at the start of the first disbursement.',
        })
      }
    }
    if (cost.timing.kind === 'recurring') {
      integer(cost.timing.everyMonths, `costs.${index}.timing.everyMonths`, issues, 1, 600)
      validatePeriod(cost.timing.period, `costs.${index}.timing.period`, issues)
      if (cost.settlement.allowed.some(settlement => settlement !== 'cash')) {
        issue(issues, {
          kind: 'error',
          code: 'non_cash_recurring_cost_unsupported',
          path: `costs.${index}.settlement.allowed`,
          message: 'V2 supports recurring costs as cash only; future financed charges require a separate facility-limit model.',
        })
      }
    }
    if (cost.timing.kind === 'per_disbursement' && cost.timing.period) validatePeriod(cost.timing.period, `costs.${index}.timing.period`, issues)
    if (
      cost.state === 'known'
      && cost.formula
      && cost.timing.kind !== 'recurring'
      && cost.settlement.allowed.some(settlement => settlement !== 'cash')
      && formulaUsesBasis(cost.formula, new Set(['opening_balance_after_draw', 'closing_balance']))
    ) {
      issue(issues, { kind: 'error', code: 'unsupported_financed_dynamic_balance_cost', path: `costs.${index}`, message: 'An upfront cost based on a dynamic balance cannot be capitalized or withheld in V2.' })
    }
  }

  if (offer.bridgeInsurance) {
    enumValue(offer.bridgeInsurance.mechanism.kind, ['rate_uplift'], 'bridgeInsurance.mechanism.kind', issues)
    enumValue(offer.bridgeInsurance.mechanism.interestTag, ['bridge_uplift_interest'], 'bridgeInsurance.mechanism.interestTag', issues)
    enumValue(offer.bridgeInsurance.refund.kind, ['none', 'tagged_amount'], 'bridgeInsurance.refund.kind', issues)
    decimal(offer.bridgeInsurance.mechanism.upliftPctPoints, 'bridgeInsurance.mechanism.upliftPctPoints', issues, { min: 0, max: 100 })
    validatePeriod(offer.bridgeInsurance.mechanism.period, 'bridgeInsurance.mechanism.period', issues)
    const bridgePeriodStart = offer.bridgeInsurance.mechanism.period.from
    if (
      !bridgePeriodStart
      || bridgePeriodStart.kind !== 'event'
      || bridgePeriodStart.event !== 'first_disbursement'
      || (bridgePeriodStart.offsetMonths ?? 0) !== 0
    ) {
      issue(issues, {
        kind: 'error',
        code: 'invalid_bridge_period_start',
        path: 'bridgeInsurance.mechanism.period.from',
        message: 'A bridge rate uplift must start at the first disbursement without an offset.',
      })
    }
    if (!offer.bridgeInsurance.mechanism.period.endExclusive) {
      issue(issues, {
        kind: 'error',
        code: 'missing_bridge_period_end',
        path: 'bridgeInsurance.mechanism.period.endExclusive',
        message: 'Bridge uplift must end at an explicit timeline anchor so the refundable amount can be closed.',
      })
    } else if (
      offer.bridgeInsurance.mechanism.period.endExclusive.kind !== 'event'
      || offer.bridgeInsurance.mechanism.period.endExclusive.event !== 'mortgage_registered'
      || (offer.bridgeInsurance.mechanism.period.endExclusive.offsetMonths ?? 0) !== 0
    ) {
      issue(issues, {
        kind: 'error',
        code: 'invalid_bridge_period_end',
        path: 'bridgeInsurance.mechanism.period.endExclusive',
        message: 'A bridge rate uplift must end at mortgage registration without an offset.',
      })
    }
    if (offer.bridgeInsurance.refund.kind === 'none') {
      issue(issues, {
        kind: 'error',
        code: 'missing_bridge_refund',
        path: 'bridgeInsurance.refund.kind',
        message: 'A bridge uplift must refund or credit the tagged additional interest.',
      })
    }
    if (offer.bridgeInsurance.refund.kind === 'tagged_amount') {
      enumValue(offer.bridgeInsurance.refund.tag, ['bridge_uplift_interest'], 'bridgeInsurance.refund.tag', issues)
      enumValue(offer.bridgeInsurance.refund.settlement, ['cash_credit', 'principal_credit'], 'bridgeInsurance.refund.settlement', issues)
      const refundPercentage = decimal(offer.bridgeInsurance.refund.percentage, 'bridgeInsurance.refund.percentage', issues, { min: 0, max: 100 })
      if (refundPercentage !== null && Math.abs(refundPercentage - 100) > MONEY_EPSILON) {
        issue(issues, {
          kind: 'error',
          code: 'partial_bridge_refund_unsupported',
          path: 'bridgeInsurance.refund.percentage',
          message: 'The current bridge model requires 100% of tagged additional interest to be refunded or credited.',
        })
      }
      validateAnchor(offer.bridgeInsurance.refund.at, 'bridgeInsurance.refund.at', issues)
    }
  }

  return { valid: !issues.some(item => item.kind === 'error'), issues }
}

function validateFormula(
  formula: MortgageCostFormulaV2,
  path: string,
  issues: MortgageCalculationIssueV2[],
): void {
  if (!isRecord(formula)) {
    issue(issues, { kind: 'error', code: 'invalid_cost_formula', path, message: 'A cost formula must be an object.' })
    return
  }
  if (formula.kind === 'fixed') decimal(formula.amount, `${path}.amount`, issues, { min: 0 })
  else if (formula.kind === 'percentage') {
    enumValue(formula.basis, ['net_loan_amount', 'gross_loan_amount', 'facility_limit', 'property_value', 'original_gross_principal', 'opening_balance_after_draw', 'closing_balance', 'current_disbursement'], `${path}.basis`, issues)
    enumValue(formula.ratePeriod, ['per_occurrence', 'annualized'], `${path}.ratePeriod`, issues)
    decimal(formula.ratePct, `${path}.ratePct`, issues, { min: 0, max: 100 })
    if (formula.minimum !== undefined) decimal(formula.minimum, `${path}.minimum`, issues, { min: 0 })
    if (formula.maximum !== undefined) decimal(formula.maximum, `${path}.maximum`, issues, { min: 0 })
    if (formula.minimum !== undefined && formula.maximum !== undefined && Number(formula.maximum) < Number(formula.minimum)) {
      issue(issues, { kind: 'error', code: 'invalid_formula_bounds', path, message: 'A formula maximum cannot be below its minimum.' })
    }
  } else if (formula.kind === 'sum') {
    if (!Array.isArray(formula.terms) || !formula.terms.length) {
      issue(issues, { kind: 'error', code: 'empty_formula_sum', path, message: 'A sum formula must contain at least one term.' })
      return
    }
    formula.terms.forEach((term, index) => validateFormula(term, `${path}.terms.${index}`, issues))
  } else {
    issue(issues, { kind: 'error', code: 'unsupported_cost_formula', path: `${path}.kind`, message: 'The cost formula is unsupported.' })
  }
}

function formulaUsesBasis(
  formula: MortgageCostFormulaV2,
  bases: Set<MortgageCostBasisV2>,
): boolean {
  if (formula.kind === 'percentage') return bases.has(formula.basis)
  return formula.kind === 'sum' && formula.terms.some(term => formulaUsesBasis(term, bases))
}

// Implemented below in the same module; declarations here make the public V2
// surface available while keeping legacy calculateMortgage entirely isolated.
export function compileMortgageOfferV2(
  offer: MortgageOfferVersionV2,
  scenario: MortgageScenarioV2,
): MortgageOfferCompileResultV2 {
  return compilePlan(offer, scenario)
}

export function calculateMortgageV2(plan: CompiledMortgagePlanV2): MortgageCalculationV2 {
  return runSchedule(plan)
}

export function calculateMortgageOfferV2(
  offer: MortgageOfferVersionV2,
  scenario: MortgageScenarioV2,
): MortgageCalculationV2 {
  const compiled = compileMortgageOfferV2(offer, scenario)
  if (compiled.plan) return calculateMortgageV2(compiled.plan)
  return emptyCalculation(compiled.status, compiled.issues)
}

type RuntimeEvents = {
  first_disbursement: { month: number, edge: 'start' | 'end' }
  last_disbursement: { month: number, edge: 'start' | 'end' }
  mortgage_registered?: { month: number, edge: 'start' | 'end' }
}

type ConditionContext = {
  netLoanAmount: number
  grossLoanAmount: number
  termMonths: number
  ltvPct: number
  propertyValue: number
  selections: Record<string, string>
}

type CostBases = {
  netLoanAmount: number
  grossLoanAmount: number
  facilityLimit: number
  propertyValue: number
  originalGrossPrincipal: number
  openingBalanceAfterDraw: number
  closingBalance: number
  currentDisbursement: number
}

function compilePlan(offer: MortgageOfferVersionV2, scenario: MortgageScenarioV2): MortgageOfferCompileResultV2 {
  const validation = validateMortgageOfferV2(offer)
  const issues = [...validation.issues]
  const trace: MortgageResolutionTraceEntryV2[] = []
  if (issues.some(item => item.kind === 'error')) {
    return { status: 'unsupported', issues, plan: null }
  }

  const requestedAmount = decimal(scenario.financing.amount, 'scenario.financing.amount', issues, { min: 0.01 })
  const purchasePrice = decimal(scenario.property.purchasePrice, 'scenario.property.purchasePrice', issues, { min: 0.01 })
  const termMonths = integer(scenario.financing.termMonths, 'scenario.financing.termMonths', issues, 1, 600)
  if (!offer.eligibility.allowedInstallmentTypes.includes(scenario.financing.installmentType)) {
    issue(issues, { kind: 'ineligible', code: 'installment_type_ineligible', path: 'scenario.financing.installmentType', message: 'The selected installment type is not available for this offer.' })
  }
  if (!offer.disbursementPolicy.supportedGraceModes.includes(scenario.grace.mode)) {
    issue(issues, { kind: 'ineligible', code: 'grace_mode_ineligible', path: 'scenario.grace.mode', message: 'The selected grace mode is not available for this offer.' })
  }
  if (scenario.grace.mode !== 'none' && !scenario.grace.period) {
    issue(issues, { kind: 'error', code: 'missing_grace_period', path: 'scenario.grace.period', message: 'A grace period is required for the selected grace mode.' })
  }
  if (scenario.monthlyOverpayment !== undefined) decimal(scenario.monthlyOverpayment, 'scenario.monthlyOverpayment', issues, { min: 0 })
  for (const [month, amount] of Object.entries(scenario.oneOffOverpayments ?? {})) {
    if (!/^\d+$/.test(month) || Number(month) < 1 || Number(month) > (termMonths ?? 600)) {
      issue(issues, { kind: 'error', code: 'invalid_overpayment_month', path: `scenario.oneOffOverpayments.${month}`, message: 'An overpayment month must be within the loan term.' })
    }
    decimal(amount, `scenario.oneOffOverpayments.${month}`, issues, { min: 0 })
  }
  const requestsLowerPayment = scenario.overpaymentStrategy === 'lower_payment'
    && (Number(scenario.monthlyOverpayment ?? '0') > 0
      || Object.values(scenario.oneOffOverpayments ?? {}).some(amount => Number(amount) > 0))
  if (requestsLowerPayment && !offer.disbursementPolicy.paymentRecalculationTriggers.includes('lower_payment_overpayment')) {
    issue(issues, {
      kind: 'ineligible',
      code: 'lower_payment_overpayment_not_supported',
      path: 'scenario.overpaymentStrategy',
      message: 'This offer does not recalculate the installment after an overpayment; use shorten_term instead.',
    })
  }
  for (const [code, shock] of Object.entries(scenario.referenceRateShocksPctPoints ?? {})) {
    decimal(shock, `scenario.referenceRateShocksPctPoints.${code}`, issues, { min: -100, max: 100 })
  }

  const selections = resolveSelections(offer, scenario, issues, trace)
  const selectionEvents = scenario.selectionEvents ?? []
  const selectionEventKeys = new Set<string>()
  for (const [index, event] of selectionEvents.entries()) {
    integer(event.month, `scenario.selectionEvents.${index}.month`, issues, 1, termMonths ?? 600)
    const feature = offer.features.find(item => item.id === event.featureId)
    if (!feature || !feature.options.some(option => option.id === event.optionId)) {
      issue(issues, {
        kind: 'error',
        code: 'unknown_selection_event_option',
        path: `scenario.selectionEvents.${index}`,
        message: 'A selection-change event references an unknown feature option.',
      })
    }
    const eventKey = `${event.featureId}:${event.month}`
    if (selectionEventKeys.has(eventKey)) {
      issue(issues, {
        kind: 'error',
        code: 'duplicate_selection_event',
        path: `scenario.selectionEvents.${index}`,
        message: 'Only one selection change per feature and month is allowed.',
      })
    }
    selectionEventKeys.add(eventKey)
  }
  const costSettlements = resolveCostSettlements(offer, scenario, issues, trace)
  const parsedDisbursements = scenario.disbursements.map((entry, index) => ({
    id: entry.id,
    month: integer(entry.month, `scenario.disbursements.${index}.month`, issues, 0, termMonths ?? 600) ?? 0,
    netAmount: decimal(entry.netAmount, `scenario.disbursements.${index}.netAmount`, issues, { min: 0.01 }) ?? 0,
  }))
  if (new Set(parsedDisbursements.map(entry => entry.id)).size !== parsedDisbursements.length || parsedDisbursements.some(entry => !entry.id)) {
    issue(issues, { kind: 'error', code: 'duplicate_disbursement', path: 'scenario.disbursements', message: 'Disbursement ids must be present and unique.' })
  }
  if (parsedDisbursements.length > offer.disbursementPolicy.maxTranches) {
    issue(issues, { kind: 'ineligible', code: 'too_many_disbursements', path: 'scenario.disbursements', message: 'The disbursement plan exceeds the offer tranche limit.' })
  }

  if (requestedAmount === null || purchasePrice === null || termMonths === null) {
    return { status: 'unsupported', issues, plan: null }
  }

  const provisionalDisbursements = parsedDisbursements.length
    ? parsedDisbursements
    : [{ id: 'initial', month: 0, netAmount: requestedAmount }]
  const firstMonth = Math.min(...provisionalDisbursements.map(entry => entry.month))
  const lastMonth = Math.max(...provisionalDisbursements.map(entry => entry.month))
  const rawMortgageRegistered = scenario.events.mortgageRegistered
  let mortgageRegistered: RuntimeEvents['mortgage_registered']
  if (rawMortgageRegistered !== undefined) {
    if (!isRecord(rawMortgageRegistered)) {
      issue(issues, {
        kind: 'error',
        code: 'invalid_mortgage_registration_event',
        path: 'scenario.events.mortgageRegistered',
        message: 'The mortgage registration event must contain a month and timeline edge.',
      })
    } else {
      const registrationMonth = integer(
        rawMortgageRegistered.month,
        'scenario.events.mortgageRegistered.month',
        issues,
        0,
        termMonths,
      )
      const validEdge = enumValue(
        rawMortgageRegistered.edge,
        ['start'],
        'scenario.events.mortgageRegistered.edge',
        issues,
      )
      if (registrationMonth !== null && validEdge) {
        mortgageRegistered = {
          month: registrationMonth,
          edge: 'start',
        }
      }
    }
  }
  const events: RuntimeEvents = {
    first_disbursement: { month: firstMonth, edge: 'start' },
    last_disbursement: { month: lastMonth, edge: 'start' },
    mortgage_registered: mortgageRegistered,
  }

  let propertyValue = purchasePrice
  const appraisal = scenario.property.appraisalValue === undefined
    ? null
    : decimal(scenario.property.appraisalValue, 'scenario.property.appraisalValue', issues, { min: 0.01 })
  if (offer.eligibility.collateralValueBasis === 'appraisal_value') {
    if (appraisal === null) {
      issue(issues, { kind: 'incomplete', code: 'missing_appraisal', path: 'scenario.property.appraisalValue', message: 'The appraisal value is required to determine LTV and was not treated as zero.' })
    } else propertyValue = appraisal
  } else if (offer.eligibility.collateralValueBasis === 'lower_of_purchase_and_appraisal') {
    if (appraisal === null) {
      issue(issues, { kind: 'incomplete', code: 'missing_appraisal', path: 'scenario.property.appraisalValue', message: 'The appraisal value is required to determine LTV and was not treated as zero.' })
    } else propertyValue = Math.min(purchasePrice, appraisal)
  }

  let netLoanAmount = requestedAmount
  let grossLoanAmount = requestedAmount
  if (scenario.financing.amountMode === 'target_net_proceeds') {
    for (let iteration = 0; iteration < 2_000; iteration += 1) {
      const financed = initialFinancedCostAmount(
        offer, scenario, selections, costSettlements, netLoanAmount, grossLoanAmount,
        propertyValue, events, provisionalDisbursements, issues,
      )
      const next = money(netLoanAmount + financed)
      if (Math.abs(next - grossLoanAmount) < 0.005) {
        grossLoanAmount = next
        break
      }
      grossLoanAmount = next
      if (iteration === 1_999 || grossLoanAmount > 10_000_000_000) {
        issue(issues, { kind: 'error', code: 'gross_loan_no_solution', path: 'costs', message: 'Financed costs do not yield a stable gross loan amount.' })
      }
    }
  } else {
    grossLoanAmount = requestedAmount
    netLoanAmount = requestedAmount
    for (let iteration = 0; iteration < 2_000; iteration += 1) {
      const solverDisbursements = parsedDisbursements.length
        ? parsedDisbursements
        : [{ id: 'initial', month: 0, netAmount: netLoanAmount }]
      const financed = initialFinancedCostAmount(
        offer, scenario, selections, costSettlements, netLoanAmount, grossLoanAmount,
        propertyValue, events, solverDisbursements, issues,
      )
      const next = money(grossLoanAmount - financed)
      if (next <= 0) {
        issue(issues, { kind: 'error', code: 'non_positive_net_loan', path: 'scenario.financing.amount', message: 'Financed costs consume the entire gross facility.' })
        break
      }
      if (Math.abs(next - netLoanAmount) < 0.005) {
        netLoanAmount = next
        break
      }
      netLoanAmount = next
      if (iteration === 1_999) {
        issue(issues, { kind: 'error', code: 'net_loan_no_solution', path: 'costs', message: 'Financed costs do not yield a stable net loan amount.' })
      }
    }
  }

  const initialFinancedCosts = money(grossLoanAmount - netLoanAmount)
  const disbursements = parsedDisbursements.length
    ? parsedDisbursements
    : [{ id: 'initial', month: 0, netAmount: netLoanAmount }]
  const disbursementTotal = money(disbursements.reduce((sum, entry) => sum + entry.netAmount, 0))
  if (Math.abs(disbursementTotal - netLoanAmount) >= 0.005) {
    issue(issues, { kind: 'error', code: 'disbursement_total_mismatch', path: 'scenario.disbursements', message: `Net disbursements must total ${moneyText(netLoanAmount)}.` })
  }

  const ltvDebt = ltvDebtAmount(offer, netLoanAmount, grossLoanAmount)
  const ltvPct = ltvDebt / propertyValue * 100
  const conditionContext: ConditionContext = { netLoanAmount, grossLoanAmount, termMonths, ltvPct, propertyValue, selections }
  validateConditionsAndTimeline(offer, scenario, conditionContext, events, issues)
  traceResolvedPricingRules(offer, conditionContext, issues, trace)
  evaluateEligibility(offer, scenario, conditionContext, issues, trace)

  const status = statusFromIssues(issues)
  if (status === 'unsupported') return { status, issues, plan: null }
  return {
    status,
    issues,
    plan: {
      offer,
      scenario,
      status,
      issues,
      trace,
      selections,
      netLoanAmount: money(netLoanAmount),
      grossLoanAmount: money(grossLoanAmount),
      initialFinancedCosts,
      propertyValue: money(propertyValue),
      ltvPct,
      disbursements,
      costSettlements,
    },
  }
}

function traceResolvedPricingRules(
  offer: MortgageOfferVersionV2,
  context: ConditionContext,
  issues: MortgageCalculationIssueV2[],
  trace: MortgageResolutionTraceEntryV2[],
): void {
  for (const [index, modifier] of offer.ratePlan.modifiers.entries()) {
    if (!modifierEnabled(modifier, context, issues, `ratePlan.modifiers.${index}.when`)) continue
    trace.push({
      sourceId: modifier.id,
      kind: 'rate',
      message: `${modifier.operation} ${modifier.target}: ${modifier.value} percentage points/percent.`,
      value: modifier.value,
    })
  }
  for (const [index, cost] of offer.costs.entries()) {
    if (cost.state === 'not_applicable') continue
    const active = cost.state === 'known' && conditionMatches(cost.when, context, issues, `costs.${index}.when`)
    trace.push({
      sourceId: cost.id,
      kind: 'cost',
      message: cost.state === 'unknown'
        ? `${cost.label}: unknown, excluded from numeric totals.`
        : `${cost.label}: ${active ? 'active' : 'inactive for this scenario'}.`,
    })
  }
}

function resolveSelections(
  offer: MortgageOfferVersionV2,
  scenario: MortgageScenarioV2,
  issues: MortgageCalculationIssueV2[],
  trace: MortgageResolutionTraceEntryV2[],
): Record<string, string> {
  const selections: Record<string, string> = {}
  const defaultPresets = offer.presets.filter(preset => preset.isDefault)
  if (defaultPresets.length > 1) issue(issues, { kind: 'error', code: 'multiple_default_presets', path: 'presets', message: 'Only one pricing preset may be the default.' })
  const preset = scenario.presetId
    ? offer.presets.find(item => item.id === scenario.presetId)
    : defaultPresets[0]
  if (scenario.presetId && !preset) issue(issues, { kind: 'error', code: 'unknown_preset', path: 'scenario.presetId', message: 'The selected pricing preset does not exist.' })
  if (preset) Object.assign(selections, preset.selections)
  for (const feature of offer.features) {
    if (!(feature.id in selections) && feature.defaultOptionId) selections[feature.id] = feature.defaultOptionId
  }
  Object.assign(selections, scenario.selections)

  const knownFeatures = new Set(offer.features.map(feature => feature.id))
  for (const featureId of Object.keys(selections)) {
    if (!knownFeatures.has(featureId)) issue(issues, { kind: 'error', code: 'unknown_feature_selection', path: `scenario.selections.${featureId}`, message: 'The selected feature does not exist.' })
  }
  for (const feature of offer.features) {
    const optionId = selections[feature.id]
    if (!optionId && feature.required) {
      issue(issues, { kind: 'error', code: 'required_selection_missing', path: `scenario.selections.${feature.id}`, message: `A selection is required for ${feature.label}.` })
    } else if (optionId && !feature.options.some(option => option.id === optionId)) {
      issue(issues, { kind: 'error', code: 'unknown_feature_option', path: `scenario.selections.${feature.id}`, message: `The selected option for ${feature.label} does not exist.` })
    } else if (optionId) {
      trace.push({ sourceId: `${feature.id}.${optionId}`, kind: 'selection', message: `${feature.label}: ${optionId}` })
    }
  }
  return selections
}

function resolveCostSettlements(
  offer: MortgageOfferVersionV2,
  scenario: MortgageScenarioV2,
  issues: MortgageCalculationIssueV2[],
  trace: MortgageResolutionTraceEntryV2[],
): Record<string, MortgageCostSettlementV2> {
  const result: Record<string, MortgageCostSettlementV2> = {}
  const costIds = new Set(offer.costs.map(cost => cost.id))
  for (const id of Object.keys(scenario.costSettlements)) {
    if (!costIds.has(id)) issue(issues, { kind: 'error', code: 'unknown_cost_settlement_override', path: `scenario.costSettlements.${id}`, message: 'The settlement override references an unknown cost.' })
  }
  for (const cost of offer.costs) {
    const settlement = scenario.costSettlements[cost.id] ?? cost.settlement.default
    if (!cost.settlement.allowed.includes(settlement)) {
      issue(issues, { kind: 'error', code: 'cost_settlement_not_allowed', path: `scenario.costSettlements.${cost.id}`, message: `${settlement} is not allowed for ${cost.label}.` })
    }
    result[cost.id] = settlement
    if (cost.state === 'known') trace.push({ sourceId: cost.id, kind: 'cost', message: `${cost.label}: ${settlement}` })
  }
  return result
}

function initialFinancedCostAmount(
  offer: MortgageOfferVersionV2,
  scenario: MortgageScenarioV2,
  selections: Record<string, string>,
  settlements: Record<string, MortgageCostSettlementV2>,
  netLoanAmount: number,
  grossLoanAmount: number,
  propertyValue: number,
  events: RuntimeEvents,
  disbursements: Array<{ month: number, netAmount: number }>,
  issues: MortgageCalculationIssueV2[],
): number {
  const context: Omit<ConditionContext, 'selections'> = {
    netLoanAmount,
    grossLoanAmount,
    termMonths: scenario.financing.termMonths,
    ltvPct: ltvDebtAmount(offer, netLoanAmount, grossLoanAmount) / propertyValue * 100,
    propertyValue,
  }
  let total = 0
  for (const [index, cost] of offer.costs.entries()) {
    if (cost.state !== 'known' || !cost.formula || settlements[cost.id] === 'cash') continue
    if (cost.timing.kind === 'once') {
      const anchor = resolveAnchor(cost.timing.at, events, scenario.financing.termMonths, issues, `costs.${index}.timing.at`)
      if (anchor.month !== events.first_disbursement.month || anchor.edge !== 'start') continue
      const occurrenceContext: ConditionContext = {
        ...context,
        selections: selectionsAtMonth(selections, scenario.selectionEvents, anchor.month),
      }
      if (!conditionMatches(cost.when, occurrenceContext, issues, `costs.${index}.when`)) continue
      const currentDisbursement = disbursements
        .filter(disbursement => disbursement.month === anchor.month)
        .reduce((sum, disbursement) => sum + disbursement.netAmount, 0)
      total += costCharge(cost.formula, basesFor(netLoanAmount, grossLoanAmount, propertyValue, netLoanAmount, netLoanAmount, currentDisbursement), 1, issues, `costs.${index}.formula`)
    } else if (cost.timing.kind === 'per_disbursement') {
      for (const disbursement of disbursements) {
        if (cost.timing.period && !periodContains(cost.timing.period, disbursement.month, events, scenario.financing.termMonths, issues, `costs.${index}.timing.period`)) continue
        const occurrenceContext: ConditionContext = {
          ...context,
          selections: selectionsAtMonth(selections, scenario.selectionEvents, disbursement.month),
        }
        if (!conditionMatches(cost.when, occurrenceContext, issues, `costs.${index}.when`)) continue
        total += costCharge(cost.formula, basesFor(netLoanAmount, grossLoanAmount, propertyValue, netLoanAmount, netLoanAmount, disbursement.netAmount), 1, issues, `costs.${index}.formula`)
      }
    }
  }
  return money(total)
}

function ltvDebtAmount(
  offer: MortgageOfferVersionV2,
  netLoanAmount: number,
  grossLoanAmount: number,
): number {
  return offer.eligibility.ltvDebtBasis === 'net_loan' ? netLoanAmount : grossLoanAmount
}

function basesFor(
  netLoanAmount: number,
  grossLoanAmount: number,
  propertyValue: number,
  openingBalanceAfterDraw: number,
  closingBalance: number,
  currentDisbursement: number,
): CostBases {
  return {
    netLoanAmount,
    grossLoanAmount,
    facilityLimit: grossLoanAmount,
    propertyValue,
    originalGrossPrincipal: grossLoanAmount,
    openingBalanceAfterDraw,
    closingBalance,
    currentDisbursement,
  }
}

function costCharge(
  formula: MortgageCostFormulaV2,
  bases: CostBases,
  intervalMonths: number,
  issues: MortgageCalculationIssueV2[],
  path: string,
): number {
  function raw(term: MortgageCostFormulaV2, termPath: string): number {
    if (term.kind === 'fixed') return decimal(term.amount, `${termPath}.amount`, issues, { min: 0 }) ?? 0
    if (term.kind === 'sum') return term.terms.reduce((sum, item, index) => sum + raw(item, `${termPath}.terms.${index}`), 0)
    const rate = decimal(term.ratePct, `${termPath}.ratePct`, issues, { min: 0, max: 100 }) ?? 0
    const basisMap: Record<keyof CostBases, number> = bases
    const keyMap: Record<string, keyof CostBases> = {
      net_loan_amount: 'netLoanAmount', gross_loan_amount: 'grossLoanAmount', facility_limit: 'facilityLimit',
      property_value: 'propertyValue', original_gross_principal: 'originalGrossPrincipal',
      opening_balance_after_draw: 'openingBalanceAfterDraw', closing_balance: 'closingBalance',
      current_disbursement: 'currentDisbursement',
    }
    let amount = basisMap[keyMap[term.basis]!] * rate / 100
    if (term.ratePeriod === 'annualized') amount *= intervalMonths / 12
    const minimum = term.minimum === undefined ? null : decimal(term.minimum, `${termPath}.minimum`, issues, { min: 0 })
    const maximum = term.maximum === undefined ? null : decimal(term.maximum, `${termPath}.maximum`, issues, { min: 0 })
    if (minimum !== null) amount = Math.max(minimum, amount)
    if (maximum !== null) amount = Math.min(maximum, amount)
    return amount
  }
  return money(raw(formula, path))
}

function formulaUsesClosingBalance(formula: MortgageCostFormulaV2): boolean {
  if (formula.kind === 'percentage') return formula.basis === 'closing_balance'
  return formula.kind === 'sum' && formula.terms.some(formulaUsesClosingBalance)
}

function conditionMatches(
  condition: MortgageConditionV2 | undefined,
  context: ConditionContext,
  issues: MortgageCalculationIssueV2[],
  path: string,
): boolean {
  if (!condition) return true
  if (condition.op === 'selection_is') return context.selections[condition.featureId] === condition.optionId
  if (condition.op === 'not') return !conditionMatches(condition.condition, context, issues, `${path}.condition`)
  if ('conditions' in condition) {
    const results = condition.conditions.map((item, index) => conditionMatches(item, context, issues, `${path}.conditions.${index}`))
    return condition.op === 'all' ? results.every(Boolean) : results.some(Boolean)
  }
  const expected = decimal(condition.value, `${path}.value`, issues) ?? Number.NaN
  const actual = ({
    net_loan_amount: context.netLoanAmount,
    gross_loan_amount: context.grossLoanAmount,
    term_months: context.termMonths,
    ltv_pct: context.ltvPct,
    property_value: context.propertyValue,
  } as Record<string, number>)[condition.field]!
  if (condition.comparator === 'lt') return actual < expected
  if (condition.comparator === 'lte') return actual <= expected
  if (condition.comparator === 'eq') return actual === expected
  if (condition.comparator === 'gte') return actual >= expected
  return actual > expected
}

function resolveAnchor(
  anchor: TimelineAnchorV2,
  events: RuntimeEvents,
  termMonths: number,
  issues: MortgageCalculationIssueV2[],
  path: string,
): { month: number, edge: 'start' | 'end' } {
  if (anchor.kind === 'month') return { month: anchor.month, edge: anchor.edge }
  const event = events[anchor.event]
  if (!event) {
    issue(issues, { kind: 'incomplete', code: `missing_event_${anchor.event}`, path, message: `${anchor.event} is unknown; it was not treated as month zero.` })
    return { month: termMonths + 1, edge: anchor.edge }
  }
  return { month: event.month + (anchor.offsetMonths ?? 0), edge: anchor.edge }
}

function anchorCanResolve(anchor: TimelineAnchorV2, events: RuntimeEvents): boolean {
  return anchor.kind === 'month' || Boolean(events[anchor.event])
}

function boundary(anchor: { month: number, edge: 'start' | 'end' }): number {
  return anchor.month + (anchor.edge === 'end' ? 1 : 0)
}

function periodContains(
  period: ActivePeriodV2,
  month: number,
  events: RuntimeEvents,
  termMonths: number,
  issues: MortgageCalculationIssueV2[],
  path: string,
): boolean {
  const from = boundary(resolveAnchor(period.from, events, termMonths, issues, `${path}.from`))
  const end = period.endExclusive
    ? boundary(resolveAnchor(period.endExclusive, events, termMonths, issues, `${path}.endExclusive`))
    : Number.POSITIVE_INFINITY
  return month >= from && month < end
}

function validateResolvedPeriodOrder(
  period: ActivePeriodV2,
  events: RuntimeEvents,
  termMonths: number,
  issues: MortgageCalculationIssueV2[],
  path: string,
): void {
  if (
    !period.endExclusive
    || !anchorCanResolve(period.from, events)
    || !anchorCanResolve(period.endExclusive, events)
  ) return
  const from = boundary(resolveAnchor(period.from, events, termMonths, issues, `${path}.from`))
  const end = boundary(resolveAnchor(period.endExclusive, events, termMonths, issues, `${path}.endExclusive`))
  if (end <= from) {
    issue(issues, {
      kind: 'error',
      code: 'invalid_resolved_active_period_order',
      path,
      message: 'The resolved end of an active period must be after its start.',
    })
  }
}

function validateConditionsAndTimeline(
  offer: MortgageOfferVersionV2,
  scenario: MortgageScenarioV2,
  context: ConditionContext,
  events: RuntimeEvents,
  issues: MortgageCalculationIssueV2[],
): void {
  for (const [index, phase] of offer.ratePlan.phases.entries()) {
    validateResolvedPeriodOrder(phase.period, events, scenario.financing.termMonths, issues, `ratePlan.phases.${index}.period`)
  }
  for (const [index, modifier] of offer.ratePlan.modifiers.entries()) {
    decimal(modifier.value, `ratePlan.modifiers.${index}.value`, issues, { min: -100, max: 100 })
    if (modifier.sourceFeatureId) {
      const feature = offer.features.find(item => item.id === modifier.sourceFeatureId)
      if (!feature || (modifier.sourceOptionId && !feature.options.some(option => option.id === modifier.sourceOptionId))) {
        issue(issues, { kind: 'error', code: 'unknown_modifier_feature', path: `ratePlan.modifiers.${index}`, message: 'A rate modifier references an unknown feature option.' })
      }
    }
    conditionMatches(modifier.when, context, issues, `ratePlan.modifiers.${index}.when`)
    if (modifier.period) {
      validateResolvedPeriodOrder(modifier.period, events, scenario.financing.termMonths, issues, `ratePlan.modifiers.${index}.period`)
    }
  }
  for (const [index, cost] of offer.costs.entries()) {
    if (cost.timing.kind === 'recurring') {
      validateResolvedPeriodOrder(cost.timing.period, events, scenario.financing.termMonths, issues, `costs.${index}.timing.period`)
    } else if (cost.timing.kind === 'per_disbursement' && cost.timing.period) {
      validateResolvedPeriodOrder(cost.timing.period, events, scenario.financing.termMonths, issues, `costs.${index}.timing.period`)
    }
  }
  if (scenario.grace.period) {
    validateResolvedPeriodOrder(scenario.grace.period, events, scenario.financing.termMonths, issues, 'scenario.grace.period')
  }
  for (let month = 1; month <= scenario.financing.termMonths; month += 1) {
    const monthContext: ConditionContext = {
      ...context,
      selections: selectionsAtMonth(context.selections, scenario.selectionEvents, month),
    }
    const phases = offer.ratePlan.phases.filter((phase, index) => periodContains(phase.period, month, events, scenario.financing.termMonths, issues, `ratePlan.phases.${index}.period`))
    if (phases.length !== 1) {
      issue(issues, { kind: 'error', code: phases.length ? 'overlapping_rate_phases' : 'rate_phase_gap', path: `ratePlan.phases.month.${month}`, message: `Month ${month} must resolve to exactly one rate phase.` })
      break
    }
    for (const target of ['fixed_rate', 'margin', 'nominal_rate'] as const) {
      const setters = offer.ratePlan.modifiers.filter((modifier, index) => (
        modifier.target === target
        && modifier.operation === 'set_percent'
        && modifierEnabled(modifier, monthContext, issues, `ratePlan.modifiers.${index}.when`)
        && (!modifier.period || periodContains(modifier.period, month, events, scenario.financing.termMonths, issues, `ratePlan.modifiers.${index}.period`))
      ))
      if (setters.length > 1) {
        issue(issues, { kind: 'error', code: 'conflicting_rate_setters', path: `ratePlan.modifiers.month.${month}.${target}`, message: `Multiple set_percent modifiers target ${target} in month ${month}.` })
      }
    }
  }
  if (offer.bridgeInsurance) {
    decimal(offer.bridgeInsurance.mechanism.upliftPctPoints, 'bridgeInsurance.mechanism.upliftPctPoints', issues, { min: 0, max: 100 })
    if (offer.bridgeInsurance.refund.kind === 'tagged_amount') decimal(offer.bridgeInsurance.refund.percentage, 'bridgeInsurance.refund.percentage', issues, { min: 0, max: 100 })
    periodContains(offer.bridgeInsurance.mechanism.period, 1, events, scenario.financing.termMonths, issues, 'bridgeInsurance.mechanism.period')
    if (offer.bridgeInsurance.refund.kind === 'tagged_amount') {
      const refundAt = resolveAnchor(offer.bridgeInsurance.refund.at, events, scenario.financing.termMonths, issues, 'bridgeInsurance.refund.at')
      const periodEndAnchor = offer.bridgeInsurance.mechanism.period.endExclusive
      if (
        periodEndAnchor
        && anchorCanResolve(offer.bridgeInsurance.refund.at, events)
        && anchorCanResolve(periodEndAnchor, events)
      ) {
        const periodEnd = resolveAnchor(periodEndAnchor, events, scenario.financing.termMonths, issues, 'bridgeInsurance.mechanism.period.endExclusive')
        if (refundAt.month < 0 || refundAt.month > scenario.financing.termMonths) {
          issue(issues, {
            kind: 'error',
            code: 'bridge_refund_outside_term',
            path: 'bridgeInsurance.refund.at',
            message: 'The bridge refund must occur within the calculated loan term.',
          })
        }
        if (boundary(refundAt) < boundary(periodEnd)) {
          issue(issues, {
            kind: 'error',
            code: 'bridge_refund_before_period_end',
            path: 'bridgeInsurance.refund.at',
            message: 'The bridge refund cannot occur before the uplift period has ended and all tagged interest is known.',
          })
        }
      }
    }
  }
}

function modifierEnabled(
  modifier: MortgageOfferVersionV2['ratePlan']['modifiers'][number],
  context: ConditionContext,
  issues: MortgageCalculationIssueV2[],
  path: string,
): boolean {
  if (modifier.sourceFeatureId && context.selections[modifier.sourceFeatureId] !== modifier.sourceOptionId) return false
  return conditionMatches(modifier.when, context, issues, path)
}

function evaluateEligibility(
  offer: MortgageOfferVersionV2,
  scenario: MortgageScenarioV2,
  context: ConditionContext,
  issues: MortgageCalculationIssueV2[],
  trace: MortgageResolutionTraceEntryV2[],
): void {
  const minimum = decimal(offer.eligibility.minAmount, 'eligibility.minAmount', issues, { min: 0 }) ?? 0
  const maximum = offer.eligibility.maxAmount === null ? null : decimal(offer.eligibility.maxAmount, 'eligibility.maxAmount', issues, { min: 0 })
  const amount = offer.eligibility.amountBasis === 'net_loan' ? context.netLoanAmount : context.grossLoanAmount
  if (amount < minimum - MONEY_EPSILON) issue(issues, { kind: 'ineligible', code: 'amount_below_minimum', path: 'scenario.financing.amount', message: 'The loan amount is below the offer minimum.' })
  if (maximum !== null && amount > maximum + MONEY_EPSILON) issue(issues, { kind: 'ineligible', code: 'amount_above_maximum', path: 'scenario.financing.amount', message: 'The loan amount exceeds the offer maximum.' })
  if (context.termMonths < offer.eligibility.minTermMonths || context.termMonths > offer.eligibility.maxTermMonths) {
    issue(issues, { kind: 'ineligible', code: 'term_ineligible', path: 'scenario.financing.termMonths', message: 'The selected term is outside offer limits.' })
  }
  const maxLtv = decimal(offer.eligibility.maxLtvPct, 'eligibility.maxLtvPct', issues, { min: 0 }) ?? 0
  if (context.ltvPct > maxLtv + MONEY_EPSILON) issue(issues, { kind: 'ineligible', code: 'ltv_ineligible', path: 'scenario.property', message: `LTV ${rateText(context.ltvPct)} exceeds ${rateText(maxLtv)}.` })
  trace.push({ sourceId: 'eligibility', kind: 'eligibility', message: `Amount ${moneyText(amount)}, LTV ${rateText(context.ltvPct)}%.` })
}

function selectionsAtMonth(
  initialSelections: Record<string, string>,
  events: MortgageScenarioV2['selectionEvents'],
  month: number,
): Record<string, string> {
  const selections = { ...initialSelections }
  for (const event of [...(events ?? [])].sort((left, right) => left.month - right.month)) {
    if (event.month > month) break
    selections[event.featureId] = event.optionId
  }
  return selections
}

function runSchedule(plan: CompiledMortgagePlanV2): MortgageCalculationV2 {
  const issues = [...plan.issues]
  const trace = [...plan.trace]
  const schedule: MortgageScheduleRowV2[] = []
  const cashFlows: MortgageCashFlowV2[] = []
  const componentNumbers: Record<string, number> = {}
  const termMonths = plan.scenario.financing.termMonths
  const firstMonth = Math.min(...plan.disbursements.map(entry => entry.month))
  const lastMonth = Math.max(...plan.disbursements.map(entry => entry.month))
  const events: RuntimeEvents = {
    first_disbursement: { month: firstMonth, edge: 'start' },
    last_disbursement: { month: lastMonth, edge: 'start' },
    mortgage_registered: plan.scenario.events.mortgageRegistered,
  }
  let balance = 0
  let equalPayment = 0
  let decreasingPrincipal = 0
  let amortizationEndMonth = termMonths
  let previousRate: number | null = null
  let previousGrace = false
  let previousOverpayment = 0
  let bridgeTaggedAccrued = 0
  let bridgeRefundApplied = false
  let repaidPrincipal = 0
  let totalInterest = 0
  let totalCashCosts = 0
  let totalOneOffCashCosts = 0
  let totalRecurringCashCosts = 0
  let totalCapitalizedCosts = 0
  let totalCreditCosts = 0
  let totalTransactionCosts = 0
  let totalConditionalCosts = 0
  let totalAprEligibleNonInterestCosts = 0
  let initialCashRequired = 0
  let totalRefunds = 0
  let borrowerTotalOutflow = 0
  let costFirstFiveYears = 0

  const refundAnchor = plan.offer.bridgeInsurance?.refund.kind === 'tagged_amount'
    ? resolveAnchor(plan.offer.bridgeInsurance.refund.at, events, termMonths, issues, 'bridgeInsurance.refund.at')
    : null

  for (let month = 0; month <= termMonths; month += 1) {
    const activeSelections = selectionsAtMonth(plan.selections, plan.scenario.selectionEvents, month)
    const conditionContext: ConditionContext = {
      netLoanAmount: plan.netLoanAmount,
      grossLoanAmount: plan.grossLoanAmount,
      termMonths,
      ltvPct: plan.ltvPct,
      propertyValue: plan.propertyValue,
      selections: activeSelections,
    }
    for (const selectionEvent of plan.scenario.selectionEvents?.filter(event => event.month === month) ?? []) {
      trace.push({
        month,
        sourceId: `${selectionEvent.featureId}.${selectionEvent.optionId}`,
        kind: 'selection',
        message: `Selection changed: ${selectionEvent.featureId} = ${selectionEvent.optionId}.`,
      })
    }
    const openingBalance = balance
    const disbursements = plan.disbursements.filter(entry => entry.month === month)
    const netDisbursements = money(disbursements.reduce((sum, entry) => sum + entry.netAmount, 0))
    balance = money(balance + netDisbursements)
    const balanceAfterDraw = balance
    if (netDisbursements > 0) {
      cashFlows.push({ month, sourceId: 'loan_disbursement', category: 'net_disbursement', direction: 'borrower_inflow', amount: moneyText(netDisbursements) })
    }

    let capitalizedCosts = 0
    let cashCosts = 0
    let rowCostTotal = 0
    const costBreakdownNumbers: Record<string, number> = {}
    const deferredClosingCosts: Array<{
      cost: MortgageCostRuleV2
      index: number
      intervalMonths: number
      currentDisbursement: number
    }> = []

    const applyCost = (cost: MortgageCostRuleV2, charge: number): void => {
      if (charge <= 0) return
      const settlement = plan.costSettlements[cost.id]!
      rowCostTotal = money(rowCostTotal + charge)
      costBreakdownNumbers[cost.id] = money((costBreakdownNumbers[cost.id] ?? 0) + charge)
      componentNumbers[cost.id] = money((componentNumbers[cost.id] ?? 0) + charge)
      if (cost.classification === 'credit_cost') totalCreditCosts = money(totalCreditCosts + charge)
      if (cost.classification === 'transaction_cost') totalTransactionCosts = money(totalTransactionCosts + charge)
      if (cost.classification === 'conditional_cost') totalConditionalCosts = money(totalConditionalCosts + charge)
      if (cost.includedInApr) totalAprEligibleNonInterestCosts = money(totalAprEligibleNonInterestCosts + charge)
      if (settlement === 'cash') {
        cashCosts = money(cashCosts + charge)
        totalCashCosts = money(totalCashCosts + charge)
        if (cost.timing.kind === 'recurring') totalRecurringCashCosts = money(totalRecurringCashCosts + charge)
        else totalOneOffCashCosts = money(totalOneOffCashCosts + charge)
        if (month <= firstMonth) initialCashRequired = money(initialCashRequired + charge)
        cashFlows.push({ month, sourceId: cost.id, category: 'cost', direction: 'borrower_outflow', amount: moneyText(charge) })
      } else {
        capitalizedCosts = money(capitalizedCosts + charge)
        totalCapitalizedCosts = money(totalCapitalizedCosts + charge)
        balance = money(balance + charge)
      }
    }

    for (const [index, cost] of plan.offer.costs.entries()) {
      if (cost.state !== 'known' || !cost.formula) continue
      if (!conditionMatches(cost.when, conditionContext, issues, `costs.${index}.when`)) continue
      const occurrences = costOccurrences(cost, month, disbursements, events, termMonths, issues, index)
      for (const occurrence of occurrences) {
        const bases = basesFor(
          plan.netLoanAmount,
          plan.grossLoanAmount,
          plan.propertyValue,
          balanceAfterDraw,
          balance,
          occurrence.currentDisbursement,
        )
        if (formulaUsesClosingBalance(cost.formula)) {
          deferredClosingCosts.push({
            cost,
            index,
            intervalMonths: occurrence.intervalMonths,
            currentDisbursement: occurrence.currentDisbursement,
          })
        } else {
          const charge = costCharge(cost.formula, bases, occurrence.intervalMonths, issues, `costs.${index}.formula`)
          applyCost(cost, charge)
        }
      }
    }

    let cashRefunds = 0
    let principalCredits = 0
    if (refundAnchor && refundAnchor.month === month && refundAnchor.edge === 'start' && !bridgeRefundApplied) {
      const refund = bridgeRefundAmount(plan, bridgeTaggedAccrued, issues)
      const applied = applyBridgeRefund(plan, month, refund, balance, cashFlows, trace)
      cashRefunds = applied.cash
      principalCredits = applied.principal
      balance = money(balance - applied.principal)
      bridgeRefundApplied = true
    }

    let annualRatePct = 0
    let interest = 0
    let bridgeTaggedInterest = 0
    let scheduledPrincipal = 0
    let scheduledPayment = 0
    let capitalizedInterest = 0
    let overpayment = 0

    if (month > 0 && balance > MONEY_EPSILON) {
      const rate = resolvedRate(plan, month, events, conditionContext, issues)
      if (!Number.isFinite(rate.annualRatePct) || rate.annualRatePct < 0) {
        issue(issues, { kind: 'error', code: 'invalid_resolved_rate', path: `ratePlan.month.${month}`, message: 'The resolved nominal rate is missing or negative; calculation stopped instead of using zero.' })
        break
      }
      annualRatePct = rate.annualRatePct
      if (previousRate === null || Math.abs(previousRate - annualRatePct) > 0.0000001) {
        trace.push({ month, sourceId: rate.phaseId, kind: 'rate', message: `Resolved nominal rate ${rateText(annualRatePct)}%.`, value: rateText(annualRatePct) })
      }

      const graceActive = plan.scenario.grace.mode !== 'none'
        && !!plan.scenario.grace.period
        && periodContains(plan.scenario.grace.period, month, events, termMonths, issues, 'scenario.grace.period')
      const balanceForInterest = balance
      interest = money(balanceForInterest * annualRatePct / 100 / 12)
      if (rate.bridgeUpliftPct > 0) {
        const withoutBridge = money(balanceForInterest * (annualRatePct - rate.bridgeUpliftPct) / 100 / 12)
        bridgeTaggedInterest = money(interest - withoutBridge)
        bridgeTaggedAccrued = money(bridgeTaggedAccrued + bridgeTaggedInterest)
        componentNumbers.bridge_uplift_interest = money((componentNumbers.bridge_uplift_interest ?? 0) + bridgeTaggedInterest)
      }

      if (graceActive && plan.scenario.grace.mode === 'capitalize_interest') {
        capitalizedInterest = interest
        balance = money(balance + interest)
      } else if (graceActive) {
        scheduledPayment = interest
      } else {
        const remainingMonths = amortizationEndMonth - month + 1
        const triggers = plan.offer.disbursementPolicy.paymentRecalculationTriggers
        const recalculate = previousRate === null
          || (triggers.includes('rate_change') && Math.abs((previousRate ?? annualRatePct) - annualRatePct) > 0.0000001)
          || (triggers.includes('disbursement') && netDisbursements > 0)
          || (triggers.includes('grace_end') && previousGrace)
          || (triggers.includes('lower_payment_overpayment')
            && plan.scenario.overpaymentStrategy === 'lower_payment'
            && previousOverpayment > 0)
        if (plan.scenario.financing.installmentType === 'equal') {
          if (recalculate || equalPayment <= 0) equalPayment = money(annuity(balance, annualRatePct, remainingMonths))
          scheduledPayment = money(Math.min(balance + interest, Math.max(equalPayment, interest)))
          scheduledPrincipal = money(Math.max(0, Math.min(balance, scheduledPayment - interest)))
        } else {
          if (recalculate || decreasingPrincipal <= 0) {
            decreasingPrincipal = money(balance / remainingAmortizingMonths(plan, month, events, issues, amortizationEndMonth))
          }
          scheduledPrincipal = money(Math.min(balance, decreasingPrincipal))
          scheduledPayment = money(scheduledPrincipal + interest)
        }
        balance = money(balance - scheduledPrincipal)
        const requestedOverpayment = scenarioOverpayment(plan.scenario, month, issues)
        overpayment = money(Math.min(balance, requestedOverpayment))
        balance = money(balance - overpayment)
        if (
          overpayment > 0
          && balance > MONEY_EPSILON
          && plan.scenario.overpaymentStrategy === 'shorten_term'
        ) {
          const remainingPaymentPeriods = plan.scenario.financing.installmentType === 'equal'
            ? equalPaymentPeriods(balance, annualRatePct, equalPayment)
            : Math.ceil(balance / decreasingPrincipal)
          amortizationEndMonth = Math.min(
            amortizationEndMonth,
            month + Math.max(1, remainingPaymentPeriods),
          )
        }
        if (month === amortizationEndMonth && balance > MONEY_EPSILON) {
          const balloon = balance
          scheduledPrincipal = money(scheduledPrincipal + balloon)
          scheduledPayment = money(scheduledPayment + balloon)
          balance = 0
        }
      }
      previousRate = annualRatePct
      previousGrace = graceActive
    } else {
      previousGrace = false
    }

    for (const deferred of deferredClosingCosts) {
      const charge = costCharge(deferred.cost.formula!, basesFor(
        plan.netLoanAmount, plan.grossLoanAmount, plan.propertyValue,
        balanceAfterDraw, balance, deferred.currentDisbursement,
      ), deferred.intervalMonths, issues, `costs.${deferred.index}.formula`)
      applyCost(deferred.cost, charge)
    }

    if (refundAnchor && refundAnchor.month === month && refundAnchor.edge === 'end' && !bridgeRefundApplied) {
      const refund = bridgeRefundAmount(plan, bridgeTaggedAccrued, issues)
      const applied = applyBridgeRefund(plan, month, refund, balance, cashFlows, trace)
      cashRefunds = money(cashRefunds + applied.cash)
      principalCredits = money(principalCredits + applied.principal)
      balance = money(balance - applied.principal)
      bridgeRefundApplied = true
    }

    if (month === termMonths && balance > MONEY_EPSILON && plan.scenario.grace.mode !== 'capitalize_interest') {
      scheduledPrincipal = money(scheduledPrincipal + balance)
      scheduledPayment = money(scheduledPayment + balance)
      balance = 0
    }

    const installmentCash = money(scheduledPayment + overpayment)
    const rowOutflow = money(installmentCash + cashCosts - cashRefunds)
    borrowerTotalOutflow = money(borrowerTotalOutflow + rowOutflow)
    repaidPrincipal = money(repaidPrincipal + scheduledPrincipal + overpayment)
    totalInterest = money(totalInterest + interest)
    totalRefunds = money(totalRefunds + cashRefunds + principalCredits)
    componentNumbers.interest = money((componentNumbers.interest ?? 0) + interest)
    if (cashRefunds + principalCredits > 0) componentNumbers.bridge_refund = money((componentNumbers.bridge_refund ?? 0) + cashRefunds + principalCredits)
    if (month <= 60) costFirstFiveYears = money(costFirstFiveYears + interest + rowCostTotal - cashRefunds - principalCredits)

    if (scheduledPrincipal > 0) cashFlows.push({ month, sourceId: 'scheduled_principal', category: 'principal', direction: 'borrower_outflow', amount: moneyText(scheduledPrincipal) })
    if (interest > 0 && capitalizedInterest === 0) cashFlows.push({ month, sourceId: 'interest', category: 'interest', direction: 'borrower_outflow', amount: moneyText(interest) })
    if (overpayment > 0) cashFlows.push({ month, sourceId: 'overpayment', category: 'overpayment', direction: 'borrower_outflow', amount: moneyText(overpayment) })

    const row: MortgageScheduleRowV2 = {
      month,
      annualRatePct: rateText(annualRatePct),
      openingBalance: moneyText(openingBalance),
      netDisbursements: moneyText(netDisbursements),
      capitalizedCosts: moneyText(capitalizedCosts),
      capitalizedInterest: moneyText(capitalizedInterest),
      scheduledPayment: moneyText(scheduledPayment),
      scheduledPrincipal: moneyText(scheduledPrincipal),
      interest: moneyText(interest),
      bridgeTaggedInterest: moneyText(bridgeTaggedInterest),
      overpayment: moneyText(overpayment),
      cashCosts: moneyText(cashCosts),
      cashRefunds: moneyText(cashRefunds),
      principalCredits: moneyText(principalCredits),
      borrowerCashOutflow: moneyText(rowOutflow),
      closingBalance: moneyText(balance),
      costBreakdown: Object.fromEntries(Object.entries(costBreakdownNumbers).map(([id, amount]) => [id, moneyText(amount)])),
    }
    schedule.push(row)
    previousOverpayment = overpayment
  }

  if (balance > 0.005) {
    issue(issues, { kind: 'incomplete', code: 'balance_remaining_at_maturity', path: 'schedule', message: `A balance of ${moneyText(balance)} remains at maturity.` })
  }
  if (Math.abs(totalCapitalizedCosts - plan.initialFinancedCosts) >= 0.005) {
    issue(issues, {
      kind: 'error',
      code: 'financed_cost_ledger_mismatch',
      path: 'costs',
      message: `The schedule capitalized ${moneyText(totalCapitalizedCosts)}, but the solved gross facility includes ${moneyText(plan.initialFinancedCosts)}.`,
    })
  }
  const bridgeRefund = plan.offer.bridgeInsurance?.refund
  if (
    bridgeRefund?.kind === 'tagged_amount'
    && anchorCanResolve(bridgeRefund.at, events)
    && refundAnchor
    && refundAnchor.month >= 0
    && refundAnchor.month <= termMonths
  ) {
    const expectedRefund = bridgeRefundAmount(plan, bridgeTaggedAccrued, issues)
    if (Math.abs(expectedRefund - totalRefunds) >= 0.005) {
      issue(issues, {
        kind: 'error',
        code: bridgeRefundApplied ? 'incomplete_bridge_refund' : 'bridge_refund_not_applied',
        path: 'bridgeInsurance.refund',
        message: `The schedule returned ${moneyText(totalRefunds)} of ${moneyText(expectedRefund)} tagged bridge interest.`,
      })
    }
  }
  const componentTotals = Object.fromEntries(Object.entries(componentNumbers).map(([id, amount]) => [id, moneyText(amount)]))
  const status = statusFromIssues(issues)
  return {
    status,
    issues,
    netLoanAmount: moneyText(plan.netLoanAmount),
    grossLoanAmount: moneyText(plan.grossLoanAmount),
    financedCosts: moneyText(plan.initialFinancedCosts),
    ltvPct: rateText(plan.ltvPct),
    resolvedSelections: selectionsAtMonth(plan.selections, plan.scenario.selectionEvents, termMonths),
    totals: {
      repaidPrincipal: moneyText(repaidPrincipal),
      interest: moneyText(totalInterest),
      cashCosts: moneyText(totalCashCosts),
      oneOffCashCosts: moneyText(totalOneOffCashCosts),
      recurringCashCosts: moneyText(totalRecurringCashCosts),
      capitalizedCosts: moneyText(totalCapitalizedCosts),
      creditCosts: moneyText(totalCreditCosts),
      transactionCosts: moneyText(totalTransactionCosts),
      conditionalCosts: moneyText(totalConditionalCosts),
      aprEligibleNonInterestCosts: moneyText(totalAprEligibleNonInterestCosts),
      initialCashRequired: moneyText(initialCashRequired),
      refunds: moneyText(totalRefunds),
      borrowerTotalOutflow: moneyText(borrowerTotalOutflow),
      borrowingCostOverNetAmount: moneyText(borrowerTotalOutflow - plan.netLoanAmount),
      costFirstFiveYears: moneyText(costFirstFiveYears),
    },
    componentTotals,
    schedule,
    cashFlows,
    resolutionTrace: trace,
  }
}

function costOccurrences(
  cost: MortgageCostRuleV2,
  month: number,
  disbursements: Array<{ month: number, netAmount: number }>,
  events: RuntimeEvents,
  termMonths: number,
  issues: MortgageCalculationIssueV2[],
  index: number,
): Array<{ intervalMonths: number, currentDisbursement: number }> {
  if (cost.timing.kind === 'once') {
    const at = resolveAnchor(cost.timing.at, events, termMonths, issues, `costs.${index}.timing.at`)
    return at.month === month ? [{ intervalMonths: 1, currentDisbursement: disbursements.reduce((sum, item) => sum + item.netAmount, 0) }] : []
  }
  if (cost.timing.kind === 'per_disbursement') {
    if (cost.timing.period && !periodContains(cost.timing.period, month, events, termMonths, issues, `costs.${index}.timing.period`)) return []
    return disbursements.map(item => ({ intervalMonths: 1, currentDisbursement: item.netAmount }))
  }
  if (!periodContains(cost.timing.period, month, events, termMonths, issues, `costs.${index}.timing.period`)) return []
  const start = boundary(resolveAnchor(cost.timing.period.from, events, termMonths, issues, `costs.${index}.timing.period.from`))
  return (month - start) % cost.timing.everyMonths === 0
    ? [{ intervalMonths: cost.timing.everyMonths, currentDisbursement: disbursements.reduce((sum, item) => sum + item.netAmount, 0) }]
    : []
}

function resolvedRate(
  plan: CompiledMortgagePlanV2,
  month: number,
  events: RuntimeEvents,
  context: ConditionContext,
  issues: MortgageCalculationIssueV2[],
): { annualRatePct: number, bridgeUpliftPct: number, phaseId: string } {
  const phase = plan.offer.ratePlan.phases.find((item, index) => periodContains(item.period, month, events, plan.scenario.financing.termMonths, issues, `ratePlan.phases.${index}.period`))!
  const activeModifiers = plan.offer.ratePlan.modifiers.filter((modifier, index) => (
    modifierEnabled(modifier, context, issues, `ratePlan.modifiers.${index}.when`)
    && (!modifier.period || periodContains(modifier.period, month, events, plan.scenario.financing.termMonths, issues, `ratePlan.modifiers.${index}.period`))
  ))
  const adjust = (base: number, target: 'fixed_rate' | 'margin' | 'nominal_rate'): number => {
    const relevant = activeModifiers.filter(modifier => modifier.target === target)
    const setter = relevant.find(modifier => modifier.operation === 'set_percent')
    const setValue = setter ? Number(setter.value) : base
    return relevant.filter(modifier => modifier.operation === 'add_percentage_points').reduce((value, modifier) => value + Number(modifier.value), setValue)
  }

  let nominal: number
  if (phase.formula.kind === 'fixed') nominal = adjust(Number(phase.formula.ratePct), 'fixed_rate')
  else {
    const shock = Number(plan.scenario.referenceRateShocksPctPoints?.[phase.formula.indexCode] ?? '0')
    let indexValue = Number(phase.formula.indexValuePct) + shock
    if (phase.formula.indexFloorPct !== undefined) indexValue = Math.max(indexValue, Number(phase.formula.indexFloorPct))
    const margin = adjust(Number(phase.formula.marginPct), 'margin')
    nominal = indexValue + margin
  }
  nominal = adjust(nominal, 'nominal_rate')
  if (phase.formula.kind === 'index_plus_margin') {
    if (phase.formula.nominalFloorPct !== undefined) nominal = Math.max(nominal, Number(phase.formula.nominalFloorPct))
    if (phase.formula.nominalCapPct !== undefined) nominal = Math.min(nominal, Number(phase.formula.nominalCapPct))
  }
  let bridgeUpliftPct = 0
  if (
    plan.offer.bridgeInsurance
    && periodContains(plan.offer.bridgeInsurance.mechanism.period, month, events, plan.scenario.financing.termMonths, issues, 'bridgeInsurance.mechanism.period')
  ) {
    bridgeUpliftPct = Number(plan.offer.bridgeInsurance.mechanism.upliftPctPoints)
    nominal += bridgeUpliftPct
  }
  return { annualRatePct: nominal, bridgeUpliftPct, phaseId: phase.id }
}

function bridgeRefundAmount(
  plan: CompiledMortgagePlanV2,
  taggedAccrued: number,
  issues: MortgageCalculationIssueV2[],
): number {
  const refund = plan.offer.bridgeInsurance?.refund
  if (!refund || refund.kind === 'none') return 0
  const percentage = decimal(refund.percentage, 'bridgeInsurance.refund.percentage', issues, { min: 0, max: 100 }) ?? 0
  return money(taggedAccrued * percentage / 100)
}

function applyBridgeRefund(
  plan: CompiledMortgagePlanV2,
  month: number,
  refundAmount: number,
  balance: number,
  cashFlows: MortgageCashFlowV2[],
  trace: MortgageResolutionTraceEntryV2[],
): { cash: number, principal: number } {
  const refund = plan.offer.bridgeInsurance?.refund
  if (!refund || refund.kind === 'none' || refundAmount <= 0) return { cash: 0, principal: 0 }
  trace.push({ month, sourceId: plan.offer.bridgeInsurance!.id, kind: 'refund', message: `Bridge refund ${moneyText(refundAmount)}.`, value: moneyText(refundAmount) })
  if (refund.settlement === 'cash_credit') {
    cashFlows.push({ month, sourceId: plan.offer.bridgeInsurance!.id, category: 'refund', direction: 'borrower_inflow', amount: moneyText(refundAmount) })
    return { cash: refundAmount, principal: 0 }
  }
  const principal = money(Math.min(balance, refundAmount))
  cashFlows.push({ month, sourceId: plan.offer.bridgeInsurance!.id, category: 'refund', direction: 'balance_adjustment', amount: moneyText(principal) })
  return { cash: 0, principal }
}

function remainingAmortizingMonths(
  plan: CompiledMortgagePlanV2,
  fromMonth: number,
  events: RuntimeEvents,
  issues: MortgageCalculationIssueV2[],
  throughMonth = plan.scenario.financing.termMonths,
): number {
  let count = 0
  for (let month = fromMonth; month <= throughMonth; month += 1) {
    const grace = plan.scenario.grace.mode !== 'none'
      && !!plan.scenario.grace.period
      && periodContains(plan.scenario.grace.period, month, events, plan.scenario.financing.termMonths, issues, 'scenario.grace.period')
    if (!grace) count += 1
  }
  return Math.max(1, count)
}

function equalPaymentPeriods(balance: number, annualRatePct: number, payment: number): number {
  if (balance <= MONEY_EPSILON) return 0
  if (payment <= MONEY_EPSILON) return Number.MAX_SAFE_INTEGER
  const monthlyRate = annualRatePct / 100 / 12
  if (Math.abs(monthlyRate) < 1e-12) return Math.ceil(balance / payment)
  const interest = balance * monthlyRate
  if (payment <= interest + MONEY_EPSILON) return Number.MAX_SAFE_INTEGER
  const periods = -Math.log(1 - interest / payment) / Math.log(1 + monthlyRate)
  return Math.max(1, Math.ceil(periods - 1e-12))
}

function scenarioOverpayment(
  scenario: MortgageScenarioV2,
  month: number,
  issues: MortgageCalculationIssueV2[],
): number {
  const monthly = scenario.monthlyOverpayment === undefined
    ? 0
    : decimal(scenario.monthlyOverpayment, 'scenario.monthlyOverpayment', issues, { min: 0 }) ?? 0
  const oneOffRaw = scenario.oneOffOverpayments?.[month]
  const oneOff = oneOffRaw === undefined
    ? 0
    : decimal(oneOffRaw, `scenario.oneOffOverpayments.${month}`, issues, { min: 0 }) ?? 0
  return money(monthly + oneOff)
}

function annuity(balance: number, annualRatePct: number, months: number): number {
  if (months <= 0) return balance
  const monthlyRate = annualRatePct / 100 / 12
  if (Math.abs(monthlyRate) < 1e-12) return balance / months
  return balance * monthlyRate * (1 + monthlyRate) ** months / ((1 + monthlyRate) ** months - 1)
}

function emptyCalculation(
  status: MortgageCalculationStatusV2,
  issues: MortgageCalculationIssueV2[],
): MortgageCalculationV2 {
  return {
    status,
    issues,
    netLoanAmount: '0.00',
    grossLoanAmount: '0.00',
    financedCosts: '0.00',
    ltvPct: '0.00000',
    resolvedSelections: {},
    totals: {
      repaidPrincipal: '0.00', interest: '0.00', cashCosts: '0.00', oneOffCashCosts: '0.00',
      recurringCashCosts: '0.00', capitalizedCosts: '0.00', creditCosts: '0.00',
      transactionCosts: '0.00', conditionalCosts: '0.00', aprEligibleNonInterestCosts: '0.00',
      initialCashRequired: '0.00', refunds: '0.00',
      borrowerTotalOutflow: '0.00', borrowingCostOverNetAmount: '0.00', costFirstFiveYears: '0.00',
    },
    componentTotals: {}, schedule: [], cashFlows: [], resolutionTrace: [],
  }
}
