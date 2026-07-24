<script setup lang="ts">
import {
  calculateMortgage,
  type InstallmentType,
  type MortgageScenario,
} from '@openexpert/mortgage'
import type { BookingPaymentCalculatorSnapshot } from '#shared/types/booking-calculators'

const emit = defineEmits<{
  started: []
  continue: [snapshot: BookingPaymentCalculatorSnapshot]
}>()

const headingId = useId()
const formId = useId()

const form = reactive({
  loanAmount: 400_000,
  propertyValue: 500_000,
  termYears: 25,
  annualInterestRatePct: 6.5,
  installmentType: 'equal' as InstallmentType,
})
let startedEmitted = false

watch(form, () => {
  if (startedEmitted) return
  startedEmitted = true
  emit('started')
}, { deep: true })

const installmentTypeItems: Array<{
  label: string
  value: InstallmentType
  description: string
}> = [
  {
    label: 'Raty równe',
    value: 'equal',
    description: 'Niższa rata na początku i podobna wysokość rat w całym okresie.',
  },
  {
    label: 'Raty malejące',
    value: 'decreasing',
    description: 'Wyższa rata na początku, ale niższy łączny koszt odsetek.',
  },
]

const currency = new Intl.NumberFormat('pl-PL', {
  style: 'currency',
  currency: 'PLN',
  maximumFractionDigits: 0,
})

const percent = new Intl.NumberFormat('pl-PL', {
  maximumFractionDigits: 2,
})

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const inputs = computed(() => ({
  loanAmount: finiteNumber(form.loanAmount),
  propertyValue: finiteNumber(form.propertyValue),
  termMonths: Math.round(finiteNumber(form.termYears)) * 12,
  annualInterestRatePct: finiteNumber(form.annualInterestRatePct),
  installmentType: form.installmentType,
}))

const calculationState = computed(() => {
  const values = inputs.value

  if (values.loanAmount <= 0 || values.propertyValue <= 0) {
    return { result: null, error: 'Kwota kredytu i wartość nieruchomości muszą być większe od zera.' }
  }
  if (values.loanAmount > values.propertyValue) {
    return { result: null, error: 'Kwota kredytu nie może przekraczać wartości nieruchomości.' }
  }
  if (values.termMonths < 12 || values.termMonths > 420) {
    return { result: null, error: 'Okres kredytu musi wynosić od 1 do 35 lat.' }
  }
  if (values.annualInterestRatePct < 0 || values.annualInterestRatePct > 30) {
    return { result: null, error: 'Oprocentowanie musi mieścić się w zakresie od 0% do 30%.' }
  }

  const scenario: MortgageScenario = {
    loanAmount: values.loanAmount,
    propertyValue: values.propertyValue,
    termMonths: values.termMonths,
    installmentType: values.installmentType,
    fixedRatePct: values.annualInterestRatePct,
    fixedPeriodMonths: values.termMonths,
  }

  try {
    return { result: calculateMortgage(scenario), error: null }
  } catch {
    return {
      result: null,
      error: 'Sprawdź, czy wszystkie wartości mieszczą się w podanych zakresach.',
    }
  }
})

const ownContribution = computed(() => Math.max(
  0,
  inputs.value.propertyValue - inputs.value.loanAmount,
))

const lastInstallment = computed(() => (
  calculationState.value.result?.schedule.at(-1)?.installment ?? 0
))

function continueToBooking() {
  const result = calculationState.value.result
  if (!result) return

  const values = inputs.value
  emit('continue', {
    widgetType: 'mortgage_payment',
    version: 1,
    inputs: {
      loanAmount: values.loanAmount,
      propertyValue: values.propertyValue,
      termYears: Math.round(finiteNumber(form.termYears)),
      annualInterestRatePct: values.annualInterestRatePct,
      installmentType: values.installmentType,
    },
  })
}
</script>

<template>
  <section :aria-labelledby="headingId">
    <header class="mb-6">
      <p class="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
        Kalkulator raty
      </p>
      <h2 :id="headingId" class="text-2xl font-semibold text-highlighted sm:text-3xl">
        Oszacuj miesięczną ratę kredytu
      </h2>
      <p class="mt-2 max-w-2xl text-sm leading-6 text-muted">
        Porównaj ratę z planowanym budżetem, a następnie umów rozmowę, aby omówić dostępne warianty finansowania.
      </p>
    </header>

    <UForm
      :id="formId"
      :state="form"
      class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,24rem)]"
      @submit="continueToBooking"
    >
      <div class="min-w-0 space-y-6 rounded-xl border border-muted bg-default p-4 sm:p-6">
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField
            name="propertyValue"
            label="Wartość nieruchomości"
            required
          >
            <UInputNumber
              v-model="form.propertyValue"
              class="w-full"
              :min="1"
              :max="1000000000"
              :step="10000"
              :format-options="{ style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }"
            />
          </UFormField>

          <UFormField
            name="loanAmount"
            label="Kwota kredytu"
            :description="`Wkład własny: ${currency.format(ownContribution)}`"
            required
          >
            <UInputNumber
              v-model="form.loanAmount"
              class="w-full"
              :min="1"
              :max="1000000000"
              :step="10000"
              :format-options="{ style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }"
            />
          </UFormField>

          <UFormField name="termYears" label="Okres kredytu (lata)" required>
            <UInputNumber
              v-model="form.termYears"
              class="w-full"
              :min="1"
              :max="35"
              :step="1"
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
        </div>

        <UFormField
          name="installmentType"
          label="Rodzaj rat"
          required
        >
          <URadioGroup
            v-model="form.installmentType"
            :items="installmentTypeItems"
          />
        </UFormField>
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
          title="Nie można obliczyć raty"
          :description="calculationState.error ?? undefined"
        />

        <template v-else>
          <p class="text-xs font-semibold tracking-wide text-muted uppercase">
            {{ form.installmentType === 'equal' ? 'Szacowana rata miesięczna' : 'Szacowana pierwsza rata' }}
          </p>
          <output class="mt-2 block text-3xl font-semibold tracking-tight text-highlighted sm:text-4xl">
            {{ currency.format(calculationState.result.firstInstallment) }}
          </output>

          <dl class="mt-5 divide-y divide-muted border-y border-muted text-sm">
            <div
              v-if="form.installmentType === 'decreasing'"
              class="flex items-start justify-between gap-4 py-3"
            >
              <dt class="text-muted">Ostatnia rata</dt>
              <dd class="text-right font-semibold text-highlighted">
                {{ currency.format(lastInstallment) }}
              </dd>
            </div>
            <div class="flex items-start justify-between gap-4 py-3">
              <dt class="text-muted">Łączne odsetki</dt>
              <dd class="text-right font-semibold text-highlighted">
                {{ currency.format(calculationState.result.totalInterest) }}
              </dd>
            </div>
            <div class="flex items-start justify-between gap-4 py-3">
              <dt class="text-muted">Łącznie do spłaty</dt>
              <dd class="text-right font-semibold text-highlighted">
                {{ currency.format(calculationState.result.totalPayment) }}
              </dd>
            </div>
            <div class="flex items-start justify-between gap-4 py-3">
              <dt class="text-muted">LTV</dt>
              <dd class="text-right font-semibold text-highlighted">
                {{ percent.format(calculationState.result.ltvPct) }}%
              </dd>
            </div>
          </dl>
        </template>

        <UAlert
          class="mt-5"
          color="warning"
          variant="soft"
          icon="i-lucide-shield-alert"
          title="Wynik orientacyjny"
          description="To nie jest oferta ani decyzja kredytowa. Kalkulacja nie uwzględnia prowizji, ubezpieczeń, zmian stóp ani dodatkowych kosztów banku."
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
