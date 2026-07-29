<script setup lang="ts">
import type { BookingWidgetAnalyticsDay } from '~/types/scheduling'

const props = defineProps<{
  days: 7 | 30 | 90
  data: BookingWidgetAnalyticsDay[]
}>()

const colorMode = useColorMode()
const points = computed(() => props.data.map(day => ({
  date: day.date,
  views: day.views,
  slotSelections: day.slotSelections,
  bookings: day.bookings,
})))
const categories = {
  views: {
    name: 'Wizyty',
    color: 'var(--oe-chart-views)',
  },
  slotSelections: {
    name: 'Wybrane terminy',
    color: 'var(--oe-chart-slot-selections)',
  },
  bookings: {
    name: 'Rezerwacje',
    color: 'var(--ui-success)',
  },
}

function xFormatter(tick: number) {
  const date = points.value[tick]?.date
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
</script>

<template>
  <div class="widget-analytics-trend">
    <NcLineChart
      :key="`${colorMode.value}-${days}`"
      :data="points"
      :height="270"
      :categories="categories"
      :x-formatter="xFormatter"
      :tooltip-title-formatter="tooltipTitleFormatter"
      :x-num-ticks="days === 7 ? 7 : 6"
      :y-num-ticks="4"
      :y-domain="[0, undefined]"
      :y-grid-line="true"
      :duration="220"
    />

    <table class="sr-only">
      <caption>Dzienna liczba wizyt, wybranych terminów i rezerwacji</caption>
      <thead>
        <tr>
          <th>Data</th>
          <th>Wizyty</th>
          <th>Wybrane terminy</th>
          <th>Rezerwacje</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="point in points" :key="point.date">
          <th>{{ point.date }}</th>
          <td>{{ point.views }}</td>
          <td>{{ point.slotSelections }}</td>
          <td>{{ point.bookings }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.widget-analytics-trend {
  --oe-chart-views: #2563eb;
  --oe-chart-slot-selections: #b45309;

  min-width: 0;
}

:global(.dark) .widget-analytics-trend {
  --oe-chart-views: #60a5fa;
  --oe-chart-slot-selections: #fbbf24;
}
</style>
