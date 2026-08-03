<script setup lang="ts">
import type { PortalCase, PortalPayload } from '~/types/portal'
import { PORTAL_TIME_ZONE } from '~/utils/portal-date'

interface InboxConversationSummary {
  caseId: string
  conversationId: string
  lastMessageAt: string | null
  lastMessageSequence: number
  readThroughSequence: number
  unreadCount: number
  lastMessagePreview: string | null
  lastMessageSenderKind: 'staff' | 'client' | null
  lastMessageCreatedAt: string | null
}

interface InboxResponse {
  data: {
    conversations: InboxConversationSummary[]
  }
}

interface MessageThread {
  caseData: PortalCase
  summary: InboxConversationSummary | null
}

const props = withDefaults(defineProps<{
  payload: PortalPayload
  preview?: boolean
}>(), {
  preview: false,
})

const route = useRoute()
const requestFetch = useRequestFetch()
const messagesPath = computed(() => props.preview ? '/preview/messages' : '/messages')
const selectedCaseQuery = computed(() => typeof route.query.case === 'string'
  ? route.query.case
  : '')

function previewInboxResponse(): InboxResponse {
  return {
    data: {
      conversations: props.payload.cases.map((caseData, index) => ({
        caseId: caseData.id,
        conversationId: `preview-conversation-${caseData.id}`,
        lastMessageAt: index === 0
          ? '2026-08-01T09:11:00.000Z'
          : '2026-07-31T14:26:00.000Z',
        lastMessageSequence: index === 0 ? 3 : 2,
        readThroughSequence: index === 0 ? 2 : 2,
        unreadCount: index === 0 ? 1 : 0,
        lastMessagePreview: index === 0
          ? 'Świetnie. Gdy tylko plik się pojawi, od razu go sprawdzę.'
          : 'Zestawienie finalnych ofert będzie gotowe jutro rano.',
        lastMessageSenderKind: 'staff',
        lastMessageCreatedAt: index === 0
          ? '2026-08-01T09:11:00.000Z'
          : '2026-07-31T14:26:00.000Z',
      })),
    },
  }
}

const {
  data: inboxResponse,
  status: inboxStatus,
  error: inboxError,
  refresh: refreshInbox,
} = useAsyncData(
  () => `portal-message-inbox:${props.preview ? 'preview' : props.payload.user.id}`,
  () => props.preview
    ? Promise.resolve(previewInboxResponse())
    : requestFetch<InboxResponse>('/api/client/conversations'),
)

let inboxRefreshTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  if (props.preview) return
  inboxRefreshTimer = setInterval(() => void refreshInbox(), 30_000)
})
onBeforeUnmount(() => {
  if (inboxRefreshTimer) clearInterval(inboxRefreshTimer)
})

const summariesByCase = computed(() => new Map(
  (inboxResponse.value?.data.conversations || []).map(summary => [summary.caseId, summary]),
))
const isInitialInboxLoading = computed(() => (
  inboxStatus.value === 'pending' && !inboxResponse.value
))

const threads = computed<MessageThread[]>(() => props.payload.cases
  .map(caseData => ({
    caseData,
    summary: summariesByCase.value.get(caseData.id) || null,
  }))
  .sort((left, right) => {
    const leftTime = left.summary?.lastMessageAt
      ? new Date(left.summary.lastMessageAt).getTime()
      : 0
    const rightTime = right.summary?.lastMessageAt
      ? new Date(right.summary.lastMessageAt).getTime()
      : 0
    return rightTime - leftTime
  }))

const selectedCase = computed(() => props.payload.cases.find(
  caseData => caseData.id === selectedCaseQuery.value,
) || props.payload.cases.find(caseData => caseData.id === props.payload.activeCaseId)
  || props.payload.cases[0]
  || null)
const hasExplicitSelection = computed(() => Boolean(
  selectedCaseQuery.value
  && props.payload.cases.some(caseData => caseData.id === selectedCaseQuery.value),
))
const totalUnread = computed(() => threads.value.reduce(
  (total, thread) => total + (thread.summary?.unreadCount || 0),
  0,
))

function threadTo(caseId: string) {
  return { path: messagesPath.value, query: { case: caseId } }
}

function caseTo(caseId: string) {
  const base = props.preview
    ? `/preview/cases/${encodeURIComponent(caseId)}`
    : `/cases/${encodeURIComponent(caseId)}`
  return `${base}?view=updates`
}

function expertInitials(caseData: PortalCase) {
  return caseData.expert.initials
    || caseData.expert.name
      .split(/\s+/u)
      .filter(Boolean)
      .map(part => part[0])
      .slice(0, 2)
      .join('')
      .toUpperCase()
}

function threadTime(summary: InboxConversationSummary | null) {
  if (!summary?.lastMessageAt) return ''
  const date = new Date(summary.lastMessageAt)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: PORTAL_TIME_ZONE,
  }).format(date)
}
</script>

<template>
  <div class="portal-messages-screen">
    <PortalHeader
      :user-name="payload.user.name"
      :user-email="payload.user.email"
      :preview="preview"
    />

    <main
      class="portal-messages-screen__main"
      :class="{ 'has-thread-selection': hasExplicitSelection }"
    >
      <header class="portal-messages-screen__heading">
        <div>
          <p>TWOJE ROZMOWY</p>
          <h1>Wiadomości</h1>
        </div>
        <p>
          Każda rozmowa jest przypisana do konkretnej sprawy, żeby kontekst zawsze był jasny.
        </p>
      </header>

      <div
        class="portal-inbox"
        :class="{ 'has-selection': hasExplicitSelection }"
      >
        <aside class="portal-inbox__threads" aria-label="Rozmowy według spraw">
          <header class="portal-inbox__threads-header">
            <div>
              <strong>Wszystkie sprawy</strong>
              <span>{{ threads.length }}</span>
            </div>
            <span v-if="totalUnread">{{ totalUnread }} nowe</span>
          </header>

          <div v-if="isInitialInboxLoading" class="portal-inbox__loading">
            <USkeleton v-for="index in 3" :key="index" class="h-24 w-full" />
          </div>

          <UAlert
            v-else-if="inboxError"
            class="portal-inbox__error"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            title="Nie udało się odświeżyć listy"
            description="Nadal możesz otworzyć rozmowę wybranej sprawy."
          >
            <template #actions>
              <UButton color="error" variant="soft" size="xs" @click="refreshInbox()">
                Spróbuj ponownie
              </UButton>
            </template>
          </UAlert>

          <nav v-if="threads.length" class="portal-inbox__thread-list">
            <NuxtLink
              v-for="thread in threads"
              :key="thread.caseData.id"
              :to="threadTo(thread.caseData.id)"
              :class="{ 'is-active': selectedCase?.id === thread.caseData.id }"
              :aria-current="selectedCase?.id === thread.caseData.id ? 'page' : undefined"
            >
              <span class="portal-inbox__avatar">{{ expertInitials(thread.caseData) }}</span>
              <span class="portal-inbox__thread-copy">
                <span>
                  <strong>{{ thread.caseData.title }}</strong>
                  <time v-if="thread.summary" :datetime="thread.summary.lastMessageAt || undefined">
                    {{ threadTime(thread.summary) }}
                  </time>
                </span>
                <small>{{ thread.caseData.expert.name }}</small>
                <span class="portal-inbox__preview">
                  {{ thread.summary?.lastMessageSenderKind === 'client' ? 'Ty: ' : '' }}{{
                    thread.summary?.lastMessagePreview || 'Rozpocznij bezpieczną rozmowę w tej sprawie.'
                  }}
                </span>
              </span>
              <span v-if="thread.summary?.unreadCount" class="portal-inbox__unread">
                {{ thread.summary.unreadCount > 99 ? '99+' : thread.summary.unreadCount }}
              </span>
            </NuxtLink>
          </nav>

          <div v-else class="portal-inbox__empty">
            <UIcon name="i-lucide-message-circle-dashed" />
            <strong>Nie masz jeszcze spraw z rozmową</strong>
            <p>Gdy ekspert udostępni sprawę, będzie można napisać do niego właśnie tutaj.</p>
          </div>
        </aside>

        <section v-if="selectedCase" class="portal-inbox__conversation" aria-label="Wybrana rozmowa">
          <header class="portal-inbox__conversation-context">
            <NuxtLink :to="messagesPath" class="portal-inbox__mobile-back">
              <UIcon name="i-lucide-arrow-left" />
              Wszystkie rozmowy
            </NuxtLink>
            <div>
              <span>SPRAWA</span>
              <strong>{{ selectedCase.title }}</strong>
            </div>
            <UButton
              :to="caseTo(selectedCase.id)"
              color="neutral"
              variant="ghost"
              trailing-icon="i-lucide-arrow-up-right"
            >
              Otwórz sprawę
            </UButton>
          </header>
          <PortalCaseConversation
            :key="selectedCase.id"
            :case-id="selectedCase.id"
            :expert-name="selectedCase.expert.name"
            :preview="preview"
            surface="pane"
            @message-sent="refreshInbox()"
            @receipt-updated="refreshInbox()"
          />
        </section>

        <section v-else class="portal-inbox__no-case">
          <UIcon name="i-lucide-folder-clock" />
          <h2>Najpierw potrzebna jest sprawa</h2>
          <p>Rozmowa pojawi się tutaj, gdy ekspert udostępni Ci pierwszą sprawę.</p>
        </section>
      </div>
    </main>
  </div>
</template>

<style scoped>
.portal-messages-screen {
  min-height: 100dvh;
  background: var(--ui-bg-muted);
}

.portal-messages-screen__main {
  width: min(1240px, calc(100% - 48px));
  margin: 0 auto;
  padding: 40px 0 110px;
}

.portal-messages-screen__heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 40px;
  margin-bottom: 24px;
}

.portal-messages-screen__heading p,
.portal-messages-screen__heading h1 {
  margin: 0;
}

.portal-messages-screen__heading > div > p {
  margin-bottom: 4px;
  color: var(--ui-text-muted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .12em;
}

.portal-messages-screen__heading h1 {
  font-size: clamp(38px, 4vw, 52px);
  line-height: 1.1;
}

.portal-messages-screen__heading > p {
  max-width: 430px;
  padding-bottom: 5px;
  color: var(--ui-text-muted);
  font-size: 13px;
  line-height: 1.5;
  text-align: right;
}

.portal-inbox {
  display: grid;
  grid-template-columns: minmax(300px, 360px) minmax(0, 1fr);
  min-height: min(690px, calc(100dvh - 220px));
  overflow: hidden;
  border: 1px solid var(--portal-line);
  border-radius: 22px;
  background: var(--ui-bg);
  box-shadow: 0 22px 60px rgb(0 0 0 / 5%);
}

.portal-inbox__threads {
  min-width: 0;
  padding: 17px;
  border-right: 1px solid var(--portal-line);
  background: var(--portal-warm-surface);
}

.portal-inbox__threads-header,
.portal-inbox__threads-header > div,
.portal-inbox__thread-copy > span:first-child,
.portal-inbox__conversation-context,
.portal-inbox__mobile-back {
  display: flex;
  align-items: center;
}

.portal-inbox__threads-header {
  justify-content: space-between;
  min-height: 42px;
  padding: 0 5px 12px;
  border-bottom: 1px solid var(--portal-line);
}

.portal-inbox__threads-header > div {
  gap: 8px;
}

.portal-inbox__threads-header strong {
  font-size: 14px;
}

.portal-inbox__threads-header > div span,
.portal-inbox__threads-header > span {
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

.portal-inbox__threads-header > span {
  background: var(--ui-bg-inverted);
  color: var(--ui-text-inverted);
}

.portal-inbox__loading {
  display: grid;
  gap: 9px;
  padding-top: 12px;
}

.portal-inbox__error {
  margin-top: 12px;
}

.portal-inbox__thread-list {
  display: grid;
  gap: 7px;
  margin-top: 10px;
}

.portal-inbox__thread-list > a {
  position: relative;
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  gap: 11px;
  min-width: 0;
  padding: 13px 11px;
  border-radius: 15px;
  color: var(--ui-text);
  text-decoration: none;
  transition: color 160ms ease, background 160ms ease;
}

.portal-inbox__thread-list > a:hover {
  background: var(--ui-bg-elevated);
}

.portal-inbox__thread-list > a.is-active {
  background: var(--ui-bg-inverted);
  color: var(--ui-text-inverted);
}

.portal-inbox__avatar {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border: 1px solid currentColor;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  opacity: .88;
}

.portal-inbox__thread-copy {
  display: grid;
  min-width: 0;
}

.portal-inbox__thread-copy > span:first-child {
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.portal-inbox__thread-copy strong {
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.portal-inbox__thread-copy time,
.portal-inbox__thread-copy small,
.portal-inbox__preview {
  color: currentColor;
  opacity: .62;
}

.portal-inbox__thread-copy time {
  flex: 0 0 auto;
  font-size: 9px;
}

.portal-inbox__thread-copy small {
  margin-top: 1px;
  font-size: 10px;
}

.portal-inbox__preview {
  display: -webkit-box;
  margin-top: 5px;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  font-size: 11px;
  line-height: 1.35;
}

.portal-inbox__unread {
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

.portal-inbox__thread-list > a.is-active .portal-inbox__unread {
  background: var(--ui-bg);
  color: var(--ui-text-highlighted);
}

.portal-inbox__conversation {
  display: grid;
  grid-template-rows: auto 1fr;
  min-width: 0;
  background: var(--ui-bg);
}

.portal-inbox__conversation-context {
  justify-content: space-between;
  gap: 20px;
  min-height: 66px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--portal-line);
}

.portal-inbox__conversation-context > div {
  display: grid;
  min-width: 0;
}

.portal-inbox__conversation-context > div span {
  color: var(--ui-text-muted);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .12em;
}

.portal-inbox__conversation-context > div strong {
  overflow: hidden;
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.portal-inbox__mobile-back {
  display: none;
  gap: 7px;
  color: var(--ui-text-muted);
  font-size: 12px;
  text-decoration: none;
}

.portal-inbox__empty,
.portal-inbox__no-case {
  display: grid;
  max-width: 420px;
  margin: auto;
  padding: 32px;
  justify-items: center;
  text-align: center;
}

.portal-inbox__empty svg,
.portal-inbox__no-case svg {
  width: 34px;
  height: 34px;
  margin-bottom: 13px;
}

.portal-inbox__empty p,
.portal-inbox__no-case p {
  margin: 6px 0 0;
  color: var(--ui-text-muted);
  font-size: 13px;
}

@media (max-width: 760px) {
  .portal-messages-screen__main {
    width: min(calc(100% - 32px), 640px);
    padding: 26px 0 var(--portal-mobile-nav-clearance);
  }

  .portal-messages-screen__heading {
    display: block;
    margin-bottom: 20px;
  }

  .portal-messages-screen__heading h1 {
    font-size: 38px;
  }

  .portal-messages-screen__heading > p {
    max-width: 390px;
    margin-top: 8px;
    padding: 0;
    text-align: left;
  }

  .portal-inbox {
    display: block;
    min-height: 0;
    overflow: visible;
    border-radius: 18px;
  }

  .portal-inbox__threads {
    min-height: 520px;
    border-right: 0;
    border-radius: inherit;
  }

  .portal-inbox__conversation {
    display: none;
    border-radius: inherit;
  }

  .portal-inbox.has-selection .portal-inbox__threads {
    display: none;
  }

  .portal-inbox.has-selection .portal-inbox__conversation {
    display: grid;
  }

  .portal-inbox.has-selection + * {
    display: none;
  }

  .portal-inbox__mobile-back {
    display: inline-flex;
    grid-column: 1 / -1;
  }

  .portal-inbox__conversation-context {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    padding: 13px 15px;
  }
}

@media (max-width: 640px) {
  .portal-messages-screen__main {
    padding-top: 20px;
  }

  .portal-messages-screen__heading h1 {
    font-size: 34px;
  }

  .portal-messages-screen__main.has-thread-selection {
    padding-top: 10px;
  }

  .portal-messages-screen__main.has-thread-selection .portal-messages-screen__heading {
    display: none;
  }

  .portal-inbox {
    margin-inline: -4px;
    border-radius: 17px;
  }

  .portal-inbox__threads {
    padding: 12px;
  }

  .portal-inbox__thread-list > a {
    grid-template-columns: 40px minmax(0, 1fr) auto;
    padding: 12px 9px;
  }

  .portal-inbox__avatar {
    width: 40px;
    height: 40px;
  }

  .portal-inbox.has-selection {
    margin-inline: -16px;
    border-right: 0;
    border-left: 0;
    border-radius: 0;
  }

}
</style>
