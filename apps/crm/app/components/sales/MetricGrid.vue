<script setup lang="ts">
import type { SalesData } from './types'
import {
  formatSalesCurrency,
  formatSalesNumber,
  salesComparisonLabel,
  salesComparisonTone,
} from './presentation'

const props = defineProps<{
  data: SalesData
  rangeLabel: string
}>()

const metrics = computed(() => [
  {
    label: 'Sprzedane produkty',
    value: formatSalesNumber(props.data.summary.wonCount.current),
    helper: salesComparisonLabel(props.data.summary.wonCount),
    icon: 'i-lucide-badge-check',
    badge: props.rangeLabel,
    tone: salesComparisonTone(props.data.summary.wonCount),
  },
  {
    label: 'Konwersja',
    value: `${formatSalesNumber(props.data.summary.conversionRate.current, 1)}%`,
    helper: salesComparisonLabel(props.data.summary.conversionRate),
    icon: 'i-lucide-chart-no-axes-combined',
    badge: props.rangeLabel,
    tone: salesComparisonTone(props.data.summary.conversionRate),
  },
  {
    label: 'Prowizje wypłacone',
    value: formatSalesCurrency(props.data.commissions.paid, props.data.currency),
    helper: 'Łącznie w rozliczeniach produktów',
    icon: 'i-lucide-banknote',
    badge: props.data.currency,
    tone: 'neutral',
  },
  {
    label: 'Aktywny pipeline',
    value: formatSalesNumber(props.data.summary.pipelineCount),
    helper: 'Produkty prowadzone teraz',
    icon: 'i-lucide-briefcase-business',
    badge: 'Teraz',
    tone: 'neutral',
  },
])
</script>

<template>
  <section class="sales-metrics" aria-labelledby="sales-metrics-title">
    <h2 id="sales-metrics-title" class="sr-only">Najważniejsze wyniki sprzedaży</h2>

    <UCard
      v-for="metric in metrics"
      :key="metric.label"
      class="sales-metric oe-hover-lift"
    >
      <div class="sales-metric__top">
        <span class="sales-metric__icon" aria-hidden="true">
          <UIcon :name="metric.icon" />
        </span>
        <UBadge color="neutral" variant="outline">{{ metric.badge }}</UBadge>
      </div>

      <strong class="sales-metric__value">{{ metric.value }}</strong>
      <h3>{{ metric.label }}</h3>
      <p :class="`sales-metric__change--${metric.tone}`">{{ metric.helper }}</p>
    </UCard>
  </section>
</template>

<style scoped>
.sales-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 20px;
}

.sales-metric {
  min-width: 0;
}

.sales-metric__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 20px;
}

.sales-metric__icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border: 1px solid var(--ui-border);
  border-radius: 11px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-muted);
  font-size: 18px;
}

.sales-metric__value {
  display: block;
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: clamp(24px, 2vw, 32px);
  font-weight: 650;
  line-height: 1.08;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sales-metric h3 {
  margin: 7px 0 0;
  color: var(--ui-text);
  font-size: 13px;
  font-weight: 600;
}

.sales-metric p {
  margin: 8px 0 0;
  color: var(--ui-text-dimmed);
  font-size: 10px;
}

.sales-metric__change--positive {
  color: var(--ui-success) !important;
}

.sales-metric__change--negative {
  color: var(--ui-error) !important;
}

@media (max-width: 1180px) {
  .sales-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 620px) {
  .sales-metrics {
    grid-template-columns: 1fr;
  }
}
</style>
