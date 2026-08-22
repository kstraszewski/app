<script setup lang="ts">
import { toRaw } from 'vue'
import type {
  EmploymentType,
  IncomeSource,
  LoanPurpose,
  PortalCase,
  PortalMultiformAnswers,
  PortalMultiformDraft,
  PortalMultiformPayload,
  PortalUser,
} from '~/types/portal'

const props = withDefaults(defineProps<{
  caseData: PortalCase
  user: PortalUser
  payload: PortalMultiformPayload
  preview?: boolean
  save?: (body: {
    answers: PortalMultiformAnswers
    step: number
    revision: number
    completed?: boolean
  }) => Promise<PortalMultiformDraft | void>
}>(), {
  preview: false,
  save: undefined,
})

const toast = useToast()
const steps = [
  { label: 'Nieruchomość', caption: 'Cel i dokumenty' },
  { label: 'Dochody', caption: 'Źródło utrzymania' },
  { label: 'Zobowiązania', caption: 'Pełny obraz finansów' },
]

const emptyAnswers = (): PortalMultiformAnswers => ({
  applicant: {
    incomeSource: null,
    employmentType: null,
    incomePaidToAccount: null,
    additionalIncome: null,
    liabilities: null,
  },
  case: {
    loanPurpose: null,
    preliminaryAgreement: null,
    landRegister: null,
    appraisalAvailable: null,
    trancheDisbursement: null,
  },
})

const answers = reactive<PortalMultiformAnswers>(structuredClone(
  props.payload.draft?.answers || emptyAnswers(),
))
const activeStep = ref(Math.min(2, Math.max(0, (props.payload.draft?.activeStep || 1) - 1)))
const revision = ref(props.payload.draft?.revision || 0)
const saving = ref(false)
const completed = ref(Boolean(props.payload.draft?.completedAt))
const validationError = ref('')
const conflict = ref(false)

const loanPurposeModel = computed<LoanPurpose | undefined>({
  get: () => answers.case.loanPurpose ?? undefined,
  set: value => { answers.case.loanPurpose = value ?? null },
})
const incomeSourceModel = computed<IncomeSource | undefined>({
  get: () => answers.applicant.incomeSource ?? undefined,
  set: (value) => {
    answers.applicant.incomeSource = value ?? null
    if (value !== 'employment') answers.applicant.employmentType = null
  },
})
const employmentTypeModel = computed<EmploymentType | undefined>({
  get: () => answers.applicant.employmentType ?? undefined,
  set: value => { answers.applicant.employmentType = value ?? null },
})

const incomeSources = [
  { label: 'Umowa o pracę', value: 'employment' },
  { label: 'Działalność gospodarcza', value: 'business' },
  { label: 'Umowa cywilnoprawna', value: 'civil_contract' },
  { label: 'Emerytura lub renta', value: 'retirement' },
  { label: 'Najem', value: 'rental' },
  { label: 'Dochód zagraniczny', value: 'foreign' },
  { label: 'Inne źródło', value: 'other' },
]
const employmentTypes = [
  { label: 'Na czas nieokreślony', value: 'indefinite' },
  { label: 'Na czas określony', value: 'fixed' },
  { label: 'Okres próbny', value: 'probation' },
  { label: 'Inna', value: 'other' },
]
const loanPurposes = [
  { label: 'Zakup na rynku pierwotnym', value: 'purchase_primary' },
  { label: 'Zakup na rynku wtórnym', value: 'purchase_secondary' },
  { label: 'Budowa domu', value: 'construction' },
  { label: 'Remont', value: 'renovation' },
  { label: 'Refinansowanie', value: 'refinance' },
]
const yesNo = [
  { label: 'Tak', value: true },
  { label: 'Nie', value: false },
]

const answeredCount = computed(() => {
  const fields = [
    answers.applicant.incomeSource,
    ...(answers.applicant.incomeSource === 'employment'
      ? [answers.applicant.employmentType]
      : []),
    answers.applicant.incomePaidToAccount,
    answers.applicant.additionalIncome,
    answers.applicant.liabilities,
    answers.case.loanPurpose,
    answers.case.preliminaryAgreement,
    answers.case.landRegister,
    answers.case.appraisalAvailable,
    answers.case.trancheDisbursement,
  ]
  return {
    value: fields.filter(value => value !== null).length,
    total: fields.length,
  }
})
const progress = computed(() => Math.round(
  (answeredCount.value.value / Math.max(1, answeredCount.value.total)) * 100,
))

const backToCase = computed(() => props.preview
  ? `/preview/cases/${encodeURIComponent(props.caseData.id)}`
  : `/cases/${encodeURIComponent(props.caseData.id)}`)

function validateStep() {
  validationError.value = ''
  if (activeStep.value === 0) {
    if (!answers.case.loanPurpose
      || answers.case.preliminaryAgreement === null
      || answers.case.landRegister === null) {
      validationError.value = 'Odpowiedz na wszystkie pytania w tym kroku.'
    }
  }
  else if (activeStep.value === 1) {
    if (!answers.applicant.incomeSource
      || (answers.applicant.incomeSource === 'employment' && !answers.applicant.employmentType)
      || answers.applicant.incomePaidToAccount === null) {
      validationError.value = 'Odpowiedz na wszystkie pytania w tym kroku.'
    }
  }
  else if (
    answers.applicant.additionalIncome === null
    || answers.applicant.liabilities === null
    || answers.case.appraisalAvailable === null
    || answers.case.trancheDisbursement === null
  ) {
    validationError.value = 'Odpowiedz na wszystkie pytania w tym kroku.'
  }
  return !validationError.value
}

async function persist(nextStep = activeStep.value, isCompleted = false) {
  saving.value = true
  try {
    const updatedDraft = await props.save?.({
      answers: structuredClone(toRaw(answers)),
      step: nextStep + 1,
      revision: revision.value,
      completed: isCompleted || undefined,
    })
    if (updatedDraft) revision.value = updatedDraft.revision
    toast.add({
      title: isCompleted ? 'Formularz został przekazany ekspertowi' : 'Postęp został zapisany',
      icon: isCompleted ? 'i-lucide-check-circle-2' : 'i-lucide-cloud-check',
      color: 'success',
    })
  }
  catch (saveError: unknown) {
    const candidate = saveError as { statusCode?: number, status?: number }
    if (candidate.statusCode === 409 || candidate.status === 409) {
      conflict.value = true
      toast.add({
        title: 'Formularz został zmieniony w innym miejscu',
        description: 'Odśwież dane przed kolejnym zapisem, żeby nie nadpisać nowszych odpowiedzi.',
        icon: 'i-lucide-refresh-cw',
        color: 'warning',
      })
    }
    else {
      toast.add({
        title: 'Nie udało się zapisać odpowiedzi',
        description: 'Twoje odpowiedzi pozostają na ekranie. Spróbuj ponownie.',
        icon: 'i-lucide-circle-alert',
        color: 'error',
      })
    }
    throw saveError
  }
  finally {
    saving.value = false
  }
}

async function next() {
  if (!validateStep()) return
  if (activeStep.value < steps.length - 1) {
    const nextStep = activeStep.value + 1
    try {
      await persist(nextStep)
      activeStep.value = nextStep
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
    catch {
      // The toast above explains the recoverable save failure.
    }
    return
  }
  try {
    await persist(activeStep.value, true)
    completed.value = true
  }
  catch {
    // The toast above explains the recoverable save failure.
  }
}

async function previous() {
  const previousStep = Math.max(0, activeStep.value - 1)
  try {
    await persist(previousStep)
    activeStep.value = previousStep
  }
  catch {
    // Stay on the current step if save failed.
  }
}

function chooseBoolean(
  scope: 'applicant' | 'case',
  field: 'incomePaidToAccount' | 'additionalIncome' | 'liabilities'
    | 'preliminaryAgreement' | 'landRegister' | 'appraisalAvailable' | 'trancheDisbursement',
  value: boolean,
) {
  if (scope === 'applicant') {
    const applicantField = field as 'incomePaidToAccount' | 'additionalIncome' | 'liabilities'
    answers.applicant[applicantField] = value
  }
  else {
    const caseField = field as 'preliminaryAgreement' | 'landRegister' | 'appraisalAvailable' | 'trancheDisbursement'
    answers.case[caseField] = value
  }
  validationError.value = ''
}

function reloadDraft() {
  window.location.reload()
}
</script>

<template>
  <div class="multiform-screen">
    <PortalHeader
      :user-name="user.name"
      :user-email="user.email"
      :preview="preview"
    />

    <main class="multiform-main">
      <NuxtLink :to="backToCase" class="multiform-back">
        <UIcon name="i-lucide-arrow-left" />
        Wróć do sprawy
      </NuxtLink>

      <template v-if="payload.access === 'locked'">
        <section class="multiform-locked">
          <div class="multiform-locked__icon"><UIcon name="i-lucide-lock-keyhole" /></div>
          <p class="multiform-eyebrow">FORMULARZ MULTIWNIOSKU</p>
          <h1>Formularz nie jest jeszcze udostępniony</h1>
          <p class="multiform-locked__description">
            Twój ekspert najpierw sprawdzi zakres sprawy i dokumenty. Gdy odblokuje formularz,
            otrzymasz powiadomienie i zobaczysz tutaj wszystkie pytania.
          </p>
          <div class="multiform-locked__expert">
            <span>{{ caseData.expert.initials || caseData.expert.name.split(/\s+/u).map(part => part[0]).join('') }}</span>
            <div>
              <strong>{{ caseData.expert.name }}</strong>
              <p>Twój ekspert przygotowuje formularz</p>
            </div>
          </div>
          <UButton :to="backToCase" color="neutral" variant="outline" icon="i-lucide-arrow-left">
            Wróć do aktualności
          </UButton>
        </section>
      </template>

      <template v-else>
        <header class="multiform-heading">
          <div>
            <p class="multiform-eyebrow">FORMULARZ MULTIWNIOSKU</p>
            <h1>Uzupełnij informacje do wniosków bankowych</h1>
            <p>Odpowiedzi zapisujemy po każdym kroku. Ekspert wykorzysta je wyłącznie w tej sprawie.</p>
          </div>
          <div class="multiform-heading__progress">
            <strong>{{ progress }}%</strong>
            <span>{{ answeredCount.value }} z {{ answeredCount.total }} odpowiedzi</span>
          </div>
        </header>

        <div v-if="completed" class="multiform-complete">
          <span><UIcon name="i-lucide-check" /></span>
          <div>
            <h2>Formularz przekazany ekspertowi</h2>
            <p>Możesz wrócić do sprawy albo poprawić odpowiedzi i wysłać je ponownie.</p>
          </div>
          <UButton :to="backToCase" variant="solid" trailing icon="i-lucide-arrow-right">
            Wróć do sprawy
          </UButton>
        </div>

        <div class="multiform-layout">
          <aside class="multiform-steps" aria-label="Kroki formularza">
            <ol>
              <li
                v-for="(step, index) in steps"
                :key="step.label"
                :class="{ 'is-active': activeStep === index, 'is-complete': activeStep > index || completed }"
              >
                <span>
                  <UIcon v-if="activeStep > index || completed" name="i-lucide-check" />
                  <template v-else>{{ index + 1 }}</template>
                </span>
                <div>
                  <strong>{{ step.label }}</strong>
                  <small>{{ step.caption }}</small>
                </div>
              </li>
            </ol>
            <div class="multiform-steps__privacy">
              <UIcon name="i-lucide-shield-check" />
              <p>Dane widzi tylko zespół przypisany do tej sprawy.</p>
            </div>
          </aside>

          <section class="multiform-form-card">
            <header>
              <span>KROK {{ activeStep + 1 }} Z {{ steps.length }}</span>
              <h2>{{ steps[activeStep]?.label }}</h2>
              <p>{{ steps[activeStep]?.caption }}</p>
            </header>

            <form @submit.prevent="next">
              <div v-if="activeStep === 0" class="multiform-fields">
                <UFormField label="Jaki jest cel kredytu?" required>
                  <USelect
                    v-model="loanPurposeModel"
                    :items="loanPurposes"
                    value-key="value"
                    label-key="label"
                    placeholder="Wybierz cel"
                    class="w-full"
                  />
                </UFormField>
                <fieldset>
                  <legend>Czy podpisano umowę przedwstępną?</legend>
                  <div class="boolean-options">
                    <button
                      v-for="option in yesNo"
                      :key="String(option.value)"
                      type="button"
                      :class="{ 'is-selected': answers.case.preliminaryAgreement === option.value }"
                      @click="chooseBoolean('case', 'preliminaryAgreement', option.value)"
                    >
                      <UIcon :name="answers.case.preliminaryAgreement === option.value ? 'i-lucide-check-circle-2' : 'i-lucide-circle'" />
                      {{ option.label }}
                    </button>
                  </div>
                </fieldset>
                <fieldset>
                  <legend>Czy nieruchomość ma księgę wieczystą?</legend>
                  <div class="boolean-options">
                    <button
                      v-for="option in yesNo"
                      :key="String(option.value)"
                      type="button"
                      :class="{ 'is-selected': answers.case.landRegister === option.value }"
                      @click="chooseBoolean('case', 'landRegister', option.value)"
                    >
                      <UIcon :name="answers.case.landRegister === option.value ? 'i-lucide-check-circle-2' : 'i-lucide-circle'" />
                      {{ option.label }}
                    </button>
                  </div>
                </fieldset>
              </div>

              <div v-else-if="activeStep === 1" class="multiform-fields">
                <UFormField label="Główne źródło dochodu" required>
                  <USelect
                    v-model="incomeSourceModel"
                    :items="incomeSources"
                    value-key="value"
                    label-key="label"
                    placeholder="Wybierz źródło"
                    class="w-full"
                  />
                </UFormField>
                <UFormField
                  v-if="answers.applicant.incomeSource === 'employment'"
                  label="Rodzaj umowy o pracę"
                  required
                >
                  <USelect
                    v-model="employmentTypeModel"
                    :items="employmentTypes"
                    value-key="value"
                    label-key="label"
                    placeholder="Wybierz rodzaj umowy"
                    class="w-full"
                  />
                </UFormField>
                <fieldset>
                  <legend>Czy dochód wpływa na rachunek bankowy?</legend>
                  <div class="boolean-options">
                    <button
                      v-for="option in yesNo"
                      :key="String(option.value)"
                      type="button"
                      :class="{ 'is-selected': answers.applicant.incomePaidToAccount === option.value }"
                      @click="chooseBoolean('applicant', 'incomePaidToAccount', option.value)"
                    >
                      <UIcon :name="answers.applicant.incomePaidToAccount === option.value ? 'i-lucide-check-circle-2' : 'i-lucide-circle'" />
                      {{ option.label }}
                    </button>
                  </div>
                </fieldset>
              </div>

              <div v-else class="multiform-fields">
                <fieldset v-for="question in [
                  { scope: 'applicant', field: 'additionalIncome', label: 'Czy masz dodatkowe źródła dochodu?' },
                  { scope: 'applicant', field: 'liabilities', label: 'Czy masz obecne zobowiązania finansowe?' },
                  { scope: 'case', field: 'appraisalAvailable', label: 'Czy jest dostępny operat szacunkowy?' },
                  { scope: 'case', field: 'trancheDisbursement', label: 'Czy kredyt będzie wypłacany w transzach?' },
                ]" :key="question.field">
                  <legend>{{ question.label }}</legend>
                  <div class="boolean-options">
                    <button
                      v-for="option in yesNo"
                      :key="String(option.value)"
                      type="button"
                      :class="{ 'is-selected': (answers[question.scope as 'applicant' | 'case'] as Record<string, unknown>)[question.field] === option.value }"
                      @click="chooseBoolean(question.scope as 'applicant' | 'case', question.field as never, option.value)"
                    >
                      <UIcon :name="(answers[question.scope as 'applicant' | 'case'] as Record<string, unknown>)[question.field] === option.value ? 'i-lucide-check-circle-2' : 'i-lucide-circle'" />
                      {{ option.label }}
                    </button>
                  </div>
                </fieldset>
              </div>

              <UAlert
                v-if="conflict"
                color="warning"
                variant="subtle"
                icon="i-lucide-refresh-cw"
                title="Nowsza wersja formularza jest już dostępna"
                description="Odśwież formularz, aby wczytać najnowsze odpowiedzi."
              >
                <template #actions>
                  <UButton color="warning" variant="outline" @click="reloadDraft">
                    Odśwież dane
                  </UButton>
                </template>
              </UAlert>

              <UAlert
                v-if="validationError"
                color="error"
                variant="subtle"
                icon="i-lucide-circle-alert"
                :description="validationError"
              />

              <footer class="multiform-form-card__actions">
                <UButton
                  v-if="activeStep > 0"
                  type="button"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-arrow-left"
                  :disabled="saving"
                  @click="previous"
                >
                  Wstecz
                </UButton>
                <span v-else />
                <UButton
                  type="submit"
                  variant="solid"
                  trailing
                  :icon="activeStep === steps.length - 1 ? 'i-lucide-check' : 'i-lucide-arrow-right'"
                  :loading="saving"
                >
                  {{ activeStep === steps.length - 1 ? 'Przekaż ekspertowi' : 'Zapisz i przejdź dalej' }}
                </UButton>
              </footer>
            </form>
          </section>
        </div>
      </template>
    </main>
  </div>
</template>

<style scoped>
.multiform-screen {
  min-height: 100dvh;
  background: var(--ui-bg-muted);
}

.multiform-main {
  width: min(1180px, calc(100% - 48px));
  margin: 0 auto;
  padding: 34px 0 80px;
}

.multiform-back {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 33px;
  color: var(--ui-text-muted);
  font-size: 13px;
  text-decoration: none;
}

.multiform-back:hover {
  color: var(--ui-text-highlighted);
}

.multiform-eyebrow {
  margin: 0 0 9px;
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.13em;
}

.multiform-heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 40px;
  margin-bottom: 29px;
}

.multiform-heading h1 {
  max-width: 720px;
  margin: 0;
  font-size: clamp(30px, 3vw, 42px);
  font-weight: 400;
  line-height: 1.18;
}

.multiform-heading > div > p:last-child {
  max-width: 690px;
  margin: 10px 0 0;
  color: var(--ui-text-muted);
  font-size: 14px;
}

.multiform-heading__progress {
  display: grid;
  min-width: 130px;
  justify-items: end;
}

.multiform-heading__progress strong {
  color: var(--ui-text-highlighted);
  font-size: 30px;
  font-weight: 500;
}

.multiform-heading__progress span {
  color: var(--ui-text-muted);
  font-size: 11px;
}

.multiform-layout {
  display: grid;
  grid-template-columns: 270px minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}

.multiform-steps,
.multiform-form-card,
.multiform-complete {
  border: 1px solid var(--ui-border);
  border-radius: 18px;
  background: #fff;
}

.multiform-steps {
  padding: 25px;
}

.multiform-steps ol {
  display: grid;
  gap: 25px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.multiform-steps li {
  display: grid;
  grid-template-columns: 34px 1fr;
  gap: 12px;
  align-items: center;
  opacity: 0.48;
}

.multiform-steps li.is-active,
.multiform-steps li.is-complete {
  opacity: 1;
}

.multiform-steps li > span {
  display: grid;
  width: 33px;
  height: 33px;
  place-items: center;
  border-radius: 999px;
  background: var(--ui-bg-elevated);
  color: var(--ui-text-highlighted);
  font-size: 12px;
  font-weight: 600;
}

.multiform-steps li.is-active > span {
  background: #000;
  color: #fff;
}

.multiform-steps li.is-complete > span {
  background: var(--ui-success);
  color: #fff;
}

.multiform-steps li strong,
.multiform-steps li small {
  display: block;
}

.multiform-steps li strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 600;
}

.multiform-steps li small {
  color: var(--ui-text-muted);
  font-size: 11px;
}

.multiform-steps__privacy {
  display: flex;
  gap: 10px;
  margin-top: 31px;
  padding-top: 20px;
  border-top: 1px solid var(--ui-border);
  color: var(--ui-text-muted);
}

.multiform-steps__privacy svg {
  flex: 0 0 18px;
  width: 18px;
  height: 18px;
  color: var(--ui-text-highlighted);
}

.multiform-steps__privacy p {
  margin: 0;
  font-size: 11px;
  line-height: 1.55;
}

.multiform-form-card {
  padding: clamp(24px, 4vw, 48px);
}

.multiform-form-card > header {
  margin-bottom: 33px;
  padding-bottom: 25px;
  border-bottom: 1px solid var(--ui-border);
}

.multiform-form-card > header span {
  color: var(--ui-text-muted);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.12em;
}

.multiform-form-card > header h2 {
  margin: 7px 0 1px;
  font-size: 27px;
  font-weight: 500;
}

.multiform-form-card > header p {
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.multiform-fields {
  display: grid;
  gap: 25px;
}

.multiform-fields fieldset {
  margin: 0;
  padding: 0;
  border: 0;
}

.multiform-fields legend {
  margin-bottom: 10px;
  color: var(--ui-text-highlighted);
  font-size: 14px;
  font-weight: 500;
}

.boolean-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.boolean-options button {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 52px;
  padding: 0 16px;
  border: 1px solid var(--ui-border-accented);
  border-radius: 12px;
  background: #fff;
  color: var(--ui-text-toned);
  font-size: 14px;
  cursor: pointer;
}

.boolean-options button.is-selected {
  border-color: #000;
  color: var(--ui-text-highlighted);
  box-shadow: inset 0 0 0 1px #000;
}

.boolean-options svg {
  width: 19px;
  height: 19px;
}

.multiform-form-card__actions {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  margin-top: 34px;
  padding-top: 25px;
  border-top: 1px solid var(--ui-border);
}

.multiform-form-card__actions :deep(button[type="submit"]) {
  min-width: 210px;
  background: #000;
  color: #fff;
}

.multiform-complete {
  display: grid;
  grid-template-columns: 46px 1fr auto;
  gap: 18px;
  align-items: center;
  margin-bottom: 20px;
  padding: 18px 20px;
  border-color: color-mix(in srgb, var(--ui-success) 40%, var(--ui-border));
}

.multiform-complete > span {
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  border-radius: 999px;
  background: var(--ui-success);
  color: #fff;
}

.multiform-complete h2,
.multiform-complete p {
  margin: 0;
}

.multiform-complete h2 {
  font-size: 16px;
  font-weight: 600;
}

.multiform-complete p {
  margin-top: 2px;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.multiform-locked {
  display: grid;
  width: min(670px, 100%);
  justify-items: center;
  margin: 54px auto;
  padding: clamp(32px, 6vw, 66px);
  border: 1px solid var(--ui-border);
  border-radius: 20px;
  background: #fff;
  text-align: center;
}

.multiform-locked__icon {
  display: grid;
  width: 76px;
  height: 76px;
  place-items: center;
  margin-bottom: 25px;
  border: 1px solid var(--ui-border-accented);
  border-radius: 999px;
}

.multiform-locked__icon svg {
  width: 31px;
  height: 31px;
}

.multiform-locked h1 {
  margin: 0;
  font-size: clamp(28px, 4vw, 38px);
  font-weight: 400;
}

.multiform-locked__description {
  max-width: 510px;
  margin: 14px 0 27px;
  color: var(--ui-text-muted);
  font-size: 14px;
  line-height: 1.65;
}

.multiform-locked__expert {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 28px;
  text-align: left;
}

.multiform-locked__expert > span {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border-radius: 999px;
  background: var(--ui-bg-elevated);
  color: var(--ui-text-highlighted);
  font-size: 12px;
  font-weight: 600;
}

.multiform-locked__expert strong,
.multiform-locked__expert p {
  margin: 0;
}

.multiform-locked__expert strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.multiform-locked__expert p {
  color: var(--ui-text-muted);
  font-size: 11px;
}

@media (max-width: 1024px) {
  .multiform-main {
    width: min(100% - 32px, 680px);
    padding-bottom: calc(56px + env(safe-area-inset-bottom));
  }

  .multiform-heading {
    align-items: start;
    flex-direction: column;
    gap: 17px;
  }

  .multiform-heading__progress {
    justify-items: start;
  }

  .multiform-layout {
    grid-template-columns: 1fr;
  }

  .multiform-steps ol {
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
  }

  .multiform-steps li {
    grid-template-columns: 29px 1fr;
    gap: 8px;
  }

  .multiform-steps li > span {
    width: 28px;
    height: 28px;
  }

  .multiform-steps li small,
  .multiform-steps__privacy {
    display: none;
  }

  .multiform-complete {
    grid-template-columns: 44px 1fr;
  }

  .multiform-complete :deep(a) {
    grid-column: 1 / -1;
  }
}

@media (max-width: 640px) {
  .multiform-main {
    padding-bottom: var(--portal-mobile-nav-clearance);
  }
}

@media (max-width: 520px) {
  .multiform-steps {
    padding: 16px;
  }

  .multiform-steps li div {
    display: none;
  }

  .multiform-steps li {
    display: flex;
    justify-content: center;
  }

  .multiform-form-card {
    padding: 22px 18px;
  }

  .boolean-options {
    grid-template-columns: 1fr;
  }

  .multiform-form-card__actions {
    align-items: stretch;
    flex-direction: column-reverse;
  }

  .multiform-form-card__actions :deep(button) {
    width: 100%;
  }
}
</style>
