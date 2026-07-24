<script setup lang="ts">
import type { InputResponse } from 'eve/client'
import type {
  EveAuthorizationPart,
  EveDynamicToolPart,
  EveMessage,
  EveMessagePart,
  UseEveAgentStatus,
} from 'eve/vue'

type ActionPart = EveAuthorizationPart | EveDynamicToolPart
type AssistantAvailability = 'available' | 'checking' | 'unavailable'

interface ActionSegmentItem {
  part: ActionPart
  position: number
}

type MessageSegment =
  | { id: string, type: 'actions', items: ActionSegmentItem[] }
  | { id: string, type: 'files', parts: Extract<EveMessagePart, { type: 'file' }>[] }
  | { id: string, type: 'reasoning-status' }
  | { id: string, type: 'text', parts: Extract<EveMessagePart, { type: 'text' }>[] }

interface ReadinessResult {
  caseUrl: string
  missingDocuments: string[]
  nextSteps: string[]
  percent: number
}

const props = withDefaults(defineProps<{
  availability?: AssistantAvailability
  availabilityMessage?: string
  demo?: boolean
  error?: { message?: string } | null
  messages: readonly EveMessage[]
  presentation?: 'page' | 'slideover'
  status: UseEveAgentStatus
}>(), {
  availability: 'available',
  availabilityMessage: '',
  demo: false,
  error: null,
  presentation: 'slideover',
})

const emit = defineEmits<{
  background: []
  inputResponses: [responses: readonly InputResponse[]]
  reset: []
  retry: []
  send: [message: string]
  stop: []
}>()

const toast = useToast()
const draft = ref('')
const composerForm = ref<HTMLFormElement | null>(null)
const messagesContainer = ref<HTMLElement | null>(null)
const shouldFollowLatest = ref(true)
const planOpenByMessage = reactive<Record<string, boolean>>({})
const selectedResponses = reactive<Record<string, InputResponse | undefined>>({})
const { orgPath } = useOrganizationContext()

const suggestions = [
  'Pokaż moje sprawy i wskaż te wymagające uwagi',
  'Sprawdź kompletność dokumentów w aktywnej sprawie',
  'Przygotuj kolejne kroki dla kredytu hipotecznego',
]

const demoMessages: readonly EveMessage[] = [
  {
    id: 'demo-user',
    role: 'user',
    metadata: { status: 'submitted' },
    parts: [{
      type: 'text',
      state: 'done',
      text: 'Sprawdź gotowość sprawy Anny Kowalskiej i przygotuj kolejne kroki.',
    }],
  },
  {
    id: 'demo-assistant',
    role: 'assistant',
    metadata: { status: 'streaming', turnId: 'demo-turn' },
    parts: [
      {
        type: 'text',
        state: 'done',
        text: 'Aby sprawdzić gotowość sprawy, wykonam kolejno: znajdę sprawę w CRM, sprawdzę dokumenty, porównam oferty i przygotuję podsumowanie.',
      },
      { type: 'step-start' },
      {
        type: 'dynamic-tool',
        toolCallId: 'demo-cases',
        toolName: 'list_user_cases',
        state: 'output-available',
        input: { scope: 'mine', query: 'Anna Kowalska', limit: 10 },
        output: {
          total: 1,
          cases: [{ title: 'Anna Kowalska — kredyt hipoteczny' }],
          readiness: {
            percent: 73,
            missingDocuments: ['Zaświadczenie o zarobkach', 'Polisa ubezpieczeniowa'],
            nextSteps: [
              'Poprosić klientkę o brakujące dokumenty',
              'Porównać oferty banków',
              'Przygotować symulację warunków kredytu',
            ],
            caseUrl: '/cases',
          },
        },
        toolMetadata: { eve: { kind: 'tool-call', name: 'list_user_cases' } },
      },
      { type: 'step-start' },
      {
        type: 'dynamic-tool',
        toolCallId: 'demo-documents',
        toolName: 'check_case_documents',
        state: 'input-available',
        input: { clientName: 'Anna Kowalska', caseTitle: 'Kredyt hipoteczny' },
        toolMetadata: { eve: { kind: 'tool-call', name: 'check_case_documents' } },
      },
      { type: 'step-start' },
      {
        type: 'dynamic-tool',
        toolCallId: 'demo-offers',
        toolName: 'compare_mortgage_offers',
        state: 'input-streaming',
        input: { clientName: 'Anna Kowalska' },
        toolMetadata: { eve: { kind: 'tool-call', name: 'compare_mortgage_offers' } },
      },
      { type: 'step-start' },
      {
        type: 'dynamic-tool',
        toolCallId: 'demo-note',
        toolName: 'add_case_note',
        state: 'approval-requested',
        input: {
          clientName: 'Anna Kowalska',
          summary: 'Gotowość sprawy 73%. Brakuje dwóch dokumentów.',
        },
        approval: { id: 'demo-approval' },
        toolMetadata: {
          eve: {
            kind: 'tool-call',
            name: 'add_case_note',
            inputRequest: {
              requestId: 'demo-approval',
              prompt: 'Dodać notatkę do sprawy?',
              display: 'confirmation',
              options: [
                { id: 'deny', label: 'Odrzuć', style: 'default' },
                { id: 'approve', label: 'Zatwierdź', style: 'primary' },
              ],
            },
          },
        },
      },
    ],
  },
]

const visibleMessages = computed(() => (
  props.demo && props.messages.length === 0 ? demoMessages : props.messages
))
const readinessResults = computed(() => new Map(
  visibleMessages.value.map(message => [message.id, readinessResult(message)] as const),
))

const isTransportBusy = computed(() => props.status === 'submitted' || props.status === 'streaming')
const visibleActionParts = computed(() => visibleMessages.value.flatMap(message => (
  message.parts.filter((part): part is ActionPart => (
    part.type === 'dynamic-tool' || part.type === 'authorization'
  ))
)))
const pendingTools = computed(() => visibleActionParts.value.filter((part): part is EveDynamicToolPart => (
  part.type === 'dynamic-tool'
  && part.state === 'approval-requested'
  && Boolean(part.toolMetadata?.eve?.inputRequest)
)))
const pendingRequests = computed(() => pendingTools.value.flatMap((part) => {
  const request = part.toolMetadata?.eve?.inputRequest
  return request ? [{ part, request }] : []
}))
const authorizationRequired = computed(() => visibleActionParts.value.some(part => (
  part.type === 'authorization' && part.state === 'required'
)))
const hasBlockingInteraction = computed(() => pendingRequests.value.length > 0 || authorizationRequired.value)
const isVisuallyBusy = computed(() => props.demo || isTransportBusy.value)
const assistantReady = computed(() => props.demo || props.availability === 'available')
const composerDisabled = computed(() => !assistantReady.value || isTransportBusy.value || hasBlockingInteraction.value)
const batchReady = computed(() => (
  pendingRequests.value.length > 1
  && pendingRequests.value.every(({ request }) => Boolean(selectedResponses[request.requestId]))
))
const selectedResponseCount = computed(() => pendingRequests.value.filter(({ request }) => (
  Boolean(selectedResponses[request.requestId])
)).length)

const statusLabel = computed(() => {
  if (props.availability === 'checking') return 'Sprawdzam połączenie…'
  if (props.availability === 'unavailable') return 'Model niedostępny'
  if (authorizationRequired.value) return 'Wymaga połączenia'
  if (pendingRequests.value.length) return 'Czeka na decyzję'
  if (props.status === 'submitted') return 'Uruchamiam zadanie…'
  if (props.status === 'streaming' || props.demo) return 'Agent pracuje…'
  if (props.status === 'error') return 'Wymaga uwagi'
  return 'Gotowy'
})

const statusTone = computed(() => {
  if (props.status === 'error' || props.availability === 'unavailable') return 'error'
  if (hasBlockingInteraction.value) return 'warning'
  if (isVisuallyBusy.value) return 'success'
  return 'neutral'
})

const composerPlaceholder = computed(() => {
  if (props.availability === 'checking') return 'Sprawdzam połączenie z modelem AI…'
  if (props.availability === 'unavailable') return 'Agent będzie dostępny po skonfigurowaniu modelu AI'
  if (hasBlockingInteraction.value) return 'Najpierw odpowiedz na decyzję powyżej…'
  return 'Napisz, co agent ma zrobić…'
})

function friendlyAssistantError(caught: { message?: string } | null | undefined) {
  const message = caught?.message?.trim() ?? ''
  if (/AI Gateway|API[_ ]?KEY|VERCEL_OIDC_TOKEN|credentials/iu.test(message)) {
    return 'Asystent nie jest jeszcze połączony z modelem AI. Skontaktuj się z administratorem.'
  }
  if (/Sesja CRM wygasła|Zaloguj się/iu.test(message)) {
    return 'Sesja CRM wygasła. Zaloguj się ponownie.'
  }
  if (/Nie wybrano organizacji/iu.test(message)) {
    return 'Wybierz organizację CRM i spróbuj ponownie.'
  }
  if (/fetch|network|ECONN/iu.test(message)) {
    return 'Nie udało się połączyć z asystentem. Sprawdź połączenie i spróbuj ponownie.'
  }
  return 'Asystent jest chwilowo niedostępny. Spróbuj ponownie.'
}

function messageSegments(message: EveMessage): MessageSegment[] {
  const segments: MessageSegment[] = []
  let actionPosition = 0
  let segmentIndex = 0

  function appendPart<T extends MessageSegment['type']>(type: T, part: EveMessagePart) {
    const previous = segments.at(-1)
    if (type === 'text' && previous?.type === 'text' && part.type === 'text') {
      previous.parts.push(part)
      return
    }
    if (type === 'files' && previous?.type === 'files' && part.type === 'file') {
      previous.parts.push(part)
      return
    }
    if (type === 'actions' && previous?.type === 'actions' && (part.type === 'dynamic-tool' || part.type === 'authorization')) {
      actionPosition += 1
      previous.items.push({ part, position: actionPosition })
      return
    }

    segmentIndex += 1
    if (type === 'text' && part.type === 'text') {
      segments.push({ id: `${message.id}:text:${segmentIndex}`, type, parts: [part] })
    }
    else if (type === 'files' && part.type === 'file') {
      segments.push({ id: `${message.id}:files:${segmentIndex}`, type, parts: [part] })
    }
    else if (type === 'actions' && (part.type === 'dynamic-tool' || part.type === 'authorization')) {
      actionPosition += 1
      segments.push({ id: `${message.id}:actions:${segmentIndex}`, type, items: [{ part, position: actionPosition }] })
    }
  }

  for (const part of message.parts) {
    if (part.type === 'text') appendPart('text', part)
    else if (part.type === 'file') appendPart('files', part)
    else if (part.type === 'dynamic-tool' || part.type === 'authorization') appendPart('actions', part)
    else if (part.type === 'reasoning' && part.state === 'streaming') {
      const previous = segments.at(-1)
      if (previous?.type !== 'reasoning-status') {
        segmentIndex += 1
        segments.push({ id: `${message.id}:reasoning:${segmentIndex}`, type: 'reasoning-status' })
      }
    }
  }

  return segments
}

function messageHasActions(message: EveMessage) {
  return message.parts.some(part => part.type === 'dynamic-tool' || part.type === 'authorization')
}

function isPlanOpen(messageId: string) {
  return planOpenByMessage[messageId] ?? true
}

function togglePlan(messageId: string) {
  planOpenByMessage[messageId] = !isPlanOpen(messageId)
}

function requestIdFor(part: EveDynamicToolPart) {
  return part.state === 'approval-requested'
    ? part.toolMetadata?.eve?.inputRequest?.requestId
    : undefined
}

function readinessResult(message: EveMessage): ReadinessResult | null {
  for (const part of message.parts) {
    if (part.type !== 'dynamic-tool' || part.state !== 'output-available') continue
    if (!part.output || typeof part.output !== 'object' || Array.isArray(part.output)) continue
    const readiness = (part.output as Record<string, unknown>).readiness
    if (!readiness || typeof readiness !== 'object' || Array.isArray(readiness)) continue
    const result = readiness as Record<string, unknown>
    if (
      typeof result.percent !== 'number'
      || !Array.isArray(result.missingDocuments)
      || !Array.isArray(result.nextSteps)
    ) continue
    return {
      percent: Math.max(0, Math.min(100, result.percent)),
      missingDocuments: result.missingDocuments.filter((item): item is string => typeof item === 'string'),
      nextSteps: result.nextSteps.filter((item): item is string => typeof item === 'string'),
      caseUrl: typeof result.caseUrl === 'string' ? result.caseUrl : '/cases',
    }
  }
  return null
}

function safeExternalUrl(value: string | undefined) {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : null
  }
  catch {
    return null
  }
}

function safeFileUrl(value: string | undefined) {
  if (!value) return null
  if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) return value
  return safeExternalUrl(value)
}

function readinessCaseUrl(value: string) {
  const fallback = orgPath('/cases')
  if (value === '/cases') return fallback
  if (value.startsWith('/cases/') && !value.includes('\\')) return orgPath(value)
  if (value === fallback || value.startsWith(`${fallback}/`)) return value
  return fallback
}

function authorizationTone(part: EveAuthorizationPart) {
  if (part.state === 'required') return 'warning'
  if (part.outcome === 'authorized') return 'success'
  if (part.outcome === 'declined') return 'neutral'
  return 'error'
}

function authorizationLabel(part: EveAuthorizationPart) {
  if (part.state === 'required') return 'Połącz konto, aby kontynuować'
  if (part.outcome === 'authorized') return 'Połączenie gotowe'
  if (part.outcome === 'declined') return 'Połączenie odrzucone'
  if (part.outcome === 'timed-out') return 'Czas na połączenie minął'
  return 'Nie udało się połączyć konta'
}

function selectResponse(response: InputResponse) {
  selectedResponses[response.requestId] = response
}

function submitSingleResponse(response: InputResponse) {
  selectedResponses[response.requestId] = response
  if (props.demo) {
    toast.add({
      title: 'Decyzja przyjęta',
      description: 'W podglądzie agent wznowiłby zadanie z wybraną decyzją.',
      color: 'success',
      icon: 'i-lucide-check-circle',
    })
    return
  }
  emit('inputResponses', [response])
}

function submitResponseBatch() {
  if (!batchReady.value) return
  const responses = pendingRequests.value.flatMap(({ request }) => {
    const response = selectedResponses[request.requestId]
    return response ? [response] : []
  })
  if (props.demo) {
    toast.add({ title: 'Decyzje przyjęte', color: 'success', icon: 'i-lucide-check-circle' })
    return
  }
  emit('inputResponses', responses)
}

function updateScrollPreference() {
  const container = messagesContainer.value
  if (!container) return
  const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
  shouldFollowLatest.value = distanceFromBottom < 96
}

async function scrollToLatest(force = false) {
  await nextTick()
  const container = messagesContainer.value
  if (!container || (!force && !shouldFollowLatest.value)) return
  container.scrollTop = container.scrollHeight
  shouldFollowLatest.value = true
}

watch(visibleMessages, () => { void scrollToLatest() }, { deep: true, flush: 'post' })
watch(() => props.status, () => { void scrollToLatest() }, { flush: 'post' })

onMounted(() => {
  void scrollToLatest(true)
})

function sendMessage(prefilled?: string) {
  const message = (prefilled ?? draft.value).trim()
  if (!message || composerDisabled.value || props.demo) return
  draft.value = ''
  shouldFollowLatest.value = true
  emit('send', message)
}

async function focusComposer() {
  await nextTick()
  composerForm.value?.querySelector('textarea')?.focus()
}

function onComposerKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  sendMessage()
}

function newConversation() {
  draft.value = ''
  emit('reset')
  void focusComposer()
}

function stopRun() {
  if (props.demo) {
    toast.add({ title: 'Podgląd zatrzymania', description: 'W aplikacji ta akcja anuluje aktywne zadanie.', color: 'neutral' })
    return
  }
  emit('stop')
}

function runInBackground() {
  if (props.demo) {
    toast.add({ title: 'Agent pracuje w tle', description: 'Możesz wrócić do innych zadań.', color: 'neutral' })
    return
  }
  emit('background')
}

defineExpose({ focusComposer })
</script>

<template>
  <section
    class="assistant-chat"
    :class="`assistant-chat--${presentation}`"
    aria-label="Rozmowa z agentem AI"
  >
    <div v-if="presentation === 'slideover'" class="assistant-chat__toolbar">
      <span class="assistant-chat__identity">
        <span class="assistant-chat__avatar" aria-hidden="true">
          <UIcon name="i-lucide-sparkles" />
        </span>
        <span>
          <strong>Eve</strong>
          <small>Asystent kredytowy</small>
        </span>
      </span>
      <span class="assistant-chat__status" :class="`assistant-chat__status--${statusTone}`">
        <span class="assistant-chat__status-dot" />
        {{ statusLabel }}
      </span>
      <UButton
        color="neutral"
        variant="ghost"
        size="xs"
        icon="i-lucide-rotate-ccw"
        label="Nowa"
        :disabled="!messages.length && !error"
        @click="newConversation"
      />
    </div>

    <p class="sr-only" aria-live="polite">{{ statusLabel }}</p>

    <div
      ref="messagesContainer"
      class="assistant-chat__messages"
      data-testid="assistant-messages"
      role="log"
      aria-label="Wiadomości agenta AI"
      aria-live="polite"
      aria-relevant="additions text"
      :aria-busy="isVisuallyBusy"
      @scroll.passive="updateScrollPreference"
    >
      <div v-if="!visibleMessages.length" class="assistant-chat__empty">
        <span class="assistant-chat__empty-icon" aria-hidden="true">
          <UIcon name="i-lucide-list-todo" />
        </span>
        <div>
          <p class="assistant-chat__empty-eyebrow">Nowe zadanie</p>
          <h2>Zleć agentowi pracę w CRM</h2>
          <p>Opisz rezultat. Eve dobierze narzędzia, pokaże postęp i poprosi o zgodę przed każdą zmianą danych.</p>
        </div>
        <UAlert
          v-if="availability === 'unavailable'"
          class="assistant-chat__availability"
          color="error"
          variant="subtle"
          icon="i-lucide-plug-zap"
          title="Agent nie jest jeszcze dostępny"
          :description="availabilityMessage || 'Administrator musi skonfigurować połączenie z modelem AI.'"
        >
          <template #actions>
            <UButton
              color="error"
              variant="outline"
              size="xs"
              icon="i-lucide-refresh-cw"
              label="Sprawdź ponownie"
              @click="emit('retry')"
            />
          </template>
        </UAlert>

        <div v-else class="assistant-chat__suggestions">
          <button
            v-for="suggestion in suggestions"
            :key="suggestion"
            type="button"
            :disabled="composerDisabled"
            @click="sendMessage(suggestion)"
          >
            <UIcon name="i-lucide-arrow-up-right" />
            <span>{{ suggestion }}</span>
          </button>
        </div>
        <p v-if="availability !== 'unavailable'" class="assistant-chat__safety">
          <UIcon name="i-lucide-shield-check" />
          Odczyty danych mogą działać automatycznie. Zapisy i działania wrażliwe zawsze wymagają Twojej decyzji.
        </p>
      </div>

      <template v-else>
        <article
          v-for="message in visibleMessages"
          :key="message.id"
          :class="['assistant-turn', `assistant-turn--${message.role}`]"
        >
          <span class="assistant-turn__avatar" aria-hidden="true">
            <UIcon :name="message.role === 'assistant' ? 'i-lucide-sparkles' : 'i-lucide-user-round'" />
          </span>

          <div class="assistant-turn__main">
            <header class="assistant-turn__header">
              <span>
                <strong>{{ message.role === 'assistant' ? 'Agent AI' : 'Ty' }}</strong>
                <small v-if="message.role === 'assistant'">plan i wykonanie</small>
                <small v-else>{{ demo ? 'dzisiaj, 10:21' : 'teraz' }}</small>
              </span>
              <UButton
                v-if="message.role === 'assistant' && messageHasActions(message)"
                color="neutral"
                variant="ghost"
                size="xs"
                :icon="isPlanOpen(message.id) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                :label="isPlanOpen(message.id) ? 'Zwiń plan' : 'Pokaż plan'"
                @click="togglePlan(message.id)"
              />
            </header>

            <div class="assistant-turn__content">
              <template v-for="segment in messageSegments(message)" :key="segment.id">
                <div v-if="segment.type === 'text'" class="assistant-turn__text">
                  <p v-for="(part, index) in segment.parts" :key="`${segment.id}:${index}`">
                    {{ part.text }}
                  </p>
                </div>

                <div v-else-if="segment.type === 'reasoning-status'" class="assistant-turn__reasoning-status">
                  <UIcon name="i-lucide-loader-circle" />
                  Analizuję kontekst i układam bezpieczny plan…
                </div>

                <div v-else-if="segment.type === 'files'" class="assistant-turn__files">
                  <a
                    v-for="(part, index) in segment.parts"
                    :key="`${segment.id}:${index}`"
                    :href="safeFileUrl(part.url) ?? undefined"
                    :target="safeFileUrl(part.url) ? '_blank' : undefined"
                    rel="noopener noreferrer"
                    :aria-disabled="!safeFileUrl(part.url)"
                  >
                    <UIcon name="i-lucide-file" />
                    {{ part.filename ?? 'Plik' }}
                  </a>
                </div>

                <ol
                  v-else-if="segment.type === 'actions' && isPlanOpen(message.id)"
                  class="assistant-run"
                  aria-label="Plan i działania agenta"
                >
                  <template v-for="item in segment.items" :key="item.part.type === 'dynamic-tool' ? item.part.toolCallId : `${item.part.turnId}:${item.part.name}`">
                    <CrmEveToolStep
                      v-if="item.part.type === 'dynamic-tool'"
                      :part="item.part"
                      :position="item.position"
                      :response="requestIdFor(item.part) ? selectedResponses[requestIdFor(item.part)!] : undefined"
                      :auto-submit="pendingRequests.length === 1"
                      @select="selectResponse"
                      @submit="submitSingleResponse"
                    />

                    <li
                      v-else
                      class="assistant-authorization"
                      :class="`assistant-authorization--${authorizationTone(item.part)}`"
                    >
                      <span class="assistant-authorization__marker" aria-hidden="true">
                        <UIcon :name="item.part.state === 'required' ? 'i-lucide-key-round' : 'i-lucide-check'" />
                      </span>
                      <div>
                        <span class="assistant-authorization__eyebrow">{{ item.position }}. Połączenie</span>
                        <h3>{{ item.part.displayName }}</h3>
                        <p>{{ authorizationLabel(item.part) }}</p>
                        <p v-if="item.part.state === 'required' && item.part.authorization?.instructions">
                          {{ item.part.authorization.instructions }}
                        </p>
                        <code v-if="item.part.state === 'required' && item.part.authorization?.userCode">
                          {{ item.part.authorization.userCode }}
                        </code>
                        <UButton
                          v-if="item.part.state === 'required' && safeExternalUrl(item.part.authorization?.url)"
                          :to="safeExternalUrl(item.part.authorization?.url)!"
                          target="_blank"
                          rel="noopener noreferrer"
                          color="neutral"
                          variant="outline"
                          icon="i-lucide-external-link"
                          label="Połącz konto"
                        />
                      </div>
                    </li>
                  </template>
                </ol>
              </template>

              <div
                v-if="message.role === 'assistant' && pendingRequests.length > 1 && isPlanOpen(message.id)"
                class="assistant-batch-approval"
              >
                <span>
                  <strong>Odpowiedz na wszystkie pytania</strong>
                  <small>{{ selectedResponseCount }} z {{ pendingRequests.length }} decyzji gotowych</small>
                </span>
                <UButton
                  color="success"
                  variant="solid"
                  icon="i-lucide-play"
                  label="Kontynuuj"
                  :disabled="!batchReady"
                  @click="submitResponseBatch"
                />
              </div>

              <section
                v-if="message.role === 'assistant' && readinessResults.get(message.id)"
                class="assistant-readiness"
                aria-label="Gotowość sprawy"
              >
                <div class="assistant-readiness__score">
                  <span>{{ readinessResults.get(message.id)!.percent }}%</span>
                  <div>
                    <strong>Gotowość sprawy</strong>
                    <small>Wymaga uzupełnień</small>
                  </div>
                  <UProgress
                    :model-value="readinessResults.get(message.id)!.percent"
                    color="success"
                    size="sm"
                    aria-label="Procent gotowości sprawy"
                  />
                </div>
                <div class="assistant-readiness__section">
                  <strong>Brakujące dokumenty ({{ readinessResults.get(message.id)!.missingDocuments.length }})</strong>
                  <ul>
                    <li
                      v-for="document in readinessResults.get(message.id)!.missingDocuments"
                      :key="document"
                    >
                      {{ document }}
                    </li>
                  </ul>
                </div>
                <div class="assistant-readiness__section">
                  <strong>Rekomendowane kolejne kroki</strong>
                  <ol>
                    <li v-for="step in readinessResults.get(message.id)!.nextSteps" :key="step">{{ step }}</li>
                  </ol>
                </div>
                <UButton
                  :to="readinessCaseUrl(readinessResults.get(message.id)!.caseUrl)"
                  color="neutral"
                  variant="outline"
                  icon="i-lucide-external-link"
                  trailing
                  label="Otwórz sprawę"
                />
              </section>
            </div>
          </div>
        </article>
      </template>

      <UAlert
        v-if="visibleMessages.length && availability === 'unavailable'"
        class="assistant-chat__inline-alert"
        color="error"
        variant="subtle"
        icon="i-lucide-plug-zap"
        title="Agent nie jest jeszcze dostępny"
        :description="availabilityMessage || 'Administrator musi skonfigurować połączenie z modelem AI.'"
      >
        <template #actions>
          <UButton
            color="error"
            variant="outline"
            size="xs"
            icon="i-lucide-refresh-cw"
            label="Sprawdź ponownie"
            @click="emit('retry')"
          />
        </template>
      </UAlert>

      <UAlert
        v-else-if="error"
        class="assistant-chat__inline-alert"
        color="error"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="Nie udało się uzyskać odpowiedzi"
        :description="friendlyAssistantError(error)"
      >
        <template #actions>
          <UButton
            color="error"
            variant="outline"
            size="xs"
            icon="i-lucide-refresh-cw"
            label="Spróbuj ponownie"
            @click="emit('retry')"
          />
        </template>
      </UAlert>
    </div>

    <form
      ref="composerForm"
      class="assistant-composer"
      data-testid="assistant-composer"
      @submit.prevent="sendMessage()"
    >
      <UTextarea
        v-model="draft"
        class="w-full"
        autoresize
        :rows="2"
        :maxrows="6"
        :disabled="composerDisabled || demo"
        :placeholder="composerPlaceholder"
        aria-label="Wiadomość do agenta AI"
        @keydown="onComposerKeydown"
      />
      <div class="assistant-composer__actions">
        <p>
          <UIcon :name="hasBlockingInteraction ? 'i-lucide-shield-alert' : 'i-lucide-shield-check'" />
          {{ hasBlockingInteraction ? 'Agent czeka na Twoją decyzję przed kontynuacją.' : 'Zmiany w CRM wymagają Twojego zatwierdzenia.' }}
          <span v-if="availability === 'available'">Enter wysyła · Shift+Enter dodaje nową linię</span>
        </p>
        <div>
          <UButton
            v-if="isVisuallyBusy && !hasBlockingInteraction"
            type="button"
            color="error"
            variant="outline"
            icon="i-lucide-square"
            label="Zatrzymaj"
            @click="stopRun"
          />
          <UButton
            v-if="isVisuallyBusy && !hasBlockingInteraction"
            type="button"
            color="neutral"
            variant="outline"
            icon="i-lucide-picture-in-picture-2"
            label="W tle"
            @click="runInBackground"
          />
          <UButton
            v-else-if="!hasBlockingInteraction"
            type="submit"
            color="neutral"
            icon="i-lucide-send"
            label="Wyślij"
            :disabled="!draft.trim() || demo"
          />
        </div>
      </div>
    </form>
  </section>
</template>

<style scoped>
.assistant-chat {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  min-height: 0;
  overflow: hidden;
  color: var(--ui-text);
}

.assistant-chat--page {
  grid-template-rows: minmax(0, 1fr) auto;
  height: 100%;
  min-height: 0;
  border-top: 1px solid var(--ui-border);
}

.assistant-chat--slideover {
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 14px;
  height: min(760px, calc(100vh - 130px));
}

.assistant-chat__toolbar,
.assistant-composer__actions,
.assistant-chat__identity,
.assistant-chat__status {
  display: flex;
  align-items: center;
}

.assistant-chat__toolbar {
  gap: 10px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--ui-border);
}

.assistant-chat__identity {
  flex: 1;
  gap: 10px;
  min-width: 0;
}

.assistant-chat__identity > span:last-child {
  display: grid;
  min-width: 0;
}

.assistant-chat__identity strong {
  color: var(--ui-text-highlighted);
  font-size: 14px;
}

.assistant-chat__identity small {
  color: var(--ui-text-muted);
  font-size: 11px;
}

.assistant-chat__avatar,
.assistant-turn__avatar {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid var(--ui-border-accented);
  border-radius: 50%;
  background: var(--ui-bg);
  color: var(--ui-text-highlighted);
}

.assistant-chat__avatar {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  background: var(--ui-bg-inverted);
  color: var(--ui-text-inverted);
}

.assistant-chat__status {
  gap: 7px;
  color: var(--ui-text-muted);
  font-size: 11px;
  white-space: nowrap;
}

.assistant-chat__status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ui-text-dimmed);
}

.assistant-chat__status--success .assistant-chat__status-dot { background: var(--ui-success); }
.assistant-chat__status--warning .assistant-chat__status-dot { background: var(--ui-warning); }
.assistant-chat__status--error .assistant-chat__status-dot { background: var(--ui-error); }

.assistant-chat__messages {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scroll-padding-block: 20px;
  scrollbar-gutter: stable;
}

.assistant-chat--page .assistant-chat__messages {
  padding: 0 2px 24px;
}

.assistant-chat--slideover .assistant-chat__messages {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 2px 2px 8px;
}

.assistant-chat__empty {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  align-content: center;
  gap: 18px;
  min-height: 100%;
  max-width: 900px;
  margin: 0 auto;
  padding: 32px 20px;
}

.assistant-chat__empty-icon {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border: 1px solid var(--ui-border-accented);
  border-radius: 16px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-highlighted);
  font-size: 23px;
}

.assistant-chat__empty-eyebrow {
  margin: 0 0 4px !important;
  color: var(--ui-success) !important;
  font-family: var(--font-mono);
  font-size: 10px !important;
  font-weight: 650;
  letter-spacing: .06em;
  text-transform: uppercase;
}

.assistant-chat__empty h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 25px;
  font-weight: 520;
}

.assistant-chat__empty p {
  max-width: 620px;
  margin: 8px 0 0;
  color: var(--ui-text-muted);
  font-size: 14px;
  line-height: 1.55;
}

.assistant-chat__suggestions {
  display: grid;
  grid-column: 2;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.assistant-chat__suggestions button {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  min-height: 64px;
  padding: 12px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  background: transparent;
  color: var(--ui-text-toned);
  font-size: 12px;
  line-height: 1.4;
  text-align: left;
  transition: background-color var(--oe-motion-fast), border-color var(--oe-motion-fast), color var(--oe-motion-fast);
}

.assistant-chat__suggestions button:hover:not(:disabled) {
  border-color: var(--ui-border-accented);
  background: var(--ui-bg-muted);
  color: var(--ui-text-highlighted);
}

.assistant-chat__suggestions button > :first-child {
  flex: 0 0 auto;
  margin-top: 2px;
}

.assistant-chat__availability {
  grid-column: 2;
}

.assistant-chat__safety {
  display: flex;
  grid-column: 2;
  align-items: center;
  gap: 8px;
  margin-top: 4px !important;
  color: var(--ui-text-dimmed) !important;
  font-size: 11px !important;
}

.assistant-chat__inline-alert {
  margin: 16px 10px;
}

.assistant-turn {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  gap: 16px;
  padding: 18px 10px 18px;
  border-bottom: 1px solid var(--ui-border-muted);
}

.assistant-turn--assistant { padding-top: 20px; }

.assistant-turn__avatar {
  width: 46px;
  height: 46px;
  font-size: 19px;
}

.assistant-turn--assistant .assistant-turn__avatar {
  background: var(--ui-bg-muted);
}

.assistant-turn__main { min-width: 0; }

.assistant-turn__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  min-height: 38px;
}

.assistant-turn__header > span {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
}

.assistant-turn__header strong {
  color: var(--ui-text-highlighted);
  font-size: 14px;
  font-weight: 650;
}

.assistant-turn__header small {
  color: var(--ui-text-dimmed);
  font-size: 11px;
}

.assistant-turn__content {
  display: grid;
  gap: 14px;
  min-width: 0;
}

.assistant-turn__text p {
  max-width: 880px;
  margin: 0;
  color: var(--ui-text-toned);
  font-size: 14px;
  line-height: 1.55;
  white-space: pre-wrap;
}

.assistant-turn__text p + p { margin-top: 8px; }

.assistant-turn__reasoning-status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.assistant-turn__reasoning-status > :first-child { animation: assistant-spin 1s linear infinite; }

.assistant-turn__files {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.assistant-turn__files a {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 40px;
  padding: 8px 10px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  color: var(--ui-text-toned);
  font-size: 12px;
  text-decoration: none;
}

.assistant-turn__files a[aria-disabled="true"] {
  cursor: default;
  opacity: .6;
}

.assistant-run {
  position: relative;
  display: grid;
  gap: 10px;
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
}

.assistant-run::before {
  position: absolute;
  top: 16px;
  bottom: -14px;
  left: 15px;
  width: 1px;
  background: var(--ui-border-accented);
  content: '';
}

.assistant-authorization {
  position: relative;
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: 16px;
}

.assistant-authorization__marker {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--ui-warning);
  border-radius: 50%;
  background: var(--ui-bg);
  color: var(--ui-warning);
}

.assistant-authorization > div {
  display: grid;
  justify-items: start;
  gap: 6px;
  padding: 14px 16px;
  border: 1px solid color-mix(in srgb, var(--ui-warning) 50%, var(--ui-border));
  border-radius: var(--oe-radius-control);
  background: color-mix(in srgb, var(--ui-warning) 7%, var(--ui-bg));
}

.assistant-authorization--success .assistant-authorization__marker { border-color: var(--ui-success); color: var(--ui-success); }
.assistant-authorization--error .assistant-authorization__marker { border-color: var(--ui-error); color: var(--ui-error); }

.assistant-authorization__eyebrow {
  color: var(--ui-text-muted);
  font-size: 10px;
  font-weight: 650;
  text-transform: uppercase;
}

.assistant-authorization h3 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 15px;
  font-weight: 600;
}

.assistant-authorization p {
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.assistant-authorization code {
  padding: 5px 8px;
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-highlighted);
  font-size: 12px;
}

.assistant-batch-approval {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 13px 14px;
  border: 1px solid color-mix(in srgb, var(--ui-warning) 55%, var(--ui-border));
  border-radius: var(--oe-radius-control);
  background: color-mix(in srgb, var(--ui-warning) 6%, var(--ui-bg));
}

.assistant-batch-approval > span { display: grid; }
.assistant-batch-approval strong { color: var(--ui-text-highlighted); font-size: 13px; }
.assistant-batch-approval small { color: var(--ui-text-muted); font-size: 11px; }

.assistant-readiness {
  display: grid;
  grid-template-columns: minmax(210px, .8fr) minmax(220px, .9fr) minmax(300px, 1.25fr) auto;
  align-items: stretch;
  margin-top: 2px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  background: color-mix(in srgb, var(--ui-bg-muted) 66%, var(--ui-bg));
  overflow: hidden;
}

.assistant-readiness > * {
  align-content: center;
  min-width: 0;
  padding: 16px 18px;
}

.assistant-readiness > * + * { border-left: 1px solid var(--ui-border-muted); }

.assistant-readiness__score {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px 12px;
  align-items: center;
}

.assistant-readiness__score > span {
  grid-row: 1;
  color: var(--ui-text-highlighted);
  font-size: 30px;
  font-weight: 500;
}

.assistant-readiness__score > div {
  display: grid;
  grid-row: 1;
}

.assistant-readiness__score strong,
.assistant-readiness__section strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
  font-weight: 620;
}

.assistant-readiness__score small {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.assistant-readiness__score :deep([data-slot="root"]) { grid-column: 1 / -1; }

.assistant-readiness__section ul,
.assistant-readiness__section ol {
  display: grid;
  gap: 4px;
  margin: 7px 0 0;
  padding-left: 18px;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.4;
}

.assistant-readiness > :deep(a) { align-self: center; margin: 16px; }

.assistant-composer {
  position: relative;
  z-index: 3;
  display: grid;
  gap: 8px;
  padding: 13px 0 max(10px, env(safe-area-inset-bottom));
  border-top: 1px solid var(--ui-border);
  background: var(--ui-bg-muted);
}

.assistant-chat--page .assistant-composer {
  margin: 0 -2px;
  padding-inline: 2px;
}

.assistant-composer__actions {
  justify-content: space-between;
  gap: 12px;
}

.assistant-composer__actions p {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  color: var(--ui-text-dimmed);
  font-size: 10px;
  line-height: 1.35;
}

.assistant-composer__actions p > span {
  padding-left: 7px;
  border-left: 1px solid var(--ui-border-accented);
}

.assistant-composer__actions > div {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

@keyframes assistant-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 1080px) {
  .assistant-readiness { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .assistant-readiness > * + * { border-left: 0; }
  .assistant-readiness > :nth-child(even) { border-left: 1px solid var(--ui-border-muted); }
  .assistant-readiness > :nth-child(n + 3) { border-top: 1px solid var(--ui-border-muted); }
}

@media (max-width: 760px) {
  .assistant-chat__empty {
    grid-template-columns: 42px minmax(0, 1fr);
    gap: 12px;
    padding: 24px 2px;
  }

  .assistant-chat__empty-icon { width: 42px; height: 42px; border-radius: 13px; }
  .assistant-chat__empty h2 { font-size: 21px; }
  .assistant-chat__suggestions { grid-template-columns: 1fr; }

  .assistant-turn {
    grid-template-columns: 36px minmax(0, 1fr);
    gap: 12px;
    padding-inline: 2px;
  }

  .assistant-turn__avatar { width: 36px; height: 36px; }
  .assistant-readiness { grid-template-columns: 1fr; }
  .assistant-readiness > * + * { border-left: 0 !important; border-top: 1px solid var(--ui-border-muted); }
  .assistant-readiness > :deep(a) { justify-self: stretch; }
}

@media (max-width: 640px) {
  .assistant-chat--page { height: 100%; min-height: 0; }
  .assistant-chat--slideover { height: calc(100vh - 120px); }
  .assistant-chat__toolbar { flex-wrap: wrap; }
  .assistant-chat__status { order: 3; width: 100%; }
  .assistant-chat__empty { grid-template-columns: 1fr; }
  .assistant-chat__empty-icon { display: none; }
  .assistant-chat__availability,
  .assistant-chat__suggestions,
  .assistant-chat__safety { grid-column: 1; }
  .assistant-composer__actions p > span { display: none; }
  .assistant-composer__actions { align-items: stretch; flex-direction: column; }
  .assistant-composer__actions > div { justify-content: stretch; }
  .assistant-composer__actions > div :deep(button) { flex: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .assistant-turn__reasoning-status > :first-child { animation: none; }
}
</style>
