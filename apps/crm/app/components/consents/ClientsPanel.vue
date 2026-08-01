<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type {
  ConsentInsightClientItem,
  ConsentInsightsClientsResponse,
} from '~/types/consent-insights'

const props = defineProps<{
  definitionId: string
  canRequest: boolean
}>()

const { crmApiPath, orgPath, organizationSlug } = useOrganizationContext()
const requestFetch = useRequestFetch()
const toast = useToast()
const searchInput = ref('')
const search = ref('')
const statusFilter = ref('all')
const page = ref(1)
const limit = 25
const requestingKey = ref('')
let searchTimer: ReturnType<typeof setTimeout> | undefined

const statusItems = [
  { label: 'Wszystkie statusy', value: 'all' },
  { label: 'Udzielona', value: 'granted' },
  { label: 'Odmowa', value: 'declined' },
  { label: 'Wycofana', value: 'withdrawn' },
  { label: 'Prośba w toku', value: 'pending' },
  { label: 'Brak decyzji', value: 'no_decision' },
]

const columns = computed<TableColumn<ConsentInsightClientItem>[]>(() => [
  { accessorKey: 'subject', header: 'Klient i osoba' },
  { accessorKey: 'status', header: 'Aktualny stan' },
  { accessorKey: 'lastRequest', header: 'Ostatnia prośba SMS' },
  { accessorKey: 'evidencePresent', header: 'Dowód' },
  ...(props.canRequest ? [{ id: 'actions', header: '' }] : []),
])

watch(searchInput, (value) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    search.value = value.trim()
    page.value = 1
  }, 300)
})

watch(statusFilter, () => {
  page.value = 1
})

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
})

const queryKey = computed(() => [
  'consent-insights-clients',
  organizationSlug.value,
  props.definitionId,
  search.value,
  statusFilter.value,
  page.value,
].join(':'))

const { data, pending, error, refresh } = await useAsyncData<ConsentInsightsClientsResponse>(
  queryKey,
  () => requestFetch<ConsentInsightsClientsResponse>(
    crmApiPath(`/consents/${props.definitionId}/insights`),
    {
      query: {
        view: 'clients',
        search: search.value || undefined,
        status: statusFilter.value === 'all' ? undefined : statusFilter.value,
        page: page.value,
        limit,
      },
    },
  ),
  { watch: [queryKey] },
)

function statusLabel(status: ConsentInsightClientItem['status']) {
  return ({
    granted: 'Udzielona',
    declined: 'Odmowa',
    withdrawn: 'Wycofana',
    pending: 'Prośba w toku',
    no_decision: 'Brak decyzji',
  })[status]
}

function statusColor(status: ConsentInsightClientItem['status']): 'success' | 'error' | 'warning' | 'info' | 'neutral' {
  return ({
    granted: 'success',
    declined: 'error',
    withdrawn: 'warning',
    pending: 'info',
    no_decision: 'neutral',
  } as const)[status]
}

function requestStatusLabel(request: NonNullable<ConsentInsightClientItem['lastRequest']>) {
  if (request.status === 'failed' && request.deliveryStatus === 'otp_locked') {
    return 'Kod zablokowany'
  }
  return ({
    pending: 'Przygotowywanie',
    queued: 'W kolejce',
    sent: 'Wysłany',
    delivered: 'Dostarczony',
    opened: 'Link otwarty',
    verified: 'Numer potwierdzony',
    accepted: 'Udzielona',
    declined: 'Odmowa',
    withdrawn: 'Wycofana',
    expired: 'Wygasła',
    cancelled: 'Anulowana',
    failed: 'Błąd wysyłki',
  })[request.status] ?? request.status
}

function requestStatusColor(status: string): 'success' | 'error' | 'warning' | 'info' | 'neutral' {
  if (['accepted', 'delivered', 'verified'].includes(status)) return 'success'
  if (['declined', 'withdrawn', 'failed'].includes(status)) return 'error'
  if (['pending', 'queued', 'sent', 'opened'].includes(status)) return 'info'
  if (status === 'expired') return 'warning'
  return 'neutral'
}

function sourceLabel(source: string | null) {
  if (!source) return 'Brak'
  return ({
    sms_verification: 'SMS z kodem',
    booking_widget: 'Widget rezerwacji',
    client_creation: 'Dodanie klienta',
    client_card: 'Karta klienta',
    import: 'Import',
    api: 'API',
  })[source] ?? source
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function requestKey(item: ConsentInsightClientItem) {
  return `${item.client.id}:${item.subject.id}`
}

async function sendSmsRequest(item: ConsentInsightClientItem) {
  const key = requestKey(item)
  requestingKey.value = key
  try {
    const response = await $fetch<{
      data: { maskedPhone?: string, devOtp?: string, demoUrl?: string, reused?: boolean }
    }>(
      crmApiPath(`/consents/${props.definitionId}/requests`),
      {
        method: 'POST',
        body: {
          clientId: item.client.id,
          subjectPersonId: item.subject.id,
          // Reuse the intent only while an SMS request is actually in flight.
          // A completed collect request must not block a later withdrawal.
          intent: item.status === 'pending' && item.lastRequest
            ? item.lastRequest.intent
            : item.status === 'granted'
              ? 'withdraw'
              : 'collect',
        },
      },
    )
    await refresh()
    toast.add({
      title: response.data.demoUrl
        ? (item.status === 'granted'
            ? 'Utworzono demo wycofania zgody'
            : 'Utworzono prośbę demo')
        : item.status === 'granted'
          ? 'Wysłano potwierdzenie wycofania'
          : 'Wysłano prośbę o zgodę',
      description: response.data.demoUrl
        ? 'Tryb demo: SMS nie został wysłany. Otwórz formularz, aby przejść proces z automatycznie uzupełnionym kodem.'
        : response.data.devOtp
          ? `Tryb lokalny: kod testowy ${response.data.devOtp}. W produkcji kod trafia wyłącznie SMS-em do klienta.`
          : response.data.reused
            ? `Aktywna wiadomość na numer ${response.data.maskedPhone || item.maskedPhone || 'klienta'} pozostaje ważna.`
            : `Wiadomość skierowano na numer ${response.data.maskedPhone || item.maskedPhone || 'klienta'}.`,
      color: 'success',
      icon: response.data.demoUrl ? 'i-lucide-flask-conical' : 'i-lucide-message-square-check',
      ...(response.data.demoUrl
        ? {
            actions: [{
              label: 'Otwórz formularz demo',
              onClick: () => {
                window.open(response.data.demoUrl, '_blank', 'noopener,noreferrer')
              },
            }],
          }
        : {}),
    })
  }
  catch (caught: any) {
    toast.add({
      title: 'Nie udało się wysłać SMS-a',
      description: caught?.data?.statusMessage ?? caught?.message ?? 'Spróbuj ponownie.',
      color: 'error',
      icon: 'i-lucide-message-square-warning',
    })
  }
  finally {
    requestingKey.value = ''
  }
}
</script>

<template>
  <section class="consent-clients" aria-labelledby="consent-clients-title">
    <header class="consent-clients__toolbar">
      <div>
        <span>Rejestr decyzji</span>
        <h2 id="consent-clients-title">Klienci i status zgody</h2>
        <p>Każdy wiersz dotyczy konkretnej osoby, wersji zgody i ostatniego dowodu.</p>
      </div>
      <div class="consent-clients__filters">
        <UInput
          v-model="searchInput"
          icon="i-lucide-search"
          placeholder="Klient lub osoba"
          aria-label="Szukaj klienta lub osoby"
        />
        <USelect
          v-model="statusFilter"
          :items="statusItems"
          value-key="value"
          aria-label="Filtruj status zgody"
        />
        <UButton
          color="neutral"
          variant="outline"
          square
          icon="i-lucide-refresh-cw"
          :loading="pending"
          aria-label="Odśwież rejestr"
          @click="refresh()"
        />
      </div>
    </header>

    <div v-if="data" class="consent-clients__counts" aria-label="Podsumowanie statusów">
      <span><strong>{{ data.counts.total }}</strong> osób</span>
      <span><i class="status-dot status-dot--success" />{{ data.counts.granted }} udzielonych</span>
      <span><i class="status-dot status-dot--info" />{{ data.counts.pending }} w toku</span>
      <span><i class="status-dot" />{{ data.counts.noDecision }} bez decyzji</span>
    </div>

    <div v-if="pending && !data" class="consent-clients__loading">
      <USkeleton v-for="index in 5" :key="index" class="h-16 w-full" />
    </div>

    <UAlert
      v-else-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-database"
      title="Nie udało się pobrać rejestru klientów"
      description="Sprawdź połączenie i spróbuj ponownie."
    >
      <template #actions>
        <UButton color="error" variant="soft" @click="refresh()">Ponów</UButton>
      </template>
    </UAlert>

    <div v-else-if="data?.items.length" class="consent-clients__table">
      <UTable
        :data="data.items"
        :columns="columns"
        :ui="{
          root: 'overflow-x-auto',
          base: 'min-w-[940px]',
          th: 'px-4 py-3 text-xs font-semibold text-muted',
          td: 'px-4 py-3 align-middle',
        }"
      >
        <template #subject-cell="{ row }">
          <div class="identity-cell">
            <span>{{ row.original.subject.displayName.slice(0, 1).toUpperCase() }}</span>
            <div>
              <NuxtLink :to="orgPath(`/clients/${row.original.client.id}?view=consents`)">
                {{ row.original.subject.displayName }}
              </NuxtLink>
              <small>
                {{ row.original.client.displayName }}
                <template v-if="row.original.maskedPhone"> · {{ row.original.maskedPhone }}</template>
              </small>
            </div>
          </div>
        </template>

        <template #status-cell="{ row }">
          <div class="status-cell">
            <UBadge :color="statusColor(row.original.status)" variant="subtle">
              {{ statusLabel(row.original.status) }}
            </UBadge>
            <small>
              {{ sourceLabel(row.original.source) }}
              <template v-if="row.original.version"> · v{{ row.original.version.number }}</template>
            </small>
          </div>
        </template>

        <template #lastRequest-cell="{ row }">
          <div v-if="row.original.lastRequest" class="request-cell">
            <UBadge :color="requestStatusColor(row.original.lastRequest.status)" variant="outline">
              {{ requestStatusLabel(row.original.lastRequest) }}
            </UBadge>
            <small>{{ formatDateTime(row.original.lastRequest.createdAt) }}</small>
          </div>
          <span v-else class="muted-cell">Nie wysłano</span>
        </template>

        <template #evidencePresent-cell="{ row }">
          <span :class="['evidence-cell', { 'evidence-cell--ok': row.original.evidencePresent }]">
            <UIcon :name="row.original.evidencePresent ? 'i-lucide-shield-check' : 'i-lucide-shield-question'" />
            {{ row.original.evidencePresent ? 'Kompletny' : 'Brak dowodu' }}
          </span>
        </template>

        <template #actions-cell="{ row }">
          <div v-if="canRequest" class="action-cell">
            <UButton
              color="neutral"
              variant="outline"
              size="xs"
              icon="i-lucide-send"
              :loading="requestingKey === requestKey(row.original)"
              @click="sendSmsRequest(row.original)"
            >
              {{ row.original.status === 'granted' ? 'Wyślij wycofanie' : 'Wyślij SMS' }}
            </UButton>
          </div>
        </template>
      </UTable>
    </div>

    <div v-else-if="data" class="consent-clients__empty">
      <UIcon name="i-lucide-user-round-search" />
      <h3>Brak pasujących osób</h3>
      <p>Zmień filtry albo wyślij pierwszą prośbę z karty klienta.</p>
    </div>

    <footer v-if="data && data.pagination.totalPages > 1" class="consent-clients__pagination">
      <span>Strona {{ data.pagination.page }} z {{ data.pagination.totalPages }}</span>
      <div>
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-chevron-left"
          :disabled="page <= 1"
          aria-label="Poprzednia strona"
          @click="page--"
        />
        <UButton
          color="neutral"
          variant="outline"
          trailing-icon="i-lucide-chevron-right"
          :disabled="page >= data.pagination.totalPages"
          aria-label="Następna strona"
          @click="page++"
        />
      </div>
    </footer>
  </section>
</template>

<style scoped>
.consent-clients {
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background: var(--ui-bg);
}

.consent-clients__toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding: 18px 20px;
  border-bottom: 1px solid var(--ui-border);
}

.consent-clients__toolbar > div:first-child {
  display: grid;
  gap: 3px;
}

.consent-clients__toolbar > div:first-child > span {
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: .05em;
  text-transform: uppercase;
}

.consent-clients__toolbar h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 20px;
  font-weight: 550;
}

.consent-clients__toolbar p {
  margin: 2px 0 0;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.consent-clients__filters {
  display: grid;
  grid-template-columns: minmax(210px, 1fr) 180px auto;
  gap: 8px;
  min-width: min(100%, 490px);
}

.consent-clients__counts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  padding: 11px 20px;
  border-bottom: 1px solid var(--ui-border-muted);
  color: var(--ui-text-muted);
  font-size: 12px;
}

.consent-clients__counts span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.consent-clients__counts strong {
  color: var(--ui-text-highlighted);
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--ui-text-dimmed);
}

.status-dot--success { background: var(--ui-success); }
.status-dot--info { background: var(--ui-info); }

.consent-clients__loading {
  display: grid;
  gap: 8px;
  padding: 16px;
}

.consent-clients__table {
  min-width: 0;
}

.identity-cell,
.status-cell,
.request-cell,
.evidence-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}

.identity-cell > span {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  border-radius: 10px;
  color: var(--ui-text-highlighted);
  background: var(--ui-bg-elevated);
  font-weight: 650;
}

.identity-cell > div,
.status-cell,
.request-cell {
  display: flex;
  align-items: flex-start;
  flex-direction: column;
  gap: 3px;
}

.identity-cell > div {
  min-width: 0;
}

.identity-cell a {
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 650;
}

.identity-cell small,
.status-cell small,
.request-cell small,
.muted-cell {
  color: var(--ui-text-muted);
  font-size: 11px;
}

.evidence-cell {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.evidence-cell--ok {
  color: var(--ui-success);
}

.action-cell {
  display: flex;
  justify-content: flex-end;
}

.consent-clients__empty {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 58px 20px;
  text-align: center;
}

.consent-clients__empty > .iconify {
  width: 32px;
  height: 32px;
  color: var(--ui-text-muted);
}

.consent-clients__empty h3,
.consent-clients__empty p {
  margin: 0;
}

.consent-clients__empty p,
.consent-clients__pagination {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.consent-clients__pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  border-top: 1px solid var(--ui-border);
}

.consent-clients__pagination > div {
  display: flex;
  gap: 6px;
}

@media (max-width: 900px) {
  .consent-clients__toolbar {
    flex-direction: column;
  }

  .consent-clients__filters {
    width: 100%;
  }
}

@media (max-width: 620px) {
  .consent-clients__filters {
    grid-template-columns: 1fr auto;
  }

  .consent-clients__filters > :first-child {
    grid-column: 1 / -1;
  }
}
</style>
