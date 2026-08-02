<script setup lang="ts">
import type { ForumCategory, ForumRealtimeEvent } from '#shared/types/forum'
import { apiErrorMessage } from '~/utils/api-error'

definePageMeta({ middleware: ['auth', 'organization'] })
useHead({ title: 'Moderacja forum ekspertów — OpenExpert CRM' })

interface ForumCategoriesPayload {
  categories: ForumCategory[]
}

interface ForumHiddenContentPayload {
  total: number
}

const route = useRoute()
const router = useRouter()
const requestFetch = useRequestFetch()
const { organizationSlug, orgApiPath } = useOrganizationContext()
const {
  canAccessModeration,
  context: moderationContext,
  load: loadModerationContext,
  roleLabel: moderatorRoleLabel,
  status: moderationContextStatus,
} = useForumModerationContext()
const categories = ref<ForumCategory[]>([])
const hiddenTotal = ref(0)
const overviewStatus = ref<'idle' | 'pending' | 'success' | 'error'>('idle')
const overviewError = ref('')
const managerOpen = ref(false)
const managerSection = ref<'hidden' | 'categories'>('hidden')
const realtimeRevision = ref(0)
let overviewController: AbortController | null = null

const forumBasePath = computed(() => (
  `/org/${encodeURIComponent(organizationSlug.value)}/forum`
))
const categoriesEndpoint = computed(() => orgApiPath('/forum/categories'))
const moderationItemsEndpoint = computed(() => orgApiPath('/forum/moderation/items'))
const threadsEndpoint = computed(() => orgApiPath('/forum/threads'))
const postsEndpoint = computed(() => orgApiPath('/forum/posts'))
const realtimeStateEndpoint = computed(() => orgApiPath('/forum/realtime'))
const realtimeTokenEndpoint = computed(() => orgApiPath('/forum/realtime/token'))
const activeCategories = computed(() => categories.value.filter(category => category.isActive !== false))
const inactiveCategories = computed(() => categories.value.filter(category => category.isActive === false))
const pageTabs = computed(() => [{
  label: 'Wszystkie wątki',
  to: forumBasePath.value,
  icon: 'i-lucide-messages-square',
  exact: true,
}, {
  label: 'Moderacja',
  to: `${forumBasePath.value}/moderation`,
  icon: 'i-lucide-shield-check',
  active: true,
}])

function threadCountLabel(count: number): string {
  if (count === 1) return 'wątek'
  const lastTwoDigits = count % 100
  return count % 10 >= 2 && count % 10 <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14)
    ? 'wątki'
    : 'wątków'
}

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
  () => route.query.tab,
  (tab) => {
    if (tab !== 'hidden' && tab !== 'categories') return
    managerSection.value = tab
    managerOpen.value = true
  },
  { immediate: true },
)

watch(managerOpen, (open) => {
  if (open || !route.query.tab) return
  const query = { ...route.query }
  delete query.tab
  void router.replace({ path: route.path, query })
})

watch(moderationContextStatus, (status) => {
  if (status === 'success' && canAccessModeration.value) void loadOverview()
})

watch(organizationSlug, () => {
  categories.value = []
  hiddenTotal.value = 0
  if (import.meta.client) void loadOverview()
})

onMounted(() => {
  if (canAccessModeration.value) void loadOverview()
})

onBeforeUnmount(() => overviewController?.abort())

async function loadOverview(): Promise<boolean> {
  overviewController?.abort()
  const controller = new AbortController()
  overviewController = controller
  overviewStatus.value = 'pending'
  overviewError.value = ''
  try {
    const [categoryPayload, hiddenPayload] = await Promise.all([
      requestFetch<ForumCategoriesPayload>(categoriesEndpoint.value, {
        signal: controller.signal,
      }),
      moderationContext.value.canModerate
        ? requestFetch<ForumHiddenContentPayload>(moderationItemsEndpoint.value, {
            query: { limit: 1 },
            signal: controller.signal,
          })
        : Promise.resolve({ total: 0 }),
    ])
    if (overviewController !== controller) return false
    categories.value = categoryPayload.categories
      .sort((left, right) => (
        (left.sortOrder ?? 100) - (right.sortOrder ?? 100)
        || left.name.localeCompare(right.name, 'pl')
      ))
    hiddenTotal.value = hiddenPayload.total
    overviewStatus.value = 'success'
    return true
  } catch (error) {
    if (controller.signal.aborted) return false
    overviewError.value = apiErrorMessage(error)
    overviewStatus.value = 'error'
    return false
  } finally {
    if (overviewController === controller) overviewController = null
  }
}

async function openManager(section: 'hidden' | 'categories'): Promise<void> {
  managerSection.value = section
  managerOpen.value = true
  await router.replace({
    path: route.path,
    query: { ...route.query, tab: section },
  })
}

async function handleRealtimeChange(_event: ForumRealtimeEvent | null): Promise<void> {
  realtimeRevision.value += 1
  if (!canAccessModeration.value) return
  const updated = await loadOverview()
  if (!updated) throw new Error('Forum moderation synchronization will be retried')
}

async function handleManagerChanged(): Promise<void> {
  await loadOverview()
}

async function openThread(threadId: string): Promise<void> {
  managerOpen.value = false
  await navigateTo(`${forumBasePath.value}/threads/${encodeURIComponent(threadId)}`)
}
</script>

<template>
  <div class="forum-moderation-page">
    <CrmShell
      title="Moderacja forum"
      eyebrow="Administracja wiedzą"
      description="Dbaj o jakość rozmów, przywracaj ukryte treści i porządkuj kategorie forum."
      :back-to="forumBasePath"
      back-label="Wróć do forum"
      :tabs="pageTabs"
    >
      <template #actions>
        <div class="forum-moderation-page__actions">
          <span
            class="forum-moderation-realtime"
            :class="[
              `forum-moderation-realtime--${realtimeStatus.tone}`,
              { 'forum-moderation-realtime--pulse': realtimePulse },
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
          <UButton
            v-if="canAccessModeration"
            color="neutral"
            variant="outline"
            icon="i-lucide-refresh-cw"
            :loading="overviewStatus === 'pending'"
            @click="loadOverview()"
          >
            Odśwież
          </UButton>
        </div>
      </template>

      <div v-if="moderationContextStatus === 'idle' || moderationContextStatus === 'pending'" class="forum-moderation-loading" aria-label="Sprawdzanie uprawnień">
        <USkeleton class="h-36 w-full" />
        <USkeleton class="h-72 w-full" />
      </div>

      <section v-else-if="moderationContextStatus === 'error'" class="forum-moderation-denied" role="alert">
        <span><UIcon name="i-lucide-shield-alert" aria-hidden="true" /></span>
        <h2>Nie udało się sprawdzić uprawnień</h2>
        <p>Połączenie z usługą moderacji nie powiodło się. Spróbuj ponownie, aby bezpiecznie otworzyć panel.</p>
        <div class="forum-moderation-denied__actions">
          <UButton color="neutral" variant="outline" icon="i-lucide-refresh-cw" @click="loadModerationContext()">
            Spróbuj ponownie
          </UButton>
          <UButton :to="forumBasePath" color="neutral" variant="ghost" icon="i-lucide-arrow-left">
            Wróć do forum
          </UButton>
        </div>
      </section>

      <section v-else-if="!canAccessModeration" class="forum-moderation-denied" role="alert">
        <span><UIcon name="i-lucide-shield-x" aria-hidden="true" /></span>
        <h2>Brak dostępu do moderacji</h2>
        <p>Ta podstrona jest dostępna wyłącznie dla moderatorów, administratorów forum i administratorów organizacji.</p>
        <UButton :to="forumBasePath" color="neutral" variant="outline" icon="i-lucide-arrow-left">
          Wróć do forum
        </UButton>
      </section>

      <template v-else>
        <UAlert
          v-if="overviewError"
          role="alert"
          class="mb-4"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          title="Nie udało się pobrać aktualnego stanu forum"
          :description="overviewError"
          :actions="[{ label: 'Spróbuj ponownie', onClick: () => loadOverview() }]"
        />

        <section class="forum-moderation-summary" aria-label="Stan moderacji forum">
          <div>
            <span class="forum-moderation-summary__icon forum-moderation-summary__icon--warning">
              <UIcon name="i-lucide-eye-off" aria-hidden="true" />
            </span>
            <span>
              <small>Kolejka moderacji</small>
              <strong>{{ hiddenTotal }}</strong>
              <span>{{ hiddenTotal === 1 ? 'ukryta treść' : 'ukrytych treści' }}</span>
            </span>
          </div>
          <div>
            <span class="forum-moderation-summary__icon">
              <UIcon name="i-lucide-folders" aria-hidden="true" />
            </span>
            <span>
              <small>Struktura forum</small>
              <strong>{{ activeCategories.length }}</strong>
              <span>aktywnych kategorii</span>
            </span>
          </div>
          <div>
            <span class="forum-moderation-summary__icon forum-moderation-summary__icon--success">
              <UIcon name="i-lucide-shield-check" aria-hidden="true" />
            </span>
            <span>
              <small>Uprawnienia</small>
              <strong>{{ moderationContext.canModerate && moderationContext.canManageCategories ? 'Pełne' : 'Zakresowe' }}</strong>
              <span>{{ moderatorRoleLabel }}</span>
            </span>
          </div>
        </section>

        <div class="forum-moderation-grid">
          <section class="forum-moderation-workspace-card">
            <div class="forum-moderation-workspace-card__heading">
              <span><UIcon name="i-lucide-message-square-warning" aria-hidden="true" /></span>
              <div>
                <small>Treści</small>
                <h2>Kolejka moderacji</h2>
                <p>Przejrzyj ukryte wątki i odpowiedzi razem z powodem oraz osobą wykonującą działanie.</p>
              </div>
            </div>
            <div class="forum-moderation-workspace-card__body">
              <div v-if="hiddenTotal" class="forum-moderation-attention">
                <UIcon name="i-lucide-bell-ring" aria-hidden="true" />
                <span>
                  <strong>{{ hiddenTotal }} {{ hiddenTotal === 1 ? 'pozycja wymaga' : 'pozycje wymagają' }} przeglądu</strong>
                  <small>Możesz otworzyć kontekst wątku lub bezpiecznie przywrócić treść.</small>
                </span>
              </div>
              <div v-else class="forum-moderation-clear">
                <UIcon name="i-lucide-circle-check" aria-hidden="true" />
                <span>
                  <strong>Kolejka jest pusta</strong>
                  <small>Brak ukrytych treści oczekujących na ponowną ocenę.</small>
                </span>
              </div>
            </div>
            <UButton
              v-if="moderationContext.canModerate"
              icon="i-lucide-eye-off"
              trailing-icon="i-lucide-arrow-right"
              @click="openManager('hidden')"
            >
              Otwórz kolejkę
            </UButton>
            <UAlert
              v-else
              color="neutral"
              variant="subtle"
              icon="i-lucide-lock-keyhole"
              title="Tylko zarządzanie kategoriami"
              description="Twoja rola nie obejmuje moderacji treści."
            />
          </section>

          <section class="forum-moderation-workspace-card">
            <div class="forum-moderation-workspace-card__heading">
              <span><UIcon name="i-lucide-folders" aria-hidden="true" /></span>
              <div>
                <small>Architektura wiedzy</small>
                <h2>Kategorie forum</h2>
                <p>Porządkuj obszary wiedzy, zmieniaj ich kolejność i wyłączaj kategorie bez usuwania historii.</p>
              </div>
            </div>
            <ul v-if="activeCategories.length" class="forum-moderation-categories" aria-label="Aktywne kategorie">
              <li v-for="category in activeCategories.slice(0, 5)" :key="category.id">
                <span><UIcon :name="category.icon || 'i-lucide-folder'" aria-hidden="true" /></span>
                <span>
                  <strong>{{ category.name }}</strong>
                  <small>{{ category.threadCount || 0 }} {{ threadCountLabel(category.threadCount || 0) }}</small>
                </span>
              </li>
              <li v-if="activeCategories.length > 5" class="forum-moderation-categories__more">
                + {{ activeCategories.length - 5 }} kolejnych kategorii
              </li>
            </ul>
            <p v-else class="forum-moderation-empty-categories">Nie ma jeszcze aktywnych kategorii.</p>
            <div v-if="inactiveCategories.length" class="forum-moderation-inactive">
              <UIcon name="i-lucide-folder-lock" aria-hidden="true" />
              {{ inactiveCategories.length }} {{ inactiveCategories.length === 1 ? 'kategoria nieaktywna' : 'kategorie nieaktywne' }}
            </div>
            <UButton
              v-if="moderationContext.canManageCategories"
              color="neutral"
              variant="outline"
              icon="i-lucide-settings-2"
              trailing-icon="i-lucide-arrow-right"
              @click="openManager('categories')"
            >
              Zarządzaj kategoriami
            </UButton>
            <UAlert
              v-else
              color="neutral"
              variant="subtle"
              icon="i-lucide-lock-keyhole"
              title="Kategorie tylko do odczytu"
              description="Twoja rola nie obejmuje zarządzania strukturą forum."
            />
          </section>
        </div>

        <section class="forum-moderation-principles" aria-labelledby="forum-moderation-principles-heading">
          <div>
            <span>Zasady pracy</span>
            <h2 id="forum-moderation-principles-heading">Moderacja, która chroni wiedzę</h2>
          </div>
          <ul>
            <li>
              <UIcon name="i-lucide-history" aria-hidden="true" />
              <span><strong>Pełna historia</strong><small>Każda zmiana ma autora, czas i powód.</small></span>
            </li>
            <li>
              <UIcon name="i-lucide-eye-off" aria-hidden="true" />
              <span><strong>Ukrywanie zamiast kasowania</strong><small>Treść można przywrócić bez utraty kontekstu.</small></span>
            </li>
            <li>
              <UIcon name="i-lucide-radio" aria-hidden="true" />
              <span><strong>Aktualizacje realtime</strong><small>Kolejka i kategorie odświeżają się bez F5.</small></span>
            </li>
          </ul>
        </section>
      </template>
    </CrmShell>

    <ForumCategoryManagerSlideover
      v-if="canAccessModeration"
      v-model:open="managerOpen"
      :endpoint="categoriesEndpoint"
      :items-endpoint="moderationItemsEndpoint"
      :threads-endpoint="threadsEndpoint"
      :posts-endpoint="postsEndpoint"
      :can-moderate="moderationContext.canModerate"
      :can-manage-categories="moderationContext.canManageCategories"
      :initial-categories="categories"
      :initial-section="managerSection"
      :realtime-revision="realtimeRevision"
      @changed="handleManagerChanged"
      @restored="handleManagerChanged"
      @open-thread="openThread"
    />
  </div>
</template>

<style scoped>
.forum-moderation-page {
  min-width: 0;
  container-type: inline-size;
}

.forum-moderation-page__actions,
.forum-moderation-realtime {
  display: flex;
  align-items: center;
}

.forum-moderation-page__actions {
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}

.forum-moderation-realtime {
  gap: 6px;
  color: var(--ui-text-muted);
  font-size: 10px;
}

.forum-moderation-realtime :deep(svg) {
  width: 13px;
  height: 13px;
}

.forum-moderation-realtime--live :deep(svg) {
  color: var(--ui-success);
}

.forum-moderation-realtime--polling :deep(svg) {
  color: var(--ui-primary);
}

.forum-moderation-realtime--connecting :deep(svg) {
  color: var(--ui-warning);
  animation: forum-moderation-spin 1.1s linear infinite;
}

.forum-moderation-realtime--offline {
  color: var(--ui-warning);
}

.forum-moderation-realtime--pulse :deep(svg) {
  animation: forum-moderation-pulse 700ms ease-out;
}

@keyframes forum-moderation-spin {
  to { transform: rotate(360deg); }
}

@keyframes forum-moderation-pulse {
  50% { transform: scale(1.22); }
}

.forum-moderation-loading {
  display: grid;
  gap: 16px;
}

.forum-moderation-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 22px;
}

.forum-moderation-summary > div {
  display: flex;
  align-items: center;
  gap: 13px;
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  background: var(--ui-bg);
}

.forum-moderation-summary__icon {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  flex: 0 0 42px;
  border-radius: 12px;
  color: var(--ui-primary);
  background: color-mix(in srgb, var(--ui-primary) 10%, var(--ui-bg));
}

.forum-moderation-summary__icon--warning {
  color: var(--ui-warning);
  background: color-mix(in srgb, var(--ui-warning) 10%, var(--ui-bg));
}

.forum-moderation-summary__icon--success {
  color: var(--ui-success);
  background: color-mix(in srgb, var(--ui-success) 10%, var(--ui-bg));
}

.forum-moderation-summary > div > span:last-child {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.forum-moderation-summary small,
.forum-moderation-summary > div > span:last-child > span {
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.forum-moderation-summary strong {
  color: var(--ui-text-highlighted);
  font-size: 18px;
  font-weight: 620;
}

.forum-moderation-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.forum-moderation-workspace-card {
  display: flex;
  min-width: 0;
  min-height: 390px;
  flex-direction: column;
  gap: 18px;
  padding: 22px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background: var(--ui-bg-muted);
}

.forum-moderation-workspace-card__heading {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 13px;
}

.forum-moderation-workspace-card__heading > span {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  color: var(--ui-primary);
  background: var(--ui-bg);
}

.forum-moderation-workspace-card__heading > div {
  display: grid;
  gap: 3px;
}

.forum-moderation-workspace-card__heading small {
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 8px;
  font-weight: 650;
  letter-spacing: .05em;
  text-transform: uppercase;
}

.forum-moderation-workspace-card h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 19px;
  font-weight: 620;
}

.forum-moderation-workspace-card__heading p {
  margin: 1px 0 0;
  color: var(--ui-text-muted);
  font-size: 10px;
  line-height: 1.55;
}

.forum-moderation-workspace-card__body {
  flex: 1 1 auto;
}

.forum-moderation-attention,
.forum-moderation-clear {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 14px;
  border: 1px solid color-mix(in srgb, var(--ui-warning) 35%, var(--ui-border));
  border-radius: 10px;
  color: var(--ui-warning);
  background: color-mix(in srgb, var(--ui-warning) 6%, var(--ui-bg));
}

.forum-moderation-clear {
  border-color: color-mix(in srgb, var(--ui-success) 35%, var(--ui-border));
  color: var(--ui-success);
  background: color-mix(in srgb, var(--ui-success) 6%, var(--ui-bg));
}

.forum-moderation-attention > span,
.forum-moderation-clear > span {
  display: grid;
  gap: 2px;
}

.forum-moderation-attention strong,
.forum-moderation-clear strong {
  color: var(--ui-text-highlighted);
  font-size: 11px;
}

.forum-moderation-attention small,
.forum-moderation-clear small {
  color: var(--ui-text-muted);
  font-size: 9px;
  line-height: 1.45;
}

.forum-moderation-categories {
  display: grid;
  flex: 1 1 auto;
  align-content: start;
  gap: 3px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.forum-moderation-categories li:not(.forum-moderation-categories__more) {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 9px;
  padding: 8px 9px;
  border-radius: 8px;
  background: var(--ui-bg);
}

.forum-moderation-categories li > span:first-child {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  color: var(--ui-primary);
  background: color-mix(in srgb, var(--ui-primary) 9%, var(--ui-bg-muted));
}

.forum-moderation-categories li > span:nth-child(2) {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.forum-moderation-categories strong {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.forum-moderation-categories small,
.forum-moderation-categories__more,
.forum-moderation-empty-categories,
.forum-moderation-inactive {
  color: var(--ui-text-muted);
  font-size: 8px;
}

.forum-moderation-categories__more {
  padding: 7px 9px;
  text-align: center;
}

.forum-moderation-empty-categories {
  flex: 1 1 auto;
  margin: 0;
}

.forum-moderation-inactive {
  display: flex;
  align-items: center;
  gap: 6px;
}

.forum-moderation-principles {
  display: grid;
  grid-template-columns: minmax(180px, .55fr) minmax(0, 1fr);
  gap: 30px;
  margin-top: 22px;
  padding: 20px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  background: var(--ui-bg);
}

.forum-moderation-principles > div {
  display: grid;
  align-content: center;
  gap: 3px;
}

.forum-moderation-principles > div span {
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 8px;
  text-transform: uppercase;
}

.forum-moderation-principles h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 16px;
  font-weight: 620;
}

.forum-moderation-principles ul {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.forum-moderation-principles li {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 8px;
}

.forum-moderation-principles li > :deep(svg) {
  color: var(--ui-primary);
}

.forum-moderation-principles li span {
  display: grid;
  gap: 2px;
}

.forum-moderation-principles li strong {
  color: var(--ui-text-highlighted);
  font-size: 9px;
}

.forum-moderation-principles li small {
  color: var(--ui-text-muted);
  font-size: 8px;
  line-height: 1.45;
}

.forum-moderation-denied {
  display: flex;
  min-height: 420px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 24px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background: var(--ui-bg-muted);
  text-align: center;
}

.forum-moderation-denied > span {
  display: grid;
  place-items: center;
  width: 62px;
  height: 62px;
  margin-bottom: 15px;
  border: 1px solid var(--ui-border);
  border-radius: 18px;
  color: var(--ui-text-dimmed);
  background: var(--ui-bg);
}

.forum-moderation-denied h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 19px;
}

.forum-moderation-denied p {
  max-width: 470px;
  margin: 8px 0 18px;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.55;
}

.forum-moderation-denied__actions {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
}

@container (max-width: 940px) {
  .forum-moderation-summary,
  .forum-moderation-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .forum-moderation-principles {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 700px) {
  .forum-moderation-principles ul {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 520px) {
  .forum-moderation-page__actions {
    justify-content: flex-start;
  }

  .forum-moderation-workspace-card {
    padding: 18px 15px;
    border-radius: var(--oe-radius-control);
  }
}

@media (prefers-reduced-motion: reduce) {
  .forum-moderation-realtime--connecting :deep(svg),
  .forum-moderation-realtime--pulse :deep(svg) {
    animation: none;
  }
}
</style>
