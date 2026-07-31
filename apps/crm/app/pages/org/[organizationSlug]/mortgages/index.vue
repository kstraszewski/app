<script setup lang="ts">
import {
  calculateMortgageCatalogVersion,
  type InstallmentType,
  type MortgageCalculationV2,
  type MortgageCatalogCalculationSummary,
  type MortgageOfferVersionV2,
  type OverpaymentStrategy,
} from '@openexpert/mortgage'

definePageMeta({ middleware: ['auth', 'organization'] })
useHead({ title: 'Porównywarka hipotek — OpenExpert' })

type CostRules = {
  commissionPct?: number | null
  appraisalFee?: number | null
  pccFee?: number | null
  courtFee?: number | null
  accountMonthlyFee?: number | null
  cardMonthlyFee?: number | null
  propertyInsuranceAnnualRatePct?: number | null
  lifeInsuranceMonthlyRatePct?: number | null
  lifeInsuranceMonths?: number | null
}

type CatalogProduct = {
  id: string
  slug: string
  name: string
  bank: {
    id: string
    slug: string
    name: string
    website_url: string
    logoUrl: string | null
    logoBackground: string | null
    override?: { revision?: number } | null
  }
  override?: { revision?: number } | null
  version: {
    id: string
    version_key: string
    retrieved_at: string
    calculation_date: string | null
    effective_from: string | null
    effective_to: string | null
    data_status: string
    completeness_score: number
    interest_type: 'fixed_periodic' | 'variable'
    fixed_rate_pct: number | null
    fixed_period_months: number | null
    margin_pct: number | null
    reference_rate_code: string | null
    reference_rate_pct: number | null
    reference_rate_as_of: string | null
    representative_apr_pct: number | null
    min_amount?: number | null
    max_amount?: number | null
    min_term_months?: number | null
    max_term_months?: number | null
    max_ltv_pct: number | null
    cost_rules: CostRules
    requirements: string[]
    assumptions: string[]
    unknown_fields: string[]
    calculation_readiness?: 'complete' | 'partial' | 'unsupported'
    offer_definition?: MortgageOfferVersionV2 | { schemaVersion?: string } | null
    source: null | {
      title: string
      source_url: string
      sha256: string | null
      retrieved_at: string
      published_at: string | null
      retrieval_status: string
      extraction_status: string
    }
  }
}

type Payload = { products: CatalogProduct[], retrievedAt: string | null, role: 'admin' | 'expert', superAdmin: boolean }
type MortgageCaseContextResponse = {
  data: {
    title: string
    offers: Array<{
      mortgage_product_id: string | null
      version_key: string | null
      scenario_snapshot: Record<string, any>
    }>
  }
}

const route = useRoute()
const organizationSlug = computed(() => String(route.params.organizationSlug ?? ''))
const caseId = computed(() => typeof route.query.caseId === 'string' ? route.query.caseId : '')
const { crmApiPath, orgPath } = useOrganizationContext()
const meetingReturnPath = computed(() => {
  const requested = typeof route.query.returnTo === 'string' ? route.query.returnTo : ''
  return requested.startsWith(`${orgPath('/meetings')}/`) ? requested : ''
})
const toast = useToast()
const requestFetch = useRequestFetch()
const { data, pending, error, refresh } = await useFetch<Payload>(
  () => `/api/org/${organizationSlug.value}/mortgages/products`,
  {
    key: computed(() => `mortgage-catalog:${organizationSlug.value}`),
    default: () => ({ products: [], retrievedAt: null, role: 'expert' as const, superAdmin: false }),
  },
)

const {
  data: caseContext,
  pending: caseContextPending,
  error: caseContextError,
  refresh: refreshCaseContext,
} = await useAsyncData<MortgageCaseContextResponse | null>(
  `mortgage-case-context:${organizationSlug.value}`,
  () => caseId.value
    ? requestFetch<MortgageCaseContextResponse>(crmApiPath(`/cases/${caseId.value}/offers`))
    : Promise.resolve(null),
  { default: () => null, watch: [organizationSlug, caseId] },
)

const scenario = reactive({
  propertyValue: 600_000,
  appraisalValue: null as number | null,
  loanAmount: 480_000,
  years: 25,
  installmentType: 'equal' as InstallmentType,
  referenceDelta: 0,
  monthlyOverpayment: 0,
  overpaymentStrategy: 'shorten_term' as OverpaymentStrategy,
  mortgageRegistrationMonth: 6,
  financeCommission: true,
})
const filters = reactive({
  banks: [] as string[],
  interestType: 'all',
  completeOnly: false,
  maxMonthlyOutflow: 0,
  maxInitialCosts: 0,
})
const sortBy = ref('cost5y')
const selectedId = ref<string | null>(null)
const comparedIds = ref<string[]>([])
const scheduleRows = ref(24)
const savingOfferKeys = ref<string[]>([])
const savedOfferKeys = ref<string[]>([])
const pricingPresetIds = reactive<Record<string, string | null>>({})
const optionSelections = reactive<Record<string, Record<string, string>>>({})
const optionSelectionEvents = reactive<Record<string, Record<string, { month: number, optionId: string }>>>({})

const currency = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 2 })
const integerCurrency = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 })
const number = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2 })
const date = new Intl.DateTimeFormat('pl-PL')
const n = (value: unknown) => typeof value === 'number' ? value : Number(value ?? 0)
const money = (value: number) => currency.format(value)
const compactMoney = (value: number) => integerCurrency.format(value)
const formatDate = (value: string | null | undefined) => value ? date.format(new Date(`${value}T12:00:00`)) : 'brak daty'

const ltv = computed(() => scenario.propertyValue > 0 ? scenario.loanAmount / scenario.propertyValue * 100 : 0)
const contribution = computed(() => Math.max(0, scenario.propertyValue - scenario.loanAmount))
const contributionPct = computed(() => scenario.propertyValue > 0 ? contribution.value / scenario.propertyValue * 100 : 0)
const banks = computed(() => [...new Map(data.value.products.map(product => [product.bank.slug, product.bank])).values()])

function v2Definition(product: CatalogProduct): MortgageOfferVersionV2 | null {
  const definition = product.version.offer_definition
  return definition?.schemaVersion === 'openexpert.mortgage-offer/2.0'
    ? definition as MortgageOfferVersionV2
    : null
}

function productPresetId(product: CatalogProduct): string | undefined {
  const definition = v2Definition(product)
  if (!definition) return undefined
  if (Object.prototype.hasOwnProperty.call(pricingPresetIds, product.id)) {
    const selectedId = pricingPresetIds[product.id]
    if (!selectedId) return undefined
    if (definition.presets.some(preset => preset.id === selectedId)) return selectedId
  }
  return definition.presets.find(preset => preset.isDefault)?.id
}

function productPresetValue(product: CatalogProduct): string {
  return productPresetId(product) ?? ''
}

function productSelections(product: CatalogProduct): Record<string, string> {
  const definition = v2Definition(product)
  if (!definition) return optionSelections[product.id] ?? {}
  const selectedPreset = definition.presets.find(preset => preset.id === productPresetId(product))
  const defaults = { ...(selectedPreset?.selections ?? {}) }
  for (const feature of definition.features) {
    if (!(feature.id in defaults) && feature.defaultOptionId) defaults[feature.id] = feature.defaultOptionId
  }
  return { ...defaults, ...(optionSelections[product.id] ?? {}) }
}

function setProductPreset(product: CatalogProduct, presetId: string) {
  const currentSelections = productSelections(product)
  if (presetId) {
    pricingPresetIds[product.id] = presetId
    optionSelections[product.id] = {}
    return
  }
  pricingPresetIds[product.id] = null
  optionSelections[product.id] = currentSelections
}

function updateProductPreset(product: CatalogProduct, event: Event) {
  setProductPreset(product, (event.target as HTMLSelectElement | null)?.value ?? '')
}

function setProductSelection(productId: string, featureId: string, optionId: string) {
  const next = { ...(optionSelections[productId] ?? {}) }
  if (optionId) next[featureId] = optionId
  else delete next[featureId]
  optionSelections[productId] = next
}

function updateProductSelection(productId: string, featureId: string, event: Event) {
  setProductSelection(productId, featureId, (event.target as HTMLSelectElement | null)?.value ?? '')
}

function productSelectionValue(product: CatalogProduct, featureId: string): string {
  return productSelections(product)[featureId] ?? ''
}

function productSelectionEvent(productId: string, featureId: string) {
  return optionSelectionEvents[productId]?.[featureId] ?? null
}

function setProductSelectionEventMonth(product: CatalogProduct, featureId: string, value: number | null | undefined) {
  const month = value == null ? 0 : Math.round(Number(value))
  const next = { ...(optionSelectionEvents[product.id] ?? {}) }
  if (month < 1) {
    delete next[featureId]
  } else {
    const feature = v2Definition(product)?.features.find(item => item.id === featureId)
    const currentOption = feature?.options.find(option => option.id === productSelectionValue(product, featureId))
    const optionId = currentOption?.breachOptionId
      ?? feature?.options.find(option => option.id !== currentOption?.id)?.id
      ?? currentOption?.id
      ?? ''
    if (optionId) next[featureId] = { month, optionId }
  }
  optionSelectionEvents[product.id] = next
}

function setProductSelectionEventOption(productId: string, featureId: string, optionId: string) {
  const current = productSelectionEvent(productId, featureId)
  if (!current || !optionId) return
  optionSelectionEvents[productId] = {
    ...(optionSelectionEvents[productId] ?? {}),
    [featureId]: { ...current, optionId },
  }
}

function updateProductSelectionEventMonth(product: CatalogProduct, featureId: string, event: Event) {
  const value = (event.target as HTMLInputElement | null)?.value
  setProductSelectionEventMonth(product, featureId, value ? Number(value) : null)
}

function updateProductSelectionEventOption(productId: string, featureId: string, event: Event) {
  setProductSelectionEventOption(productId, featureId, (event.target as HTMLSelectElement | null)?.value ?? '')
}

function productSelectionEventList(product: CatalogProduct) {
  return Object.entries(optionSelectionEvents[product.id] ?? {}).map(([featureId, event]) => ({
    featureId,
    month: event.month,
    optionId: event.optionId,
  }))
}

function calculationScenario(product: CatalogProduct) {
  const presetId = productPresetId(product)
  return {
    propertyValue: Math.max(1, n(scenario.propertyValue)),
    appraisalValue: scenario.appraisalValue == null || n(scenario.appraisalValue) <= 0
      ? null
      : n(scenario.appraisalValue),
    loanAmount: Math.max(1, n(scenario.loanAmount)),
    years: Math.max(1, Math.round(n(scenario.years))),
    installmentType: scenario.installmentType,
    referenceDelta: n(scenario.referenceDelta),
    monthlyOverpayment: Math.max(0, n(scenario.monthlyOverpayment)),
    overpaymentStrategy: scenario.overpaymentStrategy,
    mortgageRegistrationMonth: Math.max(0, Math.round(n(scenario.mortgageRegistrationMonth))),
    financeCommission: Boolean(scenario.financeCommission),
    ...(presetId ? { presetId } : {}),
    // Keep the resolved feature choices beside presetId. The calculator uses
    // the published preset, while saved case snapshots remain deterministic
    // for consumers that only understand selections.
    selections: productSelections(product),
    selectionEvents: productSelectionEventList(product),
  }
}

const calculations = computed(() => data.value.products.map((product) => {
  const version = product.version
  const offerScenario = calculationScenario(product)
  const result = calculateMortgageCatalogVersion(version, offerScenario)
  const stress = calculateMortgageCatalogVersion(version, offerScenario, 2)
  const maxLtv = version.max_ltv_pct == null ? null : n(version.max_ltv_pct)
  const amount = offerScenario.loanAmount
  const termMonths = offerScenario.years * 12
  const isV2 = v2Definition(product) !== null
  const limitsEligible = isV2 || ((version.min_amount == null || amount >= n(version.min_amount))
    && (version.max_amount == null || amount <= n(version.max_amount))
    && (version.min_term_months == null || termMonths >= n(version.min_term_months))
    && (version.max_term_months == null || termMonths <= n(version.max_term_months)))
  const ltvEligible = isV2 || maxLtv == null ? null : result.ltvPct <= maxLtv
  const eligible = limitsEligible
    && ltvEligible !== false
    && result.status !== 'ineligible'
    && result.status !== 'unsupported'
  return {
    product,
    result,
    stress,
    ltvEligible,
    eligible,
    saveable: eligible && (result.status === 'complete' || result.status === 'partial'),
  }
}))

const visibleOffers = computed(() => {
  const selectedBanks = new Set(filters.banks)
  const list = calculations.value.filter((offer) => {
    if (selectedBanks.size && !selectedBanks.has(offer.product.bank.slug)) return false
    if (filters.interestType !== 'all' && offer.product.version.interest_type !== filters.interestType) return false
    if (filters.completeOnly && (offer.product.version.unknown_fields.length || offer.result.status !== 'complete')) return false
    if (filters.maxMonthlyOutflow > 0 && offer.result.firstTotalOutflow > filters.maxMonthlyOutflow) return false
    if (filters.maxInitialCosts > 0 && offer.result.initialCosts > filters.maxInitialCosts) return false
    return true
  })
  const selectors: Record<string, (offer: typeof list[number]) => number> = {
    cost5y: offer => offer.result.costFirstFiveYears,
    firstOutflow: offer => offer.result.firstTotalOutflow,
    totalCost: offer => offer.result.totalCost,
    initialCosts: offer => offer.result.initialCosts,
    apr: offer => n(offer.product.version.representative_apr_pct) || Number.POSITIVE_INFINITY,
    completeness: offer => -offer.product.version.completeness_score,
  }
  const selector = selectors[sortBy.value] ?? selectors.cost5y!
  return [...list].sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1
    const statusRank = { complete: 0, partial: 1, ineligible: 2, unsupported: 3 }
    if (statusRank[a.result.status] !== statusRank[b.result.status]) return statusRank[a.result.status] - statusRank[b.result.status]
    return selector(a) - selector(b)
  })
})

const selected = computed(() => calculations.value.find(offer => offer.product.id === selectedId.value) ?? visibleOffers.value[0] ?? null)
const compared = computed(() => comparedIds.value
  .map(id => calculations.value.find(offer => offer.product.id === id))
  .filter(Boolean) as typeof calculations.value)

watch(() => data.value.products, (products) => {
  if (!selectedId.value && products[0]) selectedId.value = products[0].id
}, { immediate: true })
watch(selectedId, () => { scheduleRows.value = 24 })

function toggleBank(slug: string) {
  filters.banks = filters.banks.includes(slug)
    ? filters.banks.filter(value => value !== slug)
    : [...filters.banks, slug]
}

function toggleCompare(id: string) {
  if (comparedIds.value.includes(id)) comparedIds.value = comparedIds.value.filter(value => value !== id)
  else if (comparedIds.value.length < 3) comparedIds.value = [...comparedIds.value, id]
}

function presentComparedOffers() {
  if (!compared.value.length) return

  toast.add({
    title: meetingReturnPath.value ? 'Wracasz do spotkania' : 'Porównanie jest gotowe',
    description: meetingReturnPath.value
      ? 'W pokoju zobaczysz oferty zapisane w sprawie i zdecydujesz, które jawnie pokazać klientowi.'
      : `Wybrano ${compared.value.length} ${compared.value.length === 1 ? 'ofertę' : 'oferty'} do dalszej pracy.`,
    color: 'success',
  })

  void navigateTo(meetingReturnPath.value || orgPath('/meetings'))
}

function scenarioFingerprint(value: Record<string, any>) {
  return [
    Number(value.propertyValue ?? 0),
    value.appraisalValue == null ? '' : Number(value.appraisalValue),
    Number(value.loanAmount ?? 0),
    Number(value.years ?? 0),
    String(value.installmentType ?? 'equal'),
    Number(value.referenceDelta ?? 0),
    Number(value.monthlyOverpayment ?? 0),
    String(value.overpaymentStrategy ?? 'shorten_term'),
    Number(value.mortgageRegistrationMonth ?? 0),
    Boolean(value.financeCommission),
    JSON.stringify(value.selections ?? {}),
    JSON.stringify(value.selectionEvents ?? []),
  ].join('|')
}

function offerSaveKey(productId: string, versionKey: string, value: Record<string, any>) {
  return `${productId}:${versionKey}:${scenarioFingerprint(value)}`
}

const persistedOfferKeys = computed(() => new Set([
  ...(caseContext.value?.data.offers ?? []).map(offer => offerSaveKey(
    String(offer.mortgage_product_id ?? ''),
    String(offer.version_key ?? ''),
    offer.scenario_snapshot,
  )),
  ...savedOfferKeys.value,
]))

async function saveOffer(offer: typeof calculations.value[number]) {
  if (!caseId.value || !caseContext.value) return
  const offerScenario = calculationScenario(offer.product)
  const key = offerSaveKey(offer.product.id, offer.product.version.version_key, offerScenario)
  if (savingOfferKeys.value.includes(key) || persistedOfferKeys.value.has(key)) return
  savingOfferKeys.value = [...savingOfferKeys.value, key]
  try {
    await $fetch(crmApiPath(`/cases/${caseId.value}/offers`), {
      method: 'POST',
      body: {
        source_product_id: offer.product.id,
        source_version_key: offer.product.version.version_key,
        catalog_revision: {
          product: Number(offer.product.override?.revision ?? 0),
          bank: Number(offer.product.bank.override?.revision ?? 0),
        },
        scenario: offerScenario,
      },
    })
    savedOfferKeys.value = [...savedOfferKeys.value, key]
    await refreshCaseContext()
    toast.add({
      title: 'Zapisano ofertę w sprawie',
      description: `${offer.product.bank.name} · ${offer.product.name}`,
      color: 'success',
    })
  } catch (caught: any) {
    const statusCode = Number(caught?.statusCode ?? caught?.response?.status ?? 0)
    if (statusCode === 409) await refresh()
    toast.add({
      title: 'Nie udało się zapisać oferty',
      description: statusCode === 409
        ? 'Katalog zmienił się podczas porównywania. Dane zostały odświeżone — sprawdź ofertę ponownie.'
        : caught?.data?.statusMessage ?? caught?.message ?? 'Spróbuj ponownie.',
      color: 'error',
    })
  } finally {
    savingOfferKeys.value = savingOfferKeys.value.filter(value => value !== key)
  }
}

function legacyCostItems(rules: CostRules): Array<[string, string | null]> {
  return [
    ['Prowizja', rules.commissionPct == null ? null : `${number.format(rules.commissionPct)}%`],
    ['Wycena', rules.appraisalFee == null ? null : money(rules.appraisalFee)],
    ['PCC', rules.pccFee == null ? null : money(rules.pccFee)],
    ['Opłata sądowa', rules.courtFee == null ? null : money(rules.courtFee)],
    ['Konto / mies.', rules.accountMonthlyFee == null ? null : money(rules.accountMonthlyFee)],
    ['Karta / mies.', rules.cardMonthlyFee == null ? null : money(rules.cardMonthlyFee)],
    ['Nieruchomość / rok', rules.propertyInsuranceAnnualRatePct == null ? null : `${number.format(rules.propertyInsuranceAnnualRatePct)}% wartości`],
    ['Życie / mies.', rules.lifeInsuranceMonthlyRatePct == null ? null : `${number.format(rules.lifeInsuranceMonthlyRatePct)}% salda`],
  ]
}

function costItems(offer: { product: CatalogProduct, result: MortgageCatalogCalculationSummary }): Array<[string, string | null]> {
  const definition = v2Definition(offer.product)
  if (!definition) return legacyCostItems(offer.product.version.cost_rules)
  const raw = offer.result.raw as MortgageCalculationV2
  const settlementLabels = { cash: 'gotówka', capitalized: 'kredytowany', withheld_from_disbursement: 'potrącany z wypłaty' }
  const items: Array<[string, string | null]> = definition.costs.map((cost) => {
    if (cost.state === 'unknown') return [cost.label, null]
    if (cost.state === 'not_applicable') return [cost.label, 'nie dotyczy']
    const amount = n(raw.componentTotals?.[cost.id])
    const commissionPreferences = scenario.financeCommission
      ? ['capitalized', 'withheld_from_disbursement'] as const
      : ['cash'] as const
    const activeSettlement = cost.category === 'commission'
      ? commissionPreferences.find(settlement => cost.settlement.allowed.includes(settlement))
        ?? cost.settlement.default
      : cost.settlement.default
    return [cost.label, `${money(amount)} · ${settlementLabels[activeSettlement]}`]
  })
  if (definition.bridgeInsurance) {
    items.push([
      'Koszt pomostowy (dodatkowe odsetki)',
      `${money(n(raw.componentTotals?.bridge_uplift_interest))} · zwrot ${money(offer.result.refunds)}`,
    ])
  }
  return items
}

function rateLines(offer: { product: CatalogProduct, result: MortgageCatalogCalculationSummary }): [string, string] {
  const definition = v2Definition(offer.product)
  if (!definition) {
    return [
      `${number.format(offer.product.version.fixed_rate_pct ?? 0)}% przez ${offer.product.version.fixed_period_months ?? 0} mies.`,
      `potem ${offer.product.version.reference_rate_code ?? 'indeks'} + ${number.format(offer.product.version.margin_pct ?? 0)}%`,
    ]
  }
  const firstRate = offer.result.schedule[0]?.annualRatePct
  const phaseLabels = definition.ratePlan.phases.map((phase) => (
    phase.formula.kind === 'fixed'
      ? `${number.format(n(phase.formula.ratePct))}% stałe`
      : `${phase.formula.indexCode} + ${number.format(n(phase.formula.marginPct))}% marży`
  ))
  return [
    firstRate == null ? 'Brak wyliczonej stopy' : `${number.format(firstRate)}% w pierwszym miesiącu (po warunkach)`,
    phaseLabels.join(' → '),
  ]
}

function offerRequirements(offer: { product: CatalogProduct, result: MortgageCatalogCalculationSummary }): string[] {
  const definition = v2Definition(offer.product)
  if (!definition) return offer.product.version.requirements
  const raw = offer.result.raw as MortgageCalculationV2
  const selections = raw.resolvedSelections ?? productSelections(offer.product)
  const requirements = definition.features.flatMap((feature) => {
    const option = feature.options.find(item => item.id === selections[feature.id])
    if (!option) return []
    return [
      `${feature.label}: ${option.label}`,
      ...(option.obligations ?? []).map(obligation => `${feature.label} — ${obligation}`),
    ]
  })
  return requirements.length ? requirements : ['Brak dodatkowych warunków produktowych w tym wariancie']
}
</script>

<template>
  <CrmShell
    title="Porównywarka hipotek"
    :eyebrow="`Kalkulacja orientacyjna · Polska · ${banks.length} instytucji`"
    description="Porównaj dostępne produkty i zapisz wybrane warianty bezpośrednio w sprawie klienta."
  >
    <template #actions>
      <UButton
        v-if="data.superAdmin"
        :to="orgPath('/settings/institutions')"
        icon="i-lucide-badge-percent"
        color="neutral"
        variant="outline"
      >
        Ustawienia produktów
      </UButton>
      <UButton
        v-if="caseId"
        :to="orgPath(`/cases/${caseId}`)"
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="outline"
      >
        Wróć do sprawy
      </UButton>
      <UButton icon="i-lucide-refresh-cw" variant="outline" :loading="pending" @click="refresh()">Odśwież dane</UButton>
    </template>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      title="Nie udało się pobrać katalogu"
      description="Uruchom lokalny stack i synchronizację produktów: pnpm db:setup."
    />

    <UAlert
      v-if="caseId && caseContext"
      class="case-context"
      color="primary"
      variant="subtle"
      icon="i-lucide-folder-heart"
      :title="`Zapisujesz oferty w sprawie: ${caseContext.data.title}`"
      description="Ustaw scenariusz i zapisz wybrane warianty na shortliście sprawy. Wyniki z brakującymi kosztami zachowamy z wyraźnym statusem do uzupełnienia."
    >
      <template #actions>
        <UButton
          :to="{ path: orgPath(`/cases/${caseId}`), hash: '#case-documents' }"
          color="primary"
          variant="soft"
          size="sm"
          icon="i-lucide-folder-check"
        >
          Dokumenty sprawy
        </UButton>
      </template>
    </UAlert>
    <UAlert
      v-else-if="caseId && caseContextError"
      class="case-context"
      color="error"
      variant="subtle"
      title="Nie można otworzyć wskazanej sprawy"
      description="Wróć do listy spraw i uruchom porównywarkę ponownie."
    />

    <UAlert
      v-if="caseId && savedOfferKeys.length"
      class="case-context"
      color="success"
      variant="subtle"
      icon="i-lucide-circle-check-big"
      title="Oferta zapisana — możesz przejść do dokumentów"
      description="Na stronie sprawy wybierzesz ofertę do obsługi, uzupełnisz dokumenty każdego wnioskodawcy i uruchomisz Multiwniosek."
    >
      <template #actions>
        <UButton
          :to="{ path: orgPath(`/cases/${caseId}`), hash: '#case-documents' }"
          color="success"
          size="sm"
          trailing-icon="i-lucide-arrow-right"
        >
          Wróć do sprawy
        </UButton>
      </template>
    </UAlert>

    <section class="notice" aria-label="status kalkulacji">
      <UIcon name="i-lucide-info" />
      <p><strong>To nie jest oferta banku ani ESIS.</strong> Porównanie liczymy na identycznym scenariuszu z publicznych parametrów. Nieznany koszt pozostaje nieznany — nigdy nie zamieniamy go na zero.</p>
      <span>Stan katalogu: {{ formatDate(data.retrievedAt?.slice(0, 10)) }}</span>
    </section>

    <div class="workspace">
      <aside class="scenario-panel">
        <div class="panel-heading">
          <span>01</span>
          <div><h2>Twój scenariusz</h2><p>Wspólne założenia dla każdego banku</p></div>
        </div>

        <label>Cena zakupu nieruchomości <input v-model.number="scenario.propertyValue" type="number" min="1" step="10000"></label>
        <label>Wartość z operatu <input v-model.number="scenario.appraisalValue" type="number" min="1" step="10000" placeholder="Brak operatu"><small>Wymagana przez oferty liczące LTV od wyceny lub niższej z ceny i wyceny.</small></label>
        <label>Kwota kredytu <input v-model.number="scenario.loanAmount" type="number" min="1" step="10000"></label>
        <div class="scenario-metrics">
          <span>Wkład własny <strong>{{ compactMoney(contribution) }} · {{ number.format(contributionPct) }}%</strong></span>
          <span :class="{ danger: ltv > 80 }">LTV netto / cena <strong>{{ number.format(ltv) }}%</strong></span>
        </div>
        <label>Okres <span class="label-value">{{ scenario.years }} lat</span><input v-model.number="scenario.years" type="range" min="5" max="35" step="1"></label>
        <label>Rodzaj rat
          <select v-model="scenario.installmentType"><option value="equal">Równe</option><option value="decreasing">Malejące</option></select>
        </label>
        <label>Zmiana stopy referencyjnej <span class="label-value">{{ scenario.referenceDelta >= 0 ? '+' : '' }}{{ number.format(scenario.referenceDelta) }} p.p.</span><input v-model.number="scenario.referenceDelta" type="range" min="-2" max="5" step="0.25"></label>
        <label>Miesiąc wpisu hipoteki <input v-model.number="scenario.mortgageRegistrationMonth" type="number" min="0" :max="scenario.years * 12" step="1"><small>Wpływa na pomostowe i termin refundu.</small></label>
        <label class="check"><input v-model="scenario.financeCommission" type="checkbox"> Kredytuj prowizję, gdy oferta na to pozwala</label>
        <label>Nadpłata miesięczna <input v-model.number="scenario.monthlyOverpayment" type="number" min="0" step="100"></label>
        <label v-if="scenario.monthlyOverpayment > 0">Cel nadpłaty
          <select v-model="scenario.overpaymentStrategy"><option value="shorten_term">Skróć okres</option><option value="lower_payment">Obniżaj ratę</option></select>
        </label>

        <div class="panel-heading panel-heading--compact"><span>02</span><div><h2>Filtry</h2><p>Ogranicz ranking</p></div></div>
        <fieldset><legend>Banki</legend><button v-for="bank in banks" :key="bank.slug" type="button" class="chip" :class="{ active: filters.banks.includes(bank.slug) }" @click="toggleBank(bank.slug)">{{ bank.name }}</button></fieldset>
        <label>Oprocentowanie<select v-model="filters.interestType"><option value="all">Wszystkie</option><option value="fixed_periodic">Okresowo stałe</option><option value="variable">Zmienne</option></select></label>
        <label>Maks. pierwsza rata + koszty <input v-model.number="filters.maxMonthlyOutflow" type="number" min="0" placeholder="Bez limitu"></label>
        <label>Maks. koszty początkowe <input v-model.number="filters.maxInitialCosts" type="number" min="0" placeholder="Bez limitu"></label>
        <label class="check"><input v-model="filters.completeOnly" type="checkbox"> Tylko bez nieznanych kosztów</label>
      </aside>

      <div class="results">
        <div class="results-toolbar">
          <div><strong>{{ visibleOffers.length }}</strong> wyników <span>· LTV netto / cena {{ number.format(ltv) }}%</span></div>
          <label>Sortuj<select v-model="sortBy"><option value="cost5y">Koszt pierwszych 5 lat</option><option value="firstOutflow">Pierwsza rata z kosztami</option><option value="totalCost">Koszt całkowity</option><option value="initialCosts">Koszty początkowe</option><option value="apr">RRSO z przykładu banku</option><option value="completeness">Kompletność danych</option></select></label>
        </div>

        <div v-if="pending" class="loading-grid"><USkeleton v-for="i in 5" :key="i" class="h-64 w-full" /></div>
        <div v-else-if="!visibleOffers.length" class="empty"><UIcon name="i-lucide-list-filter" /><h3>Brak wyników dla filtrów</h3><p>Usuń część limitów lub wybierz więcej banków.</p></div>
        <div v-else class="offer-grid">
          <article v-for="(offer, index) in visibleOffers" :key="offer.product.id" class="offer" :class="{ selected: selected?.product.id === offer.product.id, ineligible: !offer.eligible }">
            <header><div class="offer-heading"><span class="rank">#{{ index + 1 }}</span><span v-if="offer.product.bank.logoUrl" class="bank-logo" :style="offer.product.bank.logoBackground ? { backgroundColor: offer.product.bank.logoBackground } : undefined"><img :src="offer.product.bank.logoUrl" :alt="`Logo ${offer.product.bank.name}`"></span><div><small>{{ offer.product.bank.name }}</small><h3>{{ offer.product.name }}</h3></div></div><span class="score">{{ offer.product.version.completeness_score }}% danych</span></header>
            <div class="primary-price"><span>Pierwsza rata</span><strong>{{ money(offer.result.firstInstallment) }}</strong><small>+ {{ money(offer.result.firstRecurringCosts) }} kosztów miesięcznych</small><small v-if="offer.result.capitalizedCosts">Saldo brutto {{ money(offer.result.grossLoanAmount) }} · koszty doliczone do kapitału {{ money(offer.result.capitalizedCosts) }} (na starcie {{ money(offer.result.financedCosts) }})</small></div>
            <dl>
              <div><dt>Po okresie stałym</dt><dd>{{ offer.result.postFixedInstallment == null ? '—' : money(offer.result.postFixedInstallment) }}</dd></div>
              <div><dt>Scenariusz +2 p.p.</dt><dd>{{ offer.stress.postFixedInstallment == null ? money(offer.stress.firstInstallment) : money(offer.stress.postFixedInstallment) }}</dd></div>
              <div><dt>Koszt 5 lat</dt><dd>{{ money(offer.result.costFirstFiveYears) }}</dd></div>
              <div><dt>Koszt całkowity*</dt><dd>{{ money(offer.result.totalCost) }}</dd></div>
              <div><dt>Start</dt><dd>{{ money(offer.result.initialCosts) }}</dd></div>
              <div><dt>RRSO banku</dt><dd>{{ offer.product.version.representative_apr_pct == null ? 'nieznane' : `${number.format(offer.product.version.representative_apr_pct)}%` }}</dd></div>
            </dl>
            <div class="rate"><span>{{ rateLines(offer)[0] }}</span><span>{{ rateLines(offer)[1] }}</span></div>
            <div v-if="v2Definition(offer.product)?.features.length || v2Definition(offer.product)?.presets.length" class="offer-options">
              <label v-if="v2Definition(offer.product)?.presets.length" class="offer-options__preset">
                Wariant cenowy
                <select
                  :value="productPresetValue(offer.product)"
                  @change="updateProductPreset(offer.product, $event)"
                >
                  <option value="">Konfiguracja własna</option>
                  <option v-for="preset in v2Definition(offer.product)?.presets ?? []" :key="preset.id" :value="preset.id">
                    {{ preset.label }}{{ preset.isDefault ? ' · domyślny' : '' }}
                  </option>
                </select>
                <small>Wariant pochodzi z opublikowanej wersji oferty. Zmiana automatycznie przelicza marżę, ratę i powiązane koszty.</small>
              </label>
              <label v-for="feature in v2Definition(offer.product)?.features ?? []" :key="feature.id">
                {{ feature.label }}
                <select
                  :value="productSelectionValue(offer.product, feature.id)"
                  @change="updateProductSelection(offer.product.id, feature.id, $event)"
                >
                  <option value="">— wybierz —</option>
                  <option v-for="option in feature.options" :key="option.id" :value="option.id">{{ option.label }}</option>
                </select>
                <span class="offer-options__change">
                  <span>Zmiana / utrata warunku od mies.</span>
                  <input :value="productSelectionEvent(offer.product.id, feature.id)?.month ?? ''" type="number" min="1" :max="scenario.years * 12" placeholder="bez zmiany" @input="updateProductSelectionEventMonth(offer.product, feature.id, $event)">
                  <select v-if="productSelectionEvent(offer.product.id, feature.id)" :value="productSelectionEvent(offer.product.id, feature.id)?.optionId" @change="updateProductSelectionEventOption(offer.product.id, feature.id, $event)">
                    <option v-for="option in feature.options" :key="option.id" :value="option.id">{{ option.label }}</option>
                  </select>
                </span>
              </label>
            </div>
            <div v-if="!offer.eligible || offer.result.status !== 'complete' || offer.product.version.unknown_fields.length" class="unknown"><UIcon name="i-lucide-circle-help" /> {{ !offer.eligible || offer.result.status === 'ineligible' ? 'Scenariusz poza kryteriami lub limitami oferty' : offer.result.status === 'unsupported' ? 'Konfiguracja nie pozwala na kalkulację' : 'Wynik częściowy — dostępność, limity lub część kosztów wymagają potwierdzenia' }}</div>
            <footer>
              <button type="button" class="secondary" :disabled="!comparedIds.includes(offer.product.id) && comparedIds.length >= 3" @click="toggleCompare(offer.product.id)">{{ comparedIds.includes(offer.product.id) ? 'Usuń z porównania' : 'Porównaj' }}</button>
              <button type="button" :class="caseId ? 'secondary' : 'primary'" @click="selectedId = offer.product.id">Szczegóły</button>
              <button
                v-if="caseId"
                type="button"
                class="primary"
                :data-testid="`save-offer-${offer.product.slug}`"
                :disabled="!offer.saveable || caseContextPending || !caseContext || savingOfferKeys.includes(offerSaveKey(offer.product.id, offer.product.version.version_key, calculationScenario(offer.product))) || persistedOfferKeys.has(offerSaveKey(offer.product.id, offer.product.version.version_key, calculationScenario(offer.product)))"
                :title="offer.saveable
                  ? offer.result.status === 'partial'
                    ? 'Wynik częściowy zostanie zapisany na shortliście ze statusem warunków i kosztów do potwierdzenia'
                    : undefined
                  : 'Scenariusz musi spełniać kryteria oferty i dać się bezpiecznie obliczyć'"
                @click="saveOffer(offer)"
              >
                {{ persistedOfferKeys.has(offerSaveKey(offer.product.id, offer.product.version.version_key, calculationScenario(offer.product))) ? 'Zapisano' : savingOfferKeys.includes(offerSaveKey(offer.product.id, offer.product.version.version_key, calculationScenario(offer.product))) ? 'Zapisywanie…' : 'Zapisz w sprawie' }}
              </button>
            </footer>
          </article>
        </div>

        <section v-if="compared.length" class="comparison">
          <div class="comparison-heading">
            <div class="section-title"><span>03</span><div><h2>Porównanie obok siebie</h2><p>Maksymalnie trzy produkty</p></div></div>
            <button
              type="button"
              class="primary"
              data-testid="share-comparison-to-meeting"
              @click="presentComparedOffers"
            >
              <UIcon :name="meetingReturnPath ? 'i-lucide-arrow-left' : 'i-lucide-calendar-video'" />
              {{ meetingReturnPath ? 'Wróć do spotkania' : 'Przejdź do spotkań' }}
            </button>
          </div>
          <div class="comparison-table"><table><thead><tr><th>Parametr</th><th v-for="offer in compared" :key="offer.product.id">{{ offer.product.bank.name }}<button type="button" @click="toggleCompare(offer.product.id)">×</button></th></tr></thead><tbody>
            <tr><th>Pierwsza rata</th><td v-for="offer in compared" :key="offer.product.id">{{ money(offer.result.firstInstallment) }}</td></tr>
            <tr><th>Rata po stałej stopie</th><td v-for="offer in compared" :key="offer.product.id">{{ offer.result.postFixedInstallment == null ? '—' : money(offer.result.postFixedInstallment) }}</td></tr>
            <tr><th>Koszt przez 5 lat</th><td v-for="offer in compared" :key="offer.product.id">{{ money(offer.result.costFirstFiveYears) }}</td></tr>
            <tr><th>Odsetki</th><td v-for="offer in compared" :key="offer.product.id">{{ money(offer.result.totalInterest) }}</td></tr>
            <tr><th>Koszty kredytowane</th><td v-for="offer in compared" :key="offer.product.id">{{ money(offer.result.financedCosts) }}</td></tr>
            <tr><th>Łącznie doliczone do kapitału</th><td v-for="offer in compared" :key="offer.product.id">{{ money(offer.result.capitalizedCosts) }}</td></tr>
            <tr><th>Saldo początkowe brutto</th><td v-for="offer in compared" :key="offer.product.id">{{ money(offer.result.grossLoanAmount) }}</td></tr>
            <tr><th>Zwroty / zaliczenia</th><td v-for="offer in compared" :key="offer.product.id">{{ money(offer.result.refunds) }}</td></tr>
            <tr><th>Znane koszty dodatkowe</th><td v-for="offer in compared" :key="offer.product.id">{{ money(offer.result.initialCosts + offer.result.totalRecurringCosts) }}</td></tr>
            <tr><th>Koszty warunkowe</th><td v-for="offer in compared" :key="offer.product.id">{{ money(offer.result.conditionalCosts) }}</td></tr>
            <tr><th>Koszty pozaodsetkowe klasyfikowane do RRSO</th><td v-for="offer in compared" :key="offer.product.id">{{ money(offer.result.aprEligibleNonInterestCosts) }}</td></tr>
            <tr><th>Nieznane pola</th><td v-for="offer in compared" :key="offer.product.id">{{ offer.product.version.unknown_fields.length }}</td></tr>
          </tbody></table></div>
        </section>

        <section v-if="selected" class="detail">
          <div class="section-title"><span>04</span><div><h2>{{ selected.product.bank.name }} · szczegóły raty</h2><p>{{ selected.product.name }}</p></div></div>
          <div class="detail-grid">
            <div class="anatomy"><h3>Pierwsza płatność miesięczna</h3><strong>{{ money(selected.result.firstTotalOutflow) }}</strong><div class="bar"><span :style="{ width: `${selected.result.firstInstallment / selected.result.firstTotalOutflow * 100}%` }"></span></div><dl><div><dt>Kapitał</dt><dd>{{ money(selected.result.schedule[0]?.principal ?? 0) }}</dd></div><div><dt>Odsetki</dt><dd>{{ money(selected.result.schedule[0]?.interest ?? 0) }}</dd></div><div><dt>Koszty cykliczne</dt><dd>{{ money(selected.result.schedule[0]?.recurringCosts ?? 0) }}</dd></div><div><dt>Nadpłata</dt><dd>{{ money(selected.result.schedule[0]?.overpayment ?? 0) }}</dd></div></dl></div>
            <div class="summary"><h3>Podsumowanie scenariusza</h3><dl><div><dt>Netto / LTV</dt><dd>{{ compactMoney(selected.result.netLoanAmount) }} / {{ number.format(selected.result.ltvPct) }}%</dd></div><div><dt>Saldo brutto</dt><dd>{{ money(selected.result.grossLoanAmount) }}</dd></div><div><dt>Koszty kredytowane</dt><dd>{{ money(selected.result.financedCosts) }}</dd></div><div><dt>Gotówka na start</dt><dd>{{ money(selected.result.initialCashRequired) }}</dd></div><div><dt>Spłata</dt><dd>{{ selected.result.paidOffMonth }} mies.</dd></div><div><dt>Odsetki</dt><dd>{{ money(selected.result.totalInterest) }}</dd></div><div><dt>Koszty kredytu</dt><dd>{{ money(selected.result.creditCosts) }}</dd></div><div><dt>Koszty transakcyjne</dt><dd>{{ money(selected.result.transactionCosts) }}</dd></div><div><dt>Zwroty</dt><dd>{{ money(selected.result.refunds) }}</dd></div><div><dt>Łączny wydatek*</dt><dd>{{ money(selected.result.totalPayment) }}</dd></div></dl></div>
          </div>

          <div class="detail-columns">
            <div><h3>Koszty w wybranym wariancie</h3><ul class="facts"><li v-for="item in costItems(selected)" :key="item[0]"><span>{{ item[0] }}</span><strong :class="{ muted: item[1] == null }">{{ item[1] ?? 'nieznane' }}</strong></li></ul></div>
            <div><h3>Wymagania i założenia</h3><ul><li v-for="item in offerRequirements(selected)" :key="item">{{ item }}</li></ul><ul class="assumptions"><li v-for="item in selected.product.version.assumptions" :key="item">{{ item }}</li></ul></div>
            <div><h3>Braki danych</h3><ul class="missing"><li v-for="item in selected.product.version.unknown_fields" :key="item">{{ item }}</li><li v-if="!selected.product.version.unknown_fields.length">Brak oznaczonych braków</li></ul></div>
          </div>

          <div class="schedule-heading"><div><h3>Harmonogram miesięczny</h3><p>Saldo, kapitał, odsetki, nadpłata i koszty — deterministycznie dla każdego miesiąca.</p></div><button v-if="scheduleRows < selected.result.schedule.length" type="button" class="secondary" @click="scheduleRows = selected.result.schedule.length">Pokaż wszystkie {{ selected.result.schedule.length }} rat</button></div>
          <div class="schedule"><table><thead><tr><th>Mies.</th><th>Stopa</th><th>Saldo otwarcia</th><th>Rata</th><th>Kapitał</th><th>Odsetki</th><th>Nadpłata</th><th>Koszty</th><th>Refund</th><th>Saldo końcowe</th></tr></thead><tbody><tr v-for="row in selected.result.schedule.slice(0, scheduleRows)" :key="row.month" :class="{ boundary: row.month === (selected.product.version.fixed_period_months ?? 0) + 1 }"><td>{{ row.month }}</td><td>{{ number.format(row.annualRatePct) }}%</td><td>{{ money(row.openingBalance) }}</td><td>{{ money(row.installment) }}</td><td>{{ money(row.principal) }}</td><td>{{ money(row.interest) }}</td><td>{{ money(row.overpayment) }}</td><td>{{ money(row.recurringCosts) }}</td><td>{{ row.refunds ? money(row.refunds) : '—' }}</td><td>{{ money(row.closingBalance) }}</td></tr></tbody></table></div>

          <footer class="source"><div><UIcon name="i-lucide-file-check-2" /><div><strong>{{ selected.product.version.source?.title ?? 'Źródło bankowe' }}</strong><span>Pobrano {{ formatDate(selected.product.version.source?.retrieved_at?.slice(0, 10)) }} · kalkulacja banku {{ formatDate(selected.product.version.calculation_date) }} · {{ selected.product.version.source?.retrieval_status }}</span><code v-if="selected.product.version.source?.sha256">sha256 {{ selected.product.version.source.sha256.slice(0, 16) }}…</code></div></div><a v-if="selected.product.version.source?.source_url" :href="selected.product.version.source.source_url" target="_blank" rel="noopener noreferrer">Otwórz dokument banku ↗</a></footer>
          <p class="fineprint">* Koszt i łączny wydatek obejmują wyłącznie znane, modelowalne pozycje. Opublikowane RRSO dotyczy przykładu reprezentatywnego banku o innych parametrach; nie jest RRSO tego scenariusza. Wynik nie ocenia zdolności kredytowej, nie gwarantuje dostępności i nie stanowi rekomendacji ani oferty.</p>
        </section>
      </div>
    </div>
  </CrmShell>
</template>

<style scoped>
.case-context{margin-bottom:16px}.notice{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:12px;margin-bottom:20px;padding:14px 16px;border:1px solid var(--ui-border);border-radius:12px;background:var(--ui-bg);font-size:13px}.notice p{margin:0}.notice span{color:var(--ui-text-muted);white-space:nowrap}.workspace{display:grid;grid-template-columns:280px minmax(0,1fr);gap:20px;align-items:start}.scenario-panel{position:sticky;top:20px;display:grid;gap:16px;padding:20px;border:1px solid var(--ui-border);border-radius:14px;background:var(--ui-bg)}.panel-heading,.section-title{display:flex;gap:12px;align-items:flex-start}.panel-heading>span,.section-title>span{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--ui-primary);color:white;font:700 11px var(--font-mono)}h2,h3,p{margin:0}.panel-heading h2,.section-title h2{font-size:18px}.panel-heading p,.section-title p,.schedule-heading p{color:var(--ui-text-muted);font-size:12px}.panel-heading--compact{margin-top:8px;padding-top:20px;border-top:1px solid var(--ui-border)}label{display:grid;gap:7px;color:var(--ui-text-muted);font-size:12px;font-weight:600}label small{font-weight:400}input,select{width:100%;height:40px;padding:0 10px;border:1px solid var(--ui-border);border-radius:8px;background:var(--ui-bg);color:var(--ui-text-highlighted);font:inherit}input[type=range]{height:auto;padding:0}.label-value{float:right;color:var(--ui-text-highlighted)}.scenario-metrics{display:grid;grid-template-columns:1fr 1fr;gap:8px}.scenario-metrics span{display:grid;gap:3px;padding:10px;border-radius:8px;background:var(--ui-bg-muted);color:var(--ui-text-muted);font-size:11px}.scenario-metrics strong{color:var(--ui-text-highlighted)}.danger strong{color:var(--ui-error)}fieldset{display:flex;flex-wrap:wrap;gap:6px;padding:0;border:0}legend{width:100%;margin-bottom:7px;color:var(--ui-text-muted);font-size:12px;font-weight:600}.chip,.secondary,.primary{min-height:32px;padding:0 10px;border:1px solid var(--ui-border);border-radius:8px;background:transparent;color:var(--ui-text);cursor:pointer}.chip{font-size:11px}.chip.active,.primary{border-color:var(--ui-primary);background:var(--ui-primary);color:white}.check{display:flex;grid-template-columns:auto 1fr;align-items:center}.check input{width:16px;height:16px}.label-value{float:right;color:var(--ui-text-highlighted)}.results{min-width:0}.results-toolbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}.results-toolbar>div{font-size:13px}.results-toolbar>div strong{font-size:22px}.results-toolbar>div span{color:var(--ui-text-muted)}.results-toolbar label{display:flex;grid-template-columns:auto 230px;align-items:center}.offer-grid,.loading-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.offer{display:grid;gap:15px;padding:18px;border:1px solid var(--ui-border);border-radius:14px;background:var(--ui-bg);transition:.2s}.offer.selected{border-color:var(--ui-primary);box-shadow:0 0 0 1px var(--ui-primary)}.offer header,.offer footer,.source,.source>div,.schedule-heading{display:flex;justify-content:space-between;gap:12px}.offer-heading{display:flex;align-items:flex-start;min-width:0}.offer header small{display:block;color:var(--ui-text-muted)}.offer h3{margin-top:3px;font-size:15px}.rank{display:inline-grid;place-items:center;flex:0 0 auto;width:28px;height:28px;margin-right:8px;border-radius:6px;background:var(--ui-bg-muted);font:700 11px var(--font-mono)}.bank-logo{display:grid;place-items:center;flex:0 0 auto;width:34px;height:34px;margin-right:9px;overflow:hidden;border:1px solid var(--ui-border);border-radius:7px;background:var(--ui-bg-muted)}.bank-logo img{width:100%;height:100%;padding:4px;object-fit:contain}.score{height:max-content;padding:4px 7px;border-radius:99px;background:var(--ui-bg-muted);color:var(--ui-text-muted);font-size:10px;white-space:nowrap}.primary-price{display:grid;gap:3px;padding:14px;border-radius:10px;background:var(--ui-bg-muted)}.primary-price span,.primary-price small{color:var(--ui-text-muted);font-size:11px}.primary-price strong{font-size:28px;font-weight:600}.offer dl,.summary dl,.anatomy dl{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0}.offer dl div,.summary dl div,.anatomy dl div{display:grid;gap:2px}.offer dt,.summary dt,.anatomy dt{color:var(--ui-text-muted);font-size:10px}.offer dd,.summary dd,.anatomy dd{margin:0;font-size:13px;font-weight:600}.rate{display:grid;gap:4px;padding-left:10px;border-left:2px solid var(--ui-primary);font-size:11px}.offer-options{display:grid;gap:8px;padding:10px;border:1px solid var(--ui-border);border-radius:10px;background:var(--ui-bg-muted)}.offer-options label{font-size:11px}.offer-options select{height:34px;background:var(--ui-bg)}.offer-options__preset{padding-bottom:9px;border-bottom:1px solid var(--ui-border)}.offer-options__preset small{color:var(--ui-text-muted);font-size:10px;line-height:1.4}.offer-options__change{display:grid;grid-template-columns:minmax(130px,1fr) 90px minmax(130px,1fr);gap:6px;align-items:center;color:var(--ui-text-muted);font-size:10px;font-weight:400}.offer-options__change input,.offer-options__change select{height:32px;background:var(--ui-bg)}.unknown{display:flex;gap:6px;align-items:center;color:var(--ui-warning);font-size:11px}.offer footer button{flex:1}.offer footer button:disabled{opacity:.4;cursor:not-allowed}.empty{display:grid;place-items:center;gap:8px;padding:60px;border:1px dashed var(--ui-border);border-radius:14px}.empty>svg{font-size:32px}.comparison,.detail{margin-top:28px;padding-top:24px;border-top:1px solid var(--ui-border)}.comparison-table,.schedule{overflow:auto;margin-top:15px;border:1px solid var(--ui-border);border-radius:12px}table{width:100%;border-collapse:collapse;font-size:12px;white-space:nowrap}th,td{padding:11px 12px;border-bottom:1px solid var(--ui-border);text-align:right}th:first-child,td:first-child{text-align:left}thead th{background:var(--ui-bg-muted);color:var(--ui-text-muted);font-size:10px;text-transform:uppercase}.comparison th button{margin-left:8px;border:0;background:none;color:var(--ui-text-muted);cursor:pointer}.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:16px}.anatomy,.summary{padding:18px;border:1px solid var(--ui-border);border-radius:12px;background:var(--ui-bg)}.anatomy>strong{display:block;margin:12px 0 7px;font-size:30px}.bar{height:7px;margin-bottom:14px;border-radius:99px;background:var(--ui-bg-muted);overflow:hidden}.bar span{display:block;height:100%;background:var(--ui-primary)}.detail-columns{display:grid;grid-template-columns:1.1fr 1.4fr 1fr;gap:14px;margin-top:14px}.detail-columns>div{padding:16px;border:1px solid var(--ui-border);border-radius:12px;background:var(--ui-bg)}.detail-columns h3{margin-bottom:12px;font-size:13px}.detail-columns ul{display:grid;gap:7px;margin:0;padding-left:18px;color:var(--ui-text-muted);font-size:11px}.facts{padding:0!important;list-style:none}.facts li{display:flex;justify-content:space-between;gap:8px}.facts strong{color:var(--ui-text-highlighted)}.facts .muted{color:var(--ui-warning)}.assumptions{margin-top:12px!important;padding-top:12px!important;border-top:1px solid var(--ui-border)}.missing li::marker{color:var(--ui-warning)}.schedule-heading{align-items:flex-end;margin-top:24px}.boundary{box-shadow:inset 3px 0 var(--ui-warning)}.source{align-items:center;margin-top:14px;padding:15px;border:1px solid var(--ui-border);border-radius:12px;background:var(--ui-bg)}.source>div{align-items:flex-start}.source>div>svg{font-size:22px;color:var(--ui-success)}.source strong,.source span,.source code{display:block}.source span,.source code{margin-top:3px;color:var(--ui-text-muted);font-size:10px}.source a{color:var(--ui-primary);font-size:12px}.fineprint{margin-top:12px;color:var(--ui-text-muted);font-size:10px;line-height:1.5}.primary,.secondary{font-size:12px}.loading-grid{grid-template-columns:repeat(2,1fr)}
.panel-heading>span,
.section-title>span,
.chip.active,
.primary{color:var(--ui-text-inverted)}
.comparison-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}.comparison-heading>.primary{display:inline-flex;align-items:center;gap:7px;min-height:38px;padding-inline:14px;white-space:nowrap}.comparison-heading>.primary svg{font-size:16px}
@media(max-width:1100px){.workspace{grid-template-columns:1fr}.scenario-panel{position:static;grid-template-columns:repeat(2,minmax(0,1fr))}.panel-heading,.panel-heading--compact,fieldset{grid-column:1/-1}.offer-grid{grid-template-columns:1fr}.detail-columns{grid-template-columns:1fr}.notice{grid-template-columns:auto 1fr}.notice>span{grid-column:2}}
@media(max-width:700px){.scenario-panel{grid-template-columns:1fr}.results-toolbar,.source,.schedule-heading,.comparison-heading{align-items:stretch;flex-direction:column}.results-toolbar label{grid-template-columns:1fr}.detail-grid{grid-template-columns:1fr}.notice{grid-template-columns:1fr}.notice>span{grid-column:1}.offer dl{grid-template-columns:1fr}.offer-options__change{grid-template-columns:1fr;align-items:stretch}.primary-price strong{font-size:24px}.comparison-heading>.primary{justify-content:center}}
</style>
