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
const statusFilter = ref<ConsentStatus | 'all'>('all')

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

const { data, status, error, refresh } = await useFetch<ConsentPayload>(
  () => crmApiPath('/consents'),
  { default: (): ConsentPayload => ({ role: 'expert', canManage: false, definitions: [] }) },
)

const pending = computed(() => status.value === 'pending')
const showHistory = computed(() => route.query.view === 'history')
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
const tabs = computed(() => [
  { label: 'Definicje', to: orgPath('/consents') },
  { label: 'Historia zmian', to: orgPath('/consents?view=history') },
])

function currentVersionFor(definition: ConsentDefinition): ConsentVersion | null {
  return definition.current_version
    ?? definition.versions.find(version => version.id === definition.current_version_id)
    ?? null
}

function definitionTitle(definition: ConsentDefinition) {
  const version = currentVersionFor(definition)
  return version?.display_title || version?.internal_name || definition.code
}

const definitions = computed(() => [...data.value.definitions].sort((left, right) => {
  const order = (currentVersionFor(left)?.sort_order ?? 0) - (currentVersionFor(right)?.sort_order ?? 0)
  return order || definitionTitle(left).localeCompare(definitionTitle(right), 'pl')
}))

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
    const matchesStatus = statusFilter.value === 'all' || version?.status === statusFilter.value
    return matchesSearch && matchesChannel && matchesStatus
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
  .sort((left, right) => Date.parse(right.version.created_at) - Date.parse(left.version.created_at)))

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

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Nieznana data'
  return new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function clearFilters() {
  search.value = ''
  channelFilter.value = 'all'
  statusFilter.value = 'all'
}
</script>

<template>
  <CrmShell
    title="Zgody"
    eyebrow="Panel prawny"
    description="Definicje i niezmienne wersje treści używanych w procesach CRM."
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
      :description="`Możesz przeglądać definicje i ich historię. Edycja wymaga roli administratora (bieżąca rola: ${data.role}).`"
    />

    <div class="consent-index">
    <section class="legal-review" aria-label="Informacja prawna">
      <UIcon name="i-lucide-scale" />
      <div>
        <strong>Zestaw startowy wymaga zatwierdzenia prawnego</strong>
        <p>Przed użyciem produkcyjnym potwierdź zakres produktów, kanały i podstawy prawne z prawnikiem lub IOD.</p>
      </div>
    </section>

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
        v-model="statusFilter"
        :items="statusItems"
        aria-label="Filtruj według statusu"
      />
      <span class="consent-toolbar__count">
        {{ visibleCount }} {{ visibleCountLabel }}
      </span>
    </div>

    <div v-if="pending && !definitions.length" class="consent-skeleton">
      <USkeleton class="h-14 w-full" />
      <USkeleton v-for="index in 3" :key="index" class="h-20 w-full" />
    </div>

    <template v-else-if="showHistory">
      <section v-if="visibleHistory.length" class="consent-register consent-register--history" aria-label="Historia zmian zgód">
        <div class="consent-register__head" aria-hidden="true">
          <span>Zgoda</span>
          <span>Wersja</span>
          <span>Status</span>
          <span>Utworzona</span>
          <span>Notatka</span>
          <span />
        </div>

        <NuxtLink
          v-for="{ definition, version } in visibleHistory"
          :key="version.id"
          :to="`${orgPath(`/consents/${definition.id}`)}#history`"
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
            <span class="consent-register__field" data-label="Utworzona">{{ formatDateTime(version.created_at) }}</span>
            <span class="consent-register__field consent-register__note" data-label="Notatka">{{ version.change_note || 'Bez notatki do zmiany' }}</span>
          </span>
          <span class="consent-register__open" aria-hidden="true"><UIcon name="i-lucide-chevron-right" /></span>
        </NuxtLink>
      </section>
    </template>

    <template v-else>
      <section v-if="visibleDefinitions.length" class="consent-register" aria-label="Definicje zgód">
        <div class="consent-register__head" aria-hidden="true">
          <span>Zgoda</span>
          <span>Kanał</span>
          <span>Status</span>
          <span>Wymagalność</span>
          <span>Aktualna wersja</span>
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
            <span class="consent-register__field" data-label="Kanał">{{ channelLabel(currentVersionFor(definition)?.channel || 'other') }}</span>
            <span class="consent-register__field" data-label="Status">
              <UBadge
                v-if="currentVersionFor(definition)"
                :color="statusColor(currentVersionFor(definition)!.status)"
                variant="subtle"
              >
                {{ statusLabel(currentVersionFor(definition)!.status) }}
              </UBadge>
            </span>
            <span class="consent-register__field" data-label="Wymagalność">{{ requirementLabel(currentVersionFor(definition)?.is_required || false) }}</span>
            <span class="consent-register__field" data-label="Aktualna wersja">v{{ currentVersionFor(definition)?.version || '—' }}</span>
          </span>
          <span class="consent-register__open" aria-hidden="true"><UIcon name="i-lucide-chevron-right" /></span>
        </NuxtLink>
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

    <p v-if="showHistory ? visibleHistory.length : visibleDefinitions.length" class="consent-helper">
      <UIcon name="i-lucide-info" />
      <span v-if="showHistory">Wybierz wersję, aby przejść do pełnej historii zgody.</span>
      <span v-else>Wybierz zgodę, aby zobaczyć treść, ustawienia i historię wersji.</span>
    </p>
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

.legal-review {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  margin-bottom: 24px;
  padding: 16px 18px;
  border: 1px solid color-mix(in srgb, var(--ui-warning) 35%, var(--ui-border));
  border-radius: var(--oe-radius-surface);
  background: color-mix(in srgb, var(--ui-warning) 9%, var(--ui-bg));
  color: var(--ui-warning);
}

.legal-review > .iconify {
  flex: 0 0 auto;
  width: 21px;
  height: 21px;
  margin-top: 1px;
}

.legal-review strong {
  color: var(--ui-warning);
  font-size: 14px;
}

.legal-review p {
  margin: 3px 0 0;
  color: color-mix(in srgb, var(--ui-warning) 80%, var(--ui-text));
  font-size: 13px;
}

.consent-toolbar {
  display: grid;
  grid-template-columns: minmax(260px, 1.35fr) minmax(170px, .65fr) minmax(170px, .65fr) auto;
  gap: 12px;
  align-items: center;
  margin-bottom: 18px;
}

.consent-toolbar__search {
  width: 100%;
}

.consent-toolbar :deep(button[role='combobox']) {
  width: 100%;
}

.consent-toolbar__count {
  min-width: 72px;
  color: var(--ui-text-muted);
  font-size: 13px;
  text-align: right;
  white-space: nowrap;
}

.consent-skeleton {
  display: grid;
  gap: 8px;
}

.consent-register {
  overflow: hidden;
  border-top: 1px solid var(--ui-border);
  border-bottom: 1px solid var(--ui-border);
}

.consent-register__head,
.consent-register__row {
  display: grid;
  grid-template-columns: minmax(240px, 1.45fr) minmax(140px, .8fr) minmax(140px, .75fr) minmax(130px, .7fr) minmax(110px, .55fr) 44px;
  gap: 18px;
  align-items: center;
}

.consent-register__head {
  min-height: 48px;
  padding: 0 18px;
  color: var(--ui-text-muted);
  font-size: 12px;
  font-weight: 600;
}

.consent-register__row {
  min-height: 84px;
  padding: 14px 18px;
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
}

.consent-register--history .consent-register__head,
.consent-register__row--history {
  grid-template-columns: minmax(220px, 1.2fr) 70px 140px 180px minmax(180px, 1fr) 44px;
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

.consent-helper {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 18px 0 0;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.consent-helper .iconify {
  flex: 0 0 auto;
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

@container consent-index (max-width: 1040px) {
  .consent-toolbar {
    grid-template-columns: minmax(240px, 1fr) repeat(2, minmax(160px, .65fr));
  }

  .consent-toolbar__count {
    grid-column: 1 / -1;
    text-align: left;
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
}

@container consent-index (max-width: 620px) {
  .consent-toolbar {
    grid-template-columns: 1fr;
  }
  .consent-toolbar__count {
    grid-column: auto;
  }
  .consent-register__details {
    grid-template-columns: 1fr;
  }
  .legal-review p {
    line-height: 1.5;
  }
}
</style>
