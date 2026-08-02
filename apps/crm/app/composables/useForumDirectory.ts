import type {
  ForumCategory,
  ForumRealtimeEvent,
  ForumSearchMode,
  ForumThreadListPayload,
  ForumThreadStatus,
  ForumThreadType,
} from '#shared/types/forum'
import { apiErrorMessage } from '~/utils/api-error'

type ForumThreadTypeFilter = 'all' | ForumThreadType
type ForumThreadStatusFilter = 'all' | ForumThreadStatus

interface ForumCategoriesPayload {
  categories: ForumCategory[]
}

interface UseForumDirectoryOptions {
  categorySlug?: string | (() => string)
}

const emptyForumThreadList = (): ForumThreadListPayload => ({
  categories: [],
  threads: [],
  searchMode: 'browse',
  query: null,
  total: 0,
})

function forumQueryText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function forumTypeFilter(value: unknown): ForumThreadTypeFilter {
  const normalized = forumQueryText(value)
  return normalized === 'question' || normalized === 'discussion' ? normalized : 'all'
}

function forumStatusFilter(value: unknown): ForumThreadStatusFilter {
  const normalized = forumQueryText(value)
  return ['open', 'answered', 'resolved', 'closed'].includes(normalized)
    ? normalized as ForumThreadStatus
    : 'all'
}

function forumTopicCountLabel(count: number): string {
  if (count === 1) return 'temat'
  const lastTwoDigits = count % 100
  return count % 10 >= 2 && count % 10 <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14)
    ? 'tematy'
    : 'tematów'
}

export function useForumDirectory(options: UseForumDirectoryOptions = {}) {
  const route = useRoute()
  const router = useRouter()
  const requestFetch = useRequestFetch()
  const { organizationSlug, orgApiPath } = useOrganizationContext()

  const requestedCategorySlug = computed(() => {
    const value = typeof options.categorySlug === 'function'
      ? options.categorySlug()
      : options.categorySlug
    return value?.trim().toLocaleLowerCase('pl') || ''
  })
  const searchInput = ref(forumQueryText(route.query.q))
  const typeFilter = ref<ForumThreadTypeFilter>(forumTypeFilter(route.query.type))
  const statusFilter = ref<ForumThreadStatusFilter>(forumStatusFilter(route.query.status))
  const categories = ref<ForumCategory[]>([])
  const categoriesStatus = ref<'idle' | 'pending' | 'success' | 'error'>('idle')
  const threadList = ref<ForumThreadListPayload>(emptyForumThreadList())
  const threadsStatus = ref<'idle' | 'pending' | 'success' | 'error'>('idle')
  const threadsError = ref('')
  const categoryNotFound = ref(false)
  let searchTimer: ReturnType<typeof setTimeout> | undefined
  let categoriesController: AbortController | null = null
  let listController: AbortController | null = null

  const threadsEndpoint = computed(() => orgApiPath('/forum/threads'))
  const categoriesEndpoint = computed(() => orgApiPath('/forum/categories'))
  const realtimeStateEndpoint = computed(() => orgApiPath('/forum/realtime'))
  const realtimeTokenEndpoint = computed(() => orgApiPath('/forum/realtime/token'))
  const activeCategory = computed(() => (
    categories.value.find(category => category.slug.toLocaleLowerCase('pl') === requestedCategorySlug.value)
    ?? null
  ))
  const searchValidationMessage = computed(() => {
    const length = searchInput.value.trim().length
    if (length > 0 && length < 3) return 'Wpisz co najmniej 3 znaki, aby rozpocząć wyszukiwanie.'
    if (length > 200) return 'Zapytanie może mieć maksymalnie 200 znaków.'
    return ''
  })
  const activeSearchQuery = computed(() => (
    threadList.value.query?.trim()
    || (searchValidationMessage.value ? '' : searchInput.value.trim())
  ))
  const searchModeLabel = computed(() => {
    const labels: Record<ForumSearchMode, string> = {
      browse: 'Przeglądanie forum',
      lexical: 'Wyszukiwanie po słowach kluczowych',
      hybrid: 'Wyszukiwanie hybrydowe: wektory + słowa kluczowe',
    }
    return labels[threadList.value.searchMode]
  })
  const searchHelpText = computed(() => (
    threadList.value.searchMode === 'hybrid'
      ? 'Wyniki łączą podobieństwo znaczeniowe z dopasowaniem słów kluczowych.'
      : 'Forum używa wyszukiwania wektorowego, gdy usługa semantyczna jest dostępna, i bezpiecznie przechodzi na słowa kluczowe, gdy nie jest.'
  ))
  const hasActiveFilters = computed(() => (
    Boolean(searchInput.value.trim())
    || typeFilter.value !== 'all'
    || statusFilter.value !== 'all'
  ))
  const resultAnnouncement = computed(() => {
    if (threadsStatus.value === 'pending') return 'Trwa wyszukiwanie tematów na forum'
    if (threadsStatus.value === 'error') return 'Nie udało się pobrać tematów na forum'
    const count = threadList.value.total
    if (activeSearchQuery.value) {
      return `${count} wyników dla zapytania „${activeSearchQuery.value}”. ${searchModeLabel.value}`
    }
    return `${count} ${forumTopicCountLabel(count)} na forum`
  })

  const typeItems: Array<{ label: string, value: ForumThreadTypeFilter, icon: string }> = [
    { label: 'Wszystkie typy', value: 'all', icon: 'i-lucide-list-filter' },
    { label: 'Pytania', value: 'question', icon: 'i-lucide-circle-help' },
    { label: 'Dyskusje', value: 'discussion', icon: 'i-lucide-messages-square' },
  ]
  const statusItems: Array<{ label: string, value: ForumThreadStatusFilter, icon: string }> = [
    { label: 'Wszystkie statusy', value: 'all', icon: 'i-lucide-list-checks' },
    { label: 'Otwarte', value: 'open', icon: 'i-lucide-circle-dot' },
    { label: 'Odpowiedziane', value: 'answered', icon: 'i-lucide-message-circle-check' },
    { label: 'Rozwiązane', value: 'resolved', icon: 'i-lucide-circle-check' },
    { label: 'Zamknięte', value: 'closed', icon: 'i-lucide-lock-keyhole' },
  ]

  const {
    connectionState: realtimeConnectionState,
    pulse: realtimePulse,
  } = useForumRealtime({
    organizationKey: organizationSlug,
    stateEndpoint: realtimeStateEndpoint,
    tokenEndpoint: realtimeTokenEndpoint,
    onChange: handleRealtimeChange,
  })
  const realtimeStatus = computed(() => {
    if (realtimeConnectionState.value === 'connected') {
      return { label: 'Na żywo', icon: 'i-lucide-radio', tone: 'live' }
    }
    if (realtimeConnectionState.value === 'polling') {
      return { label: 'Aktualizacje automatyczne', icon: 'i-lucide-refresh-cw', tone: 'polling' }
    }
    if (realtimeConnectionState.value === 'offline') {
      return { label: 'Offline — zmiany mogą być opóźnione', icon: 'i-lucide-cloud-off', tone: 'offline' }
    }
    return { label: 'Łączenie…', icon: 'i-lucide-loader-circle', tone: 'connecting' }
  })

  watch(
    [searchInput, typeFilter, statusFilter],
    () => scheduleSearch(),
    { flush: 'post' },
  )

  watch(
    () => [route.query.q, route.query.type, route.query.status] as const,
    ([q, type, status]) => {
      const nextSearch = forumQueryText(q)
      const nextType = forumTypeFilter(type)
      const nextStatus = forumStatusFilter(status)
      if (searchInput.value !== nextSearch) searchInput.value = nextSearch
      if (typeFilter.value !== nextType) typeFilter.value = nextType
      if (statusFilter.value !== nextStatus) statusFilter.value = nextStatus
    },
  )

  watch(requestedCategorySlug, () => {
    if (import.meta.client) void initialize()
  })

  watch(organizationSlug, () => {
    categories.value = []
    threadList.value = emptyForumThreadList()
    if (import.meta.client) void initialize()
  })

  onMounted(() => {
    void initialize()
  })

  onBeforeUnmount(() => {
    if (searchTimer) clearTimeout(searchTimer)
    categoriesController?.abort()
    listController?.abort()
  })

  function scheduleSearch(): void {
    if (!import.meta.client) return
    if (searchTimer) clearTimeout(searchTimer)
    listController?.abort()
    if (searchValidationMessage.value) return
    searchTimer = setTimeout(() => {
      void submitSearch()
    }, 360)
  }

  async function initialize(): Promise<void> {
    const categoriesLoaded = await loadCategories()
    if (!categoriesLoaded) {
      categoryNotFound.value = false
      threadList.value = emptyForumThreadList()
      threadsError.value = 'Nie udało się pobrać kategorii forum.'
      threadsStatus.value = 'error'
      return
    }
    if (requestedCategorySlug.value && !activeCategory.value) {
      categoryNotFound.value = true
      threadList.value = emptyForumThreadList()
      threadsStatus.value = 'success'
      return
    }
    categoryNotFound.value = false
    await loadThreads()
    await redirectLegacyCategoryFilter()
  }

  async function loadCategories(options: { preserveContent?: boolean } = {}): Promise<boolean> {
    categoriesController?.abort()
    const controller = new AbortController()
    categoriesController = controller
    const preserveContent = options.preserveContent === true && categoriesStatus.value === 'success'
    if (!preserveContent) categoriesStatus.value = 'pending'

    try {
      const payload = await requestFetch<ForumCategoriesPayload>(categoriesEndpoint.value, {
        signal: controller.signal,
      })
      if (categoriesController !== controller) return false
      categories.value = payload.categories
        .filter(category => category.isActive !== false)
        .sort((left, right) => (
          (left.sortOrder ?? 100) - (right.sortOrder ?? 100)
          || left.name.localeCompare(right.name, 'pl')
        ))
      categoriesStatus.value = 'success'
      return true
    } catch (error) {
      if (controller.signal.aborted) return false
      if (!preserveContent) categoriesStatus.value = 'error'
      return false
    } finally {
      if (categoriesController === controller) categoriesController = null
    }
  }

  async function loadThreads(options: { preserveContent?: boolean } = {}): Promise<boolean> {
    listController?.abort()
    const controller = new AbortController()
    listController = controller
    const preserveContent = options.preserveContent === true && threadsStatus.value === 'success'
    if (!preserveContent) threadsStatus.value = 'pending'
    threadsError.value = ''

    try {
      const payload = await requestFetch<ForumThreadListPayload>(threadsEndpoint.value, {
        query: {
          q: searchValidationMessage.value ? undefined : searchInput.value.trim() || undefined,
          category: activeCategory.value?.id,
          type: typeFilter.value === 'all' ? undefined : typeFilter.value,
          status: statusFilter.value === 'all' ? undefined : statusFilter.value,
          limit: 50,
        },
        signal: controller.signal,
      })
      if (listController !== controller) return false
      threadList.value = payload
      if (!categories.value.length && payload.categories.length) categories.value = payload.categories
      threadsStatus.value = 'success'
      return true
    } catch (error) {
      if (controller.signal.aborted) return false
      threadsError.value = apiErrorMessage(error)
      if (!preserveContent) threadsStatus.value = 'error'
      return false
    } finally {
      if (listController === controller) listController = null
    }
  }

  async function syncFiltersToRoute(): Promise<void> {
    const query = { ...route.query }
    delete query.thread
    delete query.category
    const q = searchInput.value.trim()
    if (q) query.q = q
    else delete query.q
    if (typeFilter.value !== 'all') query.type = typeFilter.value
    else delete query.type
    if (statusFilter.value !== 'all') query.status = statusFilter.value
    else delete query.status
    await router.replace({ path: route.path, query })
  }

  async function submitSearch(): Promise<void> {
    if (searchValidationMessage.value) return
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = undefined
    await syncFiltersToRoute()
    await loadThreads()
  }

  function clearSearch(): void {
    searchInput.value = ''
  }

  function resetFilters(): void {
    searchInput.value = ''
    typeFilter.value = 'all'
    statusFilter.value = 'all'
  }

  async function handleRealtimeChange(_event: ForumRealtimeEvent | null): Promise<void> {
    const categoriesUpdated = await loadCategories({ preserveContent: true })
    if (!categoriesUpdated) {
      throw new Error('Forum background synchronization will be retried')
    }
    if (requestedCategorySlug.value && !activeCategory.value) {
      categoryNotFound.value = true
      threadList.value = emptyForumThreadList()
      threadsStatus.value = 'success'
      return
    }
    categoryNotFound.value = false
    const threadsUpdated = await loadThreads({ preserveContent: true })
    if (!threadsUpdated) throw new Error('Forum background synchronization will be retried')
  }

  async function redirectLegacyCategoryFilter(): Promise<void> {
    if (requestedCategorySlug.value) return
    const categoryId = forumQueryText(route.query.category)
    if (!categoryId) return
    const category = categories.value.find(item => item.id === categoryId)
    if (!category) return
    const query = { ...route.query }
    delete query.category
    await router.replace({
      path: `/org/${encodeURIComponent(organizationSlug.value)}/forum/categories/${encodeURIComponent(category.slug)}`,
      query,
    })
  }

  return {
    activeCategory,
    activeSearchQuery,
    categories,
    categoriesEndpoint,
    categoriesStatus,
    categoryNotFound,
    clearSearch,
    hasActiveFilters,
    initialize,
    loadCategories,
    loadThreads,
    realtimePulse,
    realtimeStatus,
    resetFilters,
    resultAnnouncement,
    searchHelpText,
    searchInput,
    searchModeLabel,
    searchValidationMessage,
    statusFilter,
    statusItems,
    submitSearch,
    threadList,
    threadsEndpoint,
    threadsError,
    threadsStatus,
    typeFilter,
    typeItems,
  }
}
