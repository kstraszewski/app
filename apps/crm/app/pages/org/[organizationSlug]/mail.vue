<script setup lang="ts">
import type {
  MailAddress,
  MailConnectionPayload,
  MailFolderId,
  MailFolderSummary,
  MailSendPayload,
  MailThreadDetailPayload,
  MailThreadListPayload,
  MailThreadSummary,
} from '#shared/types/mail'
import { apiErrorMessage } from '~/utils/api-error'

definePageMeta({ middleware: ['auth', 'organization'] })
useHead({ title: 'Poczta — OpenExpert CRM' })

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
  configured: false,
  provider: {
    id: 'google',
    label: 'Gmail',
    connectPath: null,
  },
  connection: null,
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
})

function queryText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function folderFromQuery(value: unknown): MailFolderId {
  const normalized = queryText(value).toLowerCase()
  return folderConfiguration.find(folder => folder.query === normalized)?.id ?? 'INBOX'
}

const activeFolder = computed(() => folderFromQuery(route.query.folder))
const selectedThreadId = computed(() => {
  const value = queryText(route.query.thread)
  return /^[A-Za-z0-9_-]{1,256}$/u.test(value) ? value : ''
})
const searchQuery = computed(() => queryText(route.query.q).trim())
const searchInput = ref(searchQuery.value)
const pageToken = ref('')
const previousPageTokens = ref<string[]>([])
const disconnectConfirmationOpen = ref(false)
const disconnecting = ref(false)
const refreshing = ref(false)
const composerOpen = ref(false)
const composerKey = ref(0)
const composerDraft = reactive({
  to: '',
  cc: '',
  subject: '',
  threadId: '',
})

watch(searchQuery, value => {
  searchInput.value = value
})

watch([activeFolder, searchQuery, organizationSlug], () => {
  pageToken.value = ''
  previousPageTokens.value = []
})

const {
  data: connectionPayload,
  status: connectionStatus,
  error: connectionError,
  refresh: refreshConnection,
} = await useAsyncData<MailConnectionPayload>(
  `mail-connection:${organizationSlug.value}`,
  () => requestFetch<MailConnectionPayload>(orgApiPath('/mail-connections')),
  {
    default: emptyConnectionPayload,
    watch: [organizationSlug],
  },
)

const connection = computed(() => connectionPayload.value.connection)
const connectionId = computed(() => connection.value?.id ?? '')
const hasSendPermission = computed(() => Boolean(connection.value?.capabilities.canSend))
const canSend = computed(() => (
  connection.value?.status === 'active'
  && hasSendPermission.value
))
const sendEndpoint = computed(() => orgApiPath('/mail/messages'))

const {
  data: threadPayload,
  status: threadsStatus,
  error: threadsError,
  refresh: refreshThreads,
} = await useAsyncData<MailThreadListPayload>(
  `mail-threads:${organizationSlug.value}`,
  async () => {
    if (!connectionId.value) return emptyThreadPayload()
    return requestFetch<MailThreadListPayload>(orgApiPath('/mail/threads'), {
      query: {
        folder: activeFolder.value,
        q: searchQuery.value || undefined,
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
        folder: folder.query,
        ...(searchQuery.value ? { q: searchQuery.value } : {}),
      },
    },
  }
}))
const activeFolderLabel = computed(() => (
  folderConfiguration.find(folder => folder.id === activeFolder.value)?.label ?? 'Odebrane'
))
const currentPageNumber = computed(() => previousPageTokens.value.length + 1)
const hasPreviousPage = computed(() => previousPageTokens.value.length > 0)
const gmailAccountUrl = computed(() => {
  const email = connection.value?.accountEmail
  return email
    ? `https://mail.google.com/mail/u/${encodeURIComponent(email)}/`
    : 'https://mail.google.com/'
})
const showReconnectNotice = computed(() => (
  connection.value?.status === 'revoked'
  || connection.value?.status === 'error'
))
const resultAnnouncement = computed(() => {
  if (threadsStatus.value === 'pending') return 'Ładowanie wiadomości'
  const count = threadPayload.value.data.length
  if (searchQuery.value) return `${count} wyników na tej stronie dla wyszukiwania „${searchQuery.value}”`
  return `${count} wątków na tej stronie folderu ${activeFolderLabel.value}`
})

onMounted(() => {
  const status = queryText(route.query.mailStatus)
  if (status === 'connected') {
    toast.add({
      title: 'Gmail został połączony',
      description: 'Możesz teraz przeglądać i wysyłać wiadomości w CRM.',
      color: 'success',
      icon: 'i-lucide-circle-check',
    })
  } else if (status === 'cancelled') {
    toast.add({
      title: 'Łączenie anulowane',
      description: 'Google nie udzielił dostępu do skrzynki.',
      color: 'warning',
      icon: 'i-lucide-circle-alert',
    })
  } else if (status === 'permission_missing') {
    toast.add({
      title: 'Wysyłanie nie zostało włączone',
      description: 'Google nie otrzymał zgody na wysyłanie wiadomości. Odczyt poczty nadal działa.',
      color: 'warning',
      icon: 'i-lucide-send-horizontal',
    })
  } else if (status === 'account_mismatch') {
    toast.add({
      title: 'Wybrano inne konto Gmail',
      description: `Aby rozszerzyć uprawnienia, wybierz konto ${connection.value?.accountEmail || 'połączone z CRM'}.`,
      color: 'warning',
      icon: 'i-lucide-user-round-x',
    })
  } else if (status === 'error') {
    toast.add({
      title: 'Nie udało się połączyć Gmaila',
      description: 'Sprawdź konfigurację OAuth i spróbuj ponownie.',
      color: 'error',
      icon: 'i-lucide-circle-x',
    })
  }
  if (status) {
    const query = { ...route.query }
    delete query.mailStatus
    void router.replace({ query })
  }
})

function positiveCount(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && value > 0 ? value : undefined
}

function submitSearch() {
  const q = searchInput.value.trim()
  void router.push({
    path: route.path,
    query: {
      folder: folderConfiguration.find(folder => folder.id === activeFolder.value)?.query,
      ...(q ? { q } : {}),
    },
  })
}

function clearSearch() {
  searchInput.value = ''
  submitSearch()
}

function selectThread(thread: MailThreadSummary) {
  void router.push({
    path: route.path,
    query: {
      folder: folderConfiguration.find(folder => folder.id === activeFolder.value)?.query,
      ...(searchQuery.value ? { q: searchQuery.value } : {}),
      thread: thread.id,
    },
  })
}

function closeThread() {
  const query = { ...route.query }
  delete query.thread
  clearSelectedThread()
  void router.push({ path: route.path, query })
}

function connectGmail() {
  const connectPath = connectionPayload.value.provider.connectPath
  if (import.meta.client && connectPath) window.location.assign(connectPath)
}

function openNewMessage(): void {
  if (!canSend.value) {
    connectGmail()
    return
  }
  composerDraft.to = ''
  composerDraft.cc = ''
  composerDraft.subject = ''
  composerDraft.threadId = ''
  composerKey.value += 1
  composerOpen.value = true
}

function openReply(): void {
  if (!canSend.value) {
    connectGmail()
    return
  }
  const thread = selectedThread.value
  const latest = thread?.messages.at(-1)
  const accountEmail = connection.value?.accountEmail.trim().toLowerCase() || ''
  if (!thread || !latest || !accountEmail) return

  const fromEmail = latest.from?.email?.toLowerCase() || ''
  const primary = fromEmail && fromEmail !== accountEmail
    ? uniqueAddressEmails(latest.replyTo.length ? latest.replyTo : [latest.from!], accountEmail)
    : uniqueAddressEmails(latest.to, accountEmail)
  if (!primary.length) {
    toast.add({
      title: 'Nie znaleziono odbiorcy odpowiedzi',
      description: 'Otwórz wątek w Gmailu, aby odpowiedzieć na tę wiadomość.',
      color: 'warning',
      icon: 'i-lucide-circle-alert',
    })
    return
  }

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
  toast.add({
    title: wasReply ? 'Odpowiedź została wysłana' : 'Wiadomość została wysłana',
    description: `Gmail zapisał ją w folderze Wysłane konta ${connection.value?.accountEmail || ''}.`,
    color: 'success',
    icon: 'i-lucide-send',
  })
  await refreshThreads()
  if (selectedThreadId.value && result.threadId === selectedThreadId.value) {
    await refreshSelectedThread()
  }
}

async function refreshMailbox() {
  if (refreshing.value) return
  refreshing.value = true
  try {
    await refreshConnection()
    await refreshThreads()
    if (selectedThreadId.value) await refreshSelectedThread()
    toast.add({
      title: 'Poczta odświeżona',
      color: 'success',
      icon: 'i-lucide-refresh-cw',
    })
  } catch (error) {
    toast.add({
      title: 'Nie udało się odświeżyć poczty',
      description: apiErrorMessage(error),
      color: 'error',
    })
  } finally {
    refreshing.value = false
  }
}

async function disconnectGmail() {
  if (!connection.value || disconnecting.value) return
  disconnecting.value = true
  try {
    await $fetch(
      orgApiPath(`/mail-connections/${encodeURIComponent(connection.value.id)}`),
      { method: 'DELETE' },
    )
    disconnectConfirmationOpen.value = false
    composerOpen.value = false
    pageToken.value = ''
    previousPageTokens.value = []
    await refreshConnection()
    await refreshThreads()
    closeThread()
    toast.add({
      title: 'Gmail został odłączony',
      description: 'Token dostępu usunięto z CRM.',
      color: 'success',
      icon: 'i-lucide-unplug',
    })
  } catch (error) {
    toast.add({
      title: 'Nie udało się odłączyć Gmaila',
      description: apiErrorMessage(error),
      color: 'error',
    })
  } finally {
    disconnecting.value = false
  }
}

function nextPage() {
  const nextToken = threadPayload.value.nextPageToken
  if (!nextToken) return
  previousPageTokens.value.push(pageToken.value)
  pageToken.value = nextToken
  closeThread()
}

function previousPage() {
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
</script>

<template>
  <div class="mail-page-root">
    <CrmShell
      title="Poczta"
      eyebrow="Komunikacja"
      description="Przeglądaj i wysyłaj wiadomości z połączonej skrzynki Gmail bez opuszczania CRM."
      :tabs="connection ? folderTabs : []"
    >
    <template v-if="connection" #meta>
      <div class="mail-account-meta">
        <img src="/assets/google-icon.svg" alt="" class="mail-account-meta__icon">
        <span>{{ connection.accountEmail }}</span>
        <UBadge
          :color="connection.status === 'active' ? 'success' : 'warning'"
          variant="subtle"
          size="sm"
        >
          {{ connection.status === 'active' ? 'Połączono' : 'Wymaga uwagi' }}
        </UBadge>
        <UBadge color="neutral" variant="subtle" size="sm">
          {{ hasSendPermission ? 'Odczyt i wysyłanie' : 'Tylko odczyt' }}
        </UBadge>
      </div>
    </template>

    <template v-if="connection" #actions>
      <UButton
        v-if="canSend"
        icon="i-lucide-square-pen"
        @click="openNewMessage"
      >
        Napisz
      </UButton>
      <UButton
        v-else-if="connectionPayload.provider.connectPath"
        icon="i-lucide-send"
        @click="connectGmail"
      >
        {{ showReconnectNotice ? 'Połącz ponownie' : 'Włącz wysyłanie' }}
      </UButton>
      <UButton
        color="neutral"
        variant="outline"
        square
        icon="i-lucide-refresh-cw"
        :loading="refreshing"
        aria-label="Odśwież pocztę"
        title="Odśwież pocztę"
        @click="refreshMailbox"
      />
      <UButton
        v-if="canSend && connectionPayload.provider.connectPath"
        color="neutral"
        variant="outline"
        icon="i-lucide-rotate-ccw-key"
        @click="connectGmail"
      >
        Połącz ponownie
      </UButton>
      <UButton
        color="error"
        variant="soft"
        icon="i-lucide-unplug"
        @click="disconnectConfirmationOpen = true"
      >
        Odłącz
      </UButton>
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
      aria-label="Ładowanie integracji Gmail"
    >
      <USkeleton class="h-72 w-full rounded-[var(--oe-radius-surface)]" />
    </div>

    <UCard v-else-if="!connection" class="mail-connect-card">
      <div class="mail-connect-card__content">
        <div class="mail-connect-card__logo" aria-hidden="true">
          <img src="/assets/google-icon.svg" alt="">
        </div>
        <p class="mail-connect-card__eyebrow">Gmail dla OpenExpert</p>
        <h2>Połącz swoją skrzynkę Gmail</h2>
        <p class="mail-connect-card__description">
          Odczytuj wiadomości, wyszukuj korespondencję i wysyłaj odpowiedzi w CRM.
          Integracja nie może usuwać wiadomości ani zmieniać ich oznaczeń.
        </p>

        <UAlert
          v-if="!connectionPayload.configured"
          class="mail-connect-card__notice"
          color="warning"
          variant="subtle"
          icon="i-lucide-settings-2"
          title="Integracja Gmail nie jest jeszcze skonfigurowana"
          description="Administrator musi uzupełnić dane OAuth Google po stronie serwera."
        />

        <UButton
          size="lg"
          icon="i-lucide-log-in"
          :disabled="!connectionPayload.provider.connectPath"
          @click="connectGmail"
        >
          Połącz z Gmailem
        </UButton>

        <div class="mail-connect-card__assurances" aria-label="Informacje o dostępie">
          <span><UIcon name="i-lucide-eye" /> Odczyt wiadomości</span>
          <span><UIcon name="i-lucide-send" /> Wysyłanie poczty</span>
          <span><UIcon name="i-lucide-lock-keyhole" /> Szyfrowane tokeny</span>
          <span><UIcon name="i-lucide-unplug" /> Możesz odłączyć konto</span>
        </div>
      </div>
    </UCard>

    <template v-else>
      <UAlert
        v-if="showReconnectNotice"
        class="mail-alert"
        color="warning"
        variant="subtle"
        icon="i-lucide-key-round"
        title="Gmail wymaga ponownego połączenia"
        description="Google odrzucił zapisane uprawnienie lub poprzednia próba dostępu nie powiodła się."
      >
        <template #actions>
          <UButton
            v-if="connectionPayload.provider.connectPath"
            color="warning"
            variant="solid"
            size="sm"
            @click="connectGmail"
          >
            Połącz ponownie
          </UButton>
        </template>
      </UAlert>

      <UAlert
        v-else-if="!hasSendPermission"
        class="mail-alert"
        color="info"
        variant="subtle"
        icon="i-lucide-send"
        title="Włącz wysyłanie wiadomości"
        description="To konto połączono wcześniej tylko do odczytu. Google poprosi o dodatkową zgodę na wysyłanie poczty."
      >
        <template #actions>
          <UButton
            v-if="connectionPayload.provider.connectPath"
            color="info"
            variant="solid"
            size="sm"
            @click="connectGmail"
          >
            Zezwól na wysyłanie
          </UButton>
        </template>
      </UAlert>

      <UAlert
        v-if="disconnectConfirmationOpen"
        class="mail-alert"
        color="error"
        variant="subtle"
        icon="i-lucide-unplug"
        title="Odłączyć Gmail?"
        description="CRM usunie zapisany token. Skrzynkę będzie można połączyć ponownie."
      >
        <template #actions>
          <div class="mail-confirm-actions">
            <UButton
              color="error"
              variant="solid"
              size="sm"
              :loading="disconnecting"
              @click="disconnectGmail"
            >
              Odłącz konto
            </UButton>
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              :disabled="disconnecting"
              @click="disconnectConfirmationOpen = false"
            >
              Anuluj
            </UButton>
          </div>
        </template>
      </UAlert>

      <section
        class="mail-browser"
        :class="{ 'mail-browser--thread-open': selectedThreadId }"
        aria-label="Skrzynka Gmail"
      >
        <div class="mail-list-pane">
          <form class="mail-toolbar" role="search" @submit.prevent="submitSearch">
            <UInput
              v-model="searchInput"
              class="mail-search"
              icon="i-lucide-search"
              placeholder="Szukaj w poczcie"
              aria-label="Szukaj w poczcie Gmail"
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
            <UButton type="submit" color="neutral" variant="solid">
              Szukaj
            </UButton>
          </form>

          <div class="mail-list-summary">
            <div>
              <p>{{ activeFolderLabel }}</p>
              <span v-if="searchQuery">Wyniki dla „{{ searchQuery }}”</span>
              <span v-else>Strona {{ currentPageNumber }}</span>
            </div>
            <span aria-live="polite" class="mail-result-count">
              {{ threadPayload.data.length }}
            </span>
          </div>
          <ClientOnly>
            <p class="sr-only" aria-live="polite">{{ resultAnnouncement }}</p>
          </ClientOnly>

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

          <div v-else-if="threadsError" class="mail-list-state">
            <UIcon name="i-lucide-cloud-off" />
            <h2>Nie udało się pobrać wiadomości</h2>
            <p>{{ apiErrorMessage(threadsError) }}</p>
            <UButton
              v-if="connectionPayload.provider.connectPath"
              color="neutral"
              variant="solid"
              icon="i-lucide-rotate-ccw-key"
              @click="connectGmail"
            >
              Połącz ponownie
            </UButton>
          </div>

          <div
            v-else-if="!threadPayload.data.length"
            class="mail-list-state"
          >
            <UIcon :name="searchQuery ? 'i-lucide-search-x' : 'i-lucide-mail-open'" />
            <h2>{{ searchQuery ? 'Brak wyników' : 'Ten folder jest pusty' }}</h2>
            <p>
              {{ searchQuery
                ? 'Spróbuj krótszego zapytania albo użyj składni wyszukiwarki Gmail.'
                : 'Gdy w Gmailu pojawią się wiadomości, zobaczysz je tutaj.' }}
            </p>
            <UButton
              v-if="searchQuery"
              color="neutral"
              variant="outline"
              @click="clearSearch"
            >
              Wyczyść wyszukiwanie
            </UButton>
          </div>

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
          <div v-if="!selectedThreadId" class="mail-detail-empty">
            <span class="mail-detail-empty__icon">
              <UIcon name="i-lucide-mails" />
            </span>
            <h2>Wybierz wiadomość</h2>
            <p>Treść wybranego wątku pojawi się w tym miejscu.</p>
            <UButton
              v-if="canSend"
              icon="i-lucide-square-pen"
              @click="openNewMessage"
            >
              Napisz wiadomość
            </UButton>
          </div>

          <div
            v-else-if="selectedThreadStatus === 'idle' || selectedThreadStatus === 'pending'"
            class="mail-detail-loading"
          >
            <USkeleton class="h-8 w-3/4" />
            <USkeleton class="h-4 w-2/5" />
            <USkeleton class="mt-8 h-44 w-full" />
            <USkeleton class="h-40 w-full" />
          </div>

          <div v-else-if="selectedThreadError" class="mail-detail-empty">
            <span class="mail-detail-empty__icon">
              <UIcon name="i-lucide-message-circle-x" />
            </span>
            <h2>Nie udało się otworzyć wątku</h2>
            <p>{{ apiErrorMessage(selectedThreadError) }}</p>
            <UButton color="neutral" variant="outline" @click="refreshSelectedThread()">
              Spróbuj ponownie
            </UButton>
          </div>

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
                <UButton
                  v-if="canSend"
                  icon="i-lucide-reply"
                  @click="openReply"
                >
                  Odpowiedz
                </UButton>
                <UButton
                  :href="selectedThread.externalUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  color="neutral"
                  variant="outline"
                  icon="i-lucide-external-link"
                >
                  Otwórz w Gmailu
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
              description="Pełny wątek możesz otworzyć bezpośrednio w Gmailu."
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
                    </div>
                    <span v-if="message.from?.email">{{ message.from.email }}</span>
                    <span title="Odbiorcy">
                      do: {{ addressListLabel(message.to) }}
                    </span>
                    <span v-if="message.cc.length" title="Kopia">
                      DW: {{ addressListLabel(message.cc) }}
                    </span>
                  </div>
                  <time :datetime="message.sentAt || undefined">
                    {{ formatMessageDate(message.sentAt) }}
                  </time>
                </header>

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
                  description="Pełną treść zobaczysz po otwarciu wątku w Gmailu."
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
                    Pobieranie załączników pozostaje w Gmailu, aby pliki nie trafiały do CRM.
                  </p>
                </div>
              </section>
            </div>
          </div>
        </article>
      </section>
    </template>
    </CrmShell>

    <MailComposerSlideover
      v-if="connection"
      :key="composerKey"
      v-model:open="composerOpen"
      :endpoint="sendEndpoint"
      :account-email="connection.accountEmail"
      :initial-to="composerDraft.to"
      :initial-cc="composerDraft.cc"
      :initial-subject="composerDraft.subject"
      :thread-id="composerDraft.threadId"
      @sent="handleMessageSent"
    />
  </div>
</template>

<style scoped>
.mail-account-meta {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.mail-account-meta__icon {
  width: 18px;
  height: 18px;
}

.mail-alert {
  margin-bottom: 18px;
}

.mail-confirm-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.mail-connection-loading,
.mail-connect-card {
  width: min(100%, 720px);
  margin-inline: auto;
}

.mail-connect-card {
  min-height: 430px;
}

.mail-connect-card__content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 380px;
  padding: 24px;
  text-align: center;
}

.mail-connect-card__logo {
  display: grid;
  place-items: center;
  width: 68px;
  height: 68px;
  margin-bottom: 22px;
  border: 1px solid var(--ui-border);
  border-radius: 20px;
  background: var(--ui-bg);
  box-shadow: 0 12px 36px color-mix(in srgb, var(--ui-text-highlighted) 8%, transparent);
}

.mail-connect-card__logo img {
  width: 34px;
  height: 34px;
}

.mail-connect-card__eyebrow {
  margin: 0 0 7px;
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.mail-connect-card h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: clamp(25px, 3vw, 34px);
  font-weight: 450;
  line-height: 1.15;
}

.mail-connect-card__description {
  max-width: 560px;
  margin: 14px 0 22px;
  color: var(--ui-text-muted);
  font-size: 14px;
  line-height: 1.65;
}

.mail-connect-card__notice {
  width: min(100%, 540px);
  margin: 0 0 20px;
  text-align: left;
}

.mail-connect-card__assurances {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px 18px;
  margin-top: 24px;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.mail-connect-card__assurances span {
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

.mail-thread__count {
  flex: 0 0 auto;
  color: var(--ui-text-dimmed);
  font-family: var(--font-mono);
  font-size: 9px;
}

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

.mail-list-state,
.mail-detail-empty {
  display: flex;
  flex: 1 1 auto;
  min-height: 300px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 36px 24px;
  text-align: center;
}

.mail-list-state > :deep(svg) {
  width: 34px;
  height: 34px;
  margin-bottom: 16px;
  color: var(--ui-text-dimmed);
}

.mail-list-state h2,
.mail-detail-empty h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 18px;
  font-weight: 600;
}

.mail-list-state p,
.mail-detail-empty p {
  max-width: 390px;
  margin: 9px 0 18px;
  color: var(--ui-text-muted);
  font-size: 13px;
  line-height: 1.55;
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

.mail-detail-empty__icon {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  margin-bottom: 18px;
  border: 1px solid var(--ui-border);
  border-radius: 20px;
  color: var(--ui-text-dimmed);
  background: var(--ui-bg);
}

.mail-detail-empty__icon :deep(svg) {
  width: 28px;
  height: 28px;
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
  white-space: pre-wrap;
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

@media (max-width: 680px) {
  .mail-connect-card__content {
    padding: 12px 4px;
  }

  .mail-connect-card__assurances {
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
  .mail-thread {
    transition: none;
  }
}
</style>
