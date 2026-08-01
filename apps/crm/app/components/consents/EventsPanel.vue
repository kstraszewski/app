<script setup lang="ts">
import type {
  ConsentInsightAuditEvent,
  ConsentInsightsEventsResponse,
} from '~/types/consent-insights'

const props = defineProps<{
  definitionId: string
}>()

const { crmApiPath, orgPath, organizationSlug } = useOrganizationContext()
const requestFetch = useRequestFetch()
const searchInput = ref('')
const search = ref('')
const kindFilter = ref('all')
const dateFrom = ref('')
const dateTo = ref('')
const page = ref(1)
const limit = 30
let searchTimer: ReturnType<typeof setTimeout> | undefined

const kindItems = [
  { label: 'Wszystkie zdarzenia', value: 'all' },
  { label: 'Decyzje klienta', value: 'decision' },
  { label: 'Obsługa SMS', value: 'capture' },
]

watch(searchInput, (value) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    search.value = value.trim()
    page.value = 1
  }, 300)
})

watch([kindFilter, dateFrom, dateTo], () => {
  page.value = 1
})

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
})

const queryKey = computed(() => [
  'consent-insights-events',
  organizationSlug.value,
  props.definitionId,
  search.value,
  kindFilter.value,
  dateFrom.value,
  dateTo.value,
  page.value,
].join(':'))

const { data, pending, error, refresh } = await useAsyncData<ConsentInsightsEventsResponse>(
  queryKey,
  () => requestFetch<ConsentInsightsEventsResponse>(
    crmApiPath(`/consents/${props.definitionId}/insights`),
    {
      query: {
        view: 'events',
        search: search.value || undefined,
        status: kindFilter.value === 'all' ? undefined : kindFilter.value,
        dateFrom: dateFrom.value || undefined,
        dateTo: dateTo.value || undefined,
        page: page.value,
        limit,
      },
    },
  ),
  { watch: [queryKey] },
)

function eventLabel(item: ConsentInsightAuditEvent) {
  if (item.kind === 'decision') {
    return ({
      granted: 'Klient udzielił zgody',
      declined: 'Klient odmówił zgody',
      withdrawn: 'Klient wycofał zgodę',
    })[item.eventType] ?? 'Zapisano decyzję klienta'
  }
  return ({
    requested: 'Utworzono prośbę SMS',
    queued: 'Wiadomość dodano do kolejki',
    sms_queued: 'Wiadomość dodano do kolejki',
    sent: 'Wysłano wiadomość SMS',
    sms_sent: 'Wysłano wiadomość SMS',
    delivered: 'Operator potwierdził dostarczenie',
    sms_delivered: 'Operator potwierdził dostarczenie',
    sms_failed: 'Nie udało się wysłać wiadomości SMS',
    sms_delivery_failed: 'Operator zgłosił błąd dostarczenia',
    opened: 'Klient otworzył bezpieczny link',
    link_opened: 'Klient otworzył bezpieczny link',
    otp_rejected: 'Wpisano nieprawidłowy kod',
    otp_locked: 'Zablokowano kod po przekroczeniu limitu prób',
    otp_verified: 'Klient potwierdził numer kodem',
    verified: 'Klient potwierdził numer kodem',
    decision_recorded: 'Zapisano decyzję po weryfikacji',
    expired: 'Prośba wygasła',
    cancelled: 'Prośba została anulowana',
    cancelled_by_replacement: 'Poprzednia prośba została zastąpiona',
    failed: 'Wysyłka wiadomości nie powiodła się',
  })[item.eventType] ?? item.eventType.replaceAll('_', ' ')
}

function eventIcon(item: ConsentInsightAuditEvent) {
  if (item.kind === 'decision') {
    if (item.eventType === 'granted') return 'i-lucide-shield-check'
    if (item.eventType === 'declined') return 'i-lucide-shield-x'
    return 'i-lucide-shield-minus'
  }
  return ({
    sent: 'i-lucide-send',
    sms_sent: 'i-lucide-send',
    delivered: 'i-lucide-message-square-check',
    sms_delivered: 'i-lucide-message-square-check',
    opened: 'i-lucide-mail-open',
    link_opened: 'i-lucide-mail-open',
    otp_verified: 'i-lucide-badge-check',
    verified: 'i-lucide-badge-check',
    failed: 'i-lucide-message-square-warning',
    sms_failed: 'i-lucide-message-square-warning',
    sms_delivery_failed: 'i-lucide-message-square-warning',
    otp_rejected: 'i-lucide-key-round',
    otp_locked: 'i-lucide-lock-keyhole',
    cancelled: 'i-lucide-ban',
    cancelled_by_replacement: 'i-lucide-refresh-cw',
  })[item.eventType] ?? 'i-lucide-message-square-more'
}

function eventTone(item: ConsentInsightAuditEvent) {
  if (['granted', 'delivered', 'otp_verified', 'verified', 'decision_recorded'].includes(item.eventType)) return 'success'
  if (['declined', 'withdrawn', 'failed', 'sms_failed', 'sms_delivery_failed', 'otp_locked'].includes(item.eventType)) return 'error'
  if (['expired', 'cancelled', 'cancelled_by_replacement'].includes(item.eventType)) return 'warning'
  return 'info'
}

function eventHasDecisionEvidence(item: ConsentInsightAuditEvent) {
  return item.kind === 'decision' || item.eventType === 'decision_recorded'
}

function methodLabel(method: string | null, source: string) {
  if (method === 'sms_otp' || source === 'sms_verification') return 'SMS + kod jednorazowy'
  return ({
    booking_widget: 'Widget rezerwacji',
    client_creation: 'Dodanie klienta',
    client_card: 'Karta klienta',
    import: 'Import',
    api: 'API',
  })[source] ?? method ?? source
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(date)
}

function clearFilters() {
  searchInput.value = ''
  search.value = ''
  kindFilter.value = 'all'
  dateFrom.value = ''
  dateTo.value = ''
  page.value = 1
}

const hasFilters = computed(() => Boolean(
  search.value || kindFilter.value !== 'all' || dateFrom.value || dateTo.value,
))
</script>

<template>
  <section class="consent-events" aria-labelledby="consent-events-title">
    <header class="consent-events__toolbar">
      <div>
        <span>Audyt operacyjny</span>
        <h2 id="consent-events-title">Rejestr zdarzeń</h2>
        <p>Chronologiczny ślad wysyłki, weryfikacji numeru oraz decyzji klienta.</p>
      </div>
      <UButton
        color="neutral"
        variant="outline"
        square
        icon="i-lucide-refresh-cw"
        :loading="pending"
        aria-label="Odśwież rejestr"
        @click="refresh()"
      />
    </header>

    <div class="consent-events__filters">
      <UInput
        v-model="searchInput"
        icon="i-lucide-search"
        placeholder="Klient, osoba lub identyfikator prośby"
        aria-label="Szukaj zdarzenia"
      />
      <USelect v-model="kindFilter" :items="kindItems" value-key="value" aria-label="Typ zdarzenia" />
      <UInput v-model="dateFrom" type="date" aria-label="Zdarzenia od daty" />
      <UInput v-model="dateTo" type="date" aria-label="Zdarzenia do daty" />
      <UButton
        v-if="hasFilters"
        color="neutral"
        variant="ghost"
        square
        icon="i-lucide-x"
        aria-label="Wyczyść filtry"
        @click="clearFilters"
      />
    </div>

    <div v-if="pending && !data" class="consent-events__loading">
      <USkeleton v-for="index in 6" :key="index" class="h-24 w-full" />
    </div>

    <UAlert
      v-else-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-database"
      title="Nie udało się pobrać rejestru zdarzeń"
      description="Sprawdź połączenie i spróbuj ponownie."
    >
      <template #actions><UButton color="error" variant="soft" @click="refresh()">Ponów</UButton></template>
    </UAlert>

    <ol v-else-if="data?.items.length" class="consent-events__timeline">
      <li v-for="item in data.items" :key="`${item.kind}:${item.id}`">
        <span :class="`event-icon event-icon--${eventTone(item)}`">
          <UIcon :name="eventIcon(item)" />
        </span>
        <article>
          <header>
            <div>
              <strong>{{ eventLabel(item) }}</strong>
              <span>{{ formatDateTime(item.occurredAt) }}</span>
            </div>
            <UBadge :color="item.kind === 'decision' ? 'primary' : 'neutral'" variant="outline">
              {{ item.kind === 'decision' ? 'decyzja' : 'SMS' }}
            </UBadge>
          </header>

          <div class="event-subject">
            <UIcon name="i-lucide-user-round" />
            <NuxtLink v-if="item.client" :to="orgPath(`/clients/${item.client.id}?view=consents`)">
              {{ item.subject?.displayName || item.client.displayName }}
            </NuxtLink>
            <span v-else>Niepowiązana osoba</span>
            <small v-if="item.client && item.subject?.displayName !== item.client.displayName">
              {{ item.client.displayName }}
            </small>
          </div>

          <footer>
            <span><UIcon name="i-lucide-radio" />{{ methodLabel(item.method, item.source) }}</span>
            <span v-if="item.version"><UIcon name="i-lucide-file-clock" />wersja {{ item.version.number }}</span>
            <span
              v-if="eventHasDecisionEvidence(item)"
              :class="{ 'evidence-ok': item.evidencePresent }"
            >
              <UIcon :name="item.evidencePresent ? 'i-lucide-shield-check' : 'i-lucide-shield-question'" />
              {{ item.evidencePresent ? 'dowód kompletny' : 'brak referencji dowodu' }}
            </span>
            <span v-else>
              <UIcon name="i-lucide-activity" />zdarzenie operacyjne
            </span>
            <code v-if="item.requestId">{{ item.requestId.slice(0, 8) }}</code>
          </footer>
        </article>
      </li>
    </ol>

    <div v-else-if="data" class="consent-events__empty">
      <UIcon name="i-lucide-history" />
      <h3>Brak zdarzeń</h3>
      <p>Rejestr uzupełni się po wysłaniu pierwszej prośby albo zapisaniu decyzji.</p>
    </div>

    <footer v-if="data && data.pagination.totalPages > 1" class="consent-events__pagination">
      <span>{{ data.pagination.total }} zdarzeń · strona {{ data.pagination.page }} z {{ data.pagination.totalPages }}</span>
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
.consent-events {
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background: var(--ui-bg);
}

.consent-events__toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 18px 20px;
  border-bottom: 1px solid var(--ui-border);
}

.consent-events__toolbar > div {
  display: grid;
  gap: 3px;
}

.consent-events__toolbar span {
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: .05em;
  text-transform: uppercase;
}

.consent-events__toolbar h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 20px;
  font-weight: 550;
}

.consent-events__toolbar p {
  margin: 2px 0 0;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.consent-events__filters {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) 190px 150px 150px auto;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--ui-border);
}

.consent-events__loading {
  display: grid;
  gap: 10px;
  padding: 16px;
}

.consent-events__timeline {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 6px 20px;
  list-style: none;
}

.consent-events__timeline > li {
  position: relative;
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  gap: 12px;
  padding: 14px 0;
}

.consent-events__timeline > li:not(:last-child)::before {
  position: absolute;
  top: 52px;
  bottom: -14px;
  left: 18px;
  width: 1px;
  content: '';
  background: var(--ui-border);
}

.event-icon {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border: 1px solid var(--ui-border);
  border-radius: 11px;
  color: var(--ui-text-toned);
  background: var(--ui-bg);
}

.event-icon--success { color: var(--ui-success); }
.event-icon--error { color: var(--ui-error); }
.event-icon--warning { color: var(--ui-warning); }
.event-icon--info { color: var(--ui-info); }

.consent-events__timeline article {
  min-width: 0;
  padding: 13px 14px;
  border: 1px solid var(--ui-border-muted);
  border-radius: 12px;
  background: var(--ui-bg-muted);
}

.consent-events__timeline article > header,
.consent-events__timeline article > footer,
.event-subject {
  display: flex;
  align-items: center;
}

.consent-events__timeline article > header {
  justify-content: space-between;
  gap: 16px;
}

.consent-events__timeline article > header > div {
  display: grid;
  gap: 2px;
}

.consent-events__timeline article strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 650;
}

.consent-events__timeline article header span,
.event-subject small,
.consent-events__timeline article footer {
  color: var(--ui-text-muted);
  font-size: 11px;
}

.event-subject {
  gap: 7px;
  margin-top: 12px;
  color: var(--ui-text-toned);
  font-size: 12px;
}

.event-subject a {
  color: var(--ui-text-highlighted);
  font-weight: 600;
}

.consent-events__timeline article > footer {
  flex-wrap: wrap;
  gap: 7px 15px;
  margin-top: 11px;
  padding-top: 10px;
  border-top: 1px solid var(--ui-border-muted);
}

.consent-events__timeline article > footer span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.consent-events__timeline article > footer .evidence-ok {
  color: var(--ui-success);
}

.consent-events__timeline code {
  margin-left: auto;
  color: var(--ui-text-muted);
  font-size: 10px;
}

.consent-events__empty {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 60px 20px;
  text-align: center;
}

.consent-events__empty > .iconify {
  width: 32px;
  height: 32px;
  color: var(--ui-text-muted);
}

.consent-events__empty h3,
.consent-events__empty p {
  margin: 0;
}

.consent-events__empty p,
.consent-events__pagination {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.consent-events__pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  border-top: 1px solid var(--ui-border);
}

.consent-events__pagination > div {
  display: flex;
  gap: 6px;
}

@media (max-width: 1000px) {
  .consent-events__filters {
    grid-template-columns: 1fr 1fr;
  }

  .consent-events__filters > :first-child {
    grid-column: 1 / -1;
  }
}

@media (max-width: 620px) {
  .consent-events__filters {
    grid-template-columns: 1fr;
  }

  .consent-events__filters > :first-child {
    grid-column: auto;
  }
}
</style>
