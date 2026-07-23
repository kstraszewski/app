<script setup lang="ts">
definePageMeta({ middleware: ['auth', 'organization'] })
useHead({ title: 'Dashboard — OpenExpert CRM' })

const { crmApiPath, orgPath } = useOrganizationContext()

type DashboardMetric = {
  label: string
  value: number
  currency?: string
  icon: string
}

type DashboardPayload = {
  metrics: DashboardMetric[]
  cases: Array<Record<string, any>>
  items: Array<Record<string, any>>
  tasks: Array<Record<string, any>>
  clients: Array<Record<string, any>>
  submissions: { accepted: number; total: number }
}

const fallbackDashboard: DashboardPayload = {
  metrics: [],
  cases: [],
  items: [],
  tasks: [],
  clients: [],
  submissions: { accepted: 0, total: 0 },
}

const { data: dashboard, pending, error, refresh } = await useFetch<DashboardPayload>(() => crmApiPath('/dashboard'), {
  default: () => fallbackDashboard,
})

function formatMetric(metric: DashboardMetric) {
  if (metric.currency) {
    return new Intl.NumberFormat('pl-PL', {
      style: 'currency',
      currency: metric.currency,
      maximumFractionDigits: 0,
    }).format(metric.value)
  }
  return new Intl.NumberFormat('pl-PL').format(metric.value)
}
</script>

<template>
  <CrmShell title="Dashboard" eyebrow="Operacje">
    <template #actions>
      <UButton :to="orgPath('/clients')" icon="i-lucide-user-plus" variant="solid">
        Dodaj klienta
      </UButton>
      <UButton :to="orgPath('/cases')" icon="i-lucide-plus" variant="outline">
        Nowa sprawa
      </UButton>
    </template>

    <UAlert
      v-if="error"
      class="dashboard-block"
      color="warning"
      variant="subtle"
      icon="i-lucide-database"
      title="CRM API nie zwrocilo danych"
      description="Po zastosowaniu migracji i konfiguracji Supabase pulpit pokaze realne sprawy."
    >
      <template #actions>
        <UButton icon="i-lucide-refresh-cw" variant="ghost" @click="refresh()">
          Odśwież
        </UButton>
      </template>
    </UAlert>

    <section class="dashboard-agent dashboard-block" aria-labelledby="dashboard-agent-title">
      <span class="dashboard-agent__icon" aria-hidden="true">
        <UIcon name="i-lucide-sparkles" />
      </span>
      <div class="dashboard-agent__copy">
        <div class="dashboard-agent__eyebrow">
          <span class="dashboard-agent__status" />
          Agent AI jest gotowy
        </div>
        <h2 id="dashboard-agent-title">Zapytaj Eve o sprawy i proces kredytowy</h2>
        <p>Agent znajdzie Twoje sprawy w CRM, pomoże ustalić kolejny krok i uporządkować pracę z klientem.</p>
      </div>
      <UButton
        class="dashboard-agent__button"
        :to="orgPath('/assistant')"
        color="neutral"
        variant="solid"
        size="lg"
        icon="i-lucide-message-circle-more"
        trailing-icon="i-lucide-arrow-right"
      >
        Otwórz Agenta AI
      </UButton>
    </section>

    <div class="metric-grid dashboard-block">
      <UCard v-for="metric in dashboard.metrics" :key="metric.label" class="oe-hover-lift">
        <div class="metric-top">
          <UIcon :name="metric.icon" />
          <UBadge color="neutral" variant="outline">live</UBadge>
        </div>
        <strong>{{ formatMetric(metric) }}</strong>
        <span>{{ metric.label }}</span>
      </UCard>
      <UCard v-if="!dashboard.metrics.length" v-for="index in 4" :key="index">
        <USkeleton class="h-4 w-24" />
        <USkeleton class="mt-4 h-8 w-20" />
        <USkeleton class="mt-2 h-3 w-32" />
      </UCard>
    </div>

    <div class="dashboard-grid">
      <UCard>
        <template #header>
          <div class="panel-header">
            <div>
              <h2>Sprawy wymagające uwagi</h2>
              <p>Kontener procesu klienta z produktami i osobnymi statusami.</p>
            </div>
            <UButton :to="orgPath('/cases')" icon="i-lucide-arrow-right" variant="ghost" square aria-label="Przejdź do spraw" />
          </div>
        </template>

        <div v-if="pending" class="stack">
          <USkeleton v-for="index in 5" :key="index" class="h-11 w-full" />
        </div>
        <div v-else-if="dashboard.cases.length" class="case-list">
          <NuxtLink v-for="item in dashboard.cases" :key="item.id" :to="orgPath(`/cases/${item.id}`)" class="case-row">
            <div>
              <strong>{{ item.title }}</strong>
              <span>{{ item.client?.display_name || 'Brak klienta' }}</span>
            </div>
            <CrmStatusBadge :status="item.status_code" />
          </NuxtLink>
        </div>
        <div v-else class="empty-state">
          <UIcon name="i-lucide-inbox" />
          <h3>Brak aktywnych spraw</h3>
          <p>Dodaj klienta i utwórz pierwszą sprawę z kredytem, ubezpieczeniem albo nieruchomością.</p>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <div class="panel-header">
            <div>
              <h2>Follow-up dziś</h2>
              <p>Zadania przypisane do eksperta i pilne terminy.</p>
            </div>
          </div>
        </template>

        <div v-if="dashboard.tasks.length" class="task-list">
          <div v-for="task in dashboard.tasks" :key="task.id" class="task-row">
            <UIcon name="i-lucide-circle" />
            <div>
              <strong>{{ task.title }}</strong>
              <span>{{ task.due_at ? new Date(task.due_at).toLocaleString('pl-PL') : 'Bez terminu' }}</span>
            </div>
          </div>
        </div>
        <div v-else class="empty-state empty-state--compact">
          <UIcon name="i-lucide-calendar-check" />
          <h3>Brak follow-upów</h3>
          <p>Najbliższe zadania pojawią się tu po dodaniu terminów.</p>
        </div>
      </UCard>
    </div>

    <UCard class="dashboard-block">
      <template #header>
        <div class="panel-header">
          <div>
            <h2>Ostatnie produkty i wnioski</h2>
            <p>Kredyty, ubezpieczenia i nieruchomości prowadzone wewnątrz spraw.</p>
          </div>
          <UBadge color="neutral" variant="outline" icon="i-lucide-send">
            {{ dashboard.submissions.accepted }}/{{ dashboard.submissions.total }} zaakceptowane
          </UBadge>
        </div>
      </template>

      <div class="item-table">
        <div class="item-row item-row--head">
          <span>Produkt</span>
          <span>Status</span>
          <span>Wartość</span>
          <span>Aktualizacja</span>
        </div>
        <div v-for="item in dashboard.items" :key="item.id" class="item-row">
          <strong>{{ item.title }}</strong>
          <CrmStatusBadge :status="item.status_code" />
          <span>{{ item.amount_value ? `${Number(item.amount_value).toLocaleString('pl-PL')} ${item.currency}` : '—' }}</span>
          <span>{{ new Date(item.updated_at).toLocaleDateString('pl-PL') }}</span>
        </div>
        <div v-if="!dashboard.items.length" class="empty-line">Brak produktów w sprawach.</div>
      </div>
    </UCard>
  </CrmShell>
</template>

<style scoped>
.dashboard-block {
  margin-bottom: 24px;
}

.dashboard-agent {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 18px;
  align-items: center;
  padding: 22px;
  border: 1px solid var(--ui-border-inverted);
  border-radius: var(--oe-radius-emphasis);
  background: var(--ui-bg-inverted);
  color: var(--ui-text-inverted);
}

.dashboard-agent__icon {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border: 1px solid color-mix(in srgb, var(--ui-text-inverted) 20%, transparent);
  border-radius: 16px;
  background: color-mix(in srgb, var(--ui-text-inverted) 10%, transparent);
  font-size: 24px;
}

.dashboard-agent__copy {
  min-width: 0;
}

.dashboard-agent__eyebrow {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 5px;
  color: color-mix(in srgb, var(--ui-text-inverted) 64%, transparent);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.dashboard-agent__status {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ui-success);
}

.dashboard-agent h2 {
  margin: 0;
  color: var(--ui-text-inverted);
  font-size: 19px;
  font-weight: 650;
}

.dashboard-agent p {
  max-width: 720px;
  margin: 5px 0 0;
  color: color-mix(in srgb, var(--ui-text-inverted) 68%, transparent);
  font-size: 13px;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.metric-top,
.panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.metric-top {
  align-items: center;
  margin-bottom: 18px;
}

.metric-top .iconify {
  color: var(--ui-text-muted);
  font-size: 20px;
}

.metric-grid strong {
  display: block;
  color: var(--ui-text-highlighted);
  font-size: 28px;
  font-weight: 600;
  line-height: 1.1;
}

.metric-grid span {
  color: var(--ui-text-muted);
  font-size: 13px;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.65fr);
  gap: 24px;
  margin-bottom: 24px;
}

.panel-header h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 18px;
  font-weight: 650;
}

.panel-header p {
  margin: 4px 0 0;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.stack,
.case-list,
.task-list {
  display: grid;
  gap: 8px;
}

.case-row,
.task-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 54px;
  padding: 10px 0;
  border-bottom: 1px solid var(--ui-border);
  text-decoration: none;
}

.case-row:last-child,
.task-row:last-child {
  border-bottom: 0;
}

.case-row strong,
.task-row strong {
  display: block;
  color: var(--ui-text-highlighted);
  font-size: 14px;
}

.case-row span,
.task-row span {
  color: var(--ui-text-muted);
  font-size: 13px;
}

.task-row {
  justify-content: flex-start;
}

.task-row .iconify {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.empty-state {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 44px 20px;
  color: var(--ui-text-muted);
  text-align: center;
}

.empty-state--compact {
  padding: 32px 16px;
}

.empty-state .iconify {
  font-size: 28px;
}

.empty-state h3 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 16px;
}

.empty-state p {
  max-width: 360px;
  margin: 0;
  font-size: 13px;
}

.item-table {
  display: grid;
}

.item-row {
  display: grid;
  grid-template-columns: minmax(180px, 1.4fr) 160px 140px 120px;
  gap: 16px;
  align-items: center;
  min-height: 44px;
  border-bottom: 1px solid var(--ui-border);
  font-size: 13px;
}

.item-row:last-child {
  border-bottom: 0;
}

.item-row strong {
  color: var(--ui-text-highlighted);
}

.item-row--head {
  min-height: 32px;
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
}

.empty-line {
  padding: 28px 0;
  color: var(--ui-text-muted);
  font-size: 13px;
}

@media (max-width: 1100px) {
  .metric-grid,
  .dashboard-grid {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 760px) {
  .dashboard-agent {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .dashboard-agent__button {
    grid-column: 1 / -1;
    justify-content: center;
  }

  .metric-grid,
  .dashboard-grid {
    grid-template-columns: 1fr;
  }

  .item-row {
    grid-template-columns: 1fr;
    gap: 6px;
    padding: 12px 0;
  }

  .item-row--head {
    display: none;
  }
}
</style>
