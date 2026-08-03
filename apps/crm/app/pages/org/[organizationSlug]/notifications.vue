<script setup lang="ts">
import type { InAppNotification } from '#shared/types/notifications'
import { safeNotificationActionPath } from '~/utils/notifications'

definePageMeta({ middleware: ['auth', 'organization'] })
useHead({ title: 'Powiadomienia — OpenExpert CRM' })

type NotificationFilter = 'all' | 'unread'

const route = useRoute()
const toast = useToast()
const organizationSlug = computed(() => {
  const raw = route.params.organizationSlug
  return Array.isArray(raw) ? String(raw[0] || '') : String(raw || '')
})
const selectedFilter = ref<NotificationFilter>(
  route.query.filter === 'unread' ? 'unread' : 'all',
)

const {
  state,
  allNotifications,
  unreadNotifications,
  sync,
  ensureFeed,
  loadMore,
  markRead,
  markAllRead,
} = await useNotifications(organizationSlug)

if (selectedFilter.value === 'unread') {
  await ensureFeed('unread').catch(() => {})
}

const notifications = computed(() => selectedFilter.value === 'unread'
  ? unreadNotifications.value
  : allNotifications.value)
const activeCollection = computed(() => state.value.feeds[selectedFilter.value])
const lastSyncedLabel = computed(() => {
  if (!state.value.lastSyncedAt) return 'Oczekiwanie na synchronizację'
  return `Zaktualizowano ${new Intl.DateTimeFormat('pl-PL', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Warsaw',
  }).format(new Date(state.value.lastSyncedAt))}`
})

async function selectFilter(filter: NotificationFilter) {
  selectedFilter.value = filter
  await navigateTo({
    path: route.path,
    query: filter === 'unread' ? { filter: 'unread' } : {},
    replace: true,
  })
  if (filter === 'unread') await ensureFeed('unread').catch(() => {})
}

async function refreshNotifications() {
  try {
    await sync({ replace: true })
  }
  catch {
    toast.add({
      title: 'Nie udało się odświeżyć listy',
      description: 'Sprawdź połączenie i spróbuj ponownie.',
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  }
}

async function handleLoadMore() {
  try {
    await loadMore(selectedFilter.value)
  }
  catch {
    // The list exposes the collection error next to the retained results.
  }
}

async function handleMarkAllRead() {
  try {
    await markAllRead()
  }
  catch {
    toast.add({
      title: 'Nie udało się oznaczyć wszystkich',
      description: 'Zmiana została cofnięta. Spróbuj ponownie.',
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  }
}

async function activateNotification(notification: InAppNotification) {
  const target = safeNotificationActionPath(notification.actionPath, organizationSlug.value)
  try {
    await markRead(notification.id)
  }
  catch {
    toast.add({
      title: 'Nie zapisano statusu powiadomienia',
      description: target
        ? 'Otwieram wskazane miejsce; status zsynchronizuje się później.'
        : 'Spróbuj ponownie po odzyskaniu połączenia.',
      color: 'warning',
      icon: 'i-lucide-wifi-off',
    })
  }
  finally {
    if (target) await navigateTo(target)
  }
}

watch(() => route.query.filter, (filter) => {
  const nextFilter: NotificationFilter = filter === 'unread' ? 'unread' : 'all'
  if (nextFilter === selectedFilter.value) return
  selectedFilter.value = nextFilter
  if (nextFilter === 'unread') void ensureFeed('unread').catch(() => {})
})
</script>

<template>
  <CrmShell
    title="Powiadomienia"
    eyebrow="Centrum aktywności"
    description="Ważne zdarzenia i zadania z całej organizacji w jednym miejscu."
  >
    <template #meta>
      <UBadge color="neutral" variant="outline" icon="i-lucide-refresh-cw">
        {{ lastSyncedLabel }}
      </UBadge>
    </template>

    <template #actions>
      <UButton
        color="neutral"
        variant="outline"
        icon="i-lucide-refresh-cw"
        :loading="state.refreshing"
        @click="refreshNotifications"
      >
        Odśwież
      </UButton>
      <UButton
        icon="i-lucide-check-check"
        :loading="state.markingAllRead"
        :disabled="!state.unreadCount || state.markingAllRead"
        @click="handleMarkAllRead"
      >
        Przeczytaj wszystkie
      </UButton>
    </template>

    <section class="notifications-overview" aria-label="Podsumowanie powiadomień">
      <article>
        <span class="notifications-overview__icon notifications-overview__icon--primary">
          <UIcon name="i-lucide-mail-open" aria-hidden="true" />
        </span>
        <div>
          <small>Nieprzeczytane</small>
          <strong>{{ state.unreadCount }}</strong>
        </div>
      </article>
      <article>
        <span class="notifications-overview__icon">
          <UIcon name="i-lucide-inbox" aria-hidden="true" />
        </span>
        <div>
          <small>Załadowane</small>
          <strong>{{ allNotifications.length }}</strong>
        </div>
      </article>
      <article>
        <span class="notifications-overview__icon notifications-overview__icon--success">
          <UIcon name="i-lucide-radio" aria-hidden="true" />
        </span>
        <div>
          <small>Aktualizacja</small>
          <strong>Real-time</strong>
        </div>
      </article>
    </section>

    <section class="notifications-feed" aria-labelledby="notifications-feed-title">
      <header class="notifications-feed__header">
        <div>
          <h2 id="notifications-feed-title">Aktywność</h2>
          <p>Od najnowszych do najstarszych</p>
        </div>

        <div class="notifications-filter" role="tablist" aria-label="Filtr powiadomień">
          <button
            type="button"
            role="tab"
            :aria-selected="selectedFilter === 'all'"
            :class="{ 'notifications-filter__button--active': selectedFilter === 'all' }"
            @click="selectFilter('all')"
          >
            Wszystkie
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="selectedFilter === 'unread'"
            :class="{ 'notifications-filter__button--active': selectedFilter === 'unread' }"
            @click="selectFilter('unread')"
          >
            Nieprzeczytane
            <span v-if="state.unreadCount">{{ state.unreadCount > 99 ? '99+' : state.unreadCount }}</span>
          </button>
        </div>
      </header>

      <NotificationsCrmNotificationList
        :notifications="notifications"
        :loading="(state.initialLoading && !notifications.length) || activeCollection.loading"
        :loading-more="activeCollection.loading && Boolean(activeCollection.nextCursor)"
        :error="activeCollection.error"
        :has-more="activeCollection.hasMore"
        :empty-title="selectedFilter === 'unread' ? 'Wszystko przeczytane' : 'Brak powiadomień'"
        :empty-description="selectedFilter === 'unread'
          ? 'Nie masz teraz żadnych nieprzeczytanych powiadomień.'
          : 'Aktywność organizacji pojawi się tutaj.'"
        @activate="activateNotification"
        @retry="refreshNotifications"
        @load-more="handleLoadMore"
      />
    </section>

    <span class="sr-only" aria-live="polite" aria-atomic="true">
      {{ state.unreadCount
        ? `Masz ${state.unreadCount} nieprzeczytanych powiadomień.`
        : 'Wszystkie powiadomienia są przeczytane.' }}
    </span>
  </CrmShell>
</template>

<style scoped>
.notifications-overview {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 18px;
}

.notifications-overview article {
  display: flex;
  align-items: center;
  gap: 13px;
  min-width: 0;
  padding: 17px;
  border: 1px solid var(--ui-border-muted);
  border-radius: 16px;
  background: var(--ui-bg);
  box-shadow: var(--ui-shadow-xs);
}

.notifications-overview__icon {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border-radius: 13px;
  color: var(--ui-text-muted);
  background: var(--ui-bg-elevated);
}

.notifications-overview__icon--primary {
  color: var(--ui-primary);
  background: color-mix(in srgb, var(--ui-primary) 11%, var(--ui-bg));
}

.notifications-overview__icon--success {
  color: var(--ui-success);
  background: color-mix(in srgb, var(--ui-success) 11%, var(--ui-bg));
}

.notifications-overview__icon :deep(svg) {
  width: 20px;
  height: 20px;
}

.notifications-overview article > div {
  display: grid;
  min-width: 0;
}

.notifications-overview small {
  color: var(--ui-text-dimmed);
  font-size: 0.72rem;
}

.notifications-overview strong {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 1.25rem;
  line-height: 1.2;
  text-overflow: ellipsis;
}

.notifications-feed {
  overflow: hidden;
  border: 1px solid var(--ui-border-muted);
  border-radius: 18px;
  background: var(--ui-bg);
  box-shadow: var(--ui-shadow-xs);
}

.notifications-feed__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 18px 20px;
  border-bottom: 1px solid var(--ui-border-muted);
}

.notifications-feed__header h2,
.notifications-feed__header p {
  margin: 0;
}

.notifications-feed__header h2 {
  color: var(--ui-text-highlighted);
  font-size: 1rem;
}

.notifications-feed__header p {
  margin-top: 3px;
  color: var(--ui-text-dimmed);
  font-size: 0.75rem;
}

.notifications-filter {
  display: inline-flex;
  gap: 3px;
  padding: 3px;
  border: 1px solid var(--ui-border-muted);
  border-radius: 11px;
  background: var(--ui-bg-muted);
}

.notifications-filter button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 32px;
  padding: 5px 10px;
  border: 0;
  border-radius: 8px;
  color: var(--ui-text-muted);
  font-size: 0.78rem;
  font-weight: 600;
  background: transparent;
  cursor: pointer;
}

.notifications-filter button:hover,
.notifications-filter button:focus-visible {
  color: var(--ui-text-highlighted);
}

.notifications-filter button:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 1px;
}

.notifications-filter__button--active {
  color: var(--ui-text-highlighted) !important;
  background: var(--ui-bg) !important;
  box-shadow: var(--ui-shadow-xs);
}

.notifications-filter button span {
  min-width: 18px;
  padding: 1px 5px;
  border-radius: 999px;
  color: var(--ui-primary);
  font-size: 0.65rem;
  text-align: center;
  background: color-mix(in srgb, var(--ui-primary) 12%, var(--ui-bg));
}

@media (max-width: 760px) {
  .notifications-overview {
    grid-template-columns: 1fr;
  }

  .notifications-feed__header {
    align-items: stretch;
    flex-direction: column;
  }

  .notifications-filter {
    align-self: flex-start;
  }
}

@media (max-width: 420px) {
  .notifications-filter {
    align-self: stretch;
  }

  .notifications-filter button {
    justify-content: center;
    flex: 1 1 0;
  }
}
</style>
