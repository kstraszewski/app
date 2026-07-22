import {
  calculateMortgageCatalogVersion,
  type InstallmentType,
  type OverpaymentStrategy,
} from '@openexpert/mortgage'
import type { SavedCaseOffer } from '../types/cases'

type ComparisonOffer = Pick<
  SavedCaseOffer,
  'id' | 'offer_type' | 'currency' | 'loan_amount' | 'scenario_snapshot' | 'catalog_snapshot' | 'calculation_snapshot'
>

type ComparisonStatus = 'available' | 'partial' | 'ineligible' | 'invalid'
type ComparisonEligibility = 'eligible' | 'ineligible' | 'unknown'

export type FinancingComparisonBaseline = {
  offerId: string
  currency: string
  contributionAmount: number
  years: number
  termMonths: number
  installmentType: InstallmentType
  referenceDelta: number
  monthlyOverpayment: number
  overpaymentStrategy: OverpaymentStrategy
  mortgageRegistrationMonth: number | null
  financeCommission: boolean
  selections: Record<string, string>
}

export type PropertyOfferComparison = {
  propertyId: string
  offerId: string
  currency: string
  purchasePrice: number | null
  appraisalValue: number | null
  propertyPrice: number | null
  contributionAmount: number
  netLoanAmount: number | null
  grossLoanAmount: number | null
  financedCosts: number | null
  /** @deprecated Use netLoanAmount. */
  loanAmount: number | null
  years: number
  termMonths: number
  installmentType: InstallmentType
  firstInstallment: number | null
  firstMonthlyOutflow: number | null
  firstRecurringCosts: number | null
  costFirstFiveYears: number | null
  totalCost: number | null
  ltvDebtBasis: string | null
  collateralValueBasis: string | null
  ltvDebtAmount: number | null
  collateralValueAmount: number | null
  ltvPct: number | null
  maxLtvPct: number | null
  eligible: boolean
  eligibility: ComparisonEligibility
  status: ComparisonStatus
  reasons: string[]
  calculatorVersion: string | null
  scenarioSnapshot: Record<string, unknown> | null
  calculationSnapshot: Record<string, unknown> | null
}

export type PropertyComparisonInput = number | null | undefined | {
  purchasePrice: number | null | undefined
  appraisalValue?: number | null | undefined
  currency?: string | null | undefined
}

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function currencyCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toUpperCase()
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null
}

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function optionalVersionNumber(
  version: JsonRecord,
  key: string,
  invalidReasons: string[],
  options: { integer?: boolean, min?: number } = {},
): number | null {
  const raw = version[key]
  if (raw === null || raw === undefined || raw === '') return null
  const value = finiteNumber(raw)
  if (
    value === null
    || (options.integer && !Number.isInteger(value))
    || (options.min !== undefined && value < options.min)
  ) {
    invalidReasons.push(`Snapshot oferty ma nieprawidłową wartość ${key}.`)
    return null
  }
  return value
}

function invalidComparison(
  propertyId: string,
  propertyPrice: number | null,
  appraisalValue: number | null,
  offer: ComparisonOffer,
  baseline: FinancingComparisonBaseline,
  reasons: string[],
  values: Partial<Pick<PropertyOfferComparison, 'loanAmount' | 'netLoanAmount' | 'grossLoanAmount' | 'financedCosts' | 'ltvPct' | 'maxLtvPct'>> = {},
): PropertyOfferComparison {
  const netLoanAmount = values.netLoanAmount ?? values.loanAmount ?? null
  return {
    propertyId,
    offerId: offer.id,
    currency: currencyCode(offer.currency) ?? String(offer.currency ?? ''),
    purchasePrice: propertyPrice,
    appraisalValue,
    propertyPrice,
    contributionAmount: baseline.contributionAmount,
    netLoanAmount,
    grossLoanAmount: values.grossLoanAmount ?? null,
    financedCosts: values.financedCosts ?? null,
    loanAmount: netLoanAmount,
    years: baseline.years,
    termMonths: baseline.termMonths,
    installmentType: baseline.installmentType,
    firstInstallment: null,
    firstMonthlyOutflow: null,
    firstRecurringCosts: null,
    costFirstFiveYears: null,
    totalCost: null,
    ltvDebtBasis: null,
    collateralValueBasis: null,
    ltvDebtAmount: null,
    collateralValueAmount: null,
    ltvPct: values.ltvPct ?? null,
    maxLtvPct: values.maxLtvPct ?? null,
    eligible: false,
    eligibility: 'unknown',
    status: 'invalid',
    reasons,
    calculatorVersion: null,
    scenarioSnapshot: null,
    calculationSnapshot: null,
  }
}

function propertyComparisonValues(input: PropertyComparisonInput): {
  purchasePrice: number | null
  appraisalValue: number | null
  currency: string | null
} {
  if (input && typeof input === 'object') {
    return {
      purchasePrice: finiteNumber(input.purchasePrice),
      appraisalValue: finiteNumber(input.appraisalValue),
      currency: currencyCode(input.currency),
    }
  }
  return { purchasePrice: finiteNumber(input), appraisalValue: null, currency: null }
}

export function getFinancingComparisonBaseline(
  offers: readonly ComparisonOffer[],
  selectedOfferId: string | null | undefined,
): FinancingComparisonBaseline | null {
  const selectedOffer = selectedOfferId
    ? offers.find(offer => offer.id === selectedOfferId)
    : null
  const offer = selectedOffer ?? offers.find(candidate => candidate.offer_type === 'mortgage') ?? null
  if (!offer || offer.offer_type !== 'mortgage') return null

  const scenario = asRecord(offer.scenario_snapshot)
  const calculation = asRecord(offer.calculation_snapshot)
  const propertyValue = finiteNumber(scenario?.propertyValue)
  const loanAmount = finiteNumber(calculation?.netLoanAmount)
    ?? finiteNumber(scenario?.loanAmount)
    ?? finiteNumber(offer.loan_amount)
  const years = finiteNumber(scenario?.years)
  const referenceDelta = finiteNumber(scenario?.referenceDelta ?? 0)
  const monthlyOverpayment = finiteNumber(scenario?.monthlyOverpayment ?? 0)
  const currency = currencyCode(offer.currency)
  const installmentType = scenario?.installmentType
  const overpaymentStrategy = scenario?.overpaymentStrategy ?? 'shorten_term'
  const mortgageRegistrationMonth = finiteNumber(scenario?.mortgageRegistrationMonth)
  const rawSelections = asRecord(scenario?.selections) ?? {}
  const selections = Object.fromEntries(Object.entries(rawSelections).flatMap(([featureId, optionId]) => (
    typeof optionId === 'string' ? [[featureId, optionId]] : []
  )))

  if (
    !scenario
    || propertyValue === null
    || propertyValue <= 0
    || loanAmount === null
    || loanAmount <= 0
    || loanAmount > propertyValue
    || years === null
    || !Number.isInteger(years)
    || years <= 0
    || years > 50
    || referenceDelta === null
    || monthlyOverpayment === null
    || monthlyOverpayment < 0
    || !currency
    || (installmentType !== 'equal' && installmentType !== 'decreasing')
    || (overpaymentStrategy !== 'shorten_term' && overpaymentStrategy !== 'lower_payment')
  ) {
    return null
  }

  return {
    offerId: offer.id,
    currency,
    contributionAmount: money(propertyValue - loanAmount),
    years,
    termMonths: years * 12,
    installmentType,
    referenceDelta,
    monthlyOverpayment,
    overpaymentStrategy,
    mortgageRegistrationMonth,
    financeCommission: scenario?.financeCommission !== false,
    selections,
  }
}

export function calculatePropertyOfferComparison(
  propertyId: string,
  propertyInput: PropertyComparisonInput,
  offer: ComparisonOffer,
  baseline: FinancingComparisonBaseline,
): PropertyOfferComparison {
  const property = propertyComparisonValues(propertyInput)
  const price = property.purchasePrice
  const appraisalValue = property.appraisalValue == null ? null : money(property.appraisalValue)
  if (price === null || price <= 0) {
    return invalidComparison(propertyId, null, appraisalValue, offer, baseline, [
      'Nieruchomość nie ma prawidłowej ceny.',
    ])
  }

  const normalizedPrice = money(price)
  const loanAmount = money(normalizedPrice - baseline.contributionAmount)
  const derivedLtvPct = loanAmount > 0 ? money(loanAmount / normalizedPrice * 100) : null
  if (loanAmount <= 0) {
    return invalidComparison(propertyId, normalizedPrice, appraisalValue, offer, baseline, [
      'Cena nieruchomości nie przewyższa wspólnego wkładu własnego.',
    ], { loanAmount, ltvPct: derivedLtvPct })
  }

  const invalidReasons: string[] = []
  if (offer.offer_type !== 'mortgage') {
    invalidReasons.push('Ta pozycja nie jest ofertą kredytu hipotecznego.')
  }

  const offerCurrency = currencyCode(offer.currency)
  if (!offerCurrency) {
    invalidReasons.push('Oferta nie ma prawidłowego kodu waluty.')
  } else if (offerCurrency !== baseline.currency) {
    invalidReasons.push(`Waluta oferty (${offerCurrency}) różni się od waluty porównania (${baseline.currency}).`)
  }
  if (property.currency && property.currency !== baseline.currency) {
    invalidReasons.push(`Waluta nieruchomości (${property.currency}) różni się od waluty porównania (${baseline.currency}).`)
  }

  const catalog = asRecord(offer.catalog_snapshot)
  const version = asRecord(catalog?.version)
  const offerDefinition = asRecord(version?.offer_definition)
  const isV2 = offerDefinition?.schemaVersion === 'openexpert.mortgage-offer/2.0'
  if (!version) {
    invalidReasons.push('Oferta nie zawiera zamrożonej wersji parametrów produktu.')
  }

  let minAmount: number | null = null
  let maxAmount: number | null = null
  let minTermMonths: number | null = null
  let maxTermMonths: number | null = null
  let maxLtvPct: number | null = null

  if (version && !isV2) {
    minAmount = optionalVersionNumber(version, 'min_amount', invalidReasons, { min: 0 })
    maxAmount = optionalVersionNumber(version, 'max_amount', invalidReasons, { min: 0 })
    minTermMonths = optionalVersionNumber(version, 'min_term_months', invalidReasons, { integer: true, min: 1 })
    maxTermMonths = optionalVersionNumber(version, 'max_term_months', invalidReasons, { integer: true, min: 1 })
    maxLtvPct = optionalVersionNumber(version, 'max_ltv_pct', invalidReasons, { min: 0 })
    if (minAmount !== null && maxAmount !== null && minAmount > maxAmount) {
      invalidReasons.push('Snapshot oferty ma sprzeczne limity kwoty kredytu.')
    }
    if (minTermMonths !== null && maxTermMonths !== null && minTermMonths > maxTermMonths) {
      invalidReasons.push('Snapshot oferty ma sprzeczne limity okresu kredytowania.')
    }
  } else if (isV2) {
    const eligibility = asRecord(offerDefinition?.eligibility)
    const definitionMaxLtvPct = finiteNumber(eligibility?.maxLtvPct)
    maxLtvPct = definitionMaxLtvPct !== null && definitionMaxLtvPct >= 0
      ? definitionMaxLtvPct
      : null
  }

  if (invalidReasons.length) {
    return invalidComparison(propertyId, normalizedPrice, appraisalValue, offer, baseline, invalidReasons, {
      loanAmount,
      ltvPct: derivedLtvPct,
      maxLtvPct,
    })
  }

  let calculation
  const targetScenario = asRecord(offer.scenario_snapshot)
  const targetSelectionsRecord = asRecord(targetScenario?.selections) ?? {}
  const targetSelections = Object.fromEntries(Object.entries(targetSelectionsRecord).flatMap(([featureId, optionId]) => (
    typeof optionId === 'string' ? [[featureId, optionId]] : []
  )))
  const targetSelectionEvents = Array.isArray(targetScenario?.selectionEvents)
    ? targetScenario.selectionEvents.flatMap((rawEvent) => {
        const event = asRecord(rawEvent)
        const month = finiteNumber(event?.month)
        return month !== null
          && Number.isInteger(month)
          && month >= 1
          && typeof event?.featureId === 'string'
          && typeof event?.optionId === 'string'
          ? [{ month, featureId: event.featureId, optionId: event.optionId }]
          : []
      })
    : []
  const targetRegistrationMonth = finiteNumber(targetScenario?.mortgageRegistrationMonth)
  const replayScenario = {
    propertyValue: normalizedPrice,
    appraisalValue,
    loanAmount,
    years: baseline.years,
    installmentType: baseline.installmentType,
    referenceDelta: baseline.referenceDelta,
    monthlyOverpayment: baseline.monthlyOverpayment,
    overpaymentStrategy: baseline.overpaymentStrategy,
    mortgageRegistrationMonth: targetRegistrationMonth,
    financeCommission: targetScenario?.financeCommission !== false,
    selections: targetSelections,
    selectionEvents: targetSelectionEvents,
  }
  try {
    calculation = calculateMortgageCatalogVersion(version, replayScenario)
  } catch {
    return invalidComparison(propertyId, normalizedPrice, appraisalValue, offer, baseline, [
      'Nie można przeliczyć oferty dla tej nieruchomości.',
    ], { loanAmount, ltvPct: derivedLtvPct, maxLtvPct })
  }

  if (calculation.status === 'unsupported') {
    return invalidComparison(propertyId, normalizedPrice, appraisalValue, offer, baseline, [
      ...calculation.issues.map(issue => issue.message),
      'Nie można przeliczyć oferty dla tej nieruchomości.',
    ], { loanAmount, ltvPct: derivedLtvPct, maxLtvPct })
  }

  const reasons: string[] = []
  if (!isV2 && minAmount !== null && loanAmount < minAmount) {
    reasons.push(`Kwota kredytu jest niższa niż minimum oferty (${money(minAmount)} ${baseline.currency}).`)
  }
  if (!isV2 && maxAmount !== null && loanAmount > maxAmount) {
    reasons.push(`Kwota kredytu przekracza maksimum oferty (${money(maxAmount)} ${baseline.currency}).`)
  }
  if (!isV2 && minTermMonths !== null && baseline.termMonths < minTermMonths) {
    reasons.push(`Okres kredytowania jest krótszy niż minimum oferty (${minTermMonths} mies.).`)
  }
  if (!isV2 && maxTermMonths !== null && baseline.termMonths > maxTermMonths) {
    reasons.push(`Okres kredytowania przekracza maksimum oferty (${maxTermMonths} mies.).`)
  }
  if (!isV2 && maxLtvPct !== null && calculation.ltvPct > maxLtvPct) {
    reasons.push(`LTV ${calculation.ltvPct}% przekracza limit oferty ${maxLtvPct}%.`)
  }
  if (calculation.status === 'ineligible') {
    reasons.push(...calculation.issues.filter(issue => issue.kind === 'ineligible').map(issue => issue.message))
  }
  if (calculation.status === 'partial') {
    reasons.push(...calculation.issues.filter(issue => issue.kind === 'incomplete').map(issue => issue.message))
    if (!reasons.length) reasons.push('Wynik jest częściowy i wymaga uzupełnienia parametrów oferty.')
  }

  const status: ComparisonStatus = calculation.status === 'partial'
    ? 'partial'
    : reasons.length
      ? 'ineligible'
      : 'available'
  const eligibility: ComparisonEligibility = status === 'partial'
    ? 'unknown'
    : reasons.length
    ? 'ineligible'
    : !isV2 && maxLtvPct === null
      ? 'unknown'
      : 'eligible'
  const eligibilityDefinition = isV2 ? asRecord(offerDefinition?.eligibility) : null
  const ltvDebtBasis = isV2
    ? String(eligibilityDefinition?.ltvDebtBasis ?? '') || null
    : 'net_loan'
  const collateralValueBasis = isV2
    ? String(eligibilityDefinition?.collateralValueBasis ?? '') || null
    : 'purchase_price'
  const ltvDebtAmount = ltvDebtBasis === 'gross_loan' || ltvDebtBasis === 'facility_limit'
    ? calculation.grossLoanAmount
    : calculation.netLoanAmount
  const collateralValueAmount = collateralValueBasis === 'appraisal_value'
    ? appraisalValue
    : collateralValueBasis === 'lower_of_purchase_and_appraisal'
      ? appraisalValue == null ? null : Math.min(normalizedPrice, appraisalValue)
      : normalizedPrice
  return {
    propertyId,
    offerId: offer.id,
    currency: offerCurrency!,
    purchasePrice: normalizedPrice,
    appraisalValue,
    propertyPrice: normalizedPrice,
    contributionAmount: baseline.contributionAmount,
    netLoanAmount: calculation.netLoanAmount,
    grossLoanAmount: calculation.grossLoanAmount,
    financedCosts: calculation.financedCosts,
    loanAmount: calculation.netLoanAmount,
    years: baseline.years,
    termMonths: baseline.termMonths,
    installmentType: baseline.installmentType,
    firstInstallment: calculation.firstInstallment,
    firstMonthlyOutflow: calculation.firstTotalOutflow,
    firstRecurringCosts: calculation.firstRecurringCosts,
    costFirstFiveYears: calculation.costFirstFiveYears,
    totalCost: calculation.totalCost,
    ltvDebtBasis,
    collateralValueBasis,
    ltvDebtAmount,
    collateralValueAmount,
    ltvPct: calculation.ltvPct,
    maxLtvPct,
    eligible: status === 'available',
    eligibility,
    status,
    reasons,
    calculatorVersion: calculation.engineVersion,
    scenarioSnapshot: {
      schemaVersion: 'openexpert.mortgage-application-scenario/1.0',
      sourceOfferId: offer.id,
      comparisonBaselineOfferId: baseline.offerId,
      property: {
        propertyId,
        purchasePrice: normalizedPrice,
        appraisalValue,
      },
      financing: {
        amountMode: 'target_net_proceeds',
        targetNetProceeds: calculation.netLoanAmount,
        grossLoanAmount: calculation.grossLoanAmount,
        financedCosts: calculation.financedCosts,
        contributionAmount: baseline.contributionAmount,
        termMonths: baseline.termMonths,
        installmentType: baseline.installmentType,
      },
      pricing: {
        referenceDelta: baseline.referenceDelta,
        monthlyOverpayment: baseline.monthlyOverpayment,
        overpaymentStrategy: baseline.overpaymentStrategy,
        mortgageRegistrationMonth: targetRegistrationMonth,
        financeCommission: targetScenario?.financeCommission !== false,
        selections: targetSelections,
        selectionEvents: targetSelectionEvents,
      },
      // Compatibility fields for existing consumers while the application
      // snapshot becomes the canonical source.
      propertyValue: normalizedPrice,
      appraisalValue,
      loanAmount: calculation.netLoanAmount,
      grossLoanAmount: calculation.grossLoanAmount,
      years: baseline.years,
      installmentType: baseline.installmentType,
      referenceDelta: baseline.referenceDelta,
      monthlyOverpayment: baseline.monthlyOverpayment,
      overpaymentStrategy: baseline.overpaymentStrategy,
      mortgageRegistrationMonth: targetRegistrationMonth,
      financeCommission: targetScenario?.financeCommission !== false,
      selections: targetSelections,
      selectionEvents: targetSelectionEvents,
    },
    calculationSnapshot: {
      schemaVersion: 'openexpert.mortgage-application-calculation/1.0',
      engineVersion: calculation.engineVersion,
      status: calculation.status,
      summary: {
        netLoanAmount: calculation.netLoanAmount,
        grossLoanAmount: calculation.grossLoanAmount,
        financedCosts: calculation.financedCosts,
        ltvDebtBasis,
        collateralValueBasis,
        ltvDebtAmount,
        collateralValueAmount,
        ltvPct: calculation.ltvPct,
        firstInstallment: calculation.firstInstallment,
        firstMonthlyOutflow: calculation.firstTotalOutflow,
        costFirstFiveYears: calculation.costFirstFiveYears,
        totalCost: calculation.totalCost,
      },
      raw: calculation.raw,
    },
  }
}
