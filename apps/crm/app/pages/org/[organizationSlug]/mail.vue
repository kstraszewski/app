<script setup lang="ts">
import type {
  MailAddress,
  MailConnectionInfo,
  MailConnectionPayload,
  MailFolderId,
  MailMessageSecurity,
  MailProviderId,
  MailSendPayload,
  MailThreadDetailPayload,
  MailThreadListPayload,
  MailThreadSummary,
} from '#shared/types/mail'
import type { LocationQueryRaw } from 'vue-router'
import { apiErrorMessage } from '~/utils/api-error'

definePageMeta({ middleware: ['auth', 'organization'] })
useHead({
  title: 'Poczta — OpenExpert CRM',
  meta: [{ name: 'referrer', content: 'no-referrer' }],
})

const route = useRoute()
const router = useRouter()
const { organizationSlug, orgApiPath } = useOrganizationContext()
const requestFetch = useRequestFetch()
const toast = useToast()

const folderConfiguration: Array<{
  id: MailFolderId
  query: string
  label: string
  icon: string
}> = [
  { id: 'INBOX', query: 'inbox', label: 'Odebrane', icon: 'i-lucide-inbox' },
  { id: 'STARRED', query: 'starred', label: 'Oznaczone', icon: 'i-lucide-star' },
  { id: 'SENT', query: 'sent', label: 'Wysłane', icon: 'i-lucide-send' },
  { id: 'DRAFT', query: 'draft', label: 'Szkice', icon: 'i-lucide-file-pen-line' },
]

const emptyConnectionPayload = (): MailConnectionPayload => ({
  providers: [],
  connections: [],
})

const emptyThreadPayload = (): MailThreadListPayload => ({
  data: [],
  folders: folderConfiguration.map(folder => ({
    id: folder.id,
    label: folder.label,
    messagesTotal: null,
    messagesUnread: null,
  })),
  nextPageToken: null,
  resultSizeEstimate: 0,
  partialFailureCount: 0,
})

function queryText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function folderFromQuery(value: unknown): MailFolderId {
  const normalized = queryText(value).toLowerCase()
  return folderConfiguration.find(folder => folder.query === normalized)?.id ?? 'INBOX'
}

const activeFolder = computed(() => folderFromQuery(route.query.folder))
const requestedConnectionId = computed(() => queryText(route.query.account))
const selectedThreadId = computed(() => {
  const value = queryText(route.query.thread)
  return /^[A-Za-z0-9_-]{1,4096}$/u.test(value) ? value : ''
})
const searchQuery = ref('')
const searchInput = ref('')
const pageToken = ref('')
const previousPageTokens = ref<string[]>([])
const refreshing = ref(false)
const lastRefreshedAt = ref<number | null>(null)
const connectionModalOpen = ref(false)
const connectionModalProvider = ref<MailProviderId | null>(null)
const reconnectConnection = ref<MailConnectionInfo | null>(null)
const disconnectTarget = ref<MailConnectionInfo | null>(null)
const disconnecting = ref(false)
const composerOpen = ref(false)
const composerKey = ref(0)
const composerConnectionId = ref('')
const composerDraft = reactive({
  to: '',
  cc: '',
  subject: '',
  threadId: '',
})

const {
  data: connectionPayload,
  status: connectionStatus,
  error: connectionError,
  refresh: refreshConnection,
} = await useAsyncData<MailConnectionPayload>(
  `mail-connections:${organizationSlug.value}`,
  () => requestFetch<MailConnectionPayload>(orgApiPath('/mail-connections')),
  {
    default: emptyConnectionPayload,
    watch: [organizationSlug],
  },
)

const providers = computed(() => connectionPayload.value.providers)
const connections = computed(() => connectionPayload.value.connections)
const activeConnection = computed(() => (
  connections.value.find(connection => connection.id === requestedConnectionId.value)
  ?? connections.value.find(connection => connection.status === 'active')
  ?? connections.value[0]
  ?? null
))
const connectionId = computed(() => activeConnection.value?.id ?? '')
const composerConnection = computed(() => (
  connections.value.find(connection => connection.id === composerConnectionId.value)
  ?? activeConnection.value
))
const selectedConnectionId = computed({
  get: () => connectionId.value,
  set: (value: string) => switchMailbox(value),
})
const accountItems = computed(() => connections.value.map(connection => ({
  label: connection.displayName || connection.accountEmail,
  description: `${connection.providerLabel} · ${connection.accountEmail}`,
  value: connection.id,
  icon: connection.providerIcon.startsWith('/')
    ? 'i-lucide-mail'
    : connection.providerIcon,
})))
const canRead = computed(() => (
  activeConnection.value?.status === 'active'
  && activeConnection.value.capabilities.canRead
))
const canSend = computed(() => (
  activeConnection.value?.status === 'active'
  && activeConnection.value.capabilities.canSend
))
const showReconnectNotice = computed(() => (
  activeConnection.value?.status === 'revoked'
  || activeConnection.value?.status === 'error'
))
const connectionsPath = computed(() => orgApiPath('/mail-connections'))
const sendEndpoint = computed(() => orgApiPath('/mail/messages'))

watch(
  [() => connectionPayload.value.connections, connectionStatus],
  ([availableConnections, status]) => {
    if (status === 'idle' || status === 'pending') return
    if (!availableConnections.length) {
      if (route.query.account || route.query.thread) {
        const query = { ...route.query }
        delete query.account
        delete query.thread
        void router.replace({ path: route.path, query })
      }
      return
    }
    const requested = requestedConnectionId.value
    if (availableConnections.some(connection => connection.id === requested)) return
    const fallback = availableConnections.find(connection => connection.status === 'active')
      ?? availableConnections[0]
    const query: LocationQueryRaw = { ...route.query, account: fallback!.id }
    delete query.thread
    void router.replace({ path: route.path, query })
  },
  { immediate: true },
)

watch(searchQuery, (value) => {
  searchInput.value = value
})

watch([activeFolder, searchQuery, organizationSlug], () => {
  pageToken.value = ''
  previousPageTokens.value = []
})

watch(connectionId, (next, previous) => {
  if (!previous || next === previous) return
  searchQuery.value = ''
  searchInput.value = ''
  pageToken.value = ''
  previousPageTokens.value = []
  lastRefreshedAt.value = null
})

const {
  data: threadPayload,
  status: threadsStatus,
  error: threadsError,
  refresh: refreshThreads,
} = await useAsyncData<MailThreadListPayload>(
  `mail-threads:${organizationSlug.value}`,
  async () => {
    if (!connectionId.value || !activeConnection.value?.capabilities.canRead) {
      return emptyThreadPayload()
    }
    if (searchQuery.value) {
      return requestFetch<MailThreadListPayload>(orgApiPath('/mail/threads/search'), {
        method: 'POST',
        body: {
          connectionId: connectionId.value,
          folder: activeFolder.value,
          q: searchQuery.value,
          pageToken: pageToken.value || undefined,
        },
      })
    }
    return requestFetch<MailThreadListPayload>(orgApiPath('/mail/threads'), {
      query: {
        connectionId: connectionId.value,
        folder: activeFolder.value,
        pageToken: pageToken.value || undefined,
      },
    })
  },
  {
    server: false,
    default: emptyThreadPayload,
    watch: [
      organizationSlug,
      connectionId,
      activeFolder,
      searchQuery,
      pageToken,
    ],
  },
)

const {
  data: selectedThreadPayload,
  status: selectedThreadStatus,
  error: selectedThreadError,
  refresh: refreshSelectedThread,
  clear: clearSelectedThread,
} = await useAsyncData<MailThreadDetailPayload | null>(
  `mail-thread-detail:${organizationSlug.value}`,
  async () => {
    if (!connectionId.value || !selectedThreadId.value) return null
    return requestFetch<MailThreadDetailPayload>(
      orgApiPath(`/mail/threads/${encodeURIComponent(selectedThreadId.value)}`),
      { query: { connectionId: connectionId.value } },
    )
  },
  {
    server: false,
    default: () => null,
    watch: [organizationSlug, connectionId, selectedThreadId],
  },
)

const selectedThread = computed(() => selectedThreadPayload.value?.data ?? null)
const folderById = computed(() => new Map(
  threadPayload.value.folders.map(folder => [folder.id, folder]),
))
const folderTabs = computed(() => folderConfiguration.map((folder) => {
  const counts = folderById.value.get(folder.id)
  const count = folder.id === 'DRAFT'
    ? positiveCount(counts?.messagesTotal)
    : positiveCount(counts?.messagesUnread)
  return {
    label: folder.label,
    icon: folder.icon,
    count,
    active: activeFolder.value === folder.id,
    to: {
      path: route.path,
      query: {
        account: connectionId.value,
        folder: folder.query,
      },
    },
  }
}))
const activeFolderLabel = computed(() => (
  folderConfiguration.find(folder => folder.id === activeFolder.value)?.label ?? 'Odebrane'
))
const currentPageNumber = computed(() => previousPageTokens.value.length + 1)
const hasPreviousPage = computed(() => previousPageTokens.value.length > 0)
const resultAnnouncement = computed(() => {
  if (threadsStatus.value === 'pending') return 'Ładowanie wiadomości'
  const count = threadPayload.value.data.length
  if (searchQuery.value) return `${count} wyników na tej stronie dla wyszukiwania „${searchQuery.value}”`
  return `${count} wątków na tej stronie folderu ${activeFolderLabel.value}`
})
const lastRefreshedLabel = computed(() => {
  if (!lastRefreshedAt.value) return ''
  return new Intl.DateTimeFormat('pl-PL', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(lastRefreshedAt.value)
})

watch(threadsStatus, (status) => {
  if (status === 'success' && connectionId.value) lastRefreshedAt.value = Date.now()
}, { immediate: true })

const AUTO_REFRESH_INTERVAL_MS = 5 * 60_000
const FOCUS_REFRESH_STALE_MS = 60_000
let autoRefreshTimer: number | undefined

function refreshWhenVisible(): void {
  if (
    document.visibilityState !== 'visible'
    || refreshing.value
    || composerOpen.value
    || connectionModalOpen.value
    || !connectionId.value
  ) return
  if (
    lastRefreshedAt.value
    && Date.now() - lastRefreshedAt.value < FOCUS_REFRESH_STALE_MS
  ) return
  void refreshMailbox(false)
}

onMounted(() => {
  window.addEventListener('focus', refreshWhenVisible)
  document.addEventListener('visibilitychange', refreshWhenVisible)
  autoRefreshTimer = window.setInterval(refreshWhenVisible, AUTO_REFRESH_INTERVAL_MS)

  const status = queryText(route.query.mailStatus)
  const providerId = queryText(route.query.mailProvider) as MailProviderId
  const providerLabel = providers.value.find(provider => provider.id === providerId)?.label
    ?? 'Dostawca poczty'
  if (status === 'connected') {
    toast.add({
      title: 'Skrzynka została połączona',
      description: `${providerLabel} jest gotowy do odczytu i wysyłania wiadomości.`,
      color: 'success',
      icon: 'i-lucide-circle-check',
    })
  }
  else if (status === 'cancelled') {
    toast.add({
      title: 'Łączenie anulowane',
      description: 'Dostawca nie udzielił dostępu do skrzynki.',
      color: 'warning',
      icon: 'i-lucide-circle-alert',
    })
  }
  else if (status === 'permission_missing') {
    toast.add({
      title: 'Brakuje wymaganych uprawnień',
      description: 'Zezwól na odczyt i wysyłanie wiadomości, aby korzystać z klienta poczty.',
      color: 'warning',
      icon: 'i-lucide-shield-alert',
    })
  }
  else if (status === 'account_mismatch') {
    toast.add({
      title: 'Wybrano inne konto',
      description: 'Przy ponownym łączeniu wybierz tę samą skrzynkę co wcześniej.',
      color: 'warning',
      icon: 'i-lucide-user-round-x',
    })
  }
  else if (status === 'error') {
    toast.add({
      title: 'Nie udało się połączyć skrzynki',
      description: 'Sprawdź konfigurację dostawcy i spróbuj ponownie.',
      color: 'error',
      icon: 'i-lucide-circle-x',
    })
  }
  if (status || route.query.q !== undefined || route.query.mailProvider !== undefined) {
    const query = { ...route.query }
    delete query.mailStatus
    delete query.mailProvider
    delete query.q
    void router.replace({ path: route.path, query })
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('focus', refreshWhenVisible)
  document.removeEventListener('visibilitychange', refreshWhenVisible)
  if (autoRefreshTimer !== undefined) window.clearInterval(autoRefreshTimer)
})

function positiveCount(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && value > 0 ? value : undefined
}

function switchMailbox(nextConnectionId: string): void {
  if (!nextConnectionId || nextConnectionId === connectionId.value) return
  if (composerOpen.value) {
    toast.add({
      title: 'Dokończ lub odrzuć wiadomość',
      description: 'Konto nadawcy pozostaje zablokowane podczas edycji szkicu.',
      color: 'info',
      icon: 'i-lucide-file-pen-line',
    })
    return
  }
  searchQuery.value = ''
  searchInput.value = ''
  pageToken.value = ''
  previousPageTokens.value = []
  clearSelectedThread()
  void router.push({
    path: route.path,
    query: {
      account: nextConnectionId,
      folder: 'inbox',
    },
  })
}

function submitSearch(): void {
  if (!activeConnection.value?.capabilities.canSearch) return
  searchQuery.value = searchInput.value.trim()
  pageToken.value = ''
  previousPageTokens.value = []
  const query: Record<string, string> = {
    account: connectionId.value,
    folder: folderConfiguration.find(folder => folder.id === activeFolder.value)?.query || 'inbox',
  }
  void router.replace({ path: route.path, query })
}

function clearSearch(): void {
  searchInput.value = ''
  submitSearch()
}

function selectThread(thread: MailThreadSummary): void {
  void router.push({
    path: route.path,
    query: {
      account: connectionId.value,
      folder: folderConfiguration.find(folder => folder.id === activeFolder.value)?.query || 'inbox',
      thread: thread.id,
    },
  })
}

function closeThread(): void {
  const query = { ...route.query }
  delete query.thread
  clearSelectedThread()
  void router.push({ path: route.path, query })
}

function openConnectionModal(
  provider: MailProviderId | null = null,
  connection: MailConnectionInfo | null = null,
): void {
  connectionModalProvider.value = provider
  reconnectConnection.value = connection
  connectionModalOpen.value = true
}

async function handleConnectionCreated(connection: MailConnectionInfo): Promise<void> {
  await refreshConnection()
  reconnectConnection.value = null
  connectionModalProvider.value = null
  switchMailbox(connection.id)
}

function openReconnect(): void {
  if (!activeConnection.value) return
  openConnectionModal(activeConnection.value.provider, activeConnection.value)
}

function openNewMessage(): void {
  if (!canSend.value || !activeConnection.value) {
    openReconnect()
    return
  }
  composerConnectionId.value = activeConnection.value.id
  composerDraft.to = ''
  composerDraft.cc = ''
  composerDraft.subject = ''
  composerDraft.threadId = ''
  composerKey.value += 1
  composerOpen.value = true
}

function openReply(): void {
  if (!canSend.value || !activeConnection.value) {
    openReconnect()
    return
  }
  const thread = selectedThread.value
  const latest = thread?.messages.at(-1)
  const accountEmail = activeConnection.value.accountEmail.trim().toLowerCase()
  if (!thread || !latest || !accountEmail) return

  const fromEmail = latest.from?.email?.toLowerCase() || ''
  const primary = fromEmail && fromEmail !== accountEmail
    ? uniqueAddressEmails(latest.replyTo.length ? latest.replyTo : [latest.from!], accountEmail)
    : uniqueAddressEmails(latest.to, accountEmail)
  if (!primary.length) {
    toast.add({
      title: 'Nie znaleziono odbiorcy odpowiedzi',
      description: 'Otwórz wiadomość u dostawcy, aby odpowiedzieć bezpośrednio.',
      color: 'warning',
      icon: 'i-lucide-circle-alert',
    })
    return
  }

  composerConnectionId.value = activeConnection.value.id
  composerDraft.to = primary.join(', ')
  composerDraft.cc = ''
  composerDraft.subject = thread.subject
  composerDraft.threadId = thread.id
  composerKey.value += 1
  composerOpen.value = true
}

function uniqueAddressEmails(addresses: MailAddress[], excludedEmail: string): string[] {
  const seen = new Set<string>()
  return addresses
    .map(address => address.email?.trim() || '')
    .filter((email) => {
      const key = email.toLowerCase()
      if (!key || key === excludedEmail || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

async function handleMessageSent(result: MailSendPayload['data']): Promise<void> {
  const wasReply = Boolean(composerDraft.threadId)
  const sender = composerConnection.value
  toast.add({
    title: wasReply ? 'Odpowiedź została wysłana' : 'Wiadomość została wysłana',
    description: `Dostawca potwierdził wysyłkę z konta ${sender?.accountEmail || ''}.`,
    color: 'success',
    icon: 'i-lucide-send',
  })
  await refreshThreads()
  if (selectedThreadId.value && result.threadId === selectedThreadId.value) {
    await refreshSelectedThread()
  }
}

async function refreshMailbox(showToast = true): Promise<void> {
  if (refreshing.value || !connectionId.value) return
  refreshing.value = true
  try {
    await refreshConnection()
    await refreshThreads()
    if (selectedThreadId.value) await refreshSelectedThread()
    lastRefreshedAt.value = Date.now()
    if (showToast) {
      toast.add({
        title: 'Poczta odświeżona',
        description: activeConnection.value?.accountEmail,
        color: 'success',
        icon: 'i-lucide-refresh-cw',
      })
    }
  }
  catch (error) {
    if (showToast) {
      toast.add({
        title: 'Nie udało się odświeżyć poczty',
        description: apiErrorMessage(error),
        color: 'error',
      })
    }
  }
  finally {
    refreshing.value = false
  }
}

async function disconnectMailbox(): Promise<void> {
  const target = disconnectTarget.value
  if (!target || disconnecting.value) return
  disconnecting.value = true
  try {
    await $fetch(
      orgApiPath(`/mail-connections/${encodeURIComponent(target.id)}`),
      { method: 'DELETE' },
    )
    if (composerConnectionId.value === target.id) composerOpen.value = false
    disconnectTarget.value = null
    await refreshConnection()
    if (connectionId.value === target.id) {
      clearSelectedThread()
      const query = { ...route.query }
      delete query.account
      delete query.thread
      void router.replace({ path: route.path, query })
    }
    toast.add({
      title: 'Skrzynka została odłączona',
      description: `${target.accountEmail} usunięto z OpenExpert.`,
      color: 'success',
      icon: 'i-lucide-unplug',
    })
  }
  catch (error) {
    toast.add({
      title: 'Nie udało się odłączyć skrzynki',
      description: apiErrorMessage(error),
      color: 'error',
    })
  }
  finally {
    disconnecting.value = false
  }
}

function nextPage(): void {
  const nextToken = threadPayload.value.nextPageToken
  if (!nextToken) return
  previousPageTokens.value.push(pageToken.value)
  pageToken.value = nextToken
  closeThread()
}

function previousPage(): void {
  const previousToken = previousPageTokens.value.pop()
  if (previousToken === undefined) return
  pageToken.value = previousToken
  closeThread()
}

function formatThreadDate(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat('pl-PL', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date)
  }
  if (date.getFullYear() === today.getFullYear()) {
    return new Intl.DateTimeFormat('pl-PL', {
      day: 'numeric',
      month: 'short',
    }).format(date).replace('.', '')
  }
  return new Intl.DateTimeFormat('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  }).format(date)
}

function formatMessageDate(value: string | null): string {
  if (!value) return 'Brak daty'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Brak daty'
  return new Intl.DateTimeFormat('pl-PL', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatBytes(value: number): string {
  if (!value) return ''
  if (value < 1_024) return `${value} B`
  if (value < 1_024 * 1_024) return `${Math.round(value / 1_024)} KB`
  return `${(value / (1_024 * 1_024)).toFixed(1).replace('.', ',')} MB`
}

function addressListLabel(
  addresses: Array<{ label: string }>,
  emptyLabel = 'brak odbiorcy',
): string {
  return addresses.length ? addresses.map(address => address.label).join(', ') : emptyLabel
}

function senderInitial(value: string): string {
  return value.trim().charAt(0).toLocaleUpperCase('pl') || '?'
}

function securityWarningDescription(security: MailMessageSecurity): string {
  const warnings: string[] = []
  if (security.authentication === 'fail') {
    warnings.push('dostawca nie potwierdził SPF, DKIM lub DMARC tej wiadomości')
  }
  if (security.replyToMismatch) {
    warnings.push('adres odpowiedzi ma inną domenę niż widoczny nadawca')
  }
  return `${warnings.join('; ')}. Zweryfikuj nadawcę przed odpowiedzią lub otwarciem plików.`
}
</script>

<template>
  <div class="mail-page-root">
    <CrmShell
      title="Poczta"
      eyebrow="Komunikacja"
      description="Czytaj i wysyłaj wiadomości z Gmaila, Outlooka lub dowolnej skrzynki IMAP/SMTP."
      :tabs="activeConnection ? folderTabs : []"
    >
      <template v-if="activeConnection" #meta>
        <div class="mail-account-switcher">
          <USelectMenu
            v-model="selectedConnectionId"
            :items="accountItems"
            value-key="value"
            label-key="label"
            class="mail-account-switcher__select"
            :disabled="composerOpen"
            aria-label="Wybierz konto pocztowe"
          />
          <span class="mail-account-switcher__identity">
            <img
              v-if="activeConnection.providerIcon.startsWith('/')"
              :src="activeConnection.providerIcon"
              alt=""
            >
            <UIcon v-else :name="activeConnection.providerIcon" />
            <span>{{ activeConnection.accountEmail }}</span>
          </span>
          <UBadge
            :color="activeConnection.status === 'active' ? 'success' : 'warning'"
            variant="subtle"
            size="sm"
          >
            {{ activeConnection.status === 'active' ? 'Połączono' : 'Wymaga uwagi' }}
          </UBadge>
        </div>
      </template>

      <template #actions>
        <UButton
          v-if="canSend"
          icon="i-lucide-square-pen"
          @click="openNewMessage"
        >
          Napisz
        </UButton>
        <UButton
          v-else-if="activeConnection"
          icon="i-lucide-rotate-ccw-key"
          @click="openReconnect"
        >
          Połącz ponownie
        </UButton>
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-plus"
          :disabled="composerOpen"
          @click="openConnectionModal()"
        >
          Dodaj konto
        </UButton>
        <UButton
          v-if="activeConnection"
          color="neutral"
          variant="outline"
          square
          icon="i-lucide-refresh-cw"
          :loading="refreshing"
          aria-label="Odśwież aktywną skrzynkę"
          title="Odśwież aktywną skrzynkę"
          @click="refreshMailbox()"
        />
        <UButton
          v-if="activeConnection"
          color="error"
          variant="soft"
          square
          icon="i-lucide-unplug"
          aria-label="Odłącz aktywną skrzynkę"
          title="Odłącz aktywną skrzynkę"
          :disabled="composerOpen"
          @click="disconnectTarget = activeConnection"
        />
      </template>

      <UAlert
        v-if="connectionError"
        class="mail-alert"
        color="error"
        variant="subtle"
        icon="i-lucide-database-zap"
        title="Nie udało się odczytać konfiguracji poczty"
        :description="apiErrorMessage(connectionError)"
      />

      <div
        v-else-if="connectionStatus === 'pending'"
        class="mail-connection-loading"
        aria-label="Ładowanie kont pocztowych"
      >
        <USkeleton class="h-72 w-full rounded-[var(--oe-radius-surface)]" />
      </div>

      <section v-else-if="!activeConnection" class="mail-onboarding">
        <div class="mail-onboarding__hero">
          <span class="mail-onboarding__hero-icon" aria-hidden="true">
            <UIcon name="i-lucide-mails" />
          </span>
          <p class="mail-onboarding__eyebrow">Poczta w jednym miejscu</p>
          <h2>Połącz pierwszą skrzynkę</h2>
          <p class="mail-onboarding__description">
            Przeglądaj korespondencję i odpowiadaj bez opuszczania OpenExpert.
            Możesz dodać kilka prywatnych kont i przełączać je jednym kliknięciem.
          </p>
        </div>

        <div class="mail-onboarding__providers">
          <button
            v-for="provider in providers"
            :key="provider.id"
            type="button"
            class="mail-onboarding__provider"
            @click="openConnectionModal(provider.id)"
          >
            <span aria-hidden="true">
              <img v-if="provider.icon.startsWith('/')" :src="provider.icon" alt="">
              <UIcon v-else :name="provider.icon" />
            </span>
            <strong>{{ provider.label }}</strong>
            <small>{{ provider.description }}</small>
            <UBadge
              v-if="!provider.configured"
              color="warning"
              variant="subtle"
              size="xs"
            >
              Wymaga konfiguracji
            </UBadge>
          </button>
        </div>

        <UButton
          size="lg"
          icon="i-lucide-plus"
          @click="openConnectionModal()"
        >
          Dodaj konto pocztowe
        </UButton>

        <div class="mail-onboarding__assurances" aria-label="Informacje o bezpieczeństwie">
          <span><UIcon name="i-lucide-lock-keyhole" /> Szyfrowane poświadczenia</span>
          <span><UIcon name="i-lucide-image-off" /> Bez obrazów śledzących</span>
          <span><UIcon name="i-lucide-user-lock" /> Dostęp tylko dla właściciela</span>
          <span><UIcon name="i-lucide-unplug" /> Konto można odłączyć</span>
        </div>
      </section>

      <template v-else>
        <UAlert
          v-if="showReconnectNotice"
          class="mail-alert"
          color="warning"
          variant="subtle"
          icon="i-lucide-key-round"
          title="Ta skrzynka wymaga ponownego połączenia"
          :description="activeConnection.errorMessage || 'Dostawca odrzucił zapisane uprawnienie albo poprzednia próba dostępu nie powiodła się.'"
        >
          <template #actions>
            <UButton color="warning" variant="solid" size="sm" @click="openReconnect">
              Połącz ponownie
            </UButton>
          </template>
        </UAlert>

        <UAlert
          v-else-if="!activeConnection.capabilities.canSend"
          class="mail-alert"
          color="info"
          variant="subtle"
          icon="i-lucide-send"
          title="Wysyłanie nie jest dostępne"
          description="Połącz konto ponownie i udziel zgody na wysyłanie wiadomości."
        >
          <template #actions>
            <UButton color="info" variant="solid" size="sm" @click="openReconnect">
              Sprawdź połączenie
            </UButton>
          </template>
        </UAlert>

        <section
          class="mail-browser"
          :class="{ 'mail-browser--thread-open': selectedThreadId }"
          aria-label="Skrzynka pocztowa"
        >
          <div class="mail-list-pane">
            <form class="mail-toolbar" role="search" @submit.prevent="submitSearch">
              <UInput
                v-model="searchInput"
                class="mail-search"
                icon="i-lucide-search"
                placeholder="Szukaj w tej skrzynce"
                aria-label="Szukaj w aktywnej skrzynce"
                :maxlength="500"
                autocomplete="off"
                :spellcheck="false"
                :disabled="!activeConnection.capabilities.canSearch"
              >
                <template v-if="searchInput" #trailing>
                  <UButton
                    color="neutral"
                    variant="link"
                    square
                    size="xs"
                    icon="i-lucide-x"
                    aria-label="Wyczyść wyszukiwanie"
                    @click="clearSearch"
                  />
                </template>
              </UInput>
              <UButton
                type="submit"
                color="neutral"
                variant="solid"
                :disabled="!activeConnection.capabilities.canSearch"
              >
                Szukaj
              </UButton>
            </form>

            <div class="mail-list-summary">
              <div>
                <p>{{ activeFolderLabel }}</p>
                <span v-if="searchQuery">Wyniki dla „{{ searchQuery }}”</span>
                <span v-else>Strona {{ currentPageNumber }}</span>
                <span v-if="lastRefreshedLabel">Odświeżono o {{ lastRefreshedLabel }}</span>
              </div>
              <span aria-live="polite" class="mail-result-count">
                {{ threadPayload.data.length }}
              </span>
            </div>
            <ClientOnly>
              <p class="sr-only" aria-live="polite">{{ resultAnnouncement }}</p>
            </ClientOnly>

            <UAlert
              v-if="threadPayload.partialFailureCount"
              class="mail-list-warning"
              color="warning"
              variant="subtle"
              icon="i-lucide-cloud-alert"
              title="Niektórych wiadomości nie udało się pobrać"
              :description="`Pominięto ${threadPayload.partialFailureCount} wątków. Odśwież skrzynkę, aby spróbować ponownie.`"
            />

            <div
              v-if="threadsStatus === 'idle' || threadsStatus === 'pending'"
              class="mail-thread-skeletons"
            >
              <div v-for="index in 7" :key="index" class="mail-thread-skeleton">
                <USkeleton class="h-4 w-2/5" />
                <USkeleton class="h-4 w-4/5" />
                <USkeleton class="h-3 w-full" />
              </div>
            </div>

            <OeEmptyState
              v-else-if="threadsError"
              kind="error"
              title="Nie udało się pobrać wiadomości"
              :description="apiErrorMessage(threadsError)"
            >
              <template #actions>
                <UButton
                  color="neutral"
                  variant="solid"
                  icon="i-lucide-rotate-ccw-key"
                  @click="openReconnect"
                >
                  Sprawdź połączenie
                </UButton>
                <UButton color="neutral" variant="outline" icon="i-lucide-refresh-cw" @click="refreshThreads()">
                  Spróbuj ponownie
                </UButton>
              </template>
            </OeEmptyState>

            <OeEmptyState
              v-else-if="!threadPayload.data.length"
              :kind="searchQuery ? 'filtered' : 'empty'"
              :icon="searchQuery ? 'i-lucide-search-x' : 'i-lucide-mail-open'"
              :title="searchQuery ? 'Brak wyników' : 'Ten folder jest pusty'"
              :description="searchQuery
                ? 'Spróbuj krótszej frazy lub sprawdź inny folder.'
                : 'Nowe wiadomości pojawią się tutaj po odświeżeniu skrzynki.'"
            >
              <template v-if="searchQuery" #actions>
                <UButton color="neutral" variant="outline" @click="clearSearch">
                  Wyczyść wyszukiwanie
                </UButton>
              </template>
            </OeEmptyState>

            <div
              v-else
              class="mail-thread-list"
              role="listbox"
              aria-label="Wątki wiadomości"
            >
              <button
                v-for="thread in threadPayload.data"
                :key="thread.id"
                type="button"
                role="option"
                class="mail-thread"
                :class="{
                  'mail-thread--active': selectedThreadId === thread.id,
                  'mail-thread--unread': thread.unread,
                }"
                :aria-selected="selectedThreadId === thread.id"
                @click="selectThread(thread)"
              >
                <span class="mail-thread__topline">
                  <span class="mail-thread__sender">
                    <span v-if="thread.unread" class="mail-unread-dot" aria-hidden="true" />
                    <span class="mail-thread__sender-label">{{ thread.participantsLabel }}</span>
                    <span v-if="thread.messageCount > 1" class="mail-thread__count">
                      {{ thread.messageCount }}
                    </span>
                    <span v-if="thread.unread" class="sr-only">Nieprzeczytana</span>
                  </span>
                  <span class="mail-thread__date">{{ formatThreadDate(thread.latestAt) }}</span>
                </span>
                <span class="mail-thread__subject">
                  <UIcon v-if="thread.starred" name="i-lucide-star" aria-label="Oznaczona gwiazdką" />
                  <UIcon v-else-if="thread.draft" name="i-lucide-file-pen-line" aria-label="Szkic" />
                  <span>{{ thread.subject }}</span>
                  <UIcon
                    v-if="thread.hasAttachments"
                    name="i-lucide-paperclip"
                    class="mail-thread__attachment"
                    aria-label="Zawiera załącznik"
                  />
                </span>
                <span class="mail-thread__snippet">{{ thread.snippet || 'Brak podglądu treści.' }}</span>
              </button>
            </div>

            <footer
              v-if="hasPreviousPage || threadPayload.nextPageToken"
              class="mail-pagination"
              aria-label="Stronicowanie poczty"
            >
              <UButton
                color="neutral"
                variant="ghost"
                icon="i-lucide-chevron-left"
                :disabled="!hasPreviousPage"
                @click="previousPage"
              >
                Wstecz
              </UButton>
              <span>Strona {{ currentPageNumber }}</span>
              <UButton
                color="neutral"
                variant="ghost"
                trailing-icon="i-lucide-chevron-right"
                :disabled="!threadPayload.nextPageToken"
                @click="nextPage"
              >
                Dalej
              </UButton>
            </footer>
          </div>

          <article class="mail-detail-pane" aria-label="Treść wątku">
            <OeEmptyState
              v-if="!selectedThreadId"
              kind="selection"
              icon="i-lucide-mails"
              title="Wybierz wiadomość"
              description="Treść wybranego wątku pojawi się w tym miejscu."
            >
              <template #actions>
                <UButton v-if="canSend" icon="i-lucide-square-pen" @click="openNewMessage">
                  Napisz wiadomość
                </UButton>
              </template>
            </OeEmptyState>

            <div
              v-else-if="selectedThreadStatus === 'idle' || selectedThreadStatus === 'pending'"
              class="mail-detail-loading"
            >
              <USkeleton class="h-8 w-3/4" />
              <USkeleton class="h-4 w-2/5" />
              <USkeleton class="mt-8 h-44 w-full" />
              <USkeleton class="h-40 w-full" />
            </div>

            <OeEmptyState
              v-else-if="selectedThreadError"
              kind="error"
              icon="i-lucide-message-circle-x"
              title="Nie udało się otworzyć wątku"
              :description="apiErrorMessage(selectedThreadError)"
            >
              <template #actions>
                <UButton color="neutral" variant="outline" @click="refreshSelectedThread()">
                  Spróbuj ponownie
                </UButton>
              </template>
            </OeEmptyState>

            <div v-else-if="selectedThread" class="mail-detail">
              <div class="mail-detail__mobile-back">
                <UButton
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-arrow-left"
                  @click="closeThread"
                >
                  Wróć do wiadomości
                </UButton>
              </div>

              <header class="mail-detail__header">
                <div>
                  <p class="mail-detail__eyebrow">
                    Wątek · {{ selectedThread.messages.length }} wiadomości
                  </p>
                  <h2>{{ selectedThread.subject }}</h2>
                </div>
                <div class="mail-detail__actions">
                  <UButton v-if="canSend" icon="i-lucide-reply" @click="openReply">
                    Odpowiedz
                  </UButton>
                  <UButton
                    v-if="selectedThread.externalUrl"
                    :href="selectedThread.externalUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    color="neutral"
                    variant="outline"
                    icon="i-lucide-external-link"
                  >
                    Otwórz u dostawcy
                  </UButton>
                </div>
              </header>

              <UAlert
                v-if="selectedThread.omittedMessageCount"
                class="mail-detail__notice"
                color="info"
                variant="subtle"
                icon="i-lucide-info"
                :title="`Pominięto ${selectedThread.omittedMessageCount} starszych wiadomości`"
                description="Pełny wątek możesz otworzyć bezpośrednio u dostawcy poczty."
              />

              <div class="mail-message-stack">
                <section
                  v-for="message in selectedThread.messages"
                  :key="message.id"
                  class="mail-message"
                >
                  <header class="mail-message__header">
                    <span class="mail-message__avatar" aria-hidden="true">
                      {{ senderInitial(message.from?.label || '') }}
                    </span>
                    <div class="mail-message__identity">
                      <div class="mail-message__sender-row">
                        <strong>{{ message.from?.label || 'Nieznany nadawca' }}</strong>
                        <UBadge v-if="message.unread" color="primary" variant="subtle" size="xs">
                          Nieprzeczytana
                        </UBadge>
                        <UBadge
                          v-if="message.security.authentication === 'pass'"
                          color="success"
                          variant="subtle"
                          size="xs"
                          title="Wynik SPF, DKIM lub DMARC przekazany przez dostawcę jest poprawny. Nie oznacza to, że treść wiadomości jest bezpieczna."
                        >
                          Domena uwierzytelniona
                        </UBadge>
                      </div>
                      <span v-if="message.from?.email">{{ message.from.email }}</span>
                      <span title="Odbiorcy">do: {{ addressListLabel(message.to) }}</span>
                      <span v-if="message.cc.length" title="Kopia">
                        DW: {{ addressListLabel(message.cc) }}
                      </span>
                    </div>
                    <time :datetime="message.sentAt || undefined">
                      {{ formatMessageDate(message.sentAt) }}
                    </time>
                  </header>

                  <UAlert
                    v-if="message.security.authentication === 'fail' || message.security.replyToMismatch"
                    class="mail-message__security-warning"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-shield-alert"
                    title="Zweryfikuj nadawcę"
                    :description="securityWarningDescription(message.security)"
                  />

                  <div class="mail-message__body">
                    {{ message.bodyText || 'Ta wiadomość nie zawiera tekstu możliwego do wyświetlenia.' }}
                  </div>

                  <UAlert
                    v-if="message.bodyTruncated"
                    class="mail-message__truncated"
                    color="info"
                    variant="subtle"
                    icon="i-lucide-scissors-line-dashed"
                    title="Podgląd został skrócony"
                    description="Pełną treść zobaczysz po otwarciu wiadomości u dostawcy."
                  />

                  <div v-if="message.attachments.length" class="mail-attachments">
                    <p><UIcon name="i-lucide-paperclip" /> Załączniki</p>
                    <div class="mail-attachments__list">
                      <div
                        v-for="attachment in message.attachments"
                        :key="`${message.id}:${attachment.filename}:${attachment.id}`"
                        class="mail-attachment"
                      >
                        <UIcon name="i-lucide-file" />
                        <span>
                          <strong>{{ attachment.filename }}</strong>
                          <small>
                            {{ attachment.mimeType }}
                            <template v-if="attachment.size"> · {{ formatBytes(attachment.size) }}</template>
                          </small>
                        </span>
                      </div>
                    </div>
                    <p class="mail-attachments__notice">
                      Odebrane pliki pozostają u dostawcy i nie są pobierane do CRM.
                    </p>
                  </div>
                </section>
              </div>
            </div>
          </article>
        </section>
      </template>
    </CrmShell>

    <MailConnectionModal
      v-model:open="connectionModalOpen"
      :providers="providers"
      :connections-path="connectionsPath"
      :initial-provider="connectionModalProvider"
      :reconnect-connection="reconnectConnection"
      @connected="handleConnectionCreated"
    />

    <MailComposerSlideover
      v-if="composerConnection"
      :key="composerKey"
      v-model:open="composerOpen"
      :endpoint="sendEndpoint"
      :connection-id="composerConnection.id"
      :provider="composerConnection.provider"
      :provider-label="composerConnection.providerLabel"
      :provider-icon="composerConnection.providerIcon"
      :account-email="composerConnection.accountEmail"
      :external-sent-url="composerConnection.externalSentUrl"
      :max-attachment-bytes="composerConnection.capabilities.maxAttachmentBytes"
      :max-total-attachment-bytes="composerConnection.capabilities.maxTotalAttachmentBytes"
      :initial-to="composerDraft.to"
      :initial-cc="composerDraft.cc"
      :initial-subject="composerDraft.subject"
      :thread-id="composerDraft.threadId"
      @sent="handleMessageSent"
    />

    <UModal
      :open="Boolean(disconnectTarget)"
      title="Odłączyć skrzynkę?"
      :description="disconnectTarget
        ? `${disconnectTarget.accountEmail} zniknie z OpenExpert. Wiadomości pozostaną u dostawcy.`
        : undefined"
      :dismissible="!disconnecting"
      :ui="{ footer: 'justify-end' }"
      @update:open="value => { if (!value && !disconnecting) disconnectTarget = null }"
    >
      <template #body>
        <UAlert
          color="warning"
          variant="subtle"
          icon="i-lucide-shield-alert"
          title="Usuniemy tylko połączenie"
          description="OpenExpert usunie zapisane tokeny lub szyfrowane poświadczenia. Żadna wiadomość nie zostanie usunięta ze skrzynki."
        />
      </template>
      <template #footer>
        <UButton
          color="neutral"
          variant="outline"
          :disabled="disconnecting"
          @click="disconnectTarget = null"
        >
          Anuluj
        </UButton>
        <UButton
          color="error"
          icon="i-lucide-unplug"
          :loading="disconnecting"
          @click="disconnectMailbox"
        >
          Odłącz konto
        </UButton>
      </template>
    </UModal>
  </div>
</template>

<style scoped>
.mail-alert {
  margin-bottom: 18px;
}

.mail-connection-loading {
  width: min(100%, 780px);
  margin-inline: auto;
}

.mail-account-switcher {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.mail-account-switcher__select {
  width: min(280px, 72vw);
}

.mail-account-switcher__identity {
  display: inline-flex;
  max-width: 300px;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mail-account-switcher__identity img,
.mail-account-switcher__identity :deep(svg) {
  flex: 0 0 auto;
  width: 17px;
  height: 17px;
}

.mail-onboarding {
  display: grid;
  width: min(100%, 880px);
  justify-items: center;
  gap: 24px;
  margin-inline: auto;
  padding: clamp(28px, 5vw, 56px) clamp(16px, 4vw, 40px);
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background:
    radial-gradient(circle at 50% 0%, color-mix(in srgb, var(--ui-primary) 10%, transparent), transparent 42%),
    var(--ui-bg);
  text-align: center;
}

.mail-onboarding__hero {
  display: grid;
  justify-items: center;
}

.mail-onboarding__hero-icon {
  display: grid;
  place-items: center;
  width: 72px;
  height: 72px;
  margin-bottom: 20px;
  border: 1px solid var(--ui-border);
  border-radius: 22px;
  color: var(--ui-text-highlighted);
  background: var(--ui-bg-elevated);
  box-shadow: 0 16px 42px color-mix(in srgb, var(--ui-text-highlighted) 8%, transparent);
}

.mail-onboarding__hero-icon :deep(svg) {
  width: 34px;
  height: 34px;
}

.mail-onboarding__eyebrow {
  margin: 0 0 8px;
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.mail-onboarding h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: clamp(27px, 4vw, 40px);
  font-weight: 430;
  line-height: 1.12;
}

.mail-onboarding__description {
  max-width: 620px;
  margin: 14px 0 0;
  color: var(--ui-text-muted);
  font-size: 14px;
  line-height: 1.65;
}

.mail-onboarding__providers {
  display: grid;
  width: 100%;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.mail-onboarding__provider {
  display: grid;
  min-width: 0;
  justify-items: start;
  gap: 7px;
  padding: 18px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  color: var(--ui-text);
  background: var(--ui-bg-muted);
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--oe-motion-fast),
    background-color var(--oe-motion-fast),
    transform var(--oe-motion-fast);
}

.mail-onboarding__provider:hover {
  border-color: var(--ui-border-accented);
  background: var(--ui-bg-elevated);
  transform: translateY(-2px);
}

.mail-onboarding__provider:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 2px;
}

.mail-onboarding__provider > span:first-child {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: var(--ui-bg);
}

.mail-onboarding__provider img,
.mail-onboarding__provider :deep(svg) {
  width: 22px;
  height: 22px;
}

.mail-onboarding__provider strong {
  color: var(--ui-text-highlighted);
  font-size: 14px;
}

.mail-onboarding__provider small {
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.45;
}

.mail-onboarding__assurances {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px 18px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.mail-onboarding__assurances span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.mail-browser {
  container-type: inline-size;
  display: grid;
  grid-template-columns: minmax(310px, 390px) minmax(0, 1fr);
  height: min(820px, calc(100dvh - 250px));
  min-height: 620px;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background: var(--ui-bg);
}

.mail-list-pane {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  border-right: 1px solid var(--ui-border);
  background: var(--ui-bg);
}

.mail-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  padding: 14px;
  border-bottom: 1px solid var(--ui-border);
}

.mail-search {
  width: 100%;
}

.mail-list-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--ui-border);
}

.mail-list-summary p {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 650;
}

.mail-list-summary span {
  color: var(--ui-text-muted);
  font-size: 11px;
}

.mail-list-summary div > span + span::before {
  content: ' · ';
}

.mail-list-warning {
  margin: 12px;
}

.mail-result-count {
  display: grid;
  place-items: center;
  min-width: 27px;
  height: 24px;
  padding-inline: 7px;
  border-radius: 999px;
  background: var(--ui-bg-elevated);
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 10px !important;
}

.mail-thread-skeletons {
  min-height: 0;
  overflow: hidden;
}

.mail-thread-skeleton {
  display: grid;
  gap: 9px;
  padding: 17px 16px;
  border-bottom: 1px solid var(--ui-border);
}

.mail-thread-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.mail-thread {
  position: relative;
  display: grid;
  width: 100%;
  gap: 6px;
  padding: 15px 16px 16px;
  border: 0;
  border-bottom: 1px solid var(--ui-border);
  color: var(--ui-text);
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition:
    background-color var(--oe-motion-fast),
    box-shadow var(--oe-motion-fast);
}

.mail-thread:hover {
  background: var(--ui-bg-muted);
}

.mail-thread:focus-visible {
  z-index: 1;
  outline: 2px solid var(--ui-primary);
  outline-offset: -2px;
}

.mail-thread--active {
  background: var(--ui-bg-elevated);
  box-shadow: inset 3px 0 0 var(--ui-primary);
}

.mail-thread__topline,
.mail-thread__sender,
.mail-thread__subject {
  display: flex;
  min-width: 0;
  align-items: center;
}

.mail-thread__topline {
  justify-content: space-between;
  gap: 12px;
}

.mail-thread__sender {
  gap: 7px;
  overflow: hidden;
}

.mail-thread__sender-label,
.mail-thread__subject span,
.mail-thread__snippet {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mail-thread__sender-label {
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 520;
}

.mail-thread--unread .mail-thread__sender-label,
.mail-thread--unread .mail-thread__subject span {
  font-weight: 720;
}

.mail-unread-dot {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--ui-primary);
}

.mail-thread__count,
.mail-thread__date {
  flex: 0 0 auto;
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
}

.mail-thread__subject {
  gap: 6px;
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.mail-thread__subject :deep(svg) {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  color: var(--ui-text-muted);
}

.mail-thread__attachment {
  margin-left: auto;
}

.mail-thread__snippet {
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.mail-pagination {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 6px;
  padding: 9px 10px;
  border-top: 1px solid var(--ui-border);
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
}

.mail-pagination :deep(button:last-child) {
  justify-self: end;
}

.mail-detail-pane {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  background: var(--ui-bg-muted);
}

.mail-detail-loading {
  display: grid;
  gap: 14px;
  padding: 34px;
}

.mail-detail {
  min-height: 100%;
  padding: 30px 32px 110px;
}

.mail-detail__mobile-back {
  display: none;
}

.mail-detail__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding-bottom: 24px;
}

.mail-detail__eyebrow {
  margin: 0 0 7px;
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: .06em;
  text-transform: uppercase;
}

.mail-detail__header h2 {
  max-width: 760px;
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: clamp(24px, 2.8vw, 34px);
  font-weight: 420;
  line-height: 1.2;
  overflow-wrap: anywhere;
}

.mail-detail__actions {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.mail-detail__notice {
  margin-bottom: 16px;
}

.mail-message-stack {
  display: grid;
  gap: 14px;
}

.mail-message {
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background: var(--ui-bg);
}

.mail-message__header {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: 12px;
  padding: 18px 20px;
  border-bottom: 1px solid var(--ui-border);
}

.mail-message__avatar {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 999px;
  color: var(--ui-text-inverted);
  background: var(--ui-bg-inverted);
  font-size: 14px;
  font-weight: 700;
}

.mail-message__identity {
  display: grid;
  min-width: 0;
  gap: 2px;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.45;
}

.mail-message__identity > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mail-message__sender-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.mail-message__sender-row strong {
  overflow: hidden;
  text-overflow: ellipsis;
}

.mail-message__header time {
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 9px;
  line-height: 1.5;
  text-align: right;
}

.mail-message__body {
  padding: 24px 22px 28px;
  color: var(--ui-text);
  font-size: 14px;
  line-height: 1.65;
  overflow-wrap: anywhere;
  unicode-bidi: plaintext;
  white-space: pre-wrap;
}

.mail-message__security-warning {
  margin: 16px 20px 0;
}

.mail-message__truncated {
  margin: 0 20px 20px;
}

.mail-attachments {
  padding: 18px 20px 20px;
  border-top: 1px solid var(--ui-border);
  background: var(--ui-bg-muted);
}

.mail-attachments > p:first-child {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 0 11px;
  color: var(--ui-text-highlighted);
  font-size: 12px;
  font-weight: 650;
}

.mail-attachments__list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 8px;
}

.mail-attachment {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
  padding: 10px 11px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  color: var(--ui-text-muted);
  background: var(--ui-bg);
}

.mail-attachment > :deep(svg) {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
}

.mail-attachment span {
  display: grid;
  min-width: 0;
}

.mail-attachment strong,
.mail-attachment small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mail-attachment strong {
  color: var(--ui-text-highlighted);
  font-size: 11px;
}

.mail-attachment small {
  margin-top: 2px;
  font-size: 9px;
}

.mail-attachments__notice {
  margin: 10px 0 0;
  color: var(--ui-text-dimmed);
  font-size: 10px;
}

@container (max-width: 820px) {
  .mail-browser {
    grid-template-columns: minmax(0, 1fr);
  }

  .mail-list-pane {
    border-right: 0;
  }

  .mail-detail-pane {
    display: none;
  }

  .mail-browser--thread-open .mail-list-pane {
    display: none;
  }

  .mail-browser--thread-open .mail-detail-pane {
    display: block;
  }

  .mail-detail__mobile-back {
    display: block;
    margin: -12px 0 16px -10px;
  }
}

@media (max-width: 760px) {
  .mail-onboarding__providers {
    grid-template-columns: minmax(0, 1fr);
  }

  .mail-onboarding__provider {
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
  }

  .mail-onboarding__provider > span:first-child {
    grid-row: 1 / span 3;
  }

  .mail-onboarding__provider small,
  .mail-onboarding__provider :deep(.badge) {
    grid-column: 2;
  }
}

@media (max-width: 680px) {
  .mail-account-switcher__identity {
    display: none;
  }

  .mail-onboarding {
    padding-inline: 14px;
  }

  .mail-onboarding__assurances {
    display: grid;
  }

  .mail-browser {
    height: calc(100dvh - 220px);
    min-height: 560px;
  }

  .mail-toolbar {
    grid-template-columns: minmax(0, 1fr);
  }

  .mail-toolbar :deep(button[type="submit"]) {
    width: 100%;
  }

  .mail-detail {
    padding: 20px 16px 100px;
  }

  .mail-detail__header {
    display: grid;
  }

  .mail-detail__actions {
    justify-content: stretch;
  }

  .mail-detail__actions :deep(a),
  .mail-detail__actions :deep(button) {
    flex: 1 1 auto;
    justify-content: center;
  }

  .mail-message__header {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .mail-message__header time {
    grid-column: 2;
    text-align: left;
  }

  .mail-message__body {
    padding: 20px 17px 24px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .mail-thread,
  .mail-onboarding__provider {
    transition: none;
  }
}
</style>
