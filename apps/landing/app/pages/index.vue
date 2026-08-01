<script setup lang="ts">
const { siteOrigin } = useLandingSeo({
  title: 'OpenExpert — uruchom własne pośrednictwo kredytowe',
  description: 'Platforma dla osób i firm, które chcą uruchomić lub rozwinąć pośrednictwo kredytowe: CRM w Twojej marce, uporządkowany proces, rozliczenia i agenci AI.',
  path: '/',
  socialImageAlt: 'OpenExpert — platforma do budowy własnego pośrednictwa kredytowego',
})

const homeUrl = new URL('/', `${siteOrigin}/`).toString()
const organizationId = `${homeUrl}#organization`
const websiteId = `${homeUrl}#website`
const homePageId = `${homeUrl}#webpage`
const primaryImageId = `${homeUrl}#primaryimage`

useHead({
  script: [{
    key: 'structured-data:home',
    type: 'application/ld+json',
    innerHTML: serializeLandingStructuredData({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization',
          '@id': organizationId,
          name: 'OpenExpert',
          url: homeUrl,
          logo: {
            '@type': 'ImageObject',
            url: new URL('/web-app-manifest-512x512.png', `${siteOrigin}/`).toString(),
            width: 512,
            height: 512,
          },
          email: 'hello@openexpert.app',
          sameAs: ['https://github.com/OpenExpertApp/OpenExpert'],
          description: 'Platforma dla osób i firm uruchamiających lub rozwijających pośrednictwo kredytowe: CRM, obsługa spraw, rozliczenia i agenci AI.',
        },
        {
          '@type': 'WebSite',
          '@id': websiteId,
          url: homeUrl,
          name: 'OpenExpert',
          alternateName: 'Open Expert',
          publisher: { '@id': organizationId },
          inLanguage: 'pl-PL',
        },
        {
          '@type': 'ImageObject',
          '@id': primaryImageId,
          url: new URL('/openexpert-og.png', `${siteOrigin}/`).toString(),
          width: 1200,
          height: 630,
        },
        {
          '@type': 'WebPage',
          '@id': homePageId,
          url: homeUrl,
          name: 'OpenExpert — uruchom własne pośrednictwo kredytowe',
          description: 'Platforma do uruchomienia i rozwijania pośrednictwa kredytowego pod własną marką.',
          isPartOf: { '@id': websiteId },
          about: { '@id': organizationId },
          primaryImageOfPage: { '@id': primaryImageId },
          inLanguage: 'pl-PL',
        },
      ],
    }),
  }],
})

const router = useRouter()
const WAITLIST_STORAGE_KEY = 'oe-intermediary-waitlist-v1'
const email = ref('')
const emailInput = ref<HTMLInputElement | null>(null)
const waitlistError = ref<string | null>(null)
const waitlistLoading = ref(false)
const mobileMenuOpen = ref(false)

const platformRows = [
  {
    index: '01',
    icon: 'lucide:landmark',
    role: 'Agent rozliczeń',
    title: 'Domyka sprawę i uruchamia wypłatę.',
    description: 'Po wgraniu finalnych dokumentów sprawdza ich kompletność, automatycznie rozlicza sprawę i przekazuje wypłatę do realizacji.',
    flow: [
      { label: 'Start', value: 'Finalne dokumenty' },
      { label: 'Praca', value: 'Analiza i rozliczenie' },
      { label: 'Efekt', value: 'Wypłata w realizacji' },
    ],
  },
  {
    index: '02',
    icon: 'lucide:file-check-2',
    role: 'Agent wniosków',
    title: 'Przygotowuje wnioski do Twojej weryfikacji.',
    description: 'Pobiera dane klienta i sprawy, dopasowuje je do formularza oraz przygotowuje kompletny wniosek do weryfikacji.',
    flow: [
      { label: 'Start', value: 'Dane sprawy' },
      { label: 'Praca', value: 'Uzupełnienie wniosku' },
      { label: 'Efekt', value: 'Gotowy do zatwierdzenia' },
    ],
  },
  {
    index: '03',
    icon: 'lucide:search',
    role: 'Agent okazji',
    title: 'Szuka kolejnej sprzedaży w Twoim portfelu.',
    description: 'Analizuje klientów i sprawy, aby wykrywać potencjał refinansowania, dosprzedaży oraz ponownego kontaktu.',
    flow: [
      { label: 'Start', value: 'Portfel klientów' },
      { label: 'Praca', value: 'Analiza potencjału' },
      { label: 'Efekt', value: 'Nowa okazja' },
    ],
  },
  {
    index: '04',
    icon: 'lucide:building-2',
    role: 'Agent wiedzy',
    title: 'Znajduje odpowiedź w wiedzy całej firmy.',
    description: 'Przeszukuje zagregowane procedury, dokumenty, materiały i historię spraw, podając odpowiedź we właściwym kontekście.',
    flow: [
      { label: 'Start', value: 'Pytanie' },
      { label: 'Praca', value: 'Wiedza firmowa' },
      { label: 'Efekt', value: 'Odpowiedź z kontekstem' },
    ],
  },
]

const expertPoints = [
  {
    icon: 'lucide:user-round-plus',
    title: 'Startujesz samodzielnie',
    description: 'Od pierwszego klienta pracujesz w uporządkowanym procesie, bez składania firmy z wielu osobnych narzędzi.',
  },
  {
    icon: 'lucide:building-2',
    title: 'Rozwijasz istniejącą firmę',
    description: 'Łączysz zespół, placówki i sprawy we wspólnym standardzie pracy, zachowując kontrolę nad relacją z klientem.',
  },
  {
    icon: 'lucide:badge-check',
    title: 'Budujesz własną markę',
    description: 'Dopasowujesz wygląd i sposób obsługi do swojej organizacji, a OpenExpert pozostaje technologicznym zapleczem.',
  },
]

const joinSteps = [
  {
    title: 'Zostaw kontakt',
    description: 'Podaj e-mail i przejdź do krótkiej ankiety.',
  },
  {
    title: 'Opisz swój model',
    description: 'Powiedz, czy startujesz samodzielnie, rozwijasz zespół czy istniejącą firmę.',
  },
  {
    title: 'Przygotuj się do startu',
    description: 'Damy Ci znać o dostępie i kolejnych etapach wdrożenia.',
  },
]

function closeMobileMenu() {
  mobileMenuOpen.value = false
}

async function submitWaitlist() {
  const value = email.value.trim()
  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)

  if (!isValidEmail) {
    waitlistError.value = 'Podaj poprawny adres e-mail.'
    await nextTick()
    emailInput.value?.focus()
    return
  }

  waitlistLoading.value = true
  waitlistError.value = null

  try {
    const result = await $fetch<{ surveyToken: string }>('/api/waitlist', {
      method: 'POST',
      body: { email: value },
    })

    localStorage.setItem(WAITLIST_STORAGE_KEY, JSON.stringify({
      step: 1,
      email: value,
      answers: {},
      emailSaved: true,
      surveyToken: result.surveyToken,
    }))

    await router.push('/waitlist')
  } catch {
    waitlistError.value = 'Nie udało się zapisać adresu. Spróbuj ponownie za chwilę.'
  } finally {
    waitlistLoading.value = false
  }
}
</script>

<template>
  <div class="oe-redesign" @keydown.esc="closeMobileMenu">
    <a class="home-skip-link" href="#main-content">Przejdź do treści</a>

    <div class="dark-shell">
      <header class="site-header">
        <a href="#poczatek" class="brand" aria-label="OpenExpert — strona główna" @click="closeMobileMenu">
          <img src="/assets/logo-dark.svg" alt="" width="30" height="30">
          <span>OpenExpert</span>
        </a>

        <nav class="desktop-nav" aria-label="Główna nawigacja">
          <a href="#jak-to-dziala">Jak zacząć</a>
          <a href="#agenci-ai">Platforma</a>
          <NuxtLink to="/eksperci">Eksperci</NuxtLink>
          <NuxtLink to="/placowki">Placówki</NuxtLink>
        </nav>

        <a href="#dolacz" class="button button--light header-cta">Zostań pośrednikiem</a>

        <button
          type="button"
          class="mobile-menu-button"
          :aria-expanded="mobileMenuOpen"
          aria-controls="mobile-menu"
          :aria-label="mobileMenuOpen ? 'Zamknij menu' : 'Otwórz menu'"
          @click="mobileMenuOpen = !mobileMenuOpen"
        >
          <Icon v-if="!mobileMenuOpen" name="lucide:menu" />
          <Icon v-else name="lucide:x" />
        </button>

        <Transition name="mobile-menu">
          <nav v-if="mobileMenuOpen" id="mobile-menu" class="mobile-nav" aria-label="Nawigacja mobilna">
            <a href="#jak-to-dziala" @click="closeMobileMenu">Jak zacząć</a>
            <a href="#agenci-ai" @click="closeMobileMenu">Platforma</a>
            <NuxtLink to="/eksperci" @click="closeMobileMenu">Eksperci</NuxtLink>
            <NuxtLink to="/placowki" @click="closeMobileMenu">Placówki</NuxtLink>
            <a href="#dolacz" class="mobile-nav__cta" @click="closeMobileMenu">Zostań pośrednikiem</a>
          </nav>
        </Transition>
      </header>
    </div>

    <main id="main-content" tabindex="-1">
      <div class="dark-shell">
      <section id="poczatek" class="hero" aria-labelledby="hero-title">
        <div class="hero-grid">
          <div class="hero-copy">
            <p class="eyebrow">Platforma dla przyszłych i działających pośredników</p>
            <h1 id="hero-title" aria-label="Zbuduj własne pośrednictwo z OpenExpert.">
              <span aria-hidden="true">Zbuduj własne.</span>
              <em aria-hidden="true">Pośrednictwo.</em>
              <span aria-hidden="true">Z OpenExpert.</span>
            </h1>
            <p class="hero-lead">Zacznij samodzielnie albo rozwijaj całą firmę. OpenExpert daje Ci CRM w Twojej marce, uporządkowany proces obsługi, rozliczenia i agentów AI — od pierwszego kontaktu do zakończenia sprawy.</p>
            <div class="hero-actions">
              <a href="#dolacz" class="button button--light">Zostań pośrednikiem</a>
              <a href="#jak-to-dziala" class="button button--dark">Zobacz, jak zacząć</a>
            </div>
          </div>

          <LazyLandingExpertCasePreview class="hero-preview" hydrate-never />
        </div>
      </section>

      <LazyLandingBenefitsSection hydrate-never />
      </div>

      <LazyLandingJourneySection hydrate-never />

      <section id="personalizuj" class="personalize-section" aria-labelledby="personalize-title">
        <div class="personalize-inner">
          <div class="personalize-copy">
            <p class="section-label">Twoja marka od pierwszego dnia</p>
            <h2 id="personalize-title">Twój biznes.{{ ' ' }}<br><em>Twój sposób działania.</em></h2>
            <p>Niezależnie od tego, czy działasz samodzielnie, czy budujesz zespół, dopasujesz kolory, typografię i charakter interfejsu do własnej marki.</p>
          </div>

          <div class="personalize-panel">
            <LazyLandingPersonalizationPreview hydrate-on-visible />

            <NuxtLink to="/personalizacja" class="button personalize-panel__cta">
              Przetestuj personalizację
              <Icon name="lucide:arrow-right" aria-hidden="true" />
            </NuxtLink>
          </div>
        </div>
      </section>

      <section id="agenci-ai" class="platform-section" aria-labelledby="platform-title">
        <div class="platform-inner">
          <div class="platform-intro">
            <p class="section-label section-label--dark">Cyfrowy zespół od pierwszego dnia</p>
            <h2 id="platform-title">Nie zaczynasz sam.{{ ' ' }}<br><em>Agenci wspierają każdy etap.</em></h2>
            <p>OpenExpert przejmuje powtarzalną pracę operacyjną, aby jedna osoba mogła działać sprawnie od pierwszych klientów, a firma skalować obsługę bez utraty standardu.</p>
          </div>

          <div class="platform-board">
            <div class="platform-board__bar">
              <span>Agenci OpenExpert dla Twojej firmy</span>
              <span class="platform-board__status">
                <Icon name="lucide:circle-check" aria-hidden="true" />
                4 agentów gotowych do pracy
              </span>
            </div>

            <ol class="platform-list">
              <li
                v-for="row in platformRows"
                :key="row.index"
                class="platform-row"
                :class="{ 'platform-row--featured': row.index === '01' }"
              >
                <div class="platform-row__top">
                  <span class="platform-row__index">{{ row.index }}</span>
                  <span class="platform-row__icon" aria-hidden="true"><Icon :name="row.icon" /></span>
                </div>

                <div class="platform-row__copy">
                  <p>{{ row.role }}</p>
                  <h3>{{ row.title }}</h3>
                  <span>{{ row.description }}</span>
                </div>

                <ol class="platform-flow" :aria-label="`Przebieg pracy: ${row.role}`">
                  <li v-for="(step, stepIndex) in row.flow" :key="step.label" class="platform-flow__step">
                    <small>{{ step.label }}</small>
                    <strong>{{ step.value }}</strong>
                    <Icon v-if="stepIndex < row.flow.length - 1" name="lucide:arrow-right" aria-hidden="true" />
                  </li>
                </ol>
              </li>
            </ol>
          </div>
        </div>
      </section>

      <LazyLandingAnalyticsSection hydrate-never />

      <section id="dla-ekspertow" class="experts-section" aria-labelledby="experts-title">
        <div class="experts-inner">
          <div class="experts-heading">
            <p class="section-label">Model, który rośnie razem z Tobą</p>
            <h2 id="experts-title">Zacznij jako jedna osoba.{{ ' ' }}<br><em>Rozwijaj się jako firma.</em></h2>
            <p>OpenExpert daje ten sam operacyjny fundament niezależnie od skali. Ty budujesz relacje i markę, a platforma porządkuje sprawy, pracę zespołu i kolejne kroki.</p>
          </div>

          <div class="expert-points">
            <article v-for="(point, index) in expertPoints" :key="point.title" class="expert-point">
              <span class="expert-point__index">0{{ index + 1 }}</span>
              <span class="expert-point__icon" aria-hidden="true"><Icon :name="point.icon" /></span>
              <div>
                <h3>{{ point.title }}</h3>
                <p>{{ point.description }}</p>
              </div>
            </article>
          </div>
        </div>
      </section>

      <LazyLandingSettlementsSection hydrate-never />

      <section id="dolacz" class="join-section" aria-labelledby="join-title">
        <div class="join-inner">
          <div class="join-copy">
            <p class="section-label section-label--dark">Program wczesnego dostępu</p>
            <h2 id="join-title">Zostań pośrednikiem.{{ ' ' }}<br>Zacznij <em>po swojemu.</em></h2>
            <p>Masz doświadczenie, sieć kontaktów albo po prostu pomysł na własny biznes? Powiedz nam, jak chcesz działać, a pokażemy Ci OpenExpert od strony dopasowanej do Twojego modelu.</p>
          </div>

          <div class="join-action">
            <ol class="join-steps" aria-label="Jak zacząć z OpenExpert">
              <li v-for="(step, index) in joinSteps" :key="step.title">
                <span class="join-step__index">0{{ index + 1 }}</span>
                <span>
                  <strong>{{ step.title }}</strong>
                  <small>{{ step.description }}</small>
                </span>
              </li>
            </ol>

            <form class="join-form" novalidate @submit.prevent="submitWaitlist">
              <label for="landing-email">E-mail do kontaktu</label>
              <div class="join-form__row">
                <input
                  id="landing-email"
                  ref="emailInput"
                  v-model="email"
                  type="email"
                  name="email"
                  autocomplete="email"
                  inputmode="email"
                  placeholder="twoj@email.pl"
                  required
                  :disabled="waitlistLoading"
                  :aria-invalid="Boolean(waitlistError)"
                  :aria-describedby="waitlistError ? 'join-error join-note join-legal' : 'join-note join-legal'"
                  @input="waitlistError = null"
                >
                <button type="submit" class="button button--light" :disabled="waitlistLoading">
                  {{ waitlistLoading ? 'Zapisuję…' : 'Zacznij z OpenExpert' }}
                  <Icon v-if="!waitlistLoading" name="lucide:arrow-right" aria-hidden="true" />
                </button>
              </div>
              <p id="join-error" class="join-form__error" aria-live="polite">{{ waitlistError }}</p>
              <p id="join-note" class="join-form__note">Bez spamu. Po zapisie przejdziesz do krótkiej ankiety o planowanym modelu działania.</p>
              <p id="join-legal" class="join-form__legal">OpenExpert wspiera organizację i technologię pracy. Rozpoczęcie działalności pośrednika może wymagać odrębnych umów, wpisów lub zezwoleń — zależnie od modelu i oferowanych produktów.</p>
            </form>
          </div>
        </div>
      </section>
    </main>

    <footer class="site-footer">
      <div class="site-footer__inner">
        <a href="#poczatek" class="footer-brand" aria-label="OpenExpert — wróć na początek">
          <img src="/assets/logo-dark.svg" alt="" width="24" height="24">
          <span>OpenExpert</span>
        </a>
        <p>© 2026 OpenExpert. Twoja marka. Twoje pośrednictwo. Jeden system.</p>
        <nav aria-label="Linki w stopce">
          <NuxtLink to="/eksperci">Eksperci</NuxtLink>
          <NuxtLink to="/placowki">Placówki</NuxtLink>
          <NuxtLink to="/o-nas">O OpenExpert</NuxtLink>
          <NuxtLink to="/waitlist">Zostań pośrednikiem</NuxtLink>
          <a href="https://github.com/OpenExpertApp/OpenExpert" target="_blank" rel="noopener noreferrer">
            GitHub <Icon name="lucide:github" aria-hidden="true" />
          </a>
        </nav>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.oe-redesign {
  min-width: 0;
  background: #f7f7f5;
  color: #111;
  font-family: var(--font-sans);
}

.home-skip-link {
  position: fixed;
  top: 10px;
  left: 16px;
  z-index: 100;
  padding: 9px 13px;
  background: #fff;
  color: #111;
  text-decoration: none;
  transform: translateY(-180%);
}

.home-skip-link:focus {
  transform: translateY(0);
}

#main-content:focus {
  outline: none;
}

.dark-shell {
  background: #030303;
  color: #f7f7f7;
}

.site-header {
  position: relative;
  z-index: 20;
  display: grid;
  width: min(1440px, calc(100% - 80px));
  height: 88px;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  margin: 0 auto;
}

.brand,
.footer-brand {
  display: inline-flex;
  width: fit-content;
  align-items: center;
  gap: 13px;
  color: #f7f7f7;
  font-size: 22px;
  font-weight: 500;
  letter-spacing: -0.025em;
  text-decoration: none;
}

.brand img {
  width: 30px;
  height: 30px;
}

.desktop-nav {
  display: flex;
  align-items: center;
  gap: clamp(22px, 3vw, 48px);
}

.desktop-nav a,
.mobile-nav a,
.site-footer nav a {
  color: #dedede;
  text-decoration: none;
  transition: color 150ms ease-out;
}

.desktop-nav a {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  font-size: 14px;
}

.desktop-nav a:hover,
.mobile-nav a:hover,
.site-footer nav a:hover {
  color: #fff;
}

.button {
  display: inline-flex;
  min-height: 50px;
  align-items: center;
  justify-content: center;
  gap: 9px;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 12px 24px;
  font-family: var(--font-sans);
  font-size: 14px;
  font-weight: 500;
  line-height: 1;
  text-decoration: none;
  cursor: pointer;
  transition: background 150ms ease-out, color 150ms ease-out, border-color 150ms ease-out, opacity 150ms ease-out;
}

.button :deep(svg) {
  width: 17px;
  height: 17px;
  stroke-width: 1.6;
}

.button--light {
  border-color: #f7f7f7;
  background: #f7f7f7;
  color: #090909;
}

.button--light:hover {
  border-color: #d8d8d8;
  background: #d8d8d8;
}

.button--dark {
  border-color: #777;
  background: transparent;
  color: #f4f4f4;
}

.button--dark:hover {
  border-color: #aaa;
  background: #151515;
}

.button:disabled {
  cursor: wait;
  opacity: 0.62;
}

.header-cta {
  justify-self: end;
  min-width: 188px;
  min-height: 48px;
}

.mobile-menu-button,
.mobile-nav {
  display: none;
}

.hero {
  scroll-margin-top: 88px;
  width: min(1340px, calc(100% - 96px));
  margin: 0 auto;
  padding: 17px 0 50px;
}

.hero-grid {
  display: grid;
  grid-template-columns: minmax(430px, 0.78fr) minmax(620px, 1.12fr);
  align-items: center;
  gap: clamp(46px, 5vw, 72px);
}

.hero-copy {
  min-width: 0;
}

.eyebrow,
.section-label {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  letter-spacing: 0.105em;
  line-height: 1.5;
  text-transform: uppercase;
}

.eyebrow {
  margin-bottom: 24px;
  color: #aaa;
}

.hero h1 {
  margin: 0 0 14px;
  color: #f7f7f7;
  font-size: clamp(56px, 4.7vw, 74px);
  font-variation-settings: 'opsz' 72, 'wght' 300;
  font-weight: 300;
  letter-spacing: 0.015em;
  line-height: 1.13;
}

.hero h1 span,
.hero h1 em {
  display: block;
  white-space: nowrap;
}

.hero h1 em {
  font-family: Georgia, 'Times New Roman', serif;
  font-style: italic;
  font-variation-settings: normal;
  font-weight: 400;
}

.hero-lead {
  max-width: 475px;
  margin-bottom: 22px;
  color: #aaa;
  font-size: 17px;
  line-height: 1.7;
}

.hero-actions {
  display: grid;
  max-width: 430px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.hero-preview {
  min-width: 0;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  margin: -1px;
  padding: 0;
  border: 0;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.platform-section,
.personalize-section,
.experts-section,
.join-section {
  scroll-margin-top: 88px;
}

.personalize-section {
  border-top: 1px solid #d1d1cd;
  background: #ecece8;
  color: #111;
}

.personalize-inner {
  display: grid;
  width: min(1340px, calc(100% - 96px));
  grid-template-columns: minmax(0, 0.92fr) minmax(480px, 1.08fr);
  align-items: center;
  gap: clamp(64px, 8vw, 126px);
  margin: 0 auto;
  padding: 92px 0 96px;
}

.personalize-copy h2 {
  max-width: 650px;
  margin-bottom: 25px;
  font-size: clamp(42px, 4vw, 58px);
  font-variation-settings: 'opsz' 58, 'wght' 300;
  font-weight: 300;
  letter-spacing: -0.045em;
  line-height: 1.08;
}

.personalize-copy h2 em {
  font-family: var(--font-serif);
  font-style: italic;
  font-variation-settings: 'opsz' 58, 'wght' 340;
  font-weight: 340;
}

.personalize-copy > p:last-child {
  max-width: 550px;
  color: #505050;
  font-size: 17px;
  line-height: 1.7;
}

.personalize-panel {
  min-width: 0;
  border: 1px solid #c9c9c4;
  border-radius: 6px;
  background: #f7f7f5;
  padding: clamp(22px, 3vw, 34px);
}

.personalize-panel__cta {
  width: 100%;
  min-height: 54px;
  margin-top: 18px;
  border-color: #111;
  background: #111;
  color: #fff;
}

.personalize-panel__cta:hover {
  border-color: #333;
  background: #333;
}

.platform-section {
  background: #070707;
  color: #f7f7f7;
}

.platform-inner,
.experts-inner,
.join-inner {
  width: min(1340px, calc(100% - 96px));
  margin: 0 auto;
}

.platform-inner {
  padding: 104px 0;
}

.section-label {
  margin-bottom: 24px;
  color: #555;
}

.section-label--dark {
  color: #a8a8a8;
}

.platform-intro h2,
.experts-heading h2,
.join-copy h2 {
  font-variation-settings: 'opsz' 58, 'wght' 300;
  font-weight: 300;
  letter-spacing: -0.045em;
  line-height: 1.08;
}

.platform-intro h2 {
  max-width: 780px;
  font-size: clamp(42px, 4.2vw, 62px);
}

.platform-intro h2 em,
.experts-heading h2 em,
.join-copy h2 em {
  font-family: var(--font-serif);
  font-style: italic;
  font-variation-settings: 'opsz' 58, 'wght' 340;
  font-weight: 340;
}

.platform-intro > p:last-child {
  max-width: 500px;
  color: #a8a8a8;
  font-size: 17px;
  line-height: 1.7;
}

.platform-intro {
  display: grid;
  grid-template-columns: minmax(0, 1.18fr) minmax(360px, 0.82fr);
  align-items: end;
  gap: 28px 80px;
  margin-bottom: 42px;
}

.platform-intro .section-label {
  grid-column: 1 / -1;
  margin-bottom: -8px;
}

.platform-board {
  overflow: hidden;
  border: 1px solid #353535;
  border-radius: 6px;
  background: #080808;
}

.platform-board__bar {
  display: flex;
  min-height: 52px;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  border-bottom: 1px solid #353535;
  padding: 0 26px;
  color: #888;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 9px;
  letter-spacing: 0.08em;
  line-height: 1.4;
  text-transform: uppercase;
}

.platform-board__status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #aaa;
}

.platform-board__status :deep(svg) {
  width: 14px;
  height: 14px;
  color: #48b986;
  stroke-width: 1.8;
}

.platform-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  list-style: none;
}

.platform-row {
  display: flex;
  min-width: 0;
  min-height: 292px;
  flex-direction: column;
  border-bottom: 1px solid #353535;
  padding: 28px 30px 26px;
  background: #080808;
  transition: background 180ms ease-out;
}

.platform-row:nth-child(odd) {
  border-right: 1px solid #353535;
}

.platform-row:nth-last-child(-n + 2) {
  border-bottom: 0;
}

.platform-row:not(.platform-row--featured):hover {
  background: #101010;
}

.platform-row--featured {
  border-color: #c7c7c2;
  background: #f1f1ed;
  color: #111;
}

.platform-row__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}

.platform-row__index {
  color: #999;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 9px;
  letter-spacing: 0.08em;
}

.platform-row__icon {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  color: #ededed;
}

.platform-row__icon :deep(svg) {
  width: 27px;
  height: 27px;
  stroke-width: 1.4;
}

.platform-row--featured .platform-row__index {
  color: #666;
}

.platform-row--featured .platform-row__icon {
  color: #222;
}

.platform-row__copy {
  margin: 20px 0 24px;
}

.platform-row__copy > p {
  margin-bottom: 8px;
  color: #8b8b8b;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 9px;
  letter-spacing: 0.08em;
  line-height: 1.4;
  text-transform: uppercase;
}

.platform-row__copy h3 {
  max-width: 480px;
  margin-bottom: 10px;
  font-size: clamp(23px, 2.05vw, 30px);
  font-weight: 500;
  letter-spacing: -0.03em;
  line-height: 1.12;
}

.platform-row__copy > span {
  display: block;
  max-width: 500px;
  color: #9d9d9d;
  font-size: 14px;
  line-height: 1.55;
}

.platform-row--featured .platform-row__copy > p,
.platform-row--featured .platform-row__copy > span {
  color: #5f5f5f;
}

.platform-flow {
  display: grid;
  min-width: 0;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-top: auto;
  border-top: 1px solid #353535;
  padding-top: 18px;
  list-style: none;
}

.platform-flow__step {
  position: relative;
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 5px;
  border-left: 1px solid #353535;
  padding: 0 24px 0 14px;
}

.platform-flow__step:first-child {
  border-left: 0;
  padding-left: 0;
}

.platform-flow__step:last-child {
  padding-right: 0;
}

.platform-flow__step small {
  color: #6f6f6f;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 7.5px;
  letter-spacing: 0.08em;
  line-height: 1.4;
  text-transform: uppercase;
}

.platform-flow__step strong {
  overflow-wrap: anywhere;
  color: #c9c9c9;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.35;
}

.platform-flow__step :deep(svg) {
  position: absolute;
  top: 50%;
  right: 4px;
  width: 12px;
  height: 12px;
  color: #5e5e5e;
  stroke-width: 1.5;
  transform: translateY(-50%);
}

.platform-row--featured .platform-flow {
  border-color: #c7c7c2;
}

.platform-row--featured .platform-flow__step {
  border-color: #c7c7c2;
}

.platform-row--featured .platform-flow__step small {
  color: #6b6b6b;
}

.platform-row--featured .platform-flow__step strong {
  color: #282828;
}

.platform-row--featured .platform-flow__step :deep(svg) {
  color: #777;
}

.experts-section {
  background: #f7f7f5;
  color: #111;
}

.experts-inner {
  padding: 104px 0 112px;
}

.experts-heading {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(340px, 0.8fr);
  align-items: end;
  gap: 70px;
  margin-bottom: 66px;
}

.experts-heading .section-label {
  grid-column: 1 / -1;
  margin-bottom: -42px;
}

.experts-heading h2 {
  max-width: 830px;
  font-size: clamp(42px, 4.25vw, 62px);
}

.experts-heading > p:last-child {
  color: #505050;
  font-size: 16px;
  line-height: 1.7;
}

.expert-points {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border-top: 1px solid #cfcfcb;
  border-bottom: 1px solid #cfcfcb;
}

.expert-point {
  position: relative;
  min-width: 0;
  padding: 34px 34px 38px;
}

.expert-point + .expert-point {
  border-left: 1px solid #cfcfcb;
}

.expert-point__index {
  display: block;
  margin-bottom: 34px;
  color: #777;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
}

.expert-point__icon {
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
  border: 1px solid #aaa;
  border-radius: 4px;
  margin-bottom: 28px;
}

.expert-point__icon :deep(svg) {
  width: 23px;
  height: 23px;
  stroke-width: 1.35;
}

.expert-point h3 {
  margin-bottom: 9px;
  font-size: 20px;
  font-weight: 500;
  letter-spacing: -0.02em;
}

.expert-point p {
  max-width: 360px;
  color: #565656;
  font-size: 14px;
  line-height: 1.65;
}

.join-section {
  border-top: 1px solid #292929;
  background: #030303;
  color: #f7f7f7;
}

.join-inner {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(480px, 1.1fr);
  align-items: start;
  gap: clamp(64px, 8vw, 130px);
  padding: 104px 0 112px;
}

.join-copy h2 {
  margin-bottom: 24px;
  font-size: clamp(46px, 4.35vw, 64px);
}

.join-copy > p:last-child {
  max-width: 510px;
  color: #a8a8a8;
  font-size: 16px;
  line-height: 1.7;
}

.join-action {
  min-width: 0;
}

.join-steps {
  border-top: 1px solid #353535;
  margin-bottom: 30px;
  list-style: none;
}

.join-steps li {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  gap: 16px;
  border-bottom: 1px solid #353535;
  padding: 15px 0;
}

.join-step__index {
  padding-top: 3px;
  color: #777;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
  letter-spacing: 0.08em;
}

.join-steps strong,
.join-steps small {
  display: block;
}

.join-steps strong {
  margin-bottom: 4px;
  color: #f2f2f2;
  font-size: 14px;
  font-weight: 500;
}

.join-steps small {
  color: #929292;
  font-size: 12.5px;
  line-height: 1.55;
}

.join-form {
  min-width: 0;
}

.join-form label {
  display: block;
  margin-bottom: 11px;
  color: #dedede;
  font-size: 13px;
  font-weight: 500;
}

.join-form__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
}

.join-form input {
  width: 100%;
  min-height: 54px;
  border: 1px solid #555;
  border-radius: 4px;
  background: #0a0a0a;
  padding: 12px 16px;
  color: #f7f7f7;
  font: inherit;
  font-size: 16px;
  transition: border-color 150ms ease-out, background 150ms ease-out;
}

.join-form input::placeholder {
  color: #999;
}

.join-form input:hover {
  border-color: #777;
}

.join-form input[aria-invalid='true'] {
  border-color: #d67a7a;
}

.join-form .button {
  min-height: 54px;
  white-space: nowrap;
}

.join-form__error {
  min-height: 22px;
  margin-top: 9px;
  color: #efb0b0;
  font-size: 13px;
  line-height: 1.5;
}

.join-form__note {
  color: #aaa;
  font-size: 11.5px;
  line-height: 1.55;
}

.join-form__legal {
  max-width: 650px;
  margin-top: 12px;
  color: #707070;
  font-size: 10.5px;
  line-height: 1.55;
}

.site-footer {
  width: 100%;
  border-top: 1px solid #292929;
  background: #030303;
  color: #aaa;
}

.site-footer__inner {
  display: grid;
  width: min(1440px, calc(100% - 80px));
  min-height: 102px;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  margin: 0 auto;
}

.footer-brand {
  gap: 10px;
  font-size: 16px;
}

.footer-brand img {
  width: 24px;
  height: 24px;
}

.site-footer p {
  font-size: 11px;
  text-align: center;
}

.site-footer nav {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 24px;
}

.site-footer nav a {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.site-footer nav a :deep(svg) {
  width: 15px;
  height: 15px;
}

.oe-redesign :is(a, button, input):focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 3px;
}

@media (max-width: 1240px) {
  .hero-grid {
    grid-template-columns: minmax(390px, 0.72fr) minmax(560px, 1.08fr);
    gap: 42px;
  }

  .hero h1 {
    font-size: clamp(50px, 4.5vw, 62px);
  }
}

@media (max-width: 1099px) {
  .site-header,
  .site-footer__inner {
    width: calc(100% - 64px);
  }

  .hero,
  .personalize-inner,
  .platform-inner,
  .experts-inner,
  .join-inner {
    width: min(760px, calc(100% - 64px));
  }

  .hero {
    padding: 40px 0 72px;
  }

  .hero-grid {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 52px;
  }

  .hero-copy {
    max-width: 650px;
  }

  .hero h1 {
    font-size: clamp(58px, 7.5vw, 72px);
  }

  .hero-preview {
    width: 100%;
  }

  .personalize-inner,
  .join-inner {
    grid-template-columns: 1fr;
    gap: 64px;
  }

  .platform-intro {
    grid-template-columns: 1fr;
    gap: 18px;
  }

  .platform-intro .section-label {
    grid-column: auto;
    margin-bottom: 0;
  }

  .platform-intro > p:last-child {
    max-width: 620px;
  }

  .platform-row {
    min-height: 304px;
    padding: 26px 24px 24px;
  }

  .platform-row__copy h3 {
    font-size: 25px;
  }

  .platform-flow__step {
    padding-right: 18px;
    padding-left: 11px;
  }

  .personalize-copy {
    max-width: 650px;
  }

  .experts-heading {
    grid-template-columns: 1fr;
    gap: 24px;
  }

  .experts-heading .section-label {
    grid-column: auto;
    margin-bottom: 0;
  }

  .experts-heading > p:last-child {
    max-width: 600px;
  }

  .expert-point {
    padding-right: 24px;
    padding-left: 24px;
  }

  .join-action {
    max-width: 690px;
  }
}

@media (max-width: 767px) {
  .site-header {
    width: calc(100% - 40px);
    height: 64px;
    grid-template-columns: 1fr auto;
  }

  .brand {
    gap: 11px;
    font-size: 20px;
  }

  .brand img {
    width: 28px;
    height: 28px;
  }

  .desktop-nav,
  .header-cta {
    display: none;
  }

  .mobile-menu-button {
    display: grid;
    width: 42px;
    height: 42px;
    place-items: center;
    border: 1px solid #666;
    border-radius: 5px;
    background: #080808;
    color: #f7f7f7;
    cursor: pointer;
  }

  .mobile-menu-button :deep(svg) {
    width: 23px;
    height: 23px;
    stroke-width: 1.6;
  }

  .mobile-nav {
    position: absolute;
    top: 58px;
    right: 0;
    left: 0;
    display: flex;
    border: 1px solid #333;
    border-radius: 5px;
    background: #0a0a0a;
    padding: 8px;
    box-shadow: 0 16px 36px rgba(0, 0, 0, 0.42);
    flex-direction: column;
  }

  .mobile-nav a {
    display: flex;
    min-height: 48px;
    align-items: center;
    border-radius: 3px;
    padding: 0 14px;
    font-size: 15px;
  }

  .mobile-nav a:hover {
    background: #171717;
  }

  .mobile-nav__cta {
    justify-content: center;
    margin-top: 4px;
    background: #f7f7f7;
    color: #090909 !important;
    font-weight: 500;
  }

  .hero,
  .personalize-inner,
  .platform-inner,
  .experts-inner,
  .join-inner {
    width: min(100% - 40px, 620px);
  }

  .hero {
    padding: 18px 0 48px;
  }

  .hero-grid {
    gap: 18px;
  }

  .eyebrow {
    max-width: 310px;
    margin-bottom: 20px;
    font-size: 10px;
    line-height: 1.55;
  }

  .hero h1 {
    margin-bottom: 24px;
    font-size: clamp(34px, 10.25vw, 42px);
    line-height: 1.075;
  }

  .hero-lead {
    margin-bottom: 14px;
    font-size: 14.5px;
    line-height: 1.65;
  }

  .hero-actions {
    width: 100%;
    max-width: none;
    gap: 12px;
  }

  .hero-actions .button {
    min-width: 0;
    min-height: 48px;
    padding-right: 12px;
    padding-left: 12px;
    font-size: 13.5px;
  }

  .platform-inner,
  .personalize-inner,
  .experts-inner,
  .join-inner {
    padding: 70px 0;
  }

  .platform-inner,
  .personalize-inner,
  .join-inner {
    gap: 44px;
  }

  .personalize-copy h2,
  .platform-intro h2,
  .experts-heading h2,
  .join-copy h2 {
    font-size: clamp(36px, 10vw, 46px);
  }

  .platform-intro > p:last-child,
  .personalize-copy > p:last-child,
  .join-copy > p:last-child {
    font-size: 15.5px;
  }

  .personalize-panel {
    padding: 20px;
  }

  .platform-intro {
    margin-bottom: 32px;
  }

  .platform-board__bar {
    min-height: 0;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    padding: 14px 20px;
  }

  .platform-list {
    grid-template-columns: 1fr;
  }

  .platform-row,
  .platform-row:nth-child(odd),
  .platform-row:nth-last-child(-n + 2) {
    min-height: 0;
    border-right: 0;
    border-bottom: 1px solid #353535;
    padding: 24px 22px 22px;
  }

  .platform-row:last-child {
    border-bottom: 0;
  }

  .platform-row__icon {
    width: 32px;
    height: 32px;
  }

  .platform-row__icon :deep(svg) {
    width: 24px;
    height: 24px;
  }

  .platform-row__copy {
    margin: 16px 0 20px;
  }

  .platform-row__copy h3 {
    font-size: 22px;
  }

  .platform-row__copy > span {
    font-size: 13px;
  }

  .platform-flow {
    padding-top: 16px;
  }

  .platform-flow__step {
    padding-right: 16px;
    padding-left: 10px;
  }

  .platform-flow__step strong {
    font-size: 10.5px;
  }

  .experts-heading {
    margin-bottom: 42px;
  }

  .experts-heading > p:last-child {
    font-size: 15px;
  }

  .expert-points {
    grid-template-columns: 1fr;
  }

  .expert-point {
    display: grid;
    grid-template-columns: 34px 48px minmax(0, 1fr);
    gap: 13px;
    padding: 24px 0;
  }

  .expert-point + .expert-point {
    border-top: 1px solid #cfcfcb;
    border-left: 0;
  }

  .expert-point__index,
  .expert-point__icon {
    margin-bottom: 0;
  }

  .expert-point h3 {
    font-size: 17px;
  }

  .expert-point p {
    font-size: 13px;
  }

  .join-form__row {
    grid-template-columns: 1fr;
  }

  .join-form .button {
    width: 100%;
  }

  .site-footer__inner {
    width: calc(100% - 40px);
    min-height: 0;
    grid-template-columns: 1fr;
    gap: 10px;
    padding: 34px 0;
  }

  .site-footer p {
    display: none;
  }

  .site-footer nav {
    flex-wrap: wrap;
    justify-content: flex-start;
    gap: 0 18px;
  }
}

@media (max-width: 359px) {
  .site-header,
  .site-footer__inner,
  .hero,
  .personalize-inner,
  .platform-inner,
  .experts-inner,
  .join-inner {
    width: calc(100% - 32px);
  }

  .brand {
    font-size: 18px;
  }

  .hero-actions {
    grid-template-columns: 1fr;
  }

  .platform-board__bar {
    padding-right: 18px;
    padding-left: 18px;
  }

  .platform-row,
  .platform-row:nth-child(odd),
  .platform-row:nth-last-child(-n + 2) {
    padding-right: 18px;
    padding-left: 18px;
  }

  .platform-flow__step {
    padding-right: 8px;
    padding-left: 8px;
  }

  .platform-flow__step:first-child {
    padding-left: 0;
  }

  .platform-flow__step :deep(svg) {
    display: none;
  }

  .platform-flow__step strong {
    font-size: 9.5px;
  }

  .site-footer__inner {
    grid-template-columns: 1fr;
  }

  .site-footer nav {
    justify-content: flex-start;
  }
}

@media (prefers-reduced-motion: reduce) {
  .oe-redesign *,
  .oe-redesign *::before,
  .oe-redesign *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}

.mobile-menu-enter-active,
.mobile-menu-leave-active {
  transition: opacity 150ms ease-out, transform 150ms ease-out;
}

.mobile-menu-enter-from,
.mobile-menu-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
