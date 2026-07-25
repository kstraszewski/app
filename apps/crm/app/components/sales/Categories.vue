<script setup lang="ts">
import type { SalesCategorySummary } from '~/types/sales'
import {
  formatSalesCurrency,
  formatSalesNumber,
  salesCategoryIcon,
} from './presentation'

defineProps<{
  categories: SalesCategorySummary[]
  currency: string
}>()
</script>

<template>
  <UCard class="sales-categories">
    <template #header>
      <SalesPanelHeader
        eyebrow="Struktura wyniku"
        title="Sprzedaż według kategorii"
        description="Wolumen oznacza wartość produktu, a nie przychód."
      />
    </template>

    <div v-if="categories.length" class="sales-categories__list">
      <article v-for="category in categories" :key="category.domain">
        <header>
          <span aria-hidden="true"><UIcon :name="salesCategoryIcon(category.domain)" /></span>
          <div>
            <h3>{{ category.label }}</h3>
            <p>
              {{ formatSalesNumber(category.wonCount) }} sprzedanych ·
              {{ formatSalesNumber(category.pipelineCount) }} w toku
            </p>
          </div>
        </header>

        <dl>
          <div>
            <dt>Wolumen sprzedaży</dt>
            <dd>{{ formatSalesCurrency(category.wonVolume, currency) }}</dd>
          </div>
          <div>
            <dt>Wolumen pipeline</dt>
            <dd>{{ formatSalesCurrency(category.pipelineVolume, currency) }}</dd>
          </div>
        </dl>
      </article>
    </div>

    <div v-else class="sales-empty">
      <UIcon name="i-lucide-package-open" aria-hidden="true" />
      <strong>Brak produktów sprzedażowych</strong>
      <span>Produkty przypisane do wybranego zakresu pojawią się tu automatycznie.</span>
    </div>
  </UCard>
</template>

<style scoped>
.sales-categories {
  min-width: 0;
}

.sales-categories__list {
  display: grid;
  gap: 4px;
}

.sales-categories article {
  display: grid;
  grid-template-columns: minmax(190px, .8fr) minmax(0, 1.2fr);
  gap: 20px;
  align-items: center;
  min-width: 0;
  padding: 14px 0;
  border-bottom: 1px solid var(--ui-border);
}

.sales-categories article:last-child {
  border-bottom: 0;
}

.sales-categories header {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
}

.sales-categories header > span {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-muted);
}

.sales-categories h3,
.sales-categories p {
  margin: 0;
}

.sales-categories h3 {
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 650;
}

.sales-categories p {
  margin-top: 3px;
  color: var(--ui-text-dimmed);
  font-size: 9px;
}

.sales-categories dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
}

.sales-categories dt {
  color: var(--ui-text-dimmed);
  font-size: 9px;
}

.sales-categories dd {
  overflow: hidden;
  margin: 4px 0 0;
  color: var(--ui-text-highlighted);
  font-size: 12px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sales-empty {
  display: grid;
  justify-items: center;
  gap: 7px;
  padding: 42px 20px;
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
  max-width: 370px;
  color: var(--ui-text-dimmed);
  font-size: 10px;
}

@media (max-width: 620px) {
  .sales-categories article,
  .sales-categories dl {
    grid-template-columns: 1fr;
  }

  .sales-categories article {
    gap: 12px;
  }
}
</style>
