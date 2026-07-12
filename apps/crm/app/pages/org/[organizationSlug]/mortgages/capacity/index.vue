<script setup lang="ts">
import {
  calculateMortgageCapacity,
  DEFAULT_MORTGAGE_CAPACITY_POLICY,
  type CapacityBindingConstraint,
  type CapacityInterestType,
  type MortgageCapacityPolicy,
} from '@openexpert/mortgage'

definePageMeta({ middleware: ['auth', 'organization'] })
useHead({ title: 'Szacunkowa zdolność hipoteczna — OpenExpert' })

type ConfigPayload = {
  settings: MortgageCapacityPolicy
  defaults: MortgageCapacityPolicy
  notes: string | null
  isCustomized: boolean
  revision: number
  updatedAt: string | null
  role: 'admin' | 'expert'
}

const route = useRoute()
const organizationSlug = computed(() => String(route.params.organizationSlug ?? ''))
const { data: config, error, status, refresh } = await useFetch<ConfigPayload>(
  () => `/api/org/${organizationSlug.value}/mortgages/capacity/config`,
  {
    key: computed(() => `mortgage-capacity-config-${organizationSlug.value}`),
    default: () => ({
      settings: structuredClone(DEFAULT_MORTGAGE_CAPACITY_POLICY),
      defaults: structuredClone(DEFAULT_MORTGAGE_CAPACITY_POLICY),
      notes: null,
      isCustomized: false,
      revision: 0,
      updatedAt: null,
      role: 'expert' as const,
    }),
  },
)

const scenario = reactive({
  monthlyNetIncome: 12_000,
  householdSize: 2,
  declaredLivingCosts: 0,
  existingMonthlyLoanPayments: 0,
  otherMonthlyObligations: 0,
  creditCardAndOverdraftLimits: 0,
  ownContribution: 120_000,
  termYears: 25,
  annualInterestRatePct: config.value.settings.defaultInterestRatePct,
  interestType: config.value.settings.defaultInterestType as CapacityInterestType,
  fixedRateYears: Math.min(25, Math.max(5, config.value.settings.defaultFixedRatePeriodMonths / 12)),
})

watch(() => scenario.termYears, (termYears) => {
  const maximumFixedRateYears = Number(termYears)
  if (
    Number.isFinite(maximumFixedRateYears)
    && maximumFixedRateYears >= 5
    && scenario.fixedRateYears > maximumFixedRateYears
  ) {
    scenario.fixedRateYears = maximumFixedRateYears
  }
})

const interestTypeItems = [
  { label: 'Okresowo stała', value: 'periodically_fixed' },
  { label: 'Zmienna', value: 'variable' },
  { label: 'Stała do końca', value: 'fixed_for_term' },
]

const currency = new Intl.NumberFormat('pl-PL', {
  style: 'currency',
  currency: 'PLN',
  maximumFractionDigits: 0,
})
const preciseCurrency = new Intl.NumberFormat('pl-PL', {
  style: 'currency',
  currency: 'PLN',
  maximumFractionDigits: 2,
})
const decimal = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2 })
const date = new Intl.DateTimeFormat('pl-PL')
const money = (value: number) => currency.format(value)
const preciseMoney = (value: number) => preciseCurrency.format(value)
const percent = (value: number) => `${decimal.format(value)}%`
const formatDate = (value: string | null | undefined) => value
  ? date.format(new Date(`${value.slice(0, 10)}T12:00:00`))
  : 'brak daty'

const calculationError = ref<string | null>(null)
const calculation = computed(() => {
  try {
    const result = calculateMortgageCapacity({
      monthlyNetIncome: Number(scenario.monthlyNetIncome ?? 0),
      householdSize: Number(scenario.householdSize ?? 1),
      declaredLivingCosts: Number(scenario.declaredLivingCosts ?? 0),
      existingMonthlyLoanPayments: Number(scenario.existingMonthlyLoanPayments ?? 0),
      otherMonthlyObligations: Number(scenario.otherMonthlyObligations ?? 0),
      creditCardAndOverdraftLimits: Number(scenario.creditCardAndOverdraftLimits ?? 0),
      ownContribution: Number(scenario.ownContribution ?? 0),
      termMonths: Math.round(Number(scenario.termYears ?? 0) * 12),
      annualInterestRatePct: Number(scenario.annualInterestRatePct ?? 0),
      interestType: scenario.interestType,
      fixedRatePeriodMonths: scenario.interestType === 'periodically_fixed'
        ? Math.round(Number(scenario.fixedRateYears ?? 0) * 12)
        : null,
    }, config.value.settings)
    calculationError.value = null
    return result
  } catch (caught) {
    calculationError.value = caught instanceof Error ? caught.message : 'Nieprawidłowe dane wejściowe'
    return null
  }
})

const constraintLabels: Record<CapacityBindingConstraint, { title: string, description: string, icon: string }> = {
  dsti: {
    title: 'Próg DStI',
    description: 'Suma rat i trwałych obciążeń doszła do modelowego progu dochodu.',
    icon: 'i-lucide-gauge',
  },
  minimum_social: {
    title: 'Koszty utrzymania',
    description: 'Po racie musi pozostać co najmniej przyjęte minimum socjalne.',
    icon: 'i-lucide-shopping-basket',
  },
  ltv: {
    title: 'Wkład własny / LTV',
    description: 'Dostępny wkład ogranicza budżet przy standardowym LTV do 80%.',
    icon: 'i-lucide-landmark',
  },
}
</script>

<template>
  <CrmShell title="Szacunkowa zdolność hipoteczna" eyebrow="Prosty model · PLN · nieruchomość mieszkalna">
    <template #actions>
      <UButton
        v-if="config.role === 'admin'"
        :to="`/org/${organizationSlug}/mortgages/capacity/admin`"
        icon="i-lucide-settings-2"
        variant="outline"
      >
        Założenia kalkulatora
      </UButton>
      <UButton :to="`/org/${organizationSlug}/mortgages`" icon="i-lucide-scale" variant="outline">
        Porównaj oferty
      </UButton>
    </template>

    <UAlert
      v-if="error"
      class="capacity-alert"
      color="error"
      icon="i-lucide-circle-alert"
      title="Nie udało się pobrać ustawień kalkulatora"
      description="Wyświetlamy bezpieczne wartości domyślne. Spróbuj odświeżyć połączenie z bazą."
      :actions="[{ label: 'Spróbuj ponownie', onClick: () => refresh() }]"
    />

    <UAlert
      class="capacity-alert"
      color="warning"
      icon="i-lucide-shield-alert"
      title="Wynik jest wyłącznie orientacyjny"
      description="To nie jest oferta, rekomendacja ani decyzja kredytowa. Bank zweryfikuje dokumenty, stabilność dochodu, historię kredytową, wiek, nieruchomość i własną politykę ryzyka."
    />

    <div class="capacity-meta">
      <span><UIcon name="i-lucide-calendar-check" /> Parametry na {{ formatDate(config.settings.policyAsOf) }}</span>
      <span><UIcon name="i-lucide-banknote" /> Tylko stabilny dochód netto w PLN</span>
      <span><UIcon name="i-lucide-badge-info" /> Wersja ustawień {{ config.revision || 'domyślna' }}</span>
    </div>

    <div class="capacity-layout">
      <div class="capacity-form">
        <section class="capacity-section">
          <header class="section-heading">
            <span>01</span>
            <div>
              <h2>Dochód i gospodarstwo</h2>
              <p>Wpisz stabilne kwoty miesięczne wszystkich wnioskodawców.</p>
            </div>
          </header>

          <div class="field-grid">
            <UFormField
              name="monthlyNetIncome"
              label="Stabilny dochód netto"
              description="Bez jednorazowych premii i 800+."
              required
            >
              <UInputNumber
                v-model="scenario.monthlyNetIncome"
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
              <UInputNumber v-model="scenario.householdSize" :min="1" :max="20" :step="1" />
            </UFormField>

            <UFormField
              name="declaredLivingCosts"
              label="Koszty życia po zakupie"
              description="Bez obecnych rat i przyszłej raty. Zero = minimum IPiSS."
            >
              <UInputNumber
                v-model="scenario.declaredLivingCosts"
                :min="0"
                :max="10000000"
                :step="100"
                :format-options="{ style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }"
              />
            </UFormField>

            <UFormField
              name="otherMonthlyObligations"
              label="Stałe nieodwołalne obciążenia"
              description="Np. alimenty lub renty, nieujęte już w dochodzie netto."
            >
              <UInputNumber
                v-model="scenario.otherMonthlyObligations"
                :min="0"
                :max="10000000"
                :step="100"
                :format-options="{ style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }"
              />
            </UFormField>
          </div>
        </section>

        <section class="capacity-section">
          <header class="section-heading">
            <span>02</span>
            <div>
              <h2>Obecne zobowiązania</h2>
              <p>Model uwzględnia raty oraz pełne przyznane limity, nie tylko wykorzystane saldo.</p>
            </div>
          </header>

          <div class="field-grid">
            <UFormField
              name="existingMonthlyLoanPayments"
              label="Miesięczne raty i leasingi"
              description="Suma rat wszystkich wnioskodawców."
            >
              <UInputNumber
                v-model="scenario.existingMonthlyLoanPayments"
                :min="0"
                :max="10000000"
                :step="100"
                :format-options="{ style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }"
              />
            </UFormField>

            <UFormField
              name="creditCardAndOverdraftLimits"
              label="Limity kart i debetów"
              :description="`Miesięczne obciążenie modelowe: ${decimal.format(config.settings.creditLimitMonthlyChargePct)}% limitu.`"
            >
              <UInputNumber
                v-model="scenario.creditCardAndOverdraftLimits"
                :min="0"
                :max="100000000"
                :step="1000"
                :format-options="{ style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }"
              />
            </UFormField>
          </div>
        </section>

        <section class="capacity-section">
          <header class="section-heading">
            <span>03</span>
            <div>
              <h2>Planowany kredyt</h2>
              <p>Wkład dotyczy samego zakupu — odłóż osobno środki na koszty transakcyjne.</p>
            </div>
          </header>

          <div class="field-grid">
            <UFormField name="ownContribution" label="Wkład własny" required>
              <UInputNumber
                v-model="scenario.ownContribution"
                :min="0"
                :max="1000000000"
                :step="10000"
                :format-options="{ style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }"
              />
            </UFormField>

            <UFormField
              name="termYears"
              label="Okres umowy"
              description="Powyżej 25 lat zdolność nadal liczymy maksymalnie na 25 lat."
              required
            >
              <UInputNumber v-model="scenario.termYears" :min="5" :max="35" :step="1" />
            </UFormField>

            <UFormField name="interestType" label="Rodzaj oprocentowania" required>
              <USelect
                v-model="scenario.interestType"
                :items="interestTypeItems"
                value-key="value"
                class="w-full"
              />
            </UFormField>

            <UFormField
              name="annualInterestRatePct"
              label="Nominalne oprocentowanie roczne"
              description="Pełna stopa oferty, bez dodawania bufora."
              required
            >
              <UInputNumber
                v-model="scenario.annualInterestRatePct"
                :min="0"
                :max="30"
                :step="0.1"
              />
            </UFormField>

            <UFormField
              v-if="scenario.interestType === 'periodically_fixed'"
              name="fixedRateYears"
              label="Okres stałej stopy"
              description="Rekomendacja S przewiduje co najmniej 5 lat."
              required
            >
              <UInputNumber
                v-model="scenario.fixedRateYears"
                :min="5"
                :max="scenario.termYears"
                :step="1"
              />
            </UFormField>
          </div>
        </section>
      </div>

      <aside class="capacity-result" aria-live="polite">
        <div v-if="status === 'pending'" class="result-loading">
          <USkeleton class="h-5 w-32" />
          <USkeleton class="h-14 w-full" />
          <USkeleton class="h-24 w-full" />
        </div>

        <UAlert
          v-else-if="calculationError || !calculation"
          color="error"
          icon="i-lucide-circle-alert"
          title="Sprawdź dane"
          :description="calculationError ?? 'Nie można obliczyć wyniku.'"
        />

        <template v-else>
          <p class="result-eyebrow">Maksymalna szacunkowa kwota</p>
          <strong class="result-value">{{ money(calculation.maximumLoanAmount) }}</strong>
          <p class="result-budget">
            Orientacyjny budżet nieruchomości
            <strong>{{ money(calculation.maximumPropertyValue) }}</strong>
          </p>

          <UAlert
            v-if="calculation.maximumLoanAmount === 0"
            class="zero-alert"
            color="warning"
            icon="i-lucide-triangle-alert"
            title="Model nie wykazuje dostępnej kwoty"
            description="Sprawdź dochód, zobowiązania i wkład własny. Standardowy wariant wymaga co najmniej 20% wkładu."
          />

          <dl class="result-metrics">
            <div>
              <dt>Rata przy obecnej stopie</dt>
              <dd>{{ preciseMoney(calculation.nominalMonthlyInstallment) }}</dd>
            </div>
            <div>
              <dt>Rata testowa</dt>
              <dd>{{ preciseMoney(calculation.stressedMonthlyInstallment) }}</dd>
            </div>
            <div>
              <dt>Stopa użyta do oceny</dt>
              <dd>{{ percent(calculation.assessmentRatePct) }}</dd>
              <small>{{ percent(scenario.annualInterestRatePct) }} + {{ decimal.format(calculation.rateBufferPct) }} p.p.</small>
            </div>
            <div>
              <dt>DStI przy racie testowej</dt>
              <dd>{{ percent(calculation.assessedDstiPct) }}</dd>
              <small>Próg modelu: {{ percent(config.settings.dstiLimitPct) }}</small>
            </div>
            <div>
              <dt>Koszty życia przyjęte w modelu</dt>
              <dd>{{ preciseMoney(calculation.assessedLivingCosts) }}</dd>
              <small>Minimum IPiSS: {{ preciseMoney(calculation.minimumSocialCosts) }}</small>
            </div>
            <div>
              <dt>Pozostaje po racie testowej</dt>
              <dd>{{ preciseMoney(calculation.disposableIncomeAfterStressedInstallment) }}</dd>
              <small>Po buforze dochodu {{ percent(config.settings.incomeBufferPct) }}</small>
            </div>
            <div>
              <dt>LTV dla maksymalnego budżetu</dt>
              <dd>{{ percent(calculation.ltvPct) }}</dd>
              <small>Limit modelu: {{ percent(config.settings.maxLtvPct) }}</small>
            </div>
            <div>
              <dt>Okres oceny zdolności</dt>
              <dd>{{ calculation.assessmentTermMonths / 12 }} lat</dd>
              <small>Umowa: {{ calculation.contractTermMonths / 12 }} lat</small>
            </div>
          </dl>

          <div class="constraint-block">
            <h3>Co ogranicza wynik</h3>
            <div
              v-for="constraint in calculation.bindingConstraints"
              :key="constraint"
              class="constraint"
            >
              <UIcon :name="constraintLabels[constraint].icon" />
              <div>
                <strong>{{ constraintLabels[constraint].title }}</strong>
                <p>{{ constraintLabels[constraint].description }}</p>
              </div>
            </div>
          </div>

          <div v-if="calculation.declaredCostsRaisedToMinimum || calculation.termCappedForAssessment" class="result-notes">
            <p v-if="calculation.declaredCostsRaisedToMinimum">
              <UIcon name="i-lucide-info" /> Zadeklarowane koszty podniesiono do minimum socjalnego IPiSS.
            </p>
            <p v-if="calculation.termCappedForAssessment">
              <UIcon name="i-lucide-clock-3" /> Umowa ma {{ calculation.contractTermMonths / 12 }} lat, ale zdolność policzono na 25 lat.
            </p>
          </div>
        </template>
      </aside>
    </div>

    <section class="methodology">
      <div>
        <p class="methodology-label">Metoda</p>
        <h2>Co ten prosty model sprawdza</h2>
        <p>Najpierw ogranicza możliwą ratę przez modelowy DStI i dochód pozostający ponad kosztami życia. Następnie zamienia ratę na kwotę kredytu przy stopie powiększonej o bufor KNF i sprawdza wkład własny przy LTV do 80%.</p>
      </div>
      <div class="source-links">
        <a href="https://www.knf.gov.pl/knf/pl/komponenty/img/Rekomendacja_S_nowelizacja_czerwiec_2023_82872.pdf" target="_blank" rel="noreferrer">Rekomendacja S KNF <UIcon name="i-lucide-external-link" /></a>
        <a href="https://www.ipiss.com.pl/wp-content/uploads/2026/04/MS-4Q2025.pdf" target="_blank" rel="noreferrer">Minimum socjalne IPiSS <UIcon name="i-lucide-external-link" /></a>
        <a href="https://nbp.pl/rpp-08-07-2026/" target="_blank" rel="noreferrer">Stopa referencyjna NBP <UIcon name="i-lucide-external-link" /></a>
      </div>
    </section>
  </CrmShell>
</template>

<style scoped>
.capacity-alert { margin-bottom: 14px; }
.capacity-meta { display: flex; flex-wrap: wrap; gap: 8px; margin: 18px 0 24px; }
.capacity-meta span { display: inline-flex; align-items: center; gap: 7px; padding: 8px 10px; border: 1px solid var(--ui-border-muted); border-radius: var(--ui-radius); color: var(--ui-text-muted); background: var(--ui-bg); font-size: 12px; }
.capacity-layout { display: grid; grid-template-columns: minmax(0, 1fr) 390px; gap: 24px; align-items: start; }
.capacity-form { display: grid; gap: 16px; }
.capacity-section, .capacity-result, .methodology { border: 1px solid var(--ui-border); border-radius: calc(var(--ui-radius) * 1.5); background: var(--ui-bg); }
.capacity-section { padding: 22px; }
.section-heading { display: flex; gap: 14px; align-items: flex-start; margin-bottom: 22px; }
.section-heading > span { display: grid; place-items: center; width: 34px; height: 34px; flex: none; border: 1px solid var(--ui-border); border-radius: 50%; color: var(--ui-text-toned); font-family: var(--font-mono); font-size: 11px; }
.section-heading h2, .methodology h2 { margin: 0; color: var(--ui-text-highlighted); font-size: 20px; font-weight: 600; }
.section-heading p { margin: 4px 0 0; color: var(--ui-text-muted); font-size: 13px; }
.field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
.field-grid :deep([data-slot='root']) { width: 100%; }
.capacity-result { position: sticky; top: 24px; padding: 24px; overflow: hidden; }
.capacity-result::before { content: ''; display: block; width: 52px; height: 3px; margin-bottom: 22px; background: var(--ui-bg-inverted); }
.result-loading { display: grid; gap: 16px; }
.result-eyebrow { margin: 0 0 8px; color: var(--ui-text-muted); font-family: var(--font-mono); font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
.result-value { display: block; color: var(--ui-text-highlighted); font-family: var(--font-serif); font-size: clamp(44px, 5vw, 64px); font-weight: 400; line-height: .98; letter-spacing: -.045em; }
.result-budget { display: flex; justify-content: space-between; gap: 16px; margin: 18px 0 22px; padding: 13px 0; border-block: 1px solid var(--ui-border-muted); color: var(--ui-text-muted); font-size: 12px; }
.result-budget strong { color: var(--ui-text-highlighted); }
.zero-alert { margin-bottom: 18px; }
.result-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px; margin: 0; background: var(--ui-border-muted); border: 1px solid var(--ui-border-muted); }
.result-metrics > div { min-width: 0; padding: 13px; background: var(--ui-bg); }
.result-metrics dt { color: var(--ui-text-muted); font-size: 11px; line-height: 1.3; }
.result-metrics dd { margin: 5px 0 1px; color: var(--ui-text-highlighted); font-size: 15px; font-weight: 650; }
.result-metrics small { display: block; color: var(--ui-text-dimmed); font-size: 10px; line-height: 1.35; }
.constraint-block { margin-top: 22px; }
.constraint-block h3 { margin: 0 0 10px; font-size: 13px; }
.constraint { display: flex; gap: 10px; padding: 12px 0; border-top: 1px solid var(--ui-border-muted); }
.constraint > :first-child { width: 18px; height: 18px; flex: none; color: var(--ui-text-toned); }
.constraint strong { color: var(--ui-text-highlighted); font-size: 12px; }
.constraint p { margin: 2px 0 0; color: var(--ui-text-muted); font-size: 11px; line-height: 1.45; }
.result-notes { margin-top: 16px; padding: 12px; background: var(--ui-bg-muted); }
.result-notes p { display: flex; gap: 8px; margin: 0; color: var(--ui-text-muted); font-size: 11px; line-height: 1.45; }
.result-notes p + p { margin-top: 8px; }
.methodology { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 40px; margin-top: 24px; padding: 24px; }
.methodology-label { margin: 0 0 8px; color: var(--ui-text-muted); font-family: var(--font-mono); font-size: 10px; font-weight: 700; text-transform: uppercase; }
.methodology h2 { font-family: var(--font-serif); font-size: 28px; font-weight: 400; }
.methodology p:not(.methodology-label) { max-width: 720px; margin: 10px 0 0; color: var(--ui-text-muted); font-size: 13px; line-height: 1.65; }
.source-links { display: grid; align-content: start; }
.source-links a { display: flex; justify-content: space-between; gap: 12px; padding: 11px 0; border-bottom: 1px solid var(--ui-border-muted); color: var(--ui-text-highlighted); font-size: 12px; text-decoration: none; }
.source-links a:hover { color: var(--ui-text-toned); }
@media (max-width: 1120px) { .capacity-layout { grid-template-columns: 1fr; } .capacity-result { position: static; } }
@media (max-width: 720px) { .field-grid, .result-metrics, .methodology { grid-template-columns: 1fr; } .capacity-section, .capacity-result, .methodology { padding: 18px; } .result-value { font-size: 46px; } }
</style>
