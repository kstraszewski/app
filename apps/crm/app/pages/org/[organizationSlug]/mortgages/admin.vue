<script setup lang="ts">
definePageMeta({ middleware: ['auth', 'organization'] })
useHead({ title: 'Parametry hipotek — OpenExpert' })

type JsonRecord = Record<string, any>
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
type Payload = { products: Product[], role: 'admin' | 'expert', retrievedAt: string | null }
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
  { default: () => ({ products: [], role: 'expert' as const, retrievedAt: null }) },
)

const selectedId = ref('')
const saving = ref(false)
const resetting = ref(false)
const resetArmed = ref(false)
const historyPending = ref(false)
const history = ref<HistoryEntry[]>([])
const selected = computed(() => data.value.products.find(product => product.id === selectedId.value) ?? null)
const isAdmin = computed(() => data.value.role === 'admin')
const overriddenFields = computed(() => Object.keys(selected.value?.override?.parameters ?? {}))

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
  'representative_example', 'assumptions', 'unknown_fields',
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
  if (Array.isArray(value)) return JSON.stringify(value)
  if (value && typeof value === 'object') {
    const object = value as JsonRecord
    return JSON.stringify(Object.keys(object).sort().reduce<JsonRecord>((result, key) => {
      result[key] = object[key] === undefined ? null : object[key]
      return result
    }, {}))
  }
  return JSON.stringify(value ?? null)
}

function normalizedCostRules(value: unknown): JsonRecord {
  const source = value && typeof value === 'object' ? value as JsonRecord : {}
  return Object.fromEntries(costKeys.map(([key]) => [key, nullableNumber(source[key])]))
}

function loadForm(product: Product) {
  const version = product.version
  form.is_enabled = product.override?.is_enabled ?? true
  form.custom_name = product.override?.custom_name ?? ''
  form.notes = product.override?.notes ?? ''
  for (const key of editableKeys) form[key] = clone(version[key] ?? null)
  form.cost_rules = normalizedCostRules(version.cost_rules)
  form.requirementsText = listText(version.requirements)
  form.assumptionsText = listText(version.assumptions)
  form.unknownFieldsText = listText(version.unknown_fields)
  form.representativeExampleText = JSON.stringify(version.representative_example ?? {}, null, 2)
}

function currentParameters(): JsonRecord {
  const product = selected.value
  if (!product) return {}
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
  current.assumptions = lines(form.assumptionsText)
  current.unknown_fields = lines(form.unknownFieldsText)
  current.representative_example = representativeExample

  const parameters: JsonRecord = {}
  for (const key of editableKeys) {
    let baseValue = product.baseVersion[key]
    if (numericKeys.has(key)) baseValue = nullableNumber(baseValue)
    if (key === 'cost_rules') baseValue = normalizedCostRules(baseValue)
    if (canonical(current[key]) !== canonical(baseValue)) parameters[key] = current[key]
  }
  return parameters
}

async function loadHistory() {
  if (import.meta.server || !selectedId.value || !isAdmin.value) return
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
</script>

<template>
  <CrmShell title="Parametry hipotek" eyebrow="Panel administratora · nadpisania organizacji">
    <template #actions>
      <UButton :to="`/org/${organizationSlug}/mortgages`" icon="i-lucide-arrow-left" variant="outline">Porównywarka</UButton>
    </template>

    <UAlert v-if="error" color="error" variant="subtle" title="Nie udało się pobrać katalogu" />
    <UAlert
      v-else-if="!pending && !isAdmin"
      color="warning"
      variant="subtle"
      icon="i-lucide-shield-alert"
      title="Panel tylko dla administratora organizacji"
      description="Możesz korzystać z porównywarki, ale edycja parametrów wymaga roli administratora."
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
              <template #header><div class="card-head"><div><p>Opis</p><h2>Wymagania, założenia i braki</h2></div><small>Jedna pozycja w każdym wierszu</small></div></template>
              <div class="form-grid">
                <UFormField label="Wymagania"><UTextarea v-model="form.requirementsText" :rows="7" /></UFormField>
                <UFormField label="Założenia kalkulacji"><UTextarea v-model="form.assumptionsText" :rows="7" /></UFormField>
                <UFormField class="full" label="Nieznane pola"><UTextarea v-model="form.unknownFieldsText" :rows="5" /></UFormField>
                <UFormField class="full" label="Przykład reprezentatywny (JSON)" description="Dane publikowane przez bank, nie scenariusz użytkownika."><UTextarea v-model="form.representativeExampleText" :rows="10" class="json-input" /></UFormField>
              </div>
            </UCard>

            <div class="sticky-actions">
              <div><strong>{{ overriddenFields.length }}</strong> zapisanych nadpisań<span v-if="selected.override"> · aktualizacja {{ formatDateTime(selected.override.updated_at) }}</span></div>
              <button v-if="resetArmed" type="button" class="reset-button reset-button--cancel" @click="resetArmed = false">Anuluj</button>
              <button v-if="selected.override && !resetArmed" type="button" class="reset-button" @click="resetArmed = true"><UIcon name="i-lucide-rotate-ccw" /> Przywróć źródło</button>
              <button v-else-if="selected.override" type="button" class="reset-button reset-button--confirm" :disabled="resetting" @click="performReset"><UIcon name="i-lucide-rotate-ccw" /> {{ resetting ? 'Przywracanie…' : 'Potwierdź przywrócenie' }}</button>
              <UButton type="submit" icon="i-lucide-save" :loading="saving">Zapisz parametry</UButton>
            </div>
          </form>

          <UCard class="history-card">
            <template #header><div class="card-head"><div><p>Audyt</p><h2>Historia zmian</h2></div><UButton icon="i-lucide-refresh-cw" variant="ghost" :loading="historyPending" @click="loadHistory" /></div></template>
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
@media (max-width: 640px) { .product-list, .form-grid, .form-grid--three { grid-template-columns: 1fr; } .sticky-actions { align-items: stretch; flex-direction: column; } .sticky-actions > div { margin-right: 0; } }
</style>
