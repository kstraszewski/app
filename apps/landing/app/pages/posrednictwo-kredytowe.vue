<script setup lang="ts">
const { canonicalUrl, siteOrigin } = useLandingSeo({
  title: 'Pośrednictwo kredytowe dla ekspertów — akredytacja w 2 tygodnie | OpenExpert',
  description:
    'Prowadź pośrednictwo kredytowe z OpenExpert: wypłata prowizji do 5 dni roboczych od podpisania umowy kredytowej, bezpłatny dostęp do aplikacji, proste i transparentne stawki, akredytacja w 2 tygodnie oraz poczta Gmail 2 TB w cenie.',
  path: '/posrednictwo-kredytowe',
  socialImageAlt: 'Pośrednictwo kredytowe z OpenExpert — akredytacja w 2 tygodnie i prowizja do 5 dni roboczych',
})

useHead({
  script: [{
    key: 'structured-data:posrednictwo-kredytowe',
    type: 'application/ld+json',
    innerHTML: serializeLandingStructuredData({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebPage',
          '@id': `${canonicalUrl}#webpage`,
          url: canonicalUrl,
          name: 'Pośrednictwo kredytowe dla ekspertów — OpenExpert',
          description: 'Oferta pośrednictwa kredytowego dla niezależnych ekspertów i doradców: w pełni cyfrowa akredytacja w 2 tygodnie, wypłata prowizji do 5 dni roboczych od podpisania umowy kredytowej, bezpłatny dostęp do aplikacji, proste stawki i poczta Gmail 2 TB w cenie.',
          isPartOf: { '@id': `${siteOrigin}/#website` },
          about: { '@id': `${siteOrigin}/#organization` },
          breadcrumb: { '@id': `${canonicalUrl}#breadcrumb` },
          inLanguage: 'pl-PL',
        },
        {
          '@type': 'BreadcrumbList',
          '@id': `${canonicalUrl}#breadcrumb`,
          itemListElement: [
            {
              '@type': 'ListItem',
              position: 1,
              name: 'OpenExpert',
              item: `${siteOrigin}/`,
            },
            {
              '@type': 'ListItem',
              position: 2,
              name: 'Pośrednictwo kredytowe',
              item: canonicalUrl,
            },
          ],
        },
      ],
    }),
  }],
})

const heroSignals = [
  { icon: 'lucide:banknote', label: 'Prowizja do 5 dni roboczych' },
  { icon: 'lucide:badge-check', label: 'Akredytacja w 2 tygodnie' },
  { icon: 'lucide:app-window', label: 'Bezpłatna aplikacja' },
  { icon: 'lucide:mail', label: 'Gmail 2 TB w cenie' },
]

const stats = [
  {
    value: '2 tygodnie',
    label: 'w pełni cyfrowa akredytacja — najszybsza na rynku',
  },
  {
    value: 'do 5 dni roboczych',
    label: 'wypłata prowizji od podpisania umowy kredytowej z klientem',
  },
  {
    value: '0 zł',
    label: 'pełny, bezpłatny dostęp do aplikacji OpenExpert',
  },
  {
    value: '2 TB',
    label: 'poczta Gmail w cenie, w 100% zintegrowana z CRM',
  },
]

const benefits = [
  {
    icon: 'lucide:banknote',
    meta: 'Rozliczenia',
    title: 'Prowizja do 5 dni roboczych',
    description:
      'Wypłatę prowizji otrzymujesz do 5 dni roboczych od podpisania umowy kredytowej z klientem. Krótki cykl rozliczenia ułatwia planowanie przychodów.',
  },
  {
    icon: 'lucide:app-window',
    meta: 'Narzędzia pracy',
    title: 'Pełny, bezpłatny dostęp do aplikacji',
    description:
      'Od pierwszego dnia korzystasz z całego OpenExpert: CRM, proces obsługi klienta, dokumenty i agenci AI w jednym miejscu. Bez opłat za dostęp do aplikacji.',
  },
  {
    icon: 'lucide:percent',
    meta: 'Zasady współpracy',
    title: 'Proste i transparentne stawki',
    description:
      'Stawki prowizyjne mamy proste i przejrzyste. Znasz zasady rozliczenia, zanim rozpoczniesz pierwszą sprawę — bez ukrytych warunków i skomplikowanych tabel.',
  },
  {
    icon: 'lucide:badge-check',
    meta: 'Start',
    title: 'Akredytacja w 2 tygodnie',
    description:
      'To najszybsza na rynku i jedyna w pełni cyfrowa akredytacja. Cały proces załatwisz online, a wejście w pośrednictwo kredytowe zajmuje 2 tygodnie.',
  },
  {
    icon: 'lucide:mail',
    meta: 'Komunikacja',
    title: 'Gmail 2 TB w cenie',
    description:
      'Do pracy dostajesz pocztę Gmail o pojemności 2 TB — zawsze dostępną i w 100% zintegrowaną z CRM. Korespondencja z klientem i bankiem trafia prosto do kontekstu sprawy.',
    linkLabel: 'Zobacz OpenExpert Mail',
    linkTo: '/poczta-dla-ekseprta',
  },
]

const processSteps = [
  {
    number: '01',
    icon: 'lucide:send',
    label: 'Zgłoszenie',
    title: 'Startujesz online',
    description:
      'Wypełniasz jedno zgłoszenie i przekazujesz dane potrzebne do akredytacji. Bez dokumentów na papierze i wizyt stacjonarnych.',
  },
  {
    number: '02',
    icon: 'lucide:badge-check',
    label: 'Akredytacja',
    title: 'Cyfrowa akredytacja w 2 tygodnie',
    description:
      'Najszybsza ścieżka na rynku i jedyna prowadzona w pełni cyfrowo. Po 2 tygodniach możesz pracować na pośrednictwie kredytowym.',
  },
  {
    number: '03',
    icon: 'lucide:briefcase',
    label: 'Praca z klientem',
    title: 'Prowadzisz sprawy w jednej aplikacji',
    description:
      'CRM, proces kredytowy i poczta Gmail zintegrowana z CRM-em w 100%. Korespondencja, dokumenty i statusy spraw są w jednym miejscu.',
  },
  {
    number: '04',
    icon: 'lucide:banknote',
    label: 'Rozliczenie',
    title: 'Prowizja do 5 dni roboczych',
    description:
      'Od podpisania umowy kredytowej z klientem masz do 5 dni roboczych na wypłatę prowizji. Stawki pozostają proste i transparentne.',
  },
]
</script>

<template>
  <div class="credit-page">
    <DirectorySiteHeader />

    <main id="directory-content" tabindex="-1">
      <section class="credit-hero" aria-labelledby="credit-hero-title">
        <div class="credit-shell">
          <nav class="credit-breadcrumb" aria-label="Okruszki">
            <NuxtLink to="/">OpenExpert</NuxtLink>
            <span aria-hidden="true">/</span>
            <span aria-current="page">Pośrednictwo kredytowe</span>
          </nav>

          <p class="credit-kicker">Dla niezależnych ekspertów i doradców</p>
          <h1 id="credit-hero-title">
            Prowadź kredyty w jednym systemie.{{ ' ' }}
            <em>Prowizja do 5 dni roboczych.</em>
          </h1>
          <p class="credit-hero__lead">
            OpenExpert to zaplecze dla Twojego pośrednictwa kredytowego: w pełni
            cyfrowa akredytacja w 2 tygodnie, bezpłatna aplikacja z CRM, proste
            i transparentne stawki oraz poczta Gmail 2 TB w cenie, zintegrowana
            z CRM w 100%.
          </p>

          <div class="credit-hero__actions">
            <NuxtLink to="/#dolacz" class="credit-button credit-button--primary">
              Zacznij z OpenExpert
              <Icon name="lucide:arrow-right" aria-hidden="true" />
            </NuxtLink>
            <a href="#akredytacja" class="credit-button credit-button--secondary">
              Zobacz, jak zacząć
            </a>
          </div>

          <ul class="credit-hero__signals" aria-label="Najważniejsze warunki współpracy">
            <li v-for="signal in heroSignals" :key="signal.label">
              <Icon :name="signal.icon" aria-hidden="true" />
              {{ signal.label }}
            </li>
          </ul>
        </div>
      </section>

      <section class="credit-stats" aria-label="Kluczowe warunki współpracy w liczbach">
        <div class="credit-shell">
          <dl class="credit-stats__grid">
            <div v-for="stat in stats" :key="stat.value">
              <dt>{{ stat.value }}</dt>
              <dd>{{ stat.label }}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section id="korzysci" class="credit-benefits" aria-labelledby="credit-benefits-title">
        <div class="credit-shell">
          <header class="credit-section-heading credit-section-heading--split">
            <div>
              <p class="credit-kicker">Co dostajesz z OpenExpert</p>
              <h2 id="credit-benefits-title">Warunki, które realnie{{ ' ' }}<em>zmieniają Twoją pracę.</em></h2>
            </div>
            <p>
              Zasady współpracy opisujemy wprost. Pięć konkretów, które otrzymujesz,
              gdy prowadzisz pośrednictwo kredytowe z OpenExpert.
            </p>
          </header>

          <div class="credit-benefits__grid">
            <article v-for="(benefit, index) in benefits" :key="benefit.title">
              <div class="credit-benefit__topline">
                <span>0{{ index + 1 }}</span>
                <small>{{ benefit.meta }}</small>
              </div>
              <span class="credit-benefit__icon"><Icon :name="benefit.icon" aria-hidden="true" /></span>
              <h3>{{ benefit.title }}</h3>
              <p>{{ benefit.description }}</p>
              <NuxtLink v-if="benefit.linkTo" :to="benefit.linkTo" class="credit-benefit__link">
                {{ benefit.linkLabel }}
                <Icon name="lucide:arrow-right" aria-hidden="true" />
              </NuxtLink>
            </article>
            <article class="credit-benefits__cta">
              <h3>Poznaj drogę wejścia</h3>
              <p>Cztery kroki od zgłoszenia do pierwszej wypłaty prowizji.</p>
              <a href="#akredytacja">
                Przejdź do procesu
                <Icon name="lucide:arrow-down" aria-hidden="true" />
              </a>
            </article>
          </div>
        </div>
      </section>

      <section id="akredytacja" class="credit-process" aria-labelledby="credit-process-title">
        <div class="credit-shell">
          <header class="credit-process__heading">
            <p class="credit-kicker">Proces wejścia</p>
            <h2 id="credit-process-title">Od zgłoszenia do pierwszej{{ ' ' }}<em>wypłaty prowizji.</em></h2>
          </header>

          <ol class="credit-process__steps">
            <li v-for="step in processSteps" :key="step.number">
              <div class="credit-process__number">{{ step.number }}</div>
              <span class="credit-process__icon"><Icon :name="step.icon" aria-hidden="true" /></span>
              <div>
                <p>{{ step.label }}</p>
                <h3>{{ step.title }}</h3>
                <span>{{ step.description }}</span>
              </div>
            </li>
          </ol>

          <aside class="credit-process__aside">
            <div>
              <Icon name="lucide:shield-check" aria-hidden="true" />
              <span>Transparentność od pierwszego dnia</span>
            </div>
            <p>
              Proste stawki prowizyjne i jasny harmonogram wypłat: prowizja trafia
              do Ciebie do 5 dni roboczych od podpisania umowy kredytowej
              z klientem. Masz pytania przed zgłoszeniem? Napisz na
              <a href="mailto:hello@openexpert.app">hello@openexpert.app</a>.
            </p>
          </aside>
        </div>
      </section>

      <section class="credit-final" aria-labelledby="credit-final-title">
        <div class="credit-shell">
          <p class="credit-kicker">Pośrednictwo kredytowe z OpenExpert</p>
          <h2 id="credit-final-title">Gotowy, aby poprowadzić{{ ' ' }}<em>sprawy kredytowe?</em></h2>
          <p>
            Rozpocznij akredytację, korzystaj z pełnej aplikacji bezpłatnie
            i odbieraj prowizję do 5 dni roboczych od podpisania umowy kredytowej
            z klientem.
          </p>
          <div class="credit-final__actions">
            <NuxtLink to="/#dolacz" class="credit-button credit-button--primary">
              Zacznij z OpenExpert
              <Icon name="lucide:arrow-right" aria-hidden="true" />
            </NuxtLink>
            <NuxtLink to="/" class="credit-button credit-button--secondary">Wróć na stronę główną</NuxtLink>
          </div>
        </div>
      </section>
    </main>

    <DirectorySiteFooter />
  </div>
</template>

<style scoped>
.credit-page {
  min-width: 0;
  background: #f7f7f5;
  color: #111;
  font-family: var(--font-sans);
}

#directory-content:focus {
  outline: none;
}

.credit-shell {
  width: min(1240px, calc(100% - 96px));
  margin: 0 auto;
}

.credit-kicker {
  color: #666;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  line-height: 1.5;
  text-transform: uppercase;
}

.credit-hero {
  border-bottom: 1px solid #292929;
  background:
    radial-gradient(circle at 78% 12%, rgb(53 118 84 / 18%), transparent 34%),
    #030303;
  color: #f7f7f7;
  padding: 34px 0 clamp(84px, 10vw, 132px);
}

.credit-breadcrumb {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: clamp(56px, 7vw, 92px);
  color: #777;
  font-size: 12px;
}

.credit-breadcrumb a {
  color: #b6b6b6;
  text-decoration: none;
}

.credit-breadcrumb a:hover {
  color: #fff;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.credit-hero .credit-kicker {
  color: #8fd8b8;
}

.credit-hero h1 {
  max-width: 940px;
  margin-top: 20px;
  font-size: clamp(46px, 6.4vw, 90px);
  font-variation-settings: 'opsz' 88, 'wght' 300;
  font-weight: 300;
  letter-spacing: -0.055em;
  line-height: 0.95;
}

.credit-hero h1 em {
  display: block;
  color: #b9e8d1;
  font-variation-settings: 'opsz' 68, 'wght' 340;
  font-weight: 340;
}

.credit-hero__lead {
  max-width: 720px;
  margin-top: 32px;
  color: #b0b0b0;
  font-size: clamp(16px, 1.5vw, 19px);
  line-height: 1.65;
}

.credit-hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 36px;
}

.credit-button {
  display: inline-flex;
  min-height: 48px;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border: 1px solid;
  border-radius: 4px;
  padding: 12px 17px;
  font-size: 13px;
  font-weight: 650;
  text-decoration: none;
  transition:
    background-color var(--transition-fast),
    border-color var(--transition-fast),
    color var(--transition-fast),
    transform var(--transition-fast);
}

.credit-button:hover {
  transform: translateY(-1px);
}

.credit-button--primary {
  border-color: #d8f4e6;
  background: #b9e8d1;
  box-shadow: 0 8px 24px rgb(143 216 184 / 12%);
  color: #10231a;
}

.credit-button--primary:hover {
  background: #cef2df;
}

.credit-button--secondary {
  border-color: #484848;
  background: #121212;
  color: #ededed;
}

.credit-button--secondary:hover {
  border-color: #777;
  background: #1a1a1a;
}

.credit-button :deep(svg) {
  width: 16px;
  height: 16px;
}

.credit-hero__signals {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 20px;
  margin-top: 38px;
  color: #8f8f8f;
  list-style: none;
}

.credit-hero__signals li {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}

.credit-hero__signals li :deep(svg) {
  width: 14px;
  height: 14px;
  color: #8fd8b8;
}

.credit-stats {
  border-bottom: 1px solid #d0d0cb;
  background: #fbfbf8;
  padding: clamp(40px, 5vw, 64px) 0;
}

.credit-stats__grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: clamp(28px, 4vw, 56px);
}

.credit-stats__grid dt {
  font-size: clamp(26px, 2.6vw, 38px);
  font-variation-settings: 'opsz' 40, 'wght' 380;
  font-weight: 380;
  letter-spacing: -0.04em;
  line-height: 1.05;
}

.credit-stats__grid dd {
  max-width: 260px;
  margin-top: 10px;
  color: #666;
  font-size: 12px;
  line-height: 1.55;
}

.credit-benefits {
  padding: clamp(78px, 9vw, 124px) 0;
}

.credit-section-heading {
  margin-bottom: clamp(44px, 6vw, 72px);
}

.credit-section-heading--split {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.65fr);
  align-items: end;
  gap: clamp(44px, 7vw, 110px);
}

.credit-section-heading h2 {
  margin-top: 20px;
  font-size: clamp(38px, 5vw, 66px);
  font-variation-settings: 'opsz' 68, 'wght' 300;
  font-weight: 300;
  letter-spacing: -0.05em;
  line-height: 1;
}

.credit-section-heading h2 em {
  color: #777;
  font-family: var(--font-serif);
  font-weight: 400;
}

.credit-section-heading--split > p {
  color: #555;
  font-size: 15px;
  line-height: 1.7;
}

.credit-benefits__grid {
  display: grid;
  overflow: hidden;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  border: 1px solid #d6d6d1;
  border-radius: 7px;
  background: #d6d6d1;
}

.credit-benefits__grid article {
  display: flex;
  min-width: 0;
  flex-direction: column;
  background: #f7f7f3;
  padding: 28px clamp(22px, 3vw, 36px) 34px;
}

.credit-benefit__topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  color: #898983;
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.credit-benefit__icon {
  display: grid;
  width: 48px;
  height: 48px;
  flex: 0 0 auto;
  place-items: center;
  margin-top: 46px;
  border: 1px solid #bfcfc6;
  border-radius: 50%;
  background: #e9f3ed;
  color: #2f7958;
}

.credit-benefit__icon :deep(svg) {
  width: 22px;
  height: 22px;
  stroke-width: 1.35;
}

.credit-benefits__grid h3 {
  margin-top: 23px;
  font-size: 21px;
  font-weight: 520;
  letter-spacing: -0.03em;
  line-height: 1.18;
}

.credit-benefits__grid article > p {
  margin-top: 12px;
  color: #686864;
  font-size: 13px;
  line-height: 1.65;
}

.credit-benefit__link {
  display: inline-flex;
  width: fit-content;
  align-items: center;
  gap: 8px;
  margin-top: auto;
  padding-top: 18px;
  border-bottom: 1px solid #2f7958;
  color: #2f7958;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
}

.credit-benefit__link :deep(svg) {
  width: 15px;
  height: 15px;
}

.credit-benefits__cta {
  justify-content: flex-end;
  background: #111;
}

.credit-benefits__cta h3 {
  color: #f4f4f4;
}

.credit-benefits__cta > p {
  color: #a3a3a3;
}

.credit-benefits__cta a {
  display: inline-flex;
  width: fit-content;
  align-items: center;
  gap: 9px;
  margin-top: 22px;
  border-bottom: 1px solid #8fd8b8;
  color: #b9e8d1;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
}

.credit-benefits__cta a :deep(svg) {
  width: 15px;
  height: 15px;
}

.credit-process {
  border-bottom: 1px solid #294437;
  background: #07120c;
  color: #f4f5f2;
  padding: clamp(78px, 9vw, 124px) 0;
}

.credit-process .credit-kicker {
  color: #8fd8b8;
}

.credit-process__heading h2 {
  max-width: 900px;
  margin-top: 20px;
  font-size: clamp(38px, 5vw, 66px);
  font-variation-settings: 'opsz' 68, 'wght' 290;
  font-weight: 290;
  letter-spacing: -0.05em;
  line-height: 1;
}

.credit-process__heading h2 em {
  color: #b9e8d1;
}

.credit-process__steps {
  margin-top: clamp(48px, 6vw, 80px);
  border-top: 1px solid #355244;
  list-style: none;
}

.credit-process__steps li {
  display: grid;
  grid-template-columns: 74px 64px minmax(0, 1fr);
  align-items: center;
  gap: 24px;
  border-bottom: 1px solid #355244;
  padding: 27px 0;
}

.credit-process__number {
  color: #668271;
  font-family: var(--font-mono);
  font-size: 10px;
}

.credit-process__icon {
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
  border: 1px solid #3c6752;
  border-radius: 50%;
  color: #9de0bd;
}

.credit-process__icon :deep(svg) {
  width: 21px;
  height: 21px;
  stroke-width: 1.4;
}

.credit-process__steps li > div:last-child {
  display: grid;
  grid-template-columns: minmax(110px, 0.35fr) minmax(240px, 0.75fr) minmax(300px, 1fr);
  align-items: center;
  gap: clamp(24px, 4vw, 64px);
}

.credit-process__steps p {
  color: #8fd8b8;
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.credit-process__steps h3 {
  font-size: clamp(18px, 2vw, 25px);
  font-weight: 470;
  letter-spacing: -0.03em;
  line-height: 1.2;
}

.credit-process__steps li > div:last-child > span {
  color: #8f9c94;
  font-size: 12.5px;
  line-height: 1.6;
}

.credit-process__aside {
  display: grid;
  grid-template-columns: minmax(230px, 0.45fr) minmax(0, 1fr);
  align-items: center;
  gap: clamp(28px, 5vw, 80px);
  margin-top: 34px;
  border: 1px solid #355244;
  border-radius: 5px;
  background: #0c1c13;
  padding: 22px 26px;
}

.credit-process__aside > div {
  display: flex;
  align-items: center;
  gap: 13px;
  color: #dcebe2;
  font-size: 13px;
  font-weight: 600;
}

.credit-process__aside :deep(svg) {
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  color: #8fd8b8;
  stroke-width: 1.35;
}

.credit-process__aside > p {
  color: #92a097;
  font-size: 12.5px;
  line-height: 1.6;
}

.credit-process__aside a {
  color: #b9e8d1;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.credit-final {
  background:
    radial-gradient(circle at 77% 45%, rgb(53 118 84 / 10%), transparent 32%),
    #ecece8;
  padding: clamp(88px, 10vw, 140px) 0;
}

.credit-final h2 {
  max-width: 960px;
  margin-top: 21px;
  font-size: clamp(42px, 6.2vw, 86px);
  font-variation-settings: 'opsz' 82, 'wght' 300;
  font-weight: 300;
  letter-spacing: -0.055em;
  line-height: 0.96;
}

.credit-final h2 em {
  color: #2f7958;
  font-family: var(--font-serif);
  font-weight: 400;
}

.credit-final > .credit-shell > p:not(.credit-kicker) {
  max-width: 640px;
  margin-top: 28px;
  color: #555;
  font-size: 16px;
  line-height: 1.65;
}

.credit-final__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 36px;
}

.credit-final .credit-button--primary {
  border-color: #111;
  background: #111;
  box-shadow: none;
  color: #fff;
}

.credit-final .credit-button--primary:hover {
  background: #2c2c2c;
}

.credit-final .credit-button--secondary {
  border-color: #111;
  background: transparent;
  color: #111;
}

.credit-final .credit-button--secondary:hover {
  border-color: #555;
  background: rgb(17 17 17 / 5%);
}

.credit-page :is(a, button):focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 3px;
}

@media (max-width: 1099px) {
  .credit-shell {
    width: min(860px, calc(100% - 64px));
  }

  .credit-hero h1 {
    max-width: 720px;
  }

  .credit-section-heading--split {
    grid-template-columns: 1fr;
    align-items: start;
    gap: 28px;
  }

  .credit-section-heading--split > p {
    max-width: 660px;
  }

  .credit-benefits__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .credit-process__steps li > div:last-child {
    grid-template-columns: minmax(90px, 0.3fr) minmax(220px, 0.7fr) minmax(0, 1fr);
    gap: 28px;
  }
}

@media (max-width: 760px) {
  .credit-shell {
    width: min(100% - 40px, 620px);
  }

  .credit-hero {
    padding-top: 28px;
  }

  .credit-breadcrumb {
    margin-bottom: 54px;
  }

  .credit-hero h1 {
    font-size: clamp(42px, 12vw, 62px);
  }

  .credit-hero__lead {
    margin-top: 24px;
    font-size: 15px;
  }

  .credit-hero__actions,
  .credit-final__actions {
    flex-direction: column;
  }

  .credit-button {
    width: 100%;
  }

  .credit-hero__signals {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px 16px;
  }

  .credit-stats__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 32px 24px;
  }

  .credit-section-heading h2 {
    font-size: clamp(34px, 10vw, 52px);
  }

  .credit-benefits__grid {
    grid-template-columns: 1fr;
  }

  .credit-benefits__grid article {
    padding: 25px 22px 30px;
  }

  .credit-benefit__icon {
    margin-top: 36px;
  }

  .credit-process__heading h2 {
    font-size: clamp(34px, 10vw, 52px);
  }

  .credit-process__steps li {
    grid-template-columns: 42px minmax(0, 1fr);
    align-items: start;
    gap: 18px;
    padding: 26px 0;
  }

  .credit-process__number {
    grid-column: 1;
    grid-row: 1;
  }

  .credit-process__icon {
    grid-column: 1;
    grid-row: 2;
    width: 38px;
    height: 38px;
  }

  .credit-process__steps li > div:last-child {
    display: flex;
    grid-column: 2;
    grid-row: 1 / span 2;
    align-items: flex-start;
    flex-direction: column;
    gap: 10px;
  }

  .credit-process__aside {
    grid-template-columns: 1fr;
    gap: 16px;
    padding: 20px;
  }

  .credit-final h2 {
    font-size: clamp(40px, 11vw, 58px);
  }
}

@media (max-width: 420px) {
  .credit-hero__signals {
    grid-template-columns: 1fr;
  }

  .credit-stats__grid {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .credit-button {
    transition: none;
  }

  .credit-button:hover {
    transform: none;
  }
}
</style>
