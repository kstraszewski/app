<script setup lang="ts">
import type { InAppNotification } from '#shared/types/notifications'
import {
  notificationDayKey,
  notificationDayLabel,
} from '~/utils/notifications'

const props = withDefaults(defineProps<{
  notifications: InAppNotification[]
  loading?: boolean
  loadingMore?: boolean
  error?: string | null
  hasMore?: boolean
  compact?: boolean
  emptyTitle?: string
  emptyDescription?: string
}>(), {
  loading: false,
  loadingMore: false,
  error: null,
  hasMore: false,
  compact: false,
  emptyTitle: 'Wszystko przeczytane',
  emptyDescription: 'Nowe powiadomienia pojawią się tutaj.',
})

const emit = defineEmits<{
  activate: [notification: InAppNotification]
  retry: []
  loadMore: []
}>()

const groups = computed(() => {
  const grouped = new Map<string, { label: string, notifications: InAppNotification[] }>()
  const now = new Date()
  const todayKey = notificationDayKey(now.toISOString())
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayKey = notificationDayKey(yesterday.toISOString())

  for (const notification of props.notifications) {
    const key = notificationDayKey(notification.createdAt)
    const existing = grouped.get(key)
    const label = key === todayKey
      ? 'Dzisiaj'
      : key === yesterdayKey
        ? 'Wczoraj'
        : notificationDayLabel(notification.createdAt)
    if (existing) existing.notifications.push(notification)
    else grouped.set(key, { label, notifications: [notification] })
  }

  return [...grouped.entries()].map(([key, group]) => ({ key, ...group }))
})
</script>

<template>
  <div
    class="notification-list"
    :class="{ 'notification-list--compact': compact }"
    role="feed"
    aria-label="Lista powiadomień"
    :aria-busy="loading || loadingMore"
  >
    <div v-if="loading && !notifications.length" class="notification-list__skeletons" aria-label="Ładowanie powiadomień">
      <div v-for="index in compact ? 4 : 6" :key="index" class="notification-skeleton">
        <USkeleton class="notification-skeleton__icon" />
        <span>
          <USkeleton class="h-4 w-3/5" />
          <USkeleton class="mt-2 h-3 w-full" />
          <USkeleton class="mt-2 h-3 w-2/5" />
        </span>
      </div>
    </div>

    <OeEmptyState
      v-else-if="error && !notifications.length"
      kind="error"
      :size="compact ? 'compact' : 'default'"
      :align="compact ? 'start' : 'center'"
      surface="subtle"
      title="Nie udało się pobrać powiadomień"
      :description="error"
    >
      <template #actions>
        <UButton size="xs" color="error" variant="soft" icon="i-lucide-refresh-cw" @click="emit('retry')">
          Spróbuj ponownie
        </UButton>
      </template>
    </OeEmptyState>

    <OeEmptyState
      v-else-if="!notifications.length"
      :size="compact ? 'compact' : 'default'"
      :align="compact ? 'start' : 'center'"
      icon="i-lucide-bell-ring"
      :title="emptyTitle"
      :description="emptyDescription"
    />

    <template v-else>
      <UAlert
        v-if="error"
        class="notification-list__inline-error"
        color="warning"
        variant="subtle"
        icon="i-lucide-wifi-off"
        title="Lista może być nieaktualna"
        :description="error"
      >
        <template #actions>
          <UButton size="xs" color="warning" variant="ghost" @click="emit('retry')">
            Odśwież
          </UButton>
        </template>
      </UAlert>

      <section
        v-for="group in groups"
        :key="group.key"
        class="notification-list__group"
        :aria-labelledby="`notification-day-${group.key}`"
      >
        <h3 :id="`notification-day-${group.key}`">{{ group.label }}</h3>
        <NotificationsCrmNotificationItem
          v-for="notification in group.notifications"
          :key="notification.id"
          :notification="notification"
          :compact="compact"
          @activate="emit('activate', $event)"
        />
      </section>

      <div v-if="hasMore" class="notification-list__more">
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-chevrons-down"
          :loading="loadingMore"
          :disabled="loadingMore"
          @click="emit('loadMore')"
        >
          Pokaż starsze
        </UButton>
      </div>
    </template>
  </div>
</template>

<style scoped>
.notification-list {
  min-width: 0;
}

.notification-list__skeletons {
  display: grid;
}

.notification-skeleton {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--ui-border-muted);
}

.notification-skeleton__icon {
  width: 38px;
  height: 38px;
  border-radius: 12px;
}

.notification-list__message,
.notification-list__empty {
  margin: 20px;
}

.notification-list__inline-error {
  margin: 10px 12px;
}

.notification-list__empty {
  display: grid;
  justify-items: center;
  padding: 28px 18px;
  color: var(--ui-text-muted);
  text-align: center;
}

.notification-list__empty-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  margin-bottom: 12px;
  border-radius: 18px;
  color: var(--ui-primary);
  background: color-mix(in srgb, var(--ui-primary) 10%, var(--ui-bg));
}

.notification-list__empty-icon :deep(svg) {
  width: 24px;
  height: 24px;
}

.notification-list__empty strong {
  color: var(--ui-text-highlighted);
}

.notification-list__empty p {
  max-width: 32ch;
  margin: 5px 0 0;
  font-size: 0.8125rem;
}

.notification-list__group > h3 {
  margin: 0;
  padding: 9px 16px 7px;
  border-bottom: 1px solid var(--ui-border-muted);
  color: var(--ui-text-dimmed);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.055em;
  text-transform: uppercase;
  background: var(--ui-bg-muted);
}

.notification-list--compact .notification-list__group > h3 {
  padding-block: 7px 6px;
}

.notification-list__more {
  display: flex;
  justify-content: center;
  padding: 20px;
}
</style>
