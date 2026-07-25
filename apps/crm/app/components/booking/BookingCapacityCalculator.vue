<script setup lang="ts">
import {
  calculateMortgageCapacity,
  type CapacityInterestType,
  type MortgageCapacityPolicy,
  type MortgageCapacityScenario,
} from '@openexpert/mortgage'
import type { BookingCapacityCalculatorSnapshot } from '#shared/types/booking-calculators'

const props = defineProps<{
  policy: MortgageCapacityPolicy
  policyRevision: number
}>()

const emit = defineEmits<{
  started: []
  continue: [snapshot: BookingCapacityCalculatorSnapshot]
}>()

const headingId = useId()
const formId = useId()

const form = reactive({
  monthlyNetIncome: 12_000,
  householdSize: 2,
  declaredLivingCosts: 0,
  existingMonthlyLoanPayments: 0,
  otherMonthlyObligations: 0,
  creditCardAndOverdraftLimits: 0,
  ownContribution: 120_000,
  termYears: 25,
  annualInterestRatePct: props.policy.defaultInterestRatePct,
  interestType: props.policy.defaultInterestType as CapacityInterestType,
  fixedRateYears: Math.min(
    25,
    Math.max(5, Math.round(props.policy.defaultFixedRatePeriodMonths / 12)),
  ),
})
let startedEmitted = false

watch(form, () => {
  if (startedEmitted) return
  startedEmitted = true
  emit('started')
}, { deep: true })

const interestTypeItems: Array<{ label: string, value: CapacityInterestType }> = [
  { label: 'Okresowo stałe', value: 'periodically_fixed' },
  { label: 'Zmienne', value: 'variable' },
  { label: 'Stałe przez cały okres', value: 'fixed_for_term' },
]

const currency = new Intl.NumberFormat('pl-PL', {
  style: 'currency',
  currency: 'PLN',
  maximumFractionDigits: 0,
})

const policyDate = computed(() => {
  const parsed = new Date(`${props.policy.policyAsOf}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return props.policy.policyAsOf
  return new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(parsed)
})

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const inputs = computed<MortgageCapacityScenario>(() => ({
  monthlyNetIncome: finiteNumber(form.monthlyNetIncome),
  householdSize: Math.round(finiteNumber(form.householdSize, 1)),
  declaredLivingCosts: finiteNumber(form.declaredLivingCosts),
  existingMonthlyLoanPayments: finiteNumber(form.existingMonthlyLoanPayments),
  otherMonthlyObligations: finiteNumber(form.otherMonthlyObligations),
  creditCardAndOverdraftLimits: finiteNumber(form.creditCardAndOverdraftLimits),
  ownContribution: finiteNumber(form.ownContribution),
  termMonths: Math.round(finiteNumber(form.termYears)) * 12,
  annualInterestRatePct: finiteNumber(form.annualInterestRatePct),
  interestType: form.interestType,
  fixedRatePeriodMonths: form.interestType === 'periodically_fixed'
    ? Math.round(finiteNumber(form.fixedRateYears)) * 12
    : null,
}))

const calculationState = computed(() => {
  try {
    return {
      result: calculateMortgageCapacity(inputs.value, props.policy),
      error: null,
    }
  } catch {
    return {
      result: null,
      error: 'Sprawdź, czy wszystkie wartości mieszczą się w podanych zakresach.',
    }
  }
})

watch(() => form.termYears, (termYears) => {
  const maximum = finiteNumber(termYears)
  if (maximum >= 5 && form.fixedRateYears > maximum) {
    form.fixedRateYears = maximum
  }
})

function continueToBooking() {
  const result = calculationState.value.result
  if (!result) return

  const scenario = inputs.value
  emit('continue', {
    widgetType: 'mortgage_capacity',
    version: 1,
    policyRevision: props.policyRevision,
    inputs: {
      monthlyNetIncome: scenario.monthlyNetIncome,
      householdSize: scenario.householdSize,
      declaredLivingCosts: scenario.declaredLivingCosts,
      existingMonthlyLoanPayments: scenario.existingMonthlyLoanPayments,
      otherMonthlyObligations: scenario.otherMonthlyObligations,
      creditCardAndOverdraftLimits: scenario.creditCardAndOverdraftLimits,
      ownContribution: scenario.ownContribution,
      termYears: Math.round(finiteNumber(form.termYears)),
      annualInterestRatePct: scenario.annualInterestRatePct,
      interestType: scenario.interestType,
      fixedRateYears: scenario.interestType === 'periodically_fixed'
        ? Math.round(finiteNumber(form.fixedRateYears))
        : null,
    },
  })
}
</script>

<template>
  <section :aria-labelledby="headingId">
    <header class="mb-6">
      <p class="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
        Kalkulator zdolności
      </p>
      <h2 :id="headingId" class="text-2xl font-semibold text-highlighted sm:text-3xl">
        Sprawdź orientacyjną zdolność kredytową
      </h2>
      <p class="mt-2 max-w-2xl text-sm leading-6 text-muted">
        Uzupełnij podstawowe informacje. Po obliczeniu wyniku przejdziesz do wyboru terminu rozmowy z ekspertem.
      </p>
    </header>

    <UForm
      :id="formId"
      :state="form"
      class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,24rem)]"
      @submit="continueToBooking"
    >
      <div class="min-w-0 space-y-7 rounded-xl border border-muted bg-default p-4 sm:p-6">
        <fieldset class="min-w-0 space-y-4 border-0 p-0">
          <legend class="mb-4 text-base font-semibold text-highlighted">
            Dochód i gospodarstwo domowe
          </legend>

          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField
              name="monthlyNetIncome"
              label="Łączny dochód netto miesięcznie"
              description="Stabilny dochód wszystkich wnioskodawców."
              required
            >
              <UInputNumber
                v-model="form.monthlyNetIncome"
                class="w-full"
                :min="0"
                :max="10000000"
                :step="500"
                :format-options="{ style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }"
              />
            </UFormField>

            <UFormField
              name="householdSize"
              label="Liczba osób w gospodarstwie"
              description="Dorośli i osoby na utrzymaniu."
              required
            >
              <UInputNumber
                v-model="form.householdSize"
                class="w-full"
                :min="1"
                :max="20"
                :step="1"
              />
            </UFormField>

            <UFormField
              name="declaredLivingCosts"
              label="Miesięczne koszty życia"
              description="Wpisz 0, aby kalkulator przyjął minimum modelowe."
            >
              <UInputNumber
                v-model="form.declaredLivingCosts"
                class="w-full"
                :min="0"
                :max="10000000"
                :step="100"
                :format-options="{ style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }"
              />
            </UFormField>

            <UFormField
              name="otherMonthlyObligations"
              label="Inne stałe obciążenia"
              description="Np. alimenty lub renty."
            >
              <UInputNumber
                v-model="form.otherMonthlyObligations"
                class="w-full"
                :min="0"
                :max="10000000"
                :step="100"
                :format-options="{ style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }"
              />
            </UFormField>
          </div>
        </fieldset>

        <fieldset class="min-w-0 space-y-4 border-0 border-t border-muted p-0 pt-6">
          <legend class="mb-4 text-base font-semibold text-highlighted">
            Obecne zobowiązania
          </legend>

          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField
              name="existingMonthlyLoanPayments"
              label="Suma miesięcznych rat"
              description="Kredyty, pożyczki i leasingi."
            >
              <UInputNumber
                v-model="form.existingMonthlyLoanPayments"
                class="w-full"
                :min="0"
                :max="10000000"
                :step="100"
                :format-options="{ style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }"
              />
            </UFormField>

            <UFormField
              name="creditCardAndOverdraftLimits"
              label="Limity kart i kont"
              description="Łączne przyznane limity, również niewykorzystane."
            >
              <UInputNumber
                v-model="form.creditCardAndOverdraftLimits"
                class="w-full"
                :min="0"
                :max="100000000"
                :step="1000"
                :format-options="{ style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }"
              />
            </UFormField>
          </div>
        </fieldset>

        <fieldset class="min-w-0 space-y-4 border-0 border-t border-muted p-0 pt-6">
          <legend class="mb-4 text-base font-semibold text-highlighted">
            Planowany kredyt
          </legend>

          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField name="ownContribution" label="Wkład własny" required>
              <UInputNumber
                v-model="form.ownContribution"
                class="w-full"
                :min="0"
                :max="1000000000"
                :step="10000"
                :format-options="{ style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }"
              />
            </UFormField>

            <UFormField name="termYears" label="Okres kredytu (lata)" required>
              <UInputNumber
                v-model="form.termYears"
                class="w-full"
                :min="5"
                :max="35"
                :step="1"
              />
            </UFormField>

            <UFormField name="interestType" label="Rodzaj oprocentowania" required>
              <USelect
                v-model="form.interestType"
                class="w-full"
                :items="interestTypeItems"
                value-key="value"
              />
            </UFormField>

            <UFormField
              name="annualInterestRatePct"
              label="Oprocentowanie roczne (%)"
              required
            >
              <UInputNumber
                v-model="form.annualInterestRatePct"
                class="w-full"
                :min="0"
                :max="30"
                :step="0.1"
              />
            </UFormField>

            <UFormField
              v-if="form.interestType === 'periodically_fixed'"
              name="fixedRateYears"
              label="Okres stałego oprocentowania (lata)"
              required
            >
              <UInputNumber
                v-model="form.fixedRateYears"
                class="w-full"
                :min="5"
                :max="form.termYears"
                :step="1"
              />
            </UFormField>
          </div>
        </fieldset>
      </div>

      <aside
        class="self-start rounded-xl border border-muted bg-elevated/50 p-5 lg:sticky lg:top-6"
        aria-live="polite"
        aria-atomic="true"
      >
        <UAlert
          v-if="calculationState.error || !calculationState.result"
          color="error"
          icon="i-lucide-circle-alert"
          title="Nie można obliczyć wyniku"
          :description="calculationState.error ?? undefined"
        />

        <template v-else>
          <p class="text-xs font-semibold tracking-wide text-muted uppercase">
            Szacowana maksymalna kwota kredytu
          </p>
          <output class="mt-2 block text-3xl font-semibold tracking-tight text-highlighted sm:text-4xl">
            {{ currency.format(calculationState.result.maximumLoanAmount) }}
          </output>

          <dl class="mt-5 divide-y divide-muted border-y border-muted text-sm">
            <div class="flex items-start justify-between gap-4 py-3">
              <dt class="text-muted">Budżet nieruchomości</dt>
              <dd class="text-right font-semibold text-highlighted">
                {{ currency.format(calculationState.result.maximumPropertyValue) }}
              </dd>
            </div>
            <div class="flex items-start justify-between gap-4 py-3">
              <dt class="text-muted">Orientacyjna rata</dt>
              <dd class="text-right font-semibold text-highlighted">
                {{ currency.format(calculationState.result.nominalMonthlyInstallment) }}
              </dd>
            </div>
          </dl>

          <p
            v-if="calculationState.result.declaredCostsRaisedToMinimum"
            class="mt-4 flex gap-2 text-xs leading-5 text-muted"
          >
            <UIcon name="i-lucide-info" class="mt-0.5 size-4 shrink-0" />
            Koszty życia zostały podniesione do minimum przyjętego w modelu.
          </p>
        </template>

        <UAlert
          class="mt-5"
          color="warning"
          variant="soft"
          icon="i-lucide-shield-alert"
          title="Wynik orientacyjny"
          :description="`To nie jest oferta ani decyzja kredytowa. Obliczenia opierają się na założeniach aktualnych na ${policyDate}.`"
        />

        <UButton
          type="submit"
          class="mt-5 w-full justify-center"
          color="primary"
          size="lg"
          icon="i-lucide-calendar-days"
          :disabled="!calculationState.result"
        >
          Umów spotkanie z ekspertem
        </UButton>
        <p class="mt-2 text-center text-xs leading-5 text-muted">
          W kolejnym kroku wybierzesz dogodny termin.
        </p>
      </aside>
    </UForm>
  </section>
</template>
