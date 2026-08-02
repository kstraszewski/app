<script setup lang="ts">
import type {
  ForumCreateReplyPayload,
  ForumCreateThreadPayload,
  ForumRealtimeEvent,
  ForumSearchMode,
  ForumThread,
  ForumThreadDetailPayload,
  ForumThreadListPayload,
  ForumThreadStatus,
  ForumThreadSummary,
  ForumThreadType,
} from '#shared/types/forum'
import { apiErrorMessage } from '~/utils/api-error'

definePageMeta({ middleware: ['auth', 'organization'] })
useHead({ title: 'Forum ekspertów — OpenExpert CRM' })

const route = useRoute()
const router = useRouter()
const requestFetch = useRequestFetch()
const { organizationSlug, orgApiPath } = useOrganizationContext()

type ThreadTypeFilter = 'all' | ForumThreadType
type ThreadStatusFilter = 'all' | ForumThreadStatus

interface ForumModerationContextPayload {
  canModerate: boolean
  canManageCategories: boolean
  roleLabel?: string
  isForumAdmin?: boolean
  isOrganizationAdmin?: boolean
}

const emptyThreadList = (): ForumThreadListPayload => ({
  categories: [],
  threads: [],
  searchMode: 'browse',
  query: null,
  total: 0,
})

function queryText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function threadTypeFilter(value: unknown): ThreadTypeFilter {
  const normalized = queryText(value)
  return normalized === 'question' || normalized === 'discussion' ? normalized : 'all'
}

function threadStatusFilter(value: unknown): ThreadStatusFilter {
  const normalized = queryText(value)
  return ['open', 'answered', 'resolved', 'closed'].includes(normalized)
    ? normalized as ForumThreadStatus
    : 'all'
}

const selectedThreadId = computed(() => {
  const value = queryText(route.query.thread)
  return /^[\p{L}\p{N}_.:-]{1,256}$/u.test(value) ? value : ''
})
const searchInput = ref(queryText(route.query.q))
const categoryFilter = ref(queryText(route.query.category) || 'all')
const typeFilter = ref<ThreadTypeFilter>(threadTypeFilter(route.query.type))
const statusFilter = ref<ThreadStatusFilter>(threadStatusFilter(route.query.status))
const scopeFilter = ref<'organization'>('organization')
const composerOpen = ref(false)
const moderationPanelOpen = ref(false)
const moderationContext = ref<ForumModerationContextPayload>({
  canModerate: false,
  canManageCategories: false,
  roleLabel: '',
})
const moderationContextStatus = ref<'idle' | 'pending' | 'success' | 'error'>('idle')

const threadList = ref<ForumThreadListPayload>(emptyThreadList())
const threadsStatus = ref<'idle' | 'pending' | 'success' | 'error'>('idle')
const threadsError = ref('')
const detailPayload = ref<ForumThreadDetailPayload | null>(null)
const detailStatus = ref<'idle' | 'pending' | 'success' | 'error'>('idle')
const detailError = ref('')
let searchTimer: ReturnType<typeof setTimeout> | undefined
let listController: AbortController | null = null
let detailController: AbortController | null = null
let moderationContextController: AbortController | null = null
const detailPane = ref<HTMLElement | null>(null)
const forumBrowser = ref<HTMLElement | null>(null)
const unseenReplyCount = ref(0)

const threadsEndpoint = computed(() => orgApiPath('/forum/threads'))
const categoriesEndpoint = computed(() => orgApiPath('/forum/categories'))
const moderationContextEndpoint = computed(() => orgApiPath('/forum/moderation/context'))
const moderationItemsEndpoint = computed(() => orgApiPath('/forum/moderation/items'))
const postsModerationEndpoint = computed(() => orgApiPath('/forum/posts'))
const threadModerationEndpoint = computed(() => (
  selectedThreadId.value
    ? orgApiPath(`/forum/threads/${encodeURIComponent(selectedThreadId.value)}/moderation`)
    : ''
))
const replyEndpoint = computed(() => (
  selectedThreadId.value
    ? orgApiPath(`/forum/threads/${encodeURIComponent(selectedThreadId.value)}/replies`)
    : ''
))
const moderatorRoleLabel = computed(() => (
  moderationContext.value.roleLabel?.trim()
  || (moderationContext.value.isOrganizationAdmin ? 'Administrator organizacji' : '')
  || (moderationContext.value.isForumAdmin ? 'Administrator forum' : '')
  || (moderationContext.value.canModerate ? 'Moderator forum' : '')
  || (moderationContext.value.canManageCategories ? 'Administrator forum' : '')
))
const moderationAccess = computed(() => ({
  canModerate: moderationContext.value.canModerate,
  canManageCategories: moderationContext.value.canManageCategories,
  roleLabel: moderatorRoleLabel.value,
}))
const selectedThread = computed<ForumThread | null>(() => detailPayload.value?.thread ?? null)
const selectedPosts = computed(() => (
  detailPayload.value?.posts
  ?? detailPayload.value?.thread.posts
  ?? []
))
const categoryItems = computed(() => [
  { label: 'Wszystkie kategorie', value: 'all', icon: 'i-lucide-layout-grid' },
  ...threadList.value.categories.map(category => ({
    label: category.name,
    value: category.id,
    icon: category.icon || 'i-lucide-folder',
  })),
])
const scopeItems = [
  { label: 'Cała organizacja', value: 'organization', icon: 'i-lucide-building-2' },
]
const typeItems: Array<{ label: string, value: ThreadTypeFilter, icon: string }> = [
  { label: 'Wszystkie typy', value: 'all', icon: 'i-lucide-list-filter' },
  { label: 'Pytania', value: 'question', icon: 'i-lucide-circle-help' },
  { label: 'Dyskusje', value: 'discussion', icon: 'i-lucide-messages-square' },
]
const statusItems: Array<{ label: string, value: ThreadStatusFilter, icon: string }> = [
  { label: 'Wszystkie statusy', value: 'all', icon: 'i-lucide-list-checks' },
  { label: 'Otwarte', value: 'open', icon: 'i-lucide-circle-dot' },
  { label: 'Odpowiedziane', value: 'answered', icon: 'i-lucide-message-circle-check' },
  { label: 'Rozwiązane', value: 'resolved', icon: 'i-lucide-circle-check' },
  { label: 'Zamknięte', value: 'closed', icon: 'i-lucide-lock-keyhole' },
]
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
    ? 'Tryb hybrydowy łączy wyszukiwanie wektorowe znaczenia z dopasowaniem słów kluczowych.'
    : 'Forum automatycznie używa wyszukiwania wektorowego, gdy usługa semantyczna jest dostępna; w przeciwnym razie bezpiecznie wyszukuje po słowach kluczowych.'
))
const resultAnnouncement = computed(() => {
  if (threadsStatus.value === 'pending') return 'Trwa wyszukiwanie tematów na forum'
  if (threadsStatus.value === 'error') return 'Nie udało się pobrać tematów na forum'
  const count = threadList.value.total
  if (activeSearchQuery.value) {
    return `${count} wyników dla zapytania „${activeSearchQuery.value}”. ${searchModeLabel.value}`
  }
  return `${count} tematów na forum`
})
const hasActiveFilters = computed(() => (
  Boolean(searchInput.value.trim())
  || categoryFilter.value !== 'all'
  || typeFilter.value !== 'all'
  || statusFilter.value !== 'all'
))
const moderationRealtimeRevision = ref(0)
const realtimeStateEndpoint = computed(() => orgApiPath('/forum/realtime'))
const realtimeTokenEndpoint = computed(() => orgApiPath('/forum/realtime/token'))
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
  [searchInput, categoryFilter, typeFilter, statusFilter],
  () => scheduleThreadSearch(),
  { flush: 'post' },
)

watch(
  () => [route.query.q, route.query.category, route.query.type, route.query.status] as const,
  ([q, category, type, status]) => {
    const nextSearch = queryText(q)
    const nextCategory = queryText(category) || 'all'
    const nextType = threadTypeFilter(type)
    const nextStatus = threadStatusFilter(status)
    if (searchInput.value !== nextSearch) searchInput.value = nextSearch
    if (categoryFilter.value !== nextCategory) categoryFilter.value = nextCategory
    if (typeFilter.value !== nextType) typeFilter.value = nextType
    if (statusFilter.value !== nextStatus) statusFilter.value = nextStatus
  },
)

watch(selectedThreadId, () => {
  unseenReplyCount.value = 0
  if (import.meta.client) void loadSelectedThread()
})

watch(organizationSlug, () => {
  if (!import.meta.client) return
  threadList.value = emptyThreadList()
  detailPayload.value = null
  moderationPanelOpen.value = false
  moderationContext.value = {
    canModerate: false,
    canManageCategories: false,
    roleLabel: '',
  }
  void loadThreads()
  void loadSelectedThread()
  void loadModerationContext()
})

onMounted(() => {
  void loadThreads()
  void loadModerationContext()
  if (selectedThreadId.value) void loadSelectedThread()
})

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
  listController?.abort()
  detailController?.abort()
  moderationContextController?.abort()
})

function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError')
}

function apiStatusCode(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const candidate = error as {
    status?: unknown
    statusCode?: unknown
    response?: { status?: unknown }
  }
  const value = candidate.statusCode ?? candidate.status ?? candidate.response?.status
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function scheduleThreadSearch(): void {
  if (!import.meta.client) return
  if (searchTimer) clearTimeout(searchTimer)
  listController?.abort()
  if (searchValidationMessage.value) return
  searchTimer = setTimeout(() => {
    void submitSearch()
  }, 360)
}

async function syncFiltersToRoute(): Promise<void> {
  const query = { ...route.query }
  const q = searchInput.value.trim()
  if (q) query.q = q
  else delete query.q
  if (categoryFilter.value !== 'all') query.category = categoryFilter.value
  else delete query.category
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
        category: categoryFilter.value === 'all' ? undefined : categoryFilter.value,
        type: typeFilter.value === 'all' ? undefined : typeFilter.value,
        status: statusFilter.value === 'all' ? undefined : statusFilter.value,
        limit: 50,
      },
      signal: controller.signal,
    })
    if (listController !== controller) return false
    threadList.value = payload
    threadsStatus.value = 'success'
    maybeSelectFirstThread(payload.threads)
    return true
  } catch (error) {
    if (controller.signal.aborted || isAbortError(error)) return false
    threadsError.value = apiErrorMessage(error)
    if (!preserveContent) threadsStatus.value = 'error'
    return false
  } finally {
    if (listController === controller) listController = null
  }
}

async function loadModerationContext(): Promise<void> {
  moderationContextController?.abort()
  const controller = new AbortController()
  moderationContextController = controller
  moderationContextStatus.value = 'pending'
  try {
    moderationContext.value = await requestFetch<ForumModerationContextPayload>(
      moderationContextEndpoint.value,
      { signal: controller.signal },
    )
    if (moderationContextController !== controller) return
    moderationContextStatus.value = 'success'
  } catch (error) {
    if (controller.signal.aborted || isAbortError(error)) return
    moderationContext.value = {
      canModerate: false,
      canManageCategories: false,
      roleLabel: '',
    }
    moderationContextStatus.value = 'error'
  } finally {
    if (moderationContextController === controller) moderationContextController = null
  }
}

function maybeSelectFirstThread(threads: ForumThreadSummary[]): void {
  if (!import.meta.client || selectedThreadId.value || !threads[0]) return
  if (!window.matchMedia('(min-width: 961px)').matches) return
  const query = { ...route.query, thread: threads[0].id }
  void router.replace({ path: route.path, query })
}

async function loadSelectedThread(options: { preserveContent?: boolean } = {}): Promise<boolean> {
  detailController?.abort()
  const threadId = selectedThreadId.value
  if (!threadId) {
    detailPayload.value = null
    detailStatus.value = 'idle'
    detailError.value = ''
    return true
  }
  const controller = new AbortController()
  detailController = controller
  const preserveContent = options.preserveContent === true && Boolean(detailPayload.value)
  if (!preserveContent) detailStatus.value = 'pending'
  detailError.value = ''
  try {
    const payload = await requestFetch<ForumThreadDetailPayload>(
      orgApiPath(`/forum/threads/${encodeURIComponent(threadId)}`),
      { signal: controller.signal },
    )
    if (detailController !== controller) return false
    detailPayload.value = payload
    detailStatus.value = 'success'
    return true
  } catch (error) {
    if (controller.signal.aborted || isAbortError(error)) return false
    detailError.value = apiErrorMessage(error)
    const inaccessible = [403, 404].includes(apiStatusCode(error) ?? 0)
    if (!preserveContent || inaccessible) detailStatus.value = 'error'
    return inaccessible
  } finally {
    if (detailController === controller) detailController = null
  }
}

function detailIsNearBottom(): boolean {
  const pane = detailPane.value
  if (!pane) return true
  return pane.scrollHeight - pane.scrollTop - pane.clientHeight < 180
}

function revealNewReplies(behavior: ScrollBehavior = 'smooth'): void {
  unseenReplyCount.value = 0
  const pane = detailPane.value
  if (!pane) return
  pane.scrollTo({ top: pane.scrollHeight, behavior })
}

function handleDetailScroll(): void {
  if (unseenReplyCount.value && detailIsNearBottom()) unseenReplyCount.value = 0
}

async function handleRealtimeChange(event: ForumRealtimeEvent | null): Promise<void> {
  const threadId = selectedThreadId.value
  const replyCountBefore = selectedPosts.value.filter(post => post.kind === 'reply').length
  const wasNearBottom = detailIsNearBottom()
  moderationRealtimeRevision.value += 1

  const [listUpdated, detailUpdated] = await Promise.all([
    loadThreads({ preserveContent: true }),
    threadId ? loadSelectedThread({ preserveContent: true }) : Promise.resolve(true),
  ])
  if (!listUpdated || !detailUpdated) {
    throw new Error('Forum background synchronization will be retried')
  }

  if (!threadId || selectedThreadId.value !== threadId) return
  const replyCountAfter = selectedPosts.value.filter(post => post.kind === 'reply').length
  const addedReplies = Math.max(0, replyCountAfter - replyCountBefore)
  if (!addedReplies) return
  if (event?.threadId && event.threadId !== threadId) return

  await nextTick()
  if (wasNearBottom) revealNewReplies('smooth')
  else unseenReplyCount.value += addedReplies
}

async function selectThread(thread: ForumThreadSummary): Promise<void> {
  if (selectedThreadId.value === thread.id) return
  await router.push({
    path: route.path,
    query: { ...route.query, thread: thread.id },
  })
  if (import.meta.client && (forumBrowser.value?.clientWidth ?? window.innerWidth) <= 900) {
    await nextTick()
    detailPane.value?.focus()
  }
}

async function closeThread(): Promise<void> {
  const previousThreadId = selectedThreadId.value
  const query = { ...route.query }
  delete query.thread
  detailPayload.value = null
  detailStatus.value = 'idle'
  await router.push({ path: route.path, query })
  if (import.meta.client && previousThreadId) {
    await nextTick()
    document.getElementById(`forum-thread-card-${previousThreadId}`)?.focus()
  }
}

function clearSearch(): void {
  searchInput.value = ''
}

function resetFilters(): void {
  searchInput.value = ''
  categoryFilter.value = 'all'
  typeFilter.value = 'all'
  statusFilter.value = 'all'
}

async function handleThreadCreated(payload: ForumCreateThreadPayload): Promise<void> {
  composerOpen.value = false
  await router.push({
    path: route.path,
    query: { ...route.query, thread: payload.thread.id },
  })
  await Promise.all([loadThreads(), loadSelectedThread()])
}

async function handleReplyCreated(_payload: ForumCreateReplyPayload): Promise<void> {
  await Promise.all([loadThreads(), loadSelectedThread()])
  await nextTick()
  revealNewReplies('smooth')
}

async function handleModerated(): Promise<void> {
  await Promise.all([loadThreads(), loadSelectedThread({ preserveContent: true })])
}

async function handleCategoriesChanged(): Promise<void> {
  await Promise.all([loadThreads(), selectedThreadId.value ? loadSelectedThread() : Promise.resolve()])
}

async function openModeratedThread(threadId: string): Promise<void> {
  moderationPanelOpen.value = false
  await router.push({
    path: route.path,
    query: { ...route.query, thread: threadId },
  })
  await nextTick()
  detailPane.value?.focus()
}

function openSimilarThread(thread: ForumThreadSummary): void {
  composerOpen.value = false
  selectThread(thread)
}
</script>

<template>
  <div class="forum-page-root">
    <CrmShell
      title="Forum ekspertów"
      eyebrow="Wiedza organizacji"
      description="Zadaj pytanie, znajdź sprawdzone odpowiedzi i dziel się wiedzą z ekspertami w organizacji."
    >
      <template #actions>
        <div class="forum-header-actions">
          <UBadge
            v-if="(moderationContext.canModerate || moderationContext.canManageCategories) && moderatorRoleLabel"
            color="warning"
            variant="subtle"
            icon="i-lucide-shield-check"
          >
            {{ moderatorRoleLabel }}
          </UBadge>
          <UButton
            v-if="moderationContext.canModerate || moderationContext.canManageCategories"
            color="neutral"
            variant="outline"
            icon="i-lucide-shield"
            @click="moderationPanelOpen = true"
          >
            Panel moderacji
          </UButton>
          <UButton icon="i-lucide-plus" @click="composerOpen = true">
            Nowy temat
          </UButton>
        </div>
      </template>

      <UAlert
        v-if="moderationContextStatus === 'error'"
        role="alert"
        class="mb-3"
        color="warning"
        variant="subtle"
        icon="i-lucide-shield-alert"
        title="Panel moderacji jest chwilowo niedostępny"
        description="Forum nadal działa, ale nie udało się potwierdzić uprawnień moderatora. System ponowi kontrolę po zmianie organizacji lub ponownym wejściu na forum."
      />

      <section
        ref="forumBrowser"
        class="forum-browser"
        :class="{ 'forum-browser--thread-open': selectedThreadId }"
        aria-label="Forum ekspertów"
      >
        <aside class="forum-list-pane" aria-label="Tematy na forum">
          <div class="forum-search-panel">
            <form role="search" class="forum-search" @submit.prevent="submitSearch">
              <UInput
                v-model="searchInput"
                class="forum-search__input"
                size="lg"
                icon="i-lucide-search"
                placeholder="Szukaj pytania, odpowiedzi lub tematu…"
                aria-label="Semantyczne wyszukiwanie na forum"
                autocomplete="off"
                :maxlength="200"
              >
                <template v-if="searchInput" #trailing>
                  <UButton
                    type="button"
                    color="neutral"
                    variant="link"
                    square
                    size="xs"
                    icon="i-lucide-x"
                    aria-label="Wyczyść wyszukiwanie"
                    @click="clearSearch"
                  />
                </template>
              </UInput>
              <UButton type="submit" color="neutral" variant="solid" aria-label="Wyszukaj na forum">
                Szukaj
              </UButton>
            </form>

            <p v-if="searchValidationMessage" class="forum-search-validation" role="status">
              {{ searchValidationMessage }}
            </p>

            <div class="forum-search-mode" role="status">
              <UIcon
                :name="threadList.searchMode === 'hybrid' ? 'i-lucide-sparkles' : 'i-lucide-search-check'"
                aria-hidden="true"
              />
              <span>{{ searchModeLabel }}</span>
              <UTooltip
                :text="searchHelpText"
              >
                <UButton
                  color="neutral"
                  variant="link"
                  square
                  size="xs"
                  icon="i-lucide-circle-help"
                  aria-label="Jak działa wyszukiwanie semantyczne?"
                />
              </UTooltip>
            </div>

            <div
              class="forum-realtime-status"
              :class="[
                `forum-realtime-status--${realtimeStatus.tone}`,
                { 'forum-realtime-status--pulse': realtimePulse },
              ]"
              role="status"
              aria-live="polite"
            >
              <UIcon :name="realtimeStatus.icon" aria-hidden="true" />
              <span>{{ realtimeStatus.label }}</span>
              <span v-if="realtimePulse" class="forum-realtime-status__updated">
                Zaktualizowano teraz
              </span>
            </div>

            <div class="forum-filters" aria-label="Filtry forum">
              <USelect
                v-model="scopeFilter"
                :items="scopeItems"
                value-key="value"
                icon="i-lucide-building-2"
                aria-label="Zakres forum"
              />
              <USelect
                v-model="typeFilter"
                :items="typeItems"
                value-key="value"
                icon="i-lucide-list-filter"
                aria-label="Filtruj po typie tematu"
              />
              <USelect
                v-model="statusFilter"
                :items="statusItems"
                value-key="value"
                icon="i-lucide-circle-check"
                aria-label="Filtruj po statusie"
              />
              <USelect
                v-model="categoryFilter"
                :items="categoryItems"
                value-key="value"
                icon="i-lucide-folder"
                aria-label="Filtruj po kategorii"
              />
            </div>
          </div>

          <div class="forum-list-summary">
            <div>
              <strong>{{ threadList.total }} {{ threadList.total === 1 ? 'wynik' : 'wyników' }}</strong>
              <span v-if="activeSearchQuery">dla „{{ activeSearchQuery }}”</span>
              <span v-else>w całej organizacji</span>
            </div>
            <span>Sortuj: {{ activeSearchQuery ? 'najlepsze dopasowanie' : 'ostatnia aktywność' }}</span>
          </div>

          <ClientOnly>
            <p class="sr-only" aria-live="polite" aria-atomic="true">{{ resultAnnouncement }}</p>
          </ClientOnly>

          <div v-if="threadsStatus === 'idle' || threadsStatus === 'pending'" class="forum-list-loading" aria-label="Ładowanie tematów">
            <div v-for="index in 6" :key="index" class="forum-list-loading__item">
              <USkeleton class="h-4 w-4/5" />
              <USkeleton class="h-3 w-2/5" />
              <USkeleton class="h-10 w-full" />
              <USkeleton class="h-3 w-3/5" />
            </div>
          </div>

          <div v-else-if="threadsStatus === 'error'" class="forum-list-state" role="alert">
            <span class="forum-list-state__icon"><UIcon name="i-lucide-cloud-off" /></span>
            <h2>Nie udało się pobrać forum</h2>
            <p>{{ threadsError }}</p>
            <UButton color="neutral" variant="outline" icon="i-lucide-refresh-cw" @click="loadThreads()">
              Spróbuj ponownie
            </UButton>
          </div>

          <div v-else-if="!threadList.threads.length" class="forum-list-state">
            <span class="forum-list-state__icon">
              <UIcon :name="hasActiveFilters ? 'i-lucide-search-x' : 'i-lucide-messages-square'" />
            </span>
            <h2>{{ hasActiveFilters ? 'Nie znaleziono tematów' : 'Rozpocznij pierwszą rozmowę' }}</h2>
            <p>
              {{ hasActiveFilters
                ? (threadList.searchMode === 'hybrid'
                    ? 'Zmień zapytanie lub wyczyść część filtrów. Wyszukiwarka rozumie także pytania opisane własnymi słowami.'
                    : 'Zmień zapytanie, użyj krótszych słów kluczowych lub wyczyść część filtrów.')
                : 'Zadaj pytanie ekspertom albo rozpocznij dyskusję dla całej organizacji.' }}
            </p>
            <UButton
              v-if="hasActiveFilters"
              color="neutral"
              variant="outline"
              icon="i-lucide-filter-x"
              @click="resetFilters"
            >
              Wyczyść filtry
            </UButton>
            <UButton v-else icon="i-lucide-plus" @click="composerOpen = true">
              Dodaj temat
            </UButton>
          </div>

          <div v-else class="forum-thread-list" aria-label="Wyniki wyszukiwania forum">
            <ForumThreadCard
              v-for="(thread, index) in threadList.threads"
              :key="thread.id"
              :thread="thread"
              :selected="selectedThreadId === thread.id"
              :query="activeSearchQuery"
              :best-match="Boolean(activeSearchQuery && index === 0)"
              @select="selectThread"
            />

            <button type="button" class="forum-list-cta" @click="composerOpen = true">
              <span>Nie znalazłeś odpowiedzi? Zadaj nowe pytanie</span>
              <UIcon name="i-lucide-arrow-right" aria-hidden="true" />
            </button>
          </div>
        </aside>

        <section
          ref="detailPane"
          class="forum-detail-pane"
          aria-label="Wybrany wątek"
          tabindex="-1"
          @scroll.passive="handleDetailScroll"
        >
          <div v-if="!selectedThreadId" class="forum-detail-state">
            <span class="forum-detail-state__icon"><UIcon name="i-lucide-message-square-text" /></span>
            <h2>Wybierz temat</h2>
            <p>Pytanie, odpowiedzi ekspertów i stanowisko administracji pojawią się tutaj.</p>
            <UButton icon="i-lucide-plus" @click="composerOpen = true">
              Dodaj nowy temat
            </UButton>
          </div>

          <div v-else-if="detailStatus === 'idle' || detailStatus === 'pending'" class="forum-detail-loading" aria-label="Ładowanie wątku">
            <USkeleton class="h-3 w-2/5" />
            <USkeleton class="h-9 w-4/5" />
            <USkeleton class="h-4 w-1/2" />
            <USkeleton class="mt-4 h-28 w-full" />
            <USkeleton class="h-56 w-full" />
            <USkeleton class="h-36 w-full" />
          </div>

          <div v-else-if="detailStatus === 'error'" class="forum-detail-state" role="alert">
            <span class="forum-detail-state__icon"><UIcon name="i-lucide-message-circle-x" /></span>
            <h2>Nie udało się otworzyć wątku</h2>
            <p>{{ detailError }}</p>
            <div class="forum-detail-state__actions">
              <UButton color="neutral" variant="ghost" icon="i-lucide-arrow-left" @click="closeThread">
                Wróć do listy
              </UButton>
              <UButton color="neutral" variant="outline" icon="i-lucide-refresh-cw" @click="loadSelectedThread()">
                Spróbuj ponownie
              </UButton>
            </div>
          </div>

          <template v-else-if="selectedThread">
            <div v-if="unseenReplyCount" class="forum-new-replies" role="status">
              <UButton
                size="sm"
                icon="i-lucide-arrow-down"
                @click="revealNewReplies()"
              >
                {{ unseenReplyCount === 1 ? '1 nowa odpowiedź' : `${unseenReplyCount} nowe odpowiedzi` }}
              </UButton>
            </div>
            <ForumThreadDetail
              :thread="selectedThread"
              :posts="selectedPosts"
              :reply-endpoint="replyEndpoint"
              :categories="threadList.categories"
              :moderation="moderationAccess"
              :thread-moderation-endpoint="threadModerationEndpoint"
              :posts-moderation-endpoint="postsModerationEndpoint"
              @back="closeThread"
              @replied="handleReplyCreated"
              @moderated="handleModerated"
            />
          </template>
        </section>
      </section>
    </CrmShell>

    <ForumNewThreadSlideover
      v-model:open="composerOpen"
      :endpoint="threadsEndpoint"
      :categories="threadList.categories"
      @created="handleThreadCreated"
      @select-similar="openSimilarThread"
    />

    <ForumCategoryManagerSlideover
      v-if="moderationContext.canModerate || moderationContext.canManageCategories"
      v-model:open="moderationPanelOpen"
      :endpoint="categoriesEndpoint"
      :items-endpoint="moderationItemsEndpoint"
      :threads-endpoint="threadsEndpoint"
      :posts-endpoint="postsModerationEndpoint"
      :can-moderate="moderationContext.canModerate"
      :can-manage-categories="moderationContext.canManageCategories"
      :initial-categories="threadList.categories"
      :realtime-revision="moderationRealtimeRevision"
      @changed="handleCategoriesChanged"
      @restored="handleModerated"
      @open-thread="openModeratedThread"
    />
  </div>
</template>

<style scoped>
.forum-page-root {
  min-width: 0;
  container-type: inline-size;
}

.forum-header-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}

.forum-browser {
  display: grid;
  grid-template-columns: minmax(330px, 430px) minmax(0, 1fr);
  height: min(850px, calc(100dvh - 236px));
  min-height: 640px;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background: var(--ui-bg);
}

.forum-list-pane {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  border-right: 1px solid var(--ui-border);
  background: var(--ui-bg-muted);
}

.forum-search-panel {
  display: grid;
  gap: 10px;
  padding: 14px;
  border-bottom: 1px solid var(--ui-border);
  background: var(--ui-bg);
}

.forum-search {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.forum-search__input {
  width: 100%;
}

.forum-search-mode {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--ui-text-muted);
  font-size: 10px;
}

.forum-realtime-status {
  display: flex;
  min-height: 20px;
  align-items: center;
  gap: 6px;
  color: var(--ui-text-muted);
  font-size: 10px;
}

.forum-realtime-status > :deep(svg) {
  width: 13px;
  height: 13px;
}

.forum-realtime-status--live > :deep(svg) {
  color: var(--ui-success);
}

.forum-realtime-status--polling > :deep(svg) {
  color: var(--ui-primary);
}

.forum-realtime-status--connecting > :deep(svg) {
  color: var(--ui-warning);
  animation: forum-realtime-spin 1.1s linear infinite;
}

.forum-realtime-status--offline {
  color: var(--ui-warning);
}

.forum-realtime-status__updated {
  color: var(--ui-success);
  font-weight: 600;
}

.forum-realtime-status--pulse > :deep(svg) {
  animation: forum-realtime-pulse 700ms ease-out;
}

@keyframes forum-realtime-spin {
  to { transform: rotate(360deg); }
}

@keyframes forum-realtime-pulse {
  50% { transform: scale(1.22); }
}

.forum-search-validation {
  margin: -2px 0 0;
  color: var(--ui-error);
  font-size: 11px;
  line-height: 1.4;
}

.forum-search-mode > :deep(svg) {
  width: 14px;
  height: 14px;
  color: var(--ui-warning);
}

.forum-filters {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.forum-filters > :deep(button) {
  width: 100%;
}

.forum-list-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 14px;
  border-bottom: 1px solid var(--ui-border);
  color: var(--ui-text-muted);
  background: var(--ui-bg);
  font-size: 10px;
}

.forum-list-summary > div {
  display: grid;
  gap: 1px;
}

.forum-list-summary strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
}

.forum-list-loading {
  display: grid;
  min-height: 0;
  gap: 8px;
  padding: 10px;
  overflow: hidden;
}

.forum-list-loading__item {
  display: grid;
  gap: 9px;
  padding: 15px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  background: var(--ui-bg);
}

.forum-thread-list {
  display: grid;
  flex: 1 1 auto;
  min-height: 0;
  align-content: start;
  gap: 8px;
  padding: 10px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.forum-list-cta {
  display: flex;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 10px 14px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  color: var(--ui-text-muted);
  background: var(--ui-bg);
  font-size: 11px;
  cursor: pointer;
}

.forum-list-cta:hover {
  color: var(--ui-text-highlighted);
  background: var(--ui-bg-elevated);
}

.forum-list-cta:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 2px;
}

.forum-list-state,
.forum-detail-state {
  display: flex;
  flex: 1 1 auto;
  min-height: 300px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 34px 24px;
  text-align: center;
}

.forum-list-state__icon,
.forum-detail-state__icon {
  display: grid;
  place-items: center;
  width: 60px;
  height: 60px;
  margin-bottom: 16px;
  border: 1px solid var(--ui-border);
  border-radius: 18px;
  color: var(--ui-text-dimmed);
  background: var(--ui-bg);
}

.forum-list-state__icon :deep(svg),
.forum-detail-state__icon :deep(svg) {
  width: 26px;
  height: 26px;
}

.forum-list-state h2,
.forum-detail-state h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 18px;
  font-weight: 620;
}

.forum-list-state p,
.forum-detail-state p {
  max-width: 390px;
  margin: 9px 0 18px;
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.55;
}

.forum-detail-state__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}

.forum-detail-pane {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  background: var(--ui-bg-muted);
}

.forum-new-replies {
  position: sticky;
  top: 12px;
  z-index: 20;
  display: flex;
  height: 0;
  justify-content: center;
  transform: translateY(12px);
  pointer-events: none;
}

.forum-new-replies > :deep(button) {
  box-shadow: var(--ui-shadow-lg);
  pointer-events: auto;
}

.forum-detail-loading {
  display: grid;
  gap: 14px;
  padding: 32px;
}

@container (max-width: 900px) {
  .forum-browser {
    grid-template-columns: minmax(0, 1fr);
  }

  .forum-list-pane {
    border-right: 0;
  }

  .forum-detail-pane {
    display: none;
  }

  .forum-browser--thread-open .forum-list-pane {
    display: none;
  }

  .forum-browser--thread-open .forum-detail-pane {
    display: block;
  }
}

@media (max-width: 680px) {
  .forum-browser {
    height: calc(100dvh - 210px);
    min-height: 560px;
    border-radius: var(--oe-radius-control);
  }

  .forum-search {
    grid-template-columns: minmax(0, 1fr);
  }

  .forum-search > :deep(button[type="submit"]) {
    width: 100%;
    justify-content: center;
  }

  .forum-filters {
    grid-template-columns: minmax(0, 1fr);
  }

  .forum-list-summary {
    align-items: flex-start;
    flex-direction: column;
  }

  .forum-detail-loading {
    padding: 20px 16px;
  }
}
</style>
