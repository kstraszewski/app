<script setup lang="ts">
import type { PublicBookingSlot } from '../../types/booking'
import type { BookingWeekDay } from '../../utils/booking-slots'

const props = withDefaults(defineProps<{
  days: BookingWeekDay[]
  rangeLabel: string
  selectedDate: string
  selectedSlot: PublicBookingSlot | null
  timezone: string
  pending: boolean
  error: string
  canGoPrevious: boolean
  expanded: boolean
  title?: string
  trustMessage?: string
  emptyWeekMessage?: string
  emptyDayMessage?: string
  emptyDayHint?: string
  retryLabel?: string
}>(), {
  title: 'Wybierz termin',
  trustMessage: 'Rezerwacja bezpłatna · potwierdzenie od razu',
  emptyWeekMessage: 'Brak wolnych terminów w tym tygodniu.',
  emptyDayMessage: 'Brak wolnych terminów tego dnia.',
  emptyDayHint: 'Wybierz inny dzień z paska powyżej.',
  retryLabel: '',
})

const emit = defineEmits<{
  previous: []
  next: []
  selectDate: [date: string]
  selectSlot: [slot: PublicBookingSlot, date: string]
  toggleExpanded: []
  retry: []
}>()

const headingId = useId()
const visibleSlotLimit = 8
const selectedDay = computed(() => (
  props.days.find(day => day.date === props.selectedDate) ?? props.days[0]
))
const desktopTimeRows = computed(() => (
  [...new Set(props.days.flatMap(day => visibleSlots(day).map(slotTime)))].sort()
))
const slotMapsByDate = computed(() => new Map(props.days.map((day) => {
  const slotsByTime = new Map<string, PublicBookingSlot>()
  for (const slot of visibleSlots(day)) {
    const time = slotTime(slot)
    if (!slotsByTime.has(time) || slotIsSelected(slot)) {
      slotsByTime.set(time, slot)
    }
  }
  return [day.date, slotsByTime] as const
})))
const desktopRows = computed(() => desktopTimeRows.value.map(time => ({
  time,
  cells: props.days.map(day => ({
    day,
    slot: slotMapsByDate.value.get(day.date)?.get(time) ?? null,
  })),
})))
const hasLaterSlots = computed(() => (
  props.days.some(day => day.slots.length > visibleSlotLimit)
))
const selectedDayHasLaterSlots = computed(() => (
  (selectedDay.value?.slots.length ?? 0) > visibleSlotLimit
))

function visibleSlots(day: BookingWeekDay) {
  if (props.expanded) return day.slots
  const visible = day.slots.slice(0, visibleSlotLimit)
  const selected = day.slots.find(slot => slotIsSelected(slot))
  return selected && !visible.some(slot => slotIsSelected(slot))
    ? [...visible, selected]
    : visible
}

function slotTime(slot: PublicBookingSlot) {
  return new Intl.DateTimeFormat('pl-PL', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: props.timezone,
  }).format(new Date(slot.startsAt))
}

function slotIsSelected(slot: PublicBookingSlot) {
  return props.selectedSlot?.startsAt === slot.startsAt
    && props.selectedSlot?.expertUserId === slot.expertUserId
}

function availableSlotsLabel(count: number) {
  if (count === 1) return '1 dostępny termin'
  const lastTwoDigits = count % 100
  const lastDigit = count % 10
  if (lastDigit >= 2 && lastDigit <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14)) {
    return `${count} dostępne terminy`
  }
  return `${count} dostępnych terminów`
}
</script>

<template>
  <section
    class="booking-week"
    :aria-labelledby="headingId"
    :aria-busy="pending"
  >
    <header class="booking-week__toolbar">
      <div class="booking-week__heading">
        <p>{{ title }}</p>

        <div class="booking-week__navigation" aria-label="Nawigacja po tygodniach">
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            square
            icon="i-lucide-chevron-left"
            aria-label="Poprzedni tydzień"
            :disabled="pending || !canGoPrevious"
            @click="emit('previous')"
          />
          <span class="booking-week__range">
            <UIcon name="i-lucide-calendar-days" aria-hidden="true" />
            <h2 :id="headingId">{{ rangeLabel }}</h2>
          </span>
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            square
            icon="i-lucide-chevron-right"
            aria-label="Następny tydzień"
            :disabled="pending"
            @click="emit('next')"
          />
        </div>
      </div>
    </header>

    <div
      v-if="pending"
      class="booking-week__loading"
      role="status"
      aria-label="Ładowanie dostępnych terminów"
    >
      <div v-for="day in 7" :key="day" class="booking-week__loading-column">
        <USkeleton class="h-14 w-full" />
        <USkeleton v-for="slot in 5" :key="slot" class="h-11 w-full" />
      </div>
    </div>

    <UAlert
      v-else-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Nie udało się pobrać terminów"
      :description="error"
      :actions="retryLabel ? [{ label: retryLabel, onClick: () => emit('retry') }] : undefined"
      role="alert"
    />

    <template v-else>
      <div
        class="booking-week__desktop"
        role="table"
        :aria-label="`Dostępne terminy: ${rangeLabel}`"
      >
        <div class="booking-week__header-row" role="row">
          <div class="booking-week__axis-header" role="columnheader">
            <span class="booking-week__sr-only">Godzina</span>
          </div>
          <div
            v-for="day in days"
            :key="day.date"
            class="booking-week__day-column-header"
            :class="{
              'booking-week__day-column-header--selected': day.date === selectedDate,
              'booking-week__day-column-header--empty': !day.slots.length,
            }"
            role="columnheader"
          >
            <button
              type="button"
              class="booking-week__day-header"
              :aria-label="`Wybierz ${day.ariaLabel}`"
              :aria-pressed="day.date === selectedDate"
              @click="emit('selectDate', day.date)"
            >
              <strong>{{ day.weekday }}</strong>
              <span>{{ day.dateLabel }}</span>
              <small v-if="day.slots.length">{{ availableSlotsLabel(day.slots.length) }}</small>
              <small v-else>Brak terminów</small>
            </button>
          </div>
        </div>

        <div
          v-if="!desktopRows.length"
          class="booking-week__desktop-empty"
          role="row"
        >
          <div role="cell">
            <UIcon name="i-lucide-calendar-x-2" aria-hidden="true" />
            {{ emptyWeekMessage }}
          </div>
        </div>

        <div
          v-for="row in desktopRows"
          v-else
          :key="row.time"
          class="booking-week__time-row"
          role="row"
        >
          <div class="booking-week__axis-label" role="rowheader">{{ row.time }}</div>
          <div
            v-for="cell in row.cells"
            :key="cell.day.date"
            class="booking-week__time-cell"
            :class="{ 'booking-week__time-cell--selected-day': cell.day.date === selectedDate }"
            role="cell"
            :aria-label="cell.slot ? undefined : `${row.time}, ${cell.day.ariaLabel}: brak terminu`"
          >
            <button
              v-if="cell.slot"
              type="button"
              class="booking-week__time"
              :class="{ 'booking-week__time--selected': slotIsSelected(cell.slot) }"
              :aria-pressed="slotIsSelected(cell.slot)"
              :aria-label="`${row.time}, ${cell.day.ariaLabel}`"
              @click="emit('selectSlot', cell.slot, cell.day.date)"
            >
              <span>{{ row.time }}</span>
              <UIcon v-if="slotIsSelected(cell.slot)" name="i-lucide-check" aria-hidden="true" />
            </button>
            <span v-else class="booking-week__time-unavailable" aria-hidden="true">—</span>
          </div>
        </div>
      </div>

      <div class="booking-week__mobile">
        <div class="booking-week__day-strip" aria-label="Wybierz dzień">
          <button
            v-for="day in days"
            :key="day.date"
            type="button"
            class="booking-week__day-chip"
            :class="{ 'booking-week__day-chip--selected': day.date === selectedDate }"
            :aria-pressed="day.date === selectedDate"
            @click="emit('selectDate', day.date)"
          >
            <small>{{ day.weekday }}</small>
            <strong>{{ day.dateLabel }}</strong>
            <span>{{ day.slots.length ? availableSlotsLabel(day.slots.length) : 'Brak' }}</span>
          </button>
        </div>

        <div
          v-if="selectedDay?.slots.length"
          class="booking-week__mobile-times"
          role="group"
          :aria-label="`Godziny: ${selectedDay.ariaLabel}`"
        >
          <button
            v-for="slot in visibleSlots(selectedDay)"
            :key="`${slot.startsAt}-${slot.expertUserId}`"
            type="button"
            class="booking-week__mobile-time"
            :class="{ 'booking-week__mobile-time--selected': slotIsSelected(slot) }"
            :aria-pressed="slotIsSelected(slot)"
            :aria-label="`${slotTime(slot)}, ${selectedDay.ariaLabel}`"
            @click="emit('selectSlot', slot, selectedDay.date)"
          >
            <span>
              <strong>{{ slotTime(slot) }}</strong>
              <small>{{ selectedDay.ariaLabel }}</small>
            </span>
            <UIcon
              :name="slotIsSelected(slot) ? 'i-lucide-circle-check' : 'i-lucide-circle'"
              aria-hidden="true"
            />
          </button>
        </div>

        <div v-else class="booking-week__mobile-empty" role="status">
          <UIcon name="i-lucide-calendar-x-2" aria-hidden="true" />
          <p>{{ emptyDayMessage }}</p>
          <small>{{ emptyDayHint }}</small>
        </div>
      </div>
    </template>

    <button
      v-if="!pending && !error && hasLaterSlots"
      type="button"
      class="booking-week__more booking-week__more--desktop"
      :aria-expanded="expanded"
      @click="emit('toggleExpanded')"
    >
      <UIcon
        :name="expanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        aria-hidden="true"
      />
      {{ expanded ? 'Pokaż mniej godzin' : 'Pokaż późniejsze godziny' }}
    </button>

    <button
      v-if="!pending && !error && selectedDayHasLaterSlots"
      type="button"
      class="booking-week__more booking-week__more--mobile"
      :aria-expanded="expanded"
      @click="emit('toggleExpanded')"
    >
      <UIcon
        :name="expanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        aria-hidden="true"
      />
      {{ expanded ? 'Pokaż mniej godzin' : 'Pokaż późniejsze godziny' }}
    </button>

    <p v-if="trustMessage" class="booking-week__trust">
      <UIcon name="i-lucide-shield-check" aria-hidden="true" />
      {{ trustMessage }}
    </p>
  </section>
</template>

<style scoped>
.booking-week {
  display: grid;
  gap: 16px;
}

.booking-week__toolbar {
  display: block;
}

.booking-week__heading {
  display: grid;
  gap: 8px;
}

.booking-week__toolbar p {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 18px;
  font-weight: 650;
}

.booking-week__toolbar h2 {
  margin: 0;
  color: var(--ui-text);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0;
}

.booking-week__navigation {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 4px;
}

.booking-week__navigation > :last-child {
  margin-left: auto;
}

.booking-week__range {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.booking-week__range > .icon {
  flex: 0 0 auto;
  color: var(--ui-text-muted);
  font-size: 16px;
}

.booking-week__loading {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  background: var(--ui-bg);
}

.booking-week__loading-column {
  display: grid;
  align-content: start;
  gap: 7px;
  min-width: 0;
  padding: 12px 9px;
  border-left: 1px solid var(--ui-border);
}

.booking-week__loading-column:first-child {
  border-left: 0;
}

.booking-week__desktop {
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  background: var(--ui-bg);
}

.booking-week__header-row,
.booking-week__time-row {
  display: grid;
  grid-template-columns: 64px repeat(7, minmax(0, 1fr));
}

.booking-week__header-row {
  min-height: 88px;
  border-bottom: 1px solid var(--ui-border);
}

.booking-week__axis-header {
  background: var(--ui-bg-muted);
}

.booking-week__day-column-header,
.booking-week__time-cell {
  min-width: 0;
  border-left: 1px solid var(--ui-border);
}

.booking-week__day-column-header--selected,
.booking-week__time-cell--selected-day {
  background: color-mix(in srgb, var(--booking-accent) 3.5%, var(--ui-bg));
}

.booking-week__day-header {
  display: grid;
  width: 100%;
  min-height: 88px;
  align-content: center;
  gap: 2px;
  padding: 10px 3px;
  border: 0;
  background: transparent;
  color: var(--ui-text);
  text-align: center;
  cursor: pointer;
}

.booking-week__day-header:hover strong {
  color: var(--booking-accent);
}

.booking-week__day-header strong {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color var(--oe-motion-fast);
}

.booking-week__day-header > span {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.booking-week__day-header small {
  margin-top: 4px;
  color: var(--ui-success);
  font-size: 10px;
}

.booking-week__day-column-header--empty .booking-week__day-header small {
  color: var(--ui-text-dimmed);
}

.booking-week__day-column-header--selected .booking-week__day-header {
  box-shadow: inset 0 -2px var(--booking-accent);
}

.booking-week__time-row {
  min-height: 52px;
  border-top: 1px solid var(--ui-border);
}

.booking-week__header-row + .booking-week__time-row {
  border-top: 0;
}

.booking-week__axis-label,
.booking-week__time-cell {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: center;
}

.booking-week__axis-label {
  padding: 5px 7px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-toned);
  font-family: var(--font-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.booking-week__time-cell {
  padding: 5px 8px;
}

.booking-week__time {
  position: relative;
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 40px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 8px;
  border: 1px solid var(--ui-border);
  border-radius: calc(var(--oe-radius-control) - 3px);
  background: var(--ui-bg);
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
  font-variant-numeric: tabular-nums;
  transition:
    border-color var(--oe-motion-fast),
    background-color var(--oe-motion-fast),
    color var(--oe-motion-fast),
    transform var(--oe-motion-fast);
}

.booking-week__time:hover {
  border-color: var(--booking-accent);
  transform: translateY(-1px);
}

.booking-week__time-cell--selected-day .booking-week__time {
  border-color: color-mix(in srgb, var(--booking-accent) 58%, var(--ui-border));
  color: var(--booking-accent);
}

.booking-week__time--selected {
  border-color: var(--booking-accent);
  background: var(--booking-accent);
  color: white !important;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, white 18%, transparent);
}

.booking-week__time .icon {
  position: absolute;
  right: 7px;
  font-size: 14px;
}

.booking-week__time-unavailable {
  color: var(--ui-text-dimmed);
  font-size: 12px;
  text-align: center;
}

.booking-week__desktop-empty {
  min-height: 132px;
}

.booking-week__desktop-empty > div {
  display: flex;
  min-height: 132px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.booking-week__sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}

.booking-week__mobile {
  display: none;
}

.booking-week__more {
  display: inline-flex;
  width: fit-content;
  align-items: center;
  gap: 7px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--booking-accent);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.booking-week__more--mobile {
  display: none;
}

.booking-week__trust {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.booking-week__trust .icon {
  flex: 0 0 auto;
  color: var(--booking-accent);
  font-size: 18px;
}

@media (max-width: 900px) {
  .booking-week__desktop {
    display: none;
  }

  .booking-week__loading {
    grid-template-columns: 1fr;
  }

  .booking-week__loading-column {
    display: none;
    border-left: 0;
  }

  .booking-week__loading-column:first-child {
    display: grid;
  }

  .booking-week__mobile {
    display: grid;
    gap: 16px;
  }

  .booking-week__more--desktop {
    display: none;
  }

  .booking-week__more--mobile {
    display: inline-flex;
  }

  .booking-week__day-strip {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding: 2px 2px 8px;
    scroll-snap-type: x proximity;
    scrollbar-width: none;
  }

  .booking-week__day-strip::-webkit-scrollbar {
    display: none;
  }

  .booking-week__day-chip {
    display: grid;
    min-width: 96px;
    min-height: 78px;
    align-content: center;
    gap: 2px;
    padding: 9px;
    border: 1px solid var(--ui-border);
    border-radius: var(--oe-radius-control);
    background: var(--ui-bg);
    color: var(--ui-text);
    text-align: center;
    scroll-snap-align: start;
  }

  .booking-week__day-chip small,
  .booking-week__day-chip span {
    color: var(--ui-text-muted);
    font-size: 10px;
  }

  .booking-week__day-chip strong {
    color: var(--ui-text-highlighted);
    font-size: 13px;
  }

  .booking-week__day-chip--selected {
    border-color: var(--booking-accent);
    background: color-mix(in srgb, var(--booking-accent) 9%, var(--ui-bg));
    box-shadow: inset 0 0 0 1px var(--booking-accent);
  }

  .booking-week__mobile-times {
    display: grid;
    gap: 8px;
  }

  .booking-week__mobile-time {
    display: flex;
    min-height: 56px;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 9px 14px;
    border: 1px solid var(--ui-border);
    border-radius: var(--oe-radius-control);
    background: var(--ui-bg);
    color: var(--ui-text);
    text-align: left;
  }

  .booking-week__mobile-time > span {
    display: grid;
    gap: 1px;
  }

  .booking-week__mobile-time strong {
    color: var(--ui-text-highlighted);
    font-size: 16px;
  }

  .booking-week__mobile-time small {
    color: var(--ui-text-muted);
    font-size: 11px;
  }

  .booking-week__mobile-time > .icon {
    color: var(--ui-text-dimmed);
    font-size: 20px;
  }

  .booking-week__mobile-time--selected {
    border-color: var(--booking-accent);
    background: color-mix(in srgb, var(--booking-accent) 9%, var(--ui-bg));
    box-shadow: inset 0 0 0 1px var(--booking-accent);
  }

  .booking-week__mobile-time--selected > .icon {
    color: var(--booking-accent);
  }

  .booking-week__mobile-empty {
    display: grid;
    min-height: 150px;
    place-items: center;
    align-content: center;
    padding: 24px;
    border: 1px dashed var(--ui-border-accented);
    border-radius: var(--oe-radius-control);
    color: var(--ui-text-muted);
    text-align: center;
  }

  .booking-week__mobile-empty .icon {
    margin-bottom: 8px;
    font-size: 24px;
  }

  .booking-week__mobile-empty p {
    margin: 0;
    color: var(--ui-text);
  }

  .booking-week__mobile-empty small {
    margin-top: 2px;
  }
}

@media (max-width: 560px) {
  .booking-week__toolbar {
    align-items: center;
  }

  .booking-week__toolbar p {
    font-size: 17px;
  }

  .booking-week__trust {
    align-items: flex-start;
    line-height: 1.45;
  }
}
</style>
