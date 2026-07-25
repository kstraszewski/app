<script setup lang="ts">
import type { SalesRangeKey } from '~/types/sales'
import { salesRangeOptions } from './types'

const props = withDefaults(defineProps<{
  range: SalesRangeKey
  rangeLabel: string
  currency: string
  currencies?: string[]
  contextLabel?: string
  contextDescription?: string
  loading?: boolean
}>(), {
  currencies: () => [],
  contextLabel: 'Portfel sprzedażowy',
  contextDescription: 'Skuteczność, pipeline i rozliczenia w jednym widoku.',
  loading: false,
})

const emit = defineEmits<{
  'update:range': [value: SalesRangeKey]
  'update:currency': [value: string]
  'refresh': []
}>()

const currencyItems = computed(() => {
  const values = props.currencies.length ? props.currencies : [props.currency]
  return [...new Set(values)].map(currency => ({ label: currency, value: currency }))
})

const selectedCurrency = computed({
  get: () => props.currency,
  set: value => emit('update:currency', value),
})
</script>

<template>
  <section class="sales-filters" aria-label="Filtry wyników sprzedaży">
    <div class="sales-filters__context">
      <span class="sales-filters__icon" aria-hidden="true">
        <UIcon name="i-lucide-chart-no-axes-combined" />
      </span>
      <div>
        <span>{{ contextLabel }}</span>
        <strong>{{ rangeLabel }}</strong>
        <small>{{ contextDescription }}</small>
      </div>
    </div>

    <div class="sales-filters__actions">
      <fieldset>
        <legend class="sr-only">Zakres wyników sprzedaży</legend>
        <UFieldGroup>
          <UButton
            v-for="option in salesRangeOptions"
            :key="option.value"
            color="neutral"
            size="sm"
            :variant="range === option.value ? 'soft' : 'ghost'"
            :aria-pressed="range === option.value"
            @click="emit('update:range', option.value)"
          >
            {{ option.label }}
          </UButton>
        </UFieldGroup>
      </fieldset>

      <USelect
        v-model="selectedCurrency"
        class="sales-filters__currency"
        :items="currencyItems"
        :disabled="currencyItems.length < 2"
        aria-label="Waluta wyników"
      />

      <UButton
        color="neutral"
        variant="outline"
        square
        icon="i-lucide-refresh-cw"
        :loading="loading"
        aria-label="Odśwież wyniki"
        @click="emit('refresh')"
      />
    </div>
  </section>
</template>

<style scoped>
.sales-filters {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 20px;
  padding: 14px 16px;
  border: 1px solid var(--ui-border);
  border-radius: 14px;
  background: color-mix(in srgb, var(--ui-bg-elevated) 72%, transparent);
}

.sales-filters__context,
.sales-filters__actions {
  display: flex;
  align-items: center;
}

.sales-filters__context {
  gap: 12px;
  min-width: 0;
}

.sales-filters__icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 38px;
  height: 38px;
  border: 1px solid var(--ui-border);
  border-radius: 11px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-muted);
  font-size: 17px;
}

.sales-filters__context > div {
  display: grid;
  min-width: 0;
}

.sales-filters__context span {
  color: var(--ui-text-dimmed);
  font-family: var(--font-mono);
  font-size: 8px;
  font-weight: 650;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.sales-filters__context strong {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sales-filters__context small {
  margin-top: 1px;
  color: var(--ui-text-dimmed);
  font-size: 9px;
}

.sales-filters__actions {
  flex: 0 0 auto;
  gap: 8px;
}

.sales-filters__actions fieldset {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.sales-filters__currency {
  width: 92px;
}

@media (max-width: 960px) {
  .sales-filters {
    align-items: flex-start;
    flex-direction: column;
  }

  .sales-filters__actions {
    width: 100%;
  }
}

@media (max-width: 620px) {
  .sales-filters__context small {
    white-space: normal;
  }

  .sales-filters__actions {
    flex-wrap: wrap;
  }

  .sales-filters__actions fieldset {
    flex: 1 1 100%;
  }

  .sales-filters__actions :deep([role="group"]) {
    width: 100%;
  }

  .sales-filters__actions fieldset :deep(button) {
    flex: 1 1 0;
    justify-content: center;
  }

  .sales-filters__currency {
    flex: 1 1 auto;
    width: auto;
  }
}
</style>
