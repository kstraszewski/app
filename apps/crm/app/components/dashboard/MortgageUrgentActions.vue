<script setup lang="ts">
type MortgageUrgentActionKind =
  | 'decision_overdue'
  | 'decision_due_soon'
  | 'decision_received_not_delivered'
  | 'esis_missing'
  | 'esis_delivery_missing'
  | 'offer_expiring'

type MortgageUrgentActionSeverity = 'critical' | 'warning' | 'info'

interface MortgageUrgentAction {
  id: string
  kind: MortgageUrgentActionKind
  severity: MortgageUrgentActionSeverity
  caseId: string
  caseTitle: string
  applicationId: string
  bankId: string | null
  bankName: string
  title: string
  description: string
  dueAt: string | null
  daysRemaining: number | null
  action: {
    label: string
    href: string
  }
}

interface MortgageUrgentActionsResponse {
  data: MortgageUrgentAction[]
  counts: {
    total: number
    critical: number
    warning: number
    info: number
  }
  generatedAt: string
}

const { organizationSlug, crmApiPath } = useOrganizationContext()
const requestFetch = useRequestFetch()
const emptyResponse = (): MortgageUrgentActionsResponse => ({
  data: [],
  counts: { total: 0, critical: 0, warning: 0, info: 0 },
  generatedAt: '',
})

const { data, status, error, refresh } = await useAsyncData(
  computed(() => `dashboard-mortgage-urgent-actions-${organizationSlug.value}`),
  () => requestFetch<MortgageUrgentActionsResponse>(crmApiPath('/mortgages/urgent-actions')),
  { default: emptyResponse, watch: [organizationSlug] },
)

const hasActions = computed(() => data.value.data.length > 0)

const severityPresentation: Record<MortgageUrgentActionSeverity, {
  label: string
  color: 'error' | 'warning' | 'info'
  icon: string
}> = {
  critical: { label: 'Pilne', color: 'error', icon: 'i-lucide-circle-alert' },
  warning: { label: 'Wkrótce', color: 'warning', icon: 'i-lucide-clock-3' },
  info: { label: 'Do uzupełnienia', color: 'info', icon: 'i-lucide-file-up' },
}
const deadlineFormatter = new Intl.DateTimeFormat('pl-PL', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

function presentation(action: MortgageUrgentAction) {
  return severityPresentation[action.severity]
}

function deadlineLabel(action: MortgageUrgentAction) {
  if (action.daysRemaining === null) return null
  const date = action.dueAt ? new Date(action.dueAt) : null
  const dateLabel = date && Number.isFinite(date.getTime())
    ? ` · ${deadlineFormatter.format(date).replaceAll('.', '')}`
    : ''
  if (action.daysRemaining < 0) {
    const days = Math.abs(action.daysRemaining)
    return `${days} ${dayWord(days)} po terminie${dateLabel}`
  }
  if (action.daysRemaining === 0) return `Termin dzisiaj${dateLabel}`
  return `${action.daysRemaining} ${dayWord(action.daysRemaining)} do terminu${dateLabel}`
}

function dayWord(value: number) {
  if (value === 1) return 'dzień'
  const lastTwo = value % 100
  const last = value % 10
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return 'dni'
  return 'dni'
}
</script>

<template>
  <section class="mortgage-alerts dashboard-block" aria-labelledby="mortgage-alerts-title">
    <header class="mortgage-alerts__header">
      <div class="mortgage-alerts__heading">
        <span class="mortgage-alerts__icon" aria-hidden="true">
          <UIcon name="i-lucide-landmark" />
        </span>
        <div>
          <span class="mortgage-alerts__eyebrow">Kredyty hipoteczne</span>
          <h2 id="mortgage-alerts-title">Co wymaga Twojej uwagi</h2>
          <p>Terminy decyzji, ESIS i oferty banków w jednym miejscu.</p>
        </div>
      </div>

      <div class="mortgage-alerts__summary" aria-live="polite">
        <UBadge v-if="data.counts.critical" color="error" variant="subtle">
          {{ data.counts.critical }} pilne
        </UBadge>
        <UBadge v-if="data.counts.warning" color="warning" variant="subtle">
          {{ data.counts.warning }} wkrótce
        </UBadge>
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-refresh-cw"
          :loading="status === 'pending'"
          aria-label="Odśwież pilne sprawy hipoteczne"
          @click="refresh()"
        />
      </div>
    </header>

    <UAlert
      v-if="error"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="Nie udało się pobrać terminów hipotecznych"
      description="Pozostałe dane dashboardu nadal są dostępne. Odśwież sekcję i spróbuj ponownie."
    />

    <div v-else-if="status === 'pending' && !hasActions" class="mortgage-alerts__loading">
      <USkeleton v-for="index in 3" :key="index" class="h-28 w-full" />
    </div>

    <div v-else-if="hasActions" class="mortgage-alerts__list">
      <article
        v-for="action in data.data"
        :key="action.id"
        class="mortgage-alerts__row"
        :class="`mortgage-alerts__row--${action.severity}`"
      >
        <span class="mortgage-alerts__status-icon" :class="`mortgage-alerts__status-icon--${action.severity}`" aria-hidden="true">
          <UIcon :name="presentation(action).icon" />
        </span>

        <div class="mortgage-alerts__copy">
          <div class="mortgage-alerts__meta">
            <UBadge :color="presentation(action).color" variant="subtle">
              {{ presentation(action).label }}
            </UBadge>
            <span>{{ action.bankName }}</span>
            <span v-if="deadlineLabel(action)" class="mortgage-alerts__deadline">
              {{ deadlineLabel(action) }}
            </span>
          </div>
          <h3>{{ action.title }}</h3>
          <p>{{ action.caseTitle }} · {{ action.description }}</p>
        </div>

        <UButton
          :to="action.action.href"
          color="neutral"
          variant="outline"
          trailing-icon="i-lucide-arrow-right"
          class="mortgage-alerts__action"
        >
          {{ action.action.label }}
        </UButton>
      </article>
    </div>

    <div v-else class="mortgage-alerts__empty">
      <UIcon name="i-lucide-shield-check" aria-hidden="true" />
      <div>
        <strong>Brak pilnych spraw hipotecznych</strong>
        <span>Decyzje, ESIS i kończące się oferty pojawią się tutaj automatycznie.</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.mortgage-alerts {
  display: grid;
  gap: 16px;
  padding: 20px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-emphasis);
  background: var(--ui-bg);
}

.mortgage-alerts__header,
.mortgage-alerts__heading,
.mortgage-alerts__summary,
.mortgage-alerts__row,
.mortgage-alerts__meta,
.mortgage-alerts__empty {
  display: flex;
  align-items: center;
}

.mortgage-alerts__header {
  justify-content: space-between;
  gap: 16px;
}

.mortgage-alerts__heading {
  min-width: 0;
  gap: 12px;
}

.mortgage-alerts__icon,
.mortgage-alerts__status-icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
}

.mortgage-alerts__icon {
  width: 42px;
  height: 42px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-muted);
  font-size: 20px;
}

.mortgage-alerts__eyebrow {
  display: block;
  color: var(--ui-primary);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.mortgage-alerts__heading h2,
.mortgage-alerts__heading p,
.mortgage-alerts__copy h3,
.mortgage-alerts__copy p,
.mortgage-alerts__empty strong,
.mortgage-alerts__empty span {
  margin: 0;
}

.mortgage-alerts__heading h2 {
  margin-top: 2px;
  color: var(--ui-text-highlighted);
  font-size: 18px;
  font-weight: 650;
}

.mortgage-alerts__heading p,
.mortgage-alerts__copy p,
.mortgage-alerts__empty span {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.mortgage-alerts__summary,
.mortgage-alerts__meta {
  gap: 8px;
}

.mortgage-alerts__loading,
.mortgage-alerts__list {
  display: grid;
  gap: 10px;
}

.mortgage-alerts__row {
  min-width: 0;
  gap: 12px;
  padding: 13px 14px;
  border: 1px solid var(--ui-border);
  border-left-width: 3px;
  border-radius: var(--oe-radius-surface);
  background: var(--ui-bg-muted);
}

.mortgage-alerts__row--critical {
  border-left-color: var(--ui-error);
}

.mortgage-alerts__row--warning {
  border-left-color: var(--ui-warning);
}

.mortgage-alerts__row--info {
  border-left-color: var(--ui-info);
}

.mortgage-alerts__status-icon {
  width: 34px;
  height: 34px;
  border-radius: 10px;
}

.mortgage-alerts__status-icon--critical {
  background: color-mix(in srgb, var(--ui-error) 12%, var(--ui-bg));
  color: var(--ui-error);
}

.mortgage-alerts__status-icon--warning {
  background: color-mix(in srgb, var(--ui-warning) 12%, var(--ui-bg));
  color: var(--ui-warning);
}

.mortgage-alerts__status-icon--info {
  background: color-mix(in srgb, var(--ui-info) 12%, var(--ui-bg));
  color: var(--ui-info);
}

.mortgage-alerts__copy {
  display: grid;
  min-width: 0;
  flex: 1;
  gap: 3px;
}

.mortgage-alerts__meta {
  flex-wrap: wrap;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.mortgage-alerts__deadline {
  font-weight: 650;
}

.mortgage-alerts__copy h3 {
  color: var(--ui-text-highlighted);
  font-size: 14px;
  font-weight: 650;
}

.mortgage-alerts__copy p {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mortgage-alerts__action {
  flex: 0 0 auto;
}

.mortgage-alerts__empty {
  justify-content: center;
  gap: 12px;
  min-height: 94px;
  border: 1px dashed var(--ui-border);
  border-radius: var(--oe-radius-surface);
}

.mortgage-alerts__empty > :deep(svg) {
  width: 24px;
  height: 24px;
  color: var(--ui-success);
}

.mortgage-alerts__empty div {
  display: grid;
  gap: 3px;
}

.mortgage-alerts__empty strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

@media (max-width: 760px) {
  .mortgage-alerts {
    padding: 16px;
  }

  .mortgage-alerts__header {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .mortgage-alerts__summary {
    width: 100%;
  }

  .mortgage-alerts__row {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .mortgage-alerts__copy {
    min-width: calc(100% - 48px);
  }

  .mortgage-alerts__action {
    width: 100%;
    justify-content: center;
  }
}
</style>
