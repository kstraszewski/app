<script setup lang="ts">
import type { SalesPipelineStage } from '~/types/sales'
import {
  formatSalesNumber,
  salesPipelineStatusColor,
  salesStatusLabel,
} from './presentation'

const props = defineProps<{
  stages: SalesPipelineStage[]
  total: number
}>()

const maxCount = computed(() => Math.max(...props.stages.map(stage => stage.count), 1))
</script>

<template>
  <UCard class="sales-pipeline">
    <template #header>
      <SalesPanelHeader eyebrow="Aktywny pipeline" title="Produkty według etapu">
        <template #trailing>
          <UBadge color="neutral" variant="outline">{{ formatSalesNumber(total) }}</UBadge>
        </template>
      </SalesPanelHeader>
    </template>

    <div v-if="stages.length" class="sales-pipeline__list">
      <div v-for="stage in stages" :key="stage.statusCode">
        <div>
          <UBadge :color="salesPipelineStatusColor(stage.statusCode)" variant="subtle">
            {{ salesStatusLabel(stage.statusCode) }}
          </UBadge>
          <span>{{ stage.count }} · {{ formatSalesNumber(stage.share, 1) }}%</span>
        </div>
        <UProgress
          :model-value="stage.count"
          :max="maxCount"
          color="neutral"
          :aria-label="`${salesStatusLabel(stage.statusCode)}: ${stage.count} produktów`"
        />
      </div>
    </div>

    <OeEmptyState
      v-else
      size="compact"
      align="start"
      icon="i-lucide-list-checks"
      title="Pipeline jest pusty"
      description="Nowe produkty pojawią się po przypisaniu ich do wybranego zakresu."
    />
  </UCard>
</template>

<style scoped>
.sales-pipeline {
  min-width: 0;
}

.sales-pipeline__list {
  display: grid;
  gap: 18px;
}

.sales-pipeline__list > div {
  display: grid;
  gap: 7px;
}

.sales-pipeline__list > div > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.sales-pipeline__list span {
  color: var(--ui-text-muted);
  font-size: 10px;
  white-space: nowrap;
}

.sales-empty {
  display: grid;
  justify-items: center;
  gap: 7px;
  padding: 32px 16px;
  color: var(--ui-text-muted);
  text-align: center;
}

.sales-empty > :deep(.iconify) {
  margin-bottom: 3px;
  font-size: 26px;
}

.sales-empty strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.sales-empty span {
  max-width: 340px;
  color: var(--ui-text-dimmed);
  font-size: 10px;
}
</style>
