<script setup lang="ts">
import type { InAppNotification } from '#shared/types/notifications'
import {
  notificationBadgeLabel,
  safeNotificationActionPath,
} from '~/utils/notifications'

const props = defineProps<{
  organizationSlug: string
}>()

const toast = useToast()
const route = useRoute()
const notificationOpen = ref(false)
const mobileViewport = ref(false)
const bellButton = ref<HTMLButtonElement | null>(null)
const bellReference = computed(() => bellButton.value || undefined)
const bellPulse = ref(false)
let viewportMedia: MediaQueryList | null = null
let pulseTimer: ReturnType<typeof setTimeout> | null = null
let hasMounted = false

const organizationSlug = computed(() => props.organizationSlug)
const {
  state,
  allNotifications,
  sync,
  markRead,
  markAllRead,
} = await useNotifications(organizationSlug)

const notificationBase = computed(() => (
  `/api/org/${encodeURIComponent(organizationSlug.value)}/notifications`
))
const allNotificationsPath = computed(() => (
  `/org/${encodeURIComponent(organizationSlug.value)}/notifications`
))
const visibleNotifications = computed(() => allNotifications.value.slice(0, 10))
const badgeLabel = computed(() => notificationBadgeLabel(state.value.unreadCount))
const bellLabel = computed(() => state.value.unreadCount
  ? `Powiadomienia, ${state.value.unreadCount} nieprzeczytanych`
  : 'Powiadomienia, brak nieprzeczytanych')
const liveAnnouncement = computed(() => state.value.unreadCount
  ? `Masz ${state.value.unreadCount} nieprzeczytanych powiadomień.`
  : 'Nie masz nieprzeczytanych powiadomień.')

const { connectionState } = useNotificationRealtime({
  organizationKey: organizationSlug,
  stateEndpoint: computed(() => `${notificationBase.value}/realtime`),
  tokenEndpoint: computed(() => `${notificationBase.value}/realtime/token`),
  currentRevision: computed(() => state.value.revision),
  onInvalidate: () => sync({ silent: true, replace: true }),
})

function toggleNotifications() {
  notificationOpen.value = !notificationOpen.value
}

function closeNotifications() {
  notificationOpen.value = false
}

async function refreshNotifications() {
  try {
    await sync()
  }
  catch {
    // The panel renders the shared request error and its retry action.
  }
}

async function handleMarkAllRead() {
  try {
    await markAllRead()
  }
  catch {
    toast.add({
      title: 'Nie udało się oznaczyć powiadomień',
      description: 'Stan został przywrócony. Spróbuj ponownie.',
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
        ? 'Otwieram wskazane miejsce; status spróbujemy zsynchronizować później.'
        : 'Spróbuj ponownie po odzyskaniu połączenia.',
      color: 'warning',
      icon: 'i-lucide-wifi-off',
    })
  }
  finally {
    if (target) {
      closeNotifications()
      await navigateTo(target)
    }
  }
}

function updateViewport() {
  mobileViewport.value = viewportMedia?.matches ?? false
}

watch(notificationOpen, (open) => {
  if (open) {
    void sync({ silent: true }).catch(() => {})
    return
  }
  if (hasMounted) nextTick(() => bellButton.value?.focus())
})

watch(() => route.fullPath, closeNotifications)

watch(() => state.value.unreadCount, (next, previous) => {
  if (!hasMounted || next <= previous) return
  bellPulse.value = true
  if (pulseTimer) clearTimeout(pulseTimer)
  pulseTimer = setTimeout(() => {
    bellPulse.value = false
  }, 1_000)
})

onMounted(() => {
  hasMounted = true
  viewportMedia = window.matchMedia('(max-width: 900px)')
  updateViewport()
  viewportMedia.addEventListener('change', updateViewport)
})

onBeforeUnmount(() => {
  viewportMedia?.removeEventListener('change', updateViewport)
  if (pulseTimer) clearTimeout(pulseTimer)
})
</script>

<template>
  <div class="notification-center">
    <button
      ref="bellButton"
      type="button"
      class="notification-center__trigger"
      :class="{ 'notification-center__trigger--pulse': bellPulse }"
      :aria-label="bellLabel"
      :title="bellLabel"
      aria-haspopup="dialog"
      :aria-expanded="notificationOpen"
      @click="toggleNotifications"
    >
      <UIcon name="i-lucide-bell" aria-hidden="true" />
      <span
        v-if="state.unreadCount"
        class="notification-center__badge"
        aria-hidden="true"
      >
        {{ badgeLabel }}
      </span>
    </button>

    <span class="sr-only" aria-live="polite" aria-atomic="true">
      {{ liveAnnouncement }}
    </span>

    <UPopover
      v-if="!mobileViewport"
      :open="notificationOpen"
      :reference="bellReference"
      :content="{ align: 'end', side: 'bottom', sideOffset: 10, collisionPadding: 12 }"
      :ui="{ content: 'p-0 overflow-hidden' }"
      @update:open="notificationOpen = $event"
    >
      <template #content>
        <NotificationsCrmNotificationPanel
          :notifications="visibleNotifications"
          :unread-count="state.unreadCount"
          :loading="state.initialLoading && !visibleNotifications.length"
          :refreshing="state.refreshing"
          :marking-all-read="state.markingAllRead"
          :error="state.feeds.all.error"
          :connection-state="connectionState"
          :all-notifications-path="allNotificationsPath"
          @activate="activateNotification"
          @retry="refreshNotifications"
          @mark-all="handleMarkAllRead"
          @close="closeNotifications"
        />
      </template>
    </UPopover>

    <USlideover
      v-else
      :open="notificationOpen"
      title="Powiadomienia"
      description="Najnowsze zdarzenia w aktywnej organizacji"
      :close="false"
      :ui="{
        overlay: 'z-[70]',
        content: 'z-[70] w-full max-w-full sm:max-w-md',
        header: 'sr-only',
        body: 'p-0 sm:p-0 overflow-hidden',
      }"
      @update:open="notificationOpen = $event"
    >
      <template #body>
        <NotificationsCrmNotificationPanel
          class="notification-center__mobile-panel"
          :notifications="visibleNotifications"
          :unread-count="state.unreadCount"
          :loading="state.initialLoading && !visibleNotifications.length"
          :refreshing="state.refreshing"
          :marking-all-read="state.markingAllRead"
          :error="state.feeds.all.error"
          :connection-state="connectionState"
          :all-notifications-path="allNotificationsPath"
          show-close
          @activate="activateNotification"
          @retry="refreshNotifications"
          @mark-all="handleMarkAllRead"
          @close="closeNotifications"
        />
      </template>
    </USlideover>
  </div>
</template>

<style scoped>
.notification-center {
  display: inline-flex;
  flex: 0 0 auto;
}

.notification-center__trigger {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: var(--ui-radius-md, 8px);
  color: inherit;
  background: transparent;
  cursor: pointer;
  transition:
    color var(--oe-motion-fast, 120ms ease),
    background-color var(--oe-motion-fast, 120ms ease);
}

.notification-center__trigger:hover,
.notification-center__trigger:focus-visible,
.notification-center__trigger[aria-expanded="true"] {
  color: var(--ui-text-inverted);
  background: color-mix(in srgb, currentColor 12%, transparent);
}

.notification-center__trigger:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}

.notification-center__trigger > :deep(svg) {
  width: 18px;
  height: 18px;
}

.notification-center__badge {
  position: absolute;
  top: -5px;
  right: -7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding-inline: 4px;
  border: 2px solid var(--crm-nav-bg, var(--ui-bg));
  border-radius: 999px;
  color: white;
  font-size: 0.625rem;
  font-weight: 800;
  line-height: 1;
  background: var(--ui-error);
  box-shadow: 0 2px 6px color-mix(in srgb, black 24%, transparent);
}

.notification-center__trigger--pulse {
  animation: notification-bell-pulse 480ms ease-out 2;
}

.notification-center__mobile-panel {
  min-height: 100%;
}

@keyframes notification-bell-pulse {
  40% { transform: rotate(9deg) scale(1.08); }
  70% { transform: rotate(-7deg); }
}

@media (max-width: 900px) {
  .notification-center__trigger {
    width: 44px;
    height: 44px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .notification-center__trigger--pulse {
    animation: none;
  }
}
</style>
