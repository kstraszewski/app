<script setup lang="ts">
import type {
  CrmMeetingPreparation,
  CrmMeetingPreparationCoBorrower,
  CrmMeetingPreparationComfortablePayment,
  CrmMeetingPreparationGoal,
  CrmMeetingPreparationIncomeSource,
  CrmMeetingPreparationLoanAmount,
  CrmMeetingPreparationLoanTerm,
  CrmMeetingPreparationMonthlyNetIncome,
  CrmMeetingPreparationMonthlyObligations,
  CrmMeetingPreparationOwnFunds,
  CrmMeetingPreparationPropertyBudget,
  CrmMeetingPreparationStage,
} from '~/types/crm-meeting'

const props = withDefaults(defineProps<{
  preparation: CrmMeetingPreparation | null
  compact?: boolean
}>(), {
  compact: false,
})

interface BriefFact {
  label: string
  value: string
  icon: string
  missing: boolean
}

const goalLabels: Record<CrmMeetingPreparationGoal, string> = {
  purchase: 'Zakup mieszkania lub domu',
  construction: 'Budowa lub większy remont',
  refinance: 'Przeniesienie obecnego kredytu',
  exploring: 'Sprawdza możliwości',
}
const stageLabels: Record<CrmMeetingPreparationStage, string> = {
  possibilities: 'Sprawdza możliwości',
  searching: 'Szuka lub planuje',
  selected: 'Ma konkretny cel',
  deadline: 'Ma umowę lub ważny termin',
}
const incomeSourceLabels: Record<CrmMeetingPreparationIncomeSource, string> = {
  employment: 'Umowa o pracę',
  business: 'Działalność gospodarcza',
  civil_contract: 'Umowy cywilnoprawne',
  foreign: 'Dochód zagraniczny',
  retirement: 'Emerytura lub renta',
  rental: 'Najem lub inne źródło',
  other: 'Inna sytuacja',
}
const coBorrowerLabels: Record<CrmMeetingPreparationCoBorrower, string> = {
  yes: 'Tak',
  no: 'Nie',
  unsure: 'Jeszcze nie wie',
}
const propertyBudgetLabels: Record<CrmMeetingPreparationPropertyBudget, string> = {
  up_to_400k: 'Do 400 tys. zł',
  '400k_600k': '400–600 tys. zł',
  '600k_800k': '600–800 tys. zł',
  '800k_1m': '800 tys.–1 mln zł',
  '1m_1_5m': '1–1,5 mln zł',
  above_1_5m: 'Powyżej 1,5 mln zł',
  unknown: 'Jeszcze nie wie',
}
const ownFundsLabels: Record<CrmMeetingPreparationOwnFunds, string> = {
  none: 'Brak',
  up_to_50k: 'Do 50 tys. zł',
  '50k_100k': '50–100 tys. zł',
  '100k_200k': '100–200 tys. zł',
  '200k_300k': '200–300 tys. zł',
  above_300k: 'Powyżej 300 tys. zł',
  unknown: 'Jeszcze nie wie',
}
const loanAmountLabels: Record<CrmMeetingPreparationLoanAmount, string> = {
  up_to_300k: 'Do 300 tys. zł',
  '300k_500k': '300–500 tys. zł',
  '500k_700k': '500–700 tys. zł',
  '700k_1m': '700 tys.–1 mln zł',
  above_1m: 'Powyżej 1 mln zł',
  unknown: 'Jeszcze nie wie',
}
const loanTermLabels: Record<CrmMeetingPreparationLoanTerm, string> = {
  '15': '15 lat',
  '20': '20 lat',
  '25': '25 lat',
  '30': '30 lat',
  '35': '35 lat',
  unknown: 'Do porównania',
}
const monthlyNetIncomeLabels: Record<CrmMeetingPreparationMonthlyNetIncome, string> = {
  up_to_6k: 'Do 6 tys. zł',
  '6k_10k': '6–10 tys. zł',
  '10k_15k': '10–15 tys. zł',
  '15k_20k': '15–20 tys. zł',
  '20k_30k': '20–30 tys. zł',
  above_30k: 'Powyżej 30 tys. zł',
  prefer_meeting: 'Do omówienia na spotkaniu',
}
const monthlyObligationsLabels: Record<CrmMeetingPreparationMonthlyObligations, string> = {
  none: 'Brak',
  up_to_1k: 'Do 1 tys. zł',
  '1k_2_5k': '1–2,5 tys. zł',
  '2_5k_5k': '2,5–5 tys. zł',
  above_5k: 'Powyżej 5 tys. zł',
  prefer_meeting: 'Do omówienia na spotkaniu',
}
const comfortablePaymentLabels: Record<CrmMeetingPreparationComfortablePayment, string> = {
  up_to_2500: 'Do 2 500 zł',
  '2500_3500': '2 500–3 500 zł',
  '3500_4500': '3 500–4 500 zł',
  '4500_6000': '4 500–6 000 zł',
  above_6000: 'Powyżej 6 000 zł',
  unknown: 'Chce to policzyć',
}

function choiceLabel<T extends string>(
  value: T | null,
  labels: Record<T, string>,
): string {
  return value ? labels[value] : 'Do omówienia'
}

function briefFact(label: string, value: string, icon: string, missing = false): BriefFact {
  return { label, value, icon, missing }
}

const profile = computed(() => props.preparation?.answers.profile ?? null)
const incomeSources = computed(() => profile.value?.incomeSources.map(source => (
  incomeSourceLabels[source]
)).join(', ') || 'Do omówienia')

const fullFacts = computed<BriefFact[]>(() => {
  const value = profile.value
  if (!value) return []
  return [
    briefFact('Cel', choiceLabel(value.goal, goalLabels), 'i-lucide-compass', !value.goal),
    briefFact('Etap', choiceLabel(value.stage, stageLabels), 'i-lucide-route', !value.stage),
    briefFact('Źródła dochodu', incomeSources.value, 'i-lucide-briefcase-business', !value.incomeSources.length),
    briefFact('Drugi kredytobiorca', choiceLabel(value.coBorrower, coBorrowerLabels), 'i-lucide-users-round', !value.coBorrower),
    briefFact('Budżet nieruchomości', choiceLabel(value.propertyBudget, propertyBudgetLabels), 'i-lucide-house', !value.propertyBudget),
    briefFact('Środki własne', choiceLabel(value.ownFunds, ownFundsLabels), 'i-lucide-wallet-cards', !value.ownFunds),
    briefFact('Kwota kredytu', choiceLabel(value.loanAmount, loanAmountLabels), 'i-lucide-landmark', !value.loanAmount),
    briefFact('Okres kredytu', choiceLabel(value.loanTerm, loanTermLabels), 'i-lucide-calendar-range', !value.loanTerm),
    briefFact('Dochód netto / mies.', choiceLabel(value.monthlyNetIncome, monthlyNetIncomeLabels), 'i-lucide-banknote', !value.monthlyNetIncome),
    briefFact('Zobowiązania / mies.', choiceLabel(value.monthlyObligations, monthlyObligationsLabels), 'i-lucide-receipt-text', !value.monthlyObligations),
    briefFact('Komfortowa rata', choiceLabel(value.comfortablePayment, comfortablePaymentLabels), 'i-lucide-gauge', !value.comfortablePayment),
  ]
})

const compactFacts = computed<BriefFact[]>(() => {
  const value = profile.value
  if (!value) return []
  const budgetParts = [
    value.propertyBudget ? propertyBudgetLabels[value.propertyBudget] : null,
    value.ownFunds ? `środki ${ownFundsLabels[value.ownFunds]}` : null,
  ].filter((item): item is string => Boolean(item))
  const financingParts = [
    value.loanAmount ? loanAmountLabels[value.loanAmount] : null,
    value.loanTerm ? loanTermLabels[value.loanTerm] : null,
  ].filter((item): item is string => Boolean(item))

  return [
    briefFact('Cel i etap', [
      value.goal ? goalLabels[value.goal] : null,
      value.stage ? stageLabels[value.stage] : null,
    ].filter(Boolean).join(' · ') || 'Do omówienia', 'i-lucide-compass', !value.goal && !value.stage),
    briefFact('Kredytobiorcy', choiceLabel(value.coBorrower, coBorrowerLabels), 'i-lucide-users-round', !value.coBorrower),
    briefFact('Budżet i środki', budgetParts.join(' · ') || 'Do omówienia', 'i-lucide-wallet-cards', !budgetParts.length),
    briefFact('Kwota i okres', financingParts.join(' · ') || 'Do omówienia', 'i-lucide-landmark', !financingParts.length),
    briefFact('Dochody', [
      value.monthlyNetIncome ? monthlyNetIncomeLabels[value.monthlyNetIncome] : null,
      value.incomeSources.length ? incomeSources.value : null,
    ].filter(Boolean).join(' · ') || 'Do omówienia', 'i-lucide-banknote', !value.monthlyNetIncome && !value.incomeSources.length),
    briefFact('Zobowiązania', choiceLabel(value.monthlyObligations, monthlyObligationsLabels), 'i-lucide-receipt-text', !value.monthlyObligations),
    briefFact('Komfortowa rata', choiceLabel(value.comfortablePayment, comfortablePaymentLabels), 'i-lucide-gauge', !value.comfortablePayment),
  ]
})

const displayedFacts = computed(() => props.compact ? compactFacts.value : fullFacts.value)
const answeredCount = computed(() => fullFacts.value.filter(item => !item.missing).length)
const totalAnswers = 11
const progress = computed(() => Math.round(answeredCount.value / totalAnswers * 100))
const updateLabel = computed(() => {
  if (!props.preparation?.updatedAt) return ''
  return new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(props.preparation.updatedAt))
})
</script>

<template>
  <section
    class="client-brief"
    :class="{ 'client-brief--compact': compact }"
    aria-label="Brief klienta przed spotkaniem"
  >
    <header class="client-brief__header">
      <span class="client-brief__heading-icon"><UIcon name="i-lucide-clipboard-check" /></span>
      <span class="client-brief__heading-copy">
        <small>Brief klienta</small>
        <strong>{{ compact ? 'Punkt startu rozmowy' : 'Informacje przekazane przed spotkaniem' }}</strong>
      </span>
      <UBadge
        v-if="preparation && !compact"
        :color="preparation.completedAt ? 'success' : 'primary'"
        variant="soft"
        :icon="preparation.completedAt ? 'i-lucide-circle-check-big' : 'i-lucide-loader-circle'"
      >
        {{ preparation.completedAt ? 'Gotowy' : 'Uzupełniany' }}
      </UBadge>
      <UBadge v-else-if="!compact" color="neutral" variant="soft" icon="i-lucide-clock-3">
        Oczekuje
      </UBadge>
    </header>

    <div v-if="!preparation" class="client-brief__empty">
      <UIcon name="i-lucide-clipboard-list" />
      <span>
        <strong>Klient jeszcze nie rozpoczął briefu</strong>
        <small>Odpowiedzi pojawią się tutaj automatycznie po zapisaniu.</small>
      </span>
    </div>

    <template v-else>
      <div v-if="!compact" class="client-brief__progress">
        <span>
          <small>Uzupełniono {{ answeredCount }} z {{ totalAnswers }} kluczowych informacji</small>
          <strong>{{ progress }}%</strong>
        </span>
        <div
          role="progressbar"
          aria-label="Uzupełnienie briefu klienta"
          :aria-valuenow="progress"
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <span :style="{ width: `${progress}%` }" />
        </div>
      </div>

      <dl class="client-brief__facts">
        <div
          v-for="fact in displayedFacts"
          :key="fact.label"
          :class="{ 'is-missing': fact.missing }"
        >
          <UIcon :name="fact.icon" />
          <span>
            <dt>{{ fact.label }}</dt>
            <dd>{{ fact.value }}</dd>
          </span>
        </div>
      </dl>

      <footer class="client-brief__footer">
        <span><UIcon name="i-lucide-refresh-cw" /> Zapisano {{ updateLabel }}</span>
        <span v-if="!compact">
          {{ preparation.answers.readConceptIds.length }} przeczytanych materiałów ·
          {{ preparation.answers.checkedItemIds.length }} elementów checklisty ·
          {{ preparation.answers.selectedQuestionIds.length }} pytań na rozmowę
        </span>
      </footer>
    </template>
  </section>
</template>

<style scoped>
.client-brief {
  display: grid;
  gap: 16px;
  padding: 18px;
  border: 1px solid color-mix(in srgb, var(--ui-primary) 24%, var(--ui-border));
  border-radius: 18px;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--ui-primary) 6%, transparent), transparent 42%),
    var(--ui-bg);
}

.client-brief__header {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 11px;
}

.client-brief__heading-icon {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: 12px;
  background: color-mix(in srgb, var(--ui-primary) 13%, var(--ui-bg-elevated));
  color: var(--ui-primary);
}

.client-brief__heading-copy {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.client-brief__heading-copy small {
  color: var(--ui-primary);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.client-brief__heading-copy strong {
  color: var(--ui-text-highlighted);
  font-size: 14px;
}

.client-brief__empty {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border: 1px dashed var(--ui-border);
  border-radius: 14px;
  color: var(--ui-text-muted);
}

.client-brief__empty > svg {
  flex: 0 0 auto;
  font-size: 22px;
}

.client-brief__empty span {
  display: grid;
  gap: 2px;
}

.client-brief__empty strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
}

.client-brief__empty small {
  line-height: 1.4;
}

.client-brief__progress {
  display: grid;
  gap: 7px;
}

.client-brief__progress > span {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.client-brief__progress small {
  color: var(--ui-text-toned);
  font-size: 11px;
}

.client-brief__progress strong {
  color: var(--ui-primary);
  font-size: 12px;
}

.client-brief__progress > div {
  overflow: hidden;
  height: 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ui-primary) 12%, var(--ui-bg-elevated));
}

.client-brief__progress > div span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--ui-primary);
  transition: width .2s ease;
}

.client-brief__facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}

.client-brief__facts > div {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--ui-border-muted);
  border-radius: 12px;
  background: var(--ui-bg-elevated);
}

.client-brief__facts > div > svg {
  margin-top: 2px;
  color: var(--ui-primary);
  font-size: 15px;
}

.client-brief__facts span {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.client-brief__facts dt {
  color: var(--ui-text-muted);
  font-size: 9px;
  font-weight: 750;
  letter-spacing: .04em;
  text-transform: uppercase;
}

.client-brief__facts dd {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 11px;
  font-weight: 700;
  line-height: 1.35;
}

.client-brief__facts > div.is-missing > svg,
.client-brief__facts > div.is-missing dd {
  color: var(--ui-text-muted);
}

.client-brief__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 7px 14px;
  color: var(--ui-text-muted);
  font-size: 10px;
}

.client-brief__footer span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.client-brief--compact {
  gap: 10px;
  padding: 12px;
  border-radius: 14px;
}

.client-brief--compact .client-brief__heading-icon {
  width: 32px;
  height: 32px;
  border-radius: 10px;
}

.client-brief--compact .client-brief__heading-copy strong {
  font-size: 12px;
}

.client-brief--compact .client-brief__header {
  grid-template-columns: auto minmax(0, 1fr);
}

.client-brief--compact .client-brief__facts {
  grid-template-columns: 1fr;
  gap: 5px;
}

.client-brief--compact .client-brief__facts > div {
  padding: 8px;
  border: 0;
  background: color-mix(in srgb, var(--ui-bg-elevated) 72%, transparent);
}

.client-brief--compact .client-brief__footer {
  justify-content: flex-start;
}

@media (max-width: 900px) {
  .client-brief__facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 560px) {
  .client-brief__header {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .client-brief__header > :last-child {
    grid-column: 2;
    justify-self: start;
  }

  .client-brief__facts {
    grid-template-columns: 1fr;
  }
}
</style>
