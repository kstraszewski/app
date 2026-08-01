<script setup lang="ts">
import type {
  ConsentChannel,
  ConsentDefinition,
  ConsentForm,
  ConsentPayload,
  ConsentStatus,
  ConsentVersion,
} from '~/types/consents'
import { apiErrorMessage } from '~/utils/api-error'

definePageMeta({ middleware: ['auth', 'organization'] })

const route = useRoute()
const { crmApiPath, orgPath } = useOrganizationContext()
const toast = useToast()
const saving = ref(false)
const loadedKey = ref('')
const consentId = computed(() => {
  const value = route.params.consentId
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')
})
const creating = computed(() => consentId.value === 'new')

const channelItems: Array<{ label: string, value: ConsentChannel }> = [
  { label: 'E-mail', value: 'email' },
  { label: 'SMS / MMS', value: 'sms' },
  { label: 'Połączenie telefoniczne', value: 'phone' },
  { label: 'Komunikator', value: 'messaging' },
  { label: 'Inny kanał', value: 'other' },
]

const statusItems: Array<{ label: string, value: ConsentStatus }> = [
  { label: 'Wersja robocza', value: 'draft' },
  { label: 'Opublikowana', value: 'published' },
  { label: 'Zarchiwizowana', value: 'archived' },
]

const { data, status, error, refresh } = await useFetch<ConsentPayload>(
  () => crmApiPath('/consents'),
  { default: (): ConsentPayload => ({ role: 'expert', canManage: false, canPublish: false, canAudit: false, definitions: [] }) },
)

const pending = computed(() => status.value === 'pending')
const definition = computed(() => data.value.definitions.find(item => item.id === consentId.value) ?? null)
const activeVersion = computed(() => definition.value ? currentVersionFor(definition.value) : null)
const versionHistory = computed(() => [...(definition.value?.versions ?? [])].sort((left, right) => right.version - left.version))
const detailViews = ['settings', 'clients', 'statistics', 'events', 'history'] as const
type ConsentDetailView = typeof detailViews[number]
const currentView = computed<ConsentDetailView>(() => {
  if (creating.value) return 'settings'
  const requested = String(route.query.view || 'settings')
  return detailViews.includes(requested as ConsentDetailView)
    ? requested as ConsentDetailView
    : 'settings'
})
const showHistory = computed(() => currentView.value === 'history')
const notFound = computed(() => !creating.value && !pending.value && !error.value && !definition.value)
const form = reactive<ConsentForm>(blankForm())

const detailTabs = computed(() => creating.value ? [] : [
  {
    label: 'Treść i ustawienia',
    icon: 'i-lucide-file-text',
    to: orgPath(`/consents/${consentId.value}`),
    active: currentView.value === 'settings',
  },
  {
    label: 'Klienci',
    icon: 'i-lucide-users-round',
    to: orgPath(`/consents/${consentId.value}?view=clients`),
    active: currentView.value === 'clients',
  },
  {
    label: 'Statystyki',
    icon: 'i-lucide-chart-no-axes-combined',
    to: orgPath(`/consents/${consentId.value}?view=statistics`),
    active: currentView.value === 'statistics',
  },
  {
    label: 'Rejestr zdarzeń',
    icon: 'i-lucide-list-checks',
    to: orgPath(`/consents/${consentId.value}?view=events`),
    active: currentView.value === 'events',
  },
  {
    label: 'Historia wersji',
    icon: 'i-lucide-history',
    count: versionHistory.value.length,
    to: orgPath(`/consents/${consentId.value}?view=history`),
    active: showHistory.value,
  },
])

const availableStatusItems = computed(() => statusItems.map(item => ({
  ...item,
  disabled: item.value === 'published' && !data.value.canPublish,
})))

const pageTitle = computed(() => creating.value
  ? 'Nowa zgoda'
  : activeVersion.value?.display_title || 'Szczegóły zgody')
const pageDescription = computed(() => creating.value
  ? 'Utwórz definicję. Kolejne zapisy będą dodawały jej niezmienne wersje.'
  : ({
      settings: 'Treść i reguły użycia obowiązujące w procesach CRM.',
      clients: 'Aktualny stan zgody dla każdej osoby oraz wysyłka próśb SMS.',
      statistics: 'Skuteczność pozyskania zgody i droga potwierdzeń SMS.',
      events: 'Pełny ślad wysyłki, weryfikacji i decyzji klienta.',
      history: 'Chronologiczny rejestr niezmiennych wersji tej zgody.',
    })[currentView.value])

useHead(() => ({ title: `${pageTitle.value} — OpenExpert CRM` }))

watch([consentId, definition], ([key, value]) => {
  if (loadedKey.value === key) return
  if (key === 'new') {
    Object.assign(form, blankForm())
    loadedKey.value = key
    return
  }
  if (value) {
    loadDefinition(value)
    loadedKey.value = key
  }
}, { immediate: true })

function blankForm(): ConsentForm {
  return {
    code: '',
    internal_name: '',
    display_title: '',
    content: '',
    purpose: '',
    channel: 'email',
    legal_basis: 'art. 398 PKE w zw. z art. 6 ust. 1 lit. a RODO',
    is_required: false,
    status: 'draft',
    sort_order: 0,
    language_code: 'pl',
    effective_from: toDateTimeLocal(new Date().toISOString()),
    effective_to: '',
    change_note: '',
  }
}

function currentVersionFor(item: ConsentDefinition): ConsentVersion | null {
  return item.current_version
    ?? item.versions.find(version => version.id === item.current_version_id)
    ?? null
}

function loadDefinition(item: ConsentDefinition) {
  const version = currentVersionFor(item)
  if (!version) return
  Object.assign(form, {
    code: item.code,
    internal_name: version.internal_name,
    display_title: version.display_title,
    content: version.content,
    purpose: version.purpose,
    channel: version.channel,
    legal_basis: version.legal_basis,
    is_required: version.is_required,
    status: version.status,
    sort_order: version.sort_order,
    language_code: version.language_code,
    effective_from: toDateTimeLocal(version.effective_from),
    effective_to: toDateTimeLocal(version.effective_to),
    change_note: '',
  })
}

function toDateTimeLocal(value: string | null | undefined) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function toIsoDateTime(value: string) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function editablePayload() {
  return {
    internal_name: form.internal_name.trim(),
    display_title: form.display_title.trim(),
    content: form.content.trim(),
    purpose: form.purpose.trim(),
    channel: form.channel,
    legal_basis: form.legal_basis.trim(),
    is_required: form.is_required,
    status: form.status,
    sort_order: Number(form.sort_order) || 0,
    language_code: form.language_code.trim(),
    effective_from: toIsoDateTime(form.effective_from),
    effective_to: toIsoDateTime(form.effective_to),
    change_note: form.change_note.trim() || null,
  }
}

function validateForm() {
  if (creating.value && !/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(form.code.trim())) {
    toast.add({
      title: 'Niepoprawny kod zgody',
      description: 'Użyj małych liter, cyfr i podkreśleń, np. marketing_email.',
      color: 'error',
    })
    return false
  }

  const required = [
    ['nazwa wewnętrzna', form.internal_name],
    ['tytuł dla klienta', form.display_title],
    ['treść zgody', form.content],
    ['cel zgody', form.purpose],
    ['podstawa prawna', form.legal_basis],
  ] as const
  const missing = required.find(([, value]) => !value.trim())
  if (missing) {
    toast.add({ title: 'Uzupełnij formularz', description: `Pole „${missing[0]}” jest wymagane.`, color: 'error' })
    return false
  }

  if (!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(form.language_code.trim())) {
    toast.add({ title: 'Niepoprawny język', description: 'Użyj kodu w formacie pl albo pl-PL.', color: 'error' })
    return false
  }

  if (form.status === 'published' && !data.value.canPublish) {
    toast.add({
      title: 'Brak uprawnienia do publikacji',
      description: 'Możesz zapisać wersję roboczą. Publikacja wymaga osobnego uprawnienia compliance.',
      color: 'error',
    })
    return false
  }

  const effectiveFrom = toIsoDateTime(form.effective_from)
  const effectiveTo = toIsoDateTime(form.effective_to)
  if (!effectiveFrom) {
    toast.add({ title: 'Podaj początek obowiązywania', color: 'error' })
    return false
  }
  if (effectiveTo && new Date(effectiveTo) <= new Date(effectiveFrom)) {
    toast.add({
      title: 'Niepoprawny okres obowiązywania',
      description: 'Data końcowa musi być późniejsza od daty początkowej.',
      color: 'error',
    })
    return false
  }
  return true
}

async function save() {
  if (!data.value.canManage || !validateForm()) return
  saving.value = true

  try {
    const result = creating.value
      ? await $fetch<{ data: ConsentDefinition }>(crmApiPath('/consents'), {
          method: 'POST',
          body: { code: form.code.trim(), ...editablePayload() },
        })
      : await $fetch<{ data: ConsentDefinition }>(crmApiPath(`/consents/${consentId.value}`), {
          method: 'PATCH',
          body: editablePayload(),
        })

    const index = data.value.definitions.findIndex(item => item.id === result.data.id)
    if (index === -1) data.value.definitions.push(result.data)
    else data.value.definitions[index] = result.data

    loadDefinition(result.data)
    toast.add({
      title: creating.value ? 'Utworzono definicję zgody' : 'Zapisano nową wersję zgody',
      description: creating.value ? 'Możesz teraz rozwijać jej kolejne wersje.' : 'Poprzednia wersja pozostała w historii.',
      color: 'success',
    })

    if (creating.value) {
      await navigateTo(orgPath(`/consents/${result.data.id}`))
    }
  } catch (saveError: unknown) {
    toast.add({
      title: creating.value ? 'Nie udało się utworzyć zgody' : 'Nie udało się zapisać zgody',
      description: apiErrorMessage(saveError),
      color: 'error',
    })
  } finally {
    saving.value = false
  }
}

function channelLabel(channel: ConsentChannel) {
  return channelItems.find(item => item.value === channel)?.label ?? channel
}

function statusLabel(value: ConsentStatus) {
  return statusItems.find(item => item.value === value)?.label ?? value
}

function statusColor(value: ConsentStatus): 'success' | 'warning' | 'neutral' {
  if (value === 'published') return 'success'
  if (value === 'draft') return 'warning'
  return 'neutral'
}

function requirementLabel(isRequired: boolean) {
  return isRequired ? 'Wymagana' : 'Dobrowolna'
}

function requirementColor(isRequired: boolean): 'error' | 'neutral' {
  return isRequired ? 'error' : 'neutral'
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Bez daty końcowej'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Niepoprawna data'
  return new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}
</script>

<template>
  <CrmShell
    :title="pageTitle"
    eyebrow="Compliance · zgody"
    :description="pageDescription"
    :back-to="orgPath('/consents')"
    back-label="Wróć do zgód"
    :tabs="detailTabs"
  >
    <template #meta>
      <div v-if="activeVersion && !creating" class="consent-detail__badges">
        <UBadge color="neutral" variant="outline">{{ definition?.code }}</UBadge>
        <UBadge color="neutral" variant="outline">wersja {{ activeVersion.version }}</UBadge>
        <UBadge :color="statusColor(activeVersion.status)" variant="subtle">{{ statusLabel(activeVersion.status) }}</UBadge>
        <UBadge :color="requirementColor(activeVersion.is_required)" variant="subtle">{{ requirementLabel(activeVersion.is_required) }}</UBadge>
      </div>
    </template>

    <UAlert
      v-if="error"
      class="consent-detail__state"
      color="error"
      variant="subtle"
      icon="i-lucide-database"
      title="Nie udało się pobrać zgody"
      description="Sprawdź połączenie i spróbuj ponownie."
    >
      <template #actions>
        <UButton variant="ghost" icon="i-lucide-refresh-cw" @click="refresh()">Ponów</UButton>
      </template>
    </UAlert>

    <UAlert
      v-else-if="notFound"
      class="consent-detail__state"
      color="error"
      variant="subtle"
      icon="i-lucide-file-question"
      title="Nie znaleziono zgody"
      description="Ta definicja nie istnieje albo nie masz do niej dostępu."
    >
      <template #actions>
        <UButton :to="orgPath('/consents')" variant="outline">Wróć do listy</UButton>
      </template>
    </UAlert>

    <UAlert
      v-else-if="creating && !pending && !data.canManage"
      class="consent-detail__state"
      color="warning"
      variant="subtle"
      icon="i-lucide-shield-alert"
      title="Nie możesz utworzyć zgody"
      description="Tworzenie definicji wymaga uprawnienia do zarządzania zgodami compliance."
    />

    <UAlert
      v-else-if="!creating && currentView === 'settings' && !pending && definition && !data.canManage"
      class="consent-detail__state"
      color="warning"
      variant="subtle"
      icon="i-lucide-shield-alert"
      title="Treść w trybie tylko do odczytu"
      description="Możesz sprawdzić ustawienia i historię. Edycja wymaga uprawnienia do zarządzania zgodami compliance."
    />

    <div v-if="pending && !definition && !creating" class="consent-detail__loading">
      <USkeleton class="h-72 w-full" />
      <USkeleton class="h-96 w-full" />
    </div>

    <form
      v-else-if="currentView === 'settings' && ((creating && data.canManage) || definition)"
      class="consent-detail"
      @submit.prevent="save"
    >
      <p class="consent-detail__version-rule">
        <UIcon name="i-lucide-shield-check" />
        <span>{{ creating ? 'Pierwszy zapis utworzy wersję 1 tej definicji.' : 'Zapis zmian utworzy nową wersję. Poprzednia pozostanie w historii.' }}</span>
      </p>

      <fieldset class="consent-detail__fieldset" :disabled="!data.canManage || saving">
        <section class="consent-detail__section">
          <header>
            <div>
              <span>Definicja</span>
              <h2>Podstawowe informacje</h2>
            </div>
            <p>Kod pozostaje stały. Nazwy możesz aktualizować w kolejnych wersjach.</p>
          </header>

          <div class="consent-detail__grid">
            <UFormField
              label="Kod definicji"
              description="Małe litery, cyfry i podkreślenia."
              required
            >
              <UInput v-model="form.code" class="w-full" :disabled="!creating" placeholder="marketing_email" autocomplete="off" />
            </UFormField>

            <UFormField label="Proces" description="Zakres użycia definicji.">
              <UInput class="w-full" model-value="Dodawanie klienta" disabled icon="i-lucide-user-plus" />
            </UFormField>

            <UFormField label="Nazwa wewnętrzna" required>
              <UInput v-model="form.internal_name" class="w-full" placeholder="Marketing bezpośredni — e-mail" />
            </UFormField>

            <UFormField label="Tytuł dla klienta" required>
              <UInput v-model="form.display_title" class="w-full" placeholder="Marketing e-mail" />
            </UFormField>
          </div>
        </section>

        <section class="consent-detail__section">
          <header>
            <div>
              <span>Treść</span>
              <h2>Komunikat i cel zgody</h2>
            </div>
            <p>Dokładnie ta treść zostanie pokazana klientowi.</p>
          </header>

          <div class="consent-detail__grid">
            <UFormField class="consent-detail__full" label="Treść zgody" required>
              <UTextarea v-model="form.content" class="w-full" :rows="8" autoresize :maxrows="16" />
            </UFormField>

            <UFormField class="consent-detail__full" label="Cel" description="Opis celu przetwarzania i wykorzystania danych." required>
              <UTextarea v-model="form.purpose" class="w-full" :rows="3" autoresize :maxrows="8" />
            </UFormField>

            <UFormField class="consent-detail__full" label="Podstawa prawna" required>
              <UInput v-model="form.legal_basis" class="w-full" placeholder="art. 398 PKE w zw. z art. 6 ust. 1 lit. a RODO" />
            </UFormField>
          </div>
        </section>

        <section class="consent-detail__section">
          <header>
            <div>
              <span>Publikacja</span>
              <h2>Reguły i obowiązywanie</h2>
            </div>
            <p>Tylko opublikowane wersje trafiają do procesów CRM.</p>
          </header>

          <div class="consent-detail__grid">
            <UFormField label="Kanał" required>
              <USelect v-model="form.channel" class="w-full" :items="channelItems" />
            </UFormField>

            <UFormField label="Metoda pozyskania" description="Obowiązuje dla nowych decyzji.">
              <UInput
                class="w-full"
                model-value="SMS + kod jednorazowy"
                disabled
                icon="i-lucide-message-square-lock"
              />
            </UFormField>

            <UFormField label="Status" required>
              <USelect v-model="form.status" class="w-full" :items="availableStatusItems" />
            </UFormField>

            <UFormField label="Kolejność" description="Niższa liczba oznacza wcześniejszą pozycję.">
              <UInput v-model.number="form.sort_order" class="w-full" type="number" step="1" />
            </UFormField>

            <UFormField label="Język" description="Kod ISO, np. pl lub pl-PL." required>
              <UInput v-model="form.language_code" class="w-full" placeholder="pl" autocomplete="off" />
            </UFormField>

            <UFormField label="Obowiązuje od" required>
              <UInput v-model="form.effective_from" class="w-full" type="datetime-local" />
            </UFormField>

            <UFormField label="Obowiązuje do" hint="Opcjonalnie">
              <UInput v-model="form.effective_to" class="w-full" type="datetime-local" />
            </UFormField>

            <UFormField
              class="consent-detail__full"
              label="Wymagalność w procesie"
              description="Nie używaj tej opcji dla dobrowolnego marketingu. Nie blokuje utworzenia karty klienta."
            >
              <UCheckbox
                v-model="form.is_required"
                label="Wymagana do przejścia procesu docelowego"
                description="Decyzję nadal podejmuje klient w zweryfikowanym flow SMS."
              />
            </UFormField>

            <UFormField
              class="consent-detail__full"
              label="Notatka do zmiany"
              description="Uzasadnienie widoczne w historii wersji."
              hint="Opcjonalnie"
            >
              <UTextarea v-model="form.change_note" class="w-full" :rows="2" placeholder="Np. aktualizacja podstawy prawnej po przeglądzie IOD" />
            </UFormField>
          </div>
        </section>
      </fieldset>

      <div v-if="data.canManage" class="consent-detail__actions">
        <div>
          <strong>{{ creating ? 'Nowa definicja' : `Nowa wersja ${Number(activeVersion?.version || 0) + 1}` }}</strong>
          <span>{{ creating ? 'Kod będzie później tylko do odczytu.' : 'Zapis nie zmieni poprzednich wersji.' }}</span>
        </div>
        <UButton :to="orgPath('/consents')" type="button" color="neutral" variant="outline">
          Anuluj
        </UButton>
        <UButton type="submit" icon="i-lucide-save" variant="solid" :loading="saving">
          {{ creating ? 'Utwórz definicję' : 'Zapisz nową wersję' }}
        </UButton>
      </div>

    </form>

    <UAlert
      v-else-if="definition && ['clients', 'statistics', 'events'].includes(currentView) && !data.canAudit"
      color="warning"
      variant="subtle"
      icon="i-lucide-shield-alert"
      title="Brak dostępu do danych compliance"
      description="Rejestr klientów, statystyki i zdarzenia wymagają uprawnienia do odczytu audytu zgód."
    />

    <ConsentsClientsPanel
      v-else-if="definition && currentView === 'clients'"
      :definition-id="consentId"
      :can-request="data.canManage"
    />

    <ConsentsStatisticsPanel
      v-else-if="definition && currentView === 'statistics'"
      :definition-id="consentId"
    />

    <ConsentsEventsPanel
      v-else-if="definition && currentView === 'events'"
      :definition-id="consentId"
    />

    <section v-else-if="definition && showHistory" class="consent-detail__section consent-detail__history">
      <header>
        <div>
          <span>Audyt</span>
          <h2>Historia wersji</h2>
        </div>
        <div class="consent-detail__history-meta">
          <span>Wersje są niezmienne i zachowane dla audytu.</span>
          <UBadge color="neutral" variant="outline">{{ versionHistory.length }}</UBadge>
        </div>
      </header>

      <div v-if="versionHistory.length" class="history-list">
        <details
          v-for="version in versionHistory"
          :key="version.id"
          class="history-item"
          :open="version.id === definition.current_version_id"
        >
          <summary>
            <div>
              <strong>Wersja {{ version.version }}</strong>
              <UBadge v-if="version.id === definition.current_version_id" color="primary" variant="subtle">aktualna</UBadge>
              <UBadge :color="statusColor(version.status)" variant="subtle">{{ statusLabel(version.status) }}</UBadge>
              <UBadge :color="requirementColor(version.is_required)" variant="subtle">{{ requirementLabel(version.is_required) }}</UBadge>
            </div>
            <span>{{ formatDateTime(version.created_at) }}</span>
          </summary>

          <div class="history-item__body">
            <p v-if="version.change_note" class="history-item__note">{{ version.change_note }}</p>
            <dl>
              <div><dt>Tytuł</dt><dd>{{ version.display_title }}</dd></div>
              <div><dt>Kanał</dt><dd>{{ channelLabel(version.channel) }}</dd></div>
              <div><dt>Podstawa prawna</dt><dd>{{ version.legal_basis }}</dd></div>
              <div><dt>Język</dt><dd>{{ version.language_code }}</dd></div>
              <div><dt>Obowiązuje od</dt><dd>{{ formatDateTime(version.effective_from) }}</dd></div>
              <div><dt>Obowiązuje do</dt><dd>{{ formatDateTime(version.effective_to) }}</dd></div>
            </dl>
            <section>
              <span>Cel</span>
              <p>{{ version.purpose }}</p>
            </section>
            <section>
              <span>Treść</span>
              <p class="history-item__content">{{ version.content }}</p>
            </section>
            <code :title="version.content_sha256">SHA-256: {{ version.content_sha256 }}</code>
          </div>
        </details>
      </div>
    </section>
  </CrmShell>
</template>

<style scoped>
.consent-detail,
.consent-detail__fieldset,
.consent-detail__loading {
  display: grid;
  gap: 18px;
  min-width: 0;
}

.consent-detail__fieldset {
  margin: 0;
  padding: 0;
  border: 0;
}

.consent-detail__fieldset:disabled {
  opacity: .76;
}

.consent-detail__state {
  margin-bottom: 18px;
}

.consent-detail__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.consent-detail__version-rule {
  display: flex;
  gap: 9px;
  align-items: center;
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.consent-detail__version-rule > .iconify {
  flex: 0 0 auto;
  width: 17px;
  height: 17px;
  color: var(--ui-primary);
}

.consent-detail__section {
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background: var(--ui-bg);
}

.consent-detail__section > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding: 18px 20px;
  border-bottom: 1px solid var(--ui-border);
}

.consent-detail__section > header > div {
  display: grid;
  gap: 3px;
}

.consent-detail__section > header span {
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: .05em;
  text-transform: uppercase;
}

.consent-detail__section h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 20px;
  font-weight: 550;
}

.consent-detail__section > header p {
  max-width: 440px;
  margin: 3px 0 0;
  color: var(--ui-text-muted);
  font-size: 13px;
  text-align: right;
}

.consent-detail__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
  padding: 22px 20px 24px;
}

.consent-detail__grid :deep(input),
.consent-detail__grid :deep(textarea),
.consent-detail__grid :deep(button[role='combobox']) {
  width: 100%;
}

.consent-detail__full {
  grid-column: 1 / -1;
}

.consent-detail__actions {
  position: sticky;
  bottom: 12px;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--ui-border-accented);
  border-radius: var(--oe-radius-surface);
  background: color-mix(in srgb, var(--ui-bg) 94%, transparent);
  backdrop-filter: blur(14px);
}

.consent-detail__actions > div {
  display: grid;
  margin-right: auto;
}

.consent-detail__actions span {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.consent-detail__history {
  margin-top: 6px;
  scroll-margin-top: 20px;
}

.consent-detail__history-meta {
  display: flex;
  gap: 10px;
  align-items: center;
}

.consent-detail__section > header .consent-detail__history-meta > span {
  color: var(--ui-text-muted);
  font-family: inherit;
  font-size: 12px;
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
}

.history-list {
  display: grid;
  gap: 10px;
  padding: 16px;
}

.history-item {
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  background: var(--ui-bg-muted);
}

.history-item summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 13px 14px;
  cursor: pointer;
  list-style: none;
}

.history-item summary::-webkit-details-marker {
  display: none;
}

.history-item summary > div {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  align-items: center;
}

.history-item summary > span {
  color: var(--ui-text-muted);
  font-size: 12px;
  white-space: nowrap;
}

.history-item__body {
  display: grid;
  gap: 16px;
  padding: 16px;
  border-top: 1px solid var(--ui-border);
  background: var(--ui-bg);
}

.history-item__note {
  margin: 0;
  padding: 10px 12px;
  border-left: 3px solid var(--ui-primary);
  background: var(--ui-bg-muted);
  font-size: 13px;
}

.history-item__body dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 18px;
  margin: 0;
}

.history-item__body dl > div,
.history-item__body section {
  display: grid;
  gap: 3px;
}

.history-item__body dt,
.history-item__body section > span {
  color: var(--ui-text-muted);
  font-size: 10px;
  font-weight: 650;
  text-transform: uppercase;
}

.history-item__body dd,
.history-item__body p {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.history-item__content {
  white-space: pre-wrap;
}

.history-item__body code {
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 760px) {
  .consent-detail__section > header,
  .consent-detail__actions,
  .history-item summary {
    align-items: stretch;
    flex-direction: column;
  }

  .consent-detail__section > header p {
    text-align: left;
  }

  .consent-detail__grid,
  .history-item__body dl {
    grid-template-columns: 1fr;
  }

  .consent-detail__actions > div {
    margin-right: 0;
  }

  .history-item summary > span {
    white-space: normal;
  }

  .consent-detail__history-meta {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
