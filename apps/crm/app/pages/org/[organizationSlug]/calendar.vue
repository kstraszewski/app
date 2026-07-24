<script setup lang="ts">
import type {
  Appointment,
  AppointmentStatus,
  FacilityAppointmentsPayload,
  OrganizationMembersPayload,
} from '~/types/scheduling'

type CalendarPayload = {
  data: Appointment[]
  count: number
}

type CalendarEventLayout = {
  appointment: Appointment
  startMinute: number
  endMinute: number
  lane: number
  laneCount: number
}

type CalendarDay = {
  date: Date
  key: string
  weekday: string
  dayNumber: string
  accessibleLabel: string
  isToday: boolean
  events: CalendarEventLayout[]
}

definePageMeta({ middleware: ['auth', 'organization'] })
useHead({ title: 'Kalendarz — OpenExpert CRM' })

const route = useRoute()
const router = useRouter()
const { organizationSlug, orgApiPath, orgPath } = useOrganizationContext()
const requestFetch = useRequestFetch()
const hourHeight = 72

function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year!, month! - 1, day!, 12)
  return date.getFullYear() === year && date.getMonth() === month! - 1 && date.getDate() === day
}

function dateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dateFromKey(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year!, month! - 1, day!, 12)
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function startOfWeek(date: Date) {
  const start = new Date(date)
  const offset = (start.getDay() + 6) % 7
  start.setDate(start.getDate() - offset)
  start.setHours(0, 0, 0, 0)
  return start
}

const initialDate = isDateKey(route.query.date) ? route.query.date : dateKey(new Date())
const selectedDate = ref(initialDate)
const selectedExpertId = ref(typeof route.query.expert === 'string' ? route.query.expert : '')
const selectedAppointment = ref<Appointment | null>(null)
const appointmentOpen = ref(false)
const browserTimezone = ref('Europe/Warsaw')

onMounted(() => {
  browserTimezone.value = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Warsaw'
})

const weekStart = computed(() => startOfWeek(dateFromKey(selectedDate.value)))
const weekEnd = computed(() => addDays(weekStart.value, 6))
const rangeStartIso = computed(() => weekStart.value.toISOString())
const rangeEndIso = computed(() => {
  const end = addDays(weekStart.value, 7)
  end.setHours(0, 0, 0, 0)
  return end.toISOString()
})

const {
  data: membersPayload,
  status: membersStatus,
  error: membersError,
} = await useAsyncData<OrganizationMembersPayload>(
  `calendar-members-${organizationSlug.value}`,
  () => requestFetch(orgApiPath('/members')),
  {
    default: (): OrganizationMembersPayload => ({
      currentUserId: '',
      role: 'expert',
      canAssignOthers: false,
      members: [],
    }),
  },
)

const expertItems = computed(() => membersPayload.value.members.map(member => ({
  label: member.userId === membersPayload.value.currentUserId
    ? `${member.fullName || member.email} · Ty`
    : member.fullName || member.email,
  value: member.userId,
})))

watch(expertItems, (items) => {
  if (items.some(item => item.value === selectedExpertId.value)) return
  const requestedExpert = typeof route.query.expert === 'string' ? route.query.expert : ''
  selectedExpertId.value = items.find(item => item.value === requestedExpert)?.value
    ?? items.find(item => item.value === membersPayload.value.currentUserId)?.value
    ?? items[0]?.value
    ?? ''
}, { immediate: true })

const {
  data: appointmentsPayload,
  status: appointmentsStatus,
  error: appointmentsError,
  refresh: refreshAppointments,
} = await useAsyncData<CalendarPayload>(
  `expert-calendar-${organizationSlug.value}`,
  async () => {
    if (!selectedExpertId.value) return { data: [], count: 0 }

    const pageSize = 200
    const query = {
      expertUserId: selectedExpertId.value,
      startsFrom: rangeStartIso.value,
      startsBefore: rangeEndIso.value,
      status: 'confirmed',
      limit: pageSize,
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
    }
  },
  {
    watch: [selectedExpertId, rangeStartIso, rangeEndIso],
    default: (): CalendarPayload => ({ data: [], count: 0 }),
  },
)

watch([selectedExpertId, weekStart], ([expertId, start]) => {
  if (!import.meta.client || !expertId) return
  const date = dateKey(start)
  if (route.query.expert === expertId && route.query.date === date) return
  void router.replace({
    query: {
      ...route.query,
      expert: expertId,
      date,
    },
  })
}, { flush: 'post' })

const appointments = computed(() => appointmentsPayload.value.data)
const confirmedCount = computed(() => appointments.value.filter(item => item.status === 'confirmed').length)
const selectedExpert = computed(() => expertItems.value.find(item => item.value === selectedExpertId.value) ?? null)
const today = computed(() => dateKey(new Date()))
const isCurrentWeek = computed(() => {
  const current = dateFromKey(today.value)
  return current >= weekStart.value && current < addDays(weekStart.value, 7)
})

const weekLabel = computed(() => {
  const start = weekStart.value
  const end = weekEnd.value
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    return `${start.getDate()}–${new Intl.DateTimeFormat('pl-PL', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(end)}`
  }
  return `${new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric',
    month: 'long',
  }).format(start)} – ${new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(end)}`
})

function appointmentMinutes(value: string) {
  const date = new Date(value)
  return date.getHours() * 60 + date.getMinutes()
}

const calendarBounds = computed(() => {
  let earliest = 8 * 60
  let latest = 18 * 60
  for (const appointment of appointments.value) {
    earliest = Math.min(earliest, appointmentMinutes(appointment.starts_at))
    latest = Math.max(latest, appointmentMinutes(appointment.ends_at))
  }
  return {
    startHour: Math.max(0, Math.min(23, Math.floor(earliest / 60))),
    endHour: Math.max(1, Math.min(24, Math.ceil(latest / 60))),
  }
})

const hourMarkers = computed(() => Array.from(
  { length: calendarBounds.value.endHour - calendarBounds.value.startHour + 1 },
  (_, index) => calendarBounds.value.startHour + index,
))
const gridHeight = computed(() => (
  calendarBounds.value.endHour - calendarBounds.value.startHour
) * hourHeight)

function positionAppointmentsForDay(key: string) {
  const events: CalendarEventLayout[] = appointments.value
    .filter(appointment => dateKey(new Date(appointment.starts_at)) === key)
    .map(appointment => ({
      appointment,
      startMinute: appointmentMinutes(appointment.starts_at),
      endMinute: Math.max(
        appointmentMinutes(appointment.starts_at) + 15,
        appointmentMinutes(appointment.ends_at),
      ),
      lane: 0,
      laneCount: 1,
    }))
    .sort((left, right) => left.startMinute - right.startMinute || left.endMinute - right.endMinute)

  const positioned: CalendarEventLayout[] = []
  let cluster: CalendarEventLayout[] = []
  let clusterEnd = -1

  function flushCluster() {
    if (!cluster.length) return
    const laneEnds: number[] = []
    for (const event of cluster) {
      let lane = laneEnds.findIndex(endMinute => endMinute <= event.startMinute)
      if (lane === -1) lane = laneEnds.length
      laneEnds[lane] = event.endMinute
      event.lane = lane
    }
    for (const event of cluster) event.laneCount = laneEnds.length
    positioned.push(...cluster)
    cluster = []
    clusterEnd = -1
  }

  for (const event of events) {
    if (cluster.length && event.startMinute >= clusterEnd) flushCluster()
    cluster.push(event)
    clusterEnd = Math.max(clusterEnd, event.endMinute)
  }
  flushCluster()
  return positioned
}

const calendarDays = computed<CalendarDay[]>(() => Array.from({ length: 7 }, (_, index) => {
  const date = addDays(weekStart.value, index)
  const key = dateKey(date)
  const weekday = new Intl.DateTimeFormat('pl-PL', { weekday: 'short' })
    .format(date)
    .replace('.', '')
  return {
    date,
    key,
    weekday: weekday.charAt(0).toLocaleUpperCase('pl') + weekday.slice(1),
    dayNumber: new Intl.DateTimeFormat('pl-PL', { day: '2-digit' }).format(date),
    accessibleLabel: new Intl.DateTimeFormat('pl-PL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(date),
    isToday: key === today.value,
    events: positionAppointmentsForDay(key),
  }
}))

function moveWeek(direction: number) {
  selectedDate.value = dateKey(addDays(weekStart.value, direction * 7))
}

function goToToday() {
  selectedDate.value = today.value
}

function formatHour(hour: number) {
  return `${String(hour).padStart(2, '0')}:00`
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('pl-PL', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatAppointmentDate(appointment: Appointment) {
  return new Intl.DateTimeFormat('pl-PL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(appointment.starts_at))
}

function statusLabel(status: AppointmentStatus) {
  if (status === 'confirmed') return 'Potwierdzone'
  if (status === 'hold') return 'Oczekuje na potwierdzenie'
  return 'Anulowane'
}

function statusColor(status: AppointmentStatus): 'success' | 'warning' | 'neutral' {
  if (status === 'confirmed') return 'success'
  if (status === 'hold') return 'warning'
  return 'neutral'
}

function meetingCountLabel(count: number) {
  if (count === 1) return '1 spotkanie'
  const lastTwo = count % 100
  const last = count % 10
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return `${count} spotkania`
  return `${count} spotkań`
}

function eventStyle(event: CalendarEventLayout) {
  const visibleStart = calendarBounds.value.startHour * 60
  const visibleEnd = calendarBounds.value.endHour * 60
  const start = Math.max(visibleStart, event.startMinute)
  const end = Math.min(visibleEnd, event.endMinute)
  const laneWidth = 100 / event.laneCount
  return {
    top: `${((start - visibleStart) / 60) * hourHeight + 2}px`,
    height: `${Math.max(44, ((end - start) / 60) * hourHeight - 4)}px`,
    left: `calc(${event.lane * laneWidth}% + 3px)`,
    width: `calc(${laneWidth}% - 6px)`,
  }
}

function hourMarkerStyle(hour: number) {
  return {
    top: `${(hour - calendarBounds.value.startHour) * hourHeight}px`,
  }
}

function openAppointment(appointment: Appointment) {
  selectedAppointment.value = appointment
  appointmentOpen.value = true
}

function eventAccessibleLabel(appointment: Appointment) {
  return `${formatTime(appointment.starts_at)}–${formatTime(appointment.ends_at)}, ${appointment.customer_name}, ${appointment.serviceName}, ${statusLabel(appointment.status)}`
}
</script>

<template>
  <CrmShell
    title="Kalendarz"
    eyebrow="Ekspert"
    description="Spotkania, dostępność i terminy zespołu w jednym widoku."
  >
    <template #meta>
      <div class="calendar-meta">
        <span><UIcon name="i-lucide-calendar-range" />{{ weekLabel }}</span>
        <span><UIcon name="i-lucide-user-round" />{{ selectedExpert?.label || 'Wybierz eksperta' }}</span>
        <span><UIcon name="i-lucide-clock-3" />{{ browserTimezone }}</span>
      </div>
    </template>

    <template #actions>
      <USelect
        v-model="selectedExpertId"
        class="calendar-expert-select"
        :items="expertItems"
        value-key="value"
        icon="i-lucide-user-round"
        :loading="membersStatus === 'pending'"
        :disabled="!expertItems.length"
        aria-label="Ekspert wyświetlany w kalendarzu"
      />
      <UInput
        v-model="selectedDate"
        class="calendar-date-input"
        type="date"
        icon="i-lucide-calendar-days"
        aria-label="Przejdź do wybranej daty"
      />
    </template>

    <section class="calendar-surface" aria-labelledby="calendar-range-heading">
      <header class="calendar-toolbar">
        <div class="calendar-toolbar__navigation">
          <UButton
            color="neutral"
            variant="outline"
            :disabled="isCurrentWeek"
            @click="goToToday"
          >
            Dziś
          </UButton>
          <div class="calendar-toolbar__arrows" aria-label="Nawigacja po tygodniach">
            <UButton
              icon="i-lucide-chevron-left"
              color="neutral"
              variant="outline"
              square
              aria-label="Poprzedni tydzień"
              @click="moveWeek(-1)"
            />
            <UButton
              icon="i-lucide-chevron-right"
              color="neutral"
              variant="outline"
              square
              aria-label="Następny tydzień"
              @click="moveWeek(1)"
            />
          </div>
          <div>
            <p>Widok tygodnia</p>
            <h2 id="calendar-range-heading">{{ weekLabel }}</h2>
          </div>
        </div>

        <div class="calendar-toolbar__summary">
          <div class="calendar-legend" aria-label="Legenda statusów spotkań">
            <span><i class="calendar-legend__dot calendar-legend__dot--confirmed" />Potwierdzone {{ confirmedCount }}</span>
          </div>
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="ghost"
            square
            :loading="appointmentsStatus === 'pending'"
            aria-label="Odśwież spotkania"
            @click="refreshAppointments()"
          />
        </div>
      </header>

      <UAlert
        v-if="membersError"
        class="calendar-message"
        color="error"
        variant="subtle"
        icon="i-lucide-users-round"
        title="Nie udało się pobrać ekspertów"
        :description="apiErrorMessage(membersError)"
      />
      <UAlert
        v-else-if="membersStatus !== 'pending' && !expertItems.length"
        class="calendar-message"
        color="warning"
        variant="subtle"
        icon="i-lucide-user-x"
        title="Brak ekspertów w organizacji"
        description="Dodaj członka organizacji, aby wyświetlić jego spotkania."
      />
      <UAlert
        v-else-if="appointmentsError"
        class="calendar-message"
        color="error"
        variant="subtle"
        icon="i-lucide-calendar-x-2"
        title="Nie udało się pobrać spotkań"
        :description="apiErrorMessage(appointmentsError)"
      >
        <template #actions>
          <UButton color="neutral" variant="ghost" icon="i-lucide-refresh-cw" @click="refreshAppointments()">
            Spróbuj ponownie
          </UButton>
        </template>
      </UAlert>

      <div v-if="appointmentsStatus === 'pending' && !appointments.length" class="calendar-loading" aria-label="Ładowanie kalendarza">
        <div class="calendar-loading__head">
          <USkeleton v-for="index in 7" :key="index" class="h-14 w-full" />
        </div>
        <USkeleton class="h-[520px] w-full" />
      </div>

      <template v-else-if="!membersError && !appointmentsError && expertItems.length">
        <div class="calendar-grid-wrap">
          <div class="calendar-grid" role="grid" :aria-label="`Spotkania: ${weekLabel}`">
            <div class="calendar-grid__corner">Czas</div>
            <div
              v-for="day in calendarDays"
              :key="`head-${day.key}`"
              class="calendar-day-head"
              :class="{ 'calendar-day-head--today': day.isToday }"
              role="columnheader"
              :aria-label="day.accessibleLabel"
            >
              <span>{{ day.weekday }}</span>
              <strong>{{ day.dayNumber }}</strong>
              <small>{{ meetingCountLabel(day.events.length) }}</small>
            </div>

            <div class="calendar-time-rail" :style="{ height: `${gridHeight}px` }" aria-hidden="true">
              <span
                v-for="hour in hourMarkers"
                :key="hour"
                :style="hourMarkerStyle(hour)"
              >{{ formatHour(hour) }}</span>
            </div>

            <section
              v-for="day in calendarDays"
              :key="day.key"
              class="calendar-day-column"
              :class="{ 'calendar-day-column--today': day.isToday }"
              :style="{ height: `${gridHeight}px` }"
              role="gridcell"
              :aria-label="day.accessibleLabel"
            >
              <i
                v-for="hour in hourMarkers"
                :key="`${day.key}-${hour}`"
                class="calendar-hour-line"
                :style="hourMarkerStyle(hour)"
                aria-hidden="true"
              />
              <button
                v-for="event in day.events"
                :key="event.appointment.id"
                type="button"
                class="calendar-event"
                :class="`calendar-event--${event.appointment.status}`"
                :style="eventStyle(event)"
                :aria-label="eventAccessibleLabel(event.appointment)"
                @click="openAppointment(event.appointment)"
              >
                <span class="calendar-event__time">
                  {{ formatTime(event.appointment.starts_at) }}–{{ formatTime(event.appointment.ends_at) }}
                </span>
                <strong>{{ event.appointment.customer_name }}</strong>
                <span class="calendar-event__service">{{ event.appointment.serviceName }}</span>
                <span class="calendar-event__facility">{{ event.appointment.facilityName }}</span>
              </button>
            </section>
          </div>
        </div>

        <div class="calendar-agenda" aria-label="Spotkania w widoku listy">
          <section
            v-for="day in calendarDays"
            :key="`agenda-${day.key}`"
            class="calendar-agenda-day"
            :class="{ 'calendar-agenda-day--today': day.isToday }"
          >
            <header>
              <div>
                <span>{{ day.weekday }}</span>
                <strong>{{ day.dayNumber }}</strong>
              </div>
              <small>{{ meetingCountLabel(day.events.length) }}</small>
            </header>
            <div v-if="day.events.length" class="calendar-agenda-day__events">
              <button
                v-for="event in day.events"
                :key="event.appointment.id"
                type="button"
                class="calendar-agenda-event"
                :class="`calendar-agenda-event--${event.appointment.status}`"
                @click="openAppointment(event.appointment)"
              >
                <span class="calendar-agenda-event__time">
                  {{ formatTime(event.appointment.starts_at) }}
                  <small>{{ formatTime(event.appointment.ends_at) }}</small>
                </span>
                <span class="calendar-agenda-event__copy">
                  <strong>{{ event.appointment.customer_name }}</strong>
                  <small>{{ event.appointment.serviceName }} · {{ event.appointment.facilityName }}</small>
                </span>
                <UIcon name="i-lucide-chevron-right" />
              </button>
            </div>
            <p v-else>Brak spotkań</p>
          </section>
        </div>

        <div v-if="!appointments.length" class="calendar-empty-note">
          <UIcon name="i-lucide-calendar-check-2" />
          <div>
            <strong>Ten tydzień jest wolny</strong>
            <span>Nie ma potwierdzonych spotkań dla wybranego eksperta.</span>
          </div>
        </div>
      </template>
    </section>

    <UModal
      v-model:open="appointmentOpen"
      :title="selectedAppointment?.customer_name || 'Szczegóły spotkania'"
      :description="selectedAppointment ? `${formatAppointmentDate(selectedAppointment)}, ${formatTime(selectedAppointment.starts_at)}–${formatTime(selectedAppointment.ends_at)}` : undefined"
      :ui="{ content: 'sm:max-w-xl', footer: 'justify-end' }"
    >
      <template v-if="selectedAppointment" #body>
        <div class="appointment-detail">
          <div class="appointment-detail__hero">
            <span><UIcon name="i-lucide-calendar-clock" /></span>
            <div>
              <strong>{{ formatAppointmentDate(selectedAppointment) }}</strong>
              <p>{{ formatTime(selectedAppointment.starts_at) }}–{{ formatTime(selectedAppointment.ends_at) }}</p>
            </div>
            <UBadge :color="statusColor(selectedAppointment.status)" variant="subtle">
              {{ statusLabel(selectedAppointment.status) }}
            </UBadge>
          </div>

          <dl class="appointment-detail__grid">
            <div>
              <dt>Usługa</dt>
              <dd>{{ selectedAppointment.serviceName || 'Spotkanie' }}</dd>
            </div>
            <div>
              <dt>Placówka</dt>
              <dd>{{ selectedAppointment.facilityName || 'Brak placówki' }}</dd>
            </div>
            <div>
              <dt>Ekspert</dt>
              <dd>{{ selectedAppointment.expertName || selectedExpert?.label }}</dd>
            </div>
            <div>
              <dt>Strefa czasowa wizyty</dt>
              <dd>{{ selectedAppointment.timezone }}</dd>
            </div>
          </dl>

          <div class="appointment-detail__contact">
            <div>
              <span>Kontakt do klienta</span>
              <strong>{{ selectedAppointment.customer_name }}</strong>
            </div>
            <a v-if="selectedAppointment.customer_email" :href="`mailto:${selectedAppointment.customer_email}`">
              <UIcon name="i-lucide-mail" />{{ selectedAppointment.customer_email }}
            </a>
            <a v-if="selectedAppointment.customer_phone" :href="`tel:${selectedAppointment.customer_phone}`">
              <UIcon name="i-lucide-phone" />{{ selectedAppointment.customer_phone }}
            </a>
          </div>

          <div v-if="selectedAppointment.notes" class="appointment-detail__notes">
            <span>Notatka</span>
            <p>{{ selectedAppointment.notes }}</p>
          </div>
        </div>
      </template>
      <template #footer="{ close }">
        <UButton color="neutral" variant="ghost" @click="close">Zamknij</UButton>
        <UButton
          v-if="selectedAppointment"
          :to="orgPath(`/clients/${selectedAppointment.client_id}`)"
          icon="i-lucide-user-round"
          @click="close"
        >
          Otwórz klienta
        </UButton>
      </template>
    </UModal>
  </CrmShell>
</template>

<style scoped>
.calendar-meta,
.calendar-toolbar,
.calendar-toolbar__navigation,
.calendar-toolbar__summary,
.calendar-legend,
.calendar-agenda-event,
.appointment-detail__hero,
.appointment-detail__contact a {
  display: flex;
  align-items: center;
}

.calendar-meta {
  flex-wrap: wrap;
  gap: 8px 16px;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.calendar-meta span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.calendar-expert-select {
  min-width: 240px;
}

.calendar-date-input {
  width: 168px;
}

.calendar-surface {
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background: var(--ui-bg);
  box-shadow: 0 18px 48px color-mix(in srgb, var(--ui-text-highlighted) 6%, transparent);
}

.calendar-toolbar {
  justify-content: space-between;
  gap: 18px;
  min-height: 82px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--ui-border);
}

.calendar-toolbar__navigation {
  gap: 12px;
  min-width: 0;
}

.calendar-toolbar__arrows {
  display: flex;
  gap: 6px;
}

.calendar-toolbar__navigation > div:last-child {
  min-width: 0;
  margin-left: 4px;
}

.calendar-toolbar__navigation p,
.calendar-toolbar__navigation h2 {
  margin: 0;
}

.calendar-toolbar__navigation p {
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.calendar-toolbar__navigation h2 {
  margin-top: 3px;
  color: var(--ui-text-highlighted);
  font-size: 20px;
  font-weight: 550;
  line-height: 1.2;
}

.calendar-toolbar__summary {
  flex: 0 0 auto;
  gap: 10px;
}

.calendar-legend {
  flex-wrap: wrap;
  gap: 10px 14px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.calendar-legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.calendar-legend__dot {
  display: block;
  width: 7px;
  height: 7px;
  border-radius: 999px;
}

.calendar-legend__dot--confirmed {
  background: var(--ui-success);
}

.calendar-message {
  margin: 16px;
}

.calendar-loading {
  display: grid;
  gap: 8px;
  padding: 16px;
}

.calendar-loading__head {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 8px;
}

.calendar-grid-wrap {
  max-height: min(74vh, 820px);
  overflow: auto;
  overscroll-behavior: contain;
}

.calendar-grid {
  display: grid;
  grid-template-columns: 68px repeat(7, minmax(148px, 1fr));
  min-width: 1120px;
  background: var(--ui-bg);
}

.calendar-grid__corner,
.calendar-day-head {
  position: sticky;
  top: 0;
  z-index: 5;
  min-height: 76px;
  border-bottom: 1px solid var(--ui-border);
  background: color-mix(in srgb, var(--ui-bg) 94%, var(--ui-bg-muted));
}

.calendar-grid__corner {
  left: 0;
  z-index: 7;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 0 8px 12px;
  color: var(--ui-text-dimmed);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.calendar-day-head {
  display: grid;
  grid-template-columns: auto auto;
  grid-template-rows: auto auto;
  align-content: center;
  justify-content: center;
  gap: 1px 7px;
  border-left: 1px solid var(--ui-border);
  color: var(--ui-text-muted);
  text-align: center;
}

.calendar-day-head span {
  align-self: center;
  font-size: 12px;
  font-weight: 600;
}

.calendar-day-head strong {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 999px;
  color: var(--ui-text-highlighted);
  font-size: 17px;
  font-weight: 600;
}

.calendar-day-head small {
  grid-column: 1 / -1;
  color: var(--ui-text-dimmed);
  font-size: 9px;
}

.calendar-day-head--today strong {
  background: var(--ui-bg-inverted);
  color: var(--ui-text-inverted);
}

.calendar-time-rail {
  position: sticky;
  left: 0;
  z-index: 4;
  background: var(--ui-bg);
}

.calendar-time-rail span {
  position: absolute;
  right: 10px;
  color: var(--ui-text-dimmed);
  font-family: var(--font-mono);
  font-size: 9px;
  line-height: 1;
  transform: translateY(-50%);
}

.calendar-day-column {
  position: relative;
  min-width: 0;
  border-left: 1px solid var(--ui-border);
  background: var(--ui-bg);
}

.calendar-day-column--today {
  background: color-mix(in srgb, var(--ui-primary) 2.5%, var(--ui-bg));
}

.calendar-hour-line {
  position: absolute;
  right: 0;
  left: 0;
  height: 1px;
  background: var(--ui-border-muted);
  pointer-events: none;
}

.calendar-event {
  position: absolute;
  z-index: 2;
  display: grid;
  align-content: start;
  gap: 2px;
  min-width: 0;
  overflow: hidden;
  padding: 7px 8px;
  border: 1px solid;
  border-radius: 10px;
  color: var(--ui-text-highlighted);
  text-align: left;
  cursor: pointer;
  transition:
    transform var(--oe-motion-fast),
    box-shadow var(--oe-motion-fast),
    border-color var(--oe-motion-fast);
}

.calendar-event:hover,
.calendar-event:focus-visible {
  z-index: 3;
  transform: translateY(-1px);
  box-shadow: 0 8px 20px color-mix(in srgb, var(--ui-text-highlighted) 12%, transparent);
}

.calendar-event--confirmed {
  border-color: color-mix(in srgb, var(--ui-success) 36%, var(--ui-border));
  background: color-mix(in srgb, var(--ui-success) 11%, var(--ui-bg));
}

.calendar-event--hold {
  border-color: color-mix(in srgb, var(--ui-warning) 40%, var(--ui-border));
  background: color-mix(in srgb, var(--ui-warning) 11%, var(--ui-bg));
}

.calendar-event__time {
  color: var(--ui-text-toned);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 650;
}

.calendar-event strong,
.calendar-event__service,
.calendar-event__facility {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.calendar-event strong {
  margin-top: 1px;
  font-size: 12px;
  line-height: 1.3;
}

.calendar-event__service,
.calendar-event__facility {
  color: var(--ui-text-muted);
  font-size: 10px;
  line-height: 1.25;
}

.calendar-event__facility {
  margin-top: 1px;
  color: var(--ui-text-dimmed);
}

.calendar-agenda {
  display: none;
}

.calendar-empty-note {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 14px;
  padding: 13px 14px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  background: var(--ui-bg-muted);
}

.calendar-empty-note > .iconify {
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  color: var(--ui-success);
}

.calendar-empty-note div,
.calendar-empty-note strong,
.calendar-empty-note span {
  display: block;
}

.calendar-empty-note strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.calendar-empty-note span {
  margin-top: 2px;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.appointment-detail {
  display: grid;
  gap: 18px;
}

.appointment-detail__hero {
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  background: var(--ui-bg-muted);
}

.appointment-detail__hero > span {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 11px;
  background: var(--ui-bg-inverted);
  color: var(--ui-text-inverted);
}

.appointment-detail__hero > div {
  min-width: 0;
  margin-right: auto;
}

.appointment-detail__hero strong,
.appointment-detail__hero p {
  margin: 0;
}

.appointment-detail__hero strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
  text-transform: capitalize;
}

.appointment-detail__hero p {
  margin-top: 2px;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.appointment-detail__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin: 0;
}

.appointment-detail__grid div {
  min-width: 0;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--ui-border);
}

.appointment-detail__grid dt,
.appointment-detail__grid dd {
  margin: 0;
}

.appointment-detail__grid dt,
.appointment-detail__contact span,
.appointment-detail__notes span {
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.appointment-detail__grid dd {
  overflow: hidden;
  margin-top: 4px;
  color: var(--ui-text-highlighted);
  font-size: 13px;
  text-overflow: ellipsis;
}

.appointment-detail__contact {
  display: grid;
  gap: 8px;
}

.appointment-detail__contact strong {
  display: block;
  margin-top: 3px;
  color: var(--ui-text-highlighted);
}

.appointment-detail__contact a {
  gap: 7px;
  width: fit-content;
  color: var(--ui-text-toned);
  font-size: 12px;
  text-decoration: none;
}

.appointment-detail__contact a:hover {
  color: var(--ui-text-highlighted);
}

.appointment-detail__notes {
  padding: 13px 14px;
  border-left: 3px solid var(--ui-border-accented);
  background: var(--ui-bg-muted);
}

.appointment-detail__notes p {
  margin: 5px 0 0;
  color: var(--ui-text);
  font-size: 13px;
}

@media (max-width: 900px) {
  .calendar-expert-select {
    flex: 1 1 230px;
    min-width: 0;
  }

  .calendar-date-input {
    flex: 0 1 168px;
  }

  .calendar-toolbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .calendar-toolbar__summary {
    justify-content: space-between;
    width: 100%;
  }

  .calendar-grid-wrap {
    display: none;
  }

  .calendar-agenda {
    display: grid;
  }

  .calendar-agenda-day {
    padding: 15px 16px;
    border-bottom: 1px solid var(--ui-border);
  }

  .calendar-agenda-day:last-child {
    border-bottom: 0;
  }

  .calendar-agenda-day > header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .calendar-agenda-day > header div {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .calendar-agenda-day > header span {
    color: var(--ui-text-muted);
    font-size: 12px;
    font-weight: 600;
  }

  .calendar-agenda-day > header strong {
    display: grid;
    place-items: center;
    width: 29px;
    height: 29px;
    border-radius: 999px;
    color: var(--ui-text-highlighted);
    font-size: 15px;
  }

  .calendar-agenda-day--today > header strong {
    background: var(--ui-bg-inverted);
    color: var(--ui-text-inverted);
  }

  .calendar-agenda-day > header small,
  .calendar-agenda-day > p {
    color: var(--ui-text-dimmed);
    font-size: 10px;
  }

  .calendar-agenda-day > p {
    margin: 10px 0 0 37px;
  }

  .calendar-agenda-day__events {
    display: grid;
    gap: 7px;
    margin-top: 10px;
  }

  .calendar-agenda-event {
    gap: 12px;
    width: 100%;
    padding: 11px 12px;
    border: 1px solid var(--ui-border);
    border-radius: 11px;
    background: var(--ui-bg-muted);
    color: var(--ui-text);
    text-align: left;
  }

  .calendar-agenda-event--confirmed {
    border-left: 3px solid var(--ui-success);
  }

  .calendar-agenda-event--hold {
    border-left: 3px solid var(--ui-warning);
  }

  .calendar-agenda-event__time {
    display: grid;
    flex: 0 0 48px;
    color: var(--ui-text-highlighted);
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 650;
  }

  .calendar-agenda-event__time small {
    color: var(--ui-text-dimmed);
    font-size: 9px;
    font-weight: 500;
  }

  .calendar-agenda-event__copy {
    display: grid;
    min-width: 0;
    margin-right: auto;
  }

  .calendar-agenda-event__copy strong,
  .calendar-agenda-event__copy small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .calendar-agenda-event__copy strong {
    color: var(--ui-text-highlighted);
    font-size: 12px;
  }

  .calendar-agenda-event__copy small {
    margin-top: 2px;
    color: var(--ui-text-muted);
    font-size: 10px;
  }

  .calendar-agenda-event > .iconify {
    flex: 0 0 auto;
    color: var(--ui-text-dimmed);
  }
}

@media (max-width: 560px) {
  .calendar-expert-select,
  .calendar-date-input {
    flex-basis: 100%;
    width: 100%;
  }

  .calendar-toolbar__navigation {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr);
    width: 100%;
  }

  .calendar-toolbar__navigation > div:last-child {
    margin-left: 0;
  }

  .calendar-toolbar__navigation h2 {
    font-size: 17px;
  }

  .calendar-toolbar__summary,
  .calendar-legend {
    align-items: flex-start;
  }

  .calendar-legend {
    display: grid;
  }

  .appointment-detail__hero {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .appointment-detail__grid {
    grid-template-columns: 1fr;
  }
}
</style>
