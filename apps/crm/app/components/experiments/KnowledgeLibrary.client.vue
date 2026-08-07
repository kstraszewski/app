<script setup lang="ts">
import {
  buildDynamicContentBootMessage,
  buildDynamicContentPreviewShell,
  DYNAMIC_CONTENT_IFRAME_SANDBOX,
  isDynamicContentWithinLimits,
  parseDynamicContentPreviewMessage,
  sanitizeDynamicContentHtml,
  type DynamicContentSource,
} from '~/utils/dynamic-content-preview'
import type { MDCParseOptions } from '@nuxtjs/mdc'
import {
  experimentKnowledgePreviewMarkdown,
  type ExperimentKnowledgeKind,
} from '~/utils/experiment-knowledge'
import { contrastingTextColor } from '~/utils/color-contrast'

interface KnowledgeInstitution {
  id: string
  slug: string
  name: string
  logoUrl: string | null
  brandColor: string | null
  brandForegroundColor: string | null
}

interface KnowledgeListItem {
  id: string
  kind: ExperimentKnowledgeKind
  title: string
  snippet: string
  revision?: number
  indexingStatus: 'processing' | 'ready' | 'failed'
  indexingError?: string | null
  chunkCount?: number
  createdAt?: string
  updatedAt: string
  score: number | null
  institutions: KnowledgeInstitution[]
}

interface KnowledgeDocument extends KnowledgeListItem {
  textContent: string | null
  htmlContent: string | null
  cssContent: string | null
  javascriptContent: string | null
  plainText: string
  revision: number
  indexingError: string | null
  embeddingModel: string
  chunkCount: number
}

interface ListResponse {
  data: KnowledgeListItem[]
  meta: {
    query: string | null
    kind: ExperimentKnowledgeKind | null
    institutionId: string | null
    institutions: KnowledgeInstitution[]
    usedSemanticSearch: boolean
  }
}

const route = useRoute()
const toast = useToast()
const searchQuery = ref('')
const kindFilter = ref<'all' | ExperimentKnowledgeKind>('all')
const institutionFilter = ref('all')
const availableInstitutions = ref<KnowledgeInstitution[]>([])
const items = ref<KnowledgeListItem[]>([])
const selectedId = ref<string | null>(null)
const selectedDocument = ref<KnowledgeDocument | null>(null)
const loadingList = ref(true)
const loadingDocument = ref(false)
const saving = ref(false)
const deleting = ref(false)
const semanticSearchUsed = ref(false)
const createModalOpen = ref(false)
const deleteModalOpen = ref(false)
const createKind = ref<ExperimentKnowledgeKind>('text')
const createTitle = ref('')
const createText = ref('')
const createHtml = ref('')
const createCss = ref('')
const createJavaScript = ref('')
const createInstitutionIds = ref<string[]>([])
const uploadName = ref('')
const previewFrame = ref<HTMLIFrameElement | null>(null)
const previewStatus = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const previewError = ref('')
const previewChannelId = ref('')
const previewSrcdoc = ref('')
const previewSource = shallowRef<DynamicContentSource>({ html: '', css: '', javascript: '' })
const previewBooted = ref(false)
let searchTimer: ReturnType<typeof setTimeout> | undefined
let requestSequence = 0

const knowledgeMarkdownParserOptions: MDCParseOptions = {
  remark: {
    plugins: {
      'remark-mdc': false,
    },
  },
  rehype: {
    options: {
      allowDangerousHtml: false,
    },
    plugins: {
      'rehype-raw': false,
    },
  },
  highlight: false,
  toc: false,
  contentHeading: false,
}

const organizationSlug = computed(() => {
  const value = route.params.organizationSlug
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')
})
const apiBase = computed(() => (
  `/api/org/${encodeURIComponent(organizationSlug.value)}/experiments/knowledge`
))
const filteredLabel = computed(() => {
  if (kindFilter.value === 'text') return 'Dokumenty tekstowe'
  if (kindFilter.value === 'dynamic_html') return 'Interaktywne strony'
  return 'Cała wiedza'
})
const createContent = computed(() => createKind.value === 'text' ? createText.value : createHtml.value)
const canCreate = computed(() => Boolean(createTitle.value.trim() && createContent.value.trim()))
const selectedKindLabel = computed(() => (
  selectedDocument.value?.kind === 'dynamic_html' ? 'Interaktywna strona' : 'Dokument tekstowy'
))
const selectedMarkdown = computed(() => {
  const document = selectedDocument.value
  if (!document || document.kind !== 'text') return ''
  return experimentKnowledgePreviewMarkdown(document.title, document.textContent ?? '')
})

function kindIcon(kind: ExperimentKnowledgeKind) {
  return kind === 'dynamic_html' ? 'i-lucide-panels-top-left' : 'i-lucide-file-text'
}

function institutionBrandStyle(institution: KnowledgeInstitution) {
  if (!institution.brandColor) return undefined
  return {
    '--institution-brand': institution.brandColor,
    '--institution-foreground': contrastingTextColor(institution.brandColor) ?? '#FFFFFF',
  }
}

function formatDate(value: string | undefined) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('pl-PL', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function friendlyError(caught: unknown) {
  const statusMessage = typeof caught === 'object' && caught
    ? String((caught as { data?: { statusMessage?: unknown } }).data?.statusMessage ?? '')
    : ''
  return statusMessage || 'Spróbuj ponownie za chwilę.'
}

function routeDocumentId() {
  const value = Array.isArray(route.query.document)
    ? route.query.document[0]
    : route.query.document
  return typeof value === 'string' && value ? value : null
}

async function loadList(options: {
  preserveSelection?: boolean
  preferredDocumentId?: string | null
} = {}) {
  const sequence = ++requestSequence
  loadingList.value = true
  try {
    const response = await $fetch<ListResponse>(apiBase.value, {
      query: {
        q: searchQuery.value.trim() || undefined,
        kind: kindFilter.value === 'all' ? undefined : kindFilter.value,
        institutionId: institutionFilter.value === 'all' ? undefined : institutionFilter.value,
      },
    })
    if (sequence !== requestSequence) return
    items.value = response.data
    semanticSearchUsed.value = response.meta.usedSemanticSearch
    availableInstitutions.value = response.meta.institutions

    const selectionStillVisible = selectedId.value
      && response.data.some(item => item.id === selectedId.value)
    if (options.preferredDocumentId) {
      selectedId.value = options.preferredDocumentId
    }
    else if (!options.preserveSelection || !selectionStillVisible) {
      selectedId.value = response.data[0]?.id ?? null
    }
    if (selectedId.value) await loadDocument(selectedId.value)
    else selectedDocument.value = null
  }
  catch (caught) {
    if (sequence !== requestSequence) return
    toast.add({
      title: 'Nie udało się pobrać wiedzy',
      description: friendlyError(caught),
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  }
  finally {
    if (sequence === requestSequence) loadingList.value = false
  }
}

async function loadDocument(documentId: string) {
  selectedId.value = documentId
  loadingDocument.value = true
  try {
    const response = await $fetch<{ data: KnowledgeDocument }>(
      `${apiBase.value}/${encodeURIComponent(documentId)}`,
    )
    if (selectedId.value !== documentId) return
    selectedDocument.value = response.data
    await nextTick()
    runDynamicPreview()
  }
  catch (caught) {
    toast.add({
      title: 'Nie udało się otworzyć dokumentu',
      description: friendlyError(caught),
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  }
  finally {
    if (selectedId.value === documentId) loadingDocument.value = false
  }
}

function scheduleSearch() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void loadList(), 280)
}

function resetCreateForm() {
  createKind.value = 'text'
  createTitle.value = ''
  createText.value = ''
  createHtml.value = ''
  createCss.value = ''
  createJavaScript.value = ''
  createInstitutionIds.value = []
  uploadName.value = ''
}

function toggleCreateInstitution(institutionId: string) {
  createInstitutionIds.value = createInstitutionIds.value.includes(institutionId)
    ? createInstitutionIds.value.filter(id => id !== institutionId)
    : [...createInstitutionIds.value, institutionId]
}

function titleFromFileName(name: string) {
  return name
    .replace(/\.[^.]+$/u, '')
    .replace(/[-_]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 160)
}

async function handleFileUpload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (file.size > 1_000_000) {
    toast.add({ title: 'Plik jest za duży', description: 'Maksymalny rozmiar importu to 1 MB.', color: 'warning' })
    return
  }
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (!extension || !['txt', 'md', 'markdown', 'html', 'htm'].includes(extension)) {
    toast.add({ title: 'Nieobsługiwany plik', description: 'Wybierz .txt, .md albo .html.', color: 'warning' })
    return
  }
  const content = await file.text()
  uploadName.value = file.name
  createTitle.value ||= titleFromFileName(file.name)
  if (extension === 'html' || extension === 'htm') {
    createKind.value = 'dynamic_html'
    createHtml.value = content
  }
  else {
    createKind.value = 'text'
    createText.value = content
  }
}

async function createDocument() {
  if (!canCreate.value || saving.value) return
  saving.value = true
  try {
    const body = createKind.value === 'text'
      ? {
          kind: 'text',
          title: createTitle.value.trim(),
          textContent: createText.value,
          institutionIds: createInstitutionIds.value,
        }
      : {
          kind: 'dynamic_html',
          title: createTitle.value.trim(),
          htmlContent: createHtml.value,
          cssContent: createCss.value,
          javascriptContent: createJavaScript.value,
          institutionIds: createInstitutionIds.value,
        }
    const response = await $fetch<{ data: KnowledgeDocument }>(apiBase.value, {
      method: 'POST',
      body,
    })
    createModalOpen.value = false
    resetCreateForm()
    searchQuery.value = ''
    kindFilter.value = 'all'
    institutionFilter.value = 'all'
    await loadList({ preserveSelection: true })
    await loadDocument(response.data.id)
    toast.add({
      title: response.data.indexingStatus === 'ready'
        ? 'Dodano i zwektoryzowano'
        : 'Dodano do Wiedzy',
      description: response.data.indexingStatus === 'ready'
        ? 'Dokument jest dostępny w wyszukiwaniu hybrydowym.'
        : 'Wyszukiwanie tekstowe działa, ale embedding wymaga ponowienia przy kolejnym zapisie.',
      color: response.data.indexingStatus === 'ready' ? 'success' : 'warning',
      icon: response.data.indexingStatus === 'ready' ? 'i-lucide-sparkles' : 'i-lucide-triangle-alert',
    })
  }
  catch (caught) {
    toast.add({
      title: 'Nie udało się dodać dokumentu',
      description: friendlyError(caught),
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  }
  finally {
    saving.value = false
  }
}

async function archiveSelectedDocument() {
  const document = selectedDocument.value
  if (!document || deleting.value) return
  deleting.value = true
  try {
    await $fetch(`${apiBase.value}/${encodeURIComponent(document.id)}`, {
      method: 'DELETE',
      body: { expectedRevision: document.revision },
    })
    deleteModalOpen.value = false
    selectedId.value = null
    selectedDocument.value = null
    await loadList()
    toast.add({ title: 'Usunięto z Wiedzy', color: 'success', icon: 'i-lucide-trash-2' })
  }
  catch (caught) {
    toast.add({
      title: 'Nie udało się usunąć dokumentu',
      description: friendlyError(caught),
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  }
  finally {
    deleting.value = false
  }
}

async function copySelectedSource() {
  const document = selectedDocument.value
  if (!document) return
  const value = document.kind === 'text'
    ? document.textContent ?? ''
    : document.htmlContent ?? ''
  try {
    await navigator.clipboard.writeText(value)
    toast.add({ title: 'Treść skopiowana', color: 'success', icon: 'i-lucide-copy-check' })
  }
  catch {
    toast.add({ title: 'Nie udało się skopiować', color: 'error' })
  }
}

function runDynamicPreview() {
  const document = selectedDocument.value
  if (!document || document.kind !== 'dynamic_html') {
    previewStatus.value = 'idle'
    return
  }
  const source: DynamicContentSource = {
    html: sanitizeDynamicContentHtml(document.htmlContent ?? ''),
    css: document.cssContent ?? '',
    javascript: document.javascriptContent ?? '',
  }
  if (!isDynamicContentWithinLimits(source)) {
    previewStatus.value = 'error'
    previewError.value = 'Źródło przekracza limit bezpiecznego podglądu.'
    return
  }
  previewSource.value = source
  previewBooted.value = false
  previewStatus.value = 'loading'
  previewError.value = ''
  previewChannelId.value = crypto.randomUUID()
  previewSrcdoc.value = buildDynamicContentPreviewShell(previewChannelId.value, window.location.origin)
}

function handlePreviewMessage(event: MessageEvent) {
  const contentWindow = previewFrame.value?.contentWindow
  if (!contentWindow || event.source !== contentWindow || event.origin !== 'null') return
  const message = parseDynamicContentPreviewMessage(event.data, previewChannelId.value)
  if (!message) return
  if (message.type === 'ready') {
    if (previewBooted.value) return
    previewBooted.value = true
    contentWindow.postMessage(
      buildDynamicContentBootMessage(previewChannelId.value, previewSource.value),
      '*',
    )
    return
  }
  if (message.type === 'rendered') {
    previewStatus.value = 'ready'
    return
  }
  previewStatus.value = 'error'
  previewError.value = message.message
}

watch(searchQuery, scheduleSearch)
watch(kindFilter, () => void loadList())
watch(institutionFilter, () => void loadList())
watch(
  () => route.query.document,
  () => {
    const documentId = routeDocumentId()
    if (documentId && documentId !== selectedId.value) void loadDocument(documentId)
  },
)

onMounted(() => {
  window.addEventListener('message', handlePreviewMessage)
  void loadList({ preferredDocumentId: routeDocumentId() })
})

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
  window.removeEventListener('message', handlePreviewMessage)
})
</script>

<template>
  <section class="knowledge-library" aria-label="Biblioteka wiedzy">
    <header class="knowledge-toolbar">
      <div class="knowledge-search">
        <UIcon name="i-lucide-search" />
        <input
          v-model="searchQuery"
          type="search"
          maxlength="300"
          placeholder="Szukaj po znaczeniu i treści…"
          aria-label="Szukaj w całej wiedzy"
        >
        <UBadge v-if="searchQuery.trim() && semanticSearchUsed" color="primary" variant="subtle" size="sm">
          FTS + wektory
        </UBadge>
        <UIcon v-if="loadingList" name="i-lucide-loader-circle" class="animate-spin" />
      </div>

      <div class="knowledge-kind-filter" aria-label="Typ wiedzy">
        <button
          v-for="option in [
            { id: 'all', label: 'Wszystko' },
            { id: 'text', label: 'Tekst' },
            { id: 'dynamic_html', label: 'Interaktywne' },
          ]"
          :key="option.id"
          type="button"
          :aria-pressed="kindFilter === option.id"
          @click="kindFilter = option.id as typeof kindFilter"
        >
          {{ option.label }}
        </button>
      </div>

      <label class="knowledge-institution-filter">
        <UIcon name="i-lucide-landmark" />
        <select v-model="institutionFilter" aria-label="Filtruj po instytucji finansowej">
          <option value="all">Wszystkie banki</option>
          <option v-for="institution in availableInstitutions" :key="institution.id" :value="institution.id">
            {{ institution.name }}
          </option>
        </select>
        <UIcon name="i-lucide-chevron-down" />
      </label>

      <UButton
        color="primary"
        icon="i-lucide-plus"
        label="Dodaj wiedzę"
        @click="createModalOpen = true"
      />
    </header>

    <div class="knowledge-workspace">
      <aside class="knowledge-index" aria-label="Dokumenty wiedzy">
        <header>
          <div>
            <span>{{ filteredLabel }}</span>
            <strong>{{ items.length }}</strong>
          </div>
          <small v-if="searchQuery.trim()">Najlepsze dopasowania</small>
          <small v-else>Ostatnio aktualizowane</small>
        </header>

        <div v-if="loadingList && !items.length" class="knowledge-index__loading">
          <USkeleton v-for="index in 5" :key="index" class="h-24 w-full" />
        </div>

        <div v-else-if="!items.length" class="knowledge-empty">
          <span><UIcon name="i-lucide-library-big" /></span>
          <strong>{{ searchQuery.trim() ? 'Brak dopasowań' : 'Wiedza jest jeszcze pusta' }}</strong>
          <p>{{ searchQuery.trim() ? 'Spróbuj innego sformułowania albo zmień filtr.' : 'Dodaj dokument lub zapisz materiał z jednego z edytorów.' }}</p>
          <UButton v-if="!searchQuery.trim()" variant="soft" icon="i-lucide-plus" label="Dodaj pierwszy dokument" @click="createModalOpen = true" />
        </div>

        <div v-else class="knowledge-items">
          <button
            v-for="item in items"
            :key="item.id"
            type="button"
            class="knowledge-item"
            :class="{ 'is-active': selectedId === item.id }"
            @click="loadDocument(item.id)"
          >
            <span class="knowledge-item__icon"><UIcon :name="kindIcon(item.kind)" /></span>
            <span class="knowledge-item__body">
              <span class="knowledge-item__meta">
                <span>{{ item.kind === 'dynamic_html' ? 'Interaktywne' : 'Tekst' }}</span>
                <time>{{ formatDate(item.updatedAt) }}</time>
              </span>
              <strong>{{ item.title }}</strong>
              <span class="knowledge-item__snippet">{{ item.snippet }}</span>
              <span v-if="item.institutions.length" class="knowledge-institution-chips">
                <span
                  v-for="institution in item.institutions"
                  :key="institution.id"
                  :style="institutionBrandStyle(institution)"
                  :class="{ 'has-brand': institution.brandColor }"
                >
                  <UIcon name="i-lucide-landmark" /> {{ institution.name }}
                </span>
              </span>
              <span v-if="item.indexingStatus === 'failed'" class="knowledge-item__warning">
                <UIcon name="i-lucide-triangle-alert" /> Tylko wyszukiwanie tekstowe
              </span>
            </span>
          </button>
        </div>
      </aside>

      <main class="knowledge-detail">
        <div v-if="loadingDocument" class="knowledge-detail__loading">
          <USkeleton class="h-9 w-2/3" />
          <USkeleton class="h-[70%] w-full" />
        </div>

        <div v-else-if="selectedDocument" class="knowledge-document">
          <header class="knowledge-document__header">
            <div>
              <span class="knowledge-document__eyebrow">
                <UIcon :name="kindIcon(selectedDocument.kind)" />
                {{ selectedKindLabel }}
              </span>
              <h2>{{ selectedDocument.title }}</h2>
              <div class="knowledge-document__meta">
                <span>Wersja {{ selectedDocument.revision }}</span>
                <span>{{ selectedDocument.chunkCount }} fragmentów</span>
                <span>Zmieniono {{ formatDate(selectedDocument.updatedAt) }}</span>
                <UBadge
                  :color="selectedDocument.indexingStatus === 'ready' ? 'success' : 'warning'"
                  variant="subtle"
                  size="sm"
                  :icon="selectedDocument.indexingStatus === 'ready' ? 'i-lucide-sparkles' : 'i-lucide-triangle-alert'"
                >
                  {{ selectedDocument.indexingStatus === 'ready' ? 'Wektory gotowe' : 'FTS bez wektorów' }}
                </UBadge>
              </div>
              <div v-if="selectedDocument.institutions.length" class="knowledge-institution-chips is-detail">
                <span
                  v-for="institution in selectedDocument.institutions"
                  :key="institution.id"
                  :style="institutionBrandStyle(institution)"
                  :class="{ 'has-brand': institution.brandColor }"
                >
                  <UIcon name="i-lucide-landmark" /> {{ institution.name }}
                </span>
              </div>
            </div>
            <div class="knowledge-document__actions">
              <UTooltip text="Kopiuj źródło">
                <UButton color="neutral" variant="ghost" icon="i-lucide-copy" aria-label="Kopiuj źródło" @click="copySelectedSource" />
              </UTooltip>
              <UTooltip text="Usuń z Wiedzy">
                <UButton color="error" variant="ghost" icon="i-lucide-trash-2" aria-label="Usuń z Wiedzy" @click="deleteModalOpen = true" />
              </UTooltip>
            </div>
          </header>

          <div v-if="selectedDocument.indexingError" class="knowledge-index-warning">
            <UIcon name="i-lucide-triangle-alert" />
            <div><strong>Embedding nie powstał</strong><span>Dokument nadal jest dostępny przez PostgreSQL full-text search.</span></div>
          </div>

          <div v-if="selectedDocument.kind === 'text'" class="knowledge-text-preview">
            <MDC
              :key="`${selectedDocument.id}:${selectedDocument.revision}`"
              :value="selectedMarkdown"
              :cache-key="`knowledge-markdown:${selectedDocument.id}:${selectedDocument.revision}`"
              :parser-options="knowledgeMarkdownParserOptions"
              tag="article"
              class="knowledge-markdown"
            />
          </div>

          <div v-else class="knowledge-dynamic-preview">
            <div v-if="previewStatus === 'loading'" class="knowledge-preview-status">
              <UIcon name="i-lucide-loader-circle" class="animate-spin" /> Uruchamiam bezpieczny podgląd…
            </div>
            <div v-if="previewStatus === 'error'" class="knowledge-preview-error">
              <UIcon name="i-lucide-triangle-alert" /> {{ previewError }}
            </div>
            <iframe
              ref="previewFrame"
              :srcdoc="previewSrcdoc"
              :sandbox="DYNAMIC_CONTENT_IFRAME_SANDBOX"
              title="Podgląd interaktywnej wiedzy"
            />
          </div>
        </div>

        <div v-else class="knowledge-detail__empty">
          <span><UIcon name="i-lucide-mouse-pointer-2" /></span>
          <strong>Wybierz dokument</strong>
          <p>Treść i stan indeksowania pojawią się tutaj.</p>
        </div>
      </main>
    </div>

    <UModal v-model:open="createModalOpen" title="Dodaj do Wiedzy" description="Wklej treść albo zaimportuj plik tekstowy lub HTML.">
      <template #body>
        <div class="knowledge-create-form">
          <div class="knowledge-create-kind">
            <button type="button" :aria-pressed="createKind === 'text'" @click="createKind = 'text'">
              <UIcon name="i-lucide-file-text" /><span><strong>Tekst</strong><small>TXT lub Markdown</small></span>
            </button>
            <button type="button" :aria-pressed="createKind === 'dynamic_html'" @click="createKind = 'dynamic_html'">
              <UIcon name="i-lucide-panels-top-left" /><span><strong>Interaktywne</strong><small>HTML, CSS i JS</small></span>
            </button>
          </div>

          <label class="knowledge-file-drop">
            <input type="file" accept=".txt,.md,.markdown,.html,.htm,text/plain,text/markdown,text/html" @change="handleFileUpload">
            <UIcon name="i-lucide-upload-cloud" />
            <span><strong>{{ uploadName || 'Zaimportuj plik' }}</strong><small>.txt, .md lub .html · maks. 1 MB</small></span>
          </label>

          <UFormField label="Tytuł" required>
            <UInput v-model="createTitle" class="w-full" maxlength="160" placeholder="Np. Checklist dokumentów klienta" />
          </UFormField>

          <fieldset v-if="availableInstitutions.length" class="knowledge-create-institutions">
            <legend>Instytucje finansowe <span>opcjonalnie</span></legend>
            <div>
              <button
                v-for="institution in availableInstitutions"
                :key="institution.id"
                type="button"
                :style="institutionBrandStyle(institution)"
                :class="{ 'has-brand': institution.brandColor }"
                :aria-pressed="createInstitutionIds.includes(institution.id)"
                @click="toggleCreateInstitution(institution.id)"
              >
                <UIcon name="i-lucide-landmark" />
                {{ institution.name }}
                <UIcon v-if="createInstitutionIds.includes(institution.id)" name="i-lucide-check" />
              </button>
            </div>
            <small>Dokument może dotyczyć jednego lub kilku banków.</small>
          </fieldset>

          <UFormField v-if="createKind === 'text'" label="Treść" required>
            <UTextarea v-model="createText" class="w-full" :rows="12" autoresize placeholder="Wklej tekst lub Markdown…" />
          </UFormField>

          <template v-else>
            <UFormField label="HTML" required>
              <UTextarea v-model="createHtml" class="w-full font-mono" :rows="9" autoresize placeholder="<main>…</main>" />
            </UFormField>
            <div class="knowledge-create-sources">
              <UFormField label="CSS">
                <UTextarea v-model="createCss" class="w-full font-mono" :rows="5" autoresize placeholder=".page { … }" />
              </UFormField>
              <UFormField label="JavaScript">
                <UTextarea v-model="createJavaScript" class="w-full font-mono" :rows="5" autoresize placeholder="document.querySelector(…)" />
              </UFormField>
            </div>
          </template>
        </div>
      </template>
      <template #footer="{ close }">
        <UButton color="neutral" variant="ghost" @click="close">Anuluj</UButton>
        <UButton :loading="saving" :disabled="!canCreate" color="primary" icon="i-lucide-sparkles" @click="createDocument">
          Zapisz i zwektoryzuj
        </UButton>
      </template>
    </UModal>

    <UModal v-model:open="deleteModalOpen" title="Usunąć z Wiedzy?" description="Dokument zniknie z biblioteki i wspólnej wyszukiwarki.">
      <template #footer="{ close }">
        <UButton color="neutral" variant="ghost" @click="close">Anuluj</UButton>
        <UButton :loading="deleting" color="error" icon="i-lucide-trash-2" @click="archiveSelectedDocument">Usuń dokument</UButton>
      </template>
    </UModal>
  </section>
</template>

<style scoped>
.knowledge-library {
  --knowledge-line: color-mix(in srgb, var(--ui-border) 82%, transparent);
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
  border-top: 1px solid var(--knowledge-line);
  background: var(--ui-bg);
}

.knowledge-toolbar { display: flex; align-items: center; gap: 12px; padding: 14px 18px; border-bottom: 1px solid var(--knowledge-line); }
.knowledge-search { display: flex; min-width: 240px; flex: 1; align-items: center; gap: 10px; border: 1px solid var(--knowledge-line); border-radius: 12px; background: var(--ui-bg-muted); padding: 0 13px; }
.knowledge-search > svg { flex: none; color: var(--ui-text-muted); }
.knowledge-search input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; padding: 11px 0; color: var(--ui-text); font-size: 14px; }
.knowledge-kind-filter { display: flex; gap: 3px; border: 1px solid var(--knowledge-line); border-radius: 11px; background: var(--ui-bg-muted); padding: 3px; }
.knowledge-kind-filter button { border: 0; border-radius: 8px; background: transparent; padding: 7px 10px; color: var(--ui-text-muted); font-size: 12px; font-weight: 650; }
.knowledge-kind-filter button[aria-pressed="true"] { background: var(--ui-bg); color: var(--ui-text); box-shadow: 0 1px 3px color-mix(in srgb, var(--ui-text) 10%, transparent); }
.knowledge-institution-filter { position: relative; display: flex; min-width: 164px; align-items: center; gap: 7px; border: 1px solid var(--knowledge-line); border-radius: 11px; background: var(--ui-bg-muted); padding: 0 10px; color: var(--ui-text-muted); }
.knowledge-institution-filter select { min-width: 0; flex: 1; appearance: none; border: 0; outline: 0; background: transparent; padding: 10px 20px 10px 0; color: var(--ui-text); font-size: 12px; font-weight: 650; }
.knowledge-institution-filter > svg:last-child { position: absolute; right: 9px; pointer-events: none; }

.knowledge-workspace { display: grid; min-height: 0; flex: 1; grid-template-columns: minmax(300px, 380px) minmax(0, 1fr); }
.knowledge-index { display: flex; min-height: 0; flex-direction: column; border-right: 1px solid var(--knowledge-line); background: color-mix(in srgb, var(--ui-bg-muted) 48%, var(--ui-bg)); }
.knowledge-index > header { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; padding: 17px 17px 11px; }
.knowledge-index > header div { display: flex; align-items: center; gap: 8px; }
.knowledge-index > header span { color: var(--ui-text-muted); font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
.knowledge-index > header strong { display: grid; min-width: 22px; height: 22px; place-items: center; border-radius: 999px; background: var(--ui-bg-accented); font-size: 11px; }
.knowledge-index > header small { color: var(--ui-text-dimmed); font-size: 11px; }
.knowledge-items { min-height: 0; overflow: auto; padding: 4px 9px 18px; }
.knowledge-item { display: flex; width: 100%; gap: 11px; border: 1px solid transparent; border-radius: 13px; background: transparent; padding: 12px; text-align: left; transition: background-color 140ms ease, border-color 140ms ease, transform 140ms ease; }
.knowledge-item:hover { background: var(--ui-bg); transform: translateY(-1px); }
.knowledge-item.is-active { border-color: var(--knowledge-line); background: var(--ui-bg); box-shadow: 0 8px 24px color-mix(in srgb, var(--ui-text) 6%, transparent); }
.knowledge-item__icon { display: grid; width: 34px; height: 34px; flex: none; place-items: center; border-radius: 10px; background: var(--ui-bg-accented); color: var(--ui-text-muted); }
.knowledge-item.is-active .knowledge-item__icon { background: var(--ui-primary); color: var(--ui-bg); }
.knowledge-item__body { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 5px; }
.knowledge-item__meta { display: flex; justify-content: space-between; gap: 8px; color: var(--ui-text-dimmed); font-size: 10px; font-weight: 650; letter-spacing: .04em; text-transform: uppercase; }
.knowledge-item__body > strong { overflow: hidden; color: var(--ui-text); font-size: 14px; line-height: 1.25; text-overflow: ellipsis; white-space: nowrap; }
.knowledge-item__snippet { display: -webkit-box; overflow: hidden; color: var(--ui-text-muted); font-size: 12px; line-height: 1.45; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.knowledge-institution-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.knowledge-institution-chips > span { display: inline-flex; max-width: 100%; align-items: center; gap: 4px; overflow: hidden; border-radius: 999px; background: var(--ui-bg-accented); padding: 3px 7px; color: var(--ui-text-muted); font-size: 9px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.knowledge-institution-chips > span.has-brand { background: var(--institution-brand); color: var(--institution-foreground); }
.knowledge-institution-chips.is-detail { margin-top: 11px; }
.knowledge-institution-chips.is-detail > span { border: 1px solid var(--knowledge-line); background: var(--ui-bg-muted); padding: 5px 9px; font-size: 10px; }
.knowledge-institution-chips.is-detail > span.has-brand { border-color: color-mix(in srgb, var(--institution-brand) 76%, black); background: var(--institution-brand); }
.knowledge-item__warning { display: inline-flex; align-items: center; gap: 4px; color: var(--ui-warning); font-size: 10px; font-weight: 650; }
.knowledge-index__loading { display: grid; gap: 8px; padding: 8px 12px; }

.knowledge-empty, .knowledge-detail__empty { display: grid; margin: auto; max-width: 300px; place-items: center; padding: 32px; text-align: center; }
.knowledge-empty > span, .knowledge-detail__empty > span { display: grid; width: 52px; height: 52px; place-items: center; border: 1px solid var(--knowledge-line); border-radius: 16px; background: var(--ui-bg); color: var(--ui-text-muted); font-size: 21px; }
.knowledge-empty strong, .knowledge-detail__empty strong { margin-top: 15px; font-size: 15px; }
.knowledge-empty p, .knowledge-detail__empty p { margin: 7px 0 18px; color: var(--ui-text-muted); font-size: 13px; line-height: 1.5; }

.knowledge-detail { min-width: 0; min-height: 0; overflow: auto; background: var(--ui-bg); }
.knowledge-detail__loading { display: grid; height: 100%; gap: 28px; padding: 30px; grid-template-rows: auto 1fr; }
.knowledge-document { display: flex; min-height: 100%; flex-direction: column; }
.knowledge-document__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; padding: 26px 30px 22px; border-bottom: 1px solid var(--knowledge-line); }
.knowledge-document__eyebrow { display: inline-flex; align-items: center; gap: 6px; color: var(--ui-text-muted); font-size: 11px; font-weight: 750; letter-spacing: .07em; text-transform: uppercase; }
.knowledge-document h2 { margin: 9px 0 11px; color: var(--ui-text); font-size: clamp(24px, 3vw, 38px); line-height: 1.05; letter-spacing: -.035em; }
.knowledge-document__meta { display: flex; flex-wrap: wrap; align-items: center; gap: 7px 14px; color: var(--ui-text-muted); font-size: 11px; }
.knowledge-document__actions { display: flex; flex: none; gap: 4px; }
.knowledge-index-warning { display: flex; align-items: center; gap: 11px; margin: 18px 30px 0; border: 1px solid color-mix(in srgb, var(--ui-warning) 30%, transparent); border-radius: 12px; background: color-mix(in srgb, var(--ui-warning) 8%, transparent); padding: 11px 13px; color: var(--ui-warning); }
.knowledge-index-warning div { display: flex; flex-direction: column; gap: 2px; }
.knowledge-index-warning strong { font-size: 12px; }
.knowledge-index-warning span { color: var(--ui-text-muted); font-size: 11px; }
.knowledge-text-preview { min-height: 0; flex: 1; padding: 34px clamp(24px, 6vw, 72px) 64px; }
:global(.knowledge-markdown) { max-width: 860px; margin: 0 auto; color: var(--ui-text); font-size: 15px; line-height: 1.75; overflow-wrap: anywhere; }
:global(.knowledge-markdown h1) { margin: 0 0 1.1em; font-size: clamp(26px, 3vw, 38px); line-height: 1.12; letter-spacing: -.035em; }
:global(.knowledge-markdown h2) { margin: 1.9em 0 .65em; font-size: clamp(20px, 2vw, 25px); line-height: 1.25; letter-spacing: -.02em; }
:global(.knowledge-markdown h3) { margin: 1.65em 0 .55em; font-size: 18px; line-height: 1.3; }
:global(.knowledge-markdown p) { margin: .8em 0; }
:global(.knowledge-markdown blockquote) { margin: 1.3em 0; border-left: 3px solid var(--ui-primary); border-radius: 0 12px 12px 0; background: color-mix(in srgb, var(--ui-primary) 7%, var(--ui-bg-muted)); padding: 12px 16px; color: var(--ui-text-muted); }
:global(.knowledge-markdown blockquote p) { margin: 0; }
:global(.knowledge-markdown ul), :global(.knowledge-markdown ol) { margin: 1em 0; padding-left: 1.45em; }
:global(.knowledge-markdown ul) { list-style: disc; }
:global(.knowledge-markdown ol) { list-style: decimal; }
:global(.knowledge-markdown li) { margin: .35em 0; padding-left: .2em; }
:global(.knowledge-markdown a) { color: var(--ui-primary); text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--ui-primary) 45%, transparent); text-underline-offset: 3px; }
:global(.knowledge-markdown code) { border-radius: 5px; background: var(--ui-bg-accented); padding: .15em .38em; font-size: .9em; }
:global(.knowledge-markdown pre) { overflow: auto; margin: 1.25em 0; border: 1px solid var(--ui-border); border-radius: 12px; background: var(--ui-bg-muted); padding: 15px; font-size: 13px; line-height: 1.6; }
:global(.knowledge-markdown pre code) { background: transparent; padding: 0; }
:global(.knowledge-markdown hr) { margin: 2em 0; border-color: var(--ui-border); }
:global(.knowledge-markdown table) { display: block; overflow-x: auto; width: 100%; margin: 1.25em 0; border-collapse: collapse; }
:global(.knowledge-markdown th), :global(.knowledge-markdown td) { border-bottom: 1px solid var(--ui-border); padding: 9px 12px; text-align: left; }
.knowledge-dynamic-preview { position: relative; min-height: 640px; flex: 1; background: #e9ebe7; padding: 18px; }
.knowledge-dynamic-preview iframe { display: block; width: 100%; min-height: 680px; border: 1px solid rgba(22, 24, 22, .12); border-radius: 14px; background: white; box-shadow: 0 18px 50px rgba(22, 24, 22, .12); }
.knowledge-preview-status, .knowledge-preview-error { position: absolute; z-index: 2; top: 28px; left: 50%; display: inline-flex; align-items: center; gap: 7px; transform: translateX(-50%); border-radius: 999px; background: rgba(24, 26, 24, .9); padding: 7px 11px; color: white; font-size: 11px; }
.knowledge-preview-error { background: var(--ui-error); }

.knowledge-create-form { display: grid; gap: 18px; }
.knowledge-create-kind { display: grid; gap: 8px; grid-template-columns: 1fr 1fr; }
.knowledge-create-kind button { display: flex; align-items: center; gap: 11px; border: 1px solid var(--knowledge-line); border-radius: 12px; background: var(--ui-bg); padding: 12px; text-align: left; }
.knowledge-create-kind button[aria-pressed="true"] { border-color: var(--ui-primary); background: color-mix(in srgb, var(--ui-primary) 8%, var(--ui-bg)); }
.knowledge-create-kind button > svg { font-size: 20px; }
.knowledge-create-kind button span { display: flex; flex-direction: column; }
.knowledge-create-kind small { color: var(--ui-text-muted); font-size: 11px; }
.knowledge-file-drop { display: flex; align-items: center; gap: 12px; border: 1px dashed var(--ui-border-accented); border-radius: 12px; background: var(--ui-bg-muted); padding: 13px; cursor: pointer; }
.knowledge-file-drop input { position: absolute; width: 1px; height: 1px; opacity: 0; }
.knowledge-file-drop > svg { font-size: 21px; }
.knowledge-file-drop span { display: flex; flex-direction: column; }
.knowledge-file-drop small { color: var(--ui-text-muted); font-size: 11px; }
.knowledge-create-sources { display: grid; gap: 12px; grid-template-columns: 1fr 1fr; }
.knowledge-create-institutions { display: grid; gap: 8px; border: 0; padding: 0; }
.knowledge-create-institutions legend { margin-bottom: 8px; color: var(--ui-text); font-size: 13px; font-weight: 600; }
.knowledge-create-institutions legend span, .knowledge-create-institutions > small { color: var(--ui-text-muted); font-size: 11px; font-weight: 400; }
.knowledge-create-institutions > div { display: flex; flex-wrap: wrap; gap: 6px; }
.knowledge-create-institutions button { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--knowledge-line); border-radius: 999px; background: var(--ui-bg); padding: 7px 10px; color: var(--ui-text-muted); font-size: 11px; font-weight: 650; }
.knowledge-create-institutions button[aria-pressed="true"] { border-color: color-mix(in srgb, var(--ui-primary) 46%, var(--ui-border)); background: color-mix(in srgb, var(--ui-primary) 9%, var(--ui-bg)); color: var(--ui-primary); }
.knowledge-create-institutions button.has-brand { border-color: color-mix(in srgb, var(--institution-brand) 38%, var(--ui-border)); }
.knowledge-create-institutions button.has-brand[aria-pressed="true"] { border-color: var(--institution-brand); background: var(--institution-brand); color: var(--institution-foreground); }

@media (max-width: 900px) {
  .knowledge-toolbar { flex-wrap: wrap; }
  .knowledge-search { order: -1; width: 100%; flex-basis: 100%; }
  .knowledge-institution-filter { flex: 1; }
  .knowledge-workspace { grid-template-columns: 1fr; }
  .knowledge-index { max-height: 42vh; border-right: 0; border-bottom: 1px solid var(--knowledge-line); }
  .knowledge-document__header { padding: 22px 18px 18px; }
  .knowledge-dynamic-preview { min-height: 500px; padding: 10px; }
  .knowledge-create-sources { grid-template-columns: 1fr; }
}
</style>
