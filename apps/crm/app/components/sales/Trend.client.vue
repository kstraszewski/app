<script setup lang="ts">
import type { SalesTrendPoint } from '~/types/sales'

const props = defineProps<{
  data: SalesTrendPoint[]
}>()

const colorMode = useColorMode()
const points = computed(() => props.data.map(point => ({
  date: point.date,
  periodEnd: point.periodEnd,
  sold: point.wonCount,
})))
const categories = {
  sold: {
    name: 'Sprzedane produkty',
    color: 'var(--ui-success)',
  },
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`)).replace('.', '')
}

function xFormatter(tick: number) {
  const point = points.value[tick]
  return point ? formatDate(point.date) : ''
}

function yFormatter(tick: number | Date) {
  return typeof tick === 'number' ? new Intl.NumberFormat('pl-PL').format(tick) : ''
}

function tooltipTitleFormatter(point: { date: string; periodEnd: string }) {
  const exclusiveEnd = new Date(`${point.periodEnd}T00:00:00Z`)
  exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() - 1)
  const end = exclusiveEnd.toISOString().slice(0, 10)
  return point.date === end ? formatDate(point.date) : `${formatDate(point.date)} – ${formatDate(end)}`
}
</script>

<template>
  <div class="sales-trend">
    <NcLineChart
      :key="`${colorMode.value}-${points.length}`"
      :data="points"
      :height="260"
      :categories="categories"
      :x-formatter="xFormatter"
      :y-formatter="yFormatter"
      :tooltip-title-formatter="tooltipTitleFormatter"
      :x-num-ticks="Math.min(points.length, 7)"
      :y-num-ticks="4"
      :y-domain="[0, undefined]"
      :y-grid-line="true"
      :hide-legend="true"
      :duration="220"
    />

    <table class="sr-only">
      <caption>Liczba sprzedanych produktów w wybranym okresie</caption>
      <thead>
        <tr>
          <th>Od</th>
          <th>Do</th>
          <th>Sprzedane produkty</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="point in points" :key="point.date">
          <th>{{ point.date }}</th>
          <td>{{ point.periodEnd }}</td>
          <td>{{ point.sold }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.sales-trend {
  position: relative;
  min-width: 0;
}

.sales-trend > .sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  clip-path: inset(50%);
  border: 0;
  white-space: nowrap;
}
</style>
