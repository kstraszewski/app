<script setup lang="ts">
import type { InAppNotification } from '#shared/types/notifications'
import type { NotificationConnectionState } from '~/composables/useNotificationRealtime'

const props = withDefaults(defineProps<{
  notifications: InAppNotification[]
  unreadCount: number
  loading?: boolean
  refreshing?: boolean
  markingAllRead?: boolean
  error?: string | null
  connectionState?: NotificationConnectionState
  allNotificationsPath: string
  showClose?: boolean
}>(), {
  loading: false,
  refreshing: false,
  markingAllRead: false,
  error: null,
  connectionState: 'connecting',
  showClose: false,
})

const emit = defineEmits<{
  activate: [notification: InAppNotification]
  retry: []
  markAll: []
  close: []
}>()

const status = computed(() => {
  if (props.connectionState === 'connected') {
    return { label: 'Na żywo', className: 'notification-panel__status--live' }
  }
  if (props.connectionState === 'polling') {
    return { label: 'Synchronizacja', className: 'notification-panel__status--polling' }
  }
  if (props.connectionState === 'offline') {
    return { label: 'Offline', className: 'notification-panel__status--offline' }
  }
  return { label: 'Łączenie', className: 'notification-panel__status--connecting' }
})
</script>

<template>
  <section class="notification-panel" aria-labelledby="notification-panel-title">
    <header class="notification-panel__header">
      <div>
        <div class="notification-panel__title-row">
          <h2 id="notification-panel-title">Powiadomienia</h2>
          <UBadge v-if="unreadCount" color="primary" variant="subtle" size="sm">
            {{ unreadCount > 99 ? '99+' : unreadCount }}
          </UBadge>
        </div>
        <span class="notification-panel__status" :class="status.className">
          <i aria-hidden="true" />
          {{ refreshing ? 'Aktualizowanie' : status.label }}
        </span>
      </div>

      <div class="notification-panel__actions">
        <UButton
          color="neutral"
          variant="ghost"
          size="xs"
          icon="i-lucide-check-check"
          :loading="markingAllRead"
          :disabled="!unreadCount || markingAllRead"
          @click="emit('markAll')"
        >
          Przeczytaj wszystkie
        </UButton>
        <UButton
          v-if="showClose"
          color="neutral"
          variant="ghost"
          square
          icon="i-lucide-x"
          aria-label="Zamknij powiadomienia"
          @click="emit('close')"
        />
      </div>
    </header>

    <div
      v-if="connectionState === 'offline'"
      class="notification-panel__offline"
      role="status"
    >
      <UIcon name="i-lucide-wifi-off" aria-hidden="true" />
      Wyświetlam ostatnio zsynchronizowane dane. Połączenie wznowi się automatycznie.
    </div>

    <div class="notification-panel__body">
      <NotificationsCrmNotificationList
        :notifications="notifications"
        :loading="loading"
        :error="error"
        compact
        empty-title="Brak nowych powiadomień"
        empty-description="Gdy wydarzy się coś ważnego, zobaczysz to właśnie tutaj."
        @activate="emit('activate', $event)"
        @retry="emit('retry')"
      />
    </div>

    <footer class="notification-panel__footer">
      <NuxtLink :to="allNotificationsPath" @click="emit('close')">
        Zobacz wszystkie powiadomienia
        <UIcon name="i-lucide-arrow-right" aria-hidden="true" />
      </NuxtLink>
    </footer>
  </section>
</template>

<style scoped>
.notification-panel {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  width: min(400px, calc(100vw - 24px));
  max-height: min(680px, calc(100dvh - 32px));
  overflow: hidden;
  color: var(--ui-text);
  background: var(--ui-bg);
}

.notification-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid var(--ui-border-muted);
}

.notification-panel__title-row,
.notification-panel__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.notification-panel__title-row h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 1rem;
  line-height: 1.3;
}

.notification-panel__status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 5px;
  color: var(--ui-text-dimmed);
  font-size: 0.7rem;
}

.notification-panel__status i {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
}

.notification-panel__status--live {
  color: var(--ui-success);
}

.notification-panel__status--polling,
.notification-panel__status--connecting {
  color: var(--ui-warning);
}

.notification-panel__status--connecting i {
  animation: notification-pulse 1.25s ease-in-out infinite;
}

.notification-panel__status--offline {
  color: var(--ui-error);
}

.notification-panel__actions {
  flex: 0 0 auto;
}

.notification-panel__offline {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 9px 14px;
  color: var(--ui-warning);
  font-size: 0.75rem;
  line-height: 1.4;
  background: color-mix(in srgb, var(--ui-warning) 9%, var(--ui-bg));
}

.notification-panel__offline :deep(svg) {
  flex: 0 0 auto;
  width: 15px;
  height: 15px;
  margin-top: 1px;
}

.notification-panel__body {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.notification-panel__footer {
  padding: 11px 16px;
  border-top: 1px solid var(--ui-border-muted);
  background: var(--ui-bg-elevated);
}

.notification-panel__footer a {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  color: var(--ui-primary);
  font-size: 0.8125rem;
  font-weight: 650;
  text-decoration: none;
}

.notification-panel__footer a:hover {
  text-decoration: underline;
}

.notification-panel__footer :deep(svg) {
  width: 15px;
  height: 15px;
}

@keyframes notification-pulse {
  50% { opacity: 0.3; transform: scale(0.75); }
}

@media (max-width: 900px) {
  .notification-panel {
    width: 100%;
    height: 100%;
    max-height: none;
  }

  .notification-panel__header {
    padding-top: max(16px, env(safe-area-inset-top));
  }
}

@media (prefers-reduced-motion: reduce) {
  .notification-panel__status--connecting i {
    animation: none;
  }
}
</style>
