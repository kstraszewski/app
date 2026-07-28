<script setup lang="ts">
import type {
  Appointment,
  AppointmentStatus,
  ExpertTimeOff,
  ExpertTimeOffPayload,
  FacilityListPayload,
  FacilityAppointmentsPayload,
  OrganizationMembersPayload,
} from '~/types/scheduling'
import { instantDateKeyInTimezone } from '#shared/utils/zoned-date'

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

type CalendarEventDensity = 'compact' | 'standard' | 'expanded'

type CalendarDay = {
  date: Date
  key: string
  weekday: string
  dayNumber: string
  accessibleLabel: string
  isToday: boolean
  events: CalendarEventLayout[]
  timeOff: ExpertTimeOff[]
}

type CreatedCalendarEntry = {
  kind: 'appointment' | 'vacation'
  expertUserId: string
  startsAt: string
}

definePageMeta({ middleware: ['auth', 'organization'] })
useHead({ title: 'Kalendarz — OpenExpert CRM' })

const route = useRoute()
const router = useRouter()
const { organizationSlug, orgApiPath, orgPath } = useOrganizationContext()
const requestFetch = useRequestFetch()
const toast = useToast()
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
const requestedAppointmentId = computed(() => (
  typeof route.query.appointment === 'string' ? route.query.appointment : ''
))
const requestedAppointmentStartsAt = computed(() => (
  typeof route.query.appointmentAt === 'string' ? route.query.appointmentAt : ''
))
const selectedAppointment = ref<Appointment | null>(null)
const selectedTimeOff = ref<ExpertTimeOff | null>(null)
const appointmentOpen = ref(false)
const timeOffOpen = ref(false)
const createAppointmentOpen = ref(false)
const browserTimezone = ref('Europe/Warsaw')
const defaultFacilitySelection = ref('')
const savingDefaultFacility = ref(false)
const deletingTimeOff = ref(false)

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
const timeOffRangeStartIso = computed(() => addDays(weekStart.value, -2).toISOString())
const timeOffRangeEndIso = computed(() => {
  const end = addDays(weekStart.value, 9)
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

const {
  data: facilitiesPayload,
  status: facilitiesStatus,
  error: facilitiesError,
  refresh: refreshFacilities,
} = await useAsyncData<FacilityListPayload>(
  `calendar-facilities-${organizationSlug.value}`,
  () => requestFetch(orgApiPath('/facilities')),
  {
    default: (): FacilityListPayload => ({
      data: [],
      role: 'expert',
      canCreate: false,
      defaultFacilityId: null,
    }),
  },
)

const activeFacilities = computed(() => facilitiesPayload.value.data.filter(facility => (
  facility.is_active
)))
const defaultFacilityItems = computed(() => activeFacilities.value.map(facility => ({
  label: facility.city ? `${facility.name} · ${facility.city}` : facility.name,
  value: facility.id,
})))

watch(() => facilitiesPayload.value.defaultFacilityId, (facilityId) => {
  defaultFacilitySelection.value = facilityId
    ?? (activeFacilities.value.length === 1 ? activeFacilities.value[0]?.id ?? '' : '')
}, { immediate: true })

const expertItems = computed(() => membersPayload.value.members.map(member => ({
  label: member.userId === membersPayload.value.currentUserId
    ? `${member.fullName || member.email} · Ty`
    : member.fullName || member.email,
  value: member.userId,
  avatar: {
    src: member.avatarUrl || undefined,
    alt: member.fullName || member.email,
  },
})))

watch(expertItems, (items) => {
  if (items.some(item => item.value === selectedExpertId.value)) return
  const requestedExpert = typeof route.query.expert === 'string' ? route.query.expert : ''
  selectedExpertId.value = items.find(item => item.value === requestedExpert)?.value
    ?? items.find(item => item.value === membersPayload.value.currentUserId)?.value
    ?? items[0]?.value
    ?? ''
}, { immediate: true })

watch(
  [() => route.query.date, () => route.query.expert, expertItems],
  ([requestedDate, requestedExpert, items]) => {
    if (isDateKey(requestedDate) && requestedDate !== selectedDate.value) {
      selectedDate.value = requestedDate
    }
    if (
      typeof requestedExpert === 'string'
      && requestedExpert !== selectedExpertId.value
      && items.some(item => item.value === requestedExpert)
    ) {
      selectedExpertId.value = requestedExpert
    }
  },
  { immediate: true, flush: 'sync' },
)

watch(
  [requestedAppointmentId, requestedAppointmentStartsAt],
  ([appointmentId, appointmentStartsAt]) => {
    if (!import.meta.client || !appointmentId || !appointmentStartsAt) return
    const appointmentDate = new Date(appointmentStartsAt)
    if (Number.isNaN(appointmentDate.valueOf())) return
    const targetDate = dateKey(appointmentDate)
    if (targetDate !== selectedDate.value) selectedDate.value = targetDate
  },
  { immediate: true, flush: 'sync' },
)

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

const {
  data: timeOffPayload,
  status: timeOffStatus,
  error: timeOffError,
  refresh: refreshTimeOff,
} = await useAsyncData<ExpertTimeOffPayload>(
  `expert-time-off-${organizationSlug.value}`,
  async () => {
    if (!selectedExpertId.value) return { data: [] }
    return requestFetch<ExpertTimeOffPayload>(orgApiPath('/time-off'), {
      query: {
        expertUserId: selectedExpertId.value,
        startsFrom: timeOffRangeStartIso.value,
        startsBefore: timeOffRangeEndIso.value,
      },
    })
  },
  {
    watch: [selectedExpertId, timeOffRangeStartIso, timeOffRangeEndIso],
    default: (): ExpertTimeOffPayload => ({ data: [] }),
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
const timeOff = computed(() => timeOffPayload.value.data)
const confirmedCount = computed(() => appointments.value.filter(item => item.status === 'confirmed').length)
const vacationCount = computed(() => timeOff.value.length)
const selectedExpert = computed(() => expertItems.value.find(item => item.value === selectedExpertId.value) ?? null)
const today = computed(() => dateKey(new Date()))
const isCurrentWeek = computed(() => {
  const current = dateFromKey(today.value)
  return current >= weekStart.value && current < addDays(weekStart.value, 7)
})

watch(
  [appointments, requestedAppointmentId, appointmentsStatus],
  ([items, appointmentId, status]) => {
    if (!import.meta.client || !appointmentId || status === 'pending') return
    const appointment = items.find(item => item.id === appointmentId)
    if (!appointment) return
    if (appointmentOpen.value && selectedAppointment.value?.id === appointment.id) return
    openAppointment(appointment)
  },
  { immediate: true, flush: 'post' },
)

watch(appointmentOpen, (isOpen, wasOpen) => {
  if (!import.meta.client || isOpen || !wasOpen) return
  if (!selectedAppointment.value || requestedAppointmentId.value !== selectedAppointment.value.id) return
  void router.replace({
    query: {
      ...route.query,
      appointment: undefined,
      appointmentAt: undefined,
    },
  })
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

function timeOffForDay(key: string) {
  const matchingAllDay = timeOff.value.filter((item) => {
    if (!item.all_day) return false
    const startsOn = instantDateKeyInTimezone(item.starts_at, item.timezone)
    const inclusiveEnd = new Date(new Date(item.ends_at).getTime() - 1)
    const endsOn = instantDateKeyInTimezone(inclusiveEnd, item.timezone)
    return key >= startsOn && key <= endsOn
  })
  const day = dateFromKey(key)
  day.setHours(0, 0, 0, 0)
  const dayStart = day.getTime()
  const dayEnd = addDays(day, 1).getTime()
  const matchingTimed = timeOff.value.filter((item) => {
    if (item.all_day) return false
    const startsAt = new Date(item.starts_at).getTime()
    const endsAt = new Date(item.ends_at).getTime()
    return startsAt < dayEnd && endsAt > dayStart
  })
  return [...matchingAllDay, ...matchingTimed]
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
    timeOff: timeOffForDay(key),
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

function calendarEntryCountLabel(count: number) {
  if (count === 1) return '1 zdarzenie'
  const lastTwo = count % 100
  const last = count % 10
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return `${count} zdarzenia`
  return `${count} zdarzeń`
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

function eventDensity(event: CalendarEventLayout): CalendarEventDensity {
  const duration = event.endMinute - event.startMinute
  if (duration < 60) return 'compact'
  if (duration < 75) return 'standard'
  return 'expanded'
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

function openTimeOff(item: ExpertTimeOff) {
  selectedTimeOff.value = item
  timeOffOpen.value = true
}

function openCreateAppointment() {
  createAppointmentOpen.value = true
}

async function handleCalendarEntryCreated(entry: CreatedCalendarEntry) {
  selectedExpertId.value = entry.expertUserId
  selectedDate.value = dateKey(new Date(entry.startsAt))
  await nextTick()
  await Promise.all([refreshAppointments(), refreshTimeOff()])
}

function eventAccessibleLabel(appointment: Appointment) {
  return `${formatTime(appointment.starts_at)}–${formatTime(appointment.ends_at)}, ${appointment.customer_name}, ${appointment.serviceName}, ${appointment.meeting_mode === 'online' ? 'online' : appointment.facilityName}, ${statusLabel(appointment.status)}`
}

function timeOffAccessibleLabel(item: ExpertTimeOff) {
  return `Urlop: ${formatTimeOffRange(item)}`
}

function formatTimeOffRange(item: ExpertTimeOff) {
  const startsAt = new Date(item.starts_at)
  const inclusiveEnd = new Date(new Date(item.ends_at).getTime() - 1)
  const formatter = new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: item.timezone,
  })
  const startLabel = formatter.format(startsAt)
  const endLabel = formatter.format(inclusiveEnd)
  return startLabel === endLabel ? startLabel : `${startLabel} – ${endLabel}`
}

async function saveDefaultFacility(facilityId: string) {
  if (!facilityId || savingDefaultFacility.value) return
  const previous = facilitiesPayload.value.defaultFacilityId
  facilitiesPayload.value.defaultFacilityId = facilityId
  savingDefaultFacility.value = true
  try {
    await $fetch(orgApiPath('/me/scheduling-preferences'), {
      method: 'PATCH',
      body: { defaultFacilityId: facilityId },
    })
    await refreshFacilities()
    const facility = activeFacilities.value.find(item => item.id === facilityId)
    toast.add({
      title: 'Domyślna placówka została zapisana',
      description: facility?.name,
      color: 'success',
      icon: 'i-lucide-building-2',
    })
  } catch (error: unknown) {
    facilitiesPayload.value.defaultFacilityId = previous
    defaultFacilitySelection.value = previous ?? ''
    toast.add({
      title: 'Nie udało się zapisać placówki',
      description: apiErrorMessage(error),
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  } finally {
    savingDefaultFacility.value = false
  }
}

async function refreshCalendar() {
  await Promise.all([refreshAppointments(), refreshTimeOff(), refreshFacilities()])
}

async function deleteSelectedTimeOff() {
  const item = selectedTimeOff.value
  if (!item?.canManage || deletingTimeOff.value) return
  deletingTimeOff.value = true
  try {
    await $fetch(orgApiPath(`/time-off/${encodeURIComponent(item.id)}`), {
      method: 'DELETE',
    })
    timeOffOpen.value = false
    selectedTimeOff.value = null
    await refreshTimeOff()
    toast.add({
      title: 'Urlop został usunięty',
      color: 'success',
      icon: 'i-lucide-calendar-check-2',
    })
  } catch (error: unknown) {
    toast.add({
      title: 'Nie udało się usunąć urlopu',
      description: apiErrorMessage(error),
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  } finally {
    deletingTimeOff.value = false
  }
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
      <UButton
        icon="i-lucide-calendar-plus-2"
        :disabled="savingDefaultFacility"
        @click="openCreateAppointment"
      >
        Nowe zdarzenie
      </UButton>
      <USelect
        v-model="selectedExpertId"
        class="calendar-expert-select"
        :items="expertItems"
        value-key="value"
        :avatar="selectedExpert?.avatar"
        :loading="membersStatus === 'pending'"
        :disabled="!expertItems.length"
        aria-label="Ekspert wyświetlany w kalendarzu"
      />
      <USelect
        v-if="activeFacilities.length > 1"
        v-model="defaultFacilitySelection"
        class="calendar-facility-select"
        :items="defaultFacilityItems"
        value-key="value"
        icon="i-lucide-building-2"
        placeholder="Domyślna placówka"
        :loading="facilitiesStatus === 'pending' || savingDefaultFacility"
        :disabled="savingDefaultFacility"
        aria-label="Domyślna placówka użytkownika"
        @update:model-value="saveDefaultFacility"
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
          <div class="calendar-legend" aria-label="Legenda zdarzeń kalendarza">
            <span><i class="calendar-legend__dot calendar-legend__dot--confirmed" />Potwierdzone {{ confirmedCount }}</span>
            <span><i class="calendar-legend__dot calendar-legend__dot--vacation" />Urlopy {{ vacationCount }}</span>
          </div>
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="ghost"
            square
            :loading="appointmentsStatus === 'pending' || timeOffStatus === 'pending'"
            aria-label="Odśwież kalendarz"
            @click="refreshCalendar"
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
        v-else-if="appointmentsError || timeOffError || facilitiesError"
        class="calendar-message"
        color="error"
        variant="subtle"
        icon="i-lucide-calendar-x-2"
        title="Nie udało się pobrać kalendarza"
        :description="apiErrorMessage(appointmentsError || timeOffError || facilitiesError)"
      >
        <template #actions>
          <UButton color="neutral" variant="ghost" icon="i-lucide-refresh-cw" @click="refreshCalendar">
            Spróbuj ponownie
          </UButton>
        </template>
      </UAlert>

      <div
        v-if="(appointmentsStatus === 'pending' || timeOffStatus === 'pending') && !appointments.length && !timeOff.length"
        class="calendar-loading"
        aria-label="Ładowanie kalendarza"
      >
        <div class="calendar-loading__head">
          <USkeleton v-for="index in 7" :key="index" class="h-14 w-full" />
        </div>
        <USkeleton class="h-[520px] w-full" />
      </div>

      <template v-else-if="!membersError && !appointmentsError && !timeOffError && expertItems.length">
        <div class="calendar-grid-wrap">
          <div class="calendar-grid" role="grid" :aria-label="`Kalendarz: ${weekLabel}`">
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
              <small>{{ calendarEntryCountLabel(day.events.length + day.timeOff.length) }}</small>
            </div>

            <div class="calendar-all-day-label">Cały dzień</div>
            <div
              v-for="day in calendarDays"
              :key="`time-off-${day.key}`"
              class="calendar-all-day-cell"
              :class="{ 'calendar-all-day-cell--today': day.isToday }"
            >
              <button
                v-for="item in day.timeOff"
                :key="item.id"
                type="button"
                class="calendar-time-off"
                :aria-label="timeOffAccessibleLabel(item)"
                @click="openTimeOff(item)"
              >
                <UIcon name="i-lucide-plane" />
                <span>Urlop</span>
              </button>
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
                :class="[
                  `calendar-event--${event.appointment.status}`,
                  { 'calendar-event--online': event.appointment.meeting_mode === 'online' },
                  `calendar-event--${eventDensity(event)}`,
                ]"
                :style="eventStyle(event)"
                :aria-label="eventAccessibleLabel(event.appointment)"
                :title="eventAccessibleLabel(event.appointment)"
                @click="openAppointment(event.appointment)"
              >
                <span class="calendar-event__time">
                  {{ formatTime(event.appointment.starts_at) }}–{{ formatTime(event.appointment.ends_at) }}
                </span>
                <strong>{{ event.appointment.customer_name }}</strong>
                <span class="calendar-event__service">{{ event.appointment.serviceName }}</span>
                <span class="calendar-event__facility">
                  {{ event.appointment.meeting_mode === 'online' ? 'Online' : event.appointment.facilityName }}
                </span>
              </button>
            </section>
          </div>
        </div>

        <div class="calendar-agenda" aria-label="Kalendarz w widoku listy">
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
              <small>{{ calendarEntryCountLabel(day.events.length + day.timeOff.length) }}</small>
            </header>
            <div v-if="day.events.length || day.timeOff.length" class="calendar-agenda-day__events">
              <button
                v-for="item in day.timeOff"
                :key="`vacation-${item.id}`"
                type="button"
                class="calendar-agenda-event calendar-agenda-event--vacation"
                @click="openTimeOff(item)"
              >
                <span class="calendar-agenda-event__time">
                  Cały dzień
                </span>
                <span class="calendar-agenda-event__copy">
                  <strong>Urlop</strong>
                  <small>{{ formatTimeOffRange(item) }}</small>
                </span>
                <UIcon name="i-lucide-chevron-right" />
              </button>
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
                  <small>
                    {{ event.appointment.serviceName }}
                    · {{ event.appointment.meeting_mode === 'online' ? 'Online' : event.appointment.facilityName }}
                  </small>
                </span>
                <UIcon name="i-lucide-chevron-right" />
              </button>
            </div>
            <p v-else>Brak zdarzeń</p>
          </section>
        </div>

        <div v-if="!appointments.length && !timeOff.length" class="calendar-empty-note">
          <UIcon name="i-lucide-calendar-check-2" />
          <div>
            <strong>Ten tydzień jest wolny</strong>
            <span>Nie ma spotkań ani urlopów dla wybranego eksperta.</span>
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
            <span class="appointment-detail__icon"><UIcon name="i-lucide-calendar-clock" /></span>
            <div>
              <strong>{{ formatAppointmentDate(selectedAppointment) }}</strong>
              <p>{{ formatTime(selectedAppointment.starts_at) }}–{{ formatTime(selectedAppointment.ends_at) }}</p>
            </div>
            <UBadge
              class="appointment-detail__status"
              :color="statusColor(selectedAppointment.status)"
              :label="statusLabel(selectedAppointment.status)"
              variant="soft"
              size="sm"
              :icon="selectedAppointment.status === 'confirmed'
                ? 'i-lucide-circle-check'
                : selectedAppointment.status === 'hold'
                  ? 'i-lucide-clock-3'
                  : 'i-lucide-circle-x'"
            />
          </div>

          <dl class="appointment-detail__grid">
            <div>
              <dt>Usługa</dt>
              <dd>{{ selectedAppointment.serviceName || 'Spotkanie' }}</dd>
            </div>
            <div>
              <dt>Forma spotkania</dt>
              <dd>
                {{ selectedAppointment.meeting_mode === 'online'
                  ? 'Online'
                  : `W biurze · ${selectedAppointment.facilityName || 'Brak placówki'}` }}
              </dd>
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

          <UButton
            v-if="selectedAppointment.meeting_mode === 'online' && selectedAppointment.meeting_url"
            :href="selectedAppointment.meeting_url"
            target="_blank"
            rel="noopener noreferrer"
            external
            block
            icon="i-lucide-video"
          >
            Otwórz spotkanie online
          </UButton>
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

    <UModal
      v-model:open="timeOffOpen"
      title="Urlop"
      :description="selectedTimeOff ? formatTimeOffRange(selectedTimeOff) : undefined"
      :dismissible="!deletingTimeOff"
      :ui="{ content: 'sm:max-w-lg', footer: 'justify-between' }"
    >
      <template v-if="selectedTimeOff" #body>
        <div class="time-off-detail">
          <span><UIcon name="i-lucide-plane" /></span>
          <div>
            <small>Cały dzień</small>
            <strong>{{ formatTimeOffRange(selectedTimeOff) }}</strong>
            <p v-if="selectedTimeOff.notes">{{ selectedTimeOff.notes }}</p>
            <p v-else>W tym okresie ekspert jest niedostępny dla nowych rezerwacji.</p>
          </div>
        </div>
      </template>
      <template #footer="{ close }">
        <UButton color="neutral" variant="ghost" :disabled="deletingTimeOff" @click="close">
          Zamknij
        </UButton>
        <UButton
          v-if="selectedTimeOff?.canManage"
          color="error"
          variant="soft"
          icon="i-lucide-trash-2"
          :loading="deletingTimeOff"
          @click="deleteSelectedTimeOff"
        >
          Usuń urlop
        </UButton>
      </template>
    </UModal>

    <CalendarCreateAppointmentModal
      v-model:open="createAppointmentOpen"
      :initial-date="selectedDate"
      :initial-expert-id="selectedExpertId"
      @created="handleCalendarEntryCreated"
    />
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

.calendar-facility-select {
  min-width: 220px;
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

.calendar-legend__dot--vacation {
  background: var(--ui-primary);
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

.calendar-all-day-label,
.calendar-all-day-cell {
  min-height: 44px;
  border-bottom: 1px solid var(--ui-border);
  background: color-mix(in srgb, var(--ui-bg) 97%, var(--ui-bg-muted));
}

.calendar-all-day-label {
  position: sticky;
  left: 0;
  z-index: 4;
  display: grid;
  place-items: center;
  padding: 8px;
  color: var(--ui-text-dimmed);
  font-family: var(--font-mono);
  font-size: 8px;
  font-weight: 650;
  letter-spacing: .06em;
  text-align: center;
  text-transform: uppercase;
}

.calendar-all-day-cell {
  display: grid;
  align-content: center;
  gap: 4px;
  padding: 5px;
  border-left: 1px solid var(--ui-border);
}

.calendar-all-day-cell--today {
  background: color-mix(in srgb, var(--ui-primary) 3.5%, var(--ui-bg));
}

.calendar-time-off {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  padding: 5px 7px;
  border: 1px solid color-mix(in srgb, var(--ui-primary) 35%, var(--ui-border));
  border-radius: 8px;
  background:
    repeating-linear-gradient(
      -45deg,
      color-mix(in srgb, var(--ui-primary) 11%, var(--ui-bg)) 0 5px,
      color-mix(in srgb, var(--ui-primary) 6%, var(--ui-bg)) 5px 10px
    );
  color: var(--ui-text-highlighted);
  font-size: 10px;
  font-weight: 650;
}

.calendar-time-off .iconify {
  flex: 0 0 auto;
  color: var(--ui-primary);
}

.calendar-time-off span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  padding: 6px 8px;
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

.calendar-event--online {
  border-color: color-mix(in srgb, var(--ui-primary) 38%, var(--ui-border));
  background: color-mix(in srgb, var(--ui-primary) 9%, var(--ui-bg));
}

.calendar-event--compact {
  gap: 1px;
  padding: 5px 7px;
}

.calendar-event--compact .calendar-event__service,
.calendar-event--compact .calendar-event__facility,
.calendar-event--standard .calendar-event__facility {
  display: none;
}

.calendar-event__time {
  color: var(--ui-text-toned);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 650;
  line-height: 1.15;
}

.calendar-event strong,
.calendar-event__service,
.calendar-event__facility {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.calendar-event strong {
  font-size: 12px;
  line-height: 1.3;
}

.calendar-event--compact strong {
  font-size: 11px;
  line-height: 1.2;
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
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  background: var(--ui-bg-muted);
}

.appointment-detail__icon {
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
}

.appointment-detail__status {
  justify-self: end;
  white-space: nowrap;
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

.time-off-detail {
  display: flex;
  align-items: flex-start;
  gap: 13px;
  padding: 16px;
  border: 1px solid color-mix(in srgb, var(--ui-primary) 28%, var(--ui-border));
  border-radius: var(--ui-radius);
  background: color-mix(in srgb, var(--ui-primary) 6%, var(--ui-bg-muted));
}

.time-off-detail > span {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: var(--ui-bg);
  color: var(--ui-primary);
}

.time-off-detail > div {
  display: grid;
  gap: 3px;
}

.time-off-detail small {
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 650;
  letter-spacing: .06em;
  text-transform: uppercase;
}

.time-off-detail strong {
  color: var(--ui-text-highlighted);
  font-size: 14px;
}

.time-off-detail p {
  margin: 7px 0 0;
  color: var(--ui-text-muted);
  font-size: 12px;
}

@media (max-width: 900px) {
  .calendar-expert-select {
    flex: 1 1 230px;
    min-width: 0;
  }

  .calendar-facility-select {
    flex: 1 1 220px;
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

  .calendar-agenda-event--vacation {
    border-left: 3px solid var(--ui-primary);
    background: color-mix(in srgb, var(--ui-primary) 6%, var(--ui-bg-muted));
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
  .calendar-facility-select,
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
    grid-template-columns: auto minmax(0, 1fr);
    align-items: start;
  }

  .appointment-detail__status {
    grid-column: 2;
    justify-self: start;
  }

  .appointment-detail__grid {
    grid-template-columns: 1fr;
  }
}
</style>
