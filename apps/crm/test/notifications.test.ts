import assert from 'node:assert/strict'
import test from 'node:test'
import type { InAppNotification } from '../shared/types/notifications.ts'
import {
  NOTIFICATION_FEED_INVALIDATED_EVENT,
  mergeInAppNotifications,
  mergeNotificationIds,
  normalizeNotificationFeedResponse,
  normalizeNotificationRealtimeEvent,
  normalizeNotificationSnapshotResponse,
  notificationBadgeLabel,
  notificationFeedInvalidationMatches,
  safeNotificationActionPath,
} from '../app/utils/notifications.ts'

function notification(
  id: string,
  createdAt: string,
  overrides: Partial<InAppNotification> = {},
): InAppNotification {
  return {
    id,
    eventId: `event-${id}`,
    eventType: 'case.updated',
    priority: 'normal',
    title: `Powiadomienie ${id}`,
    body: 'Treść',
    icon: 'i-lucide-bell',
    tone: 'info',
    actionPath: '/org/acme/cases/123',
    actor: null,
    readAt: null,
    createdAt,
    ...overrides,
  }
}

test('normalizes the notification feed and rejects malformed entries', () => {
  const result = normalizeNotificationFeedResponse({
    data: [
      {
        id: 'notification-1',
        eventId: 'event-1',
        eventType: 'case.updated',
        priority: 'unexpected',
        title: 'Sprawa została zaktualizowana',
        body: 'Nowy dokument',
        icon: '',
        tone: 'unexpected',
        actionPath: '/org/acme/cases/123',
        actor: { userId: 'user-1', fullName: 'Jan Kowalski' },
        readAt: null,
        createdAt: '2026-08-03T10:00:00.000Z',
      },
      { id: 'missing-required-fields' },
    ],
    page: { nextCursor: 'cursor-2', hasMore: true },
    unreadCount: 7,
    generatedAt: '2026-08-03T10:01:00.000Z',
    revision: 42,
    realtime: {
      mode: 'polling',
      channel: null,
      pollIntervalMs: 1_000,
      safetyPollIntervalMs: 4_000,
    },
  })

  assert.ok(result)
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0]?.priority, 'normal')
  assert.equal(result.data[0]?.tone, 'neutral')
  assert.equal(result.data[0]?.icon, 'i-lucide-bell')
  assert.deepEqual(result.data[0]?.actor, {
    id: 'user-1',
    name: 'Jan Kowalski',
    avatarUrl: null,
  })
  assert.equal(result.realtime.channel, null)
  assert.equal(result.realtime.pollIntervalMs, 2_500)
  assert.equal(result.realtime.safetyPollIntervalMs, 15_000)
})

test('merges cursor pages without duplicates and keeps newest-first order', () => {
  const current = [
    notification('new', '2026-08-03T11:00:00.000Z'),
    notification('shared', '2026-08-03T10:00:00.000Z', { title: 'Stary tytuł' }),
  ]
  const incoming = [
    notification('shared', '2026-08-03T10:00:00.000Z', { title: 'Tytuł z serwera' }),
    notification('old', '2026-08-02T10:00:00.000Z'),
  ]

  const result = mergeInAppNotifications(current, incoming)

  assert.deepEqual(result.map(item => item.id), ['new', 'shared', 'old'])
  assert.equal(result[1]?.title, 'Tytuł z serwera')
})

test('prepends a realtime first page but appends cursor pagination', () => {
  assert.deepEqual(
    mergeNotificationIds(['older-1', 'older-2'], ['newest', 'older-1'], false),
    ['newest', 'older-1', 'older-2'],
  )
  assert.deepEqual(
    mergeNotificationIds(['newest', 'older-1'], ['older-1', 'oldest'], true),
    ['newest', 'older-1', 'oldest'],
  )
})

test('allows navigation only inside the active organization', () => {
  assert.equal(
    safeNotificationActionPath('/org/acme/cases/123?tab=files#latest', 'acme'),
    '/org/acme/cases/123?tab=files#latest',
  )
  assert.equal(safeNotificationActionPath('/org/other/cases/123', 'acme'), null)
  assert.equal(safeNotificationActionPath('/org/acme/../other', 'acme'), null)
  assert.equal(safeNotificationActionPath('//evil.example/org/acme', 'acme'), null)
  assert.equal(safeNotificationActionPath('https://evil.example/org/acme', 'acme'), null)
  assert.equal(safeNotificationActionPath('/org/acme\\@evil.example', 'acme'), null)
})

test('scopes local notification invalidations to the active organization', () => {
  const event = new CustomEvent(NOTIFICATION_FEED_INVALIDATED_EVENT, {
    detail: { organizationSlug: 'acme' },
  })
  assert.equal(notificationFeedInvalidationMatches(event, 'acme'), true)
  assert.equal(notificationFeedInvalidationMatches(event, 'other'), false)
  assert.equal(notificationFeedInvalidationMatches(new Event('other'), 'acme'), false)
})

test('normalizes the minimal invalidation-only realtime event', () => {
  assert.deepEqual(normalizeNotificationRealtimeEvent({
    schemaVersion: 1,
    kind: 'notifications.changed',
    eventId: 'realtime-1',
    revision: 43,
  }), {
    schemaVersion: 1,
    kind: 'notifications.changed',
    eventId: 'realtime-1',
    revision: 43,
  })
  assert.equal(normalizeNotificationRealtimeEvent({
    schemaVersion: 1,
    kind: 'notification.created',
    eventId: 'realtime-2',
    revision: 44,
  }), null)
})

test('preserves the snapshot last event and polling transport', () => {
  const result = normalizeNotificationSnapshotResponse({
    data: {
      revision: 44,
      lastEvent: {
        schemaVersion: 1,
        kind: 'notifications.changed',
        eventId: 'realtime-2',
        revision: 44,
      },
      updatedAt: '2026-08-03T11:00:00.000Z',
      realtime: {
        mode: 'polling',
        channel: null,
        pollIntervalMs: 5_000,
        safetyPollIntervalMs: 45_000,
      },
    },
  })

  assert.equal(result?.data.revision, 44)
  assert.equal(result?.data.lastEvent?.eventId, 'realtime-2')
  assert.equal(result?.data.realtime.mode, 'polling')
})

test('caps the notification badge at 99+', () => {
  assert.equal(notificationBadgeLabel(0), '0')
  assert.equal(notificationBadgeLabel(99), '99')
  assert.equal(notificationBadgeLabel(120), '99+')
})
