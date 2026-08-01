<script setup lang="ts">
import type {
  ConsentChannel,
  ConsentDefinition,
  ConsentPayload,
  ConsentStatus,
  ConsentVersion,
} from '~/types/consents'

definePageMeta({ middleware: ['auth', 'organization'] })
useHead({ title: 'Zgody — OpenExpert CRM' })

const route = useRoute()
const { crmApiPath, orgPath } = useOrganizationContext()
const search = ref('')
const channelFilter = ref<ConsentChannel | 'all'>('all')
const requirementFilter = ref<'all' | 'required' | 'optional'>('all')
const statusFilter = ref<ConsentStatus | 'all'>('all')
const sortMode = ref<'updated_desc' | 'title_asc' | 'version_desc'>('updated_desc')

const channelItems: Array<{ label: string, value: ConsentChannel | 'all' }> = [
  { label: 'Wszystkie kanały', value: 'all' },
  { label: 'E-mail', value: 'email' },
  { label: 'SMS / MMS', value: 'sms' },
  { label: 'Połączenie telefoniczne', value: 'phone' },
  { label: 'Komunikator', value: 'messaging' },
  { label: 'Inny kanał', value: 'other' },
]

const statusItems: Array<{ label: string, value: ConsentStatus | 'all' }> = [
  { label: 'Wszystkie statusy', value: 'all' },
  { label: 'Opublikowane', value: 'published' },
  { label: 'Wersje robocze', value: 'draft' },
  { label: 'Zarchiwizowane', value: 'archived' },
]

const requirementItems: Array<{ label: string, value: 'all' | 'required' | 'optional' }> = [
  { label: 'Każda wymagalność', value: 'all' },
  { label: 'Wymagane', value: 'required' },
  { label: 'Dobrowolne', value: 'optional' },
]

const sortItems: Array<{ label: string, value: 'updated_desc' | 'title_asc' | 'version_desc' }> = [
  { label: 'Ostatnio zmienione', value: 'updated_desc' },
  { label: 'Nazwa A–Z', value: 'title_asc' },
  { label: 'Najnowsza publikacja', value: 'version_desc' },
]

const { data, status, error, refresh } = await useFetch<ConsentPayload>(
  () => crmApiPath('/consents'),
  { default: (): ConsentPayload => ({ role: 'expert', canManage: false, canPublish: false, canAudit: false, definitions: [] }) },
)

const pending = computed(() => status.value === 'pending')
const currentView = computed<'active' | 'draft' | 'archived' | 'history'>(() => {
  if (route.query.view === 'draft') return 'draft'
  if (route.query.view === 'archived') return 'archived'
  if (route.query.view === 'history') return 'history'
  return 'active'
})
const showHistory = computed(() => currentView.value === 'history')
const currentDefinitionStatus = computed<ConsentStatus>(() => {
  if (currentView.value === 'draft') return 'draft'
  if (currentView.value === 'archived') return 'archived'
  return 'published'
})
const visibleCount = computed(() => showHistory.value ? visibleHistory.value.length : visibleDefinitions.value.length)
const visibleCountLabel = computed(() => {
  const count = visibleCount.value
  if (showHistory.value) {
    if (count === 1) return 'wersja'
    if (count >= 2 && count <= 4) return 'wersje'
    return 'wersji'
  }
  if (count === 1) return 'zgoda'
  if (count >= 2 && count <= 4) return 'zgody'
  return 'zgód'
})

function currentVersionFor(definition: ConsentDefinition): ConsentVersion | null {
  return definition.current_version
    ?? definition.versions.find(version => version.id === definition.current_version_id)
    ?? null
}

function definitionTitle(definition: ConsentDefinition) {
  const version = currentVersionFor(definition)
  return version?.display_title || version?.internal_name || definition.code
}

function isVersionActive(version: ConsentVersion | null) {
  if (!version || version.status !== 'published') return false
  const now = Date.now()
  const effectiveFrom = Date.parse(version.effective_from)
  const effectiveTo = version.effective_to ? Date.parse(version.effective_to) : null
  return Number.isFinite(effectiveFrom)
    && effectiveFrom <= now
    && (effectiveTo === null || (Number.isFinite(effectiveTo) && effectiveTo > now))
}

const definitions = computed(() => [...data.value.definitions].sort((left, right) => {
  const order = (currentVersionFor(left)?.sort_order ?? 0) - (currentVersionFor(right)?.sort_order ?? 0)
  return order || definitionTitle(left).localeCompare(definitionTitle(right), 'pl')
}))

const definitionCounts = computed(() => definitions.value.reduce<Record<ConsentStatus, number>>((counts, definition) => {
  const version = currentVersionFor(definition)
  if (version) counts[version.status] += 1
  return counts
}, { published: 0, draft: 0, archived: 0 }))

const activeDefinitionCount = computed(() => definitions.value.filter(definition => (
  isVersionActive(currentVersionFor(definition))
)).length)

const historyCount = computed(() => definitions.value.reduce((count, definition) => count + definition.versions.length, 0))

const tabs = computed(() => [
  {
    label: 'Aktywne',
    icon: 'i-lucide-shield-check',
    count: activeDefinitionCount.value,
    to: orgPath('/consents'),
    active: currentView.value === 'active',
  },
  {
    label: 'Wersje robocze',
    icon: 'i-lucide-file-pen-line',
    count: definitionCounts.value.draft,
    to: orgPath('/consents?view=draft'),
    active: currentView.value === 'draft',
  },
  {
    label: 'Archiwalne',
    icon: 'i-lucide-archive',
    count: definitionCounts.value.archived,
    to: orgPath('/consents?view=archived'),
    active: currentView.value === 'archived',
  },
  {
    label: 'Historia wersji',
    icon: 'i-lucide-history',
    count: historyCount.value,
    to: orgPath('/consents?view=history'),
    active: currentView.value === 'history',
  },
])

const visibleDefinitions = computed(() => {
  const query = search.value.trim().toLocaleLowerCase('pl')
  return definitions.value.filter((definition) => {
    const version = currentVersionFor(definition)
    const matchesSearch = !query || [
      definition.code,
      version?.internal_name,
      version?.display_title,
      version?.purpose,
    ].some(value => String(value ?? '').toLocaleLowerCase('pl').includes(query))
    const matchesChannel = channelFilter.value === 'all' || version?.channel === channelFilter.value
    const matchesRequirement = requirementFilter.value === 'all'
      || (requirementFilter.value === 'required' ? version?.is_required : !version?.is_required)
    const matchesLifecycle = currentView.value === 'active'
      ? isVersionActive(version)
      : version?.status === currentDefinitionStatus.value
    return matchesSearch
      && matchesChannel
      && matchesRequirement
      && matchesLifecycle
  }).sort((left, right) => {
    if (sortMode.value === 'title_asc') return definitionTitle(left).localeCompare(definitionTitle(right), 'pl')
    if (sortMode.value === 'version_desc') {
      return (currentVersionFor(right)?.version ?? 0) - (currentVersionFor(left)?.version ?? 0)
    }
    return Date.parse(right.updated_at) - Date.parse(left.updated_at)
  })
})

const visibleHistory = computed(() => definitions.value
  .flatMap(definition => definition.versions.map(version => ({ definition, version })))
  .filter(({ definition, version }) => {
    const query = search.value.trim().toLocaleLowerCase('pl')
    const matchesSearch = !query || [
      definition.code,
      version.internal_name,
      version.display_title,
      version.change_note,
    ].some(value => String(value ?? '').toLocaleLowerCase('pl').includes(query))
    const matchesChannel = channelFilter.value === 'all' || version.channel === channelFilter.value
    const matchesStatus = statusFilter.value === 'all' || version.status === statusFilter.value
    return matchesSearch && matchesChannel && matchesStatus
  })
  .sort((left, right) => {
    if (sortMode.value === 'title_asc') {
      return left.version.display_title.localeCompare(right.version.display_title, 'pl')
    }
    if (sortMode.value === 'version_desc') {
      return Date.parse(right.version.created_at) - Date.parse(left.version.created_at)
    }
    return Date.parse(right.version.created_at) - Date.parse(left.version.created_at)
  }))

function channelLabel(channel: ConsentChannel) {
  return channelItems.find(item => item.value === channel)?.label ?? channel
}

function statusLabel(value: ConsentStatus) {
  return statusItems.find(item => item.value === value)?.label
    ?.replace('Opublikowane', 'Opublikowana')
    .replace('Wersje robocze', 'Wersja robocza')
    .replace('Zarchiwizowane', 'Zarchiwizowana') ?? value
}

function statusColor(value: ConsentStatus): 'success' | 'warning' | 'neutral' {
  if (value === 'published') return 'success'
  if (value === 'draft') return 'warning'
  return 'neutral'
}

function requirementLabel(isRequired: boolean) {
  return isRequired ? 'Wymagana' : 'Dobrowolna'
}

function contextLabel(context: string) {
  if (context === 'client_creation') return 'Dodawanie klienta'
  return context.replaceAll('_', ' ')
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Nieznana data'
  return new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Nieznana data'
  return new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function clearFilters() {
  search.value = ''
  channelFilter.value = 'all'
  requirementFilter.value = 'all'
  statusFilter.value = 'all'
  sortMode.value = 'updated_desc'
}
</script>

<template>
  <CrmShell
    title="Zgody"
    eyebrow="Compliance"
    description="Definicje zgód używanych w procesach organizacji."
    :tabs="tabs"
  >
    <template #actions>
      <UButton
        v-if="data.canManage"
        :to="orgPath('/consents/new')"
        icon="i-lucide-plus"
        variant="solid"
      >
        Nowa zgoda
      </UButton>
      <UButton
        icon="i-lucide-refresh-cw"
        variant="outline"
        square
        :loading="pending"
        aria-label="Odśwież zgody"
        title="Odśwież"
        @click="refresh()"
      />
    </template>

    <UAlert
      v-if="error"
      class="consent-state"
      color="error"
      variant="subtle"
      icon="i-lucide-database"
      title="Nie udało się pobrać definicji zgód"
      description="Sprawdź połączenie i spróbuj ponownie."
    >
      <template #actions>
        <UButton variant="ghost" icon="i-lucide-refresh-cw" @click="refresh()">Ponów</UButton>
      </template>
    </UAlert>

    <UAlert
      v-else-if="!pending && !data.canManage"
      class="consent-state"
      color="warning"
      variant="subtle"
      icon="i-lucide-shield-alert"
      title="Panel w trybie tylko do odczytu"
      description="Możesz przeglądać definicje i ich historię. Edycja wymaga uprawnienia do zarządzania zgodami compliance."
    />

    <div class="consent-index">
      <p class="consent-version-rule">
        <UIcon name="i-lucide-info" />
        <span>Publikacja nowej treści tworzy niezmienną wersję zgody.</span>
      </p>

      <div class="consent-toolbar">
        <UInput
          v-model="search"
          class="consent-toolbar__search"
          icon="i-lucide-search"
          placeholder="Szukaj po nazwie lub kodzie"
          aria-label="Szukaj zgody"
        />
        <USelect
          v-model="channelFilter"
          :items="channelItems"
          aria-label="Filtruj według kanału"
        />
        <USelect
          v-if="showHistory"
          v-model="statusFilter"
          :items="statusItems"
          aria-label="Filtruj według statusu wersji"
        />
        <USelect
          v-else
          v-model="requirementFilter"
          :items="requirementItems"
          aria-label="Filtruj według wymagalności"
        />
        <USelect
          v-model="sortMode"
          :items="sortItems"
          aria-label="Sortuj rejestr zgód"
        />
      </div>

      <div v-if="pending && !definitions.length" class="consent-skeleton">
        <USkeleton class="h-14 w-full" />
        <USkeleton v-for="index in 3" :key="index" class="h-20 w-full" />
      </div>

      <template v-else-if="showHistory">
        <section v-if="visibleHistory.length" class="consent-register consent-register--history" aria-label="Historia wersji zgód">
          <div class="consent-register__head" aria-hidden="true">
            <span>Zgoda</span>
            <span>Wersja</span>
            <span>Status</span>
            <span>Kanał</span>
            <span>Utworzona</span>
            <span>Notatka</span>
            <span />
          </div>

          <NuxtLink
            v-for="{ definition, version } in visibleHistory"
            :key="version.id"
            :to="orgPath(`/consents/${definition.id}?view=history`)"
            class="consent-register__row consent-register__row--history"
          >
            <span class="consent-register__identity">
              <strong>{{ version.display_title }}</strong>
              <small>{{ definition.code }}</small>
            </span>
            <span class="consent-register__details">
              <span class="consent-register__field" data-label="Wersja">v{{ version.version }}</span>
              <span class="consent-register__field" data-label="Status">
                <UBadge :color="statusColor(version.status)" variant="subtle">
                  {{ statusLabel(version.status) }}
                </UBadge>
              </span>
              <span class="consent-register__field" data-label="Kanał">{{ channelLabel(version.channel) }}</span>
              <span class="consent-register__field" data-label="Utworzona">{{ formatDateTime(version.created_at) }}</span>
              <span class="consent-register__field consent-register__note" data-label="Notatka">{{ version.change_note || 'Bez notatki do zmiany' }}</span>
            </span>
            <span class="consent-register__open" aria-hidden="true"><UIcon name="i-lucide-chevron-right" /></span>
          </NuxtLink>

          <footer class="consent-register__footer" aria-live="polite">
            {{ visibleCount }} {{ visibleCountLabel }} w historii
          </footer>
        </section>
      </template>

      <template v-else>
        <section v-if="visibleDefinitions.length" class="consent-register" aria-label="Definicje zgód">
          <div class="consent-register__head" aria-hidden="true">
            <span>Zgoda</span>
            <span>Kontekst</span>
            <span>Kanał</span>
            <span>Wymagalność</span>
            <span>Status</span>
            <span>Aktualna wersja</span>
            <span>Zmieniono</span>
            <span />
          </div>

          <NuxtLink
            v-for="definition in visibleDefinitions"
            :key="definition.id"
            :to="orgPath(`/consents/${definition.id}`)"
            class="consent-register__row"
          >
            <span class="consent-register__identity">
              <strong>{{ definitionTitle(definition) }}</strong>
              <small>{{ definition.code }}</small>
            </span>
            <span class="consent-register__details">
              <span class="consent-register__field" data-label="Kontekst">{{ contextLabel(definition.context) }}</span>
              <span class="consent-register__field" data-label="Kanał">{{ channelLabel(currentVersionFor(definition)?.channel || 'other') }}</span>
              <span class="consent-register__field" data-label="Wymagalność">{{ requirementLabel(currentVersionFor(definition)?.is_required || false) }}</span>
              <span class="consent-register__field" data-label="Status">
                <UBadge
                  v-if="currentVersionFor(definition)"
                  :color="statusColor(currentVersionFor(definition)!.status)"
                  variant="subtle"
                >
                  {{ statusLabel(currentVersionFor(definition)!.status) }}
                </UBadge>
              </span>
              <span class="consent-register__field" data-label="Aktualna wersja">v{{ currentVersionFor(definition)?.version || '—' }}</span>
              <span class="consent-register__field" data-label="Zmieniono">{{ formatDate(definition.updated_at) }}</span>
            </span>
            <span class="consent-register__open" aria-hidden="true"><UIcon name="i-lucide-chevron-right" /></span>
          </NuxtLink>

          <footer class="consent-register__footer" aria-live="polite">
            {{ visibleCount }} {{ visibleCountLabel }}
          </footer>
        </section>
      </template>

      <UCard
        v-if="!pending && !(showHistory ? visibleHistory.length : visibleDefinitions.length)"
        class="consent-empty"
      >
        <UIcon :name="definitions.length ? 'i-lucide-search-x' : 'i-lucide-shield-check'" />
        <h2>{{ definitions.length ? 'Brak pasujących zgód' : 'Brak definicji zgód' }}</h2>
        <p>{{ definitions.length ? 'Zmień wyszukiwanie lub filtry.' : 'Utwórz pierwszą definicję dla procesu dodawania klienta.' }}</p>
        <UButton v-if="definitions.length" variant="outline" @click="clearFilters">Wyczyść filtry</UButton>
        <UButton
          v-else-if="data.canManage"
          :to="orgPath('/consents/new')"
          icon="i-lucide-plus"
          variant="solid"
        >
          Nowa zgoda
        </UButton>
      </UCard>
    </div>
  </CrmShell>
</template>

<style scoped>
.consent-index {
  container-name: consent-index;
  container-type: inline-size;
}

.consent-state {
  margin-bottom: 18px;
}

.consent-version-rule {
  display: flex;
  gap: 9px;
  align-items: center;
  margin: 0 0 22px;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.consent-version-rule > .iconify {
  flex: 0 0 auto;
  width: 17px;
  height: 17px;
}

.consent-toolbar {
  display: grid;
  grid-template-columns: minmax(260px, 1.4fr) repeat(3, minmax(165px, .7fr));
  gap: 12px;
  align-items: center;
  margin-bottom: 20px;
}

.consent-toolbar__search {
  width: 100%;
}

.consent-toolbar :deep(button[role='combobox']) {
  width: 100%;
}

.consent-skeleton {
  display: grid;
  gap: 8px;
}

.consent-register {
  overflow-x: auto;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background: var(--ui-bg);
}

.consent-register__head,
.consent-register__row {
  display: grid;
  grid-template-columns: minmax(210px, 1.35fr) minmax(130px, .85fr) minmax(105px, .65fr) minmax(110px, .7fr) minmax(125px, .75fr) minmax(105px, .6fr) minmax(115px, .7fr) 40px;
  gap: 16px;
  align-items: center;
  min-width: 1080px;
}

.consent-register__head {
  min-height: 54px;
  padding: 0 20px;
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .01em;
}

.consent-register__row {
  min-height: 92px;
  padding: 16px 20px;
  border-top: 1px solid var(--ui-border);
  color: var(--ui-text);
  font-size: 14px;
  text-decoration: none;
  transition:
    background-color var(--oe-motion-fast),
    color var(--oe-motion-fast);
}

.consent-register__row:hover {
  background: var(--ui-bg-elevated);
  color: var(--ui-text-highlighted);
}

.consent-register__identity {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.consent-register__identity strong {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.consent-register__identity small {
  overflow: hidden;
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: .03em;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}

.consent-register__details {
  display: contents;
}

.consent-register__field {
  min-width: 0;
  line-height: 1.45;
}

.consent-register--history .consent-register__head,
.consent-register__row--history {
  grid-template-columns: minmax(220px, 1.25fr) 70px 140px 120px 175px minmax(200px, 1fr) 40px;
  min-width: 1050px;
}

.consent-register__note {
  overflow: hidden;
  color: var(--ui-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.consent-register__open {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  color: var(--ui-text-muted);
  transition: transform var(--oe-motion-fast);
}

.consent-register__row:hover .consent-register__open {
  transform: translateX(3px);
}

.consent-register__footer {
  min-width: 1080px;
  padding: 14px 20px;
  border-top: 1px solid var(--ui-border);
  color: var(--ui-text-muted);
  font-size: 13px;
}

.consent-register--history .consent-register__footer {
  min-width: 1050px;
}

.consent-empty {
  display: grid;
  justify-items: center;
  gap: 10px;
  padding: 48px 24px;
  color: var(--ui-text-muted);
  text-align: center;
}

.consent-empty > .iconify {
  width: 32px;
  height: 32px;
}

.consent-empty h2,
.consent-empty p {
  margin: 0;
}

.consent-empty h2 {
  color: var(--ui-text-highlighted);
  font-size: 22px;
}

@container consent-index (max-width: 940px) {
  .consent-toolbar {
    grid-template-columns: repeat(3, minmax(150px, 1fr));
  }

  .consent-toolbar__search {
    grid-column: 1 / -1;
  }
}

@container consent-index (max-width: 720px) {
  .consent-toolbar {
    grid-template-columns: 1fr;
  }

  .consent-toolbar__search {
    grid-column: auto;
  }

  .consent-register {
    display: grid;
    gap: 10px;
    overflow: visible;
    border: 0;
  }
  .consent-register__head {
    display: none;
  }
  .consent-register__row,
  .consent-register__row--history {
    grid-template-columns: minmax(0, 1fr) 44px;
    gap: 14px;
    min-width: 0;
    min-height: 0;
    padding: 15px;
    border: 1px solid var(--ui-border);
    border-radius: var(--ui-radius);
    background: var(--ui-bg);
  }
  .consent-register__identity { grid-column: 1; grid-row: 1; }
  .consent-register__details {
    display: grid;
    grid-column: 1 / -1;
    grid-row: 2;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px 18px;
    padding-top: 12px;
    border-top: 1px solid var(--ui-border-muted);
  }
  .consent-register__field {
    display: grid;
    align-content: start;
    gap: 4px;
  }
  .consent-register__field::before {
    content: attr(data-label);
    color: var(--ui-text-dimmed);
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: .05em;
    text-transform: uppercase;
  }
  .consent-register__note {
    overflow: visible;
    text-overflow: clip;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .consent-register__open { grid-column: 2; grid-row: 1; }
  .consent-register__footer,
  .consent-register--history .consent-register__footer {
    min-width: 0;
    border: 0;
    text-align: center;
  }
  .consent-register__details {
    grid-template-columns: 1fr;
  }
}
</style>
