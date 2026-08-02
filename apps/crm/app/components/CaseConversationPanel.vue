<script setup lang="ts">
import type {
  Conversation,
  Message,
  Receipt,
} from '@openexpert/messaging'

interface ConversationRecipient {
  clientId: string
  clientPersonId: string
  displayName: string
  email: string | null
  role: string | null
  portalEnabled: boolean
  portalActivated: boolean
  conversationId: string | null
}

interface ConversationPerson {
  id?: string
  displayName?: string | null
  email?: string | null
}

interface ConversationListItem extends Conversation {
  clientPerson: ConversationPerson | null
  unreadCount: number
  lastMessagePreview: string | null
}

interface RealtimeConfiguration {
  mode: 'ably' | 'polling'
  channel: string | null
  ephemeralChannel: string | null
  pollIntervalMs: number
}

interface ConversationIndexResponse {
  data: {
    conversations: ConversationListItem[]
    recipients: ConversationRecipient[]
    realtime: Pick<RealtimeConfiguration, 'mode' | 'pollIntervalMs'>
  }
}

interface ConversationBootstrap {
  conversation: Conversation
  clientPerson?: ConversationPerson | null
  messages: Message[]
  receipt: Receipt | null
  peerReceipt: Receipt | null
  pageInfo: {
    lastSequence: number
    hasMore: boolean
  }
  realtime: RealtimeConfiguration
}

interface ConversationBootstrapResponse {
  data: ConversationBootstrap
}

interface SendMessageResponse {
  data: {
    conversation: Conversation
    message: Message
    created: boolean
    replayed: boolean
    realtime: RealtimeConfiguration
  }
}

interface ReceiptResponse {
  data: {
    receipt: Receipt | null
    peerReceipt: Receipt | null
  }
}

interface TokenResponse {
  data: {
    tokenRequest: unknown
    channel: string
    ephemeralChannel: string
    clientId: string
  }
}

interface RetryableSend {
  body: string
  clientMessageId: string
}

const props = defineProps<{
  caseId: string
}>()

const toast = useToast()
const route = useRoute()
const requestFetch = useRequestFetch()
const { organizationSlug, crmApiPath } = useOrganizationContext()

const indexApiPath = computed(() => crmApiPath(
  `/cases/${encodeURIComponent(props.caseId)}/conversations`,
))

const {
  data: indexResponse,
  status: indexStatus,
  error: indexError,
  refresh: refreshIndex,
} = useAsyncData<ConversationIndexResponse>(
  () => `crm-case-conversations:${organizationSlug.value}:${props.caseId}`,
  () => requestFetch<ConversationIndexResponse>(indexApiPath.value),
  { watch: [organizationSlug, () => props.caseId] },
)

const recipients = ref<ConversationRecipient[]>([])
const conversationEntries = ref<ConversationListItem[]>([])
const selectedClientPersonId = ref('')
const conversation = ref<Conversation | null>(null)
const messages = ref<Message[]>([])
const ownReceipt = ref<Receipt | null>(null)
const peerReceipt = ref<Receipt | null>(null)
const realtimeConfiguration = ref<RealtimeConfiguration>({
  mode: 'polling',
  channel: null,
  ephemeralChannel: null,
  pollIntervalMs: 5_000,
})
const composer = ref('')
const composerDrafts = new Map<string, string>()
const retryableSends = new Map<string, RetryableSend>()
const pendingBody = ref('')
const pendingRecipientId = ref('')
const sending = ref(false)
const loadingConversation = ref(false)
const conversationLoadError = ref(false)
const loadingOlder = ref(false)
const syncing = ref(false)
const hasOlderMessages = ref(false)
const listElement = ref<HTMLElement | null>(null)
const listAtEnd = ref(true)
const readSentinelElement = ref<HTMLElement | null>(null)
const panelVisible = ref(false)
const peerTyping = ref(false)
const connectionState = ref<'idle' | 'connecting' | 'connected' | 'polling' | 'offline'>('idle')
const notificationsState = ref<'unsupported' | NotificationPermission>('unsupported')
const activatingNotifications = ref(false)
const pushActivated = ref(false)

let realtimeClient: any = null
let durableChannel: any = null
let ephemeralChannel: any = null
let pollingTimer: ReturnType<typeof setInterval> | null = null
let indexPollingTimer: ReturnType<typeof setInterval> | null = null
let typingTimer: ReturnType<typeof setTimeout> | null = null
let peerTypingTimer: ReturnType<typeof setTimeout> | null = null
let receiptTimer: ReturnType<typeof setTimeout> | null = null
let visibilityObserver: IntersectionObserver | null = null
let connectedSignature = ''
let selectionRevision = 0
let selectionScheduled = false
let disposed = false
let conversationRevision = 0
let syncRequested = false

const selectedRecipient = computed(() => recipients.value.find(
  recipient => recipient.clientPersonId === selectedClientPersonId.value,
) ?? null)

const unreadByClientPerson = computed(() => new Map(
  conversationEntries.value.map(entry => [entry.clientPersonId, entry.unreadCount]),
))
const totalUnreadCount = computed(() => conversationEntries.value.reduce(
  (total, entry) => total + entry.unreadCount,
  0,
))
const recipientItems = computed(() => recipients.value.map((recipient) => {
  const unreadCount = unreadByClientPerson.value.get(recipient.clientPersonId) ?? 0
  const status = recipient.email
    || (recipient.portalActivated ? 'Aktywny panel klienta' : 'Panel nie został jeszcze aktywowany')
  return {
    label: unreadCount
      ? `${recipient.displayName} · nowe: ${unreadCount}`
      : recipient.displayName,
    description: unreadCount ? `Nieodczytane: ${unreadCount} · ${status}` : status,
    value: recipient.clientPersonId,
    icon: unreadCount
      ? 'i-lucide-mail-plus'
      : recipient.portalActivated
        ? 'i-lucide-user-round-check'
        : 'i-lucide-user-round',
  }
}))

const latestSequence = computed(() => (
  messages.value.at(-1)?.sequence
  ?? conversation.value?.lastMessageSequence
  ?? 0
))

const isIndexLoading = computed(() => indexStatus.value === 'pending' && !recipients.value.length)
const canSend = computed(() => {
  const body = composer.value.trim()
  return Boolean(
    selectedRecipient.value?.portalEnabled
    && body.length >= 1
    && body.length <= 4_000
    && !sending.value
    && !conversationLoadError.value,
  )
})

const connectionLabel = computed(() => {
  if (!conversation.value) return 'Gotowa do rozpoczęcia'
  if (connectionState.value === 'connected') return 'Na żywo'
  if (connectionState.value === 'offline') return 'Ponawianie połączenia'
  if (connectionState.value === 'connecting') return 'Łączenie'
  return 'Bezpieczna synchronizacja'
})

const connectionColor = computed<'success' | 'warning' | 'neutral'>(() => {
  if (connectionState.value === 'connected') return 'success'
  if (connectionState.value === 'offline') return 'warning'
  return 'neutral'
})

const portalSettingsLocation = computed(() => ({
  path: route.path,
  query: { ...route.query, view: 'documents' },
  hash: '#case-applications',
}))

function conversationApiPath(conversationId: string, suffix = '') {
  return `${indexApiPath.value}/${encodeURIComponent(conversationId)}${suffix}`
}

function mergeMessages(incoming: Message[]) {
  const byId = new Map(messages.value.map(message => [message.id, message]))
  for (const message of incoming) byId.set(message.id, message)
  messages.value = [...byId.values()].sort((left, right) => left.sequence - right.sequence)
}

function updateConversationEntry(updated: Conversation, additions: Partial<ConversationListItem> = {}) {
  const existingIndex = conversationEntries.value.findIndex(item => item.id === updated.id)
  const previous = existingIndex >= 0 ? conversationEntries.value[existingIndex] : null
  const next: ConversationListItem = {
    ...updated,
    clientPerson: additions.clientPerson ?? previous?.clientPerson ?? null,
    unreadCount: additions.unreadCount ?? previous?.unreadCount ?? 0,
    lastMessagePreview: additions.lastMessagePreview ?? previous?.lastMessagePreview ?? null,
  }

  if (existingIndex >= 0) {
    conversationEntries.value.splice(existingIndex, 1, next)
  }
  else {
    conversationEntries.value.push(next)
  }
}

function applyBootstrap(
  bootstrap: ConversationBootstrap,
  mode: 'replace' | 'append' | 'prepend' = 'replace',
) {
  if (
    selectedClientPersonId.value
    && bootstrap.conversation.clientPersonId !== selectedClientPersonId.value
  ) return

  conversationLoadError.value = false
  conversation.value = bootstrap.conversation
  ownReceipt.value = bootstrap.receipt
  peerReceipt.value = bootstrap.peerReceipt
  realtimeConfiguration.value = {
    mode: bootstrap.realtime?.mode ?? 'polling',
    channel: bootstrap.realtime?.channel ?? null,
    ephemeralChannel: bootstrap.realtime?.ephemeralChannel ?? null,
    pollIntervalMs: Math.max(2_500, bootstrap.realtime?.pollIntervalMs ?? 5_000),
  }

  const shouldFollowMessages = mode === 'replace' || (mode === 'append' && listAtEnd.value)
  if (mode === 'replace') messages.value = []
  mergeMessages(bootstrap.messages ?? [])
  if (mode !== 'append') hasOlderMessages.value = Boolean(bootstrap.pageInfo?.hasMore)

  updateConversationEntry(bootstrap.conversation, {
    clientPerson: bootstrap.clientPerson,
    lastMessagePreview: messages.value.at(-1)?.body ?? null,
  })

  if (shouldFollowMessages) {
    void nextTick(() => {
      scrollToEnd(mode === 'replace' ? 'auto' : 'smooth')
      if (mode === 'replace' && readSentinelElement.value && visibilityObserver) {
        panelVisible.value = false
        visibilityObserver.unobserve(readSentinelElement.value)
        visibilityObserver.observe(readSentinelElement.value)
      }
    })
  }
  scheduleReceipt()
}

function resetConversationState() {
  conversationRevision += 1
  syncRequested = false
  disconnectRealtime()
  loadingConversation.value = false
  conversationLoadError.value = false
  loadingOlder.value = false
  syncing.value = false
  conversation.value = null
  messages.value = []
  listAtEnd.value = true
  panelVisible.value = false
  ownReceipt.value = null
  peerReceipt.value = null
  hasOlderMessages.value = false
  peerTyping.value = false
  realtimeConfiguration.value = {
    mode: indexResponse.value?.data.realtime.mode ?? 'polling',
    channel: null,
    ephemeralChannel: null,
    pollIntervalMs: Math.max(2_500, indexResponse.value?.data.realtime.pollIntervalMs ?? 5_000),
  }
  connectionState.value = 'idle'
}

async function selectRecipientConversation() {
  const revision = ++selectionRevision
  resetConversationState()
  const entry = conversationEntries.value.find(
    item => item.clientPersonId === selectedClientPersonId.value,
  )
  if (!entry) return

  conversation.value = entry
  loadingConversation.value = true
  conversationLoadError.value = false
  try {
    const response = await $fetch<ConversationBootstrapResponse>(conversationApiPath(entry.id))
    if (revision !== selectionRevision) return
    applyBootstrap(response.data)
  }
  catch (caught: any) {
    if (revision !== selectionRevision) return
    conversationLoadError.value = true
    toast.add({
      title: 'Nie udało się otworzyć rozmowy',
      description: caught?.data?.statusMessage ?? 'Spróbuj ponownie za chwilę.',
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  }
  finally {
    if (revision === selectionRevision) loadingConversation.value = false
  }
}

function scheduleRecipientSelection() {
  if (!import.meta.client || selectionScheduled) return
  selectionScheduled = true
  void nextTick(() => {
    selectionScheduled = false
    if (disposed) return
    void selectRecipientConversation()
  })
}

watch(indexResponse, (response) => {
  recipients.value = response?.data.recipients ?? []
  conversationEntries.value = response?.data.conversations ?? []

  const selectedStillExists = recipients.value.some(
    recipient => recipient.clientPersonId === selectedClientPersonId.value,
  )
  if (!selectedStillExists) {
    const unreadEntry = conversationEntries.value.find(item => item.unreadCount > 0)
    const preferredRecipient = recipients.value.find(recipient => (
      recipient.clientPersonId === unreadEntry?.clientPersonId
    ))
      ?? recipients.value.find(recipient => recipient.role === 'primary')
      ?? recipients.value[0]
    selectedClientPersonId.value = preferredRecipient?.clientPersonId ?? ''
    scheduleRecipientSelection()
    return
  }

  const selectedEntry = conversationEntries.value.find(
    entry => entry.clientPersonId === selectedClientPersonId.value,
  )
  if (
    (selectedEntry && conversation.value?.id !== selectedEntry.id)
    || (!selectedEntry && conversation.value)
  ) {
    scheduleRecipientSelection()
  }
}, { immediate: true })

watch(selectedClientPersonId, (selected, previous) => {
  if (previous) composerDrafts.set(previous, composer.value)
  composer.value = composerDrafts.get(selected) ?? ''
  scheduleRecipientSelection()
})

function formatMessageTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Warsaw',
  }).format(date)
}

function deliveryLabel(message: Message) {
  if (message.senderKind !== 'staff') return ''
  if ((peerReceipt.value?.readThroughSequence ?? 0) >= message.sequence) return 'Odczytano'
  if ((peerReceipt.value?.deliveredThroughSequence ?? 0) >= message.sequence) return 'Dostarczono'
  return 'Wysłano'
}

function scrollToEnd(behavior: ScrollBehavior = 'smooth') {
  if (!listElement.value) return
  listAtEnd.value = true
  listElement.value.scrollTo({
    top: listElement.value.scrollHeight,
    behavior,
  })
}

function updateListPosition() {
  const element = listElement.value
  if (!element) return
  listAtEnd.value = element.scrollHeight - element.scrollTop - element.clientHeight <= 56
  scheduleReceipt()
}

async function ensureConversation() {
  if (conversation.value) return conversation.value
  if (!selectedRecipient.value) throw new Error('Brak wybranego odbiorcy')

  const response = await $fetch<ConversationBootstrapResponse>(indexApiPath.value, {
    method: 'POST',
    body: { clientPersonId: selectedRecipient.value.clientPersonId },
  })
  applyBootstrap(response.data)
  return response.data.conversation
}

async function sendMessage() {
  const body = composer.value.trim()
  if (!body || !canSend.value) return

  const recipientId = selectedClientPersonId.value
  const previousAttempt = retryableSends.get(recipientId)
  const attempt = previousAttempt?.body === body
    ? previousAttempt
    : { body, clientMessageId: crypto.randomUUID() }
  retryableSends.set(recipientId, attempt)

  sending.value = true
  pendingBody.value = body
  pendingRecipientId.value = recipientId
  composer.value = ''
  stopTyping()

  try {
    const activeConversation = await ensureConversation()
    const activeConversationId = activeConversation.id
    const response = await $fetch<SendMessageResponse>(
      conversationApiPath(activeConversationId, '/messages'),
      {
        method: 'POST',
        body: {
          body,
          clientMessageId: attempt.clientMessageId,
        },
      },
    )
    const stillSelected = conversation.value?.id === activeConversationId
    retryableSends.delete(recipientId)
    composerDrafts.delete(recipientId)
    if (pendingRecipientId.value === recipientId) {
      pendingBody.value = ''
      pendingRecipientId.value = ''
    }
    updateConversationEntry(response.data.conversation, { lastMessagePreview: body })
    if (!stillSelected) return
    conversation.value = response.data.conversation
    mergeMessages([response.data.message])
    realtimeConfiguration.value = response.data.realtime
    void nextTick(() => scrollToEnd())
  }
  catch (caught: any) {
    if (selectedClientPersonId.value === recipientId) composer.value = body
    else composerDrafts.set(recipientId, body)
    if (pendingRecipientId.value === recipientId) {
      pendingBody.value = ''
      pendingRecipientId.value = ''
    }
    toast.add({
      title: 'Nie udało się wysłać wiadomości',
      description: caught?.data?.statusMessage ?? 'Treść została zachowana. Spróbuj ponownie.',
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  }
  finally {
    sending.value = false
  }
}

async function syncMissingMessages() {
  if (!conversation.value) return
  if (syncing.value) {
    syncRequested = true
    return
  }
  const conversationId = conversation.value.id
  const revision = conversationRevision
  syncing.value = true
  try {
    do {
      syncRequested = false
      const previousSequence = latestSequence.value
      const response = await $fetch<ConversationBootstrapResponse>(
        conversationApiPath(conversationId),
        { query: { afterSequence: previousSequence } },
      )
      if (
        revision !== conversationRevision
        || conversation.value?.id !== conversationId
      ) return
      applyBootstrap(response.data, 'append')
      if (
        response.data.pageInfo?.hasMore
        && latestSequence.value > previousSequence
      ) {
        syncRequested = true
      }
      if (realtimeConfiguration.value.mode !== 'ably') connectionState.value = 'polling'
      else if (!realtimeClient) void connectRealtime()
    } while (syncRequested)
  }
  catch {
    if (
      revision === conversationRevision
      && connectionState.value !== 'connected'
    ) connectionState.value = 'offline'
  }
  finally {
    if (revision === conversationRevision) {
      const rerun = syncRequested
      syncing.value = false
      syncRequested = false
      if (rerun) queueMicrotask(() => void syncMissingMessages())
    }
  }
}

async function loadOlderMessages() {
  const firstSequence = messages.value[0]?.sequence
  if (!conversation.value || !firstSequence || loadingOlder.value) return

  const conversationId = conversation.value.id
  const previousScrollHeight = listElement.value?.scrollHeight ?? 0
  loadingOlder.value = true
  try {
    const response = await $fetch<ConversationBootstrapResponse>(
      conversationApiPath(conversationId),
      { query: { beforeSequence: firstSequence } },
    )
    if (conversation.value?.id !== conversationId) return
    applyBootstrap(response.data, 'prepend')
    await nextTick()
    if (listElement.value) {
      listElement.value.scrollTop += listElement.value.scrollHeight - previousScrollHeight
      updateListPosition()
    }
  }
  catch {
    toast.add({
      title: 'Nie udało się pobrać starszych wiadomości',
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  }
  finally {
    loadingOlder.value = false
  }
}

function receiptPayload() {
  const sequence = latestSequence.value
  if (!sequence) return null
  const visible = panelVisible.value
    && listAtEnd.value
    && document.visibilityState === 'visible'
  return {
    deliveredThroughSequence: sequence,
    readThroughSequence: visible
      ? sequence
      : ownReceipt.value?.readThroughSequence ?? 0,
  }
}

function scheduleReceipt() {
  if (!import.meta.client || !conversation.value) return
  if (receiptTimer) clearTimeout(receiptTimer)
  receiptTimer = setTimeout(() => void acknowledgeMessages(), 250)
}

async function acknowledgeMessages() {
  if (!conversation.value) return
  const payload = receiptPayload()
  if (!payload) return
  const delivered = ownReceipt.value?.deliveredThroughSequence ?? 0
  const read = ownReceipt.value?.readThroughSequence ?? 0
  if (
    delivered >= payload.deliveredThroughSequence
    && read >= payload.readThroughSequence
  ) return

  const conversationId = conversation.value.id
  try {
    const response = await $fetch<ReceiptResponse>(
      conversationApiPath(conversationId, '/receipt'),
      { method: 'POST', body: payload },
    )
    if (conversation.value?.id !== conversationId) return
    ownReceipt.value = response.data.receipt
    peerReceipt.value = response.data.peerReceipt
    updateConversationEntry(conversation.value, { unreadCount: 0 })
  }
  catch {
    // A later visibility change or synchronization retries this monotonic receipt.
  }
}

async function tokenRequest() {
  if (!conversation.value) throw new Error('Conversation is not available')
  const response = await fetch(conversationApiPath(conversation.value.id, '/token'), {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`Realtime authorization failed (${response.status})`)
  const payload = await response.json() as TokenResponse
  return payload.data.tokenRequest
}

function stopPolling() {
  if (!pollingTimer) return
  clearInterval(pollingTimer)
  pollingTimer = null
}

function startPolling(interval = realtimeConfiguration.value.pollIntervalMs, state = true) {
  stopPolling()
  if (state) connectionState.value = 'polling'
  pollingTimer = setInterval(() => void syncMissingMessages(), interval)
}

function startIndexPolling() {
  if (indexPollingTimer) clearInterval(indexPollingTimer)
  const interval = Math.max(
    10_000,
    indexResponse.value?.data.realtime.pollIntervalMs ?? 5_000,
  )
  indexPollingTimer = setInterval(() => void refreshIndex(), interval)
}

function stopIndexPolling() {
  if (!indexPollingTimer) return
  clearInterval(indexPollingTimer)
  indexPollingTimer = null
}

async function connectRealtime() {
  if (!import.meta.client || !conversation.value) return
  const realtimeConversationId = conversation.value.id
  const signature = [
    realtimeConversationId,
    realtimeConfiguration.value.mode,
    realtimeConfiguration.value.channel,
  ].join(':')
  if (signature === connectedSignature) return

  disconnectRealtime()
  connectedSignature = signature
  if (
    realtimeConfiguration.value.mode !== 'ably'
    || !realtimeConfiguration.value.channel
  ) {
    startPolling()
    return
  }

  connectionState.value = 'connecting'
  try {
    const Ably = await import('ably')
    let pushPlugin: unknown = null
    if ('serviceWorker' in navigator && 'Notification' in window) {
      try {
        pushPlugin = (await import('ably/push')).default
      }
      catch {
        pushPlugin = null
      }
    }

    const options: Record<string, unknown> = {
      authCallback: async (
        _tokenParams: unknown,
        callback: (error: unknown, tokenRequest: unknown) => void,
      ) => {
        try {
          callback(null, await tokenRequest())
        }
        catch (error) {
          callback(error, null)
        }
      },
      echoMessages: false,
    }
    if (pushPlugin) {
      options.plugins = { Push: pushPlugin }
      options.pushServiceWorkerUrl = '/messaging-sw.js'
    }

    realtimeClient = new Ably.Realtime(options)
    const connectedClient = realtimeClient
    realtimeClient.connection.on((change: { current: string }) => {
      if (realtimeClient !== connectedClient) return
      if (change.current === 'connected') {
        connectionState.value = 'connected'
        startPolling(Math.max(30_000, realtimeConfiguration.value.pollIntervalMs), false)
        void syncMissingMessages()
      }
      else if (change.current === 'failed') {
        realtimeClient = null
        durableChannel = null
        ephemeralChannel = null
        connectedSignature = ''
        connectedClient.close()
        connectionState.value = 'offline'
        startPolling(realtimeConfiguration.value.pollIntervalMs, false)
      }
      else if (change.current === 'suspended') {
        connectionState.value = 'offline'
        startPolling(realtimeConfiguration.value.pollIntervalMs, false)
      }
      else if (change.current === 'disconnected') {
        connectionState.value = 'connecting'
        startPolling(realtimeConfiguration.value.pollIntervalMs, false)
      }
    })

    durableChannel = realtimeClient.channels.get(realtimeConfiguration.value.channel)
    await durableChannel.subscribe('message.created', () => void syncMissingMessages())
    await durableChannel.subscribe('receipt.updated', () => void syncMissingMessages())

    if (realtimeConfiguration.value.ephemeralChannel) {
      ephemeralChannel = realtimeClient.channels.get(
        realtimeConfiguration.value.ephemeralChannel,
      )
      await ephemeralChannel.subscribe(
        'typing.updated',
        (event: { clientId?: string, data?: { active?: boolean } }) => {
          if (conversation.value?.id !== realtimeConversationId) return
          if (event.clientId === realtimeClient?.auth?.clientId) return
          peerTyping.value = event.data?.active === true
          if (peerTypingTimer) clearTimeout(peerTypingTimer)
          peerTypingTimer = setTimeout(() => {
            peerTyping.value = false
          }, 6_000)
        },
      )
    }
  }
  catch {
    if (realtimeClient) realtimeClient.close()
    realtimeClient = null
    connectedSignature = ''
    connectionState.value = 'offline'
    startPolling(realtimeConfiguration.value.pollIntervalMs, false)
  }
}

function disconnectRealtime() {
  stopPolling()
  durableChannel = null
  ephemeralChannel = null
  if (realtimeClient) realtimeClient.close()
  realtimeClient = null
  connectedSignature = ''
}

function publishTyping(active: boolean) {
  if (
    !conversation.value
    || !ephemeralChannel
    || connectionState.value !== 'connected'
  ) return
  void ephemeralChannel.publish('typing.updated', {
    kind: 'typing.updated',
    conversationId: conversation.value.id,
    active,
  }).catch(() => undefined)
}

function onComposerInput() {
  const retryable = retryableSends.get(selectedClientPersonId.value)
  if (retryable && composer.value.trim() !== retryable.body) {
    retryableSends.delete(selectedClientPersonId.value)
  }
  publishTyping(true)
  if (typingTimer) clearTimeout(typingTimer)
  typingTimer = setTimeout(stopTyping, 3_000)
}

function stopTyping() {
  if (typingTimer) clearTimeout(typingTimer)
  typingTimer = null
  publishTyping(false)
}

async function activateNotifications() {
  if (!realtimeClient?.push || notificationsState.value === 'unsupported') return
  activatingNotifications.value = true
  try {
    await realtimeClient.push.activate()
    notificationsState.value = Notification.permission
    pushActivated.value = true
    toast.add({
      title: 'Powiadomienia są włączone',
      description: 'Treść wiadomości nie jest umieszczana w powiadomieniu.',
      color: 'success',
      icon: 'i-lucide-bell-ring',
    })
  }
  catch {
    notificationsState.value = Notification.permission
    pushActivated.value = false
    toast.add({
      title: 'Nie udało się włączyć powiadomień',
      description: 'Sprawdź uprawnienia tej strony w ustawieniach przeglądarki.',
      color: 'error',
      icon: 'i-lucide-bell-off',
    })
  }
  finally {
    activatingNotifications.value = false
  }
}

watch(
  () => [
    conversation.value?.id,
    realtimeConfiguration.value.mode,
    realtimeConfiguration.value.channel,
  ] as const,
  () => void connectRealtime(),
)

watch(readSentinelElement, (current, previous) => {
  if (previous) visibilityObserver?.unobserve(previous)
  if (!current) panelVisible.value = false
  if (current) visibilityObserver?.observe(current)
})

onMounted(() => {
  notificationsState.value = (
    'Notification' in window
    && 'serviceWorker' in navigator
  )
    ? Notification.permission
    : 'unsupported'

  visibilityObserver = new IntersectionObserver(
    ([entry]) => {
      panelVisible.value = Boolean(entry?.isIntersecting)
      scheduleReceipt()
    },
    { threshold: 0.8 },
  )
  if (readSentinelElement.value) visibilityObserver.observe(readSentinelElement.value)
  document.addEventListener('visibilitychange', scheduleReceipt)
  startIndexPolling()
  void connectRealtime()
})

onBeforeUnmount(() => {
  disposed = true
  selectionRevision += 1
  stopTyping()
  if (peerTypingTimer) clearTimeout(peerTypingTimer)
  if (receiptTimer) clearTimeout(receiptTimer)
  visibilityObserver?.disconnect()
  document.removeEventListener('visibilitychange', scheduleReceipt)
  stopIndexPolling()
  disconnectRealtime()
})
</script>

<template>
  <section
    class="case-conversation"
    aria-labelledby="case-conversation-title"
  >
    <UCard class="case-conversation__card">
      <template #header>
        <div class="case-conversation__header">
          <div class="case-conversation__heading">
            <span class="case-conversation__heading-icon">
              <UIcon name="i-lucide-messages-square" />
            </span>
            <div>
              <p>Bezpośredni kontakt</p>
              <h2 id="case-conversation-title">Wiadomości z klientem</h2>
              <span>Rozmowa i potwierdzenia są przypisane do tej sprawy.</span>
            </div>
          </div>

          <div class="case-conversation__actions">
            <UBadge
              v-if="totalUnreadCount > 0"
              color="primary"
              variant="subtle"
              icon="i-lucide-mail-plus"
            >
              Nowe: {{ totalUnreadCount }}
            </UBadge>
            <UBadge
              :color="connectionColor"
              variant="subtle"
              :icon="connectionState === 'connected'
                ? 'i-lucide-wifi'
                : connectionState === 'offline'
                  ? 'i-lucide-wifi-off'
                  : 'i-lucide-refresh-cw'"
            >
              {{ connectionLabel }}
            </UBadge>
            <UButton
              v-if="!pushActivated
                && (notificationsState === 'default' || notificationsState === 'granted')
                && realtimeConfiguration.mode === 'ably'
                && conversation"
              color="neutral"
              variant="outline"
              size="sm"
              icon="i-lucide-bell-plus"
              :loading="activatingNotifications"
              :disabled="connectionState !== 'connected'"
              @click="activateNotifications"
            >
              Powiadomienia
            </UButton>
            <UBadge
              v-else-if="pushActivated"
              color="success"
              variant="subtle"
              icon="i-lucide-bell-ring"
            >
              Powiadomienia włączone
            </UBadge>
          </div>
        </div>

        <UFormField
          v-if="recipients.length > 1"
          class="case-conversation__recipient-field"
          label="Rozmowa z"
          name="conversation-recipient"
        >
          <USelectMenu
            v-model="selectedClientPersonId"
            class="w-full"
            :items="recipientItems"
            value-key="value"
            label-key="label"
            :disabled="sending"
            placeholder="Wybierz klienta"
            aria-label="Wybierz klienta do rozmowy"
          />
        </UFormField>

        <div v-else-if="selectedRecipient" class="case-conversation__recipient">
          <span><UIcon name="i-lucide-user-round" /></span>
          <div>
            <strong>{{ selectedRecipient.displayName }}</strong>
            <small>{{ selectedRecipient.email || 'Brak adresu e-mail' }}</small>
          </div>
          <UBadge
            :color="selectedRecipient.portalActivated ? 'success' : 'neutral'"
            variant="subtle"
            size="xs"
          >
            {{ selectedRecipient.portalActivated ? 'Panel aktywny' : 'Oczekuje na aktywację' }}
          </UBadge>
        </div>
      </template>

      <div v-if="isIndexLoading" class="case-conversation__loading">
        <USkeleton class="h-12 w-2/3" />
        <USkeleton class="h-16 w-3/4" />
        <USkeleton class="ml-auto h-16 w-3/4" />
      </div>

      <UAlert
        v-else-if="indexError && !recipients.length"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        title="Nie udało się pobrać rozmów"
        description="Historia pozostaje bezpieczna. Odśwież dane i spróbuj ponownie."
      >
        <template #actions>
          <UButton color="error" variant="soft" size="sm" @click="refreshIndex()">
            Odśwież
          </UButton>
        </template>
      </UAlert>

      <UAlert
        v-else-if="!recipients.length"
        color="warning"
        variant="subtle"
        icon="i-lucide-user-round-x"
        title="Brak osoby do rozmowy"
        description="Przypisz klienta i udostępnij mu panel, aby rozpocząć bezpieczną rozmowę."
      >
        <template #actions>
          <UButton :to="portalSettingsLocation" color="warning" variant="soft" size="sm">
            Ustaw dostęp klienta
          </UButton>
        </template>
      </UAlert>

      <template v-else>
        <UAlert
          v-if="selectedRecipient && !selectedRecipient.portalEnabled"
          class="case-conversation__notice"
          color="warning"
          variant="subtle"
          icon="i-lucide-lock-keyhole"
          title="Panel klienta nie jest udostępniony"
          description="Włącz dostęp do panelu, zanim wyślesz pierwszą wiadomość."
        >
          <template #actions>
            <UButton :to="portalSettingsLocation" color="warning" variant="soft" size="sm">
              Ustaw dostęp
            </UButton>
          </template>
        </UAlert>

        <UAlert
          v-else-if="selectedRecipient && !selectedRecipient.portalActivated"
          class="case-conversation__notice"
          color="info"
          variant="subtle"
          icon="i-lucide-mail-clock"
          title="Klient nie aktywował jeszcze panelu"
          description="Możesz napisać teraz — wiadomość będzie czekała po aktywacji konta."
        />

        <UAlert
          v-if="conversationLoadError"
          class="case-conversation__notice"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          title="Nie udało się otworzyć historii rozmowy"
          description="Odśwież rozmowę przed wysłaniem kolejnej wiadomości."
        >
          <template #actions>
            <UButton color="error" variant="soft" size="sm" @click="scheduleRecipientSelection">
              Spróbuj ponownie
            </UButton>
          </template>
        </UAlert>

        <div
          v-if="!conversationLoadError"
          ref="listElement"
          class="case-conversation__messages"
          aria-live="polite"
          aria-label="Historia wiadomości"
          @scroll.passive="updateListPosition"
        >
          <div v-if="hasOlderMessages" class="case-conversation__older">
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-history"
              :loading="loadingOlder"
              @click="loadOlderMessages"
            >
              Pokaż starsze wiadomości
            </UButton>
          </div>

          <template v-if="loadingConversation">
            <USkeleton class="h-16 w-3/4" />
            <USkeleton class="ml-auto h-16 w-3/4" />
            <USkeleton class="h-16 w-2/3" />
          </template>

          <div
            v-else-if="!messages.length
              && !(pendingBody && pendingRecipientId === selectedClientPersonId)"
            class="case-conversation__empty"
          >
            <span><UIcon name="i-lucide-message-circle-more" /></span>
            <strong>Zacznij rozmowę z {{ selectedRecipient?.displayName }}</strong>
            <p>Napisz krótką wiadomość — klient zobaczy ją w panelu swojej sprawy.</p>
          </div>

          <article
            v-for="message in messages"
            :key="message.id"
            :class="[
              'case-message',
              message.senderKind === 'staff' ? 'case-message--mine' : 'case-message--theirs',
            ]"
          >
            <div>
              <p>{{ message.body }}</p>
              <footer>
                <time :datetime="message.createdAt">{{ formatMessageTime(message.createdAt) }}</time>
                <span v-if="message.senderKind === 'staff'">
                  {{ deliveryLabel(message) }}
                  <UIcon
                    :name="deliveryLabel(message) === 'Odczytano'
                      ? 'i-lucide-check-check'
                      : 'i-lucide-check'"
                  />
                </span>
              </footer>
            </div>
          </article>

          <article
            v-if="pendingBody && pendingRecipientId === selectedClientPersonId"
            class="case-message case-message--mine is-pending"
          >
            <div>
              <p>{{ pendingBody }}</p>
              <footer><span>Wysyłanie…</span></footer>
            </div>
          </article>

          <div v-if="peerTyping" class="case-conversation__typing">
            <span /><span /><span />
            {{ selectedRecipient?.displayName }} pisze…
          </div>
          <span ref="readSentinelElement" class="case-conversation__read-sentinel" aria-hidden="true" />
        </div>

        <form
          v-if="!conversationLoadError"
          class="case-conversation__composer"
          @submit.prevent="sendMessage"
        >
          <UTextarea
            v-model="composer"
            class="w-full"
            autoresize
            :rows="1"
            :maxrows="7"
            :maxlength="4000"
            :disabled="sending || !selectedRecipient?.portalEnabled"
            :placeholder="selectedRecipient?.portalEnabled
              ? `Napisz do ${selectedRecipient.displayName}…`
              : 'Najpierw udostępnij panel klienta'"
            aria-label="Treść wiadomości"
            @input="onComposerInput"
            @blur="stopTyping"
            @keydown.enter.exact.prevent="sendMessage"
          />
          <UButton
            type="submit"
            color="primary"
            variant="solid"
            icon="i-lucide-arrow-up"
            :loading="sending"
            :disabled="!canSend"
            aria-label="Wyślij wiadomość"
          />
        </form>
        <p v-if="!conversationLoadError" class="case-conversation__hint">
          Enter wysyła · Shift+Enter dodaje nową linię
        </p>
      </template>
    </UCard>
  </section>
</template>

<style scoped>
.case-conversation {
  min-width: 0;
}

.case-conversation__card {
  overflow: hidden;
}

.case-conversation__header,
.case-conversation__heading,
.case-conversation__actions,
.case-conversation__recipient,
.case-conversation__composer,
.case-message footer,
.case-message footer span,
.case-conversation__typing {
  display: flex;
  align-items: center;
}

.case-conversation__header {
  justify-content: space-between;
  gap: 20px;
}

.case-conversation__heading {
  gap: 12px;
  min-width: 0;
}

.case-conversation__heading-icon,
.case-conversation__recipient > span,
.case-conversation__empty > span {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 999px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-highlighted);
}

.case-conversation__heading-icon {
  width: 42px;
  height: 42px;
}

.case-conversation__heading-icon svg {
  width: 20px;
  height: 20px;
}

.case-conversation__heading p,
.case-conversation__heading h2,
.case-conversation__heading span,
.case-conversation__empty p,
.case-message p,
.case-conversation__hint {
  margin: 0;
}

.case-conversation__heading p {
  color: var(--ui-primary);
  font-size: 10px;
  font-weight: 750;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.case-conversation__heading h2 {
  color: var(--ui-text-highlighted);
  font-size: 17px;
  font-weight: 680;
}

.case-conversation__heading span {
  display: block;
  margin-top: 2px;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.case-conversation__actions {
  flex: 0 0 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.case-conversation__recipient-field,
.case-conversation__recipient {
  margin-top: 16px;
}

.case-conversation__recipient {
  gap: 10px;
  padding-top: 14px;
  border-top: 1px solid var(--ui-border-muted);
}

.case-conversation__recipient > span {
  width: 34px;
  height: 34px;
}

.case-conversation__recipient > div {
  display: grid;
  flex: 1;
  gap: 2px;
  min-width: 0;
}

.case-conversation__recipient strong,
.case-conversation__recipient small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.case-conversation__recipient strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.case-conversation__recipient small {
  color: var(--ui-text-muted);
  font-size: 11px;
}

.case-conversation__notice {
  margin-bottom: 14px;
}

.case-conversation__loading {
  display: grid;
  min-height: 360px;
  align-content: center;
  gap: 12px;
}

.case-conversation__messages {
  display: flex;
  min-height: 360px;
  max-height: min(62dvh, 660px);
  flex-direction: column;
  gap: 9px;
  overflow-y: auto;
  margin: -8px -8px 0;
  padding: 18px 8px 20px;
  overscroll-behavior: contain;
  scroll-behavior: smooth;
}

.case-conversation__older {
  align-self: center;
  margin-bottom: 4px;
}

.case-conversation__empty {
  display: grid;
  max-width: 410px;
  margin: auto;
  justify-items: center;
  color: var(--ui-text-muted);
  text-align: center;
}

.case-conversation__empty > span {
  width: 52px;
  height: 52px;
  margin-bottom: 12px;
}

.case-conversation__empty > span svg {
  width: 24px;
  height: 24px;
}

.case-conversation__empty strong {
  color: var(--ui-text-highlighted);
  font-size: 15px;
}

.case-conversation__empty p {
  margin-top: 5px;
  font-size: 12px;
  line-height: 1.5;
}

.case-message {
  display: flex;
  width: 100%;
}

.case-message > div {
  max-width: min(76%, 660px);
  padding: 10px 13px 7px;
  border-radius: 17px 17px 17px 5px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-highlighted);
}

.case-message--mine {
  justify-content: flex-end;
}

.case-message--mine > div {
  border-radius: 17px 17px 5px;
  background: var(--ui-bg-inverted);
  color: var(--ui-text-inverted);
}

.case-message.is-pending > div {
  opacity: .65;
}

.case-message p {
  font-size: 13px;
  line-height: 1.5;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.case-message footer {
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
  color: color-mix(in srgb, currentColor 62%, transparent);
  font-size: 9px;
}

.case-message footer span {
  gap: 3px;
}

.case-message footer svg {
  width: 11px;
  height: 11px;
}

.case-conversation__typing {
  align-self: flex-start;
  gap: 4px;
  min-height: 28px;
  padding: 6px 10px;
  color: var(--ui-text-muted);
  font-size: 10px;
}

.case-conversation__typing > span {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: var(--ui-text-dimmed);
  animation: case-conversation-typing 1.1s infinite ease-in-out;
}

.case-conversation__typing > span:nth-child(2) {
  animation-delay: .14s;
}

.case-conversation__typing > span:nth-child(3) {
  margin-right: 5px;
  animation-delay: .28s;
}

.case-conversation__read-sentinel {
  flex: 0 0 1px;
  width: 100%;
}

.case-conversation__composer {
  gap: 9px;
  padding-top: 14px;
  border-top: 1px solid var(--ui-border-muted);
}

.case-conversation__composer > :last-child {
  align-self: flex-end;
  width: 38px;
  height: 38px;
  justify-content: center;
  border-radius: 999px;
}

.case-conversation__hint {
  margin-top: 7px;
  color: var(--ui-text-dimmed);
  font-size: 10px;
  text-align: right;
}

@keyframes case-conversation-typing {
  0%, 60%, 100% { transform: translateY(0); opacity: .45; }
  30% { transform: translateY(-3px); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .case-conversation__typing > span {
    animation: none;
  }
}

@media (max-width: 640px) {
  .case-conversation__header {
    align-items: flex-start;
    flex-direction: column;
  }

  .case-conversation__actions {
    width: 100%;
    justify-content: flex-start;
  }

  .case-conversation__heading span {
    display: none;
  }

  .case-conversation__recipient {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .case-conversation__messages {
    min-height: 52dvh;
    max-height: 62dvh;
  }

  .case-message > div {
    max-width: 88%;
  }

  .case-conversation__hint {
    display: none;
  }
}
</style>
