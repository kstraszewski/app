import type {
  NotificationRealtimeTransport,
  NotificationRealtimeTokenResponse,
} from '#shared/types/notifications'
import type {
  ErrorInfo,
  TokenDetails,
  TokenParams,
  TokenRequest,
} from 'ably'
import {
  normalizeNotificationRealtimeEvent,
  normalizeNotificationSnapshotResponse,
} from '~/utils/notifications'
import {
  onBeforeUnmount,
  onMounted,
  ref,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from 'vue'

export type NotificationConnectionState = 'connecting' | 'connected' | 'polling' | 'offline'

interface UseNotificationRealtimeOptions {
  organizationKey: MaybeRefOrGetter<string>
  stateEndpoint: MaybeRefOrGetter<string>
  tokenEndpoint: MaybeRefOrGetter<string>
  currentRevision: MaybeRefOrGetter<number>
  onInvalidate: () => Promise<void> | void
}

const fallbackPollIntervalMs = 5_000
const fallbackSafetyPollIntervalMs = 45_000
const changeCoalesceMs = 180
const reconnectDelayMs = 12_000

function transportSignature(transport: NotificationRealtimeTransport) {
  return [
    transport.mode,
    transport.channel || '',
    transport.pollIntervalMs,
    transport.safetyPollIntervalMs,
  ].join(':')
}

function jitteredDelay(intervalMs: number) {
  const jitter = intervalMs * 0.15
  return Math.max(2_500, Math.round(intervalMs - jitter + Math.random() * jitter * 2))
}

export function useNotificationRealtime(options: UseNotificationRealtimeOptions) {
  const requestFetch = useRequestFetch()
  const connectionState = ref<NotificationConnectionState>('connecting')
  const lastUpdatedAt = ref<string | null>(null)

  let mounted = false
  let session = 0
  let activeTransport: NotificationRealtimeTransport = {
    mode: 'polling',
    channel: null,
    pollIntervalMs: fallbackPollIntervalMs,
    safetyPollIntervalMs: fallbackSafetyPollIntervalMs,
  }
  let activeTransportSignature = ''
  let realtimeClient: any = null
  let realtimeChannel: any = null
  let realtimeHandler: ((message: unknown) => void) | null = null
  let pollingTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let coalesceTimer: ReturnType<typeof setTimeout> | null = null
  let snapshotRequest: Promise<void> | null = null
  let queuedSnapshot = false
  let invalidationRequest: Promise<void> | null = null
  let pendingRevision = 0
  let connectionAttempt = 0

  function clearPollingTimer() {
    if (!pollingTimer) return
    clearTimeout(pollingTimer)
    pollingTimer = null
  }

  function schedulePoll(intervalMs: number, sessionId: number) {
    clearPollingTimer()
    if (!mounted || sessionId !== session || !navigator.onLine) return

    pollingTimer = setTimeout(async () => {
      pollingTimer = null
      if (
        mounted
        && sessionId === session
        && navigator.onLine
        && document.visibilityState === 'visible'
      ) await syncNow()

      if (mounted && sessionId === session) schedulePoll(intervalMs, sessionId)
    }, jitteredDelay(intervalMs))
  }

  function stopReconnectTimer() {
    if (!reconnectTimer) return
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  function closeRealtime() {
    const channel = realtimeChannel
    const handler = realtimeHandler
    realtimeChannel = null
    realtimeHandler = null
    if (channel && handler) {
      try {
        void channel.unsubscribe('notifications.changed', handler)
      }
      catch {
        // Closing the owning client below also releases channel listeners.
      }
    }

    const client = realtimeClient
    realtimeClient = null
    if (client) {
      try {
        client.close()
      }
      catch {
        // The client may already be closed after a terminal connection state.
      }
    }
  }

  function stopTransport() {
    clearPollingTimer()
    stopReconnectTimer()
    connectionAttempt += 1
    closeRealtime()
    activeTransportSignature = ''
  }

  async function requestToken(): Promise<TokenDetails | TokenRequest | string> {
    const endpoint = toValue(options.tokenEndpoint)
    if (!endpoint) throw new Error('Notification realtime token endpoint is unavailable')
    const response = await requestFetch<NotificationRealtimeTokenResponse>(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    if (!response?.data?.tokenRequest) {
      throw new Error('Notification realtime authorization returned no token')
    }
    return response.data.tokenRequest as TokenDetails | TokenRequest | string
  }

  function scheduleReconnect(sessionId: number) {
    if (
      reconnectTimer
      || !mounted
      || sessionId !== session
      || activeTransport.mode !== 'ably'
      || !activeTransport.channel
      || !navigator.onLine
    ) return

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      if (document.visibilityState === 'visible') void connectRealtime(sessionId)
      else scheduleReconnect(sessionId)
    }, reconnectDelayMs)
  }

  async function flushInvalidation(sessionId: number) {
    if (invalidationRequest || sessionId !== session || !mounted) return
    const revision = pendingRevision
    pendingRevision = 0
    if (revision <= Math.max(0, Number(toValue(options.currentRevision)) || 0)) return

    const request = Promise.resolve(options.onInvalidate())
    invalidationRequest = request
    try {
      await request
      if (sessionId === session && mounted) lastUpdatedAt.value = new Date().toISOString()
    }
    catch {
      if (sessionId === session) pendingRevision = Math.max(pendingRevision, revision)
    }
    finally {
      if (invalidationRequest === request) invalidationRequest = null
      if (sessionId === session && pendingRevision > toValue(options.currentRevision)) {
        coalesceTimer = setTimeout(() => {
          coalesceTimer = null
          void flushInvalidation(sessionId)
        }, activeTransport.pollIntervalMs)
      }
    }
  }

  function scheduleInvalidation(revision: number, sessionId: number) {
    if (
      !mounted
      || sessionId !== session
      || revision <= Math.max(
        pendingRevision,
        Math.max(0, Number(toValue(options.currentRevision)) || 0),
      )
    ) return

    pendingRevision = revision
    if (coalesceTimer || invalidationRequest) return
    coalesceTimer = setTimeout(() => {
      coalesceTimer = null
      void flushInvalidation(sessionId)
    }, changeCoalesceMs)
  }

  async function connectRealtime(sessionId: number) {
    if (
      !mounted
      || sessionId !== session
      || activeTransport.mode !== 'ably'
      || !activeTransport.channel
      || realtimeClient
    ) return

    if (!navigator.onLine) {
      connectionState.value = 'offline'
      return
    }

    stopReconnectTimer()
    connectionState.value = 'connecting'
    const attempt = ++connectionAttempt

    try {
      const Ably = await import('ably')
      if (!mounted || sessionId !== session || attempt !== connectionAttempt) return

      const client = new Ably.Realtime({
        authCallback: async (
          _tokenParams: TokenParams,
          callback: (
            error: ErrorInfo | string | null,
            token: TokenDetails | TokenRequest | string | null,
          ) => void,
        ) => {
          try {
            callback(null, await requestToken())
          }
          catch (error) {
            callback(error instanceof Error ? error.message : 'Realtime authorization failed', null)
          }
        },
        echoMessages: false,
      })
      realtimeClient = client

      client.connection.on((change: { current: string }) => {
        if (sessionId !== session || realtimeClient !== client) return

        if (change.current === 'connected') {
          connectionState.value = 'connected'
          stopReconnectTimer()
          schedulePoll(activeTransport.safetyPollIntervalMs, sessionId)
        }
        else if (change.current === 'connecting' || change.current === 'disconnected') {
          connectionState.value = 'connecting'
          schedulePoll(activeTransport.pollIntervalMs, sessionId)
        }
        else if (change.current === 'suspended') {
          connectionState.value = navigator.onLine ? 'polling' : 'offline'
          schedulePoll(activeTransport.pollIntervalMs, sessionId)
        }
        else if (change.current === 'failed' || change.current === 'closed') {
          closeRealtime()
          connectionState.value = navigator.onLine ? 'polling' : 'offline'
          schedulePoll(activeTransport.pollIntervalMs, sessionId)
          scheduleReconnect(sessionId)
        }
      })

      const channel = client.channels.get(activeTransport.channel)
      const handler = (message: unknown) => {
        if (sessionId !== session || realtimeChannel !== channel) return
        const input = message && typeof message === 'object' && 'data' in message
          ? (message as { data: unknown }).data
          : message
        const event = normalizeNotificationRealtimeEvent(input)
        if (event) scheduleInvalidation(event.revision, sessionId)
        else void syncNow()
      }
      realtimeChannel = channel
      realtimeHandler = handler
      await channel.subscribe('notifications.changed', handler)
      if (sessionId === session && realtimeChannel === channel) await syncNow()
    }
    catch {
      if (!mounted || sessionId !== session || attempt !== connectionAttempt) return
      closeRealtime()
      connectionState.value = navigator.onLine ? 'polling' : 'offline'
      schedulePoll(activeTransport.pollIntervalMs, sessionId)
      scheduleReconnect(sessionId)
    }
  }

  function configureTransport(transport: NotificationRealtimeTransport, sessionId: number) {
    if (!mounted || sessionId !== session) return
    const signature = transportSignature(transport)
    activeTransport = transport
    if (signature === activeTransportSignature) return

    stopTransport()
    activeTransportSignature = signature
    if (transport.mode === 'ably' && transport.channel) {
      void connectRealtime(sessionId)
    }
    else {
      connectionState.value = navigator.onLine ? 'polling' : 'offline'
      schedulePoll(transport.pollIntervalMs, sessionId)
    }
  }

  async function fetchSnapshot(sessionId: number) {
    const endpoint = toValue(options.stateEndpoint)
    if (!endpoint || sessionId !== session) return

    try {
      const value = await requestFetch<unknown>(endpoint, {
        method: 'GET',
        headers: { Accept: 'application/json', 'cache-control': 'no-cache' },
      })
      if (!mounted || sessionId !== session) return

      const response = normalizeNotificationSnapshotResponse(value)
      if (!response) throw new Error('Notification realtime snapshot is invalid')
      configureTransport(response.data.realtime, sessionId)
      lastUpdatedAt.value = response.data.updatedAt
      scheduleInvalidation(response.data.revision, sessionId)
      if (activeTransport.mode === 'polling') {
        connectionState.value = navigator.onLine ? 'polling' : 'offline'
      }
    }
    catch {
      if (!mounted || sessionId !== session) return
      if (connectionState.value !== 'connected') {
        connectionState.value = navigator.onLine ? 'polling' : 'offline'
      }
      if (!pollingTimer && navigator.onLine) {
        schedulePoll(activeTransport.pollIntervalMs, sessionId)
      }
    }
  }

  async function syncNow() {
    if (!mounted) return
    if (snapshotRequest) {
      queuedSnapshot = true
      return snapshotRequest
    }

    const sessionId = session
    const request = fetchSnapshot(sessionId)
    snapshotRequest = request
    try {
      await request
    }
    finally {
      if (snapshotRequest === request) snapshotRequest = null
      if (sessionId === session && queuedSnapshot) {
        queuedSnapshot = false
        queueMicrotask(() => void syncNow())
      }
    }
  }

  function resetSession() {
    stopTransport()
    if (coalesceTimer) clearTimeout(coalesceTimer)
    coalesceTimer = null
    snapshotRequest = null
    queuedSnapshot = false
    invalidationRequest = null
    pendingRevision = 0
    lastUpdatedAt.value = null
  }

  function restartSession() {
    if (!mounted) return
    session += 1
    resetSession()
    connectionState.value = navigator.onLine ? 'connecting' : 'offline'
    if (toValue(options.organizationKey)) void syncNow()
  }

  function handleVisibilityChange() {
    if (document.visibilityState !== 'visible') return
    if (activeTransport.mode === 'ably' && !realtimeClient) void connectRealtime(session)
    void syncNow()
  }

  function handleFocus() {
    if (document.visibilityState === 'visible') void syncNow()
  }

  function handleOnline() {
    connectionState.value = activeTransport.mode === 'ably' ? 'connecting' : 'polling'
    if (activeTransport.mode === 'ably' && !realtimeClient) void connectRealtime(session)
    void syncNow()
  }

  function handleOffline() {
    connectionState.value = 'offline'
    clearPollingTimer()
  }

  watch(
    () => [
      toValue(options.organizationKey),
      toValue(options.stateEndpoint),
      toValue(options.tokenEndpoint),
    ] as const,
    restartSession,
  )

  onMounted(() => {
    mounted = true
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleFocus)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    restartSession()
  })

  onBeforeUnmount(() => {
    mounted = false
    session += 1
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    window.removeEventListener('focus', handleFocus)
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
    resetSession()
  })

  return {
    connectionState,
    lastUpdatedAt,
    syncNow,
  }
}
