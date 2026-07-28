<script setup lang="ts">
defineProps<{
  to: string
}>()

type PayoutStage = {
  key: 'processing' | 'approval' | 'scheduled'
  label: string
  count: number
  amount: number
}

type FeaturedPayout = {
  id: string
  client: string
  product: string
  amount: number
  date: string
  stage: PayoutStage['key']
}

// Temporary presentation data. Replace this block with the payouts API payload.
const payoutStages: PayoutStage[] = [
  { key: 'processing', label: 'W toku', count: 3, amount: 24_850 },
  { key: 'approval', label: 'Do akceptacji', count: 1, amount: 6_850 },
  { key: 'scheduled', label: 'Zaplanowane', count: 2, amount: 32_200 },
]

const featuredPayouts: FeaturedPayout[] = [
  {
    id: 'WY-2841',
    client: 'Joanna Malinowska',
    product: 'Kredyt hipoteczny',
    amount: 12_400,
    date: '31 lip',
    stage: 'processing',
  },
  {
    id: 'WY-2837',
    client: 'Marek Wiśniewski',
    product: 'Ubezpieczenie firmowe',
    amount: 6_850,
    date: 'Dzisiaj',
    stage: 'approval',
  },
  {
    id: 'WY-2829',
    client: 'Anna i Paweł Nowak',
    product: 'Kredyt gotówkowy',
    amount: 9_200,
    date: '4 sie',
    stage: 'scheduled',
  },
]

const totalAmount = payoutStages.reduce((sum, stage) => sum + stage.amount, 0)
const totalCount = payoutStages.reduce((sum, stage) => sum + stage.count, 0)

const currencyFormatter = new Intl.NumberFormat('pl-PL', {
  style: 'currency',
  currency: 'PLN',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

function formatCurrency(value: number) {
  return currencyFormatter.format(value)
}

function payoutCountLabel(count: number) {
  if (count === 1) return '1 wypłata'
  const lastTwo = count % 100
  const last = count % 10
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return `${count} wypłaty`
  return `${count} wypłat`
}

function stageLabel(stage: PayoutStage['key']) {
  return payoutStages.find(item => item.key === stage)?.label ?? ''
}
</script>

<template>
  <UCard class="payouts-overview">
    <template #header>
      <div class="payouts-overview__header">
        <div class="payouts-overview__heading">
          <span class="payouts-overview__icon" aria-hidden="true">
            <UIcon name="i-lucide-hand-coins" />
          </span>
          <div>
            <span class="payouts-overview__eyebrow">Rozliczenia</span>
            <h2>Wypłaty</h2>
            <p>Bieżący przepływ należnych prowizji</p>
          </div>
        </div>

        <div class="payouts-overview__actions">
          <UBadge color="neutral" variant="outline" icon="i-lucide-flask-conical">
            Dane demonstracyjne
          </UBadge>
          <UButton
            :to="to"
            color="neutral"
            variant="outline"
            trailing-icon="i-lucide-arrow-right"
          >
            Pełne rozliczenia
          </UButton>
        </div>
      </div>
    </template>

    <div class="payouts-overview__body">
      <section class="payouts-summary" aria-labelledby="payouts-summary-title">
        <span id="payouts-summary-title" class="payouts-summary__label">Łącznie w obiegu</span>
        <strong>{{ formatCurrency(totalAmount) }}</strong>
        <p>{{ payoutCountLabel(totalCount) }} na różnych etapach realizacji</p>

        <div
          class="payouts-summary__progress"
          role="img"
          :aria-label="`Podział ${payoutCountLabel(totalCount)} według statusu`"
        >
          <span
            v-for="stage in payoutStages"
            :key="stage.key"
            :class="`payouts-summary__progress-segment payouts-summary__progress-segment--${stage.key}`"
            :style="{ flexGrow: stage.amount }"
          />
        </div>

        <dl class="payouts-summary__stages">
          <div v-for="stage in payoutStages" :key="stage.key">
            <dt>
              <i :class="`payouts-summary__dot payouts-summary__dot--${stage.key}`" aria-hidden="true" />
              <span>{{ stage.label }}</span>
              <small>{{ payoutCountLabel(stage.count) }}</small>
            </dt>
            <dd>{{ formatCurrency(stage.amount) }}</dd>
          </div>
        </dl>
      </section>

      <section class="payouts-list" aria-labelledby="payouts-list-title">
        <div class="payouts-list__header">
          <div>
            <span>Najbliższe operacje</span>
            <h3 id="payouts-list-title">Co dzieje się z wypłatami</h3>
          </div>
          <span class="payouts-list__cycle">Lipiec 2026</span>
        </div>

        <div class="payouts-list__rows">
          <article v-for="payout in featuredPayouts" :key="payout.id" class="payout-row">
            <span :class="`payout-row__status payout-row__status--${payout.stage}`" aria-hidden="true">
              <UIcon
                :name="payout.stage === 'processing'
                  ? 'i-lucide-loader-circle'
                  : payout.stage === 'approval'
                    ? 'i-lucide-circle-check-big'
                    : 'i-lucide-calendar-clock'"
              />
            </span>

            <div class="payout-row__copy">
              <strong>{{ payout.client }}</strong>
              <span>{{ payout.product }} · {{ payout.id }}</span>
            </div>

            <div class="payout-row__amount">
              <strong>{{ formatCurrency(payout.amount) }}</strong>
              <span>{{ stageLabel(payout.stage) }} · {{ payout.date }}</span>
            </div>
          </article>
        </div>
      </section>
    </div>
  </UCard>
</template>

<style scoped>
.payouts-overview {
  overflow: hidden;
}

.payouts-overview__header,
.payouts-overview__heading,
.payouts-overview__actions {
  display: flex;
  align-items: center;
}

.payouts-overview__header {
  justify-content: space-between;
  gap: 20px;
}

.payouts-overview__heading {
  min-width: 0;
  gap: 12px;
}

.payouts-overview__icon {
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

.payouts-overview__eyebrow,
.payouts-list__header > div > span {
  display: block;
  margin-bottom: 2px;
  color: var(--ui-text-dimmed);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 650;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.payouts-overview__heading h2,
.payouts-overview__heading p,
.payouts-list__header h3 {
  margin: 0;
}

.payouts-overview__heading h2 {
  color: var(--ui-text-highlighted);
  font-size: 18px;
  font-weight: 650;
}

.payouts-overview__heading p {
  margin-top: 2px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.payouts-overview__actions {
  flex: 0 0 auto;
  gap: 10px;
}

.payouts-overview__body {
  display: grid;
  grid-template-columns: minmax(280px, .8fr) minmax(420px, 1.2fr);
  gap: 0;
}

.payouts-summary {
  min-width: 0;
  padding-right: 28px;
  border-right: 1px solid var(--ui-border);
}

.payouts-summary__label {
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 600;
}

.payouts-summary > strong {
  display: block;
  margin-top: 7px;
  color: var(--ui-text-highlighted);
  font-size: clamp(30px, 3.2vw, 42px);
  font-weight: 650;
  letter-spacing: -.035em;
  line-height: 1;
}

.payouts-summary > p {
  margin: 8px 0 0;
  color: var(--ui-text-dimmed);
  font-size: 11px;
}

.payouts-summary__progress {
  display: flex;
  gap: 3px;
  height: 8px;
  margin-top: 24px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--ui-bg-muted);
}

.payouts-summary__progress-segment {
  flex-basis: 0;
  min-width: 8px;
}

.payouts-summary__progress-segment--processing,
.payouts-summary__dot--processing {
  background: var(--ui-warning);
}

.payouts-summary__progress-segment--approval,
.payouts-summary__dot--approval {
  background: var(--ui-info);
}

.payouts-summary__progress-segment--scheduled,
.payouts-summary__dot--scheduled {
  background: var(--ui-success);
}

.payouts-summary__stages {
  display: grid;
  gap: 0;
  margin: 14px 0 0;
}

.payouts-summary__stages > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 42px;
  border-bottom: 1px solid var(--ui-border);
}

.payouts-summary__stages > div:last-child {
  border-bottom: 0;
}

.payouts-summary__stages dt {
  display: flex;
  align-items: center;
  min-width: 0;
  margin: 0;
  color: var(--ui-text);
  font-size: 11px;
}

.payouts-summary__stages dt small {
  margin-left: 7px;
  color: var(--ui-text-dimmed);
  font-size: 9px;
}

.payouts-summary__stages dd {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 650;
  white-space: nowrap;
}

.payouts-summary__dot {
  display: inline-block;
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  margin-right: 8px;
  border-radius: 999px;
}

.payouts-list {
  min-width: 0;
  padding-left: 28px;
}

.payouts-list__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 9px;
}

.payouts-list__header h3 {
  color: var(--ui-text-highlighted);
  font-size: 14px;
  font-weight: 650;
}

.payouts-list__cycle {
  color: var(--ui-text-dimmed);
  font-family: var(--font-mono);
  font-size: 9px;
  white-space: nowrap;
}

.payouts-list__rows {
  display: grid;
}

.payout-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  min-width: 0;
  min-height: 64px;
  border-bottom: 1px solid var(--ui-border);
}

.payout-row:last-child {
  border-bottom: 0;
}

.payout-row__status {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  background: var(--ui-bg-muted);
  font-size: 15px;
}

.payout-row__status--processing {
  color: var(--ui-warning);
}

.payout-row__status--approval {
  color: var(--ui-info);
}

.payout-row__status--scheduled {
  color: var(--ui-success);
}

.payout-row__copy,
.payout-row__amount {
  display: grid;
  min-width: 0;
}

.payout-row__copy strong,
.payout-row__copy span,
.payout-row__amount strong,
.payout-row__amount span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.payout-row__copy strong,
.payout-row__amount strong {
  color: var(--ui-text-highlighted);
  font-size: 11px;
  font-weight: 650;
}

.payout-row__copy span,
.payout-row__amount span {
  margin-top: 3px;
  color: var(--ui-text-dimmed);
  font-size: 9px;
}

.payout-row__amount {
  justify-items: end;
  max-width: 150px;
  text-align: right;
}

.payout-row__amount strong {
  font-family: var(--font-mono);
}

@media (max-width: 920px) {
  .payouts-overview__body {
    grid-template-columns: 1fr;
  }

  .payouts-summary {
    padding-right: 0;
    padding-bottom: 22px;
    border-right: 0;
    border-bottom: 1px solid var(--ui-border);
  }

  .payouts-list {
    padding-top: 22px;
    padding-left: 0;
  }
}

@media (max-width: 680px) {
  .payouts-overview__header {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .payouts-overview__actions {
    justify-content: space-between;
    width: 100%;
  }
}

@media (max-width: 480px) {
  .payouts-overview__actions {
    display: grid;
    grid-template-columns: 1fr;
  }

  .payouts-overview__actions :deep(.ui-button) {
    justify-content: center;
  }

  .payout-row {
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-rows: auto auto;
    gap: 5px 10px;
    align-items: start;
    min-height: 0;
    padding: 12px 0;
  }

  .payout-row__status {
    grid-row: 1 / span 2;
  }

  .payout-row__amount {
    grid-column: 2;
    display: flex;
    gap: 8px;
    align-items: center;
    max-width: none;
    text-align: left;
  }

  .payout-row__amount span {
    margin-top: 0;
  }
}
</style>
