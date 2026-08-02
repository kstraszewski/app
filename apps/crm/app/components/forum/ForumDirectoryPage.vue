<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type {
  ForumCreateThreadPayload,
  ForumThreadStatus,
  ForumThreadSummary,
} from '#shared/types/forum'

const props = withDefaults(defineProps<{
  categorySlug?: string
}>(), {
  categorySlug: '',
})

const {
  activeCategory,
  activeSearchQuery,
  categories,
  categoriesStatus,
  categoryNotFound,
  clearSearch,
  hasActiveFilters,
  initialize: reloadDirectory,
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
} = useForumDirectory({ categorySlug: () => props.categorySlug })
const {
  canAccessModeration,
  roleLabel: moderatorRoleLabel,
  status: moderationContextStatus,
} = useForumModerationContext()
const { organizationSlug } = useOrganizationContext()
const composerOpen = ref(false)

const forumBasePath = computed(() => (
  `/org/${encodeURIComponent(organizationSlug.value)}/forum`
))
const moderationPath = computed(() => `${forumBasePath.value}/moderation`)
const pageTitle = computed(() => activeCategory.value?.name || 'Forum ekspertów')
const pageDescription = computed(() => (
  activeCategory.value?.description
  || (props.categorySlug
    ? 'Wątki i sprawdzone odpowiedzi ekspertów w tej kategorii.'
    : 'Zadaj pytanie, znajdź sprawdzone odpowiedzi i dziel się wiedzą z ekspertami w organizacji.')
))
const pageEyebrow = computed(() => activeCategory.value ? 'Kategoria forum' : 'Wiedza organizacji')
const initialCategoryId = computed(() => activeCategory.value?.id || '')
const categoriesToShow = computed(() => categories.value.slice(0, 8))
const openThreadCount = computed(() => (
  threadList.value.threads.filter(thread => thread.status === 'open').length
))
const answeredThreadCount = computed(() => (
  threadList.value.threads.filter(thread => ['answered', 'resolved'].includes(thread.status)).length
))
const verifiedThreadCount = computed(() => (
  threadList.value.threads.filter(thread => thread.hasVerifiedExpertAnswer).length
))
const threadTotalLabel = computed(() => {
  const count = threadList.value.total
  if (count === 1) return 'temat'
  const lastTwoDigits = count % 100
  return count % 10 >= 2 && count % 10 <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14)
    ? 'tematy'
    : 'tematów'
})
const pageTabs = computed(() => {
  const tabs: Array<{
    label: string
    to: RouteLocationRaw
    icon: string
    exact?: boolean
    active?: boolean
  }> = [{
    label: 'Wszystkie wątki',
    to: forumBasePath.value,
    icon: 'i-lucide-messages-square',
    exact: true,
  }]
  if (activeCategory.value) {
    tabs.push({
      label: activeCategory.value.name,
      to: categoryTarget(activeCategory.value.slug),
      icon: activeCategory.value.icon || 'i-lucide-folder',
      active: true,
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

useHead({
  title: computed(() => (
    activeCategory.value
      ? `${activeCategory.value.name} — Forum ekspertów — OpenExpert CRM`
      : 'Forum ekspertów — OpenExpert CRM'
  )),
})

function categoryTarget(slug: string): RouteLocationRaw {
  return `${forumBasePath.value}/categories/${encodeURIComponent(slug)}`
}

function threadTarget(thread: ForumThreadSummary): RouteLocationRaw {
  return `${forumBasePath.value}/threads/${encodeURIComponent(thread.id)}`
}

async function handleThreadCreated(payload: ForumCreateThreadPayload): Promise<void> {
  composerOpen.value = false
  await navigateTo(`${forumBasePath.value}/threads/${encodeURIComponent(payload.thread.id)}`)
}

async function openSimilarThread(thread: ForumThreadSummary): Promise<void> {
  composerOpen.value = false
  await navigateTo(threadTarget(thread))
}

async function showStatus(status: ForumThreadStatus | 'all'): Promise<void> {
  statusFilter.value = status
  await submitSearch()
}
</script>

<template>
  <div class="forum-directory-page">
    <CrmShell
      :title="pageTitle"
      :eyebrow="pageEyebrow"
      :description="pageDescription"
      :back-to="activeCategory ? forumBasePath : undefined"
      back-label="Wszystkie wątki"
      :tabs="pageTabs"
    >
      <template #actions>
        <div class="forum-directory-page__actions">
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
            :to="moderationPath"
            color="neutral"
            variant="outline"
            icon="i-lucide-shield"
          >
            Moderacja
          </UButton>
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
        title="Nie udało się potwierdzić uprawnień moderatora"
        description="Forum działa normalnie, ale narzędzia moderacji mogą być chwilowo niedostępne."
      />

      <section v-if="categoryNotFound" class="forum-directory-state" role="alert">
        <span><UIcon name="i-lucide-folder-x" aria-hidden="true" /></span>
        <h2>Nie znaleziono kategorii</h2>
        <p>Ta kategoria nie istnieje albo została wyłączona przez administratora forum.</p>
        <UButton :to="forumBasePath" color="neutral" variant="outline" icon="i-lucide-arrow-left">
          Wróć do forum
        </UButton>
      </section>

      <template v-else>
        <section class="forum-search-hero" aria-labelledby="forum-search-heading">
          <div class="forum-search-hero__copy">
            <span class="forum-search-hero__eyebrow">
              <UIcon name="i-lucide-sparkles" aria-hidden="true" />
              Wyszukiwanie wektorowe i słowa kluczowe
            </span>
            <h2 id="forum-search-heading">
              {{ activeCategory ? `Przeszukaj kategorię „${activeCategory.name}”` : 'Znajdź odpowiedź, zanim zadasz pytanie' }}
            </h2>
            <p>Możesz wpisać całe pytanie — wyszukiwarka rozumie znaczenie, nie tylko identyczne słowa.</p>
          </div>

          <form role="search" class="forum-search-hero__form" @submit.prevent="submitSearch">
            <UInput
              v-model="searchInput"
              class="forum-search-hero__input"
              size="xl"
              icon="i-lucide-search"
              placeholder="Np. jak odpowiedzieć klientowi, gdy bank opóźnia analizę?"
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
                  size="sm"
                  icon="i-lucide-x"
                  aria-label="Wyczyść wyszukiwanie"
                  @click="clearSearch"
                />
              </template>
            </UInput>
            <UButton type="submit" size="xl" icon="i-lucide-search" :disabled="Boolean(searchValidationMessage)">
              Szukaj
            </UButton>
          </form>

          <p v-if="searchValidationMessage" class="forum-search-hero__validation" role="status">
            {{ searchValidationMessage }}
          </p>

          <div class="forum-search-hero__status-row">
            <UTooltip :text="searchHelpText">
              <button type="button" class="forum-search-hero__mode" aria-label="Jak działa wyszukiwanie forum">
                <UIcon :name="threadList.searchMode === 'hybrid' ? 'i-lucide-sparkles' : 'i-lucide-search-check'" aria-hidden="true" />
                {{ searchModeLabel }}
                <UIcon name="i-lucide-circle-help" aria-hidden="true" />
              </button>
            </UTooltip>
            <span
              class="forum-realtime-pill"
              :class="[
                `forum-realtime-pill--${realtimeStatus.tone}`,
                { 'forum-realtime-pill--pulse': realtimePulse },
              ]"
              role="status"
              aria-live="polite"
            >
              <UIcon :name="realtimeStatus.icon" aria-hidden="true" />
              {{ realtimePulse ? 'Zaktualizowano teraz' : realtimeStatus.label }}
            </span>
          </div>
        </section>

        <section v-if="!activeCategory" id="forum-categories" class="forum-categories" aria-labelledby="forum-categories-heading">
          <div class="forum-section-heading">
            <div>
              <span>Obszary wiedzy</span>
              <h2 id="forum-categories-heading">Przeglądaj kategorie</h2>
              <p>Wejdź do wybranego obszaru, aby zobaczyć tylko związane z nim rozmowy.</p>
            </div>
          </div>

          <div v-if="categoriesStatus === 'idle' || categoriesStatus === 'pending'" class="forum-category-grid" aria-label="Ładowanie kategorii">
            <USkeleton v-for="index in 4" :key="index" class="h-36 w-full" />
          </div>
          <div v-else class="forum-category-grid">
            <ForumCategoryCard
              v-for="category in categoriesToShow"
              :key="category.id"
              :category="category"
              :to="categoryTarget(category.slug)"
            />
          </div>
        </section>

        <section class="forum-conversations" aria-labelledby="forum-conversations-heading">
          <div class="forum-conversations__main">
            <div class="forum-section-heading forum-section-heading--list">
              <div>
                <span>{{ activeSearchQuery ? 'Wyniki wyszukiwania' : (activeCategory ? 'Rozmowy w kategorii' : 'Najnowsza aktywność') }}</span>
                <h2 id="forum-conversations-heading">
                  {{ activeSearchQuery ? `Wyniki dla „${activeSearchQuery}”` : 'Wątki ekspertów' }}
                </h2>
                <p>
                  {{ threadList.total }}
                  {{ threadTotalLabel }}
                  · {{ activeSearchQuery ? 'najlepsze dopasowanie' : 'ostatnia aktywność' }}
                </p>
              </div>
              <UButton
                v-if="hasActiveFilters"
                color="neutral"
                variant="ghost"
                icon="i-lucide-filter-x"
                @click="resetFilters"
              >
                Wyczyść filtry
              </UButton>
            </div>

            <div class="forum-filter-bar" aria-label="Filtry forum">
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
              <span>Sortowanie: {{ activeSearchQuery ? 'trafność' : 'ostatnia aktywność' }}</span>
            </div>

            <ClientOnly>
              <p class="sr-only" aria-live="polite" aria-atomic="true">{{ resultAnnouncement }}</p>
            </ClientOnly>

            <div v-if="threadsStatus === 'idle' || threadsStatus === 'pending'" class="forum-thread-list" aria-label="Ładowanie tematów">
              <div v-for="index in 5" :key="index" class="forum-thread-skeleton">
                <USkeleton class="h-5 w-3/4" />
                <USkeleton class="h-3 w-full" />
                <USkeleton class="h-3 w-2/3" />
                <USkeleton class="h-3 w-1/2" />
              </div>
            </div>

            <div v-else-if="threadsStatus === 'error'" class="forum-directory-state" role="alert">
              <span><UIcon name="i-lucide-cloud-off" aria-hidden="true" /></span>
              <h2>Nie udało się pobrać forum</h2>
              <p>{{ threadsError }}</p>
              <UButton color="neutral" variant="outline" icon="i-lucide-refresh-cw" @click="reloadDirectory()">
                Spróbuj ponownie
              </UButton>
            </div>

            <div v-else-if="!threadList.threads.length" class="forum-directory-state">
              <span><UIcon :name="hasActiveFilters ? 'i-lucide-search-x' : 'i-lucide-messages-square'" aria-hidden="true" /></span>
              <h2>{{ hasActiveFilters ? 'Nie znaleziono tematów' : 'Rozpocznij pierwszą rozmowę' }}</h2>
              <p>
                {{ hasActiveFilters
                  ? 'Zmień pytanie albo filtry. Wyszukiwarka rozumie także inne sformułowania tego samego problemu.'
                  : 'Zadaj pytanie ekspertom albo rozpocznij dyskusję dla całej organizacji.' }}
              </p>
              <UButton v-if="hasActiveFilters" color="neutral" variant="outline" icon="i-lucide-filter-x" @click="resetFilters">
                Wyczyść filtry
              </UButton>
              <UButton v-else icon="i-lucide-plus" @click="composerOpen = true">
                Dodaj temat
              </UButton>
            </div>

            <div v-else class="forum-thread-list" aria-label="Wątki forum">
              <ForumThreadCard
                v-for="(thread, index) in threadList.threads"
                :key="thread.id"
                :thread="thread"
                :to="threadTarget(thread)"
                :query="activeSearchQuery"
                :best-match="Boolean(activeSearchQuery && index === 0)"
              />

              <button type="button" class="forum-question-cta" @click="composerOpen = true">
                <span>
                  <strong>Nie znalazłeś odpowiedzi?</strong>
                  <small>Dodaj kontekst i zapytaj ekspertów w organizacji.</small>
                </span>
                <span>
                  Zadaj pytanie
                  <UIcon name="i-lucide-arrow-right" aria-hidden="true" />
                </span>
              </button>
            </div>
          </div>

          <aside class="forum-conversations__aside" aria-label="Narzędzia forum">
            <section class="forum-side-panel">
              <span class="forum-side-panel__eyebrow">W tym widoku</span>
              <h3>Szybki przegląd</h3>
              <dl class="forum-side-stats">
                <div>
                  <dt>Otwarte</dt>
                  <dd>{{ openThreadCount }}</dd>
                </div>
                <div>
                  <dt>Z odpowiedzią</dt>
                  <dd>{{ answeredThreadCount }}</dd>
                </div>
                <div>
                  <dt>Eksperckie</dt>
                  <dd>{{ verifiedThreadCount }}</dd>
                </div>
              </dl>
              <div class="forum-side-actions">
                <button type="button" @click="showStatus('open')">
                  <UIcon name="i-lucide-circle-dot" aria-hidden="true" />
                  Pokaż otwarte pytania
                </button>
                <button type="button" @click="showStatus('resolved')">
                  <UIcon name="i-lucide-circle-check" aria-hidden="true" />
                  Pokaż rozwiązane
                </button>
              </div>
            </section>

            <section class="forum-side-panel forum-side-panel--semantic">
              <span class="forum-side-panel__icon"><UIcon name="i-lucide-orbit" aria-hidden="true" /></span>
              <span class="forum-side-panel__eyebrow">Omni Search</span>
              <h3>Wiedza pod ręką</h3>
              <p>Te same wątki znajdziesz z każdego miejsca CRM. Użyj globalnej wyszukiwarki i wpisz problem własnymi słowami.</p>
              <div class="forum-semantic-flow" aria-label="Jak działa wyszukiwanie">
                <span>Pytanie</span>
                <UIcon name="i-lucide-arrow-right" aria-hidden="true" />
                <span>Znaczenie</span>
                <UIcon name="i-lucide-arrow-right" aria-hidden="true" />
                <span>Odpowiedzi</span>
              </div>
            </section>
          </aside>
        </section>
      </template>
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
.forum-directory-page {
  min-width: 0;
  container-type: inline-size;
}

.forum-directory-page__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}

.forum-search-hero {
  display: grid;
  gap: 16px;
  padding: clamp(22px, 3vw, 34px);
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background:
    radial-gradient(circle at 88% 12%, color-mix(in srgb, var(--ui-primary) 11%, transparent), transparent 34%),
    var(--ui-bg-muted);
}

.forum-search-hero__copy {
  display: grid;
  max-width: 760px;
  gap: 5px;
}

.forum-search-hero__eyebrow,
.forum-search-hero__mode,
.forum-realtime-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.forum-search-hero__eyebrow {
  color: var(--ui-primary);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .04em;
  text-transform: uppercase;
}

.forum-search-hero__eyebrow :deep(svg) {
  width: 14px;
  height: 14px;
}

.forum-search-hero h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: clamp(22px, 2.5vw, 31px);
  font-weight: 590;
  line-height: 1.15;
}

.forum-search-hero__copy p {
  margin: 2px 0 0;
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.55;
}

.forum-search-hero__form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  max-width: 920px;
  gap: 10px;
}

.forum-search-hero__input {
  width: 100%;
}

.forum-search-hero__validation {
  margin: -8px 0 0;
  color: var(--ui-error);
  font-size: 11px;
}

.forum-search-hero__status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  max-width: 920px;
}

.forum-search-hero__mode,
.forum-realtime-pill {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.forum-search-hero__mode {
  padding: 0;
  border: 0;
  background: transparent;
  cursor: help;
  text-align: left;
}

.forum-search-hero__mode:focus-visible {
  border-radius: 4px;
  outline: 2px solid var(--ui-primary);
  outline-offset: 3px;
}

.forum-search-hero__mode :deep(svg),
.forum-realtime-pill :deep(svg) {
  width: 13px;
  height: 13px;
}

.forum-search-hero__mode :deep(svg:first-child) {
  color: var(--ui-primary);
}

.forum-realtime-pill--live :deep(svg) {
  color: var(--ui-success);
}

.forum-realtime-pill--polling :deep(svg) {
  color: var(--ui-primary);
}

.forum-realtime-pill--connecting :deep(svg) {
  color: var(--ui-warning);
  animation: forum-directory-spin 1.1s linear infinite;
}

.forum-realtime-pill--offline {
  color: var(--ui-warning);
}

.forum-realtime-pill--pulse :deep(svg) {
  animation: forum-directory-pulse 700ms ease-out;
}

@keyframes forum-directory-spin {
  to { transform: rotate(360deg); }
}

@keyframes forum-directory-pulse {
  50% { transform: scale(1.22); }
}

.forum-categories,
.forum-conversations {
  margin-top: 30px;
}

.forum-section-heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 14px;
}

.forum-section-heading > div {
  display: grid;
  gap: 3px;
}

.forum-section-heading > div > span,
.forum-side-panel__eyebrow {
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 650;
  letter-spacing: .05em;
  text-transform: uppercase;
}

.forum-section-heading h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 20px;
  font-weight: 620;
}

.forum-section-heading p {
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.5;
}

.forum-category-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 10px;
}

@container (min-width: 1150px) {
  .forum-category-grid {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }
}

.forum-conversations {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 270px;
  align-items: start;
  gap: 24px;
}

.forum-conversations__main {
  min-width: 0;
}

.forum-filter-bar {
  display: grid;
  grid-template-columns: minmax(160px, 220px) minmax(170px, 230px) minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  padding: 10px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  background: var(--ui-bg-muted);
}

.forum-filter-bar > span {
  justify-self: end;
  color: var(--ui-text-dimmed);
  font-size: 9px;
}

.forum-thread-list {
  display: grid;
  gap: 9px;
}

.forum-thread-skeleton {
  display: grid;
  gap: 9px;
  padding: 18px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  background: var(--ui-bg);
}

.forum-question-cta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  min-height: 72px;
  padding: 15px 17px;
  border: 1px dashed var(--ui-border-accented);
  border-radius: var(--oe-radius-control);
  color: var(--ui-text);
  background: color-mix(in srgb, var(--ui-primary) 4%, var(--ui-bg));
  text-align: left;
  cursor: pointer;
}

.forum-question-cta > span:first-child {
  display: grid;
  gap: 2px;
}

.forum-question-cta strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
}

.forum-question-cta small {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.forum-question-cta > span:last-child {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 6px;
  color: var(--ui-primary);
  font-size: 11px;
  font-weight: 700;
}

.forum-question-cta:hover {
  background: color-mix(in srgb, var(--ui-primary) 8%, var(--ui-bg));
}

.forum-question-cta:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 3px;
}

.forum-conversations__aside {
  position: sticky;
  top: 18px;
  display: grid;
  gap: 10px;
}

.forum-side-panel {
  display: grid;
  gap: 10px;
  padding: 17px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  background: var(--ui-bg);
}

.forum-side-panel h3 {
  margin: -4px 0 0;
  color: var(--ui-text-highlighted);
  font-size: 15px;
  font-weight: 620;
}

.forum-side-panel p {
  margin: -3px 0 0;
  color: var(--ui-text-muted);
  font-size: 10px;
  line-height: 1.55;
}

.forum-side-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin: 2px 0 0;
  padding: 0;
  border-block: 1px solid var(--ui-border-muted);
}

.forum-side-stats > div {
  display: grid;
  gap: 2px;
  padding: 11px 5px;
  text-align: center;
}

.forum-side-stats dt {
  color: var(--ui-text-dimmed);
  font-size: 8px;
}

.forum-side-stats dd {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 650;
}

.forum-side-actions {
  display: grid;
  gap: 2px;
}

.forum-side-actions button {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 7px 8px;
  border-radius: 7px;
  color: var(--ui-text-muted);
  background: transparent;
  font-size: 10px;
  text-align: left;
  cursor: pointer;
}

.forum-side-actions button:hover {
  color: var(--ui-text-highlighted);
  background: var(--ui-bg-muted);
}

.forum-side-actions button:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 1px;
}

.forum-side-panel--semantic {
  background:
    radial-gradient(circle at 100% 0, color-mix(in srgb, var(--ui-primary) 10%, transparent), transparent 45%),
    var(--ui-bg-muted);
}

.forum-side-panel__icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 11px;
  color: var(--ui-primary);
  background: color-mix(in srgb, var(--ui-primary) 10%, var(--ui-bg));
}

.forum-semantic-flow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 5px;
  margin-top: 2px;
  color: var(--ui-text-dimmed);
  font-family: var(--font-mono);
  font-size: 8px;
}

.forum-semantic-flow :deep(svg) {
  width: 11px;
  height: 11px;
}

.forum-directory-state {
  display: flex;
  min-height: 280px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 34px 24px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  background: var(--ui-bg-muted);
  text-align: center;
}

.forum-directory-state > span {
  display: grid;
  place-items: center;
  width: 54px;
  height: 54px;
  margin-bottom: 13px;
  border: 1px solid var(--ui-border);
  border-radius: 16px;
  color: var(--ui-text-dimmed);
  background: var(--ui-bg);
}

.forum-directory-state > span :deep(svg) {
  width: 23px;
  height: 23px;
}

.forum-directory-state h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 17px;
  font-weight: 620;
}

.forum-directory-state p {
  max-width: 420px;
  margin: 8px 0 17px;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.55;
}

@container (max-width: 1080px) {
  .forum-conversations {
    grid-template-columns: minmax(0, 1fr);
  }

  .forum-conversations__aside {
    position: static;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .forum-search-hero {
    border-radius: var(--oe-radius-control);
  }

  .forum-search-hero__form,
  .forum-filter-bar {
    grid-template-columns: minmax(0, 1fr);
  }

  .forum-search-hero__form > :deep(button),
  .forum-filter-bar > :deep(button) {
    width: 100%;
    justify-content: center;
  }

  .forum-filter-bar > span {
    justify-self: start;
  }

  .forum-section-heading,
  .forum-question-cta {
    align-items: flex-start;
    flex-direction: column;
  }

  .forum-conversations__aside {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 520px) {
  .forum-category-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .forum-search-hero {
    padding: 19px 15px;
  }

  .forum-directory-page__actions {
    justify-content: flex-start;
  }
}

@media (prefers-reduced-motion: reduce) {
  .forum-realtime-pill--connecting :deep(svg),
  .forum-realtime-pill--pulse :deep(svg) {
    animation: none;
  }
}
</style>
