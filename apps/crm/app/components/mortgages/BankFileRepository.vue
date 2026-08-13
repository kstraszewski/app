<script setup lang="ts">
import type {
  MortgageBankFileCategory,
  MortgageBankFileMimeGroup,
  MortgageBankFileRepositoryPayload,
  MortgageBankFileStatus,
  MortgageBankFileSummary,
} from '~/types/mortgage-bank-files'
import { apiErrorMessage } from '~/utils/api-error'

const props = withDefaults(defineProps<{
  organizationSlug: string
  bankId?: string | null
  bankName?: string | null
  lockInstitution?: boolean
  endpoint?: string | null
  uploadEndpoint?: string | null
  title?: string | null
  description?: string | null
  showHeading?: boolean
  autoSelectFirst?: boolean
  initialFileId?: string | null
  initialPage?: number | null
}>(), {
  bankId: null,
  bankName: null,
  lockInstitution: false,
  endpoint: null,
  uploadEndpoint: null,
  title: null,
  description: null,
  showHeading: true,
  autoSelectFirst: true,
  initialFileId: null,
  initialPage: null,
})

const emit = defineEmits<{
  uploaded: []
  selected: [file: MortgageBankFileSummary | null]
}>()

const toast = useToast()
const searchField = ref<HTMLElement | null>(null)
const searchInput = ref('')
const searchQuery = ref('')
const selectedInstitution = ref(props.bankId ?? 'all')
const selectedCategory = ref('all')
const selectedMimeGroup = ref<'all' | MortgageBankFileMimeGroup>('all')
const selectedProduct = ref('all')
const selectedStatus = ref<'all' | MortgageBankFileStatus>('current')
const selectedFileId = ref<string | null>(props.initialFileId)
const previewPage = ref(positivePage(props.initialPage) ?? 1)
const requestedPreviewPage = ref<number | null>(positivePage(props.initialPage))
const uploadExpanded = ref(false)
const uploadFiles = ref<File[]>([])
const uploading = ref(false)
const creatingTemplateForId = ref<string | null>(null)
let searchTimer: ReturnType<typeof setTimeout> | undefined

const repositoryEndpoint = computed(() => (
  props.endpoint
  ?? `/api/org/${encodeURIComponent(props.organizationSlug)}/mortgages/files`
))
const repositoryUploadEndpoint = computed(() => (
  props.uploadEndpoint
  ?? `${repositoryEndpoint.value}/upload`
))
const heading = computed(() => (
  props.title
  ?? (props.bankName ? `Pliki z ${props.bankName}` : 'Pliki z banków')
))
const headingDescription = computed(() => (
  props.description
  ?? (props.bankId
    ? 'Materiały źródłowe otrzymane od instytucji.'
    : 'Wspólne repozytorium procedur, formularzy i materiałów źródłowych instytucji.')
))
const effectiveBankId = computed(() => (
  props.lockInstitution
    ? props.bankId
    : (selectedInstitution.value === 'all' ? null : selectedInstitution.value)
))
const requestQuery = computed(() => ({
  bankId: effectiveBankId.value || undefined,
  q: searchQuery.value.trim() || undefined,
  category: selectedCategory.value === 'all' ? undefined : selectedCategory.value,
  mimeGroup: selectedMimeGroup.value === 'all' ? undefined : selectedMimeGroup.value,
  productId: selectedProduct.value === 'all' ? undefined : selectedProduct.value,
  status: selectedStatus.value === 'all' ? undefined : selectedStatus.value,
}))

const {
  data,
  status,
  error,
  refresh,
} = await useFetch<MortgageBankFileRepositoryPayload>(repositoryEndpoint, {
  query: requestQuery,
  key: computed(() => `bank-file-repository:${props.organizationSlug}:${props.bankId ?? 'global'}`),
  default: () => ({
    files: [],
    total: 0,
    categories: [],
    institutions: [],
    products: [],
    permissions: {
      canUpload: false,
      canManageCategories: false,
      canCreateTemplates: false,
    },
  }),
})

const isLoading = computed(() => status.value === 'pending' || status.value === 'idle')
const categoryItems = computed<MortgageBankFileCategory[]>(() => {
  const source = data.value.categories.filter(item => !item.archived)
  const archive = data.value.categories.filter(item => item.archived)
  return [
    {
      id: 'all',
      label: 'Wszystkie pliki',
      count: data.value.total,
      icon: 'i-lucide-files',
    },
    ...source,
    ...archive,
  ]
})
const institutionItems = computed(() => [
  { label: 'Wszystkie instytucje', value: 'all' },
  ...data.value.institutions.map(item => ({ label: item.name, value: item.id })),
])
const productItems = computed(() => [
  { label: 'Wszystkie produkty', value: 'all' },
  ...data.value.products.map(item => ({ label: item.name, value: item.id })),
])
const mimeItems: Array<{ label: string, value: 'all' | MortgageBankFileMimeGroup }> = [
  { label: 'Wszystkie typy', value: 'all' },
  { label: 'PDF', value: 'pdf' },
  { label: 'Arkusze', value: 'spreadsheet' },
  { label: 'Dokumenty', value: 'document' },
  { label: 'Obrazy', value: 'image' },
  { label: 'Pozostałe', value: 'other' },
]
const statusItems: Array<{ label: string, value: 'all' | MortgageBankFileStatus }> = [
  { label: 'Wszystkie statusy', value: 'all' },
  { label: 'Aktualne', value: 'current' },
  { label: 'Wersje robocze', value: 'draft' },
  { label: 'W przetwarzaniu', value: 'processing' },
  { label: 'Wygasłe', value: 'expired' },
  { label: 'Archiwalne', value: 'archived' },
]

const visibleFiles = computed(() => {
  return data.value.files.filter((file) => {
    if (effectiveBankId.value && file.institution.id !== effectiveBankId.value) return false
    if (selectedCategory.value !== 'all' && file.categoryId !== selectedCategory.value) return false
    if (selectedMimeGroup.value !== 'all' && file.currentVersion.mimeGroup !== selectedMimeGroup.value) return false
    if (selectedProduct.value !== 'all' && !file.products.some(item => item.id === selectedProduct.value)) return false
    if (selectedStatus.value !== 'all' && file.currentVersion.status !== selectedStatus.value) return false
    return true
  })
})
const selectedFile = computed(() => (
  visibleFiles.value.find(file => file.id === selectedFileId.value)
  ?? data.value.files.find(file => file.id === selectedFileId.value)
  ?? null
))
const resultLabel = computed(() => {
  const count = visibleFiles.value.length
  if (count === 1) return '1 plik'
  if (count >= 2 && count <= 4) return `${count} pliki`
  return `${count} plików`
})
const hasActiveFilters = computed(() => (
  Boolean(searchInput.value.trim())
  || (!props.lockInstitution && selectedInstitution.value !== 'all')
  || selectedCategory.value !== 'all'
  || selectedMimeGroup.value !== 'all'
  || selectedProduct.value !== 'all'
  || selectedStatus.value !== 'current'
))
const currentMatch = computed(() => selectedFile.value?.matches[0] ?? null)
const previewUrl = computed(() => {
  const url = selectedFile.value?.currentVersion.previewUrl
    ?? selectedFile.value?.currentVersion.sourceUrl
    ?? null
  if (!url || selectedFile.value?.currentVersion.mimeGroup !== 'pdf') return url

  if (url.startsWith('/api/')) {
    const separator = url.includes('?') ? '&' : '?'
    return `${url}${separator}page=${previewPage.value}`
  }
  const separator = url.includes('#') ? '&' : '#'
  return `${url}${separator}page=${previewPage.value}&toolbar=0&navpanes=0`
})
const canMovePreviewBack = computed(() => previewPage.value > 1)
const canMovePreviewForward = computed(() => (
  previewPage.value < (selectedFile.value?.currentVersion.pageCount ?? previewPage.value)
))

watch(searchInput, (value) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    searchQuery.value = value
  }, 280)
})

watch(() => props.bankId, (value) => {
  selectedInstitution.value = value ?? 'all'
})

watch(
  [() => props.initialFileId, () => props.initialPage],
  ([fileId, page]) => {
    const requestedPage = positivePage(page)
    if (!fileId) {
      if (requestedPage) previewPage.value = requestedPage
      return
    }

    requestedPreviewPage.value = requestedPage
    if (selectedFileId.value === fileId) {
      previewPage.value = requestedPage ?? currentMatch.value?.page ?? 1
      requestedPreviewPage.value = null
      return
    }
    selectedFileId.value = fileId
  },
)

watch(visibleFiles, (files) => {
  if (selectedFileId.value && isLoading.value) return
  if (selectedFileId.value && files.some(file => file.id === selectedFileId.value)) return
  selectedFileId.value = props.autoSelectFirst ? (files[0]?.id ?? null) : null
}, { immediate: true })

watch(selectedFileId, () => {
  previewPage.value = requestedPreviewPage.value ?? currentMatch.value?.page ?? 1
  requestedPreviewPage.value = null
  emit('selected', selectedFile.value)
})

onMounted(() => {
  window.addEventListener('keydown', handleSearchShortcut)
})

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
  window.removeEventListener('keydown', handleSearchShortcut)
})

function handleSearchShortcut(event: KeyboardEvent) {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLocaleLowerCase('pl-PL') !== 'k') return
  event.preventDefault()
  searchField.value?.querySelector('input')?.focus()
}

function selectFile(file: MortgageBankFileSummary) {
  selectedFileId.value = file.id
}

function selectCategory(id: string) {
  selectedCategory.value = id
}

function clearSearch() {
  searchInput.value = ''
  searchQuery.value = ''
  searchField.value?.querySelector('input')?.focus()
}

function clearFilters() {
  searchInput.value = ''
  searchQuery.value = ''
  if (!props.lockInstitution) selectedInstitution.value = 'all'
  selectedCategory.value = 'all'
  selectedMimeGroup.value = 'all'
  selectedProduct.value = 'all'
  selectedStatus.value = 'current'
}

function statusLabel(value: MortgageBankFileStatus) {
  return {
    current: 'Aktualny',
    draft: 'Roboczy',
    expired: 'Wygasły',
    archived: 'Archiwalny',
    processing: 'Przetwarzanie',
    failed: 'Błąd',
  }[value]
}

function statusColor(value: MortgageBankFileStatus) {
  if (value === 'current') return 'success'
  if (value === 'failed' || value === 'expired') return 'error'
  if (value === 'processing' || value === 'draft') return 'warning'
  return 'neutral'
}

function fileIcon(file: MortgageBankFileSummary) {
  const icons: Record<MortgageBankFileMimeGroup, string> = {
    pdf: 'i-lucide-file-text',
    spreadsheet: 'i-lucide-sheet',
    document: 'i-lucide-file-type-2',
    image: 'i-lucide-image',
    other: 'i-lucide-file',
  }
  return icons[file.currentVersion.mimeGroup]
}

function categoryIcon(category: MortgageBankFileCategory) {
  if (category.icon) return category.icon
  const id = category.id.toLocaleLowerCase('pl-PL')
  if (id.includes('form')) return 'i-lucide-file-input'
  if (id.includes('table') || id.includes('param')) return 'i-lucide-table-properties'
  if (id.includes('list')) return 'i-lucide-list-checks'
  if (id.includes('power') || id.includes('wzor')) return 'i-lucide-stamp'
  if (id.includes('product') || id.includes('material')) return 'i-lucide-package-open'
  if (id.includes('archiv')) return 'i-lucide-archive'
  return 'i-lucide-folder'
}

function fileIconClass(file: MortgageBankFileSummary) {
  return `bank-files__file-icon--${file.currentVersion.mimeGroup}`
}

function formatBytes(value: number | null) {
  if (value == null) return '—'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toLocaleString('pl-PL', { maximumFractionDigits: 2 })} MB`
}

function formatDate(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

function positivePage(value: unknown) {
  const page = Number(value)
  return Number.isSafeInteger(page) && page > 0 ? page : null
}

function filePrimaryProduct(file: MortgageBankFileSummary) {
  if (!file.products.length) return 'Wszystkie produkty'
  if (file.products.length === 1) return file.products[0]?.name ?? '—'
  return `${file.products[0]?.name ?? 'Produkt'} +${file.products.length - 1}`
}

function templateEditorPath(file: MortgageBankFileSummary) {
  if (!file.template) return undefined
  return `/org/${encodeURIComponent(props.organizationSlug)}/settings/institutions/${encodeURIComponent(file.institution.id)}/pdf-templates/${encodeURIComponent(file.template.key)}`
}

function templateStatusLabel(file: MortgageBankFileSummary) {
  if (!file.template) return 'Brak'
  if (!file.template.usesCurrentVersion) return 'Wymaga nowej wersji'
  if (file.template.status === 'published_with_draft') return 'Opublikowany + szkic'
  if (file.template.status === 'published') return 'Opublikowany'
  return 'Szkic'
}

function templateStatusColor(file: MortgageBankFileSummary): 'success' | 'warning' | 'neutral' {
  if (!file.template || !file.template.usesCurrentVersion) return 'neutral'
  return file.template.status === 'published' ? 'success' : 'warning'
}

async function createTemplate(file: MortgageBankFileSummary) {
  if (creatingTemplateForId.value) return
  creatingTemplateForId.value = file.id
  try {
    const response = await $fetch<{ data: { templateKey: string, created: boolean } }>(
      `${repositoryEndpoint.value}/${encodeURIComponent(file.id)}/template`,
      { method: 'POST' },
    )
    await refresh()
    toast.add({
      title: response.data.created ? 'Utworzono szkic Multiwniosku' : 'Szablon już istnieje',
      description: response.data.created
        ? 'PDF jest teraz trwale powiązany z wersją pliku bankowego.'
        : 'Otwieram istniejące mapowanie tego PDF-u.',
      color: 'success',
      icon: 'i-lucide-file-check-2',
    })
    await navigateTo(
      `/org/${encodeURIComponent(props.organizationSlug)}/settings/institutions/${encodeURIComponent(file.institution.id)}/pdf-templates/${encodeURIComponent(response.data.templateKey)}`,
    )
  } catch (templateError) {
    toast.add({
      title: 'Nie udało się utworzyć szablonu',
      description: apiErrorMessage(templateError),
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  } finally {
    creatingTemplateForId.value = null
  }
}

function matchSegments(text: string) {
  const terms = searchQuery.value
    .trim()
    .split(/\s+/u)
    .filter(term => term.length >= 2)
    .sort((first, second) => second.length - first.length)

  if (!terms.length) return [{ text, highlighted: false }]

  const expression = new RegExp(
    `(${terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|')})`,
    'giu',
  )

  return text.split(expression).filter(Boolean).map(part => ({
    text: part,
    highlighted: terms.some(term => part.toLocaleLowerCase('pl-PL') === term.toLocaleLowerCase('pl-PL')),
  }))
}

function movePreview(direction: -1 | 1) {
  const nextPage = previewPage.value + direction
  const maxPage = selectedFile.value?.currentVersion.pageCount ?? nextPage
  previewPage.value = Math.max(1, Math.min(maxPage, nextPage))
}

async function submitUpload() {
  if (!uploadFiles.value.length || uploading.value) return
  if (!effectiveBankId.value) {
    toast.add({
      title: 'Wybierz instytucję',
      description: 'Każdy plik musi mieć wskazany bank źródłowy.',
      color: 'warning',
      icon: 'i-lucide-building-2',
    })
    return
  }
  uploading.value = true

  try {
    const body = new FormData()
    for (const file of uploadFiles.value) body.append('files', file)
    if (effectiveBankId.value) body.append('bankId', effectiveBankId.value)
    if (selectedCategory.value !== 'all') body.append('categoryId', selectedCategory.value)

    await $fetch(repositoryUploadEndpoint.value, {
      method: 'POST',
      body,
    })
    uploadFiles.value = []
    uploadExpanded.value = false
    await refresh()
    toast.add({
      title: 'Pliki zostały dodane',
      description: 'Rozpoczęliśmy ich analizę i indeksowanie.',
      color: 'success',
      icon: 'i-lucide-check',
    })
    emit('uploaded')
  } catch (uploadError) {
    toast.add({
      title: 'Nie udało się dodać plików',
      description: uploadError instanceof Error ? uploadError.message : 'Spróbuj ponownie.',
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  } finally {
    uploading.value = false
  }
}
</script>

<template>
  <section
    class="bank-files"
    :class="{ 'bank-files--preview': selectedFile }"
    :aria-labelledby="showHeading ? 'bank-file-repository-title' : undefined"
    :aria-label="showHeading ? undefined : heading"
  >
    <header v-if="showHeading" class="bank-files__heading">
      <div>
        <span class="bank-files__eyebrow">Pliki banku</span>
        <h2 id="bank-file-repository-title">{{ heading }}</h2>
        <p>{{ headingDescription }}</p>
      </div>
      <UButton
        v-if="data.permissions.canUpload"
        icon="i-lucide-plus"
        size="lg"
        :aria-expanded="uploadExpanded"
        @click="uploadExpanded = !uploadExpanded"
      >
        Dodaj pliki
      </UButton>
    </header>

    <section v-if="uploadExpanded" class="bank-files__upload" aria-labelledby="bank-file-upload-title">
      <div class="bank-files__upload-heading">
        <div>
          <span>Nowe materiały</span>
          <h3 id="bank-file-upload-title">Dodaj pliki do repozytorium</h3>
          <p>PDF, DOCX, XLSX, JPG lub PNG. Po przesłaniu pliki zostaną opisane i zindeksowane.</p>
        </div>
        <UButton
          color="neutral"
          variant="ghost"
          square
          icon="i-lucide-x"
          aria-label="Zamknij dodawanie plików"
          @click="uploadExpanded = false"
        />
      </div>
      <UFormField
        v-if="!lockInstitution"
        label="Instytucja źródłowa"
        description="Pliki zostaną przypisane do wybranego banku."
        required
      >
        <USelect
          v-model="selectedInstitution"
          class="w-full max-w-md"
          :items="institutionItems"
          aria-label="Instytucja źródłowa przesyłanych plików"
        />
      </UFormField>
      <UFileUpload
        v-model="uploadFiles"
        multiple
        reset
        layout="list"
        position="outside"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/png,image/jpeg"
        icon="i-lucide-cloud-upload"
        label="Wybierz lub przeciągnij pliki"
        description="Maksymalny rozmiar pojedynczego pliku zależy od ustawień organizacji."
        :disabled="uploading"
        :ui="{ base: 'min-h-28', files: 'mt-3' }"
      />
      <div class="bank-files__upload-actions">
        <span>{{ uploadFiles.length ? `${uploadFiles.length} wybranych plików` : 'Nie wybrano plików' }}</span>
        <UButton
          icon="i-lucide-upload"
          :disabled="!uploadFiles.length || !effectiveBankId"
          :loading="uploading"
          @click="submitUpload"
        >
          Prześlij
        </UButton>
      </div>
    </section>

    <div class="bank-files__toolbar">
      <div class="bank-files__search-row">
        <div ref="searchField" class="bank-files__search" role="search">
          <UInput
            v-model="searchInput"
            class="w-full"
            size="lg"
            leading-icon="i-lucide-search"
            placeholder="Szukaj w nazwach i treści dokumentów"
            aria-label="Szukaj w repozytorium plików bankowych"
          >
            <template #trailing>
              <div class="bank-files__search-trailing">
                <UButton
                  v-if="searchInput"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  square
                  icon="i-lucide-x"
                  aria-label="Wyczyść wyszukiwanie"
                  @click="clearSearch"
                />
                <UKbd value="meta" />
                <UKbd value="K" />
              </div>
            </template>
          </UInput>
        </div>
        <span class="bank-files__result-count" aria-live="polite">{{ resultLabel }}</span>
      </div>

      <div class="bank-files__filters" aria-label="Filtry repozytorium">
        <USelect
          v-if="!lockInstitution"
          v-model="selectedInstitution"
          :items="institutionItems"
          aria-label="Filtr instytucji"
        />
        <USelect
          v-model="selectedMimeGroup"
          :items="mimeItems"
          aria-label="Filtr typu pliku"
        />
        <USelect
          v-model="selectedProduct"
          :items="productItems"
          aria-label="Filtr produktu"
        />
        <USelect
          v-model="selectedStatus"
          :items="statusItems"
          aria-label="Filtr statusu pliku"
        />
        <UButton
          v-if="hasActiveFilters"
          color="neutral"
          variant="ghost"
          icon="i-lucide-filter-x"
          @click="clearFilters"
        >
          Wyczyść
        </UButton>
      </div>
    </div>

    <UAlert
      v-if="error"
      class="bank-files__state"
      color="error"
      variant="subtle"
      icon="i-lucide-database"
      title="Nie udało się pobrać plików"
      description="Sprawdź połączenie i spróbuj ponownie."
    >
      <template #actions>
        <UButton icon="i-lucide-refresh-cw" variant="ghost" @click="refresh()">Ponów</UButton>
      </template>
    </UAlert>

    <div v-else class="bank-files__workspace" :class="{ 'bank-files__workspace--preview': selectedFile }">
      <div class="bank-files__browser">
        <aside class="bank-files__categories" aria-label="Kategorie plików">
          <div class="bank-files__category-heading">
            <span class="bank-files__category-label">Kategorie</span>
            <UButton
              v-if="data.permissions.canManageCategories"
              class="bank-files__new-category"
              color="neutral"
              variant="ghost"
              icon="i-lucide-plus"
              size="xs"
              aria-label="Nowa kategoria"
              title="Nowa kategoria"
            >
              Nowa
            </UButton>
          </div>
          <nav>
            <button
              v-for="category in categoryItems"
              :key="category.id"
              type="button"
              :class="{
                'is-active': selectedCategory === category.id,
                'is-archived': category.archived,
              }"
              :aria-current="selectedCategory === category.id ? 'page' : undefined"
              @click="selectCategory(category.id)"
            >
              <UIcon :name="categoryIcon(category)" />
              <span>{{ category.label }}</span>
              <small>{{ category.count }}</small>
            </button>
          </nav>
        </aside>

        <div class="bank-files__table-wrap">
          <div v-if="isLoading" class="bank-files__loading" aria-label="Ładowanie plików">
            <div v-for="index in 5" :key="index">
              <USkeleton class="size-9 rounded-lg" />
              <div>
                <USkeleton class="h-4 w-2/3" />
                <USkeleton class="mt-2 h-3 w-4/5" />
              </div>
              <USkeleton class="h-5 w-16" />
            </div>
          </div>

          <div v-else-if="!visibleFiles.length" class="bank-files__empty">
            <span><UIcon name="i-lucide-file-search-2" /></span>
            <h3>{{ hasActiveFilters ? 'Brak pasujących plików' : 'Repozytorium jest puste' }}</h3>
            <p>
              {{ hasActiveFilters
                ? 'Zmień zapytanie lub wyczyść filtry.'
                : 'Dodaj pierwszy dokument bankowy, aby rozpocząć budowę bazy wiedzy.' }}
            </p>
            <UButton
              v-if="hasActiveFilters"
              color="neutral"
              variant="outline"
              icon="i-lucide-filter-x"
              @click="clearFilters"
            >
              Wyczyść filtry
            </UButton>
            <UButton
              v-else-if="data.permissions.canUpload"
              icon="i-lucide-plus"
              @click="uploadExpanded = true"
            >
              Dodaj pliki
            </UButton>
          </div>

          <table v-else>
            <thead>
              <tr>
                <th scope="col">Plik</th>
                <th scope="col">Dopasowanie</th>
                <th scope="col">Lokalizacja</th>
                <th scope="col">Produkt</th>
                <th scope="col">Wersja</th>
                <th scope="col">Data</th>
                <th scope="col">Status</th>
                <th scope="col">Multiwniosek</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="file in visibleFiles"
                :key="file.id"
                :class="{ 'is-selected': selectedFileId === file.id }"
                @click="selectFile(file)"
              >
                <td>
                  <button type="button" class="bank-files__file" @click.stop="selectFile(file)">
                    <span class="bank-files__file-icon" :class="fileIconClass(file)">
                      <UIcon :name="fileIcon(file)" />
                    </span>
                    <span>
                      <strong>{{ file.title }}</strong>
                      <small>
                        <template v-if="!lockInstitution">{{ file.institution.name }} · </template>
                        {{ formatBytes(file.currentVersion.sizeBytes) }}
                      </small>
                    </span>
                  </button>
                </td>
                <td>
                  <p v-if="file.matches[0]" class="bank-files__snippet">
                    <template v-for="(segment, index) in matchSegments(file.matches[0].snippet)" :key="index">
                      <mark v-if="segment.highlighted">{{ segment.text }}</mark>
                      <template v-else>{{ segment.text }}</template>
                    </template>
                  </p>
                  <span v-else class="bank-files__muted">—</span>
                </td>
                <td><span>{{ file.matches[0]?.location ?? '—' }}</span></td>
                <td><span>{{ filePrimaryProduct(file) }}</span></td>
                <td><span>{{ file.currentVersion.version }}</span></td>
                <td><span>{{ formatDate(file.currentVersion.effectiveFrom ?? file.currentVersion.publishedAt) }}</span></td>
                <td>
                  <UBadge
                    class="bank-files__status-badge"
                    :color="statusColor(file.currentVersion.status)"
                    variant="subtle"
                    :label="statusLabel(file.currentVersion.status)"
                    :title="statusLabel(file.currentVersion.status)"
                  />
                </td>
                <td>
                  <UBadge
                    class="bank-files__status-badge"
                    :color="templateStatusColor(file)"
                    variant="subtle"
                    :label="templateStatusLabel(file)"
                    :title="templateStatusLabel(file)"
                  />
                </td>
              </tr>
            </tbody>
          </table>

          <footer v-if="visibleFiles.length" class="bank-files__table-footer">
            <span>1–{{ visibleFiles.length }} z {{ data.total }}</span>
          </footer>
        </div>
      </div>

      <aside
        v-if="selectedFile"
        class="bank-files__preview"
        :aria-labelledby="`bank-file-preview-${selectedFile.id}`"
      >
        <header>
          <div class="bank-files__preview-title">
            <span class="bank-files__file-icon" :class="fileIconClass(selectedFile)">
              <UIcon :name="fileIcon(selectedFile)" />
            </span>
            <div>
              <h3 :id="`bank-file-preview-${selectedFile.id}`">{{ selectedFile.title }}</h3>
              <UBadge
                :color="statusColor(selectedFile.currentVersion.status)"
                variant="subtle"
              >
                {{ statusLabel(selectedFile.currentVersion.status) }}
              </UBadge>
            </div>
          </div>
          <UButton
            color="neutral"
            variant="ghost"
            square
            icon="i-lucide-x"
            aria-label="Zamknij podgląd"
            @click="selectedFileId = null"
          />
        </header>

        <div class="bank-files__preview-actions">
          <UButton
            v-if="selectedFile.currentVersion.mimeGroup === 'pdf' && selectedFile.template?.usesCurrentVersion"
            :to="templateEditorPath(selectedFile)"
            icon="i-lucide-panels-top-left"
          >
            Otwórz szablon
          </UButton>
          <UButton
            v-else-if="selectedFile.currentVersion.mimeGroup === 'pdf' && data.permissions.canCreateTemplates"
            icon="i-lucide-file-plus-2"
            :loading="creatingTemplateForId === selectedFile.id"
            @click="createTemplate(selectedFile)"
          >
            {{ selectedFile.template ? 'Utwórz z nowej wersji' : 'Utwórz szablon Multiwniosku' }}
          </UButton>
          <UButton
            v-if="selectedFile.currentVersion.downloadUrl"
            :to="selectedFile.currentVersion.downloadUrl"
            external
            target="_blank"
            icon="i-lucide-download"
            color="neutral"
            variant="outline"
          >
            Pobierz
          </UButton>
          <UButton
            icon="i-lucide-ellipsis"
            color="neutral"
            variant="outline"
            square
            aria-label="Więcej działań dla pliku"
          />
        </div>

        <div class="bank-files__preview-surface">
          <iframe
            v-if="previewUrl && selectedFile.currentVersion.mimeGroup === 'pdf'"
            :key="previewUrl"
            :src="previewUrl"
            :title="`Podgląd ${selectedFile.title}`"
          />
          <img
            v-else-if="previewUrl && selectedFile.currentVersion.mimeGroup === 'image'"
            :src="previewUrl"
            :alt="`Podgląd ${selectedFile.title}`"
          >
          <article v-else-if="selectedFile.currentVersion.extractedText">
            <template
              v-for="(segment, index) in matchSegments(selectedFile.currentVersion.extractedText)"
              :key="index"
            >
              <mark v-if="segment.highlighted">{{ segment.text }}</mark>
              <template v-else>{{ segment.text }}</template>
            </template>
          </article>
          <div v-else class="bank-files__preview-empty">
            <UIcon name="i-lucide-scan-text" />
            <strong>Podgląd nie jest jeszcze gotowy</strong>
            <p>Plik można pobrać lub otworzyć w źródle.</p>
          </div>
        </div>

        <div class="bank-files__preview-toolbar">
          <div>
            <UButton
              icon="i-lucide-chevron-left"
              color="neutral"
              variant="outline"
              square
              :disabled="!canMovePreviewBack"
              aria-label="Poprzednia strona"
              @click="movePreview(-1)"
            />
            <span>
              {{ previewPage }}
              <template v-if="selectedFile.currentVersion.pageCount"> / {{ selectedFile.currentVersion.pageCount }}</template>
            </span>
            <UButton
              icon="i-lucide-chevron-right"
              color="neutral"
              variant="outline"
              square
              :disabled="!canMovePreviewForward"
              aria-label="Następna strona"
              @click="movePreview(1)"
            />
          </div>
          <UButton
            v-if="selectedFile.currentVersion.previewUrl || selectedFile.currentVersion.sourceUrl"
            :to="selectedFile.currentVersion.previewUrl ?? selectedFile.currentVersion.sourceUrl ?? undefined"
            external
            target="_blank"
            trailing-icon="i-lucide-external-link"
            color="neutral"
            variant="outline"
          >
            Otwórz pełny podgląd
          </UButton>
        </div>

        <dl class="bank-files__metadata">
          <div>
            <dt>Instytucja</dt>
            <dd>{{ selectedFile.institution.name }}</dd>
          </div>
          <div>
            <dt>Produkt</dt>
            <dd>{{ filePrimaryProduct(selectedFile) }}</dd>
          </div>
          <div>
            <dt>Wersja</dt>
            <dd>{{ selectedFile.currentVersion.version }}</dd>
          </div>
          <div>
            <dt>Multiwniosek</dt>
            <dd>
              <NuxtLink
                v-if="selectedFile.template?.usesCurrentVersion"
                :to="templateEditorPath(selectedFile)"
              >
                {{ templateStatusLabel(selectedFile) }}
              </NuxtLink>
              <template v-else>{{ templateStatusLabel(selectedFile) }}</template>
            </dd>
          </div>
          <div>
            <dt>Obowiązuje od</dt>
            <dd>{{ formatDate(selectedFile.currentVersion.effectiveFrom) }}</dd>
          </div>
          <div>
            <dt>Źródło</dt>
            <dd>
              <a
                v-if="selectedFile.currentVersion.sourceUrl"
                :href="selectedFile.currentVersion.sourceUrl"
                target="_blank"
                rel="noopener noreferrer"
              >
                Oficjalna strona instytucji
              </a>
              <template v-else>Plik przesłany ręcznie</template>
            </dd>
          </div>
          <div>
            <dt>Dodano przez</dt>
            <dd>{{ selectedFile.addedBy ?? 'Import systemowy' }}</dd>
          </div>
        </dl>

        <UButton
          v-if="selectedFile.currentVersion.version !== '1.0'"
          color="neutral"
          variant="link"
          trailing-icon="i-lucide-chevron-right"
          class="bank-files__versions-link"
        >
          Poprzednie wersje
        </UButton>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.bank-files {
  --bank-files-panel: color-mix(in srgb, var(--ui-bg) 94%, var(--ui-bg-muted));
  min-width: 0;
}

.bank-files--preview {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(420px, 40%);
}

.bank-files--preview > .bank-files__heading,
.bank-files--preview > .bank-files__upload,
.bank-files--preview > .bank-files__toolbar,
.bank-files--preview > .bank-files__state {
  grid-column: 1;
  margin-right: 16px;
}

.bank-files--preview > .bank-files__heading {
  padding-top: 24px;
}

.bank-files__heading,
.bank-files__upload-heading,
.bank-files__upload-actions,
.bank-files__search-row,
.bank-files__filters,
.bank-files__preview > header,
.bank-files__preview-actions,
.bank-files__preview-toolbar {
  display: flex;
  align-items: center;
}

.bank-files__heading {
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 14px;
}

.bank-files__heading h2,
.bank-files__heading p,
.bank-files__upload-heading h3,
.bank-files__upload-heading p,
.bank-files__preview h3,
.bank-files__empty h3,
.bank-files__empty p {
  margin: 0;
}

.bank-files__heading h2 {
  color: var(--ui-text-highlighted);
  font-size: clamp(1.3rem, 1.7vw, 1.65rem);
  line-height: 1.15;
}

.bank-files__heading p {
  margin-top: 4px;
  color: var(--ui-text-muted);
  font-size: 14px;
}

.bank-files__eyebrow,
.bank-files__category-label,
.bank-files__upload-heading span {
  display: block;
  margin-bottom: 7px;
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .1em;
  text-transform: uppercase;
}

.bank-files__upload {
  display: grid;
  gap: 16px;
  margin-bottom: 18px;
  padding: 18px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background: var(--ui-bg-muted);
}

.bank-files__upload-heading,
.bank-files__upload-actions {
  justify-content: space-between;
  gap: 16px;
}

.bank-files__upload-heading h3 {
  color: var(--ui-text-highlighted);
  font-size: 17px;
  font-weight: 600;
}

.bank-files__upload-heading p,
.bank-files__upload-actions span {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.bank-files__toolbar {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) auto;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
}

.bank-files__search-row {
  gap: 14px;
  min-width: 0;
}

.bank-files__search {
  min-width: 240px;
  flex: 1;
}

.bank-files__search-trailing {
  display: flex;
  align-items: center;
  gap: 4px;
}

.bank-files__result-count {
  flex: none;
  color: var(--ui-text-muted);
  font-size: 12px;
  white-space: nowrap;
}

.bank-files__filters {
  flex-wrap: nowrap;
  gap: 8px;
  min-width: 0;
}

.bank-files__filters :deep([data-slot="base"]) {
  min-width: 124px;
}

.bank-files__state {
  margin-top: 16px;
}

.bank-files__workspace {
  display: grid;
  min-height: 560px;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background: var(--bank-files-panel);
}

.bank-files__workspace--preview {
  display: contents;
}

.bank-files__workspace--preview .bank-files__browser {
  grid-column: 1;
  min-height: 560px;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background: var(--bank-files-panel);
}

.bank-files__workspace--preview .bank-files__preview {
  grid-column: 2;
  grid-row: 1 / span 10;
}

.bank-files__browser {
  display: grid;
  min-width: 0;
  grid-template-columns: 180px minmax(0, 1fr);
}

.bank-files__categories {
  display: flex;
  min-width: 0;
  flex-direction: column;
  padding: 12px 10px;
  border-right: 1px solid var(--ui-border);
  background: var(--ui-bg-muted);
}

.bank-files__category-heading {
  display: flex;
  min-height: 30px;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 6px;
  padding: 0 4px 0 8px;
}

.bank-files__category-label {
  margin-bottom: 0;
  padding: 0;
}

.bank-files__categories nav {
  display: grid;
  min-height: 0;
  gap: 3px;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-right: 2px;
  scrollbar-width: thin;
}

.bank-files__categories nav button {
  display: grid;
  width: 100%;
  min-height: 38px;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  padding: 8px 9px;
  border: 0;
  border-radius: calc(var(--oe-radius-control) - 2px);
  background: transparent;
  color: var(--ui-text);
  cursor: pointer;
  font-size: 12px;
  text-align: left;
  transition:
    color var(--oe-motion-fast),
    background-color var(--oe-motion-fast);
}

.bank-files__categories nav button:hover {
  background: var(--ui-bg-elevated);
  color: var(--ui-text-highlighted);
}

.bank-files__categories nav button.is-active {
  background: var(--ui-bg-elevated);
  color: var(--ui-text-highlighted);
  font-weight: 600;
}

.bank-files__categories nav button.is-archived {
  margin-top: 10px;
  padding-top: 14px;
  border-top: 1px solid var(--ui-border);
  border-radius: 0 0 calc(var(--oe-radius-control) - 2px) calc(var(--oe-radius-control) - 2px);
}

.bank-files__categories nav button small {
  display: grid;
  min-width: 22px;
  height: 22px;
  place-items: center;
  border-radius: 6px;
  background: var(--ui-bg-accented);
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 9px;
}

.bank-files__new-category {
  flex: none;
  min-height: 28px;
  padding-inline: 7px;
  font-size: 10px;
}

.bank-files__table-wrap {
  min-width: 0;
  overflow: auto;
}

.bank-files__table-wrap table {
  width: 100%;
  min-width: 900px;
  border-collapse: collapse;
  table-layout: fixed;
}

.bank-files__table-wrap th {
  padding: 12px 10px;
  border-bottom: 1px solid var(--ui-border);
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 8px;
  font-weight: 700;
  letter-spacing: .06em;
  text-align: left;
  text-transform: uppercase;
  white-space: nowrap;
}

.bank-files__table-wrap th:nth-child(1) { width: 22%; }
.bank-files__table-wrap th:nth-child(2) { width: 16%; }
.bank-files__table-wrap th:nth-child(3) { width: 11%; }
.bank-files__table-wrap th:nth-child(4) { width: 12%; }
.bank-files__table-wrap th:nth-child(5) { width: 8%; }
.bank-files__table-wrap th:nth-child(6) { width: 10%; }
.bank-files__table-wrap th:nth-child(7) { width: 9%; }
.bank-files__table-wrap th:nth-child(8) { width: 12%; }

.bank-files__table-wrap td {
  padding: 10px;
  border-bottom: 1px solid var(--ui-border);
  color: var(--ui-text-muted);
  font-size: 10px;
  line-height: 1.4;
  vertical-align: middle;
}

.bank-files__table-wrap tbody tr {
  cursor: pointer;
  transition: background-color var(--oe-motion-fast);
}

.bank-files__table-wrap tbody tr:hover,
.bank-files__table-wrap tbody tr.is-selected {
  background: var(--ui-bg-elevated);
}

.bank-files__table-wrap tbody tr.is-selected {
  box-shadow: inset 2px 0 var(--ui-text-highlighted);
}

.bank-files__status-badge {
  max-width: 100%;
}

.bank-files__file {
  display: flex;
  width: 100%;
  min-width: 0;
  gap: 9px;
  align-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
}

.bank-files__file > span:last-child {
  min-width: 0;
}

.bank-files__file strong,
.bank-files__file small {
  display: block;
}

.bank-files__file strong {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 11px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bank-files__file small {
  margin-top: 3px;
  color: var(--ui-text-muted);
  font-size: 9px;
}

.bank-files__file-icon {
  display: grid;
  width: 34px;
  height: 38px;
  flex: none;
  place-items: center;
  border: 1px solid var(--ui-border);
  border-radius: 7px;
  background: var(--ui-bg);
  color: var(--ui-text-toned);
  font-size: 17px;
}

.bank-files__file-icon--pdf {
  border-color: color-mix(in srgb, var(--ui-error) 34%, var(--ui-border));
  background: color-mix(in srgb, var(--ui-error) 10%, var(--ui-bg));
  color: var(--ui-error);
}

.bank-files__file-icon--spreadsheet {
  border-color: color-mix(in srgb, var(--ui-success) 34%, var(--ui-border));
  background: color-mix(in srgb, var(--ui-success) 10%, var(--ui-bg));
  color: var(--ui-success);
}

.bank-files__file-icon--document {
  border-color: color-mix(in srgb, var(--ui-info) 34%, var(--ui-border));
  background: color-mix(in srgb, var(--ui-info) 10%, var(--ui-bg));
  color: var(--ui-info);
}

.bank-files__snippet {
  display: -webkit-box;
  overflow: hidden;
  margin: 0;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.bank-files mark,
.bank-files__preview-surface mark {
  border-radius: 2px;
  background: color-mix(in srgb, var(--ui-warning) 55%, transparent);
  color: inherit;
}

.bank-files__muted {
  color: var(--ui-text-dimmed);
}

.bank-files__table-footer {
  padding: 10px 12px;
  color: var(--ui-text-muted);
  font-size: 10px;
}

.bank-files__loading {
  display: grid;
}

.bank-files__loading > div {
  display: grid;
  min-height: 66px;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 12px;
  border-bottom: 1px solid var(--ui-border);
}

.bank-files__empty {
  display: grid;
  min-height: 440px;
  place-items: center;
  align-content: center;
  gap: 10px;
  padding: 40px;
  text-align: center;
}

.bank-files__empty > span {
  display: grid;
  width: 54px;
  height: 54px;
  place-items: center;
  border: 1px solid var(--ui-border);
  border-radius: 50%;
  color: var(--ui-text-muted);
  font-size: 24px;
}

.bank-files__empty h3 {
  color: var(--ui-text-highlighted);
  font-size: 17px;
  font-weight: 600;
}

.bank-files__empty p {
  max-width: 420px;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.bank-files__preview {
  min-width: 0;
  padding: 14px 16px 18px;
  border-left: 1px solid var(--ui-border);
  background: var(--ui-bg);
}

.bank-files__preview > header {
  justify-content: space-between;
  gap: 12px;
}

.bank-files__preview-title {
  display: flex;
  min-width: 0;
  gap: 10px;
  align-items: center;
}

.bank-files__preview-title > div:last-child {
  min-width: 0;
}

.bank-files__preview h3 {
  overflow: hidden;
  margin-bottom: 5px;
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bank-files__preview-actions {
  gap: 7px;
  margin: 12px 0 4px;
}

.bank-files__preview-surface {
  display: grid;
  height: 416px;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: calc(var(--oe-radius-control) - 2px);
  background: var(--ui-bg-muted);
}

.bank-files__preview-surface iframe,
.bank-files__preview-surface img {
  width: 100%;
  height: 100%;
  border: 0;
  object-fit: contain;
}

.bank-files__preview-surface article {
  overflow: auto;
  padding: 32px;
  background: var(--ui-bg);
  color: var(--ui-text);
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
}

.bank-files__preview-empty {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 8px;
  padding: 30px;
  color: var(--ui-text-muted);
  text-align: center;
}

.bank-files__preview-empty > :first-child {
  font-size: 28px;
}

.bank-files__preview-empty strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.bank-files__preview-empty p {
  margin: 0;
  font-size: 11px;
}

.bank-files__preview-toolbar {
  justify-content: space-between;
  gap: 12px;
  margin-top: 9px;
}

.bank-files__preview-toolbar > div {
  display: flex;
  align-items: center;
  gap: 6px;
}

.bank-files__preview-toolbar span {
  min-width: 42px;
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  text-align: center;
}

.bank-files__metadata {
  display: grid;
  gap: 8px;
  margin: 18px 0 0;
  padding-top: 16px;
  border-top: 1px solid var(--ui-border);
}

.bank-files__metadata > div {
  display: grid;
  grid-template-columns: minmax(100px, .75fr) minmax(0, 1.25fr);
  gap: 12px;
  font-size: 11px;
}

.bank-files__metadata dt {
  color: var(--ui-text-muted);
}

.bank-files__metadata dd {
  min-width: 0;
  margin: 0;
  color: var(--ui-text-highlighted);
  overflow-wrap: anywhere;
}

.bank-files__metadata a {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.bank-files__versions-link {
  margin-top: 9px;
  padding-inline: 0;
}

@media (max-width: 1100px) {
  .bank-files--preview {
    display: block;
  }

  .bank-files--preview > .bank-files__heading,
  .bank-files--preview > .bank-files__upload,
  .bank-files--preview > .bank-files__toolbar,
  .bank-files--preview > .bank-files__state {
    margin-right: 0;
  }

  .bank-files--preview > .bank-files__heading {
    padding-top: 0;
  }

  .bank-files__workspace--preview {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }

  .bank-files__workspace--preview .bank-files__preview {
    grid-column: 1;
    grid-row: auto;
    border-top: 1px solid var(--ui-border);
    border-left: 0;
  }
}

@media (max-width: 1700px) {
  .bank-files--preview > .bank-files__toolbar {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 980px) {
  .bank-files__toolbar {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 760px) {
  .bank-files__heading,
  .bank-files__search-row {
    align-items: stretch;
    flex-direction: column;
  }

  .bank-files__heading :deep(button) {
    width: 100%;
  }

  .bank-files__filters {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .bank-files__filters :deep([data-slot="base"]) {
    width: 100%;
  }

  .bank-files__browser {
    grid-template-columns: minmax(0, 1fr);
  }

  .bank-files__categories {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    overflow-x: auto;
    border-right: 0;
    border-bottom: 1px solid var(--ui-border);
  }

  .bank-files__category-label {
    display: block;
  }

  .bank-files__category-heading {
    min-height: 38px;
    margin-bottom: 0;
    padding: 0;
  }

  .bank-files__category-heading .bank-files__category-label {
    display: none;
  }

  .bank-files__categories nav {
    display: flex;
    width: max-content;
    overflow: visible;
    padding-right: 0;
  }

  .bank-files__categories nav button {
    width: auto;
    min-width: max-content;
  }

  .bank-files__preview {
    padding: 14px 12px 18px;
  }

  .bank-files__preview-surface {
    height: 420px;
  }

  .bank-files__preview-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .bank-files__preview-toolbar > :deep(button) {
    width: 100%;
  }
}

@media (max-width: 420px) {
  .bank-files__filters :deep(button) {
    min-width: 0;
  }
}
</style>
