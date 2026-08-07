<script setup lang="ts">
import type {
  EveDynamicToolPart,
  EveMessage,
  EveMessagePart,
} from 'eve/vue'
import { useEveAgent } from 'eve/vue'
import {
  buildDynamicContentBootMessage,
  buildDynamicContentPreviewShell,
  DYNAMIC_CONTENT_IFRAME_SANDBOX,
  dynamicContentCharacterCount,
  type DynamicContentSource,
  isDynamicContentWithinLimits,
  parseDynamicContentPreviewMessage,
  sanitizeDynamicContentHtml,
} from '~/utils/dynamic-content-preview'

type AssistantAvailability = 'available' | 'checking' | 'unavailable'
type ProposalDecision = 'applied' | 'rejected'
type ProposalState = ProposalDecision | 'ready' | 'stale'
type PreviewStatus = 'loading' | 'ready' | 'error'
type SourceTab = 'html' | 'css' | 'javascript'
type StudioView = 'split' | 'source' | 'preview'
type PreviewViewport = 'desktop' | 'tablet' | 'mobile'

interface DynamicContentDraft extends DynamicContentSource {
  title: string
}

interface PersistedDraft extends DynamicContentDraft {
  schemaVersion: 1
  updatedAt: string
  knowledgeDocumentId?: string | null
  knowledgeRevision?: number | null
}

interface DynamicContentRequestSnapshot {
  requestId: string
  documentRevision: number
  base: DynamicContentSource
}

interface DynamicContentClientContext {
  surface: 'experiments-dynamic-content-editor'
  requestId: string
  documentRevision: number
  documentTitle: string
  document: Record<string, string>
}

interface DynamicContentProposal {
  proposalId: string
  requestId: string
  documentRevision: number
  replacementHtml: string
  replacementCss: string
  replacementJavaScript: string
  summary: string
}

const MAX_REQUEST_SNAPSHOTS = 12
const DEFAULT_TITLE = 'Interaktywny przewodnik klienta'

const STARTER_HTML = `<main class="oe-page">
  <header class="oe-header">
    <a class="oe-brand" href="#start" aria-label="OpenExpert — początek">
      <span class="oe-brand__mark">OE</span>
      <span>OpenExpert</span>
    </a>
    <span class="oe-eyebrow">Twój plan finansowania</span>
  </header>

  <section id="start" class="oe-hero">
    <p class="oe-kicker">Kredyt hipoteczny · krok po kroku</p>
    <h1>Sprawdź, co przygotować przed rozmową z ekspertem.</h1>
    <p class="oe-lead">Krótki przewodnik dopasuje listę kolejnych działań do etapu, na którym jesteś.</p>
  </section>

  <section class="oe-planner" aria-labelledby="planner-title">
    <div class="oe-planner__intro">
      <span class="oe-step-label">Krok <strong id="step-number">1</strong> z 3</span>
      <div class="oe-progress" aria-hidden="true"><span id="progress-bar"></span></div>
      <h2 id="planner-title">Na jakim etapie jesteś?</h2>
      <p id="step-description">Wybierz odpowiedź, a przygotujemy następny krok.</p>
    </div>

    <div id="step-options" class="oe-options" role="group" aria-label="Dostępne odpowiedzi"></div>

    <div class="oe-actions">
      <button id="back-button" class="oe-button oe-button--secondary" type="button" disabled>Wstecz</button>
      <button id="next-button" class="oe-button oe-button--primary" type="button" disabled>Dalej</button>
    </div>
  </section>

  <aside class="oe-note">
    <span aria-hidden="true">i</span>
    <p><strong>Bez zobowiązań.</strong> To materiał informacyjny — ostateczne możliwości oceni ekspert na podstawie dokumentów.</p>
  </aside>
</main>`

const STARTER_CSS = `:root {
  color-scheme: light;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #171918;
  background: #f4f5f3;
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { min-width: 280px; min-height: 100vh; margin: 0; background: #f4f5f3; }
button, input, textarea, select { font: inherit; }
button { cursor: pointer; }
button:focus-visible, a:focus-visible {
  outline: 3px solid #171918;
  outline-offset: 3px;
}

.oe-page { width: min(100% - 32px, 1080px); margin: 0 auto; padding: 28px 0 64px; }
.oe-header { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding-bottom: 52px; }
.oe-brand { display: inline-flex; align-items: center; gap: 10px; color: inherit; font-weight: 750; text-decoration: none; letter-spacing: -.02em; }
.oe-brand__mark { display: grid; width: 34px; height: 34px; place-items: center; border-radius: 10px; background: #171918; color: #fff; font-size: 11px; }
.oe-eyebrow, .oe-kicker, .oe-step-label { color: #686d69; font-size: 12px; font-weight: 650; letter-spacing: .08em; text-transform: uppercase; }
.oe-hero { max-width: 780px; padding: 26px 0 48px; }
.oe-kicker { margin: 0 0 18px; }
.oe-hero h1 { max-width: 760px; margin: 0; font-size: clamp(38px, 7vw, 72px); line-height: .98; letter-spacing: -.055em; }
.oe-lead { max-width: 640px; margin: 26px 0 0; color: #5f6460; font-size: clamp(17px, 2vw, 21px); line-height: 1.55; }
.oe-planner { display: grid; grid-template-columns: minmax(0, .85fr) minmax(320px, 1.15fr); gap: 44px; padding: clamp(24px, 5vw, 52px); border: 1px solid #d9dcda; border-radius: 16px; background: #fff; box-shadow: 0 18px 60px rgba(20, 24, 21, .07); }
.oe-planner__intro h2 { margin: 28px 0 10px; font-size: clamp(26px, 4vw, 40px); line-height: 1.06; letter-spacing: -.04em; }
.oe-planner__intro p { margin: 0; color: #686d69; line-height: 1.6; }
.oe-progress { height: 4px; margin-top: 13px; overflow: hidden; border-radius: 99px; background: #eceeec; }
.oe-progress span { display: block; width: 33.333%; height: 100%; border-radius: inherit; background: #171918; transition: width 220ms ease; }
.oe-options { display: grid; gap: 10px; align-content: start; }
.oe-option { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 58px; padding: 13px 15px; border: 1px solid #d9dcda; border-radius: 12px; background: #fff; color: #303431; text-align: left; transition: border-color 140ms ease, background 140ms ease, transform 140ms ease; }
.oe-option:hover { border-color: #8b908c; transform: translateY(-1px); }
.oe-option[aria-pressed="true"] { border-color: #171918; background: #f2f3f1; }
.oe-option__radio { display: grid; width: 22px; height: 22px; flex: 0 0 auto; place-items: center; border: 1px solid #afb3b0; border-radius: 50%; }
.oe-option[aria-pressed="true"] .oe-option__radio::after { width: 10px; height: 10px; border-radius: 50%; background: #171918; content: ""; }
.oe-actions { grid-column: 2; display: flex; justify-content: flex-end; gap: 9px; }
.oe-button { min-height: 44px; padding: 0 18px; border: 1px solid #171918; border-radius: 11px; font-weight: 700; }
.oe-button--primary { background: #171918; color: #fff; }
.oe-button--secondary { background: #fff; color: #171918; }
.oe-button:disabled { cursor: not-allowed; opacity: .35; }
.oe-note { display: flex; gap: 12px; max-width: 720px; margin: 18px 0 0 auto; color: #686d69; font-size: 13px; line-height: 1.55; }
.oe-note > span { display: grid; width: 22px; height: 22px; flex: 0 0 auto; place-items: center; border: 1px solid #c7cbc8; border-radius: 50%; color: #303431; font-weight: 750; }
.oe-note p { margin: 0; }

@media (max-width: 720px) {
  .oe-page { width: min(100% - 24px, 1080px); padding-top: 18px; }
  .oe-header { padding-bottom: 28px; }
  .oe-eyebrow { display: none; }
  .oe-hero { padding: 18px 0 34px; }
  .oe-planner { grid-template-columns: 1fr; gap: 26px; padding: 22px; }
  .oe-actions { grid-column: 1; }
}

@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after { transition-duration: .01ms !important; }
}`

const STARTER_JAVASCRIPT = `const steps = [
  {
    title: 'Na jakim etapie jesteś?',
    description: 'Wybierz odpowiedź, a przygotujemy następny krok.',
    options: ['Dopiero sprawdzam możliwości', 'Mam już wybraną nieruchomość', 'Porównuję konkretne oferty']
  },
  {
    title: 'Co jest dla Ciebie najważniejsze?',
    description: 'Zaznacz priorytet, który ekspert powinien poznać jako pierwszy.',
    options: ['Niższa miesięczna rata', 'Mniejszy koszt całkowity', 'Elastyczna wcześniejsza spłata']
  },
  {
    title: 'Twój bezpieczny następny krok',
    description: 'Przygotuj dochody z ostatnich miesięcy, orientacyjny budżet i informacje o zobowiązaniach.',
    options: ['Mam komplet — chcę umówić rozmowę', 'Potrzebuję listy dokumentów']
  }
]

let stepIndex = 0
let selectedOption = ''
const title = document.querySelector('#planner-title')
const description = document.querySelector('#step-description')
const options = document.querySelector('#step-options')
const number = document.querySelector('#step-number')
const progress = document.querySelector('#progress-bar')
const back = document.querySelector('#back-button')
const next = document.querySelector('#next-button')

function renderStep() {
  const step = steps[stepIndex]
  selectedOption = ''
  title.textContent = step.title
  description.textContent = step.description
  number.textContent = String(stepIndex + 1)
  progress.style.width = String(((stepIndex + 1) / steps.length) * 100) + '%'
  back.disabled = stepIndex === 0
  next.disabled = true
  next.textContent = stepIndex === steps.length - 1 ? 'Zakończ' : 'Dalej'
  options.replaceChildren(...step.options.map((label) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'oe-option'
    button.setAttribute('aria-pressed', 'false')
    button.innerHTML = '<span class="oe-option__radio" aria-hidden="true"></span><span></span>'
    button.lastElementChild.textContent = label
    button.addEventListener('click', () => {
      options.querySelectorAll('.oe-option').forEach(item => item.setAttribute('aria-pressed', 'false'))
      button.setAttribute('aria-pressed', 'true')
      selectedOption = label
      next.disabled = false
    })
    return button
  }))
}

back.addEventListener('click', () => {
  if (stepIndex > 0) {
    stepIndex -= 1
    renderStep()
  }
})

next.addEventListener('click', () => {
  if (!selectedOption) return
  if (stepIndex < steps.length - 1) {
    stepIndex += 1
    renderStep()
    return
  }
  title.textContent = 'Gotowe — masz plan rozmowy.'
  description.textContent = 'Zapisz swoje odpowiedzi i omów je z ekspertem OpenExpert.'
  options.innerHTML = '<p class="oe-lead">Dziękujemy. Ten prototyp nie zapisuje ani nie wysyła żadnych danych.</p>'
  back.disabled = true
  next.disabled = true
})

renderStep()`

function starterDraft(): DynamicContentDraft {
  return {
    title: DEFAULT_TITLE,
    html: STARTER_HTML,
    css: STARTER_CSS,
    javascript: STARTER_JAVASCRIPT,
  }
}

function blankDraft(): DynamicContentDraft {
  return {
    title: 'Nowa interaktywna strona',
    html: `<main class="page">
  <p class="eyebrow">OpenExpert</p>
  <h1>Nowa interaktywna strona</h1>
  <p>Edytuj kod albo opisz Eve, co chcesz zbudować.</p>
</main>`,
    css: `:root { font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #171918; background: #f4f5f3; }
* { box-sizing: border-box; }
body { min-height: 100vh; margin: 0; }
.page { width: min(100% - 32px, 960px); margin: 0 auto; padding: 64px 0; }
.eyebrow { color: #686d69; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
h1 { max-width: 720px; margin: 18px 0; font-size: clamp(40px, 7vw, 72px); line-height: 1; letter-spacing: -.055em; }`,
    javascript: '',
  }
}

const route = useRoute()
const toast = useToast()
const authenticatedUser = useAuthUser()
const draft = reactive<DynamicContentDraft>(starterDraft())
const previewFrame = ref<HTMLIFrameElement | null>(null)
const messagesContainer = ref<HTMLElement | null>(null)
const activeTab = ref<SourceTab>('html')
const studioView = ref<StudioView>('split')
const previewViewport = ref<PreviewViewport>('desktop')
const documentRevision = ref(0)
const hydrated = ref(false)
const composer = ref('')
const saveState = ref<'saved' | 'saving' | 'error'>('saved')
const lastSavedAt = ref<Date | null>(null)
const knowledgeDocumentId = ref<string | null>(null)
const knowledgeRevision = ref<number | null>(null)
const knowledgeSaving = ref(false)
const livePreview = ref(true)
const previewStatus = ref<PreviewStatus>('loading')
const previewRuntimeError = ref('')
const previewChannelId = ref('')
const previewSrcdoc = ref('')
const previewSource = shallowRef<DynamicContentSource>({ html: '', css: '', javascript: '' })
const previewBooted = ref(false)
const newProjectModalOpen = ref(false)
const evePanelOpen = ref(false)
const eveOverlayMode = ref(false)
const availability = ref<AssistantAvailability>('checking')
const availabilityMessage = ref('')
const activeClientContext = shallowRef<DynamicContentClientContext | null>(null)
const lastSubmittedPrompt = ref('')
const requestSnapshots = new Map<string, DynamicContentRequestSnapshot>()
const proposalDecisions = reactive<Record<string, ProposalDecision | undefined>>({})
let saveTimer: ReturnType<typeof setTimeout> | undefined
let previewTimer: ReturnType<typeof setTimeout> | undefined
let eveOverlayMediaQuery: MediaQueryList | undefined

const organizationSlug = computed(() => {
  const value = route.params.organizationSlug
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')
})
const storageKey = computed(() => (
  `openexpert:experiments:dynamic-content-editor:v1:${authenticatedUser.value?.id ?? 'anonymous'}:${organizationSlug.value}`
))
const assistantBusy = computed(() => status.value === 'submitted' || status.value === 'streaming')
const composerDisabled = computed(() => availability.value !== 'available' || assistantBusy.value)
const messages = computed(() => data.value.messages)
const currentSource = computed<DynamicContentSource>(() => ({
  html: draft.html,
  css: draft.css,
  javascript: draft.javascript,
}))
const sourceCharacterCount = computed(() => dynamicContentCharacterCount(currentSource.value))
const activeSource = computed<string>({
  get: () => {
    if (activeTab.value === 'html') return draft.html
    if (activeTab.value === 'css') return draft.css
    return draft.javascript
  },
  set: (value: string) => {
    if (activeTab.value === 'html') draft.html = value
    else if (activeTab.value === 'css') draft.css = value
    else draft.javascript = value
  },
})
const activeSourceLineCount = computed(() => activeSource.value.split('\n').length)
const activeSourceLabel = computed(() => sourceTabs.find(item => item.id === activeTab.value)?.label ?? 'Kod')
const previewStatusLabel = computed(() => {
  if (previewStatus.value === 'loading') return 'Uruchamiam…'
  if (previewStatus.value === 'error') return 'Błąd w podglądzie'
  return 'Podgląd gotowy'
})
const previewDeviceStyle = computed(() => {
  if (previewViewport.value === 'tablet') return { width: '820px', height: '900px' }
  if (previewViewport.value === 'mobile') return { width: '390px', height: '780px' }
  return { width: '100%', height: '100%' }
})
const saveStateLabel = computed(() => {
  if (saveState.value === 'saving') return 'Zapisuję lokalnie…'
  if (saveState.value === 'error') return 'Nie udało się zapisać'
  if (!lastSavedAt.value) return 'Szkic lokalny'
  return `Zapisano ${new Intl.DateTimeFormat('pl-PL', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(lastSavedAt.value)}`
})

const sourceTabs: { id: SourceTab, label: string, icon: string }[] = [
  { id: 'html', label: 'HTML', icon: 'i-lucide-file-code-2' },
  { id: 'css', label: 'CSS', icon: 'i-lucide-palette' },
  { id: 'javascript', label: 'JavaScript', icon: 'i-lucide-braces' },
]
const studioViews: { id: StudioView, label: string, icon: string }[] = [
  { id: 'source', label: 'Kod', icon: 'i-lucide-code-2' },
  { id: 'split', label: 'Podział', icon: 'i-lucide-columns-2' },
  { id: 'preview', label: 'Podgląd', icon: 'i-lucide-monitor' },
]
const previewViewports: { id: PreviewViewport, label: string, icon: string }[] = [
  { id: 'desktop', label: 'Desktop', icon: 'i-lucide-monitor' },
  { id: 'tablet', label: 'Tablet', icon: 'i-lucide-tablet' },
  { id: 'mobile', label: 'Telefon', icon: 'i-lucide-smartphone' },
]
const quickActions = [
  { label: 'Kalkulator', icon: 'i-lucide-calculator', prompt: 'Zbuduj prosty, dostępny kalkulator zdolności w stylu OpenExpert. Nie obiecuj wyniku banku i jasno oznacz wynik jako orientacyjny.' },
  { label: 'Proces krokowy', icon: 'i-lucide-list-checks', prompt: 'Przekształć stronę w interaktywny proces krok po kroku z paskiem postępu i responsywnym układem.' },
  { label: 'Dopracuj UI', icon: 'i-lucide-wand-sparkles', prompt: 'Dopracuj hierarchię, odstępy, responsywność i dostępność strony, zachowując styl OpenExpert i istniejące działanie.' },
]

function cloneSource(source: DynamicContentSource): DynamicContentSource {
  return { html: source.html, css: source.css, javascript: source.javascript }
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
    if (import.meta.dev) console.error('[experiments-dynamic-content-editor:eve]', caught)
    toast.add({
      title: 'Eve nie odpowiedziała',
      description: friendlyAssistantError(caught),
      color: 'error',
      icon: 'i-lucide-triangle-alert',
    })
  },
})

function createRequestContext(): DynamicContentClientContext | null {
  const source = currentSource.value
  if (!isDynamicContentWithinLimits(source)) {
    toast.add({
      title: 'Projekt jest zbyt duży dla Eve',
      description: 'Łączna długość HTML, CSS i JavaScript nie może przekraczać 60 000 znaków.',
      color: 'warning',
      icon: 'i-lucide-triangle-alert',
    })
    return null
  }

  const requestId = crypto.randomUUID()
  requestSnapshots.set(requestId, {
    requestId,
    documentRevision: documentRevision.value,
    base: cloneSource(source),
  })
  while (requestSnapshots.size > MAX_REQUEST_SNAPSHOTS) {
    const oldestRequestId = requestSnapshots.keys().next().value
    if (typeof oldestRequestId !== 'string') break
    requestSnapshots.delete(oldestRequestId)
  }

  return {
    surface: 'experiments-dynamic-content-editor',
    requestId,
    documentRevision: documentRevision.value,
    documentTitle: draft.title.trim() || DEFAULT_TITLE,
    document: {
      html: source.html,
      css: source.css,
      javascript: source.javascript,
    },
  }
}

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
    await send({ message: text })
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
  const sessionId = session.value.sessionId
  try {
    if (sessionId) {
      await $fetch(`/api/assistant/eve/v1/session/${encodeURIComponent(sessionId)}/cancel`, {
        method: 'POST',
        headers: await assistantHeaders(),
        body: {},
      })
    }
    if (!options.silent) {
      toast.add({ title: 'Zadanie zatrzymane', color: 'neutral', icon: 'i-lucide-square' })
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

function proposalFromPart(part: EveDynamicToolPart): DynamicContentProposal | null {
  if (part.toolName !== 'propose_dynamic_content_edit' || part.state !== 'output-available') return null
  const output = (part as EveDynamicToolPart & { output?: unknown }).output
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null
  const candidate = output as Record<string, unknown>
  if (
    typeof candidate.proposalId !== 'string'
    || typeof candidate.requestId !== 'string'
    || typeof candidate.documentRevision !== 'number'
    || !Number.isInteger(candidate.documentRevision)
    || typeof candidate.replacementHtml !== 'string'
    || typeof candidate.replacementCss !== 'string'
    || typeof candidate.replacementJavaScript !== 'string'
    || typeof candidate.summary !== 'string'
  ) return null

  const proposal = candidate as unknown as DynamicContentProposal
  return isDynamicContentWithinLimits({
    html: proposal.replacementHtml,
    css: proposal.replacementCss,
    javascript: proposal.replacementJavaScript,
  }) ? proposal : null
}

function messageProposalParts(message: EveMessage) {
  return message.parts
    .filter((part): part is EveDynamicToolPart => part.type === 'dynamic-tool')
    .map(part => ({ part, proposal: proposalFromPart(part) }))
    .filter((item): item is { part: EveDynamicToolPart, proposal: DynamicContentProposal } => Boolean(item.proposal))
}

function messageHasPendingProposal(message: EveMessage) {
  return message.parts.some(part => (
    part.type === 'dynamic-tool'
    && part.toolName === 'propose_dynamic_content_edit'
    && part.state !== 'output-available'
    && part.state !== 'output-error'
  ))
}

function messageHasFailedProposal(message: EveMessage) {
  return message.parts.some(part => (
    part.type === 'dynamic-tool'
    && part.toolName === 'propose_dynamic_content_edit'
    && part.state === 'output-error'
  ))
}

function proposalState(proposal: DynamicContentProposal): ProposalState {
  const decision = proposalDecisions[proposal.proposalId]
  if (decision) return decision
  const snapshot = requestSnapshots.get(proposal.requestId)
  if (!snapshot) return 'stale'
  if (snapshot.documentRevision !== proposal.documentRevision) return 'stale'
  if (documentRevision.value !== snapshot.documentRevision) return 'stale'
  if (
    draft.html !== snapshot.base.html
    || draft.css !== snapshot.base.css
    || draft.javascript !== snapshot.base.javascript
  ) return 'stale'
  return 'ready'
}

function proposalStateLabel(proposal: DynamicContentProposal) {
  const state = proposalState(proposal)
  if (state === 'applied') return 'Zastosowano'
  if (state === 'rejected') return 'Odrzucono'
  if (state === 'stale') return 'Nieaktualna'
  return 'Nowa wersja strony'
}

function proposalStateColor(proposal: DynamicContentProposal) {
  const state = proposalState(proposal)
  if (state === 'applied') return 'success' as const
  if (state === 'stale') return 'warning' as const
  if (state === 'rejected') return 'neutral' as const
  return 'primary' as const
}

function proposalSources(proposal: DynamicContentProposal) {
  return [
    { label: 'HTML', value: proposal.replacementHtml },
    { label: 'CSS', value: proposal.replacementCss },
    { label: 'JavaScript', value: proposal.replacementJavaScript },
  ]
}

function applyProposal(proposal: DynamicContentProposal) {
  if (proposalState(proposal) !== 'ready') return
  draft.html = proposal.replacementHtml
  draft.css = proposal.replacementCss
  draft.javascript = proposal.replacementJavaScript
  proposalDecisions[proposal.proposalId] = 'applied'
  requestSnapshots.delete(proposal.requestId)
  void nextTick().then(runPreview)
  toast.add({
    title: 'Propozycja Eve zastosowana',
    description: 'Wszystkie trzy źródła zostały podmienione atomowo.',
    color: 'success',
    icon: 'i-lucide-check',
  })
}

function rejectProposal(proposal: DynamicContentProposal) {
  if (proposalState(proposal) !== 'ready') return
  proposalDecisions[proposal.proposalId] = 'rejected'
  requestSnapshots.delete(proposal.requestId)
}

function scheduleSave() {
  if (!hydrated.value) return
  saveState.value = 'saving'
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveDraft, 450)
}

function saveDraft() {
  if (!hydrated.value) return
  try {
    const persisted: PersistedDraft = {
      schemaVersion: 1,
      title: draft.title.trim() || DEFAULT_TITLE,
      html: draft.html,
      css: draft.css,
      javascript: draft.javascript,
      updatedAt: new Date().toISOString(),
      knowledgeDocumentId: knowledgeDocumentId.value,
      knowledgeRevision: knowledgeRevision.value,
    }
    localStorage.setItem(storageKey.value, JSON.stringify(persisted))
    lastSavedAt.value = new Date(persisted.updatedAt)
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
    const persisted = JSON.parse(raw) as Partial<PersistedDraft>
    const source = {
      html: typeof persisted.html === 'string' ? persisted.html : '',
      css: typeof persisted.css === 'string' ? persisted.css : '',
      javascript: typeof persisted.javascript === 'string' ? persisted.javascript : '',
    }
    if (persisted.schemaVersion !== 1 || !isDynamicContentWithinLimits(source)) return
    draft.title = typeof persisted.title === 'string' && persisted.title.trim()
      ? persisted.title
      : DEFAULT_TITLE
    Object.assign(draft, source)
    if (typeof persisted.knowledgeDocumentId === 'string') {
      knowledgeDocumentId.value = persisted.knowledgeDocumentId
    }
    if (typeof persisted.knowledgeRevision === 'number' && persisted.knowledgeRevision >= 1) {
      knowledgeRevision.value = persisted.knowledgeRevision
    }
    if (typeof persisted.updatedAt === 'string') {
      const date = new Date(persisted.updatedAt)
      if (!Number.isNaN(date.getTime())) lastSavedAt.value = date
    }
  }
  catch {
    saveState.value = 'error'
  }
}

function schedulePreview() {
  if (!livePreview.value || !hydrated.value) return
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = setTimeout(runPreview, 500)
}

function runPreview() {
  if (!import.meta.client) return
  const source = currentSource.value
  if (!isDynamicContentWithinLimits(source)) {
    previewStatus.value = 'error'
    previewRuntimeError.value = 'Łączna długość źródeł przekracza limit 60 000 znaków.'
    return
  }

  try {
    const sanitizedSource: DynamicContentSource = {
      html: sanitizeDynamicContentHtml(source.html),
      css: source.css,
      javascript: source.javascript,
    }
    if (!isDynamicContentWithinLimits(sanitizedSource)) throw new RangeError('Zawartość przekracza limit.')
    previewSource.value = sanitizedSource
    previewRuntimeError.value = ''
    previewStatus.value = 'loading'
    previewBooted.value = false
    previewChannelId.value = crypto.randomUUID()
    previewSrcdoc.value = buildDynamicContentPreviewShell(previewChannelId.value, window.location.origin)
  }
  catch (caught) {
    previewStatus.value = 'error'
    previewRuntimeError.value = caught instanceof Error ? caught.message : 'Nie udało się przygotować podglądu.'
  }
}

function handlePreviewMessage(event: MessageEvent) {
  const contentWindow = previewFrame.value?.contentWindow
  if (!contentWindow || event.source !== contentWindow || event.origin !== 'null') return
  const message = parseDynamicContentPreviewMessage(event.data, previewChannelId.value)
  if (!message) return

  if (message.type === 'ready') {
    if (previewBooted.value) return
    try {
      previewBooted.value = true
      contentWindow.postMessage(
        buildDynamicContentBootMessage(previewChannelId.value, previewSource.value),
        '*',
      )
    }
    catch (caught) {
      previewBooted.value = false
      previewStatus.value = 'error'
      previewRuntimeError.value = caught instanceof Error ? caught.message : 'Nie udało się uruchomić podglądu.'
    }
    return
  }

  if (message.type === 'rendered') {
    previewStatus.value = 'ready'
    return
  }

  previewStatus.value = 'error'
  previewRuntimeError.value = message.message
}

async function copyActiveSource() {
  try {
    await navigator.clipboard.writeText(activeSource.value)
    toast.add({ title: `${activeSourceLabel.value} skopiowany`, color: 'success', icon: 'i-lucide-copy-check' })
  }
  catch {
    toast.add({ title: 'Nie udało się skopiować kodu', color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

async function saveToKnowledge() {
  if (knowledgeSaving.value) return
  const source = currentSource.value
  if (!isDynamicContentWithinLimits(source) || !source.html.trim()) {
    toast.add({
      title: 'Projekt nie jest gotowy do zapisu',
      description: 'Dodaj HTML i upewnij się, że źródło nie przekracza 60 000 znaków.',
      color: 'warning',
      icon: 'i-lucide-triangle-alert',
    })
    return
  }

  knowledgeSaving.value = true
  try {
    const body = {
      kind: 'dynamic_html',
      title: draft.title.trim() || DEFAULT_TITLE,
      htmlContent: source.html,
      cssContent: source.css,
      javascriptContent: source.javascript,
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
        ? 'Interaktywna strona jest dostępna we wspólnej wyszukiwarce.'
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

function createNewProject() {
  Object.assign(draft, blankDraft())
  knowledgeDocumentId.value = null
  knowledgeRevision.value = null
  newProjectModalOpen.value = false
  void newConversation()
  void nextTick().then(runPreview)
}

function syncEveOverlayMode(event: MediaQueryListEvent | MediaQueryList) {
  eveOverlayMode.value = event.matches
}

watch(() => [draft.html, draft.css, draft.javascript], (value, previous) => {
  if (!hydrated.value || value.every((part, index) => part === previous?.[index])) return
  documentRevision.value += 1
  scheduleSave()
  schedulePreview()
})
watch(() => draft.title, scheduleSave)
watch(livePreview, (enabled) => {
  if (enabled) runPreview()
})
watch([messages, status], async () => {
  await nextTick()
  if (messagesContainer.value) messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
}, { deep: true })

onMounted(() => {
  loadDraft()
  hydrated.value = true
  if (window.matchMedia('(max-width: 900px)').matches) studioView.value = 'preview'
  eveOverlayMediaQuery = window.matchMedia('(max-width: 1099px)')
  syncEveOverlayMode(eveOverlayMediaQuery)
  eveOverlayMediaQuery.addEventListener('change', syncEveOverlayMode)
  window.addEventListener('message', handlePreviewMessage)
  runPreview()
  void checkAssistantAvailability()
})

onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer)
  if (previewTimer) clearTimeout(previewTimer)
  eveOverlayMediaQuery?.removeEventListener('change', syncEveOverlayMode)
  window.removeEventListener('message', handlePreviewMessage)
  saveDraft()
})
</script>

<template>
  <section
    class="dynamic-content-studio"
    :class="`dynamic-content-studio--${studioView}`"
    :data-eve-open="evePanelOpen"
    aria-label="Eksperymentalny edytor dynamicznego contentu"
  >
    <div class="dynamic-studio-main">
      <header class="dynamic-commandbar">
        <div class="dynamic-project-title">
          <span class="dynamic-project-title__icon"><UIcon name="i-lucide-panels-top-left" /></span>
          <label>
            <span class="sr-only">Nazwa projektu</span>
            <input v-model="draft.title" type="text" maxlength="160" placeholder="Nazwa projektu">
            <small><span :class="`is-${saveState}`" />{{ saveStateLabel }}</small>
          </label>
        </div>

        <div class="dynamic-view-switcher" aria-label="Układ edytora">
          <UButton
            v-for="view in studioViews"
            :key="view.id"
            color="neutral"
            :variant="studioView === view.id ? 'soft' : 'ghost'"
            size="xs"
            :icon="view.icon"
            :label="view.label"
            :aria-label="view.label"
            @click="studioView = view.id"
          />
        </div>

        <div class="dynamic-commandbar__actions">
          <UButton
            color="neutral"
            variant="soft"
            icon="i-lucide-library-big"
            :label="knowledgeDocumentId ? 'Aktualizuj wiedzę' : 'Zapisz w Wiedzy'"
            :loading="knowledgeSaving"
            @click="saveToKnowledge"
          />
          <UButton
            class="dynamic-eve-toggle"
            color="primary"
            variant="soft"
            icon="i-lucide-sparkles"
            label="Eve"
            @click="evePanelOpen = true"
          />
          <UTooltip text="Nowy projekt">
            <UButton
              color="neutral"
              variant="ghost"
              icon="i-lucide-file-plus-2"
              aria-label="Nowy projekt"
              @click="newProjectModalOpen = true"
            />
          </UTooltip>
        </div>
      </header>

      <div class="dynamic-workspace">
        <section class="dynamic-source-panel" aria-label="Źródła strony">
          <header class="dynamic-panelbar">
            <nav class="dynamic-source-tabs" aria-label="Rodzaj źródła">
              <button
                v-for="tab in sourceTabs"
                :key="tab.id"
                type="button"
                :aria-current="activeTab === tab.id ? 'page' : undefined"
                @click="activeTab = tab.id"
              >
                <UIcon :name="tab.icon" />{{ tab.label }}
              </button>
            </nav>
            <UTooltip :text="`Kopiuj ${activeSourceLabel}`">
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-copy"
                :aria-label="`Kopiuj ${activeSourceLabel}`"
                @click="copyActiveSource"
              />
            </UTooltip>
          </header>

          <textarea
            v-model="activeSource"
            class="dynamic-code-editor"
            :aria-label="`Kod ${activeSourceLabel}`"
            :spellcheck="false"
            autocapitalize="off"
            autocomplete="off"
          />

          <footer class="dynamic-source-footer">
            <span>{{ activeSourceLineCount }} linii · {{ activeSource.length.toLocaleString('pl-PL') }} znaków</span>
            <span>{{ sourceCharacterCount.toLocaleString('pl-PL') }} / 60 000 łącznie</span>
          </footer>
        </section>

        <section class="dynamic-preview-panel" aria-label="Podgląd interaktywnej strony">
          <header class="dynamic-panelbar dynamic-preview-toolbar">
            <div class="dynamic-viewport-switcher" aria-label="Rozmiar podglądu">
              <UTooltip v-for="viewport in previewViewports" :key="viewport.id" :text="viewport.label">
                <UButton
                  color="neutral"
                  :variant="previewViewport === viewport.id ? 'soft' : 'ghost'"
                  size="xs"
                  :icon="viewport.icon"
                  :aria-label="viewport.label"
                  @click="previewViewport = viewport.id"
                />
              </UTooltip>
            </div>
            <div class="dynamic-preview-toolbar__actions">
              <UBadge
                :color="previewStatus === 'error' ? 'error' : previewStatus === 'ready' ? 'success' : 'neutral'"
                variant="subtle"
                size="sm"
              >
                {{ previewStatusLabel }}
              </UBadge>
              <UButton
                color="neutral"
                :variant="livePreview ? 'soft' : 'ghost'"
                size="xs"
                icon="i-lucide-bolt"
                :aria-pressed="livePreview"
                aria-label="Automatyczny podgląd"
                @click="livePreview = !livePreview"
              />
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-refresh-cw"
                aria-label="Uruchom podgląd ponownie"
                @click="runPreview"
              />
            </div>
          </header>

          <div class="dynamic-preview-canvas" :class="`is-${previewViewport}`">
            <div class="dynamic-preview-device" :style="previewDeviceStyle">
              <iframe
                v-if="previewSrcdoc"
                ref="previewFrame"
                :srcdoc="previewSrcdoc"
                :sandbox="DYNAMIC_CONTENT_IFRAME_SANDBOX"
                credentialless
                allow=""
                referrerpolicy="no-referrer"
                title="Izolowany podgląd interaktywnej strony"
              />
              <div v-else class="dynamic-preview-placeholder">
                <UIcon name="i-lucide-loader-circle" />
                Przygotowuję izolowany podgląd…
              </div>
            </div>
          </div>

          <UAlert
            v-if="previewRuntimeError"
            class="dynamic-preview-error"
            color="error"
            variant="subtle"
            icon="i-lucide-bug"
            title="JavaScript zgłosił błąd"
            :description="previewRuntimeError"
          />
          <footer class="dynamic-preview-safety">
            <UIcon name="i-lucide-shield-check" />
            Izolowany podgląd bez dostępu do CRM i sieci. Nie wpisuj danych wrażliwych.
          </footer>
        </section>
      </div>
    </div>

    <button
      v-if="evePanelOpen"
      class="dynamic-eve-backdrop"
      type="button"
      tabindex="-1"
      aria-label="Zamknij panel Eve"
      @click="evePanelOpen = false"
    />

    <aside
      class="dynamic-eve-panel"
      aria-label="Eve — partner przy dynamicznym contencie"
      :aria-hidden="eveOverlayMode && !evePanelOpen ? 'true' : undefined"
      :inert="eveOverlayMode && !evePanelOpen"
    >
      <header class="dynamic-eve-panel__header">
        <span class="dynamic-eve-panel__identity">
          <span><UIcon name="i-lucide-sparkles" /></span>
          <span><strong>Eve</strong><small>Projektant interakcji</small></span>
        </span>
        <div class="dynamic-eve-panel__header-actions">
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
            class="dynamic-eve-panel__close"
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-lucide-x"
            aria-label="Zamknij Eve"
            @click="evePanelOpen = false"
          />
        </div>
      </header>

      <div class="dynamic-eve-panel__context">
        <UIcon name="i-lucide-code-xml" />
        Eve widzi HTML, CSS i JavaScript dopiero przy wysyłaniu
      </div>

      <div
        ref="messagesContainer"
        class="dynamic-eve-panel__messages"
        role="log"
        aria-live="polite"
        :aria-busy="assistantBusy"
      >
        <div v-if="!messages.length" class="dynamic-eve-empty">
          <span class="dynamic-eve-empty__icon"><UIcon name="i-lucide-blocks" /></span>
          <div>
            <h2>Zbuduj interaktywną stronę z Eve</h2>
            <p>Opisz efekt. Eve przygotuje kompletną propozycję HTML, CSS i JavaScript — zastosujesz ją dopiero po sprawdzeniu.</p>
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

          <div v-else class="dynamic-eve-empty__actions">
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
          class="dynamic-eve-message"
          :class="`dynamic-eve-message--${message.role}`"
        >
          <span class="dynamic-eve-message__avatar" aria-hidden="true">
            <UIcon :name="message.role === 'assistant' ? 'i-lucide-sparkles' : 'i-lucide-user-round'" />
          </span>
          <div class="dynamic-eve-message__body">
            <strong>{{ message.role === 'assistant' ? 'Eve' : 'Ty' }}</strong>
            <p v-for="(part, index) in messageTextParts(message)" :key="`${message.id}:text:${index}`">
              {{ part.text }}
            </p>

            <div v-if="messageHasPendingProposal(message)" class="dynamic-eve-working">
              <UIcon name="i-lucide-loader-circle" /> Przygotowuję stronę…
            </div>
            <UAlert
              v-if="messageHasFailedProposal(message)"
              color="error"
              variant="subtle"
              icon="i-lucide-circle-alert"
              title="Nie udało się przygotować propozycji"
              description="Kod projektu nie został zmieniony."
            />

            <section
              v-for="{ part, proposal } in messageProposalParts(message)"
              :key="part.toolCallId"
              class="dynamic-proposal"
            >
              <header>
                <span><UIcon name="i-lucide-panels-top-left" /><strong>Propozycja strony</strong></span>
                <UBadge :color="proposalStateColor(proposal)" variant="subtle" size="sm">
                  {{ proposalStateLabel(proposal) }}
                </UBadge>
              </header>
              <p>{{ proposal.summary }}</p>
              <div class="dynamic-proposal__files">
                <details v-for="source in proposalSources(proposal)" :key="source.label">
                  <summary>{{ source.label }} <span>{{ source.value.length.toLocaleString('pl-PL') }} znaków</span></summary>
                  <pre>{{ source.value }}</pre>
                </details>
              </div>
              <UAlert
                v-if="proposalState(proposal) === 'stale'"
                color="warning"
                variant="subtle"
                icon="i-lucide-history"
                title="Projekt zmienił się od czasu tej propozycji"
                description="Poproś Eve o przygotowanie nowej wersji."
              />
              <div v-if="proposalState(proposal) === 'ready'" class="dynamic-proposal__actions">
                <UButton color="primary" icon="i-lucide-check" label="Zastosuj" @click="applyProposal(proposal)" />
                <UButton color="neutral" variant="ghost" label="Odrzuć" @click="rejectProposal(proposal)" />
              </div>
            </section>
          </div>
        </article>

        <div v-if="assistantBusy && messages.length" class="dynamic-eve-typing" aria-label="Eve pisze">
          <span /><span /><span />
        </div>
      </div>

      <footer class="dynamic-eve-panel__composer">
        <div class="dynamic-eve-panel__quick-actions">
          <button
            v-for="action in quickActions"
            :key="action.label"
            type="button"
            :disabled="composerDisabled"
            @click="sendMessage(action.prompt)"
          >
            <UIcon :name="action.icon" />{{ action.label }}
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
              : 'Co zbudować lub zmienić?'"
          @submit="submitComposer"
        >
          <template #footer>
            <div class="dynamic-eve-composer-footer">
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
      v-model:open="newProjectModalOpen"
      title="Utworzyć nowy projekt?"
      description="Bieżący lokalny szkic HTML, CSS i JavaScript zostanie zastąpiony."
      :ui="{ footer: 'justify-end' }"
    >
      <template #body>
        <UAlert
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="Bieżąca wersja zostanie usunięta z tego edytora"
          description="Skopiuj potrzebne źródła przed rozpoczęciem nowego projektu."
        />
      </template>
      <template #footer="{ close }">
        <UButton color="neutral" variant="ghost" @click="close">Anuluj</UButton>
        <UButton color="error" icon="i-lucide-file-plus-2" @click="createNewProject">Nowy projekt</UButton>
      </template>
    </UModal>
  </section>
</template>

<style scoped>
.dynamic-content-studio {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) clamp(350px, 28vw, 430px);
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-top: 1px solid var(--ui-border);
  background: var(--ui-bg-muted);
}

.dynamic-studio-main,
.dynamic-source-panel,
.dynamic-preview-panel,
.dynamic-eve-panel {
  min-width: 0;
  min-height: 0;
}

.dynamic-studio-main { display: flex; flex-direction: column; }

.dynamic-commandbar {
  position: relative;
  z-index: 4;
  display: grid;
  grid-template-columns: minmax(220px, 1fr) auto minmax(110px, 1fr);
  align-items: center;
  gap: 14px;
  min-height: 60px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--ui-border);
  background: color-mix(in srgb, var(--ui-bg) 95%, transparent);
  backdrop-filter: blur(14px);
}

.dynamic-project-title { display: flex; min-width: 0; align-items: center; gap: 10px; }
.dynamic-project-title__icon {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-highlighted);
}
.dynamic-project-title label { display: grid; min-width: 0; }
.dynamic-project-title input {
  width: min(100%, 360px);
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 700;
}
.dynamic-project-title small { display: inline-flex; align-items: center; gap: 6px; color: var(--ui-text-dimmed); font-size: 9px; }
.dynamic-project-title small span { width: 6px; height: 6px; border-radius: 50%; background: var(--ui-success); }
.dynamic-project-title small span.is-saving { background: var(--ui-warning); }
.dynamic-project-title small span.is-error { background: var(--ui-error); }
.dynamic-view-switcher,
.dynamic-commandbar__actions,
.dynamic-preview-toolbar__actions,
.dynamic-viewport-switcher { display: flex; align-items: center; }
.dynamic-view-switcher { gap: 2px; padding: 3px; border: 1px solid var(--ui-border-muted); border-radius: 9px; background: var(--ui-bg-muted); }
.dynamic-commandbar__actions { justify-content: flex-end; gap: 2px; }
.dynamic-eve-toggle { display: none; }

.dynamic-workspace {
  display: grid;
  grid-template-columns: minmax(320px, .78fr) minmax(420px, 1.22fr);
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.dynamic-content-studio--source .dynamic-workspace { grid-template-columns: minmax(0, 1fr); }
.dynamic-content-studio--source .dynamic-preview-panel { display: none; }
.dynamic-content-studio--preview .dynamic-workspace { grid-template-columns: minmax(0, 1fr); }
.dynamic-content-studio--preview .dynamic-source-panel { display: none; }

.dynamic-source-panel,
.dynamic-preview-panel { display: flex; flex-direction: column; background: var(--ui-bg); }
.dynamic-source-panel { border-right: 1px solid var(--ui-border); }
.dynamic-panelbar {
  display: flex;
  min-height: 44px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 9px;
  border-bottom: 1px solid var(--ui-border);
  background: var(--ui-bg);
}
.dynamic-source-tabs { display: flex; min-width: 0; gap: 2px; }
.dynamic-source-tabs button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 30px;
  padding: 0 9px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--ui-text-muted);
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
}
.dynamic-source-tabs button:hover { color: var(--ui-text-highlighted); }
.dynamic-source-tabs button[aria-current="page"] { background: var(--ui-bg-muted); color: var(--ui-text-highlighted); }
.dynamic-code-editor {
  width: 100%;
  min-height: 0;
  flex: 1;
  resize: none;
  border: 0;
  outline: 0;
  padding: 18px;
  background: color-mix(in srgb, var(--ui-bg) 97%, var(--ui-bg-muted));
  color: var(--ui-text);
  caret-color: var(--ui-primary);
  font: 12px/1.72 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  tab-size: 2;
}
.dynamic-code-editor:focus { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ui-primary) 45%, transparent); }
.dynamic-source-footer,
.dynamic-preview-safety {
  display: flex;
  min-height: 32px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 11px;
  border-top: 1px solid var(--ui-border-muted);
  color: var(--ui-text-dimmed);
  font-size: 9px;
}

.dynamic-preview-toolbar__actions { gap: 3px; }
.dynamic-viewport-switcher { gap: 1px; }
.dynamic-preview-canvas {
  display: grid;
  min-height: 0;
  flex: 1;
  place-items: stretch;
  overflow: auto;
  padding: 14px;
  background-color: var(--ui-bg-muted);
  background-image: radial-gradient(color-mix(in srgb, var(--ui-border-accented) 55%, transparent) .7px, transparent .7px);
  background-size: 12px 12px;
}
.dynamic-preview-canvas.is-tablet,
.dynamic-preview-canvas.is-mobile { place-items: start center; }
.dynamic-preview-device {
  position: relative;
  min-width: 280px;
  min-height: 360px;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 16px 42px rgb(15 23 42 / 10%);
}
.dynamic-preview-canvas.is-mobile .dynamic-preview-device { border-radius: 22px; }
.dynamic-preview-device iframe { display: block; width: 100%; height: 100%; border: 0; background: #fff; }
.dynamic-preview-placeholder { display: flex; height: 100%; align-items: center; justify-content: center; gap: 8px; color: var(--ui-text-muted); font-size: 11px; }
.dynamic-preview-placeholder svg { animation: dynamic-spin 1s linear infinite; }
.dynamic-preview-error { margin: 8px 10px 0; }
.dynamic-preview-safety { justify-content: center; }
.dynamic-preview-safety svg { color: var(--ui-success); }

.dynamic-eve-panel {
  position: relative;
  z-index: 6;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--ui-border);
  background: var(--ui-bg);
}
.dynamic-eve-panel__header { display: flex; min-height: 60px; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; border-bottom: 1px solid var(--ui-border); }
.dynamic-eve-panel__identity,
.dynamic-eve-panel__header-actions { display: flex; align-items: center; }
.dynamic-eve-panel__identity { gap: 10px; }
.dynamic-eve-panel__identity > span:first-child { display: grid; width: 34px; height: 34px; place-items: center; border: 1px solid color-mix(in srgb, var(--ui-primary) 30%, var(--ui-border)); border-radius: 10px; background: color-mix(in srgb, var(--ui-primary) 10%, var(--ui-bg)); color: var(--ui-primary); }
.dynamic-eve-panel__identity > span:last-child { display: grid; }
.dynamic-eve-panel__identity strong { color: var(--ui-text-highlighted); font-size: 13px; }
.dynamic-eve-panel__identity small { color: var(--ui-text-muted); font-size: 10px; }
.dynamic-eve-panel__header-actions { gap: 2px; }
.dynamic-eve-panel__close { display: none; }
.dynamic-eve-panel__context { display: flex; align-items: center; gap: 7px; padding: 8px 14px; border-bottom: 1px solid var(--ui-border-muted); background: var(--ui-bg-muted); color: var(--ui-text-muted); font-size: 10px; }
.dynamic-eve-panel__context svg { flex: 0 0 auto; color: var(--ui-primary); }
.dynamic-eve-panel__messages { min-height: 0; flex: 1; overflow-y: auto; padding: 18px 14px 28px; scrollbar-gutter: stable; }
.dynamic-eve-empty { display: grid; gap: 18px; align-content: center; min-height: 100%; padding: 28px 12px; text-align: center; }
.dynamic-eve-empty__icon { display: grid; width: 50px; height: 50px; place-items: center; margin: 0 auto; border: 1px solid var(--ui-border); border-radius: 16px; background: var(--ui-bg-muted); color: var(--ui-primary); font-size: 21px; }
.dynamic-eve-empty h2 { margin: 0 0 7px; color: var(--ui-text-highlighted); font-size: 17px; }
.dynamic-eve-empty p { margin: 0; color: var(--ui-text-muted); font-size: 12px; line-height: 1.6; }
.dynamic-eve-empty__actions { display: grid; gap: 8px; }
.dynamic-eve-message { display: grid; grid-template-columns: 29px minmax(0, 1fr); gap: 9px; margin-bottom: 20px; }
.dynamic-eve-message--user { grid-template-columns: minmax(0, 1fr) 29px; }
.dynamic-eve-message--user .dynamic-eve-message__avatar { grid-column: 2; grid-row: 1; }
.dynamic-eve-message--user .dynamic-eve-message__body { grid-column: 1; grid-row: 1; justify-self: end; border-radius: 14px 14px 4px; background: color-mix(in srgb, var(--ui-primary) 10%, var(--ui-bg)); }
.dynamic-eve-message__avatar { display: grid; width: 29px; height: 29px; place-items: center; border: 1px solid var(--ui-border); border-radius: 9px; background: var(--ui-bg-muted); color: var(--ui-text-muted); font-size: 13px; }
.dynamic-eve-message--assistant .dynamic-eve-message__avatar { color: var(--ui-primary); }
.dynamic-eve-message__body { display: grid; gap: 8px; min-width: 0; padding: 9px 11px; border-radius: 4px 14px 14px; background: var(--ui-bg-muted); }
.dynamic-eve-message__body > strong { color: var(--ui-text-highlighted); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
.dynamic-eve-message__body > p { margin: 0; color: var(--ui-text); font-size: 12px; line-height: 1.65; white-space: pre-wrap; }
.dynamic-eve-working { display: flex; align-items: center; gap: 7px; color: var(--ui-text-muted); font-size: 11px; }
.dynamic-eve-working svg { animation: dynamic-spin 1s linear infinite; }
.dynamic-proposal { display: grid; gap: 10px; margin-top: 3px; padding: 12px; border: 1px solid color-mix(in srgb, var(--ui-primary) 24%, var(--ui-border)); border-radius: 12px; background: var(--ui-bg); }
.dynamic-proposal header,
.dynamic-proposal header > span,
.dynamic-proposal__actions { display: flex; align-items: center; }
.dynamic-proposal header { justify-content: space-between; gap: 8px; }
.dynamic-proposal header > span { gap: 6px; color: var(--ui-primary); font-size: 11px; }
.dynamic-proposal > p { margin: 0; color: var(--ui-text); font-size: 12px; line-height: 1.5; }
.dynamic-proposal__files { display: grid; gap: 5px; }
.dynamic-proposal details { overflow: hidden; border: 1px solid var(--ui-border-muted); border-radius: 8px; }
.dynamic-proposal summary { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 9px; color: var(--ui-text-toned); font-size: 10px; font-weight: 700; cursor: pointer; }
.dynamic-proposal summary span { color: var(--ui-text-dimmed); font-weight: 500; }
.dynamic-proposal pre { overflow: auto; max-height: 230px; margin: 0; padding: 10px; border-top: 1px solid var(--ui-border-muted); background: var(--ui-bg-muted); color: var(--ui-text-muted); font: 9px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre; }
.dynamic-proposal__actions { justify-content: flex-end; gap: 5px; }
.dynamic-eve-typing { display: flex; gap: 4px; width: fit-content; padding: 10px 12px; border-radius: 12px; background: var(--ui-bg-muted); }
.dynamic-eve-typing span { width: 5px; height: 5px; border-radius: 50%; background: var(--ui-text-dimmed); animation: dynamic-pulse 1.2s ease-in-out infinite; }
.dynamic-eve-typing span:nth-child(2) { animation-delay: 120ms; }
.dynamic-eve-typing span:nth-child(3) { animation-delay: 240ms; }
.dynamic-eve-panel__composer { padding: 9px 11px 12px; border-top: 1px solid var(--ui-border); background: var(--ui-bg); }
.dynamic-eve-panel__quick-actions { display: flex; gap: 5px; overflow-x: auto; margin: 0 2px 8px; scrollbar-width: none; }
.dynamic-eve-panel__quick-actions::-webkit-scrollbar { display: none; }
.dynamic-eve-panel__quick-actions button { display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto; padding: 5px 8px; border: 1px solid var(--ui-border); border-radius: 999px; background: transparent; color: var(--ui-text-muted); font-size: 10px; cursor: pointer; }
.dynamic-eve-panel__quick-actions button:hover:not(:disabled) { border-color: color-mix(in srgb, var(--ui-primary) 35%, var(--ui-border)); color: var(--ui-primary); }
.dynamic-eve-panel__quick-actions button:disabled { cursor: not-allowed; opacity: .45; }
.dynamic-eve-composer-footer { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 10px; }
.dynamic-eve-composer-footer > span { display: inline-flex; align-items: center; gap: 5px; color: var(--ui-text-dimmed); font-size: 9px; }
.dynamic-eve-backdrop { display: none; }

@keyframes dynamic-spin { to { transform: rotate(360deg); } }
@keyframes dynamic-pulse { 0%, 60%, 100% { opacity: .35; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-2px); } }

@media (max-width: 1280px) {
  .dynamic-workspace { grid-template-columns: minmax(300px, .72fr) minmax(360px, 1.28fr); }
  .dynamic-view-switcher :deep(button span:not([data-slot="leadingIcon"])) { display: none; }
}

@media (max-width: 1099px) {
  .dynamic-content-studio { grid-template-columns: minmax(0, 1fr); }
  .dynamic-eve-toggle { display: inline-flex; }
  .dynamic-eve-panel { position: absolute; inset: 0 0 0 auto; width: min(440px, calc(100% - 38px)); transform: translateX(102%); transition: transform 180ms ease; }
  .dynamic-content-studio[data-eve-open="true"] .dynamic-eve-panel { transform: translateX(0); }
  .dynamic-eve-panel__close { display: inline-flex; }
  .dynamic-eve-backdrop { position: absolute; z-index: 5; inset: 0; display: block; border: 0; background: rgb(15 23 42 / 38%); backdrop-filter: blur(2px); }
}

@media (max-width: 900px) {
  .dynamic-commandbar { grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
  .dynamic-view-switcher { position: absolute; left: 50%; bottom: -42px; z-index: 8; transform: translateX(-50%); box-shadow: 0 8px 24px rgb(15 23 42 / 10%); }
  .dynamic-workspace { grid-template-columns: minmax(0, 1fr); }
  .dynamic-content-studio--split .dynamic-source-panel { display: none; }
  .dynamic-content-studio--split .dynamic-preview-panel { display: flex; }
  .dynamic-panelbar { padding-top: 45px; }
  .dynamic-source-panel .dynamic-panelbar { padding-top: 45px; }
}

@media (max-width: 560px) {
  .dynamic-commandbar { padding-inline: 10px; }
  .dynamic-project-title__icon { display: none; }
  .dynamic-project-title input { max-width: 190px; }
  .dynamic-view-switcher :deep(button span:not([data-slot="leadingIcon"])) { display: none; }
  .dynamic-source-tabs button { padding-inline: 7px; }
  .dynamic-preview-canvas { padding: 8px; }
  .dynamic-preview-toolbar .dynamic-viewport-switcher { display: none; }
  .dynamic-preview-safety { justify-content: flex-start; }
  .dynamic-eve-panel { width: 100%; }
}

@media (prefers-reduced-motion: reduce) {
  .dynamic-eve-panel,
  .dynamic-eve-working svg,
  .dynamic-eve-typing span,
  .dynamic-preview-placeholder svg { animation: none; transition: none; }
}
</style>
