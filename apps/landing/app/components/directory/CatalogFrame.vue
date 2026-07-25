<script setup lang="ts">
const query = defineModel<string>({ default: '' })

const props = defineProps<{
  active: 'experts' | 'facilities'
  eyebrow: string
  title: string
  emphasis: string
  description: string
  searchId: string
  searchLabel: string
  searchPlaceholder: string
  resultText: string
  status: 'idle' | 'pending' | 'success' | 'error'
  hasError: boolean
  totalCount: number
  visibleCount: number
  emptyTitle: string
  emptyDescription: string
  noResultsTitle: string
  noResultsDescription: string
}>()

defineEmits<{
  retry: []
}>()

const countLabel = computed(() => {
  if (props.active === 'experts') {
    return props.totalCount === 1 ? 'ekspert' : 'ekspertów'
  }

  const lastTwoDigits = Math.abs(props.totalCount) % 100
  const lastDigit = lastTwoDigits % 10
  if (props.totalCount === 1) return 'placówka'
  if (lastTwoDigits < 12 || lastTwoDigits > 14) {
    if (lastDigit >= 2 && lastDigit <= 4) return 'placówki'
  }
  return 'placówek'
})

const currentPageLabel = computed(() => (
  props.active === 'experts' ? 'Eksperci' : 'Placówki'
))

const guide = computed(() => props.active === 'experts'
  ? {
      eyebrow: 'Jak wybrać eksperta',
      title: 'Porównaj zakres pomocy, miejsce i dostępny termin.',
      description: 'Katalog pokazuje informacje opublikowane wraz z aktywnym kalendarzem. Przed rezerwacją sprawdź, czy zakres konsultacji odpowiada Twojej sprawie.',
      points: [
        {
          title: 'Zakres konsultacji',
          description: 'Nazwy usług i czas spotkania pomagają ocenić, czy ekspert zajmuje się tematem, z którym przychodzisz.',
        },
        {
          title: 'Placówka i forma spotkania',
          description: 'Sprawdź przypisaną placówkę oraz adres. Szczegóły spotkania zobaczysz w kalendarzu rezerwacji.',
        },
        {
          title: 'Aktualna dostępność',
          description: 'Kliknij „Umów konsultację”, aby wybrać eksperta, usługę i jeden z aktualnie dostępnych terminów.',
        },
      ],
    }
  : {
      eyebrow: 'Jak wybrać placówkę',
      title: 'Sprawdź lokalizację, zespół i dostępne konsultacje.',
      description: 'Każda placówka publikuje własny aktywny kalendarz. Porównaj adres, listę ekspertów i zakres usług przed przejściem do rezerwacji.',
      points: [
        {
          title: 'Lokalizacja',
          description: 'Zweryfikuj adres placówki i upewnij się, że odpowiada planowanej formie konsultacji.',
        },
        {
          title: 'Eksperci i usługi',
          description: 'Na karcie zobaczysz osoby oraz rodzaje konsultacji przypisane do danego miejsca.',
        },
        {
          title: 'Termin bez telefonu zwrotnego',
          description: 'Przejdź do kalendarza i samodzielnie wybierz dostępny termin zamiast czekać na kontakt.',
        },
      ],
    },
)

const questions = computed(() => [
  {
    question: 'Czy rezerwacja konsultacji odbywa się online?',
    answer: 'Tak. Karta prowadzi do aktualnego kalendarza, w którym wybierasz usługę, eksperta i dostępny termin. Samo spotkanie może odbywać się online lub w placówce — zgodnie z informacją w kalendarzu.',
  },
  {
    question: 'Jakie dane są potrzebne do umówienia konsultacji?',
    answer: 'Podczas rezerwacji podajesz imię, adres e-mail i numer telefonu potrzebny do potwierdzenia oraz obsługi wizyty. Organizacja może też wyświetlić własne, aktualne zgody i oświadczenia.',
  },
  {
    question: 'Czy jedno konto może należeć jednocześnie do eksperta i klienta?',
    answer: 'Tak. OpenExpert rozdziela kontekst pracy eksperta od kontekstu klienta. To samo logowanie może prowadzić do różnych widoków i uprawnień, bez mieszania danych obu ról.',
  },
  {
    question: props.active === 'experts'
      ? 'Czy obecność w katalogu oznacza weryfikację uprawnień eksperta?'
      : 'Czy OpenExpert weryfikuje dane placówek?',
    answer: 'Katalog obejmuje aktywne kalendarze, które organizacje zdecydowały się opublikować. Przed konsultacją warto samodzielnie potwierdzić kwalifikacje, uprawnienia i dane podmiotu, jeśli są istotne dla danej sprawy.',
  },
])
</script>

<template>
  <div class="directory-page">
    <DirectorySiteHeader :active="active" />

    <main id="directory-content" tabindex="-1">
      <section class="directory-hero" :aria-labelledby="`${searchId}-title`">
        <div class="directory-hero__inner">
          <nav class="directory-breadcrumb" aria-label="Okruszki">
            <NuxtLink to="/">OpenExpert</NuxtLink>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{{ currentPageLabel }}</span>
          </nav>
          <p class="directory-hero__eyebrow">{{ eyebrow }}</p>
          <h1 :id="`${searchId}-title`">
            {{ title }}{{ ' ' }}<br><em>{{ emphasis }}</em>
          </h1>
          <p class="directory-hero__lead">{{ description }}</p>
          <a class="directory-hero__link" href="#wyniki">
            Przejdź do katalogu
            <Icon name="lucide:arrow-right" aria-hidden="true" />
          </a>
        </div>
      </section>

      <section id="wyniki" class="directory-results" aria-labelledby="directory-results-title">
        <div class="directory-results__inner">
          <div class="directory-results__heading">
            <div>
              <p>Publiczny katalog</p>
              <h2 id="directory-results-title">
                {{ active === 'experts' ? 'Znajdź właściwego eksperta' : 'Wybierz placówkę' }}
              </h2>
            </div>
            <span v-if="status === 'success'" class="directory-results__count">
              {{ totalCount }}
              {{ countLabel }}
            </span>
          </div>

          <DirectorySearchField
            v-model="query"
            :id="searchId"
            :label="searchLabel"
            :placeholder="searchPlaceholder"
            :result-text="resultText"
          />

          <div
            v-if="status === 'pending' || status === 'idle'"
            class="directory-state directory-state--loading"
            role="status"
            aria-live="polite"
          >
            <span class="directory-state__loader" aria-hidden="true" />
            <div>
              <strong>Ładujemy katalog</strong>
              <p>Pobieramy aktualnych ekspertów, usługi i dostępne placówki.</p>
            </div>
          </div>

          <div
            v-else-if="hasError"
            class="directory-state directory-state--error"
            role="alert"
          >
            <span class="directory-state__icon" aria-hidden="true">
              <Icon name="lucide:triangle-alert" />
            </span>
            <div>
              <strong>Nie udało się pobrać katalogu</strong>
              <p>Spróbuj ponownie. Jeśli problem nie zniknie, wróć za kilka minut.</p>
            </div>
            <button type="button" @click="$emit('retry')">
              <Icon name="lucide:rotate-ccw" aria-hidden="true" />
              Spróbuj ponownie
            </button>
          </div>

          <div
            v-else-if="totalCount === 0"
            class="directory-state directory-state--empty"
          >
            <span class="directory-state__icon" aria-hidden="true">
              <Icon :name="active === 'experts' ? 'lucide:user-round' : 'lucide:landmark'" />
            </span>
            <div>
              <strong>{{ emptyTitle }}</strong>
              <p>{{ emptyDescription }}</p>
            </div>
          </div>

          <div
            v-else-if="visibleCount === 0"
            class="directory-state directory-state--empty"
          >
            <span class="directory-state__icon" aria-hidden="true">
              <Icon name="lucide:eye" />
            </span>
            <div>
              <strong>{{ noResultsTitle }}</strong>
              <p>{{ noResultsDescription }}</p>
            </div>
            <button v-if="query" type="button" @click="query = ''">Wyczyść wyszukiwanie</button>
          </div>

          <div v-else class="directory-grid">
            <slot />
          </div>
        </div>
      </section>

      <section class="directory-guide" aria-labelledby="directory-guide-title">
        <div class="directory-guide__inner">
          <p>{{ guide.eyebrow }}</p>
          <div class="directory-guide__intro">
            <h2 id="directory-guide-title">{{ guide.title }}</h2>
            <p>{{ guide.description }}</p>
          </div>
          <div class="directory-guide__points">
            <article v-for="(point, index) in guide.points" :key="point.title">
              <span>0{{ index + 1 }}</span>
              <h3>{{ point.title }}</h3>
              <p>{{ point.description }}</p>
            </article>
          </div>
        </div>
      </section>

      <section class="directory-trust" aria-labelledby="directory-trust-title">
        <div class="directory-trust__inner">
          <p>Jak wygląda konsultacja</p>
          <h2 id="directory-trust-title">Ty wybierasz termin.{{ ' ' }}<br><em>Ekspert prowadzi dalej.</em></h2>
          <ol>
            <li>
              <span>01</span>
              <strong>Wybierz eksperta lub placówkę</strong>
              <p>Porównaj zakres konsultacji i zdecyduj, z kim chcesz porozmawiać.</p>
            </li>
            <li>
              <span>02</span>
              <strong>Zarezerwuj termin online</strong>
              <p>Zobacz aktualną dostępność i pozostaw dane potrzebne do potwierdzenia.</p>
            </li>
            <li>
              <span>03</span>
              <strong>Omów swoją sprawę</strong>
              <p>Ekspert skontaktuje się z Tobą i poprowadzi kolejne etapy konsultacji.</p>
            </li>
          </ol>
        </div>
      </section>

      <section class="directory-faq" aria-labelledby="directory-faq-title">
        <div class="directory-faq__inner">
          <p>Najczęstsze pytania</p>
          <h2 id="directory-faq-title">Zanim umówisz konsultację</h2>
          <div class="directory-faq__list">
            <details v-for="question in questions" :key="question.question">
              <summary>{{ question.question }}</summary>
              <p>{{ question.answer }}</p>
            </details>
          </div>
        </div>
      </section>
    </main>

    <DirectorySiteFooter />
  </div>
</template>

<style scoped>
.directory-page {
  min-width: 0;
  background: #f7f7f5;
  color: #111;
  font-family: var(--font-sans);
}

#directory-content:focus {
  outline: none;
}

.directory-hero {
  border-bottom: 1px solid #272727;
  background: #030303;
  color: #f7f7f7;
}

.directory-hero__inner {
  width: min(1340px, calc(100% - 96px));
  margin: 0 auto;
  padding: clamp(74px, 9vw, 126px) 0 clamp(76px, 9vw, 118px);
}

.directory-hero__eyebrow,
.directory-results__heading p,
.directory-trust__inner > p,
.directory-guide__inner > p,
.directory-faq__inner > p {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.directory-breadcrumb {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 24px;
  color: #aaa;
  font-size: 12px;
}

.directory-breadcrumb a {
  color: #e1e1e1;
  text-decoration: none;
}

.directory-breadcrumb a:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.directory-hero__eyebrow {
  margin-bottom: 24px;
  color: #aaa;
}

.directory-hero h1 {
  max-width: 960px;
  font-size: clamp(52px, 7.2vw, 104px);
  font-variation-settings: 'opsz' 104, 'wght' 300;
  font-weight: 300;
  letter-spacing: -0.055em;
  line-height: 0.93;
}

.directory-hero h1 em {
  color: #aaa;
  font-family: var(--font-serif);
  font-weight: 400;
}

.directory-hero__lead {
  max-width: 680px;
  margin-top: 32px;
  color: #b7b7b7;
  font-size: clamp(17px, 1.6vw, 21px);
  line-height: 1.55;
}

.directory-hero__link {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  gap: 10px;
  margin-top: 34px;
  border-bottom: 1px solid #777;
  color: #f7f7f7;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
}

.directory-hero__link:hover {
  border-color: #fff;
}

.directory-hero__link :deep(svg) {
  width: 16px;
  height: 16px;
}

.directory-results {
  scroll-margin-top: 20px;
  border-bottom: 1px solid #cfcfca;
  background: #ecece8;
}

.directory-results__inner {
  width: min(1340px, calc(100% - 96px));
  margin: 0 auto;
  padding: clamp(64px, 7vw, 96px) 0 clamp(76px, 8vw, 112px);
}

.directory-results__heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 32px;
  margin-bottom: 32px;
}

.directory-results__heading p {
  margin-bottom: 10px;
  color: #666;
}

.directory-results__heading h2 {
  font-size: clamp(34px, 4vw, 54px);
  font-variation-settings: 'opsz' 54, 'wght' 300;
  font-weight: 300;
  letter-spacing: -0.04em;
  line-height: 1;
}

.directory-results__count {
  flex: 0 0 auto;
  border: 1px solid #bdbdb8;
  border-radius: 999px;
  padding: 8px 12px;
  color: #555;
  font-size: 11px;
}

.directory-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
  margin-top: 34px;
}

.directory-state {
  display: grid;
  min-height: 180px;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 18px;
  margin-top: 34px;
  border: 1px solid #c9c9c4;
  border-radius: 6px;
  padding: 28px;
  background: #f7f7f5;
}

.directory-state strong {
  display: block;
  margin-bottom: 6px;
  font-size: 18px;
  font-weight: 600;
}

.directory-state p {
  max-width: 620px;
  color: #666;
  font-size: 14px;
  line-height: 1.5;
}

.directory-state__icon {
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
  border: 1px solid #ccc;
  border-radius: 50%;
  background: #fff;
}

.directory-state__icon :deep(svg) {
  width: 20px;
  height: 20px;
}

.directory-state__loader {
  width: 38px;
  height: 38px;
  border: 2px solid #ccc;
  border-top-color: #111;
  border-radius: 50%;
  animation: directory-spin 800ms linear infinite;
}

.directory-state button {
  display: inline-flex;
  min-height: 42px;
  align-items: center;
  gap: 8px;
  border: 1px solid #111;
  border-radius: 4px;
  padding: 9px 13px;
  background: #111;
  color: #fff;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
}

.directory-state button:hover {
  background: #353535;
}

.directory-state button :deep(svg) {
  width: 15px;
  height: 15px;
}

.directory-state--error {
  border-color: #c9a7a7;
  background: #fff8f8;
}

.directory-trust {
  background: #f7f7f5;
}

.directory-trust__inner,
.directory-guide__inner,
.directory-faq__inner {
  width: min(1340px, calc(100% - 96px));
  margin: 0 auto;
  padding: clamp(72px, 8vw, 112px) 0;
}

.directory-trust__inner > p,
.directory-guide__inner > p,
.directory-faq__inner > p {
  margin-bottom: 14px;
  color: #666;
}

.directory-trust h2 {
  max-width: 840px;
  font-size: clamp(40px, 5vw, 70px);
  font-variation-settings: 'opsz' 70, 'wght' 300;
  font-weight: 300;
  letter-spacing: -0.05em;
  line-height: 0.98;
}

.directory-trust h2 em {
  color: #666;
  font-family: var(--font-serif);
}

.directory-trust ol {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-top: 52px;
  border-top: 1px solid #aaa;
  list-style: none;
}

.directory-trust li {
  min-width: 0;
  padding: 24px 28px 0 0;
}

.directory-trust li + li {
  border-left: 1px solid #d2d2ce;
  padding-left: 28px;
}

.directory-trust li > span {
  display: block;
  margin-bottom: 28px;
  color: #666;
  font-family: var(--font-mono);
  font-size: 10px;
}

.directory-trust li strong {
  display: block;
  font-size: 18px;
  font-weight: 600;
}

.directory-trust li p {
  max-width: 340px;
  margin-top: 9px;
  color: #666;
  font-size: 14px;
  line-height: 1.55;
}

.directory-guide {
  border-bottom: 1px solid #cfcfca;
  background: #f7f7f5;
}

.directory-guide__intro {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(280px, 0.7fr);
  align-items: end;
  gap: 48px;
}

.directory-guide__intro h2,
.directory-faq h2 {
  max-width: 820px;
  font-size: clamp(38px, 4.7vw, 66px);
  font-variation-settings: 'opsz' 66, 'wght' 300;
  font-weight: 300;
  letter-spacing: -0.045em;
  line-height: 1;
}

.directory-guide__intro > p {
  color: #555;
  font-size: 15px;
  line-height: 1.65;
}

.directory-guide__points {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-top: 48px;
  border-top: 1px solid #aaa;
}

.directory-guide__points article {
  padding: 24px 28px 0 0;
}

.directory-guide__points article + article {
  border-left: 1px solid #d2d2ce;
  padding-left: 28px;
}

.directory-guide__points span {
  color: #666;
  font-family: var(--font-mono);
  font-size: 10px;
}

.directory-guide__points h3 {
  margin-top: 28px;
  font-size: 18px;
  font-weight: 600;
}

.directory-guide__points p {
  max-width: 350px;
  margin-top: 9px;
  color: #555;
  font-size: 14px;
  line-height: 1.6;
}

.directory-faq {
  border-top: 1px solid #cfcfca;
  background: #ecece8;
}

.directory-faq__list {
  margin-top: 42px;
  border-top: 1px solid #bdbdb8;
}

.directory-faq details {
  border-bottom: 1px solid #c7c7c2;
  padding: 0 2px;
}

.directory-faq summary {
  display: flex;
  min-height: 66px;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  color: #222;
  cursor: pointer;
  font-size: 16px;
  font-weight: 600;
  list-style: none;
}

.directory-faq summary::-webkit-details-marker {
  display: none;
}

.directory-faq summary::after {
  flex: 0 0 auto;
  color: #666;
  content: '+';
  font-size: 22px;
  font-weight: 300;
}

.directory-faq details[open] summary::after {
  content: '−';
}

.directory-faq details p {
  max-width: 760px;
  padding: 0 0 24px;
  color: #555;
  font-size: 14px;
  line-height: 1.65;
}

.directory-page :is(a, button, input):focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 3px;
}

@keyframes directory-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 1100px) {
  .directory-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .directory-hero__inner,
  .directory-results__inner,
  .directory-trust__inner,
  .directory-guide__inner,
  .directory-faq__inner {
    width: min(100% - 40px, 620px);
  }

  .directory-hero__inner {
    padding: 62px 0 72px;
  }

  .directory-hero h1 {
    font-size: clamp(46px, 15vw, 72px);
  }

  .directory-hero__lead {
    margin-top: 24px;
    font-size: 16px;
  }

  .directory-results__heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 18px;
  }

  .directory-grid {
    grid-template-columns: 1fr;
  }

  .directory-state {
    min-height: 220px;
    grid-template-columns: auto minmax(0, 1fr);
  }

  .directory-state button {
    grid-column: 1 / -1;
    justify-content: center;
  }

  .directory-trust ol {
    grid-template-columns: 1fr;
    gap: 0;
  }

  .directory-guide__intro {
    grid-template-columns: 1fr;
    align-items: start;
    gap: 20px;
  }

  .directory-guide__points {
    grid-template-columns: 1fr;
  }

  .directory-guide__points article {
    padding: 22px 0;
  }

  .directory-guide__points article + article {
    border-top: 1px solid #d2d2ce;
    border-left: 0;
    padding-left: 0;
  }

  .directory-guide__points h3 {
    margin-top: 12px;
  }

  .directory-trust li {
    padding: 22px 0;
  }

  .directory-trust li + li {
    border-top: 1px solid #d2d2ce;
    border-left: 0;
    padding-left: 0;
  }

  .directory-trust li > span {
    margin-bottom: 14px;
  }
}

@media (max-width: 380px) {
  .directory-hero h1 {
    font-size: 44px;
  }

  .directory-state {
    grid-template-columns: 1fr;
    padding: 22px;
  }

  .directory-state button {
    grid-column: auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .directory-state__loader {
    animation: none;
  }
}
</style>
