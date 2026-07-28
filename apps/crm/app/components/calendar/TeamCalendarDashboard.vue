<script setup lang="ts">
import type {
  AppointmentStatus,
  TeamCalendarAppointment,
  TeamCalendarPayload,
  TeamCalendarTimeOff,
} from '~/types/scheduling'
import type { TeamCalendarMemberStats } from '~/utils/team-calendar'
import { apiErrorMessage } from '~/utils/api-error'
import {
  buildTeamCalendarStats,
  teamCalendarDateKey,
} from '~/utils/team-calendar'
import {
  addDaysToDateKey,
  startOfDateInTimezone,
} from '#shared/utils/zoned-date'

type AgendaEntry =
  | {
      kind: 'appointment'
      id: string
      startsAt: string
      appointment: TeamCalendarAppointment
    }
  | {
      kind: 'timeOff'
      id: string
      startsAt: string
      timeOff: TeamCalendarTimeOff
    }

const props = defineProps<{
  teamId: string
}>()

const teamTimezone = 'Europe/Warsaw'
const route = useRoute()
const router = useRouter()
const { orgApiPath, orgPath } = useOrganizationContext()

function queryValue(value: unknown) {
  return Array.isArray(value) ? value[0] : value
}

function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day!, 12))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month! - 1
    && date.getUTCDate() === day
}

function dateFromKey(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day!, 12))
}

function startOfWeekKey(value: string) {
  const date = dateFromKey(value)
  const offset = (date.getUTCDay() + 6) % 7
  return addDaysToDateKey(value, -offset)
}

const todayKey = teamCalendarDateKey(new Date(), teamTimezone)
const initialQueryDate = queryValue(route.query.date)
const selectedDate = ref(isDateKey(initialQueryDate) ? initialQueryDate : todayKey)
const selectedMemberId = ref('all')
const agendaStatus = ref<'active' | AppointmentStatus | 'all'>('active')

const weekStartKey = computed(() => startOfWeekKey(selectedDate.value))
const weekEndKey = computed(() => addDaysToDateKey(weekStartKey.value, 6))
const startsFrom = computed(() => startOfDateInTimezone(weekStartKey.value, teamTimezone))
const startsBefore = computed(() => startOfDateInTimezone(
  addDaysToDateKey(weekStartKey.value, 7),
  teamTimezone,
))
const weekDays = computed(() => Array.from({ length: 7 }, (_, index) => {
  const key = addDaysToDateKey(weekStartKey.value, index)
  const date = dateFromKey(key)
  return {
    key,
    weekday: new Intl.DateTimeFormat('pl-PL', {
      weekday: 'short',
      timeZone: 'UTC',
    }).format(date).replace('.', ''),
    day: new Intl.DateTimeFormat('pl-PL', {
      day: '2-digit',
      month: '2-digit',
      timeZone: 'UTC',
    }).format(date),
    accessibleLabel: new Intl.DateTimeFormat('pl-PL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date),
    isToday: key === todayKey,
  }
}))
const isCurrentWeek = computed(() => (
  todayKey >= weekStartKey.value && todayKey <= weekEndKey.value
))

const {
  data: payload,
  status,
  error,
  refresh,
} = await useFetch<TeamCalendarPayload>(
  () => orgApiPath(`/teams/${props.teamId}/calendar`),
  {
    query: {
      startsFrom,
      startsBefore,
    },
  },
)

const emptyPayload = computed<TeamCalendarPayload>(() => ({
  team: { id: props.teamId, name: '' },
  period: {
    startsFrom: startsFrom.value,
    startsBefore: startsBefore.value,
  },
  members: [],
  appointments: [],
  timeOff: [],
}))
const calendarPayload = computed(() => payload.value ?? emptyPayload.value)
const calendarStats = computed(() => buildTeamCalendarStats(calendarPayload.value, {
  timeZone: teamTimezone,
}))
const memberItems = computed(() => [
  { label: 'Cały zespół', value: 'all' },
  ...calendarStats.value.members.map(item => ({
    label: memberName(item),
    value: item.member.userId,
  })),
])
const agendaStatusItems = [
  { label: 'Aktywne spotkania', value: 'active' },
  { label: 'Potwierdzone', value: 'confirmed' },
  { label: 'Oczekujące', value: 'hold' },
  { label: 'Anulowane', value: 'cancelled' },
  { label: 'Wszystkie statusy', value: 'all' },
]
const visibleMembers = computed(() => selectedMemberId.value === 'all'
  ? calendarStats.value.members
  : calendarStats.value.members.filter(item => item.member.userId === selectedMemberId.value))
const visibleSummary = computed(() => ({
  confirmed: visibleMembers.value.reduce((sum, item) => sum + item.confirmed, 0),
  hold: visibleMembers.value.reduce((sum, item) => sum + item.hold, 0),
  cancelled: visibleMembers.value.reduce((sum, item) => sum + item.cancelled, 0),
  scheduledMinutes: visibleMembers.value.reduce((sum, item) => sum + item.scheduledMinutes, 0),
  activeMembers: visibleMembers.value.filter(item => item.confirmed + item.hold > 0).length,
}))
const membersById = computed(() => new Map(
  calendarStats.value.members.map(item => [item.member.userId, item]),
))

watch(memberItems, (items) => {
  if (!items.some(item => item.value === selectedMemberId.value)) {
    selectedMemberId.value = 'all'
  }
})

function memberName(item?: TeamCalendarMemberStats) {
  return item?.member.fullName || item?.member.email || 'Nieznany ekspert'
}

function memberInitials(item?: TeamCalendarMemberStats) {
  return memberName(item)
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part.charAt(0).toUpperCase())
    .join('')
}

function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} godz. ${rest} min` : `${hours} godz.`
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('pl-PL', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: teamTimezone,
  }).format(new Date(value))
}

function formatDateTime(value: string | null) {
  if (!value) return 'Brak kolejnego spotkania w tym tygodniu'
  return new Intl.DateTimeFormat('pl-PL', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: teamTimezone,
  }).format(new Date(value))
}

const weekLabel = computed(() => {
  const start = dateFromKey(weekStartKey.value)
  const end = dateFromKey(weekEndKey.value)
  const startMonth = start.getUTCMonth()
  const endMonth = end.getUTCMonth()
  const year = end.getUTCFullYear()
  if (startMonth === endMonth) {
    return `${start.getUTCDate()}–${new Intl.DateTimeFormat('pl-PL', {
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }).format(end)} ${year}`
  }
  return `${new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(start)} – ${new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(end)}`
})

function setSelectedDate(value: unknown) {
  if (!isDateKey(value)) return
  selectedDate.value = value
  const date = startOfWeekKey(value)
  void router.replace({
    query: {
      ...route.query,
      view: 'calendar',
      date,
    },
  })
}

function moveWeek(direction: number) {
  setSelectedDate(addDaysToDateKey(weekStartKey.value, direction * 7))
}

function individualCalendarTo(userId: string, date = weekStartKey.value) {
  return {
    path: orgPath('/calendar'),
    query: { expert: userId, date },
  }
}

function memberRank(userId: string) {
  const index = calendarStats.value.members.findIndex(item => item.member.userId === userId)
  return index >= 0 ? index + 1 : '—'
}

function dayCellLabel(item: TeamCalendarMemberStats, key: string, dateLabel: string) {
  const day = item.byDay[key]
  if (!day) return `${memberName(item)}, ${dateLabel}: brak zdarzeń`
  const details = [
    day.confirmed ? `potwierdzone spotkania: ${day.confirmed}` : '',
    day.scheduledMinutes ? `czas: ${formatDuration(day.scheduledMinutes)}` : '',
    day.hold ? `oczekujące: ${day.hold}` : '',
    day.cancelled ? `anulowane: ${day.cancelled}` : '',
    day.timeOff ? 'urlop' : '',
  ].filter(Boolean)
  return `${memberName(item)}, ${dateLabel}: ${details.join(', ') || 'brak zdarzeń'}`
}

function timeOffCoversDate(item: TeamCalendarTimeOff, key: string) {
  const startsOn = teamCalendarDateKey(item.startsAt, teamTimezone)
  const inclusiveEnd = new Date(new Date(item.endsAt).valueOf() - 1)
  const endsOn = teamCalendarDateKey(inclusiveEnd, teamTimezone)
  return key >= startsOn && key <= endsOn
}

function appointmentMatchesStatus(item: TeamCalendarAppointment) {
  if (agendaStatus.value === 'all') return true
  if (agendaStatus.value === 'active') return item.status !== 'cancelled'
  return item.status === agendaStatus.value
}

const agendaDays = computed(() => weekDays.value.map((day) => {
  const entries: AgendaEntry[] = calendarPayload.value.appointments
    .filter(item => (
      teamCalendarDateKey(item.startsAt, teamTimezone) === day.key
      && (selectedMemberId.value === 'all' || item.expertUserId === selectedMemberId.value)
      && appointmentMatchesStatus(item)
    ))
    .map(appointment => ({
      kind: 'appointment' as const,
      id: appointment.id,
      startsAt: appointment.startsAt,
      appointment,
    }))

  if (agendaStatus.value === 'active' || agendaStatus.value === 'all') {
    entries.push(...calendarPayload.value.timeOff
      .filter(item => (
        timeOffCoversDate(item, day.key)
        && (selectedMemberId.value === 'all' || item.expertUserId === selectedMemberId.value)
      ))
      .map(timeOff => ({
        kind: 'timeOff' as const,
        id: timeOff.id,
        startsAt: timeOff.startsAt,
        timeOff,
      })))
  }

  return {
    ...day,
    entries: entries.sort((left, right) => (
      left.kind === right.kind
        ? left.startsAt.localeCompare(right.startsAt)
        : left.kind === 'timeOff' ? -1 : 1
    )),
  }
}).filter(day => day.entries.length))

function statusLabel(statusValue: AppointmentStatus) {
  if (statusValue === 'confirmed') return 'Potwierdzone'
  if (statusValue === 'hold') return 'Oczekuje'
  return 'Anulowane'
}

function statusColor(statusValue: AppointmentStatus) {
  if (statusValue === 'confirmed') return 'success'
  if (statusValue === 'hold') return 'warning'
  return 'neutral'
}
</script>

<template>
  <div class="team-calendar-dashboard">
    <div class="team-calendar-intro">
      <div>
        <span class="team-calendar-eyebrow">Kalendarz całego zespołu</span>
        <h2>Obłożenie i spotkania</h2>
        <p>Zakres obejmuje ten zespół oraz jego podzespoły. Kliknij osobę lub dzień, aby przejść do szczegółowego kalendarza.</p>
      </div>
      <div class="team-calendar-intro__actions">
        <USelectMenu
          v-model="selectedMemberId"
          class="team-calendar-member-select"
          :items="memberItems"
          value-key="value"
          label-key="label"
          icon="i-lucide-users-round"
          placeholder="Wyszukaj eksperta"
          aria-label="Filtruj kalendarz po osobie"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          :loading="status === 'pending'"
          @click="() => refresh()"
        >
          Odśwież
        </UButton>
      </div>
    </div>

    <section class="team-calendar-toolbar" aria-labelledby="team-calendar-week">
      <div class="team-calendar-toolbar__navigation">
        <UButton
          color="neutral"
          variant="outline"
          :disabled="isCurrentWeek"
          @click="setSelectedDate(todayKey)"
        >
          Dziś
        </UButton>
        <div class="team-calendar-toolbar__arrows" aria-label="Nawigacja po tygodniach">
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
          <span>Widok tygodnia</span>
          <h3 id="team-calendar-week">{{ weekLabel }}</h3>
        </div>
      </div>
      <UInput
        :model-value="selectedDate"
        type="date"
        icon="i-lucide-calendar-days"
        aria-label="Przejdź do wybranego tygodnia"
        @update:model-value="setSelectedDate"
      />
    </section>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-calendar-x-2"
      title="Nie udało się pobrać kalendarza zespołu"
      :description="apiErrorMessage(error)"
      :actions="[{ label: 'Spróbuj ponownie', onClick: () => refresh() }]"
    />

    <template v-else-if="status === 'pending'">
      <div class="team-calendar-kpis">
        <USkeleton v-for="index in 4" :key="index" class="h-28 w-full" />
      </div>
      <USkeleton class="h-80 w-full" />
    </template>

    <template v-else>
      <div class="team-calendar-kpis">
        <article>
          <span><UIcon name="i-lucide-calendar-check-2" /></span>
          <div>
            <small>Potwierdzone</small>
            <strong>{{ visibleSummary.confirmed }}</strong>
            <p>w wybranym tygodniu</p>
          </div>
        </article>
        <article>
          <span><UIcon name="i-lucide-users-round" /></span>
          <div>
            <small>Aktywni eksperci</small>
            <strong>{{ visibleSummary.activeMembers }}<em>/{{ visibleMembers.length }}</em></strong>
            <p>ze spotkaniami</p>
          </div>
        </article>
        <article>
          <span><UIcon name="i-lucide-clock-3" /></span>
          <div>
            <small>Czas spotkań</small>
            <strong>{{ formatDuration(visibleSummary.scheduledMinutes) }}</strong>
            <p>potwierdzone terminy</p>
          </div>
        </article>
        <article>
          <span><UIcon name="i-lucide-hourglass" /></span>
          <div>
            <small>Oczekujące</small>
            <strong>{{ visibleSummary.hold }}</strong>
            <p>{{ visibleSummary.cancelled }} anulowanych</p>
          </div>
        </article>
      </div>

      <UCard class="team-calendar-matrix">
        <template #header>
          <div class="team-calendar-card-heading">
            <div>
              <span class="team-calendar-eyebrow">Tydzień zespołu</span>
              <h3>Kto ma ile spotkań</h3>
            </div>
            <span class="team-calendar-legend">
              <i /> potwierdzone
              <i /> oczekujące
            </span>
          </div>
        </template>

        <div v-if="visibleMembers.length" class="team-calendar-matrix__scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Ekspert</th>
                <th
                  v-for="day in weekDays"
                  :key="day.key"
                  scope="col"
                  :class="{ 'is-today': day.isToday }"
                >
                  <span>{{ day.weekday }}</span>
                  <strong>{{ day.day }}</strong>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in visibleMembers" :key="item.member.userId">
                <th scope="row">
                  <NuxtLink :to="individualCalendarTo(item.member.userId)">
                    <UAvatar
                      :src="item.member.avatarUrl || undefined"
                      :alt="memberName(item)"
                      :text="memberInitials(item)"
                      size="lg"
                    />
                    <span>
                      <strong>{{ memberName(item) }}</strong>
                      <small>{{ item.confirmed }} spot. · {{ formatDuration(item.scheduledMinutes) }}</small>
                    </span>
                    <UIcon name="i-lucide-arrow-up-right" />
                  </NuxtLink>
                </th>
                <td
                  v-for="day in weekDays"
                  :key="day.key"
                  :class="{ 'is-today': day.isToday }"
                >
                  <NuxtLink
                    :to="individualCalendarTo(item.member.userId, day.key)"
                    :aria-label="dayCellLabel(item, day.key, day.accessibleLabel)"
                  >
                    <template v-if="item.byDay[day.key]">
                      <strong v-if="item.byDay[day.key]?.confirmed">
                        {{ item.byDay[day.key]?.confirmed }}
                        <small>{{ item.byDay[day.key]?.confirmed === 1 ? 'spotkanie' : 'spotkania' }}</small>
                      </strong>
                      <span v-if="item.byDay[day.key]?.scheduledMinutes">
                        {{ formatDuration(item.byDay[day.key]?.scheduledMinutes ?? 0) }}
                      </span>
                      <em v-if="item.byDay[day.key]?.hold">
                        +{{ item.byDay[day.key]?.hold }} oczek.
                      </em>
                      <em v-if="item.byDay[day.key]?.timeOff" class="is-time-off">
                        Urlop
                      </em>
                      <span
                        v-if="!item.byDay[day.key]?.confirmed && !item.byDay[day.key]?.hold && !item.byDay[day.key]?.timeOff"
                        class="is-empty"
                      >
                        —
                      </span>
                    </template>
                    <span v-else class="is-empty">—</span>
                  </NuxtLink>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="team-calendar-empty">
          <UIcon name="i-lucide-users-round" />
          <div>
            <strong>Brak osób w zakresie zespołu</strong>
            <p>Dodaj członków do zespołu lub jego podzespołów, aby zobaczyć obłożenie.</p>
          </div>
        </div>
      </UCard>

      <div class="team-calendar-details">
        <UCard class="team-calendar-ranking">
          <template #header>
            <div class="team-calendar-card-heading">
              <div>
                <span class="team-calendar-eyebrow">Obłożenie</span>
                <h3>Podsumowanie osób</h3>
              </div>
            </div>
          </template>
          <ol v-if="visibleMembers.length">
            <li v-for="item in visibleMembers" :key="item.member.userId">
              <span class="team-calendar-ranking__position">{{ memberRank(item.member.userId) }}</span>
              <UAvatar
                :src="item.member.avatarUrl || undefined"
                :alt="memberName(item)"
                :text="memberInitials(item)"
                size="lg"
              />
              <div>
                <NuxtLink :to="individualCalendarTo(item.member.userId)">
                  {{ memberName(item) }}
                </NuxtLink>
                <small>{{ formatDateTime(item.nextAt) }}</small>
              </div>
              <span class="team-calendar-ranking__result">
                <strong>{{ item.confirmed }}</strong>
                <small>{{ formatDuration(item.scheduledMinutes) }}</small>
              </span>
            </li>
          </ol>
          <div v-else class="team-calendar-empty team-calendar-empty--compact">
            <UIcon name="i-lucide-user-x" />
            <p>Brak osób do wyświetlenia.</p>
          </div>
        </UCard>

        <UCard class="team-calendar-agenda">
          <template #header>
            <div class="team-calendar-card-heading">
              <div>
                <span class="team-calendar-eyebrow">Agenda</span>
                <h3>Spotkania i nieobecności</h3>
              </div>
              <USelect
                v-model="agendaStatus"
                class="team-calendar-status-select"
                :items="agendaStatusItems"
                value-key="value"
                aria-label="Filtruj agendę po statusie"
              />
            </div>
          </template>

          <div v-if="agendaDays.length" class="team-calendar-agenda__days">
            <section v-for="day in agendaDays" :key="day.key">
              <header>
                <strong>{{ day.weekday }}</strong>
                <span>{{ day.day }}</span>
                <small>{{ day.entries.length === 1 ? '1 zdarzenie' : `${day.entries.length} zdarzeń` }}</small>
              </header>
              <div>
                <template v-for="entry in day.entries" :key="`${entry.kind}-${entry.id}-${day.key}`">
                  <NuxtLink
                    v-if="entry.kind === 'appointment'"
                    :to="individualCalendarTo(entry.appointment.expertUserId, day.key)"
                    class="team-calendar-agenda__entry"
                    :class="`is-${entry.appointment.status}`"
                  >
                    <time>{{ formatTime(entry.appointment.startsAt) }}</time>
                    <span>
                      <strong>{{ entry.appointment.customerName || 'Spotkanie' }}</strong>
                      <small>
                        {{ entry.appointment.serviceName || 'Usługa' }}
                        <template v-if="entry.appointment.facilityName"> · {{ entry.appointment.facilityName }}</template>
                      </small>
                    </span>
                    <span class="team-calendar-agenda__person">
                      {{ memberName(membersById.get(entry.appointment.expertUserId)) }}
                    </span>
                    <UBadge
                      :color="statusColor(entry.appointment.status)"
                      variant="subtle"
                      :label="statusLabel(entry.appointment.status)"
                    />
                  </NuxtLink>
                  <NuxtLink
                    v-else
                    :to="individualCalendarTo(entry.timeOff.expertUserId, day.key)"
                    class="team-calendar-agenda__entry is-time-off"
                  >
                    <span class="team-calendar-agenda__icon"><UIcon name="i-lucide-umbrella" /></span>
                    <span>
                      <strong>Urlop</strong>
                      <small>{{ memberName(membersById.get(entry.timeOff.expertUserId)) }}</small>
                    </span>
                    <UBadge color="neutral" variant="subtle" label="Nieobecność" />
                  </NuxtLink>
                </template>
              </div>
            </section>
          </div>
          <div v-else class="team-calendar-empty">
            <UIcon name="i-lucide-calendar-search" />
            <div>
              <strong>Brak zdarzeń dla wybranych filtrów</strong>
              <p>Zmień osobę, status lub przejdź do innego tygodnia.</p>
            </div>
          </div>
        </UCard>
      </div>
    </template>
  </div>
</template>

<style scoped>
.team-calendar-dashboard {
  display: grid;
  gap: 20px;
}

.team-calendar-intro,
.team-calendar-toolbar,
.team-calendar-card-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}

.team-calendar-intro {
  align-items: end;
}

.team-calendar-intro h2,
.team-calendar-toolbar h3,
.team-calendar-card-heading h3 {
  margin: 4px 0 0;
  color: var(--ui-text-highlighted);
}

.team-calendar-intro h2 {
  font-size: 22px;
}

.team-calendar-intro p {
  max-width: 720px;
  margin: 6px 0 0;
  color: var(--ui-text-muted);
  font-size: 13px;
  line-height: 1.55;
}

.team-calendar-eyebrow,
.team-calendar-toolbar__navigation > div:last-child > span {
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.team-calendar-intro__actions,
.team-calendar-toolbar__navigation,
.team-calendar-toolbar__arrows {
  display: flex;
  align-items: center;
  gap: 8px;
}

.team-calendar-member-select {
  width: min(260px, 42vw);
}

.team-calendar-toolbar {
  padding: 16px 18px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  background: var(--ui-bg);
}

.team-calendar-toolbar__navigation {
  gap: 12px;
}

.team-calendar-toolbar__navigation > div:last-child {
  display: grid;
  gap: 2px;
  margin-left: 4px;
}

.team-calendar-toolbar h3 {
  font-size: 16px;
}

.team-calendar-kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.team-calendar-kpis > article {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  min-height: 112px;
  padding: 17px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  background: var(--ui-bg);
}

.team-calendar-kpis > article > span {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 38px;
  height: 38px;
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  background: var(--ui-bg-muted);
}

.team-calendar-kpis > article > div {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.team-calendar-kpis small,
.team-calendar-kpis p {
  color: var(--ui-text-muted);
  font-size: 11px;
}

.team-calendar-kpis small {
  font-family: var(--font-mono);
  font-weight: 700;
  letter-spacing: .05em;
  text-transform: uppercase;
}

.team-calendar-kpis strong {
  color: var(--ui-text-highlighted);
  font-size: 26px;
  line-height: 1.1;
}

.team-calendar-kpis strong em {
  color: var(--ui-text-muted);
  font-size: 15px;
  font-style: normal;
}

.team-calendar-kpis p {
  margin: 0;
}

.team-calendar-card-heading {
  align-items: flex-start;
}

.team-calendar-card-heading h3 {
  font-size: 17px;
}

.team-calendar-legend {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.team-calendar-legend i {
  width: 7px;
  height: 7px;
  margin-left: 6px;
  border-radius: 50%;
  background: var(--ui-success);
}

.team-calendar-legend i:nth-of-type(2) {
  background: var(--ui-warning);
}

.team-calendar-matrix__scroll {
  overflow-x: auto;
  max-width: 100%;
  padding-bottom: 4px;
  scrollbar-width: thin;
}

.team-calendar-matrix table {
  width: 100%;
  min-width: 930px;
  border-collapse: separate;
  border-spacing: 0;
}

.team-calendar-matrix th,
.team-calendar-matrix td {
  border-right: 1px solid var(--ui-border);
  border-bottom: 1px solid var(--ui-border);
}

.team-calendar-matrix tr > :first-child {
  border-left: 1px solid var(--ui-border);
}

.team-calendar-matrix thead th {
  padding: 11px 8px;
  border-top: 1px solid var(--ui-border);
  color: var(--ui-text-muted);
  background: var(--ui-bg-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  text-align: center;
  text-transform: uppercase;
}

.team-calendar-matrix thead th:first-child {
  width: 230px;
  border-top-left-radius: 10px;
  text-align: left;
}

.team-calendar-matrix thead th:last-child {
  border-top-right-radius: 10px;
}

.team-calendar-matrix thead th span,
.team-calendar-matrix thead th strong {
  display: block;
}

.team-calendar-matrix thead th strong {
  margin-top: 2px;
  color: var(--ui-text);
  font-size: 11px;
}

.team-calendar-matrix .is-today {
  background: color-mix(in srgb, var(--ui-primary) 8%, var(--ui-bg));
}

.team-calendar-matrix tbody th {
  position: sticky;
  left: 0;
  z-index: 1;
  width: 230px;
  padding: 0;
  background: var(--ui-bg);
  text-align: left;
}

.team-calendar-matrix tbody th > a {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) 16px;
  align-items: center;
  gap: 10px;
  min-height: 78px;
  padding: 10px 12px;
  color: inherit;
  text-decoration: none;
}

.team-calendar-matrix tbody th > a:hover strong,
.team-calendar-ranking a:hover {
  color: var(--ui-primary);
}

.team-calendar-matrix tbody th > a > span:nth-child(2) {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.team-calendar-matrix tbody th strong {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.team-calendar-matrix tbody th small {
  color: var(--ui-text-muted);
  font-size: 10px;
  font-weight: 400;
}

.team-calendar-matrix td {
  width: calc((100% - 230px) / 7);
  min-width: 96px;
  padding: 0;
  vertical-align: stretch;
}

.team-calendar-matrix td > a {
  display: grid;
  place-content: center;
  min-height: 78px;
  padding: 8px;
  color: inherit;
  text-align: center;
  text-decoration: none;
}

.team-calendar-matrix td > a:hover {
  background: var(--ui-bg-muted);
}

.team-calendar-matrix td strong,
.team-calendar-matrix td strong small,
.team-calendar-matrix td span,
.team-calendar-matrix td em {
  display: block;
}

.team-calendar-matrix td strong {
  color: var(--ui-text-highlighted);
  font-size: 18px;
  line-height: 1;
}

.team-calendar-matrix td strong small,
.team-calendar-matrix td span,
.team-calendar-matrix td em {
  margin-top: 3px;
  color: var(--ui-text-muted);
  font-size: 9px;
  font-style: normal;
  font-weight: 500;
}

.team-calendar-matrix td em {
  color: var(--ui-warning);
}

.team-calendar-matrix td .is-time-off {
  color: var(--ui-text);
  font-weight: 700;
}

.team-calendar-matrix td .is-empty {
  margin: 0;
  color: var(--ui-text-dimmed);
  font-size: 14px;
}

.team-calendar-details {
  display: grid;
  grid-template-columns: minmax(280px, .72fr) minmax(0, 1.5fr);
  gap: 20px;
  align-items: start;
}

.team-calendar-ranking ol,
.team-calendar-agenda__days,
.team-calendar-agenda__days > section > div {
  display: grid;
  gap: 8px;
}

.team-calendar-ranking ol {
  margin: 0;
  padding: 0;
  list-style: none;
}

.team-calendar-ranking li {
  display: grid;
  grid-template-columns: 20px 36px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--ui-border);
}

.team-calendar-ranking li:last-child {
  border-bottom: 0;
}

.team-calendar-ranking__position {
  color: var(--ui-text-dimmed);
  font-family: var(--font-mono);
  font-size: 10px;
  text-align: center;
}

.team-calendar-ranking li > div {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.team-calendar-ranking a {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 12px;
  font-weight: 700;
  text-decoration: none;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.team-calendar-ranking li > div small,
.team-calendar-ranking__result small {
  color: var(--ui-text-muted);
  font-size: 9px;
}

.team-calendar-ranking__result {
  display: grid;
  justify-items: end;
  gap: 2px;
}

.team-calendar-ranking__result strong {
  color: var(--ui-text-highlighted);
  font-size: 17px;
}

.team-calendar-agenda__days > section {
  display: grid;
  grid-template-columns: 84px minmax(0, 1fr);
  gap: 14px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--ui-border);
}

.team-calendar-agenda__days > section:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.team-calendar-agenda__days > section > header {
  display: grid;
  align-content: start;
  gap: 2px;
}

.team-calendar-agenda__days > section > header strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
  text-transform: capitalize;
}

.team-calendar-agenda__days > section > header span {
  color: var(--ui-text);
  font-size: 11px;
}

.team-calendar-agenda__days > section > header small {
  color: var(--ui-text-muted);
  font-size: 9px;
}

.team-calendar-agenda__entry {
  position: relative;
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) minmax(90px, .45fr) auto;
  align-items: center;
  gap: 10px;
  padding: 10px 11px 10px 14px;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  color: inherit;
  text-decoration: none;
}

.team-calendar-agenda__entry::before {
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: var(--ui-success);
  content: '';
}

.team-calendar-agenda__entry.is-hold::before {
  background: var(--ui-warning);
}

.team-calendar-agenda__entry.is-cancelled {
  opacity: .65;
}

.team-calendar-agenda__entry.is-cancelled::before,
.team-calendar-agenda__entry.is-time-off::before {
  background: var(--ui-border-accented);
}

.team-calendar-agenda__entry:hover {
  border-color: var(--ui-border-accented);
  background: var(--ui-bg-muted);
}

.team-calendar-agenda__entry time,
.team-calendar-agenda__icon {
  color: var(--ui-text-highlighted);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
}

.team-calendar-agenda__entry > span:nth-child(2) {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.team-calendar-agenda__entry strong {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.team-calendar-agenda__entry small,
.team-calendar-agenda__person {
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.team-calendar-agenda__entry.is-time-off {
  grid-template-columns: 48px minmax(0, 1fr) auto;
}

.team-calendar-status-select {
  width: 190px;
}

.team-calendar-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 150px;
  color: var(--ui-text-muted);
  text-align: left;
}

.team-calendar-empty > svg {
  width: 28px;
  height: 28px;
}

.team-calendar-empty strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.team-calendar-empty p {
  margin: 3px 0 0;
  font-size: 11px;
}

.team-calendar-empty--compact {
  min-height: 90px;
}

@media (max-width: 1100px) {
  .team-calendar-kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .team-calendar-details {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 700px) {
  .team-calendar-intro,
  .team-calendar-toolbar,
  .team-calendar-card-heading {
    align-items: stretch;
    flex-direction: column;
  }

  .team-calendar-intro__actions {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .team-calendar-member-select,
  .team-calendar-status-select {
    width: 100%;
  }

  .team-calendar-toolbar__navigation {
    flex-wrap: wrap;
  }

  .team-calendar-toolbar__navigation > div:last-child {
    flex-basis: 100%;
    margin: 5px 0 0;
  }

  .team-calendar-kpis {
    grid-template-columns: 1fr;
  }

  .team-calendar-kpis > article {
    min-height: 94px;
  }

  .team-calendar-legend {
    flex-wrap: wrap;
  }

  .team-calendar-agenda__days > section {
    grid-template-columns: 1fr;
  }

  .team-calendar-agenda__days > section > header {
    grid-template-columns: auto auto 1fr;
    align-items: baseline;
    gap: 8px;
  }

  .team-calendar-agenda__entry {
    grid-template-columns: 42px minmax(0, 1fr) auto;
  }

  .team-calendar-agenda__person {
    grid-column: 2;
  }

  .team-calendar-agenda__entry > :last-child {
    grid-column: 3;
    grid-row: 1 / span 2;
  }
}

@media (max-width: 460px) {
  .team-calendar-intro__actions {
    grid-template-columns: 1fr;
  }

  .team-calendar-toolbar__navigation > button:first-child {
    flex: 1;
  }

  .team-calendar-agenda__entry {
    grid-template-columns: 42px minmax(0, 1fr);
  }

  .team-calendar-agenda__entry > :last-child {
    grid-column: 2;
    grid-row: auto;
    justify-self: start;
  }
}
</style>
