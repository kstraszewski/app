<script setup lang="ts">
import type {
  Conversation,
  Message,
  MessageAttachment,
  Receipt,
} from '@openexpert/messaging'
import {
  classifyMessageAttachmentCompletionFailure,
  MessageAttachmentComposer,
  MessageAttachments,
  useMessageAttachmentDrafts,
  type MessageAttachmentDraftAdapter,
  type MessageAttachmentUploadReservation,
} from '@openexpert/messaging-ui'
import { PORTAL_TIME_ZONE } from '~/utils/portal-date'

interface RealtimeConfiguration {
  mode: 'ably' | 'polling'
  channel: string | null
  ephemeralChannel: string | null
}

interface ConversationResponse {
  data: {
    conversation: Conversation
    messages: Message[]
    receipt: Receipt | null
    peerReceipt: Receipt | null
    pageInfo: {
      lastSequence: number
      hasMore: boolean
    }
    realtime: RealtimeConfiguration
  }
}

interface RetryableSend {
  body: string
  clientMessageId: string
  attachmentIds: string[]
}

function requestErrorCode(error: unknown): string {
  const candidate = error && typeof error === 'object'
    ? error as Record<string, any>
    : {}
  return String(
    candidate.data?.data?.code
    ?? candidate.data?.code
    ?? candidate.response?._data?.data?.code
    ?? candidate.response?._data?.code
    ?? '',
  )
}

const props = withDefaults(defineProps<{
  caseId: string
  expertName: string
  caseTitle?: string
  caseTo?: string
  backTo?: string
  preview?: boolean
  surface?: 'card' | 'pane'
}>(), {
  preview: false,
  surface: 'card',
})
const emit = defineEmits<{
  messageSent: []
  receiptUpdated: []
}>()

const toast = useToast()
const { $portalFetch } = useNuxtApp()
const apiPath = computed(
  () => `/api/client/cases/${encodeURIComponent(props.caseId)}/conversation`,
)
const authenticatedUser = useAuthUser()
const draftClientMessageId = useState<string>(
  `portal-case-conversation:draft:${authenticatedUser.value?.id || 'session'}:${props.caseId}`,
  () => crypto.randomUUID(),
)
const attachmentApiPaths = new Map<string, string>()
const attachmentAdapter: MessageAttachmentDraftAdapter = {
  async reserve(input) {
    const attachmentApiPath = `${apiPath.value}/attachments`
    const response = await $portalFetch<{ data: MessageAttachmentUploadReservation }>(
      attachmentApiPath,
      { method: 'POST', body: input },
    )
    attachmentApiPaths.set(response.data.attachment.id, attachmentApiPath)
    return response.data
  },
  async complete(id) {
    const attachmentApiPath = attachmentApiPaths.get(id)
    if (!attachmentApiPath) {
      throw Object.assign(
        new Error('Nie znaleziono przygotowanego załącznika.'),
        { statusCode: 404 },
      )
    }
    const response = await $portalFetch<{ data: { attachment: MessageAttachment } }>(
      `${attachmentApiPath}/${encodeURIComponent(id)}/complete`,
      { method: 'POST' },
    )
    return response.data.attachment
  },
  async discard(id) {
    const attachmentApiPath = attachmentApiPaths.get(id)
    if (!attachmentApiPath) return
    try {
      await $portalFetch(`${attachmentApiPath}/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
    }
    finally {
      attachmentApiPaths.delete(id)
    }
  },
  completionFailureMode: classifyMessageAttachmentCompletionFailure,
}
const attachmentDrafts = useMessageAttachmentDrafts(attachmentAdapter)

function previewConversationResponse(): ConversationResponse {
  const conversationId = `preview-conversation-${props.caseId}`
  const messages: Message[] = [
    {
      id: `${conversationId}-1`,
      organizationId: 'org-openexpert-local',
      conversationId,
      sequence: 1,
      clientMessageId: `${conversationId}-client-1`,
      senderKind: 'staff',
      senderUserId: 'preview-expert',
      senderClientPersonId: null,
      senderAuthUserId: null,
      body: 'Dzień dobry, dodałam najważniejsze informacje do sprawy. Jeśli coś będzie niejasne, proszę napisać tutaj.',
      attachments: [],
      createdAt: '2026-08-01T08:42:00.000Z',
      editedAt: null,
      deletedAt: null,
    },
    {
      id: `${conversationId}-2`,
      organizationId: 'org-openexpert-local',
      conversationId,
      sequence: 2,
      clientMessageId: `${conversationId}-client-2`,
      senderKind: 'client',
      senderUserId: null,
      senderClientPersonId: 'preview-client',
      senderAuthUserId: 'preview-auth-user',
      body: 'Dziękuję. Dokument prześlę jeszcze dzisiaj po południu.',
      attachments: [],
      createdAt: '2026-08-01T09:08:00.000Z',
      editedAt: null,
      deletedAt: null,
    },
    {
      id: `${conversationId}-3`,
      organizationId: 'org-openexpert-local',
      conversationId,
      sequence: 3,
      clientMessageId: `${conversationId}-client-3`,
      senderKind: 'staff',
      senderUserId: 'preview-expert',
      senderClientPersonId: null,
      senderAuthUserId: null,
      body: 'Świetnie. Gdy tylko plik się pojawi, od razu go sprawdzę.',
      attachments: [],
      createdAt: '2026-08-01T09:11:00.000Z',
      editedAt: null,
      deletedAt: null,
    },
  ]

  return {
    data: {
      conversation: {
        id: conversationId,
        organizationId: 'org-openexpert-local',
        caseId: props.caseId,
        clientId: 'preview-client-account',
        clientPersonId: 'preview-client',
        lastMessageSequence: messages.length,
        lastMessageAt: messages.at(-1)?.createdAt ?? null,
        createdAt: '2026-07-29T08:00:00.000Z',
        updatedAt: messages.at(-1)?.createdAt ?? '2026-07-29T08:00:00.000Z',
      },
      messages,
      receipt: null,
      peerReceipt: {
        id: `${conversationId}-peer-receipt`,
        organizationId: 'org-openexpert-local',
        conversationId,
        participantKind: 'staff',
        participantUserId: 'preview-expert',
        participantClientPersonId: null,
        deliveredThroughSequence: 2,
        readThroughSequence: 2,
        deliveredAt: '2026-08-01T09:09:00.000Z',
        readAt: '2026-08-01T09:09:00.000Z',
        updatedAt: '2026-08-01T09:09:00.000Z',
      },
      pageInfo: { lastSequence: messages.length, hasMore: false },
      realtime: { mode: 'polling', channel: null, ephemeralChannel: null },
    },
  }
}

const {
  data: initialResponse,
  status,
  error: initialError,
  refresh,
} = useAsyncData<ConversationResponse>(
  () => `portal-case-conversation:${props.preview ? 'preview:' : ''}${props.caseId}`,
  () => props.preview
    ? Promise.resolve(previewConversationResponse())
    : $portalFetch<ConversationResponse>(apiPath.value),
  { watch: [apiPath] },
)

const conversation = ref<Conversation | null>(null)
const messages = ref<Message[]>([])
const ownReceipt = ref<Receipt | null>(null)
const peerReceipt = ref<Receipt | null>(null)
const realtimeConfiguration = ref<RealtimeConfiguration>({
  mode: 'polling',
  channel: null,
  ephemeralChannel: null,
})
const composer = useState<string>(
  `portal-case-conversation:composer:${authenticatedUser.value?.id || 'session'}:${props.caseId}`,
  () => '',
)
const retryableSend = ref<RetryableSend | null>(null)
const sending = ref(false)
const syncing = ref(false)
const loadingOlder = ref(false)
const hasOlderMessages = ref(false)
const pendingMessage = ref<{
  body: string
  attachments: MessageAttachment[]
} | null>(null)
const listElement = ref<HTMLElement | null>(null)
const listAtEnd = ref(true)
const readSentinelElement = ref<HTMLElement | null>(null)
const conversationVisible = ref(false)
const connectionState = ref<'connecting' | 'connected' | 'polling' | 'offline'>(
  props.preview ? 'connected' : 'connecting',
)
const peerTyping = ref(false)
const notificationsState = ref<'unsupported' | 'default' | 'denied' | 'granted'>('unsupported')
const activatingNotifications = ref(false)
const pushActivated = ref(false)

let realtimeClient: any = null
let durableChannel: any = null
let ephemeralChannel: any = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let typingTimer: ReturnType<typeof setTimeout> | null = null
let peerTypingTimer: ReturnType<typeof setTimeout> | null = null
let receiptTimer: ReturnType<typeof setTimeout> | null = null
let visibilityObserver: IntersectionObserver | null = null
let connectedConversationId = ''
let syncRequested = false

const latestSequence = computed(() => (
  messages.value.at(-1)?.sequence
  ?? conversation.value?.lastMessageSequence
  ?? 0
))
const expertFirstName = computed(() => props.expertName.trim().split(/\s+/u)[0] || 'eksperta')
const expertInitials = computed(() => {
  const parts = props.expertName.trim().split(/\s+/u)
  return `${parts[0]?.[0] ?? ''}${parts.at(-1)?.[0] ?? ''}`.toUpperCase()
})
const isLoading = computed(() => status.value === 'pending' && !conversation.value)
const loadError = computed(() => Boolean(initialError.value) && !conversation.value)
const canSend = computed(() => {
  const body = composer.value.trim()
  const hasContent = body.length >= 1 || attachmentDrafts.readyAttachments.value.length >= 1
  return hasContent
    && body.length <= 4000
    && !sending.value
    && !loadError.value
    && !attachmentDrafts.isBusy.value
    && !attachmentDrafts.hasFailed.value
})

function messageAttachmentUrl(attachment: MessageAttachment, download: boolean) {
  const path = `${apiPath.value}/attachments/${encodeURIComponent(attachment.id)}`
  return download ? `${path}?download=1` : path
}

function mergeMessages(incoming: Message[]) {
  const byId = new Map(messages.value.map(message => [message.id, message]))
  for (const message of incoming) byId.set(message.id, message)
  messages.value = [...byId.values()].sort((a, b) => a.sequence - b.sequence)
}

function applyResponse(
  response: ConversationResponse | null | undefined,
  mode: 'initial' | 'incremental' | 'older' = 'initial',
) {
  if (!response?.data?.conversation) return
  if (response.data.conversation.caseId !== props.caseId) return
  const shouldFollowMessages = mode === 'initial'
    || (mode === 'incremental' && listAtEnd.value)
  conversation.value = response.data.conversation
  ownReceipt.value = response.data.receipt
  peerReceipt.value = response.data.peerReceipt
  realtimeConfiguration.value = response.data.realtime ?? realtimeConfiguration.value
  mergeMessages(response.data.messages ?? [])
  if (mode !== 'incremental') {
    hasOlderMessages.value = response.data.pageInfo?.hasMore === true
  }
  if (shouldFollowMessages) void nextTick(scrollToEnd)
  scheduleReceipt()
}

watch(initialResponse, response => applyResponse(response), { immediate: true })

watch(() => props.caseId, () => {
  void attachmentDrafts.clear({ discard: !sending.value })
  retryableSend.value = null
  draftClientMessageId.value = crypto.randomUUID()
  composer.value = ''
  pendingMessage.value = null
  stopTyping()
  disconnectRealtime()
  conversation.value = null
  messages.value = []
  ownReceipt.value = null
  peerReceipt.value = null
  hasOlderMessages.value = false
  peerTyping.value = false
  realtimeConfiguration.value = {
    mode: 'polling',
    channel: null,
    ephemeralChannel: null,
  }
  connectionState.value = props.preview ? 'connected' : 'connecting'
})

function formatMessageTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: PORTAL_TIME_ZONE,
  }).format(date)
}

function deliveryLabel(message: Message) {
  if (message.senderKind !== 'client') return ''
  if ((peerReceipt.value?.readThroughSequence ?? 0) >= message.sequence) return 'Odczytano'
  if ((peerReceipt.value?.deliveredThroughSequence ?? 0) >= message.sequence) return 'Dostarczono'
  return 'Wysłano'
}

function scrollToEnd() {
  if (!listElement.value) return
  listAtEnd.value = true
  listElement.value.scrollTo({
    top: listElement.value.scrollHeight,
    behavior: messages.value.length > 1 ? 'smooth' : 'auto',
  })
}

function updateListPosition() {
  const element = listElement.value
  if (!element) return
  listAtEnd.value = element.scrollHeight - element.scrollTop - element.clientHeight <= 48
  scheduleReceipt()
}

async function syncMissingMessages() {
  if (props.preview || !conversation.value) return
  if (syncing.value) {
    syncRequested = true
    return
  }
  syncing.value = true
  try {
    do {
      syncRequested = false
      const previousSequence = latestSequence.value
      const response = await $portalFetch<ConversationResponse>(apiPath.value, {
        query: { afterSequence: previousSequence },
      })
      applyResponse(response, 'incremental')
      if (
        response.data.pageInfo?.hasMore
        && latestSequence.value > previousSequence
      ) {
        syncRequested = true
      }
      if (realtimeConfiguration.value.mode === 'ably' && !realtimeClient) {
        void connectRealtime()
      }
      connectionState.value = realtimeConfiguration.value.mode === 'ably'
        ? connectionState.value
        : 'polling'
    } while (syncRequested)
  }
  catch {
    if (connectionState.value !== 'connected') connectionState.value = 'offline'
  }
  finally {
    const rerun = syncRequested
    syncing.value = false
    syncRequested = false
    if (rerun) queueMicrotask(() => void syncMissingMessages())
  }
}

async function loadOlderMessages() {
  if (props.preview) return
  const firstSequence = messages.value[0]?.sequence
  if (!conversation.value || !firstSequence || loadingOlder.value) return
  loadingOlder.value = true
  const list = listElement.value
  const previousHeight = list?.scrollHeight ?? 0
  try {
    const response = await $portalFetch<ConversationResponse>(apiPath.value, {
      query: { beforeSequence: firstSequence },
    })
    applyResponse(response, 'older')
    await nextTick()
    if (list) list.scrollTop += list.scrollHeight - previousHeight
  }
  catch (caught) {
    if (isUnauthorizedRequestError(caught)) return
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
  return {
    deliveredThroughSequence: sequence,
    readThroughSequence: (
      conversationVisible.value
      && (!import.meta.client || document.visibilityState === 'visible')
    )
      ? sequence
      : ownReceipt.value?.readThroughSequence ?? 0,
  }
}

function scheduleReceipt() {
  if (props.preview || !import.meta.client || !conversation.value) return
  if (receiptTimer) clearTimeout(receiptTimer)
  receiptTimer = setTimeout(() => void acknowledgeMessages(), 250)
}

async function acknowledgeMessages() {
  if (props.preview) return
  const payload = receiptPayload()
  if (!payload || !conversation.value) return
  const delivered = ownReceipt.value?.deliveredThroughSequence ?? 0
  const read = ownReceipt.value?.readThroughSequence ?? 0
  if (
    delivered >= payload.deliveredThroughSequence
    && read >= payload.readThroughSequence
  ) return

  try {
    const response = await $portalFetch<{ data: { receipt: Receipt } }>(
      `${apiPath.value}/receipt`,
      { method: 'POST', body: payload },
    )
    ownReceipt.value = response.data.receipt
    emit('receiptUpdated')
  }
  catch {
    // The next sync or visibility change retries this monotonic acknowledgement.
  }
}

async function sendMessage() {
  const body = composer.value.trim()
  if (!canSend.value) return

  if (props.preview) {
    const sequence = latestSequence.value + 1
    mergeMessages([{
      id: crypto.randomUUID(),
      organizationId: conversation.value?.organizationId || 'org-openexpert-local',
      conversationId: conversation.value?.id || `preview-conversation-${props.caseId}`,
      sequence,
      clientMessageId: draftClientMessageId.value,
      senderKind: 'client',
      senderUserId: null,
      senderClientPersonId: 'preview-client',
      senderAuthUserId: 'preview-auth-user',
      body,
      attachments: [],
      createdAt: new Date().toISOString(),
      editedAt: null,
      deletedAt: null,
    }])
    composer.value = ''
    draftClientMessageId.value = crypto.randomUUID()
    emit('messageSent')
    void nextTick(scrollToEnd)
    return
  }

  const sendingCaseId = props.caseId
  const sendingApiPath = apiPath.value
  const attachments = [...attachmentDrafts.readyAttachments.value]
  const attachmentIds = attachments.map(attachment => attachment.id)
  const previousAttempt = retryableSend.value
  const matchesPreviousAttempt = previousAttempt?.body === body
    && previousAttempt.attachmentIds.length === attachmentIds.length
    && previousAttempt.attachmentIds.every((id, index) => id === attachmentIds[index])
  if (previousAttempt && !matchesPreviousAttempt) {
    const nextClientMessageId = crypto.randomUUID()
    retryableSend.value = null
    draftClientMessageId.value = nextClientMessageId
    if (attachmentDrafts.drafts.value.length) {
      await attachmentDrafts.restartForClientMessageId(nextClientMessageId)
      toast.add({
        title: 'Aktualizujemy załączniki',
        description: 'Szkic się zmienił, dlatego pliki są bezpiecznie przesyłane ponownie.',
        color: 'info',
        icon: 'i-lucide-refresh-cw',
      })
      return
    }
  }
  const attempt = matchesPreviousAttempt && previousAttempt
    ? previousAttempt
    : {
        body,
        clientMessageId: draftClientMessageId.value,
        attachmentIds,
      }
  retryableSend.value = attempt
  sending.value = true
  pendingMessage.value = { body, attachments }
  composer.value = ''
  stopTyping()

  try {
    const response = await $portalFetch<{ data: { message: Message, peerReceipt?: Receipt | null } }>(
      sendingApiPath,
      {
        method: 'POST',
        body: {
          body,
          clientMessageId: attempt.clientMessageId,
          attachmentIds: attempt.attachmentIds,
        },
      },
    )
    if (props.caseId !== sendingCaseId) {
      for (const attachmentId of attachmentIds) attachmentApiPaths.delete(attachmentId)
      return
    }
    if (response.data.message) mergeMessages([response.data.message])
    if (response.data.peerReceipt !== undefined) peerReceipt.value = response.data.peerReceipt
    await attachmentDrafts.clear({ discard: false })
    for (const attachmentId of attachmentIds) attachmentApiPaths.delete(attachmentId)
    retryableSend.value = null
    draftClientMessageId.value = crypto.randomUUID()
    emit('messageSent')
    pendingMessage.value = null
    void nextTick(scrollToEnd)
  }
  catch (caught: any) {
    if (props.caseId !== sendingCaseId) {
      for (const attachmentId of attachmentIds) attachmentApiPaths.delete(attachmentId)
      return
    }
    if (requestErrorCode(caught) === 'case_message_attachment_unavailable') {
      attachmentDrafts.invalidateReadyAttachments(
        attachmentIds,
        'Załącznik wygasł. Kliknij „Ponów”, aby przesłać go ponownie.',
      )
      retryableSend.value = null
    }
    composer.value = body
    pendingMessage.value = null
    if (isUnauthorizedRequestError(caught)) return
    toast.add({
      title: 'Nie udało się wysłać wiadomości',
      description: 'Treść i załączniki zostały zachowane. Spróbuj ponownie za chwilę.',
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  }
  finally {
    sending.value = false
  }
}

async function tokenRequest() {
  const payload = await $portalFetch<any>(`${apiPath.value}/token`, {
    headers: { Accept: 'application/json' },
  })
  return payload.data?.tokenRequest ?? payload.tokenRequest ?? payload
}

function stopPolling() {
  if (!pollTimer) return
  clearInterval(pollTimer)
  pollTimer = null
}

function startPolling(interval = 5_000) {
  if (props.preview) return
  stopPolling()
  connectionState.value = connectionState.value === 'offline' ? 'offline' : 'polling'
  pollTimer = setInterval(() => void syncMissingMessages(), interval)
}

async function connectRealtime() {
  if (
    props.preview
    ||
    !import.meta.client
    || !conversation.value
    || connectedConversationId === conversation.value.id
  ) return

  disconnectRealtime()
  connectedConversationId = conversation.value.id
  if (
    realtimeConfiguration.value.mode !== 'ably'
    || !realtimeConfiguration.value.channel
  ) {
    startPolling()
    return
  }

  connectionState.value = 'connecting'
  try {
    const [Ably, pushModule] = await Promise.all([
      import('ably'),
      import('ably/push'),
    ])
    realtimeClient = new Ably.Realtime({
      authCallback: async (_tokenParams, callback) => {
        try {
          callback(null, await tokenRequest())
        }
        catch (error) {
          callback(
            error instanceof Error ? error.message : 'Realtime authorization failed',
            null,
          )
        }
      },
      echoMessages: false,
      plugins: { Push: pushModule.default },
      pushServiceWorkerUrl: '/messaging-sw.js',
    })
    const connectedClient = realtimeClient
    realtimeClient.connection.on((change: { current: string }) => {
      if (realtimeClient !== connectedClient) return
      if (change.current === 'connected') {
        connectionState.value = 'connected'
        startPolling(30_000)
        connectionState.value = 'connected'
        void syncMissingMessages()
      }
      else if (change.current === 'failed') {
        realtimeClient = null
        durableChannel = null
        ephemeralChannel = null
        connectedConversationId = ''
        connectedClient.close()
        connectionState.value = 'offline'
        startPolling()
      }
      else if (change.current === 'suspended') {
        connectionState.value = 'offline'
        startPolling()
      }
      else if (change.current === 'disconnected') {
        connectionState.value = 'connecting'
        startPolling()
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
        (message: { clientId?: string, data?: { active?: boolean } }) => {
          if (message.clientId === realtimeClient?.auth?.clientId) return
          peerTyping.value = message.data?.active === true
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
    durableChannel = null
    ephemeralChannel = null
    connectedConversationId = ''
    connectionState.value = 'offline'
    startPolling()
  }
}

function disconnectRealtime() {
  stopPolling()
  durableChannel = null
  ephemeralChannel = null
  if (realtimeClient) realtimeClient.close()
  realtimeClient = null
  connectedConversationId = ''
}

function publishTyping(active: boolean) {
  if (props.preview) return
  if (!ephemeralChannel || connectionState.value !== 'connected') return
  void ephemeralChannel.publish('typing.updated', {
    kind: 'typing.updated',
    conversationId: conversation.value?.id,
    active,
  }).catch(() => undefined)
}

function onComposerInput() {
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
    notificationsState.value = Notification.permission as typeof notificationsState.value
    pushActivated.value = true
    toast.add({
      title: 'Powiadomienia są włączone',
      description: 'Pokażemy tylko bezpieczną informację o nowej wiadomości.',
      color: 'success',
      icon: 'i-lucide-bell-ring',
    })
  }
  catch {
    notificationsState.value = Notification.permission as typeof notificationsState.value
    pushActivated.value = false
    toast.add({
      title: 'Nie udało się włączyć powiadomień',
      description: 'Sprawdź uprawnienia tej strony w przeglądarce.',
      color: 'error',
      icon: 'i-lucide-bell-off',
    })
  }
  finally {
    activatingNotifications.value = false
  }
}

watch(
  () => [conversation.value?.id, realtimeConfiguration.value.mode] as const,
  () => void connectRealtime(),
)

onMounted(() => {
  if (props.preview) {
    connectionState.value = 'connected'
    return
  }
  notificationsState.value = (
    'Notification' in window
    && 'serviceWorker' in navigator
  )
    ? Notification.permission
    : 'unsupported'
  visibilityObserver = new IntersectionObserver(
    ([entry]) => {
      conversationVisible.value = Boolean(entry?.isIntersecting)
      scheduleReceipt()
    },
    { threshold: 0.45 },
  )
  if (readSentinelElement.value) visibilityObserver.observe(readSentinelElement.value)
  document.addEventListener('visibilitychange', scheduleReceipt)
  void connectRealtime()
})

onBeforeUnmount(() => {
  void attachmentDrafts.clear({ discard: !sending.value })
  stopTyping()
  if (peerTypingTimer) clearTimeout(peerTypingTimer)
  if (receiptTimer) clearTimeout(receiptTimer)
  visibilityObserver?.disconnect()
  document.removeEventListener('visibilitychange', scheduleReceipt)
  disconnectRealtime()
  draftClientMessageId.value = crypto.randomUUID()
})
</script>

<template>
  <section
    id="portal-case-conversation"
    :class="[
      'portal-conversation',
      `portal-conversation--${surface}`,
    ]"
    aria-labelledby="portal-conversation-title"
  >
    <header class="portal-conversation__header">
      <div class="portal-conversation__expert">
        <NuxtLink
          v-if="backTo"
          :to="backTo"
          class="portal-conversation__back"
          aria-label="Wróć do listy rozmów"
        >
          <UIcon name="i-lucide-arrow-left" />
        </NuxtLink>
        <span class="portal-conversation__avatar">{{ expertInitials }}</span>
        <div>
          <p id="portal-conversation-title">{{ caseTitle || 'Wiadomości' }}</p>
          <strong>{{ expertName }}</strong>
          <span>
            <i
              :class="{
                'is-connected': connectionState === 'connected',
                'is-offline': connectionState === 'offline',
              }"
            />
            {{ connectionState === 'connected'
              ? 'Na żywo'
              : connectionState === 'offline'
                ? 'Łączenie ponownie'
                : 'Bezpieczna synchronizacja' }}
          </span>
        </div>
      </div>

      <div class="portal-conversation__header-actions">
        <UButton
          v-if="caseTo"
          :to="caseTo"
          class="portal-conversation__case-link"
          color="neutral"
          variant="ghost"
          size="sm"
          trailing-icon="i-lucide-arrow-up-right"
        >
          Otwórz sprawę
        </UButton>
        <UButton
          v-if="!pushActivated
            && (notificationsState === 'default' || notificationsState === 'granted')
            && realtimeConfiguration.mode === 'ably'"
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-bell-plus"
          :loading="activatingNotifications"
          @click="activateNotifications"
        >
          Włącz powiadomienia
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
    </header>

    <div
      ref="listElement"
      :class="[
        'portal-conversation__messages',
        { 'is-error': loadError },
      ]"
      aria-live="polite"
      @scroll.passive="updateListPosition"
    >
      <template v-if="isLoading">
        <USkeleton v-for="index in 3" :key="index" class="h-16 w-3/4" />
      </template>

      <UAlert
        v-else-if="loadError"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        title="Nie udało się pobrać rozmowy"
        description="Historia jest bezpieczna. Spróbuj ponownie za chwilę."
      >
        <template #actions>
          <UButton color="error" variant="soft" size="sm" @click="refresh()">
            Spróbuj ponownie
          </UButton>
        </template>
      </UAlert>

      <UButton
        v-else-if="hasOlderMessages"
        class="portal-conversation__older"
        color="neutral"
        variant="ghost"
        size="xs"
        icon="i-lucide-history"
        :loading="loadingOlder"
        @click="loadOlderMessages"
      >
        Pokaż starsze wiadomości
      </UButton>

      <div v-else-if="!messages.length && !pendingMessage" class="portal-conversation__empty">
        <span><UIcon name="i-lucide-messages-square" /></span>
        <strong>Zacznij rozmowę</strong>
        <p>Wiadomości są przypisane do tej sprawy i zostają w jednym miejscu.</p>
      </div>

      <article
        v-for="message in messages"
        :key="message.id"
        :class="[
          'portal-message',
          message.senderKind === 'client' ? 'portal-message--mine' : 'portal-message--theirs',
        ]"
      >
        <div>
          <p v-if="message.body">{{ message.body }}</p>
          <div v-if="message.attachments.length" class="portal-message__attachments">
            <MessageAttachments
              :attachments="message.attachments"
              :url-for="messageAttachmentUrl"
            />
          </div>
          <footer>
            <time :datetime="message.createdAt">{{ formatMessageTime(message.createdAt) }}</time>
            <span v-if="message.senderKind === 'client'">
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

      <article v-if="pendingMessage" class="portal-message portal-message--mine is-pending">
        <div>
          <p v-if="pendingMessage.body">{{ pendingMessage.body }}</p>
          <div
            v-if="pendingMessage.attachments.length"
            class="portal-message__pending-attachments"
            aria-label="Wysyłane załączniki"
          >
            <span v-for="attachment in pendingMessage.attachments" :key="attachment.id">
              <UIcon
                :name="attachment.mimeType.startsWith('image/')
                  ? 'i-lucide-image'
                  : 'i-lucide-file'"
              />
              <span>{{ attachment.name }}</span>
            </span>
          </div>
          <footer><span>Wysyłanie…</span></footer>
        </div>
      </article>

      <div v-if="peerTyping" class="portal-conversation__typing">
        <span /><span /><span />
        {{ expertFirstName }} pisze…
      </div>
      <span ref="readSentinelElement" class="portal-conversation__read-sentinel" aria-hidden="true" />
    </div>

    <form v-if="!loadError" class="portal-conversation__composer" @submit.prevent="sendMessage">
      <MessageAttachmentComposer
        :controller="attachmentDrafts"
        :client-message-id="draftClientMessageId"
        :disabled="preview || sending || loadError"
        :disabled-reason="preview
          ? 'Dodawanie załączników jest wyłączone w trybie podglądu.'
          : sending
            ? 'Poczekaj na wysłanie bieżącej wiadomości.'
            : undefined"
      >
        <template #input>
          <UTextarea
            v-model="composer"
            class="w-full"
            autoresize
            :rows="1"
            :maxrows="6"
            :maxlength="4000"
            :disabled="sending || loadError"
            placeholder="Napisz wiadomość…"
            aria-label="Treść wiadomości"
            @input="onComposerInput"
            @blur="stopTyping"
            @keydown.enter.exact.prevent="sendMessage"
          />
        </template>
        <template #submit>
          <UButton
            class="portal-conversation__send"
            type="submit"
            icon="i-lucide-arrow-up"
            variant="solid"
            :loading="sending"
            :disabled="!canSend"
            aria-label="Wyślij wiadomość"
          />
        </template>
      </MessageAttachmentComposer>
    </form>
    <p v-if="!loadError" class="portal-conversation__hint">
      Enter wysyła · Shift+Enter dodaje nową linię · możesz wkleić lub przeciągnąć plik
    </p>
  </section>
</template>

<style scoped>
.portal-conversation {
  min-width: 0;
  overflow: hidden;
  margin-bottom: 28px;
  border: 1px solid var(--portal-line);
  border-radius: 18px;
  background: var(--ui-bg);
  box-shadow: 0 18px 45px rgb(15 23 42 / 5%);
}

.portal-conversation--pane {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto auto;
  height: 100%;
  min-height: 0;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
  margin-bottom: 0;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}

.portal-conversation__header {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  min-height: 86px;
  padding: 17px 20px;
  border-bottom: 1px solid var(--portal-line);
  background: var(--portal-warm-surface);
}

.portal-conversation--pane .portal-conversation__header {
  min-height: 78px;
  padding-block: 13px;
}

.portal-conversation__expert {
  display: flex;
  align-items: center;
  gap: 13px;
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
}

.portal-conversation__expert > div {
  min-width: 0;
}

.portal-conversation__back {
  display: none;
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: 999px;
  color: var(--ui-text-highlighted);
  text-decoration: none;
}

.portal-conversation__back:hover {
  background: var(--ui-bg-elevated);
}

.portal-conversation__back svg {
  width: 20px;
  height: 20px;
}

.portal-conversation__avatar {
  display: grid;
  flex: 0 0 auto;
  width: 48px;
  height: 48px;
  place-items: center;
  border: 1px solid var(--portal-line);
  border-radius: 999px;
  background: var(--ui-bg);
  font-size: 13px;
  font-weight: 700;
}

.portal-conversation__expert > div p,
.portal-conversation__expert > div strong,
.portal-conversation__expert > div > span {
  display: block;
}

.portal-conversation__expert p {
  overflow: hidden;
  margin: 0 0 1px;
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .09em;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}

.portal-conversation__expert strong {
  font-size: 15px;
  font-weight: 650;
}

.portal-conversation__expert div > span {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.portal-conversation__expert i {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--ui-color-warning-500);
}

.portal-conversation__expert i.is-connected {
  background: var(--ui-color-success-500);
}

.portal-conversation__expert i.is-offline {
  background: var(--ui-color-error-500);
}

.portal-conversation__header-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
}

.portal-conversation__messages {
  display: flex;
  min-height: 280px;
  max-height: min(56dvh, 560px);
  flex-direction: column;
  gap: 9px;
  overflow-y: auto;
  padding: 24px 20px 18px;
  overscroll-behavior: contain;
  scroll-behavior: smooth;
}

.portal-conversation--pane .portal-conversation__messages {
  min-height: 0;
  max-height: none;
}

.portal-conversation__messages.is-error {
  min-height: 0;
  max-height: none;
  padding-block: 18px;
}

.portal-conversation__messages > :deep(.u-skeleton):nth-child(even) {
  align-self: flex-end;
}

.portal-conversation__empty {
  display: grid;
  max-width: 390px;
  margin: auto;
  justify-items: center;
  color: var(--ui-text-muted);
  text-align: center;
}

.portal-conversation__older {
  align-self: center;
  margin-bottom: 5px;
}

.portal-conversation__empty > span {
  display: grid;
  width: 52px;
  height: 52px;
  margin-bottom: 12px;
  place-items: center;
  border-radius: 999px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-highlighted);
}

.portal-conversation__empty svg {
  width: 25px;
  height: 25px;
}

.portal-conversation__empty strong {
  color: var(--ui-text-highlighted);
  font-size: 16px;
}

.portal-conversation__empty p {
  margin: 5px 0 0;
  font-size: 13px;
  line-height: 1.5;
}

.portal-message {
  display: flex;
  width: 100%;
}

.portal-message > div {
  max-width: min(76%, 620px);
  padding: 10px 13px 7px;
  border-radius: 17px 17px 17px 5px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-highlighted);
}

.portal-message--mine {
  justify-content: flex-end;
}

.portal-message--mine > div {
  --oe-message-attachment-bg: rgb(255 255 255 / 9%);
  --oe-message-attachment-border: rgb(255 255 255 / 18%);
  --oe-message-attachment-hover: rgb(255 255 255 / 14%);
  --oe-message-attachment-text: #fff;
  --oe-message-attachment-muted: rgb(255 255 255 / 78%);

  border-radius: 17px 17px 5px;
  background: #111827;
  color: #fff;
}

.portal-message.is-pending > div {
  opacity: .65;
}

.portal-message p {
  margin: 0;
  font-size: 14px;
  line-height: 1.48;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.portal-message__attachments {
  margin-top: 7px;
}

.portal-message__pending-attachments {
  display: grid;
  gap: 4px;
  margin-top: 7px;
}

.portal-message__pending-attachments > span {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 5px 8px;
  border: 1px solid rgb(255 255 255 / 18%);
  border-radius: 9px;
  background: rgb(255 255 255 / 9%);
  font-size: 11px;
}

.portal-message__pending-attachments > span > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.portal-message__pending-attachments svg {
  width: 16px;
  height: 16px;
}

.portal-message footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
  color: color-mix(in srgb, currentColor 65%, transparent);
  font-size: 10px;
}

.portal-message footer span {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.portal-message footer svg {
  width: 12px;
  height: 12px;
}

.portal-conversation__typing {
  display: flex;
  align-items: center;
  gap: 4px;
  width: fit-content;
  padding: 8px 11px;
  border-radius: 14px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-muted);
  font-size: 11px;
}

.portal-conversation__typing span {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: currentColor;
  animation: portal-typing 1.2s infinite ease-in-out;
}

.portal-conversation__typing span:nth-child(2) {
  animation-delay: .15s;
}

.portal-conversation__typing span:nth-child(3) {
  margin-right: 4px;
  animation-delay: .3s;
}

.portal-conversation__read-sentinel {
  flex: 0 0 1px;
  width: 100%;
}

.portal-conversation__composer {
  margin: 0 16px;
  padding: 12px 0 6px;
  border-top: 1px solid var(--portal-line);
}

.portal-conversation__composer :deep(textarea) {
  min-height: 44px;
  border-radius: 15px;
}

.portal-conversation__composer :deep(.portal-conversation__send) {
  width: 44px;
  height: 44px;
  border-radius: 999px;
  background: #111827;
  color: #fff;
}

.portal-conversation__hint {
  margin: 0;
  padding: 0 18px 12px;
  color: var(--ui-text-muted);
  font-size: 10px;
  text-align: right;
}

@keyframes portal-typing {
  0%,
  60%,
  100% { transform: translateY(0); opacity: .45; }
  30% { transform: translateY(-3px); opacity: 1; }
}

@media (max-width: 640px) {
  .portal-conversation {
    margin-inline: -1px;
    border-radius: 17px;
  }

  .portal-conversation--pane {
    margin-inline: 0;
    border-radius: 0;
  }

  .portal-conversation--pane .portal-conversation__composer {
    position: relative;
    margin-inline: 0;
    margin-bottom: calc(80px + env(safe-area-inset-bottom));
    padding: 10px 12px;
    background: rgb(255 255 255 / 96%);
    backdrop-filter: blur(14px);
  }

  .portal-conversation__header {
    padding: 15px 16px;
  }

  .portal-conversation--pane .portal-conversation__header {
    min-height: 74px;
    padding: 10px 12px;
  }

  .portal-conversation--pane .portal-conversation__back {
    display: grid;
  }

  .portal-conversation__header-actions > :not(.portal-conversation__case-link),
  .portal-conversation__case-link :deep(span:not(.iconify)) {
    display: none;
  }

  .portal-conversation__case-link {
    width: 38px;
    min-width: 38px;
    height: 38px;
    min-height: 38px;
    justify-content: center;
    overflow: hidden;
    padding: 0;
    font-size: 0;
  }

  .portal-conversation__case-link :deep(.iconify) {
    width: 18px;
    height: 18px;
  }

  .portal-conversation__messages {
    min-height: 330px;
    max-height: 62dvh;
    padding: 20px 12px 16px;
  }

  .portal-conversation--pane .portal-conversation__messages {
    min-height: 0;
    max-height: none;
  }

  .portal-conversation__messages.is-error {
    min-height: 0;
    padding: 14px 0;
  }

  .portal-message > div {
    max-width: 87%;
  }

  .portal-conversation__composer {
    margin-inline: 10px;
  }

  .portal-conversation__hint {
    display: none;
  }
}
</style>
