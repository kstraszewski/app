<script setup lang="ts">
import type { Appointment, FacilityAppointmentsPayload } from '~/types/scheduling'

definePageMeta({ middleware: ['auth', 'organization'] })
useHead({ title: 'Dashboard — OpenExpert CRM' })

const { organizationSlug, crmApiPath, orgApiPath, orgPath } = useOrganizationContext()
const authenticatedUser = useAuthUser()
const requestFetch = useRequestFetch()
const scheduleFallback = {
  data: [] as Appointment[],
  count: 0,
  generatedAt: '',
  endsAt: '',
}
const defaultScheduleTimeZone = 'Europe/Warsaw'

type DashboardMetric = {
  label: string
  value: number
  currency?: string
  icon: string
}

type DashboardPayload = {
  currentUserId: string
  metrics: DashboardMetric[]
}

type DashboardSchedulePayload = FacilityAppointmentsPayload & {
  generatedAt: string
  endsAt: string
}

type DashboardScheduleDay = {
  key: string
  weekday: string
  dayNumber: string
  isToday: boolean
  appointmentCount: number
}

const fallbackDashboard: DashboardPayload = {
  currentUserId: '',
  metrics: [],
}

const dashboardRequest = useFetch<DashboardPayload>(() => crmApiPath('/dashboard'), {
  default: () => fallbackDashboard,
})

const scheduleRequest = useAsyncData<DashboardSchedulePayload>(
  `dashboard-schedule-${organizationSlug.value}-${authenticatedUser.value?.id || 'session'}`,
  async () => {
    const generatedAt = new Date()
    const endsAt = new Date(generatedAt.getTime() + 7 * 24 * 60 * 60 * 1_000)
    const expertUserId = authenticatedUser.value?.id
    if (!expertUserId) {
      return {
        data: [],
        count: 0,
        generatedAt: generatedAt.toISOString(),
        endsAt: endsAt.toISOString(),
      }
    }
    const query = {
      expertUserId,
      startsFrom: generatedAt.toISOString(),
      startsBefore: endsAt.toISOString(),
      status: 'confirmed',
      limit: 200,
    }
    const data: Appointment[] = []
    let count = 0
    let offset = 0

    do {
      const page = await requestFetch<FacilityAppointmentsPayload>(orgApiPath('/appointments'), {
        query: { ...query, offset },
      })
      data.push(...page.data)
      count = page.count
      offset += page.data.length
      if (!page.data.length) break
    } while (data.length < count)

    return {
      data: data.sort((left, right) => left.starts_at.localeCompare(right.starts_at)),
      count,
      generatedAt: generatedAt.toISOString(),
      endsAt: endsAt.toISOString(),
    }
  },
  {
    default: (): DashboardSchedulePayload => ({ ...scheduleFallback }),
  },
)

const [
  { data: dashboard, error, refresh },
  {
    data: schedule,
    status: scheduleStatus,
    error: scheduleError,
    refresh: refreshSchedule,
  },
] = await Promise.all([dashboardRequest, scheduleRequest])

const scheduleAppointments = computed(() => schedule.value.data)
const scheduleTimeZone = computed(() => (
  scheduleAppointments.value[0]?.timezone || defaultScheduleTimeZone
))
const nextAppointments = computed(() => scheduleAppointments.value.slice(0, 3))
const scheduleDays = computed<DashboardScheduleDay[]>(() => {
  if (!schedule.value.generatedAt) return []
  const startKey = dateKey(schedule.value.generatedAt, scheduleTimeZone.value)
  const todayKey = startKey

  return Array.from({ length: 7 }, (_, index) => {
    const key = addDaysToKey(startKey, index)
    const date = dateFromKey(key)
    return {
      key,
      weekday: new Intl.DateTimeFormat('pl-PL', {
        weekday: 'short',
        timeZone: 'UTC',
      }).format(date).replace('.', ''),
      dayNumber: new Intl.DateTimeFormat('pl-PL', {
        day: '2-digit',
        timeZone: 'UTC',
      }).format(date),
      isToday: key === todayKey,
      appointmentCount: scheduleAppointments.value.filter(appointment => (
        dateKey(appointment.starts_at, scheduleTimeZone.value) === key
      )).length,
    }
  })
})
const scheduleRangeLabel = computed(() => {
  const first = scheduleDays.value[0]
  const last = scheduleDays.value.at(-1)
  if (!first || !last) return 'Najbliższe siedem dni'
  const firstDate = dateFromKey(first.key)
  const lastDate = dateFromKey(last.key)
  const firstLabel = new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(firstDate).replace('.', '')
  const lastLabel = new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(lastDate).replace('.', '')
  return `${firstLabel} – ${lastLabel}`
})

function dateKey(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).formatToParts(new Date(value))
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function dateFromKey(value: string) {
  return new Date(`${value}T12:00:00.000Z`)
}

function addDaysToKey(value: string, days: number) {
  const date = dateFromKey(value)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function meetingCountLabel(count: number) {
  if (count === 1) return '1 spotkanie'
  const lastTwo = count % 100
  const last = count % 10
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return `${count} spotkania`
  return `${count} spotkań`
}

function formatAppointmentTime(appointment: Appointment) {
  const formatter = new Intl.DateTimeFormat('pl-PL', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: appointment.timezone || defaultScheduleTimeZone,
  })
  return `${formatter.format(new Date(appointment.starts_at))}–${formatter.format(new Date(appointment.ends_at))}`
}

function formatAppointmentDate(appointment: Appointment) {
  return new Intl.DateTimeFormat('pl-PL', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: appointment.timezone || defaultScheduleTimeZone,
  }).format(new Date(appointment.starts_at)).replaceAll('.', '')
}

function appointmentDetails(appointment: Appointment) {
  return [
    appointment.serviceName,
    appointment.meeting_mode === 'online' ? 'Online' : appointment.facilityName,
  ].filter(Boolean).join(' · ') || 'Spotkanie'
}

function calendarPath(date?: string) {
  return date ? orgPath(`/calendar?date=${encodeURIComponent(date)}`) : orgPath('/calendar')
}

function appointmentCalendarPath(appointment: Appointment) {
  return calendarPath(dateKey(
    appointment.starts_at,
    appointment.timezone || defaultScheduleTimeZone,
  ))
}

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
  <CrmShell
    title="Dashboard"
    eyebrow="Operacje"
    description="Najważniejsze zadania, terminy i aktywność organizacji."
  >
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
      description="Po zastosowaniu migracji i konfiguracji Data API pulpit pokaże realne sprawy."
    >
      <template #actions>
        <UButton icon="i-lucide-refresh-cw" variant="ghost" @click="refresh()">
          Odśwież
        </UButton>
      </template>
    </UAlert>

    <section class="dashboard-calendar dashboard-block" aria-labelledby="dashboard-calendar-title">
      <header class="dashboard-calendar__header">
        <div class="dashboard-calendar__heading">
          <span class="dashboard-calendar__icon" aria-hidden="true">
            <UIcon name="i-lucide-calendar-days" />
          </span>
          <div>
            <span class="dashboard-calendar__eyebrow">Twój kalendarz</span>
            <h2 id="dashboard-calendar-title">Najbliższe spotkania</h2>
            <p>{{ scheduleRangeLabel }}</p>
          </div>
        </div>
        <div class="dashboard-calendar__actions">
          <UBadge v-if="scheduleStatus === 'success'" color="neutral" variant="outline">
            {{ meetingCountLabel(schedule.count) }}
          </UBadge>
          <UButton
            :to="calendarPath()"
            color="neutral"
            variant="outline"
            icon="i-lucide-calendar"
            trailing-icon="i-lucide-arrow-right"
          >
            Pełny kalendarz
          </UButton>
        </div>
      </header>

      <div v-if="scheduleStatus === 'pending' && !scheduleDays.length" class="dashboard-calendar__loading">
        <USkeleton v-for="index in 7" :key="index" class="h-20 w-full" />
      </div>

      <UAlert
        v-else-if="scheduleError"
        class="dashboard-calendar__message"
        color="warning"
        variant="subtle"
        icon="i-lucide-calendar-x-2"
        title="Nie udało się pobrać kalendarza"
        description="Pozostałe dane dashboardu nadal są dostępne."
      >
        <template #actions>
          <UButton icon="i-lucide-refresh-cw" variant="ghost" @click="refreshSchedule()">
            Spróbuj ponownie
          </UButton>
        </template>
      </UAlert>

      <div v-else class="dashboard-calendar__body">
        <nav class="dashboard-calendar__week" aria-label="Najbliższe siedem dni">
          <NuxtLink
            v-for="day in scheduleDays"
            :key="day.key"
            :to="calendarPath(day.key)"
            class="dashboard-calendar-day"
            :class="{
              'dashboard-calendar-day--today': day.isToday,
              'dashboard-calendar-day--busy': day.appointmentCount > 0,
            }"
            :aria-current="day.isToday ? 'date' : undefined"
            :aria-label="`${day.weekday} ${day.dayNumber}, ${meetingCountLabel(day.appointmentCount)}`"
          >
            <span>{{ day.weekday }}</span>
            <strong>{{ day.dayNumber }}</strong>
            <small>
              <i aria-hidden="true" />
              {{ day.appointmentCount || '—' }}
            </small>
          </NuxtLink>
        </nav>

        <div v-if="nextAppointments.length" class="dashboard-calendar__appointments">
          <NuxtLink
            v-for="appointment in nextAppointments"
            :key="appointment.id"
            :to="appointmentCalendarPath(appointment)"
            class="dashboard-calendar-appointment"
          >
            <span class="dashboard-calendar-appointment__time">
              <small>{{ formatAppointmentDate(appointment) }}</small>
              <strong>{{ formatAppointmentTime(appointment) }}</strong>
            </span>
            <span class="dashboard-calendar-appointment__copy">
              <strong>{{ appointment.customer_name }}</strong>
              <small>{{ appointmentDetails(appointment) }}</small>
            </span>
            <UIcon name="i-lucide-arrow-up-right" aria-hidden="true" />
          </NuxtLink>
        </div>

        <div v-else class="dashboard-calendar__empty">
          <UIcon name="i-lucide-calendar-check-2" />
          <div>
            <strong>Brak spotkań w najbliższych 7 dniach</strong>
            <span>W kalendarzu możesz sprawdzić dalsze terminy i dostępność zespołu.</span>
          </div>
        </div>
      </div>
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

    <DashboardPayoutsOverview :to="orgPath('/sales')" />
  </CrmShell>
</template>

<style scoped>
.dashboard-block {
  margin-bottom: 24px;
}

.dashboard-calendar {
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-emphasis);
  background: var(--ui-bg);
}

.dashboard-calendar__header,
.dashboard-calendar__heading,
.dashboard-calendar__actions {
  display: flex;
  align-items: center;
}

.dashboard-calendar__header {
  justify-content: space-between;
  gap: 20px;
  padding: 18px 20px;
  border-bottom: 1px solid var(--ui-border);
}

.dashboard-calendar__heading {
  min-width: 0;
  gap: 12px;
}

.dashboard-calendar__icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 42px;
  height: 42px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-muted);
  font-size: 20px;
}

.dashboard-calendar__eyebrow {
  display: block;
  margin-bottom: 2px;
  color: var(--ui-text-dimmed);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.dashboard-calendar__heading h2,
.dashboard-calendar__heading p {
  margin: 0;
}

.dashboard-calendar__heading h2 {
  color: var(--ui-text-highlighted);
  font-size: 18px;
  font-weight: 650;
}

.dashboard-calendar__heading p {
  margin-top: 2px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.dashboard-calendar__actions {
  flex: 0 0 auto;
  gap: 10px;
}

.dashboard-calendar__body {
  padding: 16px 20px 20px;
}

.dashboard-calendar__loading {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 8px;
  padding: 16px 20px 20px;
}

.dashboard-calendar__message {
  margin: 16px 20px 20px;
}

.dashboard-calendar__week {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 8px;
}

.dashboard-calendar-day {
  display: grid;
  justify-items: center;
  gap: 1px;
  min-width: 0;
  min-height: 76px;
  padding: 9px 7px;
  border: 1px solid var(--ui-border);
  border-radius: 11px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-muted);
  text-decoration: none;
  transition:
    border-color var(--oe-motion-fast),
    background var(--oe-motion-fast),
    transform var(--oe-motion-fast);
}

.dashboard-calendar-day:hover,
.dashboard-calendar-day:focus-visible {
  border-color: var(--ui-border-accented);
  background: var(--ui-bg-elevated);
  transform: translateY(-1px);
}

.dashboard-calendar-day > span {
  font-size: 10px;
  font-weight: 600;
  text-transform: capitalize;
}

.dashboard-calendar-day > strong {
  color: var(--ui-text-highlighted);
  font-size: 19px;
  font-weight: 600;
  line-height: 1.2;
}

.dashboard-calendar-day > small {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--ui-text-dimmed);
  font-size: 9px;
}

.dashboard-calendar-day > small i {
  display: block;
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: transparent;
}

.dashboard-calendar-day--busy {
  border-color: color-mix(in srgb, var(--ui-success) 34%, var(--ui-border));
}

.dashboard-calendar-day--busy > small i {
  background: var(--ui-success);
}

.dashboard-calendar-day--today {
  border-color: var(--ui-border-inverted);
  background: var(--ui-bg-inverted);
  color: var(--ui-text-inverted);
}

.dashboard-calendar-day--today:hover,
.dashboard-calendar-day--today:focus-visible {
  border-color: var(--ui-border-inverted);
  background: var(--ui-bg-inverted);
}

.dashboard-calendar-day--today > strong {
  color: var(--ui-text-inverted);
}

.dashboard-calendar-day--today > small {
  color: color-mix(in srgb, var(--ui-text-inverted) 65%, transparent);
}

.dashboard-calendar__appointments {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 12px;
}

.dashboard-calendar-appointment {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  min-width: 0;
  min-height: 68px;
  padding: 11px 12px;
  border: 1px solid var(--ui-border);
  border-radius: 11px;
  background: var(--ui-bg-muted);
  color: var(--ui-text);
  text-decoration: none;
  transition:
    border-color var(--oe-motion-fast),
    background var(--oe-motion-fast),
    transform var(--oe-motion-fast);
}

.dashboard-calendar-appointment:hover,
.dashboard-calendar-appointment:focus-visible {
  border-color: var(--ui-border-accented);
  background: var(--ui-bg-elevated);
  transform: translateY(-1px);
}

.dashboard-calendar-appointment__time,
.dashboard-calendar-appointment__copy {
  display: grid;
  min-width: 0;
}

.dashboard-calendar-appointment__time {
  gap: 1px;
  min-width: 82px;
  padding-right: 12px;
  border-right: 1px solid var(--ui-border);
}

.dashboard-calendar-appointment__time small {
  color: var(--ui-text-dimmed);
  font-family: var(--font-mono);
  font-size: 8px;
  font-weight: 650;
  text-transform: uppercase;
}

.dashboard-calendar-appointment__time strong {
  color: var(--ui-text-highlighted);
  font-family: var(--font-mono);
  font-size: 10px;
  white-space: nowrap;
}

.dashboard-calendar-appointment__copy strong,
.dashboard-calendar-appointment__copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dashboard-calendar-appointment__copy strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
  font-weight: 650;
}

.dashboard-calendar-appointment__copy small {
  margin-top: 2px;
  color: var(--ui-text-muted);
  font-size: 9px;
}

.dashboard-calendar-appointment > .iconify {
  color: var(--ui-text-dimmed);
  font-size: 15px;
}

.dashboard-calendar__empty {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  padding: 15px 16px;
  border: 1px solid var(--ui-border);
  border-radius: 11px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-muted);
}

.dashboard-calendar__empty > .iconify {
  flex: 0 0 auto;
  font-size: 20px;
}

.dashboard-calendar__empty div {
  display: grid;
  gap: 2px;
}

.dashboard-calendar__empty strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
}

.dashboard-calendar__empty span {
  font-size: 10px;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.metric-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.metric-top {
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

@media (max-width: 1100px) {
  .metric-grid {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 760px) {
  .dashboard-calendar__header {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .dashboard-calendar__actions {
    justify-content: space-between;
    width: 100%;
  }

  .dashboard-calendar__body {
    padding-inline: 14px;
  }

  .dashboard-calendar__loading {
    grid-template-columns: repeat(7, minmax(68px, 1fr));
    overflow-x: auto;
    padding-inline: 14px;
  }

  .dashboard-calendar__week {
    grid-template-columns: repeat(7, minmax(68px, 1fr));
    overflow-x: auto;
    padding-bottom: 4px;
  }

  .dashboard-calendar__appointments {
    grid-template-columns: 1fr;
  }

  .metric-grid {
    grid-template-columns: 1fr;
  }
}
</style>
