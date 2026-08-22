<script setup lang="ts">
const contactHref = 'mailto:hello@openexpert.app?subject=Po%C5%9Brednictwo%20kredytowe%20z%20OpenExpert'

const { canonicalUrl, siteOrigin } = useLandingSeo({
  title: 'Pośrednictwo kredytowe dla ekspertów | OpenExpert',
  description: 'Cyfrowa akredytacja w 2 tygodnie, prowizja wypłacana do 5 dni roboczych od podpisania umowy kredytowej z klientem i bezpłatny dostęp do OpenExpert.',
  path: '/posrednictwo-kredytowe',
  socialImageAlt: 'Pośrednictwo kredytowe z OpenExpert',
})

useHead({
  script: [{
    key: 'structured-data:brokerage',
    type: 'application/ld+json',
    innerHTML: serializeLandingStructuredData({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      '@id': `${canonicalUrl}#webpage`,
      url: canonicalUrl,
      name: 'Pośrednictwo kredytowe dla ekspertów — OpenExpert',
      description: 'Warunki współpracy dla ekspertów kredytowych w OpenExpert.',
      isPartOf: { '@id': `${siteOrigin}/#website` },
      inLanguage: 'pl-PL',
    }),
  }],
})

const journey = [
  {
    number: '01',
    icon: 'lucide:badge-check',
    label: 'Akredytacja',
    title: '2 tygodnie. W pełni cyfrowo.',
    description: 'Najszybsza na rynku i jedyna w pełni cyfrowa akredytacja.',
  },
  {
    number: '02',
    icon: 'lucide:file-signature',
    label: 'Sprzedaż',
    title: 'Podpisujesz umowę z klientem.',
    description: 'Prowadzisz klienta i sprawę w jednym, uporządkowanym środowisku.',
  },
  {
    number: '03',
    icon: 'lucide:banknote',
    label: 'Rozliczenie',
    title: 'Prowizja trafia do Ciebie.',
    description: 'Do 5 dni roboczych od podpisania umowy kredytowej z klientem.',
  },
]

const partnership = [
  {
    number: '01',
    title: 'Pełny OpenExpert za darmo',
    description: 'CRM, obsługa spraw, dokumenty i komunikacja — bez opłat za dostęp do aplikacji.',
  },
  {
    number: '02',
    title: 'Transparentne stawki',
    description: 'Proste zasady prowizyjne, które znasz przed rozpoczęciem współpracy.',
  },
  {
    number: '03',
    title: 'Szybkie rozliczenie',
    description: 'Od podpisania umowy kredytowej z klientem do wypłaty prowizji — do 5 dni roboczych.',
  },
]

const mailFeatures = [
  {
    icon: 'lucide:mail',
    title: 'Gmail 2 TB w cenie',
    description: 'Duża skrzynka do codziennej pracy z klientami i bankami.',
  },
  {
    icon: 'lucide:refresh-cw',
    title: 'Zawsze dostępna',
    description: 'Twoja korespondencja jest pod ręką dokładnie wtedy, kiedy jej potrzebujesz.',
  },
  {
    icon: 'lucide:workflow',
    title: '100% zintegrowana z CRM',
    description: 'Wiadomości, załączniki i kontekst klienta pozostają przy właściwej sprawie.',
  },
]
</script>

<template>
  <div class="brokerage-page">
    <DirectorySiteHeader
      :cta-href="contactHref"
      cta-label="Zostań partnerem"
    />

    <main id="directory-content" tabindex="-1">
      <section class="hero" aria-labelledby="brokerage-title">
        <div class="hero__main">
          <nav class="breadcrumb" aria-label="Okruszki">
            <NuxtLink to="/">OpenExpert</NuxtLink>
            <span aria-hidden="true">/</span>
            <span aria-current="page">Pośrednictwo kredytowe</span>
          </nav>

          <div class="hero__copy">
            <p class="overline">System pracy dla eksperta kredytowego</p>
            <h1 id="brokerage-title">
              Kredyty.<br>
              <em>Na Twoich zasadach.</em>
            </h1>
            <p class="hero__lead">
              OpenExpert łączy technologię, proces i jasne warunki współpracy,
              abyś mógł skupić się na kliencie i swoim wyniku.
            </p>
            <a :href="contactHref" class="button button--dark">
              Porozmawiajmy o współpracy
              <Icon name="lucide:arrow-up-right" aria-hidden="true" />
            </a>
          </div>

          <div class="payout-proof">
            <strong>5</strong>
            <div>
              <span>dni roboczych</span>
              <p>
                od podpisania umowy kredytowej z klientem
                <b>do wypłaty prowizji</b>
              </p>
            </div>
          </div>
        </div>

        <aside class="journey" aria-label="Od akredytacji do wypłaty prowizji">
          <p class="journey__heading">Twoja droga do prowizji</p>
          <ol>
            <li v-for="step in journey" :key="step.number">
              <span class="journey__number">{{ step.number }}</span>
              <Icon :name="step.icon" aria-hidden="true" />
              <p class="journey__label">{{ step.label }}</p>
              <h2>{{ step.title }}</h2>
              <p class="journey__description">{{ step.description }}</p>
            </li>
          </ol>
        </aside>
      </section>

      <section class="accreditation" aria-labelledby="accreditation-title">
        <div class="accreditation__inner">
          <Icon name="lucide:calendar-check-2" aria-hidden="true" />
          <div>
            <p class="overline">Akredytacja w 2 tygodnie</p>
            <h2 id="accreditation-title">Całość online. Od pierwszego kroku.</h2>
          </div>
          <p>
            Najszybsza na rynku i jedyna w pełni cyfrowa akredytacja.
            Prosty proces bez papierowego obiegu.
          </p>
          <a href="#warunki">
            Zobacz warunki
            <Icon name="lucide:arrow-down" aria-hidden="true" />
          </a>
        </div>
      </section>

      <section id="warunki" class="partnership" aria-labelledby="partnership-title">
        <div class="shell">
          <header class="section-heading">
            <p class="overline">Partnerstwo bez drobnego druku</p>
            <h2 id="partnership-title">
              Wszystko, czego potrzebujesz.<br>
              <em>Bez rzeczy, których nie potrzebujesz.</em>
            </h2>
          </header>

          <ol class="partnership__list">
            <li v-for="item in partnership" :key="item.number">
              <span>{{ item.number }}</span>
              <h3>{{ item.title }}</h3>
              <p>{{ item.description }}</p>
              <Icon name="lucide:arrow-down-right" aria-hidden="true" />
            </li>
          </ol>
        </div>
      </section>

      <section id="mail" class="mail" aria-labelledby="mail-title">
        <div class="shell">
          <div class="mail__heading">
            <div>
              <p class="overline">OpenExpert Mail</p>
              <h2 id="mail-title">
                Gmail 2 TB w cenie.<br>
                <em>Poczta, która zna sprawę.</em>
              </h2>
            </div>
            <p>
              Zawsze dostępna i w 100% zintegrowana z CRM. Bez przełączania się
              między skrzynką, klientem i dokumentami.
            </p>
          </div>

          <div class="mail__features">
            <article v-for="feature in mailFeatures" :key="feature.title">
              <Icon :name="feature.icon" aria-hidden="true" />
              <h3>{{ feature.title }}</h3>
              <p>{{ feature.description }}</p>
            </article>
          </div>

          <div class="mail__flow" aria-label="Integracja poczty z CRM">
            <div>
              <Icon name="lucide:mail-open" aria-hidden="true" />
              <span>Wiadomość od klienta</span>
            </div>
            <Icon name="lucide:arrow-right" aria-hidden="true" />
            <div>
              <Icon name="lucide:paperclip" aria-hidden="true" />
              <span>Dokumenty i historia</span>
            </div>
            <Icon name="lucide:arrow-right" aria-hidden="true" />
            <div>
              <Icon name="lucide:folder-check" aria-hidden="true" />
              <span>Właściwa sprawa w CRM</span>
            </div>
          </div>
        </div>
      </section>

      <section id="kontakt" class="closing" aria-labelledby="closing-title">
        <div class="shell closing__inner">
          <div>
            <p class="overline">Pośrednictwo kredytowe z OpenExpert</p>
            <h2 id="closing-title">
              Gotowy na prostszy start<br>
              <em>i szybsze rozliczenie?</em>
            </h2>
          </div>
          <div class="closing__action">
            <p>Napisz do nas. Pokażemy Ci proces akredytacji i zasady współpracy.</p>
            <a :href="contactHref" class="button button--light">
              Napisz do OpenExpert
              <Icon name="lucide:arrow-up-right" aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>
    </main>

    <DirectorySiteFooter />
  </div>
</template>

<style scoped>
.brokerage-page {
  --brokerage-display: Baskerville, 'Iowan Old Style', Georgia, 'Times New Roman', serif;

  min-width: 0;
  background: #f6f4ef;
  color: #0b0b0b;
  font-family: var(--font-sans);
}

#directory-content:focus {
  outline: none;
}

.shell {
  width: min(1240px, calc(100% - 96px));
  margin: 0 auto;
}

.overline {
  color: #6b6963;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.13em;
  line-height: 1.5;
  text-transform: uppercase;
}

.button {
  display: inline-flex;
  min-height: 48px;
  align-items: center;
  justify-content: center;
  gap: 11px;
  border: 1px solid;
  padding: 11px 17px;
  font-size: 13px;
  font-weight: 650;
  text-decoration: none;
  transition: transform var(--transition-fast), background-color var(--transition-fast);
}

.button:hover {
  transform: translateY(-2px);
}

.button :deep(svg) {
  width: 16px;
  height: 16px;
}

.button--dark {
  border-color: #0b0b0b;
  background: #0b0b0b;
  color: #fff;
}

.button--dark:hover {
  background: #303030;
}

.button--light {
  border-color: #fff;
  background: #fff;
  color: #0b0b0b;
}

.brokerage-page :is(a, button):focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 4px;
}

.hero {
  display: grid;
  grid-template-columns: minmax(0, 2.2fr) minmax(320px, 0.8fr);
  min-height: 860px;
  border-bottom: 1px solid #cac7c0;
}

.hero__main {
  display: flex;
  min-width: 0;
  flex-direction: column;
  padding: 34px clamp(48px, 7vw, 112px) 48px;
}

.breadcrumb {
  display: flex;
  align-items: center;
  gap: 9px;
  color: #85817a;
  font-size: 12px;
}

.breadcrumb a {
  color: #3e3c38;
  text-decoration: none;
}

.breadcrumb a:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.hero__copy {
  max-width: 860px;
  margin-top: clamp(82px, 9vw, 128px);
}

.hero h1 {
  margin-top: 26px;
  font-family: var(--brokerage-display);
  font-size: clamp(76px, 7.2vw, 112px);
  font-synthesis: none;
  font-weight: 400;
  letter-spacing: -0.045em;
  line-height: 0.92;
  text-wrap: balance;
}

.hero h1 em {
  color: #55524c;
  font-family: inherit;
  font-style: normal;
  font-weight: 400;
}

.hero__lead {
  max-width: 520px;
  margin-top: 36px;
  color: #4f4c47;
  font-size: 16px;
  line-height: 1.7;
}

.hero__copy .button {
  margin-top: 32px;
}

.payout-proof {
  display: flex;
  align-items: flex-end;
  gap: 24px;
  margin-top: auto;
  padding-top: 80px;
}

.payout-proof > strong {
  font-family: var(--brokerage-display);
  font-size: clamp(142px, 15vw, 220px);
  font-synthesis: none;
  font-weight: 400;
  letter-spacing: -0.08em;
  line-height: 0.62;
}

.payout-proof span {
  display: block;
  font-family: var(--brokerage-display);
  font-size: clamp(38px, 3.8vw, 58px);
  font-synthesis: none;
  letter-spacing: -0.035em;
  line-height: 0.95;
}

.payout-proof p {
  max-width: 310px;
  margin-top: 15px;
  color: #55524c;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.06em;
  line-height: 1.55;
  text-transform: uppercase;
}

.payout-proof b {
  display: block;
  color: #0b0b0b;
  font-weight: 700;
}

.journey {
  display: flex;
  min-width: 0;
  flex-direction: column;
  padding: 42px clamp(30px, 3.2vw, 52px);
  background: #080808;
  color: #f7f7f4;
}

.journey__heading {
  color: #81817c;
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.journey ol {
  display: grid;
  flex: 1;
  grid-template-rows: repeat(3, 1fr);
  margin-top: 32px;
  list-style: none;
}

.journey li {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: center;
  border-top: 1px solid #30302e;
  padding: 30px 0 30px 38px;
}

.journey li:first-child {
  border-top: 0;
}

.journey__number {
  position: absolute;
  top: 32px;
  left: 0;
  color: #a4a49f;
  font-family: var(--font-mono);
  font-size: 11px;
}

.journey li > :deep(svg) {
  width: 30px;
  height: 30px;
  margin-bottom: 23px;
  stroke-width: 1.25;
}

.journey__label {
  color: #888883;
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.journey h2 {
  margin-top: 9px;
  font-size: 21px;
  font-weight: 450;
  letter-spacing: -0.035em;
  line-height: 1.15;
}

.journey__description {
  max-width: 250px;
  margin-top: 10px;
  color: #a9a9a3;
  font-size: 12px;
  line-height: 1.6;
}

.accreditation {
  background: #080808;
  color: #fff;
}

.accreditation__inner {
  display: grid;
  width: min(1440px, 100%);
  min-height: 132px;
  grid-template-columns: auto 1fr 1fr auto;
  align-items: center;
  gap: clamp(24px, 4vw, 60px);
  margin: 0 auto;
  border-top: 1px solid #30302e;
  padding: 28px 48px;
}

.accreditation__inner > :deep(svg) {
  width: 37px;
  height: 37px;
  stroke-width: 1.25;
}

.accreditation .overline {
  color: #8d8d87;
}

.accreditation h2 {
  margin-top: 6px;
  font-family: var(--brokerage-display);
  font-size: 31px;
  font-synthesis: none;
  font-weight: 400;
  letter-spacing: -0.02em;
}

.accreditation__inner > p {
  max-width: 430px;
  color: #aaa9a4;
  font-size: 13px;
  line-height: 1.65;
}

.accreditation a {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
}

.accreditation a :deep(svg) {
  width: 16px;
  height: 16px;
}

.partnership {
  border-bottom: 1px solid #cac7c0;
  padding: clamp(88px, 10vw, 144px) 0;
}

.section-heading h2,
.mail h2,
.closing h2 {
  margin-top: 25px;
  font-size: clamp(48px, 6vw, 82px);
  font-variation-settings: 'opsz' 80, 'wght' 300;
  font-weight: 300;
  letter-spacing: -0.055em;
  line-height: 0.94;
}

.section-heading h2 em,
.mail h2 em,
.closing h2 em {
  color: #67645e;
  font-family: var(--brokerage-display);
  font-synthesis: none;
  font-weight: 400;
}

.partnership__list {
  margin-top: 76px;
  border-top: 1px solid #8f8b83;
  list-style: none;
}

.partnership__list li {
  display: grid;
  grid-template-columns: 80px minmax(220px, 0.8fr) minmax(280px, 1fr) auto;
  align-items: center;
  gap: 35px;
  border-bottom: 1px solid #d2cfc8;
  padding: 32px 0;
}

.partnership__list li > span {
  color: #77736d;
  font-family: var(--font-mono);
  font-size: 10px;
}

.partnership__list h3 {
  font-size: clamp(22px, 2.4vw, 31px);
  font-weight: 450;
  letter-spacing: -0.04em;
}

.partnership__list p {
  max-width: 520px;
  color: #5e5b55;
  font-size: 14px;
  line-height: 1.65;
}

.partnership__list :deep(svg) {
  width: 18px;
  height: 18px;
  color: #68655f;
}

.mail {
  padding: clamp(88px, 10vw, 144px) 0;
  background: #e9e6df;
}

.mail__heading {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(300px, 0.55fr);
  align-items: end;
  gap: 70px;
}

.mail__heading > p {
  max-width: 430px;
  color: #56534d;
  font-size: 15px;
  line-height: 1.7;
}

.mail__features {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  margin-top: 72px;
  border-top: 1px solid #97938b;
}

.mail__features article {
  padding: 30px 34px 24px 0;
}

.mail__features article + article {
  border-left: 1px solid #c8c4bc;
  padding-left: 34px;
}

.mail__features :deep(svg) {
  width: 29px;
  height: 29px;
  stroke-width: 1.3;
}

.mail__features h3 {
  margin-top: 28px;
  font-size: 20px;
  font-weight: 500;
  letter-spacing: -0.03em;
}

.mail__features p {
  max-width: 300px;
  margin-top: 10px;
  color: #605d57;
  font-size: 13px;
  line-height: 1.65;
}

.mail__flow {
  display: grid;
  grid-template-columns: 1fr auto 1fr auto 1fr;
  align-items: center;
  gap: 20px;
  margin-top: 64px;
  border: 1px solid #aaa69e;
  padding: 28px 32px;
}

.mail__flow > div {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 13px;
}

.mail__flow > div :deep(svg) {
  width: 21px;
  height: 21px;
  flex: 0 0 auto;
}

.mail__flow > :deep(svg) {
  width: 17px;
  height: 17px;
  color: #77736d;
}

.mail__flow span {
  font-size: 13px;
  font-weight: 600;
}

.closing {
  padding: clamp(84px, 10vw, 136px) 0;
  background: #080808;
  color: #fff;
}

.closing__inner {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(300px, 0.55fr);
  align-items: end;
  gap: 80px;
}

.closing .overline {
  color: #8d8d87;
}

.closing h2 em {
  color: #aaa9a4;
}

.closing__action > p {
  color: #aaa9a4;
  font-size: 15px;
  line-height: 1.7;
}

.closing__action .button {
  margin-top: 28px;
}

@media (prefers-reduced-motion: reduce) {
  .button {
    transition: none;
  }

  .button:hover {
    transform: none;
  }
}

@media (max-width: 900px) {
  .shell {
    width: min(100% - 40px, 680px);
  }

  .hero {
    grid-template-columns: 1fr;
  }

  .hero__main {
    min-height: 760px;
    padding: 28px 30px 42px;
  }

  .hero__copy {
    margin-top: 74px;
  }

  .hero h1 {
    font-size: clamp(68px, 13vw, 100px);
  }

  .payout-proof {
    margin-top: 100px;
  }

  .payout-proof > strong {
    font-size: clamp(150px, 28vw, 220px);
  }

  .journey {
    padding: 30px;
  }

  .journey ol {
    grid-template-rows: none;
  }

  .journey li {
    min-height: 220px;
  }

  .accreditation__inner {
    grid-template-columns: auto 1fr;
    padding: 28px 24px;
  }

  .accreditation__inner > p,
  .accreditation__inner > a {
    grid-column: 2;
  }

  .partnership__list li {
    grid-template-columns: 48px 1fr auto;
    gap: 18px;
  }

  .partnership__list p {
    grid-column: 2 / -1;
  }

  .mail__heading,
  .closing__inner {
    grid-template-columns: 1fr;
    gap: 28px;
  }
}

@media (max-width: 640px) {
  .hero__main {
    min-height: 700px;
    padding-right: 20px;
    padding-left: 20px;
  }

  .breadcrumb {
    font-size: 11px;
  }

  .hero h1 {
    font-size: clamp(59px, 19vw, 82px);
  }

  .hero__lead {
    font-size: 15px;
  }

  .payout-proof {
    gap: 15px;
    margin-top: 82px;
  }

  .payout-proof > strong {
    font-size: clamp(130px, 38vw, 185px);
  }

  .payout-proof span {
    font-size: 38px;
  }

  .payout-proof p {
    max-width: 210px;
    font-size: 8px;
  }

  .journey li {
    min-height: 0;
    padding-top: 32px;
    padding-bottom: 32px;
  }

  .section-heading h2,
  .mail h2,
  .closing h2 {
    font-size: clamp(45px, 13vw, 65px);
  }

  .partnership__list {
    margin-top: 52px;
  }

  .partnership__list li {
    grid-template-columns: 34px 1fr auto;
    padding: 26px 0;
  }

  .mail__features {
    grid-template-columns: 1fr;
    margin-top: 52px;
  }

  .mail__features article,
  .mail__features article + article {
    border-top: 1px solid #c8c4bc;
    border-left: 0;
    padding: 25px 0;
  }

  .mail__features article:first-child {
    border-top: 0;
  }

  .mail__flow {
    grid-template-columns: 1fr;
    gap: 16px;
    padding: 24px;
  }

  .mail__flow > :deep(svg) {
    margin-left: 2px;
    transform: rotate(90deg);
  }
}
</style>
