import type { Message } from '@openexpert/messaging'

interface PreviewMessageSeed {
  sequence: number
  senderKind: 'staff' | 'client'
  body: string
  createdAt: string
}

const previewConversationSeeds: Record<string, PreviewMessageSeed[]> = {
  'case-preview-warszewo': [
    {
      sequence: 1,
      senderKind: 'staff',
      body: 'Dzień dobry, dodałam najważniejsze informacje do sprawy. Jeśli coś będzie niejasne, proszę napisać tutaj.',
      createdAt: '2026-08-01T08:42:00.000Z',
    },
    {
      sequence: 2,
      senderKind: 'client',
      body: 'Dziękuję. Dokument prześlę jeszcze dzisiaj po południu.',
      createdAt: '2026-08-01T09:08:00.000Z',
    },
    {
      sequence: 3,
      senderKind: 'staff',
      body: 'Świetnie. Gdy tylko plik się pojawi, od razu go sprawdzę.',
      createdAt: '2026-08-01T09:11:00.000Z',
    },
  ],
  'case-preview-refinance': [
    {
      sequence: 1,
      senderKind: 'staff',
      body: 'Mam już potwierdzone warunki z trzech banków. Kończę porównanie kosztów i oprocentowania.',
      createdAt: '2026-07-31T13:48:00.000Z',
    },
    {
      sequence: 2,
      senderKind: 'client',
      body: 'Dziękuję. Czy w zestawieniu będzie też koszt wcześniejszej spłaty?',
      createdAt: '2026-07-31T14:02:00.000Z',
    },
    {
      sequence: 3,
      senderKind: 'staff',
      body: 'Tak. Zestawienie finalnych ofert będzie gotowe jutro rano.',
      createdAt: '2026-07-31T14:26:00.000Z',
    },
  ],
}

const previewConversationStorageKey = 'openexpert:preview-conversations:v3'

function isStoredPreviewConversations(value: unknown): value is Record<string, Message[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value as Record<string, unknown>).every(messages => Array.isArray(messages))
}

function previewMessage(caseId: string, seed: PreviewMessageSeed): Message {
  const conversationId = `preview-conversation-${caseId}`
  const senderIsClient = seed.senderKind === 'client'

  return {
    id: `${conversationId}-${seed.sequence}`,
    organizationId: 'org-openexpert-local',
    conversationId,
    sequence: seed.sequence,
    clientMessageId: `${conversationId}-client-${seed.sequence}`,
    senderKind: seed.senderKind,
    senderUserId: senderIsClient ? null : 'preview-expert',
    senderClientPersonId: senderIsClient ? 'preview-client' : null,
    senderAuthUserId: senderIsClient ? 'preview-auth-user' : null,
    body: seed.body,
    attachments: [],
    replyToMessageId: null,
    replyToMessage: null,
    createdAt: seed.createdAt,
    editedAt: null,
    deletedAt: null,
  }
}

export function createPortalPreviewMessages(caseId: string): Message[] {
  const seeds = previewConversationSeeds[caseId] ?? [{
    sequence: 1,
    senderKind: 'staff' as const,
    body: 'Dzień dobry. Tutaj możesz bezpiecznie napisać do eksperta w tej sprawie.',
    createdAt: '2026-08-01T08:42:00.000Z',
  }]

  return seeds.map(seed => previewMessage(caseId, seed))
}

export function usePortalPreviewConversations(enabled = true) {
  const messagesByCase = useState<Record<string, Message[]>>(
    'portal-preview-conversations-v3',
    () => ({}),
  )
  const storageHydrated = useState('portal-preview-conversations-storage-hydrated-v3', () => false)

  function persistMessages() {
    if (!enabled || !import.meta.client || !storageHydrated.value) return
    sessionStorage.setItem(previewConversationStorageKey, JSON.stringify(messagesByCase.value))
  }

  if (import.meta.client) {
    onMounted(() => {
      if (!enabled || storageHydrated.value) return
      storageHydrated.value = true
      try {
        const serialized = sessionStorage.getItem(previewConversationStorageKey)
        const stored = serialized ? JSON.parse(serialized) : null
        if (isStoredPreviewConversations(stored)) {
          messagesByCase.value = stored
          return
        }
      }
      catch {
        // Corrupted preview state falls back to the deterministic demo history.
      }
      persistMessages()
    })
  }

  function ensureMessages(caseId: string): Message[] {
    const existing = messagesByCase.value[caseId]
    if (existing) return existing

    const messages = createPortalPreviewMessages(caseId)
    messagesByCase.value = {
      ...messagesByCase.value,
      [caseId]: messages,
    }
    persistMessages()
    return messages
  }

  function appendMessage(caseId: string, message: Message) {
    const messages = ensureMessages(caseId)
    const byId = new Map(messages.map(item => [item.id, item]))
    byId.set(message.id, message)
    messagesByCase.value = {
      ...messagesByCase.value,
      [caseId]: [...byId.values()].sort((left, right) => left.sequence - right.sequence),
    }
    persistMessages()
  }

  return {
    messagesByCase,
    ensureMessages,
    appendMessage,
  }
}
