<script setup lang="ts">
import type { TemplateValidationIssue, TemplateValidationResult } from '@openexpert/multiform'
import PdfTemplateVisualEditor from '~/components/multiform-admin/PdfTemplateVisualEditor.client.vue'
import type { AdminTemplatesResponse, RegisteredAdminTemplate } from '~/types/multiform-admin'
import {
  ADMIN_TEMPLATE_DRAFTS_STORAGE_KEY,
  GENERATED_BUNDLE_STORAGE_KEY,
  type StoredAdminTemplateDrafts,
} from '~/utils/multiform-template-storage'

definePageMeta({
  path: '/multiform-eve/admin',
})

useHead({
  title: 'Template JSON — Multiform Eve',
  meta: [
    {
      name: 'description',
      content: 'Przeglądaj, waliduj i ręcznie poprawiaj robocze szablony JSON dla Multiform Eve.',
    },
  ],
})

type TemplateSourceKind = 'registered' | 'generated'
type NoticeKind = 'success' | 'warning' | 'error'

interface TemplateSource {
  key: string
  kind: TemplateSourceKind
  id: string
  label: string
  bank: string
  template: unknown
  validation: TemplateValidationResult | null
  meta: string
}

interface GeneratedBundleLike {
  id?: string
  templates?: unknown[]
  generation?: {
    generatedAt?: string
    model?: string
  }
}

interface SyntaxState {
  valid: boolean
  value?: unknown
  message?: string
  line?: number
  column?: number
}

const { data, status: fetchStatus, error: fetchError, refresh } = await useFetch<AdminTemplatesResponse>(
  '/api/multiform/admin/templates',
  {
    key: 'multiform-admin-templates',
  },
)

const searchQuery = ref('')
const generatedSources = ref<TemplateSource[]>([])
const storedDrafts = ref<StoredAdminTemplateDrafts>({})
const selectedKey = ref('')
const editorText = ref('')
const savedSnapshot = ref('')
const validation = ref<TemplateValidationResult | null>(null)
const validatedSnapshot = ref('')
const validationPending = ref(false)
const notice = ref<{ kind: NoticeKind, message: string } | null>(null)
const storageReady = ref(false)
const editorMode = ref<'visual' | 'json'>('visual')

const registeredSources = computed<TemplateSource[]>(() => (
  (data.value?.templates ?? []).map(template => registeredToSource(template))
))

const allSources = computed(() => [...registeredSources.value, ...generatedSources.value])
const selectedSource = computed(() => allSources.value.find(source => source.key === selectedKey.value) ?? null)
const dirty = computed(() => editorText.value !== savedSnapshot.value)
const hasLocalDraft = computed(() => Boolean(storedDrafts.value[selectedKey.value]))
const validationStale = computed(() => Boolean(validation.value) && editorText.value !== validatedSnapshot.value)

const normalizedSearch = computed(() => searchQuery.value.trim().toLocaleLowerCase('pl-PL'))
const filteredRegistered = computed(() => filterSources(registeredSources.value, normalizedSearch.value))
const filteredGenerated = computed(() => filterSources(generatedSources.value, normalizedSearch.value))

const syntax = computed<SyntaxState>(() => parseJson(editorText.value))
const issueList = computed(() => {
  if (!validation.value) return []
  return [
    ...validation.value.errors,
    ...validation.value.warnings,
  ]
})

const lineCount = computed(() => editorText.value ? editorText.value.split('\n').length : 0)
const characterCount = computed(() => editorText.value.length)
const selectedDraftSavedAt = computed(() => storedDrafts.value[selectedKey.value]?.savedAt ?? '')

watch(registeredSources, (sources) => {
  if (!selectedKey.value && sources[0]) loadSource(sources[0].key, false)
}, { immediate: true })

onBeforeRouteLeave(() => {
  if (!dirty.value || !import.meta.client) return true
  return window.confirm('Masz niezapisane zmiany w template JSON. Czy na pewno chcesz opuścić stronę?')
})

onMounted(() => {
  hydrateBrowserStorage()
  window.addEventListener('beforeunload', handleBeforeUnload)
  window.addEventListener('keydown', handleSaveShortcut)
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
  window.removeEventListener('keydown', handleSaveShortcut)
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function registeredToSource(entry: RegisteredAdminTemplate): TemplateSource {
  return {
    key: entry.key,
    kind: 'registered',
    id: entry.id,
    label: entry.label,
    bank: entry.bank,
    template: entry.template,
    validation: entry.validation,
    meta: `${entry.summary.pages} str. · ${entry.summary.mappedFieldCount}/${entry.summary.fieldCount} pól`,
  }
}

function filterSources(sources: readonly TemplateSource[], query: string) {
  if (!query) return sources
  return sources.filter(source => (
    `${source.label} ${source.id} ${source.bank}`.toLocaleLowerCase('pl-PL').includes(query)
  ))
}

function parseJson(text: string): SyntaxState {
  if (!text.trim()) return { valid: false, message: 'Edytor jest pusty.' }

  try {
    return { valid: true, value: JSON.parse(text) as unknown }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Nie udało się odczytać JSON.'
    const positionMatch = message.match(/position\s+(\d+)/i)
    if (!positionMatch) return { valid: false, message }

    const position = Number(positionMatch[1])
    const beforeError = text.slice(0, position)
    const lines = beforeError.split('\n')
    return {
      valid: false,
      message,
      line: lines.length,
      column: (lines.at(-1)?.length ?? 0) + 1,
    }
  }
}

function loadSource(key: string, confirmDirty = true) {
  const source = allSources.value.find(item => item.key === key)
  if (!source || key === selectedKey.value && editorText.value) return
  if (confirmDirty && dirty.value && !window.confirm('Porzucić niezapisane zmiany w bieżącym szablonie?')) return

  const localDraft = storedDrafts.value[key]
  const text = localDraft?.text ?? JSON.stringify(source.template, null, 2)
  selectedKey.value = key
  editorText.value = text
  savedSnapshot.value = text
  validation.value = localDraft ? null : source.validation
  validatedSnapshot.value = localDraft ? '' : text
  notice.value = null
}

function selectSource(key: string) {
  if (key === selectedKey.value) return
  loadSource(key)
}

function hydrateBrowserStorage() {
  storedDrafts.value = readStoredDrafts()
  generatedSources.value = readGeneratedSources()
  storageReady.value = true

  if (selectedKey.value) {
    const localDraft = storedDrafts.value[selectedKey.value]
    if (localDraft) {
      editorText.value = localDraft.text
      savedSnapshot.value = localDraft.text
      validation.value = null
      validatedSnapshot.value = ''
    }
  }
  else if (allSources.value[0]) {
    loadSource(allSources.value[0].key, false)
  }
}

function readStoredDrafts(): StoredAdminTemplateDrafts {
  try {
    const raw = window.localStorage.getItem(ADMIN_TEMPLATE_DRAFTS_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) return {}

    return Object.fromEntries(Object.entries(parsed).flatMap(([key, value]) => {
      if (!isRecord(value) || typeof value.text !== 'string' || typeof value.savedAt !== 'string') return []
      return [[key, { text: value.text, savedAt: value.savedAt }]]
    }))
  }
  catch {
    notice.value = { kind: 'warning', message: 'Nie udało się odczytać lokalnych szkiców z tej przeglądarki.' }
    return {}
  }
}

function readGeneratedSources(): TemplateSource[] {
  try {
    const raw = window.localStorage.getItem(GENERATED_BUNDLE_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as GeneratedBundleLike
    if (!Array.isArray(parsed.templates)) return []

    const generationLabel = parsed.generation?.generatedAt
      ? `AI · ${formatDate(parsed.generation.generatedAt)}`
      : 'Ostatni draft AI'

    return parsed.templates.flatMap((template, index) => {
      if (!isRecord(template)) return []
      const source = isRecord(template.source) ? template.source : {}
      const id = stringValue(template.id, `draft-${index + 1}`)
      return [{
        key: `generated:${stringValue(parsed.id, 'latest')}:${id}:${index}`,
        kind: 'generated' as const,
        id,
        label: stringValue(template.label, stringValue(source.fileName, `Draft ${index + 1}`)),
        bank: stringValue(template.bank, 'AI draft'),
        template,
        validation: null,
        meta: generationLabel,
      }]
    })
  }
  catch {
    notice.value = { kind: 'warning', message: 'Ostatni wynik generatora AI nie zawiera poprawnego JSON-u.' }
    return []
  }
}

function formatJson() {
  if (!syntax.value.valid) {
    notice.value = { kind: 'error', message: syntaxErrorLabel(syntax.value) }
    return
  }
  editorText.value = JSON.stringify(syntax.value.value, null, 2)
  notice.value = { kind: 'success', message: 'JSON został sformatowany.' }
}

async function validateEditor() {
  if (!syntax.value.valid) {
    validation.value = null
    validatedSnapshot.value = ''
    notice.value = { kind: 'error', message: syntaxErrorLabel(syntax.value) }
    return
  }

  validationPending.value = true
  notice.value = null
  try {
    validation.value = await $fetch<TemplateValidationResult>('/api/multiform/admin/templates/validate', {
      method: 'POST',
      body: { template: syntax.value.value },
    })
    validatedSnapshot.value = editorText.value
    notice.value = validation.value.valid
      ? { kind: validation.value.fillReady ? 'success' : 'warning', message: validation.value.fillReady ? 'Template jest poprawny i gotowy do wypełniania.' : 'Struktura jest poprawna, ale template nie jest jeszcze gotowy do aktywacji.' }
      : { kind: 'error', message: `Walidacja wykryła ${validation.value.errors.length} ${validation.value.errors.length === 1 ? 'błąd' : 'błędy'}.` }
  }
  catch (error) {
    notice.value = { kind: 'error', message: requestErrorMessage(error, 'Nie udało się zweryfikować template JSON.') }
  }
  finally {
    validationPending.value = false
  }
}

function saveLocalDraft() {
  const source = selectedSource.value
  if (!source) return

  const nextDrafts: StoredAdminTemplateDrafts = {
    ...storedDrafts.value,
    [source.key]: {
      text: editorText.value,
      savedAt: new Date().toISOString(),
    },
  }

  try {
    window.localStorage.setItem(ADMIN_TEMPLATE_DRAFTS_STORAGE_KEY, JSON.stringify(nextDrafts))
    storedDrafts.value = nextDrafts
    savedSnapshot.value = editorText.value
    notice.value = syntax.value.valid
      ? { kind: 'success', message: 'Szkic zapisano lokalnie w tej przeglądarce.' }
      : { kind: 'warning', message: 'Szkic zapisano lokalnie, ale JSON ma błąd składni.' }
  }
  catch {
    notice.value = { kind: 'error', message: 'Nie udało się zapisać szkicu. Pamięć przeglądarki może być pełna.' }
  }
}

function resetToSource() {
  const source = selectedSource.value
  if (!source) return
  const needsConfirmation = dirty.value || hasLocalDraft.value
  if (needsConfirmation && !window.confirm('Usunąć lokalny szkic i przywrócić JSON źródłowy?')) return

  const nextDrafts = { ...storedDrafts.value }
  delete nextDrafts[source.key]
  try {
    window.localStorage.setItem(ADMIN_TEMPLATE_DRAFTS_STORAGE_KEY, JSON.stringify(nextDrafts))
    storedDrafts.value = nextDrafts
  }
  catch {
    notice.value = { kind: 'error', message: 'Nie udało się usunąć lokalnego szkicu.' }
    return
  }

  const text = JSON.stringify(source.template, null, 2)
  editorText.value = text
  savedSnapshot.value = text
  validation.value = source.validation
  validatedSnapshot.value = source.validation ? text : ''
  notice.value = { kind: 'success', message: 'Przywrócono JSON źródłowy.' }
}

function downloadJson() {
  const source = selectedSource.value
  if (!source) return
  if (!syntax.value.valid) {
    notice.value = { kind: 'error', message: 'Popraw składnię JSON przed pobraniem pliku.' }
    return
  }

  const content = `${JSON.stringify(syntax.value.value, null, 2)}\n`
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${safeFileName(source.id)}-template.json`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
  notice.value = { kind: 'success', message: 'Pobrano bieżącą wersję JSON.' }
}

function handleBeforeUnload(event: BeforeUnloadEvent) {
  if (!dirty.value) return
  event.preventDefault()
  event.returnValue = ''
}

function handleSaveShortcut(event: KeyboardEvent) {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLocaleLowerCase('pl-PL') !== 's') return
  event.preventDefault()
  saveLocalDraft()
}

function syntaxErrorLabel(state: SyntaxState) {
  if (state.line && state.column) return `Błąd składni JSON w wierszu ${state.line}, kolumnie ${state.column}.`
  return state.message ?? 'JSON ma niepoprawną składnię.'
}

function requestErrorMessage(error: unknown, fallback: string) {
  if (!isRecord(error)) return fallback
  if (typeof error.statusMessage === 'string') return error.statusMessage
  if (typeof error.message === 'string') return error.message
  const response = isRecord(error.data) ? error.data : undefined
  return typeof response?.statusMessage === 'string' ? response.statusMessage : fallback
}

function safeFileName(value: string) {
  return value.trim().toLocaleLowerCase('pl-PL').replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') || 'multiform'
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

function issueKey(issue: TemplateValidationIssue, index: number) {
  return `${issue.severity}:${issue.path}:${issue.code}:${index}`
}
</script>

<template>
  <div class="admin-page">
    <header class="admin-nav">
      <NuxtLink class="brand" to="/" aria-label="OpenExpert — strona główna">
        <picture>
          <source srcset="/assets/logo-dark.svg" media="(prefers-color-scheme: dark)">
          <img class="brand__logo" src="/assets/logo-light.svg" alt="">
        </picture>
        <span>OpenExpert</span>
      </NuxtLink>

      <div class="admin-nav__actions">
        <span class="admin-badge"><span aria-hidden="true" /> Template admin</span>
        <NuxtLink class="back-link" to="/multiform-eve">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
          Wróć do Multiform Eve
        </NuxtLink>
      </div>
    </header>

    <main class="admin-main">
      <section class="page-heading">
        <div>
          <p class="eyebrow">Multiform Eve · narzędzie administratora</p>
          <h1>Template JSON <em>workspace</em></h1>
          <p>Przeglądaj mapowania PDF, poprawiaj JSON ręcznie i sprawdzaj go tym samym walidatorem, którego używa backend.</p>
        </div>

        <button type="button" class="refresh-button" :disabled="fetchStatus === 'pending'" @click="refresh()">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5" /><path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5" /></svg>
          {{ fetchStatus === 'pending' ? 'Odświeżam…' : 'Odśwież rejestr' }}
        </button>
      </section>

      <div class="local-only-banner" role="note">
        <span class="local-only-banner__icon" aria-hidden="true">!</span>
        <div>
          <strong>To jest lokalny szkic — nie aktywny template</strong>
          <p>Zapis w tym panelu trafia wyłącznie do tej przeglądarki. Nie zmienia rejestru, działania Eve ani generowanych PDF-ów. Pobierz JSON, aby przekazać go do audytu i publikacji.</p>
        </div>
      </div>

      <div class="render-contract-banner" role="note">
        <span class="render-contract-banner__version">V2</span>
        <div>
          <strong>JSON zawiera pełny kontrakt wydruku</strong>
          <p><code>source.pages</code> opisuje MediaBox, CropBox, obrót i UserUnit; każdy target ma dokładny prostokąt widgetu lub <code>box</code> oraz <code>appearance</code> z fontem, rozmiarem, letter spacingiem, wyrównaniem, overflow i stylem checkboxa.</p>
        </div>
      </div>

      <p v-if="fetchError" class="api-error" role="alert">
        Nie udało się pobrać rejestru template’ów. {{ fetchError.message }}
      </p>

      <div class="admin-workspace" :class="{ 'admin-workspace--visual': editorMode === 'visual' }">
        <aside class="source-panel" aria-label="Lista template JSON">
          <div class="source-panel__header">
            <div>
              <span class="section-kicker">Źródła</span>
              <strong>Template’y</strong>
            </div>
            <span class="source-count">{{ allSources.length }}</span>
          </div>

          <label class="search-field">
            <span class="sr-only">Szukaj template’u</span>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input v-model="searchQuery" type="search" placeholder="Szukaj po nazwie lub banku">
          </label>

          <div class="source-panel__scroll">
            <div class="source-group">
              <div class="source-group__label">
                <span>Rejestr aplikacji</span>
                <strong>{{ filteredRegistered.length }}</strong>
              </div>

              <div v-if="fetchStatus === 'pending' && !registeredSources.length" class="source-loading">
                <span class="spinner" aria-hidden="true" /> Pobieram template’y…
              </div>

              <button
                v-for="source in filteredRegistered"
                :key="source.key"
                type="button"
                class="source-card"
                :class="{ 'source-card--active': source.key === selectedKey }"
                :aria-pressed="source.key === selectedKey"
                @click="selectSource(source.key)"
              >
                <span class="source-card__topline">
                  <span class="source-tag source-tag--registered">Zarejestrowany</span>
                  <span v-if="storedDrafts[source.key]" class="draft-dot" title="Ma lokalny szkic" aria-label="Ma lokalny szkic" />
                </span>
                <strong>{{ source.label }}</strong>
                <span>{{ source.bank }} · {{ source.meta }}</span>
              </button>

              <p v-if="fetchStatus !== 'pending' && !filteredRegistered.length" class="source-empty">
                Brak pasujących template’ów w rejestrze.
              </p>
            </div>

            <div class="source-group source-group--generated">
              <div class="source-group__label">
                <span>Ostatni wynik AI</span>
                <strong>{{ filteredGenerated.length }}</strong>
              </div>

              <button
                v-for="source in filteredGenerated"
                :key="source.key"
                type="button"
                class="source-card"
                :class="{ 'source-card--active': source.key === selectedKey }"
                :aria-pressed="source.key === selectedKey"
                @click="selectSource(source.key)"
              >
                <span class="source-card__topline">
                  <span class="source-tag source-tag--generated">Draft AI</span>
                  <span v-if="storedDrafts[source.key]" class="draft-dot" title="Ma lokalny szkic" aria-label="Ma lokalny szkic" />
                </span>
                <strong>{{ source.label }}</strong>
                <span>{{ source.bank }} · {{ source.meta }}</span>
              </button>

              <p v-if="storageReady && !generatedSources.length" class="source-empty">
                Najpierw wygeneruj template JSON na stronie Multiform Eve. Ostatni wynik pojawi się tutaj automatycznie.
              </p>
              <p v-else-if="generatedSources.length && !filteredGenerated.length" class="source-empty">
                Brak draftów pasujących do wyszukiwania.
              </p>
            </div>
          </div>
        </aside>

        <section class="editor-panel" :class="{ 'editor-panel--visual': editorMode === 'visual' }" aria-label="Edytor template JSON">
          <template v-if="selectedSource">
            <header class="editor-header">
              <div class="editor-title">
                <span class="section-kicker">{{ selectedSource.kind === 'registered' ? 'Template z rejestru' : 'Wygenerowany draft AI' }}</span>
                <div>
                  <h2>{{ selectedSource.label }}</h2>
                  <span v-if="dirty" class="modified-badge">Niezapisane zmiany</span>
                  <span v-else-if="hasLocalDraft" class="saved-badge">Szkic lokalny</span>
                </div>
                <p><code>{{ selectedSource.id }}</code> · {{ selectedSource.bank }}</p>
              </div>

              <div class="editor-actions editor-actions--primary">
                <button type="button" class="action-button" @click="formatJson">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" /><path d="M8 8h8v8H8z" /></svg>
                  Formatuj
                </button>
                <button type="button" class="action-button" :disabled="validationPending" @click="validateEditor">
                  <span v-if="validationPending" class="spinner spinner--small" aria-hidden="true" />
                  <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
                  {{ validationPending ? 'Sprawdzam…' : 'Waliduj' }}
                </button>
                <button type="button" class="action-button action-button--primary" @click="saveLocalDraft">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" /><path d="M17 21v-8H7v8M7 3v5h8" /></svg>
                  Zapisz szkic
                </button>
              </div>
            </header>

            <div class="editor-secondary-bar">
              <div class="editor-secondary-bar__left">
                <div class="editor-view-tabs" role="tablist" aria-label="Tryb edycji template’u">
                  <button type="button" role="tab" :aria-selected="editorMode === 'visual'" :class="{ active: editorMode === 'visual' }" @click="editorMode = 'visual'">
                    Wizualny
                  </button>
                  <button type="button" role="tab" :aria-selected="editorMode === 'json'" :class="{ active: editorMode === 'json' }" @click="editorMode = 'json'">
                    JSON
                  </button>
                </div>
                <div class="editor-actions">
                  <button type="button" class="text-action" :disabled="!dirty && !hasLocalDraft" @click="resetToSource">
                    Przywróć źródło
                  </button>
                  <button type="button" class="text-action" @click="downloadJson">
                    Pobierz JSON
                  </button>
                </div>
              </div>
              <span>⌘/Ctrl + S zapisuje lokalny szkic</span>
            </div>

            <ClientOnly>
              <PdfTemplateVisualEditor
                v-show="editorMode === 'visual'"
                :template-text="editorText"
                :template-id="selectedSource.id"
                :source-kind="selectedSource.kind"
                @update:template-text="editorText = $event"
              />
              <template #fallback>
                <div class="visual-editor-fallback"><span class="spinner" aria-hidden="true" /> Uruchamiam podgląd PDF…</div>
              </template>
            </ClientOnly>

            <template v-if="editorMode === 'json'">
              <textarea
                v-model="editorText"
                class="json-editor"
                spellcheck="false"
                wrap="off"
                aria-label="Treść template JSON"
                aria-describedby="editor-status"
              />

              <footer id="editor-status" class="editor-footer">
                <span :class="syntax.valid ? 'syntax-ok' : 'syntax-error'">
                  <span aria-hidden="true">{{ syntax.valid ? '●' : '!' }}</span>
                  {{ syntax.valid ? 'Poprawna składnia JSON' : syntaxErrorLabel(syntax) }}
                </span>
                <span>{{ lineCount }} wierszy · {{ characterCount.toLocaleString('pl-PL') }} znaków</span>
              </footer>
            </template>
          </template>

          <div v-else class="editor-empty">
            <span aria-hidden="true">{ }</span>
            <strong>Wybierz template JSON</strong>
            <p>Po lewej wybierz plik z rejestru lub ostatni draft wygenerowany przez AI.</p>
          </div>
        </section>

        <aside class="inspector-panel" aria-label="Wynik walidacji">
          <div class="inspector-heading">
            <div>
              <span class="section-kicker">Kontrola jakości</span>
              <h2>Inspector</h2>
            </div>
            <span v-if="validationStale" class="stale-badge">Nieaktualna</span>
          </div>

          <template v-if="selectedSource">
            <div v-if="notice" class="notice" :class="`notice--${notice.kind}`" role="status" aria-live="polite">
              {{ notice.message }}
            </div>

            <div v-if="validation" class="validation-status" :class="{ 'validation-status--ready': validation.fillReady, 'validation-status--invalid': !validation.valid }">
              <span class="validation-status__mark" aria-hidden="true">{{ validation.valid ? (validation.fillReady ? '✓' : '!') : '×' }}</span>
              <div>
                <strong>{{ validation.valid ? (validation.fillReady ? 'Gotowy do wypełniania' : 'Wymaga dalszego audytu') : 'Template ma błędy' }}</strong>
                <span>{{ validation.kind === 'generated-draft' ? 'Draft wygenerowany przez AI' : 'Struktura document-template' }}</span>
              </div>
            </div>

            <button v-else type="button" class="validate-prompt" :disabled="validationPending" @click="validateEditor">
              <span class="validate-prompt__icon" aria-hidden="true">✓</span>
              <span><strong>Uruchom walidację</strong><small>Sprawdź strukturę i gotowość mapowań</small></span>
            </button>

            <div v-if="validation" class="metric-grid" :class="{ 'metric-grid--stale': validationStale }">
              <div><span>Bindings</span><strong>{{ validation.summary.bindingCount }}</strong></div>
              <div><span>Zmapowane</span><strong>{{ validation.summary.mappedBindingCount }}</strong></div>
              <div><span>Gotowe</span><strong>{{ validation.summary.readyBindingCount }}</strong></div>
              <div><span>Do audytu</span><strong>{{ validation.summary.needsReviewCount }}</strong></div>
            </div>

            <section v-if="issueList.length" class="issue-section" :class="{ 'issue-section--stale': validationStale }">
              <div class="inspector-section-label">
                <span>Problemy i uwagi</span>
                <strong>{{ issueList.length }}</strong>
              </div>
              <ul class="issue-list">
                <li v-for="(issue, index) in issueList" :key="issueKey(issue, index)" :class="`issue--${issue.severity}`">
                  <div><span>{{ issue.severity === 'error' ? 'Błąd' : 'Uwaga' }}</span><code>{{ issue.path }}</code></div>
                  <p>{{ issue.message }}</p>
                </li>
              </ul>
            </section>

            <div v-else-if="validation" class="no-issues" :class="{ 'no-issues--stale': validationStale }">
              <span aria-hidden="true">✓</span>
              <p><strong>Brak błędów i ostrzeżeń</strong>Walidator nie wykrył problemów strukturalnych.</p>
            </div>

            <section class="draft-info">
              <div class="inspector-section-label"><span>Szkic w przeglądarce</span></div>
              <template v-if="hasLocalDraft">
                <strong>Zapisany lokalnie</strong>
                <span>{{ selectedDraftSavedAt ? formatDate(selectedDraftSavedAt) : '—' }}</span>
              </template>
              <template v-else>
                <strong>Brak lokalnego szkicu</strong>
                <span>Edytujesz kopię danych źródłowych.</span>
              </template>
            </section>

            <div class="publish-note">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
              <p><strong>Brak automatycznej publikacji.</strong> Ten panel celowo nie nadpisuje szablonów używanych przez renderer PDF.</p>
            </div>
          </template>

          <p v-else class="inspector-empty">Wybierz template, aby zobaczyć wynik walidacji.</p>
        </aside>
      </div>
    </main>
  </div>
</template>

<style scoped>
.admin-page {
  --admin-accent: #2563eb;
  --admin-accent-soft: #eff6ff;
  --admin-positive: #15803d;
  --admin-positive-soft: #f0fdf4;
  --admin-warning: #b45309;
  --admin-warning-soft: #fffbeb;
  --admin-danger: #b91c1c;
  --admin-danger-soft: #fef2f2;
  min-height: 100vh;
  color: var(--fg-primary);
  background: var(--bg-default);
  font-family: var(--font-sans);
}

.admin-nav {
  position: sticky;
  z-index: 30;
  top: 0;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 max(24px, calc((100vw - 1500px) / 2));
  background: color-mix(in srgb, var(--bg-default) 92%, transparent);
  border-bottom: 1px solid var(--border-default);
  backdrop-filter: blur(16px);
}

.brand { display: inline-flex; align-items: center; gap: 10px; color: var(--fg-primary); font-size: 14px; font-weight: var(--weight-medium); text-decoration: none; letter-spacing: var(--tracking-snug); }
.brand__logo { display: block; height: 20px; }
.admin-nav__actions { display: flex; align-items: center; gap: 10px; }

.admin-badge,
.back-link {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--border-default);
  border-radius: 999px;
  color: var(--fg-secondary);
  font-size: 11px;
  white-space: nowrap;
}

.admin-badge { gap: 7px; padding: 7px 10px; font-family: var(--font-mono); }
.admin-badge > span { width: 6px; height: 6px; background: var(--admin-accent); border-radius: 50%; box-shadow: 0 0 0 3px color-mix(in srgb, var(--admin-accent) 14%, transparent); }
.back-link { gap: 5px; padding: 7px 11px; text-decoration: none; transition: border-color var(--transition-fast), color var(--transition-fast); }
.back-link:hover { color: var(--fg-primary); border-color: var(--border-strong); }

.admin-main {
  width: min(1500px, calc(100% - 48px));
  margin: 0 auto;
  padding: 44px 0 72px;
}

.page-heading { display: flex; align-items: end; justify-content: space-between; gap: 32px; margin-bottom: 26px; }
.eyebrow,
.section-kicker { color: var(--admin-accent); font-family: var(--font-mono); font-size: 10px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; }
.eyebrow { margin: 0 0 9px; }
.page-heading h1 { margin: 0; font-family: var(--font-serif); font-size: clamp(38px, 4vw, 54px); font-weight: 400; line-height: 1; letter-spacing: -.03em; }
.page-heading h1 em { color: var(--fg-secondary); }
.page-heading p:last-child { max-width: 720px; margin: 14px 0 0; color: var(--fg-secondary); font-size: 15px; line-height: 1.6; }

.refresh-button,
.action-button,
.text-action,
.validate-prompt { font: inherit; cursor: pointer; }

.refresh-button {
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 8px 12px;
  color: var(--fg-secondary);
  background: var(--bg-default);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  font-size: 12px;
}
.refresh-button:hover:not(:disabled) { color: var(--fg-primary); border-color: var(--border-strong); }

.local-only-banner {
  display: flex;
  gap: 13px;
  align-items: flex-start;
  padding: 14px 16px;
  margin-bottom: 18px;
  color: var(--admin-warning);
  background: var(--admin-warning-soft);
  border: 1px solid color-mix(in srgb, var(--admin-warning) 30%, transparent);
  border-radius: var(--radius-lg);
}
.local-only-banner__icon { width: 23px; height: 23px; display: grid; flex: 0 0 auto; place-items: center; border: 1px solid currentColor; border-radius: 50%; font-family: var(--font-mono); font-size: 11px; font-weight: 600; }
.local-only-banner strong { display: block; margin-bottom: 3px; color: currentColor; font-size: 13px; }
.local-only-banner p { margin: 0; color: color-mix(in srgb, var(--admin-warning) 88%, var(--fg-primary)); font-size: 12px; line-height: 1.55; }
.api-error { padding: 12px 14px; margin: 0 0 18px; color: var(--admin-danger); background: var(--admin-danger-soft); border: 1px solid color-mix(in srgb, var(--admin-danger) 28%, transparent); border-radius: var(--radius-md); font-size: 12px; }

.render-contract-banner {
  display: flex;
  align-items: flex-start;
  gap: 13px;
  padding: 13px 16px;
  margin: -7px 0 18px;
  color: var(--admin-accent);
  background: var(--admin-accent-soft);
  border: 1px solid color-mix(in srgb, var(--admin-accent) 24%, transparent);
  border-radius: var(--radius-lg);
}
.render-contract-banner__version { flex: 0 0 auto; padding: 5px 7px; color: #fff; background: var(--admin-accent); border-radius: var(--radius-sm); font-family: var(--font-mono); font-size: 9px; font-weight: 700; }
.render-contract-banner strong { display: block; margin-bottom: 3px; color: var(--fg-primary); font-size: 12px; }
.render-contract-banner p { margin: 0; color: var(--fg-secondary); font-size: 11px; line-height: 1.55; }
.render-contract-banner code { color: var(--admin-accent); font-family: var(--font-mono); font-size: .92em; }

.admin-workspace { display: grid; grid-template-columns: 260px minmax(480px, 1fr) 310px; gap: 14px; align-items: start; }
.admin-workspace--visual { grid-template-columns: 240px minmax(0, 1fr); }
.admin-workspace--visual .inspector-panel { position: static; grid-column: 2; max-height: none; }
.source-panel,
.editor-panel,
.inspector-panel { min-width: 0; background: var(--bg-default); border: 1px solid var(--border-default); border-radius: var(--radius-lg); }
.source-panel,
.inspector-panel { position: sticky; top: 78px; max-height: calc(100vh - 96px); overflow: hidden; }

.source-panel { display: flex; flex-direction: column; }
.source-panel__header { display: flex; align-items: center; justify-content: space-between; padding: 16px; border-bottom: 1px solid var(--border-default); }
.source-panel__header > div { display: grid; gap: 4px; }
.source-panel__header strong { font-family: var(--font-serif); font-size: 22px; font-weight: 400; }
.source-count { min-width: 27px; padding: 5px 7px; color: var(--fg-secondary); background: var(--bg-muted); border-radius: 999px; font-family: var(--font-mono); font-size: 10px; text-align: center; }

.search-field { position: relative; display: flex; align-items: center; margin: 12px; }
.search-field svg { position: absolute; left: 11px; color: var(--fg-tertiary); pointer-events: none; }
.search-field input { width: 100%; height: 38px; padding: 8px 11px 8px 34px; color: var(--fg-primary); background: var(--bg-subtle); border: 1px solid var(--border-default); border-radius: var(--radius-md); font: inherit; font-size: 12px; }
.search-field input::placeholder { color: var(--fg-tertiary); }
.source-panel__scroll { overflow: auto; padding: 0 9px 12px; }
.source-group + .source-group { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--border-default); }
.source-group__label,
.inspector-section-label { display: flex; align-items: center; justify-content: space-between; color: var(--fg-tertiary); font-family: var(--font-mono); font-size: 9px; letter-spacing: .07em; text-transform: uppercase; }
.source-group__label { padding: 0 4px 8px; }
.source-group__label strong,
.inspector-section-label strong { font-weight: 500; }

.source-card { width: 100%; display: grid; gap: 6px; padding: 11px; margin-bottom: 6px; color: var(--fg-primary); text-align: left; background: transparent; border: 1px solid transparent; border-radius: var(--radius-md); font: inherit; cursor: pointer; transition: background var(--transition-fast), border-color var(--transition-fast); }
.source-card:hover { background: var(--bg-subtle); border-color: var(--border-default); }
.source-card--active { background: var(--admin-accent-soft); border-color: color-mix(in srgb, var(--admin-accent) 35%, transparent); }
.source-card--active:hover { background: var(--admin-accent-soft); border-color: var(--admin-accent); }
.source-card__topline { min-height: 17px; display: flex; align-items: center; justify-content: space-between; }
.source-card > strong { overflow: hidden; font-size: 12px; line-height: 1.35; text-overflow: ellipsis; }
.source-card > span:last-child { overflow: hidden; color: var(--fg-tertiary); font-size: 10px; line-height: 1.4; text-overflow: ellipsis; white-space: nowrap; }
.source-tag { padding: 4px 6px; border-radius: 999px; font-family: var(--font-mono); font-size: 8px; font-weight: 600; letter-spacing: .03em; text-transform: uppercase; }
.source-tag--registered { color: var(--admin-positive); background: var(--admin-positive-soft); }
.source-tag--generated { color: var(--admin-accent); background: var(--admin-accent-soft); }
.draft-dot { width: 7px; height: 7px; background: var(--admin-warning); border-radius: 50%; box-shadow: 0 0 0 3px color-mix(in srgb, var(--admin-warning) 14%, transparent); }
.source-empty { padding: 8px 5px 4px; margin: 0; color: var(--fg-tertiary); font-size: 11px; line-height: 1.5; }
.source-loading { display: flex; align-items: center; gap: 8px; padding: 10px 5px; color: var(--fg-tertiary); font-size: 11px; }

.editor-panel { overflow: hidden; }
.editor-panel--visual { overflow-x: auto; }
.editor-header { min-height: 101px; display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; padding: 15px 16px; border-bottom: 1px solid var(--border-default); }
.editor-title { min-width: 0; display: grid; gap: 5px; }
.editor-title > div { display: flex; align-items: center; gap: 9px; }
.editor-title h2 { overflow: hidden; margin: 0; font-family: var(--font-serif); font-size: 22px; font-weight: 400; line-height: 1.15; text-overflow: ellipsis; white-space: nowrap; }
.editor-title p { margin: 0; color: var(--fg-tertiary); font-size: 11px; }
.editor-title code { color: var(--fg-secondary); font-family: var(--font-mono); font-size: 10px; }
.modified-badge,
.saved-badge,
.stale-badge { padding: 4px 6px; border-radius: 999px; font-family: var(--font-mono); font-size: 8px; white-space: nowrap; }
.modified-badge { color: var(--admin-warning); background: var(--admin-warning-soft); }
.saved-badge { color: var(--admin-positive); background: var(--admin-positive-soft); }
.stale-badge { color: var(--admin-warning); background: var(--admin-warning-soft); }

.editor-actions { display: flex; align-items: center; gap: 6px; }
.editor-actions--primary { flex-wrap: wrap; justify-content: flex-end; }
.action-button { min-height: 34px; display: inline-flex; align-items: center; gap: 6px; padding: 7px 9px; color: var(--fg-secondary); background: var(--bg-default); border: 1px solid var(--border-default); border-radius: var(--radius-md); font-size: 11px; white-space: nowrap; }
.action-button:hover:not(:disabled) { color: var(--fg-primary); border-color: var(--border-strong); }
.action-button--primary { color: #fff; background: var(--admin-accent); border-color: var(--admin-accent); }
.action-button--primary:hover:not(:disabled) { color: #fff; background: color-mix(in srgb, var(--admin-accent) 88%, black); border-color: color-mix(in srgb, var(--admin-accent) 88%, black); }
.action-button:disabled,
.refresh-button:disabled,
.validate-prompt:disabled { opacity: .55; cursor: not-allowed; }
.editor-secondary-bar { min-height: 42px; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 10px; color: var(--fg-tertiary); background: var(--bg-subtle); border-bottom: 1px solid var(--border-default); font-family: var(--font-mono); font-size: 9px; }
.editor-secondary-bar__left { display: flex; align-items: center; gap: 12px; }
.editor-view-tabs { display: inline-flex; padding: 2px; background: var(--bg-muted); border: 1px solid var(--border-default); border-radius: var(--radius-sm); }
.editor-view-tabs button { min-height: 27px; padding: 5px 9px; color: var(--fg-tertiary); background: transparent; border: 0; border-radius: calc(var(--radius-sm) - 2px); font: inherit; font-size: 9px; cursor: pointer; }
.editor-view-tabs button.active { color: var(--fg-primary); background: var(--bg-default); box-shadow: 0 1px 2px rgb(15 23 42 / 10%); }
.text-action { padding: 0; color: var(--fg-secondary); background: transparent; border: 0; font-family: var(--font-sans); font-size: 10px; }
.text-action:hover:not(:disabled) { color: var(--admin-accent); }
.text-action:disabled { color: var(--fg-disabled); cursor: default; }

.json-editor { width: 100%; min-height: 590px; display: block; resize: vertical; padding: 18px; color: var(--fg-primary); caret-color: var(--admin-accent); background: var(--bg-default); border: 0; border-radius: 0; outline: 0; font-family: var(--font-mono); font-size: 11px; line-height: 1.65; tab-size: 2; }
.visual-editor-fallback { min-height: 640px; display: flex; align-items: center; justify-content: center; gap: 9px; color: var(--fg-tertiary); font-size: 11px; }
.json-editor:focus { box-shadow: inset 0 0 0 2px var(--admin-accent); }
.editor-footer { min-height: 35px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 14px; color: var(--fg-tertiary); background: var(--bg-subtle); border-top: 1px solid var(--border-default); font-family: var(--font-mono); font-size: 9px; }
.syntax-ok,
.syntax-error { display: inline-flex; align-items: center; gap: 6px; }
.syntax-ok { color: var(--admin-positive); }
.syntax-error { color: var(--admin-danger); }
.editor-empty { min-height: 760px; display: grid; align-content: center; justify-items: center; padding: 40px; color: var(--fg-tertiary); text-align: center; }
.editor-empty > span { margin-bottom: 10px; font-family: var(--font-mono); font-size: 28px; }
.editor-empty strong { color: var(--fg-primary); font-size: 14px; }
.editor-empty p { max-width: 330px; margin: 6px 0 0; font-size: 12px; line-height: 1.5; }

.inspector-panel { overflow: auto; padding-bottom: 14px; }
.inspector-heading { display: flex; align-items: center; justify-content: space-between; padding: 16px; border-bottom: 1px solid var(--border-default); }
.inspector-heading > div { display: grid; gap: 4px; }
.inspector-heading h2 { margin: 0; font-family: var(--font-serif); font-size: 22px; font-weight: 400; }
.notice { padding: 10px 11px; margin: 12px 12px 0; border: 1px solid; border-radius: var(--radius-md); font-size: 10px; line-height: 1.5; }
.notice--success { color: var(--admin-positive); background: var(--admin-positive-soft); border-color: color-mix(in srgb, var(--admin-positive) 28%, transparent); }
.notice--warning { color: var(--admin-warning); background: var(--admin-warning-soft); border-color: color-mix(in srgb, var(--admin-warning) 28%, transparent); }
.notice--error { color: var(--admin-danger); background: var(--admin-danger-soft); border-color: color-mix(in srgb, var(--admin-danger) 28%, transparent); }

.validation-status { display: flex; gap: 10px; align-items: center; padding: 12px; margin: 12px; color: var(--admin-warning); background: var(--admin-warning-soft); border: 1px solid color-mix(in srgb, var(--admin-warning) 25%, transparent); border-radius: var(--radius-md); }
.validation-status--ready { color: var(--admin-positive); background: var(--admin-positive-soft); border-color: color-mix(in srgb, var(--admin-positive) 25%, transparent); }
.validation-status--invalid { color: var(--admin-danger); background: var(--admin-danger-soft); border-color: color-mix(in srgb, var(--admin-danger) 25%, transparent); }
.validation-status__mark { width: 28px; height: 28px; display: grid; flex: 0 0 auto; place-items: center; border: 1px solid currentColor; border-radius: 50%; font-family: var(--font-mono); font-size: 12px; }
.validation-status div { min-width: 0; display: grid; gap: 2px; }
.validation-status strong { font-size: 11px; }
.validation-status span:last-child { overflow: hidden; color: currentColor; font-size: 9px; opacity: .8; text-overflow: ellipsis; white-space: nowrap; }
.validate-prompt { width: calc(100% - 24px); display: flex; align-items: center; gap: 10px; padding: 11px; margin: 12px; color: var(--fg-primary); text-align: left; background: var(--bg-subtle); border: 1px dashed var(--border-strong); border-radius: var(--radius-md); }
.validate-prompt:hover:not(:disabled) { border-color: var(--admin-accent); }
.validate-prompt__icon { width: 28px; height: 28px; display: grid; flex: 0 0 auto; place-items: center; color: var(--admin-accent); background: var(--admin-accent-soft); border-radius: 50%; font-family: var(--font-mono); font-size: 11px; }
.validate-prompt > span:last-child { display: grid; gap: 2px; }
.validate-prompt strong { font-size: 11px; }
.validate-prompt small { color: var(--fg-tertiary); font-size: 9px; }

.metric-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; margin: 0 12px 14px; overflow: hidden; background: var(--border-default); border: 1px solid var(--border-default); border-radius: var(--radius-md); }
.metric-grid > div { display: grid; gap: 3px; padding: 10px; background: var(--bg-default); }
.metric-grid span { color: var(--fg-tertiary); font-size: 9px; }
.metric-grid strong { font-family: var(--font-mono); font-size: 15px; font-weight: 500; }
.metric-grid--stale,
.issue-section--stale,
.no-issues--stale { opacity: .52; }
.issue-section { padding: 0 12px 14px; }
.inspector-section-label { margin-bottom: 8px; }
.issue-list { max-height: 280px; display: grid; gap: 7px; overflow: auto; padding: 0; margin: 0; list-style: none; }
.issue-list li { padding: 9px; border-left: 2px solid; border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }
.issue--error { background: var(--admin-danger-soft); border-color: var(--admin-danger); }
.issue--warning { background: var(--admin-warning-soft); border-color: var(--admin-warning); }
.issue-list li > div { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.issue-list li > div span { color: var(--fg-secondary); font-family: var(--font-mono); font-size: 8px; font-weight: 600; text-transform: uppercase; }
.issue-list code { overflow: hidden; color: var(--fg-tertiary); font-family: var(--font-mono); font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }
.issue-list p { margin: 5px 0 0; color: var(--fg-secondary); font-size: 10px; line-height: 1.45; }
.no-issues { display: flex; align-items: center; gap: 9px; padding: 11px; margin: 0 12px 14px; color: var(--admin-positive); background: var(--admin-positive-soft); border-radius: var(--radius-md); }
.no-issues > span { width: 25px; height: 25px; display: grid; flex: 0 0 auto; place-items: center; border: 1px solid currentColor; border-radius: 50%; font-size: 10px; }
.no-issues p { display: grid; gap: 2px; margin: 0; color: var(--fg-secondary); font-size: 9px; line-height: 1.4; }
.no-issues strong { color: var(--admin-positive); font-size: 10px; }
.draft-info { display: grid; gap: 3px; padding: 13px 12px; border-top: 1px solid var(--border-default); }
.draft-info .inspector-section-label { margin-bottom: 5px; }
.draft-info > strong { font-size: 11px; }
.draft-info > span { color: var(--fg-tertiary); font-size: 9px; line-height: 1.4; }
.publish-note { display: flex; gap: 8px; align-items: flex-start; padding: 11px; margin: 0 12px; color: var(--fg-tertiary); background: var(--bg-subtle); border-radius: var(--radius-md); }
.publish-note svg { flex: 0 0 auto; margin-top: 1px; }
.publish-note p { margin: 0; font-size: 9px; line-height: 1.5; }
.publish-note strong { color: var(--fg-secondary); }
.inspector-empty { padding: 16px; margin: 0; color: var(--fg-tertiary); font-size: 11px; line-height: 1.5; }

.spinner { width: 14px; height: 14px; display: inline-block; border: 2px solid var(--border-strong); border-top-color: var(--admin-accent); border-radius: 50%; animation: spin .7s linear infinite; }
.spinner--small { width: 12px; height: 12px; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; padding: 0; margin: -1px; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 1220px) {
  .admin-workspace { grid-template-columns: 250px minmax(0, 1fr); }
  .inspector-panel { position: static; grid-column: 2; max-height: none; }
  .inspector-panel { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; column-gap: 0; }
  .inspector-heading { grid-column: 1 / -1; }
  .inspector-panel > .notice { grid-column: 1 / -1; }
  .inspector-panel > .publish-note { align-self: end; }
  .admin-workspace--visual { grid-template-columns: minmax(0, 1fr); }
  .admin-workspace--visual .source-panel,
  .admin-workspace--visual .inspector-panel { position: static; grid-column: auto; max-height: none; }
  .admin-workspace--visual .source-panel__scroll { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; overflow: visible; }
  .admin-workspace--visual .source-group + .source-group { margin: 0; padding: 0 0 0 12px; border-top: 0; border-left: 1px solid var(--border-default); }
}

@media (max-width: 880px) {
  .admin-main { width: min(100% - 28px, 720px); padding-top: 30px; }
  .page-heading { align-items: flex-start; }
  .admin-workspace { grid-template-columns: minmax(0, 1fr); }
  .admin-workspace--visual .inspector-panel { grid-column: auto; }
  .source-panel,
  .inspector-panel { position: static; max-height: none; }
  .source-panel__scroll { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; overflow: visible; }
  .source-group + .source-group { margin: 0; padding: 0 0 0 12px; border-top: 0; border-left: 1px solid var(--border-default); }
  .inspector-panel { grid-column: auto; }
  .json-editor { min-height: 520px; }
}

@media (max-width: 640px) {
  .admin-nav { height: 56px; padding: 0 14px; }
  .admin-badge { display: none; }
  .back-link { padding: 7px; }
  .back-link svg { display: none; }
  .admin-main { width: calc(100% - 20px); padding: 24px 0 50px; }
  .page-heading { display: grid; gap: 16px; }
  .page-heading h1 { font-size: 38px; }
  .page-heading p:last-child { font-size: 13px; }
  .refresh-button { justify-self: start; }
  .local-only-banner { padding: 12px; }
  .source-panel__scroll { display: block; }
  .source-group + .source-group { margin-top: 14px; padding: 14px 0 0; border-top: 1px solid var(--border-default); border-left: 0; }
  .admin-workspace--visual .source-panel__scroll { display: block; }
  .admin-workspace--visual .source-group + .source-group { margin-top: 14px; padding: 14px 0 0; border-top: 1px solid var(--border-default); border-left: 0; }
  .editor-header { display: grid; }
  .editor-actions--primary { justify-content: flex-start; }
  .editor-secondary-bar > span { display: none; }
  .editor-secondary-bar__left { width: 100%; justify-content: space-between; }
  .json-editor { min-height: 480px; padding: 14px; font-size: 10px; }
  .editor-footer { align-items: flex-start; flex-direction: column; }
  .inspector-panel { display: block; }
}

@media (prefers-color-scheme: dark) {
  .admin-page {
    --admin-accent: #60a5fa;
    --admin-accent-soft: #172554;
    --admin-positive: #4ade80;
    --admin-positive-soft: #052e16;
    --admin-warning: #fbbf24;
    --admin-warning-soft: #422006;
    --admin-danger: #f87171;
    --admin-danger-soft: #450a0a;
  }
}

@media (prefers-reduced-motion: reduce) {
  .spinner { animation-duration: 1.8s; }
}
</style>
