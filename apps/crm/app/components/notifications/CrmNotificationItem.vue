<script setup lang="ts">
import type { InAppNotification } from '#shared/types/notifications'
import { notificationRelativeTime } from '~/utils/notifications'

const props = withDefaults(defineProps<{
  notification: InAppNotification
  compact?: boolean
  busy?: boolean
}>(), {
  compact: false,
  busy: false,
})

const emit = defineEmits<{
  activate: [notification: InAppNotification]
}>()

const actorInitials = computed(() => (
  props.notification.actor?.name
    .split(/\s+/u)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || undefined
))
const relativeTime = computed(() => notificationRelativeTime(props.notification.createdAt))
const fullTime = computed(() => new Intl.DateTimeFormat('pl-PL', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'Europe/Warsaw',
}).format(new Date(props.notification.createdAt)))
</script>

<template>
  <button
    type="button"
    class="notification-item"
    :class="{
      'notification-item--unread': !notification.readAt,
      'notification-item--compact': compact,
    }"
    :disabled="busy"
    :aria-label="`${notification.readAt ? '' : 'Nieprzeczytane: '}${notification.title}`"
    @click="emit('activate', notification)"
  >
    <span
      class="notification-item__icon"
      :class="`notification-item__icon--${notification.tone}`"
      aria-hidden="true"
    >
      <UIcon :name="notification.icon || 'i-lucide-bell'" />
    </span>

    <span class="notification-item__content">
      <span class="notification-item__heading">
        <strong>{{ notification.title }}</strong>
        <span v-if="!notification.readAt" class="notification-item__unread-dot" aria-hidden="true" />
      </span>
      <span v-if="notification.body" class="notification-item__body">
        {{ notification.body }}
      </span>
      <span class="notification-item__meta">
        <span v-if="notification.actor" class="notification-item__actor">
          <UAvatar
            :src="notification.actor.avatarUrl || undefined"
            :alt="notification.actor.name"
            :text="actorInitials"
            size="3xs"
          />
          <span>{{ notification.actor.name }}</span>
        </span>
        <time :datetime="notification.createdAt" :title="fullTime">{{ relativeTime }}</time>
        <UBadge
          v-if="notification.priority === 'urgent'"
          color="error"
          variant="subtle"
          size="xs"
        >
          Pilne
        </UBadge>
      </span>
    </span>

    <UIcon
      v-if="notification.actionPath"
      class="notification-item__arrow"
      name="i-lucide-chevron-right"
      aria-hidden="true"
    />
  </button>
</template>

<style scoped>
.notification-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 12px;
  width: 100%;
  padding: 14px 16px;
  border: 0;
  border-bottom: 1px solid var(--ui-border-muted);
  color: var(--ui-text);
  text-align: left;
  background: var(--ui-bg);
  cursor: pointer;
  transition: background-color var(--oe-motion-fast, 120ms ease);
}

.notification-item:hover,
.notification-item:focus-visible {
  background: var(--ui-bg-muted);
}

.notification-item:focus-visible {
  position: relative;
  z-index: 1;
  outline: 2px solid var(--ui-primary);
  outline-offset: -2px;
}

.notification-item:disabled {
  cursor: wait;
  opacity: 0.7;
}

.notification-item--unread {
  background: color-mix(in srgb, var(--ui-primary) 5%, var(--ui-bg));
}

.notification-item__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 12px;
  color: var(--ui-text-muted);
  background: var(--ui-bg-elevated);
}

.notification-item__icon :deep(svg) {
  width: 18px;
  height: 18px;
}

.notification-item__icon--info {
  color: var(--ui-info);
  background: color-mix(in srgb, var(--ui-info) 12%, var(--ui-bg));
}

.notification-item__icon--success {
  color: var(--ui-success);
  background: color-mix(in srgb, var(--ui-success) 12%, var(--ui-bg));
}

.notification-item__icon--warning {
  color: var(--ui-warning);
  background: color-mix(in srgb, var(--ui-warning) 14%, var(--ui-bg));
}

.notification-item__icon--error {
  color: var(--ui-error);
  background: color-mix(in srgb, var(--ui-error) 12%, var(--ui-bg));
}

.notification-item__content,
.notification-item__heading,
.notification-item__meta,
.notification-item__actor {
  min-width: 0;
}

.notification-item__content {
  display: grid;
  gap: 5px;
}

.notification-item__heading {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.notification-item__heading strong {
  overflow: hidden;
  font-size: 0.875rem;
  line-height: 1.35;
  text-overflow: ellipsis;
}

.notification-item__unread-dot {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  margin-top: 5px;
  border-radius: 999px;
  background: var(--ui-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ui-primary) 14%, transparent);
}

.notification-item__body {
  display: -webkit-box;
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 0.8125rem;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.notification-item--compact .notification-item__body {
  -webkit-line-clamp: 2;
}

.notification-item__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  color: var(--ui-text-dimmed);
  font-size: 0.72rem;
}

.notification-item__actor {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  overflow: hidden;
}

.notification-item__actor > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notification-item__arrow {
  align-self: center;
  width: 16px;
  height: 16px;
  color: var(--ui-text-dimmed);
}

@media (max-width: 560px) {
  .notification-item {
    padding-inline: 14px;
  }
}
</style>
