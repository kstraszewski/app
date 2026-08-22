<script setup lang="ts">
import type {
  Conversation,
  ConversationKind,
  Message,
  MessageAttachment,
  MessageReplyReference,
  Receipt,
} from '@openexpert/messaging'
import {
  classifyMessageAttachmentCompletionFailure,
  MessageAttachmentComposer,
  MessageAttachments,
  MessageReplyQuote,
  messageReplyReference,
  resolveMessageReplySwipe,
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
    currentClientPersonId: string
    participants: PortalConversationParticipant[]
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

interface PortalConversationParticipant {
  clientId: string
  clientPersonId: string
  displayName: string
  role: string
}

interface RetryableSend {
  body: string
  clientMessageId: string
  attachmentIds: string[]
  replyToMessageId: string | null
}

interface ReplySwipeState {
  pointerId: number | null
  messageId: string
  startX: number
  startY: number
  offset: number
  shouldReply: boolean
  cancelled: boolean
}

type LoadOlderMessagesResult = 'loaded' | 'busy' | 'unavailable' | 'error' | 'cancelled'

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
  expertAvatarUrl?: string | null
  threadKind?: ConversationKind
  caseTitle?: string
  caseTo?: string
  backTo?: string
  preview?: boolean
  surface?: 'card' | 'pane'
}>(), {
  expertAvatarUrl: null,
  threadKind: 'direct',
  preview: false,
  surface: 'card',
})
const emit = defineEmits<{
  messageSent: []
  receiptUpdated: []
}>()

const toast = useToast()
const { $portalFetch } = useNuxtApp()
const previewConversations = usePortalPreviewConversations(props.preview)
const apiPath = computed(
  () => `/api/client/cases/${encodeURIComponent(props.caseId)}/conversation`,
)
function conversationQuery(extra: Record<string, unknown> = {}) {
  return {
    ...(props.threadKind === 'group' ? { thread: 'group' } : {}),
    ...extra,
  }
}

function conversationApiPath(suffix = '') {
  return `${apiPath.value}${suffix}`
}

const authenticatedUser = useAuthUser()
const stateScope = `${props.caseId}:${props.threadKind}`
const draftClientMessageId = useState<string>(
  `portal-case-conversation:draft:${authenticatedUser.value?.id || 'session'}:${stateScope}`,
  () => crypto.randomUUID(),
)
const attachmentApiPaths = new Map<string, { path: string, thread: ConversationKind }>()
const attachmentAdapter: MessageAttachmentDraftAdapter = {
  async reserve(input) {
    const attachmentApiPath = conversationApiPath('/attachments')
    const thread = props.threadKind
    const response = await $portalFetch<{ data: MessageAttachmentUploadReservation }>(
      attachmentApiPath,
      { method: 'POST', query: conversationQuery(), body: input },
    )
    attachmentApiPaths.set(response.data.attachment.id, { path: attachmentApiPath, thread })
    return response.data
  },
  async complete(id) {
    const attachmentTarget = attachmentApiPaths.get(id)
    if (!attachmentTarget) {
      throw Object.assign(
        new Error('Nie znaleziono przygotowanego załącznika.'),
        { statusCode: 404 },
      )
    }
    const response = await $portalFetch<{ data: { attachment: MessageAttachment } }>(
      `${attachmentTarget.path}/${encodeURIComponent(id)}/complete`,
      {
        method: 'POST',
        query: attachmentTarget.thread === 'group' ? { thread: 'group' } : {},
      },
    )
    return response.data.attachment
  },
  async discard(id) {
    const attachmentTarget = attachmentApiPaths.get(id)
    if (!attachmentTarget) return
    try {
      await $portalFetch(`${attachmentTarget.path}/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        query: attachmentTarget.thread === 'group' ? { thread: 'group' } : {},
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
  const messages = previewConversations.ensureMessages(props.caseId)
  const lastMessage = messages.at(-1)

  return {
    data: {
      conversation: {
        id: conversationId,
        organizationId: 'org-openexpert-local',
        caseId: props.caseId,
        kind: 'direct',
        clientId: 'preview-client-account',
        clientPersonId: 'preview-client',
        lastMessageSequence: lastMessage?.sequence ?? 0,
        lastMessageAt: lastMessage?.createdAt ?? null,
        createdAt: '2026-07-29T08:00:00.000Z',
        updatedAt: lastMessage?.createdAt ?? '2026-07-29T08:00:00.000Z',
      },
      currentClientPersonId: 'preview-client',
      participants: [{
        clientId: 'preview-client-account',
        clientPersonId: 'preview-client',
        displayName: 'Klient',
        role: 'borrower',
      }],
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
  () => `portal-case-conversation:${props.preview ? 'preview:' : ''}${props.caseId}:${props.threadKind}`,
  () => props.preview
    ? Promise.resolve(previewConversationResponse())
    : $portalFetch<ConversationResponse>(apiPath.value, { query: conversationQuery() }),
  { watch: [apiPath, () => props.threadKind] },
)

const conversation = ref<Conversation | null>(null)
const currentClientPersonId = ref('')
const participants = ref<PortalConversationParticipant[]>([])
const messages = ref<Message[]>([])
const ownReceipt = ref<Receipt | null>(null)
const peerReceipt = ref<Receipt | null>(null)
const realtimeConfiguration = ref<RealtimeConfiguration>({
  mode: 'polling',
  channel: null,
  ephemeralChannel: null,
})
const composer = useState<string>(
  `portal-case-conversation:composer:${authenticatedUser.value?.id || 'session'}:${stateScope}`,
  () => '',
)
const retryableSend = ref<RetryableSend | null>(null)
const replyingTo = useState<MessageReplyReference | null>(
  `portal-case-conversation:reply:${authenticatedUser.value?.id || 'session'}:${stateScope}`,
  () => null,
)
const sending = ref(false)
const syncing = ref(false)
const loadingOlder = ref(false)
const hasOlderMessages = ref(false)
const pendingMessage = ref<{
  clientMessageId: string
  body: string
  attachments: MessageAttachment[]
  replyToMessage: MessageReplyReference | null
} | null>(null)
const visiblePendingMessage = computed(() => {
  const pending = pendingMessage.value
  if (!pending) return null
  return messages.value.some(message => message.clientMessageId === pending.clientMessageId)
    ? null
    : pending
})
const messageMotionReady = ref(false)
const unseenMessageCount = ref(0)
const listElement = ref<HTMLElement | null>(null)
const composerElement = ref<HTMLFormElement | null>(null)
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
const highlightedMessageId = ref('')
const replyNavigationStatus = ref('')
const replySwipe = reactive<ReplySwipeState>({
  pointerId: null,
  messageId: '',
  startX: 0,
  startY: 0,
  offset: 0,
  shouldReply: false,
  cancelled: false,
})

let realtimeClient: any = null
let durableChannel: any = null
let ephemeralChannel: any = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let typingTimer: ReturnType<typeof setTimeout> | null = null
let peerTypingTimer: ReturnType<typeof setTimeout> | null = null
let receiptTimer: ReturnType<typeof setTimeout> | null = null
let highlightTimer: ReturnType<typeof setTimeout> | null = null
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
const isGroupConversation = computed(() => props.threadKind === 'group')
const groupParticipantNames = computed(() => participants.value
  .map(participant => participant.displayName.trim())
  .filter(Boolean)
  .join(', '))
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
  const path = conversationApiPath(`/attachments/${encodeURIComponent(attachment.id)}`)
  const query = new URLSearchParams()
  if (props.threadKind === 'group') query.set('thread', 'group')
  if (download) query.set('download', '1')
  const suffix = query.toString()
  return suffix ? `${path}?${suffix}` : path
}

function participantByPersonId(clientPersonId: string | null | undefined) {
  return participants.value.find(
    participant => participant.clientPersonId === clientPersonId,
  ) ?? null
}

function isOwnClientSender(
  senderKind: Message['senderKind'],
  senderClientPersonId: string | null,
) {
  return senderKind === 'client'
    && Boolean(currentClientPersonId.value)
    && senderClientPersonId === currentClientPersonId.value
}

function isOwnMessage(message: Message) {
  return isOwnClientSender(message.senderKind, message.senderClientPersonId)
}

function personInitials(name: string) {
  const parts = name.trim().split(/\s+/u).filter(Boolean)
  return `${parts[0]?.[0] ?? ''}${parts.at(-1)?.[0] ?? ''}`.toUpperCase() || 'K'
}

function messageAuthorName(message: Message) {
  if (message.senderKind === 'staff') return props.expertName || 'Ekspert'
  if (isOwnMessage(message)) return 'Ty'
  return participantByPersonId(message.senderClientPersonId)?.displayName || 'Kredytobiorca'
}

function messageAuthorInitials(message: Message) {
  return message.senderKind === 'staff'
    ? expertInitials.value
    : personInitials(messageAuthorName(message))
}

function mergeMessages(incoming: Message[]) {
  const byClientMessageId = new Map(messages.value.map(message => [
    message.clientMessageId || message.id,
    message,
  ]))
  for (const message of incoming) {
    byClientMessageId.set(message.clientMessageId || message.id, message)
  }
  messages.value = [...byClientMessageId.values()].sort((a, b) => a.sequence - b.sequence)
}

function applyResponse(
  response: ConversationResponse | null | undefined,
  mode: 'initial' | 'incremental' | 'older' = 'initial',
) {
  if (!response?.data?.conversation) return
  if (response.data.conversation.caseId !== props.caseId) return
  if (response.data.conversation.kind !== props.threadKind) return
  const incomingMessages = response.data.messages ?? []
  const knownMessageIds = new Set(messages.value.map(
    message => message.clientMessageId || message.id,
  ))
  const addedMessages = mode === 'incremental'
    ? incomingMessages.filter(message => !knownMessageIds.has(
        message.clientMessageId || message.id,
      ))
    : []
  if (mode !== 'incremental') messageMotionReady.value = false
  const shouldFollowMessages = mode === 'initial'
    || (mode === 'incremental' && listAtEnd.value)
  conversation.value = response.data.conversation
  currentClientPersonId.value = response.data.currentClientPersonId
  participants.value = response.data.participants ?? []
  ownReceipt.value = response.data.receipt
  peerReceipt.value = response.data.peerReceipt
  realtimeConfiguration.value = response.data.realtime ?? realtimeConfiguration.value
  mergeMessages(incomingMessages)
  if (mode !== 'incremental') {
    hasOlderMessages.value = response.data.pageInfo?.hasMore === true
  }
  if (mode === 'incremental' && !shouldFollowMessages && addedMessages.length) {
    unseenMessageCount.value += addedMessages.length
  }
  if (shouldFollowMessages) {
    void nextTick(() => scrollToEnd(mode === 'initial' ? 'auto' : 'smooth'))
  }
  if (mode === 'initial') {
    unseenMessageCount.value = 0
    void nextTick(() => {
      messageMotionReady.value = true
    })
  }
  scheduleReceipt()
}

watch(initialResponse, response => applyResponse(response), { immediate: true })

watch(
  () => previewConversations.messagesByCase.value[props.caseId],
  storedMessages => {
    if (props.preview && storedMessages) mergeMessages(storedMessages)
  },
)

watch(() => [props.caseId, props.threadKind] as const, () => {
  void attachmentDrafts.clear({ discard: !sending.value })
  retryableSend.value = null
  replyingTo.value = null
  draftClientMessageId.value = crypto.randomUUID()
  composer.value = ''
  pendingMessage.value = null
  stopTyping()
  disconnectRealtime()
  conversation.value = null
  currentClientPersonId.value = ''
  participants.value = []
  messages.value = []
  ownReceipt.value = null
  peerReceipt.value = null
  hasOlderMessages.value = false
  peerTyping.value = false
  messageMotionReady.value = false
  unseenMessageCount.value = 0
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
  if (!isOwnMessage(message)) return ''
  if ((peerReceipt.value?.readThroughSequence ?? 0) >= message.sequence) return 'Odczytano'
  if ((peerReceipt.value?.deliveredThroughSequence ?? 0) >= message.sequence) return 'Dostarczono'
  return 'Wysłano'
}

function replyAuthorLabel(reply: MessageReplyReference) {
  if (reply.senderKind === 'staff') return props.expertName || 'Ekspert'
  if (isOwnClientSender(reply.senderKind, reply.senderClientPersonId)) return 'Ty'
  return participantByPersonId(reply.senderClientPersonId)?.displayName || 'Kredytobiorca'
}

function replyActionLabel(message: Message) {
  const author = isOwnMessage(message)
    ? 'Ciebie'
    : message.senderKind === 'staff'
      ? props.expertName || 'eksperta'
      : participantByPersonId(message.senderClientPersonId)?.displayName || 'kredytobiorcy'
  return `Odpowiedz na wiadomość od ${author}`
}

function focusComposer() {
  void nextTick(() => composerElement.value?.querySelector('textarea')?.focus())
}

function startReply(message: Message) {
  if (sending.value || message.deletedAt) return
  replyingTo.value = messageReplyReference(message)
  focusComposer()
}

function cancelReply() {
  replyingTo.value = null
}

function resetReplySwipe() {
  replySwipe.pointerId = null
  replySwipe.messageId = ''
  replySwipe.startX = 0
  replySwipe.startY = 0
  replySwipe.offset = 0
  replySwipe.shouldReply = false
  replySwipe.cancelled = false
}

function messageSwipeOffset(messageId: string) {
  return replySwipe.messageId === messageId ? replySwipe.offset : 0
}

function onMessagePointerDown(event: PointerEvent, message: Message) {
  if (
    sending.value
    || event.pointerType === 'mouse'
    || event.button !== 0
    || message.deletedAt
    || (event.target as Element | null)?.closest(
      'a, button, input, textarea, select, [role="button"]',
    )
  ) return

  resetReplySwipe()
  replySwipe.pointerId = event.pointerId
  replySwipe.messageId = message.id
  replySwipe.startX = event.clientX
  replySwipe.startY = event.clientY
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
}

function onMessagePointerMove(event: PointerEvent) {
  if (
    replySwipe.pointerId !== event.pointerId
    || replySwipe.cancelled
  ) return
  const frame = resolveMessageReplySwipe(
    event.clientX - replySwipe.startX,
    event.clientY - replySwipe.startY,
  )
  if (frame.intent === 'vertical' || frame.intent === 'opposite') {
    replySwipe.cancelled = true
    replySwipe.offset = 0
    replySwipe.shouldReply = false
    return
  }
  if (frame.intent !== 'horizontal') return
  event.preventDefault()
  replySwipe.offset = frame.offset
  replySwipe.shouldReply = frame.shouldReply
}

function onMessagePointerEnd(event: PointerEvent) {
  if (replySwipe.pointerId !== event.pointerId) return
  const message = replySwipe.shouldReply
    ? messages.value.find(candidate => candidate.id === replySwipe.messageId)
    : null
  ;(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId)
  resetReplySwipe()
  if (message) startReply(message)
}

function onMessagePointerCancel(event: PointerEvent) {
  if (replySwipe.pointerId !== event.pointerId) return
  ;(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId)
  resetReplySwipe()
}

async function revealReply(reply: MessageReplyReference) {
  const requestedCaseId = props.caseId
  const requestedConversationId = conversation.value?.id
  const selector = `[data-message-id="${reply.id}"]`
  let element = listElement.value?.querySelector<HTMLElement>(selector) ?? null
  let attempts = 0
  while (
    !element
    && hasOlderMessages.value
    && (messages.value[0]?.sequence ?? Number.MAX_SAFE_INTEGER) > reply.sequence
    && attempts < 20
  ) {
    const previousFirstSequence = messages.value[0]?.sequence
    const loadResult = await loadOlderMessages()
    if (
      props.caseId !== requestedCaseId
      || conversation.value?.id !== requestedConversationId
      || loadResult === 'busy'
      || loadResult === 'error'
      || loadResult === 'cancelled'
    ) return
    await nextTick()
    element = listElement.value?.querySelector<HTMLElement>(selector) ?? null
    attempts += 1
    if (messages.value[0]?.sequence === previousFirstSequence) break
  }
  if (!element) {
    toast.add({
      title: 'Oryginalna wiadomość jest niedostępna',
      color: 'info',
      icon: 'i-lucide-message-circle-warning',
    })
    return
  }
  element.scrollIntoView({
    behavior: shouldReduceMotion() ? 'auto' : 'smooth',
    block: 'center',
  })
  highlightedMessageId.value = reply.id
  element.focus({ preventScroll: true })
  replyNavigationStatus.value = `Przejście do cytowanej wiadomości numer ${reply.sequence}.`
  if (highlightTimer) clearTimeout(highlightTimer)
  highlightTimer = setTimeout(() => {
    if (highlightedMessageId.value === reply.id) highlightedMessageId.value = ''
  }, 1_600)
}

function shouldReduceMotion() {
  return import.meta.client
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function scrollToEnd(behavior: ScrollBehavior = messages.value.length > 1 ? 'smooth' : 'auto') {
  if (!listElement.value) return
  listAtEnd.value = true
  unseenMessageCount.value = 0
  listElement.value.scrollTo({
    top: listElement.value.scrollHeight,
    behavior: shouldReduceMotion() ? 'auto' : behavior,
  })
}

function updateListPosition() {
  const element = listElement.value
  if (!element) return
  listAtEnd.value = element.scrollHeight - element.scrollTop - element.clientHeight <= 48
  if (listAtEnd.value) unseenMessageCount.value = 0
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
        query: conversationQuery({ afterSequence: previousSequence }),
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

async function loadOlderMessages(): Promise<LoadOlderMessagesResult> {
  if (props.preview) return 'unavailable'
  const firstSequence = messages.value[0]?.sequence
  if (!conversation.value || !firstSequence) return 'unavailable'
  if (loadingOlder.value) return 'busy'
  const requestedCaseId = props.caseId
  const requestedConversationId = conversation.value.id
  loadingOlder.value = true
  const list = listElement.value
  const previousHeight = list?.scrollHeight ?? 0
  try {
    const response = await $portalFetch<ConversationResponse>(apiPath.value, {
      query: conversationQuery({ beforeSequence: firstSequence }),
    })
    if (
      props.caseId !== requestedCaseId
      || conversation.value?.id !== requestedConversationId
    ) return 'cancelled'
    applyResponse(response, 'older')
    await nextTick()
    if (list) list.scrollTop += list.scrollHeight - previousHeight
    messageMotionReady.value = true
    return 'loaded'
  }
  catch (caught) {
    if (isUnauthorizedRequestError(caught)) return 'error'
    toast.add({
      title: 'Nie udało się pobrać starszych wiadomości',
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
    return 'error'
  }
  finally {
    if (
      props.caseId === requestedCaseId
      && conversation.value?.id === requestedConversationId
    ) loadingOlder.value = false
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
      { method: 'POST', query: conversationQuery(), body: payload },
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
  const replyTarget = replyingTo.value
  const replyToMessageId = replyTarget?.id ?? null

  if (props.preview) {
    const sequence = latestSequence.value + 1
    const message: Message = {
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
      replyToMessageId,
      replyToMessage: replyTarget,
      createdAt: new Date().toISOString(),
      editedAt: null,
      deletedAt: null,
    }
    previewConversations.appendMessage(props.caseId, message)
    mergeMessages([message])
    composer.value = ''
    replyingTo.value = null
    draftClientMessageId.value = crypto.randomUUID()
    emit('messageSent')
    void nextTick(scrollToEnd)
    return
  }

  const sendingCaseId = props.caseId
  const sendingThreadKind = props.threadKind
  const sendingApiPath = apiPath.value
  const attachments = [...attachmentDrafts.readyAttachments.value]
  const attachmentIds = attachments.map(attachment => attachment.id)
  const previousAttempt = retryableSend.value
  const matchesPreviousAttempt = previousAttempt?.body === body
    && previousAttempt.replyToMessageId === replyToMessageId
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
        replyToMessageId,
      }
  retryableSend.value = attempt
  sending.value = true
  pendingMessage.value = {
    clientMessageId: attempt.clientMessageId,
    body,
    attachments,
    replyToMessage: replyTarget,
  }
  composer.value = ''
  replyingTo.value = null
  stopTyping()

  try {
    const response = await $portalFetch<{ data: { message: Message, peerReceipt?: Receipt | null } }>(
      sendingApiPath,
      {
        method: 'POST',
        query: sendingThreadKind === 'group' ? { thread: 'group' } : {},
        body: {
          body,
          clientMessageId: attempt.clientMessageId,
          attachmentIds: attempt.attachmentIds,
          replyToMessageId: attempt.replyToMessageId,
        },
      },
    )
    if (props.caseId !== sendingCaseId || props.threadKind !== sendingThreadKind) {
      for (const attachmentId of attachmentIds) attachmentApiPaths.delete(attachmentId)
      return
    }
    pendingMessage.value = null
    if (response.data.message) mergeMessages([response.data.message])
    if (response.data.peerReceipt !== undefined) peerReceipt.value = response.data.peerReceipt
    await attachmentDrafts.clear({ discard: false })
    for (const attachmentId of attachmentIds) attachmentApiPaths.delete(attachmentId)
    retryableSend.value = null
    draftClientMessageId.value = crypto.randomUUID()
    emit('messageSent')
    void nextTick(scrollToEnd)
  }
  catch (caught: any) {
    if (props.caseId !== sendingCaseId || props.threadKind !== sendingThreadKind) {
      for (const attachmentId of attachmentIds) attachmentApiPaths.delete(attachmentId)
      return
    }
    const errorCode = requestErrorCode(caught)
    const replyUnavailable = errorCode === 'case_message_reply_unavailable'
    if (errorCode === 'case_message_attachment_unavailable') {
      attachmentDrafts.invalidateReadyAttachments(
        attachmentIds,
        'Załącznik wygasł. Kliknij „Ponów”, aby przesłać go ponownie.',
      )
      retryableSend.value = null
    }
    if (replyUnavailable) retryableSend.value = null
    composer.value = body
    replyingTo.value = replyUnavailable ? null : replyTarget
    pendingMessage.value = null
    if (isUnauthorizedRequestError(caught)) return
    toast.add({
      title: replyUnavailable
        ? 'Nie można już odpowiedzieć na tę wiadomość'
        : 'Nie udało się wysłać wiadomości',
      description: replyUnavailable
        ? 'Treść została zachowana. Wybierz inną wiadomość lub wyślij ją bez cytatu.'
        : 'Treść i załączniki zostały zachowane. Spróbuj ponownie za chwilę.',
      color: replyUnavailable ? 'warning' : 'error',
      icon: replyUnavailable ? 'i-lucide-message-circle-warning' : 'i-lucide-circle-alert',
    })
  }
  finally {
    sending.value = false
  }
}

async function tokenRequest() {
  const payload = await $portalFetch<any>(`${apiPath.value}/token`, {
    headers: { Accept: 'application/json' },
    query: conversationQuery(),
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
  if (highlightTimer) clearTimeout(highlightTimer)
  resetReplySwipe()
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
        <span class="portal-conversation__avatar">
          <UIcon v-if="isGroupConversation" name="i-lucide-users" />
          <template v-else>{{ expertInitials }}</template>
        </span>
        <div>
          <p id="portal-conversation-title">{{ caseTitle || 'Wiadomości' }}</p>
          <strong>{{ isGroupConversation ? 'Czat wspólny' : expertName }}</strong>
          <span v-if="isGroupConversation && groupParticipantNames" class="portal-conversation__participants">
            {{ groupParticipantNames }} · {{ expertName }}
          </span>
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

    <div class="portal-conversation__stage">
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

        <OeEmptyState
          v-else-if="!messages.length && !visiblePendingMessage"
          compact
          align="start"
          icon="i-lucide-messages-square"
          title="Zacznij rozmowę"
          description="Wiadomości są przypisane do tej sprawy i zostają w jednym miejscu."
        />

        <TransitionGroup
          tag="div"
          name="portal-message-list"
          class="portal-conversation__stream"
          :css="messageMotionReady"
        >
          <article
            v-for="message in messages"
            :key="message.clientMessageId"
            :data-message-id="message.id"
            tabindex="-1"
            :class="[
              'portal-message',
              isOwnMessage(message) ? 'portal-message--mine' : 'portal-message--theirs',
              {
                'is-highlighted': highlightedMessageId === message.id,
                'is-swiping': replySwipe.messageId === message.id && replySwipe.offset > 0,
                'is-swipe-ready': replySwipe.messageId === message.id && replySwipe.shouldReply,
              },
            ]"
            @pointerdown="onMessagePointerDown($event, message)"
            @pointermove="onMessagePointerMove"
            @pointerup="onMessagePointerEnd"
            @pointercancel="onMessagePointerCancel"
          >
            <UAvatar
              v-if="!isOwnMessage(message)"
              class="portal-message__avatar"
              :src="message.senderKind === 'staff' ? expertAvatarUrl || undefined : undefined"
              :alt="messageAuthorName(message)"
              :text="messageAuthorInitials(message)"
              size="xs"
              :color="message.senderKind === 'staff' ? 'primary' : 'neutral'"
            />
            <UButton
              v-if="isOwnMessage(message)"
              class="portal-message__reply-action"
              type="button"
              color="neutral"
              variant="ghost"
              size="sm"
              icon="i-lucide-reply"
              :disabled="sending"
              :aria-label="replyActionLabel(message)"
              @click="startReply(message)"
            />
            <div
              class="portal-message__bubble"
              :style="{ '--portal-message-swipe-offset': `${messageSwipeOffset(message.id)}px` }"
            >
              <strong
                v-if="isGroupConversation && !isOwnMessage(message)"
                class="portal-message__author"
              >
                {{ messageAuthorName(message) }}
              </strong>
              <MessageReplyQuote
                v-if="message.replyToMessage"
                :reply="message.replyToMessage"
                :author-label="replyAuthorLabel(message.replyToMessage)"
                interactive
                @select="revealReply"
              />
              <div
                v-else-if="message.replyToMessageId"
                class="portal-message__reply-missing"
              >
                Oryginalna wiadomość jest niedostępna
              </div>
              <p v-if="message.body">{{ message.body }}</p>
              <div v-if="message.attachments.length" class="portal-message__attachments">
                <MessageAttachments
                  :attachments="message.attachments"
                  :url-for="messageAttachmentUrl"
                />
              </div>
              <footer>
                <time :datetime="message.createdAt">{{ formatMessageTime(message.createdAt) }}</time>
                <Transition name="portal-message-status" mode="out-in">
                  <span
                    v-if="isOwnMessage(message)"
                    :key="deliveryLabel(message)"
                  >
                    {{ deliveryLabel(message) }}
                    <UIcon
                      :name="deliveryLabel(message) === 'Odczytano'
                        ? 'i-lucide-check-check'
                        : 'i-lucide-check'"
                    />
                  </span>
                </Transition>
              </footer>
            </div>
            <UButton
              v-if="!isOwnMessage(message)"
              class="portal-message__reply-action"
              type="button"
              color="neutral"
              variant="ghost"
              size="sm"
              icon="i-lucide-reply"
              :disabled="sending"
              :aria-label="replyActionLabel(message)"
              @click="startReply(message)"
            />
          </article>

          <article
            v-if="visiblePendingMessage"
            :key="visiblePendingMessage.clientMessageId"
            class="portal-message portal-message--mine is-pending"
          >
            <div class="portal-message__bubble">
              <MessageReplyQuote
                v-if="visiblePendingMessage.replyToMessage"
                :reply="visiblePendingMessage.replyToMessage"
                :author-label="replyAuthorLabel(visiblePendingMessage.replyToMessage)"
              />
              <p v-if="visiblePendingMessage.body">{{ visiblePendingMessage.body }}</p>
              <div
                v-if="visiblePendingMessage.attachments.length"
                class="portal-message__pending-attachments"
                aria-label="Wysyłane załączniki"
              >
                <span v-for="attachment in visiblePendingMessage.attachments" :key="attachment.id">
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

          <div v-if="peerTyping" key="peer-typing" class="portal-conversation__typing">
            <span /><span /><span />
            {{ isGroupConversation ? 'Ktoś pisze…' : `${expertFirstName} pisze…` }}
          </div>
        </TransitionGroup>
        <span ref="readSentinelElement" class="portal-conversation__read-sentinel" aria-hidden="true" />
      </div>

      <Transition name="portal-new-message">
        <UButton
          v-if="unseenMessageCount"
          class="portal-conversation__new-message"
          color="neutral"
          variant="solid"
          size="sm"
          trailing-icon="i-lucide-arrow-down"
          :aria-label="`${unseenMessageCount} ${unseenMessageCount === 1 ? 'nowa wiadomość' : 'nowe wiadomości'}. Przejdź na koniec rozmowy.`"
          @click="scrollToEnd()"
        >
          {{ unseenMessageCount === 1 ? 'Nowa wiadomość' : `${unseenMessageCount} nowe wiadomości` }}
        </UButton>
      </Transition>
    </div>

    <p class="sr-only" role="status" aria-live="polite">
      {{ replyNavigationStatus }}
    </p>

    <form
      v-if="!loadError"
      ref="composerElement"
      class="portal-conversation__composer"
      @submit.prevent="sendMessage"
      @keydown.esc.prevent="cancelReply"
    >
      <Transition name="portal-reply-composer">
        <div
          v-if="replyingTo"
          class="portal-conversation__reply-composer"
        >
          <div>
            <span role="status" aria-live="polite">
              Odpowiadasz: {{ replyAuthorLabel(replyingTo) }}
            </span>
            <MessageReplyQuote
              :reply="replyingTo"
              :author-label="replyAuthorLabel(replyingTo)"
              :show-author="false"
            />
          </div>
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            icon="i-lucide-x"
            aria-label="Anuluj odpowiedź na wiadomość"
            @click="cancelReply"
          />
        </div>
      </Transition>
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

.portal-conversation__expert div > .portal-conversation__participants {
  display: block;
  overflow: hidden;
  max-width: min(48vw, 520px);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.portal-conversation__expert i {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--ui-color-warning-500);
  transition: background-color var(--oe-motion-fast);
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

.portal-conversation__stage {
  position: relative;
  min-height: 0;
}

.portal-conversation--pane .portal-conversation__stage {
  height: 100%;
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
  height: 100%;
  min-height: 0;
  max-height: none;
}

.portal-conversation__stream {
  display: flex;
  flex-direction: column;
  gap: 9px;
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
  position: relative;
  display: flex;
  width: 100%;
  align-items: center;
  gap: 4px;
  touch-action: pan-y pinch-zoom;
  transform-origin: left bottom;
}

.portal-message__avatar {
  align-self: flex-end;
  margin-bottom: 2px;
  border: 1px solid var(--ui-border-muted);
}

.portal-message__bubble {
  position: relative;
  z-index: 1;
  max-width: min(76%, 620px);
  padding: 10px 13px 7px;
  border-radius: 17px 17px 17px 5px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-highlighted);
  transform: translate3d(var(--portal-message-swipe-offset, 0), 0, 0);
  transition:
    opacity var(--oe-motion-fast),
    transform var(--oe-duration-fast) var(--ease-out),
    box-shadow var(--oe-duration-fast) var(--ease-out);
}

.portal-message__author {
  display: block;
  margin-bottom: 3px;
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 700;
}

.portal-message--mine {
  justify-content: flex-end;
  transform-origin: right bottom;
}

.portal-message--mine .portal-message__bubble {
  --oe-message-attachment-bg: rgb(255 255 255 / 9%);
  --oe-message-attachment-border: rgb(255 255 255 / 18%);
  --oe-message-attachment-hover: rgb(255 255 255 / 14%);
  --oe-message-attachment-text: #fff;
  --oe-message-attachment-muted: rgb(255 255 255 / 78%);

  border-radius: 17px 17px 5px;
  background: #111827;
  color: #fff;
}

.portal-message.is-pending .portal-message__bubble {
  opacity: .65;
}

.portal-message.is-swiping .portal-message__bubble {
  transition: none;
}

.portal-message.is-highlighted .portal-message__bubble {
  box-shadow:
    0 0 0 3px color-mix(in srgb, var(--ui-primary) 28%, transparent),
    0 10px 30px color-mix(in srgb, var(--ui-primary) 14%, transparent);
}

.portal-message__reply-action {
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  justify-content: center;
  border-radius: 999px;
  opacity: 0;
  transform: scale(.88);
  transition:
    opacity var(--oe-duration-fast) var(--ease-out),
    color var(--oe-duration-fast) var(--ease-out),
    transform var(--oe-duration-fast) var(--ease-out);
}

.portal-message:hover .portal-message__reply-action,
.portal-message:focus-within .portal-message__reply-action {
  opacity: 1;
  transform: scale(1);
}

.portal-message.is-swipe-ready .portal-message__reply-action {
  color: var(--ui-primary);
  opacity: 1;
  transform: scale(1.08);
}

.portal-message__reply-missing {
  margin-bottom: 7px;
  padding: 7px 9px 7px 11px;
  border-left: 3px solid currentColor;
  border-radius: 9px;
  background: color-mix(in srgb, currentColor 8%, transparent);
  color: color-mix(in srgb, currentColor 66%, transparent);
  font-size: 11px;
}

.portal-message-list-enter-active {
  transition:
    opacity var(--oe-duration-base) var(--ease-out),
    transform var(--oe-duration-base) var(--ease-out);
}

.portal-message-list-leave-active {
  transition:
    opacity var(--oe-duration-fast) var(--ease-out),
    transform var(--oe-duration-fast) var(--ease-out);
}

.portal-message-list-enter-from {
  opacity: 0;
  transform: translateY(4px) scale(.985);
}

.portal-message-list-leave-to {
  opacity: 0;
  transform: translateY(2px) scale(.985);
}

.portal-message p {
  margin: 0;
  font-size: 14px;
  line-height: 1.48;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.portal-message__bubble > :deep(.oe-message-reply-quote) {
  margin-bottom: 7px;
}

.portal-message--mine :deep(.oe-message-reply-quote) {
  --oe-message-reply-bg: rgb(255 255 255 / 11%);
  --oe-message-reply-hover: rgb(255 255 255 / 17%);
  --oe-message-reply-accent: currentColor;
  --oe-message-reply-author: currentColor;
  --oe-message-reply-muted: rgb(255 255 255 / 76%);
  --oe-message-reply-text: currentColor;
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

.portal-message-status-enter-active,
.portal-message-status-leave-active {
  transition: opacity 100ms var(--ease-out);
}

.portal-message-status-enter-from,
.portal-message-status-leave-to {
  opacity: .45;
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
  animation: portal-typing 1.2s infinite var(--ease-in-out);
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

.portal-conversation__new-message {
  position: absolute;
  z-index: 5;
  bottom: 12px;
  left: 50%;
  min-height: 36px;
  border-radius: 999px;
  box-shadow: 0 10px 28px rgb(15 23 42 / 14%);
  transform: translateX(-50%);
}

.portal-conversation__new-message:active:not(:disabled) {
  transform: translateX(-50%) scale(.97);
}

.portal-new-message-enter-active {
  transition:
    opacity var(--oe-duration-base) var(--ease-out),
    transform var(--oe-duration-base) var(--ease-out);
}

.portal-new-message-leave-active {
  transition:
    opacity var(--oe-duration-fast) var(--ease-out),
    transform var(--oe-duration-fast) var(--ease-out);
}

.portal-new-message-enter-from,
.portal-new-message-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(6px) scale(.98);
}

.portal-conversation__composer {
  margin: 0 16px;
  padding: 12px 0 6px;
  border-top: 1px solid var(--portal-line);
}

.portal-conversation__reply-composer {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 9px;
  padding: 7px 7px 7px 10px;
  border-radius: 12px;
  background: var(--ui-bg-muted);
}

.portal-conversation__reply-composer > div {
  display: grid;
  flex: 1 1 auto;
  min-width: 0;
  gap: 3px;
}

.portal-conversation__reply-composer > div > span {
  color: var(--ui-text-toned);
  font-size: 10px;
  font-weight: 720;
}

.portal-conversation__reply-composer > button {
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  justify-content: center;
  border-radius: 999px;
}

.portal-reply-composer-enter-active,
.portal-reply-composer-leave-active {
  transition:
    opacity var(--oe-duration-fast) var(--ease-out),
    transform var(--oe-duration-fast) var(--ease-out);
}

.portal-reply-composer-enter-from,
.portal-reply-composer-leave-to {
  opacity: 0;
  transform: translateY(4px);
}

.portal-conversation__composer :deep(textarea) {
  min-height: 44px;
  border-radius: 15px;
}

.portal-conversation__composer :deep(.portal-conversation__send) {
  width: 44px;
  height: 44px;
  justify-content: center;
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

@media (prefers-reduced-motion: reduce) {
  .portal-message-list-enter-active,
  .portal-message-list-leave-active,
  .portal-message-status-enter-active,
  .portal-message-status-leave-active,
  .portal-new-message-enter-active,
  .portal-new-message-leave-active,
  .portal-reply-composer-enter-active,
  .portal-reply-composer-leave-active,
  .portal-message__bubble,
  .portal-message__reply-action {
    transition-duration: 150ms !important;
    transition-property: opacity !important;
  }

  .portal-message-list-enter-from,
  .portal-message-list-leave-to {
    transform: none !important;
  }

  .portal-new-message-enter-from,
  .portal-new-message-leave-to {
    transform: translateX(-50%) !important;
  }

  .portal-reply-composer-enter-from,
  .portal-reply-composer-leave-to {
    transform: none !important;
  }

  .portal-conversation__typing span {
    animation: none;
    opacity: .65;
  }
}

@media (max-width: 1024px) {
  .portal-conversation--pane .portal-conversation__back {
    display: grid;
  }
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

  .portal-message__bubble {
    max-width: min(87%, calc(100% - 48px));
  }

  .portal-conversation__composer {
    margin-inline: 10px;
  }

  .portal-conversation__hint {
    display: none;
  }
}

@media (hover: none), (pointer: coarse) {
  .portal-message__reply-action {
    opacity: .58;
    transform: scale(1);
  }
}

.portal-message__reply-action:disabled {
  opacity: 0;
}

.portal-message--theirs.is-swiping .portal-message__reply-action {
  position: absolute;
  z-index: 0;
  top: 50%;
  left: 28px;
  transform: translateY(-50%) scale(1);
}
</style>
