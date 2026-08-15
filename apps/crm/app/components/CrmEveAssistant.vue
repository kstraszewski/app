<script setup lang="ts">
import type { InputResponse } from 'eve/client'
import type { CrmAgentInvocationCredentialResponse } from '#shared/types/agent-invocation'
import type {
  EveMessage,
  EveMessageData,
  UseEveAgentSnapshot,
} from 'eve/vue'
import { useEveAgent } from 'eve/vue'
import type { AgentInvocationRequest } from '~/composables/useAgentInvocation'

type AssistantAvailability = 'available' | 'checking' | 'unavailable'
type ClientContextJsonValue =
  | boolean
  | number
  | string
  | null
  | readonly ClientContextJsonValue[]
  | { readonly [key: string]: ClientContextJsonValue }
type ClientContextJsonObject = { readonly [key: string]: ClientContextJsonValue }

const props = withDefaults(defineProps<{
  demo?: boolean
  mode?: 'launcher' | 'page'
}>(), {
  demo: false,
  mode: 'launcher',
})

const emit = defineEmits<{
  statusChange: [status: string]
}>()

const route = useRoute()
const toast = useToast()
const open = ref(false)
const chat = ref<{ focusComposer: () => Promise<void> | void } | null>(null)
const availability = ref<AssistantAvailability>(props.demo ? 'available' : 'checking')
const availabilityMessage = ref('')
const {
  request: invocationRequest,
  consume: consumeInvocationRequest,
  complete: completeInvocation,
  fail: failInvocation,
} = useAgentInvocation()
const activeInvocation = shallowRef<AgentInvocationRequest | null>(null)
let pendingInvocationCompletion: { requestId: string, text: string } | null = null
let slideoverPresent = false
let startingInvocation = false

watch(open, (value) => {
  if (props.mode === 'launcher' && value) slideoverPresent = true
}, { flush: 'sync' })

const organizationSlug = computed(() => {
  const value = route.params.organizationSlug
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')
})
const currentCaseId = computed(() => {
  if (!/\/cases\/[^/]+(?:\/|$)/u.test(route.path)) return ''
  const value = route.params.id
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')
})
const messageWorkspace = computed(() => {
  const view = Array.isArray(route.query.view) ? route.query.view[0] : route.query.view
  return /\/messages\/?$/.test(route.path)
    || (/\/cases\/[^/]+\/?$/.test(route.path) && view === 'messages')
})

function friendlyAssistantError(caught: { message?: string } | null | undefined) {
  const responseMessage = (caught as any)?.data?.statusMessage
    ?? (caught as any)?.data?.message
  const message = (typeof responseMessage === 'string' ? responseMessage : caught?.message)?.trim() ?? ''
  if (/AI Gateway|API[_ ]?KEY|VERCEL_OIDC_TOKEN|credentials/iu.test(message)) {
    return 'Asystent nie jest jeszcze połączony z modelem AI. Skontaktuj się z administratorem.'
  }
  if (/fetch|network|ECONN/iu.test(message)) {
    return 'Nie udało się połączyć z asystentem. Sprawdź połączenie i spróbuj ponownie.'
  }
  if (/Sesja CRM wygasła|Zaloguj się/iu.test(message)) {
    return 'Sesja CRM wygasła. Zaloguj się ponownie.'
  }
  if (/Nie wybrano organizacji/iu.test(message)) {
    return 'Wybierz organizację CRM i spróbuj ponownie.'
  }
  if (/spraw|klient|wiadomoś|zakres|preset/iu.test(message) && message.length <= 240) {
    return message
  }
  return 'Asystent jest chwilowo niedostępny. Spróbuj ponownie.'
}

function isModelConfigurationError(caught: { message?: string } | null | undefined) {
  return /AI Gateway|API[_ ]?KEY|VERCEL_OIDC_TOKEN|credentials/iu.test(caught?.message?.trim() ?? '')
}

async function assistantHeaders() {
  const token = await $fetch<{ accessToken: string }>('/api/data/token')
    .catch(() => null)
  if (!token?.accessToken) {
    throw new Error('Sesja CRM wygasła. Zaloguj się ponownie.')
  }
  if (!organizationSlug.value) {
    throw new Error('Nie wybrano organizacji CRM.')
  }

  return {
    Authorization: `Bearer ${token.accessToken}`,
    'x-openexpert-organization': organizationSlug.value,
  }
}

async function checkAssistantAvailability() {
  if (props.demo) {
    availability.value = 'available'
    availabilityMessage.value = ''
    return
  }

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

function prepareAgentSend(input: any) {
  const suppliedContext = input.clientContext
  const context = suppliedContext
    && typeof suppliedContext === 'object'
    && !Array.isArray(suppliedContext)
    ? suppliedContext
    : suppliedContext === undefined
      ? {}
      : { suppliedClientContext: suppliedContext }

  return {
    ...input,
    clientContext: {
      ...context,
      route: route.fullPath,
      organizationSlug: organizationSlug.value,
      ...(currentCaseId.value ? { currentCaseId: currentCaseId.value } : {}),
    },
  }
}

const {
  data,
  error,
  reset,
  respond,
  send,
  session,
  status,
  stop,
} = useEveAgent({
  host: '/api/assistant',
  headers: assistantHeaders,
  prepareSend: prepareAgentSend,
  onError: caught => {
    if (isModelConfigurationError(caught)) {
      availability.value = 'unavailable'
      availabilityMessage.value = friendlyAssistantError(caught)
    }
    if (props.mode === 'launcher' && !open.value) {
      toast.add({
        title: 'Agent AI nie odpowiedział',
        description: friendlyAssistantError(caught),
        color: 'error',
        icon: 'i-lucide-triangle-alert',
      })
    }
  },
})

const {
  data: invocationData,
  error: invocationError,
  reset: resetInvocationSession,
  respond: respondToInvocation,
  send: sendInvocation,
  session: invocationSession,
  status: invocationStatus,
  stop: stopInvocationStream,
} = useEveAgent({
  host: '/api/assistant',
  headers: assistantHeaders,
  prepareSend: prepareAgentSend,
  onFinish: finishInvocationTurn,
  onError: caught => {
    if (isModelConfigurationError(caught)) {
      availability.value = 'unavailable'
      availabilityMessage.value = friendlyAssistantError(caught)
    }
    failActiveInvocation(friendlyAssistantError(caught))
  },
})

const showingInvocation = computed(() => Boolean(activeInvocation.value))
const displayedData = computed(() => (
  showingInvocation.value ? invocationData.value : data.value
))
const displayedError = computed(() => (
  showingInvocation.value ? invocationError.value : error.value
))
const displayedAgentStatus = computed(() => (
  showingInvocation.value ? invocationStatus.value : status.value
))

const displayStatus = computed(() => {
  if (availability.value === 'checking') return 'checking'
  if (availability.value === 'unavailable') return 'unavailable'
  const parts = displayedData.value.messages.flatMap(message => message.parts)
  if (parts.some(part => part.type === 'authorization' && part.state === 'required')) return 'authorization'
  if (parts.some(part => part.type === 'dynamic-tool' && part.state === 'approval-requested')) return 'waiting'
  return displayedAgentStatus.value
})

watch(displayStatus, value => emit('statusChange', value), { immediate: true })

onMounted(() => {
  if (props.mode === 'page') void checkAssistantAvailability()
})

watch(
  [invocationRequest, invocationStatus, availability],
  () => { void startQueuedInvocation() },
  { immediate: true },
)

function hasPendingInteraction(messages: readonly EveMessage[]): boolean {
  return messages.some(message => message.parts.some(part => (
    (part.type === 'authorization' && part.state === 'required')
    || (
      part.type === 'dynamic-tool'
      && part.state === 'approval-requested'
      && Boolean(part.toolMetadata?.eve?.inputRequest)
    )
  )))
}

function latestInvocationText(messages: readonly EveMessage[]): string {
  const message = [...messages].reverse().find(item => item.role === 'assistant')
  if (!message) return ''
  return message.parts
    .flatMap(part => part.type === 'text' ? [part.text.trim()] : [])
    .filter(Boolean)
    .join('\n\n')
    .trim()
}

function finishInvocationTurn(snapshot: UseEveAgentSnapshot<EveMessageData>): void {
  const active = activeInvocation.value
  if (!active) return

  if (snapshot.status === 'error') {
    failActiveInvocation(friendlyAssistantError(snapshot.error))
    return
  }
  if (hasPendingInteraction(snapshot.data.messages)) {
    open.value = true
    return
  }

  const text = latestInvocationText(snapshot.data.messages)
  if (!text) {
    failActiveInvocation('Agent nie zwrócił wyniku. Spróbuj ponownie.')
    return
  }

  activeInvocation.value = null
  if (!slideoverPresent) {
    completeInvocation(active.id, text)
    return
  }

  pendingInvocationCompletion = { requestId: active.id, text }
  open.value = false
}

function handleSlideoverAfterLeave(): void {
  slideoverPresent = false
  const completion = pendingInvocationCompletion
  if (!completion) return
  pendingInvocationCompletion = null
  completeInvocation(completion.requestId, completion.text)
}

function failActiveInvocation(message: string): void {
  const active = activeInvocation.value
  if (!active) return
  activeInvocation.value = null
  failInvocation(active.id, message)
}

async function invocationCredential(request: AgentInvocationRequest) {
  const response = await $fetch<CrmAgentInvocationCredentialResponse>(
    `/api/org/${encodeURIComponent(organizationSlug.value)}/assistant/invocations`,
    {
      method: 'POST',
      body: request.credential,
    },
  )
  return {
    Authorization: `Bearer ${response.accessToken}`,
  }
}

async function startQueuedInvocation(): Promise<void> {
  const request = invocationRequest.value
  if (
    props.mode !== 'launcher'
    || !request
    || activeInvocation.value
    || startingInvocation
  ) return

  open.value = true
  if (invocationStatus.value === 'submitted' || invocationStatus.value === 'streaming') return

  startingInvocation = true
  try {
    if (availability.value !== 'available') await checkAssistantAvailability()
    if (invocationRequest.value?.id !== request.id) return
    if (availability.value !== 'available') {
      consumeInvocationRequest(request.id)
      failInvocation(
        request.id,
        availabilityMessage.value || 'Agent AI jest chwilowo niedostępny.',
      )
      return
    }

    const headers = await invocationCredential(request)
    resetInvocationSession()
    await nextTick()
    activeInvocation.value = request
    consumeInvocationRequest(request.id)
    const clientContext = {
      ...request.context,
      requestId: request.id,
    } as unknown as ClientContextJsonObject
    await sendInvocation(request.prompt, {
      clientContext,
      headers,
    })
  }
  catch (caught) {
    if (activeInvocation.value?.id === request.id) {
      failActiveInvocation(friendlyAssistantError(caught as { message?: string }))
    }
    else {
      consumeInvocationRequest(request.id)
      failInvocation(request.id, friendlyAssistantError(caught as { message?: string }))
    }
  }
  finally {
    startingInvocation = false
  }
}

async function sendMessage(message: string) {
  open.value = true
  if (availability.value !== 'available') return
  const active = activeInvocation.value
  if (active) {
    await sendInvocation(message, {
      headers: await invocationCredential(active),
    })
    return
  }
  await send(message)
}

async function sendInputResponses(responses: readonly InputResponse[]) {
  if (!responses.length) return
  open.value = true
  const active = activeInvocation.value
  if (active) {
    await respondToInvocation(responses, {
      headers: await invocationCredential(active),
    })
    return
  }
  await respond(responses)
}

async function cancelTurn(options: { silent?: boolean } = {}) {
  const invocation = activeInvocation.value
  const sessionId = invocation
    ? invocationSession.value?.sessionId
    : session.value?.sessionId
  if (invocation) failActiveInvocation('Zadanie Agenta AI zostało zatrzymane.')
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
        description: 'Agent nie będzie wykonywać kolejnych działań.',
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
    if (invocation) stopInvocationStream()
    else stop()
  }
}

function runInBackground() {
  const invocation = activeInvocation.value
  if (invocation) {
    failActiveInvocation('Agent kontynuuje pracę w tle, ale wynik nie zostanie automatycznie przekazany do miejsca wywołania.')
    stopInvocationStream()
  }
  else {
    stop()
  }
  toast.add({
    title: 'Agent pracuje w tle',
    description: 'Odłączono podgląd bieżącego strumienia. Zadanie nadal działa na serwerze.',
    color: 'neutral',
    icon: 'i-lucide-picture-in-picture-2',
  })
}

async function newConversation() {
  if (activeInvocation.value) {
    if (invocationStatus.value === 'submitted' || invocationStatus.value === 'streaming') {
      await cancelTurn({ silent: true })
    }
    else {
      failActiveInvocation('Rozpoczęto nową rozmowę przed ukończeniem zadania.')
    }
  }
  else if (status.value === 'submitted' || status.value === 'streaming') {
    await cancelTurn({ silent: true })
  }
  resetInvocationSession()
  reset()
  await nextTick()
  await chat.value?.focusComposer()
}

function openAssistant() {
  open.value = true
  if (availability.value === 'checking') void checkAssistantAvailability()
}

defineExpose({ newConversation })
</script>

<template>
  <div
    v-if="organizationSlug"
    class="crm-eve-assistant"
    :class="[
      `crm-eve-assistant--${mode}`,
      { 'is-message-workspace': messageWorkspace },
    ]"
  >
    <CrmEveChat
      v-if="mode === 'page'"
      ref="chat"
      :messages="displayedData.messages"
      :status="displayedAgentStatus"
      :error="displayedError"
      :demo="props.demo"
      :availability="availability"
      :availability-message="availabilityMessage"
      presentation="page"
      @send="sendMessage"
      @stop="cancelTurn"
      @background="runInBackground"
      @input-responses="sendInputResponses"
      @reset="newConversation"
      @retry="checkAssistantAvailability"
    />

    <template v-else>
      <UButton
        class="crm-eve-assistant__launcher"
        color="neutral"
        size="lg"
        icon="i-lucide-sparkles"
        aria-label="Otwórz agenta AI"
        @click="openAssistant"
      >
        <span>Agent AI</span>
      </UButton>

      <USlideover
        v-model:open="open"
        title="Agent AI Eve"
        description="Główny agent CRM · bezpieczny dostęp do spraw i wiedzy OpenExpert"
        :ui="{
          content: 'sm:max-w-xl',
          body: 'min-h-0 overflow-hidden',
        }"
        @after:leave="handleSlideoverAfterLeave"
      >
        <template #body>
          <CrmEveChat
            ref="chat"
            :messages="displayedData.messages"
            :status="displayedAgentStatus"
            :error="displayedError"
            :availability="availability"
            :availability-message="availabilityMessage"
            @send="sendMessage"
            @stop="cancelTurn"
            @background="runInBackground"
            @input-responses="sendInputResponses"
            @reset="newConversation"
            @retry="checkAssistantAvailability"
          />
        </template>
      </USlideover>
    </template>
  </div>
</template>

<style scoped>
.crm-eve-assistant__launcher {
  position: fixed;
  right: calc(24px + env(safe-area-inset-right, 0px));
  bottom: calc(24px + env(safe-area-inset-bottom, 0px));
  z-index: 40;
  border-radius: 999px;
  box-shadow: 0 16px 40px rgb(0 0 0 / 16%);
}

.crm-eve-assistant.is-message-workspace .crm-eve-assistant__launcher {
  bottom: calc(92px + env(safe-area-inset-bottom, 0px));
}

@media (max-width: 640px) {
  .crm-eve-assistant__launcher {
    right: calc(16px + env(safe-area-inset-right, 0px));
    bottom: calc(16px + env(safe-area-inset-bottom, 0px));
    min-width: 48px;
    min-height: 48px;
  }

  .crm-eve-assistant.is-message-workspace .crm-eve-assistant__launcher {
    bottom: calc(84px + env(safe-area-inset-bottom, 0px));
  }

  .crm-eve-assistant__launcher span { display: none; }
}
</style>
