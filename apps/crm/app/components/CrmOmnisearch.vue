<script setup lang="ts">
import type { CommandPaletteGroup, CommandPaletteItem } from '@nuxt/ui'
import type {
  CrmOmnisearchGroupKey,
  CrmOmnisearchResponse,
  CrmOmnisearchTarget,
} from '#shared/types/omnisearch'

type SearchState = 'idle' | 'pending' | 'success' | 'error'

interface NavigationSearchItem {
  id: string
  label: string
  description?: string
  suffix?: string
  icon: string
  to: CrmOmnisearchTarget
  keywords?: string
}

const props = withDefaults(defineProps<{
  organizationSlug: string
  pages?: NavigationSearchItem[]
}>(), {
  pages: () => [],
})

const open = defineModel<boolean>('open', { default: false })
const searchTerm = ref('')
const response = ref<CrmOmnisearchResponse | null>(null)
const searchState = ref<SearchState>('idle')
const searchError = ref('')
const normalizedSearchTerm = computed(() => searchTerm.value.trim().replace(/\s+/gu, ' '))

let searchTimer: ReturnType<typeof setTimeout> | null = null
let searchController: AbortController | null = null
let searchRequestId = 0

function clearScheduledSearch() {
  if (searchTimer) {
    clearTimeout(searchTimer)
    searchTimer = null
  }
  searchController?.abort()
  searchController = null
}

async function fetchSearchResults(query: string, organizationSlug: string, requestId: number) {
  const controller = new AbortController()
  searchController = controller

  try {
    const result = await $fetch<CrmOmnisearchResponse>(
      `/api/org/${encodeURIComponent(organizationSlug)}/crm/omnisearch`,
      {
        query: { q: query, limit: 5 },
        signal: controller.signal,
      },
    )
    if (requestId !== searchRequestId) return
    response.value = result
    searchState.value = 'success'
  }
  catch (error) {
    if (requestId !== searchRequestId || controller.signal.aborted) return
    response.value = null
    searchError.value = apiErrorMessage(error)
    searchState.value = 'error'
  }
  finally {
    if (requestId === searchRequestId) searchController = null
  }
}

watch(
  [normalizedSearchTerm, () => props.organizationSlug, open],
  ([query, organizationSlug, isOpen]) => {
    clearScheduledSearch()
    const requestId = ++searchRequestId
    response.value = null
    searchError.value = ''

    if (!isOpen || query.length < 3 || !organizationSlug) {
      searchState.value = 'idle'
      return
    }

    searchState.value = 'pending'
    searchTimer = setTimeout(() => {
      searchTimer = null
      void fetchSearchResults(query, organizationSlug, requestId)
    }, 350)
  },
  { immediate: true },
)

watch(open, (isOpen) => {
  if (isOpen) return
  searchTerm.value = ''
})

onBeforeUnmount(clearScheduledSearch)

function remoteItems(group: CrmOmnisearchGroupKey): CommandPaletteItem[] {
  return (response.value?.groups[group] ?? []).map(hit => ({
    ...hit,
    ...(hit.kind === 'bank_file' && hit.avatar
      ? {
          avatar: {
            ...hit.avatar,
            class: 'rounded-md border border-muted bg-default',
            ui: { image: 'object-contain p-0.5' },
          },
        }
      : {}),
    to: hit.to as CommandPaletteItem['to'],
  }))
}

const searchGroups = computed<CommandPaletteGroup<CommandPaletteItem>[]>(() => [{
  id: 'crm-forum',
  label: 'Forum ekspertów',
  ignoreFilter: true,
  highlightedIcon: 'i-lucide-corner-down-left',
  items: remoteItems('forum'),
}, {
  id: 'crm-bank-files',
  label: 'Pliki z banków',
  ignoreFilter: true,
  highlightedIcon: 'i-lucide-corner-down-left',
  items: remoteItems('bankFiles'),
}, {
  id: 'crm-knowledge',
  label: 'Wiedza',
  ignoreFilter: true,
  highlightedIcon: 'i-lucide-corner-down-left',
  items: remoteItems('knowledge'),
}, {
  id: 'crm-cases',
  label: 'Sprawy',
  ignoreFilter: true,
  highlightedIcon: 'i-lucide-corner-down-left',
  items: remoteItems('cases'),
}, {
  id: 'crm-clients',
  label: 'Klienci',
  ignoreFilter: true,
  highlightedIcon: 'i-lucide-corner-down-left',
  items: remoteItems('clients'),
}, {
  id: 'crm-appointments',
  label: 'Spotkania',
  ignoreFilter: true,
  highlightedIcon: 'i-lucide-corner-down-left',
  items: remoteItems('appointments'),
}, {
  id: 'crm-tasks',
  label: 'Zadania',
  ignoreFilter: true,
  highlightedIcon: 'i-lucide-corner-down-left',
  items: remoteItems('tasks'),
}, {
  id: 'crm-documents',
  label: 'Dokumenty i wnioski',
  ignoreFilter: true,
  highlightedIcon: 'i-lucide-corner-down-left',
  items: remoteItems('documents'),
}, {
  id: 'crm-pages',
  label: 'Strony CRM',
  highlightedIcon: 'i-lucide-corner-down-left',
  items: props.pages.map(page => ({
    ...page,
    to: page.to as CommandPaletteItem['to'],
  })),
}])

const statusMessage = computed(() => {
  if (searchState.value === 'pending') return 'Wyszukiwanie danych CRM…'
  if (searchState.value === 'error') return 'Wyszukiwanie danych CRM nie powiodło się.'
  if (normalizedSearchTerm.value.length < 3) return 'Wpisz co najmniej 3 znaki, aby przeszukać dane CRM.'
  return ''
})
</script>

<template>
  <UDashboardSearch
    v-model:open="open"
    v-model:search-term="searchTerm"
    :groups="searchGroups"
    :loading="searchState === 'pending'"
    :color-mode="false"
    :transition="false"
    :preserve-group-order="true"
    :search-delay="0"
    :fuse="{
      fuseOptions: {
        ignoreLocation: true,
        includeMatches: true,
        threshold: 0.28,
        keys: ['label', 'description', 'suffix', 'keywords'],
      },
      resultLimit: 8,
      matchAllWhenSearchEmpty: true,
    }"
    size="md"
    title="Wyszukiwanie w CRM"
    description="Przeszukaj forum ekspertów, Wiedzę, pliki banków, sprawy, klientów, spotkania, zadania, dokumenty, wnioski i strony CRM."
    placeholder="Szukaj w całym CRM…"
  >
    <template #empty>
      <div
        v-if="searchState === 'pending'"
        class="flex items-center justify-center gap-2"
        role="status"
      >
        <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
        <span>Przeszukuję dane CRM…</span>
      </div>

      <div v-else-if="normalizedSearchTerm.length < 3" class="grid justify-items-center gap-1">
        <UIcon name="i-lucide-search" class="size-5 text-muted" />
        <span>Wpisz co najmniej 3 znaki, aby przeszukać dane CRM.</span>
      </div>

      <div
        v-else-if="searchState === 'error'"
        class="grid justify-items-center gap-1 text-center"
        role="alert"
      >
        <UIcon name="i-lucide-circle-alert" class="size-5 text-error" />
        <span>Nie udało się pobrać wyników.</span>
        <span v-if="searchError" class="text-xs text-muted">{{ searchError }}</span>
      </div>

      <div v-else class="grid justify-items-center gap-1 text-center">
        <UIcon name="i-lucide-search-x" class="size-5 text-muted" />
        <span>Nie znaleziono wyników dla „{{ normalizedSearchTerm }}”.</span>
        <span class="text-xs text-muted">Spróbuj pytania, nazwy banku, treści z Wiedzy, procedury, nazwiska, numeru telefonu lub tytułu dokumentu.</span>
      </div>
    </template>

    <template #footer>
      <div class="flex min-w-0 items-center justify-between gap-4 text-xs text-muted">
        <span class="min-w-0 truncate" aria-live="polite">{{ statusMessage }}</span>
        <span class="hidden shrink-0 items-center gap-2 sm:flex" aria-hidden="true">
          <span class="inline-flex items-center gap-1"><UKbd value="arrowup" /><UKbd value="arrowdown" /> wybór</span>
          <span class="inline-flex items-center gap-1"><UKbd value="enter" /> otwórz</span>
          <span class="inline-flex items-center gap-1"><UKbd value="escape" /> zamknij</span>
        </span>
      </div>
    </template>
  </UDashboardSearch>
</template>
