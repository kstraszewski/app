<script setup lang="ts">
type PayoutMetric = {
  key: 'paid' | 'outstanding'
  label: string
  amount: number
  countLabel: string
  icon: string
}

// Temporary presentation data. Replace this block with the sales settlements API payload.
const period = 'Lipiec 2026'
const metrics: PayoutMetric[] = [
  {
    key: 'paid',
    label: 'Wypłacono',
    amount: 48_650,
    countLabel: '8 rozliczonych sprzedaży',
    icon: 'i-lucide-circle-check-big',
  },
  {
    key: 'outstanding',
    label: 'Do wypłaty',
    amount: 15_250,
    countLabel: '4 sprzedaże oczekują',
    icon: 'i-lucide-clock-3',
  },
]

const paid = metrics.find(metric => metric.key === 'paid')?.amount ?? 0
const outstanding = metrics.find(metric => metric.key === 'outstanding')?.amount ?? 0
const total = paid + outstanding
const paidShare = total ? Math.round((paid / total) * 100) : 0

const currencyFormatter = new Intl.NumberFormat('pl-PL', {
  style: 'currency',
  currency: 'PLN',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

function formatCurrency(value: number) {
  return currencyFormatter.format(value)
}
</script>

<template>
  <UCard class="sales-payout-summary">
    <template #header>
      <div class="sales-payout-summary__header">
        <div class="sales-payout-summary__heading">
          <span class="sales-payout-summary__icon" aria-hidden="true">
            <UIcon name="i-lucide-hand-coins" />
          </span>
          <div>
            <span class="sales-payout-summary__eyebrow">Rozliczenia</span>
            <h2>Moja sprzedaż</h2>
            <p>Prowizje wypłacone i oczekujące na rozliczenie</p>
          </div>
        </div>

        <div class="sales-payout-summary__badges">
          <UBadge color="neutral" variant="outline">{{ period }}</UBadge>
          <UBadge color="neutral" variant="outline" icon="i-lucide-flask-conical">
            Dane demonstracyjne
          </UBadge>
        </div>
      </div>
    </template>

    <div class="sales-payout-summary__body">
      <dl class="sales-payout-summary__metrics">
        <div
          v-for="metric in metrics"
          :key="metric.key"
          class="sales-payout-metric"
          :class="`sales-payout-metric--${metric.key}`"
        >
          <dt>
            <span class="sales-payout-metric__icon" aria-hidden="true">
              <UIcon :name="metric.icon" />
            </span>
            <span>{{ metric.label }}</span>
          </dt>
          <dd>{{ formatCurrency(metric.amount) }}</dd>
          <small>{{ metric.countLabel }}</small>
        </div>
      </dl>

      <section class="sales-payout-progress" aria-labelledby="sales-payout-progress-title">
        <div class="sales-payout-progress__heading">
          <div>
            <span id="sales-payout-progress-title">Stan rozliczenia</span>
            <strong>{{ paidShare }}%</strong>
          </div>
          <span>{{ formatCurrency(total) }} łącznie</span>
        </div>

        <div
          class="sales-payout-progress__bar"
          role="progressbar"
          :aria-valuenow="paidShare"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-label="`${paidShare}% prowizji wypłacono`"
        >
          <span class="sales-payout-progress__paid" :style="{ width: `${paidShare}%` }" />
          <span class="sales-payout-progress__outstanding" />
        </div>

        <div class="sales-payout-progress__legend">
          <span><i aria-hidden="true" /> Wypłacono</span>
          <span><i aria-hidden="true" /> Do wypłaty</span>
        </div>

        <div class="sales-payout-progress__next">
          <span class="sales-payout-progress__next-icon" aria-hidden="true">
            <UIcon name="i-lucide-calendar-clock" />
          </span>
          <div>
            <span>Najbliższe rozliczenie</span>
            <strong>5 sierpnia · {{ formatCurrency(6_850) }}</strong>
          </div>
        </div>
      </section>
    </div>
  </UCard>
</template>

<style scoped>
.sales-payout-summary {
  margin-bottom: 20px;
  overflow: hidden;
}

.sales-payout-summary__header,
.sales-payout-summary__heading,
.sales-payout-summary__badges,
.sales-payout-metric dt,
.sales-payout-progress__heading,
.sales-payout-progress__legend,
.sales-payout-progress__next {
  display: flex;
  align-items: center;
}

.sales-payout-summary__header {
  justify-content: space-between;
  gap: 20px;
}

.sales-payout-summary__heading {
  min-width: 0;
  gap: 12px;
}

.sales-payout-summary__icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 42px;
  height: 42px;
  border: 1px solid color-mix(in srgb, var(--ui-success) 28%, var(--ui-border));
  border-radius: 12px;
  background: color-mix(in srgb, var(--ui-success) 7%, var(--ui-bg));
  color: var(--ui-success);
  font-size: 20px;
}

.sales-payout-summary__eyebrow {
  display: block;
  margin-bottom: 2px;
  color: var(--ui-text-dimmed);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 650;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.sales-payout-summary__heading h2,
.sales-payout-summary__heading p,
.sales-payout-metric dd,
.sales-payout-metric small {
  margin: 0;
}

.sales-payout-summary__heading h2 {
  color: var(--ui-text-highlighted);
  font-size: 18px;
  font-weight: 650;
}

.sales-payout-summary__heading p {
  margin-top: 2px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.sales-payout-summary__badges {
  flex: 0 0 auto;
  gap: 8px;
}

.sales-payout-summary__body {
  display: grid;
  grid-template-columns: minmax(420px, 1.25fr) minmax(300px, .75fr);
  gap: 28px;
}

.sales-payout-summary__metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  min-width: 0;
  margin: 0;
}

.sales-payout-metric {
  min-width: 0;
  padding: 18px;
  border: 1px solid var(--ui-border);
  border-radius: 13px;
  background: var(--ui-bg-muted);
}

.sales-payout-metric dt {
  gap: 9px;
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 600;
}

.sales-payout-metric__icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 9px;
  font-size: 14px;
}

.sales-payout-metric--paid .sales-payout-metric__icon {
  background: color-mix(in srgb, var(--ui-success) 12%, transparent);
  color: var(--ui-success);
}

.sales-payout-metric--outstanding .sales-payout-metric__icon {
  background: color-mix(in srgb, var(--ui-warning) 13%, transparent);
  color: var(--ui-warning);
}

.sales-payout-metric dd {
  margin-top: 18px;
  color: var(--ui-text-highlighted);
  font-size: clamp(25px, 3vw, 35px);
  font-weight: 650;
  letter-spacing: -.035em;
  line-height: 1;
  white-space: nowrap;
}

.sales-payout-metric small {
  display: block;
  margin-top: 8px;
  color: var(--ui-text-dimmed);
  font-size: 10px;
}

.sales-payout-progress {
  min-width: 0;
  padding-left: 28px;
  border-left: 1px solid var(--ui-border);
}

.sales-payout-progress__heading {
  justify-content: space-between;
  gap: 16px;
}

.sales-payout-progress__heading > div {
  display: grid;
}

.sales-payout-progress__heading span,
.sales-payout-progress__legend {
  color: var(--ui-text-dimmed);
  font-size: 9px;
}

.sales-payout-progress__heading > div > span {
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 600;
}

.sales-payout-progress__heading strong {
  margin-top: 2px;
  color: var(--ui-text-highlighted);
  font-size: 24px;
  font-weight: 650;
}

.sales-payout-progress__bar {
  display: flex;
  gap: 3px;
  height: 9px;
  margin-top: 15px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--ui-bg-muted);
}

.sales-payout-progress__bar span {
  min-width: 5px;
}

.sales-payout-progress__paid {
  flex: 0 0 auto;
  background: var(--ui-success);
}

.sales-payout-progress__outstanding {
  flex: 1;
  background: var(--ui-warning);
}

.sales-payout-progress__legend {
  gap: 14px;
  margin-top: 10px;
}

.sales-payout-progress__legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.sales-payout-progress__legend i {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--ui-success);
}

.sales-payout-progress__legend span:last-child i {
  background: var(--ui-warning);
}

.sales-payout-progress__next {
  gap: 10px;
  margin-top: 19px;
  padding-top: 15px;
  border-top: 1px solid var(--ui-border);
}

.sales-payout-progress__next-icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--ui-border);
  border-radius: 9px;
  background: var(--ui-bg-muted);
  color: var(--ui-info);
}

.sales-payout-progress__next > div {
  display: grid;
}

.sales-payout-progress__next span {
  color: var(--ui-text-dimmed);
  font-size: 9px;
}

.sales-payout-progress__next strong {
  margin-top: 2px;
  color: var(--ui-text-highlighted);
  font-size: 11px;
  font-weight: 650;
}

@media (max-width: 920px) {
  .sales-payout-summary__body {
    grid-template-columns: 1fr;
  }

  .sales-payout-progress {
    padding-top: 22px;
    padding-left: 0;
    border-top: 1px solid var(--ui-border);
    border-left: 0;
  }
}

@media (max-width: 680px) {
  .sales-payout-summary__header {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .sales-payout-summary__badges {
    justify-content: space-between;
    width: 100%;
  }
}

@media (max-width: 560px) {
  .sales-payout-summary__metrics {
    grid-template-columns: 1fr;
  }

  .sales-payout-summary__badges {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
