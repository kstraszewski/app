import type {
  InAppNotification,
  NotificationFeedResponse,
  NotificationRealtimeTransport,
} from '#shared/types/notifications'
import {
  mergeInAppNotifications,
  mergeNotificationIds,
  normalizeNotificationFeedResponse,
  normalizeNotificationReadResponse,
  normalizeNotificationsReadAllResponse,
} from '~/utils/notifications'

type NotificationFeedKind = 'all' | 'unread'

interface NotificationCollectionState {
  ids: string[]
  nextCursor: string | null
  hasMore: boolean
  loaded: boolean
  loading: boolean
  error: string | null
}

interface NotificationsState {
  scopeKey: string
  items: InAppNotification[]
  feeds: Record<NotificationFeedKind, NotificationCollectionState>
  unreadCount: number
  generatedAt: string | null
  revision: number
  realtime: NotificationRealtimeTransport
  initialLoading: boolean
  refreshing: boolean
  markingAllRead: boolean
  error: string | null
  lastSyncedAt: string | null
}

interface LoadOptions {
  replace?: boolean
  silent?: boolean
}

const defaultRealtime: NotificationRealtimeTransport = {
  mode: 'polling',
  channel: null,
  pollIntervalMs: 5_000,
  safetyPollIntervalMs: 45_000,
}

function emptyCollection(): NotificationCollectionState {
  return {
    ids: [],
    nextCursor: null,
    hasMore: false,
    loaded: false,
    loading: false,
    error: null,
  }
}

function emptyNotificationsState(scopeKey = ''): NotificationsState {
  return {
    scopeKey,
    items: [],
    feeds: {
      all: emptyCollection(),
      unread: emptyCollection(),
    },
    unreadCount: 0,
    generatedAt: null,
    revision: 0,
    realtime: { ...defaultRealtime },
    initialLoading: true,
    refreshing: false,
    markingAllRead: false,
    error: null,
    lastSyncedAt: null,
  }
}

function requestErrorMessage(error: unknown) {
  if (error && typeof error === 'object') {
    const candidate = error as {
      data?: { statusMessage?: unknown, message?: unknown }
      statusMessage?: unknown
      message?: unknown
    }
    const message = candidate.data?.statusMessage
      || candidate.data?.message
      || candidate.statusMessage
      || candidate.message
    if (typeof message === 'string' && message.trim()) return message.trim()
  }

  return 'Nie udało się pobrać powiadomień. Spróbuj ponownie.'
}

function notificationEndpoint(organizationSlug: string) {
  return `/api/org/${encodeURIComponent(organizationSlug)}/notifications`
}

export async function useNotifications(organizationSlug: MaybeRefOrGetter<string>) {
  const user = useAuthUser()
  const requestFetch = useRequestFetch()
  const slug = computed(() => String(toValue(organizationSlug) || '').trim())
  const scopeKey = computed(() => `${user.value?.id || 'anonymous'}:${slug.value}`)
  const state = useState<NotificationsState>(
    'openexpert-in-app-notifications',
    () => emptyNotificationsState(scopeKey.value),
  )

  if (state.value.scopeKey !== scopeKey.value) {
    state.value = emptyNotificationsState(scopeKey.value)
  }

  let syncPromise: Promise<void> | null = null
  let syncReplacing = false
  let scopeGeneration = 0

  function applyResponse(
    response: NotificationFeedResponse,
    kind: NotificationFeedKind,
    options: { replace: boolean, paginated: boolean },
  ) {
    const collection = state.value.feeds[kind]
    const responseIsCurrent = response.revision >= state.value.revision
    const currentById = new Map(state.value.items.map(notification => [notification.id, notification]))
    const incoming = responseIsCurrent
      ? response.data
      : response.data.map(notification => currentById.get(notification.id) ?? notification)
    state.value.items = mergeInAppNotifications(state.value.items, incoming)

    const incomingIds = response.data.map(notification => notification.id)
    if (options.replace && responseIsCurrent) {
      collection.ids = incomingIds
    }
    else {
      collection.ids = mergeNotificationIds(
        collection.ids,
        incomingIds,
        options.paginated,
      )
    }

    if (options.replace || options.paginated || !collection.loaded) {
      collection.nextCursor = response.page.nextCursor
      collection.hasMore = response.page.hasMore
    }
    collection.loaded = true
    collection.error = null

    if (responseIsCurrent) {
      state.value.unreadCount = response.unreadCount
      state.value.generatedAt = response.generatedAt
      state.value.revision = response.revision
      state.value.realtime = response.realtime
      state.value.lastSyncedAt = new Date().toISOString()
    }
    state.value.error = null

    if (kind === 'all' && state.value.feeds.unread.loaded) {
      const unreadIds = new Set(
        state.value.items
          .filter(notification => !notification.readAt)
          .map(notification => notification.id),
      )
      state.value.feeds.unread.ids = state.value.feeds.unread.ids
        .filter(id => unreadIds.has(id))
    }
  }

  const initialSlug = slug.value
  const initialScope = scopeKey.value
  const initialUrl = initialSlug
    ? `${notificationEndpoint(initialSlug)}?limit=30&unreadOnly=false`
    : '/api/notifications/unavailable'
  const {
    data: initialData,
    error: initialError,
    status: initialStatus,
  } = await useFetch<unknown>(initialUrl, {
    key: `notifications:${initialScope}:initial`,
    headers: { 'cache-control': 'no-cache' },
    server: Boolean(initialSlug),
    immediate: Boolean(initialSlug),
  })

  if (state.value.scopeKey === initialScope) {
    const response = normalizeNotificationFeedResponse(initialData.value)
    if (response) applyResponse(response, 'all', { replace: true, paginated: false })
    state.value.initialLoading = initialStatus.value === 'pending'
    if (initialError.value) {
      state.value.error = requestErrorMessage(initialError.value)
      state.value.feeds.all.error = state.value.error
    }
  }

  async function requestPage(
    kind: NotificationFeedKind,
    cursor: string | null,
    options: LoadOptions = {},
  ) {
    const requestScope = state.value.scopeKey
    const requestSlug = slug.value
    if (!requestSlug || !requestScope.endsWith(`:${requestSlug}`)) return

    const collection = state.value.feeds[kind]
    if (collection.loading) return
    collection.loading = true
    collection.error = null
    if (!options.silent) state.value.error = null

    try {
      const responseValue = await requestFetch<unknown>(notificationEndpoint(requestSlug), {
        query: {
          limit: 30,
          unreadOnly: kind === 'unread',
          ...(cursor ? { cursor } : {}),
        },
        headers: { 'cache-control': 'no-cache' },
      })
      if (state.value.scopeKey !== requestScope) return

      const response = normalizeNotificationFeedResponse(responseValue)
      if (!response) throw new Error('Nieprawidłowa odpowiedź serwera powiadomień.')
      applyResponse(response, kind, {
        replace: options.replace === true,
        paginated: Boolean(cursor),
      })
    }
    catch (error) {
      if (state.value.scopeKey !== requestScope) return
      const message = requestErrorMessage(error)
      collection.error = message
      if (!options.silent) state.value.error = message
      throw error
    }
    finally {
      if (state.value.scopeKey === requestScope) collection.loading = false
    }
  }

  async function sync(options: LoadOptions = {}) {
    if (syncPromise) {
      const activeRequest = syncPromise
      const activeRequestReplaces = syncReplacing
      await activeRequest
      if (options.replace && !activeRequestReplaces) return sync(options)
      return
    }
    const generation = scopeGeneration
    syncReplacing = options.replace === true

    const request = (async () => {
      state.value.refreshing = !options.silent
      try {
        const tasks: Promise<void>[] = [requestPage('all', null, {
          replace: options.replace === true,
          silent: options.silent,
        })]
        if (state.value.feeds.unread.loaded) {
          tasks.push(requestPage('unread', null, {
            replace: options.replace === true,
            silent: true,
          }))
        }
        await Promise.all(tasks)
      }
      finally {
        if (generation === scopeGeneration) state.value.refreshing = false
      }
    })()
    syncPromise = request

    try {
      await request
    }
    finally {
      if (syncPromise === request) {
        syncPromise = null
        syncReplacing = false
      }
    }
  }

  async function ensureFeed(kind: NotificationFeedKind) {
    if (state.value.feeds[kind].loaded) return
    await requestPage(kind, null, { replace: true })
  }

  async function loadMore(kind: NotificationFeedKind) {
    const collection = state.value.feeds[kind]
    if (!collection.hasMore || !collection.nextCursor || collection.loading) return
    await requestPage(kind, collection.nextCursor)
  }

  async function markRead(notificationId: string) {
    const notification = state.value.items.find(item => item.id === notificationId)
    if (!notification || notification.readAt) return

    const requestScope = state.value.scopeKey
    const requestSlug = slug.value
    const previousUnreadCount = state.value.unreadCount
    const previousUnreadIds = [...state.value.feeds.unread.ids]
    const optimisticReadAt = new Date().toISOString()
    notification.readAt = optimisticReadAt
    state.value.unreadCount = Math.max(0, state.value.unreadCount - 1)
    state.value.feeds.unread.ids = state.value.feeds.unread.ids
      .filter(id => id !== notificationId)

    try {
      const responseValue = await requestFetch<unknown>(
        `${notificationEndpoint(requestSlug)}/${encodeURIComponent(notificationId)}`,
        { method: 'PATCH' },
      )
      if (state.value.scopeKey !== requestScope) return

      const response = normalizeNotificationReadResponse(responseValue)
      if (!response) throw new Error('Nieprawidłowa odpowiedź serwera powiadomień.')
      const current = state.value.items.find(item => item.id === notificationId)
      if (current) current.readAt = response.data.readAt || optimisticReadAt
      state.value.revision = Math.max(state.value.revision, response.revision)
      void sync({ silent: true }).catch(() => {})
    }
    catch (error) {
      if (state.value.scopeKey === requestScope) {
        const current = state.value.items.find(item => item.id === notificationId)
        if (current?.readAt === optimisticReadAt) current.readAt = null
        state.value.unreadCount = previousUnreadCount
        state.value.feeds.unread.ids = previousUnreadIds
        state.value.error = requestErrorMessage(error)
      }
      throw error
    }
  }

  async function markAllRead() {
    if (state.value.markingAllRead || state.value.unreadCount === 0) return
    if (!state.value.generatedAt) await sync({ silent: true })
    const through = state.value.generatedAt
    if (!through) return

    const requestScope = state.value.scopeKey
    const requestSlug = slug.value
    const previousUnreadCount = state.value.unreadCount
    const previousUnreadIds = [...state.value.feeds.unread.ids]
    const previousReadAt = new Map(state.value.items.map(item => [item.id, item.readAt]))
    const optimisticReadAt = new Date().toISOString()

    for (const notification of state.value.items) {
      if (!notification.readAt && Date.parse(notification.createdAt) <= Date.parse(through)) {
        notification.readAt = optimisticReadAt
      }
    }
    state.value.feeds.unread.ids = state.value.feeds.unread.ids.filter((id) => {
      const item = state.value.items.find(notification => notification.id === id)
      return Boolean(item && !item.readAt)
    })
    state.value.unreadCount = state.value.feeds.unread.ids.length
    state.value.markingAllRead = true

    try {
      const responseValue = await requestFetch<unknown>(
        `${notificationEndpoint(requestSlug)}/read-all`,
        {
          method: 'POST',
          body: { through },
        },
      )
      if (state.value.scopeKey !== requestScope) return

      const response = normalizeNotificationsReadAllResponse(responseValue)
      if (!response) throw new Error('Nieprawidłowa odpowiedź serwera powiadomień.')
      state.value.revision = Math.max(state.value.revision, response.revision)
      void sync({ silent: true }).catch(() => {})
    }
    catch (error) {
      if (state.value.scopeKey === requestScope) {
        for (const notification of state.value.items) {
          notification.readAt = previousReadAt.get(notification.id) ?? null
        }
        state.value.unreadCount = previousUnreadCount
        state.value.feeds.unread.ids = previousUnreadIds
        state.value.error = requestErrorMessage(error)
      }
      throw error
    }
    finally {
      if (state.value.scopeKey === requestScope) state.value.markingAllRead = false
    }
  }

  const allNotifications = computed(() => {
    const byId = new Map(state.value.items.map(notification => [notification.id, notification]))
    return state.value.feeds.all.ids
      .map(id => byId.get(id))
      .filter((notification): notification is InAppNotification => Boolean(notification))
  })
  const unreadNotifications = computed(() => {
    const byId = new Map(state.value.items.map(notification => [notification.id, notification]))
    const ids = state.value.feeds.unread.loaded
      ? state.value.feeds.unread.ids
      : state.value.feeds.all.ids
    return ids
      .map(id => byId.get(id))
      .filter((notification): notification is InAppNotification => Boolean(notification && !notification.readAt))
  })

  watch(scopeKey, (nextScope) => {
    scopeGeneration += 1
    syncPromise = null
    syncReplacing = false
    if (state.value.scopeKey === nextScope) return
    state.value = emptyNotificationsState(nextScope)
    if (slug.value) {
      void sync({ replace: true }).catch(() => {})
    }
  })

  watch(initialStatus, (status) => {
    if (state.value.scopeKey === initialScope) state.value.initialLoading = status === 'pending'
  })

  return {
    state,
    allNotifications,
    unreadNotifications,
    sync,
    ensureFeed,
    loadMore,
    markRead,
    markAllRead,
  }
}
