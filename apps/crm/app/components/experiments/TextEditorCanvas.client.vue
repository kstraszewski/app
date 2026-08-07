<script setup lang="ts">
import type {
  EveDynamicToolPart,
  EveMessage,
  EveMessagePart,
} from 'eve/vue'
import { useEveAgent } from 'eve/vue'

type AssistantAvailability = 'available' | 'checking' | 'unavailable'
type ProposalDecision = 'applied' | 'rejected'
type ProposalState = ProposalDecision | 'ready' | 'stale'
type EditTarget = 'selection' | 'document'

interface MarkdownDocumentNode {
  type?: string
  content?: unknown[]
}

interface MarkdownDocument {
  type?: string
  content?: MarkdownDocumentNode[]
}

interface MarkdownEditorChain {
  deleteRange: (range: { from: number, to: number }) => MarkdownEditorChain
  focus: () => MarkdownEditorChain
  insertContentAt: (
    range: { from: number, to: number },
    content: unknown,
    options?: { contentType?: 'markdown', updateSelection?: boolean },
  ) => MarkdownEditorChain
  run: () => boolean
}

interface MarkdownEditor {
  getMarkdown: () => string
  state: {
    selection: {
      from: number
      to: number
      empty: boolean
      $from: { sameParent: (position: unknown) => boolean }
      $to: unknown
    }
    doc: {
      content: { size: number }
      textBetween: (from: number, to: number, blockSeparator?: string, leafText?: string) => string
      slice: (from: number, to: number) => {
        content: { toJSON: () => unknown[] }
      }
    }
  }
  markdown?: {
    parse: (markdown: string) => MarkdownDocument
    serialize: (document: MarkdownDocument) => string
  }
  commands: {
    setContent: (content: string, options: { contentType: 'markdown' }) => boolean
  }
  chain: () => MarkdownEditorChain
}

interface EditorComponentRef {
  editor?: MarkdownEditor | { value?: MarkdownEditor }
}

interface SelectionSnapshot {
  from: number
  to: number
  text: string
  markdown: string
  contextBefore: string
  contextAfter: string
  inline: boolean
}

interface EditorRequestSnapshot {
  requestId: string
  documentRevision: number
  target: EditTarget
  baseMarkdown: string
  selection: SelectionSnapshot | null
}

interface EditorClientContext {
  surface: 'experiments-text-editor'
  requestId: string
  documentRevision: number
  documentTitle: string
  target: EditTarget
  documentMarkdown?: string
  selection?: {
    markdown: string
    text: string
    contextBefore: string
    contextAfter: string
  }
}

interface TextEditProposal {
  proposalId: string
  requestId: string
  target: EditTarget
  documentRevision: number
  replacementMarkdown: string
  summary: string
}

interface PersistedDraft {
  schemaVersion: 1
  title: string
  markdown: string
  updatedAt: string
  knowledgeDocumentId?: string | null
  knowledgeRevision?: number | null
}

const MAX_CONTEXT_CHARACTERS = 60_000
const MAX_REQUEST_SNAPSHOTS = 12
const SELECTION_CONTEXT_CHARACTERS = 900
const DEFAULT_TITLE = 'Dokument bez tytułu'

const route = useRoute()
const toast = useToast()
const authenticatedUser = useAuthUser()
const editorComponent = ref<EditorComponentRef | null>(null)
const messagesContainer = ref<HTMLElement | null>(null)
const documentTitle = ref(DEFAULT_TITLE)
const documentMarkdown = ref('')
const documentRevision = ref(0)
const composer = ref('')
const hydrated = ref(false)
const saveState = ref<'saved' | 'saving' | 'error'>('saved')
const lastSavedAt = ref<Date | null>(null)
const knowledgeDocumentId = ref<string | null>(null)
const knowledgeRevision = ref<number | null>(null)
const knowledgeSaving = ref(false)
const newDocumentModalOpen = ref(false)
const evePanelOpen = ref(false)
const availability = ref<AssistantAvailability>('checking')
const availabilityMessage = ref('')
const activeClientContext = shallowRef<EditorClientContext | null>(null)
const lastSubmittedPrompt = ref('')
const selection = reactive<SelectionSnapshot>({
  from: 0,
  to: 0,
  text: '',
  markdown: '',
  contextBefore: '',
  contextAfter: '',
  inline: false,
})
const requestSnapshots = new Map<string, EditorRequestSnapshot>()
const proposalDecisions = reactive<Record<string, ProposalDecision | undefined>>({})
let saveTimer: ReturnType<typeof setTimeout> | undefined

const organizationSlug = computed(() => {
  const value = route.params.organizationSlug
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')
})
const storageKey = computed(() => (
  `openexpert:experiments:text-editor:v1:${authenticatedUser.value?.id ?? 'anonymous'}:${organizationSlug.value}`
))
const hasSelection = computed(() => selection.to > selection.from && Boolean(selection.text.trim()))
const assistantBusy = computed(() => status.value === 'submitted' || status.value === 'streaming')
const composerDisabled = computed(() => availability.value !== 'available' || assistantBusy.value)
const messages = computed(() => data.value.messages)
const wordCount = computed(() => {
  const text = documentMarkdown.value
    .replace(/[`#>*_~\[\]()!-]/g, ' ')
    .trim()
  return text ? text.split(/\s+/u).length : 0
})
const characterCount = computed(() => documentMarkdown.value.length)
const saveStateLabel = computed(() => {
  if (saveState.value === 'saving') return 'Zapisuję lokalnie…'
  if (saveState.value === 'error') return 'Nie udało się zapisać'
  if (!lastSavedAt.value) return 'Szkic lokalny'
  return `Zapisano ${new Intl.DateTimeFormat('pl-PL', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(lastSavedAt.value)}`
})

const toolbarItems = [
  [
    { 'aria-label': 'Cofnij', square: true, icon: 'i-lucide-undo-2', kind: 'undo', tooltip: { text: 'Cofnij' } },
    { 'aria-label': 'Ponów', square: true, icon: 'i-lucide-redo-2', kind: 'redo', tooltip: { text: 'Ponów' } },
  ],
  [
    { 'aria-label': 'Akapit', square: true, icon: 'i-lucide-pilcrow', kind: 'paragraph', tooltip: { text: 'Akapit' } },
    { 'aria-label': 'Nagłówek 1', square: true, icon: 'i-lucide-heading-1', kind: 'heading', level: 1, tooltip: { text: 'Nagłówek 1' } },
    { 'aria-label': 'Nagłówek 2', square: true, icon: 'i-lucide-heading-2', kind: 'heading', level: 2, tooltip: { text: 'Nagłówek 2' } },
    { 'aria-label': 'Nagłówek 3', square: true, icon: 'i-lucide-heading-3', kind: 'heading', level: 3, tooltip: { text: 'Nagłówek 3' } },
  ],
  [
    { 'aria-label': 'Pogrubienie', square: true, icon: 'i-lucide-bold', kind: 'mark', mark: 'bold', tooltip: { text: 'Pogrubienie' } },
    { 'aria-label': 'Kursywa', square: true, icon: 'i-lucide-italic', kind: 'mark', mark: 'italic', tooltip: { text: 'Kursywa' } },
    { 'aria-label': 'Przekreślenie', square: true, icon: 'i-lucide-strikethrough', kind: 'mark', mark: 'strike', tooltip: { text: 'Przekreślenie' } },
    { 'aria-label': 'Kod', square: true, icon: 'i-lucide-code-2', kind: 'mark', mark: 'code', tooltip: { text: 'Kod' } },
  ],
  [
    { 'aria-label': 'Lista punktowana', square: true, icon: 'i-lucide-list', kind: 'bulletList', tooltip: { text: 'Lista punktowana' } },
    { 'aria-label': 'Lista numerowana', square: true, icon: 'i-lucide-list-ordered', kind: 'orderedList', tooltip: { text: 'Lista numerowana' } },
    { 'aria-label': 'Cytat', square: true, icon: 'i-lucide-text-quote', kind: 'blockquote', tooltip: { text: 'Cytat' } },
    { 'aria-label': 'Blok kodu', square: true, icon: 'i-lucide-square-code', kind: 'codeBlock', tooltip: { text: 'Blok kodu' } },
  ],
  [
    { 'aria-label': 'Wyczyść formatowanie', square: true, icon: 'i-lucide-remove-formatting', kind: 'clearFormatting', tooltip: { text: 'Wyczyść formatowanie' } },
  ],
]

const bubbleToolbarItems = [[
  { 'aria-label': 'Pogrubienie', square: true, icon: 'i-lucide-bold', kind: 'mark', mark: 'bold', tooltip: { text: 'Pogrubienie' } },
  { 'aria-label': 'Kursywa', square: true, icon: 'i-lucide-italic', kind: 'mark', mark: 'italic', tooltip: { text: 'Kursywa' } },
  { 'aria-label': 'Przekreślenie', square: true, icon: 'i-lucide-strikethrough', kind: 'mark', mark: 'strike', tooltip: { text: 'Przekreślenie' } },
]]

const slashMenuItems = [[
  { label: 'Akapit', description: 'Zwykły tekst', icon: 'i-lucide-pilcrow', kind: 'paragraph' },
  { label: 'Nagłówek 1', description: 'Duży nagłówek sekcji', icon: 'i-lucide-heading-1', kind: 'heading', level: 1 },
  { label: 'Nagłówek 2', description: 'Średni nagłówek sekcji', icon: 'i-lucide-heading-2', kind: 'heading', level: 2 },
  { label: 'Nagłówek 3', description: 'Mały nagłówek sekcji', icon: 'i-lucide-heading-3', kind: 'heading', level: 3 },
], [
  { label: 'Lista punktowana', description: 'Lista bez kolejności', icon: 'i-lucide-list', kind: 'bulletList' },
  { label: 'Lista numerowana', description: 'Lista kroków', icon: 'i-lucide-list-ordered', kind: 'orderedList' },
  { label: 'Cytat', description: 'Wyróżniony cytat', icon: 'i-lucide-text-quote', kind: 'blockquote' },
  { label: 'Blok kodu', description: 'Fragment kodu', icon: 'i-lucide-square-code', kind: 'codeBlock' },
]]

const quickActions = [
  { label: 'Popraw styl', icon: 'i-lucide-wand-sparkles', prompt: 'Popraw styl i klarowność tekstu, zachowując jego znaczenie i język.' },
  { label: 'Skróć', icon: 'i-lucide-scan-line', prompt: 'Skróć tekst bez utraty kluczowych informacji.' },
  { label: 'Uporządkuj', icon: 'i-lucide-list-tree', prompt: 'Uporządkuj tekst, dodaj logiczną strukturę i czytelne nagłówki tam, gdzie to pomaga.' },
]

function currentEditor(): MarkdownEditor | null {
  const exposed = editorComponent.value?.editor
  if (!exposed) return null
  if ('getMarkdown' in exposed) return exposed
  return exposed.value ?? null
}

function selectionMarkdown(editor: MarkdownEditor, from: number, to: number, inline: boolean, fallback: string) {
  if (inline || !editor.markdown) return fallback
  try {
    const content = editor.state.doc.slice(from, to).content.toJSON()
    return editor.markdown.serialize({ type: 'doc', content: content as MarkdownDocumentNode[] }).trim() || fallback
  }
  catch {
    return fallback
  }
}

function updateSelection(payload: { editor: unknown }) {
  const editor = payload.editor as MarkdownEditor
  const { from, to, empty, $from, $to } = editor.state.selection
  const inline = !empty && $from.sameParent($to)
  const text = empty ? '' : editor.state.doc.textBetween(from, to, '\n', ' ')
  const beforeStart = Math.max(0, from - SELECTION_CONTEXT_CHARACTERS)
  const afterEnd = Math.min(editor.state.doc.content.size, to + SELECTION_CONTEXT_CHARACTERS)

  selection.from = from
  selection.to = to
  selection.text = text
  selection.inline = inline
  selection.markdown = empty ? '' : selectionMarkdown(editor, from, to, inline, text)
  selection.contextBefore = empty ? '' : editor.state.doc.textBetween(beforeStart, from, '\n', ' ')
  selection.contextAfter = empty ? '' : editor.state.doc.textBetween(to, afterEnd, '\n', ' ')
}

function snapshotSelection(): SelectionSnapshot | null {
  if (!hasSelection.value) return null
  return {
    from: selection.from,
    to: selection.to,
    text: selection.text,
    markdown: selection.markdown,
    contextBefore: selection.contextBefore,
    contextAfter: selection.contextAfter,
    inline: selection.inline,
  }
}

function createRequestContext(): EditorClientContext | null {
  const selected = snapshotSelection()
  const target: EditTarget = selected ? 'selection' : 'document'
  const contextLength = selected?.markdown.length ?? documentMarkdown.value.length

  if (contextLength > MAX_CONTEXT_CHARACTERS) {
    toast.add({
      title: 'Tekst jest zbyt długi dla Eve',
      description: selected
        ? 'Zmniejsz zaznaczenie i spróbuj ponownie.'
        : 'Zaznacz fragment dokumentu, nad którym Eve ma pracować.',
      color: 'warning',
      icon: 'i-lucide-triangle-alert',
    })
    return null
  }

  const requestId = crypto.randomUUID()
  const requestSnapshot: EditorRequestSnapshot = {
    requestId,
    documentRevision: documentRevision.value,
    target,
    baseMarkdown: documentMarkdown.value,
    selection: selected,
  }
  requestSnapshots.set(requestId, requestSnapshot)
  while (requestSnapshots.size > MAX_REQUEST_SNAPSHOTS) {
    const oldestRequestId = requestSnapshots.keys().next().value
    if (typeof oldestRequestId !== 'string') break
    requestSnapshots.delete(oldestRequestId)
  }

  return {
    surface: 'experiments-text-editor',
    requestId,
    documentRevision: documentRevision.value,
    documentTitle: documentTitle.value.trim() || DEFAULT_TITLE,
    target,
    ...(selected
      ? {
          selection: {
            markdown: selected.markdown,
            text: selected.text,
            contextBefore: selected.contextBefore,
            contextAfter: selected.contextAfter,
          },
        }
      : { documentMarkdown: documentMarkdown.value }),
  }
}

function friendlyAssistantError(caught: { message?: string } | null | undefined) {
  const message = caught?.message?.trim() ?? ''
  if (/AI Gateway|API[_ ]?KEY|VERCEL_OIDC_TOKEN|credentials/iu.test(message)) {
    return 'Eve nie jest jeszcze połączona z modelem AI.'
  }
  if (/Sesja CRM wygasła|Zaloguj się/iu.test(message)) return 'Sesja CRM wygasła. Zaloguj się ponownie.'
  if (/Dostęp do eksperymentów/iu.test(message)) return 'Nie masz dostępu do tego eksperymentu.'
  if (/fetch|network|ECONN/iu.test(message)) return 'Nie udało się połączyć z Eve.'
  return 'Eve jest chwilowo niedostępna. Spróbuj ponownie.'
}

async function assistantHeaders() {
  const token = await $fetch<{ accessToken: string }>('/api/data/token').catch(() => null)
  if (!token?.accessToken) throw new Error('Sesja CRM wygasła. Zaloguj się ponownie.')
  return {
    Authorization: `Bearer ${token.accessToken}`,
    'x-openexpert-organization': organizationSlug.value,
  }
}

async function checkAssistantAvailability() {
  availability.value = 'checking'
  availabilityMessage.value = ''
  try {
    const result = await $fetch<{ available: boolean, message?: string }>('/api/assistant/status', {
      headers: await assistantHeaders(),
    })
    availability.value = result.available ? 'available' : 'unavailable'
    availabilityMessage.value = result.message ?? ''
  }
  catch (caught) {
    availability.value = 'unavailable'
    availabilityMessage.value = friendlyAssistantError(caught as { message?: string })
  }
}

const {
  data,
  error: assistantError,
  reset,
  send,
  session,
  status,
  stop,
} = useEveAgent({
  host: '/api/assistant',
  headers: assistantHeaders,
  prepareSend: input => ({
    ...input,
    clientContext: {
      route: route.fullPath,
      organizationSlug: organizationSlug.value,
      ...activeClientContext.value,
    },
  }),
  onError: caught => {
    if (import.meta.dev) console.error('[experiments-text-editor:eve]', caught)
    toast.add({
      title: 'Eve nie odpowiedziała',
      description: friendlyAssistantError(caught),
      color: 'error',
      icon: 'i-lucide-triangle-alert',
    })
  },
})

function scheduleSave() {
  if (!hydrated.value) return
  saveState.value = 'saving'
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveDraft, 450)
}

function saveDraft() {
  if (!hydrated.value) return
  try {
    const draft: PersistedDraft = {
      schemaVersion: 1,
      title: documentTitle.value.trim() || DEFAULT_TITLE,
      markdown: documentMarkdown.value,
      updatedAt: new Date().toISOString(),
      knowledgeDocumentId: knowledgeDocumentId.value,
      knowledgeRevision: knowledgeRevision.value,
    }
    localStorage.setItem(storageKey.value, JSON.stringify(draft))
    lastSavedAt.value = new Date(draft.updatedAt)
    saveState.value = 'saved'
  }
  catch {
    saveState.value = 'error'
  }
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(storageKey.value)
    if (!raw) return
    const draft = JSON.parse(raw) as Partial<PersistedDraft>
    if (draft.schemaVersion !== 1) return
    if (typeof draft.title === 'string') documentTitle.value = draft.title || DEFAULT_TITLE
    if (typeof draft.markdown === 'string') documentMarkdown.value = draft.markdown
    if (typeof draft.knowledgeDocumentId === 'string') knowledgeDocumentId.value = draft.knowledgeDocumentId
    if (typeof draft.knowledgeRevision === 'number' && draft.knowledgeRevision >= 1) {
      knowledgeRevision.value = draft.knowledgeRevision
    }
    if (typeof draft.updatedAt === 'string') {
      const date = new Date(draft.updatedAt)
      if (!Number.isNaN(date.getTime())) lastSavedAt.value = date
    }
  }
  catch {
    saveState.value = 'error'
  }
}

watch(documentMarkdown, (value, previous) => {
  if (!hydrated.value || value === previous) return
  documentRevision.value += 1
  scheduleSave()
})
watch(documentTitle, scheduleSave)
watch([messages, status], async () => {
  await nextTick()
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  }
}, { deep: true })

onMounted(() => {
  loadDraft()
  hydrated.value = true
  void checkAssistantAvailability()
})

onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer)
  saveDraft()
})

async function sendMessage(message = composer.value) {
  const text = message.trim()
  if (!text || composerDisabled.value) return
  const context = createRequestContext()
  if (!context) return

  activeClientContext.value = context
  lastSubmittedPrompt.value = text
  composer.value = ''
  evePanelOpen.value = true
  try {
    await send(text)
  }
  catch {
    // useEveAgent forwards the useful error through onError.
  }
}

function submitComposer() {
  void sendMessage()
}

function retryLastMessage() {
  if (!lastSubmittedPrompt.value || composerDisabled.value) return
  void sendMessage(lastSubmittedPrompt.value)
}

async function cancelTurn(options: { silent?: boolean } = {}) {
  const sessionId = session.value?.sessionId
  try {
    if (sessionId) {
      await $fetch(`/api/assistant/eve/v1/session/${encodeURIComponent(sessionId)}/cancel`, {
        method: 'POST',
        headers: await assistantHeaders(),
        body: {},
      })
    }
    if (!options.silent) {
      toast.add({
        title: 'Zadanie zatrzymane',
        description: 'Eve nie będzie wykonywać kolejnych działań.',
        color: 'neutral',
        icon: 'i-lucide-square',
      })
    }
  }
  catch (caught) {
    if (!options.silent) {
      toast.add({
        title: 'Nie udało się zatrzymać zadania',
        description: friendlyAssistantError(caught as { message?: string }),
        color: 'error',
        icon: 'i-lucide-triangle-alert',
      })
    }
  }
  finally {
    stop()
  }
}

async function newConversation() {
  if (assistantBusy.value) await cancelTurn({ silent: true })
  reset()
  activeClientContext.value = null
  lastSubmittedPrompt.value = ''
  requestSnapshots.clear()
  for (const key of Object.keys(proposalDecisions)) delete proposalDecisions[key]
}

function messageTextParts(message: EveMessage) {
  return message.parts.filter((part): part is Extract<EveMessagePart, { type: 'text' }> => part.type === 'text')
}

function proposalFromPart(part: EveDynamicToolPart): TextEditProposal | null {
  if (part.toolName !== 'propose_text_edit' || part.state !== 'output-available') return null
  const output = (part as EveDynamicToolPart & { output?: unknown }).output
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null
  const candidate = output as Record<string, unknown>
  if (
    typeof candidate.proposalId !== 'string'
    || typeof candidate.requestId !== 'string'
    || (candidate.target !== 'selection' && candidate.target !== 'document')
    || typeof candidate.documentRevision !== 'number'
    || !Number.isInteger(candidate.documentRevision)
    || typeof candidate.replacementMarkdown !== 'string'
    || typeof candidate.summary !== 'string'
  ) return null
  return candidate as unknown as TextEditProposal
}

function messageProposalParts(message: EveMessage) {
  return message.parts
    .filter((part): part is EveDynamicToolPart => part.type === 'dynamic-tool')
    .map(part => ({ part, proposal: proposalFromPart(part) }))
    .filter((item): item is { part: EveDynamicToolPart, proposal: TextEditProposal } => Boolean(item.proposal))
}

function messageHasPendingProposal(message: EveMessage) {
  return message.parts.some(part => (
    part.type === 'dynamic-tool'
    && part.toolName === 'propose_text_edit'
    && part.state !== 'output-available'
    && part.state !== 'output-error'
  ))
}

function messageHasFailedProposal(message: EveMessage) {
  return message.parts.some(part => (
    part.type === 'dynamic-tool'
    && part.toolName === 'propose_text_edit'
    && part.state === 'output-error'
  ))
}

function proposalState(proposal: TextEditProposal): ProposalState {
  const decision = proposalDecisions[proposal.proposalId]
  if (decision) return decision
  const snapshot = requestSnapshots.get(proposal.requestId)
  if (!snapshot) return 'stale'
  if (snapshot.documentRevision !== proposal.documentRevision) return 'stale'
  if (snapshot.target !== proposal.target) return 'stale'
  if (documentRevision.value !== snapshot.documentRevision) return 'stale'
  if (documentMarkdown.value !== snapshot.baseMarkdown) return 'stale'
  if (proposal.target === 'selection' && !snapshot.selection) return 'stale'
  return 'ready'
}

function proposalStateLabel(proposal: TextEditProposal) {
  const state = proposalState(proposal)
  if (state === 'applied') return 'Zastosowano'
  if (state === 'rejected') return 'Odrzucono'
  if (state === 'stale') return 'Nieaktualna'
  return proposal.target === 'selection' ? 'Zmiana zaznaczenia' : 'Zmiana dokumentu'
}

function proposalStateColor(proposal: TextEditProposal) {
  const state = proposalState(proposal)
  if (state === 'applied') return 'success' as const
  if (state === 'stale') return 'warning' as const
  if (state === 'rejected') return 'neutral' as const
  return 'primary' as const
}

function applyProposal(proposal: TextEditProposal) {
  if (proposalState(proposal) !== 'ready') return
  const editor = currentEditor()
  const snapshot = requestSnapshots.get(proposal.requestId)
  if (!editor || !snapshot) return

  let applied = false
  if (proposal.target === 'document') {
    applied = editor.commands.setContent(proposal.replacementMarkdown, { contentType: 'markdown' })
  }
  else if (snapshot.selection) {
    const range = { from: snapshot.selection.from, to: snapshot.selection.to }
    if (!proposal.replacementMarkdown) {
      applied = editor.chain().focus().deleteRange(range).run()
    }
    else if (snapshot.selection.inline && editor.markdown) {
      const parsed = editor.markdown.parse(proposal.replacementMarkdown)
      const onlyBlock = parsed.content?.length === 1 ? parsed.content[0] : undefined
      if (onlyBlock?.type === 'paragraph') {
        applied = editor.chain()
          .focus()
          .insertContentAt(range, onlyBlock.content ?? [], { updateSelection: true })
          .run()
      }
    }
    if (!applied) {
      applied = editor.chain()
        .focus()
        .insertContentAt(range, proposal.replacementMarkdown, {
          contentType: 'markdown',
          updateSelection: true,
        })
        .run()
    }
  }

  if (!applied) {
    toast.add({
      title: 'Nie udało się zastosować propozycji',
      description: 'Tekst pozostał bez zmian.',
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
    return
  }

  proposalDecisions[proposal.proposalId] = 'applied'
  requestSnapshots.delete(proposal.requestId)
  toast.add({
    title: 'Propozycja Eve zastosowana',
    description: 'Możesz cofnąć zmianę standardowym poleceniem Cofnij.',
    color: 'success',
    icon: 'i-lucide-check',
  })
}

function rejectProposal(proposal: TextEditProposal) {
  if (proposalState(proposal) !== 'ready') return
  proposalDecisions[proposal.proposalId] = 'rejected'
  requestSnapshots.delete(proposal.requestId)
}

async function copyMarkdown() {
  try {
    await navigator.clipboard.writeText(documentMarkdown.value)
    toast.add({ title: 'Markdown skopiowany', color: 'success', icon: 'i-lucide-copy-check' })
  }
  catch {
    toast.add({ title: 'Nie udało się skopiować tekstu', color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

async function saveToKnowledge() {
  if (knowledgeSaving.value) return
  if (!documentMarkdown.value.trim()) {
    toast.add({
      title: 'Dokument jest pusty',
      description: 'Dodaj treść przed zapisaniem jej w Wiedzy.',
      color: 'warning',
      icon: 'i-lucide-triangle-alert',
    })
    return
  }

  knowledgeSaving.value = true
  try {
    const body = {
      kind: 'text',
      title: documentTitle.value.trim() || DEFAULT_TITLE,
      textContent: documentMarkdown.value,
      ...(knowledgeDocumentId.value && knowledgeRevision.value
        ? { expectedRevision: knowledgeRevision.value }
        : {}),
    }
    const endpoint = knowledgeDocumentId.value
      ? `/api/org/${encodeURIComponent(organizationSlug.value)}/experiments/knowledge/${encodeURIComponent(knowledgeDocumentId.value)}`
      : `/api/org/${encodeURIComponent(organizationSlug.value)}/experiments/knowledge`
    const response = await $fetch<{ data: { id: string, revision: number, indexingStatus: string } }>(endpoint, {
      method: knowledgeDocumentId.value ? 'PUT' : 'POST',
      body,
    })
    knowledgeDocumentId.value = response.data.id
    knowledgeRevision.value = response.data.revision
    saveDraft()
    toast.add({
      title: response.data.indexingStatus === 'ready'
        ? 'Zapisano i zwektoryzowano'
        : 'Zapisano w Wiedzy',
      description: response.data.indexingStatus === 'ready'
        ? 'Dokument jest już dostępny we wspólnej wyszukiwarce.'
        : 'Wyszukiwanie tekstowe działa, ale embedding nie powstał.',
      color: response.data.indexingStatus === 'ready' ? 'success' : 'warning',
      icon: response.data.indexingStatus === 'ready' ? 'i-lucide-sparkles' : 'i-lucide-triangle-alert',
    })
  }
  catch (caught) {
    const description = typeof caught === 'object' && caught
      ? String((caught as { data?: { statusMessage?: unknown } }).data?.statusMessage ?? 'Spróbuj ponownie.')
      : 'Spróbuj ponownie.'
    toast.add({
      title: 'Nie udało się zapisać w Wiedzy',
      description,
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  }
  finally {
    knowledgeSaving.value = false
  }
}

function downloadMarkdown() {
  const safeTitle = (documentTitle.value.trim() || 'dokument')
    .toLocaleLowerCase('pl')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'dokument'
  const url = URL.createObjectURL(new Blob([documentMarkdown.value], { type: 'text/markdown;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${safeTitle}.md`
  anchor.click()
  URL.revokeObjectURL(url)
}

function createNewDocument() {
  documentTitle.value = DEFAULT_TITLE
  documentMarkdown.value = ''
  knowledgeDocumentId.value = null
  knowledgeRevision.value = null
  documentRevision.value += 1
  newDocumentModalOpen.value = false
  newConversation()
  scheduleSave()
  nextTick(() => currentEditor()?.commands.setContent('', { contentType: 'markdown' }))
}
</script>

<template>
  <section
    class="text-editor-canvas"
    :class="{ 'text-editor-canvas--eve-open': evePanelOpen }"
    aria-label="Eksperymentalny edytor tekstu"
  >
    <div class="canvas-document-panel">
      <header class="canvas-commandbar">
        <div class="canvas-commandbar__status" role="status" aria-live="polite">
          <span :class="`is-${saveState}`" />
          <div>
            <strong>{{ saveStateLabel }}</strong>
            <small>Tylko w tej przeglądarce</small>
          </div>
        </div>

        <div class="canvas-commandbar__stats" aria-label="Statystyki dokumentu">
          <span>{{ wordCount }} słów</span>
          <span>{{ characterCount }} znaków</span>
          <UBadge v-if="hasSelection" color="primary" variant="subtle" size="sm">
            {{ selection.text.length }} zaznaczonych
          </UBadge>
        </div>

        <div class="canvas-commandbar__actions">
          <UButton
            color="neutral"
            variant="soft"
            icon="i-lucide-library-big"
            :label="knowledgeDocumentId ? 'Aktualizuj wiedzę' : 'Zapisz w Wiedzy'"
            :loading="knowledgeSaving"
            @click="saveToKnowledge"
          />
          <UButton
            class="canvas-eve-toggle"
            color="primary"
            variant="soft"
            icon="i-lucide-sparkles"
            label="Eve"
            @click="evePanelOpen = true"
          />
          <UTooltip text="Nowy dokument">
            <UButton
              color="neutral"
              variant="ghost"
              icon="i-lucide-file-plus-2"
              aria-label="Nowy dokument"
              @click="newDocumentModalOpen = true"
            />
          </UTooltip>
          <UTooltip text="Kopiuj Markdown">
            <UButton
              color="neutral"
              variant="ghost"
              icon="i-lucide-copy"
              aria-label="Kopiuj Markdown"
              @click="copyMarkdown"
            />
          </UTooltip>
          <UTooltip text="Pobierz Markdown">
            <UButton
              color="neutral"
              variant="ghost"
              icon="i-lucide-download"
              aria-label="Pobierz Markdown"
              @click="downloadMarkdown"
            />
          </UTooltip>
        </div>
      </header>

      <div class="canvas-paper-scroll">
        <article class="canvas-paper">
          <input
            v-model="documentTitle"
            class="canvas-paper__title"
            type="text"
            maxlength="160"
            aria-label="Tytuł dokumentu"
            placeholder="Dokument bez tytułu"
          >

          <UEditor
            ref="editorComponent"
            v-model="documentMarkdown"
            class="canvas-editor"
            content-type="markdown"
            :image="false"
            :mention="false"
            :placeholder="{ placeholder: 'Zacznij pisać albo poproś Eve o pierwszy szkic…', mode: 'firstLine' }"
            :on-selection-update="updateSelection"
            :ui="{
              root: 'min-h-[720px]',
              content: 'min-h-[660px]',
              base: 'min-h-[660px] px-0 sm:px-0 pb-24 text-base',
            }"
          >
            <template #default="{ editor }">
              <div class="canvas-editor__toolbar" aria-label="Formatowanie tekstu">
                <UEditorToolbar
                  :editor="editor"
                  :items="toolbarItems"
                  size="xs"
                />
              </div>
              <UEditorToolbar
                layout="bubble"
                :editor="editor"
                :items="bubbleToolbarItems"
                size="xs"
              />
              <UEditorSuggestionMenu :editor="editor" :items="slashMenuItems" />
              <UEditorDragHandle :editor="editor" />
            </template>
          </UEditor>
        </article>
      </div>
    </div>

    <button
      v-if="evePanelOpen"
      class="canvas-eve-backdrop"
      type="button"
      tabindex="-1"
      aria-label="Zamknij panel Eve"
      @click="evePanelOpen = false"
    />

    <aside class="canvas-eve-panel" aria-label="Eve — partner redakcyjny">
      <header class="canvas-eve-panel__header">
        <span class="canvas-eve-panel__identity">
          <span><UIcon name="i-lucide-sparkles" /></span>
          <span>
            <strong>Eve</strong>
            <small>Partner redakcyjny</small>
          </span>
        </span>
        <div class="canvas-eve-panel__header-actions">
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-lucide-rotate-ccw"
            aria-label="Nowa rozmowa"
            :disabled="!messages.length"
            @click="newConversation"
          />
          <UButton
            class="canvas-eve-panel__close"
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-lucide-x"
            aria-label="Zamknij Eve"
            @click="evePanelOpen = false"
          />
        </div>
      </header>

      <div class="canvas-eve-panel__context">
        <UIcon :name="hasSelection ? 'i-lucide-text-cursor-input' : 'i-lucide-file-text'" />
        <span v-if="hasSelection">Eve będzie pracować na zaznaczeniu</span>
        <span v-else>Eve widzi bieżący dokument przy wysyłaniu</span>
      </div>

      <div
        ref="messagesContainer"
        class="canvas-eve-panel__messages"
        role="log"
        aria-live="polite"
        :aria-busy="assistantBusy"
      >
        <div v-if="!messages.length" class="canvas-eve-empty">
          <span class="canvas-eve-empty__icon"><UIcon name="i-lucide-pencil-ruler" /></span>
          <div>
            <h2>Pracuj nad tekstem razem z Eve</h2>
            <p>Zaznacz fragment lub zostaw kursor w dokumencie, a potem opisz oczekiwany rezultat.</p>
          </div>

          <UAlert
            v-if="availability === 'unavailable'"
            color="error"
            variant="subtle"
            icon="i-lucide-plug-zap"
            title="Eve jest niedostępna"
            :description="availabilityMessage"
          >
            <template #actions>
              <UButton color="error" variant="outline" size="xs" @click="checkAssistantAvailability">
                Sprawdź ponownie
              </UButton>
            </template>
          </UAlert>

          <div v-else class="canvas-eve-empty__actions">
            <UButton
              v-for="action in quickActions"
              :key="action.label"
              color="neutral"
              variant="outline"
              :icon="action.icon"
              :label="action.label"
              :disabled="composerDisabled"
              @click="sendMessage(action.prompt)"
            />
          </div>
        </div>

        <article
          v-for="message in messages"
          :key="message.id"
          class="canvas-eve-message"
          :class="`canvas-eve-message--${message.role}`"
        >
          <span class="canvas-eve-message__avatar" aria-hidden="true">
            <UIcon :name="message.role === 'assistant' ? 'i-lucide-sparkles' : 'i-lucide-user-round'" />
          </span>
          <div class="canvas-eve-message__body">
            <strong>{{ message.role === 'assistant' ? 'Eve' : 'Ty' }}</strong>
            <p
              v-for="(part, index) in messageTextParts(message)"
              :key="`${message.id}:text:${index}`"
            >
              {{ part.text }}
            </p>

            <div v-if="messageHasPendingProposal(message)" class="canvas-eve-working">
              <UIcon name="i-lucide-loader-circle" />
              Przygotowuję propozycję…
            </div>

            <UAlert
              v-if="messageHasFailedProposal(message)"
              color="error"
              variant="subtle"
              icon="i-lucide-circle-alert"
              title="Nie udało się przygotować propozycji"
              description="Dokument nie został zmieniony."
            />

            <section
              v-for="{ part, proposal } in messageProposalParts(message)"
              :key="part.toolCallId"
              class="canvas-proposal"
            >
              <header>
                <span>
                  <UIcon name="i-lucide-file-diff" />
                  <strong>Propozycja zmiany</strong>
                </span>
                <UBadge :color="proposalStateColor(proposal)" variant="subtle" size="sm">
                  {{ proposalStateLabel(proposal) }}
                </UBadge>
              </header>
              <p>{{ proposal.summary }}</p>
              <pre>{{ proposal.replacementMarkdown }}</pre>
              <UAlert
                v-if="proposalState(proposal) === 'stale'"
                color="warning"
                variant="subtle"
                icon="i-lucide-history"
                title="Dokument zmienił się od czasu tej propozycji"
                description="Poproś Eve o przygotowanie nowej wersji."
              />
              <div v-if="proposalState(proposal) === 'ready'" class="canvas-proposal__actions">
                <UButton
                  color="primary"
                  icon="i-lucide-check"
                  label="Zastosuj"
                  @click="applyProposal(proposal)"
                />
                <UButton
                  color="neutral"
                  variant="ghost"
                  label="Odrzuć"
                  @click="rejectProposal(proposal)"
                />
              </div>
            </section>
          </div>
        </article>

        <div v-if="assistantBusy && messages.length" class="canvas-eve-typing" aria-label="Eve pisze">
          <span /><span /><span />
        </div>
      </div>

      <footer class="canvas-eve-panel__composer">
        <div class="canvas-eve-panel__quick-actions">
          <button
            v-for="action in quickActions"
            :key="action.label"
            type="button"
            :disabled="composerDisabled"
            @click="sendMessage(action.prompt)"
          >
            <UIcon :name="action.icon" /> {{ action.label }}
          </button>
        </div>
        <UChatPrompt
          v-model="composer"
          :disabled="composerDisabled"
          :loading="availability === 'checking'"
          :error="assistantError ?? undefined"
          autoresize
          :maxrows="6"
          :placeholder="availability === 'checking'
            ? 'Łączę z Eve…'
            : availability === 'unavailable'
              ? 'Eve jest niedostępna'
              : hasSelection
                ? 'Co zmienić w zaznaczeniu?'
                : 'Co zrobić z dokumentem?'"
          @submit="submitComposer"
        >
          <template #footer>
            <div class="canvas-eve-composer-footer">
              <span><UIcon name="i-lucide-shield-check" /> Zmiany wymagają akceptacji</span>
              <UChatPromptSubmit
                :status="status"
                :disabled="!composer.trim() || availability !== 'available'"
                @stop="cancelTurn()"
                @reload="retryLastMessage"
              />
            </div>
          </template>
        </UChatPrompt>
      </footer>
    </aside>

    <UModal
      v-model:open="newDocumentModalOpen"
      title="Utworzyć nowy dokument?"
      description="Bieżący szkic lokalny zostanie zastąpiony pustym dokumentem."
      :ui="{ footer: 'justify-end' }"
    >
      <template #body>
        <UAlert
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="Tej operacji nie można cofnąć po zamknięciu strony"
          description="Jeśli chcesz zachować tekst, najpierw pobierz go jako Markdown."
        />
      </template>
      <template #footer="{ close }">
        <UButton color="neutral" variant="ghost" @click="close">Anuluj</UButton>
        <UButton color="error" icon="i-lucide-file-plus-2" @click="createNewDocument">
          Nowy dokument
        </UButton>
      </template>
    </UModal>
  </section>
</template>

<style scoped>
.text-editor-canvas {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) clamp(360px, 31vw, 460px);
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border-top: 1px solid var(--ui-border);
  background: var(--ui-bg-muted);
}

.canvas-document-panel,
.canvas-eve-panel {
  min-width: 0;
  min-height: 0;
}

.canvas-document-panel {
  display: flex;
  flex-direction: column;
}

.canvas-commandbar {
  position: relative;
  z-index: 4;
  display: grid;
  grid-template-columns: minmax(170px, 1fr) auto minmax(170px, 1fr);
  align-items: center;
  gap: 16px;
  min-height: 60px;
  padding: 9px 18px;
  border-bottom: 1px solid var(--ui-border);
  background: color-mix(in srgb, var(--ui-bg) 94%, transparent);
  backdrop-filter: blur(14px);
}

.canvas-commandbar__status,
.canvas-commandbar__actions,
.canvas-commandbar__stats {
  display: flex;
  align-items: center;
}

.canvas-commandbar__status {
  gap: 9px;
  min-width: 0;
}

.canvas-commandbar__status > span {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--ui-success);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--ui-success) 14%, transparent);
}

.canvas-commandbar__status > span.is-saving {
  background: var(--ui-warning);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--ui-warning) 14%, transparent);
}

.canvas-commandbar__status > span.is-error {
  background: var(--ui-error);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--ui-error) 14%, transparent);
}

.canvas-commandbar__status div {
  display: grid;
  min-width: 0;
}

.canvas-commandbar__status strong {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 12px;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.canvas-commandbar__status small {
  color: var(--ui-text-dimmed);
  font-size: 10px;
}

.canvas-commandbar__stats {
  justify-content: center;
  gap: 11px;
  color: var(--ui-text-muted);
  font-size: 11px;
  white-space: nowrap;
}

.canvas-commandbar__stats > span + span::before {
  margin-right: 11px;
  color: var(--ui-border-accented);
  content: "·";
}

.canvas-commandbar__actions {
  justify-content: flex-end;
  gap: 2px;
}

.canvas-eve-toggle {
  display: none;
}

.canvas-paper-scroll {
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: clamp(22px, 4vw, 54px);
  scrollbar-gutter: stable;
}

.canvas-paper {
  width: min(100%, 860px);
  min-height: 980px;
  margin: 0 auto 64px;
  padding: clamp(42px, 6vw, 72px) clamp(30px, 5vw, 64px);
  border: 1px solid color-mix(in srgb, var(--ui-border) 82%, transparent);
  border-radius: 5px;
  background: var(--ui-bg);
  box-shadow:
    0 1px 2px rgb(15 23 42 / 5%),
    0 22px 65px rgb(15 23 42 / 8%);
}

.canvas-paper__title {
  width: 100%;
  margin: 0 0 34px;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--ui-text-highlighted);
  font: 700 clamp(30px, 3vw, 40px) / 1.12 "DM Sans", sans-serif;
  letter-spacing: -0.035em;
}

.canvas-paper__title::placeholder {
  color: var(--ui-text-dimmed);
}

.canvas-editor {
  position: relative;
}

.canvas-editor :deep(.ProseMirror:focus),
.canvas-editor :deep(.ProseMirror:focus-visible) {
  outline: none;
}

.canvas-editor :deep([role="toolbar"] button) {
  width: 30px;
  min-height: 30px;
  justify-content: center;
  padding: 0;
  border-radius: 6px;
}

.canvas-editor :deep([role="toolbar"] button [data-slot="leadingIcon"]) {
  width: 14px;
  height: 14px;
}

.canvas-editor__toolbar {
  position: sticky;
  z-index: 3;
  top: -1px;
  overflow-x: auto;
  margin: 0 0 26px;
  padding: 4px;
  border: 1px solid var(--ui-border);
  border-radius: 9px;
  background: color-mix(in srgb, var(--ui-bg) 96%, transparent);
  box-shadow: 0 4px 16px rgb(15 23 42 / 4%);
  scrollbar-width: none;
}

.canvas-editor__toolbar :deep([role="toolbar"]) {
  width: max-content;
  min-width: 100%;
  gap: 4px;
}

.canvas-editor__toolbar::-webkit-scrollbar {
  display: none;
}

.canvas-eve-panel {
  position: relative;
  z-index: 6;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--ui-border);
  background: var(--ui-bg);
}

.canvas-eve-panel__header {
  display: flex;
  min-height: 60px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 15px;
  border-bottom: 1px solid var(--ui-border);
}

.canvas-eve-panel__identity,
.canvas-eve-panel__header-actions {
  display: flex;
  align-items: center;
}

.canvas-eve-panel__identity {
  gap: 10px;
}

.canvas-eve-panel__identity > span:first-child {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--ui-primary) 30%, var(--ui-border));
  border-radius: 10px;
  background: color-mix(in srgb, var(--ui-primary) 11%, var(--ui-bg));
  color: var(--ui-primary);
}

.canvas-eve-panel__identity > span:last-child {
  display: grid;
}

.canvas-eve-panel__identity strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.canvas-eve-panel__identity small {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.canvas-eve-panel__header-actions {
  gap: 2px;
}

.canvas-eve-panel__close {
  display: none;
}

.canvas-eve-panel__context {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 15px;
  border-bottom: 1px solid var(--ui-border-muted);
  background: var(--ui-bg-muted);
  color: var(--ui-text-muted);
  font-size: 11px;
}

.canvas-eve-panel__context svg {
  color: var(--ui-primary);
}

.canvas-eve-panel__messages {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding: 18px 15px 28px;
  scrollbar-gutter: stable;
}

.canvas-eve-empty {
  display: grid;
  gap: 18px;
  align-content: center;
  min-height: 100%;
  padding: 30px 13px;
  text-align: center;
}

.canvas-eve-empty__icon {
  display: grid;
  width: 50px;
  height: 50px;
  place-items: center;
  margin: 0 auto;
  border: 1px solid var(--ui-border);
  border-radius: 16px;
  background: var(--ui-bg-muted);
  color: var(--ui-primary);
  font-size: 21px;
}

.canvas-eve-empty h2 {
  margin: 0 0 7px;
  color: var(--ui-text-highlighted);
  font-size: 17px;
}

.canvas-eve-empty p {
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.6;
}

.canvas-eve-empty__actions {
  display: grid;
  gap: 8px;
}

.canvas-eve-message {
  display: grid;
  grid-template-columns: 29px minmax(0, 1fr);
  gap: 9px;
  margin-bottom: 20px;
}

.canvas-eve-message--user {
  grid-template-columns: minmax(0, 1fr) 29px;
}

.canvas-eve-message--user .canvas-eve-message__avatar {
  grid-column: 2;
  grid-row: 1;
}

.canvas-eve-message--user .canvas-eve-message__body {
  grid-column: 1;
  grid-row: 1;
  justify-self: end;
  border-radius: 14px 14px 4px 14px;
  background: color-mix(in srgb, var(--ui-primary) 10%, var(--ui-bg));
}

.canvas-eve-message__avatar {
  display: grid;
  width: 29px;
  height: 29px;
  place-items: center;
  border: 1px solid var(--ui-border);
  border-radius: 9px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-muted);
  font-size: 13px;
}

.canvas-eve-message--assistant .canvas-eve-message__avatar {
  color: var(--ui-primary);
}

.canvas-eve-message__body {
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 9px 11px;
  border-radius: 4px 14px 14px;
  background: var(--ui-bg-muted);
}

.canvas-eve-message__body > strong {
  color: var(--ui-text-highlighted);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.canvas-eve-message__body > p {
  margin: 0;
  color: var(--ui-text);
  font-size: 12px;
  line-height: 1.65;
  white-space: pre-wrap;
}

.canvas-eve-working {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.canvas-eve-working svg {
  animation: canvas-spin 1s linear infinite;
}

.canvas-proposal {
  display: grid;
  gap: 10px;
  margin-top: 3px;
  padding: 12px;
  border: 1px solid color-mix(in srgb, var(--ui-primary) 24%, var(--ui-border));
  border-radius: 12px;
  background: var(--ui-bg);
}

.canvas-proposal header,
.canvas-proposal header > span,
.canvas-proposal__actions {
  display: flex;
  align-items: center;
}

.canvas-proposal header {
  justify-content: space-between;
  gap: 8px;
}

.canvas-proposal header > span {
  gap: 6px;
  color: var(--ui-primary);
  font-size: 11px;
}

.canvas-proposal > p {
  margin: 0;
  color: var(--ui-text);
  font-size: 12px;
  line-height: 1.5;
}

.canvas-proposal pre {
  overflow: auto;
  max-height: 230px;
  margin: 0;
  padding: 10px;
  border: 1px solid var(--ui-border-muted);
  border-radius: 8px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-muted);
  font: 10px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: pre-wrap;
}

.canvas-proposal__actions {
  justify-content: flex-end;
  gap: 5px;
}

.canvas-eve-typing {
  display: flex;
  gap: 4px;
  width: fit-content;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--ui-bg-muted);
}

.canvas-eve-typing span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--ui-text-dimmed);
  animation: canvas-pulse 1.2s ease-in-out infinite;
}

.canvas-eve-typing span:nth-child(2) { animation-delay: 120ms; }
.canvas-eve-typing span:nth-child(3) { animation-delay: 240ms; }

.canvas-eve-panel__composer {
  padding: 9px 11px 12px;
  border-top: 1px solid var(--ui-border);
  background: var(--ui-bg);
}

.canvas-eve-panel__quick-actions {
  display: flex;
  gap: 5px;
  overflow-x: auto;
  margin: 0 2px 8px;
  scrollbar-width: none;
}

.canvas-eve-panel__quick-actions::-webkit-scrollbar {
  display: none;
}

.canvas-eve-panel__quick-actions button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  padding: 5px 8px;
  border: 1px solid var(--ui-border);
  border-radius: 999px;
  background: transparent;
  color: var(--ui-text-muted);
  font-size: 10px;
  cursor: pointer;
}

.canvas-eve-panel__quick-actions button:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--ui-primary) 35%, var(--ui-border));
  color: var(--ui-primary);
}

.canvas-eve-panel__quick-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.canvas-eve-composer-footer {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.canvas-eve-composer-footer > span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--ui-text-dimmed);
  font-size: 9px;
}

.canvas-eve-backdrop {
  display: none;
}

@keyframes canvas-spin {
  to { transform: rotate(360deg); }
}

@keyframes canvas-pulse {
  0%, 60%, 100% { opacity: 0.35; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-2px); }
}

@media (max-width: 1099px) {
  .text-editor-canvas {
    grid-template-columns: minmax(0, 1fr);
  }

  .canvas-eve-toggle {
    display: inline-flex;
  }

  .canvas-eve-panel {
    position: absolute;
    inset: 0 0 0 auto;
    width: min(440px, calc(100% - 38px));
    transform: translateX(102%);
    transition: transform 180ms ease;
  }

  .text-editor-canvas--eve-open .canvas-eve-panel {
    transform: translateX(0);
  }

  .canvas-eve-panel__close {
    display: inline-flex;
  }

  .canvas-eve-backdrop {
    position: absolute;
    z-index: 5;
    inset: 0;
    display: block;
    border: 0;
    background: rgb(15 23 42 / 38%);
    backdrop-filter: blur(2px);
  }
}

@media (max-width: 720px) {
  .canvas-commandbar {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    padding-inline: 11px;
  }

  .canvas-commandbar__stats {
    display: none;
  }

  .canvas-paper-scroll {
    padding: 0;
    background: var(--ui-bg);
  }

  .canvas-paper {
    width: 100%;
    min-height: 100%;
    margin: 0;
    padding: 34px 22px 80px;
    border: 0;
    border-radius: 0;
    box-shadow: none;
  }

  .canvas-paper__title {
    margin-bottom: 26px;
    font-size: 32px;
  }

  .canvas-editor__toolbar {
    margin-inline: -8px;
  }

  .canvas-eve-panel {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .canvas-eve-panel,
  .canvas-eve-working svg,
  .canvas-eve-typing span {
    animation: none;
    transition: none;
  }
}
</style>
