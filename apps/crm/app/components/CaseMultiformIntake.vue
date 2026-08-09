<script setup lang="ts">
import type { CaseDetail } from '~/types/cases'
import type { MultiformCrmContext, MultiformContextRequirement } from '~/types/multiform'
import {
  getMultiformApplicantIntakeProgress,
  getMultiformIntakeProgress,
  multiformIntakeBooleanOptions,
  multiformIntakeEmploymentTypeOptions,
  multiformIntakeIncomeSourceOptions,
  multiformIntakeLabels,
  multiformIntakeLoanProgramOptions,
  multiformIntakeLoanPurposeOptions,
  normalizeMultiformIntake,
  resolveMultiformIntakeRequirement,
  validateMultiformIntake,
  type MultiformApplicantIntakeAnswers,
  type MultiformCaseIntakeAnswers,
  type MultiformIntakeAnswers,
  type MultiformIntakeValidationIssue,
} from '#shared/multiform-intake'

const props = withDefaults(defineProps<{
  caseData: CaseDetail
  context: MultiformCrmContext
  modelValue: MultiformIntakeAnswers
  validationVisible?: boolean
  autoFilledCount?: number
  saving?: boolean
  savedAt?: string
}>(), {
  validationVisible: false,
  autoFilledCount: 0,
  saving: false,
  savedAt: '',
})

const emit = defineEmits<{
  'update:modelValue': [value: MultiformIntakeAnswers]
}>()

const caseSubject = '__case__'
const incomeSourceItems = [...multiformIntakeIncomeSourceOptions]
const employmentTypeItems = [...multiformIntakeEmploymentTypeOptions]
const loanPurposeItems = [...multiformIntakeLoanPurposeOptions]
const loanProgramItems = [...multiformIntakeLoanProgramOptions]
const booleanItems = [...multiformIntakeBooleanOptions]
const activeSubject = ref(
  props.caseData.clients.find(client => client.is_primary)?.id
  ?? props.caseData.clients[0]?.id
  ?? caseSubject,
)

const clientIds = computed(() => props.caseData.clients.map(client => client.id))
const normalizedAnswers = computed(() => normalizeMultiformIntake(props.modelValue, clientIds.value))
const progress = computed(() => getMultiformIntakeProgress(normalizedAnswers.value, clientIds.value))
const validation = computed(() => validateMultiformIntake(normalizedAnswers.value, clientIds.value))
const missingCount = computed(() => Math.max(0, progress.value.total - progress.value.completed))

const subjectItems = computed(() => [
  ...props.caseData.clients.map(client => ({
    label: client.display_name,
    value: client.id,
    icon: 'i-lucide-user-round',
  })),
  {
    label: 'Wspólne dla sprawy',
    value: caseSubject,
    icon: 'i-lucide-users-round',
  },
])

const activeClient = computed(() => (
  props.caseData.clients.find(client => client.id === activeSubject.value) ?? null
))

const activeApplicantAnswers = computed(() => (
  activeClient.value
    ? normalizedAnswers.value.applicants[activeClient.value.id] ?? null
    : null
))
const activeApplicantProgress = computed(() => (
  activeClient.value
    ? getMultiformApplicantIntakeProgress(normalizedAnswers.value, activeClient.value.id)
    : null
))

function copyAnswers(): MultiformIntakeAnswers {
  return {
    applicants: Object.fromEntries(Object.entries(normalizedAnswers.value.applicants).map(([id, answers]) => [
      id,
      { ...answers },
    ])),
    case: { ...normalizedAnswers.value.case },
  }
}

function updateApplicant<K extends keyof MultiformApplicantIntakeAnswers>(
  field: K,
  value: MultiformApplicantIntakeAnswers[K],
) {
  const client = activeClient.value
  if (!client) return
  const next = copyAnswers()
  const current = next.applicants[client.id]
  if (!current) return
  next.applicants[client.id] = {
    ...current,
    [field]: value,
    ...(field === 'incomeSource' && value !== 'employment'
      ? { employmentType: null }
      : {}),
  }
  emit('update:modelValue', next)
}

function updateCase<K extends keyof MultiformCaseIntakeAnswers>(
  field: K,
  value: MultiformCaseIntakeAnswers[K],
) {
  const next = copyAnswers()
  next.case = {
    ...next.case,
    [field]: value,
    ...(field === 'loanProgram' && value !== 'rkm' ? { rkmGuarantee: null } : {}),
  }
  emit('update:modelValue', next)
}

function updateIncomeSource(value: unknown) {
  const option = multiformIntakeIncomeSourceOptions.find(item => item.value === value)
  if (option) updateApplicant('incomeSource', option.value)
}

function updateEmploymentType(value: unknown) {
  const option = multiformIntakeEmploymentTypeOptions.find(item => item.value === value)
  if (option) updateApplicant('employmentType', option.value)
}

function updateBooleanApplicant(
  field: 'incomePaidToAccount' | 'additionalIncome' | 'liabilities',
  value: unknown,
) {
  if (typeof value === 'boolean') updateApplicant(field, value)
}

function updateLoanPurpose(value: unknown) {
  const option = multiformIntakeLoanPurposeOptions.find(item => item.value === value)
  if (option) updateCase('loanPurpose', option.value)
}

function updateLoanProgram(value: unknown) {
  const option = multiformIntakeLoanProgramOptions.find(item => item.value === value)
  if (option) updateCase('loanProgram', option.value)
}

function updateBooleanCase(
  field: 'rkmGuarantee' | 'preliminaryAgreement' | 'landRegister' | 'appraisalAvailable' | 'trancheDisbursement',
  value: unknown,
) {
  if (typeof value === 'boolean') updateCase(field, value)
}

function fieldError(field: keyof MultiformApplicantIntakeAnswers | keyof MultiformCaseIntakeAnswers) {
  if (!props.validationVisible) return undefined
  const issue = validation.value.issues.find(item => (
    item.field === field
    && (
      activeClient.value
        ? item.clientId === activeClient.value.id
        : item.scope === 'case'
    )
  ))
  return issue?.message
}

function requirementAcceptsAttachment(requirement: MultiformContextRequirement) {
  return requirement.itemKind === 'client_document'
    || (requirement.itemKind === 'bank_document' && !requirement.templateId)
}

const previewRequirements = computed(() => props.context.checklist.requirements.flatMap((requirement) => {
  if (!requirementAcceptsAttachment(requirement)) return []
  const resolution = resolveMultiformIntakeRequirement(requirement, normalizedAnswers.value)
  return resolution.phase === 'analysis' && resolution.status === 'required'
    ? [requirement]
    : []
}))

const unresolvedRequirementCount = computed(() => props.context.checklist.requirements.filter((requirement) => {
  if (!requirementAcceptsAttachment(requirement)) return false
  const resolution = resolveMultiformIntakeRequirement(requirement, normalizedAnswers.value)
  return resolution.phase === 'analysis' && resolution.status === 'unknown'
}).length)

const requirementCountByOwner = computed(() => {
  const counts = new Map<string, number>()
  for (const requirement of previewRequirements.value) {
    const key = requirement.ownerClientId ?? caseSubject
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
})

const bankNames = computed(() => [...new Set(props.context.applications.map(application => application.bankName))])

const selectedProperty = computed(() => (
  props.caseData.properties.find(property => property.id === props.caseData.selected_property_id)
  ?? props.caseData.properties[0]
  ?? null
))

function formatSavedAt(value: string) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' }).format(date)
}

async function focusIssue(issue: MultiformIntakeValidationIssue) {
  activeSubject.value = issue.scope === 'applicant' && issue.clientId
    ? issue.clientId
    : caseSubject
  await nextTick()
  const field = document.querySelector<HTMLElement>(
    `[data-intake-field="${issue.field}"] input, [data-intake-field="${issue.field}"] button`,
  )
  field?.focus()
}

defineExpose({ focusIssue })
</script>

<template>
  <div class="multiform-intake">
    <div class="multiform-intake__main">
      <header class="multiform-intake__heading">
        <p>Pytania wstępne</p>
        <h3>Ustal wymagane dokumenty</h3>
        <span>
          Na podstawie danych z CRM i kalkulatora uzupełniliśmy to, co już wiemy.
          Odpowiedz tylko na pytania, które zmieniają listę dokumentów.
        </span>
      </header>

      <div class="multiform-intake__status" aria-live="polite">
        <span><UIcon name="i-lucide-circle-check" /></span>
        <p>
          <strong>{{ autoFilledCount }} odpowiedzi uzupełniono automatycznie</strong>
          <small>· {{ missingCount }} {{ missingCount === 1 ? 'pytanie pozostało' : 'pytań pozostało' }}</small>
        </p>
        <UProgress :model-value="progress.percentage" color="neutral" size="xs" />
      </div>

      <section class="multiform-intake__section" aria-labelledby="multiform-intake-subject-heading">
        <div class="multiform-intake__section-heading">
          <h4 id="multiform-intake-subject-heading">Zakres odpowiedzi</h4>
          <p>Wybierz osobę albo informacje wspólne dla całej sprawy.</p>
        </div>
        <UTabs
          v-model="activeSubject"
          :items="subjectItems"
          :content="false"
          class="multiform-intake__tabs"
        />
      </section>

      <section
        v-if="activeApplicantAnswers && activeClient"
        :key="activeClient.id"
        class="multiform-intake__section multiform-intake__questions"
        :aria-labelledby="`multiform-intake-${activeClient.id}`"
      >
        <div class="multiform-intake__section-heading multiform-intake__section-heading--inline">
          <div>
            <h4 :id="`multiform-intake-${activeClient.id}`">Dochody i zatrudnienie</h4>
            <p>
              {{ activeClient.display_name }}
              <span v-if="activeApplicantProgress">
                · {{ activeApplicantProgress.completed }} z {{ activeApplicantProgress.total }} odpowiedzi
              </span>
            </p>
          </div>
          <UBadge
            :color="activeApplicantProgress?.complete ? 'success' : 'warning'"
            variant="subtle"
            size="sm"
          >
            {{ activeApplicantProgress?.percentage ?? 0 }}%
          </UBadge>
        </div>

        <UFormField
          name="intakeIncomeSource"
          data-intake-field="incomeSource"
          class="multiform-intake__field multiform-intake__field--choice"
          :label="multiformIntakeLabels.incomeSource"
          description="Wybierz główne źródło. Dodatkowe dochody oznaczysz osobno."
          :error="fieldError('incomeSource')"
          required
        >
          <URadioGroup
            :model-value="activeApplicantAnswers.incomeSource ?? undefined"
            :items="incomeSourceItems"
            value-key="value"
            orientation="horizontal"
            variant="card"
            size="sm"
            class="multiform-intake__choice-grid multiform-intake__choice-grid--wide"
            @update:model-value="updateIncomeSource"
          />
        </UFormField>

        <UFormField
          v-if="activeApplicantAnswers.incomeSource === 'employment'"
          name="intakeEmploymentType"
          data-intake-field="employmentType"
          class="multiform-intake__field multiform-intake__field--choice"
          :label="multiformIntakeLabels.employmentType"
          description="Wskaż rodzaj aktualnej umowy."
          :error="fieldError('employmentType')"
          required
        >
          <URadioGroup
            :model-value="activeApplicantAnswers.employmentType ?? undefined"
            :items="employmentTypeItems"
            value-key="value"
            orientation="horizontal"
            variant="card"
            size="sm"
            class="multiform-intake__choice-grid"
            @update:model-value="updateEmploymentType"
          />
        </UFormField>

        <div class="multiform-intake__question-grid">
          <UFormField
            name="intakeIncomePaidToAccount"
            data-intake-field="incomePaidToAccount"
            class="multiform-intake__binary-field"
            orientation="horizontal"
            :label="multiformIntakeLabels.incomePaidToAccount"
            description="Wpływa na wymaganie wyciągów bankowych."
            :error="fieldError('incomePaidToAccount')"
            required
          >
            <URadioGroup
              :model-value="activeApplicantAnswers.incomePaidToAccount ?? undefined"
              :items="booleanItems"
              value-key="value"
              orientation="horizontal"
              variant="table"
              size="sm"
              class="multiform-intake__choice-grid multiform-intake__choice-grid--boolean"
              @update:model-value="updateBooleanApplicant('incomePaidToAccount', $event)"
            />
          </UFormField>

          <UFormField
            name="intakeAdditionalIncome"
            data-intake-field="additionalIncome"
            class="multiform-intake__binary-field"
            orientation="horizontal"
            :label="multiformIntakeLabels.additionalIncome"
            :error="fieldError('additionalIncome')"
            required
          >
            <URadioGroup
              :model-value="activeApplicantAnswers.additionalIncome ?? undefined"
              :items="booleanItems"
              value-key="value"
              orientation="horizontal"
              variant="table"
              size="sm"
              class="multiform-intake__choice-grid multiform-intake__choice-grid--boolean"
              @update:model-value="updateBooleanApplicant('additionalIncome', $event)"
            />
          </UFormField>

          <UFormField
            name="intakeLiabilities"
            data-intake-field="liabilities"
            class="multiform-intake__binary-field"
            orientation="horizontal"
            :label="multiformIntakeLabels.liabilities"
            :error="fieldError('liabilities')"
            required
          >
            <URadioGroup
              :model-value="activeApplicantAnswers.liabilities ?? undefined"
              :items="booleanItems"
              value-key="value"
              orientation="horizontal"
              variant="table"
              size="sm"
              class="multiform-intake__choice-grid multiform-intake__choice-grid--boolean"
              @update:model-value="updateBooleanApplicant('liabilities', $event)"
            />
          </UFormField>
        </div>
      </section>

      <section
        v-else
        class="multiform-intake__section multiform-intake__questions"
        aria-labelledby="multiform-intake-case-heading"
      >
        <div class="multiform-intake__section-heading">
          <h4 id="multiform-intake-case-heading">Nieruchomość i przebieg transakcji</h4>
          <p>
            {{ selectedProperty
              ? [selectedProperty.address, selectedProperty.city].filter(Boolean).join(', ')
              : 'Informacje wspólne dla wszystkich banków.' }}
          </p>
        </div>

        <UFormField
          name="intakeLoanProgram"
          data-intake-field="loanProgram"
          class="multiform-intake__field multiform-intake__field--choice"
          :label="multiformIntakeLabels.loanProgram"
          description="Wybór steruje dokumentami RKM dołączanymi do kompletu Erste."
          :error="fieldError('loanProgram')"
          required
        >
          <URadioGroup
            :model-value="normalizedAnswers.case.loanProgram ?? undefined"
            :items="loanProgramItems"
            value-key="value"
            orientation="horizontal"
            variant="card"
            size="sm"
            class="multiform-intake__choice-grid multiform-intake__choice-grid--wide"
            @update:model-value="updateLoanProgram"
          />
        </UFormField>

        <UFormField
          v-if="normalizedAnswers.case.loanProgram === 'rkm'"
          name="intakeRkmGuarantee"
          data-intake-field="rkmGuarantee"
          class="multiform-intake__binary-field"
          orientation="horizontal"
          :label="multiformIntakeLabels.rkmGuarantee"
          :error="fieldError('rkmGuarantee')"
          required
        >
          <URadioGroup
            :model-value="normalizedAnswers.case.rkmGuarantee ?? undefined"
            :items="booleanItems"
            value-key="value"
            orientation="horizontal"
            variant="table"
            size="sm"
            class="multiform-intake__choice-grid multiform-intake__choice-grid--boolean"
            @update:model-value="updateBooleanCase('rkmGuarantee', $event)"
          />
        </UFormField>

        <UFormField
          name="intakeLoanPurpose"
          data-intake-field="loanPurpose"
          class="multiform-intake__field multiform-intake__field--choice"
          :label="multiformIntakeLabels.loanPurpose"
          description="Wybierz główny cel finansowania."
          :error="fieldError('loanPurpose')"
          required
        >
          <URadioGroup
            :model-value="normalizedAnswers.case.loanPurpose ?? undefined"
            :items="loanPurposeItems"
            value-key="value"
            orientation="horizontal"
            variant="card"
            size="sm"
            class="multiform-intake__choice-grid multiform-intake__choice-grid--wide"
            @update:model-value="updateLoanPurpose"
          />
        </UFormField>

        <div class="multiform-intake__question-grid">
          <UFormField
            v-for="field in ([
              'preliminaryAgreement',
              'landRegister',
              'appraisalAvailable',
              'trancheDisbursement',
            ] as const)"
            :key="field"
            :name="`intake-${field}`"
            :data-intake-field="field"
            class="multiform-intake__binary-field"
            orientation="horizontal"
            :label="multiformIntakeLabels[field]"
            :error="fieldError(field)"
            required
          >
            <URadioGroup
              :model-value="normalizedAnswers.case[field] ?? undefined"
              :items="booleanItems"
              value-key="value"
              orientation="horizontal"
              variant="table"
              size="sm"
              class="multiform-intake__choice-grid multiform-intake__choice-grid--boolean"
              @update:model-value="updateBooleanCase(field, $event)"
            />
          </UFormField>
        </div>
      </section>
    </div>

    <aside class="multiform-intake__preview" aria-live="polite">
      <div class="multiform-intake__preview-heading">
        <div>
          <span>Powstająca checklista</span>
          <strong>{{ previewRequirements.length }}</strong>
          <p>wymaganych dokumentów</p>
        </div>
        <UBadge color="warning" variant="subtle" size="xs">Na żywo</UBadge>
      </div>

      <div class="multiform-intake__preview-section">
        <span>Podział dokumentów</span>
        <ul>
          <li v-for="client in caseData.clients" :key="client.id">
            <span><UIcon name="i-lucide-user-round" /> {{ client.display_name }}</span>
            <strong>{{ requirementCountByOwner.get(client.id) ?? 0 }}</strong>
          </li>
          <li>
            <span><UIcon name="i-lucide-users-round" /> Wspólne dla sprawy</span>
            <strong>{{ requirementCountByOwner.get(caseSubject) ?? 0 }}</strong>
          </li>
        </ul>
      </div>

      <div class="multiform-intake__preview-section">
        <span>Dla banków</span>
        <div class="multiform-intake__banks">
          <UBadge v-for="bankName in bankNames" :key="bankName" color="neutral" variant="outline">
            {{ bankName }}
          </UBadge>
        </div>
        <p>Jeden dokument może spełniać wymaganie obu banków.</p>
      </div>

      <UAlert
        v-if="unresolvedRequirementCount"
        color="neutral"
        variant="subtle"
        icon="i-lucide-info"
        :description="`${unresolvedRequirementCount} pozycji zostanie rozstrzygniętych po uzupełnieniu wszystkich odpowiedzi.`"
      />

      <div class="multiform-intake__save-state">
        <UIcon :name="saving ? 'i-lucide-loader-circle' : 'i-lucide-cloud-check'" :class="{ 'is-spinning': saving }" />
        <span>
          {{ saving ? 'Zapisuję odpowiedzi…' : savedAt ? `Zapisano o ${formatSavedAt(savedAt)}` : 'Zapis automatyczny' }}
        </span>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.multiform-intake {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 290px;
}

.multiform-intake__main {
  container-type: inline-size;
  min-width: 0;
  padding: 28px 30px 34px;
}

.multiform-intake__heading {
  display: grid;
  gap: 6px;
  margin-bottom: 20px;
}

.multiform-intake__heading p,
.multiform-intake__heading h3,
.multiform-intake__heading span,
.multiform-intake__section-heading h4,
.multiform-intake__section-heading p,
.multiform-intake__status p,
.multiform-intake__status small,
.multiform-intake__preview-heading p,
.multiform-intake__preview-section p {
  margin: 0;
}

.multiform-intake__heading > p,
.multiform-intake__preview-section > span {
  color: var(--ui-primary);
  font-size: 10px;
  font-weight: 750;
  letter-spacing: .075em;
  text-transform: uppercase;
}

.multiform-intake__heading h3 {
  color: var(--ui-text-highlighted);
  font-size: 23px;
  line-height: 1.2;
}

.multiform-intake__heading > span {
  max-width: 680px;
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.6;
}

.multiform-intake__status {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 8px 12px;
  padding: 11px 13px;
  border: 1px solid var(--ui-border-accented);
  border-radius: 11px;
  background: color-mix(in srgb, var(--ui-primary) 4%, var(--ui-bg));
}

.multiform-intake__status > span {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  color: var(--ui-primary);
}

.multiform-intake__status p {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  color: var(--ui-text-toned);
  font-size: 11px;
}

.multiform-intake__status strong {
  color: var(--ui-text-highlighted);
}

.multiform-intake__status :deep([data-slot="root"]) {
  grid-column: 2;
}

.multiform-intake__section {
  display: grid;
  gap: 14px;
  padding-top: 18px;
}

.multiform-intake__section + .multiform-intake__section {
  margin-top: 12px;
  border-top: 1px solid var(--ui-border-muted);
}

.multiform-intake__section-heading {
  display: grid;
  gap: 2px;
}

.multiform-intake__section-heading--inline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.multiform-intake__section-heading h4 {
  color: var(--ui-text-highlighted);
  font-size: 16px;
  font-weight: 650;
  line-height: 1.3;
}

.multiform-intake__section-heading p {
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.45;
}

.multiform-intake__tabs {
  max-width: 100%;
}

.multiform-intake__tabs :deep([data-slot="list"]) {
  overflow-x: auto;
  scrollbar-width: none;
}

.multiform-intake__tabs :deep([data-slot="list"]::-webkit-scrollbar) {
  display: none;
}

.multiform-intake__tabs :deep([data-slot="trigger"]) {
  flex: 1 0 max-content;
  min-width: 150px;
  white-space: nowrap;
}

.multiform-intake__questions {
  gap: 0;
  padding: 18px 20px 20px;
  border: 1px solid var(--ui-border-muted);
  border-radius: 16px;
  background: color-mix(in srgb, var(--ui-bg-muted) 45%, var(--ui-bg));
}

.multiform-intake__questions.multiform-intake__section {
  margin-top: 18px;
}

.multiform-intake__questions > .multiform-intake__section-heading {
  padding-bottom: 15px;
}

.multiform-intake__field--choice {
  padding: 16px 0;
  border-top: 1px solid var(--ui-border-muted);
}

.multiform-intake__field :deep([data-slot="label"]),
.multiform-intake__binary-field :deep([data-slot="label"]) {
  color: var(--ui-text-highlighted);
  font-size: 12px;
  font-weight: 650;
  line-height: 1.4;
}

.multiform-intake__field :deep([data-slot="description"]),
.multiform-intake__binary-field :deep([data-slot="description"]) {
  margin-top: 2px;
  color: var(--ui-text-muted);
  font-size: 10px;
  line-height: 1.45;
}

.multiform-intake__question-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0;
  border-top: 1px solid var(--ui-border-muted);
}

.multiform-intake__binary-field {
  display: flex;
  align-items: center;
  gap: 24px;
  min-width: 0;
  padding: 13px 0;
  border-bottom: 1px solid var(--ui-border-muted);
}

.multiform-intake__binary-field:last-child {
  border-bottom: 0;
}

.multiform-intake__binary-field > :deep([data-slot="wrapper"]) {
  flex: 1 1 auto;
  min-width: 0;
}

.multiform-intake__binary-field > :deep(.relative) {
  flex: 0 0 190px;
  width: 190px;
  margin-top: 0;
}

.multiform-intake__choice-grid {
  min-width: 0;
}

.multiform-intake__choice-grid :deep(fieldset) {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(145px, 1fr));
  gap: 8px;
}

.multiform-intake__choice-grid--wide :deep(fieldset) {
  grid-template-columns: repeat(auto-fit, minmax(172px, 1fr));
}

.multiform-intake__choice-grid--boolean :deep(fieldset) {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0;
}

.multiform-intake__choice-grid :deep([data-slot="item"]) {
  min-height: 46px;
  align-items: center;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--ui-bg);
  box-shadow: 0 1px 1px color-mix(in srgb, var(--ui-text) 4%, transparent);
  transition:
    border-color 140ms ease,
    background-color 140ms ease,
    box-shadow 140ms ease;
}

.multiform-intake__choice-grid :deep([data-slot="item"]:hover) {
  border-color: var(--ui-border-accented);
  background: var(--ui-bg-elevated);
}

.multiform-intake__choice-grid :deep([data-slot="item"]:has([data-state="checked"])) {
  border-color: var(--ui-border-inverted);
  background: var(--ui-bg-elevated);
  box-shadow:
    inset 3px 0 0 var(--ui-bg-inverted),
    0 1px 2px color-mix(in srgb, var(--ui-text) 8%, transparent);
}

.multiform-intake__choice-grid :deep([data-slot="label"]) {
  text-wrap: balance;
  line-height: 1.25;
}

.multiform-intake__choice-grid--boolean :deep([data-slot="item"]) {
  min-height: 38px;
  padding: 9px 12px;
  border-radius: 0;
  box-shadow: none;
}

.multiform-intake__choice-grid--boolean :deep([data-slot="item"]:first-of-type) {
  border-radius: 9px 0 0 9px;
}

.multiform-intake__choice-grid--boolean :deep([data-slot="item"]:last-of-type) {
  border-radius: 0 9px 9px 0;
}

.multiform-intake__choice-grid--boolean :deep([data-slot="item"]:has([data-state="checked"])) {
  z-index: 1;
  background: var(--ui-bg-accented);
  box-shadow: inset 0 0 0 1px var(--ui-border-inverted);
}

.multiform-intake__preview {
  display: flex;
  flex-direction: column;
  gap: 24px;
  min-width: 0;
  padding: 28px 24px;
  border-left: 1px solid var(--ui-border);
  background: color-mix(in srgb, var(--ui-bg-muted) 62%, var(--ui-bg));
}

.multiform-intake__preview-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.multiform-intake__preview-heading > div {
  display: grid;
  gap: 2px;
}

.multiform-intake__preview-heading span {
  color: var(--ui-text-highlighted);
  font-size: 12px;
  font-weight: 700;
}

.multiform-intake__preview-heading strong {
  margin-top: 8px;
  color: var(--ui-text-highlighted);
  font-size: 26px;
  line-height: 1;
}

.multiform-intake__preview-heading p,
.multiform-intake__preview-section p {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.multiform-intake__preview-section {
  display: grid;
  gap: 10px;
  padding-top: 20px;
  border-top: 1px solid var(--ui-border);
}

.multiform-intake__preview-section ul {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.multiform-intake__preview-section li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--ui-border-muted);
  color: var(--ui-text-toned);
  font-size: 11px;
}

.multiform-intake__preview-section li span {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.multiform-intake__banks {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.multiform-intake__save-state {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: auto;
  color: var(--ui-text-muted);
  font-size: 10px;
}

.is-spinning {
  animation: multiform-intake-spin .9s linear infinite;
}

@keyframes multiform-intake-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 980px) {
  .multiform-intake {
    grid-template-columns: 1fr;
  }

  .multiform-intake__preview {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 18px;
    border-top: 1px solid var(--ui-border);
    border-left: 0;
  }

  .multiform-intake__preview-heading,
  .multiform-intake__save-state {
    grid-column: 1 / -1;
  }

  .multiform-intake__save-state {
    margin-top: 0;
  }
}

@media (max-width: 720px) {
  .multiform-intake__main,
  .multiform-intake__preview {
    padding: 20px 16px;
  }

  .multiform-intake__questions {
    padding: 16px;
  }

  .multiform-intake__choice-grid :deep(fieldset),
  .multiform-intake__choice-grid--wide :deep(fieldset) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .multiform-intake__binary-field {
    align-items: flex-start;
    gap: 16px;
  }

  .multiform-intake__binary-field > :deep(.relative) {
    flex-basis: 170px;
    width: 170px;
  }

  .multiform-intake__preview {
    grid-template-columns: 1fr;
  }

  .multiform-intake__preview-heading,
  .multiform-intake__save-state {
    grid-column: auto;
  }
}

@media (max-width: 500px) {
  .multiform-intake__choice-grid :deep(fieldset),
  .multiform-intake__choice-grid--wide :deep(fieldset) {
    grid-template-columns: 1fr;
  }

  .multiform-intake__binary-field {
    display: grid;
    gap: 9px;
  }

  .multiform-intake__binary-field > :deep(.relative) {
    width: 100%;
  }
}
</style>
