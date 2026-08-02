<script setup lang="ts">
import {
  coBorrowerOptions,
  expertQuestions,
  incomeSourceLabels,
  meetingConcepts,
  meetingGoalOptions,
  meetingIncomeSourceOptions,
  meetingStageOptions,
  preparationSources,
  recommendedQuestionIds,
  visibleChecklistItems,
  type CoBorrowerPlan,
  type ExpertQuestion,
  type MeetingGoal,
  type MeetingIncomeSource,
  type MeetingStage,
} from '~/data/meeting-preparation'
import type { PortalAppointment, PortalPayload } from '~/types/portal'
import {
  buildMeetingPreparationSummary,
  createMeetingPreparationState,
  meetingPreparationProgress,
  meetingPreparationStorageKey,
  parseMeetingPreparationState,
  profileIsReady,
} from '~/utils/meeting-preparation'

const props = withDefaults(defineProps<{
  payload: PortalPayload
  preview?: boolean
}>(), {
  preview: false,
})

const toast = useToast()
const state = reactive(createMeetingPreparationState())
const hydrated = ref(false)

const steps = [
  { label: 'Punkt startu', caption: 'Twój cel i sytuacja', icon: 'i-lucide-compass' },
  { label: 'Bez żargonu', caption: '6 ważnych pojęć', icon: 'i-lucide-book-open-text' },
  { label: 'Co przygotować', caption: 'Dopasowana checklista', icon: 'i-lucide-list-checks' },
  { label: 'Twoje pytania', caption: 'Agenda spotkania', icon: 'i-lucide-message-circle-question' },
  { label: 'Twój brief', caption: 'Gotowe podsumowanie', icon: 'i-lucide-notebook-tabs' },
]

const nextAppointment = computed<PortalAppointment | null>(() => (
  props.payload.nextAppointment
  || [...(props.payload.appointments || [])]
    .filter(item => item.status !== 'cancelled' && new Date(item.endsAt).getTime() >= Date.now())
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt))[0]
  || null
))
const expert = computed(() => (
  nextAppointment.value?.expert
  || props.payload.cases[0]?.expert
  || null
))
const expertInitials = computed(() => {
  if (!expert.value) return 'OE'
  return expert.value.initials
    || expert.value.name
      .split(/\s+/u)
      .filter(Boolean)
      .map(part => part[0])
      .slice(0, 2)
      .join('')
      .toUpperCase()
})
const failedExpertAvatarUrl = ref('')
const expertAvatarUrl = computed(() => {
  const source = expert.value?.avatarUrl || ''
  return source && source !== failedExpertAvatarUrl.value ? source : ''
})

function handleExpertAvatarError() {
  failedExpertAvatarUrl.value = expert.value?.avatarUrl || ''
}
const dashboardTo = computed(() => props.preview ? '/preview?scenario=first-meeting' : '/')
const storageKey = computed(() => meetingPreparationStorageKey(
  props.payload.user.id,
  nextAppointment.value?.id,
))
const progress = computed(() => meetingPreparationProgress(state))
const profileReady = computed(() => profileIsReady(state.profile))
const checklistItems = computed(() => visibleChecklistItems(state.profile))
const checkedVisibleCount = computed(() => {
  const visibleIds = new Set(checklistItems.value.map(item => item.id))
  return state.checkedItemIds.filter(id => visibleIds.has(id)).length
})
const selectedQuestions = computed(() => expertQuestions.filter(question => (
  state.selectedQuestionIds.includes(question.id)
)))
const recommendedIds = computed(() => recommendedQuestionIds(state.profile))
const summary = computed(() => buildMeetingPreparationSummary(state))

const checklistGroups = computed(() => [
  'Sytuacja i budżet',
  'Dochody',
  'Nieruchomość lub obecny kredyt',
].map(group => ({
  label: group,
  items: checklistItems.value.filter(item => item.group === group),
})).filter(group => group.items.length))

const questionGroups = computed(() => [
  'Dopasowanie',
  'Koszt i ryzyko',
  'Proces i współpraca',
].map(category => ({
  label: category,
  items: expertQuestions.filter(question => (
    question.category === category
    && (!question.goals?.length || !state.profile.goal || question.goals.includes(state.profile.goal))
  )),
})))

const appointmentDate = computed(() => {
  if (!nextAppointment.value) return null
  const date = new Date(nextAppointment.value.startsAt)
  const timezone = nextAppointment.value.timezone || 'Europe/Warsaw'
  return {
    day: new Intl.DateTimeFormat('pl-PL', { day: '2-digit', timeZone: timezone }).format(date),
    month: new Intl.DateTimeFormat('pl-PL', { month: 'short', timeZone: timezone }).format(date).replace('.', ''),
    full: new Intl.DateTimeFormat('pl-PL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone,
    }).format(date),
  }
})
const meetingModeLabel = computed(() => {
  if (!nextAppointment.value) return 'Szczegóły terminu znajdziesz w panelu'
  if (nextAppointment.value.meetingMode === 'online') return 'Spotkanie online'
  return nextAppointment.value.facility?.name || 'Spotkanie w placówce'
})

onMounted(() => {
  const saved = parseMeetingPreparationState(window.localStorage.getItem(storageKey.value))
  Object.assign(state, saved)
  hydrated.value = true
})

watch(state, () => {
  if (!hydrated.value) return
  try {
    window.localStorage.setItem(storageKey.value, JSON.stringify({
      ...state,
      updatedAt: new Date().toISOString(),
    }))
  }
  catch {
    // The flow remains fully usable when browser storage is unavailable.
  }
}, { deep: true, flush: 'post' })

function scrollToFlow() {
  document.getElementById('preparation-flow')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function goToStep(index: number) {
  state.activeStep = Math.max(0, Math.min(steps.length - 1, index))
  nextTick(() => scrollToFlow())
}

function nextStep() {
  goToStep(state.activeStep + 1)
}

function previousStep() {
  goToStep(state.activeStep - 1)
}

function chooseGoal(value: MeetingGoal) {
  state.profile.goal = value
}

function chooseStage(value: MeetingStage) {
  state.profile.stage = value
}

function chooseCoBorrower(value: CoBorrowerPlan) {
  state.profile.coBorrower = value
}

function toggleIncomeSource(value: MeetingIncomeSource) {
  const index = state.profile.incomeSources.indexOf(value)
  if (index >= 0) state.profile.incomeSources.splice(index, 1)
  else state.profile.incomeSources.push(value)
}

function markConceptRead(id: string, event: Event) {
  const details = event.currentTarget as HTMLDetailsElement
  if (details.open && !state.readConceptIds.includes(id)) state.readConceptIds.push(id)
}

function toggleChecklistItem(id: string) {
  const index = state.checkedItemIds.indexOf(id)
  if (index >= 0) state.checkedItemIds.splice(index, 1)
  else state.checkedItemIds.push(id)
}

function toggleQuestion(id: string) {
  const index = state.selectedQuestionIds.indexOf(id)
  if (index >= 0) state.selectedQuestionIds.splice(index, 1)
  else state.selectedQuestionIds.push(id)
}

function addRecommendedQuestions() {
  state.selectedQuestionIds = [...new Set([
    ...state.selectedQuestionIds,
    ...recommendedIds.value,
  ])]
  toast.add({
    title: 'Dodaliśmy najważniejsze pytania',
    description: 'Możesz usunąć każde, które nie pasuje do Twojej rozmowy.',
    icon: 'i-lucide-list-plus',
  })
}

function questionIsRecommended(question: ExpertQuestion): boolean {
  return recommendedIds.value.includes(question.id)
}

function countWithNoun(count: number, singular: string, plural: string, genitivePlural: string) {
  const lastDigit = count % 10
  const lastTwoDigits = count % 100
  const noun = count === 1
    ? singular
    : lastDigit >= 2 && lastDigit <= 4 && !(lastTwoDigits >= 12 && lastTwoDigits <= 14)
      ? plural
      : genitivePlural

  return `${count} ${noun}`
}

async function copySummary() {
  try {
    await navigator.clipboard.writeText(summary.value)
    toast.add({
      title: 'Podsumowanie skopiowane',
      description: 'Możesz wkleić je do notatek albo mieć otwarte podczas spotkania.',
      color: 'success',
      icon: 'i-lucide-copy-check',
    })
  }
  catch {
    toast.add({
      title: 'Nie udało się skopiować podsumowania',
      description: 'Spróbuj ponownie albo skorzystaj z opcji drukowania.',
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  }
}

function printSummary() {
  window.print()
}

async function completePreparation() {
  state.completedAt = new Date().toISOString()
  toast.add({
    title: 'Jesteś przygotowany/a do spotkania',
    description: 'Twój brief pozostanie zapisany w tej przeglądarce.',
    color: 'success',
    icon: 'i-lucide-circle-check-big',
  })
  await navigateTo(dashboardTo.value)
}
</script>

<template>
  <div class="meeting-preparation">
    <PortalHeader
      :user-name="payload.user.name"
      :user-email="payload.user.email"
      :preview="preview"
    />

    <main class="meeting-preparation__main">
      <NuxtLink :to="dashboardTo" class="preparation-back">
        <UIcon name="i-lucide-arrow-left" />
        Wróć do „Co teraz”
      </NuxtLink>

      <section class="preparation-hero">
        <div class="preparation-hero__copy">
          <p class="preparation-eyebrow">PRZED PIERWSZYM SPOTKANIEM · OK. 7 MINUT</p>
          <h1>Pierwsza rozmowa to nie egzamin.</h1>
          <p class="preparation-hero__lead">
            Uporządkuj swój punkt startu, poznaj najważniejsze decyzje i przygotuj pytania.
            Dzięki temu na spotkaniu szybciej przejdziecie do konkretów.
          </p>

          <div class="preparation-hero__progress">
            <div>
              <span>Twój postęp</span>
              <strong>{{ progress }}%</strong>
            </div>
            <div
              class="preparation-progress"
              role="progressbar"
              aria-label="Postęp przygotowania"
              :aria-valuenow="progress"
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <span :style="{ width: `${progress}%` }" />
            </div>
          </div>

          <div class="preparation-hero__actions">
            <UButton
              color="neutral"
              variant="solid"
              :icon="state.completedAt ? 'i-lucide-notebook-tabs' : 'i-lucide-arrow-down'"
              @click="scrollToFlow"
            >
              {{ state.completedAt ? 'Otwórz swój brief' : progress ? 'Kontynuuj przygotowanie' : 'Zacznij przygotowanie' }}
            </UButton>
            <span><UIcon name="i-lucide-lock-keyhole" /> Odpowiedzi zostają na tym urządzeniu.</span>
          </div>
        </div>

        <aside class="preparation-meeting-card" aria-label="Najbliższe spotkanie">
          <div class="preparation-meeting-card__top">
            <p>TWÓJ TERMIN</p>
            <UBadge v-if="state.completedAt" color="success" variant="subtle">
              Przygotowanie gotowe
            </UBadge>
            <UIcon v-else name="i-lucide-calendar-days" />
          </div>

          <template v-if="nextAppointment && appointmentDate">
            <div class="preparation-meeting-card__date-row">
              <span class="preparation-meeting-card__date" aria-hidden="true">
                <strong>{{ appointmentDate.day }}</strong>
                <small>{{ appointmentDate.month }}</small>
              </span>
              <div>
                <h2>{{ nextAppointment.service?.name || 'Pierwsza konsultacja kredytowa' }}</h2>
                <p>{{ appointmentDate.full }}</p>
              </div>
            </div>
            <div class="preparation-meeting-card__meta">
              <span>
                <UIcon :name="nextAppointment.meetingMode === 'online' ? 'i-lucide-video' : 'i-lucide-map-pin'" />
                {{ meetingModeLabel }}
              </span>
              <span v-if="nextAppointment.service?.durationMinutes">
                <UIcon name="i-lucide-clock-3" />
                {{ nextAppointment.service.durationMinutes }} min
              </span>
            </div>
          </template>
          <div v-else class="preparation-meeting-card__empty">
            <h2>Przygotowanie działa także bez terminu</h2>
            <p>Gdy spotkanie zostanie umówione, szczegóły pojawią się w „Co teraz”.</p>
          </div>

          <div v-if="expert" class="preparation-meeting-card__expert">
            <span class="preparation-meeting-card__avatar">
              <img
                v-if="expertAvatarUrl"
                :src="expertAvatarUrl"
                alt=""
                @error="handleExpertAvatarError"
              >
              <template v-else>{{ expertInitials }}</template>
            </span>
            <div>
              <strong>{{ expert.name }}</strong>
              <p>{{ expert.professionalTitle || 'Ekspert prowadzący spotkanie' }}</p>
            </div>
          </div>
        </aside>
      </section>

      <section id="preparation-flow" class="preparation-workspace">
        <aside class="preparation-steps" aria-label="Etapy przygotowania">
          <div class="preparation-steps__heading">
            <p>TWÓJ PLAN</p>
            <span>{{ state.activeStep + 1 }} / {{ steps.length }}</span>
          </div>
          <ol>
            <li v-for="(step, index) in steps" :key="step.label">
              <button
                type="button"
                :class="{
                  'is-active': state.activeStep === index,
                  'is-complete': state.activeStep > index || Boolean(state.completedAt),
                }"
                :aria-current="state.activeStep === index ? 'step' : undefined"
                @click="goToStep(index)"
              >
                <span class="preparation-steps__index">
                  <UIcon v-if="state.activeStep > index || state.completedAt" name="i-lucide-check" />
                  <UIcon v-else :name="step.icon" />
                </span>
                <span>
                  <strong>{{ step.label }}</strong>
                  <small>{{ step.caption }}</small>
                </span>
              </button>
            </li>
          </ol>
          <div class="preparation-steps__privacy">
            <UIcon name="i-lucide-shield-check" />
            <p>Nic nie jest automatycznie wysyłane ekspertowi.</p>
          </div>
        </aside>

        <section class="preparation-card">
          <template v-if="state.activeStep === 0">
            <header class="preparation-card__header">
              <p>KROK 1 · TWÓJ PUNKT STARTU</p>
              <h2>Najpierw ustalmy, z czym przychodzisz.</h2>
              <p>Odpowiadaj orientacyjnie. Na pierwsze spotkanie nie potrzebujesz wyliczeń co do złotówki.</p>
            </header>

            <div class="preparation-section">
              <div class="preparation-section__heading">
                <span>01</span>
                <div>
                  <h3>Jaki jest Twój główny cel?</h3>
                  <p>Wybierz jedną odpowiedź.</p>
                </div>
              </div>
              <div class="preparation-options preparation-options--two">
                <button
                  v-for="option in meetingGoalOptions"
                  :key="option.value"
                  type="button"
                  :class="{ 'is-selected': state.profile.goal === option.value }"
                  :aria-pressed="state.profile.goal === option.value"
                  @click="chooseGoal(option.value)"
                >
                  <UIcon :name="option.icon" />
                  <span>
                    <strong>{{ option.label }}</strong>
                    <small>{{ option.description }}</small>
                  </span>
                  <UIcon class="preparation-option__check" :name="state.profile.goal === option.value ? 'i-lucide-circle-check-big' : 'i-lucide-circle'" />
                </button>
              </div>
            </div>

            <div class="preparation-section">
              <div class="preparation-section__heading">
                <span>02</span>
                <div>
                  <h3>Na jakim jesteś etapie?</h3>
                  <p>To pomaga ustalić tempo i kolejność działań.</p>
                </div>
              </div>
              <div class="preparation-options preparation-options--two">
                <button
                  v-for="option in meetingStageOptions"
                  :key="option.value"
                  type="button"
                  :class="{ 'is-selected': state.profile.stage === option.value }"
                  :aria-pressed="state.profile.stage === option.value"
                  @click="chooseStage(option.value)"
                >
                  <UIcon :name="option.icon" />
                  <span>
                    <strong>{{ option.label }}</strong>
                    <small>{{ option.description }}</small>
                  </span>
                  <UIcon class="preparation-option__check" :name="state.profile.stage === option.value ? 'i-lucide-circle-check-big' : 'i-lucide-circle'" />
                </button>
              </div>
            </div>

            <div class="preparation-section">
              <div class="preparation-section__heading">
                <span>03</span>
                <div>
                  <h3>Jakie źródła dochodu dotyczą kredytobiorców?</h3>
                  <p>Możesz zaznaczyć kilka.</p>
                </div>
              </div>
              <div class="preparation-options preparation-options--two">
                <button
                  v-for="option in meetingIncomeSourceOptions"
                  :key="option.value"
                  type="button"
                  :class="{ 'is-selected': state.profile.incomeSources.includes(option.value) }"
                  :aria-pressed="state.profile.incomeSources.includes(option.value)"
                  @click="toggleIncomeSource(option.value)"
                >
                  <UIcon :name="option.icon" />
                  <span>
                    <strong>{{ option.label }}</strong>
                    <small>{{ option.description }}</small>
                  </span>
                  <UIcon class="preparation-option__check" :name="state.profile.incomeSources.includes(option.value) ? 'i-lucide-circle-check-big' : 'i-lucide-circle'" />
                </button>
              </div>
            </div>

            <div class="preparation-section">
              <div class="preparation-section__heading">
                <span>04</span>
                <div>
                  <h3>Czy planujesz kredyt z drugą osobą?</h3>
                  <p>Nie musisz mieć jeszcze ostatecznej decyzji.</p>
                </div>
              </div>
              <div class="preparation-options preparation-options--three">
                <button
                  v-for="option in coBorrowerOptions"
                  :key="option.value"
                  type="button"
                  :class="{ 'is-selected': state.profile.coBorrower === option.value }"
                  :aria-pressed="state.profile.coBorrower === option.value"
                  @click="chooseCoBorrower(option.value)"
                >
                  <UIcon :name="option.icon" />
                  <span>
                    <strong>{{ option.label }}</strong>
                    <small>{{ option.description }}</small>
                  </span>
                  <UIcon class="preparation-option__check" :name="state.profile.coBorrower === option.value ? 'i-lucide-circle-check-big' : 'i-lucide-circle'" />
                </button>
              </div>
            </div>

            <div class="preparation-section preparation-section--amounts">
              <div class="preparation-section__heading">
                <span>05</span>
                <div>
                  <h3>Trzy orientacyjne kwoty</h3>
                  <p>Opcjonalne — wpisz tylko to, co już wiesz.</p>
                </div>
              </div>
              <div class="preparation-amounts">
                <UFormField label="Budżet lub wartość celu" hint="opcjonalne">
                  <UInput
                    v-model="state.profile.propertyBudget"
                    inputmode="numeric"
                    placeholder="np. 750 000 zł"
                    icon="i-lucide-house"
                  />
                </UFormField>
                <UFormField label="Dostępne środki własne" hint="opcjonalne">
                  <UInput
                    v-model="state.profile.ownFunds"
                    inputmode="numeric"
                    placeholder="np. 150 000 zł"
                    icon="i-lucide-wallet-cards"
                  />
                </UFormField>
                <UFormField label="Komfortowa miesięczna rata" hint="opcjonalne">
                  <UInput
                    v-model="state.profile.comfortablePayment"
                    inputmode="numeric"
                    placeholder="np. do 4 000 zł"
                    icon="i-lucide-gauge"
                  />
                </UFormField>
              </div>
              <UAlert
                :color="profileReady ? 'success' : 'neutral'"
                variant="subtle"
                :icon="profileReady ? 'i-lucide-circle-check-big' : 'i-lucide-info'"
                :title="profileReady ? 'Mamy dobry punkt startu' : 'Możesz przejść dalej w każdej chwili'"
                :description="profileReady
                  ? 'Na tej podstawie dopasowaliśmy checklistę i pytania.'
                  : 'Uzupełnione odpowiedzi pozwolą lepiej dopasować kolejne kroki, ale nic nie jest obowiązkowe.'"
              />
            </div>
          </template>

          <template v-else-if="state.activeStep === 1">
            <header class="preparation-card__header">
              <p>KROK 2 · KREDYT BEZ ŻARGONU</p>
              <h2>Sześć rzeczy, które naprawdę warto rozumieć.</h2>
              <p>Rozwiń te, które są dla Ciebie nowe. Każda kończy się gotowym pytaniem do eksperta.</p>
            </header>

            <div class="preparation-concepts">
              <details
                v-for="concept in meetingConcepts"
                :key="concept.id"
                :open="state.readConceptIds.includes(concept.id)"
                @toggle="markConceptRead(concept.id, $event)"
              >
                <summary>
                  <span class="preparation-concept__icon"><UIcon :name="concept.icon" /></span>
                  <span>
                    <strong>{{ concept.title }}</strong>
                    <small>{{ concept.lead }}</small>
                  </span>
                  <UIcon class="preparation-concept__chevron" name="i-lucide-chevron-down" />
                </summary>
                <div class="preparation-concept__content">
                  <p>{{ concept.explanation }}</p>
                  <div>
                    <span>WARTO ZAPYTAĆ</span>
                    <strong>„{{ concept.question }}”</strong>
                  </div>
                </div>
              </details>
            </div>

            <p class="preparation-skip-note">
              <UIcon name="i-lucide-info" />
              To edukacyjne wprowadzenie, nie rekomendacja konkretnej oferty ani ocena zdolności.
            </p>
          </template>

          <template v-else-if="state.activeStep === 2">
            <header class="preparation-card__header">
              <p>KROK 3 · CO PRZYGOTOWAĆ</p>
              <h2>Przygotuj liczby, nie segregator dokumentów.</h2>
              <p>Na pierwszą rozmowę zwykle wystarczy, że znasz poniższe informacje. Dokładną listę dokumentów ekspert dopasuje później.</p>
            </header>

            <UAlert
              color="neutral"
              variant="subtle"
              icon="i-lucide-shield-check"
              title="Nie przesyłaj tu dokumentów ani numerów identyfikacyjnych"
              description="Ta checklista jest prywatną pomocą. Zaznacz tylko, co masz już pod ręką lub potrafisz omówić."
            />

            <div class="preparation-checklist-progress">
              <span>{{ checkedVisibleCount }} z {{ checklistItems.length }} tematów przygotowanych</span>
              <div class="preparation-progress preparation-progress--light" role="progressbar" :aria-valuenow="checkedVisibleCount" aria-valuemin="0" :aria-valuemax="checklistItems.length">
                <span :style="{ width: `${Math.round((checkedVisibleCount / Math.max(1, checklistItems.length)) * 100)}%` }" />
              </div>
            </div>

            <div class="preparation-checklist">
              <section v-for="group in checklistGroups" :key="group.label">
                <h3>{{ group.label }}</h3>
                <div>
                  <button
                    v-for="item in group.items"
                    :key="item.id"
                    type="button"
                    role="checkbox"
                    :aria-checked="state.checkedItemIds.includes(item.id)"
                    :class="{ 'is-checked': state.checkedItemIds.includes(item.id) }"
                    @click="toggleChecklistItem(item.id)"
                  >
                    <UIcon :name="state.checkedItemIds.includes(item.id) ? 'i-lucide-square-check-big' : 'i-lucide-square'" />
                    <span>
                      <strong>{{ item.label }}</strong>
                      <small>{{ item.description }}</small>
                    </span>
                  </button>
                </div>
              </section>
            </div>
          </template>

          <template v-else-if="state.activeStep === 3">
            <header class="preparation-card__header preparation-card__header--questions">
              <div>
                <p>KROK 4 · TWOJA AGENDA</p>
                <h2>Wybierz pytania, z którymi chcesz wyjść ze spotkania.</h2>
                <p>Pięć dobrze dobranych pytań zwykle daje więcej niż długa, przypadkowa lista.</p>
              </div>
              <div class="preparation-question-count">
                <strong>{{ state.selectedQuestionIds.length }}</strong>
                <span>wybranych</span>
              </div>
            </header>

            <div class="preparation-question-recommendation">
              <div>
                <UIcon name="i-lucide-sparkles" />
                <span>
                  <strong>Zestaw na dobry początek</strong>
                  <small>Wybraliśmy {{ recommendedIds.length }} pytań na podstawie Twojego punktu startu.</small>
                </span>
              </div>
              <UButton color="neutral" variant="outline" icon="i-lucide-list-plus" @click="addRecommendedQuestions">
                Dodaj zestaw
              </UButton>
            </div>

            <div class="preparation-questions">
              <section v-for="group in questionGroups" :key="group.label">
                <h3>{{ group.label }}</h3>
                <div>
                  <button
                    v-for="question in group.items"
                    :key="question.id"
                    type="button"
                    role="checkbox"
                    :aria-checked="state.selectedQuestionIds.includes(question.id)"
                    :class="{ 'is-selected': state.selectedQuestionIds.includes(question.id) }"
                    @click="toggleQuestion(question.id)"
                  >
                    <UIcon :name="state.selectedQuestionIds.includes(question.id) ? 'i-lucide-square-check-big' : 'i-lucide-square'" />
                    <span>
                      <span v-if="questionIsRecommended(question)" class="preparation-question__badge">REKOMENDOWANE</span>
                      <strong>{{ question.text }}</strong>
                      <small>{{ question.why }}</small>
                    </span>
                  </button>
                </div>
              </section>
            </div>

            <UFormField
              label="Twoje własne pytanie"
              description="Opcjonalnie — dopisz temat, którego nie ma na liście."
            >
              <UTextarea
                v-model="state.customQuestion"
                autoresize
                :rows="3"
                :maxrows="6"
                maxlength="600"
                placeholder="Np. czy moja sytuacja zawodowa wymaga dodatkowych dokumentów?"
                class="w-full"
              />
            </UFormField>
          </template>

          <template v-else>
            <header class="preparation-card__header">
              <p>KROK 5 · TWÓJ BRIEF</p>
              <h2>Masz plan na konkretną rozmowę.</h2>
              <p>Podsumowanie możesz mieć otwarte podczas spotkania, skopiować do notatek albo zapisać jako PDF.</p>
            </header>

            <div class="preparation-ready">
              <span><UIcon name="i-lucide-circle-check-big" /></span>
              <div>
                <p>GOTOWOŚĆ DO ROZMOWY</p>
                <h3>{{ progress >= 80 ? 'Masz wszystko, żeby przejść do konkretów' : 'Masz już dobry punkt startu' }}</h3>
                <p>
                  Przygotowano {{ countWithNoun(checkedVisibleCount, 'temat', 'tematy', 'tematów') }}
                  i {{ countWithNoun(selectedQuestions.length, 'pytanie', 'pytania', 'pytań') }}.
                  Brakujące elementy możecie uzupełnić razem na spotkaniu.
                </p>
              </div>
              <strong>{{ progress }}%</strong>
            </div>

            <div class="preparation-summary">
              <section>
                <p>TWÓJ PUNKT STARTU</p>
                <dl>
                  <div>
                    <dt>Cel</dt>
                    <dd>{{ meetingGoalOptions.find(option => option.value === state.profile.goal)?.label || 'Do omówienia' }}</dd>
                  </div>
                  <div>
                    <dt>Etap</dt>
                    <dd>{{ meetingStageOptions.find(option => option.value === state.profile.stage)?.label || 'Do omówienia' }}</dd>
                  </div>
                  <div>
                    <dt>Dochody</dt>
                    <dd>{{ incomeSourceLabels(state.profile.incomeSources).join(', ') || 'Do omówienia' }}</dd>
                  </div>
                  <div>
                    <dt>Współkredytobiorca</dt>
                    <dd>{{ coBorrowerOptions.find(option => option.value === state.profile.coBorrower)?.label || 'Do omówienia' }}</dd>
                  </div>
                </dl>
                <div v-if="state.profile.propertyBudget || state.profile.ownFunds || state.profile.comfortablePayment" class="preparation-summary__amounts">
                  <span v-if="state.profile.propertyBudget">Budżet: <strong>{{ state.profile.propertyBudget }}</strong></span>
                  <span v-if="state.profile.ownFunds">Środki własne: <strong>{{ state.profile.ownFunds }}</strong></span>
                  <span v-if="state.profile.comfortablePayment">Komfortowa rata: <strong>{{ state.profile.comfortablePayment }}</strong></span>
                </div>
              </section>

              <section>
                <p>PYTANIA NA SPOTKANIE · {{ selectedQuestions.length }}</p>
                <ol v-if="selectedQuestions.length">
                  <li v-for="question in selectedQuestions" :key="question.id">{{ question.text }}</li>
                  <li v-if="state.customQuestion.trim()">{{ state.customQuestion.trim() }}</li>
                </ol>
                <div v-else class="preparation-summary__empty">
                  <UIcon name="i-lucide-message-circle-question" />
                  <p>Wróć o krok i wybierz pytania, które chcesz zadać.</p>
                </div>
              </section>
            </div>

            <div class="preparation-meeting-plan">
              <p>NA SPOTKANIU</p>
              <ol>
                <li><span>1</span><div><strong>Cel i punkt startu</strong><small>Ekspert porządkuje Twoją sytuację.</small></div></li>
                <li><span>2</span><div><strong>Realne scenariusze</strong><small>Porównujecie możliwości, koszty i ryzyka.</small></div></li>
                <li><span>3</span><div><strong>Plan działania</strong><small>Ustalicie kolejne kroki i właściwą listę dokumentów.</small></div></li>
              </ol>
            </div>

            <div class="preparation-summary-actions">
              <UButton color="neutral" variant="outline" icon="i-lucide-copy" @click="copySummary">
                Skopiuj podsumowanie
              </UButton>
              <UButton color="neutral" variant="outline" icon="i-lucide-printer" @click="printSummary">
                Drukuj lub zapisz PDF
              </UButton>
            </div>

            <UAlert
              color="neutral"
              variant="subtle"
              icon="i-lucide-lock-keyhole"
              title="Ten brief jest tylko dla Ciebie"
              description="Nie wysyłamy go ekspertowi automatycznie. Jeśli chcesz, możesz skopiować podsumowanie i samodzielnie wykorzystać je w rozmowie."
            />
          </template>

          <footer class="preparation-card__footer">
            <UButton
              v-if="state.activeStep > 0"
              color="neutral"
              variant="ghost"
              icon="i-lucide-arrow-left"
              @click="previousStep"
            >
              Wstecz
            </UButton>
            <span v-else />

            <div>
              <UButton
                v-if="state.activeStep < steps.length - 1"
                color="neutral"
                variant="solid"
                trailing
                icon="i-lucide-arrow-right"
                @click="nextStep"
              >
                {{ state.activeStep === 0 && !profileReady ? 'Dalej — uzupełnię później' : 'Dalej' }}
              </UButton>
              <UButton
                v-else
                color="neutral"
                variant="solid"
                trailing
                icon="i-lucide-arrow-right"
                @click="completePreparation"
              >
                {{ state.completedAt ? 'Wróć do „Co teraz”' : 'Gotowe — wróć do „Co teraz”' }}
              </UButton>
            </div>
          </footer>
        </section>
      </section>

      <details class="preparation-sources">
        <summary>
          <span><UIcon name="i-lucide-shield-check" /> Skąd pochodzą te informacje?</span>
          <UIcon name="i-lucide-chevron-down" />
        </summary>
        <div>
          <p>
            Materiał opracowano na podstawie aktualnych źródeł konsumenckich i regulacyjnych.
            Ma charakter edukacyjny — wymagania i warunki zależą od banku, produktu i Twojej sytuacji.
          </p>
          <ul>
            <li v-for="source in preparationSources" :key="source.href">
              <a :href="source.href" target="_blank" rel="noopener noreferrer">
                {{ source.label }} <UIcon name="i-lucide-external-link" />
              </a>
            </li>
          </ul>
        </div>
      </details>
    </main>
  </div>
</template>

<style scoped>
.meeting-preparation {
  min-height: 100dvh;
  background: var(--ui-bg-muted);
}

.meeting-preparation__main {
  width: min(1180px, calc(100% - 48px));
  margin: 0 auto;
  padding: 28px 0 100px;
}

.preparation-back {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 20px;
  color: var(--ui-text-toned);
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
}

.preparation-back:hover { color: var(--ui-text-highlighted); }
.preparation-back svg { width: 16px; height: 16px; }

.preparation-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(310px, 0.65fr);
  gap: 34px;
  min-height: 410px;
  padding: 38px;
  border-radius: 22px;
  background: var(--ui-bg-inverted);
  color: var(--ui-text-inverted);
}

.preparation-hero__copy {
  display: flex;
  align-items: flex-start;
  flex-direction: column;
  justify-content: center;
  max-width: 670px;
}

.preparation-eyebrow,
.preparation-hero h1,
.preparation-hero__lead,
.preparation-hero__progress p,
.preparation-meeting-card p,
.preparation-meeting-card h2 {
  margin: 0;
}

.preparation-eyebrow {
  margin-bottom: 17px;
  color: rgb(255 255 255 / 58%);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.13em;
}

.preparation-hero h1 {
  max-width: 620px;
  color: var(--ui-text-inverted);
  font-size: clamp(38px, 4.5vw, 60px);
  line-height: 1.02;
}

.preparation-hero__lead {
  max-width: 620px;
  margin-top: 18px;
  color: rgb(255 255 255 / 67%);
  font-size: 16px;
  line-height: 1.6;
}

.preparation-hero__progress {
  width: min(100%, 530px);
  margin-top: 30px;
}

.preparation-hero__progress > div:first-child {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 9px;
  color: rgb(255 255 255 / 62%);
  font-size: 12px;
}

.preparation-hero__progress strong { color: #fff; font-size: 13px; }

.preparation-progress {
  height: 5px;
  overflow: hidden;
  border-radius: 999px;
  background: rgb(255 255 255 / 17%);
}

.preparation-progress > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: #fff;
  transition: width 240ms ease;
}

.preparation-hero__actions {
  display: flex;
  align-items: center;
  gap: 18px;
  margin-top: 25px;
}

.preparation-hero__actions :deep(button) {
  border-color: #fff;
  background: #fff;
  color: #000;
}

.preparation-hero__actions > span {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: rgb(255 255 255 / 51%);
  font-size: 11px;
}

.preparation-hero__actions > span svg { width: 14px; height: 14px; }

.preparation-meeting-card {
  align-self: stretch;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-width: 0;
  padding: 23px;
  border: 1px solid rgb(255 255 255 / 16%);
  border-radius: 18px;
  background: rgb(255 255 255 / 9%);
}

.preparation-meeting-card__top,
.preparation-meeting-card__date-row,
.preparation-meeting-card__meta,
.preparation-meeting-card__expert {
  display: flex;
  align-items: center;
}

.preparation-meeting-card__top {
  justify-content: space-between;
  gap: 12px;
}

.preparation-meeting-card__top > p {
  color: rgb(255 255 255 / 55%);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.13em;
}

.preparation-meeting-card__top > svg { width: 18px; height: 18px; color: rgb(255 255 255 / 66%); }

.preparation-meeting-card__date-row {
  gap: 15px;
  margin: 24px 0;
}

.preparation-meeting-card__date {
  display: grid;
  flex: 0 0 auto;
  width: 62px;
  height: 68px;
  place-content: center;
  border-radius: 13px;
  background: #fff;
  color: #000;
  text-align: center;
}

.preparation-meeting-card__date strong { font-size: 24px; font-weight: 500; line-height: 1; }
.preparation-meeting-card__date small { margin-top: 4px; font-size: 9px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; }

.preparation-meeting-card h2 {
  color: #fff;
  font-size: 17px;
  line-height: 1.28;
}

.preparation-meeting-card__date-row p,
.preparation-meeting-card__empty p {
  margin-top: 5px;
  color: rgb(255 255 255 / 55%);
  font-size: 11px;
}

.preparation-meeting-card__meta {
  flex-wrap: wrap;
  gap: 9px 14px;
  padding: 16px 0;
  border-top: 1px solid rgb(255 255 255 / 16%);
  border-bottom: 1px solid rgb(255 255 255 / 16%);
}

.preparation-meeting-card__meta span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: rgb(255 255 255 / 69%);
  font-size: 11px;
}

.preparation-meeting-card__meta svg { width: 14px; height: 14px; }

.preparation-meeting-card__expert {
  gap: 11px;
  padding-top: 19px;
}

.preparation-meeting-card__avatar {
  display: grid;
  flex: 0 0 auto;
  width: 43px;
  height: 43px;
  overflow: hidden;
  place-items: center;
  border-radius: 999px;
  background: rgb(255 255 255 / 13%);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
}

.preparation-meeting-card__avatar img { width: 100%; height: 100%; object-fit: cover; }
.preparation-meeting-card__expert strong { color: #fff; font-size: 13px; }
.preparation-meeting-card__expert p { margin-top: 2px; color: rgb(255 255 255 / 48%); font-size: 10px; }

.preparation-workspace {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 20px;
  align-items: start;
  margin-top: 24px;
  scroll-margin-top: 24px;
}

.preparation-steps,
.preparation-card,
.preparation-sources {
  border: 1px solid var(--portal-line);
  background: var(--ui-bg);
}

.preparation-steps {
  position: sticky;
  top: 24px;
  padding: 18px;
  border-radius: 18px;
}

.preparation-steps__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
  padding: 0 3px;
}

.preparation-steps__heading p { margin: 0; color: var(--ui-text-muted); font-size: 9px; font-weight: 700; letter-spacing: 0.12em; }
.preparation-steps__heading span { color: var(--ui-text-muted); font-size: 10px; }
.preparation-steps ol { display: grid; gap: 5px; margin: 0; padding: 0; list-style: none; }

.preparation-steps button {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  width: 100%;
  padding: 9px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: var(--ui-text-toned);
  text-align: left;
  cursor: pointer;
}

.preparation-steps button:hover { background: var(--ui-bg-muted); }
.preparation-steps button.is-active { background: var(--ui-bg-inverted); color: var(--ui-text-inverted); }

.preparation-steps__index {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  background: var(--ui-bg);
  color: var(--ui-text-highlighted);
}

.preparation-steps button.is-active .preparation-steps__index { border-color: rgb(255 255 255 / 24%); background: rgb(255 255 255 / 10%); color: #fff; }
.preparation-steps button.is-complete:not(.is-active) .preparation-steps__index { border-color: var(--ui-color-success-200); background: var(--ui-color-success-50); color: var(--ui-color-success-700); }
.preparation-steps__index svg { width: 17px; height: 17px; }
.preparation-steps button strong, .preparation-steps button small { display: block; }
.preparation-steps button strong { font-size: 12px; font-weight: 650; }
.preparation-steps button small { margin-top: 1px; color: var(--ui-text-muted); font-size: 9px; }
.preparation-steps button.is-active small { color: rgb(255 255 255 / 52%); }

.preparation-steps__privacy {
  display: flex;
  gap: 8px;
  margin-top: 15px;
  padding: 13px 4px 2px;
  border-top: 1px solid var(--portal-line);
  color: var(--ui-text-muted);
}

.preparation-steps__privacy svg { flex: 0 0 auto; width: 15px; height: 15px; margin-top: 2px; }
.preparation-steps__privacy p { margin: 0; font-size: 9px; line-height: 1.45; }

.preparation-card {
  min-width: 0;
  padding: 34px;
  border-radius: 20px;
}

.preparation-card__header { max-width: 740px; margin-bottom: 30px; }
.preparation-card__header > p:first-child { margin: 0 0 9px; color: var(--ui-text-muted); font-size: 9px; font-weight: 700; letter-spacing: 0.12em; }
.preparation-card__header h2 { margin: 0; font-size: clamp(29px, 3.2vw, 42px); line-height: 1.1; }
.preparation-card__header > p:last-child { max-width: 680px; margin: 13px 0 0; color: var(--ui-text-muted); font-size: 14px; line-height: 1.55; }

.preparation-section + .preparation-section {
  margin-top: 32px;
  padding-top: 32px;
  border-top: 1px solid var(--portal-line);
}

.preparation-section__heading { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 16px; }
.preparation-section__heading > span { display: grid; flex: 0 0 auto; width: 30px; height: 30px; place-items: center; border-radius: 9px; background: var(--ui-bg-inverted); color: var(--ui-text-inverted); font-size: 10px; font-weight: 700; }
.preparation-section__heading h3, .preparation-section__heading p { margin: 0; }
.preparation-section__heading h3 { font-size: 19px; line-height: 1.3; }
.preparation-section__heading p { margin-top: 2px; color: var(--ui-text-muted); font-size: 12px; }

.preparation-options { display: grid; gap: 10px; }
.preparation-options--two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.preparation-options--three { grid-template-columns: repeat(3, minmax(0, 1fr)); }

.preparation-options button {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) 19px;
  gap: 10px;
  align-items: start;
  min-height: 88px;
  padding: 15px;
  border: 1px solid var(--ui-border);
  border-radius: 14px;
  background: var(--ui-bg);
  color: var(--ui-text);
  text-align: left;
  cursor: pointer;
}

.preparation-options button:hover { border-color: var(--ui-border-accented); background: var(--ui-bg-muted); }
.preparation-options button.is-selected { border-color: #000; background: var(--ui-bg-inverted); color: var(--ui-text-inverted); }
.preparation-options button > svg:first-child { width: 21px; height: 21px; margin-top: 1px; }
.preparation-options strong, .preparation-options small { display: block; }
.preparation-options strong { color: var(--ui-text-highlighted); font-size: 13px; font-weight: 650; line-height: 1.35; }
.preparation-options small { margin-top: 4px; color: var(--ui-text-muted); font-size: 10px; line-height: 1.4; }
.preparation-options button.is-selected strong { color: #fff; }
.preparation-options button.is-selected small { color: rgb(255 255 255 / 55%); }
.preparation-option__check { width: 18px; height: 18px; color: var(--ui-text-muted); }
.preparation-options button.is-selected .preparation-option__check { color: #fff; }

.preparation-amounts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 15px; }

.preparation-concepts { display: grid; gap: 10px; }
.preparation-concepts details { border: 1px solid var(--ui-border); border-radius: 15px; background: var(--ui-bg); }
.preparation-concepts details[open] { border-color: var(--ui-border-accented); background: var(--ui-bg-muted); }
.preparation-concepts summary { display: grid; grid-template-columns: 42px minmax(0, 1fr) 20px; gap: 13px; align-items: center; padding: 17px; list-style: none; cursor: pointer; }
.preparation-concepts summary::-webkit-details-marker { display: none; }
.preparation-concept__icon { display: grid; width: 40px; height: 40px; place-items: center; border-radius: 11px; background: var(--ui-bg-elevated); color: var(--ui-text-highlighted); }
.preparation-concept__icon svg { width: 19px; height: 19px; }
.preparation-concepts summary strong, .preparation-concepts summary small { display: block; }
.preparation-concepts summary strong { color: var(--ui-text-highlighted); font-size: 14px; font-weight: 650; line-height: 1.35; }
.preparation-concepts summary small { margin-top: 3px; color: var(--ui-text-muted); font-size: 11px; line-height: 1.4; }
.preparation-concept__chevron { width: 18px; height: 18px; transition: transform 160ms ease; }
.preparation-concepts details[open] .preparation-concept__chevron { transform: rotate(180deg); }
.preparation-concept__content { padding: 0 17px 17px 72px; }
.preparation-concept__content > p { margin: 0; color: var(--ui-text-toned); font-size: 12px; line-height: 1.6; }
.preparation-concept__content > div { margin-top: 13px; padding: 13px; border-left: 3px solid #000; border-radius: 0 10px 10px 0; background: var(--ui-bg); }
.preparation-concept__content > div span, .preparation-concept__content > div strong { display: block; }
.preparation-concept__content > div span { margin-bottom: 4px; color: var(--ui-text-muted); font-size: 8px; font-weight: 700; letter-spacing: 0.11em; }
.preparation-concept__content > div strong { color: var(--ui-text-highlighted); font-size: 12px; font-weight: 600; line-height: 1.5; }

.preparation-skip-note { display: flex; align-items: flex-start; gap: 8px; margin: 18px 0 0; color: var(--ui-text-muted); font-size: 10px; }
.preparation-skip-note svg { flex: 0 0 auto; width: 14px; height: 14px; }

.preparation-checklist-progress { margin: 22px 0 27px; }
.preparation-checklist-progress > span { display: block; margin-bottom: 7px; color: var(--ui-text-muted); font-size: 11px; }
.preparation-progress--light { height: 6px; background: var(--ui-bg-elevated); }
.preparation-progress--light > span { background: var(--ui-bg-inverted); }

.preparation-checklist { display: grid; gap: 28px; }
.preparation-checklist h3, .preparation-questions h3 { margin: 0 0 10px; color: var(--ui-text-muted); font-size: 9px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; }
.preparation-checklist section > div, .preparation-questions section > div { display: grid; gap: 8px; }
.preparation-checklist button, .preparation-questions button { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 11px; width: 100%; padding: 14px; border: 1px solid var(--ui-border); border-radius: 13px; background: var(--ui-bg); color: var(--ui-text); text-align: left; cursor: pointer; }
.preparation-checklist button:hover, .preparation-questions button:hover { border-color: var(--ui-border-accented); background: var(--ui-bg-muted); }
.preparation-checklist button.is-checked, .preparation-questions button.is-selected { border-color: #000; background: var(--ui-bg-muted); }
.preparation-checklist button > svg, .preparation-questions button > svg { width: 20px; height: 20px; margin-top: 1px; }
.preparation-checklist button.is-checked > svg, .preparation-questions button.is-selected > svg { color: var(--ui-text-highlighted); }
.preparation-checklist button strong, .preparation-checklist button small, .preparation-questions button strong, .preparation-questions button small { display: block; }
.preparation-checklist button strong, .preparation-questions button strong { color: var(--ui-text-highlighted); font-size: 12px; font-weight: 650; line-height: 1.4; }
.preparation-checklist button small, .preparation-questions button small { margin-top: 3px; color: var(--ui-text-muted); font-size: 10px; line-height: 1.45; }

.preparation-card__header--questions { display: flex; align-items: flex-end; justify-content: space-between; gap: 28px; max-width: none; }
.preparation-card__header--questions > div:first-child { max-width: 680px; }
.preparation-card__header--questions > div:first-child > p:first-child { margin: 0 0 9px; color: var(--ui-text-muted); font-size: 9px; font-weight: 700; letter-spacing: 0.12em; }
.preparation-card__header--questions > div:first-child > p:last-child { margin: 13px 0 0; color: var(--ui-text-muted); font-size: 14px; }
.preparation-question-count { flex: 0 0 auto; text-align: right; }
.preparation-question-count strong, .preparation-question-count span { display: block; }
.preparation-question-count strong { color: var(--ui-text-highlighted); font-size: 35px; font-weight: 400; line-height: 1; }
.preparation-question-count span { margin-top: 4px; color: var(--ui-text-muted); font-size: 9px; }

.preparation-question-recommendation { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 26px; padding: 16px; border: 1px solid var(--ui-border-accented); border-radius: 14px; background: var(--ui-bg-muted); }
.preparation-question-recommendation > div { display: flex; align-items: center; gap: 10px; }
.preparation-question-recommendation > div > svg { flex: 0 0 auto; width: 21px; height: 21px; }
.preparation-question-recommendation strong, .preparation-question-recommendation small { display: block; }
.preparation-question-recommendation strong { color: var(--ui-text-highlighted); font-size: 12px; }
.preparation-question-recommendation small { margin-top: 2px; color: var(--ui-text-muted); font-size: 10px; }
.preparation-questions { display: grid; gap: 25px; margin-bottom: 26px; }
.preparation-question__badge { display: inline-flex; margin-bottom: 5px; padding: 2px 5px; border-radius: 5px; background: var(--ui-bg-inverted); color: var(--ui-text-inverted); font-size: 7px; font-weight: 700; letter-spacing: 0.08em; }

.preparation-ready { display: grid; grid-template-columns: 48px minmax(0, 1fr) auto; gap: 15px; align-items: center; margin-bottom: 24px; padding: 19px; border-radius: 16px; background: var(--ui-bg-inverted); color: var(--ui-text-inverted); }
.preparation-ready > span { display: grid; width: 46px; height: 46px; place-items: center; border-radius: 999px; background: rgb(255 255 255 / 12%); }
.preparation-ready > span svg { width: 23px; height: 23px; }
.preparation-ready p, .preparation-ready h3 { margin: 0; }
.preparation-ready > div > p:first-child { color: rgb(255 255 255 / 53%); font-size: 8px; font-weight: 700; letter-spacing: 0.12em; }
.preparation-ready h3 { margin-top: 4px; color: #fff; font-size: 18px; }
.preparation-ready > div > p:last-child { margin-top: 4px; color: rgb(255 255 255 / 58%); font-size: 10px; }
.preparation-ready > strong { font-size: 24px; font-weight: 400; }

.preparation-summary { display: grid; grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr); gap: 12px; }
.preparation-summary > section { padding: 20px; border: 1px solid var(--ui-border); border-radius: 15px; }
.preparation-summary > section > p:first-child, .preparation-meeting-plan > p { margin: 0 0 14px; color: var(--ui-text-muted); font-size: 8px; font-weight: 700; letter-spacing: 0.12em; }
.preparation-summary dl { display: grid; gap: 9px; margin: 0; }
.preparation-summary dl > div { display: grid; grid-template-columns: 90px minmax(0, 1fr); gap: 10px; padding-bottom: 9px; border-bottom: 1px solid var(--ui-border-muted); }
.preparation-summary dt { color: var(--ui-text-muted); font-size: 10px; }
.preparation-summary dd { margin: 0; color: var(--ui-text-highlighted); font-size: 11px; font-weight: 600; }
.preparation-summary__amounts { display: grid; gap: 4px; margin-top: 12px; color: var(--ui-text-muted); font-size: 10px; }
.preparation-summary__amounts strong { color: var(--ui-text-highlighted); }
.preparation-summary ol { display: grid; gap: 9px; margin: 0; padding-left: 20px; }
.preparation-summary li { padding-left: 4px; color: var(--ui-text-toned); font-size: 10px; line-height: 1.45; }
.preparation-summary__empty { display: flex; align-items: center; gap: 10px; color: var(--ui-text-muted); }
.preparation-summary__empty svg { width: 22px; height: 22px; }
.preparation-summary__empty p { margin: 0; font-size: 10px; }

.preparation-meeting-plan { margin-top: 12px; padding: 20px; border: 1px solid var(--ui-border); border-radius: 15px; background: var(--ui-bg-muted); }
.preparation-meeting-plan ol { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 13px; margin: 0; padding: 0; list-style: none; }
.preparation-meeting-plan li { display: flex; gap: 9px; }
.preparation-meeting-plan li > span { display: grid; flex: 0 0 auto; width: 25px; height: 25px; place-items: center; border-radius: 8px; background: var(--ui-bg-inverted); color: var(--ui-text-inverted); font-size: 9px; }
.preparation-meeting-plan strong, .preparation-meeting-plan small { display: block; }
.preparation-meeting-plan strong { color: var(--ui-text-highlighted); font-size: 10px; }
.preparation-meeting-plan small { margin-top: 2px; color: var(--ui-text-muted); font-size: 8px; line-height: 1.4; }

.preparation-summary-actions { display: flex; flex-wrap: wrap; gap: 9px; margin: 18px 0 12px; }

.preparation-card__footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 34px; padding-top: 22px; border-top: 1px solid var(--portal-line); }

.preparation-sources { margin-top: 20px; border-radius: 16px; }
.preparation-sources summary { display: flex; align-items: center; justify-content: space-between; gap: 15px; padding: 17px 20px; list-style: none; color: var(--ui-text-toned); font-size: 11px; font-weight: 600; cursor: pointer; }
.preparation-sources summary::-webkit-details-marker { display: none; }
.preparation-sources summary span { display: inline-flex; align-items: center; gap: 8px; }
.preparation-sources summary svg { width: 16px; height: 16px; }
.preparation-sources > div { padding: 0 20px 20px; }
.preparation-sources > div > p { max-width: 760px; margin: 0 0 13px; color: var(--ui-text-muted); font-size: 10px; line-height: 1.5; }
.preparation-sources ul { display: flex; flex-wrap: wrap; gap: 8px 17px; margin: 0; padding: 0; list-style: none; }
.preparation-sources a { display: inline-flex; align-items: center; gap: 4px; color: var(--ui-text-toned); font-size: 10px; }
.preparation-sources a svg { width: 11px; height: 11px; }

@media (max-width: 960px) {
  .preparation-hero { grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr); padding: 30px; }
  .preparation-workspace { grid-template-columns: 220px minmax(0, 1fr); }
  .preparation-card { padding: 28px; }
  .preparation-options--three, .preparation-amounts { grid-template-columns: 1fr; }
  .preparation-summary { grid-template-columns: 1fr; }
}

@media (max-width: 760px) {
  .meeting-preparation__main { width: min(640px, calc(100% - 32px)); padding: 22px 0 70px; }
  .preparation-hero { grid-template-columns: 1fr; min-height: 0; gap: 28px; }
  .preparation-hero__copy { max-width: none; }
  .preparation-hero h1 { font-size: 42px; }
  .preparation-meeting-card { min-height: 300px; }
  .preparation-workspace { grid-template-columns: 1fr; }
  .preparation-steps { position: static; overflow-x: auto; padding: 14px; }
  .preparation-steps__heading, .preparation-steps__privacy { display: none; }
  .preparation-steps ol { display: flex; width: max-content; }
  .preparation-steps li { width: 175px; }
  .preparation-card__header--questions { align-items: flex-start; }
  .preparation-question-recommendation { align-items: flex-start; flex-direction: column; }
  .preparation-meeting-plan ol { grid-template-columns: 1fr; }
}

@media (max-width: 560px) {
  .meeting-preparation__main { width: calc(100% - 24px); }
  .preparation-back { margin-left: 4px; }
  .preparation-hero { padding: 25px 22px; border-radius: 18px; }
  .preparation-hero h1 { font-size: 36px; }
  .preparation-hero__lead { font-size: 14px; }
  .preparation-hero__actions { align-items: flex-start; flex-direction: column; }
  .preparation-hero__actions :deep(button) { width: 100%; }
  .preparation-meeting-card { min-height: 320px; padding: 19px; }
  .preparation-card { padding: 23px 19px; border-radius: 18px; }
  .preparation-card__header h2 { font-size: 30px; }
  .preparation-options--two { grid-template-columns: 1fr; }
  .preparation-concepts summary { grid-template-columns: 36px minmax(0, 1fr) 18px; padding: 14px; }
  .preparation-concept__icon { width: 34px; height: 34px; }
  .preparation-concept__content { padding: 0 14px 14px; }
  .preparation-card__header--questions { display: block; }
  .preparation-question-count { margin-top: 18px; text-align: left; }
  .preparation-ready { grid-template-columns: 42px minmax(0, 1fr); }
  .preparation-ready > strong { grid-column: 2; }
  .preparation-summary dl > div { grid-template-columns: 1fr; gap: 2px; }
  .preparation-card__footer { align-items: stretch; flex-direction: column-reverse; }
  .preparation-card__footer > div :deep(button), .preparation-card__footer > :deep(button) { width: 100%; }
  .preparation-summary-actions { display: grid; }
}

@media print {
  .meeting-preparation { background: #fff; }
  .meeting-preparation :deep(.portal-header),
  .preparation-back,
  .preparation-hero,
  .preparation-steps,
  .preparation-card__footer,
  .preparation-summary-actions,
  .preparation-sources { display: none !important; }
  .meeting-preparation__main { width: 100%; padding: 0; }
  .preparation-workspace { display: block; margin: 0; }
  .preparation-card { padding: 0; border: 0; }
}
</style>
