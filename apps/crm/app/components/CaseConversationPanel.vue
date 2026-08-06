<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type {
  Conversation,
  Message,
  MessageAttachment,
  MessageReplyReference,
  Receipt,
} from '@openexpert/messaging'
import { buildMessagePreview } from '@openexpert/messaging'
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

interface CompleteAttachmentResponse {
  data: {
    attachment: MessageAttachment
  }
}

interface ReserveAttachmentResponse {
  data: MessageAttachmentUploadReservation
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
  fixedClientPersonId?: string
  caseTitle?: string
  caseTo?: RouteLocationRaw
  backTo?: RouteLocationRaw
  surface?: 'card' | 'pane'
}>(), {
  fixedClientPersonId: '',
  caseTitle: '',
  caseTo: undefined,
  backTo: undefined,
  surface: 'card',
})

const emit = defineEmits<{
  activity: []
}>()

const toast = useToast()
const route = useRoute()
const requestFetch = useRequestFetch()
const { organizationSlug, crmApiPath, orgPath } = useOrganizationContext()

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
const replyDrafts = new Map<string, MessageReplyReference | null>()
const retryableSends = new Map<string, RetryableSend>()
const replyingTo = ref<MessageReplyReference | null>(null)
const draftClientMessageId = ref('')
const pendingBody = ref('')
const pendingAttachments = ref<MessageAttachment[]>([])
const pendingReply = ref<MessageReplyReference | null>(null)
const pendingClientMessageId = ref('')
const pendingConversationId = ref('')
const pendingRecipientId = ref('')
const sending = ref(false)
const loadingConversation = ref(false)
const conversationLoadError = ref(false)
const loadingOlder = ref(false)
const syncing = ref(false)
const hasOlderMessages = ref(false)
const listElement = ref<HTMLElement | null>(null)
const composerElement = ref<HTMLFormElement | null>(null)
const listAtEnd = ref(true)
const readSentinelElement = ref<HTMLElement | null>(null)
const panelVisible = ref(false)
const panelHydrated = ref(false)
const peerTyping = ref(false)
const messageMotionReady = ref(false)
const unseenMessageCount = ref(0)
const connectionState = ref<'idle' | 'connecting' | 'connected' | 'polling' | 'offline'>('idle')
const notificationsState = ref<'unsupported' | NotificationPermission>('unsupported')
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
let pollingTimer: ReturnType<typeof setInterval> | null = null
let indexPollingTimer: ReturnType<typeof setInterval> | null = null
let typingTimer: ReturnType<typeof setTimeout> | null = null
let peerTypingTimer: ReturnType<typeof setTimeout> | null = null
let receiptTimer: ReturnType<typeof setTimeout> | null = null
let highlightTimer: ReturnType<typeof setTimeout> | null = null
let visibilityObserver: IntersectionObserver | null = null
let connectedSignature = ''
let selectionRevision = 0
let selectionScheduled = false
let disposed = false
let conversationRevision = 0
let syncRequested = false
const attachmentApiPaths = new Map<string, string>()
const pendingAttachmentPreviewUrls = new Map<string, string>()
const clientFilesOpen = ref(false)
const clientFilesRefreshKey = ref(0)

const attachmentDraftAdapter: MessageAttachmentDraftAdapter = {
  async reserve(input) {
    const activeConversation = await ensureConversation()
    const attachmentApiPath = conversationApiPath(activeConversation.id, '/attachments')
    const response = await $fetch<ReserveAttachmentResponse>(attachmentApiPath, {
      method: 'POST',
      body: input,
    })
    attachmentApiPaths.set(response.data.attachment.id, attachmentApiPath)
    return response.data
  },
  async complete(id) {
    const attachmentApiPath = attachmentApiPaths.get(id)
    if (!attachmentApiPath) throw new Error('Nie znaleziono przygotowanego załącznika.')
    const response = await $fetch<CompleteAttachmentResponse>(
      `${attachmentApiPath}/${encodeURIComponent(id)}/complete`,
      { method: 'POST' },
    )
    return response.data.attachment
  },
  async discard(id) {
    const attachmentApiPath = attachmentApiPaths.get(id)
    if (!attachmentApiPath) return
    try {
      await $fetch(`${attachmentApiPath}/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
    }
    finally {
      attachmentApiPaths.delete(id)
    }
  },
  completionFailureMode: classifyMessageAttachmentCompletionFailure,
}

const attachmentDrafts = useMessageAttachmentDrafts(attachmentDraftAdapter)

const selectedRecipient = computed(() => recipients.value.find(
  recipient => recipient.clientPersonId === selectedClientPersonId.value,
) ?? null)
const selectedRecipientInitials = computed(() => {
  const words = (selectedRecipient.value?.displayName || 'Klient')
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
  return (words.length > 1
    ? `${words[0]?.[0] ?? ''}${words.at(-1)?.[0] ?? ''}`
    : words[0]?.slice(0, 2) ?? 'KL')
    .toLocaleUpperCase('pl-PL')
})
const conversationCardUi = {
  root: 'case-conversation__card-root',
  header: 'case-conversation__card-header',
  body: 'case-conversation__card-body',
}
const hasAttachmentDrafts = computed(() => attachmentDrafts.drafts.value.length > 0)
const hasPendingMessage = computed(() => (
  Boolean(pendingRecipientId.value)
  && pendingRecipientId.value === selectedClientPersonId.value
  && !messages.value.some(message => message.clientMessageId === pendingClientMessageId.value)
))
const recipientSelectionModel = computed({
  get: () => selectedClientPersonId.value,
  set: (clientPersonId: string) => {
    if (
      clientPersonId !== selectedClientPersonId.value
      && hasAttachmentDrafts.value
    ) {
      toast.add({
        title: 'Najpierw zakończ szkic wiadomości',
        description: 'Wyślij wiadomość albo usuń załączniki, aby zmienić odbiorcę.',
        color: 'warning',
        icon: 'i-lucide-paperclip',
      })
      return
    }
    selectedClientPersonId.value = clientPersonId
  },
})

const requestedClientPersonId = computed(() => {
  const raw = props.fixedClientPersonId
    || (Array.isArray(route.query.person) ? route.query.person[0] : route.query.person)
  if (typeof raw !== 'string') return ''
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(raw)
    ? raw
    : ''
})

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
    && body.length <= 4_000
    && (body.length >= 1 || attachmentDrafts.readyAttachments.value.length > 0)
    && !sending.value
    && !conversationLoadError.value
    && !attachmentDrafts.isBusy.value
    && !attachmentDrafts.hasFailed.value
  )
})

function canLeaveConversation() {
  return !sending.value
    && !hasAttachmentDrafts.value
    && !composer.value.trim()
}

defineExpose({ canLeaveConversation })

const attachmentDisabledReason = computed(() => {
  if (!draftClientMessageId.value) return 'Przygotowywanie bezpiecznego przesyłania…'
  if (!selectedRecipient.value?.portalEnabled) return 'Najpierw udostępnij panel klienta.'
  if (conversationLoadError.value) return 'Najpierw odśwież historię rozmowy.'
  if (loadingConversation.value) return 'Poczekaj na otwarcie rozmowy.'
  if (sending.value) return 'Poczekaj na wysłanie bieżącej wiadomości.'
  return undefined
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
  path: orgPath(`/cases/${props.caseId}`),
  query: { view: 'documents' },
  hash: '#case-applications',
}))

function conversationApiPath(conversationId: string, suffix = '') {
  return `${indexApiPath.value}/${encodeURIComponent(conversationId)}${suffix}`
}

const clientFilesApiPath = computed(() => conversation.value
  ? conversationApiPath(conversation.value.id, '/attachments')
  : '')

function rotateDraftClientMessageId() {
  if (!import.meta.client) return
  draftClientMessageId.value = crypto.randomUUID()
}

function messageAttachmentUrl(
  conversationId: string,
  attachmentId: string,
  download: boolean,
) {
  const base = conversationApiPath(
    conversationId,
    `/attachments/${encodeURIComponent(attachmentId)}`,
  )
  return download ? `${base}?download=1` : base
}

function messageAttachmentUrlFor(conversationId: string) {
  return (attachment: MessageAttachment, download: boolean) => (
    messageAttachmentUrl(conversationId, attachment.id, download)
  )
}

function pendingAttachmentUrl(attachment: MessageAttachment, download: boolean) {
  if (!download) {
    const previewUrl = pendingAttachmentPreviewUrls.get(attachment.id)
    if (previewUrl) return previewUrl
  }
  return messageAttachmentUrl(pendingConversationId.value, attachment.id, download)
}

function clearPendingMessage() {
  pendingBody.value = ''
  pendingAttachments.value = []
  pendingReply.value = null
  pendingClientMessageId.value = ''
  pendingConversationId.value = ''
  pendingRecipientId.value = ''
  pendingAttachmentPreviewUrls.clear()
}

function abandonAttachmentDrafts(discard = true) {
  const clearing = attachmentDrafts.clear({ discard })
  rotateDraftClientMessageId()
  void clearing
}

function mergeMessages(incoming: Message[]) {
  const byClientMessageId = new Map(messages.value.map(message => [
    message.clientMessageId || message.id,
    message,
  ]))
  for (const message of incoming) {
    byClientMessageId.set(message.clientMessageId || message.id, message)
  }
  messages.value = [...byClientMessageId.values()].sort((left, right) => left.sequence - right.sequence)
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

  const incomingMessages = bootstrap.messages ?? []
  const knownMessageIds = new Set(messages.value.map(
    message => message.clientMessageId || message.id,
  ))
  const addedMessages = mode === 'append'
    ? incomingMessages.filter(message => !knownMessageIds.has(
        message.clientMessageId || message.id,
      ))
    : []
  if (mode !== 'append') messageMotionReady.value = false
  const receivedClientFiles = mode === 'append' && bootstrap.messages.some(message => (
    message.senderKind === 'client' && message.attachments.length > 0
  ))
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
  mergeMessages(incomingMessages)
  if (mode !== 'append') hasOlderMessages.value = Boolean(bootstrap.pageInfo?.hasMore)

  updateConversationEntry(bootstrap.conversation, {
    clientPerson: bootstrap.clientPerson,
    lastMessagePreview: messages.value.at(-1)
      ? buildMessagePreview(
          messages.value.at(-1)!.body,
          messages.value.at(-1)!.attachments,
        )
      : null,
  })

  if (shouldFollowMessages) {
    void nextTick(() => {
      scrollToEnd(mode === 'replace' ? 'auto' : 'smooth')
      if (mode === 'replace' && readSentinelElement.value && visibilityObserver) {
        panelVisible.value = false
        visibilityObserver.unobserve(readSentinelElement.value)
        visibilityObserver.observe(readSentinelElement.value)
      }
      if (mode === 'replace') messageMotionReady.value = true
    })
  }
  else if (mode === 'append' && addedMessages.length) {
    unseenMessageCount.value += addedMessages.length
  }
  if (mode === 'replace') unseenMessageCount.value = 0
  scheduleReceipt()
  if (receivedClientFiles) clientFilesRefreshKey.value += 1
  if (mode === 'append' && (bootstrap.messages?.length ?? 0) > 0) emit('activity')
}

function resetConversationState() {
  abandonAttachmentDrafts()
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
  messageMotionReady.value = false
  unseenMessageCount.value = 0
  panelVisible.value = false
  ownReceipt.value = null
  peerReceipt.value = null
  hasOlderMessages.value = false
  peerTyping.value = false
  clientFilesOpen.value = false
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
    const response = await $fetch<ConversationBootstrapResponse>(
      conversationApiPath(entry.id, '/messages'),
    )
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
    if (hasAttachmentDrafts.value) return
    const requestedRecipient = recipients.value.find(recipient => (
      recipient.clientPersonId === requestedClientPersonId.value
    ))
    const unreadEntry = conversationEntries.value.find(item => item.unreadCount > 0)
    const preferredRecipient = requestedRecipient
      ?? recipients.value.find(recipient => (
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
    if (hasAttachmentDrafts.value) return
    scheduleRecipientSelection()
  }
}, { immediate: true })

watch(requestedClientPersonId, (requested) => {
  if (!requested || requested === selectedClientPersonId.value) return
  if (hasAttachmentDrafts.value) return
  const requestedRecipientExists = recipients.value.some(recipient => (
    recipient.clientPersonId === requested
  ))
  if (requestedRecipientExists) selectedClientPersonId.value = requested
})

watch(selectedClientPersonId, (selected, previous) => {
  if (previous) {
    composerDrafts.set(previous, composer.value)
    replyDrafts.set(previous, replyingTo.value)
  }
  composer.value = composerDrafts.get(selected) ?? ''
  replyingTo.value = replyDrafts.get(selected) ?? null
  if (import.meta.client) {
    draftClientMessageId.value = retryableSends.get(selected)?.clientMessageId
      ?? crypto.randomUUID()
  }
  scheduleRecipientSelection()
})

watch(() => props.caseId, () => {
  abandonAttachmentDrafts(!sending.value)
  composerDrafts.clear()
  replyDrafts.clear()
  retryableSends.clear()
  composer.value = ''
  replyingTo.value = null
  clearPendingMessage()
  selectionRevision += 1
  conversationRevision += 1
  disconnectRealtime()
  recipients.value = []
  conversationEntries.value = []
  selectedClientPersonId.value = ''
  conversation.value = null
  messages.value = []
  ownReceipt.value = null
  peerReceipt.value = null
  clientFilesOpen.value = false
  hasOlderMessages.value = false
  connectionState.value = 'idle'
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

function replyAuthorLabel(reply: MessageReplyReference) {
  return reply.senderKind === 'staff'
    ? 'Ty'
    : selectedRecipient.value?.displayName || 'Klient'
}

function replyActionLabel(message: Message) {
  const author = message.senderKind === 'staff'
    ? 'Ciebie'
    : selectedRecipient.value?.displayName || 'klienta'
  return `Odpowiedz na wiadomość od ${author}`
}

function focusComposer() {
  void nextTick(() => composerElement.value?.querySelector('textarea')?.focus())
}

function startReply(message: Message) {
  if (sending.value || message.deletedAt) return
  replyingTo.value = messageReplyReference(message)
  replyDrafts.set(selectedClientPersonId.value, replyingTo.value)
  focusComposer()
}

function cancelReply() {
  replyingTo.value = null
  replyDrafts.set(selectedClientPersonId.value, null)
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
      conversation.value?.id !== requestedConversationId
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

function scrollToEnd(behavior: ScrollBehavior = 'smooth') {
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
  listAtEnd.value = element.scrollHeight - element.scrollTop - element.clientHeight <= 56
  if (listAtEnd.value) unseenMessageCount.value = 0
  scheduleReceipt()
}

async function ensureConversation() {
  if (conversation.value) return conversation.value
  if (!selectedRecipient.value) throw new Error('Brak wybranego odbiorcy')

  const requestedCaseId = props.caseId
  const response = await $fetch<ConversationBootstrapResponse>(indexApiPath.value, {
    method: 'POST',
    body: { clientPersonId: selectedRecipient.value.clientPersonId },
  })
  if (props.caseId !== requestedCaseId) {
    throw new Error('Kontekst sprawy zmienił się podczas otwierania rozmowy.')
  }
  applyBootstrap(response.data)
  return response.data.conversation
}

async function sendMessage() {
  const draftBody = composer.value
  const body = composer.value.trim()
  if (!canSend.value) return

  const sendingCaseId = props.caseId
  const recipientId = selectedClientPersonId.value
  const replyTarget = replyingTo.value
  const replyToMessageId = replyTarget?.id ?? null
  const readyAttachments = [...attachmentDrafts.readyAttachments.value]
  const attachmentIds = readyAttachments.map(attachment => attachment.id)
  const previousAttempt = retryableSends.get(recipientId)
  const matchesPreviousAttempt = previousAttempt?.body === body
    && previousAttempt.replyToMessageId === replyToMessageId
    && previousAttempt.attachmentIds.length === attachmentIds.length
    && previousAttempt.attachmentIds.every((id, index) => id === attachmentIds[index])
  if (previousAttempt && !matchesPreviousAttempt) {
    const nextClientMessageId = crypto.randomUUID()
    retryableSends.delete(recipientId)
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
        clientMessageId: draftClientMessageId.value || crypto.randomUUID(),
        attachmentIds,
        replyToMessageId,
      }
  draftClientMessageId.value = attempt.clientMessageId
  retryableSends.set(recipientId, attempt)

  sending.value = true
  pendingBody.value = body
  pendingAttachments.value = readyAttachments
  pendingReply.value = replyTarget
  pendingClientMessageId.value = attempt.clientMessageId
  pendingConversationId.value = conversation.value?.id ?? ''
  pendingRecipientId.value = recipientId
  pendingAttachmentPreviewUrls.clear()
  for (const draft of attachmentDrafts.drafts.value) {
    if (draft.attachment && draft.previewUrl) {
      pendingAttachmentPreviewUrls.set(draft.attachment.id, draft.previewUrl)
    }
  }
  composer.value = ''
  replyingTo.value = null
  replyDrafts.set(recipientId, null)
  stopTyping()

  try {
    const activeConversation = await ensureConversation()
    const activeConversationId = activeConversation.id
    pendingConversationId.value = activeConversationId
    const response = await $fetch<SendMessageResponse>(
      conversationApiPath(activeConversationId, '/messages'),
      {
        method: 'POST',
        body: {
          body,
          clientMessageId: attempt.clientMessageId,
          attachmentIds: attempt.attachmentIds,
          replyToMessageId: attempt.replyToMessageId,
        },
      },
    )
    const stillSelected = conversation.value?.id === activeConversationId
    retryableSends.delete(recipientId)
    composerDrafts.delete(recipientId)
    replyDrafts.delete(recipientId)
    if (stillSelected) {
      conversation.value = response.data.conversation
      mergeMessages([response.data.message])
      realtimeConfiguration.value = response.data.realtime
    }
    if (pendingRecipientId.value === recipientId) {
      clearPendingMessage()
    }
    await attachmentDrafts.clear({ discard: false })
    for (const attachmentId of attachmentIds) attachmentApiPaths.delete(attachmentId)
    if (selectedClientPersonId.value === recipientId) rotateDraftClientMessageId()
    if (props.caseId !== sendingCaseId) return
    updateConversationEntry(response.data.conversation, {
      lastMessagePreview: buildMessagePreview(
        response.data.message.body,
        response.data.message.attachments,
      ),
    })
    emit('activity')
    if (!stillSelected) return
    void nextTick(() => scrollToEnd())
  }
  catch (caught: any) {
    if (props.caseId !== sendingCaseId) {
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
      retryableSends.delete(recipientId)
    }
    if (replyUnavailable) retryableSends.delete(recipientId)
    if (selectedClientPersonId.value === recipientId) {
      composer.value = draftBody
      replyingTo.value = replyUnavailable ? null : replyTarget
    }
    else {
      composerDrafts.set(recipientId, draftBody)
    }
    replyDrafts.set(recipientId, replyUnavailable ? null : replyTarget)
    if (pendingRecipientId.value === recipientId) {
      clearPendingMessage()
    }
    toast.add({
      title: replyUnavailable
        ? 'Nie można już odpowiedzieć na tę wiadomość'
        : 'Nie udało się wysłać wiadomości',
      description: replyUnavailable
        ? 'Treść została zachowana. Wybierz inną wiadomość lub wyślij ją bez cytatu.'
        : caught?.data?.statusMessage ?? 'Treść została zachowana. Spróbuj ponownie.',
      color: replyUnavailable ? 'warning' : 'error',
      icon: replyUnavailable ? 'i-lucide-message-circle-warning' : 'i-lucide-circle-alert',
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
        conversationApiPath(conversationId, '/messages'),
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

async function loadOlderMessages(): Promise<LoadOlderMessagesResult> {
  const firstSequence = messages.value[0]?.sequence
  if (!conversation.value || !firstSequence) return 'unavailable'
  if (loadingOlder.value) return 'busy'

  const conversationId = conversation.value.id
  const previousScrollHeight = listElement.value?.scrollHeight ?? 0
  loadingOlder.value = true
  try {
    const response = await $fetch<ConversationBootstrapResponse>(
      conversationApiPath(conversationId, '/messages'),
      { query: { beforeSequence: firstSequence } },
    )
    if (conversation.value?.id !== conversationId) return 'cancelled'
    applyBootstrap(response.data, 'prepend')
    await nextTick()
    if (listElement.value) {
      listElement.value.scrollTop += listElement.value.scrollHeight - previousScrollHeight
      updateListPosition()
    }
    messageMotionReady.value = true
    return 'loaded'
  }
  catch {
    toast.add({
      title: 'Nie udało się pobrać starszych wiadomości',
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
    return 'error'
  }
  finally {
    if (conversation.value?.id === conversationId) loadingOlder.value = false
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
    emit('activity')
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
  panelHydrated.value = true
  if (!draftClientMessageId.value) rotateDraftClientMessageId()
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
  void attachmentDrafts.clear({ discard: !sending.value })
  stopTyping()
  if (peerTypingTimer) clearTimeout(peerTypingTimer)
  if (receiptTimer) clearTimeout(receiptTimer)
  if (highlightTimer) clearTimeout(highlightTimer)
  resetReplySwipe()
  visibilityObserver?.disconnect()
  document.removeEventListener('visibilitychange', scheduleReceipt)
  stopIndexPolling()
  disconnectRealtime()
})
</script>

<template>
  <section
    :class="[
      'case-conversation',
      `case-conversation--${props.surface}`,
    ]"
    aria-labelledby="case-conversation-title"
  >
    <UCard
      v-if="!panelHydrated"
      class="case-conversation__card"
      :ui="conversationCardUi"
      aria-busy="true"
    >
      <h2 id="case-conversation-title" class="sr-only">Wiadomości z klientem</h2>
      <div class="case-conversation__loading">
        <USkeleton class="h-12 w-2/3" />
        <USkeleton class="h-16 w-3/4" />
        <USkeleton class="ml-auto h-16 w-3/4" />
      </div>
    </UCard>

    <UCard
      v-else
      class="case-conversation__card"
      :ui="conversationCardUi"
    >
      <template #header>
        <div class="case-conversation__header">
          <div
            v-if="props.surface === 'pane'"
            class="case-conversation__pane-heading"
          >
            <UButton
              v-if="props.backTo"
              class="case-conversation__back"
              :to="props.backTo"
              color="neutral"
              variant="ghost"
              icon="i-lucide-arrow-left"
              aria-label="Wróć do listy rozmów"
            />
            <span class="case-conversation__avatar">
              {{ selectedRecipientInitials }}
            </span>
            <div>
              <p>{{ props.caseTitle || 'Rozmowa w sprawie' }}</p>
              <h2 id="case-conversation-title">
                {{ selectedRecipient?.displayName || 'Wiadomości' }}
              </h2>
              <span class="case-conversation__connection">
                <i :class="`is-${connectionState}`" />
                {{ peerTyping ? `${selectedRecipient?.displayName || 'Klient'} pisze…` : connectionLabel }}
              </span>
            </div>
          </div>

          <div v-else class="case-conversation__heading">
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
              v-if="props.surface !== 'pane' && totalUnreadCount > 0"
              color="primary"
              variant="subtle"
              icon="i-lucide-mail-plus"
            >
              Nowe: {{ totalUnreadCount }}
            </UBadge>
            <UBadge
              v-if="props.surface !== 'pane'"
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
              v-if="props.surface === 'pane' && props.caseTo"
              class="case-conversation__case-link"
              :to="props.caseTo"
              color="neutral"
              variant="ghost"
              size="sm"
              trailing-icon="i-lucide-arrow-up-right"
            >
              Otwórz sprawę
            </UButton>
            <UButton
              v-if="conversation"
              class="case-conversation__files-action"
              color="neutral"
              variant="outline"
              size="sm"
              icon="i-lucide-folder-open"
              @click="clientFilesOpen = true"
            >
              <span class="case-conversation__action-label">Pliki od klienta</span>
            </UButton>
            <UButton
              v-if="!pushActivated
                && (notificationsState === 'default' || notificationsState === 'granted')
                && realtimeConfiguration.mode === 'ably'
                && conversation"
              class="case-conversation__notification-action"
              color="neutral"
              variant="outline"
              size="sm"
              icon="i-lucide-bell-plus"
              :loading="activatingNotifications"
              :disabled="connectionState !== 'connected'"
              @click="activateNotifications"
            >
              <span class="case-conversation__action-label">Powiadomienia</span>
            </UButton>
            <UBadge
              v-else-if="pushActivated"
              class="case-conversation__push-enabled"
              color="success"
              variant="subtle"
              icon="i-lucide-bell-ring"
            >
              Powiadomienia włączone
            </UBadge>
          </div>
        </div>

        <UFormField
          v-if="recipients.length > 1 && !props.fixedClientPersonId"
          class="case-conversation__recipient-field"
          label="Rozmowa z"
          name="conversation-recipient"
          :description="hasAttachmentDrafts
            ? 'Wyślij wiadomość albo usuń załączniki, aby zmienić odbiorcę.'
            : undefined"
        >
          <USelectMenu
            v-model="recipientSelectionModel"
            class="w-full"
            :items="recipientItems"
            value-key="value"
            label-key="label"
            :disabled="sending || hasAttachmentDrafts"
            placeholder="Wybierz klienta"
            aria-label="Wybierz klienta do rozmowy"
          />
        </UFormField>

        <div
          v-else-if="selectedRecipient && props.surface !== 'pane'"
          class="case-conversation__recipient"
        >
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

        <div v-if="!conversationLoadError" class="case-conversation__stage">
          <div
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
                && !hasPendingMessage"
              class="case-conversation__empty"
            >
              <span><UIcon name="i-lucide-message-circle-more" /></span>
              <strong>Zacznij rozmowę z {{ selectedRecipient?.displayName }}</strong>
              <p>Napisz krótką wiadomość — klient zobaczy ją w panelu swojej sprawy.</p>
            </div>

            <TransitionGroup
              tag="div"
              name="case-message-list"
              class="case-conversation__stream"
              :css="messageMotionReady"
            >
              <article
                v-for="message in messages"
                :key="message.clientMessageId"
                :data-message-id="message.id"
                tabindex="-1"
                :class="[
                  'case-message',
                  message.senderKind === 'staff' ? 'case-message--mine' : 'case-message--theirs',
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
                <UButton
                  v-if="message.senderKind === 'staff'"
                  class="case-message__reply-action"
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
                  class="case-message__bubble"
                  :style="{ '--case-message-swipe-offset': `${messageSwipeOffset(message.id)}px` }"
                >
                  <MessageReplyQuote
                    v-if="message.replyToMessage"
                    :reply="message.replyToMessage"
                    :author-label="replyAuthorLabel(message.replyToMessage)"
                    interactive
                    @select="revealReply"
                  />
                  <div
                    v-else-if="message.replyToMessageId"
                    class="case-message__reply-missing"
                  >
                    Oryginalna wiadomość jest niedostępna
                  </div>
                  <p v-if="message.body">{{ message.body }}</p>
                  <MessageAttachments
                    :attachments="message.attachments"
                    :url-for="messageAttachmentUrlFor(message.conversationId)"
                  />
                  <footer>
                    <time :datetime="message.createdAt">{{ formatMessageTime(message.createdAt) }}</time>
                    <Transition name="case-message-status" mode="out-in">
                      <span
                        v-if="message.senderKind === 'staff'"
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
                  v-if="message.senderKind !== 'staff'"
                  class="case-message__reply-action"
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
                v-if="hasPendingMessage"
                :key="pendingClientMessageId"
                class="case-message case-message--mine is-pending"
              >
                <div class="case-message__bubble">
                  <MessageReplyQuote
                    v-if="pendingReply"
                    :reply="pendingReply"
                    :author-label="replyAuthorLabel(pendingReply)"
                  />
                  <p v-if="pendingBody">{{ pendingBody }}</p>
                  <MessageAttachments
                    :attachments="pendingAttachments"
                    :url-for="pendingAttachmentUrl"
                    :interactive="false"
                  />
                  <footer><span>Wysyłanie…</span></footer>
                </div>
              </article>

              <div v-if="peerTyping" key="peer-typing" class="case-conversation__typing">
                <span /><span /><span />
                {{ selectedRecipient?.displayName }} pisze…
              </div>
            </TransitionGroup>
            <span ref="readSentinelElement" class="case-conversation__read-sentinel" aria-hidden="true" />
          </div>

          <Transition name="case-new-message">
            <UButton
              v-if="unseenMessageCount"
              class="case-conversation__new-message"
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
          v-if="!conversationLoadError"
          ref="composerElement"
          class="case-conversation__composer"
          @submit.prevent="sendMessage"
          @keydown.esc.prevent="cancelReply"
        >
          <Transition name="case-reply-composer">
            <div
              v-if="replyingTo"
              class="case-conversation__reply-composer"
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
            :disabled="Boolean(attachmentDisabledReason)"
            :disabled-reason="attachmentDisabledReason"
          >
            <template #input>
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
            </template>
            <template #submit>
              <UButton
                class="case-conversation__send"
                type="submit"
                color="primary"
                variant="solid"
                icon="i-lucide-arrow-up"
                :loading="sending"
                :disabled="!canSend"
                aria-label="Wyślij wiadomość"
              />
            </template>
          </MessageAttachmentComposer>
        </form>
        <p v-if="!conversationLoadError" class="case-conversation__hint">
          Enter wysyła · Shift+Enter dodaje nową linię
        </p>
      </template>
    </UCard>

    <CaseConversationFilesSlideover
      v-model:open="clientFilesOpen"
      :api-path="clientFilesApiPath"
      :client-name="selectedRecipient?.displayName || ''"
      :refresh-key="clientFilesRefreshKey"
    />
  </section>
</template>

<style scoped>
.case-conversation {
  min-width: 0;
}

.case-conversation__card {
  overflow: hidden;
}

.case-conversation--pane {
  height: 100%;
  min-height: 0;
}

.case-conversation--pane .case-conversation__card {
  display: grid;
  height: 100%;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr);
  border-radius: 0;
  background: var(--ui-bg);
  box-shadow: none;
}

.case-conversation--pane .case-conversation__card[aria-busy='true'] {
  grid-template-rows: minmax(0, 1fr);
}

.case-conversation--pane :deep(.case-conversation__card-header) {
  padding: 0;
}

.case-conversation--pane :deep(.case-conversation__card-body) {
  display: flex;
  min-height: 0;
  overflow: hidden;
  flex-direction: column;
  padding: 0;
}

.case-conversation__header,
.case-conversation__heading,
.case-conversation__pane-heading,
.case-conversation__actions,
.case-conversation__recipient,
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

.case-conversation__pane-heading {
  min-width: 0;
  gap: 12px;
}

.case-conversation__pane-heading > div {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.case-conversation__pane-heading p,
.case-conversation__pane-heading h2,
.case-conversation__pane-heading span {
  overflow: hidden;
  margin: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.case-conversation__pane-heading p {
  max-width: min(46vw, 540px);
  color: var(--ui-text-muted);
  font-size: 10px;
  font-weight: 760;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.case-conversation__pane-heading h2 {
  color: var(--ui-text-highlighted);
  font-size: 17px;
  font-weight: 720;
  line-height: 1.25;
}

.case-conversation__avatar {
  display: grid;
  width: 46px;
  height: 46px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid var(--ui-border);
  border-radius: 999px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 720;
}

.case-conversation__connection {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.case-conversation__connection i {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: var(--ui-text-dimmed);
  transition: background-color var(--oe-motion-fast);
}

.case-conversation__connection i.is-connected {
  background: var(--ui-success);
}

.case-conversation__connection i.is-offline {
  background: var(--ui-warning);
}

.case-conversation__back {
  display: none;
  flex: 0 0 auto;
}

.case-conversation--pane .case-conversation__header {
  min-height: 76px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--ui-border-muted);
  background: var(--ui-bg);
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

.case-conversation--pane .case-conversation__recipient-field {
  margin: 0;
  padding: 10px 20px 12px;
  border-bottom: 1px solid var(--ui-border-muted);
  background: var(--ui-bg);
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

.case-conversation--pane .case-conversation__notice {
  flex: 0 0 auto;
  margin: 12px 20px 0;
}

.case-conversation__loading {
  display: grid;
  min-height: 360px;
  align-content: center;
  gap: 12px;
}

.case-conversation--pane .case-conversation__loading {
  min-height: 0;
  flex: 1 1 0;
  padding: 24px;
}

.case-conversation__stage {
  position: relative;
  min-height: 0;
}

.case-conversation--pane .case-conversation__stage {
  flex: 1 1 0;
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

.case-conversation--pane .case-conversation__messages {
  height: 100%;
  min-height: 0;
  max-height: none;
  flex: 1 1 0;
  margin: 0;
  padding: 24px 28px 32px;
  background: var(--ui-bg);
}

.case-conversation__stream {
  display: flex;
  flex-direction: column;
  gap: 9px;
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
  position: relative;
  display: flex;
  width: 100%;
  align-items: center;
  gap: 4px;
  touch-action: pan-y pinch-zoom;
  transform-origin: left bottom;
}

.case-message__bubble {
  position: relative;
  z-index: 1;
  max-width: min(76%, 660px);
  padding: 10px 13px 7px;
  border-radius: 17px 17px 17px 5px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-highlighted);
  transform: translate3d(var(--case-message-swipe-offset, 0), 0, 0);
  transition:
    opacity var(--oe-motion-fast),
    transform var(--oe-duration-fast) var(--ease-out),
    box-shadow var(--oe-duration-fast) var(--ease-out);
}

.case-message--mine {
  justify-content: flex-end;
  transform-origin: right bottom;
}

.case-message--mine .case-message__bubble {
  border-radius: 17px 17px 5px;
  background: var(--ui-bg-inverted);
  color: var(--ui-text-inverted);
}

.case-message.is-pending .case-message__bubble {
  opacity: .65;
}

.case-message.is-swiping .case-message__bubble {
  transition: none;
}

.case-message.is-highlighted .case-message__bubble {
  box-shadow:
    0 0 0 3px color-mix(in srgb, var(--ui-primary) 30%, transparent),
    0 10px 30px color-mix(in srgb, var(--ui-primary) 15%, transparent);
}

.case-message__reply-action {
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

.case-message:hover .case-message__reply-action,
.case-message:focus-within .case-message__reply-action {
  opacity: 1;
  transform: scale(1);
}

.case-message.is-swipe-ready .case-message__reply-action {
  color: var(--ui-primary);
  opacity: 1;
  transform: scale(1.08);
}

.case-message__reply-missing {
  margin-bottom: 7px;
  padding: 7px 9px 7px 11px;
  border-left: 3px solid currentColor;
  border-radius: 9px;
  background: color-mix(in srgb, currentColor 8%, transparent);
  color: color-mix(in srgb, currentColor 66%, transparent);
  font-size: 11px;
}

.case-message-list-enter-active {
  transition:
    opacity var(--oe-duration-base) var(--ease-out),
    transform var(--oe-duration-base) var(--ease-out);
}

.case-message-list-leave-active {
  transition:
    opacity var(--oe-duration-fast) var(--ease-out),
    transform var(--oe-duration-fast) var(--ease-out);
}

.case-message-list-enter-from {
  opacity: 0;
  transform: translateY(4px) scale(.985);
}

.case-message-list-leave-to {
  opacity: 0;
  transform: translateY(2px) scale(.985);
}

.case-message p {
  font-size: 13px;
  line-height: 1.5;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.case-message p + :deep(.oe-message-attachments) {
  margin-top: 7px;
}

.case-message__bubble > :deep(.oe-message-reply-quote) {
  margin-bottom: 7px;
}

.case-message--mine :deep(.oe-message-attachments) {
  --oe-message-attachment-bg: color-mix(in srgb, currentColor 12%, transparent);
  --oe-message-attachment-border: color-mix(in srgb, currentColor 22%, transparent);
  --oe-message-attachment-hover: color-mix(in srgb, currentColor 18%, transparent);
  --oe-message-attachment-text: currentColor;
  --oe-message-attachment-muted: color-mix(in srgb, currentColor 78%, transparent);
}

.case-message--mine :deep(.oe-message-reply-quote) {
  --oe-message-reply-bg: color-mix(in srgb, currentColor 12%, transparent);
  --oe-message-reply-hover: color-mix(in srgb, currentColor 18%, transparent);
  --oe-message-reply-accent: currentColor;
  --oe-message-reply-author: currentColor;
  --oe-message-reply-muted: color-mix(in srgb, currentColor 76%, transparent);
  --oe-message-reply-text: currentColor;
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

.case-message-status-enter-active,
.case-message-status-leave-active {
  transition: opacity 100ms var(--ease-out);
}

.case-message-status-enter-from,
.case-message-status-leave-to {
  opacity: .45;
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
  animation: case-conversation-typing 1.1s infinite var(--ease-in-out);
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

.case-conversation__new-message {
  position: absolute;
  z-index: 5;
  bottom: 12px;
  left: 50%;
  min-height: 36px;
  border-radius: 999px;
  box-shadow: 0 10px 28px color-mix(in srgb, var(--ui-text) 14%, transparent);
  transform: translateX(-50%);
}

.case-conversation__new-message:active:not(:disabled) {
  transform: translateX(-50%) scale(.97);
}

.case-new-message-enter-active {
  transition:
    opacity var(--oe-duration-base) var(--ease-out),
    transform var(--oe-duration-base) var(--ease-out);
}

.case-new-message-leave-active {
  transition:
    opacity var(--oe-duration-fast) var(--ease-out),
    transform var(--oe-duration-fast) var(--ease-out);
}

.case-new-message-enter-from,
.case-new-message-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(6px) scale(.98);
}

.case-conversation__composer {
  padding-top: 14px;
  border-top: 1px solid var(--ui-border-muted);
}

.case-conversation__reply-composer {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 9px;
  padding: 7px 7px 7px 10px;
  border-radius: 12px;
  background: var(--ui-bg-muted);
}

.case-conversation__reply-composer > div {
  display: grid;
  flex: 1 1 auto;
  min-width: 0;
  gap: 3px;
}

.case-conversation__reply-composer > div > span {
  color: var(--ui-text-toned);
  font-size: 10px;
  font-weight: 720;
}

.case-conversation__reply-composer > button {
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  justify-content: center;
  border-radius: 999px;
}

.case-reply-composer-enter-active,
.case-reply-composer-leave-active {
  transition:
    opacity var(--oe-duration-fast) var(--ease-out),
    transform var(--oe-duration-fast) var(--ease-out);
}

.case-reply-composer-enter-from,
.case-reply-composer-leave-to {
  opacity: 0;
  transform: translateY(4px);
}

.case-conversation--pane .case-conversation__composer {
  flex: 0 0 auto;
  padding: 12px 20px 0;
  background: var(--ui-bg);
}

.case-conversation--pane .case-conversation__reply-composer {
  margin-right: 122px;
}

.case-conversation__send {
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

.case-conversation--pane .case-conversation__hint {
  flex: 0 0 auto;
  margin: 6px 0 0;
  padding: 0 20px 10px;
  background: var(--ui-bg);
}

.case-conversation--pane .case-conversation__send {
  width: 44px;
  height: 44px;
}

@keyframes case-conversation-typing {
  0%, 60%, 100% { transform: translateY(0); opacity: .45; }
  30% { transform: translateY(-3px); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .case-message-list-enter-active,
  .case-message-list-leave-active,
  .case-message-status-enter-active,
  .case-message-status-leave-active,
  .case-new-message-enter-active,
  .case-new-message-leave-active,
  .case-reply-composer-enter-active,
  .case-reply-composer-leave-active,
  .case-message__bubble,
  .case-message__reply-action {
    transition-duration: 150ms !important;
    transition-property: opacity !important;
  }

  .case-message-list-enter-from,
  .case-message-list-leave-to {
    transform: none !important;
  }

  .case-new-message-enter-from,
  .case-new-message-leave-to {
    transform: translateX(-50%) !important;
  }

  .case-reply-composer-enter-from,
  .case-reply-composer-leave-to {
    transform: none !important;
  }

  .case-conversation__typing > span {
    animation: none;
    opacity: .65;
  }
}

@media (min-width: 761px) and (max-width: 1100px) {
  .case-conversation--pane .case-conversation__back {
    display: inline-flex;
  }
}

@media (max-width: 760px) {
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

  .case-message__bubble {
    max-width: min(88%, calc(100% - 48px));
  }

  .case-conversation__hint {
    display: none;
  }

  .case-conversation--pane .case-conversation__header {
    min-height: 68px;
    align-items: center;
    flex-direction: row;
    gap: 8px;
    padding: 10px 12px;
  }

  .case-conversation--pane .case-conversation__pane-heading {
    flex: 1 1 0;
    gap: 8px;
  }

  .case-conversation--pane .case-conversation__pane-heading p {
    max-width: 42vw;
  }

  .case-conversation--pane .case-conversation__avatar {
    width: 40px;
    height: 40px;
  }

  .case-conversation--pane .case-conversation__back {
    display: inline-flex;
  }

  .case-conversation--pane .case-conversation__actions {
    width: auto;
    flex-wrap: nowrap;
    justify-content: flex-end;
    gap: 4px;
  }

  .case-conversation--pane .case-conversation__case-link,
  .case-conversation--pane .case-conversation__push-enabled {
    display: none;
  }

  .case-conversation--pane .case-conversation__files-action,
  .case-conversation--pane .case-conversation__notification-action {
    width: 40px;
    height: 40px;
    justify-content: center;
    padding-inline: 0;
  }

  .case-conversation--pane .case-conversation__action-label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  .case-conversation--pane .case-conversation__messages {
    min-height: 0;
    max-height: none;
    padding: 18px 14px 24px;
  }

  .case-conversation--pane .case-conversation__composer {
    padding: 10px 12px 0;
  }

  .case-conversation--pane .case-conversation__reply-composer {
    margin-right: 56px;
  }

  .case-conversation--pane .case-conversation__hint {
    display: none;
  }
}

@media (hover: none), (pointer: coarse) {
  .case-message__reply-action {
    opacity: .58;
    transform: scale(1);
  }
}

.case-message__reply-action:disabled {
  opacity: 0;
}

.case-message--theirs.is-swiping .case-message__reply-action {
  position: absolute;
  z-index: 0;
  top: 50%;
  left: 0;
  transform: translateY(-50%) scale(1);
}
</style>
