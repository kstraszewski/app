<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui'
import type {
  CaseFilterOption,
  CaseFiltersResponse,
  CaseListResponse,
  CreateCaseResponse,
} from '~/types/cases'

definePageMeta({ middleware: ['auth', 'organization'] })
useHead({ title: 'Sprawy — OpenExpert CRM' })

interface CaseCreateForm {
  title: string
  client_ids: string[]
}

interface ActiveFilterChip {
  key: 'search' | 'clients' | 'banks' | 'offers' | 'updatedFrom' | 'updatedTo'
  label: string
}

const route = useRoute()
const router = useRouter()
const { organizationSlug, crmApiPath, orgPath } = useOrganizationContext()
const toast = useToast()
const requestFetch = useRequestFetch()

function queryText(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function queryList(value: unknown) {
  const raw = Array.isArray(value) ? value.join(',') : queryText(value)
  return [...new Set(raw.split(',').map(item => item.trim()).filter(Boolean))]
}

const searchInput = ref(queryText(route.query.q))
const search = ref(searchInput.value.trim())
const clientFilter = ref<string[]>(queryList(route.query.clients))
const bankFilter = ref<string[]>(queryList(route.query.banks))
const offerMode = ref(queryText(route.query.offers) || 'all')
const updatedFrom = ref(queryText(route.query.updated_from))
const updatedTo = ref(queryText(route.query.updated_to))
const sortValue = ref(queryText(route.query.sort) || (search.value ? 'relevance' : 'updated_desc'))
const page = ref(Math.max(1, Number(route.query.page) || 1))
const pageSize = ref(25)
const advancedFiltersOpen = ref(Boolean(updatedFrom.value || updatedTo.value))
const createOpen = ref(false)
const saving = ref(false)
const form = reactive<CaseCreateForm>({ title: '', client_ids: [] })

let searchDebounce: ReturnType<typeof setTimeout> | undefined
watch(searchInput, (value) => {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => {
    search.value = value.trim()
  }, 300)
})
onBeforeUnmount(() => {
  if (searchDebounce) clearTimeout(searchDebounce)
})

watch(search, (value, previous) => {
  if (value && !previous) sortValue.value = 'relevance'
  if (!value && sortValue.value === 'relevance') sortValue.value = 'updated_desc'
})

const emptyFilters = (): CaseFiltersResponse => ({
  clients: [],
  banks: [],
  offer_counts: { with: 0, without: 0 },
  date_bounds: null,
})
const emptyCases = (): CaseListResponse => ({ data: [], count: 0 })

const {
  data: filterConfiguration,
  pending: filtersPending,
  error: filtersError,
  refresh: refreshFilters,
} = await useAsyncData<CaseFiltersResponse>(
  `crm-cases-filters:${organizationSlug.value}`,
  () => requestFetch<CaseFiltersResponse>(crmApiPath('/cases/filters')),
  { default: emptyFilters, watch: [organizationSlug] },
)

const clientItems = computed(() => filterConfiguration.value.clients.map(client => ({
  label: client.display_name,
  description: client.primary_email || client.primary_phone || 'Brak danych kontaktowych',
  value: client.id,
})))
const bankItems = computed(() => filterConfiguration.value.banks.map(bank => ({
  label: bank.count === undefined ? bank.label : `${bank.label} (${bank.count})`,
  value: bank.value,
})))
const clientById = computed(() => new Map(
  filterConfiguration.value.clients.map(client => [client.id, client]),
))
const bankById = computed(() => new Map(
  filterConfiguration.value.banks.map(bank => [bank.value, bank]),
))

const offerItems = computed(() => [
  { label: 'Wszystkie sprawy', value: 'all' },
  { label: `Z zapisanymi ofertami (${filterConfiguration.value.offer_counts.with})`, value: 'with' },
  { label: `Bez zapisanych ofert (${filterConfiguration.value.offer_counts.without})`, value: 'without' },
])
const sortItems = computed(() => [
  ...(search.value ? [{ label: 'Najlepsze dopasowanie', value: 'relevance' }] : []),
  { label: 'Ostatnio zmienione', value: 'updated_desc' },
  { label: 'Najdawniej zmienione', value: 'updated_asc' },
  { label: 'Najnowsze', value: 'created_desc' },
  { label: 'Nazwa A–Z', value: 'title_asc' },
  { label: 'Nazwa Z–A', value: 'title_desc' },
  { label: 'Najwięcej ofert', value: 'offers_desc' },
])

function localDateBoundary(value: string, endOfDay = false) {
  if (!value) return undefined
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return undefined
  const date = new Date(
    year,
    month - 1,
    day,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  )
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

const casesQuery = computed(() => ({
  q: search.value || undefined,
  client_ids: clientFilter.value.length ? clientFilter.value.join(',') : undefined,
  bank_ids: bankFilter.value.length ? bankFilter.value.join(',') : undefined,
  offer_mode: offerMode.value === 'all' ? undefined : offerMode.value,
  updated_from: localDateBoundary(updatedFrom.value),
  updated_to: localDateBoundary(updatedTo.value, true),
  sort: sortValue.value,
  offset: (page.value - 1) * pageSize.value,
  limit: pageSize.value,
}))

const {
  data: cases,
  pending: casesPending,
  error: casesError,
  refresh: refreshCases,
} = await useAsyncData<CaseListResponse>(
  `crm-cases-list:${organizationSlug.value}`,
  () => requestFetch<CaseListResponse>(crmApiPath('/cases'), { query: casesQuery.value }),
  { default: emptyCases, watch: [organizationSlug, casesQuery] },
)

watch([
  search,
  clientFilter,
  bankFilter,
  offerMode,
  updatedFrom,
  updatedTo,
  sortValue,
  pageSize,
], () => { page.value = 1 }, { deep: true })

const totalCases = computed(() => Math.max(0, Number(cases.value.count) || 0))
const totalPages = computed(() => Math.max(1, Math.ceil(totalCases.value / pageSize.value)))

function requestErrorMessage(error: unknown) {
  const candidate = error as {
    data?: { statusMessage?: string, message?: string }
    statusMessage?: string
    message?: string
  } | null
  return candidate?.data?.statusMessage
    ?? candidate?.data?.message
    ?? candidate?.statusMessage
    ?? candidate?.message
}

const loadErrorDescription = computed(() => {
  const failures = [
    casesError.value ? `Lista spraw: ${requestErrorMessage(casesError.value) ?? 'nieznany błąd'}.` : '',
    filtersError.value ? `Filtry: ${requestErrorMessage(filtersError.value) ?? 'nieznany błąd'}.` : '',
  ].filter(Boolean)

  return failures.join(' ') || 'Odśwież widok i spróbuj ponownie.'
})

watch(totalPages, value => {
  if (page.value > value) page.value = value
})

const routeQuery = computed(() => ({
  ...(search.value ? { q: search.value } : {}),
  ...(clientFilter.value.length ? { clients: clientFilter.value.join(',') } : {}),
  ...(bankFilter.value.length ? { banks: bankFilter.value.join(',') } : {}),
  ...(offerMode.value !== 'all' ? { offers: offerMode.value } : {}),
  ...(updatedFrom.value ? { updated_from: updatedFrom.value } : {}),
  ...(updatedTo.value ? { updated_to: updatedTo.value } : {}),
  ...(sortValue.value !== (search.value ? 'relevance' : 'updated_desc') ? { sort: sortValue.value } : {}),
  ...(page.value > 1 ? { page: String(page.value) } : {}),
}))
watch(routeQuery, value => {
  void router.replace({ query: value })
}, { deep: true })

const hasActiveFilters = computed(() => Boolean(
  search.value
  || clientFilter.value.length
  || bankFilter.value.length
  || offerMode.value !== 'all'
  || updatedFrom.value
  || updatedTo.value,
))

const activeFilterChips = computed<ActiveFilterChip[]>(() => {
  const chips: ActiveFilterChip[] = []
  if (search.value) chips.push({ key: 'search', label: `Szukasz: „${search.value}”` })
  if (clientFilter.value.length) {
    const names = clientFilter.value.map(id => clientById.value.get(id)?.display_name ?? 'Klient')
    chips.push({ key: 'clients', label: names.length === 1 ? names[0]! : `Klienci: ${names.length}` })
  }
  if (bankFilter.value.length) {
    const names = bankFilter.value.map(id => bankById.value.get(id)?.label ?? 'Bank')
    chips.push({ key: 'banks', label: names.length === 1 ? names[0]! : `Banki: ${names.length}` })
  }
  if (offerMode.value !== 'all') {
    chips.push({ key: 'offers', label: offerMode.value === 'with' ? 'Z ofertami' : 'Bez ofert' })
  }
  if (updatedFrom.value) chips.push({ key: 'updatedFrom', label: `Zmienione od ${updatedFrom.value}` })
  if (updatedTo.value) chips.push({ key: 'updatedTo', label: `Zmienione do ${updatedTo.value}` })
  return chips
})

function removeFilter(key: ActiveFilterChip['key']) {
  if (key === 'search') {
    searchInput.value = ''
    search.value = ''
  } else if (key === 'clients') clientFilter.value = []
  else if (key === 'banks') bankFilter.value = []
  else if (key === 'offers') offerMode.value = 'all'
  else if (key === 'updatedFrom') updatedFrom.value = ''
  else if (key === 'updatedTo') updatedTo.value = ''
}

function resetFilters() {
  searchInput.value = ''
  search.value = ''
  clientFilter.value = []
  bankFilter.value = []
  offerMode.value = 'all'
  updatedFrom.value = ''
  updatedTo.value = ''
  sortValue.value = 'updated_desc'
  advancedFiltersOpen.value = false
}

function clearSearch() {
  searchInput.value = ''
  search.value = ''
}

function toggleAdvancedFilters() {
  advancedFiltersOpen.value = !advancedFiltersOpen.value
}

async function refreshView() {
  await Promise.all([refreshCases(), refreshFilters()])
}

function validateCaseForm(state: Partial<CaseCreateForm>): FormError[] {
  const errors: FormError[] = []
  if (!state.title?.trim()) errors.push({ name: 'title', message: 'Podaj nazwę sprawy.' })
  if ((state.title?.trim().length ?? 0) > 200) {
    errors.push({ name: 'title', message: 'Nazwa może mieć maksymalnie 200 znaków.' })
  }
  if (!state.client_ids?.length) {
    errors.push({ name: 'client_ids', message: 'Wybierz co najmniej jednego klienta.' })
  }
  return errors
}

function openCreateForm() {
  createOpen.value = true
}

function resetCreateForm() {
  form.title = ''
  form.client_ids = []
}

async function createCase(_event: FormSubmitEvent<CaseCreateForm>) {
  saving.value = true
  try {
    const response = await $fetch<CreateCaseResponse>(crmApiPath('/cases'), {
      method: 'POST',
      body: { title: form.title.trim(), client_ids: form.client_ids },
    })
    createOpen.value = false
    resetCreateForm()
    toast.add({
      title: 'Utworzono sprawę',
      description: 'Możesz teraz zapisać w niej wybrane oferty.',
      color: 'success',
    })
    await navigateTo(orgPath(`/cases/${response.data.id}`))
  } catch (caught: any) {
    toast.add({
      title: 'Nie udało się utworzyć sprawy',
      description: caught?.data?.statusMessage ?? caught?.message ?? 'Sprawdź dane formularza.',
      color: 'error',
    })
  } finally {
    saving.value = false
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' }).format(new Date(value))
}

function caseBanks(item: CaseListResponse['data'][number]) {
  const names = [...new Set(item.banks.map(bank => bank.name).filter(Boolean))]
  if (!names.length) return 'Brak zapisanych ofert'
  return names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2}` : '')
}
</script>

<template>
  <CrmShell
    title="Sprawy"
    eyebrow="Obsługa klientów"
    description="Rejestr procesów klientów, zapisanych ofert i dokumentów prowadzonych przez zespół."
  >
    <template #actions>
      <UButton icon="i-lucide-plus" @click="openCreateForm">
        Nowa sprawa
      </UButton>
      <UButton
        color="neutral"
        variant="outline"
        square
        icon="i-lucide-refresh-cw"
        :loading="casesPending || filtersPending"
        aria-label="Odśwież sprawy"
        title="Odśwież"
        @click="refreshView"
      />
    </template>

    <UAlert
      v-if="casesError || filtersError"
      class="cases-alert"
      color="error"
      variant="subtle"
      title="Nie udało się pobrać spraw"
      :description="loadErrorDescription"
    >
      <template #actions>
        <UButton color="error" variant="soft" size="sm" @click="refreshView">
          Odśwież
        </UButton>
      </template>
    </UAlert>

    <section class="cases-register" aria-label="Rejestr spraw">
      <section class="filters" aria-label="Filtry listy spraw">
        <div class="filters-main">
          <UInput
            v-model="searchInput"
            class="search-input"
            icon="i-lucide-search"
            placeholder="Sprawa, klient, osoba, telefon, PESEL, produkt lub adres"
            aria-label="Przeszukaj sprawy"
            data-testid="cases-search"
          >
            <template v-if="searchInput" #trailing>
              <UButton
                icon="i-lucide-x"
                color="neutral"
                variant="link"
                size="xs"
                aria-label="Wyczyść wyszukiwanie"
                @click="clearSearch"
              />
            </template>
          </UInput>

          <USelectMenu
            v-model="clientFilter"
            class="filter-select"
            :items="clientItems"
            value-key="value"
            label-key="label"
            multiple
            clear
            placeholder="Klienci"
            aria-label="Filtruj po klientach"
            :loading="filtersPending"
          />
          <USelectMenu
            v-model="bankFilter"
            class="filter-select"
            :items="bankItems"
            value-key="value"
            label-key="label"
            multiple
            clear
            placeholder="Banki"
            aria-label="Filtruj po bankach"
            :loading="filtersPending"
          />
          <USelect v-model="offerMode" class="filter-select filter-select--offers" :items="offerItems" value-key="value" aria-label="Filtruj po zapisanych ofertach" />
          <USelect v-model="sortValue" class="filter-select filter-select--sort" :items="sortItems" value-key="value" aria-label="Sortuj sprawy" />
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-sliders-horizontal"
            :aria-expanded="advancedFiltersOpen"
            @click="toggleAdvancedFilters"
          >
            Daty
          </UButton>
          <span class="cases-count" aria-live="polite">
            {{ totalCases }} {{ totalCases === 1 ? 'sprawa' : 'spraw' }}
          </span>
        </div>

        <div v-if="advancedFiltersOpen" class="filters-advanced">
          <UFormField label="Zmienione od">
            <UInput v-model="updatedFrom" type="date" />
          </UFormField>
          <UFormField label="Zmienione do">
            <UInput v-model="updatedTo" type="date" />
          </UFormField>
        </div>

        <div v-if="activeFilterChips.length" class="active-filters" aria-label="Aktywne filtry spraw">
          <UButton
            v-for="chip in activeFilterChips"
            :key="chip.key"
            color="neutral"
            variant="soft"
            size="xs"
            trailing-icon="i-lucide-x"
            @click="removeFilter(chip.key)"
          >
            {{ chip.label }}
          </UButton>
          <UButton color="neutral" variant="link" size="xs" @click="resetFilters">
            Wyczyść wszystko
          </UButton>
        </div>
      </section>

      <div v-if="casesPending" class="case-skeletons">
        <USkeleton v-for="index in 7" :key="index" class="h-18 w-full" />
      </div>

      <div v-else-if="cases.data.length" class="case-results" data-testid="cases-results">
        <div class="case-table-head" aria-hidden="true">
          <span>Sprawa</span>
          <span>Klienci</span>
          <span>Zapisane oferty</span>
          <span />
        </div>
        <div class="case-list">
          <NuxtLink
            v-for="item in cases.data"
            :key="item.id"
            :to="orgPath(`/cases/${item.id}`)"
            class="case-row"
            data-testid="case-row"
            :data-case-id="item.id"
          >
            <div class="case-title">
              <strong>{{ item.title }}</strong>
              <span>
                Zmieniono {{ formatDate(item.updated_at) }}
                <template v-if="search && item.match_context">
                  · Trafienie: {{ item.match_context.label }}
                </template>
              </span>
            </div>
            <div class="client-chips">
              <UBadge
                v-for="client in item.clients.slice(0, 3)"
                :key="client.id"
                color="neutral"
                variant="subtle"
              >
                {{ client.display_name }}
              </UBadge>
              <UBadge v-if="item.clients.length > 3" color="neutral" variant="outline">
                +{{ item.clients.length - 3 }}
              </UBadge>
            </div>
            <div class="offer-summary">
              <span class="offer-count"><UIcon name="i-lucide-bookmark-check" />{{ item.offer_count }}</span>
              <small>{{ caseBanks(item) }}</small>
            </div>
            <UIcon class="row-arrow" name="i-lucide-chevron-right" />
          </NuxtLink>
        </div>
      </div>

      <OeEmptyState
        v-else
        :kind="hasActiveFilters ? 'filtered' : 'empty'"
        :icon="hasActiveFilters ? 'i-lucide-search-x' : 'i-lucide-folder-plus'"
        :title="hasActiveFilters ? 'Nie znaleźliśmy takich spraw' : 'Utwórz pierwszą sprawę'"
        :description="hasActiveFilters
          ? 'Zmień wyszukiwanie albo usuń część filtrów.'
          : 'Nazwij sprawę, przypisz klientów i zapisuj w niej wybrane oferty.'"
        surface="outline"
      >
        <template #actions>
          <UButton v-if="hasActiveFilters" color="neutral" variant="outline" @click="resetFilters">
            Wyczyść filtry
          </UButton>
          <UButton icon="i-lucide-plus" @click="openCreateForm">
            Nowa sprawa
          </UButton>
        </template>
      </OeEmptyState>

      <div v-if="totalCases > pageSize" class="pagination-row">
        <span>Strona {{ page }} z {{ totalPages }}</span>
        <UPagination
          v-model:page="page"
          :total="totalCases"
          :items-per-page="pageSize"
          :sibling-count="1"
          show-edges
        />
      </div>
    </section>

    <UModal
      v-model:open="createOpen"
      title="Nowa sprawa"
      description="Sprawa potrzebuje tylko nazwy i klientów. Oferty dodasz po utworzeniu."
      :dismissible="!saving"
      :ui="{ footer: 'justify-end' }"
      @after:leave="!saving && resetCreateForm()"
    >
      <template #body>
        <UForm
          id="create-case-form"
          :state="form"
          :validate="validateCaseForm"
          :validate-on="['blur', 'change']"
          class="create-form"
          data-testid="create-case-form"
          @submit="createCase"
        >
          <UFormField name="title" label="Nazwa sprawy" required>
            <UInput
              v-model="form.title"
              class="w-full"
              :maxlength="200"
              autofocus
              placeholder="Zakup mieszkania — Kowalscy"
            />
          </UFormField>
          <UFormField
            name="client_ids"
            label="Klienci"
            description="Pierwsza wybrana osoba będzie klientem głównym."
            required
          >
            <USelectMenu
              v-model="form.client_ids"
              class="w-full"
              :items="clientItems"
              value-key="value"
              label-key="label"
              multiple
              clear
              placeholder="Wybierz jednego lub kilku klientów"
              aria-label="Wybierz klientów sprawy"
              :loading="filtersPending"
            />
          </UFormField>
        </UForm>
      </template>
      <template #footer="{ close }">
        <UButton color="neutral" variant="outline" :disabled="saving" @click="close">
          Anuluj
        </UButton>
        <UButton type="submit" form="create-case-form" icon="i-lucide-folder-plus" :loading="saving">
          Utwórz sprawę
        </UButton>
      </template>
    </UModal>
  </CrmShell>
</template>

<style scoped>
.cases-alert {
  margin-bottom: 16px;
}

.pagination-row,
.filters-main,
.active-filters,
.empty-state__actions {
  display: flex;
  align-items: center;
}

.pagination-row {
  justify-content: space-between;
  gap: 20px;
}

.pagination-row > span {
  margin: 4px 0 0;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.cases-register {
  min-width: 0;
  container-name: cases-register;
  container-type: inline-size;
}

.filters {
  display: grid;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius) var(--ui-radius) 0 0;
  background: var(--ui-bg);
}

.filters-main {
  flex-wrap: wrap;
  gap: 10px;
}

.search-input {
  flex: 1 1 360px;
  min-width: 260px;
}

.filter-select {
  width: 190px;
}

.filter-select--offers {
  width: 210px;
}

.filter-select--sort {
  width: 190px;
}

.cases-count {
  flex: 0 0 auto;
  margin-left: auto;
  padding-inline: 6px;
  color: var(--ui-text-muted);
  font-size: 12px;
  font-weight: 650;
  white-space: nowrap;
}

.filters-advanced {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 220px));
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  background: var(--ui-bg-muted);
}

.active-filters {
  flex-wrap: wrap;
  gap: 8px;
}

.case-skeletons,
.create-form {
  display: grid;
  gap: 10px;
}

.case-skeletons {
  padding: 14px;
  border: 1px solid var(--ui-border);
  border-top: 0;
  border-radius: 0 0 var(--ui-radius) var(--ui-radius);
  background: var(--ui-bg);
}

.case-results {
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-top: 0;
  border-radius: 0 0 var(--ui-radius) var(--ui-radius);
  background: var(--ui-bg);
}

.case-list {
  display: grid;
}

.case-table-head,
.case-row {
  display: grid;
  grid-template-columns: minmax(220px, 1.2fr) minmax(260px, 1.4fr) minmax(200px, 0.9fr) 24px;
  gap: 20px;
  align-items: center;
}

.case-table-head {
  min-height: 42px;
  padding: 0 18px;
  border-bottom: 1px solid var(--ui-border);
  color: var(--ui-text-muted);
  background: var(--ui-bg-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: .05em;
  text-transform: uppercase;
}

.case-row {
  min-height: 76px;
  padding: 12px 18px;
  border-top: 1px solid var(--ui-border);
  color: inherit;
  text-decoration: none;
  transition: background-color var(--oe-motion-fast), box-shadow var(--oe-motion-fast);
}

.case-row:first-child {
  border-top: 0;
}

.case-row:hover,
.case-row:focus-visible {
  background: var(--ui-bg-muted);
  box-shadow: inset 3px 0 0 var(--ui-primary);
  outline: none;
}

.case-title,
.offer-summary {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.case-title strong {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 14px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.case-title span,
.offer-summary small {
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.client-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

.offer-count {
  display: inline-flex;
  gap: 7px;
  align-items: center;
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 650;
}

.offer-count .iconify {
  color: var(--ui-primary);
}

.row-arrow {
  color: var(--ui-text-dimmed);
}

.empty-state {
  display: grid;
  justify-items: center;
  gap: 10px;
  padding: 70px 20px;
  border: 1px dashed var(--ui-border-accented);
  border-top: 0;
  border-radius: 0 0 var(--ui-radius) var(--ui-radius);
  background: var(--ui-bg);
  text-align: center;
}

.empty-state__icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 14px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-muted);
  font-size: 24px;
}

.empty-state h3,
.empty-state p {
  margin: 0;
}

.empty-state h3 {
  color: var(--ui-text-highlighted);
  font-size: 17px;
}

.empty-state p {
  max-width: 480px;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.empty-state__actions {
  gap: 8px;
  margin-top: 4px;
}

.pagination-row {
  padding: 14px 16px;
  margin-top: 12px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  background: var(--ui-bg);
}

@media (max-width: 1120px) {
  .search-input {
    flex-basis: 100%;
  }

  .filter-select,
  .filter-select--offers,
  .filter-select--sort {
    flex: 1 1 180px;
    width: auto;
  }
}

@media (max-width: 820px) {
  .case-table-head {
    display: none;
  }

  .case-list {
    gap: 10px;
    padding: 12px;
  }

  .case-row {
    grid-template-columns: 1fr auto;
    gap: 12px;
    border: 1px solid var(--ui-border);
    border-radius: calc(var(--ui-radius) * .8);
  }

  .case-row:first-child { border-top: 1px solid var(--ui-border); }

  .client-chips,
  .offer-summary {
    grid-column: 1;
  }

  .row-arrow {
    grid-column: 2;
    grid-row: 1 / span 3;
  }
}

@container cases-register (max-width: 820px) {
  .case-table-head {
    display: none;
  }

  .case-list {
    gap: 10px;
    padding: 12px;
  }

  .case-row {
    grid-template-columns: 1fr auto;
    gap: 12px;
    border: 1px solid var(--ui-border);
    border-radius: calc(var(--ui-radius) * .8);
  }

  .case-row:first-child {
    border-top: 1px solid var(--ui-border);
  }

  .client-chips,
  .offer-summary {
    grid-column: 1;
  }

  .row-arrow {
    grid-column: 2;
    grid-row: 1 / span 3;
  }
}

@media (max-width: 640px) {
  .pagination-row {
    align-items: flex-start;
    flex-direction: column;
  }

  .filters-main,
  .empty-state__actions {
    align-items: stretch;
    flex-direction: column;
    flex-wrap: nowrap;
  }

  .search-input,
  .filter-select,
  .filter-select--offers,
  .filter-select--sort,
  .filters-main > :deep(button) {
    flex: 0 0 auto;
    width: 100%;
    min-width: 0;
  }

  .filters-advanced {
    grid-template-columns: 1fr;
  }

  .cases-count {
    margin-left: 0;
  }
}
</style>
