<script setup lang="ts">
useLandingSeo({
  title: 'Dołącz do waitlisty — OpenExpert',
  description: 'Zapisz się na wczesny dostęp do OpenExpert.',
  path: '/waitlist',
  robots: 'noindex, follow',
})

interface SurveyStep {
  id: string
  label: string
  question: string
  type: 'multi' | 'single' | 'text'
  options: string[]
  placeholder?: string
}

const SURVEY_STEPS: SurveyStep[] = [
  {
    id: 'domain',
    label: 'Twoja dziedzina',
    question: 'Jaką dziedziną ekspercką się zajmujesz?',
    type: 'multi',
    options: [
      'Finanse i kredyty',
      'Nieruchomości',
      'Ubezpieczenia',
      'Prawo i compliance',
      'Doradztwo podatkowe',
      'Medycyna i zdrowie',
      'Edukacja i szkolenia',
      'Inna dziedzina',
    ],
  },
  {
    id: 'usecase',
    label: 'Zastosowanie',
    question: 'Jak chcesz korzystać z platformy?',
    type: 'multi',
    options: [
      'Interfejs dla siebie lub zespołu',
      'Backend / API dla własnej aplikacji',
      'Silnik dla agentów AI',
      'Budowanie i sprzedaż modułów',
    ],
  },
  {
    id: 'priority',
    label: 'Priorytety',
    question: 'Co jest dla Ciebie najważniejsze w pierwszej kolejności?',
    type: 'single',
    options: [
      'Gotowe moduły do pobrania',
      'Możliwość budowania własnych modułów',
      'Integracja z API i zewnętrznymi danymi',
      'Obsługa agentów AI przez MCP',
      'Self-hosting i pełna kontrola danych',
    ],
  },
  {
    id: 'contrib',
    label: 'Wkład w projekt',
    question: 'Czy jesteś otwarty/a na współtworzenie projektu?',
    type: 'single',
    options: [
      'Tak — chętnie pomogę jako developer',
      'Tak — mogę testować i dawać feedback',
      'Tak — mogę budować i publikować moduły',
      'Nie, interesuje mnie tylko używanie',
    ],
  },
  {
    id: 'notes',
    label: 'Uwagi',
    question: 'Co jeszcze chcesz nam powiedzieć?',
    type: 'text',
    options: [],
    placeholder: 'Przypadek użycia, pomysł na moduł, pytanie — cokolwiek przychodzi do głowy.',
  },
]

const TOTAL_STEPS = 1 + SURVEY_STEPS.length + 1 // email + 5 survey + done = 7

// ── State ───────────────────────────────────────────────────────────────────
const step       = ref(0)
const email      = ref('')
const answers    = ref<Record<string, string | string[]>>({})
const loading    = ref(false)
const submitErr  = ref<string | null>(null)
const emailErr   = ref(false)
const emailSaved = ref(false) // true after email saved to DB, before survey starts
const surveyToken = ref('')

// ── LocalStorage persistence ─────────────────────────────────────────────────
onMounted(() => {
  const saved = localStorage.getItem('oe-waitlist')
  if (saved) {
    try {
      const {
        step: s,
        email: e,
        answers: a,
        emailSaved: es,
        surveyToken: token,
      } = JSON.parse(saved)
      // Don't restore completed state
      if (s < TOTAL_STEPS - 1) {
        step.value       = s
        email.value      = e
        answers.value    = a
        emailSaved.value = !!es
        surveyToken.value = typeof token === 'string' ? token : ''
      }
    } catch { /* ignore */ }
  }
})

watch([step, email, answers, emailSaved, surveyToken], () => {
  if (step.value < TOTAL_STEPS - 1) {
    localStorage.setItem('oe-waitlist', JSON.stringify({
      step:       step.value,
      email:      email.value,
      answers:    answers.value,
      emailSaved: emailSaved.value,
      surveyToken: surveyToken.value,
    }))
  }
}, { deep: true })

// ── Email step ───────────────────────────────────────────────────────────────
async function handleEmailSubmit() {
  const val = email.value.trim()
  if (!val || !val.includes('@') || !val.includes('.')) {
    emailErr.value = true
    return
  }
  emailErr.value  = false
  loading.value   = true
  submitErr.value = null

  try {
    const result = await $fetch<{ surveyToken: string }>('/api/waitlist', {
      method: 'POST',
      body: { email: val },
    })
    surveyToken.value = result.surveyToken
    emailSaved.value = true
    step.value = 1
  } catch {
    submitErr.value = 'Coś poszło nie tak — spróbuj jeszcze raz.'
  } finally {
    loading.value = false
  }
}

// ── Survey steps ─────────────────────────────────────────────────────────────
const surveyIndex   = computed(() => step.value - 1)
const currentSurvey = computed(() => SURVEY_STEPS[surveyIndex.value])

function toggleOption(id: string, opt: string, type: string) {
  if (type === 'single') {
    answers.value[id] = opt
  } else {
    const cur = (answers.value[id] as string[]) || []
    answers.value[id] = cur.includes(opt)
      ? cur.filter(x => x !== opt)
      : [...cur, opt]
  }
}

function isSelected(id: string, opt: string, type: string) {
  const val = answers.value[id]
  if (type === 'single') return val === opt
  return Array.isArray(val) && val.includes(opt)
}

const textareaValue = computed({
  get: () => (answers.value['notes'] as string) || '',
  set: (v: string) => { answers.value['notes'] = v },
})

async function nextSurvey() {
  const isLast = surveyIndex.value === SURVEY_STEPS.length - 1
  if (isLast) {
    await submitSurvey()
  } else {
    step.value += 1
  }
}

async function submitSurvey() {
  if (!surveyToken.value) {
    submitErr.value = 'Sesja ankiety wygasła. Wróć do pierwszego kroku.'
    step.value = 0
    emailSaved.value = false
    return
  }

  loading.value = true
  submitErr.value = null

  try {
    await $fetch('/api/waitlist/survey', {
      method: 'PATCH',
      body: {
        email: email.value.trim(),
        surveyToken: surveyToken.value,
        answers: answers.value,
      },
    })
    localStorage.removeItem('oe-waitlist')
    step.value = TOTAL_STEPS - 1
  } catch {
    submitErr.value = 'Nie udało się zapisać ankiety — spróbuj ponownie.'
  } finally {
    loading.value = false
  }
}

// ── Progress bar ─────────────────────────────────────────────────────────────
const progressLabel = computed(() => {
  if (step.value === 0)               return 'Waitlista'
  if (step.value < TOTAL_STEPS - 1)  return `Ankieta ${step.value}/${SURVEY_STEPS.length}`
  return 'Gotowe'
})

// ── Thank you summary ─────────────────────────────────────────────────────────
const LABELS: Record<string, string> = {
  domain:   'Dziedzina',
  usecase:  'Zastosowanie',
  priority: 'Priorytet',
  contrib:  'Wkład',
  notes:    'Uwagi',
}

const filledAnswers = computed(() =>
  Object.entries(answers.value).filter(([, v]) =>
    v && (Array.isArray(v) ? v.length > 0 : String(v).trim() !== '')
  )
)
</script>

<template>
  <div class="wl-page">
    <!-- NAV -->
    <nav class="wl-nav">
      <NuxtLink to="/" class="wl-logo">
        <picture>
          <source srcset="/assets/logo-dark.svg" media="(prefers-color-scheme: dark)">
          <img src="/assets/logo-light.svg" alt="OpenExpert" class="wl-logo-img">
        </picture>
        <span class="wl-logo-name">OpenExpert</span>
      </NuxtLink>
      <NuxtLink to="/" class="wl-back" aria-label="Wróć do strony głównej">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </NuxtLink>
    </nav>

    <!-- MAIN -->
    <main class="wl-main">
      <div class="wl-card">

        <!-- PROGRESS BAR -->
        <div class="wl-progress">
          <div
            v-for="(_, i) in TOTAL_STEPS"
            :key="i"
            class="wl-step-dot"
            :class="{ active: i === step, done: i < step }"
          />
        </div>

        <!-- STEP 0: EMAIL FORM -->
        <div v-if="step === 0 && !emailSaved" class="wl-step" :key="'email'">
          <div class="wl-eyebrow">OpenExpert — early access</div>
          <h1 class="wl-heading">Dołącz do<br><em>waitlisty.</em></h1>
          <p class="wl-sub">
            Platforma jest w budowie. Zapisz się — dostaniesz dostęp jako jeden z pierwszych
            i pomożesz kształtować to, co budujemy.
          </p>
          <div class="wl-email-row">
            <input
              v-model="email"
              type="email"
              class="wl-input"
              :class="{ error: emailErr }"
              placeholder="twoj@email.pl"
              :disabled="loading"
              autofocus
              @keyup.enter="handleEmailSubmit"
            >
            <button
              class="wl-btn-primary"
              :disabled="loading"
              @click="handleEmailSubmit"
            >
              {{ loading ? 'Zapisuję…' : 'Dołącz' }}
            </button>
          </div>
          <p v-if="emailErr" class="wl-field-error">Podaj poprawny adres email.</p>
          <p v-if="submitErr" class="wl-field-error">{{ submitErr }}</p>
          <p class="wl-privacy">Bez spamu. Tylko powiadomienie o dostępie i ważne aktualizacje projektu.</p>
        </div>

        <!-- STEPS 1–5: SURVEY -->
        <div
          v-if="step >= 1 && step < TOTAL_STEPS - 1 && currentSurvey"
          class="wl-step"
          :key="step"
        >
          <!-- Email saved confirmation banner (shown on first survey step) -->
          <div v-if="emailSaved && surveyIndex === 0" class="wl-confirm-banner">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:2px">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>Zapisano <strong>{{ email }}</strong> na waitliście — wypełnij ankietę poniżej.</span>
          </div>
          <div class="wl-eyebrow">Ankieta — pytanie {{ surveyIndex + 1 }} z {{ SURVEY_STEPS.length }}</div>
          <h1 class="wl-heading wl-heading--survey">{{ currentSurvey.question }}</h1>

          <p v-if="currentSurvey.type !== 'text'" class="wl-type-hint">
            {{ currentSurvey.type === 'multi' ? 'Możesz wybrać kilka.' : 'Wybierz jedną opcję.' }}
          </p>

          <!-- Multi / single select options -->
          <div v-if="currentSurvey.type !== 'text'" class="wl-options">
            <div
              v-for="opt in currentSurvey.options"
              :key="opt"
              class="wl-option"
              :class="{ selected: isSelected(currentSurvey.id, opt, currentSurvey.type) }"
              @click="toggleOption(currentSurvey.id, opt, currentSurvey.type)"
            >
              <div
                v-if="currentSurvey.type === 'single'"
                class="wl-option-radio"
              />
              <div
                v-else
                class="wl-option-check"
              />
              <span class="wl-option-text">{{ opt }}</span>
            </div>
          </div>

          <!-- Textarea (notes) -->
          <textarea
            v-if="currentSurvey.type === 'text'"
            v-model="textareaValue"
            class="wl-textarea"
            :placeholder="currentSurvey.placeholder ?? ''"
          />

          <!-- Nav row -->
          <div class="wl-nav-row">
            <button
              class="wl-btn-primary"
              :disabled="loading"
              @click="nextSurvey"
            >
              {{ loading ? 'Zapisuję…' : surveyIndex === SURVEY_STEPS.length - 1 ? 'Zakończ ankietę' : 'Dalej' }}
            </button>
          </div>
        </div>

        <!-- STEP 6: THANK YOU -->
        <div v-if="step === TOTAL_STEPS - 1" class="wl-step wl-thankyou" :key="TOTAL_STEPS - 1">
          <div class="wl-check-circle">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h1 class="wl-heading" style="text-align:center">Jesteś na liście.</h1>
          <p class="wl-sub" style="text-align:center">
            Odezwiemy się na <strong style="color:var(--fg-primary)">{{ email }}</strong> gdy
            platforma będzie gotowa do testów. Dziękujemy za odpowiedzi — każda z nich pomaga nam
            budować coś lepszego.
          </p>

          <div v-if="filledAnswers.length > 0" class="wl-summary">
            <div v-for="[key, val] in filledAnswers" :key="key" class="wl-summary-row">
              <span class="wl-summary-key">{{ LABELS[key] }}</span>
              <span class="wl-summary-val">{{ Array.isArray(val) ? val.join(', ') : val }}</span>
            </div>
          </div>

          <div class="wl-gh-cta">
            <div>
              <strong>Rozwijaj projekt już teraz</strong>
              <p>OpenExpert jest open-source. Możesz eksplorować kod, zgłaszać pomysły i budować pierwsze moduły.</p>
            </div>
            <a
              href="https://github.com/OpenExpertApp/OpenExpert"
              target="_blank"
              rel="noopener"
              class="wl-btn-primary wl-btn-gh"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
              </svg>
              GitHub
            </a>
          </div>
        </div>

      </div>
    </main>
  </div>
</template>

<style scoped>
/* ── LAYOUT ──────────────────────────────────────────────────────────────── */
.wl-page {
  min-height: 100vh;
  display: grid;
  grid-template-rows: 60px 1fr;
  background: var(--bg-default);
  color: var(--fg-primary);
  font-family: var(--font-sans);
}

/* ── NAV ─────────────────────────────────────────────────────────────────── */
.wl-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 48px;
  border-bottom: 1px solid var(--border-default);
}

.wl-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  color: var(--fg-primary);
}
.wl-logo-img { height: 20px; display: block; }
.wl-logo-name {
  font-size: var(--text-base);
  font-weight: var(--weight-medium);
  letter-spacing: -0.01em;
}

.wl-back {
  font-size: var(--text-sm);
  color: var(--fg-secondary);
  text-decoration: none;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: color var(--transition-fast);
}
.wl-back:hover { color: var(--fg-primary); }

/* ── MAIN ────────────────────────────────────────────────────────────────── */
.wl-main {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
}

.wl-card {
  width: 100%;
  max-width: 520px;
}

/* ── PROGRESS BAR ────────────────────────────────────────────────────────── */
.wl-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 48px;
}

.wl-step-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--border-strong);
  transition: background var(--transition-base), width var(--transition-base), border-radius var(--transition-base);
  flex-shrink: 0;
}
.wl-step-dot.active {
  background: var(--fg-primary);
  width: 24px;
  border-radius: 3px;
}
.wl-step-dot.done { background: var(--gray-400); }

.wl-step-label {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--fg-tertiary);
  margin-left: 4px;
}

/* ── STEP ANIMATION ──────────────────────────────────────────────────────── */
.wl-step {
  animation: fadeUp 200ms ease-out;
}

@keyframes fadeUp {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ── TYPOGRAPHY ──────────────────────────────────────────────────────────── */
.wl-eyebrow {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--fg-tertiary);
  letter-spacing: var(--tracking-wider);
  text-transform: uppercase;
  margin-bottom: 16px;
}

.wl-heading {
  font-size: clamp(28px, 4vw, 40px);
  font-weight: 300;
  letter-spacing: -0.03em;
  font-variation-settings: 'opsz' 40, 'wght' 300;
  line-height: 1.1;
  margin-bottom: 12px;
}
.wl-heading em {
  font-family: var(--font-serif);
  font-style: italic;
}
.wl-heading--survey {
  font-size: clamp(22px, 3vw, 32px);
  margin-bottom: 8px;
}

.wl-sub {
  font-size: var(--text-md);
  color: var(--fg-secondary);
  line-height: var(--leading-relaxed);
  margin-bottom: 40px;
}

.wl-type-hint {
  font-size: var(--text-sm);
  color: var(--fg-tertiary);
  margin-bottom: 24px;
}

/* ── EMAIL STEP ──────────────────────────────────────────────────────────── */
.wl-email-row {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.wl-input {
  flex: 1;
  min-width: 0;
  padding: 12px 16px;
  font-family: var(--font-sans);
  font-size: var(--text-base);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--bg-default);
  color: var(--fg-primary);
  outline: none;
  transition: border-color var(--transition-fast);
}
.wl-input::placeholder { color: var(--fg-tertiary); }
.wl-input:focus        { border-color: var(--border-focus); }
.wl-input.error        { border-color: var(--gray-400); }
.wl-input:disabled     { opacity: 0.6; cursor: not-allowed; }

.wl-field-error {
  font-size: var(--text-xs);
  color: var(--gray-500);
  margin-bottom: 12px;
}

.wl-privacy {
  font-size: var(--text-xs);
  color: var(--fg-tertiary);
  line-height: var(--leading-relaxed);
}

/* ── BUTTONS ─────────────────────────────────────────────────────────────── */
.wl-btn-primary {
  padding: 12px 24px;
  background: var(--fg-primary);
  color: var(--bg-default);
  border: 1px solid var(--fg-primary);
  border-radius: var(--radius-sm);
  font-family: var(--font-sans);
  font-size: var(--text-base);
  font-weight: var(--weight-medium);
  cursor: pointer;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
  transition: opacity var(--transition-fast);
}
.wl-btn-primary:hover    { opacity: 0.75; }
.wl-btn-primary:disabled { opacity: 0.4; cursor: default; }

.wl-skip {
  font-size: var(--text-sm);
  color: var(--fg-tertiary);
  cursor: pointer;
  background: none;
  border: none;
  padding: 0;
  font-family: var(--font-sans);
  transition: color var(--transition-fast);
}
.wl-skip:hover { color: var(--fg-secondary); }

/* ── SURVEY OPTIONS ──────────────────────────────────────────────────────── */
.wl-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 0;
}

.wl-option {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  cursor: pointer;
  user-select: none;
  transition: background var(--transition-fast), border-color var(--transition-fast);
}
.wl-option:hover { background: var(--bg-subtle); border-color: var(--border-strong); }
.wl-option.selected {
  background: var(--fg-primary);
  color: var(--bg-default);
  border-color: var(--fg-primary);
}

.wl-option-check {
  width: 16px;
  height: 16px;
  border: 1.5px solid var(--border-strong);
  border-radius: 2px;
  flex-shrink: 0;
  position: relative;
  transition: all var(--transition-fast);
}
.wl-option.selected .wl-option-check {
  border-color: var(--bg-default);
  background: var(--bg-default);
}
.wl-option.selected .wl-option-check::after { display: block; }
.wl-option-check::after {
  content: '';
  display: none;
  position: absolute;
  top: 1px; left: 4px;
  width: 5px; height: 9px;
  border: 1.5px solid var(--bg-default);
  border-top: none;
  border-left: none;
  transform: rotate(45deg);
}

.wl-option-radio {
  width: 16px;
  height: 16px;
  border: 1.5px solid var(--border-strong);
  border-radius: 50%;
  flex-shrink: 0;
  position: relative;
  transition: all var(--transition-fast);
}
.wl-option.selected .wl-option-radio { border-color: var(--bg-default); }
.wl-option.selected .wl-option-radio::after { display: block; }
.wl-option-radio::after {
  content: '';
  display: none;
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 6px; height: 6px;
  background: var(--bg-default);
  border-radius: 50%;
}

.wl-option-text {
  font-size: var(--text-base);
  line-height: var(--leading-snug);
}

/* ── TEXTAREA ────────────────────────────────────────────────────────────── */
.wl-textarea {
  width: 100%;
  padding: 12px 16px;
  font-family: var(--font-sans);
  font-size: var(--text-base);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-default);
  color: var(--fg-primary);
  resize: vertical;
  min-height: 96px;
  outline: none;
  line-height: var(--leading-relaxed);
  transition: border-color var(--transition-fast);
}
.wl-textarea::placeholder { color: var(--fg-tertiary); }
.wl-textarea:focus        { border-color: var(--border-focus); }

/* ── SURVEY NAV ROW ──────────────────────────────────────────────────────── */
.wl-nav-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 24px;
}

/* ── EMAIL SAVED BANNER ──────────────────────────────────────────────────── */
.wl-confirm-banner {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 14px;
  margin-bottom: 28px;
  background: var(--success-bg);
  border: 1px solid var(--success-border);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  color: var(--success-text);
  line-height: var(--leading-normal);
}
.wl-confirm-banner svg  { color: var(--success-icon); }
.wl-confirm-banner span { min-width: 0; }
.wl-confirm-banner strong {
  color: var(--success-text);
  font-weight: var(--weight-medium);
  word-break: break-all;
}

/* ── THANK YOU ───────────────────────────────────────────────────────────── */
.wl-thankyou {
  padding: 24px 0 48px;
}

.wl-check-circle {
  width: 56px;
  height: 56px;
  border: 1.5px solid var(--border-default);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 32px;
}

.wl-summary {
  margin-top: 40px;
  text-align: left;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.wl-summary-row {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--border-default);
  font-size: var(--text-sm);
}
.wl-summary-row:last-child { border-bottom: none; }

.wl-summary-key {
  color: var(--fg-tertiary);
  min-width: 120px;
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  padding-top: 2px;
}

.wl-summary-val {
  color: var(--fg-primary);
  line-height: var(--leading-normal);
}

.wl-gh-cta {
  margin-top: 32px;
  padding: 20px;
  background: var(--bg-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.wl-gh-cta > div strong {
  display: block;
  font-size: var(--text-base);
  color: var(--fg-primary);
  margin-bottom: 4px;
  font-weight: var(--weight-medium);
}

.wl-gh-cta > div p {
  font-size: var(--text-sm);
  color: var(--fg-secondary);
  line-height: var(--leading-normal);
}

.wl-btn-gh { flex-shrink: 0; }

/* ── DARK MODE ───────────────────────────────────────────────────────────── */
@media (prefers-color-scheme: dark) {
  .wl-input,
  .wl-textarea {
    background: var(--bg-muted);
    border-color: var(--border-strong);
  }

  /* Selected option: white bg (inverted) — black checkbox with white tick */
  .wl-option.selected .wl-option-check {
    background: var(--black);
    border-color: var(--black);
  }
  .wl-option.selected .wl-option-check::after {
    border-color: var(--white);
  }
  .wl-option.selected .wl-option-radio {
    border-color: var(--black);
  }
  .wl-option.selected .wl-option-radio::after {
    background: var(--black);
  }
}

/* ── RESPONSIVE ──────────────────────────────────────────────────────────── */
@media (max-width: 640px) {
  .wl-nav {
    padding: 0 20px;
  }

  .wl-back span { display: none; }

  .wl-main {
    padding: 32px 20px;
    align-items: flex-start;
  }

  .wl-progress { margin-bottom: 32px; }

  .wl-email-row {
    flex-direction: column;
  }
  .wl-btn-primary {
    justify-content: center;
    width: 100%;
  }

  .wl-gh-cta {
    flex-direction: column;
    align-items: flex-start;
  }
  .wl-btn-gh { width: 100%; justify-content: center; }

  .wl-summary-key { min-width: 90px; }
}
</style>
