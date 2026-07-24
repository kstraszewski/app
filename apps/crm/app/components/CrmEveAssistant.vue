<script setup lang="ts">
import type { InputResponse } from 'eve/client'
import { useEveAgent } from 'eve/vue'

type AssistantAvailability = 'available' | 'checking' | 'unavailable'

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
const supabase = useSupabaseClient()
const toast = useToast()
const open = ref(false)
const chat = ref<{ focusComposer: () => Promise<void> | void } | null>(null)
const availability = ref<AssistantAvailability>(props.demo ? 'available' : 'checking')
const availabilityMessage = ref('')

const organizationSlug = computed(() => {
  const value = route.params.organizationSlug
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')
})
const currentCaseId = computed(() => {
  const value = route.params.id
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')
})

function friendlyAssistantError(caught: { message?: string } | null | undefined) {
  const message = caught?.message?.trim() ?? ''
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
  return 'Asystent jest chwilowo niedostępny. Spróbuj ponownie.'
}

function isModelConfigurationError(caught: { message?: string } | null | undefined) {
  return /AI Gateway|API[_ ]?KEY|VERCEL_OIDC_TOKEN|credentials/iu.test(caught?.message?.trim() ?? '')
}

async function assistantHeaders() {
  const { data: sessionResult, error: sessionError } = await supabase.auth.getSession()
  const authSession = sessionResult.session
  if (sessionError || !authSession?.access_token) {
    throw new Error('Sesja CRM wygasła. Zaloguj się ponownie.')
  }
  if (!organizationSlug.value) {
    throw new Error('Nie wybrano organizacji CRM.')
  }

  return {
    Authorization: `Bearer ${authSession.access_token}`,
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

const {
  data,
  error,
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
      ...(currentCaseId.value ? { currentCaseId: currentCaseId.value } : {}),
    },
  }),
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

const displayStatus = computed(() => {
  if (availability.value === 'checking') return 'checking'
  if (availability.value === 'unavailable') return 'unavailable'
  const parts = data.value.messages.flatMap(message => message.parts)
  if (parts.some(part => part.type === 'authorization' && part.state === 'required')) return 'authorization'
  if (parts.some(part => part.type === 'dynamic-tool' && part.state === 'approval-requested')) return 'waiting'
  return status.value
})

watch(displayStatus, value => emit('statusChange', value), { immediate: true })

onMounted(() => {
  if (props.mode === 'page') void checkAssistantAvailability()
})

async function sendMessage(message: string) {
  open.value = true
  if (availability.value !== 'available') return
  await send({ message })
}

async function sendInputResponses(responses: readonly InputResponse[]) {
  if (!responses.length) return
  open.value = true
  await send({ inputResponses: responses })
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
    stop()
  }
}

function runInBackground() {
  stop()
  toast.add({
    title: 'Agent pracuje w tle',
    description: 'Odłączono podgląd bieżącego strumienia. Zadanie nadal działa na serwerze.',
    color: 'neutral',
    icon: 'i-lucide-picture-in-picture-2',
  })
}

async function newConversation() {
  if (status.value === 'submitted' || status.value === 'streaming') {
    await cancelTurn({ silent: true })
  }
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
  <div v-if="organizationSlug" class="crm-eve-assistant" :class="`crm-eve-assistant--${mode}`">
    <CrmEveChat
      v-if="mode === 'page'"
      ref="chat"
      :messages="data.messages"
      :status="status"
      :error="error"
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
        description="Gemini 3.5 Flash-Lite · bezpieczny dostęp do spraw CRM"
        :ui="{ content: 'sm:max-w-xl' }"
      >
        <template #body>
          <CrmEveChat
            ref="chat"
            :messages="data.messages"
            :status="status"
            :error="error"
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
  right: 24px;
  bottom: 24px;
  z-index: 40;
  border-radius: 999px;
  box-shadow: 0 16px 40px rgb(0 0 0 / 16%);
}

@media (max-width: 640px) {
  .crm-eve-assistant__launcher {
    right: 16px;
    bottom: 16px;
  }

  .crm-eve-assistant__launcher span { display: none; }
}
</style>
