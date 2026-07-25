<script setup lang="ts">
import type { SalesData } from './types'
import { formatSalesCurrency, formatSalesNumber } from './presentation'

const props = withDefaults(defineProps<{
  commissions: SalesData['commissions']
  currency: string
  title?: string
}>(), {
  title: 'Prowizje',
})

const realization = computed(() => (
  props.commissions.expected
    ? (props.commissions.paid / props.commissions.expected) * 100
    : 0
))

const progress = computed(() => Math.min(Math.max(realization.value, 0), 100))
</script>

<template>
  <UCard class="sales-commissions">
    <template #header>
      <SalesPanelHeader eyebrow="Stan bieżący" :title="title" icon="i-lucide-banknote" />
    </template>

    <div class="sales-commissions__progress">
      <div>
        <span>Realizacja prognozy</span>
        <strong>{{ formatSalesNumber(realization, 1) }}%</strong>
      </div>
      <UProgress
        :model-value="progress"
        :max="100"
        color="success"
        aria-label="Realizacja prognozy prowizji"
      />
    </div>

    <dl>
      <div>
        <dt>Prognozowane</dt>
        <dd>{{ formatSalesCurrency(commissions.expected, currency) }}</dd>
      </div>
      <div>
        <dt>Naliczone</dt>
        <dd>{{ formatSalesCurrency(commissions.due, currency) }}</dd>
      </div>
      <div>
        <dt>Wypłacone</dt>
        <dd>{{ formatSalesCurrency(commissions.paid, currency) }}</dd>
      </div>
      <div class="sales-commissions__accent">
        <dt>Do wypłaty</dt>
        <dd>{{ formatSalesCurrency(commissions.outstanding, currency) }}</dd>
      </div>
    </dl>
  </UCard>
</template>

<style scoped>
.sales-commissions {
  min-width: 0;
}

.sales-commissions__progress {
  display: grid;
  gap: 9px;
  margin-bottom: 10px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--ui-border);
}

.sales-commissions__progress > div,
.sales-commissions dl > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.sales-commissions__progress span,
.sales-commissions dt {
  color: var(--ui-text-muted);
  font-size: 11px;
}

.sales-commissions__progress strong,
.sales-commissions dd {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 650;
  white-space: nowrap;
}

.sales-commissions dl {
  display: grid;
  gap: 2px;
  margin: 0;
}

.sales-commissions dl > div {
  min-height: 44px;
  padding: 8px 0;
  border-bottom: 1px solid var(--ui-border);
}

.sales-commissions dl > div:last-child {
  border-bottom: 0;
}

.sales-commissions__accent {
  margin-top: 7px;
  padding: 12px 13px !important;
  border: 1px solid color-mix(in srgb, var(--ui-success) 28%, var(--ui-border)) !important;
  border-radius: 11px;
  background: color-mix(in srgb, var(--ui-success) 7%, var(--ui-bg));
}
</style>
