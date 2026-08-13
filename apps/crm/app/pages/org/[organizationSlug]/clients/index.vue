<script setup lang="ts">
import type { FormError, FormSubmitEvent, TableColumn } from '@nuxt/ui'
import type {
  ClientConsentDefinition,
  ClientConsentDefinitionPayload,
  ClientConsentVersion,
  ClientFiltersResponse,
  ClientFilterOption,
  ClientLegalDocumentDeliverySummary,
  ClientListItem,
  ClientListQuery,
  ClientListResponse,
  ClientMembersResponse,
  ClientSortDirection,
  ClientSortField,
  CreateClientRequest,
  CreateClientResponse,
} from '~/types/clients'

definePageMeta({ middleware: ['auth', 'organization'] })
useHead({ title: 'Klienci — OpenExpert CRM' })

const route = useRoute()
const router = useRouter()
const { organizationSlug, crmApiPath, orgApiPath, orgPath } = useOrganizationContext()
const requestFetch = useRequestFetch()
const toast = useToast()

interface ClientCreateFormState {
  display_name: string
  owner_user_id: string
  first_name: string
  last_name: string
  primary_email: string
  primary_phone: string
  tags: string
  notes: string
}

interface ActiveFilterChip {
  key: 'search' | 'owner' | 'tag' | 'contact' | 'consent' | 'consentDecision' | 'createdFrom' | 'createdTo' | 'updatedFrom' | 'updatedTo'
  label: string
}

const createEmptyFilters = (): ClientFiltersResponse => ({
  statuses: [],
  sources: [],
  tags: [],
  owners: [],
  consent_definitions: [],
})

const createEmptyMembers = (): ClientMembersResponse => ({
  currentUserId: '',
  role: 'expert',
  canAssignOthers: false,
  members: [],
})

const createEmptyList = (): ClientListResponse => ({
  data: [],
  count: 0,
})

function queryText(value: unknown) {
  return typeof value === 'string' ? value : ''
}

const searchInput = ref(queryText(route.query.q))
const search = ref(searchInput.value.trim())
const ownerFilter = ref('all')
const tagFilter = ref('all')
const contactFilter = ref('all')
const consentFilter = ref('all')
const consentDecisionFilter = ref('all')
const createdFrom = ref('')
const createdTo = ref('')
const updatedFrom = ref('')
const updatedTo = ref('')
const advancedFiltersOpen = ref(false)
const sortValue = ref(
  queryText(route.query.sort) || (search.value ? 'relevance' : 'updated_at:desc'),
)
const page = ref(Math.max(1, Number(route.query.page) || 1))
const pageSize = ref(25)
const createOpen = ref(false)
const saving = ref(false)

const form = reactive<ClientCreateFormState>({
  display_name: '',
  owner_user_id: '',
  first_name: '',
  last_name: '',
  primary_email: '',
  primary_phone: '',
  tags: '',
  notes: '',
})

let searchDebounce: ReturnType<typeof setTimeout> | undefined

watch(searchInput, (value) => {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => {
    search.value = value.trim()
  }, 300)
})

watch(search, (value, previous) => {
  if (value && !previous) sortValue.value = 'relevance'
  if (!value && sortValue.value === 'relevance') sortValue.value = 'updated_at:desc'
})

onBeforeUnmount(() => {
  if (searchDebounce) clearTimeout(searchDebounce)
})

const {
  data: filterConfiguration,
  pending: filtersPending,
  error: filtersError,
  refresh: refreshFilters,
} = await useAsyncData<ClientFiltersResponse>(
  `crm-clients-filters:${organizationSlug.value}`,
  () => requestFetch<ClientFiltersResponse>(crmApiPath('/clients/filters')),
  {
    default: createEmptyFilters,
    watch: [organizationSlug],
  },
)

const {
  data: memberConfiguration,
  pending: membersPending,
  error: membersError,
  refresh: refreshMembers,
} = await useAsyncData<ClientMembersResponse>(
  `crm-clients-members:${organizationSlug.value}`,
  () => requestFetch<ClientMembersResponse>(orgApiPath('/members')),
  {
    default: createEmptyMembers,
    watch: [organizationSlug],
  },
)

const sortParts = computed(() => {
  if (sortValue.value === 'relevance') {
    return {
      field: 'relevance' as const,
      direction: undefined,
    }
  }
  const [field = 'updated_at', direction = 'desc'] = sortValue.value.split(':')
  return {
    field: field as ClientSortField,
    direction: direction as ClientSortDirection,
  }
})

const ownerFilterUserId = computed(() => {
  if (ownerFilter.value === 'mine') return memberConfiguration.value.currentUserId || undefined
  if (ownerFilter.value === 'unassigned') return 'unassigned'
  if (ownerFilter.value.startsWith('member:')) {
    return ownerFilter.value.slice('member:'.length) || undefined
  }
  return undefined
})

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

const clientsQuery = computed<ClientListQuery>(() => ({
  q: search.value || undefined,
  owner_user_id: ownerFilterUserId.value,
  tags_any: tagFilter.value === 'all' ? undefined : tagFilter.value,
  consent_definition_id: consentFilter.value === 'all' ? undefined : consentFilter.value,
  consent_decision: consentFilter.value !== 'all' && consentDecisionFilter.value !== 'all'
    ? consentDecisionFilter.value as 'granted' | 'declined' | 'withdrawn' | 'unknown'
    : undefined,
  created_from: localDateBoundary(createdFrom.value),
  created_to: localDateBoundary(createdTo.value, true),
  updated_from: localDateBoundary(updatedFrom.value),
  updated_to: localDateBoundary(updatedTo.value, true),
  has_email: contactFilter.value === 'with_email' || contactFilter.value === 'with_both'
    ? true
    : contactFilter.value === 'without_email' ? false : undefined,
  has_phone: contactFilter.value === 'with_phone' || contactFilter.value === 'with_both'
    ? true
    : contactFilter.value === 'without_phone' ? false : undefined,
  sort: sortParts.value.field,
  direction: sortParts.value.direction,
  offset: (page.value - 1) * pageSize.value,
  limit: pageSize.value,
}))

const {
  data: clients,
  pending: clientsPending,
  error: clientsError,
  refresh: refreshClients,
} = await useAsyncData<ClientListResponse>(
  `crm-clients-list:${organizationSlug.value}`,
  () => requestFetch<ClientListResponse>(crmApiPath('/clients'), { query: clientsQuery.value }),
  {
    default: createEmptyList,
    watch: [organizationSlug, clientsQuery],
  },
)

watch([
  search,
  ownerFilter,
  tagFilter,
  contactFilter,
  consentFilter,
  consentDecisionFilter,
  createdFrom,
  createdTo,
  updatedFrom,
  updatedTo,
  sortValue,
  pageSize,
], () => {
  page.value = 1
})

watch([search, sortValue, page], () => {
  const query = { ...route.query }
  const defaultSort = search.value ? 'relevance' : 'updated_at:desc'

  if (search.value) query.q = search.value
  else delete query.q

  if (sortValue.value !== defaultSort) query.sort = sortValue.value
  else delete query.sort

  if (page.value > 1) query.page = String(page.value)
  else delete query.page

  void router.replace({ query })
})

watch(consentFilter, (value) => {
  if (value === 'all') consentDecisionFilter.value = 'all'
})

const totalClients = computed(() => Math.max(0, Number(clients.value.count) || 0))
const totalPages = computed(() => Math.max(1, Math.ceil(totalClients.value / pageSize.value)))

watch(totalPages, (value) => {
  if (page.value > value) page.value = value
})

function normalizeOptions(options: ClientFilterOption[] | undefined) {
  return (options ?? [])
    .filter(option => option.value)
    .map(option => ({
      label: option.count === undefined ? option.label : `${option.label} (${option.count})`,
      value: option.value,
    }))
}

const tagFilterItems = computed(() => [
  { label: 'Wszystkie tagi', value: 'all' },
  ...normalizeOptions(filterConfiguration.value.tags),
])

const contactFilterItems = [
  { label: 'Dowolne dane kontaktowe', value: 'all' },
  { label: 'Ma adres e-mail', value: 'with_email' },
  { label: 'Ma numer telefonu', value: 'with_phone' },
  { label: 'Ma e-mail i telefon', value: 'with_both' },
  { label: 'Brak adresu e-mail', value: 'without_email' },
  { label: 'Brak numeru telefonu', value: 'without_phone' },
]

function memberLabel(member: ClientMembersResponse['members'][number]) {
  const name = member.fullName.trim()
  if (!name) return member.email
  return member.email ? `${name} · ${member.email}` : name
}

const memberById = computed(() => new Map(
  memberConfiguration.value.members.map(member => [member.userId, member]),
))

const ownerLabelById = computed(() => new Map([
  ...filterConfiguration.value.owners.map(option => [option.value, option.label] as const),
  ...memberConfiguration.value.members.map(member => [member.userId, memberLabel(member)] as const),
]))

const memberItems = computed(() => memberConfiguration.value.members.map(member => ({
  label: memberLabel(member),
  value: member.userId,
})))

const assignableMemberItems = computed(() => {
  if (memberConfiguration.value.canAssignOthers) return memberItems.value
  return memberItems.value.filter(item => item.value === memberConfiguration.value.currentUserId)
})

const ownerFilterItems = computed(() => {
  const seen = new Set<string>()
  const ownerOptions = [
    { label: 'Wszyscy opiekunowie', value: 'all' },
    { label: 'Moi klienci', value: 'mine' },
    { label: 'Bez opiekuna', value: 'unassigned' },
  ]

  for (const option of filterConfiguration.value.owners) {
    if (!option.value || ['all', 'mine', 'unassigned'].includes(option.value) || seen.has(option.value)) continue
    seen.add(option.value)
    ownerOptions.push({
      label: option.count === undefined ? option.label : `${option.label} (${option.count})`,
      value: `member:${option.value}`,
    })
  }

  for (const member of memberConfiguration.value.members) {
    if (seen.has(member.userId)) continue
    seen.add(member.userId)
    ownerOptions.push({
      label: member.userId === memberConfiguration.value.currentUserId
        ? `${memberLabel(member)} (Ty)`
        : memberLabel(member),
      value: `member:${member.userId}`,
    })
  }

  return ownerOptions
})

const sortItems = computed(() => [
  ...(search.value ? [{ label: 'Najlepsze dopasowanie', value: 'relevance' }] : []),
  { label: 'Ostatnio aktualizowani', value: 'updated_at:desc' },
  { label: 'Najdawniej aktualizowani', value: 'updated_at:asc' },
  { label: 'Najnowsi klienci', value: 'created_at:desc' },
  { label: 'Najstarsi klienci', value: 'created_at:asc' },
  { label: 'Nazwa A–Z', value: 'display_name:asc' },
  { label: 'Nazwa Z–A', value: 'display_name:desc' },
])

const pageSizeItems = [
  { label: '10 na stronę', value: 10 },
  { label: '25 na stronę', value: 25 },
  { label: '50 na stronę', value: 50 },
  { label: '100 na stronę', value: 100 },
]

function normalizeConsentDefinition(payload: ClientConsentDefinitionPayload): ClientConsentDefinition | null {
  const version = payload.current_version ?? payload.currentVersion
  const versionId = payload.current_version_id ?? payload.currentVersionId ?? version?.id
  if (!payload.id || !version || !versionId) return null

  return {
    id: payload.id,
    code: payload.code,
    current_version_id: versionId,
    current_version: {
      id: version.id,
      version: version.version,
      display_title: version.display_title ?? version.displayTitle ?? payload.code,
      content: version.content,
      purpose: version.purpose,
      channel: version.channel,
      legal_basis: version.legal_basis ?? version.legalBasis ?? '—',
      is_required: version.is_required ?? version.isRequired ?? false,
    },
  }
}

const consentDefinitions = computed<ClientConsentDefinition[]>(() => {
  const definitions = filterConfiguration.value.consent_definitions.length
    ? filterConfiguration.value.consent_definitions
    : filterConfiguration.value.definitions ?? []
  return definitions.flatMap((definition) => {
    const normalized = normalizeConsentDefinition(definition)
    return normalized ? [normalized] : []
  })
})

const consentFilterItems = computed(() => [
  { label: 'Dowolna zgoda', value: 'all' },
  ...consentDefinitions.value.map(definition => ({
    label: definition.current_version.display_title,
    value: definition.id,
  })),
])

const consentDecisionFilterItems = [
  { label: 'Dowolna decyzja', value: 'all' },
  { label: 'Udzielona', value: 'granted' },
  { label: 'Nieudzielona', value: 'declined' },
  { label: 'Wycofana', value: 'withdrawn' },
  { label: 'Brak decyzji', value: 'unknown' },
]

watch(memberConfiguration, (configuration) => {
  const currentOwnerExists = configuration.members.some(member => member.userId === form.owner_user_id)
  if (!currentOwnerExists) form.owner_user_id = configuration.currentUserId
}, { immediate: true })

function channelLabel(channel: ClientConsentVersion['channel']) {
  return ({
    email: 'e-mail',
    sms: 'SMS/MMS',
    phone: 'telefon',
    messaging: 'komunikator',
    other: 'inny kanał',
  })[channel]
}

const saveDisabled = computed(() => (
  membersPending.value
  || Boolean(membersError.value)
  || !form.owner_user_id
))

function validateClientForm(state: Partial<ClientCreateFormState>): FormError[] {
  const errors: FormError[] = []
  const hasIdentity = Boolean(
    state.display_name?.trim()
    || state.first_name?.trim()
    || state.last_name?.trim()
    || state.primary_email?.trim()
    || state.primary_phone?.trim(),
  )

  if (!hasIdentity) {
    errors.push({
      name: 'display_name',
      message: 'Podaj nazwę klienta albo dane osoby głównej.',
    })
  }

  if (!state.owner_user_id) {
    errors.push({ name: 'owner_user_id', message: 'Wybierz opiekuna klienta.' })
  }

  if (state.primary_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.primary_email.trim())) {
    errors.push({ name: 'primary_email', message: 'Podaj poprawny adres e-mail.' })
  }

  return errors
}

function resetCreateForm() {
  form.display_name = ''
  form.owner_user_id = memberConfiguration.value.currentUserId
  form.first_name = ''
  form.last_name = ''
  form.primary_email = ''
  form.primary_phone = ''
  form.tags = ''
  form.notes = ''
}

function handleCreateClosed() {
  if (!saving.value) resetCreateForm()
}

function openCreateForm() {
  createOpen.value = true
}

function closeCreateForm() {
  createOpen.value = false
}

function toggleAdvancedFilters() {
  advancedFiltersOpen.value = !advancedFiltersOpen.value
}

function compactText(value: string) {
  const trimmed = value.trim()
  return trimmed || undefined
}

function clientCreatedToast(delivery: ClientLegalDocumentDeliverySummary | null) {
  const smsHint = 'Prośby o zgodę możesz wysłać SMS-em z karty klienta.'
  const common = 'Karta klienta została zapisana.'

  switch (delivery?.status) {
    case 'sent':
      return {
        description: `${common} Dokumenty OFI i RODO zostały wysłane e-mailem. ${smsHint}`,
        color: 'success' as const,
      }
    case 'blocked_missing_email':
      return {
        description: `${common} Dokumentów OFI i RODO nie wysłano, ponieważ klient nie ma adresu e-mail. Dodaj e-mail w karcie klienta, aby wznowić wysyłkę. ${smsHint}`,
        color: 'warning' as const,
      }
    case 'blocked_incomplete_settings':
      return {
        description: `${common} Wysyłka OFI i RODO czeka na uzupełnienie danych pośrednika w ustawieniach organizacji. ${smsHint}`,
        color: 'warning' as const,
      }
    case 'failed':
      return {
        description: `${common} Wysyłka OFI i RODO nie powiodła się; kolejka ponowi ją automatycznie. ${smsHint}`,
        color: 'warning' as const,
      }
    case 'processing':
      return {
        description: `${common} Dokumenty OFI i RODO są przygotowywane do wysyłki e-mailem. ${smsHint}`,
        color: 'success' as const,
      }
    case 'pending':
    default:
      return {
        description: `${common} Dokumenty OFI i RODO zostaną wysłane e-mailem. ${smsHint}`,
        color: 'success' as const,
      }
  }
}

async function createClient(_event: FormSubmitEvent<ClientCreateFormState>) {
  if (saveDisabled.value) return

  const personDisplayName = [form.first_name.trim(), form.last_name.trim()]
    .filter(Boolean)
    .join(' ')
  const tags = form.tags
    .split(',')
    .map(tag => tag.trim())
    .filter(Boolean)

  const body: CreateClientRequest = {
    display_name: compactText(form.display_name),
    primary_email: compactText(form.primary_email),
    primary_phone: compactText(form.primary_phone),
    tags: tags.length ? tags : undefined,
    notes: compactText(form.notes),
    owner_user_id: form.owner_user_id,
    primary_person: {
      role: 'primary',
      first_name: compactText(form.first_name),
      last_name: compactText(form.last_name),
      display_name: personDisplayName || undefined,
      email: compactText(form.primary_email),
      phone: compactText(form.primary_phone),
    },
    // A CRM user creates only the client record. The data subject makes every
    // consent decision later in the verified SMS flow from the client card.
    consent_decisions: [],
  }

  saving.value = true
  try {
    const response = await $fetch<CreateClientResponse>(crmApiPath('/clients'), {
      method: 'POST',
      body,
    })
    createOpen.value = false
    resetCreateForm()
    page.value = 1
    await Promise.all([refreshClients(), refreshFilters()])
    const createdToast = clientCreatedToast(response.legal_document_delivery)
    toast.add({
      title: 'Dodano klienta',
      ...createdToast,
    })
  } catch (caught: any) {
    const statusCode = Number(caught?.statusCode ?? caught?.response?.status ?? 0)
    if (statusCode === 409) await refreshFilters()
    toast.add({
      title: 'Nie udało się dodać klienta',
      description: statusCode === 409
        ? 'Treść zgód zmieniła się podczas wypełniania formularza. Sprawdź aktualne wersje i spróbuj ponownie.'
        : caught?.data?.statusMessage ?? caught?.message ?? 'Sprawdź dane formularza.',
      color: 'error',
    })
  } finally {
    saving.value = false
  }
}

function optionLabel(items: Array<{ label: string, value: string }>, value: string) {
  return items.find(item => item.value === value)?.label ?? value
}

const activeFilterChips = computed<ActiveFilterChip[]>(() => {
  const chips: ActiveFilterChip[] = []
  if (search.value) chips.push({ key: 'search', label: `Szukaj: ${search.value}` })
  if (ownerFilter.value !== 'all') {
    chips.push({ key: 'owner', label: optionLabel(ownerFilterItems.value, ownerFilter.value) })
  }
  if (tagFilter.value !== 'all') {
    chips.push({ key: 'tag', label: `Tag: ${optionLabel(tagFilterItems.value, tagFilter.value)}` })
  }
  if (contactFilter.value !== 'all') {
    chips.push({ key: 'contact', label: optionLabel(contactFilterItems, contactFilter.value) })
  }
  if (consentFilter.value !== 'all') {
    chips.push({ key: 'consent', label: optionLabel(consentFilterItems.value, consentFilter.value) })
  }
  if (consentDecisionFilter.value !== 'all') {
    chips.push({
      key: 'consentDecision',
      label: optionLabel(consentDecisionFilterItems, consentDecisionFilter.value),
    })
  }
  if (createdFrom.value) chips.push({ key: 'createdFrom', label: `Utworzono od: ${createdFrom.value}` })
  if (createdTo.value) chips.push({ key: 'createdTo', label: `Utworzono do: ${createdTo.value}` })
  if (updatedFrom.value) chips.push({ key: 'updatedFrom', label: `Aktualizacja od: ${updatedFrom.value}` })
  if (updatedTo.value) chips.push({ key: 'updatedTo', label: `Aktualizacja do: ${updatedTo.value}` })
  return chips
})

const hasActiveFilters = computed(() => activeFilterChips.value.length > 0)
const activeAdvancedFilterCount = computed(() => activeFilterChips.value.filter(chip => (
  ['tag', 'contact', 'consent', 'consentDecision', 'createdFrom', 'createdTo', 'updatedFrom', 'updatedTo'].includes(chip.key)
)).length)

function clearFilter(key: ActiveFilterChip['key']) {
  if (key === 'search') {
    searchInput.value = ''
    search.value = ''
  }
  if (key === 'owner') ownerFilter.value = 'all'
  if (key === 'tag') tagFilter.value = 'all'
  if (key === 'contact') contactFilter.value = 'all'
  if (key === 'consent') consentFilter.value = 'all'
  if (key === 'consentDecision') consentDecisionFilter.value = 'all'
  if (key === 'createdFrom') createdFrom.value = ''
  if (key === 'createdTo') createdTo.value = ''
  if (key === 'updatedFrom') updatedFrom.value = ''
  if (key === 'updatedTo') updatedTo.value = ''
}

function resetFilters() {
  searchInput.value = ''
  search.value = ''
  ownerFilter.value = 'all'
  tagFilter.value = 'all'
  contactFilter.value = 'all'
  consentFilter.value = 'all'
  consentDecisionFilter.value = 'all'
  createdFrom.value = ''
  createdTo.value = ''
  updatedFrom.value = ''
  updatedTo.value = ''
  sortValue.value = 'updated_at:desc'
  page.value = 1
}

function clientOwnerLabel(client: ClientListItem) {
  if (!client.owner_user_id) return 'Bez opiekuna'
  const member = memberById.value.get(client.owner_user_id)
  const label = member
    ? member.fullName.trim() || member.email
    : ownerLabelById.value.get(client.owner_user_id) || 'Nieznany opiekun'
  return client.owner_user_id === memberConfiguration.value.currentUserId ? `${label} (Ty)` : label
}

function clientInitials(client: ClientListItem) {
  return client.display_name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || 'K'
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' }).format(parsed)
}

const resultDescription = computed(() => {
  if (!totalClients.value) return 'Brak rekordów'
  const first = (page.value - 1) * pageSize.value + 1
  const last = Math.min(page.value * pageSize.value, totalClients.value)
  return `${first}–${last} z ${totalClients.value}`
})

const columns: TableColumn<ClientListItem>[] = [
  { accessorKey: 'display_name', header: 'Klient' },
  { id: 'contact', header: 'Kontakt' },
  { accessorKey: 'owner_user_id', header: 'Opiekun' },
  { accessorKey: 'updated_at', header: 'Aktualizacja' },
  { id: 'actions', header: '' },
]
</script>

<template>
  <CrmShell
    title="Klienci"
    eyebrow="Baza relacji"
    description="Rejestr osób i firm wraz z kontaktem, zgodami oraz powiązanymi sprawami."
  >
    <template #actions>
      <UButton icon="i-lucide-user-plus" @click="openCreateForm">
        Dodaj klienta
      </UButton>
    </template>

    <UCard class="clients-card">
      <template #header>
        <div class="list-heading">
          <div>
            <h2>Lista klientów</h2>
            <p>Zarządzaj relacjami, opiekunami i aktualnymi danymi kontaktowymi.</p>
          </div>
          <UBadge color="neutral" variant="subtle">
            {{ totalClients }}
          </UBadge>
        </div>
      </template>

      <div class="client-toolbar" aria-label="Filtry listy klientów">
        <UInput
          v-model="searchInput"
          class="client-search"
          icon="i-lucide-search"
          placeholder="Nazwa, osoba, telefon, PESEL lub NIP"
          :maxlength="200"
          aria-label="Szukaj klienta"
        >
          <template v-if="searchInput" #trailing>
            <UButton
              color="neutral"
              variant="link"
              size="xs"
              icon="i-lucide-x"
              aria-label="Wyczyść wyszukiwanie"
              @click="clearFilter('search')"
            />
          </template>
        </UInput>

        <USelect
          v-model="ownerFilter"
          :items="ownerFilterItems"
          value-key="value"
          icon="i-lucide-user-round-check"
          aria-label="Filtruj po opiekunie"
        />
        <USelect
          v-model="sortValue"
          :items="sortItems"
          value-key="value"
          icon="i-lucide-arrow-up-down"
          aria-label="Sortuj klientów"
        />
        <div class="toolbar-actions">
          <UButton
            color="neutral"
            :variant="advancedFiltersOpen ? 'soft' : 'outline'"
            icon="i-lucide-list-filter-plus"
            :trailing-icon="advancedFiltersOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
            @click="toggleAdvancedFilters"
          >
            Więcej<span v-if="activeAdvancedFilterCount"> ({{ activeAdvancedFilterCount }})</span>
          </UButton>
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-rotate-ccw"
            :disabled="!hasActiveFilters && sortValue === 'updated_at:desc'"
            @click="resetFilters"
          >
            Wyczyść
          </UButton>
        </div>
      </div>

      <div v-if="advancedFiltersOpen" class="advanced-toolbar" aria-label="Zaawansowane filtry klientów">
        <label class="toolbar-field">
          <span>Tag</span>
          <USelect
            v-model="tagFilter"
            :items="tagFilterItems"
            value-key="value"
            icon="i-lucide-tag"
            :disabled="filtersPending || Boolean(filtersError)"
          />
        </label>
        <label class="toolbar-field">
          <span>Dane kontaktowe</span>
          <USelect
            v-model="contactFilter"
            :items="contactFilterItems"
            value-key="value"
            icon="i-lucide-contact"
          />
        </label>
        <label class="toolbar-field">
          <span>Definicja zgody</span>
          <USelect
            v-model="consentFilter"
            :items="consentFilterItems"
            value-key="value"
            icon="i-lucide-shield-check"
            :disabled="filtersPending || Boolean(filtersError)"
          />
        </label>
        <label class="toolbar-field">
          <span>Decyzja</span>
          <USelect
            v-model="consentDecisionFilter"
            :items="consentDecisionFilterItems"
            value-key="value"
            icon="i-lucide-circle-check-big"
            :disabled="consentFilter === 'all'"
          />
        </label>
        <label class="toolbar-field">
          <span>Utworzenie od</span>
          <UInput v-model="createdFrom" type="date" icon="i-lucide-calendar-plus" />
        </label>
        <label class="toolbar-field">
          <span>Utworzenie do</span>
          <UInput v-model="createdTo" type="date" icon="i-lucide-calendar-plus" />
        </label>
        <label class="toolbar-field">
          <span>Aktualizacja od</span>
          <UInput v-model="updatedFrom" type="date" icon="i-lucide-calendar-range" />
        </label>
        <label class="toolbar-field">
          <span>Aktualizacja do</span>
          <UInput v-model="updatedTo" type="date" icon="i-lucide-calendar-range" />
        </label>
      </div>

      <div v-if="activeFilterChips.length" class="active-filters" aria-label="Aktywne filtry">
        <span>Aktywne:</span>
        <UButton
          v-for="chip in activeFilterChips"
          :key="chip.key"
          color="neutral"
          variant="soft"
          size="xs"
          trailing-icon="i-lucide-x"
          @click="clearFilter(chip.key)"
        >
          {{ chip.label }}
        </UButton>
      </div>

      <UAlert
        v-if="filtersError"
        class="filters-alert"
        color="warning"
        variant="subtle"
        icon="i-lucide-list-filter"
        title="Nie udało się pobrać opcji filtrów"
        description="Lista nadal może działać, ale część opcji filtrowania jest chwilowo niedostępna."
        :actions="[{ label: 'Spróbuj ponownie', onClick: () => refreshFilters() }]"
      />

      <div class="list-meta">
        <span>{{ resultDescription }}</span>
        <USelect
          v-model="pageSize"
          class="page-size"
          :items="pageSizeItems"
          value-key="value"
          aria-label="Liczba klientów na stronę"
        />
      </div>

      <div v-if="clientsPending" class="loading-state" aria-label="Ładowanie klientów">
        <USkeleton v-for="index in 7" :key="index" class="h-14 w-full" />
      </div>

      <UAlert
        v-else-if="clientsError"
        class="list-error"
        color="error"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="Nie udało się pobrać klientów"
        description="Sprawdź połączenie i ponów próbę. Ustawione filtry zostaną zachowane."
        :actions="[{ label: 'Spróbuj ponownie', onClick: () => refreshClients() }]"
      />

      <template v-else-if="clients.data.length">
        <div class="desktop-table">
          <UTable
            :data="clients.data"
            :columns="columns"
            :ui="{
              th: 'text-xs font-semibold text-muted',
              td: 'align-middle',
            }"
          >
            <template #display_name-cell="{ row }">
              <div class="client-identity">
                <span class="client-avatar" aria-hidden="true">{{ clientInitials(row.original) }}</span>
                <div>
                  <NuxtLink :to="orgPath(`/clients/${row.original.id}`)">
                    {{ row.original.display_name }}
                  </NuxtLink>
                  <small>Dodano {{ formatDate(row.original.created_at) }}</small>
                  <small
                    v-if="search && row.original.matchedPerson
                      && row.original.matchedPerson.display_name !== row.original.display_name"
                  >
                    Trafienie: {{ row.original.matchedPerson.display_name }}
                  </small>
                  <UBadge
                    v-if="row.original.tags?.includes('possible-duplicate')"
                    color="warning"
                    variant="subtle"
                    size="xs"
                  >
                    Możliwy duplikat
                  </UBadge>
                </div>
              </div>
            </template>

            <template #contact-cell="{ row }">
              <div class="contact-cell">
                <span v-if="row.original.primary_email">
                  <UIcon name="i-lucide-mail" />
                  {{ row.original.primary_email }}
                </span>
                <span v-if="row.original.primary_phone">
                  <UIcon name="i-lucide-phone" />
                  {{ row.original.primary_phone }}
                </span>
                <small v-if="!row.original.primary_email && !row.original.primary_phone">Brak kontaktu</small>
              </div>
            </template>

            <template #owner_user_id-cell="{ row }">
              <span class="owner-cell">
                <UIcon name="i-lucide-user-round-check" />
                {{ clientOwnerLabel(row.original) }}
              </span>
            </template>

            <template #updated_at-cell="{ row }">
              <span class="date-cell">{{ formatDate(row.original.updated_at) }}</span>
            </template>

            <template #actions-cell="{ row }">
              <UButton
                :to="orgPath(`/clients/${row.original.id}`)"
                color="neutral"
                variant="ghost"
                icon="i-lucide-chevron-right"
                aria-label="Otwórz kartę klienta"
              />
            </template>
          </UTable>
        </div>

        <div class="mobile-client-list">
          <NuxtLink
            v-for="client in clients.data"
            :key="client.id"
            :to="orgPath(`/clients/${client.id}`)"
            class="mobile-client-card"
          >
            <div class="mobile-client-card__head">
              <div class="client-identity">
                <span class="client-avatar" aria-hidden="true">{{ clientInitials(client) }}</span>
                <div>
                  <strong>{{ client.display_name }}</strong>
                  <small>{{ client.primary_email || client.primary_phone || 'Brak kontaktu' }}</small>
                  <small
                    v-if="search && client.matchedPerson
                      && client.matchedPerson.display_name !== client.display_name"
                  >
                    Trafienie: {{ client.matchedPerson.display_name }}
                  </small>
                  <UBadge
                    v-if="client.tags?.includes('possible-duplicate')"
                    color="warning"
                    variant="subtle"
                    size="xs"
                  >
                    Możliwy duplikat
                  </UBadge>
                </div>
              </div>
            </div>
            <dl>
              <div>
                <dt>Opiekun</dt>
                <dd>{{ clientOwnerLabel(client) }}</dd>
              </div>
              <div>
                <dt>Aktualizacja</dt>
                <dd>{{ formatDate(client.updated_at) }}</dd>
              </div>
            </dl>
          </NuxtLink>
        </div>
      </template>

      <OeEmptyState
        v-else
        :kind="hasActiveFilters ? 'filtered' : 'empty'"
        :icon="hasActiveFilters ? 'i-lucide-search-x' : 'i-lucide-user-plus'"
        :title="hasActiveFilters ? 'Brak pasujących klientów' : 'Dodaj pierwszego klienta'"
        :description="hasActiveFilters
          ? 'Zmień kryteria wyszukiwania lub wyczyść filtry, aby zobaczyć więcej rekordów.'
          : 'Utwórz kartę klienta wraz z osobą główną i zapisz aktualne decyzje dotyczące zgód.'"
        surface="outline"
      >
        <template #actions>
          <UButton v-if="hasActiveFilters" color="neutral" variant="outline" @click="resetFilters">
            Wyczyść filtry
          </UButton>
          <UButton icon="i-lucide-user-plus" @click="openCreateForm">
            Dodaj klienta
          </UButton>
        </template>
      </OeEmptyState>

      <template v-if="totalClients > pageSize" #footer>
        <div class="pagination-row">
          <span>Strona {{ page }} z {{ totalPages }}</span>
          <UPagination
            v-model:page="page"
            :total="totalClients"
            :items-per-page="pageSize"
            :sibling-count="1"
            show-edges
          />
        </div>
      </template>
    </UCard>

    <USlideover
      v-model:open="createOpen"
      title="Nowy klient"
      description="Utwórz kartę klienta, osobę główną i zapisz decyzje dla aktualnych wersji zgód."
      :dismissible="!saving"
      :ui="{ content: 'sm:max-w-3xl' }"
      @after:leave="handleCreateClosed"
    >
      <template #body>
        <UForm
          id="create-client-form"
          :state="form"
          :validate="validateClientForm"
          :validate-on="['blur', 'change']"
          class="create-form"
          @submit="createClient"
        >
          <section class="form-section" aria-labelledby="client-card-heading">
            <div class="form-section__head">
              <span><UIcon name="i-lucide-building-2" /></span>
              <div>
                <h3 id="client-card-heading">Karta klienta</h3>
                <p>Nazwa rekordu i odpowiedzialny opiekun.</p>
              </div>
            </div>

            <div class="form-grid">
              <UFormField
                class="full"
                name="display_name"
                label="Nazwa klienta"
                description="Opcjonalna, jeśli podasz dane osoby głównej."
              >
                <UInput v-model="form.display_name" class="w-full" :maxlength="200" placeholder="Anna Kowalska lub ACME sp. z o.o." />
              </UFormField>

              <UFormField
                class="full"
                name="owner_user_id"
                label="Opiekun klienta"
                :description="memberConfiguration.canAssignOthers ? 'Administrator może przypisać klienta dowolnemu członkowi organizacji.' : 'Klient zostanie przypisany do Ciebie.'"
                required
              >
                <USkeleton v-if="membersPending" class="h-9 w-full" />
                <UAlert
                  v-else-if="membersError"
                  color="error"
                  variant="subtle"
                  icon="i-lucide-triangle-alert"
                  title="Nie można pobrać opiekunów"
                  description="Lista członków organizacji jest potrzebna do zapisania klienta."
                  :actions="[{ label: 'Spróbuj ponownie', onClick: () => refreshMembers() }]"
                />
                <USelect
                  v-else
                  v-model="form.owner_user_id"
                  class="w-full"
                  :items="assignableMemberItems"
                  value-key="value"
                  :disabled="!memberConfiguration.canAssignOthers"
                  placeholder="Wybierz opiekuna"
                />
              </UFormField>
            </div>
          </section>

          <USeparator />

          <section class="form-section" aria-labelledby="primary-person-heading">
            <div class="form-section__head">
              <span><UIcon name="i-lucide-contact-round" /></span>
              <div>
                <h3 id="primary-person-heading">Osoba główna</h3>
                <p>Dane kontaktowe używane przy sprawach, wizytach i zgodach.</p>
              </div>
            </div>

            <div class="form-grid">
              <UFormField name="first_name" label="Imię">
                <UInput v-model="form.first_name" class="w-full" :maxlength="120" autocomplete="given-name" placeholder="Anna" />
              </UFormField>
              <UFormField name="last_name" label="Nazwisko">
                <UInput v-model="form.last_name" class="w-full" :maxlength="120" autocomplete="family-name" placeholder="Kowalska" />
              </UFormField>
              <UFormField name="primary_email" label="E-mail">
                <UInput
                  v-model="form.primary_email"
                  class="w-full"
                  type="email"
                  :maxlength="320"
                  autocomplete="email"
                  icon="i-lucide-mail"
                  placeholder="anna@example.com"
                />
              </UFormField>
              <UFormField name="primary_phone" label="Telefon">
                <UInput
                  v-model="form.primary_phone"
                  class="w-full"
                  type="tel"
                  :maxlength="50"
                  autocomplete="tel"
                  icon="i-lucide-phone"
                  placeholder="+48 600 000 000"
                />
              </UFormField>
              <UFormField class="full" name="tags" label="Tagi" description="Oddziel tagi przecinkami.">
                <UInput v-model="form.tags" class="w-full" icon="i-lucide-tags" placeholder="hipoteka, premium" />
              </UFormField>
              <UFormField class="full" name="notes" label="Notatka wewnętrzna">
                <UTextarea
                  v-model="form.notes"
                  class="w-full"
                  :rows="3"
                  placeholder="Kontekst relacji, preferencje kontaktu, następny krok"
                />
              </UFormField>
            </div>
          </section>

          <USeparator />

          <UFormField name="consents">
            <section class="form-section" aria-labelledby="client-consents-heading">
              <div class="form-section__head form-section__head--consents">
                <span><UIcon name="i-lucide-shield-check" /></span>
                <div>
                  <h3 id="client-consents-heading">Zgody pozyskiwane od klienta</h3>
                  <p>Pracownik nie zaznacza zgód za klienta. Po zapisie wyślesz bezpieczną prośbę SMS.</p>
                </div>
                <UBadge color="neutral" variant="outline">
                  {{ consentDefinitions.length }}
                </UBadge>
              </div>

              <div v-if="filtersPending" class="consent-loading">
                <USkeleton v-for="index in 3" :key="index" class="h-36 w-full" />
              </div>
              <UAlert
                v-else-if="filtersError"
                color="warning"
                variant="subtle"
                icon="i-lucide-triangle-alert"
                title="Nie można pobrać aktualnych zgód"
                description="Klienta nadal możesz zapisać. Lista zgód będzie dostępna na jego karcie po odświeżeniu."
                :actions="[{ label: 'Spróbuj ponownie', onClick: () => refreshFilters() }]"
              />
              <div v-else-if="consentDefinitions.length" class="consent-list">
                <article
                  v-for="definition in consentDefinitions"
                  :key="definition.id"
                  :class="['consent-option', {
                    'consent-option--required': definition.current_version.is_required,
                  }]"
                >
                  <div class="consent-option__heading">
                    <div>
                      <h4>{{ definition.current_version.display_title }}</h4>
                      <span>{{ definition.code }}</span>
                    </div>
                    <div class="consent-option__badges">
                      <UBadge color="neutral" variant="subtle">
                        {{ channelLabel(definition.current_version.channel) }}
                      </UBadge>
                      <UBadge
                        :color="definition.current_version.is_required ? 'error' : 'neutral'"
                        :variant="definition.current_version.is_required ? 'subtle' : 'outline'"
                      >
                        {{ definition.current_version.is_required ? 'Wymagana' : 'Dobrowolna' }}
                      </UBadge>
                      <UBadge color="neutral" variant="outline">
                        v{{ definition.current_version.version }}
                      </UBadge>
                    </div>
                  </div>

                  <p>{{ definition.current_version.content }}</p>

                  <dl class="consent-meta">
                    <div>
                      <dt>Cel</dt>
                      <dd>{{ definition.current_version.purpose }}</dd>
                    </div>
                    <div>
                      <dt>Podstawa</dt>
                      <dd>{{ definition.current_version.legal_basis }}</dd>
                    </div>
                  </dl>

                  <div class="consent-option__capture">
                    <UIcon name="i-lucide-message-square-lock" />
                    <span>Decyzję potwierdzi klient kodem jednorazowym wysłanym na jego numer telefonu.</span>
                  </div>
                </article>
              </div>
              <UAlert
                v-else
                color="neutral"
                variant="subtle"
                icon="i-lucide-info"
                title="Brak opublikowanych zgód"
                description="Klient zostanie dodany bez decyzji marketingowych. Definicje można opublikować w panelu zgód."
              />
            </section>
          </UFormField>
        </UForm>
      </template>

      <template #footer>
        <div class="slideover-footer">
          <span>
            <UIcon name="i-lucide-message-square-lock" />
            Zgody nie są nadawane przez pracownika — klient potwierdza je SMS-em.
          </span>
          <div>
            <UButton color="neutral" variant="ghost" :disabled="saving" @click="closeCreateForm">
              Anuluj
            </UButton>
            <UButton
              type="submit"
              form="create-client-form"
              icon="i-lucide-save"
              :loading="saving"
              :disabled="saveDisabled"
            >
              Zapisz klienta
            </UButton>
          </div>
        </div>
      </template>
    </USlideover>
  </CrmShell>
</template>

<style scoped>
.clients-card {
  overflow: hidden;
}

.list-heading,
.list-meta,
.pagination-row,
.slideover-footer,
.form-section__head,
.consent-option__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.list-heading h2,
.form-section h3,
.consent-option h4 {
  margin: 0;
  color: var(--ui-text-highlighted);
}

.list-heading h2 {
  font-size: 18px;
  font-weight: 650;
}

.list-heading p,
.form-section__head p {
  margin: 4px 0 0;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.client-toolbar {
  display: grid;
  grid-template-columns: minmax(220px, 1.5fr) repeat(4, minmax(150px, .8fr)) auto;
  gap: 10px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--ui-border);
}

.client-toolbar :deep(button[role='combobox']),
.client-search :deep(input) {
  width: 100%;
}

.toolbar-actions {
  display: flex;
  gap: 8px;
}

.advanced-toolbar {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-top: 12px;
  padding: 14px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  background: var(--ui-bg-muted);
}

.toolbar-field {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.toolbar-field > span {
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 650;
}

.toolbar-field :deep(button[role='combobox']),
.toolbar-field :deep(input) {
  width: 100%;
}

.active-filters {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  padding-top: 12px;
}

.active-filters > span,
.list-meta,
.pagination-row > span {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.filters-alert,
.list-error {
  margin-top: 14px;
}

.list-meta {
  min-height: 48px;
  padding: 10px 0;
}

.page-size {
  min-width: 132px;
}

.loading-state {
  display: grid;
  gap: 8px;
  padding: 10px 0;
}

.desktop-table {
  margin: 0 -24px;
  border-top: 1px solid var(--ui-border);
}

.desktop-table :deep(tbody tr:hover) {
  background: var(--ui-bg-muted);
}

.client-identity {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 190px;
}

.client-avatar {
  display: grid;
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 1px solid var(--ui-border-accented);
  border-radius: 10px;
  background: var(--ui-bg-elevated);
  color: var(--ui-primary);
  font-size: 11px;
  font-weight: 750;
  letter-spacing: .03em;
}

.client-identity > div {
  display: grid;
  min-width: 0;
}

.client-identity a,
.client-identity strong {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 650;
  text-decoration: none;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.client-identity a:hover {
  color: var(--ui-primary);
}

.client-identity small,
.contact-cell small {
  color: var(--ui-text-muted);
  font-size: 11px;
}

.contact-cell {
  display: grid;
  gap: 3px;
  min-width: 175px;
}

.contact-cell span,
.owner-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--ui-text);
  font-size: 12px;
}

.contact-cell .iconify,
.owner-cell .iconify {
  flex: 0 0 auto;
  color: var(--ui-text-muted);
}

.owner-cell {
  max-width: 190px;
}

.source-cell,
.date-cell {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.mobile-client-list {
  display: none;
}

.pagination-row {
  width: 100%;
}

.empty-state {
  display: grid;
  justify-items: center;
  gap: 10px;
  min-height: 330px;
  padding: 56px 24px;
  text-align: center;
}

.empty-state__icon {
  display: grid;
  width: 54px;
  height: 54px;
  place-items: center;
  border-radius: 16px;
  background: var(--ui-bg-elevated);
  color: var(--ui-text-muted);
}

.empty-state__icon .iconify {
  width: 25px;
  height: 25px;
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
  line-height: 1.55;
}

.empty-state__actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.create-form {
  display: grid;
  gap: 24px;
}

.form-section {
  display: grid;
  gap: 18px;
}

.form-section__head {
  justify-content: flex-start;
  align-items: flex-start;
}

.form-section__head > span {
  display: grid;
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: 10px;
  background: var(--ui-bg-elevated);
  color: var(--ui-primary);
}

.form-section__head > div {
  min-width: 0;
}

.form-section__head--consents > div {
  flex: 1;
}

.form-section h3 {
  font-size: 15px;
  font-weight: 650;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.form-grid .full {
  grid-column: 1 / -1;
}

.consent-loading,
.consent-list {
  display: grid;
  gap: 12px;
}

.consent-option {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--ui-border);
  border-radius: 14px;
  background: var(--ui-bg-elevated);
}

.consent-option--required {
  border-color: color-mix(in srgb, var(--ui-error) 32%, var(--ui-border));
}

.consent-option__heading {
  align-items: flex-start;
}

.consent-option h4 {
  font-size: 13px;
  font-weight: 650;
}

.consent-option__heading > div:first-child > span {
  color: var(--ui-text-dimmed);
  font-family: var(--font-mono);
  font-size: 10px;
  text-transform: uppercase;
}

.consent-option__badges {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 5px;
}

.consent-option > p {
  margin: 0;
  color: var(--ui-text);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
}

.consent-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--ui-bg-muted);
}

.consent-meta div {
  display: grid;
  gap: 3px;
}

.consent-meta dt {
  color: var(--ui-text-dimmed);
  font-size: 10px;
  font-weight: 650;
  text-transform: uppercase;
}

.consent-meta dd {
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.consent-option :deep([data-slot='root']) {
  gap: 8px;
}

.consent-option__hint {
  color: var(--ui-text-warning);
  font-size: 11px;
  line-height: 1.45;
}

.consent-option__capture {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 11px;
  border: 1px solid var(--ui-border-muted);
  border-radius: 10px;
  color: var(--ui-text-toned);
  background: var(--ui-bg);
  font-size: 12px;
  line-height: 1.45;
}

.consent-option__capture > .iconify {
  flex: 0 0 auto;
  color: var(--ui-primary);
}

.slideover-footer {
  width: 100%;
}

.slideover-footer > span {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.slideover-footer > div {
  display: flex;
  gap: 8px;
}

@media (max-width: 1220px) {
  .client-toolbar {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .client-search {
    grid-column: span 2;
  }

  .toolbar-actions {
    justify-content: flex-end;
  }
}

@media (max-width: 820px) {
  .desktop-table {
    display: none;
  }

  .mobile-client-list {
    display: grid;
    gap: 10px;
  }

  .mobile-client-card {
    display: grid;
    gap: 14px;
    padding: 14px;
    border: 1px solid var(--ui-border);
    border-radius: 14px;
    background: var(--ui-bg-elevated);
    color: inherit;
    text-decoration: none;
  }

  .mobile-client-card__head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .mobile-client-card dl {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    margin: 0;
  }

  .mobile-client-card dl > div {
    display: grid;
    gap: 2px;
  }

  .mobile-client-card dt {
    color: var(--ui-text-dimmed);
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
  }

  .mobile-client-card dd {
    overflow: hidden;
    margin: 0;
    color: var(--ui-text-muted);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

@media (max-width: 640px) {
  .client-toolbar,
  .advanced-toolbar,
  .form-grid,
  .consent-meta {
    grid-template-columns: 1fr;
  }

  .client-search,
  .form-grid .full {
    grid-column: auto;
  }

  .toolbar-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .toolbar-actions :deep(button) {
    justify-content: center;
  }

  .list-heading,
  .pagination-row,
  .slideover-footer,
  .consent-option__heading {
    align-items: stretch;
    flex-direction: column;
  }

  .pagination-row :deep(nav) {
    justify-content: center;
  }

  .empty-state__actions,
  .slideover-footer > div {
    width: 100%;
    flex-direction: column-reverse;
  }

  .empty-state__actions :deep(button),
  .slideover-footer > div :deep(button) {
    justify-content: center;
    width: 100%;
  }

  .mobile-client-card dl {
    grid-template-columns: 1fr 1fr;
  }

  .form-section__head--consents {
    flex-wrap: wrap;
  }
}
</style>
