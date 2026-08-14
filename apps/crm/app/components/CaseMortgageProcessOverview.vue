<script setup lang="ts">
import type {
  CaseBankApplication,
  CaseDetail,
  MortgageNextAction,
  MortgageNextActionKind,
  MortgageNextActionSeverity,
  MortgageProcessStepKey,
} from '~/types/cases'
import {
  mortgageActionDeadline,
  mortgageActionLabel,
  resolveCaseMortgageNextAction,
  resolveMortgageApplicationNextAction,
  resolveMortgageProcessSteps,
  type MortgageProcessStepPresentation,
} from '~/utils/mortgage-case-process'

const props = defineProps<{
  caseData: CaseDetail
}>()

const emit = defineEmits<{
  openAction: [payload: { applicationId: string | null, kind: MortgageNextActionKind }]
}>()

const dateFormatter = new Intl.DateTimeFormat('pl-PL', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Europe/Warsaw',
})

const nextAction = computed(() => resolveCaseMortgageNextAction(props.caseData))
const bankRows = computed(() => (
  [...props.caseData.bank_applications]
    .sort((left, right) => left.slot - right.slot)
    .map(application => ({
      application,
      offer: props.caseData.offers.find(offer => offer.id === application.offer_id) ?? null,
      action: resolveMortgageApplicationNextAction(application, props.caseData.offers),
      steps: resolveMortgageProcessSteps(
        application,
        application.id === props.caseData.contract_application_id,
      ),
    }))
))

const severityPresentation: Record<MortgageNextActionSeverity, {
  color: 'error' | 'warning' | 'primary' | 'neutral'
  icon: string
}> = {
  critical: { color: 'error', icon: 'i-lucide-circle-alert' },
  warning: { color: 'warning', icon: 'i-lucide-clock-alert' },
  normal: { color: 'primary', icon: 'i-lucide-list-checks' },
  waiting: { color: 'neutral', icon: 'i-lucide-hourglass' },
}

const responsibilityLabel = computed(() => {
  if (nextAction.value.responsibility === 'client') return 'Czeka na klienta'
  if (nextAction.value.responsibility === 'bank') return 'Czeka na bank'
  return nextAction.value.overdue ? 'Termin przekroczony' : 'Teraz Ty'
})

const deadlineLabel = computed(() => {
  const deadline = mortgageActionDeadline(nextAction.value)
  if (!deadline) return null
  const label = dateFormatter.format(new Date(deadline))
  return nextAction.value.overdue ? `Po terminie · ${label}` : `Termin · ${label}`
})

function openAction(action: MortgageNextAction) {
  emit('openAction', {
    applicationId: action.application_id ?? null,
    kind: action.kind,
  })
}

function processStage(application: CaseBankApplication) {
  return application.mortgage_process?.stage ?? null
}

function canRegisterMissingInformation(application: CaseBankApplication) {
  return ['submitted', 'awaiting_completeness', 'under_review'].includes(processStage(application) ?? '')
}

function canRecordEarlyDecisionConsent(application: CaseBankApplication) {
  const dueAt = application.mortgage_process?.decision_due_at
  return ['under_review', 'decision_received'].includes(processStage(application) ?? '')
    && typeof dueAt === 'string'
    && Date.parse(dueAt) > Date.now()
}

function canCloseApplication(application: CaseBankApplication) {
  const stage = processStage(application)
  return stage !== null
    && !['completed', 'closed'].includes(stage)
    && application.id !== props.caseData.contract_application_id
}

function emitStepAction(application: CaseBankApplication, step: MortgageProcessStepPresentation) {
  const kind = stepActionKind(application, step)
  if (kind) emit('openAction', { applicationId: application.id, kind })
}

function stepActionKind(
  application: CaseBankApplication,
  step: MortgageProcessStepPresentation,
): MortgageNextActionKind | null {
  if (step.actionKind) {
    if (step.key === 'agreement'
      && step.actionKind === 'review-agreement'
      && processStage(application) !== 'ready_for_contract') {
      const action = resolveMortgageApplicationNextAction(application, props.caseData.offers)
      if (actionBelongsToStep(action.kind, step.key)) return action.kind
    }
    return step.actionKind
  }
  if (!['attention', 'current', 'unknown'].includes(step.status)) return null
  const applicationAction = resolveMortgageApplicationNextAction(application, props.caseData.offers)
  if (actionBelongsToStep(applicationAction.kind, step.key)) return applicationAction.kind
  if (step.key === 'esis') return 'upload-esis'
  if (step.key === 'application') return 'submit-application'
  if (step.key === 'completeness') return application.status_code === 'braki' ? 'resume-review' : 'confirm-completeness'
  if (step.key === 'decision') return application.decision_at ? 'deliver-decision' : 'wait-bank'
  if (step.key === 'agreement') return 'review-agreement'
  return null
}

function actionBelongsToStep(kind: MortgageNextActionKind, step: MortgageProcessStepKey) {
  const mapping: Record<MortgageProcessStepKey, MortgageNextActionKind[]> = {
    esis: ['upload-esis', 'deliver-esis'],
    application: ['submit-application'],
    completeness: ['confirm-completeness', 'open-documents', 'resume-review'],
    decision: ['upload-decision', 'deliver-decision', 'review-offer', 'wait-bank'],
    agreement: ['upload-agreement', 'deliver-agreement', 'review-agreement', 'complete-application'],
  }
  return mapping[step].includes(kind)
}

function stepIcon(step: MortgageProcessStepPresentation) {
  if (step.status === 'complete') return 'i-lucide-check'
  if (step.status === 'attention') return 'i-lucide-triangle-alert'
  if (step.status === 'unknown') return 'i-lucide-circle-help'
  if (step.status === 'skipped') return 'i-lucide-minus'
  return null
}
</script>

<template>
  <section class="mortgage-next" aria-labelledby="mortgage-next-title">
    <div
      class="mortgage-next__hero"
      :class="`mortgage-next__hero--${nextAction.severity}`"
      aria-live="polite"
    >
      <span class="mortgage-next__hero-icon" aria-hidden="true">
        <UIcon :name="severityPresentation[nextAction.severity].icon" />
      </span>

      <div class="mortgage-next__copy">
        <div class="mortgage-next__meta">
          <span>{{ responsibilityLabel }}</span>
          <span v-if="nextAction.bank_name">{{ nextAction.bank_name }}</span>
          <span v-if="deadlineLabel" :class="{ 'mortgage-next__deadline--overdue': nextAction.overdue }">
            {{ deadlineLabel }}
          </span>
        </div>
        <h2 id="mortgage-next-title">{{ nextAction.title }}</h2>
        <p>{{ nextAction.description || 'Otwórz krok, aby kontynuować obsługę sprawy.' }}</p>
      </div>

      <UButton
        class="mortgage-next__cta"
        :color="severityPresentation[nextAction.severity].color"
        :variant="nextAction.severity === 'waiting' ? 'outline' : 'solid'"
        size="lg"
        trailing-icon="i-lucide-arrow-right"
        @click="openAction(nextAction)"
      >
        {{ mortgageActionLabel(nextAction.kind) }}
      </UButton>
    </div>

    <div v-if="bankRows.length" class="mortgage-paths">
      <header class="mortgage-paths__heading">
        <div>
          <h2>Ścieżki bankowe</h2>
          <p>ESIS, kompletność i decyzja są kontrolowane osobno dla każdego banku.</p>
        </div>
        <UBadge color="neutral" variant="subtle" size="sm">
          {{ bankRows.length }}/3 {{ bankRows.length === 1 ? 'bank' : 'banki' }}
        </UBadge>
      </header>

      <div class="mortgage-paths__list">
        <article
          v-for="row in bankRows"
          :key="row.application.id"
          class="mortgage-path"
          :class="{
            'mortgage-path--attention': ['critical', 'warning'].includes(row.action.severity),
            'mortgage-path--contract': row.application.id === caseData.contract_application_id,
          }"
          :data-application-id="row.application.id"
        >
          <header class="mortgage-path__bank">
            <span
              class="mortgage-path__logo"
              :style="row.offer?.bank_logo_background ? { backgroundColor: row.offer.bank_logo_background } : undefined"
            >
              <img
                v-if="row.offer?.bank_logo_url"
                :src="row.offer.bank_logo_url"
                :alt="`Logo ${row.offer.bank_name}`"
              >
              <UIcon v-else name="i-lucide-landmark" aria-hidden="true" />
            </span>
            <span class="mortgage-path__identity">
              <small>Wniosek {{ row.application.slot }}/3</small>
              <strong>{{ row.offer?.bank_name ?? row.action.bank_name ?? 'Bank' }}</strong>
            </span>
            <UBadge
              v-if="row.application.id === caseData.contract_application_id"
              class="mortgage-path__badge"
              color="success"
              variant="subtle"
              icon="i-lucide-file-signature"
              size="xs"
            >
              Podpisana umowa
            </UBadge>
            <UBadge
              v-else-if="row.action.responsibility === 'expert'"
              class="mortgage-path__badge"
              :color="severityPresentation[row.action.severity].color"
              variant="subtle"
              size="xs"
            >
              Wymaga działania
            </UBadge>
            <UBadge v-else class="mortgage-path__badge" color="neutral" variant="subtle" size="xs">
              Czeka na {{ row.action.responsibility === 'client' ? 'klienta' : 'bank' }}
            </UBadge>
            <div
              v-if="canRegisterMissingInformation(row.application) || processStage(row.application) === 'additional_information_requested' || canRecordEarlyDecisionConsent(row.application) || canCloseApplication(row.application)"
              class="mortgage-path__tools"
            >
              <UButton
                v-if="processStage(row.application) === 'additional_information_requested'"
                color="neutral"
                variant="link"
                size="xs"
                icon="i-lucide-rotate-cw"
                @click="emit('openAction', { applicationId: row.application.id, kind: 'resume-review' })"
              >
                Braki uzupełnione
              </UButton>
              <UButton
                v-else-if="canRegisterMissingInformation(row.application)"
                color="neutral"
                variant="link"
                size="xs"
                icon="i-lucide-file-warning"
                @click="emit('openAction', { applicationId: row.application.id, kind: 'open-documents' })"
              >
                Bank zgłosił braki
              </UButton>
              <UButton
                v-if="canRecordEarlyDecisionConsent(row.application)"
                color="neutral"
                variant="link"
                size="xs"
                icon="i-lucide-signature"
                @click="emit('openAction', { applicationId: row.application.id, kind: 'record-early-consent' })"
              >
                Decyzje klientów o wcześniejszym terminie
              </UButton>
              <UButton
                v-if="canCloseApplication(row.application)"
                color="error"
                variant="link"
                size="xs"
                icon="i-lucide-circle-minus"
                @click="emit('openAction', { applicationId: row.application.id, kind: 'close-application' })"
              >
                Wycofaj wniosek
              </UButton>
            </div>
          </header>

          <ol class="mortgage-path__steps" :aria-label="`Przebieg wniosku w ${row.offer?.bank_name ?? 'banku'}`">
            <li
              v-for="step in row.steps"
              :key="step.key"
              :class="`mortgage-step--${step.status}`"
            >
              <button
                v-if="stepActionKind(row.application, step)"
                type="button"
                :aria-label="`${step.label}: ${step.statusLabel}. ${step.detail}`"
                @click="emitStepAction(row.application, step)"
              >
                <span class="mortgage-step__point" aria-hidden="true">
                  <UIcon v-if="stepIcon(step)" :name="stepIcon(step)!" />
                </span>
                <span class="mortgage-step__copy">
                  <strong>{{ step.label }}</strong>
                  <small>{{ step.detail }}</small>
                </span>
              </button>
              <div v-else>
                <span class="mortgage-step__point" aria-hidden="true">
                  <UIcon v-if="stepIcon(step)" :name="stepIcon(step)!" />
                </span>
                <span class="mortgage-step__copy">
                  <strong>{{ step.label }}</strong>
                  <small>{{ step.detail }}</small>
                </span>
                <span class="sr-only">{{ step.statusLabel }}</span>
              </div>
            </li>
          </ol>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.mortgage-next {
  display: grid;
  gap: 12px;
}

.mortgage-next__hero {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  min-height: 128px;
  padding: 22px;
  border: 1px solid color-mix(in srgb, var(--ui-primary) 34%, var(--ui-border));
  border-radius: var(--oe-radius-emphasis);
  background: linear-gradient(120deg, color-mix(in srgb, var(--ui-primary) 8%, var(--ui-bg)) 0%, var(--ui-bg) 72%);
  box-shadow: 0 8px 26px color-mix(in srgb, var(--ui-text-highlighted) 5%, transparent);
}

.mortgage-next__hero--critical {
  border-color: color-mix(in srgb, var(--ui-error) 52%, var(--ui-border));
  background: linear-gradient(120deg, color-mix(in srgb, var(--ui-error) 9%, var(--ui-bg)) 0%, var(--ui-bg) 72%);
}

.mortgage-next__hero--warning {
  border-color: color-mix(in srgb, var(--ui-warning) 52%, var(--ui-border));
  background: linear-gradient(120deg, color-mix(in srgb, var(--ui-warning) 9%, var(--ui-bg)) 0%, var(--ui-bg) 72%);
}

.mortgage-next__hero--waiting {
  border-color: var(--ui-border);
  background: var(--ui-bg);
}

.mortgage-next__hero-icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--ui-primary) 13%, var(--ui-bg));
  color: var(--ui-primary);
  font-size: 24px;
}

.mortgage-next__hero--critical .mortgage-next__hero-icon { background: color-mix(in srgb, var(--ui-error) 13%, var(--ui-bg)); color: var(--ui-error); }
.mortgage-next__hero--warning .mortgage-next__hero-icon { background: color-mix(in srgb, var(--ui-warning) 13%, var(--ui-bg)); color: var(--ui-warning); }
.mortgage-next__hero--waiting .mortgage-next__hero-icon { background: var(--ui-bg-muted); color: var(--ui-text-toned); }

.mortgage-next__copy { display: grid; gap: 5px; min-width: 0; }
.mortgage-next__copy h2 { margin: 0; color: var(--ui-text-highlighted); font-size: clamp(18px, 2vw, 23px); font-weight: 700; letter-spacing: -.02em; }
.mortgage-next__copy p { max-width: 780px; margin: 0; color: var(--ui-text-muted); font-size: 13px; line-height: 1.5; }

.mortgage-next__meta { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; color: var(--ui-text-toned); font-size: 10px; font-weight: 750; letter-spacing: .07em; text-transform: uppercase; }
.mortgage-next__meta span + span::before { margin-right: 7px; color: var(--ui-border-accented); content: '•'; }
.mortgage-next__deadline--overdue { color: var(--ui-error); }
.mortgage-next__cta { justify-self: end; }

.mortgage-paths {
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background: var(--ui-bg);
}

.mortgage-paths__heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 15px 18px; border-bottom: 1px solid var(--ui-border); }
.mortgage-paths__heading > div { display: grid; gap: 2px; }
.mortgage-paths__heading h2 { margin: 0; color: var(--ui-text-highlighted); font-size: 14px; font-weight: 680; }
.mortgage-paths__heading p { margin: 0; color: var(--ui-text-muted); font-size: 11px; }
.mortgage-paths__list { display: grid; }

.mortgage-path {
  display: grid;
  grid-template-columns: minmax(165px, .65fr) minmax(500px, 2fr);
  align-items: center;
  min-width: 0;
  padding: 12px 16px;
  box-shadow: inset 3px 0 transparent;
}

.mortgage-path + .mortgage-path { border-top: 1px solid var(--ui-border); }
.mortgage-path--attention { box-shadow: inset 3px 0 var(--ui-warning); }
.mortgage-path--contract { background: color-mix(in srgb, var(--ui-success) 4%, var(--ui-bg)); box-shadow: inset 3px 0 var(--ui-success); }

.mortgage-path__bank { display: grid; grid-template-columns: 36px minmax(0, 1fr); align-items: center; gap: 9px; min-width: 0; padding-right: 18px; }
.mortgage-path__badge { grid-column: 1 / -1; justify-self: start; }
.mortgage-path__tools { display: flex; grid-column: 1 / -1; flex-wrap: wrap; align-items: center; gap: 1px 5px; margin: -2px 0 0 -8px; }
.mortgage-path__tools :deep(button) { min-height: 22px; padding-block: 1px; font-size: 9px; }
.mortgage-path__logo { display: grid; place-items: center; width: 36px; height: 36px; overflow: hidden; border: 1px solid var(--ui-border); border-radius: 9px; background: #fff; color: var(--ui-text-muted); }
.mortgage-path__logo img { width: 100%; height: 100%; padding: 4px; object-fit: contain; }
.mortgage-path__identity { display: grid; gap: 1px; min-width: 0; }
.mortgage-path__identity small { color: var(--ui-text-muted); font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; }
.mortgage-path__identity strong { overflow: hidden; color: var(--ui-text-highlighted); font-size: 12px; font-weight: 680; text-overflow: ellipsis; white-space: nowrap; }

.mortgage-path__steps { display: grid; grid-template-columns: repeat(5, minmax(92px, 1fr)); margin: 0; padding: 0; list-style: none; }
.mortgage-path__steps li { position: relative; min-width: 0; }
.mortgage-path__steps li::before { position: absolute; top: 14px; right: 50%; left: -50%; height: 2px; background: var(--ui-border); content: ''; }
.mortgage-path__steps li:first-child::before { display: none; }
.mortgage-path__steps li:has(.mortgage-step__point) { --step-color: var(--ui-border-accented); }
.mortgage-path__steps li.mortgage-step--complete { --step-color: var(--ui-success); }
.mortgage-path__steps li.mortgage-step--current { --step-color: var(--ui-primary); }
.mortgage-path__steps li.mortgage-step--attention { --step-color: var(--ui-warning); }
.mortgage-path__steps li.mortgage-step--unknown { --step-color: var(--ui-text-toned); }
.mortgage-path__steps li.mortgage-step--complete::before,
.mortgage-path__steps li.mortgage-step--current::before,
.mortgage-path__steps li.mortgage-step--attention::before { background: var(--step-color); }

.mortgage-path__steps button,
.mortgage-path__steps li > div { position: relative; z-index: 1; display: grid; justify-items: center; gap: 5px; width: 100%; padding: 0 5px; border: 0; background: transparent; color: inherit; text-align: center; }
.mortgage-path__steps button { border-radius: 8px; cursor: pointer; }
.mortgage-path__steps button:hover,
.mortgage-path__steps button:focus-visible { background: var(--ui-bg-muted); outline: 2px solid color-mix(in srgb, var(--ui-primary) 45%, transparent); outline-offset: 2px; }
.mortgage-step__point { display: grid; place-items: center; width: 29px; height: 29px; border: 2px solid var(--step-color); border-radius: 999px; background: var(--ui-bg); color: var(--step-color); font-size: 13px; }
.mortgage-step--current .mortgage-step__point,
.mortgage-step--attention .mortgage-step__point { background: var(--step-color); color: var(--ui-text-inverted); }
.mortgage-step__copy { display: grid; gap: 1px; min-width: 0; }
.mortgage-step__copy strong { color: var(--ui-text-highlighted); font-size: 10px; font-weight: 650; }
.mortgage-step__copy small { overflow: hidden; color: var(--ui-text-muted); font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }

@media (max-width: 980px) {
  .mortgage-path { grid-template-columns: 1fr; gap: 13px; }
  .mortgage-path__bank { grid-template-columns: 36px minmax(0, 1fr) auto; padding-right: 0; }
  .mortgage-path__badge { grid-column: 3; grid-row: 1; }
}

@media (max-width: 680px) {
  .mortgage-next__hero { grid-template-columns: 42px minmax(0, 1fr); align-items: start; min-height: 0; padding: 17px; }
  .mortgage-next__hero-icon { width: 42px; height: 42px; border-radius: 12px; font-size: 21px; }
  .mortgage-next__cta { grid-column: 1 / -1; width: 100%; justify-content: center; }
  .mortgage-next__meta { gap: 4px; }
  .mortgage-next__meta span + span::before { margin-right: 4px; }
  .mortgage-paths__heading { align-items: flex-start; }
  .mortgage-paths__heading p { display: none; }
  .mortgage-path { padding: 14px 12px; }
  .mortgage-path__bank { grid-template-columns: 36px minmax(0, 1fr); }
  .mortgage-path__badge { grid-column: 1 / -1; grid-row: auto; }
  .mortgage-path__steps { overflow-x: auto; grid-template-columns: repeat(5, minmax(88px, 1fr)); padding: 2px 0 8px; }
}
</style>
