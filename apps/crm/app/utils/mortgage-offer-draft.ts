import type {
  ActivePeriodV2,
  MortgageBridgeInsuranceV2,
  MortgageConditionV2,
  MortgageCostFormulaV2,
  MortgageCostSettlementV2,
  MortgageFeatureOptionV2,
  MortgageFeatureV2,
  MortgagePricingPresetV2,
  RateModifierV2,
  RatePhaseV2,
  TimelineAnchorV2,
} from '@openexpert/mortgage'
import type {
  DocumentRequirementV2,
  MortgageCostRuleDraftV2,
  MortgageOfferDraftDataV2,
  OfferSourceV2,
} from '~/types/mortgage-offer-draft'

type JsonObject = Record<string, unknown>

function record(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {}
}

function isoDate(value?: string): string {
  if (value && /^\d{4}-\d{2}-\d{2}$/u.test(value)) return value
  return new Date().toISOString().slice(0, 10)
}

export function mortgageDraftId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 8)
  return `${prefix}-${Date.now().toString(36)}-${random}`
}

export function monthAnchor(month: number, edge: 'start' | 'end' = 'start'): TimelineAnchorV2 {
  return { kind: 'month', month, edge }
}

export function eventAnchor(
  event: 'first_disbursement' | 'last_disbursement' | 'mortgage_registered',
  offsetMonths = 0,
  edge: 'start' | 'end' = 'start',
): TimelineAnchorV2 {
  return { kind: 'event', event, offsetMonths, edge }
}

export function createActivePeriodV2(): ActivePeriodV2 {
  return { from: monthAnchor(1), endExclusive: undefined }
}

function unknownCost(
  id: string,
  label: string,
  category: MortgageCostRuleDraftV2['category'],
  classification: MortgageCostRuleDraftV2['classification'],
  settlements: MortgageCostSettlementV2[],
): MortgageCostRuleDraftV2 {
  return {
    id,
    label,
    category,
    state: 'unknown',
    classification,
    timing: { kind: 'once', at: eventAnchor('first_disbursement') },
    settlement: { allowed: settlements, default: settlements[0] ?? 'cash' },
    includedInApr: classification === 'credit_cost',
  }
}

export function createDefaultMortgageOfferV2(input: {
  currency?: 'PLN'
  validFrom?: string
} = {}): MortgageOfferDraftDataV2 {
  const effectiveFrom = isoDate(input.validFrom)
  return {
    schemaVersion: 'openexpert.mortgage-offer/2.0',
    currency: input.currency ?? 'PLN',
    validity: {
      effectiveFrom,
      effectiveTo: null,
      pricingAsOf: effectiveFrom,
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
      minAmount: '50000',
      maxAmount: null,
      amountBasis: 'net_loan',
      minTermMonths: 60,
      maxTermMonths: 420,
      allowedInstallmentTypes: ['equal', 'decreasing'],
      maxLtvPct: '90',
      ltvDebtBasis: 'gross_loan',
      collateralValueBasis: 'lower_of_purchase_and_appraisal',
    },
    ratePlan: {
      phases: [],
      modifiers: [],
    },
    features: [],
    presets: [],
    costs: [
      unknownCost('commission', 'Prowizja za udzielenie', 'commission', 'credit_cost', ['cash', 'capitalized', 'withheld_from_disbursement']),
      unknownCost('appraisal', 'Wycena nieruchomości', 'appraisal', 'credit_cost', ['cash']),
      unknownCost('court-fee', 'Opłata sądowa', 'court', 'transaction_cost', ['cash']),
      unknownCost('pcc-tax', 'PCC / podatek od transakcji', 'tax', 'transaction_cost', ['cash']),
      unknownCost('notary', 'Koszty notarialne', 'other', 'transaction_cost', ['cash']),
      unknownCost('property-insurance', 'Ubezpieczenie nieruchomości', 'property_insurance', 'conditional_cost', ['cash']),
      unknownCost('life-insurance', 'Ubezpieczenie na życie', 'life_insurance', 'conditional_cost', ['cash', 'capitalized']),
      unknownCost('account', 'Konto osobiste', 'account', 'conditional_cost', ['cash']),
      unknownCost('card', 'Karta płatnicza', 'card', 'conditional_cost', ['cash']),
    ],
    disbursementPolicy: {
      maxTranches: 1,
      supportedGraceModes: ['none', 'interest_only'],
      paymentRecalculationTriggers: ['rate_change', 'disbursement', 'grace_end', 'lower_payment_overpayment'],
    },
    documentation: {
      requirements: [],
      sources: [],
    },
  }
}

export function normalizeMortgageOfferDraftV2(value: unknown): MortgageOfferDraftDataV2 {
  const source = record(value)
  const defaults = createDefaultMortgageOfferV2({
    currency: source.currency === 'PLN' ? 'PLN' : undefined,
    validFrom: typeof record(source.validity).effectiveFrom === 'string'
      ? String(record(source.validity).effectiveFrom)
      : undefined,
  })
  const validity = record(source.validity)
  const calculationPolicy = record(source.calculationPolicy)
  const rounding = record(calculationPolicy.rounding)
  const eligibility = record(source.eligibility)
  const ratePlan = record(source.ratePlan)
  const disbursementPolicy = record(source.disbursementPolicy)
  const documentation = record(source.documentation)

  return {
    ...defaults,
    ...source,
    schemaVersion: 'openexpert.mortgage-offer/2.0',
    currency: 'PLN',
    validity: { ...defaults.validity, ...validity },
    calculationPolicy: {
      ...defaults.calculationPolicy,
      ...calculationPolicy,
      rounding: { ...defaults.calculationPolicy.rounding, ...rounding },
    },
    eligibility: { ...defaults.eligibility, ...eligibility },
    ratePlan: {
      phases: Array.isArray(ratePlan.phases) ? ratePlan.phases as RatePhaseV2[] : [],
      modifiers: Array.isArray(ratePlan.modifiers) ? ratePlan.modifiers as RateModifierV2[] : [],
    },
    features: Array.isArray(source.features) ? source.features as MortgageFeatureV2[] : [],
    presets: Array.isArray(source.presets) ? source.presets as MortgagePricingPresetV2[] : [],
    costs: Array.isArray(source.costs) ? source.costs as MortgageCostRuleDraftV2[] : defaults.costs,
    bridgeInsurance: source.bridgeInsurance
      ? source.bridgeInsurance as MortgageBridgeInsuranceV2
      : undefined,
    disbursementPolicy: { ...defaults.disbursementPolicy, ...disbursementPolicy },
    documentation: {
      requirements: Array.isArray(documentation.requirements)
        ? documentation.requirements as DocumentRequirementV2[]
        : [],
      sources: Array.isArray(documentation.sources)
        ? (documentation.sources as OfferSourceV2[]).map((source, index) => ({
            ...source,
            id: source.id || `source-${index + 1}`,
          }))
        : [],
    },
  } as MortgageOfferDraftDataV2
}

export function cloneMortgageOfferDraftV2(value: MortgageOfferDraftDataV2): MortgageOfferDraftDataV2 {
  return JSON.parse(JSON.stringify(value)) as MortgageOfferDraftDataV2
}

export function createRatePhaseV2(kind: 'fixed' | 'index_plus_margin'): RatePhaseV2 {
  return {
    id: mortgageDraftId('rate'),
    period: createActivePeriodV2(),
    formula: kind === 'fixed'
      ? { kind: 'fixed', ratePct: '' }
      : {
          kind: 'index_plus_margin',
          indexCode: 'POLSTR_3M',
          indexValuePct: '',
          indexAsOf: isoDate(),
          marginPct: '',
          resetEveryMonths: 3,
        },
  }
}

export function createRateModifierV2(): RateModifierV2 {
  return {
    id: mortgageDraftId('modifier'),
    target: 'margin',
    operation: 'add_percentage_points',
    value: '',
  }
}

export function createMortgageFeatureOptionV2(label = 'Tak'): MortgageFeatureOptionV2 {
  return { id: mortgageDraftId('option'), label, obligations: [] }
}

export function createMortgageFeatureV2(): MortgageFeatureV2 {
  const no = createMortgageFeatureOptionV2('Bez produktu')
  const yes = createMortgageFeatureOptionV2('Z produktem')
  return {
    id: mortgageDraftId('feature'),
    label: 'Nowy warunek oferty',
    required: false,
    defaultOptionId: no.id,
    options: [no, yes],
  }
}

export function createMortgagePresetV2(features: MortgageFeatureV2[]): MortgagePricingPresetV2 {
  return {
    id: mortgageDraftId('preset'),
    label: 'Nowy wariant',
    selections: Object.fromEntries(features
      .filter(feature => feature.defaultOptionId)
      .map(feature => [feature.id, feature.defaultOptionId!])),
    isDefault: false,
  }
}

export function createMortgageCostV2(): MortgageCostRuleDraftV2 {
  return {
    id: mortgageDraftId('cost'),
    label: 'Nowy koszt',
    category: 'other',
    state: 'unknown',
    classification: 'credit_cost',
    timing: { kind: 'once', at: eventAnchor('first_disbursement') },
    settlement: { allowed: ['cash'], default: 'cash' },
    includedInApr: true,
  }
}

export function fixedCostFormulaV2(): MortgageCostFormulaV2 {
  return { kind: 'fixed', amount: '' }
}

export function percentageCostFormulaV2(): MortgageCostFormulaV2 {
  return {
    kind: 'percentage',
    ratePct: '',
    basis: 'net_loan_amount',
    ratePeriod: 'per_occurrence',
  }
}

export function createBridgeInsuranceV2(): MortgageBridgeInsuranceV2 {
  return {
    id: 'bridge-insurance',
    mechanism: {
      kind: 'rate_uplift',
      upliftPctPoints: '',
      period: {
        from: eventAnchor('first_disbursement'),
        endExclusive: eventAnchor('mortgage_registered'),
      },
      interestTag: 'bridge_uplift_interest',
    },
    refund: {
      kind: 'tagged_amount',
      tag: 'bridge_uplift_interest',
      percentage: '100',
      at: eventAnchor('mortgage_registered', 1),
      settlement: 'cash_credit',
    },
  }
}

export function createDocumentRequirementV2(): DocumentRequirementV2 {
  return {
    code: mortgageDraftId('document'),
    label: 'Nowy dokument',
    category: 'other',
    itemKind: 'client_document',
    scope: 'case',
    stage: 'analysis',
    applicability: 'always',
    evidence: 'confirmed_bank_source',
    required: true,
    multiple: false,
    allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png'],
  }
}

export function createOfferSourceV2(): OfferSourceV2 {
  return {
    id: mortgageDraftId('source'),
    title: 'Nowe źródło',
    url: '',
    kind: 'bank_product_page',
    role: 'general',
    retrievedAt: isoDate(),
  }
}

export function conditionForSelection(
  featureId: string,
  optionId: string,
): MortgageConditionV2 {
  return { op: 'selection_is', featureId, optionId }
}
