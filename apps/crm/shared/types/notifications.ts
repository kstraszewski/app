export type InAppNotificationPriority = 'low' | 'normal' | 'high' | 'urgent'

export type InAppNotificationTone = 'neutral' | 'info' | 'success' | 'warning' | 'error'

export interface InAppNotificationActor {
  id: string | null
  name: string
  avatarUrl: string | null
}

export interface InAppNotification {
  id: string
  eventId: string
  eventType: string
  priority: InAppNotificationPriority
  title: string
  body: string
  icon: string
  tone: InAppNotificationTone
  actionPath: string | null
  actor: InAppNotificationActor | null
  readAt: string | null
  createdAt: string
}

export type NotificationRealtimeMode = 'ably' | 'polling'

export interface NotificationRealtimeTransport {
  mode: NotificationRealtimeMode
  channel: string | null
  pollIntervalMs: number
  safetyPollIntervalMs: number
}

export interface NotificationPageInfo {
  nextCursor: string | null
  hasMore: boolean
}

export interface NotificationFeedResponse {
  data: InAppNotification[]
  page: NotificationPageInfo
  unreadCount: number
  generatedAt: string
  revision: number
  realtime: NotificationRealtimeTransport
}

export interface NotificationReadResponse {
  data: {
    id: string
    readAt: string | null
  }
  changed: boolean
  revision: number
}

export interface NotificationsReadAllResponse {
  data: {
    readAt: string
    count: number
  }
  changed: boolean
  revision: number
}

export type NotificationRealtimeEventKind = 'notifications.changed'

/**
 * Realtime messages intentionally carry only invalidation metadata. The client
 * always reconciles through the authenticated HTTP feed, which keeps Ably (or
 * a future transport) out of the authorization boundary.
 */
export interface NotificationRealtimeEvent {
  schemaVersion: 1
  eventId: string
  kind: NotificationRealtimeEventKind
  revision: number
}

export interface NotificationRealtimeSnapshot {
  revision: number
  lastEvent: NotificationRealtimeEvent | null
  updatedAt: string | null
  realtime: NotificationRealtimeTransport
}

export interface NotificationRealtimeSnapshotResponse {
  data: NotificationRealtimeSnapshot
}

export interface NotificationRealtimeTokenResponse {
  data: {
    tokenRequest: unknown
    channel: string
    clientId: string
  }
}
