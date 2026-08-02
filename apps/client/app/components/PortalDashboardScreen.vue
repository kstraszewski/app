<script setup lang="ts">
import type {
  PortalAppointment,
  PortalCase,
  PortalNextStep,
  PortalPayload,
} from '~/types/portal'
import {
  meetingPreparationStorageKey,
  parseMeetingPreparationState,
} from '~/utils/meeting-preparation'

const props = withDefaults(defineProps<{
  payload: PortalPayload
  preview?: boolean
}>(), {
  preview: false,
})

const firstName = computed(() => props.payload.user.name.trim().split(/\s+/u)[0] || 'Dzień dobry')
const activeCase = computed(() => props.payload.cases.find(item => item.id === props.payload.activeCaseId)
  || props.payload.cases[0]
  || null)

const nextAppointment = computed<PortalAppointment | null>(() => {
  if (props.payload.nextAppointment !== undefined) return props.payload.nextAppointment
  return [...(props.payload.appointments || [])]
    .filter(item => item.status !== 'cancelled' && new Date(item.endsAt).getTime() >= Date.now())
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt))[0] || null
})

const nextStep = computed<PortalNextStep>(() => {
  if (props.payload.nextStep) return props.payload.nextStep
  const caseData = activeCase.value
  if (caseData?.action) {
    return {
      kind: caseData.action.kind,
      responsibility: caseData.action.kind === 'wait' ? 'expert' : 'client',
      title: caseData.action.title,
      description: caseData.action.description,
      caseId: caseData.id,
      label: caseData.action.label,
      to: caseData.action.to,
    }
  }
  if (nextAppointment.value) {
    return {
      kind: 'prepare_appointment',
      responsibility: 'client',
      title: 'Teraz przygotuj się do pierwszego spotkania',
      description: 'W kilka minut uporządkujesz swoją sytuację, poznasz najważniejsze pojęcia i wybierzesz pytania do eksperta.',
      appointmentId: nextAppointment.value.id,
      label: 'Przygotuj się do spotkania',
      to: '/prepare',
    }
  }
  return {
    kind: 'wait',
    responsibility: 'expert',
    title: 'Teraz nie musisz nic robić',
    description: 'Twój ekspert przygotowuje kolejny krok. Gdy coś będzie potrzebne, zobaczysz to właśnie tutaj.',
    caseId: caseData?.id || null,
    label: caseData ? 'Zobacz sprawę' : null,
  }
})

const actionCase = computed<PortalCase | null>(() => props.payload.cases.find(item => item.id === nextStep.value.caseId)
  || activeCase.value)
const expert = computed(() => actionCase.value?.expert
  || activeCase.value?.expert
  || nextAppointment.value?.expert
  || null)
const dashboardCases = computed(() => props.payload.cases)
const preparationCompleted = ref(false)
const isFirstAppointment = computed(() => Boolean(
  nextAppointment.value
  && (
    nextAppointment.value.relationship === 'first'
    || (nextAppointment.value.relationship == null && !props.payload.cases.length)
  ),
))
const preparationTo = computed(() => props.preview ? '/preview/prepare' : '/prepare')

onMounted(() => {
  if (!nextAppointment.value) return
  const key = meetingPreparationStorageKey(
    props.payload.user.id,
    nextAppointment.value.id,
  )
  preparationCompleted.value = Boolean(
    parseMeetingPreparationState(window.localStorage.getItem(key)).completedAt,
  )
})

const actionIcon = computed(() => {
  if (nextStep.value.kind === 'prepare_appointment' && preparationCompleted.value) {
    return 'i-lucide-circle-check-big'
  }
  if (nextStep.value.kind === 'upload_document') return 'i-lucide-file-up'
  if (nextStep.value.kind === 'complete_multiform') return 'i-lucide-clipboard-list'
  if (nextStep.value.kind === 'prepare_appointment') return 'i-lucide-calendar-clock'
  return 'i-lucide-hourglass'
})

const actionEyebrow = computed(() => {
  if (nextStep.value.kind === 'prepare_appointment' && preparationCompleted.value) {
    return 'JESTEŚ PRZYGOTOWANY/A'
  }
  return nextStep.value.responsibility === 'client'
    ? 'CZEKA NA CIEBIE'
    : 'PO STRONIE EKSPERTA'
})

const actionTitle = computed(() => (
  nextStep.value.kind === 'prepare_appointment' && preparationCompleted.value
    ? 'Masz gotowy plan na pierwsze spotkanie'
    : nextStep.value.title
))

const actionDescription = computed(() => (
  nextStep.value.kind === 'prepare_appointment' && preparationCompleted.value
    ? 'Twój punkt startu i pytania czekają w zapisanym briefie. Możesz mieć go otwarte podczas rozmowy.'
    : nextStep.value.description
))

const actionTo = computed(() => {
  if (nextStep.value.kind === 'prepare_appointment') return preparationTo.value
  if (props.preview) {
    if (nextStep.value.kind === 'complete_multiform') return '/preview/multiform'
    if (actionCase.value) return `/preview/cases/${encodeURIComponent(actionCase.value.id)}`
    return '/preview'
  }
  if (nextStep.value.to) return nextStep.value.to
  if (actionCase.value) return `/cases/${encodeURIComponent(actionCase.value.id)}`
  return '/'
})

const actionLabel = computed(() => {
  if (nextStep.value.kind === 'prepare_appointment' && preparationCompleted.value) {
    return 'Zobacz swoje przygotowanie'
  }
  return nextStep.value.label
    || (nextStep.value.responsibility === 'client' ? 'Przejdź do zadania' : 'Zobacz sprawę')
})

const preparationActionLabel = computed(() => preparationCompleted.value
  ? 'Przygotowanie gotowe'
  : 'Przygotuj się do spotkania')

const contactTo = computed(() => {
  if (!expert.value || !actionCase.value) return null
  const base = props.preview
    ? `/preview/cases/${encodeURIComponent(actionCase.value.id)}`
    : `/cases/${encodeURIComponent(actionCase.value.id)}`
  return `${base}#kontakt`
})

const expertInitials = computed(() => {
  if (!expert.value) return 'OE'
  return expert.value.initials
    || expert.value.name.split(/\s+/u).filter(Boolean).map(part => part[0]).slice(0, 2).join('').toUpperCase()
})
const failedExpertAvatarUrl = ref('')
const expertAvatarUrl = computed(() => {
  const source = expert.value?.avatarUrl || ''
  return source && source !== failedExpertAvatarUrl.value ? source : ''
})

function handleExpertAvatarError() {
  failedExpertAvatarUrl.value = expert.value?.avatarUrl || ''
}

const calendarDayNumber = (date: Date, timezone?: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: timezone,
  }).formatToParts(date)
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return Date.UTC(Number(value.year), Number(value.month) - 1, Number(value.day))
}

const relativeAppointmentDay = (date: Date, weekday: string, timezone?: string) => {
  const daysUntil = Math.round((calendarDayNumber(date, timezone) - calendarDayNumber(new Date(), timezone)) / 86_400_000)
  if (daysUntil === 0) return 'dzisiaj'
  if (daysUntil === 1) return 'jutro'

  const feminineWeekday = ['środa', 'sobota', 'niedziela'].includes(weekday)
  if (daysUntil >= 2 && daysUntil <= 6) return `${feminineWeekday ? 'najbliższa' : 'najbliższy'} ${weekday}`
  if (daysUntil >= 7 && daysUntil <= 13) return `${feminineWeekday ? 'następna' : 'następny'} ${weekday}`

  return new Intl.DateTimeFormat('pl-PL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: timezone,
  }).format(date)
}

const appointmentDate = computed(() => {
  if (!nextAppointment.value) return null
  const date = new Date(nextAppointment.value.startsAt)
  const timezone = nextAppointment.value.timezone || undefined
  const weekday = new Intl.DateTimeFormat('pl-PL', { weekday: 'long', timeZone: timezone }).format(date)
  return {
    day: new Intl.DateTimeFormat('pl-PL', { day: '2-digit', timeZone: timezone }).format(date),
    month: new Intl.DateTimeFormat('pl-PL', { month: 'short', timeZone: timezone }).format(date).replace('.', ''),
    relativeDay: relativeAppointmentDay(date, weekday, timezone),
    time: new Intl.DateTimeFormat('pl-PL', {
      hour: '2-digit', minute: '2-digit', timeZone: timezone,
    }).format(date),
  }
})

const meetingModeLabel = computed(() => {
  if (!nextAppointment.value) return ''
  if (nextAppointment.value.meetingMode === 'online') return 'Spotkanie online'
  if (nextAppointment.value.facility?.name) return nextAppointment.value.facility.name
  return 'Spotkanie w placówce'
})
</script>

<template>
  <div class="portal-dashboard">
    <PortalHeader
      :user-name="payload.user.name"
      :user-email="payload.user.email"
      :preview="preview"
    />

    <main class="portal-dashboard__main">
      <header class="portal-dashboard__welcome">
        <div>
          <p>Dzień dobry, {{ firstName }}</p>
          <h1>Co teraz?</h1>
        </div>
        <p>Najważniejsze informacje i kolejny krok w jednym miejscu.</p>
      </header>

      <section class="portal-dashboard__focus" aria-label="Najważniejsze informacje">
        <article class="now-card">
          <div class="now-card__icon" aria-hidden="true">
            <UIcon :name="actionIcon" />
          </div>
          <div class="now-card__copy">
            <p class="now-card__eyebrow">
              <span />
              {{ actionEyebrow }}
            </p>
            <p v-if="actionCase" class="now-card__case">{{ actionCase.title }}</p>
            <h2>{{ actionTitle }}</h2>
            <p>{{ actionDescription }}</p>
          </div>
          <div class="now-card__footer">
            <UButton
              v-if="nextStep.caseId || nextStep.appointmentId || payload.cases.length"
              :to="actionTo"
              color="neutral"
              variant="solid"
              trailing
              icon="i-lucide-arrow-right"
            >
              {{ actionLabel }}
            </UButton>
            <span v-if="nextStep.responsibility === 'expert'">
              Powiadomimy Cię, gdy pojawi się nowy krok.
            </span>
            <span v-else-if="nextStep.kind === 'prepare_appointment' && preparationCompleted">
              Możesz wrócić do swojego briefu i pytań w każdej chwili.
            </span>
            <span v-else-if="nextStep.kind === 'prepare_appointment'">
              Postęp zapisze się tylko w tej przeglądarce.
            </span>
            <span v-else>Bezpiecznie zapisujemy każdy wykonany krok.</span>
          </div>
        </article>

        <article id="najblizsze-spotkanie" class="context-card context-card--meeting">
          <div class="context-card__header">
            <p>NAJBLIŻSZE SPOTKANIE</p>
            <UIcon name="i-lucide-calendar-days" />
          </div>
          <template v-if="nextAppointment && appointmentDate">
            <div class="meeting-card__main">
              <div class="meeting-card__date" aria-hidden="true">
                <strong>{{ appointmentDate.day }}</strong>
                <span>{{ appointmentDate.month }}</span>
              </div>
              <div>
                <h2>{{ nextAppointment.service?.name || 'Spotkanie z ekspertem' }}</h2>
                <p>{{ appointmentDate.relativeDay }}, {{ appointmentDate.time }}</p>
              </div>
            </div>
            <div class="meeting-card__place">
              <UIcon :name="nextAppointment.meetingMode === 'online' ? 'i-lucide-video' : 'i-lucide-map-pin'" />
              <span>{{ meetingModeLabel }}</span>
              <UBadge :color="nextAppointment.status === 'confirmed' ? 'success' : 'warning'" variant="subtle">
                {{ nextAppointment.status === 'confirmed' ? 'Potwierdzone' : 'Do potwierdzenia' }}
              </UBadge>
            </div>
            <UButton
              v-if="isFirstAppointment && nextStep.kind !== 'prepare_appointment'"
              :to="preparationTo"
              color="neutral"
              variant="outline"
              :icon="preparationCompleted ? 'i-lucide-circle-check-big' : 'i-lucide-notebook-pen'"
              block
            >
              {{ preparationActionLabel }}
            </UButton>
          </template>
          <div v-else class="context-card__empty">
            <h2>Brak zaplanowanych spotkań</h2>
            <p>Nowy termin pojawi się tutaj, gdy zostanie ustalony.</p>
          </div>
        </article>

        <article class="context-card context-card--expert">
          <div class="context-card__header">
            <p>TWÓJ EKSPERT</p>
            <UIcon name="i-lucide-badge-check" />
          </div>
          <template v-if="expert">
            <div class="expert-card__identity">
              <span class="expert-card__avatar">
                <img
                  v-if="expertAvatarUrl"
                  :src="expertAvatarUrl"
                  alt=""
                  @error="handleExpertAvatarError"
                >
                <template v-else>{{ expertInitials }}</template>
              </span>
              <div>
                <h2>{{ expert.name }}</h2>
                <p>{{ expert.professionalTitle || expert.role || 'Ekspert prowadzący Twoją sprawę' }}</p>
              </div>
            </div>
            <UButton
              v-if="contactTo"
              :to="contactTo"
              color="neutral"
              variant="outline"
              icon="i-lucide-message-circle"
              block
            >
              Napisz do eksperta
            </UButton>
          </template>
          <div v-else class="context-card__empty">
            <h2>Ekspert nie jest jeszcze przypisany</h2>
            <p>Pokażemy go tutaj, gdy rozpocznie prowadzenie sprawy.</p>
          </div>
        </article>
      </section>

      <section class="portal-dashboard__cases" aria-labelledby="dashboard-cases-title">
        <header>
          <div>
            <p>TWOJE SPRAWY</p>
            <h2 id="dashboard-cases-title">Wszystko, co prowadzimy dla Ciebie</h2>
          </div>
        </header>

        <div v-if="dashboardCases.length" class="portal-dashboard__case-grid">
          <PortalCaseCard
            v-for="caseData in dashboardCases"
            :key="caseData.id"
            :case-data="caseData"
            :preview="preview"
            compact
          />
        </div>
        <div v-else class="portal-dashboard__empty-cases">
          <UIcon name="i-lucide-folder-clock" />
          <div>
            <h3>Nie masz jeszcze udostępnionej sprawy</h3>
            <p>Gdy ekspert ją udostępni, pojawi się tutaj automatycznie.</p>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.portal-dashboard {
  min-height: 100dvh;
  background: var(--ui-bg-muted);
}

.portal-dashboard__main {
  width: min(1240px, calc(100% - 48px));
  margin: 0 auto;
  padding: 40px 0 110px;
}

.portal-dashboard__welcome {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 40px;
  margin-bottom: 20px;
}

.portal-dashboard__welcome p,
.portal-dashboard__welcome h1,
.portal-dashboard__cases h2,
.portal-dashboard__cases p {
  margin: 0;
}

.portal-dashboard__welcome > div > p {
  margin-bottom: 3px;
  color: var(--ui-text-muted);
  font-size: 15px;
}

.portal-dashboard__welcome h1 {
  font-size: clamp(38px, 4vw, 54px);
  line-height: 1.1;
}

.portal-dashboard__welcome > p {
  max-width: 340px;
  padding-bottom: 5px;
  color: var(--ui-text-muted);
  font-size: 14px;
  text-align: right;
}

.portal-dashboard__focus {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(310px, 0.75fr);
  grid-template-areas:
    "now meeting"
    "now expert";
  gap: 18px;
}

.now-card,
.context-card {
  border: 1px solid var(--portal-line);
  border-radius: 20px;
}

.now-card {
  grid-area: now;
  display: grid;
  grid-template-rows: auto 1fr auto;
  min-height: 390px;
  padding: 27px;
  background: var(--ui-bg-inverted);
  color: var(--ui-text-inverted);
}

.now-card__icon {
  display: grid;
  width: 50px;
  height: 50px;
  place-items: center;
  border: 1px solid rgb(255 255 255 / 23%);
  border-radius: 999px;
  background: rgb(255 255 255 / 8%);
}

.now-card__icon svg {
  width: 27px;
  height: 27px;
  stroke-width: 1.7;
}

.now-card__copy {
  align-self: center;
  max-width: 650px;
  padding: 18px 0;
}

.now-card__eyebrow,
.now-card__case,
.now-card__copy h2,
.now-card__copy > p:last-child,
.now-card__footer span {
  margin: 0;
}

.now-card__eyebrow {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 12px;
  color: rgb(255 255 255 / 68%);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.13em;
}

.now-card__eyebrow span {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--ui-color-success-400);
  box-shadow: 0 0 0 4px rgb(74 222 128 / 15%);
}

.now-card__case {
  margin-bottom: 8px;
  color: rgb(255 255 255 / 60%);
  font-size: 13px;
}

.now-card__copy h2 {
  max-width: 620px;
  color: var(--ui-text-inverted);
  font-size: clamp(30px, 3.3vw, 46px);
  line-height: 1.13;
}

.now-card__copy > p:last-child {
  max-width: 610px;
  margin-top: 12px;
  color: rgb(255 255 255 / 67%);
  font-size: 15px;
  line-height: 1.55;
}

.now-card__footer {
  display: flex;
  align-items: center;
  gap: 20px;
  padding-top: 17px;
  border-top: 1px solid rgb(255 255 255 / 18%);
}

.now-card__footer :deep(a) {
  min-width: 195px;
  border-color: #fff;
  background: #fff;
  color: #000;
}

.now-card__footer span {
  max-width: 280px;
  color: rgb(255 255 255 / 52%);
  font-size: 12px;
  line-height: 1.45;
}

.context-card {
  display: grid;
  align-content: space-between;
  gap: 14px;
  min-height: 186px;
  padding: 19px 22px;
  background: var(--ui-bg);
}

.context-card--meeting { grid-area: meeting; }
.context-card--expert { grid-area: expert; }

.context-card__header,
.meeting-card__main,
.meeting-card__place,
.expert-card__identity {
  display: flex;
  align-items: center;
}

.context-card__header {
  justify-content: space-between;
  gap: 12px;
}

.context-card__header p {
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
}

.context-card__header svg {
  width: 19px;
  height: 19px;
  color: var(--ui-text-muted);
}

.meeting-card__main {
  align-items: center;
  gap: 15px;
}

.meeting-card__date {
  display: grid;
  flex: 0 0 auto;
  width: 58px;
  height: 64px;
  place-content: center;
  border-radius: 13px;
  background: var(--ui-bg-inverted);
  color: var(--ui-text-inverted);
  text-align: center;
}

.meeting-card__date strong {
  font-size: 23px;
  font-weight: 500;
  line-height: 1;
}

.meeting-card__date span {
  margin-top: 4px;
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.meeting-card__main h2,
.meeting-card__main p,
.expert-card__identity h2,
.expert-card__identity p,
.context-card__empty h2,
.context-card__empty p {
  margin: 0;
}

.meeting-card__main h2,
.expert-card__identity h2,
.context-card__empty h2 {
  font-size: 17px;
  line-height: 1.3;
}

.meeting-card__main p,
.expert-card__identity p,
.context-card__empty p {
  margin-top: 4px;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.meeting-card__place {
  gap: 8px;
  padding-top: 15px;
  border-top: 1px solid var(--portal-line);
  color: var(--ui-text-toned);
  font-size: 12px;
}

.meeting-card__place > svg {
  width: 16px;
  height: 16px;
}

.meeting-card__place :deep(.badge) {
  margin-left: auto;
}

.meeting-card__place > :last-child {
  margin-left: auto;
}

.expert-card__identity {
  gap: 14px;
}

.expert-card__avatar {
  display: grid;
  flex: 0 0 auto;
  width: 54px;
  height: 54px;
  overflow: hidden;
  place-items: center;
  border-radius: 999px;
  background: var(--ui-bg-elevated);
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 700;
}

.expert-card__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.context-card__empty {
  align-self: center;
}

.portal-dashboard__cases {
  margin-top: 40px;
}

.portal-dashboard__cases > header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 30px;
  margin-bottom: 22px;
}

.portal-dashboard__cases > header > div > p {
  margin-bottom: 5px;
  color: var(--ui-text-muted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
}

.portal-dashboard__cases h2 {
  font-size: 27px;
}

.portal-dashboard__case-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.portal-dashboard__empty-cases {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 28px;
  border: 1px dashed var(--ui-border-accented);
  border-radius: 18px;
  background: var(--ui-bg);
}

.portal-dashboard__empty-cases > svg {
  width: 28px;
  height: 28px;
}

.portal-dashboard__empty-cases h3,
.portal-dashboard__empty-cases p {
  margin: 0;
}

.portal-dashboard__empty-cases h3 { font-size: 17px; }
.portal-dashboard__empty-cases p { margin-top: 3px; color: var(--ui-text-muted); font-size: 13px; }

@media (max-width: 980px) {
  .portal-dashboard__focus {
    grid-template-columns: minmax(0, 1fr) minmax(280px, 0.85fr);
  }

  .now-card {
    min-height: 420px;
    padding: 28px;
  }

  .now-card__footer {
    align-items: flex-start;
    flex-direction: column;
  }
}

@media (max-width: 760px) {
  .portal-dashboard__main {
    width: min(calc(100% - 32px), 640px);
    padding: 36px 0 calc(56px + env(safe-area-inset-bottom));
  }

  .portal-dashboard__welcome {
    display: block;
    margin-bottom: 24px;
  }

  .portal-dashboard__welcome > p {
    margin-top: 10px;
    padding: 0;
    text-align: left;
  }

  .portal-dashboard__welcome h1 {
    font-size: 42px;
  }

  .portal-dashboard__focus {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .now-card { order: 1; min-height: 380px; }
  .context-card--meeting { order: 2; }
  .context-card--expert { order: 3; }

  .context-card {
    min-height: 0;
  }

  .portal-dashboard__case-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .portal-dashboard__main {
    padding-top: 22px;
  }

  .portal-dashboard__welcome {
    margin-bottom: 18px;
  }

  .portal-dashboard__welcome > div > p {
    margin-bottom: 1px;
    font-size: 14px;
  }

  .portal-dashboard__welcome > p {
    max-width: 330px;
    margin-top: 7px;
    font-size: 13px;
    line-height: 1.45;
  }

  .portal-dashboard__welcome h1 {
    font-size: 36px;
  }

  .portal-dashboard__focus {
    gap: 12px;
  }

  .now-card {
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr);
    column-gap: 12px;
    min-height: 0;
    padding: 20px;
    border-radius: 18px;
  }

  .now-card__icon {
    grid-column: 1;
    grid-row: 1;
    width: 40px;
    height: 40px;
  }

  .now-card__icon svg {
    width: 21px;
    height: 21px;
  }

  .now-card__copy {
    display: contents;
  }

  .now-card__eyebrow {
    grid-column: 2;
    grid-row: 1;
    align-self: center;
    margin-bottom: 0;
    font-size: 10.5px;
    line-height: 1.25;
  }

  .now-card__case {
    grid-column: 1 / -1;
    grid-row: 2;
    margin-top: 18px;
    margin-bottom: 7px;
    font-size: 12.5px;
  }

  .now-card__copy h2 {
    grid-column: 1 / -1;
    grid-row: 3;
    font-size: clamp(27px, 7.6vw, 30px);
    line-height: 1.12;
  }

  .now-card__copy > p:last-child {
    grid-column: 1 / -1;
    grid-row: 4;
    margin-top: 9px;
    font-size: 14px;
    line-height: 1.45;
  }

  .now-card__footer {
    display: grid;
    grid-column: 1 / -1;
    grid-row: 5;
    gap: 10px;
    margin-top: 22px;
    padding-top: 16px;
  }

  .now-card__footer :deep(a) {
    width: 100%;
    min-height: 48px;
    justify-content: space-between;
    padding-inline: 14px;
  }

  .now-card__footer span {
    max-width: none;
    font-size: 11.5px;
  }

  .context-card {
    gap: 10px;
    padding: 18px 19px;
    border-radius: 18px;
  }

  .context-card__header svg {
    width: 18px;
    height: 18px;
  }

  .context-card__empty h2 {
    font-size: 16px;
  }

  .context-card__empty p {
    font-size: 12.5px;
    line-height: 1.45;
  }

  .meeting-card__place {
    flex-wrap: wrap;
  }

  .portal-dashboard__cases {
    margin-top: 38px;
  }

  .portal-dashboard__cases > header {
    align-items: flex-start;
    flex-direction: column;
    gap: 10px;
  }

  .portal-dashboard__cases h2 {
    font-size: 24px;
  }
}
</style>
