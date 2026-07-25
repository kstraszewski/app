<script setup lang="ts">
import type { SalesTrendPoint } from '~/types/sales'

defineProps<{
  data: SalesTrendPoint[]
  rangeLabel: string
}>()
</script>

<template>
  <UCard class="sales-panel">
    <template #header>
      <SalesPanelHeader eyebrow="Sprzedaż w czasie" title="Sprzedane produkty">
        <template #trailing>
          <UBadge color="neutral" variant="outline">{{ rangeLabel }}</UBadge>
        </template>
      </SalesPanelHeader>
    </template>

    <SalesTrend :data="data" />
  </UCard>
</template>

<style scoped>
.sales-panel {
  min-width: 0;
}
</style>
