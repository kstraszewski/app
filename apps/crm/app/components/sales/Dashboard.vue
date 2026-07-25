<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { SalesRangeKey } from '~/types/sales'
import type {
  SalesCaseLinkBuilder,
  SalesDashboardStatus,
  SalesData,
} from './types'
import { emptySalesData } from './types'

const props = withDefaults(defineProps<{
  data?: SalesData
  status?: SalesDashboardStatus
  error?: unknown
  range?: SalesRangeKey
  contextLabel?: string
  contextDescription?: string
  commissionsTitle?: string
  casesTo?: RouteLocationRaw
  caseTo?: SalesCaseLinkBuilder
  recentWinsLinkLabel?: string
}>(), {
  data: undefined,
  status: 'idle',
  error: undefined,
  range: undefined,
  contextLabel: 'Portfel sprzedażowy',
  contextDescription: 'Skuteczność, pipeline i rozliczenia w jednym widoku.',
  commissionsTitle: 'Prowizje',
  casesTo: undefined,
  caseTo: undefined,
  recentWinsLinkLabel: 'Wszystkie sprawy',
})

const emit = defineEmits<{
  'update:range': [value: SalesRangeKey]
  'update:currency': [value: string]
  'refresh': []
}>()

const sales = computed(() => props.data ?? emptySalesData)
const selectedRange = computed(() => props.range ?? sales.value.range.key)
const isInitialLoading = computed(() => props.status === 'pending' && !props.data?.generatedAt)
</script>

<template>
  <div
    class="sales-dashboard"
    :aria-busy="status === 'pending'"
  >
    <SalesFilters
      :range="selectedRange"
      :range-label="sales.range.label"
      :currency="sales.currency"
      :currencies="sales.availableCurrencies"
      :context-label="contextLabel"
      :context-description="contextDescription"
      :loading="status === 'pending'"
      @update:range="emit('update:range', $event)"
      @update:currency="emit('update:currency', $event)"
      @refresh="emit('refresh')"
    />

    <UAlert
      v-if="error"
      class="sales-dashboard__alert"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Nie udało się pobrać wyników sprzedaży"
      description="Wybrane filtry zostały zachowane. Spróbuj ponownie pobrać dane."
    >
      <template #actions>
        <UButton
          color="error"
          variant="ghost"
          icon="i-lucide-refresh-cw"
          @click="emit('refresh')"
        >
          Spróbuj ponownie
        </UButton>
      </template>
    </UAlert>

    <template v-if="isInitialLoading">
      <span class="sr-only" role="status">Pobieranie wyników sprzedaży</span>
      <div class="sales-dashboard__skeleton-metrics">
        <UCard v-for="index in 4" :key="index">
          <USkeleton class="h-9 w-9" />
          <USkeleton class="mt-6 h-9 w-32" />
          <USkeleton class="mt-3 h-4 w-40" />
        </UCard>
      </div>
      <div class="sales-dashboard__skeleton-overview">
        <UCard><USkeleton class="h-80 w-full" /></UCard>
        <UCard><USkeleton class="h-80 w-full" /></UCard>
      </div>
    </template>

    <template v-else>
      <SalesMetricGrid :data="sales" :range-label="sales.range.label" />

      <div class="sales-dashboard__overview">
        <SalesTrendPanel :data="sales.trend" :range-label="sales.range.label" />
        <SalesCommissions
          :commissions="sales.commissions"
          :currency="sales.currency"
          :title="commissionsTitle"
        />
      </div>

      <div class="sales-dashboard__breakdown">
        <SalesCategories :categories="sales.categories" :currency="sales.currency" />
        <SalesPipeline :stages="sales.pipeline" :total="sales.summary.pipelineCount" />
      </div>

      <SalesRecentWins
        :items="sales.recentWins"
        :cases-to="casesTo"
        :case-to="caseTo"
        :link-label="recentWinsLinkLabel"
      />
    </template>
  </div>
</template>

<style scoped>
.sales-dashboard {
  min-width: 0;
}

.sales-dashboard__alert,
.sales-dashboard__overview,
.sales-dashboard__breakdown,
.sales-dashboard__skeleton-metrics,
.sales-dashboard__skeleton-overview {
  margin-bottom: 20px;
}

.sales-dashboard__overview,
.sales-dashboard__breakdown,
.sales-dashboard__skeleton-overview {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(300px, .75fr);
  gap: 20px;
}

.sales-dashboard__skeleton-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

@media (max-width: 1180px) {
  .sales-dashboard__overview,
  .sales-dashboard__breakdown,
  .sales-dashboard__skeleton-overview {
    grid-template-columns: 1fr;
  }

  .sales-dashboard__skeleton-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 620px) {
  .sales-dashboard__skeleton-metrics {
    grid-template-columns: 1fr;
  }
}
</style>
