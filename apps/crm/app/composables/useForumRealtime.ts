import type {
  ForumRealtimeBootstrapPayload,
  ForumRealtimeConnectionState,
  ForumRealtimeEvent,
  ForumRealtimeEventKind,
  ForumRealtimeTransport,
} from '#shared/types/forum'
import type {
  ErrorInfo,
  TokenDetails,
  TokenParams,
  TokenRequest,
} from 'ably'
import {
  onBeforeUnmount,
  onMounted,
  ref,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from 'vue'

interface UseForumRealtimeOptions {
  stateEndpoint: MaybeRefOrGetter<string>
  tokenEndpoint: MaybeRefOrGetter<string>
  organizationKey: MaybeRefOrGetter<string>
  onChange: (event: ForumRealtimeEvent | null) => Promise<void> | void
}

interface ForumRealtimeStateResponse {
  data: ForumRealtimeBootstrapPayload
}

interface ForumRealtimeTokenResponse {
  data: {
    tokenRequest: unknown
  }
}

interface PendingForumChange {
  revision: number
  event: ForumRealtimeEvent | null
  updatedAt: string | null
}

const defaultPollIntervalMs = 4_000
const safetyPollIntervalMs = 30_000
const changeCoalesceMs = 200
const realtimeReconnectMs = 15_000

const realtimeEventKinds = new Set<ForumRealtimeEventKind>([
  'thread.created',
  'thread.updated',
  'reply.created',
  'post.created',
  'post.updated',
  'category.created',
  'category.updated',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizedRevision(value: unknown): number | null {
  if (
    typeof value !== 'number'
    && (typeof value !== 'string' || !value.trim())
  ) return null
  const revision = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null
}

function normalizedDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  return Number.isNaN(new Date(value).getTime()) ? null : value
}

function parseRealtimeEvent(value: unknown): ForumRealtimeEvent | null {
  if (!isRecord(value)) return null

  const revision = normalizedRevision(value.revision)
  if (
    value.schemaVersion !== 1
    || typeof value.eventId !== 'string'
    || !value.eventId
    || typeof value.kind !== 'string'
    || !realtimeEventKinds.has(value.kind as ForumRealtimeEventKind)
    || typeof value.organizationId !== 'string'
    || !value.organizationId
    || revision === null
    || !normalizedDate(value.occurredAt)
  ) return null

  return {
    schemaVersion: 1,
    eventId: value.eventId,
    kind: value.kind as ForumRealtimeEventKind,
    organizationId: value.organizationId,
    revision,
    ...(typeof value.threadId === 'string' && value.threadId
      ? { threadId: value.threadId }
      : {}),
    ...(typeof value.postId === 'string' && value.postId
      ? { postId: value.postId }
      : {}),
    ...(typeof value.categoryId === 'string' && value.categoryId
      ? { categoryId: value.categoryId }
      : {}),
    occurredAt: value.occurredAt as string,
  }
}

function normalizeTransport(value: unknown): ForumRealtimeTransport {
  const input = isRecord(value) ? value : {}
  const pollInterval = normalizedRevision(input.pollIntervalMs)
  const mode = input.mode === 'ably' ? 'ably' : 'polling'

  return {
    mode,
    channel: mode === 'ably' && typeof input.channel === 'string' && input.channel
      ? input.channel
      : null,
    pollIntervalMs: Math.max(2_500, pollInterval ?? defaultPollIntervalMs),
  }
}

function normalizeBootstrap(value: unknown): ForumRealtimeBootstrapPayload | null {
  const envelope = isRecord(value) ? value : null
  const input = envelope && isRecord(envelope.data) ? envelope.data : envelope
  if (!input) return null

  const revision = normalizedRevision(input.revision)
  if (revision === null) return null

  const event = parseRealtimeEvent(input.lastEvent)
  return {
    revision,
    lastEvent: event?.revision === revision ? event : null,
    updatedAt: normalizedDate(input.updatedAt),
    realtime: normalizeTransport(input.realtime),
  }
}

function transportSignature(transport: ForumRealtimeTransport) {
  return [transport.mode, transport.channel ?? '', transport.pollIntervalMs].join(':')
}

export function useForumRealtime(options: UseForumRealtimeOptions) {
  const requestFetch = useRequestFetch()
  const connectionState = ref<ForumRealtimeConnectionState>('connecting')
  const revision = ref(0)
  const lastUpdatedAt = ref<string | null>(null)
  const pulse = ref(false)

  let mounted = false
  let sessionRevision = 0
  let bootstrapped = false
  let activeTransport: ForumRealtimeTransport = {
    mode: 'polling',
    channel: null,
    pollIntervalMs: defaultPollIntervalMs,
  }
  let activeTransportSignature = ''
  let realtimeClient: any = null
  let realtimeChannel: any = null
  let realtimeMessageHandler: ((message: unknown) => void) | null = null
  let pollingTimer: ReturnType<typeof setInterval> | null = null
  let coalesceTimer: ReturnType<typeof setTimeout> | null = null
  let pulseTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let pendingChange: PendingForumChange | null = null
  let applyingChangeSession: number | null = null
  let realtimeConnecting = false
  let realtimeConnectionAttempt = 0
  let snapshotRequest: Promise<void> | null = null
  let snapshotRequestQueued = false

  function stopPolling() {
    if (!pollingTimer) return
    clearInterval(pollingTimer)
    pollingTimer = null
  }

  function startPolling(intervalMs: number, updateState = true) {
    stopPolling()
    if (!mounted) return
    if (updateState && navigator.onLine) connectionState.value = 'polling'
    const interval = Math.max(2_500, intervalMs)
    pollingTimer = setInterval(() => {
      if (document.visibilityState === 'visible') void syncNow()
    }, interval)
  }

  function stopRealtimeReconnect() {
    if (!reconnectTimer) return
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  function closeRealtimeClient() {
    const channel = realtimeChannel
    const handler = realtimeMessageHandler
    realtimeChannel = null
    realtimeMessageHandler = null
    if (channel && handler) {
      try {
        void channel.unsubscribe('forum.changed', handler)
      }
      catch {
        // Closing the client below also detaches any remaining listeners.
      }
    }

    const client = realtimeClient
    realtimeClient = null
    if (client) {
      try {
        client.close()
      }
      catch {
        // The client can already be closing after a terminal connection state.
      }
    }
  }

  function stopTransport() {
    stopPolling()
    stopRealtimeReconnect()
    realtimeConnectionAttempt += 1
    realtimeConnecting = false
    closeRealtimeClient()
    activeTransportSignature = ''
  }

  function triggerPulse(session: number) {
    if (session !== sessionRevision || !mounted) return
    pulse.value = true
    if (pulseTimer) clearTimeout(pulseTimer)
    pulseTimer = setTimeout(() => {
      if (session === sessionRevision) pulse.value = false
    }, 1_600)
  }

  function scheduleChange(change: PendingForumChange, session: number) {
    if (
      session !== sessionRevision
      || change.revision <= revision.value
      || change.revision <= (pendingChange?.revision ?? -1)
    ) return

    pendingChange = change
    if (coalesceTimer || applyingChangeSession === session) return
    coalesceTimer = setTimeout(() => {
      coalesceTimer = null
      void applyPendingChanges(session)
    }, changeCoalesceMs)
  }

  function restorePendingChange(change: PendingForumChange) {
    const queuedChange: PendingForumChange | null = pendingChange
    pendingChange = !queuedChange || change.revision > queuedChange.revision
      ? change
      : queuedChange
  }

  async function applyPendingChanges(session: number) {
    if (applyingChangeSession === session || session !== sessionRevision || !mounted) return
    applyingChangeSession = session

    try {
      while (session === sessionRevision && pendingChange) {
        const change = pendingChange
        pendingChange = null
        if (change.revision <= revision.value) continue

        try {
          await options.onChange(change.event)
        }
        catch {
          if (session === sessionRevision) restorePendingChange(change)
          break
        }

        if (session !== sessionRevision || !mounted) return
        revision.value = change.revision
        lastUpdatedAt.value = change.updatedAt
          ?? change.event?.occurredAt
          ?? new Date().toISOString()
        triggerPulse(session)
      }
    }
    finally {
      if (applyingChangeSession === session) applyingChangeSession = null
      if (session === sessionRevision && pendingChange && !coalesceTimer) {
        coalesceTimer = setTimeout(() => {
          coalesceTimer = null
          void applyPendingChanges(session)
        }, activeTransport.pollIntervalMs)
      }
    }
  }

  function candidateFromMessage(message: unknown): PendingForumChange | null {
    const envelope = isRecord(message) && 'data' in message ? message.data : message
    const input = isRecord(envelope) ? envelope : null
    const event = parseRealtimeEvent(input?.event ?? input?.lastEvent ?? envelope)
    const eventRevision = event?.revision
    const envelopeRevision = normalizedRevision(input?.revision)
    const nextRevision = eventRevision ?? envelopeRevision
    if (nextRevision === null || nextRevision === undefined) return null

    return {
      revision: nextRevision,
      event,
      updatedAt: normalizedDate(input?.updatedAt) ?? event?.occurredAt ?? null,
    }
  }

  async function requestToken(): Promise<TokenDetails | TokenRequest | string> {
    const endpoint = toValue(options.tokenEndpoint)
    if (!endpoint) throw new Error('Forum realtime token endpoint is unavailable')
    const response = await requestFetch<ForumRealtimeTokenResponse>(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    const tokenRequest = response?.data?.tokenRequest
    if (!tokenRequest) throw new Error('Forum realtime authorization returned no token')
    return tokenRequest as TokenDetails | TokenRequest | string
  }

  function scheduleRealtimeReconnect(session: number) {
    if (
      reconnectTimer
      || session !== sessionRevision
      || activeTransport.mode !== 'ably'
      || !activeTransport.channel
      || !navigator.onLine
    ) return

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      if (document.visibilityState === 'visible') void connectRealtime(session)
      else scheduleRealtimeReconnect(session)
    }, realtimeReconnectMs)
  }

  async function connectRealtime(session: number) {
    if (
      !mounted
      || session !== sessionRevision
      || activeTransport.mode !== 'ably'
      || !activeTransport.channel
      || realtimeClient
      || realtimeConnecting
    ) return

    if (!navigator.onLine) {
      connectionState.value = 'offline'
      startPolling(activeTransport.pollIntervalMs, false)
      return
    }

    stopRealtimeReconnect()
    connectionState.value = 'connecting'
    realtimeConnecting = true
    const connectionAttempt = ++realtimeConnectionAttempt

    try {
      const Ably = await import('ably')
      if (
        session !== sessionRevision
        || connectionAttempt !== realtimeConnectionAttempt
        || !mounted
      ) return

      const client = new Ably.Realtime({
        authCallback: async (
          _tokenParams: TokenParams,
          callback: (
            error: ErrorInfo | string | null,
            tokenRequest: TokenDetails | TokenRequest | string | null,
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
        if (session !== sessionRevision || realtimeClient !== client) return

        if (change.current === 'connected') {
          connectionState.value = 'connected'
          stopRealtimeReconnect()
          startPolling(
            Math.max(safetyPollIntervalMs, activeTransport.pollIntervalMs),
            false,
          )
          void syncNow()
        }
        else if (change.current === 'connecting' || change.current === 'disconnected') {
          connectionState.value = 'connecting'
          startPolling(activeTransport.pollIntervalMs, false)
        }
        else if (change.current === 'suspended') {
          connectionState.value = 'offline'
          startPolling(activeTransport.pollIntervalMs, false)
        }
        else if (change.current === 'failed' || change.current === 'closed') {
          closeRealtimeClient()
          connectionState.value = navigator.onLine ? 'polling' : 'offline'
          startPolling(activeTransport.pollIntervalMs, false)
          scheduleRealtimeReconnect(session)
        }
      })

      const channel = client.channels.get(activeTransport.channel)
      const handler = (message: unknown) => {
        if (session !== sessionRevision || realtimeChannel !== channel) return
        const change = candidateFromMessage(message)
        if (change) scheduleChange(change, session)
        else void syncNow()
      }
      realtimeChannel = channel
      realtimeMessageHandler = handler
      await channel.subscribe('forum.changed', handler)
    }
    catch {
      if (
        session !== sessionRevision
        || connectionAttempt !== realtimeConnectionAttempt
        || !mounted
      ) return
      closeRealtimeClient()
      connectionState.value = navigator.onLine ? 'polling' : 'offline'
      startPolling(activeTransport.pollIntervalMs, false)
      scheduleRealtimeReconnect(session)
    }
    finally {
      if (connectionAttempt === realtimeConnectionAttempt) realtimeConnecting = false
    }
  }

  function configureTransport(transport: ForumRealtimeTransport, session: number) {
    if (session !== sessionRevision || !mounted) return
    const signature = transportSignature(transport)
    activeTransport = transport
    if (signature === activeTransportSignature) {
      if (transport.mode === 'polling' && navigator.onLine) {
        connectionState.value = 'polling'
      }
      return
    }

    stopTransport()
    activeTransportSignature = signature
    if (transport.mode === 'ably' && transport.channel) {
      void connectRealtime(session)
    }
    else {
      startPolling(transport.pollIntervalMs)
    }
  }

  async function fetchSnapshot(session: number) {
    const endpoint = toValue(options.stateEndpoint)
    if (!endpoint || session !== sessionRevision) return

    try {
      const response = await requestFetch<ForumRealtimeStateResponse | ForumRealtimeBootstrapPayload>(
        endpoint,
        { method: 'GET', headers: { Accept: 'application/json' } },
      )
      if (session !== sessionRevision || !mounted) return

      const snapshot = normalizeBootstrap(response)
      if (!snapshot) throw new Error('Forum realtime state is invalid')

      configureTransport(snapshot.realtime, session)
      if (!bootstrapped) {
        bootstrapped = true
        revision.value = snapshot.revision
        lastUpdatedAt.value = snapshot.updatedAt
      }
      else if (snapshot.revision > revision.value) {
        scheduleChange({
          revision: snapshot.revision,
          event: snapshot.lastEvent,
          updatedAt: snapshot.updatedAt,
        }, session)
      }

      if (activeTransport.mode === 'polling' && navigator.onLine) {
        connectionState.value = 'polling'
      }
    }
    catch {
      if (session !== sessionRevision || !mounted) return
      if (connectionState.value !== 'connected') connectionState.value = 'offline'
      if (!pollingTimer) startPolling(activeTransport.pollIntervalMs, false)
    }
  }

  async function syncNow() {
    if (!mounted) return
    if (snapshotRequest) {
      snapshotRequestQueued = true
      return snapshotRequest
    }

    const session = sessionRevision
    const request = fetchSnapshot(session)
    snapshotRequest = request
    try {
      await request
    }
    finally {
      if (snapshotRequest === request) snapshotRequest = null
      if (session === sessionRevision && snapshotRequestQueued) {
        snapshotRequestQueued = false
        queueMicrotask(() => void syncNow())
      }
    }
  }

  function resetSessionState() {
    stopTransport()
    if (coalesceTimer) clearTimeout(coalesceTimer)
    if (pulseTimer) clearTimeout(pulseTimer)
    coalesceTimer = null
    pulseTimer = null
    pendingChange = null
    applyingChangeSession = null
    snapshotRequest = null
    snapshotRequestQueued = false
    bootstrapped = false
    revision.value = 0
    lastUpdatedAt.value = null
    pulse.value = false
    activeTransport = {
      mode: 'polling',
      channel: null,
      pollIntervalMs: defaultPollIntervalMs,
    }
  }

  function restartSession() {
    if (!mounted) return
    sessionRevision += 1
    resetSessionState()
    connectionState.value = navigator.onLine ? 'connecting' : 'offline'
    if (!toValue(options.organizationKey)) return
    void syncNow()
  }

  function handleVisibilityChange() {
    if (document.visibilityState !== 'visible') return
    if (activeTransport.mode === 'ably' && !realtimeClient) {
      void connectRealtime(sessionRevision)
    }
    void syncNow()
  }

  function handleOnline() {
    connectionState.value = activeTransport.mode === 'ably' ? 'connecting' : 'polling'
    if (activeTransport.mode === 'ably' && !realtimeClient) {
      void connectRealtime(sessionRevision)
    }
    void syncNow()
  }

  function handleOffline() {
    connectionState.value = 'offline'
  }

  watch(
    () => [
      toValue(options.organizationKey),
      toValue(options.stateEndpoint),
      toValue(options.tokenEndpoint),
    ] as const,
    () => restartSession(),
  )

  onMounted(() => {
    mounted = true
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    restartSession()
  })

  onBeforeUnmount(() => {
    mounted = false
    sessionRevision += 1
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
    resetSessionState()
  })

  return {
    connectionState,
    revision,
    lastUpdatedAt,
    pulse,
    syncNow,
  }
}
