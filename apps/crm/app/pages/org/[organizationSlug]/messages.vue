<script setup lang="ts">
import type {
  CrmConversationInboxItem,
  CrmConversationInboxResponse,
} from '#shared/types/case-conversation-inbox'

definePageMeta({ middleware: ['auth', 'organization'] })
useHead({ title: 'Wiadomości — OpenExpert CRM' })

type InboxFilter = 'all' | 'unread'

const toast = useToast()
const { organizationSlug, crmApiPath, orgPath } = useOrganizationContext()
const search = ref('')
const selectedFilter = ref<InboxFilter>('all')

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
    path: orgPath(`/cases/${encodeURIComponent(conversation.caseId)}`),
    query: {
      view: 'messages',
      person: conversation.clientPersonId,
    },
  }
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

let refreshTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  refreshTimer = setInterval(() => {
    if (document.visibilityState !== 'visible' || status.value === 'pending') return
    void refresh().catch(() => {})
  }, 30_000)
})

onBeforeUnmount(() => {
  if (refreshTimer) clearInterval(refreshTimer)
})
</script>

<template>
  <CrmShell
    title="Wiadomości"
    eyebrow="Komunikacja"
    description="Wszystkie rozmowy z panelu klienta, uporządkowane według ostatniej aktywności."
  >
    <template #meta>
      <UBadge
        :color="unreadCount ? 'primary' : 'neutral'"
        :variant="unreadCount ? 'subtle' : 'outline'"
        icon="i-lucide-message-circle"
      >
        {{ unreadCount ? `${unreadCount} nieprzeczytanych` : 'Wszystko przeczytane' }}
      </UBadge>
    </template>

    <template #actions>
      <UButton
        color="neutral"
        variant="outline"
        icon="i-lucide-refresh-cw"
        :loading="refreshing"
        @click="refreshInbox"
      >
        Odśwież
      </UButton>
    </template>

    <section class="message-inbox" aria-labelledby="message-inbox-title">
      <header class="message-inbox__toolbar">
        <div class="message-inbox__heading">
          <div>
            <h2 id="message-inbox-title">Rozmowy</h2>
            <p>{{ updatedAtLabel }}</p>
          </div>
          <span class="message-inbox__count" aria-live="polite">
            {{ visibleConversations.length }}
          </span>
        </div>

        <div class="message-inbox__controls">
          <UInput
            v-model="search"
            class="message-inbox__search"
            icon="i-lucide-search"
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

          <div class="message-inbox__filters" role="tablist" aria-label="Filtr wiadomości">
            <button
              type="button"
              role="tab"
              :aria-selected="selectedFilter === 'all'"
              :class="{ 'message-inbox__filter--active': selectedFilter === 'all' }"
              @click="selectedFilter = 'all'"
            >
              Wszystkie
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="selectedFilter === 'unread'"
              :class="{ 'message-inbox__filter--active': selectedFilter === 'unread' }"
              @click="selectedFilter = 'unread'"
            >
              Nieprzeczytane
              <span v-if="unreadConversationCount">
                {{ unreadConversationCount > 99 ? '99+' : unreadConversationCount }}
              </span>
            </button>
          </div>
        </div>
      </header>

      <UAlert
        v-if="error && conversations.length"
        class="message-inbox__alert"
        color="warning"
        variant="subtle"
        icon="i-lucide-wifi-off"
        title="Lista może być nieaktualna"
        description="Nie udało się pobrać najnowszych wiadomości. Zachowaliśmy ostatnio załadowane wyniki."
      />

      <div v-if="initialLoading" class="message-inbox__skeletons" aria-label="Ładowanie wiadomości">
        <div v-for="index in 6" :key="index" class="message-inbox__skeleton">
          <USkeleton class="size-11 shrink-0 rounded-full" />
          <div>
            <USkeleton class="h-4 w-40 max-w-full" />
            <USkeleton class="mt-2 h-4 w-64 max-w-full" />
            <USkeleton class="mt-2 h-3 w-52 max-w-full" />
          </div>
        </div>
      </div>

      <div v-else-if="error && !conversations.length" class="message-inbox__state">
        <span class="message-inbox__state-icon">
          <UIcon name="i-lucide-cloud-off" aria-hidden="true" />
        </span>
        <h2>Nie udało się pobrać wiadomości</h2>
        <p>Sprawdź połączenie i spróbuj ponownie.</p>
        <UButton icon="i-lucide-refresh-cw" @click="refreshInbox">
          Spróbuj ponownie
        </UButton>
      </div>

      <div v-else-if="!conversations.length" class="message-inbox__state">
        <span class="message-inbox__state-icon">
          <UIcon name="i-lucide-message-square-dashed" aria-hidden="true" />
        </span>
        <h2>Nie ma jeszcze rozmów</h2>
        <p>Wiadomości wysłane w sprawach pojawią się tutaj automatycznie.</p>
        <UButton color="neutral" variant="outline" :to="orgPath('/cases')" icon="i-lucide-briefcase-business">
          Przejdź do spraw
        </UButton>
      </div>

      <div v-else-if="!visibleConversations.length" class="message-inbox__state">
        <span class="message-inbox__state-icon">
          <UIcon :name="selectedFilter === 'unread' ? 'i-lucide-mail-check' : 'i-lucide-search-x'" aria-hidden="true" />
        </span>
        <h2>{{ selectedFilter === 'unread' && !search ? 'Wszystko przeczytane' : 'Brak wyników' }}</h2>
        <p>
          {{ selectedFilter === 'unread' && !search
            ? 'Nie masz teraz żadnych nieprzeczytanych rozmów.'
            : 'Zmień wyszukiwanie lub filtr, aby zobaczyć inne rozmowy.' }}
        </p>
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-list-filter"
          @click="search = ''; selectedFilter = 'all'"
        >
          Wyczyść filtry
        </UButton>
      </div>

      <ul v-else class="message-inbox__list" aria-label="Lista rozmów">
        <li v-for="conversation in visibleConversations" :key="conversation.conversationId">
          <NuxtLink
            class="message-thread"
            :class="{ 'message-thread--unread': conversation.unreadCount > 0 }"
            :to="conversationLocation(conversation)"
            :aria-label="`Otwórz rozmowę z ${conversation.clientName} w sprawie ${conversation.caseTitle}`"
          >
            <span class="message-thread__avatar" aria-hidden="true">
              {{ clientInitials(conversation.clientName) }}
            </span>

            <span class="message-thread__content">
              <span class="message-thread__topline">
                <strong>{{ conversation.clientName }}</strong>
                <time :datetime="conversation.lastMessageAt">
                  {{ formatConversationTime(conversation.lastMessageAt) }}
                </time>
              </span>

              <span class="message-thread__context">
                <UBadge
                  class="message-thread__case"
                  color="neutral"
                  variant="subtle"
                  size="xs"
                  icon="i-lucide-briefcase-business"
                  :title="conversation.caseTitle"
                >
                  Sprawa · {{ conversation.caseTitle }}
                </UBadge>
                <span v-if="conversation.clientEmail" class="message-thread__email">
                  {{ conversation.clientEmail }}
                </span>
              </span>

              <span class="message-thread__preview">
                {{ messagePreview(conversation) }}
              </span>
            </span>

            <span class="message-thread__aside">
              <UBadge
                v-if="conversation.unreadCount"
                color="primary"
                variant="solid"
                size="xs"
                :aria-label="`${conversation.unreadCount} nieprzeczytanych wiadomości`"
              >
                {{ conversation.unreadCount > 99 ? '99+' : conversation.unreadCount }}
              </UBadge>
              <UIcon name="i-lucide-chevron-right" aria-hidden="true" />
            </span>
          </NuxtLink>
        </li>
      </ul>

      <UAlert
        v-if="response.data.hasMore"
        class="message-inbox__limit"
        color="neutral"
        variant="subtle"
        icon="i-lucide-info"
        title="Pokazujemy 100 najnowszych rozmów"
        description="Starsze rozmowy nadal znajdziesz w odpowiednich sprawach."
      />
    </section>

    <span class="sr-only" aria-live="polite" aria-atomic="true">
      {{ unreadCount
        ? `Masz ${unreadCount} nieprzeczytanych wiadomości w ${unreadConversationCount} rozmowach.`
        : 'Wszystkie rozmowy są przeczytane.' }}
    </span>
  </CrmShell>
</template>

<style scoped>
.message-inbox {
  max-width: 1040px;
  margin-inline: auto;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background: var(--ui-bg);
  box-shadow: 0 1px 2px color-mix(in srgb, var(--ui-text) 4%, transparent);
}

.message-inbox__toolbar {
  display: grid;
  gap: 16px;
  padding: 18px;
  border-bottom: 1px solid var(--ui-border);
  background: var(--ui-bg-elevated);
}

.message-inbox__heading,
.message-inbox__controls,
.message-thread__topline,
.message-thread__context,
.message-thread__aside {
  display: flex;
  align-items: center;
}

.message-inbox__heading,
.message-thread__topline {
  justify-content: space-between;
  gap: 16px;
}

.message-inbox__heading h2,
.message-inbox__state h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 16px;
  font-weight: 700;
}

.message-inbox__heading p,
.message-inbox__state p {
  margin: 3px 0 0;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.message-inbox__count {
  display: grid;
  min-width: 30px;
  height: 26px;
  place-items: center;
  padding-inline: 8px;
  border-radius: 999px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
}

.message-inbox__controls {
  gap: 12px;
}

.message-inbox__search {
  flex: 1 1 360px;
}

.message-inbox__filters {
  display: inline-flex;
  flex: 0 0 auto;
  gap: 3px;
  padding: 3px;
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  background: var(--ui-bg-muted);
}

.message-inbox__filters button {
  display: inline-flex;
  min-height: 34px;
  align-items: center;
  gap: 7px;
  padding: 6px 11px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--ui-text-muted);
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
}

.message-inbox__filters button:hover {
  color: var(--ui-text-highlighted);
}

.message-inbox__filters button:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 1px;
}

.message-inbox__filters .message-inbox__filter--active {
  background: var(--ui-bg);
  color: var(--ui-text-highlighted);
  box-shadow: 0 1px 2px color-mix(in srgb, var(--ui-text) 10%, transparent);
}

.message-inbox__filters span {
  display: grid;
  min-width: 19px;
  height: 18px;
  place-items: center;
  padding-inline: 4px;
  border-radius: 999px;
  background: var(--ui-primary);
  color: var(--ui-bg);
  font-size: 10px;
}

.message-inbox__alert {
  margin: 14px 14px 0;
}

.message-inbox__skeletons,
.message-inbox__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.message-inbox__skeleton {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 14px;
  padding: 18px;
  border-bottom: 1px solid var(--ui-border);
}

.message-inbox__skeleton:last-child {
  border-bottom: 0;
}

.message-inbox__state {
  display: grid;
  min-height: 320px;
  place-items: center;
  align-content: center;
  gap: 8px;
  padding: 40px 20px;
  text-align: center;
}

.message-inbox__state-icon {
  display: grid;
  width: 52px;
  height: 52px;
  place-items: center;
  margin-bottom: 4px;
  border-radius: 16px;
  background: var(--ui-bg-elevated);
  color: var(--ui-primary);
  font-size: 24px;
}

.message-inbox__state p {
  max-width: 420px;
  margin-bottom: 12px;
  font-size: 13px;
}

.message-inbox__list li:not(:last-child) {
  border-bottom: 1px solid var(--ui-border);
}

.message-thread {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 14px;
  min-height: 92px;
  align-items: center;
  padding: 16px 18px;
  color: inherit;
  text-decoration: none;
  transition: background-color var(--oe-motion-fast);
}

.message-thread:hover {
  background: var(--ui-bg-muted);
}

.message-thread:focus-visible {
  position: relative;
  z-index: 1;
  outline: 2px solid var(--ui-primary);
  outline-offset: -2px;
}

.message-thread--unread {
  background: color-mix(in srgb, var(--ui-primary) 5%, var(--ui-bg));
}

.message-thread__avatar {
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  border-radius: 14px;
  background: var(--ui-bg-elevated);
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 750;
}

.message-thread--unread .message-thread__avatar {
  background: color-mix(in srgb, var(--ui-primary) 14%, var(--ui-bg));
  color: var(--ui-primary);
}

.message-thread__content {
  display: grid;
  min-width: 0;
  gap: 6px;
}

.message-thread__topline strong {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 14px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.message-thread--unread .message-thread__topline strong {
  font-weight: 750;
}

.message-thread__topline time {
  flex: 0 0 auto;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.message-thread__context {
  min-width: 0;
  gap: 9px;
}

.message-thread__case {
  max-width: min(360px, 55vw);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.message-thread__email {
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.message-thread__preview {
  display: -webkit-box;
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 13px;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.message-thread--unread .message-thread__preview {
  color: var(--ui-text);
}

.message-thread__aside {
  align-self: stretch;
  gap: 9px;
  color: var(--ui-text-dimmed);
}

.message-thread__aside > :last-child {
  font-size: 17px;
}

.message-inbox__limit {
  margin: 14px;
}

@media (max-width: 680px) {
  .message-inbox__toolbar,
  .message-thread {
    padding-inline: 14px;
  }

  .message-inbox__controls {
    align-items: stretch;
    flex-direction: column;
  }

  .message-inbox__search {
    flex-basis: auto;
  }

  .message-inbox__filters {
    align-self: flex-start;
  }

  .message-thread {
    grid-template-columns: auto minmax(0, 1fr);
    gap: 11px;
  }

  .message-thread__avatar {
    width: 40px;
    height: 40px;
    border-radius: 12px;
  }

  .message-thread__aside {
    grid-column: 2;
    grid-row: 1;
    align-self: start;
    justify-self: end;
    padding-top: 25px;
  }

  .message-thread__aside > :last-child,
  .message-thread__topline time,
  .message-thread__email {
    display: none;
  }

  .message-thread__content {
    grid-column: 2;
    grid-row: 1;
    padding-right: 42px;
  }

  .message-thread__case {
    max-width: 58vw;
  }
}
</style>
