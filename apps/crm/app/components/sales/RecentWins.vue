<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { SalesRecentWin } from '~/types/sales'
import type { SalesCaseLinkBuilder } from './types'
import { formatSalesCurrency, formatSalesDate } from './presentation'

const props = withDefaults(defineProps<{
  items: SalesRecentWin[]
  casesTo?: RouteLocationRaw
  caseTo?: SalesCaseLinkBuilder
  linkLabel?: string
}>(), {
  casesTo: undefined,
  caseTo: undefined,
  linkLabel: 'Wszystkie sprawy',
})

function itemLink(item: SalesRecentWin) {
  return props.caseTo?.(item)
}
</script>

<template>
  <UCard class="sales-recent">
    <template #header>
      <SalesPanelHeader eyebrow="Ostatnie wyniki" title="Ostatnie sprzedaże">
        <template v-if="casesTo" #trailing>
          <UButton
            :to="casesTo"
            color="neutral"
            variant="ghost"
            trailing-icon="i-lucide-arrow-right"
          >
            {{ linkLabel }}
          </UButton>
        </template>
      </SalesPanelHeader>
    </template>

    <div v-if="items.length" class="sales-table-wrap">
      <table>
        <caption class="sr-only">Ostatnie zakończone sprzedaże</caption>
        <thead>
          <tr>
            <th scope="col">Data</th>
            <th scope="col">Klient i sprawa</th>
            <th scope="col">Produkt</th>
            <th scope="col">Wolumen</th>
            <th scope="col">Prowizja</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="item.id">
            <td data-label="Data">{{ formatSalesDate(item.wonAt) }}</td>
            <td data-label="Klient i sprawa">
              <NuxtLink v-if="itemLink(item)" :to="itemLink(item)">
                <strong>{{ item.clientName }}</strong>
                <span>{{ item.caseTitle }}</span>
              </NuxtLink>
              <span v-else class="sales-table-wrap__stack">
                <strong>{{ item.clientName }}</strong>
                <span>{{ item.caseTitle }}</span>
              </span>
            </td>
            <td data-label="Produkt" class="sales-table-wrap__stack">
              <strong>{{ item.title }}</strong>
              <span>{{ item.productName }}</span>
            </td>
            <td data-label="Wolumen">{{ formatSalesCurrency(item.amountValue, item.currency) }}</td>
            <td data-label="Prowizja">{{ formatSalesCurrency(item.paidCommission, item.currency) }}</td>
            <td data-label="Status"><CrmStatusBadge :status="item.statusCode" /></td>
          </tr>
        </tbody>
      </table>
    </div>

    <OeEmptyState
      v-else
      size="compact"
      align="start"
      icon="i-lucide-trophy"
      title="Brak zakończonych sprzedaży"
      description="Po pierwszej wygranej pojawi się tu pełny kontekst klienta, produktu i prowizji."
    />
  </UCard>
</template>

<style scoped>
.sales-recent {
  min-width: 0;
}

.sales-table-wrap {
  overflow-x: auto;
}

.sales-table-wrap table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}

.sales-table-wrap th {
  padding: 0 14px 10px 0;
  color: var(--ui-text-dimmed);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 650;
  text-align: left;
  text-transform: uppercase;
  white-space: nowrap;
}

.sales-table-wrap td {
  padding: 13px 14px 13px 0;
  border-top: 1px solid var(--ui-border);
  color: var(--ui-text);
  vertical-align: middle;
  white-space: nowrap;
}

.sales-table-wrap td:nth-child(2),
.sales-table-wrap td:nth-child(3) {
  min-width: 180px;
  white-space: normal;
}

.sales-table-wrap a,
.sales-table-wrap__stack {
  display: grid;
  gap: 2px;
  text-decoration: none;
}

.sales-table-wrap a:hover strong {
  text-decoration: underline;
}

.sales-table-wrap td strong {
  color: var(--ui-text-highlighted);
  font-size: 11px;
  font-weight: 650;
}

.sales-table-wrap td span {
  color: var(--ui-text-dimmed);
  font-size: 9px;
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
  max-width: 400px;
  color: var(--ui-text-dimmed);
  font-size: 10px;
}

@media (max-width: 720px) {
  .sales-table-wrap {
    overflow: visible;
  }

  .sales-table-wrap thead {
    display: none;
  }

  .sales-table-wrap table,
  .sales-table-wrap tbody,
  .sales-table-wrap tr,
  .sales-table-wrap td {
    display: block;
    width: 100%;
  }

  .sales-table-wrap tr {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px 16px;
    padding: 16px 0;
    border-top: 1px solid var(--ui-border);
  }

  .sales-table-wrap tr:first-child {
    padding-top: 0;
    border-top: 0;
  }

  .sales-table-wrap td {
    display: grid;
    gap: 4px;
    min-width: 0 !important;
    padding: 0;
    border: 0;
    white-space: normal;
  }

  .sales-table-wrap td::before {
    color: var(--ui-text-dimmed);
    content: attr(data-label);
    font-family: var(--font-mono);
    font-size: 8px;
    font-weight: 650;
    text-transform: uppercase;
  }

  .sales-table-wrap td:nth-child(2),
  .sales-table-wrap td:nth-child(3) {
    grid-column: 1 / -1;
  }
}

@media (max-width: 480px) {
  .sales-table-wrap tr {
    grid-template-columns: 1fr;
  }
}
</style>
