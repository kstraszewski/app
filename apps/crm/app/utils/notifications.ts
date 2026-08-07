import type {
  InAppNotification,
  InAppNotificationActor,
  InAppNotificationPriority,
  InAppNotificationTone,
  NotificationFeedResponse,
  NotificationReadResponse,
  NotificationRealtimeEvent,
  NotificationRealtimeSnapshotResponse,
  NotificationRealtimeTransport,
  NotificationsReadAllResponse,
} from '#shared/types/notifications'

const notificationPriorities = new Set<InAppNotificationPriority>([
  'low',
  'normal',
  'high',
  'urgent',
])

const notificationTones = new Set<InAppNotificationTone>([
  'neutral',
  'info',
  'success',
  'warning',
  'error',
])

const defaultPollIntervalMs = 5_000
const defaultSafetyPollIntervalMs = 45_000
const notificationTimeZone = 'Europe/Warsaw'

export const NOTIFICATION_FEED_INVALIDATED_EVENT = 'openexpert:notifications-feed-invalidated'

export function dispatchNotificationFeedInvalidated(organizationSlug: string) {
  if (typeof window === 'undefined' || !organizationSlug) return
  window.dispatchEvent(new CustomEvent(NOTIFICATION_FEED_INVALIDATED_EVENT, {
    detail: { organizationSlug },
  }))
}

export function notificationFeedInvalidationMatches(
  event: Event,
  organizationSlug: string,
) {
  if (
    typeof CustomEvent === 'undefined'
    || !(event instanceof CustomEvent)
    || !isNotificationRecord(event.detail)
  ) return false
  return event.detail.organizationSlug === organizationSlug
}

export function isNotificationRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizedString(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

export function normalizeNotificationDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  return Number.isNaN(Date.parse(value)) ? null : value
}

export function normalizeNotificationRevision(value: unknown): number {
  const revision = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0
}

export function normalizeNotificationActor(value: unknown): InAppNotificationActor | null {
  if (!isNotificationRecord(value)) return null

  const name = normalizedString(value.name)
    || normalizedString(value.fullName)
    || normalizedString(value.displayName)
  if (!name) return null

  return {
    id: normalizedString(value.id) || normalizedString(value.userId) || null,
    name,
    avatarUrl: normalizedString(value.avatarUrl) || null,
  }
}

export function normalizeInAppNotification(value: unknown): InAppNotification | null {
  if (!isNotificationRecord(value)) return null

  const id = normalizedString(value.id)
  const eventId = normalizedString(value.eventId)
  const eventType = normalizedString(value.eventType)
  const title = normalizedString(value.title)
  const createdAt = normalizeNotificationDate(value.createdAt)
  if (!id || !eventId || !eventType || !title || !createdAt) return null

  const priority = notificationPriorities.has(value.priority as InAppNotificationPriority)
    ? value.priority as InAppNotificationPriority
    : 'normal'
  const tone = notificationTones.has(value.tone as InAppNotificationTone)
    ? value.tone as InAppNotificationTone
    : 'neutral'

  return {
    id,
    eventId,
    eventType,
    priority,
    title,
    body: normalizedString(value.body),
    icon: normalizedString(value.icon, 'i-lucide-bell'),
    tone,
    actionPath: normalizedString(value.actionPath) || null,
    actor: normalizeNotificationActor(value.actor),
    readAt: normalizeNotificationDate(value.readAt),
    createdAt,
  }
}

export function normalizeNotificationTransport(value: unknown): NotificationRealtimeTransport {
  const input = isNotificationRecord(value) ? value : {}
  const pollIntervalMs = Math.max(
    2_500,
    normalizeNotificationRevision(input.pollIntervalMs) || defaultPollIntervalMs,
  )
  const safetyPollIntervalMs = Math.max(
    15_000,
    normalizeNotificationRevision(input.safetyPollIntervalMs) || defaultSafetyPollIntervalMs,
  )

  return {
    mode: input.mode === 'ably' ? 'ably' : 'polling',
    channel: normalizedString(input.channel) || null,
    pollIntervalMs,
    safetyPollIntervalMs,
  }
}

export function normalizeNotificationFeedResponse(value: unknown): NotificationFeedResponse | null {
  if (!isNotificationRecord(value) || !Array.isArray(value.data)) return null

  const page = isNotificationRecord(value.page) ? value.page : {}
  const generatedAt = normalizeNotificationDate(value.generatedAt)
  if (!generatedAt) return null

  const data = value.data
    .map(normalizeInAppNotification)
    .filter((notification): notification is InAppNotification => Boolean(notification))

  return {
    data,
    page: {
      nextCursor: normalizedString(page.nextCursor) || null,
      hasMore: page.hasMore === true,
    },
    unreadCount: Math.max(0, normalizeNotificationRevision(value.unreadCount)),
    generatedAt,
    revision: normalizeNotificationRevision(value.revision),
    realtime: normalizeNotificationTransport(value.realtime),
  }
}

export function normalizeNotificationReadResponse(value: unknown): NotificationReadResponse | null {
  if (!isNotificationRecord(value) || !isNotificationRecord(value.data)) return null
  const id = normalizedString(value.data.id)
  if (!id) return null

  return {
    data: {
      id,
      readAt: normalizeNotificationDate(value.data.readAt),
    },
    changed: value.changed === true,
    revision: normalizeNotificationRevision(value.revision),
  }
}

export function normalizeNotificationsReadAllResponse(value: unknown): NotificationsReadAllResponse | null {
  if (!isNotificationRecord(value) || !isNotificationRecord(value.data)) return null
  const readAt = normalizeNotificationDate(value.data.readAt)
  if (!readAt) return null

  return {
    data: {
      readAt,
      count: Math.max(0, normalizeNotificationRevision(value.data.count)),
    },
    changed: value.changed === true,
    revision: normalizeNotificationRevision(value.revision),
  }
}

export function normalizeNotificationSnapshotResponse(
  value: unknown,
): NotificationRealtimeSnapshotResponse | null {
  const envelope = isNotificationRecord(value) && isNotificationRecord(value.data)
    ? value.data
    : value
  if (!isNotificationRecord(envelope)) return null

  return {
    data: {
      revision: normalizeNotificationRevision(envelope.revision),
      lastEvent: normalizeNotificationRealtimeEvent(envelope.lastEvent),
      updatedAt: normalizeNotificationDate(envelope.updatedAt),
      realtime: normalizeNotificationTransport(envelope.realtime),
    },
  }
}

export function normalizeNotificationRealtimeEvent(value: unknown): NotificationRealtimeEvent | null {
  if (!isNotificationRecord(value)) return null
  const eventId = normalizedString(value.eventId)
  const revision = normalizeNotificationRevision(value.revision)
  if (
    value.schemaVersion !== 1
    || value.kind !== 'notifications.changed'
    || !eventId
    || revision < 1
  ) return null

  return {
    schemaVersion: 1,
    kind: 'notifications.changed',
    eventId,
    revision,
  }
}

/** Keep the newest server representation while preserving stable newest-first order. */
export function mergeInAppNotifications(
  current: InAppNotification[],
  incoming: InAppNotification[],
): InAppNotification[] {
  const byId = new Map<string, InAppNotification>()
  for (const notification of current) byId.set(notification.id, notification)
  for (const notification of incoming) byId.set(notification.id, notification)

  return [...byId.values()].sort((left, right) => {
    const createdDifference = Date.parse(right.createdAt) - Date.parse(left.createdAt)
    return createdDifference || right.id.localeCompare(left.id)
  })
}

export function mergeNotificationIds(
  currentIds: string[],
  incomingIds: string[],
  paginated: boolean,
) {
  return paginated
    ? [...new Set([...currentIds, ...incomingIds])]
    : [...new Set([...incomingIds, ...currentIds])]
}

export function notificationBadgeLabel(unreadCount: number) {
  const safeCount = Math.max(0, Math.trunc(unreadCount))
  return safeCount > 99 ? '99+' : String(safeCount)
}

/**
 * Notifications are allowed to navigate only inside the active organization.
 * This rejects protocol-relative URLs, external origins and sibling tenants.
 */
export function safeNotificationActionPath(
  actionPath: string | null | undefined,
  organizationSlug: string,
): string | null {
  if (!actionPath || !organizationSlug) return null
  const candidate = actionPath.trim()
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\')) return null

  try {
    const parsed = new URL(candidate, 'https://crm.openexpert.local')
    if (parsed.origin !== 'https://crm.openexpert.local') return null

    const organizationRoot = `/org/${encodeURIComponent(organizationSlug)}`
    if (
      parsed.pathname !== organizationRoot
      && !parsed.pathname.startsWith(`${organizationRoot}/`)
    ) return null

    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  }
  catch {
    return null
  }
}

export function notificationDayKey(createdAt: string, locale = 'pl-PL') {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: notificationTimeZone,
  }).format(new Date(createdAt))
}

export function notificationDayLabel(createdAt: string, locale = 'pl-PL') {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: notificationTimeZone,
  }).format(new Date(createdAt))
}

export function notificationRelativeTime(
  createdAt: string,
  now = Date.now(),
  locale = 'pl-PL',
) {
  const differenceSeconds = Math.round((Date.parse(createdAt) - now) / 1_000)
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const absoluteSeconds = Math.abs(differenceSeconds)

  // A stable label avoids SSR hydration drift caused by a one-second
  // difference between the server render and browser hydration.
  if (absoluteSeconds < 60) return 'przed chwilą'
  if (absoluteSeconds < 3_600) return formatter.format(Math.round(differenceSeconds / 60), 'minute')
  if (absoluteSeconds < 86_400) return formatter.format(Math.round(differenceSeconds / 3_600), 'hour')
  if (absoluteSeconds < 604_800) return formatter.format(Math.round(differenceSeconds / 86_400), 'day')

  const yearFormatter = new Intl.DateTimeFormat('en', {
    year: 'numeric',
    timeZone: notificationTimeZone,
  })
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: yearFormatter.format(new Date(createdAt)) === yearFormatter.format(new Date(now))
      ? undefined
      : 'numeric',
    timeZone: notificationTimeZone,
  }).format(new Date(createdAt))
}
