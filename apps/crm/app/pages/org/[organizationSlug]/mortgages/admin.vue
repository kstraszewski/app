<script setup lang="ts">
definePageMeta({ middleware: ['auth', 'organization'] })
useHead({ title: 'Parametry hipotek — OpenExpert' })

type JsonRecord = Record<string, any>
type DocumentRequirementItemKind = 'client_document' | 'bank_document' | 'external_check' | 'manual_action'
type DocumentRequirementCategory = 'application' | 'identity' | 'income_employment' | 'income_business' | 'income_other' | 'liabilities' | 'transaction' | 'property_legal' | 'valuation' | 'construction_renovation' | 'refinance_discharge' | 'insurance_security' | 'disbursement' | 'disclosure_privacy' | 'other'
type DocumentRequirementScope = 'case' | 'primary_applicant' | 'each_applicant'
type DocumentRequirementStage = 'analysis' | 'agreement' | 'disbursement' | 'tranche' | 'maintenance'
type DocumentRequirementApplicability = 'always' | 'conditional' | 'optional' | 'case_requested'
type DocumentRequirementEvidence = 'confirmed_bank_source' | 'inferred' | 'expert_default' | 'organization_custom'
type DocumentRequirement = {
  code: string
  label: string
  category: DocumentRequirementCategory
  itemKind: DocumentRequirementItemKind
  scope: DocumentRequirementScope
  stage: DocumentRequirementStage
  applicability: DocumentRequirementApplicability
  evidence: DocumentRequirementEvidence
  required: boolean
  multiple: boolean
  allowedMimeTypes: string[]
  templateId?: string
  notes?: string
}
type Product = {
  id: string
  name: string
  baseName: string
  isEnabled: boolean
  bank: { name: string }
  version: JsonRecord
  baseVersion: JsonRecord
  override: null | {
    id: string
    is_enabled: boolean
    custom_name: string | null
    parameters: JsonRecord
    notes: string | null
    revision: number
    updated_at: string
  }
}
type Payload = { products: Product[], role: 'admin' | 'expert', superAdmin: boolean, retrievedAt: string | null }
type HistoryEntry = {
  id: string
  revision: number
  action: 'created' | 'updated' | 'reset'
  parameters: JsonRecord
  changed_by: string
  created_at: string
  actor: null | { full_name: string, email: string }
}

const route = useRoute()
const toast = useToast()
const organizationSlug = computed(() => String(route.params.organizationSlug ?? ''))
const apiBase = computed(() => `/api/org/${organizationSlug.value}/mortgages/products`)
const { data, pending, error, refresh } = await useFetch<Payload>(
  () => `${apiBase.value}?includeDisabled=1`,
  { default: () => ({ products: [], role: 'expert' as const, superAdmin: false, retrievedAt: null }) },
)

const selectedId = ref('')
const saving = ref(false)
const resetting = ref(false)
const resetArmed = ref(false)
const historyPending = ref(false)
const mounted = ref(false)
const history = ref<HistoryEntry[]>([])
const selected = computed(() => data.value.products.find(product => product.id === selectedId.value) ?? null)
const isSuperAdmin = computed(() => data.value.superAdmin)
const overriddenFields = computed(() => Object.keys(selected.value?.override?.parameters ?? {}))
const selectedUsesV2 = computed(() => Number(selected.value?.baseVersion?.calculator_schema_version ?? 1) >= 2)

const costKeys = [
  ['commissionPct', 'Prowizja (%)'],
  ['appraisalFee', 'Wycena (zł)'],
  ['pccFee', 'PCC (zł)'],
  ['courtFee', 'Opłata sądowa (zł)'],
  ['accountMonthlyFee', 'Konto / miesiąc (zł)'],
  ['cardMonthlyFee', 'Karta / miesiąc (zł)'],
  ['propertyInsuranceAnnualRatePct', 'Nieruchomość / rok (%)'],
  ['lifeInsuranceMonthlyRatePct', 'Życie / miesiąc (%)'],
  ['lifeInsuranceMonths', 'Ubezpieczenie życia (mies.)'],
] as const
const editableKeys = [
  'effective_from', 'effective_to', 'calculation_date', 'data_status',
  'completeness_score', 'interest_type', 'fixed_rate_pct', 'fixed_period_months',
  'margin_pct', 'reference_rate_code', 'reference_rate_pct', 'reference_rate_as_of',
  'representative_apr_pct', 'min_amount', 'max_amount', 'min_term_months',
  'max_term_months', 'max_ltv_pct', 'is_eco', 'cost_rules', 'requirements',
  'document_requirements', 'multiform_template_ids', 'representative_example',
  'assumptions', 'unknown_fields',
] as const
const numericKeys = new Set([
  'completeness_score', 'fixed_rate_pct', 'fixed_period_months', 'margin_pct',
  'reference_rate_pct', 'representative_apr_pct', 'min_amount', 'max_amount',
  'min_term_months', 'max_term_months', 'max_ltv_pct',
])

const form = reactive<JsonRecord>({
  is_enabled: true,
  custom_name: '',
  notes: '',
  cost_rules: {},
  requirementsText: '',
  document_requirements: [],
  multiform_template_ids: [],
  assumptionsText: '',
  unknownFieldsText: '',
  representativeExampleText: '{}',
})

const statusItems = [
  { label: 'Potwierdzone', value: 'confirmed' },
  { label: 'Wywnioskowane', value: 'inferred' },
  { label: 'Wersja robocza', value: 'draft' },
]
const interestItems = [
  { label: 'Okresowo stałe', value: 'fixed_periodic' },
  { label: 'Zmienne', value: 'variable' },
]
const itemKindItems = [
  { label: 'Dokument klienta', value: 'client_document' },
  { label: 'Dokument bankowy', value: 'bank_document' },
  { label: 'Sprawdzenie zewnętrzne', value: 'external_check' },
  { label: 'Czynność ręczna', value: 'manual_action' },
]
const categoryItems = [
  { label: 'Wniosek i formularze', value: 'application' },
  { label: 'Tożsamość', value: 'identity' },
  { label: 'Dochód — zatrudnienie', value: 'income_employment' },
  { label: 'Dochód — działalność', value: 'income_business' },
  { label: 'Dochód — pozostałe', value: 'income_other' },
  { label: 'Zobowiązania', value: 'liabilities' },
  { label: 'Transakcja', value: 'transaction' },
  { label: 'Stan prawny nieruchomości', value: 'property_legal' },
  { label: 'Wycena', value: 'valuation' },
  { label: 'Budowa lub remont', value: 'construction_renovation' },
  { label: 'Refinansowanie i zwolnienie', value: 'refinance_discharge' },
  { label: 'Ubezpieczenia i zabezpieczenia', value: 'insurance_security' },
  { label: 'Uruchomienie środków', value: 'disbursement' },
  { label: 'Informacje i prywatność', value: 'disclosure_privacy' },
  { label: 'Inne', value: 'other' },
]
const scopeItems = [
  { label: 'Cała sprawa', value: 'case' },
  { label: 'Główny wnioskodawca', value: 'primary_applicant' },
  { label: 'Każdy wnioskodawca', value: 'each_applicant' },
]
const stageItems = [
  { label: 'Analiza', value: 'analysis' },
  { label: 'Umowa', value: 'agreement' },
  { label: 'Uruchomienie', value: 'disbursement' },
  { label: 'Transza', value: 'tranche' },
  { label: 'Obsługa', value: 'maintenance' },
]
const applicabilityItems = [
  { label: 'Zawsze', value: 'always' },
  { label: 'Warunkowo', value: 'conditional' },
  { label: 'Opcjonalnie', value: 'optional' },
  { label: 'Na żądanie w sprawie', value: 'case_requested' },
]
const evidenceItems = [
  { label: 'Potwierdzone źródłem banku', value: 'confirmed_bank_source' },
  { label: 'Wywnioskowane', value: 'inferred' },
  { label: 'Domyślne eksperta', value: 'expert_default' },
  { label: 'Własne organizacji', value: 'organization_custom' },
]
const mimeTypeItems = [
  { label: 'PDF', value: 'application/pdf' },
  { label: 'JPEG', value: 'image/jpeg' },
  { label: 'PNG', value: 'image/png' },
]
const identifierPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const itemKindValues = new Set(itemKindItems.map(item => item.value))
const categoryValues = new Set(categoryItems.map(item => item.value))
const scopeValues = new Set(scopeItems.map(item => item.value))
const stageValues = new Set(stageItems.map(item => item.value))
const applicabilityValues = new Set(applicabilityItems.map(item => item.value))
const evidenceValues = new Set(evidenceItems.map(item => item.value))
const mimeTypeValues = new Set(mimeTypeItems.map(item => item.value))
const templateIdItems = computed(() => [
  { label: 'Bez szablonu', value: '' },
  ...[...new Set((form.multiform_template_ids as unknown[])
    .map(value => String(value ?? '').trim())
    .filter(Boolean))]
    .map(value => ({ label: value, value })),
])

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function listText(value: unknown): string {
  return Array.isArray(value) ? value.join('\n') : ''
}

function lines(value: unknown): string[] {
  return String(value ?? '').split('\n').map(entry => entry.trim()).filter(Boolean)
}

function nullableNumber(value: unknown): number | null {
  if (value === '' || value == null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function canonical(value: unknown): string {
  function normalize(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(normalize)
    if (input && typeof input === 'object') {
      const object = input as JsonRecord
      return Object.keys(object).sort().reduce<JsonRecord>((result, key) => {
        if (object[key] !== undefined) result[key] = normalize(object[key])
        return result
      }, {})
    }
    return input ?? null
  }
  return JSON.stringify(normalize(value))
}

function normalizedCostRules(value: unknown): JsonRecord {
  const source = value && typeof value === 'object' ? value as JsonRecord : {}
  return Object.fromEntries(costKeys.map(([key]) => [key, nullableNumber(source[key])]))
}

function documentRequirementsForForm(value: unknown): DocumentRequirement[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => {
    const source = entry && typeof entry === 'object' && !Array.isArray(entry)
      ? entry as JsonRecord
      : {}
    return {
      code: String(source.code ?? ''),
      label: String(source.label ?? ''),
      category: String(source.category ?? 'other') as DocumentRequirementCategory,
      itemKind: String(source.itemKind ?? 'client_document') as DocumentRequirementItemKind,
      scope: String(source.scope ?? 'case') as DocumentRequirementScope,
      stage: String(source.stage ?? 'analysis') as DocumentRequirementStage,
      applicability: String(source.applicability ?? 'always') as DocumentRequirementApplicability,
      evidence: String(source.evidence ?? 'organization_custom') as DocumentRequirementEvidence,
      required: typeof source.required === 'boolean' ? source.required : true,
      multiple: typeof source.multiple === 'boolean' ? source.multiple : false,
      allowedMimeTypes: Array.isArray(source.allowedMimeTypes)
        ? source.allowedMimeTypes.map(value => String(value))
        : [],
      templateId: String(source.templateId ?? ''),
      notes: String(source.notes ?? ''),
    }
  })
}

function normalizedMultiformTemplateIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 50) {
    throw new Error('Lista szablonów MultiForm może zawierać maksymalnie 50 pozycji.')
  }
  const result = value.map(entry => String(entry ?? '').trim()).filter(Boolean)
  for (const templateId of result) {
    if (templateId.length > 120 || !identifierPattern.test(templateId)) {
      throw new Error(`Niepoprawny identyfikator szablonu MultiForm: ${templateId}`)
    }
  }
  if (new Set(result).size !== result.length) {
    throw new Error('Identyfikatory szablonów MultiForm nie mogą się powtarzać.')
  }
  return result
}

function normalizedDocumentRequirements(value: unknown): DocumentRequirement[] {
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error('Checklista może zawierać maksymalnie 100 pozycji.')
  }

  const codes = new Set<string>()
  return value.map((entry, index) => {
    const source = entry as Partial<DocumentRequirement>
    const rowLabel = `Pozycja ${index + 1}`
    const code = String(source.code ?? '').trim()
    const label = String(source.label ?? '').trim()
    const category = String(source.category ?? '').trim()
    const templateId = String(source.templateId ?? '').trim()
    const notes = String(source.notes ?? '').trim()
    if (!identifierPattern.test(code) || code.length > 100) {
      throw new Error(`${rowLabel}: kod musi być małym identyfikatorem bez spacji.`)
    }
    if (codes.has(code)) throw new Error(`${rowLabel}: kod „${code}” jest zduplikowany.`)
    codes.add(code)
    if (!label || label.length > 200) throw new Error(`${rowLabel}: podaj etykietę do 200 znaków.`)
    if (!categoryValues.has(category)) throw new Error(`${rowLabel}: wybierz kategorię.`)
    if (!itemKindValues.has(String(source.itemKind))) throw new Error(`${rowLabel}: wybierz rodzaj pozycji.`)
    if (!scopeValues.has(String(source.scope))) throw new Error(`${rowLabel}: wybierz zakres.`)
    if (!stageValues.has(String(source.stage))) throw new Error(`${rowLabel}: wybierz etap.`)
    if (!applicabilityValues.has(String(source.applicability))) throw new Error(`${rowLabel}: wybierz wymagalność.`)
    if (!evidenceValues.has(String(source.evidence))) throw new Error(`${rowLabel}: wybierz źródło informacji.`)
    if (typeof source.required !== 'boolean' || typeof source.multiple !== 'boolean') {
      throw new Error(`${rowLabel}: pola „wymagane” i „wiele plików” muszą być ustawione.`)
    }
    if (!Array.isArray(source.allowedMimeTypes)) throw new Error(`${rowLabel}: wybierz dozwolone formaty.`)
    const allowedMimeTypes = source.allowedMimeTypes.map(value => String(value))
    if (allowedMimeTypes.some(value => !mimeTypeValues.has(value))) {
      throw new Error(`${rowLabel}: lista formatów zawiera nieobsługiwaną wartość.`)
    }
    if (new Set(allowedMimeTypes).size !== allowedMimeTypes.length) {
      throw new Error(`${rowLabel}: formaty plików nie mogą się powtarzać.`)
    }
    if (source.itemKind === 'client_document' && allowedMimeTypes.length === 0) {
      throw new Error(`${rowLabel}: dokument klienta musi mieć co najmniej jeden dozwolony format.`)
    }
    if (templateId && (templateId.length > 120 || !identifierPattern.test(templateId))) {
      throw new Error(`${rowLabel}: identyfikator szablonu MultiForm jest niepoprawny.`)
    }
    if (templateId && source.itemKind !== 'bank_document') {
      throw new Error(`${rowLabel}: szablon MultiForm można przypisać tylko do dokumentu bankowego.`)
    }
    if (notes.length > 1_000) throw new Error(`${rowLabel}: notatka może mieć maksymalnie 1000 znaków.`)

    return {
      code,
      label,
      category: category as DocumentRequirementCategory,
      itemKind: source.itemKind as DocumentRequirementItemKind,
      scope: source.scope as DocumentRequirementScope,
      stage: source.stage as DocumentRequirementStage,
      applicability: source.applicability as DocumentRequirementApplicability,
      evidence: source.evidence as DocumentRequirementEvidence,
      required: source.required,
      multiple: source.multiple,
      allowedMimeTypes,
      ...(templateId ? { templateId } : {}),
      ...(notes ? { notes } : {}),
    }
  })
}

function addDocumentRequirement() {
  const requirements = form.document_requirements as DocumentRequirement[]
  requirements.push({
    code: '',
    label: '',
    category: 'other',
    itemKind: 'client_document',
    scope: 'case',
    stage: 'analysis',
    applicability: 'always',
    evidence: 'organization_custom',
    required: true,
    multiple: false,
    allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png'],
    templateId: '',
    notes: '',
  })
}

function removeDocumentRequirement(index: number) {
  const requirements = form.document_requirements as DocumentRequirement[]
  requirements.splice(index, 1)
}

function updateRequirementItemKind(requirement: DocumentRequirement, value: unknown) {
  const itemKind = String(value)
  if (!itemKindValues.has(itemKind)) return
  requirement.itemKind = itemKind as DocumentRequirementItemKind
  if (requirement.itemKind !== 'bank_document') requirement.templateId = ''
  if (requirement.itemKind === 'client_document' && requirement.allowedMimeTypes.length === 0) {
    requirement.allowedMimeTypes = ['application/pdf', 'image/jpeg', 'image/png']
  }
}

function addMultiformTemplateId() {
  const templateIds = form.multiform_template_ids as string[]
  templateIds.push('')
}

function removeMultiformTemplateId(index: number) {
  const templateIds = form.multiform_template_ids as string[]
  const removed = String(templateIds[index] ?? '').trim()
  templateIds.splice(index, 1)
  if (!removed) return
  for (const requirement of form.document_requirements as DocumentRequirement[]) {
    if (requirement.templateId === removed) requirement.templateId = ''
  }
}

function loadForm(product: Product) {
  const version = product.version
  form.is_enabled = product.override?.is_enabled ?? true
  form.custom_name = product.override?.custom_name ?? ''
  form.notes = product.override?.notes ?? ''
  for (const key of editableKeys) form[key] = clone(version[key] ?? null)
  form.cost_rules = normalizedCostRules(version.cost_rules)
  form.requirementsText = listText(version.requirements)
  form.document_requirements = documentRequirementsForForm(version.document_requirements)
  form.multiform_template_ids = Array.isArray(version.multiform_template_ids)
    ? version.multiform_template_ids.map((value: unknown) => String(value))
    : []
  form.assumptionsText = listText(version.assumptions)
  form.unknownFieldsText = listText(version.unknown_fields)
  form.representativeExampleText = JSON.stringify(version.representative_example ?? {}, null, 2)
}

function currentParameters(): JsonRecord {
  const product = selected.value
  if (!product) return {}
  if (selectedUsesV2.value) return {}
  let representativeExample: JsonRecord
  try {
    representativeExample = JSON.parse(String(form.representativeExampleText || '{}'))
  } catch {
    throw new Error('Przykład reprezentatywny nie jest poprawnym JSON-em.')
  }
  if (!representativeExample || typeof representativeExample !== 'object' || Array.isArray(representativeExample)) {
    throw new Error('Przykład reprezentatywny musi być obiektem JSON.')
  }

  const current: JsonRecord = {}
  for (const key of editableKeys) {
    if (numericKeys.has(key)) current[key] = nullableNumber(form[key])
    else current[key] = form[key]
  }
  current.effective_from = form.effective_from || null
  current.effective_to = form.effective_to || null
  current.calculation_date = form.calculation_date || null
  current.reference_rate_as_of = form.reference_rate_as_of || null
  current.cost_rules = normalizedCostRules(form.cost_rules)
  current.requirements = lines(form.requirementsText)
  current.document_requirements = normalizedDocumentRequirements(form.document_requirements)
  const configuredTemplateIds = normalizedMultiformTemplateIds(form.multiform_template_ids)
  const referencedTemplateIds = (current.document_requirements as DocumentRequirement[])
    .flatMap(requirement => requirement.templateId ? [requirement.templateId] : [])
  current.multiform_template_ids = [...new Set([...configuredTemplateIds, ...referencedTemplateIds])]
  current.assumptions = lines(form.assumptionsText)
  current.unknown_fields = lines(form.unknownFieldsText)
  current.representative_example = representativeExample

  const parameters: JsonRecord = {}
  for (const key of editableKeys) {
    let baseValue = product.baseVersion[key]
    if (numericKeys.has(key)) baseValue = nullableNumber(baseValue)
    if (key === 'cost_rules') baseValue = normalizedCostRules(baseValue)
    if (key === 'document_requirements') baseValue = normalizedDocumentRequirements(baseValue ?? [])
    if (key === 'multiform_template_ids') baseValue = normalizedMultiformTemplateIds(baseValue ?? [])
    if (canonical(current[key]) !== canonical(baseValue)) parameters[key] = current[key]
  }
  return parameters
}

async function loadHistory() {
  if (!mounted.value || !selectedId.value || !isSuperAdmin.value) return
  historyPending.value = true
  try {
    const result = await $fetch<{ data: HistoryEntry[] }>(`${apiBase.value}/${selectedId.value}/history`)
    history.value = result.data
  } catch (caught: any) {
    history.value = []
    toast.add({ title: 'Nie udało się pobrać historii', description: caught?.data?.statusMessage ?? caught?.message, color: 'error' })
  } finally {
    historyPending.value = false
  }
}

async function save() {
  if (!selected.value) return
  saving.value = true
  try {
    const parameters = currentParameters()
    await $fetch(`${apiBase.value}/${selected.value.id}`, {
      method: 'PATCH',
      body: {
        is_enabled: Boolean(form.is_enabled),
        custom_name: String(form.custom_name ?? '').trim() || null,
        notes: String(form.notes ?? '').trim() || null,
        parameters,
      },
    })
    await refresh()
    await loadHistory()
    toast.add({ title: 'Zapisano parametry organizacji', description: `${Object.keys(parameters).length} pól nadpisuje katalog źródłowy.`, color: 'success' })
  } catch (caught: any) {
    toast.add({ title: 'Nie udało się zapisać', description: caught?.data?.statusMessage ?? caught?.message ?? 'Sprawdź dane formularza.', color: 'error' })
  } finally {
    saving.value = false
  }
}

async function performReset() {
  if (!selected.value?.override) return
  resetting.value = true
  try {
    await $fetch(`${apiBase.value}/${selected.value.id}`, { method: 'DELETE' })
    await refresh()
    await loadHistory()
    toast.add({ title: 'Przywrócono dane źródłowe', color: 'success' })
  } finally {
    resetting.value = false
    resetArmed.value = false
  }
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function actionLabel(action: HistoryEntry['action']) {
  return ({ created: 'Utworzono', updated: 'Zmieniono', reset: 'Przywrócono źródło' })[action]
}

watch(() => data.value.products, (products) => {
  if (!products.some(product => product.id === selectedId.value)) selectedId.value = products[0]?.id ?? ''
}, { immediate: true })
watch(selected, (product) => {
  if (!product) return
  resetArmed.value = false
  loadForm(product)
  loadHistory()
}, { immediate: true })
onMounted(() => {
  mounted.value = true
  loadHistory()
})
</script>

<template>
  <CrmShell title="Produkty hipoteczne" eyebrow="SuperAdmin · katalog produktów">
    <template #actions>
      <UButton :to="`/org/${organizationSlug}/mortgages/offers`" icon="i-lucide-badge-percent">Nowy backoffice ofert</UButton>
      <UButton :to="`/org/${organizationSlug}/mortgages/institutions`" icon="i-lucide-landmark" variant="outline">Instytucje</UButton>
      <UButton :to="`/org/${organizationSlug}/mortgages`" icon="i-lucide-arrow-left" variant="outline">Porównywarka</UButton>
    </template>

    <UAlert v-if="error" color="error" variant="subtle" title="Nie udało się pobrać katalogu" />
    <UAlert
      v-else-if="!pending && !isSuperAdmin"
      color="warning"
      variant="subtle"
      icon="i-lucide-shield-alert"
      title="Panel tylko dla SuperAdmina"
      description="Możesz korzystać z porównywarki, ale edycja produktów wymaga globalnej roli SuperAdmin."
    />

    <template v-else>
      <section class="admin-notice">
        <UIcon name="i-lucide-shield-check" />
        <div>
          <strong>Katalog bankowy pozostaje niezmieniony.</strong>
          <p>Zmiany obowiązują wyłącznie w tej organizacji. Każdy zapis tworzy wersję audytową z użytkownikiem i czasem zmiany.</p>
        </div>
      </section>

      <div class="admin-layout">
        <aside class="product-list">
          <div class="product-list__header"><span>Produkty</span><UBadge color="neutral" variant="outline">{{ data.products.length }}</UBadge></div>
          <button
            v-for="product in data.products"
            :key="product.id"
            type="button"
            :class="['product-item', { active: product.id === selectedId }]"
            @click="selectedId = product.id"
          >
            <span>{{ product.bank.name }}</span>
            <strong>{{ product.name }}</strong>
            <small>
              <UBadge v-if="!product.isEnabled" color="warning" variant="subtle">wyłączony</UBadge>
              <UBadge v-else-if="product.override" color="primary" variant="subtle">{{ Object.keys(product.override.parameters).length }} zmian</UBadge>
              <UBadge v-else color="neutral" variant="subtle">źródłowy</UBadge>
            </small>
          </button>
        </aside>

        <main v-if="selected" class="editor">
          <form @submit.prevent="save">
            <UCard>
              <template #header><div class="card-head"><div><p>{{ selected.bank.name }}</p><h2>{{ selected.baseName }}</h2></div><UBadge v-if="selected.override" color="primary" variant="outline">rewizja {{ selected.override.revision }}</UBadge></div></template>
              <div class="form-grid">
                <UFormField label="Widoczny w porównywarce" description="Wyłączenie ukrywa produkt tylko członkom tej organizacji."><USwitch v-model="form.is_enabled" /></UFormField>
                <UFormField label="Nazwa w organizacji" description="Puste pole zachowuje nazwę bankową."><UInput v-model="form.custom_name" :placeholder="selected.baseName" /></UFormField>
                <UFormField class="full" label="Notatka administratora"><UTextarea v-model="form.notes" :rows="2" placeholder="Powód zmiany, numer tabeli lub osoba zatwierdzająca" /></UFormField>
              </div>
            </UCard>

            <UAlert
              v-if="selectedUsesV2"
              color="info"
              variant="subtle"
              icon="i-lucide-badge-percent"
              title="Cennik V2 jest wersjonowany globalnie"
              description="Tutaj możesz zmienić widoczność i nazwę w organizacji. Stopy, warianty, koszty i dokumenty edytuj w nowym backoffice ofert, aby kalkulator oraz audyt używały tej samej definicji."
            >
              <template #actions><UButton :to="`/org/${organizationSlug}/mortgages/offers/${selected.id}`" size="sm">Otwórz definicję oferty</UButton></template>
            </UAlert>

            <template v-if="!selectedUsesV2">
            <UCard>
              <template #header><div class="card-head"><div><p>Warunki</p><h2>Oprocentowanie i okres</h2></div></div></template>
              <div class="form-grid form-grid--three">
                <UFormField label="Status danych"><USelect v-model="form.data_status" :items="statusItems" /></UFormField>
                <UFormField label="Kompletność (%)"><UInput v-model="form.completeness_score" type="number" min="0" max="100" /></UFormField>
                <UFormField label="Rodzaj oprocentowania"><USelect v-model="form.interest_type" :items="interestItems" /></UFormField>
                <UFormField label="Stopa stała (%)"><UInput v-model="form.fixed_rate_pct" type="number" step="0.00001" /></UFormField>
                <UFormField label="Okres stały (mies.)"><UInput v-model="form.fixed_period_months" type="number" min="1" /></UFormField>
                <UFormField label="Marża (%)"><UInput v-model="form.margin_pct" type="number" step="0.00001" /></UFormField>
                <UFormField label="Wskaźnik referencyjny"><UInput v-model="form.reference_rate_code" placeholder="WIBOR 3M / POLSTR" /></UFormField>
                <UFormField label="Stopa referencyjna (%)"><UInput v-model="form.reference_rate_pct" type="number" step="0.00001" /></UFormField>
                <UFormField label="Stopa na dzień"><UInput v-model="form.reference_rate_as_of" type="date" /></UFormField>
                <UFormField label="RRSO przykładu (%)"><UInput v-model="form.representative_apr_pct" type="number" step="0.00001" /></UFormField>
                <UFormField label="Data kalkulacji"><UInput v-model="form.calculation_date" type="date" /></UFormField>
                <UFormField label="Obowiązuje od"><UInput v-model="form.effective_from" type="date" /></UFormField>
                <UFormField label="Obowiązuje do"><UInput v-model="form.effective_to" type="date" /></UFormField>
              </div>
            </UCard>

            <UCard>
              <template #header><div class="card-head"><div><p>Kwalifikacja</p><h2>Kwota, okres i LTV</h2></div></div></template>
              <div class="form-grid form-grid--three">
                <UFormField label="Kwota minimalna (zł)"><UInput v-model="form.min_amount" type="number" min="0" /></UFormField>
                <UFormField label="Kwota maksymalna (zł)"><UInput v-model="form.max_amount" type="number" min="0" /></UFormField>
                <UFormField label="Maksymalne LTV (%)"><UInput v-model="form.max_ltv_pct" type="number" min="0" step="0.01" /></UFormField>
                <UFormField label="Minimalny okres (mies.)"><UInput v-model="form.min_term_months" type="number" min="1" /></UFormField>
                <UFormField label="Maksymalny okres (mies.)"><UInput v-model="form.max_term_months" type="number" min="1" /></UFormField>
                <UFormField label="Produkt ekologiczny"><USwitch v-model="form.is_eco" /></UFormField>
              </div>
            </UCard>

            <UCard>
              <template #header><div class="card-head"><div><p>Koszty</p><h2>Opłaty i ubezpieczenia</h2></div><small>Puste pole oznacza koszt nieznany</small></div></template>
              <div class="form-grid form-grid--three">
                <UFormField v-for="costItem in costKeys" :key="costItem[0]" :label="costItem[1]"><UInput v-model="form.cost_rules[costItem[0]]" type="number" min="0" step="0.00001" /></UFormField>
              </div>
            </UCard>

            <UCard>
              <template #header>
                <div class="card-head">
                  <div>
                    <p>Dokumenty procesu</p>
                    <h2>Checklista dokumentów i czynności</h2>
                  </div>
                  <UButton type="button" icon="i-lucide-plus" variant="outline" @click="addDocumentRequirement">
                    Dodaj pozycję
                  </UButton>
                </div>
              </template>

              <section class="template-manager">
                <div class="section-subhead">
                  <div>
                    <h3>Szablony MultiForm</h3>
                    <p>Lista szablonów dostępnych dla dokumentów bankowych tego produktu.</p>
                  </div>
                  <UButton type="button" icon="i-lucide-plus" size="sm" color="neutral" variant="outline" @click="addMultiformTemplateId">
                    Dodaj szablon
                  </UButton>
                </div>
                <div v-if="form.multiform_template_ids.length" class="template-id-list">
                  <div v-for="(_templateId, index) in form.multiform_template_ids" :key="`template-${index}`" class="template-id-row">
                    <UInput v-model="form.multiform_template_ids[index]" placeholder="np. pko-bp-mortgage-2022" />
                    <UButton
                      type="button"
                      icon="i-lucide-trash-2"
                      color="error"
                      variant="ghost"
                      square
                      :aria-label="`Usuń szablon ${Number(index) + 1}`"
                      @click="removeMultiformTemplateId(Number(index))"
                    />
                  </div>
                </div>
                <p v-else class="empty-checklist">Ten produkt nie ma przypisanego szablonu MultiForm.</p>
              </section>

              <div v-if="form.document_requirements.length" class="requirement-list">
                <article
                  v-for="(requirement, index) in form.document_requirements"
                  :key="`requirement-${index}`"
                  class="requirement-editor"
                >
                  <header>
                    <div>
                      <span>Pozycja {{ Number(index) + 1 }}</span>
                      <strong>{{ requirement.label || 'Nowa pozycja checklisty' }}</strong>
                    </div>
                    <div class="requirement-editor__actions">
                      <UBadge :color="requirement.required ? 'error' : 'neutral'" variant="subtle">
                        {{ requirement.required ? 'wymagane' : 'niewymagane' }}
                      </UBadge>
                      <UButton
                        type="button"
                        icon="i-lucide-trash-2"
                        color="error"
                        variant="ghost"
                        square
                        :aria-label="`Usuń pozycję ${Number(index) + 1}`"
                        @click="removeDocumentRequirement(Number(index))"
                      />
                    </div>
                  </header>

                  <div class="requirement-grid">
                    <UFormField label="Kod" description="Stały identyfikator bez spacji.">
                      <UInput v-model="requirement.code" placeholder="np. identity_document" />
                    </UFormField>
                    <UFormField label="Etykieta">
                      <UInput v-model="requirement.label" placeholder="Nazwa widoczna ekspertowi" />
                    </UFormField>
                    <UFormField label="Kategoria">
                      <USelect v-model="requirement.category" :items="categoryItems" />
                    </UFormField>
                    <UFormField label="Rodzaj pozycji">
                      <USelect
                        :model-value="requirement.itemKind"
                        :items="itemKindItems"
                        @update:model-value="updateRequirementItemKind(requirement, $event)"
                      />
                    </UFormField>
                    <UFormField label="Zakres">
                      <USelect v-model="requirement.scope" :items="scopeItems" />
                    </UFormField>
                    <UFormField label="Etap">
                      <USelect v-model="requirement.stage" :items="stageItems" />
                    </UFormField>
                    <UFormField label="Wymagalność">
                      <USelect v-model="requirement.applicability" :items="applicabilityItems" />
                    </UFormField>
                    <UFormField label="Źródło informacji">
                      <USelect v-model="requirement.evidence" :items="evidenceItems" />
                    </UFormField>
                    <UFormField label="Dozwolone formaty">
                      <USelect v-model="requirement.allowedMimeTypes" :items="mimeTypeItems" multiple />
                    </UFormField>
                    <UFormField v-if="requirement.itemKind === 'bank_document'" label="Szablon MultiForm">
                      <USelect v-model="requirement.templateId" :items="templateIdItems" placeholder="Bez szablonu" />
                    </UFormField>
                    <div class="requirement-toggles">
                      <UFormField label="Pozycja wymagana">
                        <USwitch v-model="requirement.required" />
                      </UFormField>
                      <UFormField label="Wiele plików">
                        <USwitch v-model="requirement.multiple" />
                      </UFormField>
                    </div>
                    <UFormField class="full" label="Notatka">
                      <UTextarea v-model="requirement.notes" :rows="2" placeholder="Doprecyzowanie warunku lub zakresu dokumentów" />
                    </UFormField>
                  </div>
                </article>
              </div>
              <div v-else class="empty-checklist">
                Brak pozycji. Dodaj dokument, kontrolę zewnętrzną lub czynność ręczną wymaganą przez produkt.
              </div>
            </UCard>

            <UCard>
              <template #header><div class="card-head"><div><p>Opis</p><h2>Wymagania, założenia i braki</h2></div><small>Jedna pozycja w każdym wierszu</small></div></template>
              <div class="form-grid">
                <UFormField label="Wymagania"><UTextarea v-model="form.requirementsText" :rows="7" /></UFormField>
                <UFormField label="Założenia kalkulacji"><UTextarea v-model="form.assumptionsText" :rows="7" /></UFormField>
                <UFormField class="full" label="Nieznane pola"><UTextarea v-model="form.unknownFieldsText" :rows="5" /></UFormField>
                <UFormField class="full" label="Przykład reprezentatywny (JSON)" description="Dane publikowane przez bank, nie scenariusz użytkownika."><UTextarea v-model="form.representativeExampleText" :rows="10" class="json-input" /></UFormField>
              </div>
            </UCard>
            </template>

            <div class="sticky-actions">
              <div><strong>{{ overriddenFields.length }}</strong> zapisanych nadpisań<span v-if="selected.override"> · aktualizacja {{ formatDateTime(selected.override.updated_at) }}</span></div>
              <button v-if="resetArmed" type="button" class="reset-button reset-button--cancel" @click="resetArmed = false">Anuluj</button>
              <button v-if="selected.override && !resetArmed" type="button" class="reset-button" @click="resetArmed = true"><UIcon name="i-lucide-rotate-ccw" /> Przywróć źródło</button>
              <button v-else-if="selected.override" type="button" class="reset-button reset-button--confirm" :disabled="resetting" @click="performReset"><UIcon name="i-lucide-rotate-ccw" /> {{ resetting ? 'Przywracanie…' : 'Potwierdź przywrócenie' }}</button>
              <UButton type="submit" icon="i-lucide-save" :loading="saving">{{ selectedUsesV2 ? 'Zapisz ustawienia organizacji' : 'Zapisz parametry' }}</UButton>
            </div>
          </form>

          <UCard class="history-card">
            <template #header><div class="card-head"><div><p>Audyt</p><h2>Historia zmian</h2></div><UButton aria-label="Odśwież historię" icon="i-lucide-refresh-cw" variant="ghost" :loading="historyPending" @click="loadHistory" /></div></template>
            <div v-if="!history.length" class="empty-history">Nie zapisano jeszcze zmian dla tego produktu.</div>
            <ol v-else class="history-list">
              <li v-for="entry in history" :key="entry.id"><span class="history-dot" /><div><strong>{{ actionLabel(entry.action) }} · rewizja {{ entry.revision }}</strong><p>{{ entry.actor?.full_name || entry.actor?.email || entry.changed_by }}</p><small>{{ formatDateTime(entry.created_at) }} · {{ Object.keys(entry.parameters).length }} pól</small></div></li>
            </ol>
          </UCard>
        </main>
      </div>
    </template>
  </CrmShell>
</template>

<style scoped>
.admin-notice { display: flex; gap: 14px; padding: 18px 20px; margin-bottom: 20px; border: 1px solid var(--ui-border); border-radius: 14px; background: var(--ui-bg); }
.admin-notice svg { flex: 0 0 auto; width: 22px; height: 22px; color: var(--ui-primary); }
.admin-notice p { margin: 4px 0 0; color: var(--ui-text-muted); font-size: 14px; }
.admin-layout { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 20px; align-items: start; }
.product-list { position: sticky; top: 20px; display: grid; gap: 6px; padding: 10px; border: 1px solid var(--ui-border); border-radius: 14px; background: var(--ui-bg); }
.product-list__header { display: flex; align-items: center; justify-content: space-between; padding: 8px 8px 12px; color: var(--ui-text-muted); font-size: 12px; font-weight: 700; text-transform: uppercase; }
.product-item { display: grid; gap: 4px; width: 100%; padding: 12px; border: 1px solid transparent; border-radius: 10px; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.product-item:hover, .product-item.active { border-color: var(--ui-border-accented); background: var(--ui-bg-muted); }
.product-item.active { box-shadow: inset 3px 0 0 var(--ui-primary); }
.product-item > span { color: var(--ui-text-muted); font-size: 11px; text-transform: uppercase; }
.product-item > strong { font-size: 13px; line-height: 1.35; }
.editor form, .editor { display: grid; gap: 16px; min-width: 0; }
.card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.card-head p { margin: 0 0 3px; color: var(--ui-text-muted); font-family: var(--font-mono); font-size: 10px; font-weight: 700; text-transform: uppercase; }
.card-head h2 { margin: 0; font-size: 19px; }
.card-head small { color: var(--ui-text-muted); }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.form-grid--three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.form-grid :deep(input), .form-grid :deep(textarea), .form-grid :deep(button[role='combobox']) { width: 100%; }
.full { grid-column: 1 / -1; }
.json-input :deep(textarea) { font-family: var(--font-mono); font-size: 12px; }
.template-manager { display: grid; gap: 12px; padding-bottom: 18px; border-bottom: 1px solid var(--ui-border); }
.section-subhead { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.section-subhead h3 { margin: 0; color: var(--ui-text-highlighted); font-size: 14px; }
.section-subhead p { margin: 3px 0 0; color: var(--ui-text-muted); font-size: 12px; }
.template-id-list { display: grid; gap: 8px; }
.template-id-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
.requirement-list { display: grid; gap: 14px; margin-top: 18px; }
.requirement-editor { overflow: hidden; border: 1px solid var(--ui-border); border-radius: 12px; background: var(--ui-bg-elevated); }
.requirement-editor > header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border-bottom: 1px solid var(--ui-border); background: var(--ui-bg-muted); }
.requirement-editor > header > div:first-child { display: grid; gap: 2px; min-width: 0; }
.requirement-editor > header span { color: var(--ui-text-muted); font-size: 10px; font-weight: 700; text-transform: uppercase; }
.requirement-editor > header strong { overflow: hidden; color: var(--ui-text-highlighted); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.requirement-editor__actions { display: flex; align-items: center; gap: 6px; }
.requirement-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; padding: 16px; }
.requirement-grid :deep(input), .requirement-grid :deep(textarea), .requirement-grid :deep(button[role='combobox']) { width: 100%; }
.requirement-toggles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; align-items: end; }
.empty-checklist { margin: 0; padding: 14px; border: 1px dashed var(--ui-border); border-radius: 10px; color: var(--ui-text-muted); font-size: 12px; text-align: center; }
.sticky-actions { position: sticky; bottom: 12px; z-index: 5; display: flex; align-items: center; justify-content: flex-end; gap: 10px; padding: 12px 14px; border: 1px solid var(--ui-border-accented); border-radius: 14px; background: color-mix(in srgb, var(--ui-bg) 94%, transparent); box-shadow: 0 12px 30px rgb(0 0 0 / 9%); backdrop-filter: blur(14px); }
.sticky-actions > div { margin-right: auto; color: var(--ui-text-muted); font-size: 13px; }
.reset-button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 34px; padding: 0 12px; border: 0; border-radius: var(--ui-radius); background: transparent; color: var(--ui-error); font-size: 14px; font-weight: 600; cursor: pointer; }
.reset-button:hover { background: color-mix(in srgb, var(--ui-error) 10%, transparent); }
.reset-button--cancel { color: var(--ui-text-muted); }
.reset-button--confirm { background: var(--ui-error); color: white; }
.reset-button--confirm:hover { background: color-mix(in srgb, var(--ui-error) 88%, black); }
.reset-button:disabled { cursor: wait; opacity: .65; }
.history-card { margin-top: 4px; }
.empty-history { padding: 12px 0; color: var(--ui-text-muted); }
.history-list { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; }
.history-list li { position: relative; display: flex; gap: 12px; padding: 0 0 18px; }
.history-list li:not(:last-child)::before { position: absolute; top: 10px; bottom: 0; left: 4px; width: 1px; background: var(--ui-border); content: ''; }
.history-dot { z-index: 1; flex: 0 0 auto; width: 9px; height: 9px; margin-top: 5px; border-radius: 999px; background: var(--ui-primary); }
.history-list p { margin: 2px 0; color: var(--ui-text-muted); font-size: 13px; }
.history-list small { color: var(--ui-text-dimmed); }
@media (max-width: 1050px) { .admin-layout { grid-template-columns: 1fr; } .product-list { position: static; grid-template-columns: repeat(2, minmax(0, 1fr)); } .product-list__header { grid-column: 1 / -1; } .form-grid--three { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 640px) { .product-list, .form-grid, .form-grid--three, .requirement-grid { grid-template-columns: 1fr; } .section-subhead { align-items: stretch; flex-direction: column; } .sticky-actions { align-items: stretch; flex-direction: column; } .sticky-actions > div { margin-right: 0; } }
</style>
