<script setup lang="ts">
const props = defineProps<{
  to: string
}>()

// Temporary presentation data. Replace with the sales API summary payload.
const salesSummary = {
  paid: 18_420,
  outstanding: 7_860,
  currency: 'PLN',
  period: 'Lipiec 2026',
  paidDeals: 8,
  outstandingDeals: 4,
}

const total = salesSummary.paid + salesSummary.outstanding
const paidShare = Math.round((salesSummary.paid / total) * 100)

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency: salesSummary.currency,
    maximumFractionDigits: 0,
  }).format(value)
}
</script>

<template>
  <section class="sales-summary" aria-labelledby="sales-summary-title">
    <div class="sales-summary__intro">
      <div class="sales-summary__icon" aria-hidden="true">
        <UIcon name="i-lucide-chart-no-axes-combined" />
      </div>

      <div class="sales-summary__heading">
        <span>Twoje wyniki · {{ salesSummary.period }}</span>
        <h2 id="sales-summary-title">Moja sprzedaż</h2>
        <p>{{ paidShare }}% wypracowanej prowizji jest już na Twoim koncie</p>
      </div>
    </div>

    <div class="sales-summary__metrics">
      <div class="sales-summary__metric sales-summary__metric--paid">
        <span class="sales-summary__metric-icon" aria-hidden="true">
          <UIcon name="i-lucide-circle-check" />
        </span>
        <div>
          <span>Wypłacono</span>
          <strong>{{ formatCurrency(salesSummary.paid) }}</strong>
          <small>{{ salesSummary.paidDeals }} rozliczonych sprzedaży</small>
        </div>
      </div>

      <div class="sales-summary__metric sales-summary__metric--outstanding">
        <span class="sales-summary__metric-icon" aria-hidden="true">
          <UIcon name="i-lucide-clock-3" />
        </span>
        <div>
          <span>Do wypłaty</span>
          <strong>{{ formatCurrency(salesSummary.outstanding) }}</strong>
          <small>{{ salesSummary.outstandingDeals }} sprzedaże w rozliczeniu</small>
        </div>
      </div>
    </div>

    <div class="sales-summary__footer">
      <div class="sales-summary__progress-copy">
        <span>Rozliczono</span>
        <strong>{{ paidShare }}%</strong>
      </div>
      <div
        class="sales-summary__progress"
        role="progressbar"
        :aria-valuenow="paidShare"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-label="Procent rozliczonej prowizji"
      >
        <span :style="{ width: `${paidShare}%` }" />
      </div>
      <UButton
        :to="props.to"
        color="neutral"
        variant="ghost"
        trailing-icon="i-lucide-arrow-right"
      >
        Zobacz szczegóły
      </UButton>
    </div>
  </section>
</template>

<style scoped>
.sales-summary {
  position: relative;
  display: grid;
  grid-template-columns: minmax(260px, 0.9fr) minmax(420px, 1.45fr);
  gap: 18px 28px;
  overflow: hidden;
  padding: 24px;
  border: 1px solid color-mix(in srgb, var(--ui-primary) 26%, var(--ui-border));
  border-radius: var(--oe-radius-emphasis);
  background:
    radial-gradient(circle at 4% 0%, color-mix(in srgb, var(--ui-primary) 15%, transparent), transparent 34%),
    linear-gradient(135deg, color-mix(in srgb, var(--ui-bg) 92%, var(--ui-primary)), var(--ui-bg) 58%);
  box-shadow: 0 14px 36px color-mix(in srgb, var(--ui-primary) 8%, transparent);
}

.sales-summary::after {
  position: absolute;
  top: -52px;
  right: -34px;
  width: 180px;
  height: 180px;
  border: 1px solid color-mix(in srgb, var(--ui-primary) 10%, transparent);
  border-radius: 999px;
  content: '';
  pointer-events: none;
}

.sales-summary__intro,
.sales-summary__metric,
.sales-summary__footer,
.sales-summary__progress-copy {
  display: flex;
  align-items: center;
}

.sales-summary__intro {
  align-self: center;
  min-width: 0;
  gap: 14px;
}

.sales-summary__icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 48px;
  height: 48px;
  border: 1px solid color-mix(in srgb, var(--ui-primary) 30%, transparent);
  border-radius: 15px;
  background: color-mix(in srgb, var(--ui-primary) 13%, var(--ui-bg));
  color: var(--ui-primary);
  font-size: 22px;
}

.sales-summary__heading {
  min-width: 0;
}

.sales-summary__heading > span {
  display: block;
  margin-bottom: 3px;
  color: var(--ui-primary);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.sales-summary__heading h2,
.sales-summary__heading p,
.sales-summary__metric strong,
.sales-summary__metric small {
  margin: 0;
}

.sales-summary__heading h2 {
  color: var(--ui-text-highlighted);
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.025em;
}

.sales-summary__heading p {
  margin-top: 4px;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.45;
}

.sales-summary__metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.sales-summary__metric {
  min-width: 0;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--ui-border);
  border-radius: 14px;
  background: color-mix(in srgb, var(--ui-bg) 86%, transparent);
}

.sales-summary__metric-icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  font-size: 17px;
}

.sales-summary__metric--paid .sales-summary__metric-icon {
  background: color-mix(in srgb, var(--ui-success) 12%, transparent);
  color: var(--ui-success);
}

.sales-summary__metric--outstanding .sales-summary__metric-icon {
  background: color-mix(in srgb, var(--ui-warning) 13%, transparent);
  color: var(--ui-warning);
}

.sales-summary__metric > div {
  display: grid;
  min-width: 0;
}

.sales-summary__metric > div > span,
.sales-summary__metric small {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.sales-summary__metric strong {
  color: var(--ui-text-highlighted);
  font-size: 21px;
  font-weight: 700;
  letter-spacing: -0.025em;
  white-space: nowrap;
}

.sales-summary__metric small {
  margin-top: 2px;
}

.sales-summary__footer {
  grid-column: 1 / -1;
  gap: 12px;
  padding-top: 14px;
  border-top: 1px solid var(--ui-border);
}

.sales-summary__progress-copy {
  flex: 0 0 auto;
  gap: 6px;
  color: var(--ui-text-muted);
  font-size: 10px;
}

.sales-summary__progress-copy strong {
  color: var(--ui-text-highlighted);
  font-size: 11px;
}

.sales-summary__progress {
  flex: 1;
  overflow: hidden;
  height: 6px;
  border-radius: 999px;
  background: var(--ui-bg-accented);
}

.sales-summary__progress span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--ui-primary), color-mix(in srgb, var(--ui-primary) 68%, var(--ui-success)));
}

.sales-summary__footer :deep(.ui-button) {
  flex: 0 0 auto;
}

@media (max-width: 900px) {
  .sales-summary {
    grid-template-columns: 1fr;
  }

  .sales-summary__footer {
    grid-column: auto;
  }
}

@media (max-width: 560px) {
  .sales-summary {
    gap: 18px;
    padding: 18px;
  }

  .sales-summary__metrics {
    grid-template-columns: 1fr;
  }

  .sales-summary__footer {
    flex-wrap: wrap;
  }

  .sales-summary__progress {
    min-width: calc(100% - 78px);
  }

  .sales-summary__footer :deep(.ui-button) {
    width: 100%;
    justify-content: center;
  }
}
</style>
