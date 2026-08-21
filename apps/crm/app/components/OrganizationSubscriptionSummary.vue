<script setup lang="ts">
const props = withDefaults(defineProps<{
  monthlyTotal: string
  planLabel: string
  priceQualifier: string
  grossMonthlyTotal?: string
  seatAssignment: string
  discountLabel?: string
}>(), {
  discountLabel: '',
  grossMonthlyTotal: '',
})

const hasDiscount = computed(() => Boolean(props.discountLabel))
</script>

<template>
  <section
    class="organization-subscription-summary"
    :aria-label="`Plan ${planLabel}`"
  >
    <header class="organization-subscription-summary__header">
      <div>
        <span>PLAN</span>
        <strong>{{ planLabel }}</strong>
      </div>
      <UBadge
        color="neutral"
        variant="subtle"
        size="sm"
        :icon="hasDiscount ? 'i-lucide-ticket-percent' : 'i-lucide-repeat-2'"
      >
        {{ hasDiscount ? 'Oferta specjalna' : 'Subskrypcja' }}
      </UBadge>
    </header>

    <div class="organization-subscription-summary__price">
      <strong>{{ monthlyTotal }}</strong>
      <div>
        <span>
          {{ priceQualifier }}
          <small>/ miesiąc</small>
        </span>
        <small
          v-if="grossMonthlyTotal"
          class="organization-subscription-summary__gross"
        >
          {{ grossMonthlyTotal }} brutto{{ hasDiscount ? ' przed rabatem' : '' }} / miesiąc
        </small>
      </div>
    </div>

    <ul class="organization-subscription-summary__benefits">
      <li>
        <UIcon name="i-lucide-shield-check" aria-hidden="true" />
        <span>Bezpieczna płatność Stripe</span>
      </li>
      <li>
        <UIcon name="i-lucide-user-round-check" aria-hidden="true" />
        <span>{{ seatAssignment }}</span>
      </li>
      <li v-if="hasDiscount">
        <UIcon name="i-lucide-ticket-percent" aria-hidden="true" />
        <span>Rabat automatyczny: {{ discountLabel }}</span>
      </li>
      <li v-else>
        <UIcon name="i-lucide-ticket" aria-hidden="true" />
        <span>Kod promocyjny możesz wpisać w checkout</span>
      </li>
      <li>
        <UIcon name="i-lucide-calendar-sync" aria-hidden="true" />
        <span>Rozliczenie co miesiąc</span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.organization-subscription-summary {
  display: grid;
  gap: 18px;
  overflow: hidden;
  border: 1px solid var(--ui-border-accented);
  border-radius: var(--oe-radius-surface);
  padding: 18px;
  background: var(--ui-bg);
}

.organization-subscription-summary__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.organization-subscription-summary__header > div {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.organization-subscription-summary__header > div > span {
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .1em;
}

.organization-subscription-summary__header strong {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 15px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.organization-subscription-summary__price {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.organization-subscription-summary__price > strong {
  color: var(--ui-text-highlighted);
  font-size: clamp(30px, 8vw, 38px);
  font-weight: 650;
  letter-spacing: -.04em;
  line-height: 1;
}

.organization-subscription-summary__price > div {
  display: grid;
  gap: 3px;
}

.organization-subscription-summary__price > div > span {
  display: flex;
  flex-wrap: wrap;
  gap: 0 4px;
  color: var(--ui-text-toned);
  font-size: 12px;
  font-weight: 550;
}

.organization-subscription-summary__price span small {
  color: var(--ui-text-muted);
  font-size: inherit;
  font-weight: inherit;
}

.organization-subscription-summary__gross {
  color: var(--ui-text-muted);
  font-size: 10px;
  font-weight: 500;
  line-height: 1.35;
}

.organization-subscription-summary__benefits {
  display: grid;
  gap: 0;
  margin: 0;
  border-top: 1px solid var(--ui-border);
  padding: 4px 0 0;
  list-style: none;
}

.organization-subscription-summary__benefits li {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  align-items: start;
  gap: 8px;
  min-width: 0;
  padding: 11px 0 0;
  color: var(--ui-text-toned);
  font-size: 11px;
  line-height: 1.4;
}

.organization-subscription-summary__benefits li :deep(svg) {
  width: 16px;
  height: 16px;
  margin-top: 1px;
  color: var(--ui-success);
}

</style>
