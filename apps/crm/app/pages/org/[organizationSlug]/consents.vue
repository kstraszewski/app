<script setup lang="ts">
type ConsentChannel = 'email' | 'sms' | 'phone' | 'messaging' | 'other'
type ConsentStatus = 'draft' | 'published' | 'archived'

type ConsentVersion = {
  id: string
  version: number
  internal_name: string
  display_title: string
  content: string
  purpose: string
  channel: ConsentChannel
  legal_basis: string
  is_required: boolean
  status: ConsentStatus
  sort_order: number
  language_code: string
  effective_from: string
  effective_to: string | null
  change_note: string | null
  content_sha256: string
  created_at: string
}

type ConsentDefinition = {
  id: string
  code: string
  context: string
  current_version_id: string
  created_at: string
  updated_at: string
  current_version: ConsentVersion | null
  versions: ConsentVersion[]
}

type ConsentPayload = {
  role: 'admin' | 'expert'
  canManage: boolean
  definitions: ConsentDefinition[]
}

type ConsentForm = {
  code: string
  internal_name: string
  display_title: string
  content: string
  purpose: string
  channel: ConsentChannel
  legal_basis: string
  is_required: boolean
  status: ConsentStatus
  sort_order: number
  language_code: string
  effective_from: string
  effective_to: string
  change_note: string
}

definePageMeta({ middleware: ['auth', 'organization'] })
useHead({ title: 'Zgody — OpenExpert CRM' })

const { crmApiPath } = useOrganizationContext()
const toast = useToast()
const search = ref('')
const selectedId = ref('')
const creating = ref(false)
const saving = ref(false)

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

const { data, pending, error, refresh } = await useFetch<ConsentPayload>(
  () => crmApiPath('/consents'),
  { default: (): ConsentPayload => ({ role: 'expert', canManage: false, definitions: [] }) },
)

const canManage = computed(() => Boolean(data.value.canManage))
const definitions = computed(() => [...data.value.definitions].sort((left, right) => {
  const order = (currentVersionFor(left)?.sort_order ?? 0) - (currentVersionFor(right)?.sort_order ?? 0)
  if (order) return order
  return definitionTitle(left).localeCompare(definitionTitle(right), 'pl')
}))
const visibleDefinitions = computed(() => {
  const query = search.value.trim().toLocaleLowerCase('pl')
  if (!query) return definitions.value
  return definitions.value.filter((definition) => {
    const version = currentVersionFor(definition)
    return [definition.code, version?.internal_name, version?.display_title, version?.purpose]
      .some(value => String(value ?? '').toLocaleLowerCase('pl').includes(query))
  })
})
const selected = computed(() => definitions.value.find(definition => definition.id === selectedId.value) ?? null)
const activeVersion = computed(() => selected.value ? currentVersionFor(selected.value) : null)
const versionHistory = computed(() => [...(selected.value?.versions ?? [])].sort((left, right) => right.version - left.version))
const form = reactive<ConsentForm>(blankForm())

watch(definitions, (items) => {
  if (creating.value) return
  const definition = items.find(item => item.id === selectedId.value) ?? items[0]
  if (!definition) {
    selectedId.value = ''
    return
  }
  selectedId.value = definition.id
  loadDefinition(definition)
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

function currentVersionFor(definition: ConsentDefinition): ConsentVersion | null {
  return definition.current_version
    ?? definition.versions.find(version => version.id === definition.current_version_id)
    ?? null
}

function definitionTitle(definition: ConsentDefinition) {
  return currentVersionFor(definition)?.display_title || currentVersionFor(definition)?.internal_name || definition.code
}

function loadDefinition(definition: ConsentDefinition) {
  const version = currentVersionFor(definition)
  if (!version) return
  Object.assign(form, {
    code: definition.code,
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

function selectDefinition(definition: ConsentDefinition) {
  creating.value = false
  selectedId.value = definition.id
  loadDefinition(definition)
}

function startCreating() {
  if (!canManage.value) return
  creating.value = true
  selectedId.value = ''
  Object.assign(form, blankForm())
}

function cancelCreating() {
  creating.value = false
  const definition = definitions.value[0]
  if (definition) selectDefinition(definition)
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
  if (!canManage.value || !validateForm()) return
  saving.value = true
  const wasCreating = creating.value
  const savedCode = form.code.trim()
  const savedId = selectedId.value

  try {
    if (wasCreating) {
      await $fetch(crmApiPath('/consents'), {
        method: 'POST',
        body: { code: savedCode, ...editablePayload() },
      })
    } else if (savedId) {
      await $fetch(crmApiPath(`/consents/${savedId}`), {
        method: 'PATCH',
        body: editablePayload(),
      })
    }

    await refresh()
    creating.value = false
    const definition = data.value.definitions.find(item => item.id === savedId || item.code === savedCode)
    if (definition) selectDefinition(definition)
    toast.add({
      title: wasCreating ? 'Utworzono definicję zgody' : 'Zapisano nową wersję zgody',
      description: wasCreating ? 'Definicja jest gotowa do dalszej edycji.' : 'Poprzednia wersja pozostała w historii.',
      color: 'success',
    })
  } catch (caught: any) {
    toast.add({
      title: wasCreating ? 'Nie udało się utworzyć zgody' : 'Nie udało się zapisać zgody',
      description: errorDescription(caught),
      color: 'error',
    })
  } finally {
    saving.value = false
  }
}

function errorDescription(caught: any) {
  return caught?.data?.statusMessage
    ?? caught?.data?.message
    ?? caught?.statusMessage
    ?? caught?.message
    ?? 'Spróbuj ponownie lub sprawdź dane formularza.'
}

function channelLabel(channel: ConsentChannel) {
  return channelItems.find(item => item.value === channel)?.label ?? channel
}

function statusLabel(status: ConsentStatus) {
  return statusItems.find(item => item.value === status)?.label ?? status
}

function statusColor(status: ConsentStatus): 'success' | 'warning' | 'neutral' {
  if (status === 'published') return 'success'
  if (status === 'draft') return 'warning'
  return 'neutral'
}

function requirementLabel(isRequired: boolean) {
  return isRequired ? 'Wymagana' : 'Dobrowolna'
}

function requirementColor(isRequired: boolean): 'error' | 'neutral' {
  return isRequired ? 'error' : 'neutral'
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'bez daty końcowej'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'niepoprawna data'
  return new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}
</script>

<template>
  <CrmShell title="Zgody" eyebrow="Panel prawny · definicje i wersje">
    <template #actions>
      <UButton
        v-if="canManage"
        icon="i-lucide-plus"
        variant="solid"
        :disabled="saving"
        @click="startCreating"
      >
        Nowa zgoda
      </UButton>
      <UButton icon="i-lucide-refresh-cw" variant="outline" :loading="pending" @click="refresh()">
        Odśwież
      </UButton>
    </template>

    <UAlert
      v-if="error"
      class="consent-block"
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
      v-else-if="!pending && !canManage"
      class="consent-block"
      color="warning"
      variant="subtle"
      icon="i-lucide-shield-alert"
      title="Panel w trybie tylko do odczytu"
      :description="`Możesz przeglądać definicje i ich historię. Edycja wymaga uprawnienia do zarządzania zgodami (bieżąca rola: ${data.role}).`"
    />

    <section class="consent-notice consent-block">
      <UIcon name="i-lucide-history" />
      <div>
        <strong>Każdy zapis tworzy nową, niezmienną wersję.</strong>
        <p>Proces „Dodawanie klienta” korzysta z aktualnie opublikowanych treści i ich reguły wymagalności. Kod definicji pozostaje stały.</p>
      </div>
    </section>

    <UAlert
      class="consent-block"
      color="warning"
      variant="subtle"
      icon="i-lucide-scale"
      title="Zestaw startowy wymaga zatwierdzenia prawnego"
      description="Przed użyciem produkcyjnym potwierdź administratora danych, rzeczywisty zakres produktów, kanały i podstawy prawne z prawnikiem lub IOD."
    />

    <div v-if="pending && !data.definitions.length" class="loading-layout">
      <USkeleton class="h-96 w-full" />
      <USkeleton class="h-[42rem] w-full" />
    </div>

    <div v-else-if="definitions.length || creating" class="consent-workspace">
      <aside class="definition-panel">
        <div class="definition-panel__header">
          <div>
            <span>Definicje</span>
            <UBadge color="neutral" variant="outline">{{ definitions.length }}</UBadge>
          </div>
          <UInput v-model="search" icon="i-lucide-search" placeholder="Szukaj zgody" aria-label="Szukaj definicji zgody" />
        </div>

        <nav class="definition-list" aria-label="Definicje zgód">
          <button
            v-if="creating"
            type="button"
            class="definition-item definition-item--active"
            aria-pressed="true"
          >
            <span>Nowa definicja</span>
            <strong>{{ form.display_title || form.internal_name || 'Bez tytułu' }}</strong>
            <small><UBadge color="warning" variant="subtle">wersja robocza</UBadge></small>
          </button>

          <button
            v-for="definition in visibleDefinitions"
            :key="definition.id"
            type="button"
            :class="['definition-item', { 'definition-item--active': !creating && definition.id === selectedId }]"
            :aria-pressed="!creating && definition.id === selectedId"
            @click="selectDefinition(definition)"
          >
            <span>{{ definition.code }}</span>
            <strong>{{ definitionTitle(definition) }}</strong>
            <small>
              <UBadge color="neutral" variant="outline">{{ channelLabel(currentVersionFor(definition)?.channel || 'other') }}</UBadge>
              <UBadge
                v-if="currentVersionFor(definition)"
                :color="statusColor(currentVersionFor(definition)!.status)"
                variant="subtle"
              >
                {{ statusLabel(currentVersionFor(definition)!.status) }}
              </UBadge>
              <UBadge
                v-if="currentVersionFor(definition)"
                :color="requirementColor(currentVersionFor(definition)!.is_required)"
                variant="subtle"
              >
                {{ requirementLabel(currentVersionFor(definition)!.is_required) }}
              </UBadge>
            </small>
          </button>

          <p v-if="!visibleDefinitions.length && !creating" class="definition-empty">
            Brak definicji pasujących do wyszukiwania.
          </p>
        </nav>
      </aside>

      <main v-if="creating || selected" class="consent-editor">
        <form class="editor-form" @submit.prevent="save">
          <UCard>
            <template #header>
              <div class="card-head">
                <div>
                  <p>{{ creating ? 'Nowa definicja' : selected?.code }}</p>
                  <h2>{{ creating ? 'Utwórz zgodę' : activeVersion?.display_title }}</h2>
                </div>
                <div v-if="activeVersion && !creating" class="card-head__badges">
                  <UBadge color="neutral" variant="outline">wersja {{ activeVersion.version }}</UBadge>
                  <UBadge :color="statusColor(activeVersion.status)" variant="subtle">{{ statusLabel(activeVersion.status) }}</UBadge>
                  <UBadge :color="requirementColor(activeVersion.is_required)" variant="subtle">{{ requirementLabel(activeVersion.is_required) }}</UBadge>
                </div>
              </div>
            </template>

            <fieldset class="editor-fieldset" :disabled="!canManage || saving">
              <div class="form-grid">
                <UFormField
                  label="Kod definicji"
                  description="Stały identyfikator: małe litery, cyfry i podkreślenia."
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

                <UFormField class="full" label="Treść zgody" description="Dokładny tekst prezentowany klientowi." required>
                  <UTextarea v-model="form.content" class="w-full" :rows="8" autoresize :maxrows="16" />
                </UFormField>

                <UFormField class="full" label="Cel" description="Opis celu przetwarzania i wykorzystania danych." required>
                  <UTextarea v-model="form.purpose" class="w-full" :rows="3" autoresize :maxrows="8" />
                </UFormField>

                <UFormField label="Kanał" required>
                  <USelect v-model="form.channel" class="w-full" :items="channelItems" />
                </UFormField>

                <UFormField label="Podstawa prawna" required>
                  <UInput v-model="form.legal_basis" class="w-full" placeholder="art. 398 PKE w zw. z art. 6 ust. 1 lit. a RODO" />
                </UFormField>

                <UFormField label="Status" description="Tylko opublikowane wersje trafiają do procesu klienta." required>
                  <USelect v-model="form.status" class="w-full" :items="statusItems" />
                </UFormField>

                <UFormField label="Kolejność" description="Niższa liczba oznacza wcześniejszą pozycję.">
                  <UInput v-model.number="form.sort_order" class="w-full" type="number" step="1" />
                </UFormField>

                <UFormField
                  class="full"
                  label="Wymagalność w procesie"
                  description="Włączenie tej opcji zablokuje dodanie klienta do czasu świadomego zaznaczenia tej wersji zgody. Nie używaj jej dla dobrowolnego marketingu."
                >
                  <UCheckbox
                    v-model="form.is_required"
                    label="Wymagana do dodania klienta"
                    description="Checkbox klienta nadal pozostanie domyślnie niezaznaczony."
                  />
                </UFormField>

                <UFormField label="Język" description="Kod ISO, np. pl lub pl-PL." required>
                  <UInput v-model="form.language_code" class="w-full" placeholder="pl" autocomplete="off" />
                </UFormField>

                <div aria-hidden="true" />

                <UFormField label="Obowiązuje od" required>
                  <UInput v-model="form.effective_from" class="w-full" type="datetime-local" />
                </UFormField>

                <UFormField label="Obowiązuje do" hint="Opcjonalnie">
                  <UInput v-model="form.effective_to" class="w-full" type="datetime-local" />
                </UFormField>

                <UFormField
                  class="full"
                  label="Notatka do zmiany"
                  description="Uzasadnienie widoczne w historii wersji."
                  hint="Opcjonalnie"
                >
                  <UTextarea v-model="form.change_note" class="w-full" :rows="2" placeholder="Np. aktualizacja podstawy prawnej po przeglądzie IOD" />
                </UFormField>
              </div>
            </fieldset>
          </UCard>

          <div v-if="canManage" class="sticky-actions">
            <div>
              <strong>{{ creating ? 'Nowa definicja' : `Nowa wersja ${Number(activeVersion?.version || 0) + 1}` }}</strong>
              <span>{{ creating ? 'Kod będzie później tylko do odczytu.' : 'Zapis nie zmieni poprzednich wersji.' }}</span>
            </div>
            <UButton v-if="creating" type="button" color="neutral" variant="outline" @click="cancelCreating">
              Anuluj
            </UButton>
            <UButton type="submit" icon="i-lucide-save" variant="solid" :loading="saving">
              {{ creating ? 'Utwórz definicję' : 'Zapisz nową wersję' }}
            </UButton>
          </div>
        </form>

        <UCard v-if="selected && !creating" class="history-card">
          <template #header>
            <div class="card-head">
              <div>
                <p>Audyt</p>
                <h2>Historia wersji</h2>
              </div>
              <UBadge color="neutral" variant="outline">{{ versionHistory.length }}</UBadge>
            </div>
          </template>

          <div v-if="versionHistory.length" class="history-list">
            <details
              v-for="version in versionHistory"
              :key="version.id"
              class="history-item"
              :open="version.id === selected.current_version_id"
            >
              <summary>
                <div>
                  <strong>Wersja {{ version.version }}</strong>
                  <UBadge v-if="version.id === selected.current_version_id" color="primary" variant="subtle">aktualna</UBadge>
                  <UBadge :color="statusColor(version.status)" variant="subtle">{{ statusLabel(version.status) }}</UBadge>
                  <UBadge :color="requirementColor(version.is_required)" variant="subtle">{{ requirementLabel(version.is_required) }}</UBadge>
                </div>
                <span>{{ formatDateTime(version.created_at) }}</span>
              </summary>

              <div class="history-body">
                <p v-if="version.change_note" class="history-note">{{ version.change_note }}</p>
                <dl>
                  <div><dt>Tytuł</dt><dd>{{ version.display_title }}</dd></div>
                  <div><dt>Kanał</dt><dd>{{ channelLabel(version.channel) }}</dd></div>
                  <div><dt>Podstawa prawna</dt><dd>{{ version.legal_basis }}</dd></div>
                  <div><dt>Wymagalność</dt><dd>{{ requirementLabel(version.is_required) }}</dd></div>
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
                  <p class="history-content">{{ version.content }}</p>
                </section>
                <code :title="version.content_sha256">SHA-256: {{ version.content_sha256 }}</code>
              </div>
            </details>
          </div>
          <p v-else class="history-empty">Ta definicja nie ma jeszcze zapisanej historii.</p>
        </UCard>
      </main>
    </div>

    <UCard v-else class="empty-state">
      <UIcon name="i-lucide-shield-check" />
      <h2>Brak definicji zgód</h2>
      <p v-if="canManage">Utwórz pierwszą definicję dla procesu dodawania klienta.</p>
      <p v-else>Administrator nie utworzył jeszcze definicji zgód.</p>
      <UButton v-if="canManage" icon="i-lucide-plus" variant="solid" @click="startCreating">Nowa zgoda</UButton>
    </UCard>
  </CrmShell>
</template>

<style scoped>
.consent-block {
  margin-bottom: 20px;
}

.consent-notice {
  display: flex;
  gap: 14px;
  padding: 18px 20px;
  border: 1px solid var(--ui-border);
  border-radius: 14px;
  background: var(--ui-bg);
}

.consent-notice > .iconify {
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  color: var(--ui-primary);
}

.consent-notice p {
  margin: 4px 0 0;
  color: var(--ui-text-muted);
  font-size: 14px;
}

.loading-layout,
.consent-workspace {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}

.definition-panel {
  position: sticky;
  top: 20px;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: 14px;
  background: var(--ui-bg);
}

.definition-panel__header {
  display: grid;
  gap: 12px;
  padding: 14px;
  border-bottom: 1px solid var(--ui-border);
}

.definition-panel__header > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--ui-text-muted);
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}

.definition-list {
  display: grid;
  gap: 6px;
  max-height: calc(100vh - 260px);
  padding: 10px;
  overflow-y: auto;
}

.definition-item {
  display: grid;
  gap: 5px;
  width: 100%;
  padding: 12px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.definition-item:hover,
.definition-item--active {
  border-color: var(--ui-border-accented);
  background: var(--ui-bg-muted);
}

.definition-item--active {
  box-shadow: inset 3px 0 0 var(--ui-primary);
}

.definition-item > span {
  overflow: hidden;
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}

.definition-item > strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
  line-height: 1.35;
}

.definition-item > small,
.card-head__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.definition-empty,
.history-empty {
  margin: 0;
  padding: 18px 12px;
  color: var(--ui-text-muted);
  font-size: 13px;
  text-align: center;
}

.consent-editor,
.editor-form {
  display: grid;
  gap: 16px;
  min-width: 0;
}

.card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.card-head p {
  margin: 0 0 3px;
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
}

.card-head h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 19px;
}

.editor-fieldset {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.editor-fieldset:disabled {
  opacity: .78;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.form-grid :deep(input),
.form-grid :deep(textarea),
.form-grid :deep(button[role='combobox']) {
  width: 100%;
}

.full {
  grid-column: 1 / -1;
}

.sticky-actions {
  position: sticky;
  bottom: 12px;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--ui-border-accented);
  border-radius: 14px;
  background: color-mix(in srgb, var(--ui-bg) 94%, transparent);
  backdrop-filter: blur(14px);
}

.sticky-actions > div {
  display: grid;
  margin-right: auto;
}

.sticky-actions span {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.history-card {
  margin-top: 4px;
}

.history-list {
  display: grid;
  gap: 10px;
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
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
}

.history-item summary > span {
  color: var(--ui-text-muted);
  font-size: 12px;
  white-space: nowrap;
}

.history-body {
  display: grid;
  gap: 16px;
  padding: 16px;
  border-top: 1px solid var(--ui-border);
  background: var(--ui-bg);
}

.history-note {
  margin: 0;
  padding: 10px 12px;
  border-left: 3px solid var(--ui-primary);
  background: var(--ui-bg-muted);
  color: var(--ui-text);
  font-size: 13px;
}

.history-body dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 18px;
  margin: 0;
}

.history-body dl > div,
.history-body section {
  display: grid;
  gap: 3px;
}

.history-body dt,
.history-body section > span {
  color: var(--ui-text-muted);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
}

.history-body dd,
.history-body p {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.history-content {
  white-space: pre-wrap;
}

.history-body code {
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-state {
  display: grid;
  justify-items: center;
  gap: 10px;
  padding: 56px 24px;
  color: var(--ui-text-muted);
  text-align: center;
}

.empty-state > .iconify {
  width: 34px;
  height: 34px;
}

.empty-state h2,
.empty-state p {
  margin: 0;
}

.empty-state h2 {
  color: var(--ui-text-highlighted);
}

@media (max-width: 1050px) {
  .loading-layout,
  .consent-workspace {
    grid-template-columns: 1fr;
  }

  .definition-panel {
    position: static;
  }

  .definition-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    max-height: none;
  }
}

@media (max-width: 680px) {
  .definition-list,
  .form-grid,
  .history-body dl {
    grid-template-columns: 1fr;
  }

  .form-grid > [aria-hidden='true'] {
    display: none;
  }

  .sticky-actions,
  .history-item summary {
    align-items: stretch;
    flex-direction: column;
  }

  .sticky-actions > div {
    margin-right: 0;
  }

  .history-item summary > span {
    white-space: normal;
  }
}
</style>
