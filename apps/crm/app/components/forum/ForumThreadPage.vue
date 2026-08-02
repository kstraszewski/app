<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type {
  ForumCategory,
  ForumCreateReplyPayload,
  ForumCreateThreadPayload,
  ForumRealtimeEvent,
  ForumThreadDetailPayload,
  ForumThreadListPayload,
  ForumThreadStatus,
  ForumThreadSummary,
} from '#shared/types/forum'
import { apiErrorMessage } from '~/utils/api-error'

const props = defineProps<{
  threadId: string
}>()

interface ForumCategoriesPayload {
  categories: ForumCategory[]
}

const requestFetch = useRequestFetch()
const { organizationSlug, orgApiPath } = useOrganizationContext()
const {
  access: moderationAccess,
  canAccessModeration,
  roleLabel: moderatorRoleLabel,
  status: moderationContextStatus,
} = useForumModerationContext()
const rootElement = ref<HTMLElement | null>(null)
const detailPayload = ref<ForumThreadDetailPayload | null>(null)
const detailStatus = ref<'idle' | 'pending' | 'success' | 'error'>('idle')
const detailError = ref('')
const categories = ref<ForumCategory[]>([])
const relatedThreads = ref<ForumThreadSummary[]>([])
const relatedStatus = ref<'idle' | 'pending' | 'success' | 'error'>('idle')
const composerOpen = ref(false)
const unseenReplyCount = ref(0)
let detailController: AbortController | null = null
let categoriesController: AbortController | null = null
let relatedController: AbortController | null = null

const forumBasePath = computed(() => (
  `/org/${encodeURIComponent(organizationSlug.value)}/forum`
))
const threadsEndpoint = computed(() => orgApiPath('/forum/threads'))
const categoriesEndpoint = computed(() => orgApiPath('/forum/categories'))
const postsModerationEndpoint = computed(() => orgApiPath('/forum/posts'))
const moderationPath = computed(() => `${forumBasePath.value}/moderation`)
const threadEndpoint = computed(() => (
  orgApiPath(`/forum/threads/${encodeURIComponent(props.threadId)}`)
))
const replyEndpoint = computed(() => `${threadEndpoint.value}/replies`)
const threadModerationEndpoint = computed(() => `${threadEndpoint.value}/moderation`)
const realtimeStateEndpoint = computed(() => orgApiPath('/forum/realtime'))
const realtimeTokenEndpoint = computed(() => orgApiPath('/forum/realtime/token'))
const selectedThread = computed(() => detailPayload.value?.thread ?? null)
const selectedPosts = computed(() => (
  detailPayload.value?.posts
  ?? detailPayload.value?.thread.posts
  ?? []
))
const categoryPath = computed(() => {
  const category = selectedThread.value?.category
  return category
    ? `${forumBasePath.value}/categories/${encodeURIComponent(category.slug)}`
    : forumBasePath.value
})
const pageTabs = computed(() => {
  const tabs: Array<{
    label: string
    to: RouteLocationRaw
    icon: string
    exact?: boolean
  }> = [{
    label: 'Wszystkie wątki',
    to: forumBasePath.value,
    icon: 'i-lucide-messages-square',
    exact: true,
  }]
  if (selectedThread.value?.category) {
    tabs.push({
      label: selectedThread.value.category.name,
      to: categoryPath.value,
      icon: selectedThread.value.category.icon || 'i-lucide-folder',
    })
  }
  if (canAccessModeration.value) {
    tabs.push({
      label: 'Moderacja',
      to: moderationPath.value,
      icon: 'i-lucide-shield-check',
    })
  }
  return tabs
})
const initialCategoryId = computed(() => selectedThread.value?.category.id || '')
const statusPresentation: Record<ForumThreadStatus, { label: string, icon: string, color: 'success' | 'warning' | 'neutral' }> = {
  open: { label: 'Otwarte', icon: 'i-lucide-circle-dot', color: 'warning' },
  answered: { label: 'Odpowiedziane', icon: 'i-lucide-message-circle-check', color: 'success' },
  resolved: { label: 'Rozwiązane', icon: 'i-lucide-circle-check', color: 'success' },
  closed: { label: 'Zamknięte', icon: 'i-lucide-lock-keyhole', color: 'neutral' },
}
const selectedStatus = computed(() => (
  selectedThread.value ? statusPresentation[selectedThread.value.status] : null
))

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

useHead({
  title: computed(() => (
    selectedThread.value?.title
      ? `${selectedThread.value.title} — Forum ekspertów — OpenExpert CRM`
      : 'Wątek forum ekspertów — OpenExpert CRM'
  )),
})

watch(() => props.threadId, () => {
  detailPayload.value = null
  relatedThreads.value = []
  unseenReplyCount.value = 0
  if (import.meta.client) void initialize()
})

watch(organizationSlug, () => {
  detailPayload.value = null
  categories.value = []
  relatedThreads.value = []
  if (import.meta.client) void initialize()
})

onMounted(() => {
  void initialize()
})

onBeforeUnmount(() => {
  detailController?.abort()
  categoriesController?.abort()
  relatedController?.abort()
})

async function initialize(): Promise<void> {
  const [threadLoaded] = await Promise.all([
    loadThread(),
    loadCategories(),
  ])
  if (threadLoaded) await loadRelatedThreads()
}

async function loadThread(options: { preserveContent?: boolean } = {}): Promise<boolean> {
  detailController?.abort()
  const controller = new AbortController()
  detailController = controller
  const preserveContent = options.preserveContent === true && Boolean(detailPayload.value)
  if (!preserveContent) detailStatus.value = 'pending'
  detailError.value = ''

  try {
    const payload = await requestFetch<ForumThreadDetailPayload>(threadEndpoint.value, {
      signal: controller.signal,
    })
    if (detailController !== controller) return false
    detailPayload.value = payload
    detailStatus.value = 'success'
    return true
  } catch (error) {
    if (controller.signal.aborted) return false
    detailError.value = apiErrorMessage(error)
    const inaccessible = [403, 404].includes(apiStatusCode(error) ?? 0)
    if (!preserveContent || inaccessible) {
      if (inaccessible) detailPayload.value = null
      detailStatus.value = 'error'
    }
    return inaccessible
  } finally {
    if (detailController === controller) detailController = null
  }
}

async function loadCategories(): Promise<boolean> {
  categoriesController?.abort()
  const controller = new AbortController()
  categoriesController = controller
  try {
    const payload = await requestFetch<ForumCategoriesPayload>(categoriesEndpoint.value, {
      signal: controller.signal,
    })
    if (categoriesController !== controller) return false
    categories.value = payload.categories.filter(category => category.isActive !== false)
    return true
  } catch (error) {
    return false
  } finally {
    if (categoriesController === controller) categoriesController = null
  }
}

async function loadRelatedThreads(): Promise<boolean> {
  const categoryId = selectedThread.value?.category.id
  if (!categoryId) {
    relatedThreads.value = []
    relatedStatus.value = 'success'
    return true
  }

  relatedController?.abort()
  const controller = new AbortController()
  relatedController = controller
  relatedStatus.value = relatedThreads.value.length ? 'success' : 'pending'
  try {
    const payload = await requestFetch<ForumThreadListPayload>(threadsEndpoint.value, {
      query: { category: categoryId, limit: 7 },
      signal: controller.signal,
    })
    if (relatedController !== controller) return false
    relatedThreads.value = payload.threads
      .filter(thread => thread.id !== props.threadId)
      .slice(0, 5)
    relatedStatus.value = 'success'
    return true
  } catch (error) {
    if (!controller.signal.aborted && !relatedThreads.value.length) relatedStatus.value = 'error'
    return false
  } finally {
    if (relatedController === controller) relatedController = null
  }
}

function pageIsNearBottom(): boolean {
  if (!import.meta.client) return true
  const documentHeight = Math.max(
    document.documentElement.scrollHeight,
    document.body.scrollHeight,
  )
  return window.scrollY + window.innerHeight >= documentHeight - 220
}

async function revealNewReplies(behavior: ScrollBehavior = 'smooth'): Promise<void> {
  unseenReplyCount.value = 0
  await nextTick()
  rootElement.value?.querySelector<HTMLElement>('.forum-reply-composer')?.scrollIntoView({
    behavior,
    block: 'end',
  })
}

async function handleRealtimeChange(event: ForumRealtimeEvent | null): Promise<void> {
  if (event?.threadId && event.threadId !== props.threadId) return
  const replyCountBefore = selectedPosts.value.filter(post => post.kind === 'reply').length
  const wasNearBottom = pageIsNearBottom()
  const updated = await loadThread({ preserveContent: true })
  if (!updated) throw new Error('Forum thread synchronization will be retried')
  if (event?.kind === 'category.created' || event?.kind === 'category.updated') {
    await loadCategories()
  }
  await loadRelatedThreads()

  const replyCountAfter = selectedPosts.value.filter(post => post.kind === 'reply').length
  const addedReplies = Math.max(0, replyCountAfter - replyCountBefore)
  if (!addedReplies) return
  if (wasNearBottom) await revealNewReplies('smooth')
  else unseenReplyCount.value += addedReplies
}

async function handleReplyCreated(_payload: ForumCreateReplyPayload): Promise<void> {
  await loadThread({ preserveContent: true })
  await loadRelatedThreads()
  await revealNewReplies('smooth')
}

async function handleModerated(): Promise<void> {
  await Promise.all([
    loadThread({ preserveContent: true }),
    loadCategories(),
  ])
  await loadRelatedThreads()
}

async function handleThreadCreated(payload: ForumCreateThreadPayload): Promise<void> {
  composerOpen.value = false
  await navigateTo(`${forumBasePath.value}/threads/${encodeURIComponent(payload.thread.id)}`)
}

async function openSimilarThread(thread: ForumThreadSummary): Promise<void> {
  composerOpen.value = false
  await navigateTo(`${forumBasePath.value}/threads/${encodeURIComponent(thread.id)}`)
}

async function goBack(): Promise<void> {
  await navigateTo(categoryPath.value)
}
</script>

<template>
  <div ref="rootElement" class="forum-thread-page">
    <CrmShell
      title="Forum ekspertów"
      eyebrow="Wiedza organizacji"
      description="Osobna przestrzeń rozmowy — z pełnym kontekstem, odpowiedziami ekspertów i stałym adresem."
      :back-to="categoryPath"
      :back-label="selectedThread?.category.name || 'Wszystkie wątki'"
      :tabs="pageTabs"
    >
      <template #actions>
        <div class="forum-thread-page__actions">
          <span
            class="forum-thread-realtime"
            :class="[
              `forum-thread-realtime--${realtimeStatus.tone}`,
              { 'forum-thread-realtime--pulse': realtimePulse },
            ]"
            role="status"
            aria-live="polite"
          >
            <UIcon :name="realtimeStatus.icon" aria-hidden="true" />
            {{ realtimePulse ? 'Zaktualizowano teraz' : realtimeStatus.label }}
          </span>
          <UBadge
            v-if="canAccessModeration && moderatorRoleLabel"
            color="warning"
            variant="subtle"
            icon="i-lucide-shield-check"
          >
            {{ moderatorRoleLabel }}
          </UBadge>
          <UButton icon="i-lucide-plus" @click="composerOpen = true">
            Nowy temat
          </UButton>
        </div>
      </template>

      <UAlert
        v-if="moderationContextStatus === 'error'"
        role="alert"
        class="mb-4"
        color="warning"
        variant="subtle"
        icon="i-lucide-shield-alert"
        title="Narzędzia moderacji są chwilowo niedostępne"
        description="Treść wątku i odpowiedzi pozostają dostępne."
      />

      <div v-if="detailStatus === 'idle' || detailStatus === 'pending'" class="forum-thread-loading" aria-label="Ładowanie wątku">
        <div>
          <USkeleton class="h-4 w-2/5" />
          <USkeleton class="h-10 w-4/5" />
          <USkeleton class="h-4 w-1/2" />
          <USkeleton class="h-32 w-full" />
          <USkeleton class="h-64 w-full" />
        </div>
        <USkeleton class="h-80 w-full" />
      </div>

      <section v-else-if="detailStatus === 'error'" class="forum-thread-state" role="alert">
        <span><UIcon name="i-lucide-message-circle-x" aria-hidden="true" /></span>
        <h2>Nie udało się otworzyć wątku</h2>
        <p>{{ detailError }}</p>
        <div>
          <UButton :to="forumBasePath" color="neutral" variant="ghost" icon="i-lucide-arrow-left">
            Wróć do forum
          </UButton>
          <UButton color="neutral" variant="outline" icon="i-lucide-refresh-cw" @click="loadThread()">
            Spróbuj ponownie
          </UButton>
        </div>
      </section>

      <div v-else-if="selectedThread" class="forum-thread-layout">
        <main class="forum-thread-layout__conversation">
          <div v-if="unseenReplyCount" class="forum-thread-new-replies" role="status">
            <UButton size="sm" icon="i-lucide-arrow-down" @click="revealNewReplies()">
              {{ unseenReplyCount === 1 ? '1 nowa odpowiedź' : `${unseenReplyCount} nowe odpowiedzi` }}
            </UButton>
          </div>
          <ForumThreadDetail
            :thread="selectedThread"
            :posts="selectedPosts"
            :reply-endpoint="replyEndpoint"
            :categories="categories"
            :moderation="moderationAccess"
            :thread-moderation-endpoint="threadModerationEndpoint"
            :posts-moderation-endpoint="postsModerationEndpoint"
            :forum-base-path="forumBasePath"
            @back="goBack"
            @replied="handleReplyCreated"
            @moderated="handleModerated"
          />
        </main>

        <aside class="forum-thread-layout__aside" aria-label="Kontekst wątku">
          <section class="forum-thread-context">
            <span class="forum-thread-context__eyebrow">Kontekst</span>
            <NuxtLink :to="categoryPath" class="forum-thread-category-link">
              <span><UIcon :name="selectedThread.category.icon || 'i-lucide-folder'" aria-hidden="true" /></span>
              <span>
                <small>Kategoria</small>
                <strong>{{ selectedThread.category.name }}</strong>
              </span>
              <UIcon name="i-lucide-arrow-up-right" aria-hidden="true" />
            </NuxtLink>
            <dl class="forum-thread-context__stats">
              <div>
                <dt>Odpowiedzi</dt>
                <dd>{{ selectedThread.replyCount }}</dd>
              </div>
              <div>
                <dt>Uczestnicy</dt>
                <dd>{{ selectedThread.participantCount || 1 }}</dd>
              </div>
              <div>
                <dt>Wyświetlenia</dt>
                <dd>{{ selectedThread.viewCount || 0 }}</dd>
              </div>
            </dl>
            <div v-if="selectedStatus" class="forum-thread-context__status">
              <UBadge :color="selectedStatus.color" variant="subtle" :icon="selectedStatus.icon">
                {{ selectedStatus.label }}
              </UBadge>
              <span v-if="selectedThread.hasVerifiedExpertAnswer">
                <UIcon name="i-lucide-badge-check" aria-hidden="true" />
                Odpowiedź eksperta
              </span>
              <span v-if="selectedThread.hasOfficialAdminAnswer">
                <UIcon name="i-lucide-shield-check" aria-hidden="true" />
                Stanowisko administracji
              </span>
            </div>
          </section>

          <section class="forum-thread-related" aria-labelledby="forum-related-heading">
            <span class="forum-thread-context__eyebrow">Z tej kategorii</span>
            <h3 id="forum-related-heading">Podobne rozmowy</h3>
            <div v-if="relatedStatus === 'idle' || relatedStatus === 'pending'" class="forum-thread-related__loading">
              <USkeleton v-for="index in 3" :key="index" class="h-16 w-full" />
            </div>
            <p v-else-if="relatedStatus === 'error'" class="forum-thread-related__empty">
              Nie udało się teraz pobrać podobnych rozmów.
            </p>
            <p v-else-if="!relatedThreads.length" class="forum-thread-related__empty">
              To jedyny aktualny wątek w tej kategorii.
            </p>
            <nav v-else aria-label="Podobne rozmowy">
              <NuxtLink
                v-for="thread in relatedThreads"
                :key="thread.id"
                :to="`${forumBasePath}/threads/${encodeURIComponent(thread.id)}`"
              >
                <span>{{ thread.title }}</span>
                <small>{{ thread.replyCount }} odpowiedzi · {{ thread.status === 'resolved' ? 'rozwiązany' : 'aktywny' }}</small>
              </NuxtLink>
            </nav>
            <UButton :to="categoryPath" color="neutral" variant="ghost" trailing-icon="i-lucide-arrow-right" block>
              Wszystkie w kategorii
            </UButton>
          </section>

          <section class="forum-thread-search-card">
            <span><UIcon name="i-lucide-sparkles" aria-hidden="true" /></span>
            <h3>Sprawdź inne odpowiedzi</h3>
            <p>Wyszukiwanie wektorowe znajdzie podobne problemy, nawet jeśli zostały opisane innymi słowami.</p>
            <UButton :to="forumBasePath" color="neutral" variant="outline" icon="i-lucide-search" block>
              Przeszukaj forum
            </UButton>
          </section>
        </aside>
      </div>
    </CrmShell>

    <ForumNewThreadSlideover
      v-model:open="composerOpen"
      :endpoint="threadsEndpoint"
      :categories="categories"
      :initial-category-id="initialCategoryId"
      @created="handleThreadCreated"
      @select-similar="openSimilarThread"
    />
  </div>
</template>

<style scoped>
.forum-thread-page {
  min-width: 0;
  container-type: inline-size;
}

.forum-thread-page__actions,
.forum-thread-realtime {
  display: flex;
  align-items: center;
}

.forum-thread-page__actions {
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}

.forum-thread-realtime {
  gap: 6px;
  color: var(--ui-text-muted);
  font-size: 10px;
}

.forum-thread-realtime :deep(svg) {
  width: 13px;
  height: 13px;
}

.forum-thread-realtime--live :deep(svg) {
  color: var(--ui-success);
}

.forum-thread-realtime--polling :deep(svg) {
  color: var(--ui-primary);
}

.forum-thread-realtime--connecting :deep(svg) {
  color: var(--ui-warning);
  animation: forum-thread-spin 1.1s linear infinite;
}

.forum-thread-realtime--offline {
  color: var(--ui-warning);
}

.forum-thread-realtime--pulse :deep(svg) {
  animation: forum-thread-pulse 700ms ease-out;
}

@keyframes forum-thread-spin {
  to { transform: rotate(360deg); }
}

@keyframes forum-thread-pulse {
  50% { transform: scale(1.22); }
}

.forum-thread-loading,
.forum-thread-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  align-items: start;
  gap: 24px;
}

.forum-thread-loading > div:first-child {
  display: grid;
  gap: 14px;
  padding: 28px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
}

.forum-thread-layout__conversation {
  position: relative;
  min-width: 0;
  overflow: clip;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background: var(--ui-bg-muted);
}

.forum-thread-layout__conversation :deep(.forum-detail) {
  padding: 28px;
}

.forum-thread-new-replies {
  position: sticky;
  top: 12px;
  z-index: 20;
  display: flex;
  height: 0;
  justify-content: center;
  transform: translateY(12px);
  pointer-events: none;
}

.forum-thread-new-replies > :deep(button) {
  box-shadow: var(--ui-shadow-lg);
  pointer-events: auto;
}

.forum-thread-layout__aside {
  position: sticky;
  top: 18px;
  display: grid;
  gap: 10px;
}

.forum-thread-context,
.forum-thread-related,
.forum-thread-search-card {
  display: grid;
  gap: 11px;
  padding: 17px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  background: var(--ui-bg);
}

.forum-thread-context__eyebrow {
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 650;
  letter-spacing: .05em;
  text-transform: uppercase;
}

.forum-thread-category-link {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border-radius: 9px;
  color: var(--ui-text);
  background: var(--ui-bg-muted);
  text-decoration: none;
}

.forum-thread-category-link > span:first-child {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  color: var(--ui-primary);
  background: color-mix(in srgb, var(--ui-primary) 10%, var(--ui-bg));
}

.forum-thread-category-link > span:nth-child(2) {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.forum-thread-category-link small {
  color: var(--ui-text-dimmed);
  font-size: 8px;
}

.forum-thread-category-link strong {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.forum-thread-category-link > :deep(svg:last-child) {
  color: var(--ui-text-dimmed);
}

.forum-thread-category-link:hover {
  background: var(--ui-bg-elevated);
}

.forum-thread-category-link:focus-visible,
.forum-thread-related a:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 2px;
}

.forum-thread-context__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin: 0;
  padding-block: 11px;
  border-block: 1px solid var(--ui-border-muted);
}

.forum-thread-context__stats > div {
  display: grid;
  gap: 2px;
  text-align: center;
}

.forum-thread-context__stats dt {
  color: var(--ui-text-dimmed);
  font-size: 8px;
}

.forum-thread-context__stats dd {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 650;
}

.forum-thread-context__status {
  display: flex;
  align-items: flex-start;
  flex-direction: column;
  gap: 7px;
}

.forum-thread-context__status > span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ui-text-muted);
  font-size: 9px;
}

.forum-thread-context__status > span :deep(svg) {
  width: 13px;
  height: 13px;
  color: var(--ui-success);
}

.forum-thread-related h3,
.forum-thread-search-card h3 {
  margin: -5px 0 0;
  color: var(--ui-text-highlighted);
  font-size: 14px;
  font-weight: 620;
}

.forum-thread-related nav,
.forum-thread-related__loading {
  display: grid;
  gap: 3px;
}

.forum-thread-related nav a {
  display: grid;
  gap: 3px;
  padding: 9px;
  border-radius: 8px;
  color: var(--ui-text);
  text-decoration: none;
}

.forum-thread-related nav a:hover {
  background: var(--ui-bg-muted);
}

.forum-thread-related nav span {
  display: -webkit-box;
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 10px;
  font-weight: 600;
  line-height: 1.4;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.forum-thread-related nav small,
.forum-thread-related__empty {
  color: var(--ui-text-dimmed);
  font-size: 8px;
}

.forum-thread-related__empty {
  margin: 0;
  line-height: 1.5;
}

.forum-thread-search-card {
  background:
    radial-gradient(circle at 100% 0, color-mix(in srgb, var(--ui-primary) 11%, transparent), transparent 48%),
    var(--ui-bg-muted);
}

.forum-thread-search-card > span {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 11px;
  color: var(--ui-primary);
  background: color-mix(in srgb, var(--ui-primary) 10%, var(--ui-bg));
}

.forum-thread-search-card p {
  margin: -4px 0 2px;
  color: var(--ui-text-muted);
  font-size: 9px;
  line-height: 1.55;
}

.forum-thread-state {
  display: flex;
  min-height: 380px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 36px 24px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background: var(--ui-bg-muted);
  text-align: center;
}

.forum-thread-state > span {
  display: grid;
  place-items: center;
  width: 58px;
  height: 58px;
  margin-bottom: 14px;
  border: 1px solid var(--ui-border);
  border-radius: 17px;
  color: var(--ui-text-dimmed);
  background: var(--ui-bg);
}

.forum-thread-state h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 18px;
}

.forum-thread-state p {
  max-width: 440px;
  margin: 8px 0 18px;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.5;
}

.forum-thread-state > div {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}

@container (max-width: 1040px) {
  .forum-thread-loading,
  .forum-thread-layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .forum-thread-layout__aside {
    position: static;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .forum-thread-layout__conversation {
    border-radius: var(--oe-radius-control);
  }

  .forum-thread-layout__conversation :deep(.forum-detail) {
    padding: 18px 15px 28px;
  }

  .forum-thread-layout__aside {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 520px) {
  .forum-thread-page__actions {
    justify-content: flex-start;
  }
}

@media (prefers-reduced-motion: reduce) {
  .forum-thread-realtime--connecting :deep(svg),
  .forum-thread-realtime--pulse :deep(svg) {
    animation: none;
  }
}
</style>
