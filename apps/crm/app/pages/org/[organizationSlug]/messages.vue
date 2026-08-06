<script setup lang="ts">
import type {
  CrmConversationInboxItem,
  CrmConversationInboxResponse,
} from '#shared/types/case-conversation-inbox'

definePageMeta({ middleware: ['auth', 'organization'] })
useHead({ title: 'Wiadomości — OpenExpert CRM' })

type InboxFilter = 'all' | 'unread'
type ConversationPanelHandle = {
  canLeaveConversation: () => boolean
}

const route = useRoute()
const toast = useToast()
const { organizationSlug, crmApiPath, orgPath } = useOrganizationContext()
const search = ref('')
const selectedFilter = ref<InboxFilter>('all')
const desktopFallbackEnabled = ref(false)
const rememberedConversationId = ref('')
const conversationPanel = ref<ConversationPanelHandle | null>(null)

const emptyResponse: CrmConversationInboxResponse = {
  data: {
    conversations: [],
    unreadCount: 0,
    unreadConversationCount: 0,
    hasMore: false,
    generatedAt: '',
  },
}

const {
  data: response,
  status,
  error,
  refresh,
} = await useFetch<CrmConversationInboxResponse>(
  () => crmApiPath('/conversations'),
  {
    key: computed(() => `crm-conversation-inbox:${organizationSlug.value}`),
    default: () => emptyResponse,
  },
)

const conversations = computed(() => response.value.data.conversations)
const unreadCount = computed(() => response.value.data.unreadCount)
const unreadConversationCount = computed(() => response.value.data.unreadConversationCount)
const initialLoading = computed(() => status.value === 'pending' && !conversations.value.length)
const refreshing = computed(() => status.value === 'pending' && Boolean(conversations.value.length))

const visibleConversations = computed(() => {
  const query = search.value.trim().toLocaleLowerCase('pl')
  return conversations.value.filter((conversation) => {
    if (selectedFilter.value === 'unread' && conversation.unreadCount === 0) return false
    if (!query) return true
    return [
      conversation.clientName,
      conversation.clientEmail,
      conversation.caseTitle,
      conversation.lastMessagePreview,
    ].some(value => value?.toLocaleLowerCase('pl').includes(query))
  })
})

const selectedCaseId = computed(() => {
  const value = Array.isArray(route.query.case) ? route.query.case[0] : route.query.case
  return typeof value === 'string' ? value : ''
})

const selectedClientPersonId = computed(() => {
  const value = Array.isArray(route.query.person) ? route.query.person[0] : route.query.person
  return typeof value === 'string' ? value : ''
})

const explicitConversation = computed(() => conversations.value.find(conversation => (
  conversation.caseId === selectedCaseId.value
  && conversation.clientPersonId === selectedClientPersonId.value
)) ?? null)

watch(explicitConversation, (conversation) => {
  if (conversation) rememberedConversationId.value = conversation.conversationId
}, { immediate: true })

watch(
  [desktopFallbackEnabled, conversations],
  ([desktopEnabled, nextConversations]) => {
    if (
      !desktopEnabled
      || explicitConversation.value
      || rememberedConversationId.value
    ) return
    rememberedConversationId.value = nextConversations[0]?.conversationId ?? ''
  },
  { immediate: true },
)

const rememberedConversation = computed(() => conversations.value.find(conversation => (
  conversation.conversationId === rememberedConversationId.value
)) ?? null)

const selectedConversation = computed(() => (
  explicitConversation.value
  ?? rememberedConversation.value
  ?? (desktopFallbackEnabled.value ? conversations.value[0] : null)
  ?? null
))
const hasExplicitSelection = computed(() => Boolean(explicitConversation.value))

const updatedAtLabel = computed(() => {
  const value = response.value.data.generatedAt
  if (!value || Number.isNaN(Date.parse(value))) return 'Oczekiwanie na synchronizację'
  return `Zaktualizowano ${new Intl.DateTimeFormat('pl-PL', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Warsaw',
  }).format(new Date(value))}`
})

function conversationLocation(conversation: CrmConversationInboxItem) {
  return {
    path: orgPath('/messages'),
    query: {
      case: conversation.caseId,
      person: conversation.clientPersonId,
    },
  }
}

function caseConversationLocation(conversation: CrmConversationInboxItem) {
  return {
    path: orgPath(`/cases/${encodeURIComponent(conversation.caseId)}`),
    query: {
      view: 'messages',
      person: conversation.clientPersonId,
    },
  }
}

function guardConversationChange(
  event: MouseEvent,
  conversation: CrmConversationInboxItem,
) {
  if (selectedConversation.value?.conversationId === conversation.conversationId) return
  if (conversationPanel.value?.canLeaveConversation() ?? true) return
  event.preventDefault()
  toast.add({
    title: 'Najpierw zakończ szkic wiadomości',
    description: 'Wyślij albo wyczyść treść i załączniki przed zmianą rozmowy.',
    color: 'warning',
    icon: 'i-lucide-paperclip',
  })
}

function clientInitials(name: string) {
  const initials = name
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toLocaleUpperCase('pl') ?? '')
    .join('')
  return initials || 'K'
}

function formatConversationTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Warsaw',
  }).format(date)
}

function messagePreview(conversation: CrmConversationInboxItem) {
  const preview = conversation.lastMessagePreview || 'Otwórz rozmowę, aby zobaczyć wiadomość.'
  if (conversation.lastMessageSenderKind !== 'staff') return preview
  return `${conversation.lastMessageSentByCurrentUser ? 'Ty' : 'Ekspert'}: ${preview}`
}

async function refreshInbox() {
  await refresh()
  if (!error.value) return
  toast.add({
    title: 'Nie udało się odświeżyć wiadomości',
    description: 'Sprawdź połączenie i spróbuj ponownie.',
    color: 'error',
    icon: 'i-lucide-circle-alert',
  })
}

function syncInboxAfterActivity() {
  if (status.value === 'pending') return
  void refresh().catch(() => {})
}

let refreshTimer: ReturnType<typeof setInterval> | null = null
let splitViewMedia: MediaQueryList | null = null

function enableDesktopFallback() {
  if (splitViewMedia?.matches) desktopFallbackEnabled.value = true
}

onMounted(() => {
  splitViewMedia = window.matchMedia('(min-width: 1101px)')
  enableDesktopFallback()
  splitViewMedia.addEventListener('change', enableDesktopFallback)
  refreshTimer = setInterval(() => {
    if (document.visibilityState !== 'visible' || status.value === 'pending') return
    void refresh().catch(() => {})
  }, 30_000)
})

onBeforeUnmount(() => {
  if (refreshTimer) clearInterval(refreshTimer)
  splitViewMedia?.removeEventListener('change', enableDesktopFallback)
})
</script>

<template>
  <div
    class="crm-messages-workspace crm-content-mode--workspace"
    :class="{ 'has-explicit-selection': hasExplicitSelection }"
  >
    <aside class="crm-messages-inbox" aria-labelledby="crm-messages-title">
      <header class="crm-messages-inbox__header">
        <div class="crm-messages-inbox__title">
          <h1 id="crm-messages-title">Wiadomości</h1>
          <span aria-live="polite">{{ conversations.length }}</span>
        </div>

        <div class="crm-messages-inbox__header-actions">
          <span v-if="unreadCount" class="crm-messages-inbox__new">
            {{ unreadCount > 99 ? '99+' : unreadCount }} nowe
          </span>
          <UButton
            color="neutral"
            variant="ghost"
            square
            icon="i-lucide-refresh-cw"
            :loading="refreshing"
            aria-label="Odśwież wiadomości"
            title="Odśwież wiadomości"
            @click="refreshInbox"
          />
        </div>
      </header>

      <p class="crm-messages-inbox__updated">{{ updatedAtLabel }}</p>

      <UInput
        v-model="search"
        class="crm-messages-inbox__search"
        icon="i-lucide-search"
        size="lg"
        placeholder="Szukaj klienta, sprawy lub treści"
        aria-label="Szukaj w wiadomościach"
      >
        <template v-if="search" #trailing>
          <UButton
            color="neutral"
            variant="link"
            square
            size="xs"
            icon="i-lucide-x"
            aria-label="Wyczyść wyszukiwanie"
            @click="search = ''"
          />
        </template>
      </UInput>

      <div class="crm-messages-inbox__filters" role="tablist" aria-label="Filtr wiadomości">
        <button
          type="button"
          role="tab"
          :aria-selected="selectedFilter === 'all'"
          :class="{ 'is-active': selectedFilter === 'all' }"
          @click="selectedFilter = 'all'"
        >
          Wszystkie
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="selectedFilter === 'unread'"
          :class="{ 'is-active': selectedFilter === 'unread' }"
          @click="selectedFilter = 'unread'"
        >
          Nieprzeczytane
          <span v-if="unreadConversationCount">
            {{ unreadConversationCount > 99 ? '99+' : unreadConversationCount }}
          </span>
        </button>
      </div>

      <UAlert
        v-if="error && conversations.length"
        class="crm-messages-inbox__alert"
        color="warning"
        variant="subtle"
        icon="i-lucide-wifi-off"
        title="Lista może być nieaktualna"
        description="Nie udało się pobrać najnowszych wiadomości. Zachowaliśmy ostatnie wyniki."
      />

      <div v-if="initialLoading" class="crm-messages-inbox__skeletons" aria-label="Ładowanie wiadomości">
        <div v-for="index in 6" :key="index" class="crm-messages-inbox__skeleton">
          <USkeleton class="size-11 shrink-0 rounded-full" />
          <div>
            <USkeleton class="h-4 w-36 max-w-full" />
            <USkeleton class="mt-2 h-3 w-48 max-w-full" />
            <USkeleton class="mt-2 h-3 w-56 max-w-full" />
          </div>
        </div>
      </div>

      <div v-else-if="error && !conversations.length" class="crm-messages-inbox__state">
        <UIcon name="i-lucide-cloud-off" aria-hidden="true" />
        <strong>Nie udało się pobrać wiadomości</strong>
        <p>Sprawdź połączenie i spróbuj ponownie.</p>
        <UButton size="sm" icon="i-lucide-refresh-cw" @click="refreshInbox">
          Spróbuj ponownie
        </UButton>
      </div>

      <div v-else-if="!conversations.length" class="crm-messages-inbox__state">
        <UIcon name="i-lucide-message-square-dashed" aria-hidden="true" />
        <strong>Nie ma jeszcze rozmów</strong>
        <p>Wiadomości wysłane w sprawach pojawią się tutaj automatycznie.</p>
        <UButton
          color="neutral"
          variant="outline"
          size="sm"
          :to="orgPath('/cases')"
          icon="i-lucide-briefcase-business"
        >
          Przejdź do spraw
        </UButton>
      </div>

      <div v-else-if="!visibleConversations.length" class="crm-messages-inbox__state">
        <UIcon
          :name="selectedFilter === 'unread' ? 'i-lucide-mail-check' : 'i-lucide-search-x'"
          aria-hidden="true"
        />
        <strong>{{ selectedFilter === 'unread' && !search ? 'Wszystko przeczytane' : 'Brak wyników' }}</strong>
        <p>
          {{ selectedFilter === 'unread' && !search
            ? 'Nie masz teraz żadnych nieprzeczytanych rozmów.'
            : 'Zmień wyszukiwanie lub filtr, aby zobaczyć inne rozmowy.' }}
        </p>
        <UButton
          color="neutral"
          variant="outline"
          size="sm"
          icon="i-lucide-list-filter"
          @click="search = ''; selectedFilter = 'all'"
        >
          Wyczyść filtry
        </UButton>
      </div>

      <nav v-else class="crm-messages-inbox__list" aria-label="Lista rozmów">
        <NuxtLink
          v-for="conversation in visibleConversations"
          :key="conversation.conversationId"
          :to="conversationLocation(conversation)"
          :class="{
            'is-active': selectedConversation?.conversationId === conversation.conversationId,
            'is-unread': conversation.unreadCount > 0,
          }"
          :aria-current="selectedConversation?.conversationId === conversation.conversationId ? 'page' : undefined"
          :aria-label="`Otwórz rozmowę z ${conversation.clientName} w sprawie ${conversation.caseTitle}`"
          @click="guardConversationChange($event, conversation)"
        >
          <span class="crm-messages-inbox__avatar" aria-hidden="true">
            {{ clientInitials(conversation.clientName) }}
          </span>

          <span class="crm-messages-inbox__thread-copy">
            <span class="crm-messages-inbox__thread-topline">
              <strong>{{ conversation.clientName }}</strong>
              <time :datetime="conversation.lastMessageAt">
                {{ formatConversationTime(conversation.lastMessageAt) }}
              </time>
            </span>
            <small :title="conversation.caseTitle">{{ conversation.caseTitle }}</small>
            <span class="crm-messages-inbox__preview">{{ messagePreview(conversation) }}</span>
          </span>

          <span v-if="conversation.unreadCount" class="crm-messages-inbox__unread">
            {{ conversation.unreadCount > 99 ? '99+' : conversation.unreadCount }}
          </span>
        </NuxtLink>
      </nav>

      <div v-if="response.data.hasMore" class="crm-messages-inbox__limit">
        <UIcon name="i-lucide-info" aria-hidden="true" />
        <span>Pokazujemy 100 najnowszych rozmów.</span>
      </div>
    </aside>

    <section
      v-if="selectedConversation"
      class="crm-messages-conversation"
      aria-label="Wybrana rozmowa"
    >
      <CaseConversationPanel
        ref="conversationPanel"
        surface="pane"
        :case-id="selectedConversation.caseId"
        :fixed-client-person-id="selectedConversation.clientPersonId"
        :case-title="selectedConversation.caseTitle"
        :case-to="caseConversationLocation(selectedConversation)"
        :back-to="orgPath('/messages')"
        @activity="syncInboxAfterActivity"
      />
    </section>

    <section v-else class="crm-messages-conversation crm-messages-conversation--empty">
      <UIcon name="i-lucide-message-circle-more" aria-hidden="true" />
      <h2>Wybierz rozmowę</h2>
      <p>Historia wiadomości i pole odpowiedzi pojawią się w tym miejscu.</p>
    </section>

    <span class="sr-only" aria-live="polite" aria-atomic="true">
      {{ unreadCount
        ? `Masz ${unreadCount} nieprzeczytanych wiadomości w ${unreadConversationCount} rozmowach.`
        : 'Wszystkie rozmowy są przeczytane.' }}
    </span>
  </div>
</template>

<style scoped>
.crm-messages-workspace {
  display: grid;
  grid-template-columns: minmax(300px, 360px) minmax(0, 1fr);
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--ui-bg);
}

.crm-messages-inbox {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  padding: 18px 14px 12px;
  border-right: 1px solid var(--ui-border);
  background: var(--ui-bg-muted);
}

.crm-messages-inbox__header,
.crm-messages-inbox__title,
.crm-messages-inbox__header-actions,
.crm-messages-inbox__thread-topline {
  display: flex;
  align-items: center;
}

.crm-messages-inbox__header {
  min-height: 46px;
  justify-content: space-between;
  gap: 12px;
  padding-inline: 6px 2px;
}

.crm-messages-inbox__title {
  min-width: 0;
  gap: 8px;
}

.crm-messages-inbox__title h1 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 23px;
  font-weight: 680;
  letter-spacing: -.03em;
}

.crm-messages-inbox__title > span,
.crm-messages-inbox__new {
  display: grid;
  min-width: 22px;
  min-height: 22px;
  place-items: center;
  padding-inline: 6px;
  border-radius: 999px;
  background: var(--ui-bg-elevated);
  color: var(--ui-text-muted);
  font-size: 10px;
  font-weight: 700;
}

.crm-messages-inbox__header-actions {
  flex: 0 0 auto;
  gap: 3px;
}

.crm-messages-inbox__new {
  background: var(--ui-bg-inverted);
  color: var(--ui-text-inverted);
}

.crm-messages-inbox__updated {
  margin: -1px 6px 8px;
  color: var(--ui-text-dimmed);
  font-size: 10px;
}

.crm-messages-inbox__search {
  flex: 0 0 auto;
  margin: 3px 2px 8px;
}

.crm-messages-inbox__search :deep(input) {
  border-radius: 999px;
  background: var(--ui-bg-elevated);
}

.crm-messages-inbox__filters {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 3px;
  margin: 0 2px 8px;
  padding: 3px;
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  background: var(--ui-bg-elevated);
}

.crm-messages-inbox__filters button {
  display: inline-flex;
  min-height: 32px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 5px 9px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 650;
  cursor: pointer;
}

.crm-messages-inbox__filters button:hover,
.crm-messages-inbox__filters button.is-active {
  color: var(--ui-text-highlighted);
}

.crm-messages-inbox__filters button.is-active {
  background: var(--ui-bg);
  box-shadow: 0 1px 2px color-mix(in srgb, var(--ui-text) 9%, transparent);
}

.crm-messages-inbox__filters button:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 1px;
}

.crm-messages-inbox__filters button span {
  display: grid;
  min-width: 18px;
  height: 18px;
  place-items: center;
  padding-inline: 4px;
  border-radius: 999px;
  background: var(--ui-bg-inverted);
  color: var(--ui-text-inverted);
  font-size: 9px;
}

.crm-messages-inbox__alert {
  margin: 4px 2px 8px;
}

.crm-messages-inbox__skeletons {
  display: grid;
  gap: 5px;
  min-height: 0;
  overflow: hidden;
  padding-top: 4px;
}

.crm-messages-inbox__skeleton {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 11px;
  padding: 12px 10px;
}

.crm-messages-inbox__state {
  display: grid;
  flex: 1 1 auto;
  min-height: 220px;
  place-items: center;
  align-content: center;
  gap: 7px;
  padding: 28px 18px;
  color: var(--ui-text-muted);
  text-align: center;
}

.crm-messages-inbox__state > svg {
  width: 34px;
  height: 34px;
  margin-bottom: 5px;
}

.crm-messages-inbox__state strong {
  color: var(--ui-text-highlighted);
  font-size: 14px;
}

.crm-messages-inbox__state p {
  max-width: 300px;
  margin: 0 0 7px;
  font-size: 12px;
  line-height: 1.45;
}

.crm-messages-inbox__list {
  display: grid;
  align-content: start;
  gap: 4px;
  min-height: 0;
  margin-top: 2px;
  overflow-y: auto;
  padding-bottom: 8px;
  overscroll-behavior: contain;
}

.crm-messages-inbox__list > a {
  position: relative;
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  gap: 11px;
  min-width: 0;
  padding: 12px 11px;
  border-radius: 14px;
  color: var(--ui-text);
  text-decoration: none;
  transition: color var(--oe-motion-fast), background-color var(--oe-motion-fast);
}

@media (hover: hover) and (pointer: fine) {
  .crm-messages-inbox__list > a:hover {
    background: var(--ui-bg-elevated);
  }
}

.crm-messages-inbox__list > a:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: -2px;
}

.crm-messages-inbox__list > a.is-active {
  background: var(--ui-bg-elevated);
  color: var(--ui-text-highlighted);
  box-shadow: inset 3px 0 0 var(--ui-primary);
}

.crm-messages-inbox__avatar {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border: 1px solid currentColor;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  opacity: .84;
}

.crm-messages-inbox__thread-copy {
  display: grid;
  min-width: 0;
}

.crm-messages-inbox__thread-topline {
  min-width: 0;
  justify-content: space-between;
  gap: 10px;
}

.crm-messages-inbox__thread-topline strong {
  overflow: hidden;
  font-size: 13px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.crm-messages-inbox__list > a.is-unread:not(.is-active) .crm-messages-inbox__thread-topline strong,
.crm-messages-inbox__list > a.is-unread:not(.is-active) .crm-messages-inbox__preview {
  color: var(--ui-text-highlighted);
  font-weight: 720;
}

.crm-messages-inbox__thread-topline time,
.crm-messages-inbox__thread-copy small,
.crm-messages-inbox__preview {
  color: currentColor;
  opacity: .6;
}

.crm-messages-inbox__thread-topline time {
  flex: 0 0 auto;
  font-size: 9px;
}

.crm-messages-inbox__thread-copy small {
  overflow: hidden;
  margin-top: 1px;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.crm-messages-inbox__preview {
  display: -webkit-box;
  margin-top: 5px;
  overflow: hidden;
  font-size: 11px;
  line-height: 1.35;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.crm-messages-inbox__unread {
  display: grid;
  align-self: center;
  min-width: 20px;
  height: 20px;
  place-items: center;
  padding-inline: 5px;
  border-radius: 999px;
  background: var(--ui-bg-inverted);
  color: var(--ui-text-inverted);
  font-size: 9px;
  font-weight: 750;
}

.crm-messages-inbox__list > a.is-active .crm-messages-inbox__unread {
  background: var(--ui-primary);
  color: var(--ui-text-inverted);
}

.crm-messages-inbox__limit {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 7px;
  margin: 5px 4px 0;
  padding-top: 9px;
  border-top: 1px solid var(--ui-border);
  color: var(--ui-text-dimmed);
  font-size: 10px;
}

.crm-messages-conversation {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--ui-bg);
}

.crm-messages-conversation--empty {
  place-items: center;
  align-content: center;
  padding: 32px;
  color: var(--ui-text-muted);
  text-align: center;
}

.crm-messages-conversation--empty > svg {
  width: 42px;
  height: 42px;
  margin-bottom: 12px;
}

.crm-messages-conversation--empty h2,
.crm-messages-conversation--empty p {
  margin: 0;
}

.crm-messages-conversation--empty h2 {
  color: var(--ui-text-highlighted);
  font-size: 18px;
}

.crm-messages-conversation--empty p {
  max-width: 380px;
  margin-top: 6px;
  font-size: 13px;
}

@media (max-width: 1100px) {
  .crm-messages-workspace {
    position: relative;
    display: block;
    overflow: hidden;
  }

  .crm-messages-inbox,
  .crm-messages-conversation {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    transition:
      opacity var(--oe-duration-base) var(--ease-out),
      transform var(--oe-duration-base) var(--ease-drawer),
      visibility 0s linear 0s;
  }

  .crm-messages-inbox {
    z-index: 1;
    padding: 15px 12px max(18px, env(safe-area-inset-bottom));
    border-right: 0;
  }

  .crm-messages-conversation {
    z-index: 2;
    visibility: hidden;
    opacity: 0;
    transform: translateX(12px);
    pointer-events: none;
    transition-duration:
      var(--oe-duration-fast),
      var(--oe-duration-fast),
      0s;
    transition-delay: 0s, 0s, var(--oe-duration-fast);
  }

  .crm-messages-workspace.has-explicit-selection .crm-messages-inbox {
    visibility: hidden;
    opacity: 0;
    transform: translateX(-12px);
    pointer-events: none;
    transition-duration:
      var(--oe-duration-fast),
      var(--oe-duration-fast),
      0s;
    transition-delay: 0s, 0s, var(--oe-duration-fast);
  }

  .crm-messages-workspace.has-explicit-selection .crm-messages-conversation {
    visibility: visible;
    opacity: 1;
    transform: translateX(0);
    pointer-events: auto;
    transition-delay: 0s;
  }

  .crm-messages-inbox__list > a {
    grid-template-columns: 40px minmax(0, 1fr) auto;
    padding-inline: 9px;
  }

  .crm-messages-inbox__avatar {
    width: 40px;
    height: 40px;
  }
}

@media (max-width: 1100px) and (prefers-reduced-motion: reduce) {
  .crm-messages-inbox,
  .crm-messages-conversation {
    transform: none !important;
    transition-duration: 150ms, 150ms, 0s !important;
    transition-property: opacity, transform, visibility !important;
  }
}
</style>
