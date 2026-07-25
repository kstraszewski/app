<script setup lang="ts">
import type {
  CrmMeetingClientSignal,
  CrmMeetingMortgageOffer,
  CrmMeetingProcessStep,
} from '../types/crm-meeting.ts'

const {
  state,
  mortgageProcessArtifact,
  minimizeMeeting,
  expandMeeting,
  showMortgageProcess,
} = useCrmMeetingPrototype()
const route = useRoute()
const { orgPath } = useOrganizationContext()
const meetingPagePath = computed(() => (
  state.value.appointmentId
    ? orgPath(`/meetings/${state.value.appointmentId}`)
    : orgPath('/meetings')
))
const isMeetingPage = computed(() => route.path.startsWith(`${orgPath('/meetings')}/`))

const now = ref(Date.now())
let elapsedTimer: ReturnType<typeof setInterval> | null = null

const activeProcessStep = computed<CrmMeetingProcessStep>(() => (
  mortgageProcessArtifact.steps.find(step => step.id === state.value.activeProcessStepId)
  ?? mortgageProcessArtifact.steps[0]!
))
const activeComparison = computed(() => state.value.mortgageComparison)
const selectedOffer = computed<CrmMeetingMortgageOffer | null>(() => (
  activeComparison.value?.offers.find(offer => offer.id === state.value.selectedOfferId)
  ?? activeComparison.value?.offers[0]
  ?? null
))
const activeArtifactTitle = computed(() => (
  state.value.activeArtifactKind === 'mortgage-comparison' && activeComparison.value
    ? activeComparison.value.title
    : mortgageProcessArtifact.title
))
const elapsedLabel = computed(() => {
  if (!state.value.startedAt) return '00:00'
  const elapsedSeconds = Math.max(
    0,
    Math.floor((now.value - new Date(state.value.startedAt).valueOf()) / 1_000),
  )
  const minutes = Math.floor(elapsedSeconds / 60)
  const seconds = elapsedSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
})
const clientSignalCopy = computed(() => {
  const copy: Record<CrmMeetingClientSignal, string> = {
    none: 'Klient nie wybrał jeszcze reakcji.',
    question: 'Klient prosi o dodatkowe wyjaśnienie.',
    understood: 'Klient oznaczył ten fragment jako zrozumiały.',
    'offer-selected': selectedOffer.value
      ? `Klient chce omówić: ${selectedOffer.value.bankName}.`
      : 'Klient wskazał ofertę do omówienia.',
  }
  return copy[state.value.clientSignal]
})

const currency = new Intl.NumberFormat('pl-PL', {
  style: 'currency',
  currency: 'PLN',
  maximumFractionDigits: 0,
})
const percent = new Intl.NumberFormat('pl-PL', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function selectProcessStep(stepId: string) {
  state.value = {
    ...state.value,
    activeProcessStepId: stepId,
    clientSignal: 'none',
  }
}

function showMortgageComparison() {
  if (!state.value.mortgageComparison) return
  state.value = {
    ...state.value,
    activeArtifactKind: 'mortgage-comparison',
    clientSignal: 'none',
  }
}

function setClientSignal(signal: CrmMeetingClientSignal) {
  state.value = { ...state.value, clientSignal: signal }
}

function selectOffer(offerId: string) {
  state.value = {
    ...state.value,
    selectedOfferId: offerId,
    clientSignal: 'offer-selected',
  }
}

async function openMeetingPage() {
  expandMeeting()
  await navigateTo(meetingPagePath.value)
}

onMounted(() => {
  elapsedTimer = setInterval(() => {
    now.value = Date.now()
  }, 1_000)
})

onBeforeUnmount(() => {
  if (elapsedTimer) clearInterval(elapsedTimer)
})
</script>

<template>
  <Teleport to="body">
    <section
      v-if="state.active && !isMeetingPage"
      class="meeting-prototype"
      :class="{ 'meeting-prototype--minimized': state.displayMode === 'minimized' }"
      aria-label="Spotkanie w CRM"
    >
      <div
        v-if="state.displayMode === 'minimized'"
        class="meeting-mini"
        data-testid="crm-meeting-minimized"
      >
        <header class="meeting-mini__header">
          <span class="meeting-live-dot" aria-hidden="true" />
          <strong>Spotkanie · {{ elapsedLabel }}</strong>
          <UButton
            color="neutral"
            variant="ghost"
            square
            icon="i-lucide-maximize-2"
            aria-label="Rozwiń spotkanie"
            title="Rozwiń spotkanie"
            data-testid="crm-meeting-expand"
            @click="openMeetingPage"
          />
        </header>

        <button
          type="button"
          class="meeting-mini__stage"
          aria-label="Rozwiń spotkanie"
          @click="openMeetingPage"
        >
          <span class="meeting-mini__participant">
            <UIcon name="i-lucide-user-round" />
            <small>{{ state.clientName || 'Klient' }}</small>
          </span>
          <span class="meeting-mini__self">
            <UIcon name="i-lucide-user-round" />
            <small>Ty</small>
          </span>
        </button>

        <footer class="meeting-mini__footer">
          <span>
            <small>Pokazujesz</small>
            <strong>{{ activeArtifactTitle }}</strong>
          </span>
          <UButton
            color="error"
            variant="soft"
            square
            icon="i-lucide-phone-off"
            aria-label="Wróć do spotkania, aby je zakończyć"
            title="Wróć i zakończ"
            @click="openMeetingPage"
          />
        </footer>
      </div>

      <div
        v-else
        class="meeting-workspace"
        role="dialog"
        aria-modal="true"
        aria-labelledby="crm-meeting-title"
        data-testid="crm-meeting-expanded"
      >
        <header class="meeting-workspace__header">
          <div class="meeting-workspace__identity">
            <span class="meeting-workspace__mark">
              <UIcon name="i-lucide-video" />
            </span>
            <span>
              <small>OpenExpert · spotkanie w CRM</small>
              <strong id="crm-meeting-title">Konsultacja hipoteczna</strong>
            </span>
          </div>

          <div class="meeting-workspace__status">
            <UBadge color="warning" variant="soft" icon="i-lucide-video-off">
              LiveKit niepołączony
            </UBadge>
            <span class="meeting-workspace__timer">
              <span class="meeting-live-dot" aria-hidden="true" />
              {{ elapsedLabel }}
            </span>
          </div>

          <div class="meeting-workspace__actions">
            <UButton
              color="neutral"
              variant="ghost"
              icon="i-lucide-minimize-2"
              label="Minimalizuj"
              data-testid="crm-meeting-minimize"
              @click="minimizeMeeting"
            />
            <UButton
              color="error"
              variant="soft"
              icon="i-lucide-phone-off"
              label="Zakończ"
              @click="openMeetingPage"
            />
          </div>
        </header>

        <div class="meeting-workspace__body">
          <aside class="meeting-call">
            <UAlert
              color="warning"
              variant="subtle"
              icon="i-lucide-circle-alert"
              title="Połączenie wideo wyłączone"
              description="LiveKit nie jest połączony w tym środowisku. Nadal możesz korzystać z minimalizacji i selektywnego udostępniania danych CRM."
            />

            <div class="meeting-call__stage" aria-label="Podgląd uczestników">
              <article class="meeting-video meeting-video--client">
                <span class="meeting-video__avatar">
                  <UIcon name="i-lucide-user-round" />
                </span>
                <span class="meeting-video__label">
                  <span class="meeting-live-dot" aria-hidden="true" />
                  {{ state.clientName || 'Klient' }}
                </span>
              </article>
              <article class="meeting-video meeting-video--self">
                <span class="meeting-video__avatar">
                  <UIcon name="i-lucide-user-round" />
                </span>
                <span class="meeting-video__label">Ty</span>
              </article>
            </div>

            <div class="meeting-call__section">
              <div class="meeting-section-heading">
                <span>
                  <small>Artefakt rozmowy</small>
                  <strong>Co widzi klient</strong>
                </span>
                <UIcon name="i-lucide-eye" />
              </div>

              <div class="meeting-artifact-picker">
                <button
                  type="button"
                  :class="{ 'is-active': state.activeArtifactKind === 'mortgage-process' }"
                  @click="showMortgageProcess"
                >
                  <UIcon name="i-lucide-route" />
                  <span>
                    <strong>Proces kredytowy</strong>
                    <small>Materiał edukacyjny</small>
                  </span>
                  <UIcon name="i-lucide-chevron-right" />
                </button>
                <button
                  v-if="activeComparison"
                  type="button"
                  :class="{ 'is-active': state.activeArtifactKind === 'mortgage-comparison' }"
                  @click="showMortgageComparison"
                >
                  <UIcon name="i-lucide-scale" />
                  <span>
                    <strong>Wybrane oferty</strong>
                    <small>{{ activeComparison.offers.length }} z kalkulatora CRM</small>
                  </span>
                  <UIcon name="i-lucide-chevron-right" />
                </button>
              </div>
            </div>

            <div class="meeting-client-signal" :class="{ 'is-active': state.clientSignal !== 'none' }">
              <UIcon name="i-lucide-message-circle" />
              <span>
                <small>Sygnał z podglądu klienta</small>
                <strong>{{ clientSignalCopy }}</strong>
              </span>
            </div>
          </aside>

          <main class="meeting-artifact">
            <header class="meeting-artifact__header">
              <span>
                <small>Udostępniany materiał</small>
                <strong>{{ activeArtifactTitle }}</strong>
              </span>
              <UBadge color="success" variant="soft" icon="i-lucide-shield-check">
                Tylko wybrane dane
              </UBadge>
            </header>

            <section
              v-if="state.activeArtifactKind === 'mortgage-process'"
              class="process-artifact"
            >
              <div class="process-artifact__intro">
                <span class="process-artifact__number">
                  {{ String(mortgageProcessArtifact.steps.findIndex(step => step.id === activeProcessStep.id) + 1).padStart(2, '0') }}
                </span>
                <span>
                  <small>{{ mortgageProcessArtifact.sourceLabel }}</small>
                  <h2>{{ activeProcessStep.label }}</h2>
                  <p>{{ activeProcessStep.summary }}</p>
                </span>
              </div>

              <ol class="process-artifact__steps">
                <li
                  v-for="(step, index) in mortgageProcessArtifact.steps"
                  :key="step.id"
                  :class="{ 'is-active': step.id === activeProcessStep.id }"
                >
                  <button type="button" @click="selectProcessStep(step.id)">
                    <span>{{ index + 1 }}</span>
                    <strong>{{ step.label }}</strong>
                  </button>
                </li>
              </ol>

              <div class="process-artifact__prompt">
                <UIcon name="i-lucide-message-square-text" />
                <span>
                  <small>Pytanie do klienta</small>
                  <strong>{{ activeProcessStep.clientPrompt }}</strong>
                </span>
              </div>
            </section>

            <section
              v-else-if="activeComparison"
              class="comparison-artifact"
            >
              <div class="comparison-artifact__scenario">
                <span>
                  <small>Kwota kredytu</small>
                  <strong>{{ currency.format(activeComparison.scenario.loanAmount) }}</strong>
                </span>
                <span>
                  <small>Wartość nieruchomości</small>
                  <strong>{{ currency.format(activeComparison.scenario.propertyValue) }}</strong>
                </span>
                <span>
                  <small>Okres</small>
                  <strong>{{ activeComparison.scenario.years }} lat</strong>
                </span>
                <span>
                  <small>LTV</small>
                  <strong>{{ percent.format(activeComparison.scenario.ltvPct) }}%</strong>
                </span>
              </div>

              <div class="comparison-artifact__table">
                <table>
                  <thead>
                    <tr>
                      <th>Parametr</th>
                      <th v-for="offer in activeComparison.offers" :key="offer.id">
                        {{ offer.bankName }}
                        <small>{{ offer.productName }}</small>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th>Pierwsza rata</th>
                      <td v-for="offer in activeComparison.offers" :key="offer.id">
                        {{ currency.format(offer.firstInstallment) }}
                      </td>
                    </tr>
                    <tr>
                      <th>Pierwszy wydatek / mies.</th>
                      <td v-for="offer in activeComparison.offers" :key="offer.id">
                        {{ currency.format(offer.firstMonthlyOutflow) }}
                      </td>
                    </tr>
                    <tr>
                      <th>Koszt przez 5 lat</th>
                      <td v-for="offer in activeComparison.offers" :key="offer.id">
                        {{ currency.format(offer.costFirstFiveYears) }}
                      </td>
                    </tr>
                    <tr>
                      <th>Koszt całkowity</th>
                      <td v-for="offer in activeComparison.offers" :key="offer.id">
                        {{ currency.format(offer.totalCost) }}
                      </td>
                    </tr>
                    <tr>
                      <th>RRSO reprezentatywne</th>
                      <td v-for="offer in activeComparison.offers" :key="offer.id">
                        {{ offer.representativeAprPct == null ? 'Brak danych' : `${percent.format(offer.representativeAprPct)}%` }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <p class="comparison-artifact__note">
                {{ activeComparison.sourceLabel }} · pokazujemy tylko dane zaznaczone w porównywarce.
                To nie jest oferta banku ani ESIS.
              </p>
            </section>
          </main>

          <aside class="client-preview">
            <header class="client-preview__header">
              <span>
                <small>Interaktywny podgląd</small>
                <strong>Widok klienta</strong>
              </span>
            </header>

            <div class="client-preview__screen">
              <div class="client-preview__brand">
                <span><UIcon name="i-lucide-sparkles" /></span>
                <strong>OpenExpert</strong>
                <small>Rozmowa z ekspertem</small>
              </div>

              <template v-if="state.activeArtifactKind === 'mortgage-process'">
                <div class="client-preview__eyebrow">Twój proces kredytowy</div>
                <h3>{{ activeProcessStep.label }}</h3>
                <p>{{ activeProcessStep.summary }}</p>

                <div class="client-process-nav" aria-label="Kroki procesu">
                  <button
                    v-for="(step, index) in mortgageProcessArtifact.steps"
                    :key="step.id"
                    type="button"
                    :class="{ 'is-active': step.id === activeProcessStep.id }"
                    :aria-label="`Krok ${index + 1}: ${step.label}`"
                    @click="selectProcessStep(step.id)"
                  >
                    {{ index + 1 }}
                  </button>
                </div>

                <div class="client-preview__question">
                  <small>Ekspert pyta</small>
                  <strong>{{ activeProcessStep.clientPrompt }}</strong>
                </div>

                <div class="client-preview__actions">
                  <UButton
                    color="neutral"
                    variant="outline"
                    icon="i-lucide-message-circle-question"
                    label="Mam pytanie"
                    @click="setClientSignal('question')"
                  />
                  <UButton
                    color="success"
                    variant="soft"
                    icon="i-lucide-check"
                    label="Rozumiem"
                    @click="setClientSignal('understood')"
                  />
                </div>
              </template>

              <template v-else-if="activeComparison">
                <div class="client-preview__eyebrow">Oferty wybrane przez eksperta</div>
                <h3>Co jest dla Ciebie najważniejsze?</h3>
                <p>Wybierz ofertę, którą chcesz omówić. Ekspert od razu zobaczy Twój wybór.</p>

                <div class="client-offers">
                  <button
                    v-for="offer in activeComparison.offers"
                    :key="offer.id"
                    type="button"
                    :class="{ 'is-active': offer.id === selectedOffer?.id }"
                    @click="selectOffer(offer.id)"
                  >
                    <span>
                      <strong>{{ offer.bankName }}</strong>
                      <small>{{ offer.productName }}</small>
                    </span>
                    <span>
                      <small>Pierwsza rata</small>
                      <strong>{{ currency.format(offer.firstInstallment) }}</strong>
                    </span>
                    <UIcon :name="offer.id === selectedOffer?.id ? 'i-lucide-circle-check' : 'i-lucide-circle'" />
                  </button>
                </div>

                <div v-if="selectedOffer" class="client-preview__question">
                  <small>Twój wybór</small>
                  <strong>
                    {{ selectedOffer.bankName }} · koszt 5 lat
                    {{ currency.format(selectedOffer.costFirstFiveYears) }}
                  </strong>
                </div>

                <UButton
                  color="neutral"
                  variant="solid"
                  block
                  icon="i-lucide-message-circle"
                  label="Chcę omówić tę ofertę"
                  @click="setClientSignal('offer-selected')"
                />
              </template>
            </div>

            <footer class="client-preview__footer">
              <UIcon name="i-lucide-lock-keyhole" />
              <span>
                Klient widzi tylko ten panel. Pozostałe dane CRM pozostają ukryte.
              </span>
            </footer>
          </aside>
        </div>
      </div>
    </section>
  </Teleport>
</template>

<style scoped>
.meeting-prototype {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: grid;
  place-items: center;
  padding: 18px;
  background: color-mix(in srgb, var(--ui-bg-inverted) 62%, transparent);
  backdrop-filter: blur(8px);
}

.meeting-prototype--minimized {
  pointer-events: none;
  place-items: end;
  background: transparent;
  backdrop-filter: none;
}

.meeting-workspace,
.meeting-mini {
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-emphasis);
  background: var(--ui-bg);
  color: var(--ui-text);
  box-shadow: 0 28px 80px color-mix(in srgb, var(--ui-bg-inverted) 28%, transparent);
}

.meeting-workspace {
  display: grid;
  width: min(1500px, 100%);
  height: min(920px, calc(100dvh - 36px));
  grid-template-rows: auto minmax(0, 1fr);
}

.meeting-workspace__header {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 18px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--ui-border);
  background: var(--ui-bg);
}

.meeting-workspace__identity,
.meeting-workspace__status,
.meeting-workspace__actions,
.meeting-workspace__timer,
.meeting-section-heading,
.meeting-client-signal,
.meeting-artifact__header,
.client-preview__header,
.client-preview__brand,
.client-preview__footer {
  display: flex;
  align-items: center;
}

.meeting-workspace__identity {
  gap: 11px;
  min-width: 0;
}

.meeting-workspace__mark {
  display: grid;
  flex: 0 0 auto;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: var(--oe-radius-control);
  background: var(--ui-bg-inverted);
  color: var(--ui-text-inverted);
}

.meeting-workspace__identity > span:last-child,
.meeting-section-heading > span,
.meeting-client-signal > span,
.meeting-artifact__header > span,
.client-preview__header > span {
  display: grid;
  min-width: 0;
}

.meeting-workspace__identity small,
.meeting-section-heading small,
.meeting-client-signal small,
.meeting-artifact__header small,
.client-preview__header small,
.meeting-mini small,
.comparison-artifact__scenario small,
.client-preview__question small,
.client-offers small {
  color: var(--ui-text-muted);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.04em;
  line-height: 1.4;
  text-transform: uppercase;
}

.meeting-workspace__identity strong {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meeting-workspace__status {
  justify-content: center;
  gap: 12px;
}

.meeting-workspace__timer {
  gap: 7px;
  color: var(--ui-text-toned);
  font-family: var(--font-mono);
  font-size: 12px;
}

.meeting-live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ui-success);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--ui-success) 12%, transparent);
}

.meeting-workspace__actions {
  justify-content: flex-end;
  gap: 8px;
}

.meeting-workspace__body {
  display: grid;
  min-height: 0;
  grid-template-columns: minmax(230px, 0.7fr) minmax(440px, 1.35fr) minmax(300px, 0.85fr);
}

.meeting-call,
.meeting-artifact,
.client-preview {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
}

.meeting-call {
  display: grid;
  align-content: start;
  gap: 16px;
  padding: 18px;
  border-right: 1px solid var(--ui-border);
  background: var(--ui-bg-muted);
}

.meeting-call__stage {
  position: relative;
  aspect-ratio: 4 / 3;
  min-height: 210px;
}

.meeting-video {
  position: absolute;
  display: grid;
  overflow: hidden;
  place-items: center;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background:
    radial-gradient(circle at 50% 35%, var(--ui-bg-accented), var(--ui-bg-inverted));
  color: var(--ui-text-inverted);
}

.meeting-video--client {
  inset: 0;
}

.meeting-video--self {
  right: 10px;
  bottom: 10px;
  width: 34%;
  min-width: 92px;
  aspect-ratio: 4 / 3;
  box-shadow: 0 10px 32px color-mix(in srgb, var(--ui-bg-inverted) 32%, transparent);
}

.meeting-video__avatar {
  display: grid;
  width: 64px;
  height: 64px;
  place-items: center;
  border-radius: 50%;
  background: color-mix(in srgb, var(--ui-text-inverted) 10%, transparent);
  font-size: 28px;
}

.meeting-video--self .meeting-video__avatar {
  width: 36px;
  height: 36px;
  font-size: 17px;
}

.meeting-video__label {
  position: absolute;
  bottom: 10px;
  left: 10px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 7px;
  border-radius: 7px;
  background: color-mix(in srgb, var(--ui-bg-inverted) 62%, transparent);
  font-size: 10px;
}

.meeting-video__label .meeting-live-dot {
  width: 6px;
  height: 6px;
  box-shadow: none;
}

.meeting-call__section {
  display: grid;
  gap: 10px;
}

.meeting-section-heading {
  justify-content: space-between;
  gap: 12px;
}

.meeting-section-heading > svg {
  color: var(--ui-text-muted);
}

.meeting-artifact-picker {
  display: grid;
  gap: 7px;
}

.meeting-artifact-picker button {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 11px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  background: var(--ui-bg);
  color: var(--ui-text);
  text-align: left;
  cursor: pointer;
  transition: border-color var(--oe-motion-fast), background var(--oe-motion-fast);
}

.meeting-artifact-picker button:hover,
.meeting-artifact-picker button.is-active {
  border-color: var(--ui-border-accented);
  background: var(--ui-bg-elevated);
}

.meeting-artifact-picker button.is-active {
  box-shadow: inset 3px 0 var(--ui-primary);
}

.meeting-artifact-picker button > span {
  display: grid;
  min-width: 0;
}

.meeting-artifact-picker button strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
}

.meeting-artifact-picker button small {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.meeting-client-signal {
  gap: 10px;
  padding: 11px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  color: var(--ui-text-toned);
  background: var(--ui-bg);
}

.meeting-client-signal.is-active {
  border-color: color-mix(in srgb, var(--ui-success) 45%, var(--ui-border));
  color: var(--ui-success);
}

.meeting-client-signal strong {
  color: var(--ui-text-highlighted);
  font-size: 11px;
  line-height: 1.4;
}

.meeting-artifact {
  padding: 22px;
  background: var(--ui-bg);
}

.meeting-artifact__header {
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--ui-border);
}

.meeting-artifact__header strong,
.client-preview__header strong {
  color: var(--ui-text-highlighted);
  font-size: 15px;
}

.process-artifact,
.comparison-artifact {
  display: grid;
  gap: 20px;
  padding-top: 22px;
}

.process-artifact__intro {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.process-artifact__number {
  display: grid;
  width: 54px;
  height: 54px;
  place-items: center;
  border-radius: 50%;
  background: var(--ui-bg-inverted);
  color: var(--ui-text-inverted);
  font: 700 13px var(--font-mono);
}

.process-artifact__intro > span:last-child {
  display: grid;
  gap: 6px;
}

.process-artifact__intro small {
  color: var(--ui-text-muted);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.process-artifact__intro h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: clamp(24px, 3vw, 38px);
}

.process-artifact__intro p {
  max-width: 64ch;
  margin: 0;
  color: var(--ui-text-toned);
  font-size: 14px;
  line-height: 1.6;
}

.process-artifact__steps {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.process-artifact__steps button {
  display: grid;
  gap: 8px;
  width: 100%;
  min-height: 102px;
  padding: 12px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  background: var(--ui-bg-muted);
  color: var(--ui-text);
  text-align: left;
  cursor: pointer;
}

.process-artifact__steps li.is-active button {
  border-color: var(--ui-border-inverted);
  background: var(--ui-bg-inverted);
  color: var(--ui-text-inverted);
}

.process-artifact__steps button span {
  color: var(--ui-text-muted);
  font: 700 10px var(--font-mono);
}

.process-artifact__steps button strong {
  align-self: end;
  font-size: 11px;
  line-height: 1.35;
}

.process-artifact__prompt,
.client-preview__question {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background: var(--ui-bg-muted);
}

.process-artifact__prompt > svg {
  flex: 0 0 auto;
  margin-top: 2px;
}

.process-artifact__prompt > span,
.client-preview__question {
  display: grid;
  gap: 4px;
}

.process-artifact__prompt small {
  color: var(--ui-text-muted);
  font-size: 10px;
  font-weight: 650;
  text-transform: uppercase;
}

.process-artifact__prompt strong {
  color: var(--ui-text-highlighted);
  font-size: 14px;
}

.comparison-artifact__scenario {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
}

.comparison-artifact__scenario > span {
  display: grid;
  gap: 4px;
  padding: 13px;
  border-left: 1px solid var(--ui-border);
}

.comparison-artifact__scenario > span:first-child {
  border-left: 0;
}

.comparison-artifact__scenario strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.comparison-artifact__table {
  overflow-x: auto;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
}

.comparison-artifact__table table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
  white-space: nowrap;
}

.comparison-artifact__table th,
.comparison-artifact__table td {
  padding: 11px 12px;
  border-bottom: 1px solid var(--ui-border);
  text-align: right;
}

.comparison-artifact__table th:first-child {
  text-align: left;
}

.comparison-artifact__table thead th {
  background: var(--ui-bg-muted);
  color: var(--ui-text-highlighted);
}

.comparison-artifact__table thead small {
  display: block;
  margin-top: 2px;
  color: var(--ui-text-muted);
  font-size: 9px;
  font-weight: 400;
}

.comparison-artifact__note {
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 10px;
  line-height: 1.5;
}

.client-preview {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  padding: 18px;
  border-left: 1px solid var(--ui-border);
  background: var(--ui-bg-muted);
}

.client-preview__header {
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 14px;
}

.client-preview__screen {
  display: grid;
  align-content: start;
  gap: 14px;
  min-height: 0;
  overflow-y: auto;
  padding: 18px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-emphasis);
  background: var(--ui-bg);
  box-shadow: 0 12px 40px color-mix(in srgb, var(--ui-bg-inverted) 8%, transparent);
}

.client-preview__brand {
  gap: 8px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--ui-border);
}

.client-preview__brand > span {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 8px;
  background: var(--ui-bg-inverted);
  color: var(--ui-text-inverted);
}

.client-preview__brand strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
}

.client-preview__brand small {
  margin-left: auto;
  color: var(--ui-text-muted);
  font-size: 9px;
}

.client-preview__eyebrow {
  color: var(--ui-text-muted);
  font: 650 9px var(--font-mono);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.client-preview__screen h3 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 21px;
}

.client-preview__screen > p {
  margin: -8px 0 0;
  color: var(--ui-text-toned);
  font-size: 12px;
  line-height: 1.55;
}

.client-process-nav {
  display: flex;
  gap: 6px;
}

.client-process-nav button {
  display: grid;
  flex: 1 1 0;
  height: 32px;
  place-items: center;
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-muted);
  font: 700 10px var(--font-mono);
  cursor: pointer;
}

.client-process-nav button.is-active {
  border-color: var(--ui-border-inverted);
  background: var(--ui-bg-inverted);
  color: var(--ui-text-inverted);
}

.client-preview__question strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
  line-height: 1.45;
}

.client-preview__actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.client-offers {
  display: grid;
  gap: 8px;
}

.client-offers button {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 10px;
  padding: 11px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  background: var(--ui-bg-muted);
  color: var(--ui-text);
  text-align: left;
  cursor: pointer;
}

.client-offers button.is-active {
  border-color: var(--ui-border-inverted);
  background: var(--ui-bg);
  box-shadow: inset 3px 0 var(--ui-primary);
}

.client-offers button > span {
  display: grid;
  min-width: 0;
}

.client-offers button > span:nth-child(2) {
  text-align: right;
}

.client-offers strong {
  color: var(--ui-text-highlighted);
  font-size: 11px;
}

.client-preview__footer {
  gap: 8px;
  padding-top: 14px;
  color: var(--ui-text-muted);
  font-size: 10px;
  line-height: 1.4;
}

.meeting-mini {
  pointer-events: auto;
  display: grid;
  width: min(340px, calc(100vw - 28px));
  grid-template-rows: auto auto auto;
}

.meeting-mini__header,
.meeting-mini__footer {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 11px;
}

.meeting-mini__header {
  border-bottom: 1px solid var(--ui-border);
}

.meeting-mini__header strong {
  flex: 1;
  color: var(--ui-text-highlighted);
  font-size: 12px;
}

.meeting-mini__stage {
  position: relative;
  display: grid;
  min-height: 150px;
  overflow: hidden;
  place-items: center;
  border: 0;
  background:
    radial-gradient(circle at 50% 35%, var(--ui-bg-accented), var(--ui-bg-inverted));
  color: var(--ui-text-inverted);
  cursor: pointer;
}

.meeting-mini__participant,
.meeting-mini__self {
  display: grid;
  place-items: center;
}

.meeting-mini__participant > svg {
  width: 42px;
  height: 42px;
}

.meeting-mini__participant small,
.meeting-mini__self small {
  margin-top: 6px;
  color: currentColor;
  opacity: 0.75;
}

.meeting-mini__self {
  position: absolute;
  right: 10px;
  bottom: 10px;
  width: 78px;
  height: 58px;
  border: 1px solid color-mix(in srgb, var(--ui-text-inverted) 16%, transparent);
  border-radius: 9px;
  background: color-mix(in srgb, var(--ui-bg-inverted) 78%, transparent);
}

.meeting-mini__self > svg {
  width: 20px;
  height: 20px;
}

.meeting-mini__self small {
  margin-top: 2px;
}

.meeting-mini__footer {
  border-top: 1px solid var(--ui-border);
}

.meeting-mini__footer > span {
  display: grid;
  flex: 1;
  min-width: 0;
}

.meeting-mini__footer strong {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 1180px) {
  .meeting-workspace__body {
    grid-template-columns: minmax(220px, 0.65fr) minmax(420px, 1.35fr);
  }

  .client-preview {
    display: none;
  }
}

@media (max-width: 800px) {
  .meeting-prototype {
    padding: 0;
  }

  .meeting-workspace {
    width: 100%;
    height: 100dvh;
    border: 0;
    border-radius: 0;
  }

  .meeting-workspace__header {
    grid-template-columns: 1fr auto;
  }

  .meeting-workspace__status {
    display: none;
  }

  .meeting-workspace__actions :deep([data-slot="label"]) {
    display: none;
  }

  .meeting-workspace__body {
    grid-template-columns: 1fr;
    overflow-y: auto;
  }

  .meeting-call,
  .meeting-artifact {
    overflow: visible;
    border: 0;
  }

  .meeting-call__stage {
    aspect-ratio: 16 / 9;
  }

  .process-artifact__steps {
    grid-template-columns: 1fr;
  }

  .process-artifact__steps button {
    min-height: 0;
    grid-template-columns: auto 1fr;
  }

  .comparison-artifact__scenario {
    grid-template-columns: 1fr 1fr;
  }

  .comparison-artifact__scenario > span:nth-child(3) {
    border-left: 0;
    border-top: 1px solid var(--ui-border);
  }

  .comparison-artifact__scenario > span:nth-child(4) {
    border-top: 1px solid var(--ui-border);
  }
}

@media (prefers-reduced-motion: reduce) {
  .meeting-prototype *,
  .meeting-prototype *::before,
  .meeting-prototype *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
</style>
