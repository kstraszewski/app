import type {
  MortgageCostRuleV2,
  MortgageEvidenceReferenceV2,
  MortgageFeatureV2,
  MortgageOfferVersionV2,
  MortgagePricingPresetV2,
  RatePhaseV2,
} from '@openexpert/mortgage'

type JsonRecord = Record<string, any>

export interface LegacyMortgageOfferDraftSeed {
  draftData: MortgageOfferVersionV2 & {
    documentation: {
      requirements: JsonRecord[]
      sources: JsonRecord[]
    }
    migration?: JsonRecord
  }
  warnings: string[]
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function numberOrNull(value: unknown): number | null {
  if (value === '' || value == null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function decimal(value: number): string {
  return String(value)
}

function dateOnly(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  const candidate = value.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/u.test(candidate) ? candidate : null
}

function identifier(value: string, fallback: string): string {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('pl')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')
  return normalized || fallback
}

function resetMonths(indexCode: string): number | null {
  const match = indexCode.match(/(?:^|\s)(1|3|6|12)\s*M(?:$|\s)/iu)
  return match ? Number(match[1]) : null
}

function sourceKind(value: unknown): string {
  return ({
    product_page: 'bank_product_page',
    general_information: 'bank_information_sheet',
    pricing_table: 'bank_tariff',
    promotion_rules: 'bank_terms',
    other: 'other',
  } as Record<string, string>)[String(value ?? '')] ?? 'other'
}

function evidence(sourceId: string | null): MortgageEvidenceReferenceV2[] | undefined {
  return sourceId ? [{ sourceId, note: 'Zaimportowano z opublikowanej wersji legacy.' }] : undefined
}

function knownFixedCost(input: {
  id: string
  label: string
  category: MortgageCostRuleV2['category']
  classification: MortgageCostRuleV2['classification']
  amount: number | null
  sourceId: string | null
  allowed?: MortgageCostRuleV2['settlement']['allowed']
}): MortgageCostRuleV2 {
  const allowed = input.allowed ?? ['cash']
  return {
    id: input.id,
    label: input.label,
    state: input.amount == null ? 'unknown' : 'known',
    classification: input.classification,
    category: input.category,
    ...(input.amount == null ? {} : { formula: { kind: 'fixed', amount: decimal(input.amount) } as const }),
    timing: { kind: 'once', at: { kind: 'event', event: 'first_disbursement', edge: 'start' } },
    settlement: { allowed, default: allowed[0] ?? 'cash' },
    includedInApr: input.classification === 'credit_cost',
    evidenceRefs: evidence(input.sourceId),
  }
}

function recurringFixedCost(input: {
  id: string
  label: string
  category: MortgageCostRuleV2['category']
  classification: MortgageCostRuleV2['classification']
  amount: number | null
  sourceId: string | null
  months?: number | null
}): MortgageCostRuleV2 {
  return {
    id: input.id,
    label: input.label,
    state: input.amount == null ? 'unknown' : 'known',
    classification: input.classification,
    category: input.category,
    ...(input.amount == null ? {} : { formula: { kind: 'fixed', amount: decimal(input.amount) } as const }),
    timing: {
      kind: 'recurring',
      everyMonths: 1,
      period: {
        from: { kind: 'event', event: 'first_disbursement', edge: 'start' },
        ...(input.months && input.months > 0
          ? { endExclusive: { kind: 'month', month: input.months + 1, edge: 'start' } as const }
          : {}),
      },
    },
    settlement: { allowed: ['cash'], default: 'cash' },
    includedInApr: input.classification === 'credit_cost',
    evidenceRefs: evidence(input.sourceId),
  }
}

function recurringPercentageCost(input: {
  id: string
  label: string
  category: MortgageCostRuleV2['category']
  classification: MortgageCostRuleV2['classification']
  ratePct: number | null
  basis: 'property_value' | 'opening_balance_after_draw'
  everyMonths: number
  ratePeriod: 'per_occurrence' | 'annualized'
  sourceId: string | null
  months?: number | null
}): MortgageCostRuleV2 {
  return {
    id: input.id,
    label: input.label,
    state: input.ratePct == null ? 'unknown' : 'known',
    classification: input.classification,
    category: input.category,
    ...(input.ratePct == null
      ? {}
      : {
          formula: {
            kind: 'percentage',
            ratePct: decimal(input.ratePct),
            basis: input.basis,
            ratePeriod: input.ratePeriod,
          } as const,
        }),
    timing: {
      kind: 'recurring',
      everyMonths: input.everyMonths,
      period: {
        from: { kind: 'event', event: 'first_disbursement', edge: 'start' },
        ...(input.months && input.months > 0
          ? { endExclusive: { kind: 'month', month: input.months + 1, edge: 'start' } as const }
          : {}),
      },
    },
    settlement: { allowed: ['cash'], default: 'cash' },
    includedInApr: input.classification === 'credit_cost',
    evidenceRefs: evidence(input.sourceId),
  }
}

function ratePhases(version: JsonRecord, sourceId: string | null, pricingAsOf: string): RatePhaseV2[] {
  const phases: RatePhaseV2[] = []
  const fixedRate = numberOrNull(version.fixed_rate_pct)
  const fixedMonths = numberOrNull(version.fixed_period_months)
  const margin = numberOrNull(version.margin_pct)
  const referenceRate = numberOrNull(version.reference_rate_pct)
  const indexCode = String(version.reference_rate_code ?? '').trim()
  const indexAsOf = dateOnly(version.reference_rate_as_of) ?? pricingAsOf
  const evidenceRefs = evidence(sourceId)

  if (version.interest_type === 'fixed_periodic' && fixedRate != null && fixedMonths && fixedMonths > 0) {
    phases.push({
      id: 'legacy-fixed-period',
      period: {
        from: { kind: 'month', month: 1, edge: 'start' },
        endExclusive: { kind: 'month', month: fixedMonths + 1, edge: 'start' },
      },
      formula: { kind: 'fixed', ratePct: decimal(fixedRate) },
      evidenceRefs,
    })
  }

  if (margin != null && referenceRate != null && indexCode) {
    phases.push({
      id: 'legacy-indexed-period',
      period: {
        from: {
          kind: 'month',
          month: version.interest_type === 'fixed_periodic' && fixedMonths ? fixedMonths + 1 : 1,
          edge: 'start',
        },
      },
      formula: {
        kind: 'index_plus_margin',
        indexCode,
        indexValuePct: decimal(referenceRate),
        indexAsOf,
        marginPct: decimal(margin),
        resetEveryMonths: resetMonths(indexCode),
      },
      evidenceRefs,
    })
  }

  return phases
}

function legacyFeatures(version: JsonRecord, sourceId: string | null): {
  features: MortgageFeatureV2[]
  presets: MortgagePricingPresetV2[]
} {
  const rawRequirements = Array.isArray(version.requirements) ? version.requirements : []
  const features = rawRequirements.flatMap((value, index) => {
    const label = typeof value === 'string' ? value.trim() : ''
    if (!label) return []
    const featureId = `legacy-requirement-${index + 1}-${identifier(label, String(index + 1)).slice(0, 48)}`
    return [{
      id: featureId,
      label,
      required: true,
      defaultOptionId: 'required',
      options: [{ id: 'required', label: 'Wymagane przez ofertę' }],
      evidenceRefs: evidence(sourceId),
    } satisfies MortgageFeatureV2]
  })
  const selections = Object.fromEntries(features.map(feature => [feature.id, 'required']))
  return {
    features,
    presets: [{ id: 'standard', label: 'Wariant opublikowany', selections, isDefault: true }],
  }
}

export function mortgageLegacyVersionToDraft(
  rawVersion: unknown,
  rawSource: unknown = null,
): LegacyMortgageOfferDraftSeed {
  const version = record(rawVersion)
  const source = record(rawSource)
  const warnings: string[] = [
    'Szkic został utworzony z opublikowanej wersji legacy. Przed publikacją sprawdź wszystkie pola oznaczone jako nieznane lub przyjęte domyślnie.',
  ]
  const effectiveFrom = dateOnly(version.effective_from)
    ?? dateOnly(version.calculation_date)
    ?? dateOnly(version.retrieved_at)
    ?? new Date().toISOString().slice(0, 10)
  const pricingAsOf = dateOnly(version.calculation_date)
    ?? dateOnly(version.reference_rate_as_of)
    ?? effectiveFrom
  const sourceId = typeof source.id === 'string' && source.id ? source.id : null
  const sourceUrl = typeof source.source_url === 'string' ? source.source_url : ''
  const minAmount = numberOrNull(version.min_amount)
  const minTermMonths = numberOrNull(version.min_term_months)
  const maxTermMonths = numberOrNull(version.max_term_months)
  const maxLtvPct = numberOrNull(version.max_ltv_pct)
  if (minAmount == null) warnings.push('Minimalna kwota nie była znana; ustawiono roboczo 50 000 zł.')
  if (minTermMonths == null) warnings.push('Minimalny okres nie był znany; ustawiono roboczo 60 miesięcy.')
  if (maxTermMonths == null) warnings.push('Maksymalny okres nie był znany; ustawiono roboczo 420 miesięcy.')
  if (maxLtvPct == null) warnings.push('Maksymalne LTV nie było znane; ustawiono roboczo 90%.')
  if (!sourceId || !sourceUrl) warnings.push('Brakuje kompletnego dokumentu źródłowego dla wersji legacy.')

  const costs = record(version.cost_rules)
  const lifeMonths = numberOrNull(costs.lifeInsuranceMonths)
  const featureConfig = legacyFeatures(version, sourceId)
  const documentRequirements = Array.isArray(version.document_requirements)
    ? version.document_requirements.map((item) => {
        const requirement = { ...record(item) }
        if (requirement.evidence === 'confirmed_bank_source' && sourceId) {
          requirement.evidenceRefs = evidence(sourceId)
        }
        return requirement
      })
    : []

  const offerSources = sourceId && sourceUrl
    ? [{
        id: sourceId,
        title: String(source.title ?? 'Źródło wersji legacy'),
        url: sourceUrl,
        kind: sourceKind(source.source_kind),
        role: 'general',
        retrievedAt: dateOnly(source.retrieved_at) ?? effectiveFrom,
        ...(dateOnly(source.published_at) ? { publishedAt: dateOnly(source.published_at) } : {}),
        ...(typeof source.sha256 === 'string' && source.sha256 ? { sha256: source.sha256 } : {}),
      }]
    : []

  const draftData: LegacyMortgageOfferDraftSeed['draftData'] = {
    schemaVersion: 'openexpert.mortgage-offer/2.0',
    currency: 'PLN',
    validity: {
      effectiveFrom,
      effectiveTo: dateOnly(version.effective_to),
      pricingAsOf,
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
      minAmount: decimal(minAmount ?? 50_000),
      maxAmount: numberOrNull(version.max_amount) == null ? null : decimal(numberOrNull(version.max_amount)!),
      amountBasis: 'net_loan',
      minTermMonths: minTermMonths ?? 60,
      maxTermMonths: maxTermMonths ?? 420,
      allowedInstallmentTypes: ['equal', 'decreasing'],
      maxLtvPct: decimal(maxLtvPct ?? 90),
      ltvDebtBasis: 'gross_loan',
      collateralValueBasis: 'lower_of_purchase_and_appraisal',
      evidenceRefs: evidence(sourceId),
    },
    ratePlan: {
      phases: ratePhases(version, sourceId, pricingAsOf),
      modifiers: [],
    },
    ...featureConfig,
    costs: [
      {
        id: 'commission-percentage',
        label: 'Prowizja za udzielenie',
        state: numberOrNull(costs.commissionPct) == null ? 'unknown' : 'known',
        classification: 'credit_cost',
        category: 'commission',
        ...(numberOrNull(costs.commissionPct) == null
          ? {}
          : {
              formula: {
                kind: 'percentage',
                ratePct: decimal(numberOrNull(costs.commissionPct)!),
                basis: 'net_loan_amount',
                ratePeriod: 'per_occurrence',
              } as const,
            }),
        timing: { kind: 'once', at: { kind: 'event', event: 'first_disbursement', edge: 'start' } },
        settlement: {
          allowed: ['cash', 'capitalized', 'withheld_from_disbursement'],
          default: 'cash',
        },
        includedInApr: true,
        evidenceRefs: evidence(sourceId),
      },
      knownFixedCost({ id: 'appraisal', label: 'Wycena nieruchomości', category: 'appraisal', classification: 'credit_cost', amount: numberOrNull(costs.appraisalFee), sourceId }),
      knownFixedCost({ id: 'court-fee', label: 'Opłata sądowa', category: 'court', classification: 'transaction_cost', amount: numberOrNull(costs.courtFee), sourceId }),
      knownFixedCost({ id: 'pcc-tax', label: 'PCC / podatek od transakcji', category: 'tax', classification: 'transaction_cost', amount: numberOrNull(costs.pccFee), sourceId }),
      recurringFixedCost({ id: 'account', label: 'Konto osobiste', category: 'account', classification: 'conditional_cost', amount: numberOrNull(costs.accountMonthlyFee), sourceId }),
      recurringFixedCost({ id: 'card', label: 'Karta płatnicza', category: 'card', classification: 'conditional_cost', amount: numberOrNull(costs.cardMonthlyFee), sourceId }),
      recurringPercentageCost({
        id: 'property-insurance',
        label: 'Ubezpieczenie nieruchomości',
        category: 'property_insurance',
        classification: 'conditional_cost',
        ratePct: numberOrNull(costs.propertyInsuranceAnnualRatePct),
        basis: 'property_value',
        everyMonths: 12,
        ratePeriod: 'annualized',
        sourceId,
      }),
      recurringPercentageCost({
        id: 'life-insurance',
        label: 'Ubezpieczenie na życie',
        category: 'life_insurance',
        classification: 'conditional_cost',
        ratePct: numberOrNull(costs.lifeInsuranceMonthlyRatePct),
        basis: 'opening_balance_after_draw',
        everyMonths: 1,
        ratePeriod: 'per_occurrence',
        months: lifeMonths,
        sourceId,
      }),
      knownFixedCost({ id: 'bridge-insurance', label: 'Ubezpieczenie pomostowe', category: 'bridge_insurance', classification: 'conditional_cost', amount: null, sourceId }),
      knownFixedCost({ id: 'early-repayment', label: 'Wcześniejsza spłata', category: 'other', classification: 'conditional_cost', amount: null, sourceId }),
    ],
    disbursementPolicy: {
      maxTranches: 1,
      supportedGraceModes: ['none', 'interest_only'],
      paymentRecalculationTriggers: ['rate_change', 'disbursement', 'grace_end', 'lower_payment_overpayment'],
      evidenceRefs: evidence(sourceId),
    },
    documentation: {
      requirements: documentRequirements,
      sources: offerSources,
    },
    migration: {
      fromSchema: 'legacy-flat-v1',
      sourceVersionId: version.id ?? null,
      sourceVersionKey: version.version_key ?? null,
      assumptions: Array.isArray(version.assumptions) ? version.assumptions : [],
      unknownFields: Array.isArray(version.unknown_fields) ? version.unknown_fields : [],
    },
  }

  return { draftData, warnings }
}
