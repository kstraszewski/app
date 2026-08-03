<script setup lang="ts">
import * as z from 'zod'
import type { FormError, FormSubmitEvent } from '@nuxt/ui'
import {
  calculateMortgageOfferV2,
  validateMortgageOfferV2,
} from '@openexpert/mortgage'
import type {
  ActivePeriodV2,
  MortgageCalculationIssueV2,
  MortgageCalculationV2,
  MortgageConditionV2,
  MortgageCostSettlementV2,
  MortgageFeatureV2,
  MortgageScenarioV2,
  RatePhaseV2,
  TimelineAnchorV2,
} from '@openexpert/mortgage'
import MortgageActivePeriodEditor from '~/components/mortgages/MortgageActivePeriodEditor.vue'
import MortgageConditionEditor from '~/components/mortgages/MortgageConditionEditor.vue'
import MortgageCostFormulaEditor from '~/components/mortgages/MortgageCostFormulaEditor.vue'
import MortgageEvidenceReferencesEditor from '~/components/mortgages/MortgageEvidenceReferencesEditor.vue'
import MortgageTimelineAnchorEditor from '~/components/mortgages/MortgageTimelineAnchorEditor.vue'
import type {
  DocumentRequirementV2,
  MortgageCostRuleDraftV2,
  MortgageOfferDraftDataV2,
  OfferSourceV2,
} from '~/types/mortgage-offer-draft'
import {
  mortgageBackofficeErrorStatus,
  normalizeMortgageOfferDetail,
} from '~/types/mortgage-offer-backoffice'
import { apiErrorMessage } from '~/utils/api-error'
import {
  cloneMortgageOfferDraftV2,
  conditionForSelection,
  createActivePeriodV2,
  createBridgeInsuranceV2,
  createDocumentRequirementV2,
  createMortgageCostV2,
  createMortgageFeatureOptionV2,
  createMortgageFeatureV2,
  createMortgagePresetV2,
  createOfferSourceV2,
  createRateModifierV2,
  createRatePhaseV2,
  eventAnchor,
  fixedCostFormulaV2,
  monthAnchor,
  normalizeMortgageOfferDraftV2,
  percentageCostFormulaV2,
} from '~/utils/mortgage-offer-draft'

definePageMeta({
  middleware: ['auth', 'organization'],
  path: 'settings/products/:offerId',
  alias: ['mortgages/offers/:offerId'],
})

type OrganizationProductSettingsPayload = {
  data: {
    id: string
    baseName: string
    isEnabled: boolean
    customName: string | null
    notes: string | null
    revision: number
    isCustomized: boolean
    bankEnabled: boolean
    hasPublishedVersion: boolean
    liveInCalculator: boolean
    createdAt: string | null
    updatedAt: string | null
  }
}

const route = useRoute()
const router = useRouter()
const toast = useToast()
const organizationSlug = computed(() => String(route.params.organizationSlug ?? ''))
const offerId = computed(() => String(route.params.offerId ?? ''))
const listPath = computed(() => `/org/${organizationSlug.value}/settings/products`)
const calculatorPath = computed(() => `/org/${organizationSlug.value}/calculator/mortgages`)
const endpoint = computed(() => `/api/backoffice/mortgages/offers/${encodeURIComponent(offerId.value)}`)
const organizationSettingsEndpoint = computed(() => (
  `/api/org/${organizationSlug.value}/mortgages/products/${encodeURIComponent(offerId.value)}`
))

const [
  { data: rawDetail, status, error, refresh },
  {
    data: organizationSettings,
    status: organizationSettingsStatus,
    error: organizationSettingsError,
    refresh: refreshOrganizationSettings,
  },
] = await Promise.all([
  useFetch<unknown>(endpoint, {
    default: () => ({ data: null }),
  }),
  useFetch<OrganizationProductSettingsPayload>(organizationSettingsEndpoint, {
    default: () => ({
      data: {
        id: '',
        baseName: '',
        isEnabled: true,
        customName: null,
        notes: null,
        revision: 0,
        isCustomized: false,
        bankEnabled: true,
        hasPublishedVersion: false,
        liveInCalculator: false,
        createdAt: null,
        updatedAt: null,
      },
    }),
  }),
])
const detail = computed(() => normalizeMortgageOfferDetail<MortgageOfferDraftDataV2>(rawDetail.value))
const bankPath = computed(() => detail.value?.bank?.id
  ? `/org/${organizationSlug.value}/settings/institutions/${encodeURIComponent(detail.value.bank.id)}`
  : '')

const draft = ref<MortgageOfferDraftDataV2>(normalizeMortgageOfferDraftV2(null))
const revision = ref(0)
const baseline = ref('')
const hydratedOfferId = ref('')
const saving = ref(false)
const publishing = ref(false)
const publishOpen = ref(false)
const conflict = ref<string | null>(null)
const savingOrganizationSettings = ref(false)
const resettingOrganizationSettings = ref(false)
const organizationForm = reactive({
  isEnabled: organizationSettings.value.data.isEnabled,
  customName: organizationSettings.value.data.customName ?? '',
  notes: organizationSettings.value.data.notes ?? '',
})
const editorForm = useTemplateRef('editorForm')
const legacyDraftNotice = computed(() => (
  detail.value?.draft.seededFromLegacy === true
  || draft.value.migration?.fromSchema === 'legacy-flat-v1'
))
const legacyDraftDescription = computed(() => (
  detail.value?.draft.seedWarnings[0]
  ?? 'Ta oferta została przeniesiona z wcześniejszego modelu danych. Sprawdź pola oznaczone jako nieznane, zapisz szkic i dopiero potem opublikuj nową wersję.'
))

function syncOrganizationForm(payload = organizationSettings.value) {
  organizationForm.isEnabled = payload.data.isEnabled
  organizationForm.customName = payload.data.customName ?? ''
  organizationForm.notes = payload.data.notes ?? ''
}

watch(organizationSettings, payload => syncOrganizationForm(payload), { immediate: true })

const editorSteps = [
  { value: 'basics', slot: 'basics', title: 'Podstawy', description: 'Ważność i dostępność', icon: 'i-lucide-settings-2' },
  { value: 'rates', slot: 'rates', title: 'Stopa', description: 'Fazy i zmiany marży', icon: 'i-lucide-percent' },
  { value: 'features', slot: 'features', title: 'Warunki', description: 'Cross-sell i warianty', icon: 'i-lucide-git-branch' },
  { value: 'costs', slot: 'costs', title: 'Koszty', description: 'Prowizje i ubezpieczenia', icon: 'i-lucide-receipt-text' },
  { value: 'bridge', slot: 'bridge', title: 'Pomostowe', description: 'Podwyżka i zwrot', icon: 'i-lucide-landmark' },
  { value: 'documents', slot: 'documents', title: 'Dokumenty', description: 'Checklista i źródła', icon: 'i-lucide-files' },
  { value: 'preview', slot: 'preview', title: 'Laboratorium', description: 'Próba kalkulacji', icon: 'i-lucide-flask-conical' },
]
function editorStepFromQuery(value: unknown) {
  const requested = Array.isArray(value) ? value[0] : value
  return typeof requested === 'string' && editorSteps.some(step => step.value === requested)
    ? requested
    : 'basics'
}

const activeStep = ref(editorStepFromQuery(route.query.step))

const draftSchema = z.object({
  schemaVersion: z.literal('openexpert.mortgage-offer/2.0'),
  currency: z.literal('PLN'),
  validity: z.object({
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'Podaj poprawną datę.'),
    effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'Podaj poprawną datę.').nullable(),
    pricingAsOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'Podaj poprawną datę.'),
  }),
  calculationPolicy: z.object({
    accrual: z.enum(['nominal_monthly_12', 'actual_365_fixed']),
    eventOrder: z.literal('openexpert_v2'),
    rounding: z.object({
      currencyScale: z.literal(2),
      interest: z.literal('half_up_each_period'),
      charges: z.literal('half_up_each_charge'),
      balance: z.enum(['rounded', 'high_precision']),
    }),
  }),
  eligibility: z.object({
    minAmount: z.string(),
    maxAmount: z.string().nullable(),
    amountBasis: z.enum(['net_loan', 'gross_loan', 'facility_limit']),
    minTermMonths: z.number().int().min(1),
    maxTermMonths: z.number().int().min(1),
    allowedInstallmentTypes: z.array(z.enum(['equal', 'decreasing'])).min(1, 'Wybierz co najmniej jeden rodzaj rat.'),
    maxLtvPct: z.string(),
    ltvDebtBasis: z.enum(['net_loan', 'gross_loan', 'facility_limit']),
    collateralValueBasis: z.enum(['purchase_price', 'appraisal_value', 'lower_of_purchase_and_appraisal']),
  }),
  ratePlan: z.object({ phases: z.array(z.unknown()), modifiers: z.array(z.unknown()) }),
  features: z.array(z.unknown()),
  presets: z.array(z.unknown()),
  costs: z.array(z.unknown()),
  disbursementPolicy: z.object({
    maxTranches: z.number().int().min(1),
    supportedGraceModes: z.array(z.enum(['none', 'interest_only', 'capitalize_interest'])).min(1),
    paymentRecalculationTriggers: z.array(z.enum(['rate_change', 'disbursement', 'grace_end', 'lower_payment_overpayment'])),
  }),
  documentation: z.object({ requirements: z.array(z.unknown()), sources: z.array(z.unknown()) }),
}).passthrough().superRefine((value, context) => {
  if (value.validity.effectiveTo && value.validity.effectiveTo < value.validity.effectiveFrom) {
    context.addIssue({
      code: 'custom',
      path: ['validity', 'effectiveTo'],
      message: 'Data końcowa nie może poprzedzać daty początkowej.',
    })
  }
  if (value.eligibility.maxTermMonths < value.eligibility.minTermMonths) {
    context.addIssue({
      code: 'custom',
      path: ['eligibility', 'maxTermMonths'],
      message: 'Maksymalny okres musi być nie mniejszy niż minimalny.',
    })
  }
})
type DraftSchema = z.output<typeof draftSchema>

const canonicalDraft = computed(() => JSON.stringify(draft.value))
const isDirty = computed(() => Boolean(baseline.value) && canonicalDraft.value !== baseline.value)
const unknownCostCount = computed(() => draft.value.costs.filter(cost => cost.state === 'unknown').length)
const calculationReady = computed(() => {
  try {
    const validation = validateMortgageOfferV2(draft.value)
    return validation.valid && !validation.issues.some(issue => issue.kind === 'incomplete')
  } catch {
    return false
  }
})

const rateFormulaItems = [
  { label: 'Stopa stała', value: 'fixed' },
  { label: 'Indeks + marża', value: 'index_plus_margin' },
]
const rateTargetItems = [
  { label: 'Stopa stała', value: 'fixed_rate' },
  { label: 'Marża', value: 'margin' },
  { label: 'Stopa nominalna', value: 'nominal_rate' },
]
const modifierOperationItems = [
  { label: 'Dodaj / odejmij p.p.', value: 'add_percentage_points' },
  { label: 'Ustaw dokładną wartość', value: 'set_percent' },
]
const amountBasisItems = [
  { label: 'Kwota netto dla klienta', value: 'net_loan' },
  { label: 'Kapitał brutto z kosztami', value: 'gross_loan' },
  { label: 'Limit kredytowy', value: 'facility_limit' },
]
const collateralBasisItems = [
  { label: 'Cena zakupu', value: 'purchase_price' },
  { label: 'Wartość z operatu', value: 'appraisal_value' },
  { label: 'Niższa z ceny i operatu', value: 'lower_of_purchase_and_appraisal' },
]
const accrualItems = [
  { label: 'Nominalna / 12', value: 'nominal_monthly_12' },
  { label: 'Rzeczywiste dni / 365 — jeszcze nieobsługiwane', value: 'actual_365_fixed', disabled: true },
]
const balancePrecisionItems = [
  { label: 'Zaokrąglaj saldo co miesiąc', value: 'rounded' },
  { label: 'Saldo wysokiej precyzji — jeszcze nieobsługiwane', value: 'high_precision', disabled: true },
]
const costStateItems = [
  { label: 'Znany — uwzględniaj w obliczeniach', value: 'known' },
  { label: 'Nie dotyczy tej oferty', value: 'not_applicable' },
  { label: 'Nieznany — wynik częściowy', value: 'unknown' },
]
const costClassificationItems = [
  { label: 'Koszt kredytu', value: 'credit_cost' },
  { label: 'Koszt transakcji', value: 'transaction_cost' },
  { label: 'Koszt warunkowy', value: 'conditional_cost' },
  { label: 'Tylko informacyjny', value: 'informational' },
]
const costCategoryItems = [
  ['Prowizja', 'commission'], ['Wycena', 'appraisal'], ['Opłata sądowa', 'court'], ['Podatek', 'tax'],
  ['Konto', 'account'], ['Karta', 'card'], ['Ubezpieczenie życia', 'life_insurance'],
  ['Ubezpieczenie nieruchomości', 'property_insurance'], ['Ubezpieczenie pomostowe', 'bridge_insurance'], ['Inny', 'other'],
].map(([label, value]) => ({ label, value }))
const timingKindItems = [
  { label: 'Jednorazowo', value: 'once' },
  { label: 'Cyklicznie', value: 'recurring' },
  { label: 'Przy każdej transzy', value: 'per_disbursement' },
]
const settlementItems: Array<{ label: string, value: MortgageCostSettlementV2 }> = [
  { label: 'Płatność gotówkowa', value: 'cash' },
  { label: 'Doliczenie do kapitału', value: 'capitalized' },
  { label: 'Potrącenie z wypłaty', value: 'withheld_from_disbursement' },
]
const featureItems = computed(() => draft.value.features.map(feature => ({ label: feature.label, value: feature.id })))
const manualPresetValue = '__manual__'
const presetItems = computed(() => [
  { label: 'Bez presetu — wybór ręczny', value: manualPresetValue },
  ...draft.value.presets.map(preset => ({ label: preset.label, value: preset.id })),
])
const documentCategoryItems = [
  ['Wniosek i formularze', 'application'], ['Tożsamość', 'identity'], ['Dochód — etat', 'income_employment'],
  ['Dochód — działalność', 'income_business'], ['Inne dochody', 'income_other'], ['Zobowiązania', 'liabilities'],
  ['Transakcja', 'transaction'], ['Stan prawny', 'property_legal'], ['Wycena', 'valuation'],
  ['Budowa / remont', 'construction_renovation'], ['Refinansowanie', 'refinance_discharge'],
  ['Ubezpieczenia', 'insurance_security'], ['Uruchomienie', 'disbursement'], ['Zgody i prywatność', 'disclosure_privacy'], ['Inne', 'other'],
].map(([label, value]) => ({ label, value }))
const documentKindItems = [
  { label: 'Dokument klienta', value: 'client_document' },
  { label: 'Dokument bankowy', value: 'bank_document' },
  { label: 'Sprawdzenie zewnętrzne', value: 'external_check' },
  { label: 'Czynność ręczna', value: 'manual_action' },
]
const documentScopeItems = [
  { label: 'Cała sprawa', value: 'case' },
  { label: 'Główny wnioskodawca', value: 'primary_applicant' },
  { label: 'Każdy wnioskodawca', value: 'each_applicant' },
]
const documentStageItems = [
  { label: 'Analiza', value: 'analysis' }, { label: 'Umowa', value: 'agreement' },
  { label: 'Uruchomienie', value: 'disbursement' }, { label: 'Transza', value: 'tranche' },
  { label: 'Obsługa', value: 'maintenance' },
]
const applicabilityItems = [
  { label: 'Zawsze', value: 'always' }, { label: 'Warunkowo', value: 'conditional' },
  { label: 'Opcjonalnie', value: 'optional' }, { label: 'Na żądanie w sprawie', value: 'case_requested' },
]
const evidenceItems = [
  { label: 'Potwierdzone źródłem banku', value: 'confirmed_bank_source' },
  { label: 'Wywnioskowane', value: 'inferred' }, { label: 'Domyślne eksperta', value: 'expert_default' },
  { label: 'Własne organizacji', value: 'organization_custom' },
]
const sourceKindItems = [
  ['Taryfa banku', 'bank_tariff'], ['Strona produktu', 'bank_product_page'], ['Regulamin banku', 'bank_terms'],
  ['Formularz informacyjny', 'bank_information_sheet'], ['Przepis / rekomendacja', 'regulation'],
  ['Notatka eksperta', 'expert_note'], ['Inne', 'other'],
].map(([label, value]) => ({ label, value }))
const sourceRoleItems = [
  ['Cennik', 'pricing'], ['Dostępność', 'eligibility'], ['Koszty', 'costs'], ['Dokumenty', 'documents'],
  ['Podstawa prawna', 'legal'], ['Ogólne', 'general'],
].map(([label, value]) => ({ label, value }))

const previewScenario = reactive<MortgageScenarioV2>({
  property: { purchasePrice: '600000', appraisalValue: '600000' },
  financing: { amount: '480000', amountMode: 'target_net_proceeds', termMonths: 300, installmentType: 'equal' },
  presetId: undefined,
  selections: {},
  selectionEvents: [],
  costSettlements: {},
  disbursements: [],
  grace: { mode: 'none' },
  events: { mortgageRegistered: { month: 6, edge: 'start' } },
})

const previewCalculation = computed<MortgageCalculationV2 | null>(() => {
  try {
    return calculateMortgageOfferV2(draft.value, previewScenario)
  } catch {
    return null
  }
})
const previewIssues = computed<MortgageCalculationIssueV2[]>(() => previewCalculation.value?.issues ?? [])
const firstPayment = computed(() => previewCalculation.value?.schedule.find(row => Number(row.scheduledPayment) > 0) ?? null)

watch(detail, (value) => {
  if (!value || hydratedOfferId.value === value.product.id) return
  hydrateFromServer(value)
}, { immediate: true })

watch(() => draft.value.features, syncPreviewSelections, { deep: true })
watch(() => draft.value.costs, syncPreviewCostSettlements, { deep: true })
watch(() => route.query.step, (value) => {
  const step = editorStepFromQuery(value)
  if (activeStep.value !== step) activeStep.value = step
})
watch(activeStep, (value) => {
  const step = editorStepFromQuery(value)
  const routeStep = editorStepFromQuery(route.query.step)
  const hasCanonicalQuery = step === 'basics'
    ? route.query.step === undefined
    : route.query.step === step

  if (routeStep === step && hasCanonicalQuery) return

  const query = { ...route.query }
  if (step === 'basics') delete query.step
  else query.step = step
  void router.replace({ query })
})
useHead(() => ({ title: `${detail.value?.product.name ?? 'Edycja oferty'} — OpenExpert` }))

defineShortcuts({
  meta_s: () => {
    if (!saving.value && isDirty.value) editorForm.value?.submit()
  },
})

onBeforeRouteLeave(() => {
  if (!isDirty.value || !import.meta.client) return true
  return window.confirm('Masz niezapisane zmiany oferty. Czy na pewno chcesz opuścić edytor?')
})

function hydrateFromServer(value = detail.value) {
  if (!value) return
  draft.value = normalizeMortgageOfferDraftV2(value.draft.draftData)
  revision.value = value.draft.revision
  baseline.value = JSON.stringify(draft.value)
  hydratedOfferId.value = value.product.id
  conflict.value = null
  syncPreviewSelections()
  syncPreviewCostSettlements()
}

async function reloadServerDraft() {
  await refresh()
  const refreshed = normalizeMortgageOfferDetail<MortgageOfferDraftDataV2>(rawDetail.value)
  if (refreshed) hydrateFromServer(refreshed)
}

function invalidateMortgageCatalog() {
  clearNuxtData(`mortgage-catalog:${organizationSlug.value}`)
}

async function saveOrganizationSettings() {
  savingOrganizationSettings.value = true
  try {
    await $fetch(organizationSettingsEndpoint.value, {
      method: 'PATCH',
      body: {
        is_enabled: organizationForm.isEnabled,
        custom_name: organizationForm.customName.trim() || null,
        notes: organizationForm.notes.trim() || null,
      },
    })
    await refreshOrganizationSettings()
    invalidateMortgageCatalog()
    toast.add({
      title: 'Zapisano ustawienia produktu w organizacji',
      description: organizationSettings.value.data.liveInCalculator
        ? 'Produkt jest dostępny w porównywarce tej organizacji.'
        : 'Produkt nie jest obecnie dostępny w porównywarce tej organizacji.',
      color: 'success',
      icon: 'i-lucide-circle-check',
    })
  } catch (caught: unknown) {
    toast.add({
      title: 'Nie udało się zapisać ustawień organizacji',
      description: apiErrorMessage(caught),
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  } finally {
    savingOrganizationSettings.value = false
  }
}

async function resetOrganizationSettings() {
  resettingOrganizationSettings.value = true
  try {
    await $fetch(organizationSettingsEndpoint.value, { method: 'DELETE' })
    await refreshOrganizationSettings()
    invalidateMortgageCatalog()
    toast.add({
      title: 'Przywrócono ustawienia domyślne produktu',
      color: 'success',
      icon: 'i-lucide-rotate-ccw',
    })
  } catch (caught: unknown) {
    toast.add({
      title: 'Nie udało się przywrócić ustawień',
      description: apiErrorMessage(caught),
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  } finally {
    resettingOrganizationSettings.value = false
  }
}

function responseRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const source = value as Record<string, unknown>
  const data = source.data
  return data && typeof data === 'object' && !Array.isArray(data)
    ? data as Record<string, unknown>
    : source
}

async function persistDraft(): Promise<boolean> {
  if (saving.value) return false
  saving.value = true
  conflict.value = null
  try {
    const response = await $fetch<unknown>(`${endpoint.value}/draft`, {
      method: 'PATCH',
      body: {
        expectedRevision: revision.value,
        draftData: cloneMortgageOfferDraftV2(draft.value),
      },
    })
    const saved = responseRecord(response)
    const nextRevision = Number(saved.revision)
    if (Number.isFinite(nextRevision)) revision.value = nextRevision
    baseline.value = JSON.stringify(draft.value)
    toast.add({ title: 'Szkic zapisany', color: 'success', icon: 'i-lucide-cloud-check' })
    return true
  } catch (caught: unknown) {
    if (mortgageBackofficeErrorStatus(caught) === 409) {
      conflict.value = 'Ktoś zapisał nowszą rewizję tej oferty. Pobierz wersję z serwera, aby nie nadpisać cudzych zmian.'
    } else {
      toast.add({
        title: 'Nie udało się zapisać szkicu',
        description: apiErrorMessage(caught),
        color: 'error',
        icon: 'i-lucide-circle-alert',
      })
    }
    return false
  } finally {
    saving.value = false
  }
}

async function submitDraft(_event: FormSubmitEvent<DraftSchema>): Promise<void> {
  await persistDraft()
}

function issuesAsFormErrors(issues: MortgageCalculationIssueV2[]): FormError[] {
  return issues.filter(issue => issue.kind === 'error' || issue.kind === 'incomplete').map(issue => ({
    name: issue.path.replace(/^\$\.?/u, '') || 'schemaVersion',
    message: issue.message,
  }))
}

function documentationFormErrors(): FormError[] {
  const errors: FormError[] = []
  const codes = new Set<string>()
  draft.value.documentation.requirements.forEach((requirement, index) => {
    const code = requirement.code.trim()
    if (!code) errors.push({ name: `documentation.requirements.${index}.code`, message: 'Kod dokumentu jest wymagany.' })
    else if (codes.has(code)) errors.push({ name: `documentation.requirements.${index}.code`, message: 'Kod dokumentu musi być unikalny.' })
    codes.add(code)
    if (!requirement.label.trim()) errors.push({ name: `documentation.requirements.${index}.label`, message: 'Nazwa dokumentu jest wymagana.' })
    if (!requirement.allowedMimeTypes.length && requirement.itemKind === 'client_document') {
      errors.push({ name: `documentation.requirements.${index}.allowedMimeTypes`, message: 'Wybierz co najmniej jeden typ pliku.' })
    }
    if (requirement.applicability === 'conditional' && !selectionCondition(requirement.when)) {
      errors.push({ name: `documentation.requirements.${index}.applicability`, message: 'Warunkowy dokument musi wskazywać wariant oferty.' })
    }
  })

  if (!draft.value.documentation.sources.length) {
    errors.push({ name: 'documentation.sources', message: 'Przed publikacją dodaj co najmniej jedno źródło.' })
  }
  draft.value.documentation.sources.forEach((source, index) => {
    if (!source.title.trim()) errors.push({ name: `documentation.sources.${index}.title`, message: 'Tytuł źródła jest wymagany.' })
    if (!source.retrievedAt || Number.isNaN(Date.parse(`${source.retrievedAt}T00:00:00.000Z`))) {
      errors.push({ name: `documentation.sources.${index}.retrievedAt`, message: 'Data pobrania źródła jest wymagana.' })
    }
    try {
      const url = new URL(source.url)
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('unsupported protocol')
    } catch {
      errors.push({ name: `documentation.sources.${index}.url`, message: 'Podaj poprawny adres HTTP lub HTTPS.' })
    }
  })
  return errors
}

async function openPublishReview() {
  const uiValid = await editorForm.value?.validate({ silent: true }).catch(() => false)
  if (!uiValid) return
  const documentationErrors = documentationFormErrors()
  if (documentationErrors.length) {
    editorForm.value?.setErrors(documentationErrors)
    activeStep.value = 'documents'
    toast.add({
      title: 'Uzupełnij dokumentację oferty',
      description: 'Publikacja wymaga poprawnej checklisty i co najmniej jednego źródła.',
      color: 'warning',
      icon: 'i-lucide-files',
    })
    return
  }
  const validation = validateMortgageOfferV2(draft.value)
  const hasBlockingIssue = !validation.valid || validation.issues.some(issue => issue.kind === 'incomplete')
  if (hasBlockingIssue) {
    editorForm.value?.setErrors(issuesAsFormErrors(validation.issues))
    activeStep.value = 'preview'
    toast.add({
      title: 'Oferta nie jest gotowa do publikacji',
      description: 'Uzupełnij brakujące parametry wskazane w laboratorium kalkulacji.',
      color: 'warning',
      icon: 'i-lucide-triangle-alert',
    })
    return
  }
  publishOpen.value = true
}

async function publishDraft() {
  publishing.value = true
  try {
    if (isDirty.value && !await persistDraft()) return
    await $fetch(`${endpoint.value}/draft/publish`, {
      method: 'POST',
      body: { expectedRevision: revision.value },
    })
    publishOpen.value = false
    toast.add({
      title: 'Oferta została opublikowana',
      description: 'Kalkulatory organizacji, w których produkt jest włączony, mogą już używać nowej wersji.',
      color: 'success',
      icon: 'i-lucide-badge-check',
    })
    invalidateMortgageCatalog()
    await reloadServerDraft()
  } catch (caught: unknown) {
    if (mortgageBackofficeErrorStatus(caught) === 409) {
      publishOpen.value = false
      conflict.value = 'Publikacja została zatrzymana, bo szkic ma nowszą rewizję na serwerze.'
    } else {
      toast.add({
        title: 'Nie udało się opublikować oferty',
        description: apiErrorMessage(caught),
        color: 'error',
        icon: 'i-lucide-circle-alert',
      })
    }
  } finally {
    publishing.value = false
  }
}

function decimalNumber(value: string | null | undefined): number | undefined {
  if (value == null || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function decimalString(value: number | null | undefined): string {
  return value == null || !Number.isFinite(Number(value)) ? '' : String(value)
}

function nullableDecimalString(value: number | null | undefined): string | null {
  return value == null || !Number.isFinite(Number(value)) ? null : String(value)
}

function moveItem<T>(items: T[], index: number, delta: number) {
  const target = index + delta
  if (target < 0 || target >= items.length) return
  const [item] = items.splice(index, 1)
  items.splice(target, 0, item!)
}

function addRatePhase(kind: 'fixed' | 'index_plus_margin') {
  const phase = createRatePhaseV2(kind)
  const previous = draft.value.ratePlan.phases.at(-1)
  if (previous?.period.endExclusive) phase.period.from = structuredClone(previous.period.endExclusive)
  draft.value.ratePlan.phases.push(phase)
}

function changeRateFormula(phase: RatePhaseV2, value: string) {
  const kind = value as 'fixed' | 'index_plus_margin'
  phase.formula = createRatePhaseV2(kind).formula
}

function featureOptions(featureId?: string) {
  return draft.value.features.find(feature => feature.id === featureId)?.options.map(option => ({
    label: option.label,
    value: option.id,
  })) ?? []
}

function addFeatureOption(feature: MortgageFeatureV2) {
  feature.options.push(createMortgageFeatureOptionV2('Nowa opcja'))
}

function addBreachFeatureOption(feature: MortgageFeatureV2) {
  const option = createMortgageFeatureOptionV2('Warunek niespełniony')
  option.description = 'Powiąż z modyfikatorem podwyżki marży i ustaw okres jego działania.'
  for (const existing of feature.options) existing.breachOptionId ??= option.id
  feature.options.push(option)
}

function addConditionalCommission() {
  const cost = createMortgageCostV2()
  cost.label = 'Prowizja zależna od wariantu'
  cost.category = 'commission'
  cost.classification = 'credit_cost'
  cost.state = 'known'
  cost.formula = percentageCostFormulaV2()
  cost.settlement = {
    allowed: ['cash', 'capitalized', 'withheld_from_disbursement'],
    default: 'cash',
  }
  const feature = draft.value.features[0]
  if (feature?.options[0]) cost.when = conditionForSelection(feature.id, feature.options[0].id)
  draft.value.costs.push(cost)
  activeStep.value = 'costs'
}

function removeFeature(featureIndex: number) {
  const [removed] = draft.value.features.splice(featureIndex, 1)
  if (!removed) return
  draft.value.ratePlan.modifiers = draft.value.ratePlan.modifiers.filter(modifier => modifier.sourceFeatureId !== removed.id)
  for (const preset of draft.value.presets) delete preset.selections[removed.id]
  delete previewScenario.selections[removed.id]
  previewScenario.selectionEvents = previewScenario.selectionEvents?.filter(event => event.featureId !== removed.id)
}

function removeFeatureOption(feature: MortgageFeatureV2, optionIndex: number) {
  const [removed] = feature.options.splice(optionIndex, 1)
  if (!removed) return
  if (feature.defaultOptionId === removed.id) feature.defaultOptionId = feature.options[0]?.id
  for (const option of feature.options) {
    if (option.breachOptionId === removed.id) delete option.breachOptionId
  }
  previewScenario.selectionEvents = previewScenario.selectionEvents?.filter(event => (
    event.featureId !== feature.id || event.optionId !== removed.id
  ))
  draft.value.ratePlan.modifiers = draft.value.ratePlan.modifiers.filter(modifier => modifier.sourceOptionId !== removed.id)
  for (const preset of draft.value.presets) {
    if (preset.selections[feature.id] === removed.id) preset.selections[feature.id] = feature.defaultOptionId ?? ''
  }
}

function setDefaultPreset(index: number) {
  draft.value.presets.forEach((preset, presetIndex) => { preset.isDefault = presetIndex === index })
}

function modifierFeatureChanged(modifier: MortgageOfferDraftDataV2['ratePlan']['modifiers'][number], featureId: string | undefined) {
  modifier.sourceFeatureId = featureId || undefined
  modifier.sourceOptionId = featureOptions(featureId)[0]?.value
}

function defaultMortgageCondition(): MortgageConditionV2 {
  const feature = draft.value.features.find(candidate => candidate.options.length)
  const option = feature?.options[0]
  if (feature && option) return conditionForSelection(feature.id, option.id)
  return { op: 'compare', field: 'net_loan_amount', comparator: 'gte', value: '' }
}

function setModifierCondition(modifier: MortgageOfferDraftDataV2['ratePlan']['modifiers'][number], enabled: boolean) {
  if (!enabled) {
    delete modifier.when
    return
  }
  modifier.when ??= defaultMortgageCondition()
}

function setCostState(cost: MortgageCostRuleDraftV2, value: string) {
  const state = value as MortgageCostRuleDraftV2['state']
  cost.state = state
  if (state === 'known') cost.formula ??= fixedCostFormulaV2()
  else delete cost.formula
}

function setCostTiming(cost: MortgageCostRuleDraftV2, value: string) {
  const kind = value as 'once' | 'recurring' | 'per_disbursement'
  if (kind === cost.timing.kind) return
  const existingPeriod = cost.timing.kind === 'recurring' || cost.timing.kind === 'per_disbursement'
    ? cost.timing.period
    : undefined
  if (kind === 'once') cost.timing = { kind: 'once', at: eventAnchor('first_disbursement') }
  if (kind === 'recurring') {
    cost.timing = { kind: 'recurring', period: existingPeriod ?? createActivePeriodV2(), everyMonths: 1 }
    cost.settlement = { allowed: ['cash'], default: 'cash' }
  }
  if (kind === 'per_disbursement') cost.timing = existingPeriod
    ? { kind: 'per_disbursement', period: existingPeriod }
    : { kind: 'per_disbursement' }
}

function setPerDisbursementPeriod(cost: MortgageCostRuleDraftV2, enabled: boolean) {
  if (cost.timing.kind !== 'per_disbursement') return
  if (enabled) cost.timing.period ??= createActivePeriodV2()
  else delete cost.timing.period
}

function setCostSettlement(cost: MortgageCostRuleDraftV2, settlement: MortgageCostSettlementV2, enabled: boolean) {
  const allowed = new Set(cost.settlement.allowed)
  if (enabled) allowed.add(settlement)
  else allowed.delete(settlement)
  if (!allowed.size) allowed.add('cash')
  cost.settlement.allowed = [...allowed]
  if (!allowed.has(cost.settlement.default)) cost.settlement.default = cost.settlement.allowed[0]!
}

function setCostCondition(cost: MortgageCostRuleDraftV2, enabled: boolean) {
  if (!enabled) {
    delete cost.when
    return
  }
  cost.when ??= defaultMortgageCondition()
}

function selectionCondition(value?: MortgageConditionV2): Extract<MortgageConditionV2, { op: 'selection_is' }> | null {
  return value?.op === 'selection_is' ? value : null
}

function enableBridgeInsurance(enabled: boolean) {
  if (enabled) draft.value.bridgeInsurance ??= createBridgeInsuranceV2()
  else delete draft.value.bridgeInsurance
}

function setBridgeRefundKind(value: string) {
  if (!draft.value.bridgeInsurance || value !== 'tagged_amount') return
  draft.value.bridgeInsurance.refund = createBridgeInsuranceV2().refund
}

function setRequirementCondition(requirement: DocumentRequirementV2, enabled: boolean) {
  if (!enabled) {
    delete requirement.when
    requirement.applicability = 'always'
    return
  }
  requirement.applicability = 'conditional'
  const feature = draft.value.features[0]
  if (feature?.options[0]) requirement.when = conditionForSelection(feature.id, feature.options[0].id)
}

function updateRequirementConditionFeature(requirement: DocumentRequirementV2, featureId: string) {
  const optionId = featureOptions(featureId)[0]?.value
  if (optionId) requirement.when = conditionForSelection(featureId, optionId)
}

function updateRequirementConditionOption(requirement: DocumentRequirementV2, optionId: string) {
  const condition = selectionCondition(requirement.when)
  if (condition) requirement.when = conditionForSelection(condition.featureId, optionId)
}

function setDocumentMimeType(requirement: DocumentRequirementV2, mimeType: string, enabled: boolean) {
  const allowed = new Set(requirement.allowedMimeTypes)
  if (enabled) allowed.add(mimeType)
  else allowed.delete(mimeType)
  requirement.allowedMimeTypes = [...allowed]
}

function syncPreviewSelections() {
  for (const feature of draft.value.features) {
    if (!feature.options.some(option => option.id === previewScenario.selections[feature.id])) {
      previewScenario.selections[feature.id] = feature.defaultOptionId ?? feature.options[0]?.id ?? ''
    }
  }
  for (const featureId of Object.keys(previewScenario.selections)) {
    if (!draft.value.features.some(feature => feature.id === featureId)) delete previewScenario.selections[featureId]
  }
  previewScenario.selectionEvents = previewScenario.selectionEvents?.filter(event => (
    draft.value.features.some(feature => (
      feature.id === event.featureId && feature.options.some(option => option.id === event.optionId)
    ))
  ))
}

function previewSelectionEvent(featureId: string) {
  return previewScenario.selectionEvents?.find(event => event.featureId === featureId) ?? null
}

function setPreviewSelectionEventMonth(feature: MortgageFeatureV2, value: number | null | undefined) {
  const month = value == null ? null : Math.round(Number(value))
  const events = (previewScenario.selectionEvents ?? []).filter(event => event.featureId !== feature.id)
  if (month && month > 0) {
    const selected = feature.options.find(option => option.id === previewScenario.selections[feature.id])
    const optionId = selected?.breachOptionId
      ?? feature.options.find(option => option.id !== selected?.id)?.id
      ?? selected?.id
    if (optionId) events.push({ month, featureId: feature.id, optionId })
  }
  previewScenario.selectionEvents = events
}

function setPreviewSelectionEventOption(featureId: string, optionId: string) {
  previewScenario.selectionEvents = (previewScenario.selectionEvents ?? []).map(event => (
    event.featureId === featureId ? { ...event, optionId } : event
  ))
}

function applyPreviewPreset(selectedValue: string | undefined) {
  const presetId = selectedValue === manualPresetValue ? undefined : selectedValue
  previewScenario.presetId = presetId
  const preset = draft.value.presets.find(entry => entry.id === presetId)
  if (preset) Object.assign(previewScenario.selections, preset.selections)
}

function syncPreviewCostSettlements() {
  for (const cost of draft.value.costs) {
    if (!cost.settlement.allowed.includes(previewScenario.costSettlements[cost.id]!)) {
      previewScenario.costSettlements[cost.id] = cost.settlement.default
    }
  }
  for (const costId of Object.keys(previewScenario.costSettlements)) {
    if (!draft.value.costs.some(cost => cost.id === costId)) delete previewScenario.costSettlements[costId]
  }
}

function formatMoney(value: string | number | null | undefined) {
  const number = Number(value ?? 0)
  return new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 2 }).format(Number.isFinite(number) ? number : 0)
}

function formatPercent(value: string | number | null | undefined) {
  const number = Number(value ?? 0)
  return `${new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 4 }).format(Number.isFinite(number) ? number : 0)}%`
}

function issueColor(kind: MortgageCalculationIssueV2['kind']): 'error' | 'warning' | 'info' | 'neutral' {
  if (kind === 'error') return 'error'
  if (kind === 'incomplete' || kind === 'warning') return 'warning'
  if (kind === 'ineligible') return 'info'
  return 'neutral'
}

function removeAt<T>(items: T[], index: number) {
  items.splice(index, 1)
}

function setTimelineAnchor(target: { at: TimelineAnchorV2 }, at: TimelineAnchorV2) {
  target.at = at
}

function setPeriod(target: { period: ActivePeriodV2 }, period: ActivePeriodV2) {
  target.period = period
}

</script>

<template>
  <CrmShell
    :title="detail?.product.name ?? 'Ustawienia produktu'"
    eyebrow="Ustawienia administracyjne"
    description="Konfiguracja produktu, wersji kalkulatora i publikacji."
    :back-to="listPath"
    back-label="Wróć do produktów"
  >
    <template #actions>
      <UButton
        v-if="detail?.bank && bankPath"
        :to="bankPath"
        icon="i-lucide-landmark"
        color="neutral"
        variant="outline"
        square
        :aria-label="`Profil banku: ${detail.bank.name}`"
        :title="`Profil banku: ${detail.bank.name}`"
      />
      <UBadge v-if="detail?.product.hasPublishedVersion" color="success" variant="subtle">
        Opublikowana · {{ detail.versions[0] ? `v${detail.versions[0].revision}` : 'live' }}
      </UBadge>
      <UBadge v-if="detail?.product.hasDraft" color="warning" variant="subtle">
        Szkic · r{{ revision }}
      </UBadge>
      <UButton
        type="submit"
        form="mortgage-offer-editor-form"
        icon="i-lucide-save"
        color="neutral"
        variant="outline"
        :loading="saving"
        :disabled="!isDirty || Boolean(conflict)"
      >
        Zapisz szkic
      </UButton>
      <UButton icon="i-lucide-send" :disabled="Boolean(conflict)" @click="openPublishReview">Opublikuj</UButton>
    </template>

    <div class="offer-editor">
      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        title="Nie udało się pobrać oferty"
        :description="apiErrorMessage(error)"
        :actions="[{ label: 'Ponów', onClick: () => refresh() }]"
      />

      <UAlert
        v-if="organizationSettingsError"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        title="Nie udało się pobrać ustawień produktu w organizacji"
        :description="apiErrorMessage(organizationSettingsError)"
        :actions="[{ label: 'Ponów', onClick: () => refreshOrganizationSettings() }]"
      />

      <UAlert
        v-if="conflict"
        color="warning"
        variant="subtle"
        icon="i-lucide-git-compare-arrows"
        title="Konflikt wersji szkicu"
        :description="conflict"
        :actions="[{ label: 'Pobierz wersję z serwera', icon: 'i-lucide-cloud-download', onClick: reloadServerDraft }]"
      />

      <div v-if="status === 'pending' || status === 'idle'" class="offer-editor__loading">
        <USkeleton class="h-24 w-full" />
        <USkeleton class="h-96 w-full" />
      </div>

      <template v-else-if="detail">
        <UCard
          v-if="organizationSettingsStatus === 'success' && !organizationSettingsError"
          class="organization-product-settings"
        >
          <template #header>
            <div class="organization-product-settings__header">
              <div>
                <span>Ustawienia w tej organizacji</span>
                <h2>Widoczność i nazwa produktu</h2>
                <p>Te ustawienia działają tylko w bieżącej organizacji i są stosowane przez porównywarkę od razu po zapisie.</p>
              </div>
              <UBadge
                :color="organizationSettings.data.liveInCalculator ? 'success' : 'warning'"
                variant="subtle"
              >
                {{ organizationSettings.data.liveInCalculator ? 'Aktywny w kalkulatorze' : 'Poza kalkulatorem' }}
              </UBadge>
            </div>
          </template>

          <UAlert
            v-if="!organizationSettings.data.bankEnabled"
            class="organization-product-settings__notice"
            color="warning"
            variant="subtle"
            icon="i-lucide-landmark"
            title="Instytucja jest wyłączona"
            description="Produkt pozostanie poza kalkulatorem, dopóki instytucja nie zostanie ponownie włączona w ustawieniach."
          />

          <form class="organization-product-settings__form" @submit.prevent="saveOrganizationSettings">
            <UFormField
              label="Widoczny w kalkulatorze"
              description="Wyłączenie usuwa ten produkt z porównywarki wyłącznie w bieżącej organizacji."
            >
              <USwitch v-model="organizationForm.isEnabled" label="Produkt aktywny" />
            </UFormField>
            <UFormField
              label="Nazwa w organizacji"
              description="Puste pole zachowuje globalną nazwę produktu."
            >
              <UInput v-model="organizationForm.customName" :placeholder="organizationSettings.data.baseName" />
            </UFormField>
            <UFormField class="organization-product-settings__notes" label="Notatka administratora">
              <UTextarea
                v-model="organizationForm.notes"
                :rows="2"
                placeholder="Np. zakres współpracy lub powód wyłączenia produktu"
              />
            </UFormField>
            <div class="organization-product-settings__actions">
              <UButton
                v-if="organizationSettings.data.isCustomized"
                type="button"
                color="neutral"
                variant="ghost"
                icon="i-lucide-rotate-ccw"
                :loading="resettingOrganizationSettings"
                @click="resetOrganizationSettings"
              >
                Przywróć domyślne
              </UButton>
              <UButton
                type="submit"
                icon="i-lucide-save"
                :loading="savingOrganizationSettings"
              >
                Zapisz dla organizacji
              </UButton>
            </div>
          </form>
        </UCard>

        <UAlert
          color="info"
          variant="subtle"
          icon="i-lucide-calculator"
          title="Publikacja aktualizuje kalkulatory"
          description="Zapis szkicu nie zmienia porównywarki. Po publikacji oprocentowanie, limity, warunki i koszty zaczną wpływać na wszystkie organizacje, w których ten produkt jest włączony."
          :actions="detail.product.hasPublishedVersion ? [{ label: 'Otwórz kalkulator', to: calculatorPath }] : []"
        />

        <UAlert
          v-if="legacyDraftNotice"
          color="warning"
          variant="subtle"
          icon="i-lucide-file-warning"
          title="Oferta przygotowana do migracji na kalkulator V2"
          :description="legacyDraftDescription"
        />

        <section class="offer-editor__statusbar">
          <div>
            <span class="offer-editor__status-icon"><UIcon name="i-lucide-cloud" /></span>
            <span><small>Status zapisu</small><strong>{{ isDirty ? 'Niezapisane zmiany' : detail.product.hasDraft ? 'Szkic zsynchronizowany' : 'Wersja opublikowana — brak szkicu' }}</strong></span>
          </div>
          <div>
            <span class="offer-editor__status-icon"><UIcon name="i-lucide-circle-help" /></span>
            <span><small>Nieznane koszty</small><strong>{{ unknownCostCount }}</strong></span>
          </div>
          <div>
            <span class="offer-editor__status-icon"><UIcon :name="calculationReady ? 'i-lucide-circle-check' : 'i-lucide-triangle-alert'" /></span>
            <span><small>Walidacja kalkulatora</small><strong>{{ calculationReady ? 'Gotowa' : 'Wymaga uzupełnienia' }}</strong></span>
          </div>
          <div>
            <span class="offer-editor__status-icon"><UIcon name="i-lucide-history" /></span>
            <span><small>Opublikowane wersje</small><strong>{{ detail.versions.length }}</strong></span>
          </div>
        </section>

        <UForm
          ref="editorForm"
          id="mortgage-offer-editor-form"
          :schema="draftSchema"
          :state="draft"
          @submit="submitDraft"
        >
          <UCard class="offer-editor__workspace">
            <UTabs
              v-model="activeStep"
              :items="editorSteps"
              value-key="value"
              label-key="title"
              class="offer-editor__tabs"
              aria-label="Sekcje konfiguracji produktu"
            >
              <template #default="{ item }">
                <span class="offer-editor__tab-label">
                  <strong>{{ item.title }}</strong>
                  <small>{{ item.description }}</small>
                </span>
              </template>

              <template #basics>
                <section class="editor-section">
                  <header class="editor-section__header">
                    <div><span>01 · Podstawy</span><h2>Ważność, polityka obliczeń i dostępność</h2><p>To są twarde granice, poza którymi kalkulator oznaczy scenariusz jako niedostępny.</p></div>
                  </header>
                  <div class="form-grid form-grid--3">
                    <UFormField name="validity.effectiveFrom" label="Oferta ważna od" required><UInput v-model="draft.validity.effectiveFrom" type="date" class="w-full" /></UFormField>
                    <UFormField name="validity.effectiveTo" label="Oferta ważna do" hint="Opcjonalnie"><UInput :model-value="draft.validity.effectiveTo ?? ''" type="date" class="w-full" @update:model-value="draft.validity.effectiveTo = $event ? String($event) : null" /></UFormField>
                    <UFormField name="validity.pricingAsOf" label="Cennik sprawdzony na dzień" required><UInput v-model="draft.validity.pricingAsOf" type="date" class="w-full" /></UFormField>
                  </div>
                  <USeparator label="Sposób naliczania" />
                  <div class="form-grid form-grid--3">
                    <UFormField name="calculationPolicy.accrual" label="Konwencja odsetek" description="Musi odpowiadać dokumentacji banku."><USelect v-model="draft.calculationPolicy.accrual" :items="accrualItems" class="w-full" /></UFormField>
                    <UFormField name="calculationPolicy.rounding.balance" label="Precyzja salda"><USelect v-model="draft.calculationPolicy.rounding.balance" :items="balancePrecisionItems" class="w-full" /></UFormField>
                    <UFormField name="currency" label="Waluta"><UInput v-model="draft.currency" disabled class="w-full" /></UFormField>
                  </div>
                  <USeparator label="Warunki dostępności" />
                  <div class="form-grid form-grid--3">
                    <UFormField name="eligibility.minAmount" label="Minimalna kwota"><UInputNumber :model-value="decimalNumber(draft.eligibility.minAmount)" :min="0" :step="1000" :format-options="{ style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }" class="w-full" @update:model-value="draft.eligibility.minAmount = decimalString($event)" /></UFormField>
                    <UFormField name="eligibility.maxAmount" label="Maksymalna kwota" hint="Puste = bez limitu"><UInputNumber :model-value="decimalNumber(draft.eligibility.maxAmount)" :min="0" :step="10000" :format-options="{ style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }" class="w-full" @update:model-value="draft.eligibility.maxAmount = nullableDecimalString($event)" /></UFormField>
                    <UFormField name="eligibility.amountBasis" label="Podstawa limitu kwoty"><USelect v-model="draft.eligibility.amountBasis" :items="amountBasisItems" class="w-full" /></UFormField>
                    <UFormField name="eligibility.minTermMonths" label="Minimalny okres (mies.)"><UInputNumber v-model="draft.eligibility.minTermMonths" :min="1" :max="600" :step="12" class="w-full" /></UFormField>
                    <UFormField name="eligibility.maxTermMonths" label="Maksymalny okres (mies.)"><UInputNumber v-model="draft.eligibility.maxTermMonths" :min="1" :max="600" :step="12" class="w-full" /></UFormField>
                    <UFormField name="eligibility.maxLtvPct" label="Maksymalne LTV (%)"><UInputNumber :model-value="decimalNumber(draft.eligibility.maxLtvPct)" :min="0" :max="200" :step="0.1" :format-options="{ maximumFractionDigits: 2 }" class="w-full" @update:model-value="draft.eligibility.maxLtvPct = decimalString($event)" /></UFormField>
                    <UFormField name="eligibility.ltvDebtBasis" label="Dług do LTV"><USelect v-model="draft.eligibility.ltvDebtBasis" :items="amountBasisItems" class="w-full" /></UFormField>
                    <UFormField name="eligibility.collateralValueBasis" label="Wartość zabezpieczenia"><USelect v-model="draft.eligibility.collateralValueBasis" :items="collateralBasisItems" class="w-full" /></UFormField>
                    <UFormField name="eligibility.allowedInstallmentTypes" label="Dopuszczalne raty">
                      <div class="check-row"><UCheckbox :model-value="draft.eligibility.allowedInstallmentTypes.includes('equal')" label="Równe" @update:model-value="$event ? draft.eligibility.allowedInstallmentTypes.push('equal') : draft.eligibility.allowedInstallmentTypes.splice(draft.eligibility.allowedInstallmentTypes.indexOf('equal'), 1)" /><UCheckbox :model-value="draft.eligibility.allowedInstallmentTypes.includes('decreasing')" label="Malejące" @update:model-value="$event ? draft.eligibility.allowedInstallmentTypes.push('decreasing') : draft.eligibility.allowedInstallmentTypes.splice(draft.eligibility.allowedInstallmentTypes.indexOf('decreasing'), 1)" /></div>
                    </UFormField>
                  </div>
                  <MortgageEvidenceReferencesEditor v-model="draft.eligibility.evidenceRefs" :sources="draft.documentation.sources" name-prefix="eligibility.evidenceRefs" />
                  <USeparator label="Wypłata i karencja" />
                  <div class="form-grid form-grid--3">
                    <UFormField name="disbursementPolicy.maxTranches" label="Maksymalna liczba transz"><UInputNumber v-model="draft.disbursementPolicy.maxTranches" :min="1" :max="120" :step="1" class="w-full" /></UFormField>
                    <UFormField name="disbursementPolicy.supportedGraceModes" label="Dopuszczalna karencja" class="form-grid__wide">
                      <div class="check-row"><UCheckbox v-for="item in [{ label: 'Brak', value: 'none' }, { label: 'Tylko odsetki', value: 'interest_only' }, { label: 'Kapitalizacja odsetek', value: 'capitalize_interest' }]" :key="item.value" :model-value="draft.disbursementPolicy.supportedGraceModes.includes(item.value as never)" :label="item.label" @update:model-value="$event ? draft.disbursementPolicy.supportedGraceModes.push(item.value as never) : draft.disbursementPolicy.supportedGraceModes.splice(draft.disbursementPolicy.supportedGraceModes.indexOf(item.value as never), 1)" /></div>
                    </UFormField>
                    <UFormField name="disbursementPolicy.paymentRecalculationTriggers" label="Kiedy bank przelicza ratę" description="Zaznacz wyłącznie zdarzenia wynikające z regulaminu lub umowy." class="form-grid__wide">
                      <div class="check-row"><UCheckbox v-for="item in [{ label: 'Zmiana stopy', value: 'rate_change' }, { label: 'Wypłata transzy', value: 'disbursement' }, { label: 'Koniec karencji', value: 'grace_end' }, { label: 'Nadpłata obniżająca ratę', value: 'lower_payment_overpayment' }]" :key="item.value" :model-value="draft.disbursementPolicy.paymentRecalculationTriggers.includes(item.value as never)" :label="item.label" @update:model-value="$event ? draft.disbursementPolicy.paymentRecalculationTriggers.push(item.value as never) : draft.disbursementPolicy.paymentRecalculationTriggers.splice(draft.disbursementPolicy.paymentRecalculationTriggers.indexOf(item.value as never), 1)" /></div>
                    </UFormField>
                  </div>
                  <MortgageEvidenceReferencesEditor v-model="draft.disbursementPolicy.evidenceRefs" :sources="draft.documentation.sources" name-prefix="disbursementPolicy.evidenceRefs" />
                </section>
              </template>

              <template #rates>
                <section class="editor-section">
                  <header class="editor-section__header editor-section__header--actions">
                    <div><span>02 · Oprocentowanie</span><h2>Fazy stopy i modyfikatory ceny</h2><p>Każda faza ma jawny okres. Warunki cross-sell zmieniają stopę, marżę lub oprocentowanie nominalne.</p></div>
                    <UDropdownMenu :items="[[{ label: 'Faza stopy stałej', icon: 'i-lucide-lock-keyhole', onSelect: () => addRatePhase('fixed') }, { label: 'Faza indeks + marża', icon: 'i-lucide-chart-no-axes-combined', onSelect: () => addRatePhase('index_plus_margin') }]]"><UButton icon="i-lucide-plus">Dodaj fazę</UButton></UDropdownMenu>
                  </header>
                  <UAlert v-if="!draft.ratePlan.phases.length" color="warning" variant="subtle" icon="i-lucide-triangle-alert" title="Brak faz oprocentowania" description="Szkic można zapisać, ale publikacja i kalkulacja pozostaną zablokowane." />
                  <div class="editor-list">
                    <UCard v-for="(phase, index) in draft.ratePlan.phases" :key="phase.id" class="rule-card">
                      <template #header><div class="rule-card__header"><div><UBadge color="info" variant="subtle">Faza {{ index + 1 }}</UBadge><strong>{{ phase.formula.kind === 'fixed' ? 'Stopa stała' : 'Indeks + marża' }}</strong></div><div><UButton icon="i-lucide-arrow-up" square color="neutral" variant="ghost" :disabled="index === 0" @click="moveItem(draft.ratePlan.phases, index, -1)" /><UButton icon="i-lucide-arrow-down" square color="neutral" variant="ghost" :disabled="index === draft.ratePlan.phases.length - 1" @click="moveItem(draft.ratePlan.phases, index, 1)" /><UButton icon="i-lucide-trash-2" square color="error" variant="ghost" @click="removeAt(draft.ratePlan.phases, index)" /></div></div></template>
                      <div class="form-grid form-grid--3">
                        <UFormField :name="`ratePlan.phases.${index}.id`" label="Kod fazy"><UInput v-model="phase.id" class="w-full" /></UFormField>
                        <UFormField :name="`ratePlan.phases.${index}.formula.kind`" label="Formuła"><USelect :model-value="phase.formula.kind" :items="rateFormulaItems" class="w-full" @update:model-value="changeRateFormula(phase, $event)" /></UFormField>
                        <template v-if="phase.formula.kind === 'fixed'"><UFormField :name="`ratePlan.phases.${index}.formula.ratePct`" label="Stopa stała (%)"><UInputNumber :model-value="decimalNumber(phase.formula.ratePct)" :min="0" :max="100" :step="0.01" class="w-full" @update:model-value="phase.formula.ratePct = decimalString($event)" /></UFormField></template>
                        <template v-else>
                          <UFormField :name="`ratePlan.phases.${index}.formula.indexCode`" label="Kod indeksu"><UInput v-model="phase.formula.indexCode" class="w-full" placeholder="POLSTR_3M" /></UFormField>
                          <UFormField :name="`ratePlan.phases.${index}.formula.indexValuePct`" label="Wartość indeksu (%)"><UInputNumber :model-value="decimalNumber(phase.formula.indexValuePct)" :step="0.01" class="w-full" @update:model-value="phase.formula.indexValuePct = decimalString($event)" /></UFormField>
                          <UFormField :name="`ratePlan.phases.${index}.formula.indexAsOf`" label="Indeks z dnia"><UInput v-model="phase.formula.indexAsOf" type="date" class="w-full" /></UFormField>
                          <UFormField :name="`ratePlan.phases.${index}.formula.marginPct`" label="Marża (%)"><UInputNumber :model-value="decimalNumber(phase.formula.marginPct)" :step="0.01" class="w-full" @update:model-value="phase.formula.marginPct = decimalString($event)" /></UFormField>
                          <UFormField :name="`ratePlan.phases.${index}.formula.resetEveryMonths`" label="Aktualizacja indeksu (mies.)"><UInputNumber v-model="phase.formula.resetEveryMonths" :min="1" :max="60" :step="1" class="w-full" /></UFormField>
                          <UFormField :name="`ratePlan.phases.${index}.formula.indexFloorPct`" label="Minimum indeksu (%)" hint="Opcjonalnie"><UInputNumber :model-value="decimalNumber(phase.formula.indexFloorPct)" :step="0.01" class="w-full" @update:model-value="phase.formula.indexFloorPct = $event == null ? undefined : decimalString($event)" /></UFormField>
                          <UFormField :name="`ratePlan.phases.${index}.formula.nominalFloorPct`" label="Minimum nominalne (%)" hint="Opcjonalnie"><UInputNumber :model-value="decimalNumber(phase.formula.nominalFloorPct)" :step="0.01" class="w-full" @update:model-value="phase.formula.nominalFloorPct = $event == null ? undefined : decimalString($event)" /></UFormField>
                          <UFormField :name="`ratePlan.phases.${index}.formula.nominalCapPct`" label="Maksimum nominalne (%)" hint="Opcjonalnie"><UInputNumber :model-value="decimalNumber(phase.formula.nominalCapPct)" :step="0.01" class="w-full" @update:model-value="phase.formula.nominalCapPct = $event == null ? undefined : decimalString($event)" /></UFormField>
                        </template>
                      </div>
                      <MortgageActivePeriodEditor v-model="phase.period" :name-prefix="`ratePlan.phases.${index}.period`" />
                      <MortgageEvidenceReferencesEditor v-model="phase.evidenceRefs" :sources="draft.documentation.sources" :name-prefix="`ratePlan.phases.${index}.evidenceRefs`" />
                    </UCard>
                  </div>
                  <div class="subsection-heading"><div><span>Modyfikatory</span><h3>Zmiany ceny wynikające z wariantu</h3><p>Wartość ujemna obniża cenę, np. −0,10 p.p. za ubezpieczenie. Opcja „niespełniony warunek” może podnosić marżę od wskazanego miesiąca. Prowizję modelujemy jako warunkowy koszt, bo może być płatna, kredytowana albo potrącana.</p></div><div class="action-row"><UButton icon="i-lucide-plus" color="neutral" variant="outline" @click="void draft.ratePlan.modifiers.push(createRateModifierV2())">Zmiana stopy / marży</UButton><UButton icon="i-lucide-receipt" color="neutral" variant="outline" :disabled="!draft.features.length" @click="addConditionalCommission">Warunkowa prowizja</UButton></div></div>
                  <div class="editor-list">
                    <UCard v-for="(modifier, index) in draft.ratePlan.modifiers" :key="modifier.id" class="rule-card">
                      <template #header><div class="rule-card__header"><div><UBadge color="warning" variant="subtle">Reguła {{ index + 1 }}</UBadge><strong>{{ modifier.id }}</strong></div><UButton icon="i-lucide-trash-2" square color="error" variant="ghost" @click="removeAt(draft.ratePlan.modifiers, index)" /></div></template>
                      <div class="form-grid form-grid--3">
                        <UFormField :name="`ratePlan.modifiers.${index}.id`" label="Kod reguły"><UInput v-model="modifier.id" class="w-full" /></UFormField>
                        <UFormField :name="`ratePlan.modifiers.${index}.sourceFeatureId`" label="Warunek / produkt"><USelect :model-value="modifier.sourceFeatureId" :items="featureItems" placeholder="Wybierz warunek" class="w-full" @update:model-value="modifierFeatureChanged(modifier, $event)" /></UFormField>
                        <UFormField :name="`ratePlan.modifiers.${index}.sourceOptionId`" label="Opcja wyzwalająca"><USelect v-model="modifier.sourceOptionId" :items="featureOptions(modifier.sourceFeatureId)" class="w-full" /></UFormField>
                        <UFormField :name="`ratePlan.modifiers.${index}.target`" label="Co zmienia"><USelect v-model="modifier.target" :items="rateTargetItems" class="w-full" /></UFormField>
                        <UFormField :name="`ratePlan.modifiers.${index}.operation`" label="Operacja"><USelect v-model="modifier.operation" :items="modifierOperationItems" class="w-full" /></UFormField>
                        <UFormField :name="`ratePlan.modifiers.${index}.value`" label="Wartość (%) / p.p."><UInputNumber :model-value="decimalNumber(modifier.value)" :step="0.01" class="w-full" @update:model-value="modifier.value = decimalString($event)" /></UFormField>
                      </div>
                      <USeparator label="Dodatkowy warunek logiczny" />
                      <UAlert
                        color="info"
                        variant="subtle"
                        icon="i-lucide-git-merge"
                        title="Warunki modyfikatora łączą się przez AND"
                        description="Szybki wybór produktu i opcji powyżej pozostaje prostym wyzwalaczem. Jeśli dodasz warunek logiczny, kalkulator zastosuje zmianę dopiero wtedy, gdy wybrana opcja oraz cały dodatkowy warunek są spełnione jednocześnie."
                      />
                      <UFormField :name="`ratePlan.modifiers.${index}.when`" label="Zaawansowany warunek" description="Łącz wybory cross-sell i progi kwoty, LTV lub okresu operatorami AND, OR i NOT.">
                        <USwitch :model-value="Boolean(modifier.when)" label="Modyfikator ma dodatkowy warunek" @update:model-value="setModifierCondition(modifier, Boolean($event))" />
                      </UFormField>
                      <MortgageConditionEditor
                        v-if="modifier.when"
                        :model-value="modifier.when"
                        :features="draft.features"
                        :name-prefix="`ratePlan.modifiers.${index}.when`"
                        :max-depth="4"
                        label="Warunek modyfikatora"
                        @update:model-value="modifier.when = $event"
                      />
                      <UCollapsible><UButton label="Ogranicz okres działania" icon="i-lucide-calendar-range" color="neutral" variant="ghost" trailing-icon="i-lucide-chevron-down" /><template #content><div class="pt-3"><MortgageActivePeriodEditor v-if="modifier.period" v-model="modifier.period" :name-prefix="`ratePlan.modifiers.${index}.period`" /><UButton v-else icon="i-lucide-plus" color="neutral" variant="outline" @click="void (modifier.period = createActivePeriodV2())">Dodaj okres</UButton></div></template></UCollapsible>
                      <MortgageEvidenceReferencesEditor v-model="modifier.evidenceRefs" :sources="draft.documentation.sources" :name-prefix="`ratePlan.modifiers.${index}.evidenceRefs`" />
                    </UCard>
                  </div>
                </section>
              </template>

              <template #features>
                <section class="editor-section">
                  <header class="editor-section__header editor-section__header--actions"><div><span>03 · Warunki</span><h2>Cross-sell, obowiązki i warianty</h2><p>Modeluj produkty dodatkowe jako wybory. Wariant to zestaw wyborów, a wpływ na cenę definiują modyfikatory z poprzedniej sekcji.</p></div><UButton icon="i-lucide-plus" @click="void draft.features.push(createMortgageFeatureV2())">Dodaj warunek</UButton></header>
                  <div class="editor-list">
                    <UCard v-for="(feature, featureIndex) in draft.features" :key="feature.id" class="rule-card">
                      <template #header><div class="rule-card__header"><div><UBadge color="info" variant="subtle">Warunek {{ featureIndex + 1 }}</UBadge><strong>{{ feature.label }}</strong></div><UButton icon="i-lucide-trash-2" square color="error" variant="ghost" @click="removeFeature(featureIndex)" /></div></template>
                      <div class="form-grid form-grid--3">
                        <UFormField :name="`features.${featureIndex}.id`" label="Kod warunku"><UInput v-model="feature.id" class="w-full" /></UFormField>
                        <UFormField :name="`features.${featureIndex}.label`" label="Nazwa"><UInput v-model="feature.label" class="w-full" /></UFormField>
                        <UFormField :name="`features.${featureIndex}.required`" label="Wymagany do oferty"><USwitch v-model="feature.required" label="Klient musi wybrać opcję" /></UFormField>
                      </div>
                      <div class="option-list">
                        <div v-for="(option, optionIndex) in feature.options" :key="option.id" class="option-row">
                          <UFormField :name="`features.${featureIndex}.options.${optionIndex}.id`" label="Kod opcji"><UInput v-model="option.id" class="w-full" /></UFormField>
                          <UFormField :name="`features.${featureIndex}.options.${optionIndex}.label`" label="Etykieta"><UInput v-model="option.label" class="w-full" /></UFormField>
                          <UFormField :name="`features.${featureIndex}.options.${optionIndex}.description`" label="Opis"><UInput v-model="option.description" class="w-full" placeholder="Krótki opis dla eksperta" /></UFormField>
                          <URadioGroup :model-value="feature.defaultOptionId" :items="[{ label: 'Domyślna', value: option.id }]" @update:model-value="feature.defaultOptionId = $event" />
                          <UButton class="option-row__remove" icon="i-lucide-x" square color="error" variant="ghost" aria-label="Usuń opcję" :disabled="feature.options.length <= 1" @click="removeFeatureOption(feature, optionIndex)" />
                          <UFormField :name="`features.${featureIndex}.options.${optionIndex}.obligations`" label="Obowiązki i warunki utrzymania" description="Każdy wpis to osobny warunek, np. wpływ 3 000 zł miesięcznie przez 5 lat." class="option-row__obligations">
                            <UInputTags v-model="option.obligations" class="w-full" placeholder="Wpisz warunek i naciśnij Enter" />
                          </UFormField>
                          <UFormField :name="`features.${featureIndex}.options.${optionIndex}.monitoringEveryMonths`" label="Kontrola co ile miesięcy" hint="Opcjonalnie"><UInputNumber v-model="option.monitoringEveryMonths" :min="1" :max="600" :step="1" class="w-full" /></UFormField>
                          <UFormField :name="`features.${featureIndex}.options.${optionIndex}.breachOptionId`" label="Opcja po utracie warunku" hint="Opcjonalnie"><USelect v-model="option.breachOptionId" :items="feature.options.filter(candidate => candidate.id !== option.id).map(candidate => ({ label: candidate.label, value: candidate.id }))" class="w-full" /></UFormField>
                        </div>
                      </div>
                      <div class="action-row action-row--start"><UButton icon="i-lucide-plus" color="neutral" variant="ghost" @click="addFeatureOption(feature)">Dodaj opcję</UButton><UButton icon="i-lucide-shield-alert" color="neutral" variant="ghost" @click="addBreachFeatureOption(feature)">Dodaj „warunek niespełniony”</UButton></div>
                      <MortgageEvidenceReferencesEditor v-model="feature.evidenceRefs" :sources="draft.documentation.sources" :name-prefix="`features.${featureIndex}.evidenceRefs`" />
                    </UCard>
                  </div>
                  <div class="subsection-heading"><div><span>Warianty</span><h3>Gotowe kombinacje dla kalkulatora</h3><p>Preset nie duplikuje oferty — zapisuje tylko wybory, dlatego unikamy eksplozji kombinacji.</p></div><UButton icon="i-lucide-plus" color="neutral" variant="outline" :disabled="!draft.features.length" @click="void draft.presets.push(createMortgagePresetV2(draft.features))">Dodaj wariant</UButton></div>
                  <div class="editor-list">
                    <UCard v-for="(preset, presetIndex) in draft.presets" :key="preset.id" class="rule-card">
                      <template #header><div class="rule-card__header"><div><UBadge :color="preset.isDefault ? 'success' : 'neutral'" variant="subtle">{{ preset.isDefault ? 'Domyślny' : `Wariant ${presetIndex + 1}` }}</UBadge><strong>{{ preset.label }}</strong></div><div><UButton v-if="!preset.isDefault" label="Ustaw domyślny" color="neutral" variant="ghost" @click="setDefaultPreset(presetIndex)" /><UButton icon="i-lucide-trash-2" square color="error" variant="ghost" @click="removeAt(draft.presets, presetIndex)" /></div></div></template>
                      <div class="form-grid form-grid--3"><UFormField :name="`presets.${presetIndex}.id`" label="Kod wariantu"><UInput v-model="preset.id" class="w-full" /></UFormField><UFormField :name="`presets.${presetIndex}.label`" label="Nazwa wariantu"><UInput v-model="preset.label" class="w-full" /></UFormField><UFormField v-for="feature in draft.features" :key="feature.id" :name="`presets.${presetIndex}.selections.${feature.id}`" :label="feature.label"><USelect v-model="preset.selections[feature.id]" :items="featureOptions(feature.id)" class="w-full" /></UFormField></div>
                    </UCard>
                  </div>
                </section>
              </template>

              <template #costs>
                <section class="editor-section">
                  <header class="editor-section__header editor-section__header--actions"><div><span>04 · Koszty</span><h2>Pełny cash-flow kosztów kredytu</h2><p>Stan „nieznany” jest informacją — kalkulator zwróci wynik częściowy i nigdy nie zastąpi go zerem.</p></div><UButton icon="i-lucide-plus" @click="void draft.costs.push(createMortgageCostV2())">Dodaj koszt</UButton></header>
                  <UAlert v-if="unknownCostCount" color="warning" variant="subtle" icon="i-lucide-circle-help" :title="`${unknownCostCount} kosztów ma nieznaną wartość`" description="Możesz zapisać szkic, ale nie publikuj go, dopóki te pozycje nie zostaną potwierdzone albo oznaczone jako niedotyczące." />
                  <div class="editor-list">
                    <UCard v-for="(cost, costIndex) in draft.costs" :key="cost.id" class="rule-card" :class="`rule-card--${cost.state}`">
                      <template #header><div class="rule-card__header"><div><UBadge :color="cost.state === 'known' ? 'success' : cost.state === 'unknown' ? 'warning' : 'neutral'" variant="subtle">{{ cost.state === 'known' ? 'Znany' : cost.state === 'unknown' ? 'Nieznany' : 'Nie dotyczy' }}</UBadge><strong>{{ cost.label }}</strong></div><div><UButton icon="i-lucide-arrow-up" square color="neutral" variant="ghost" :disabled="costIndex === 0" @click="moveItem(draft.costs, costIndex, -1)" /><UButton icon="i-lucide-arrow-down" square color="neutral" variant="ghost" :disabled="costIndex === draft.costs.length - 1" @click="moveItem(draft.costs, costIndex, 1)" /><UButton icon="i-lucide-trash-2" square color="error" variant="ghost" @click="removeAt(draft.costs, costIndex)" /></div></div></template>
                      <div class="form-grid form-grid--4">
                        <UFormField :name="`costs.${costIndex}.id`" label="Kod kosztu"><UInput v-model="cost.id" class="w-full" /></UFormField>
                        <UFormField :name="`costs.${costIndex}.label`" label="Nazwa"><UInput v-model="cost.label" class="w-full" /></UFormField>
                        <UFormField :name="`costs.${costIndex}.state`" label="Stan wiedzy"><USelect :model-value="cost.state" :items="costStateItems" class="w-full" @update:model-value="setCostState(cost, $event)" /></UFormField>
                        <UFormField :name="`costs.${costIndex}.category`" label="Kategoria"><USelect v-model="cost.category" :items="costCategoryItems" class="w-full" /></UFormField>
                        <UFormField :name="`costs.${costIndex}.classification`" label="Klasyfikacja"><USelect v-model="cost.classification" :items="costClassificationItems" class="w-full" /></UFormField>
                        <UFormField :name="`costs.${costIndex}.includedInApr`" label="Klasyfikacja RRSO" description="Oznacza koszt kwalifikowany; kalkulator nie wyznacza jeszcze ustawowego RRSO."><USwitch v-model="cost.includedInApr" label="Uwzględniaj w kosztach kwalifikowanych" /></UFormField>
                        <UFormField :name="`costs.${costIndex}.notes`" label="Uwagi / brakujące dane" class="form-grid__wide"><UInput v-model="cost.notes" class="w-full" placeholder="Np. stawka zależy od indywidualnej polisy" /></UFormField>
                      </div>
                      <UAlert v-if="cost.state === 'unknown'" color="warning" variant="soft" icon="i-lucide-circle-help" title="Brak wartości nie oznacza 0 zł" description="Pozycja zostanie wskazana jako brak danych w kalkulacji." />
                      <template v-if="cost.state === 'known' && cost.formula">
                        <USeparator label="Formuła" />
                        <MortgageCostFormulaEditor
                          :model-value="cost.formula"
                          :name-prefix="`costs.${costIndex}.formula`"
                          :max-depth="4"
                          @update:model-value="cost.formula = $event"
                        />
                        <USeparator label="Moment i rozliczenie" />
                        <div class="form-grid form-grid--3"><UFormField :name="`costs.${costIndex}.timing.kind`" label="Kiedy naliczać"><USelect :model-value="cost.timing.kind" :items="timingKindItems" class="w-full" @update:model-value="setCostTiming(cost, $event)" /></UFormField><UFormField :name="`costs.${costIndex}.settlement.default`" label="Domyślne rozliczenie"><USelect v-model="cost.settlement.default" :items="settlementItems.filter(item => cost.settlement.allowed.includes(item.value))" class="w-full" /></UFormField><UFormField :name="`costs.${costIndex}.settlement.allowed`" label="Dozwolone rozliczenia"><div class="check-stack"><UCheckbox v-for="item in settlementItems" :key="item.value" :model-value="cost.settlement.allowed.includes(item.value)" :label="item.label" :disabled="cost.timing.kind === 'recurring' && item.value !== 'cash' && !cost.settlement.allowed.includes(item.value)" @update:model-value="setCostSettlement(cost, item.value, Boolean($event))" /></div></UFormField></div>
                        <UAlert v-if="cost.timing.kind === 'recurring' && cost.settlement.allowed.some(item => item !== 'cash')" color="error" variant="soft" icon="i-lucide-circle-alert" title="Koszt cykliczny musi być gotówkowy" description="Usuń kapitalizację lub potrącenie. Finansowanie przyszłych opłat cyklicznych wymaga osobnego limitu i nie jest obsługiwane w V2." />
                        <MortgageTimelineAnchorEditor v-if="cost.timing.kind === 'once'" :model-value="cost.timing.at" :name-prefix="`costs.${costIndex}.timing.at`" label="Moment naliczenia" @update:model-value="setTimelineAnchor(cost.timing, $event)" />
                        <template v-else-if="cost.timing.kind === 'recurring'"><UFormField :name="`costs.${costIndex}.timing.everyMonths`" label="Co ile miesięcy"><UInputNumber v-model="cost.timing.everyMonths" :min="1" :max="120" :step="1" /></UFormField><MortgageActivePeriodEditor v-model="cost.timing.period" :name-prefix="`costs.${costIndex}.timing.period`" /></template>
                        <template v-else>
                          <UFormField :name="`costs.${costIndex}.timing.period`" label="Okres kwalifikowanych transz" description="Opcjonalnie ogranicz naliczanie tylko do transz wypłaconych w tym okresie.">
                            <USwitch :model-value="Boolean(cost.timing.period)" label="Ogranicz okres naliczania" @update:model-value="setPerDisbursementPeriod(cost, Boolean($event))" />
                          </UFormField>
                          <MortgageActivePeriodEditor v-if="cost.timing.period" v-model="cost.timing.period" :name-prefix="`costs.${costIndex}.timing.period`" from-label="Pierwsza kwalifikowana transza" end-label="Koniec okresu kwalifikowanych transz" />
                        </template>
                        <USeparator label="Warunek naliczenia" />
                        <UFormField :name="`costs.${costIndex}.when`" label="Warunek kosztu" description="Możesz połączyć wybór produktu z progami kwoty, LTV lub okresu kredytu za pomocą AND, OR i NOT.">
                          <USwitch :model-value="Boolean(cost.when)" label="Koszt ma dodatkowy warunek naliczenia" @update:model-value="setCostCondition(cost, Boolean($event))" />
                        </UFormField>
                        <MortgageConditionEditor
                          v-if="cost.when"
                          :model-value="cost.when"
                          :features="draft.features"
                          :name-prefix="`costs.${costIndex}.when`"
                          :max-depth="4"
                          label="Warunek naliczenia kosztu"
                          @update:model-value="cost.when = $event"
                        />
                      </template>
                      <MortgageEvidenceReferencesEditor v-model="cost.evidenceRefs" :sources="draft.documentation.sources" :name-prefix="`costs.${costIndex}.evidenceRefs`" />
                    </UCard>
                  </div>
                </section>
              </template>

              <template #bridge>
                <section class="editor-section">
                  <header class="editor-section__header"><div><span>05 · Ubezpieczenie pomostowe</span><h2>Podwyższenie stopy do wpisu hipoteki</h2><p>Mechanizm jest osobnym przepływem. Zwrot może trafić na konto klienta albo obniżyć kapitał.</p></div></header>
                  <UCard class="bridge-toggle"><div><span class="bridge-toggle__icon"><UIcon name="i-lucide-shield-check" /></span><span><strong>Oferta stosuje koszt pomostowy</strong><small>Włącz tylko, gdy bank podwyższa stopę do czasu wpisu hipoteki.</small></span></div><USwitch :model-value="Boolean(draft.bridgeInsurance)" @update:model-value="enableBridgeInsurance(Boolean($event))" /></UCard>
                  <template v-if="draft.bridgeInsurance">
                    <UAlert color="info" variant="subtle" icon="i-lucide-info" title="Czas wpisu hipoteki jest parametrem scenariusza" description="Oferta definiuje mechanizm i zasady zwrotu. W laboratorium podasz oczekiwany miesiąc wpisu dla konkretnej sprawy." />
                    <UCard class="rule-card"><template #header><div class="rule-card__header"><div><UBadge color="info" variant="subtle">Podwyżka</UBadge><strong>Okres pomostowy</strong></div></div></template><UFormField name="bridgeInsurance.mechanism.upliftPctPoints" label="Podwyżka oprocentowania (p.p.)" description="Np. 0,05 oznacza +0,05 punktu procentowego."><UInputNumber :model-value="decimalNumber(draft.bridgeInsurance.mechanism.upliftPctPoints)" :min="0" :step="0.01" class="w-full sm:max-w-xs" @update:model-value="draft.bridgeInsurance!.mechanism.upliftPctPoints = decimalString($event)" /></UFormField><MortgageActivePeriodEditor v-model="draft.bridgeInsurance.mechanism.period" name-prefix="bridgeInsurance.mechanism.period" from-label="Początek podwyżki" end-label="Koniec po wpisie hipoteki" /><MortgageEvidenceReferencesEditor v-model="draft.bridgeInsurance.evidenceRefs" :sources="draft.documentation.sources" name-prefix="bridgeInsurance.evidenceRefs" /></UCard>
                    <UCard class="rule-card">
                      <template #header>
                        <div class="rule-card__header">
                          <div><UBadge :color="draft.bridgeInsurance.refund.kind === 'none' ? 'neutral' : 'success'" variant="subtle">Zwrot</UBadge><strong>Rozliczenie pobranych odsetek</strong></div>
                        </div>
                      </template>
                      <div class="form-grid form-grid--3">
                        <UFormField name="bridgeInsurance.refund.kind" label="Polityka zwrotu">
                          <USelect :model-value="draft.bridgeInsurance.refund.kind" :items="[{ label: 'Zwrot 100% oznaczonych odsetek', value: 'tagged_amount' }]" class="w-full" @update:model-value="setBridgeRefundKind($event)" />
                        </UFormField>
                        <template v-if="draft.bridgeInsurance.refund.kind === 'tagged_amount'">
                          <UFormField name="bridgeInsurance.refund.percentage" label="Procent zwrotu">
                            <UInputNumber :model-value="decimalNumber(draft.bridgeInsurance.refund.percentage)" :min="100" :max="100" :step="1" disabled class="w-full" />
                          </UFormField>
                          <UFormField name="bridgeInsurance.refund.settlement" label="Sposób rozliczenia">
                            <USelect v-model="draft.bridgeInsurance.refund.settlement" :items="[{ label: 'Zwrot na rachunek', value: 'cash_credit' }, { label: 'Zaliczenie na kapitał', value: 'principal_credit' }]" class="w-full" />
                          </UFormField>
                        </template>
                      </div>
                      <MortgageTimelineAnchorEditor
                        v-if="draft.bridgeInsurance.refund.kind === 'tagged_amount'"
                        :model-value="draft.bridgeInsurance.refund.at"
                        name-prefix="bridgeInsurance.refund.at"
                        label="Moment zwrotu"
                        @update:model-value="draft.bridgeInsurance!.refund.kind === 'tagged_amount' && (draft.bridgeInsurance!.refund.at = $event)"
                      />
                      <UAlert v-if="draft.bridgeInsurance.refund.kind === 'none'" color="error" variant="soft" icon="i-lucide-circle-alert" title="Zwrot jest wymagany" description="Wybierz zwrot 100% oznaczonych odsetek. Oferta bez zwrotu kosztu pomostowego nie może zostać opublikowana." />
                    </UCard>
                  </template>
                </section>
              </template>

              <template #documents>
                <section class="editor-section">
                  <header class="editor-section__header editor-section__header--actions"><div><span>06 · Dokumentacja</span><h2>Checklista dokumentów i dowody źródłowe</h2><p>Oferta powinna być audytowalna: każdy koszt i warunek można powiązać z aktualnym dokumentem banku.</p></div><UButton icon="i-lucide-plus" @click="void draft.documentation.requirements.push(createDocumentRequirementV2())">Dodaj dokument</UButton></header>
                  <div class="editor-list">
                    <UCard v-for="(requirement, index) in draft.documentation.requirements" :key="`${requirement.code}-${index}`" class="rule-card">
                      <template #header>
                        <div class="rule-card__header">
                          <div><UBadge color="info" variant="subtle">{{ requirement.stage }}</UBadge><strong>{{ requirement.label }}</strong></div>
                          <UButton icon="i-lucide-trash-2" square color="error" variant="ghost" aria-label="Usuń wymaganie" @click="removeAt(draft.documentation.requirements, index)" />
                        </div>
                      </template>
                      <div class="form-grid form-grid--4">
                        <UFormField :name="`documentation.requirements.${index}.code`" label="Kod"><UInput v-model="requirement.code" class="w-full" /></UFormField>
                        <UFormField :name="`documentation.requirements.${index}.label`" label="Nazwa"><UInput v-model="requirement.label" class="w-full" /></UFormField>
                        <UFormField :name="`documentation.requirements.${index}.category`" label="Kategoria"><USelect v-model="requirement.category" :items="documentCategoryItems" class="w-full" /></UFormField>
                        <UFormField :name="`documentation.requirements.${index}.itemKind`" label="Typ pozycji"><USelect v-model="requirement.itemKind" :items="documentKindItems" class="w-full" /></UFormField>
                        <UFormField :name="`documentation.requirements.${index}.scope`" label="Zakres"><USelect v-model="requirement.scope" :items="documentScopeItems" class="w-full" /></UFormField>
                        <UFormField :name="`documentation.requirements.${index}.stage`" label="Etap"><USelect v-model="requirement.stage" :items="documentStageItems" class="w-full" /></UFormField>
                        <UFormField :name="`documentation.requirements.${index}.applicability`" label="Stosowanie"><USelect v-model="requirement.applicability" :items="applicabilityItems" class="w-full" /></UFormField>
                        <UFormField :name="`documentation.requirements.${index}.evidence`" label="Pochodzenie"><USelect v-model="requirement.evidence" :items="evidenceItems" class="w-full" /></UFormField>
                        <UFormField :name="`documentation.requirements.${index}.required`" label="Obowiązek"><USwitch v-model="requirement.required" label="Wymagany" /></UFormField>
                        <UFormField :name="`documentation.requirements.${index}.multiple`" label="Liczba plików"><USwitch v-model="requirement.multiple" label="Wiele plików" /></UFormField>
                        <UFormField :name="`documentation.requirements.${index}.templateId`" label="Szablon MultiForm" hint="Opcjonalnie"><UInput v-model="requirement.templateId" class="w-full" /></UFormField>
                        <UFormField :name="`documentation.requirements.${index}.notes`" label="Uwagi"><UInput v-model="requirement.notes" class="w-full" /></UFormField>
                        <UFormField :name="`documentation.requirements.${index}.allowedMimeTypes`" label="Dozwolone pliki" class="form-grid__wide">
                          <div class="check-row">
                            <UCheckbox v-for="mime in [{ label: 'PDF', value: 'application/pdf' }, { label: 'JPEG', value: 'image/jpeg' }, { label: 'PNG', value: 'image/png' }]" :key="mime.value" :model-value="requirement.allowedMimeTypes.includes(mime.value)" :label="mime.label" @update:model-value="setDocumentMimeType(requirement, mime.value, Boolean($event))" />
                          </div>
                        </UFormField>
                      </div>
                      <USwitch :model-value="Boolean(selectionCondition(requirement.when))" label="Dokument zależy od wariantu oferty" @update:model-value="setRequirementCondition(requirement, Boolean($event))" />
                      <div v-if="selectionCondition(requirement.when)" class="form-grid form-grid--2">
                        <UFormField :name="`documentation.requirements.${index}.when.featureId`" label="Warunek"><USelect :model-value="selectionCondition(requirement.when)?.featureId" :items="featureItems" class="w-full" @update:model-value="updateRequirementConditionFeature(requirement, $event)" /></UFormField>
                        <UFormField :name="`documentation.requirements.${index}.when.optionId`" label="Opcja"><USelect :model-value="selectionCondition(requirement.when)?.optionId" :items="featureOptions(selectionCondition(requirement.when)?.featureId)" class="w-full" @update:model-value="updateRequirementConditionOption(requirement, $event)" /></UFormField>
                      </div>
                      <MortgageEvidenceReferencesEditor v-model="requirement.evidenceRefs" :sources="draft.documentation.sources" :name-prefix="`documentation.requirements.${index}.evidenceRefs`" />
                    </UCard>
                  </div>
                  <div class="subsection-heading"><div><span>Źródła</span><h3>Dokumenty potwierdzające definicję</h3><p>Używaj bezpośrednich linków do taryf, formularzy informacyjnych i regulaminów.</p></div><UButton icon="i-lucide-plus" color="neutral" variant="outline" @click="void draft.documentation.sources.push(createOfferSourceV2())">Dodaj źródło</UButton></div>
                  <div class="editor-list"><UCard v-for="(source, index) in draft.documentation.sources" :key="source.id ?? index" class="rule-card"><template #header><div class="rule-card__header"><div><UBadge color="neutral" variant="subtle">Źródło {{ index + 1 }}</UBadge><strong>{{ source.title }}</strong></div><UButton icon="i-lucide-trash-2" square color="error" variant="ghost" @click="removeAt(draft.documentation.sources, index)" /></div></template><div class="form-grid form-grid--3"><UFormField :name="`documentation.sources.${index}.title`" label="Tytuł"><UInput v-model="source.title" class="w-full" /></UFormField><UFormField :name="`documentation.sources.${index}.kind`" label="Rodzaj"><USelect v-model="source.kind" :items="sourceKindItems" class="w-full" /></UFormField><UFormField :name="`documentation.sources.${index}.role`" label="Co potwierdza"><USelect v-model="source.role" :items="sourceRoleItems" class="w-full" /></UFormField><UFormField :name="`documentation.sources.${index}.url`" label="Adres źródła" class="form-grid__wide"><UInput v-model="source.url" type="url" icon="i-lucide-link" class="w-full" placeholder="https://bank.pl/..." /></UFormField><UFormField :name="`documentation.sources.${index}.retrievedAt`" label="Pobrano" required><UInput v-model="source.retrievedAt" type="date" class="w-full" /></UFormField><UFormField :name="`documentation.sources.${index}.publishedAt`" label="Data publikacji" hint="Opcjonalnie"><UInput v-model="source.publishedAt" type="date" class="w-full" /></UFormField><UFormField :name="`documentation.sources.${index}.sha256`" label="SHA-256" hint="Zalecany dla plików PDF"><UInput v-model="source.sha256" class="w-full" /></UFormField></div></UCard></div>
                </section>
              </template>

              <template #preview>
                <section class="editor-section">
                  <header class="editor-section__header"><div><span>07 · Laboratorium</span><h2>Scenariusz kontrolny kalkulatora</h2><p>Zmiany przeliczają się lokalnie. Wynik częściowy jasno pokazuje brakujące dane i nieznane koszty.</p></div></header>
                  <div class="laboratory">
                    <aside class="laboratory__inputs">
                      <h3>Scenariusz</h3>
                      <UFormField label="Cena zakupu"><UInputNumber :model-value="decimalNumber(previewScenario.property.purchasePrice)" :min="1" :step="10000" :format-options="{ style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }" class="w-full" @update:model-value="previewScenario.property.purchasePrice = decimalString($event)" /></UFormField>
                      <UFormField label="Wartość z operatu"><UInputNumber :model-value="decimalNumber(previewScenario.property.appraisalValue)" :min="1" :step="10000" :format-options="{ style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }" class="w-full" @update:model-value="previewScenario.property.appraisalValue = decimalString($event)" /></UFormField>
                      <UFormField label="Kwota finansowania"><UInputNumber :model-value="decimalNumber(previewScenario.financing.amount)" :min="1" :step="10000" :format-options="{ style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }" class="w-full" @update:model-value="previewScenario.financing.amount = decimalString($event)" /></UFormField>
                      <UFormField label="Znaczenie kwoty"><URadioGroup v-model="previewScenario.financing.amountMode" :items="[{ label: 'Docelowa kwota netto', value: 'target_net_proceeds', description: 'Koszty kredytowane zwiększają kapitał.' }, { label: 'Kapitał brutto', value: 'gross_facility', description: 'Koszty pomniejszają środki dla klienta.' }]" /></UFormField>
                      <UFormField label="Okres (mies.)"><UInputNumber v-model="previewScenario.financing.termMonths" :min="1" :max="600" :step="12" class="w-full" /></UFormField>
                      <UFormField label="Rodzaj rat"><USelect v-model="previewScenario.financing.installmentType" :items="[{ label: 'Równe', value: 'equal' }, { label: 'Malejące', value: 'decreasing' }]" class="w-full" /></UFormField>
                      <UFormField label="Wariant"><USelect :model-value="previewScenario.presetId ?? manualPresetValue" :items="presetItems" class="w-full" @update:model-value="applyPreviewPreset($event || undefined)" /></UFormField>
                      <div v-for="feature in draft.features" :key="feature.id" class="laboratory__selection-event">
                        <UFormField :label="feature.label"><USelect v-model="previewScenario.selections[feature.id]" :items="featureOptions(feature.id)" class="w-full" /></UFormField>
                        <UFormField label="Zmiana / utrata warunku od miesiąca" hint="Puste = bez zmiany"><UInputNumber :model-value="previewSelectionEvent(feature.id)?.month" :min="1" :max="previewScenario.financing.termMonths" :step="1" class="w-full" @update:model-value="setPreviewSelectionEventMonth(feature, $event)" /></UFormField>
                        <UFormField v-if="previewSelectionEvent(feature.id)" label="Opcja po zmianie"><USelect :model-value="previewSelectionEvent(feature.id)?.optionId" :items="featureOptions(feature.id)" class="w-full" @update:model-value="setPreviewSelectionEventOption(feature.id, String($event ?? ''))" /></UFormField>
                      </div>
                      <UFormField v-if="draft.bridgeInsurance" label="Wpis hipoteki w miesiącu"><UInputNumber v-model="previewScenario.events.mortgageRegistered!.month" :min="0" :max="previewScenario.financing.termMonths" :step="1" class="w-full" /></UFormField>
                      <USeparator label="Rozliczenie kosztów" />
                      <UFormField v-for="cost in draft.costs.filter(item => item.state === 'known' && item.settlement.allowed.length > 1)" :key="cost.id" :label="cost.label"><USelect v-model="previewScenario.costSettlements[cost.id]" :items="settlementItems.filter(item => cost.settlement.allowed.includes(item.value))" class="w-full" /></UFormField>
                    </aside>
                    <div class="laboratory__results">
                      <div v-if="previewCalculation" class="result-metrics"><article><span>Status</span><UBadge :color="previewCalculation.status === 'complete' ? 'success' : previewCalculation.status === 'partial' ? 'warning' : 'error'" variant="subtle">{{ previewCalculation.status }}</UBadge></article><article><span>Kwota netto</span><strong>{{ formatMoney(previewCalculation.netLoanAmount) }}</strong></article><article><span>Kapitał brutto</span><strong>{{ formatMoney(previewCalculation.grossLoanAmount) }}</strong><small>{{ formatMoney(previewCalculation.financedCosts) }} kosztów kredytowanych</small></article><article><span>LTV</span><strong>{{ formatPercent(previewCalculation.ltvPct) }}</strong></article><article><span>Pierwsza rata</span><strong>{{ formatMoney(firstPayment?.scheduledPayment) }}</strong><small>+ {{ formatMoney(firstPayment?.cashCosts) }} kosztów w tym miesiącu</small></article><article><span>Koszty gotówkowe</span><strong>{{ formatMoney(previewCalculation.totals.cashCosts) }}</strong><small>{{ formatMoney(previewCalculation.totals.recurringCashCosts) }} cyklicznych</small></article><article><span>Koszty warunkowe</span><strong>{{ formatMoney(previewCalculation.totals.conditionalCosts) }}</strong></article><article><span>Koszty kwalifikowane do RRSO</span><strong>{{ formatMoney(previewCalculation.totals.aprEligibleNonInterestCosts) }}</strong><small>bez odsetek; samo RRSO nie jest estymowane</small></article><article><span>Odsetki</span><strong>{{ formatMoney(previewCalculation.totals.interest) }}</strong></article><article><span>Zwroty</span><strong>{{ formatMoney(previewCalculation.totals.refunds) }}</strong></article><article><span>Koszt pierwszych 5 lat</span><strong>{{ formatMoney(previewCalculation.totals.costFirstFiveYears) }}</strong></article><article><span>Łączny wypływ</span><strong>{{ formatMoney(previewCalculation.totals.borrowerTotalOutflow) }}</strong></article></div>
                      <UAlert v-else color="error" variant="subtle" icon="i-lucide-circle-alert" title="Silnik nie mógł przeliczyć scenariusza" description="Sprawdź fazy stopy i wymagane dane oferty." />
                      <section v-if="previewIssues.length" class="issue-list"><h3>Problemy i założenia</h3><UAlert v-for="(issue, index) in previewIssues" :key="`${issue.code}-${index}`" :color="issueColor(issue.kind)" variant="soft" :title="issue.message" :description="`${issue.code} · ${issue.path}`" /></section>
                      <section v-if="previewCalculation?.schedule.length" class="schedule-preview"><div class="schedule-preview__header"><div><h3>Pierwsze 12 miesięcy</h3><p>Rata, koszty, refund i zmiana salda.</p></div><UBadge color="neutral" variant="outline">{{ previewCalculation.schedule.length }} mies. harmonogramu</UBadge></div><div class="schedule-table"><table><thead><tr><th>Mies.</th><th>Stopa</th><th>Rata</th><th>Odsetki</th><th>Koszty</th><th>Zwrot</th><th>Saldo</th></tr></thead><tbody><tr v-for="row in previewCalculation.schedule.slice(0, 12)" :key="row.month"><td>{{ row.month }}</td><td>{{ formatPercent(row.annualRatePct) }}</td><td>{{ formatMoney(row.scheduledPayment) }}</td><td>{{ formatMoney(row.interest) }}</td><td>{{ formatMoney(row.cashCosts) }}</td><td>{{ formatMoney(row.cashRefunds) }}</td><td>{{ formatMoney(row.closingBalance) }}</td></tr></tbody></table></div></section>
                    </div>
                  </div>
                </section>
              </template>
            </UTabs>
          </UCard>
        </UForm>
      </template>
    </div>

    <UModal v-model:open="publishOpen" title="Opublikować nową wersję?" description="Powstanie niezmienna wersja używana przez porównywarki wszystkich organizacji, w których produkt jest włączony." :ui="{ footer: 'justify-end' }"><template #body><div class="publish-review"><UAlert color="success" variant="subtle" icon="i-lucide-circle-check" title="Walidacja silnika zakończona" description="Oferta przechodzi kontrolę kompletności i scenariusz można przeliczyć." /><dl><div><dt>Oferta</dt><dd>{{ detail?.product.name }}</dd></div><div><dt>Rewizja szkicu</dt><dd>{{ revision }}</dd></div><div><dt>Ważność</dt><dd>{{ draft.validity.effectiveFrom }} – {{ draft.validity.effectiveTo || 'bez daty końcowej' }}</dd></div><div><dt>Fazy / koszty / warianty</dt><dd>{{ draft.ratePlan.phases.length }} / {{ draft.costs.length }} / {{ draft.presets.length }}</dd></div></dl></div></template><template #footer="{ close }"><UButton color="neutral" variant="ghost" :disabled="publishing" @click="close">Anuluj</UButton><UButton icon="i-lucide-send" :loading="publishing" @click="publishDraft">Opublikuj wersję</UButton></template></UModal>
  </CrmShell>
</template>

<style scoped>
.offer-editor { display: grid; gap: 16px; min-width: 0; }
.offer-editor > *, .offer-editor form { min-width: 0; max-width: 100%; }
.organization-product-settings__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
.organization-product-settings__header span { color: var(--ui-primary); font-family: var(--font-mono); font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.organization-product-settings__header h2, .organization-product-settings__header p { margin: 0; }
.organization-product-settings__header h2 { margin-top: 4px; font-size: 19px; }
.organization-product-settings__header p { max-width: 720px; margin-top: 5px; color: var(--ui-text-muted); font-size: 12px; }
.organization-product-settings__notice { margin-bottom: 16px; }
.organization-product-settings__form { display: grid; grid-template-columns: minmax(210px, .8fr) minmax(230px, 1fr) minmax(260px, 1.2fr); gap: 16px 20px; align-items: start; }
.organization-product-settings__actions { display: flex; grid-column: 1 / -1; justify-content: flex-end; gap: 8px; }
.offer-editor__loading { display: grid; gap: 16px; }
.offer-editor__statusbar { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); min-width: 0; border: 1px solid var(--ui-border); border-radius: var(--ui-radius); background: var(--ui-bg); }
.offer-editor__statusbar > div { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 13px 16px; border-left: 1px solid var(--ui-border); }
.offer-editor__statusbar > div:first-child { border-left: 0; }
.offer-editor__statusbar span:last-child { display: grid; gap: 2px; min-width: 0; }
.offer-editor__statusbar small { color: var(--ui-text-muted); font-size: 10px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
.offer-editor__statusbar strong { color: var(--ui-text-highlighted); font-size: 12px; }
.offer-editor__status-icon { display: grid; place-items: center; flex: 0 0 auto; width: 32px; height: 32px; border-radius: 9px; color: var(--ui-text-toned); background: var(--ui-bg-elevated); }
.offer-editor__workspace { min-width: 0; max-width: 100%; }
.offer-editor__tabs { min-width: 0; max-width: 100%; }
.offer-editor__tabs :deep([data-slot="list"]) {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 8px;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
}
.offer-editor__tabs :deep([data-slot="indicator"]) { display: none; }
.offer-editor__tabs :deep([data-slot="trigger"]) {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  align-items: center;
  justify-content: stretch;
  gap: 10px;
  min-width: 0;
  min-height: 70px;
  padding: 11px 12px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  color: var(--ui-text-muted);
  background: var(--ui-bg-muted);
  text-align: left;
}
.offer-editor__tabs :deep([data-slot="trigger"]:hover) {
  border-color: var(--ui-border-accented);
  color: var(--ui-text);
  background: var(--ui-bg-elevated);
}
.offer-editor__tabs :deep([data-slot="trigger"][data-state="active"]) {
  border-color: var(--ui-primary);
  color: var(--ui-primary);
  background: color-mix(in srgb, var(--ui-primary) 8%, var(--ui-bg));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ui-primary) 24%, transparent);
}
.offer-editor__tabs :deep([data-slot="leadingIcon"]) { width: 22px; height: 22px; justify-self: center; }
.offer-editor__tabs :deep([data-slot="label"]) {
  min-width: 0;
  overflow: visible;
  white-space: normal;
  text-overflow: clip;
}
.offer-editor__tab-label { display: grid; gap: 2px; min-width: 0; }
.offer-editor__tab-label strong { color: var(--ui-text-highlighted); font-size: 12px; line-height: 1.2; }
.offer-editor__tab-label small { color: var(--ui-text-muted); font-size: 10px; font-weight: 400; line-height: 1.25; }
.offer-editor__tabs :deep([data-slot="trigger"][data-state="active"]) .offer-editor__tab-label strong { color: var(--ui-primary); }
.editor-section { display: grid; gap: 22px; padding-top: 22px; }
.editor-section__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 22px; padding-bottom: 18px; border-bottom: 1px solid var(--ui-border); }
.editor-section__header--actions { align-items: center; }
.editor-section__header span, .subsection-heading span { color: var(--ui-primary); font-family: var(--font-mono); font-size: 10px; font-weight: 800; letter-spacing: .09em; text-transform: uppercase; }
.editor-section__header h2, .editor-section__header p, .subsection-heading h3, .subsection-heading p { margin: 0; }
.editor-section__header h2 { margin-top: 5px; font-size: clamp(20px, 2.2vw, 28px); }
.editor-section__header p, .subsection-heading p { max-width: 760px; margin-top: 5px; color: var(--ui-text-muted); }
.form-grid { display: grid; gap: 16px; }
.form-grid--2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.form-grid--3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.form-grid--4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.form-grid__wide { grid-column: span 2; }
.check-row { display: flex; flex-wrap: wrap; gap: 12px 20px; min-height: 32px; align-items: center; }
.check-stack { display: grid; gap: 8px; }
.editor-list { display: grid; gap: 14px; }
.rule-card { border-left: 3px solid var(--ui-border-accented); }
.rule-card--unknown { border-left-color: var(--ui-warning); }
.rule-card--known { border-left-color: var(--ui-success); }
.rule-card__header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.rule-card__header > div { display: flex; align-items: center; gap: 10px; min-width: 0; }
.rule-card__header strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.subsection-heading { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-top: 10px; padding-top: 22px; border-top: 1px solid var(--ui-border); }
.subsection-heading h3 { margin-top: 4px; font-size: 20px; }
.action-row { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.action-row--start { justify-content: flex-start; }
.option-list { display: grid; gap: 10px; margin-top: 16px; }
.option-row { display: grid; grid-template-columns: 1fr 1.2fr 1.5fr auto 34px; align-items: end; gap: 10px; padding: 12px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius); background: var(--ui-bg-muted); }
.option-row__obligations { grid-column: 1 / -1; }
.bridge-toggle { display: flex; align-items: center; justify-content: space-between; gap: 18px; }
.bridge-toggle > div { display: flex; align-items: center; gap: 13px; }
.bridge-toggle span:not(.bridge-toggle__icon) { display: grid; gap: 3px; }
.bridge-toggle small { color: var(--ui-text-muted); }
.bridge-toggle__icon { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 12px; color: var(--ui-primary); background: var(--ui-bg-elevated); }
.laboratory { display: grid; grid-template-columns: minmax(260px, 330px) minmax(0, 1fr); gap: 18px; align-items: start; }
.laboratory__inputs { display: grid; gap: 13px; padding: 16px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius); background: var(--ui-bg-muted); }
.laboratory__inputs h3 { margin: 0 0 4px; }
.laboratory__selection-event { display: grid; gap: 10px; padding: 12px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius); background: var(--ui-bg); }
.laboratory__results { display: grid; gap: 18px; min-width: 0; }
.result-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.result-metrics article { display: grid; align-content: start; gap: 5px; min-height: 96px; padding: 14px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius); background: var(--ui-bg); }
.result-metrics span, .result-metrics small { color: var(--ui-text-muted); font-size: 11px; }
.result-metrics strong { color: var(--ui-text-highlighted); font-size: 18px; }
.issue-list { display: grid; gap: 9px; }
.issue-list h3 { margin: 0 0 3px; }
.schedule-preview { overflow: hidden; border: 1px solid var(--ui-border); border-radius: var(--ui-radius); }
.schedule-preview__header { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 14px 16px; border-bottom: 1px solid var(--ui-border); }
.schedule-preview__header h3, .schedule-preview__header p { margin: 0; }
.schedule-preview__header p { margin-top: 3px; color: var(--ui-text-muted); font-size: 12px; }
.schedule-table { overflow-x: auto; }
.schedule-table table { width: 100%; border-collapse: collapse; white-space: nowrap; }
.schedule-table th, .schedule-table td { padding: 10px 12px; border-top: 1px solid var(--ui-border); text-align: right; font-size: 12px; }
.schedule-table th { border-top: 0; color: var(--ui-text-muted); font-size: 10px; letter-spacing: .04em; text-transform: uppercase; }
.schedule-table th:first-child, .schedule-table td:first-child { text-align: left; }
.publish-review { display: grid; gap: 16px; }
.publish-review dl { display: grid; gap: 0; margin: 0; border: 1px solid var(--ui-border); border-radius: var(--ui-radius); }
.publish-review dl div { display: flex; justify-content: space-between; gap: 18px; padding: 11px 13px; border-top: 1px solid var(--ui-border); }
.publish-review dl div:first-child { border-top: 0; }
.publish-review dt { color: var(--ui-text-muted); }
.publish-review dd { margin: 0; color: var(--ui-text-highlighted); font-weight: 600; text-align: right; }
@media (max-width: 1200px) {
  .organization-product-settings__form { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .organization-product-settings__notes { grid-column: 1 / -1; }
  .offer-editor__tabs :deep([data-slot="list"]) { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .offer-editor__statusbar { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .offer-editor__statusbar > div:nth-child(3) { border-left: 0; border-top: 1px solid var(--ui-border); }
  .offer-editor__statusbar > div:nth-child(4) { border-top: 1px solid var(--ui-border); }
  .form-grid--3 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .form-grid--4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .result-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .option-row { grid-template-columns: 1fr 1fr 34px; }
  .option-row > :nth-child(3) { grid-column: span 2; }
  .laboratory { grid-template-columns: 1fr; }
}
@media (max-width: 640px) {
  .organization-product-settings__header { align-items: stretch; flex-direction: column; }
  .organization-product-settings__form { grid-template-columns: 1fr; }
  .organization-product-settings__notes, .organization-product-settings__actions { grid-column: auto; }
  .organization-product-settings__actions { align-items: stretch; flex-direction: column-reverse; }
  .offer-editor__tabs :deep([data-slot="list"]) { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .offer-editor__statusbar, .form-grid--2, .form-grid--3, .form-grid--4, .result-metrics { grid-template-columns: 1fr; }
  .offer-editor__statusbar > div { border-top: 1px solid var(--ui-border); border-left: 0; }
  .offer-editor__statusbar > div:first-child { border-top: 0; }
  .editor-section__header, .subsection-heading { align-items: stretch; flex-direction: column; }
  .form-grid__wide { grid-column: auto; }
  .option-row { grid-template-columns: 1fr 34px; }
  .option-row > * { grid-column: 1; }
  .option-row__remove { grid-column: 2 !important; grid-row: 1; }
  .option-row__obligations { grid-column: 1 / -1 !important; }
}
</style>
