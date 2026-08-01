<script setup lang="ts">
import type { ConsentInsightsStatisticsResponse } from '~/types/consent-insights'

const props = defineProps<{
  definitionId: string
}>()

const { crmApiPath, organizationSlug } = useOrganizationContext()
const requestFetch = useRequestFetch()
const colorMode = useColorMode()
const range = ref<'30' | '90' | 'all'>('30')

const rangeItems = [
  { label: 'Ostatnie 30 dni', value: '30' },
  { label: 'Ostatnie 90 dni', value: '90' },
  { label: 'Cała historia', value: 'all' },
]

const dateFrom = computed(() => {
  if (range.value === 'all') return undefined
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - Number(range.value) + 1)
  return date.toISOString().slice(0, 10)
})

const queryKey = computed(() => [
  'consent-insights-statistics',
  organizationSlug.value,
  props.definitionId,
  range.value,
].join(':'))

const { data, pending, error, refresh } = await useAsyncData<ConsentInsightsStatisticsResponse>(
  queryKey,
  () => requestFetch<ConsentInsightsStatisticsResponse>(
    crmApiPath(`/consents/${props.definitionId}/insights`),
    {
      query: {
        view: 'statistics',
        dateFrom: dateFrom.value,
      },
    },
  ),
  { watch: [queryKey] },
)

const chartPoints = computed(() => (data.value?.dailyTrend ?? []).map(point => ({
  date: point.date,
  granted: point.granted,
  declined: point.declined,
  withdrawn: point.withdrawn,
  requests: point.requests,
})))

const chartCategories = {
  granted: { name: 'Udzielone', color: 'var(--ui-success)' },
  requests: { name: 'Prośby SMS', color: 'var(--ui-info)' },
  declined: { name: 'Odmowy', color: 'var(--ui-error)' },
  withdrawn: { name: 'Wycofania', color: 'var(--ui-warning)' },
}

const metrics = computed(() => {
  const totals = data.value?.totals
  return [
    {
      label: 'Osoby w rejestrze',
      value: totals?.uniqueSubjects ?? 0,
      hint: `${totals?.decided ?? 0} z decyzją`,
      icon: 'i-lucide-users-round',
    },
    {
      label: 'Udzielone zgody',
      value: totals?.granted ?? 0,
      hint: `${Math.round((totals?.grantRate ?? 0) * 100)}% podjętych decyzji`,
      icon: 'i-lucide-shield-check',
    },
    {
      label: 'Prośby w toku',
      value: totals?.pending ?? 0,
      hint: `${totals?.noDecision ?? 0} bez wysłanej prośby`,
      icon: 'i-lucide-message-square-more',
    },
    {
      label: 'Wycofane',
      value: totals?.withdrawn ?? 0,
      hint: `${totals?.declined ?? 0} odmów`,
      icon: 'i-lucide-shield-minus',
    },
  ]
})

const funnel = computed(() => {
  const sms = data.value?.smsFunnel
  const items = [
    { label: 'Utworzone prośby', value: sms?.requested ?? 0 },
    { label: 'Wysłane', value: sms?.sent ?? 0 },
    { label: 'Dostarczone', value: sms?.delivered ?? 0 },
    { label: 'Zweryfikowany numer', value: sms?.verified ?? 0 },
    { label: 'Zapisana decyzja', value: sms?.decided ?? 0 },
  ]
  const maximum = Math.max(items[0]?.value ?? 0, 1)
  return items.map(item => ({ ...item, percent: Math.round(item.value / maximum * 100) }))
})

function xFormatter(tick: number) {
  const date = chartPoints.value[tick]?.date
  if (!date) return ''
  return new Intl.DateTimeFormat('pl-PL', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`))
}

function tooltipTitleFormatter(point: { date: string }) {
  return new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${point.date}T12:00:00Z`))
}

function sourceLabel(source: string) {
  return ({
    sms_verification: 'SMS z kodem',
    booking_widget: 'Widget rezerwacji',
    client_creation: 'Dodanie klienta',
    client_card: 'Karta klienta',
    import: 'Import',
    api: 'API',
  })[source] ?? source
}
</script>

<template>
  <section class="consent-statistics" aria-labelledby="consent-statistics-title">
    <header class="consent-statistics__toolbar">
      <div>
        <span>Analityka zgody</span>
        <h2 id="consent-statistics-title">Skuteczność i jakość dowodów</h2>
        <p>Decyzje osób, droga wiadomości SMS oraz źródła historycznych zdarzeń.</p>
      </div>
      <div>
        <USelect v-model="range" :items="rangeItems" value-key="value" aria-label="Zakres statystyk" />
        <UButton
          color="neutral"
          variant="outline"
          square
          icon="i-lucide-refresh-cw"
          :loading="pending"
          aria-label="Odśwież statystyki"
          @click="refresh()"
        />
      </div>
    </header>

    <div v-if="pending && !data" class="consent-statistics__loading">
      <USkeleton v-for="index in 4" :key="index" class="h-28 w-full" />
      <USkeleton class="h-80 w-full" />
    </div>

    <UAlert
      v-else-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-chart-no-axes-combined"
      title="Nie udało się policzyć statystyk"
      description="Sprawdź połączenie i spróbuj ponownie."
    >
      <template #actions>
        <UButton color="error" variant="soft" @click="refresh()">Ponów</UButton>
      </template>
    </UAlert>

    <template v-else-if="data">
      <div class="consent-statistics__metrics">
        <article v-for="metric in metrics" :key="metric.label">
          <span><UIcon :name="metric.icon" /></span>
          <div>
            <small>{{ metric.label }}</small>
            <strong>{{ metric.value }}</strong>
            <p>{{ metric.hint }}</p>
          </div>
        </article>
      </div>

      <div class="consent-statistics__main-grid">
        <section class="analytics-card analytics-card--trend">
          <header>
            <div>
              <span>W czasie</span>
              <h3>Decyzje i prośby SMS</h3>
            </div>
          </header>
          <div v-if="chartPoints.length" class="analytics-card__chart">
            <NcLineChart
              :key="`${colorMode.value}-${range}`"
              :data="chartPoints"
              :height="280"
              :categories="chartCategories"
              :x-formatter="xFormatter"
              :tooltip-title-formatter="tooltipTitleFormatter"
              :x-num-ticks="range === '30' ? 6 : 8"
              :y-num-ticks="4"
              :y-domain="[0, undefined]"
              :y-grid-line="true"
              :duration="220"
            />
          </div>
          <div v-else class="analytics-card__empty">
            <UIcon name="i-lucide-chart-line" />
            <span>Brak zdarzeń w wybranym okresie.</span>
          </div>
        </section>

        <section class="analytics-card">
          <header>
            <div>
              <span>Lejek potwierdzenia</span>
              <h3>Droga wiadomości SMS</h3>
            </div>
          </header>
          <ol class="sms-funnel">
            <li v-for="(step, index) in funnel" :key="step.label">
              <span>{{ index + 1 }}</span>
              <div>
                <p><strong>{{ step.label }}</strong><b>{{ step.value }}</b></p>
                <UProgress :model-value="step.percent" color="primary" size="sm" />
                <small>{{ step.percent }}% wszystkich próśb</small>
              </div>
            </li>
          </ol>
        </section>
      </div>

      <section class="analytics-card analytics-card--sources">
        <header>
          <div>
            <span>Pochodzenie</span>
            <h3>Źródła zapisanych decyzji</h3>
          </div>
          <UBadge color="neutral" variant="outline">{{ data.sources.length }}</UBadge>
        </header>
        <div v-if="data.sources.length" class="source-list">
          <div v-for="source in data.sources" :key="source.source">
            <span>{{ sourceLabel(source.source) }}</span>
            <strong>{{ source.count }}</strong>
          </div>
        </div>
        <div v-else class="analytics-card__empty analytics-card__empty--small">
          <span>Brak zapisanych decyzji w wybranym okresie.</span>
        </div>
      </section>

      <table class="sr-only">
        <caption>Dzienna liczba decyzji i próśb SMS</caption>
        <thead><tr><th>Data</th><th>Udzielone</th><th>Odmowy</th><th>Wycofania</th><th>Prośby</th></tr></thead>
        <tbody>
          <tr v-for="point in chartPoints" :key="point.date">
            <th>{{ point.date }}</th>
            <td>{{ point.granted }}</td>
            <td>{{ point.declined }}</td>
            <td>{{ point.withdrawn }}</td>
            <td>{{ point.requests }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style scoped>
.consent-statistics {
  display: grid;
  gap: 14px;
}

.consent-statistics__toolbar,
.analytics-card {
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background: var(--ui-bg);
}

.consent-statistics__toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding: 18px 20px;
}

.consent-statistics__toolbar > div:first-child {
  display: grid;
  gap: 3px;
}

.consent-statistics__toolbar > div:last-child {
  display: flex;
  gap: 8px;
}

.consent-statistics__toolbar > div:first-child > span,
.analytics-card header span {
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: .05em;
  text-transform: uppercase;
}

.consent-statistics__toolbar h2,
.analytics-card h3 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-weight: 550;
}

.consent-statistics__toolbar h2 { font-size: 20px; }
.analytics-card h3 { font-size: 16px; }

.consent-statistics__toolbar p {
  margin: 2px 0 0;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.consent-statistics__loading,
.consent-statistics__metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.consent-statistics__loading > :last-child {
  grid-column: 1 / -1;
}

.consent-statistics__metrics article {
  display: flex;
  gap: 12px;
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background: var(--ui-bg);
}

.consent-statistics__metrics article > span {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  border-radius: 10px;
  color: var(--ui-primary);
  background: var(--ui-bg-elevated);
}

.consent-statistics__metrics article > div {
  display: grid;
  gap: 1px;
  min-width: 0;
}

.consent-statistics__metrics small,
.consent-statistics__metrics p,
.sms-funnel small {
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.consent-statistics__metrics strong {
  color: var(--ui-text-highlighted);
  font-size: 25px;
  font-weight: 550;
  line-height: 1.15;
}

.consent-statistics__main-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(300px, .75fr);
  gap: 14px;
}

.analytics-card {
  overflow: hidden;
}

.analytics-card header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--ui-border);
}

.analytics-card header > div {
  display: grid;
  gap: 3px;
}

.analytics-card__chart {
  padding: 18px 10px 10px;
}

.analytics-card__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 280px;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.analytics-card__empty--small {
  min-height: 90px;
}

.sms-funnel {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 12px 18px 16px;
  list-style: none;
}

.sms-funnel li {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 10px;
  padding: 9px 0;
}

.sms-funnel li > span {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  color: var(--ui-text-toned);
  background: var(--ui-bg-elevated);
  font-size: 11px;
  font-weight: 650;
}

.sms-funnel li > div {
  display: grid;
  gap: 6px;
}

.sms-funnel p {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin: 0;
  color: var(--ui-text-toned);
  font-size: 12px;
}

.sms-funnel p b {
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.source-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  background: var(--ui-border-muted);
}

.source-list > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  background: var(--ui-bg);
}

.source-list span {
  color: var(--ui-text-toned);
  font-size: 12px;
}

.source-list strong {
  color: var(--ui-text-highlighted);
  font-size: 16px;
}

@media (max-width: 1050px) {
  .consent-statistics__metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .consent-statistics__main-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .consent-statistics__toolbar {
    flex-direction: column;
  }

  .consent-statistics__metrics,
  .source-list {
    grid-template-columns: 1fr;
  }
}
</style>
