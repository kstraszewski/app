<script setup lang="ts">
import type { ClientDetailResponse } from '~/types/clients'

definePageMeta({ middleware: ['auth', 'organization'] })

const route = useRoute()
const { organizationSlug, crmApiPath, orgPath } = useOrganizationContext()
const clientId = computed(() => String(route.params.id))
const requestFetch = useRequestFetch()
const toast = useToast()

const emptyDetail = (): ClientDetailResponse => ({
  data: {
    id: '',
    organization_id: '',
    owner_user_id: null,
    display_name: '',
    primary_email: null,
    primary_phone: null,
    status_code: '',
    lead_source: null,
    tags: [],
    notes: null,
    metadata: {},
    created_at: '',
    updated_at: '',
  },
  owner: null,
  primary_person: null,
  people: [],
  cases: [],
  tasks: [],
  documents: [],
  activities: [],
  activity_count: 0,
  consents: [],
  consent_states: [],
  consent_definitions: [],
  consent_events: [],
  consent_history: [],
  consent_history_count: 0,
  consent_history_page_info: { offset: 0, limit: 100, has_more: false },
  appointments: [],
  appointment_count: 0,
  appointments_page_info: { offset: 0, limit: 20, has_more: false },
  summary: {
    people_count: 0,
    cases_count: 0,
    open_cases_count: 0,
    task_count: 0,
    open_tasks_count: 0,
    documents_count: 0,
    activity_count: 0,
    consent_definition_count: 0,
    granted_consent_count: 0,
    appointment_count: 0,
  },
})

const {
  data,
  pending,
  error,
  refresh,
} = await useAsyncData<ClientDetailResponse>(
  `crm-client:${organizationSlug.value}:${clientId.value}`,
  () => requestFetch<ClientDetailResponse>(crmApiPath(`/clients/${clientId.value}`)),
  {
    default: emptyDetail,
    watch: [organizationSlug, clientId],
  },
)

useHead(() => ({ title: `${data.value.data.display_name || 'Klient'} — OpenExpert CRM` }))

const validViews = ['overview', 'cases', 'consents', 'appointments', 'history'] as const
type ClientView = typeof validViews[number]

const currentView = computed<ClientView>(() => {
  const view = String(route.query.view ?? 'overview')
  return validViews.includes(view as ClientView) ? view as ClientView : 'overview'
})

function viewLocation(view: ClientView) {
  const query = { ...route.query }
  if (view === 'overview') delete query.view
  else query.view = view
  return { path: route.path, query }
}

const clientTabs = computed(() => [
  {
    label: 'Podsumowanie',
    icon: 'i-lucide-layout-dashboard',
    to: viewLocation('overview'),
  },
  {
    label: 'Sprawy',
    icon: 'i-lucide-briefcase-business',
    count: data.value.summary.cases_count,
    to: viewLocation('cases'),
  },
  {
    label: 'Zgody',
    icon: 'i-lucide-shield-check',
    count: data.value.summary.consent_definition_count,
    to: viewLocation('consents'),
  },
  {
    label: 'Wizyty',
    icon: 'i-lucide-calendar-days',
    count: data.value.appointment_count,
    to: viewLocation('appointments'),
  },
  {
    label: 'Historia',
    icon: 'i-lucide-history',
    count: data.value.activity_count + data.value.consent_history_count,
    to: viewLocation('history'),
  },
])

const statusMeta = computed(() => {
  const statuses: Record<string, { label: string, color: 'neutral' | 'info' | 'success' | 'warning' | 'error' }> = {
    lead: { label: 'Potencjalny klient', color: 'info' },
    active: { label: 'Aktywny', color: 'success' },
    inactive: { label: 'Nieaktywny', color: 'neutral' },
    blocked: { label: 'Zablokowany', color: 'error' },
  }
  const rawStatus = data.value.data.status_code
  return statuses[rawStatus] ?? {
    label: rawStatus ? rawStatus.replaceAll('_', ' ') : 'Bez statusu',
    color: 'neutral' as const,
  }
})

const headerDate = new Intl.DateTimeFormat('pl-PL', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const longDate = new Intl.DateTimeFormat('pl-PL', {
  dateStyle: 'long',
  timeStyle: 'short',
})

const shortDate = new Intl.DateTimeFormat('pl-PL', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

function formatDateTime(value: string | null | undefined, fallback = '—') {
  if (!value) return fallback
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? fallback : longDate.format(date)
}

function formatShortDate(value: string | null | undefined, fallback = '—') {
  if (!value) return fallback
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? fallback : shortDate.format(date)
}

function formatHeaderDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : headerDate.format(date)
}

const clientInitials = computed(() => {
  const words = data.value.data.display_name.trim().split(/\s+/).filter(Boolean)
  return words.slice(0, 2).map(word => word[0]?.toUpperCase()).join('') || 'K'
})

function consentDecisionLabel(decision: string) {
  return ({
    granted: 'Udzielona',
    declined: 'Brak zgody',
    withdrawn: 'Wycofana',
    missing: 'Brak decyzji',
  })[decision] ?? decision
}

function consentDecisionColor(decision: string): 'success' | 'error' | 'warning' | 'neutral' {
  return ({
    granted: 'success',
    declined: 'error',
    withdrawn: 'warning',
    missing: 'neutral',
  })[decision] as 'success' | 'error' | 'warning' | 'neutral' ?? 'neutral'
}

function consentChannelLabel(channel: string | null | undefined) {
  if (!channel) return 'Dowolny kanał'
  return ({
    email: 'E-mail',
    sms: 'SMS/MMS',
    phone: 'Telefon',
    messaging: 'Komunikator',
    other: 'Inny kanał',
  })[channel] ?? channel
}

function consentSourceLabel(source: string | null | undefined) {
  if (!source) return 'CRM'
  return ({
    client_creation: 'Dodanie klienta',
    client_card: 'Karta klienta',
    import: 'Import',
    api: 'API',
    booking_widget: 'Widget rezerwacji',
  })[source] ?? source
}

function personRoleLabel(role: string) {
  return ({
    primary: 'Osoba główna',
    co_borrower: 'Współkredytobiorca',
    insured: 'Ubezpieczony',
    representative: 'Pełnomocnik',
  })[role] ?? role.replaceAll('_', ' ')
}

const appointmentStatuses = {
  hold: { label: 'Wstępnie zarezerwowana', color: 'warning' },
  confirmed: { label: 'Potwierdzona', color: 'success' },
  cancelled: { label: 'Anulowana', color: 'error' },
} as const

function appointmentStatusMeta(status: string) {
  return appointmentStatuses[status as keyof typeof appointmentStatuses]
    ?? { label: status || 'Nieznany', color: 'neutral' as const }
}

function appointmentDay(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('pl-PL', { day: '2-digit' }).format(date)
}

function appointmentMonth(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('pl-PL', { month: 'short' }).format(date)
}

function appointmentTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('pl-PL', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function activityIcon(activityType: string) {
  if (activityType.includes('created')) return 'i-lucide-circle-plus'
  if (activityType.includes('status')) return 'i-lucide-refresh-cw'
  if (activityType.includes('document') || activityType.includes('submission')) return 'i-lucide-file-check-2'
  if (activityType.includes('note')) return 'i-lucide-message-square-text'
  if (activityType.includes('appointment')) return 'i-lucide-calendar-check'
  if (activityType.includes('updated')) return 'i-lucide-pencil'
  return 'i-lucide-activity'
}

function activityLabel(activityType: string) {
  return ({
    client_created: 'Utworzenie klienta',
    client_updated: 'Zmiana danych',
    case_created: 'Nowa sprawa',
    status_changed: 'Zmiana statusu',
    note: 'Notatka',
    submission_created: 'Nowy wniosek',
    settlement_upserted: 'Aktualizacja rozliczenia',
  })[activityType] ?? activityType.replaceAll('_', ' ')
}

type HistoryItem = {
  id: string
  date: string
  icon: string
  category: string
  title: string
  description: string
  meta: string
  tone: 'neutral' | 'success' | 'warning' | 'error'
}

const historyItems = computed<HistoryItem[]>(() => {
  const activities = data.value.activities.map(activity => ({
    id: `activity:${activity.id}`,
    date: activity.created_at,
    icon: activityIcon(activity.activity_type),
    category: activityLabel(activity.activity_type),
    title: activity.title,
    description: activity.body || 'Zdarzenie zapisane w historii klienta.',
    meta: activity.actor?.full_name || activity.actor?.email || 'OpenExpert CRM',
    tone: 'neutral' as const,
  }))

  const consents = data.value.consent_history.map(consent => ({
    id: `consent:${consent.id}`,
    date: consent.occurred_at,
    icon: consent.decision === 'granted' ? 'i-lucide-shield-check' : 'i-lucide-shield-x',
    category: 'Decyzja zgody',
    title: consent.version?.display_title || 'Zgoda klienta',
    description: `${consentDecisionLabel(consent.decision)} · ${consentChannelLabel(consent.version?.channel)}`,
    meta: consentSourceLabel(consent.source),
    tone: consent.decision === 'granted'
      ? 'success' as const
      : consent.decision === 'withdrawn'
        ? 'warning' as const
        : 'error' as const,
  }))

  return [...activities, ...consents].sort((left, right) => (
    new Date(right.date).getTime() - new Date(left.date).getTime()
  ))
})

const recentHistory = computed(() => historyItems.value.slice(0, 3))
const oldestHistoryItem = computed(() => historyItems.value.at(-1) ?? null)

const summaryMetrics = computed(() => [
  {
    label: 'Otwarte sprawy',
    value: data.value.summary.open_cases_count,
    icon: 'i-lucide-briefcase-business',
    hint: `${data.value.summary.cases_count} łącznie`,
  },
  {
    label: 'Wizyty',
    value: data.value.summary.appointment_count,
    icon: 'i-lucide-calendar-days',
    hint: 'w historii klienta',
  },
  {
    label: 'Aktywne zgody',
    value: data.value.summary.granted_consent_count,
    icon: 'i-lucide-shield-check',
    hint: `${data.value.summary.consent_definition_count} definicje`,
  },
  {
    label: 'Otwarte zadania',
    value: data.value.summary.open_tasks_count,
    icon: 'i-lucide-list-checks',
    hint: `${data.value.summary.task_count} łącznie`,
  },
])

const createCaseOpen = ref(false)
const savingCase = ref(false)
const caseForm = reactive({ title: '' })

function openCreateCase() {
  createCaseOpen.value = true
}

async function createCase() {
  const title = caseForm.title.trim()
  if (!title) return
  savingCase.value = true
  try {
    const response = await $fetch<{ data: { id: string } }>(crmApiPath('/cases'), {
      method: 'POST',
      body: {
        client_ids: [clientId.value],
        title,
      },
    })
    createCaseOpen.value = false
    caseForm.title = ''
    toast.add({
      title: 'Sprawa została utworzona',
      description: 'Klient jest już do niej przypisany.',
      color: 'success',
      icon: 'i-lucide-circle-check',
    })
    await navigateTo(orgPath(`/cases/${response.data.id}`))
  } catch (caught: any) {
    toast.add({
      title: 'Nie udało się utworzyć sprawy',
      description: caught?.data?.statusMessage ?? caught?.message,
      color: 'error',
    })
  } finally {
    savingCase.value = false
  }
}

const editOpen = ref(false)
const savingClient = ref(false)
const editForm = reactive({
  display_name: '',
  primary_email: '',
  primary_phone: '',
  tags: '',
  notes: '',
})

function openEdit() {
  editForm.display_name = data.value.data.display_name
  editForm.primary_email = data.value.data.primary_email ?? ''
  editForm.primary_phone = data.value.data.primary_phone ?? ''
  editForm.tags = data.value.data.tags.join(', ')
  editForm.notes = data.value.data.notes ?? ''
  editOpen.value = true
}

async function saveClient() {
  const displayName = editForm.display_name.trim()
  if (!displayName) return
  savingClient.value = true
  try {
    await $fetch(crmApiPath(`/clients/${clientId.value}`), {
      method: 'PATCH',
      body: {
        display_name: displayName,
        primary_email: editForm.primary_email.trim() || null,
        primary_phone: editForm.primary_phone.trim() || null,
        tags: editForm.tags.split(',').map(tag => tag.trim()).filter(Boolean),
        notes: editForm.notes.trim() || null,
      },
    })
    await refresh()
    editOpen.value = false
    toast.add({
      title: 'Dane klienta zapisane',
      color: 'success',
      icon: 'i-lucide-circle-check',
    })
  } catch (caught: any) {
    toast.add({
      title: 'Nie udało się zapisać klienta',
      description: caught?.data?.statusMessage ?? caught?.message,
      color: 'error',
    })
  } finally {
    savingClient.value = false
  }
}

const headerMenuItems = computed(() => [[
  {
    label: 'Edytuj dane klienta',
    icon: 'i-lucide-pencil',
    onSelect: openEdit,
  },
  {
    label: 'Odśwież dane',
    icon: 'i-lucide-refresh-cw',
    onSelect: () => refresh(),
  },
]])
</script>

<template>
  <CrmShell
    :title="data.data.display_name || 'Klient'"
    eyebrow="Klient · karta CRM"
    description="Relacja, sprawy, zgody, wizyty i pełna historia obsługi w jednym miejscu."
    :back-to="orgPath('/clients')"
    back-label="Wróć do klientów"
    :tabs="pending && !data.data.id ? [] : clientTabs"
  >
    <template #meta>
      <div v-if="data.data.id" class="client-header-meta">
        <UBadge :color="statusMeta.color" variant="subtle">{{ statusMeta.label }}</UBadge>
        <span class="client-header-meta__separator" aria-hidden="true" />
        <span>
          Opiekun:
          <strong>{{ data.owner?.full_name || data.owner?.email || 'Nieprzypisany' }}</strong>
        </span>
        <span class="client-header-meta__separator" aria-hidden="true" />
        <span>Ostatnia aktualizacja: {{ formatHeaderDate(data.data.updated_at) }}</span>
      </div>
    </template>

    <template #actions>
      <template v-if="data.data.id">
        <UButton
          v-if="data.data.primary_email"
          :to="`mailto:${data.data.primary_email}`"
          color="neutral"
          variant="outline"
          size="lg"
          icon="i-lucide-mail"
        >
          Napisz
        </UButton>
        <UButton
          color="neutral"
          variant="solid"
          size="lg"
          icon="i-lucide-folder-plus"
          @click="openCreateCase"
        >
          Nowa sprawa
        </UButton>
        <UDropdownMenu :items="headerMenuItems" :content="{ align: 'end' }">
          <UButton
            color="neutral"
            variant="outline"
            size="lg"
            icon="i-lucide-ellipsis"
            aria-label="Więcej działań"
          />
        </UDropdownMenu>
      </template>
    </template>

    <div v-if="pending && !data.data.id" class="client-loading">
      <div class="client-loading__metrics">
        <USkeleton v-for="index in 4" :key="index" class="h-28 w-full" />
      </div>
      <div class="client-loading__body">
        <USkeleton class="h-96 w-full" />
        <USkeleton class="h-96 w-full" />
      </div>
    </div>

    <UAlert
      v-else-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="Nie udało się pobrać karty klienta"
      description="Sprawdź połączenie i spróbuj ponownie."
    >
      <template #actions>
        <UButton color="error" variant="soft" icon="i-lucide-refresh-cw" @click="refresh()">
          Spróbuj ponownie
        </UButton>
      </template>
    </UAlert>

    <template v-else>
      <section v-if="currentView === 'overview'" class="client-overview">
        <div class="client-metrics" aria-label="Podsumowanie klienta">
          <article v-for="metric in summaryMetrics" :key="metric.label" class="client-metric">
            <span class="client-metric__icon"><UIcon :name="metric.icon" /></span>
            <div>
              <strong>{{ metric.value }}</strong>
              <span>{{ metric.label }}</span>
            </div>
            <small>{{ metric.hint }}</small>
          </article>
        </div>

        <div class="client-overview__grid">
          <div class="client-panel-stack">
            <section class="client-panel client-profile-panel" aria-labelledby="client-data-title">
              <header class="client-panel__header">
                <div>
                  <p>Dane podstawowe</p>
                  <h2 id="client-data-title">Kontakt i opiekun</h2>
                </div>
                <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-pencil" @click="openEdit">
                  Edytuj
                </UButton>
              </header>

              <div class="client-profile">
                <span class="client-avatar">{{ clientInitials }}</span>
                <div class="client-profile__identity">
                  <strong>{{ data.data.display_name }}</strong>
                  <span>{{ statusMeta.label }}</span>
                </div>
              </div>

              <dl class="client-data-list">
                <div>
                  <dt><UIcon name="i-lucide-mail" /> E-mail</dt>
                  <dd>
                    <a v-if="data.data.primary_email" :href="`mailto:${data.data.primary_email}`">
                      {{ data.data.primary_email }}
                    </a>
                    <span v-else>Nie podano</span>
                  </dd>
                </div>
                <div>
                  <dt><UIcon name="i-lucide-phone" /> Telefon</dt>
                  <dd>
                    <a v-if="data.data.primary_phone" :href="`tel:${data.data.primary_phone}`">
                      {{ data.data.primary_phone }}
                    </a>
                    <span v-else>Nie podano</span>
                  </dd>
                </div>
                <div>
                  <dt><UIcon name="i-lucide-user-round-check" /> Opiekun</dt>
                  <dd>{{ data.owner?.full_name || data.owner?.email || 'Nieprzypisany' }}</dd>
                </div>
                <div>
                  <dt><UIcon name="i-lucide-calendar-plus" /> Klient od</dt>
                  <dd>{{ formatShortDate(data.data.created_at) }}</dd>
                </div>
              </dl>
            </section>

            <section class="client-panel" aria-labelledby="related-people-title">
              <header class="client-panel__header">
                <div>
                  <p>Relacje</p>
                  <h2 id="related-people-title">Osoby powiązane</h2>
                </div>
                <UBadge color="neutral" variant="outline">{{ data.people.length }}</UBadge>
              </header>

              <div v-if="data.people.length" class="related-people">
                <article v-for="person in data.people" :key="person.id">
                  <span><UIcon name="i-lucide-user-round" /></span>
                  <div>
                    <strong>{{ person.display_name }}</strong>
                    <small>{{ personRoleLabel(person.role) }}</small>
                  </div>
                  <p>{{ person.email || person.phone || 'Brak danych kontaktowych' }}</p>
                </article>
              </div>
              <div v-else class="client-empty client-empty--compact">
                <UIcon name="i-lucide-users-round" />
                <span>Nie dodano innych osób do tej relacji.</span>
              </div>
            </section>
          </div>

          <aside class="client-panel-stack">
            <section class="client-panel" aria-labelledby="relationship-context-title">
              <header class="client-panel__header">
                <div>
                  <p>Kontekst relacji</p>
                  <h2 id="relationship-context-title">O kliencie</h2>
                </div>
              </header>

              <dl class="client-context-list">
                <div>
                  <dt>Źródło</dt>
                  <dd>{{ data.data.lead_source || 'Nieokreślone' }}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{{ statusMeta.label }}</dd>
                </div>
                <div>
                  <dt>Tagi</dt>
                  <dd class="client-tags">
                    <UBadge
                      v-for="tag in data.data.tags"
                      :key="tag"
                      color="neutral"
                      variant="subtle"
                    >
                      {{ tag }}
                    </UBadge>
                    <span v-if="!data.data.tags.length">Brak tagów</span>
                  </dd>
                </div>
              </dl>

              <div v-if="data.data.notes" class="client-note">
                <span><UIcon name="i-lucide-notebook-text" /></span>
                <p>{{ data.data.notes }}</p>
              </div>
            </section>

            <section class="client-panel" aria-labelledby="recent-activity-title">
              <header class="client-panel__header">
                <div>
                  <p>Ostatnie zdarzenia</p>
                  <h2 id="recent-activity-title">Aktywność</h2>
                </div>
                <UButton :to="viewLocation('history')" color="neutral" variant="ghost" size="xs" trailing-icon="i-lucide-arrow-right">
                  Cała historia
                </UButton>
              </header>

              <div v-if="recentHistory.length" class="recent-activity">
                <article v-for="item in recentHistory" :key="item.id">
                  <span><UIcon :name="item.icon" /></span>
                  <div>
                    <strong>{{ item.title }}</strong>
                    <small>{{ formatShortDate(item.date) }}</small>
                  </div>
                </article>
              </div>
              <div v-else class="client-empty client-empty--compact">
                <UIcon name="i-lucide-history" />
                <span>Historia uzupełni się po pierwszych działaniach.</span>
              </div>
            </section>
          </aside>
        </div>
      </section>

      <section v-else-if="currentView === 'cases'" class="client-workspace" aria-labelledby="client-cases-title">
        <header class="workspace-heading">
          <div>
            <p>Powiązane procesy</p>
            <h2 id="client-cases-title">Sprawy klienta</h2>
            <span>Wszystkie procesy, w których uczestniczy ten klient.</span>
          </div>
          <UButton icon="i-lucide-folder-plus" @click="openCreateCase">Nowa sprawa</UButton>
        </header>

        <div v-if="data.cases.length" class="client-case-list">
          <NuxtLink
            v-for="item in data.cases"
            :key="item.id"
            :to="orgPath(`/cases/${item.id}`)"
            class="client-case-row"
          >
            <span class="client-case-row__icon"><UIcon name="i-lucide-briefcase-business" /></span>
            <div class="client-case-row__title">
              <strong>{{ item.title }}</strong>
              <span>Aktualizacja {{ formatShortDate(item.updated_at) }}</span>
            </div>
            <div class="client-case-row__facts">
              <span><UIcon name="i-lucide-bookmark-check" /> {{ item.offer_count }} ofert</span>
              <UBadge :color="item.closed_at ? 'neutral' : 'success'" variant="subtle">
                {{ item.closed_at ? 'Zamknięta' : 'Aktywna' }}
              </UBadge>
            </div>
            <UIcon class="client-case-row__arrow" name="i-lucide-chevron-right" />
          </NuxtLink>
        </div>

        <div v-else class="client-empty client-empty--workspace">
          <span><UIcon name="i-lucide-folder-plus" /></span>
          <h3>Brak spraw tego klienta</h3>
          <p>Utwórz pierwszą sprawę, a klient zostanie przypisany automatycznie.</p>
          <UButton icon="i-lucide-folder-plus" @click="openCreateCase">Utwórz sprawę</UButton>
        </div>
      </section>

      <section v-else-if="currentView === 'consents'" class="client-workspace" aria-labelledby="client-consents-title">
        <header class="workspace-heading">
          <div>
            <p>Preferencje i podstawy prawne</p>
            <h2 id="client-consents-title">Zgody klienta</h2>
            <span>Aktualna decyzja dla każdej opublikowanej definicji.</span>
          </div>
          <UBadge color="neutral" variant="outline">{{ data.consent_states.length }} definicje</UBadge>
        </header>

        <div v-if="data.consent_states.length" class="client-consent-grid">
          <article v-for="consent in data.consent_states" :key="consent.definition_id" class="client-consent-card">
            <header>
              <span class="client-consent-card__icon"><UIcon name="i-lucide-shield-check" /></span>
              <div>
                <strong>{{ consent.version?.display_title || 'Zgoda' }}</strong>
                <small>
                  {{ consentChannelLabel(consent.version?.channel) }}
                  · wersja {{ consent.version?.version || '—' }}
                </small>
              </div>
              <UBadge :color="consentDecisionColor(consent.decision)" variant="subtle">
                {{ consentDecisionLabel(consent.decision) }}
              </UBadge>
            </header>
            <p>{{ consent.version?.content || 'Brak opisu treści zgody.' }}</p>
            <footer>
              <span>{{ consent.version?.is_required ? 'Wymagana' : 'Dobrowolna' }}</span>
              <span v-if="consent.occurred_at">{{ formatDateTime(consent.occurred_at) }}</span>
              <span v-else>Nie zapisano decyzji</span>
            </footer>
          </article>
        </div>

        <div v-else class="client-empty client-empty--workspace">
          <span><UIcon name="i-lucide-shield-question" /></span>
          <h3>Brak aktywnych definicji zgód</h3>
          <p>Po opublikowaniu zgód ich aktualny stan pojawi się tutaj.</p>
        </div>
      </section>

      <section v-else-if="currentView === 'appointments'" class="client-workspace" aria-labelledby="client-appointments-title">
        <header class="workspace-heading">
          <div>
            <p>Kalendarz relacji</p>
            <h2 id="client-appointments-title">Wizyty klienta</h2>
            <span>Spotkania w placówkach i z przypisanymi ekspertami.</span>
          </div>
          <UBadge color="neutral" variant="outline">{{ data.appointment_count }} wizyt</UBadge>
        </header>

        <div v-if="data.appointments.length" class="client-appointment-list">
          <article v-for="appointment in data.appointments" :key="appointment.id" class="client-appointment-row">
            <time :datetime="appointment.starts_at" class="client-appointment-row__date">
              <strong>{{ appointmentDay(appointment.starts_at) }}</strong>
              <span>{{ appointmentMonth(appointment.starts_at) }}</span>
            </time>
            <div class="client-appointment-row__body">
              <strong>{{ appointment.serviceName || 'Spotkanie' }}</strong>
              <span>
                {{ appointmentTime(appointment.starts_at) }}
                · {{ appointment.meeting_mode === 'online'
                  ? 'Online'
                  : appointment.facilityName || 'Placówka nieokreślona' }}
              </span>
            </div>
            <div class="client-appointment-row__expert">
              <UIcon name="i-lucide-user-round" />
              <span>{{ appointment.expertName || 'Ekspert nieprzypisany' }}</span>
            </div>
            <UBadge :color="appointmentStatusMeta(appointment.status).color" variant="subtle">
              {{ appointmentStatusMeta(appointment.status).label }}
            </UBadge>
          </article>
        </div>

        <div v-else class="client-empty client-empty--workspace">
          <span><UIcon name="i-lucide-calendar-plus" /></span>
          <h3>Brak wizyt klienta</h3>
          <p>Umówione spotkania pojawią się tutaj wraz z miejscem, ekspertem i statusem.</p>
          <UButton :to="orgPath('/calendar')" color="neutral" variant="outline" icon="i-lucide-calendar-days">
            Otwórz kalendarz
          </UButton>
        </div>
      </section>

      <section v-else class="client-history-layout" aria-labelledby="client-history-title">
        <div class="client-workspace">
          <header class="workspace-heading">
            <div>
              <p>Pełny ślad obsługi</p>
              <h2 id="client-history-title">Historia klienta</h2>
              <span>Zmiany w CRM, powiązane sprawy oraz decyzje dotyczące zgód.</span>
            </div>
            <UBadge color="neutral" variant="outline">{{ historyItems.length }} zdarzenia</UBadge>
          </header>

          <ol v-if="historyItems.length" class="client-timeline">
            <li v-for="item in historyItems" :key="item.id" :class="`client-timeline__item client-timeline__item--${item.tone}`">
              <span class="client-timeline__marker"><UIcon :name="item.icon" /></span>
              <article>
                <header>
                  <div>
                    <small>{{ item.category }}</small>
                    <strong>{{ item.title }}</strong>
                  </div>
                  <time :datetime="item.date">{{ formatDateTime(item.date) }}</time>
                </header>
                <p>{{ item.description }}</p>
                <footer><UIcon name="i-lucide-user-round" /> {{ item.meta }}</footer>
              </article>
            </li>
          </ol>

          <div v-else class="client-empty client-empty--workspace">
            <span><UIcon name="i-lucide-history" /></span>
            <h3>Historia jest jeszcze pusta</h3>
            <p>Pierwsze zmiany danych, sprawy i decyzje zgód utworzą tutaj chronologiczny feed.</p>
          </div>
        </div>

        <aside class="client-history-summary">
          <section class="client-panel">
            <header class="client-panel__header">
              <div>
                <p>Zakres historii</p>
                <h2>Źródła zdarzeń</h2>
              </div>
            </header>
            <dl>
              <div>
                <dt><UIcon name="i-lucide-activity" /> Aktywność CRM</dt>
                <dd>{{ data.activity_count }}</dd>
              </div>
              <div>
                <dt><UIcon name="i-lucide-shield-check" /> Decyzje zgód</dt>
                <dd>{{ data.consent_history_count }}</dd>
              </div>
              <div>
                <dt><UIcon name="i-lucide-briefcase-business" /> Powiązane sprawy</dt>
                <dd>{{ data.summary.cases_count }}</dd>
              </div>
            </dl>
          </section>

          <section class="client-panel client-history-start">
            <span><UIcon name="i-lucide-calendar-clock" /></span>
            <div>
              <small>Początek historii</small>
              <strong>{{ oldestHistoryItem ? formatDateTime(oldestHistoryItem.date) : formatDateTime(data.data.created_at) }}</strong>
            </div>
          </section>
        </aside>
      </section>
    </template>

    <UModal
      v-model:open="createCaseOpen"
      title="Nowa sprawa"
      description="Klient zostanie przypisany do sprawy automatycznie."
      :dismissible="!savingCase"
      :ui="{ footer: 'justify-end' }"
      @after:leave="!savingCase && (caseForm.title = '')"
    >
      <template #body>
        <form id="client-create-case-form" class="client-modal-form" @submit.prevent="createCase">
          <UFormField label="Nazwa sprawy" required>
            <UInput
              v-model="caseForm.title"
              class="w-full"
              autofocus
              :maxlength="200"
              placeholder="Zakup mieszkania — Kowalscy"
            />
          </UFormField>
          <div class="client-case-assignment">
            <span>{{ clientInitials }}</span>
            <div>
              <strong>{{ data.data.display_name }}</strong>
              <small>Zostanie dodany jako klient główny</small>
            </div>
            <UIcon name="i-lucide-circle-check" />
          </div>
        </form>
      </template>
      <template #footer="{ close }">
        <UButton color="neutral" variant="outline" :disabled="savingCase" @click="close">Anuluj</UButton>
        <UButton
          type="submit"
          form="client-create-case-form"
          icon="i-lucide-folder-plus"
          :loading="savingCase"
          :disabled="!caseForm.title.trim()"
        >
          Utwórz sprawę
        </UButton>
      </template>
    </UModal>

    <UModal
      v-model:open="editOpen"
      title="Edytuj dane klienta"
      description="Zmień dane używane w sprawach, wizytach i bieżącej komunikacji."
      :dismissible="!savingClient"
      :ui="{ footer: 'justify-end' }"
    >
      <template #body>
        <form id="client-edit-form" class="client-modal-form" @submit.prevent="saveClient">
          <UFormField label="Nazwa klienta" required>
            <UInput v-model="editForm.display_name" class="w-full" :maxlength="200" />
          </UFormField>
          <div class="client-modal-form__grid">
            <UFormField label="E-mail">
              <UInput v-model="editForm.primary_email" class="w-full" type="email" icon="i-lucide-mail" />
            </UFormField>
            <UFormField label="Telefon">
              <UInput v-model="editForm.primary_phone" class="w-full" icon="i-lucide-phone" />
            </UFormField>
          </div>
          <UFormField label="Tagi" description="Oddziel tagi przecinkami.">
            <UInput v-model="editForm.tags" class="w-full" icon="i-lucide-tags" placeholder="premium, polecenie" />
          </UFormField>
          <UFormField label="Notatka">
            <UTextarea v-model="editForm.notes" class="w-full" :rows="4" autoresize :maxrows="8" />
          </UFormField>
        </form>
      </template>
      <template #footer="{ close }">
        <UButton color="neutral" variant="outline" :disabled="savingClient" @click="close">Anuluj</UButton>
        <UButton
          type="submit"
          form="client-edit-form"
          icon="i-lucide-save"
          :loading="savingClient"
          :disabled="!editForm.display_name.trim()"
        >
          Zapisz zmiany
        </UButton>
      </template>
    </UModal>
  </CrmShell>
</template>

<style scoped>
.client-header-meta,
.client-header-meta > span,
.client-metric,
.client-panel__header,
.client-profile,
.client-data-list dt,
.related-people article,
.recent-activity article,
.client-case-row,
.client-case-row__facts,
.client-appointment-row,
.client-appointment-row__expert,
.client-timeline__item article > header,
.client-timeline__item article > footer,
.client-history-summary dl div,
.client-history-start,
.client-case-assignment {
  display: flex;
  align-items: center;
}

.client-header-meta {
  flex-wrap: wrap;
  gap: 10px;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.client-header-meta > span {
  gap: 4px;
}

.client-header-meta strong {
  color: var(--ui-text-toned);
  font-weight: 600;
}

.client-header-meta__separator {
  width: 1px;
  height: 14px;
  background: var(--ui-border);
}

.client-loading,
.client-panel-stack,
.client-modal-form {
  display: grid;
  gap: 18px;
}

.client-loading__metrics,
.client-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.client-loading__body {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(300px, .75fr);
  gap: 18px;
}

.client-overview {
  display: grid;
  gap: 18px;
}

.client-metric,
.client-panel,
.client-workspace {
  border: 1px solid var(--ui-border);
  background: var(--ui-bg);
}

.client-metric {
  position: relative;
  gap: 12px;
  min-width: 0;
  min-height: 104px;
  padding: 18px;
  border-radius: var(--ui-radius);
}

.client-metric__icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  border-radius: 10px;
  color: var(--ui-text-highlighted);
  background: var(--ui-bg-elevated);
}

.client-metric__icon svg {
  width: 18px;
  height: 18px;
}

.client-metric > div {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.client-metric strong {
  color: var(--ui-text-highlighted);
  font-size: 24px;
  font-weight: 650;
  line-height: 1;
}

.client-metric span {
  color: var(--ui-text-toned);
  font-size: 12px;
}

.client-metric small {
  position: absolute;
  right: 14px;
  bottom: 12px;
  color: var(--ui-text-muted);
  font-size: 10px;
}

.client-overview__grid {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(300px, .75fr);
  align-items: start;
  gap: 18px;
}

.client-panel {
  min-width: 0;
  padding: 22px;
  border-radius: var(--ui-radius);
}

.client-panel__header,
.workspace-heading {
  justify-content: space-between;
  gap: 18px;
}

.client-panel__header {
  margin-bottom: 20px;
}

.client-panel__header > div,
.workspace-heading > div {
  min-width: 0;
}

.client-panel__header p,
.workspace-heading p {
  margin: 0 0 4px;
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: .06em;
  text-transform: uppercase;
}

.client-panel__header h2,
.workspace-heading h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 18px;
  font-weight: 650;
}

.workspace-heading h2 {
  font-size: 22px;
}

.workspace-heading > div > span {
  display: block;
  margin-top: 5px;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.client-profile {
  gap: 14px;
  padding: 0 0 20px;
  border-bottom: 1px solid var(--ui-border);
}

.client-avatar {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  flex: 0 0 auto;
  border-radius: 14px;
  color: var(--ui-text-inverted);
  background: var(--ui-bg-inverted);
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 650;
}

.client-profile__identity {
  display: grid;
  gap: 2px;
}

.client-profile__identity strong {
  color: var(--ui-text-highlighted);
  font-size: 16px;
  font-weight: 650;
}

.client-profile__identity span {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.client-data-list,
.client-context-list,
.client-history-summary dl {
  display: grid;
  gap: 0;
  margin: 0;
}

.client-data-list {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 24px;
}

.client-data-list > div,
.client-context-list > div {
  display: grid;
  gap: 7px;
  padding: 16px 0;
  border-bottom: 1px solid var(--ui-border-muted);
}

.client-data-list > div:nth-last-child(-n + 2) {
  border-bottom: 0;
  padding-bottom: 0;
}

.client-data-list dt,
.client-context-list dt {
  gap: 7px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.client-data-list dt svg {
  width: 14px;
  height: 14px;
}

.client-data-list dd,
.client-context-list dd {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 550;
}

.client-data-list a {
  color: inherit;
  text-decoration: none;
}

.client-data-list a:hover {
  text-decoration: underline;
}

.related-people,
.recent-activity {
  display: grid;
}

.related-people article {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--ui-border-muted);
}

.related-people article:first-child {
  padding-top: 0;
}

.related-people article:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.related-people article > span,
.recent-activity article > span {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  color: var(--ui-text-muted);
  background: var(--ui-bg-elevated);
}

.related-people article > div,
.recent-activity article > div {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.related-people strong,
.recent-activity strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 600;
}

.related-people small,
.recent-activity small {
  color: var(--ui-text-muted);
  font-size: 11px;
}

.related-people article > p {
  max-width: 240px;
  margin: 0;
  overflow: hidden;
  color: var(--ui-text-toned);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.client-context-list > div {
  grid-template-columns: 82px minmax(0, 1fr);
  align-items: start;
}

.client-context-list > div:first-child {
  padding-top: 0;
}

.client-context-list > div:last-child {
  border-bottom: 0;
}

.client-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.client-note {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-top: 12px;
  padding: 13px;
  border-radius: 10px;
  color: var(--ui-text-toned);
  background: var(--ui-bg-elevated);
}

.client-note > span {
  flex: 0 0 auto;
  color: var(--ui-text-muted);
}

.client-note p {
  margin: 0;
  font-size: 12px;
  line-height: 1.55;
}

.recent-activity article {
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--ui-border-muted);
}

.recent-activity article:first-child {
  padding-top: 0;
}

.recent-activity article:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.client-workspace {
  min-height: 360px;
  padding: 26px;
  border-radius: var(--ui-radius);
}

.workspace-heading {
  display: flex;
  align-items: flex-start;
  margin-bottom: 24px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--ui-border);
}

.client-case-list,
.client-appointment-list {
  display: grid;
}

.client-case-row {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto 20px;
  gap: 14px;
  min-height: 78px;
  padding: 14px 8px;
  border-bottom: 1px solid var(--ui-border-muted);
  color: inherit;
  text-decoration: none;
}

.client-case-row:first-child {
  padding-top: 2px;
}

.client-case-row:last-child {
  border-bottom: 0;
}

.client-case-row:hover .client-case-row__title strong,
.client-case-row:hover .client-case-row__arrow {
  color: var(--ui-primary);
}

.client-case-row__icon {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 11px;
  color: var(--ui-text-toned);
  background: var(--ui-bg-elevated);
}

.client-case-row__title {
  display: grid;
  gap: 4px;
}

.client-case-row__title strong {
  color: var(--ui-text-highlighted);
  font-size: 14px;
  font-weight: 650;
  transition: color var(--oe-motion-fast);
}

.client-case-row__title span,
.client-case-row__facts span {
  color: var(--ui-text-muted);
  font-size: 11px;
}

.client-case-row__facts {
  justify-content: flex-end;
  gap: 16px;
}

.client-case-row__facts > span {
  display: flex;
  align-items: center;
  gap: 5px;
}

.client-case-row__arrow {
  color: var(--ui-text-muted);
  transition: color var(--oe-motion-fast);
}

.client-consent-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.client-consent-card {
  display: grid;
  gap: 16px;
  min-width: 0;
  padding: 18px;
  border: 1px solid var(--ui-border-muted);
  border-radius: 12px;
  background: var(--ui-bg-muted);
}

.client-consent-card header {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
}

.client-consent-card__icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 10px;
  color: var(--ui-text-toned);
  background: var(--ui-bg-elevated);
}

.client-consent-card header > div {
  display: grid;
  gap: 3px;
}

.client-consent-card strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 650;
}

.client-consent-card small,
.client-consent-card footer {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.client-consent-card > p {
  display: -webkit-box;
  min-height: 38px;
  margin: 0;
  overflow: hidden;
  color: var(--ui-text-toned);
  font-size: 12px;
  line-height: 1.55;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.client-consent-card footer {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--ui-border-muted);
}

.client-appointment-row {
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr) minmax(180px, auto) auto;
  gap: 16px;
  min-height: 84px;
  padding: 14px 8px;
  border-bottom: 1px solid var(--ui-border-muted);
}

.client-appointment-row:last-child {
  border-bottom: 0;
}

.client-appointment-row__date {
  display: grid;
  place-items: center;
  align-content: center;
  width: 52px;
  height: 52px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  text-transform: uppercase;
}

.client-appointment-row__date strong {
  color: var(--ui-text-highlighted);
  font-size: 17px;
  line-height: 1;
}

.client-appointment-row__date span {
  margin-top: 4px;
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 9px;
}

.client-appointment-row__body {
  display: grid;
  gap: 4px;
}

.client-appointment-row__body strong {
  color: var(--ui-text-highlighted);
  font-size: 14px;
  font-weight: 650;
}

.client-appointment-row__body span,
.client-appointment-row__expert {
  color: var(--ui-text-muted);
  font-size: 11px;
}

.client-appointment-row__expert {
  gap: 7px;
}

.client-history-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  align-items: start;
  gap: 18px;
}

.client-history-summary {
  display: grid;
  gap: 12px;
}

.client-history-summary dl div {
  justify-content: space-between;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--ui-border-muted);
}

.client-history-summary dl div:first-child {
  padding-top: 0;
}

.client-history-summary dl div:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.client-history-summary dt {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.client-history-summary dd {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-family: var(--font-mono);
  font-size: 12px;
}

.client-history-start {
  gap: 12px;
}

.client-history-start > span {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  border-radius: 10px;
  color: var(--ui-text-muted);
  background: var(--ui-bg-elevated);
}

.client-history-start > div {
  display: grid;
  gap: 3px;
}

.client-history-start small {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.client-history-start strong {
  color: var(--ui-text-highlighted);
  font-size: 11px;
  font-weight: 600;
}

.client-timeline {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.client-timeline__item {
  position: relative;
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  gap: 14px;
  min-width: 0;
  padding-bottom: 22px;
}

.client-timeline__item::before {
  position: absolute;
  top: 40px;
  bottom: 0;
  left: 19px;
  width: 1px;
  background: var(--ui-border);
  content: "";
}

.client-timeline__item:last-child {
  padding-bottom: 0;
}

.client-timeline__item:last-child::before {
  display: none;
}

.client-timeline__marker {
  z-index: 1;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  color: var(--ui-text-muted);
  background: var(--ui-bg-elevated);
}

.client-timeline__item--success .client-timeline__marker {
  color: var(--ui-success);
}

.client-timeline__item--warning .client-timeline__marker {
  color: var(--ui-warning);
}

.client-timeline__item--error .client-timeline__marker {
  color: var(--ui-error);
}

.client-timeline__item article {
  min-width: 0;
  padding: 14px 16px;
  border: 1px solid var(--ui-border-muted);
  border-radius: 12px;
  background: var(--ui-bg-muted);
}

.client-timeline__item article > header {
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.client-timeline__item article > header > div {
  display: grid;
  gap: 3px;
}

.client-timeline__item article small {
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: .04em;
  text-transform: uppercase;
}

.client-timeline__item article strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 650;
}

.client-timeline__item time {
  color: var(--ui-text-muted);
  font-size: 10px;
  white-space: nowrap;
}

.client-timeline__item article > p {
  margin: 9px 0 12px;
  color: var(--ui-text-toned);
  font-size: 12px;
  line-height: 1.5;
}

.client-timeline__item article > footer {
  gap: 5px;
  color: var(--ui-text-muted);
  font-size: 10px;
}

.client-empty {
  color: var(--ui-text-muted);
}

.client-empty--compact {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 48px;
  font-size: 12px;
}

.client-empty--workspace {
  display: grid;
  place-items: center;
  min-height: 260px;
  text-align: center;
}

.client-empty--workspace > span {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  margin-bottom: 12px;
  border-radius: 14px;
  color: var(--ui-text-toned);
  background: var(--ui-bg-elevated);
}

.client-empty--workspace h3 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 16px;
  font-weight: 650;
}

.client-empty--workspace p {
  max-width: 420px;
  margin: 6px 0 16px;
  font-size: 12px;
  line-height: 1.5;
}

.client-modal-form {
  gap: 16px;
}

.client-modal-form__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.client-case-assignment {
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--ui-border-muted);
  border-radius: 10px;
  background: var(--ui-bg-muted);
}

.client-case-assignment > span {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  border-radius: 10px;
  color: var(--ui-text-inverted);
  background: var(--ui-bg-inverted);
  font-family: var(--font-mono);
  font-size: 10px;
}

.client-case-assignment > div {
  display: grid;
  flex: 1;
  gap: 2px;
}

.client-case-assignment strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
  font-weight: 600;
}

.client-case-assignment small {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.client-case-assignment > svg {
  color: var(--ui-success);
}

@media (max-width: 1180px) {
  .client-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .client-overview__grid,
  .client-loading__body,
  .client-history-layout {
    grid-template-columns: 1fr;
  }

  .client-history-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 820px) {
  .client-loading__metrics,
  .client-metrics,
  .client-consent-grid {
    grid-template-columns: 1fr;
  }

  .client-data-list {
    grid-template-columns: 1fr;
  }

  .client-data-list > div:nth-last-child(-n + 2) {
    border-bottom: 1px solid var(--ui-border-muted);
    padding-bottom: 16px;
  }

  .client-data-list > div:last-child {
    border-bottom: 0;
    padding-bottom: 0;
  }

  .client-case-row {
    grid-template-columns: 42px minmax(0, 1fr) 20px;
  }

  .client-case-row__facts {
    display: none;
  }

  .client-appointment-row {
    grid-template-columns: 58px minmax(0, 1fr) auto;
  }

  .client-appointment-row__expert {
    display: none;
  }
}

@media (max-width: 620px) {
  .client-header-meta__separator {
    display: none;
  }

  .client-workspace,
  .client-panel {
    padding: 18px;
  }

  .workspace-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .related-people article {
    grid-template-columns: 36px minmax(0, 1fr);
  }

  .related-people article > p {
    grid-column: 2;
  }

  .client-history-summary,
  .client-modal-form__grid {
    grid-template-columns: 1fr;
  }

  .client-timeline__item article > header {
    align-items: flex-start;
    flex-direction: column;
    gap: 7px;
  }

  .client-consent-card header {
    grid-template-columns: 38px minmax(0, 1fr);
  }

  .client-consent-card header > :last-child {
    grid-column: 2;
    justify-self: start;
  }
}
</style>
