<script setup lang="ts">
import type {
  MailConnectionInfo,
  MailConnectionPayload,
  MailSendPayload,
} from '#shared/types/mail'
import { apiErrorMessage } from '~/utils/api-error'

const props = withDefaults(defineProps<{
  recipient: string
  contextType: 'client' | 'case'
  contextId: string
  subject?: string
  label?: string
}>(), {
  subject: '',
  label: 'Napisz',
})

const requestFetch = useRequestFetch()
const toast = useToast()
const { organizationSlug, orgApiPath, orgPath } = useOrganizationContext()

const emptyConnections = (): MailConnectionPayload => ({
  providers: [],
  connections: [],
})

const {
  data: connectionPayload,
  status: connectionStatus,
  error: connectionError,
  refresh: refreshConnections,
} = useAsyncData<MailConnectionPayload>(
  `mail-contextual-compose-connections:${organizationSlug.value}`,
  () => requestFetch<MailConnectionPayload>(orgApiPath('/mail-connections')),
  {
    default: emptyConnections,
    lazy: true,
    watch: [organizationSlug],
  },
)

const composerOpen = ref(false)
const composerKey = ref(0)
const selectedConnection = ref<MailConnectionInfo | null>(null)

const sendConnections = computed(() => connectionPayload.value.connections.filter(connection => (
  connection.status === 'active' && connection.capabilities.canSend
)))

const accountMenuItems = computed(() => sendConnections.value.map(connection => ({
  label: connection.displayName || connection.accountEmail,
  description: `${connection.providerLabel} · ${connection.accountEmail}`,
  icon: connection.providerIcon.startsWith('/') ? 'i-lucide-mail' : connection.providerIcon,
  onSelect: () => openWithConnection(connection),
})))

function openWithConnection(connection: MailConnectionInfo): void {
  selectedConnection.value = connection
  composerKey.value += 1
  composerOpen.value = true
}

async function openComposer(): Promise<void> {
  if (connectionStatus.value === 'pending') return

  if (connectionStatus.value === 'idle' || connectionError.value) {
    await refreshConnections()
  }

  const connection = sendConnections.value[0]
  if (connection) {
    openWithConnection(connection)
    return
  }

  toast.add({
    title: 'Najpierw połącz skrzynkę',
    description: connectionError.value
      ? apiErrorMessage(connectionError.value)
      : 'Do wysyłki z CRM potrzebne jest aktywne konto pocztowe.',
    color: 'warning',
    icon: 'i-lucide-mail-warning',
  })
  await navigateTo(orgPath('/mail'))
}

function handleSent(_result: MailSendPayload['data']): void {
  toast.add({
    title: 'Wiadomość została wysłana',
    description: selectedConnection.value?.accountEmail,
    color: 'success',
    icon: 'i-lucide-send',
  })
}
</script>

<template>
  <UDropdownMenu
    v-if="sendConnections.length > 1"
    :items="accountMenuItems"
    :content="{ align: 'end' }"
  >
    <UButton
      color="neutral"
      variant="outline"
      size="lg"
      icon="i-lucide-mail"
      trailing-icon="i-lucide-chevron-down"
    >
      {{ props.label }}
    </UButton>
  </UDropdownMenu>

  <UButton
    v-else
    color="neutral"
    variant="outline"
    size="lg"
    icon="i-lucide-mail"
    :loading="connectionStatus === 'pending'"
    @click="openComposer"
  >
    {{ props.label }}
  </UButton>

  <MailComposerSlideover
    v-if="selectedConnection"
    :key="composerKey"
    v-model:open="composerOpen"
    :endpoint="orgApiPath('/mail/messages')"
    :connection-id="selectedConnection.id"
    :provider="selectedConnection.provider"
    :provider-label="selectedConnection.providerLabel"
    :provider-icon="selectedConnection.providerIcon"
    :account-email="selectedConnection.accountEmail"
    :external-sent-url="selectedConnection.externalSentUrl"
    :max-attachment-bytes="selectedConnection.capabilities.maxAttachmentBytes"
    :max-total-attachment-bytes="selectedConnection.capabilities.maxTotalAttachmentBytes"
    :initial-to="props.recipient"
    :initial-subject="props.subject"
    :context-type="props.contextType"
    :context-id="props.contextId"
    @sent="handleSent"
  />
</template>
