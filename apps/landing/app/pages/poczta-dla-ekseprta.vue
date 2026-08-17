<script setup lang="ts">
const { canonicalUrl, siteOrigin } = useLandingSeo({
  title: 'Poczta dla eksperta zintegrowana z CRM — OpenExpert Mail',
  description: 'OpenExpert Mail łączy pocztę z widokiem klienta i sprawy, podpowiada właściwy kontekst oraz przygotowuje szkice odpowiedzi z pomocą agenta AI.',
  path: '/poczta-dla-ekseprta',
  socialImageAlt: 'OpenExpert Mail — poczta dla eksperta zintegrowana z CRM',
})

useHead({
  script: [{
    key: 'structured-data:openexpert-mail',
    type: 'application/ld+json',
    innerHTML: serializeLandingStructuredData({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'SoftwareApplication',
          '@id': `${canonicalUrl}#software`,
          name: 'OpenExpert Mail',
          applicationCategory: 'BusinessApplication',
          operatingSystem: 'Web',
          url: canonicalUrl,
          description: 'Poczta e-mail zintegrowana z CRM OpenExpert, widokiem klienta, sprawami i agentem AI.',
          featureList: [
            'Korespondencja w widoku klienta',
            'Powiązania wiadomości ze sprawami',
            'Propozycje odpowiedzi od agenta AI',
            'Obsługa załączników',
            'Integracja z Gmail, Outlook, Microsoft 365 oraz IMAP i SMTP',
            'Bezpieczny podgląd wiadomości',
          ],
          publisher: { '@id': `${siteOrigin}/#organization` },
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
              name: 'OpenExpert Mail',
              item: canonicalUrl,
            },
          ],
        },
      ],
    }),
  }],
})

const outcomes = [
  {
    icon: 'lucide:user-round',
    index: '01',
    title: 'Rozmowa zawsze przy kliencie',
    description: 'Nie odtwarzasz historii z kilku skrzynek. Korespondencja jest widoczna obok danych, dokumentów i wcześniejszych ustaleń.',
  },
  {
    icon: 'lucide:link-2',
    index: '02',
    title: 'Wiadomość trafia do kontekstu sprawy',
    description: 'OpenExpert podpowiada pasującą sprawę. Weryfikujesz powiązanie i od razu wiesz, czego dotyczy mail oraz jaki jest kolejny krok.',
  },
  {
    icon: 'lucide:sparkles',
    index: '03',
    title: 'Agent AI zaczyna odpowiedź',
    description: 'Szkic powstaje na podstawie wiadomości i kontekstu sprawy. Ty go sprawdzasz, poprawiasz i decydujesz o wysłaniu.',
  },
]

const capabilities = [
  {
    icon: 'lucide:users-round',
    title: 'Jedna historia kontaktu',
    description: 'Wiadomości klienta, banku i partnerów są dostępne z jego karty — razem z tym, co wydarzyło się wcześniej.',
    meta: 'Widok klienta',
  },
  {
    icon: 'lucide:folder',
    title: 'Kontekst każdej sprawy',
    description: 'Czytasz korespondencję obok statusu, dokumentów i zadań. Ważne wątki możesz trwale powiązać z właściwą sprawą.',
    meta: 'Sprawy i proces',
  },
  {
    icon: 'lucide:search',
    title: 'Wyszukiwanie bez przełączania',
    description: 'Przeszukujesz skrzynkę w tym samym miejscu, w którym obsługujesz klienta. Bez dodatkowej karty i utraty kontekstu.',
    meta: 'Codzienna praca',
  },
  {
    icon: 'lucide:sparkles',
    title: 'Odpowiedzi przygotowane przez AI',
    description: 'Agent uwzględnia treść maila i dane sprawy, a potem tworzy propozycję, która czeka na Twoją akceptację.',
    meta: 'Agent AI',
  },
  {
    icon: 'lucide:file-text',
    title: 'Załączniki pod ręką',
    description: 'Decyzje, formularze i dokumenty z maila możesz sprawdzić oraz dodać do sprawy bez ręcznego szukania plików.',
    meta: 'Dokumenty',
  },
  {
    icon: 'lucide:mail-check',
    title: 'Twój obecny adres e-mail',
    description: 'Podłączasz używaną już skrzynkę. Klienci nadal piszą na znany adres, a Ty zyskujesz pracę w jednym systemie.',
    meta: 'Bez migracji adresu',
  },
]

const workflowSteps = [
  {
    number: '01',
    icon: 'lucide:inbox',
    label: 'Wiadomość',
    title: 'Mail pojawia się w OpenExpert',
    description: 'Odbierasz go w swojej skrzynce i widzisz bez uruchamiania pikseli śledzących ani aktywnego kodu.',
  },
  {
    number: '02',
    icon: 'lucide:link-2',
    label: 'Kontekst',
    title: 'System wskazuje klienta i sprawę',
    description: 'Sprawdzasz sugerowane powiązanie, a wiadomość pracuje dalej razem z pełną historią procesu.',
  },
  {
    number: '03',
    icon: 'lucide:sparkles',
    label: 'Następny krok',
    title: 'Agent przygotowuje szkic',
    description: 'Dostajesz propozycję odpowiedzi i akcje wynikające z maila. Ostateczna decyzja zawsze należy do Ciebie.',
  },
]

const integrations = ['Gmail', 'Outlook', 'Microsoft 365', 'IMAP / SMTP']

const assurances = [
  {
    icon: 'lucide:lock-keyhole',
    title: 'Dostęp tylko dla właściciela skrzynki',
    description: 'Połączenie jest szyfrowane, a zawartość poczty pozostaje oddzielona od dostępu innych członków organizacji.',
  },
  {
    icon: 'lucide:shield-check',
    title: 'Bezpieczny podgląd wiadomości',
    description: 'OpenExpert ogranicza zewnętrzne obrazy śledzące i aktywny kod, zanim treść pojawi się w podglądzie.',
  },
  {
    icon: 'lucide:gauge',
    title: '99,99% gwarantowanej dostępności*',
    description: 'Niezawodność jest fundamentem usługi, ale nie zastępuje najważniejszej korzyści: poczty pracującej razem z CRM-em.',
  },
]
</script>

<template>
  <div class="mail-landing-page">
    <a class="mail-skip-link" href="#mail-page-content">Przejdź do treści</a>

    <header class="mail-site-header">
      <div class="mail-site-header__inner">
        <NuxtLink to="/" class="mail-brand" aria-label="OpenExpert — strona główna">
          <img src="/assets/logo-dark.svg" alt="" width="30" height="30">
          <span>OpenExpert</span>
          <small>Mail</small>
        </NuxtLink>

        <nav class="mail-site-nav" aria-label="OpenExpert Mail">
          <a href="#mozliwosci">Możliwości</a>
          <a href="#jak-dziala">Jak działa</a>
          <a href="#bezpieczenstwo">Bezpieczeństwo</a>
        </nav>

        <NuxtLink to="/#dolacz" class="mail-header-cta">
          Zacznij z OpenExpert
          <Icon name="lucide:arrow-right" aria-hidden="true" />
        </NuxtLink>
      </div>
    </header>

    <main id="mail-page-content" tabindex="-1">
      <section class="mail-hero" aria-labelledby="mail-hero-title">
        <div class="mail-page-shell">
          <nav class="mail-breadcrumb" aria-label="Okruszki">
            <NuxtLink to="/">OpenExpert</NuxtLink>
            <span aria-hidden="true">/</span>
            <span aria-current="page">Mail</span>
          </nav>

          <div class="mail-hero__grid">
            <div class="mail-hero__copy">
              <p class="mail-eyebrow">Poczta dla ekspertów · zintegrowana z CRM</p>
              <h1 id="mail-hero-title" aria-label="Poczta, która zna klienta i jego sprawę.">
                <span aria-hidden="true">Poczta, która zna</span>{{ ' ' }}
                <em aria-hidden="true">klienta i jego sprawę.</em>
              </h1>
              <p class="mail-hero__lead">
                Wiadomości od klientów, banków i partnerów spotykają się z danymi sprawy w jednym miejscu. Masz pełny kontekst, a agent AI przygotowuje odpowiedź do Twojej akceptacji.
              </p>
              <div class="mail-hero__actions">
                <NuxtLink to="/#dolacz" class="mail-button mail-button--primary">
                  Zacznij z OpenExpert
                  <Icon name="lucide:arrow-right" aria-hidden="true" />
                </NuxtLink>
                <a href="#openexpert-mail" class="mail-button mail-button--secondary">
                  Zobacz pocztę w CRM
                </a>
              </div>
              <ul class="mail-hero__signals" aria-label="Najważniejsze możliwości">
                <li><Icon name="lucide:user-round" aria-hidden="true" /> Klient</li>
                <li><Icon name="lucide:folder" aria-hidden="true" /> Sprawa</li>
                <li><Icon name="lucide:mail" aria-hidden="true" /> Korespondencja</li>
                <li><Icon name="lucide:sparkles" aria-hidden="true" /> Agent AI</li>
              </ul>
            </div>

            <article class="mail-context-preview" aria-label="Podgląd wiadomości połączonej z klientem i sprawą">
              <header class="mail-context-preview__bar">
                <span>
                  <Icon name="lucide:mail" aria-hidden="true" />
                  OpenExpert Mail
                </span>
                <small><i aria-hidden="true" /> skrzynka połączona</small>
              </header>

              <div class="mail-context-preview__body">
                <div class="mail-context-preview__message">
                  <p>Wiadomość z banku · 1 załącznik</p>
                  <h2>Pozytywna decyzja kredytowa</h2>
                  <div class="mail-context-preview__sender">
                    <span>PKO</span>
                    <div>
                      <strong>PKO Bank Polski</strong>
                      <small>dziś, 10:42</small>
                    </div>
                  </div>
                  <p class="mail-context-preview__excerpt">
                    Dla wniosku Anny Kowalskiej, numer OE-142, wydano pozytywną decyzję kredytową…
                  </p>
                  <div class="mail-context-preview__attachment">
                    <Icon name="lucide:file-text" aria-hidden="true" />
                    decyzja_kredytowa_AK.pdf
                  </div>
                </div>

                <aside class="mail-context-preview__rail" aria-label="Kontekst wiadomości">
                  <div>
                    <span class="mail-context-preview__icon"><Icon name="lucide:user-round" aria-hidden="true" /></span>
                    <p>Klient</p>
                    <strong>Anna Kowalska</strong>
                  </div>
                  <div>
                    <span class="mail-context-preview__icon"><Icon name="lucide:link-2" aria-hidden="true" /></span>
                    <p>Sugerowana sprawa</p>
                    <strong>OE-142 · Hipoteka</strong>
                    <small>Gotowe do powiązania</small>
                  </div>
                  <div class="is-ai">
                    <span class="mail-context-preview__icon"><Icon name="lucide:sparkles" aria-hidden="true" /></span>
                    <p>Agent AI</p>
                    <strong>Szkic odpowiedzi gotowy</strong>
                    <small>Sprawdź przed wysłaniem</small>
                  </div>
                </aside>
              </div>

              <footer class="mail-context-preview__footer">
                <span><Icon name="lucide:shield-check" aria-hidden="true" /> Bez obrazów śledzących</span>
                <span>1 wiadomość · 3 konteksty</span>
              </footer>
            </article>
          </div>
        </div>
      </section>

      <section class="mail-outcomes" aria-labelledby="mail-outcomes-title">
        <div class="mail-page-shell">
          <header class="mail-section-heading mail-section-heading--split">
            <div>
              <p class="mail-eyebrow">Mniej szukania. Więcej działania.</p>
              <h2 id="mail-outcomes-title">Jedna wiadomość.{{ ' ' }}<br><em>Pełny kontekst.</em></h2>
            </div>
            <p>
              Zwykła skrzynka zna nadawcę i temat. OpenExpert Mail widzi także klienta, sprawę, dokumenty oraz etap procesu — dlatego pomaga przejść od wiadomości do konkretnego działania.
            </p>
          </header>

          <ol class="mail-outcomes__grid">
            <li v-for="outcome in outcomes" :key="outcome.title">
              <span class="mail-outcomes__index">{{ outcome.index }}</span>
              <Icon :name="outcome.icon" aria-hidden="true" />
              <h3>{{ outcome.title }}</h3>
              <p>{{ outcome.description }}</p>
            </li>
          </ol>
        </div>
      </section>

      <LandingMailSection :show-product-link="false" />

      <section id="mozliwosci" class="mail-capabilities" aria-labelledby="mail-capabilities-title">
        <div class="mail-page-shell">
          <header class="mail-section-heading mail-section-heading--split">
            <div>
              <p class="mail-eyebrow">Możliwości OpenExpert Mail</p>
              <h2 id="mail-capabilities-title">Skrzynka zbudowana{{ ' ' }}<br><em>wokół Twojej pracy.</em></h2>
            </div>
            <p>
              Nie dokładamy kolejnego narzędzia. Poczta staje się częścią procesu, który już prowadzisz w CRM-ie — od pierwszego kontaktu po zamknięcie sprawy.
            </p>
          </header>

          <div class="mail-capabilities__grid">
            <article v-for="(capability, index) in capabilities" :key="capability.title">
              <div class="mail-capability__topline">
                <span>0{{ index + 1 }}</span>
                <small>{{ capability.meta }}</small>
              </div>
              <span class="mail-capability__icon"><Icon :name="capability.icon" aria-hidden="true" /></span>
              <h3>{{ capability.title }}</h3>
              <p>{{ capability.description }}</p>
            </article>
          </div>
        </div>
      </section>

      <section id="jak-dziala" class="mail-workflow" aria-labelledby="mail-workflow-title">
        <div class="mail-page-shell">
          <header class="mail-workflow__heading">
            <p class="mail-eyebrow">Jak działa</p>
            <h2 id="mail-workflow-title">Od maila do następnego kroku.{{ ' ' }}<em>Bez ręcznego przepisywania.</em></h2>
          </header>

          <ol class="mail-workflow__steps">
            <li v-for="step in workflowSteps" :key="step.number">
              <div class="mail-workflow__number">{{ step.number }}</div>
              <span class="mail-workflow__icon"><Icon :name="step.icon" aria-hidden="true" /></span>
              <div>
                <p>{{ step.label }}</p>
                <h3>{{ step.title }}</h3>
                <span>{{ step.description }}</span>
              </div>
            </li>
          </ol>

          <aside class="mail-human-control">
            <div>
              <Icon name="lucide:user-round-check" aria-hidden="true" />
              <span>Kontrola po Twojej stronie</span>
            </div>
            <p>Agent proponuje. Ty zatwierdzasz powiązanie, sprawdzasz szkic i decydujesz, kiedy wiadomość zostanie wysłana.</p>
          </aside>
        </div>
      </section>

      <section id="bezpieczenstwo" class="mail-trust" aria-labelledby="mail-trust-title">
        <div class="mail-page-shell">
          <div class="mail-trust__grid">
            <div class="mail-trust__intro">
              <p class="mail-eyebrow">Połączenie i bezpieczeństwo</p>
              <h2 id="mail-trust-title">Twoja skrzynka.{{ ' ' }}<br><em>Bez zmiany adresu.</em></h2>
              <p>
                Podłącz pocztę, której już używasz. OpenExpert daje Ci wygodę pracy w CRM-ie, a klient nadal pisze na znany adres.
              </p>
              <ul class="mail-integrations" aria-label="Obsługiwane rodzaje skrzynek">
                <li v-for="integration in integrations" :key="integration">
                  <Icon name="lucide:check" aria-hidden="true" />
                  {{ integration }}
                </li>
              </ul>
            </div>

            <div class="mail-trust__assurances">
              <article v-for="assurance in assurances" :key="assurance.title">
                <Icon :name="assurance.icon" aria-hidden="true" />
                <div>
                  <h3>{{ assurance.title }}</h3>
                  <p>{{ assurance.description }}</p>
                </div>
              </article>
              <p class="mail-trust__note">
                <span aria-hidden="true">*</span>
                Gwarancja 99,99% dotyczy dostępności usługi OpenExpert Mail. Wysyłanie i odbieranie wiadomości zależy także od działania podłączonego dostawcy poczty oraz połączenia internetowego.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section class="mail-final-cta" aria-labelledby="mail-final-cta-title">
        <div class="mail-page-shell">
          <p class="mail-eyebrow">OpenExpert Mail</p>
          <h2 id="mail-final-cta-title">Pracuj z pocztą tam,{{ ' ' }}<br><em>gdzie prowadzisz sprawy.</em></h2>
          <p>Zacznij budować pośrednictwo z CRM-em, pocztą i agentami AI w jednym systemie.</p>
          <div class="mail-final-cta__actions">
            <NuxtLink to="/#dolacz" class="mail-button mail-button--primary">
              Zacznij z OpenExpert
              <Icon name="lucide:arrow-right" aria-hidden="true" />
            </NuxtLink>
            <NuxtLink to="/" class="mail-button mail-button--secondary">Wróć na stronę główną</NuxtLink>
          </div>
        </div>
      </section>
    </main>

    <footer class="mail-footer">
      <div class="mail-footer__inner">
        <NuxtLink to="/" class="mail-footer__brand">
          <img src="/assets/logo-dark.svg" alt="" width="25" height="25">
          <span>OpenExpert</span>
        </NuxtLink>
        <p>Poczta, CRM i agenci AI pracujący na wspólnym kontekście klienta i sprawy.</p>
        <nav aria-label="Linki w stopce">
          <NuxtLink to="/">Strona główna</NuxtLink>
          <NuxtLink to="/eksperci">Eksperci</NuxtLink>
          <NuxtLink to="/o-nas">O nas</NuxtLink>
          <a href="mailto:hello@openexpert.app">Kontakt</a>
        </nav>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.mail-landing-page {
  min-width: 0;
  overflow: clip;
  background: #f5f5f1;
  color: #111;
  font-family: var(--font-sans);
}

#mail-page-content:focus {
  outline: none;
}

.mail-page-shell {
  width: min(1340px, calc(100% - 96px));
  margin: 0 auto;
}

.mail-skip-link {
  position: fixed;
  z-index: 100;
  top: 12px;
  left: 16px;
  padding: 10px 14px;
  background: #fff;
  color: #111;
  text-decoration: none;
  transform: translateY(-160%);
}

.mail-skip-link:focus {
  transform: translateY(0);
}

.mail-site-header {
  position: relative;
  z-index: 20;
  border-bottom: 1px solid #292929;
  background: #030303;
  color: #f7f7f7;
}

.mail-site-header__inner {
  display: grid;
  width: min(1440px, calc(100% - 80px));
  min-height: 84px;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 32px;
  margin: 0 auto;
}

.mail-brand,
.mail-footer__brand {
  display: inline-flex;
  width: fit-content;
  align-items: center;
  gap: 12px;
  color: inherit;
  text-decoration: none;
}

.mail-brand span {
  font-size: 20px;
  font-weight: 550;
  letter-spacing: -0.025em;
}

.mail-brand small {
  border-left: 1px solid #424242;
  color: #8fd8b8;
  padding-left: 12px;
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.mail-site-nav {
  display: flex;
  align-items: center;
  gap: clamp(24px, 3vw, 42px);
}

.mail-site-nav a {
  color: #a9a9a9;
  font-size: 13px;
  text-decoration: none;
  transition: color var(--transition-fast);
}

.mail-site-nav a:hover {
  color: #fff;
}

.mail-header-cta {
  display: inline-flex;
  min-height: 42px;
  align-items: center;
  justify-self: end;
  gap: 9px;
  border: 1px solid #d8f4e6;
  border-radius: 4px;
  background: #b9e8d1;
  color: #10231a;
  padding: 9px 15px;
  font-size: 12px;
  font-weight: 650;
  text-decoration: none;
  transition: background-color var(--transition-fast), transform var(--transition-fast);
}

.mail-header-cta:hover {
  background: #cef2df;
  transform: translateY(-1px);
}

.mail-header-cta :deep(svg) {
  width: 15px;
  height: 15px;
}

.mail-hero {
  border-bottom: 1px solid #292929;
  background:
    radial-gradient(circle at 76% 14%, rgb(53 118 84 / 18%), transparent 32%),
    #030303;
  color: #f7f7f7;
  padding: 30px 0 clamp(78px, 9vw, 126px);
}

.mail-breadcrumb {
  display: flex;
  align-items: center;
  gap: 9px;
  color: #777;
  font-size: 11px;
}

.mail-breadcrumb a {
  color: #b6b6b6;
  text-decoration: none;
}

.mail-hero__grid {
  display: grid;
  grid-template-columns: minmax(0, 0.82fr) minmax(520px, 1.18fr);
  align-items: center;
  gap: clamp(56px, 8vw, 128px);
  margin-top: clamp(68px, 8vw, 104px);
}

.mail-eyebrow {
  color: #2f7958;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  line-height: 1.5;
  text-transform: uppercase;
}

.mail-hero .mail-eyebrow,
.mail-workflow .mail-eyebrow,
.mail-final-cta .mail-eyebrow {
  color: #8fd8b8;
}

.mail-hero h1 {
  max-width: 750px;
  margin-top: 23px;
  font-size: clamp(58px, 6.7vw, 100px);
  font-variation-settings: 'opsz' 84, 'wght' 270;
  font-weight: 280;
  letter-spacing: -0.06em;
  line-height: 0.91;
}

.mail-hero h1 span,
.mail-hero h1 em {
  display: block;
}

.mail-hero h1 em {
  color: #b9e8d1;
  font-variation-settings: 'opsz' 68, 'wght' 340;
  font-weight: 340;
}

.mail-hero__lead {
  max-width: 660px;
  margin-top: 32px;
  color: #b0b0b0;
  font-size: 17px;
  line-height: 1.68;
}

.mail-hero__actions,
.mail-final-cta__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 34px;
}

.mail-button {
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

.mail-button:hover {
  transform: translateY(-1px);
}

.mail-button--primary {
  border-color: #d8f4e6;
  background: #b9e8d1;
  box-shadow: 0 8px 24px rgb(143 216 184 / 12%);
  color: #10231a;
}

.mail-button--primary:hover {
  background: #cef2df;
}

.mail-button--secondary {
  border-color: #484848;
  background: #121212;
  color: #ededed;
}

.mail-button--secondary:hover {
  border-color: #777;
  background: #1a1a1a;
}

.mail-button :deep(svg) {
  width: 16px;
  height: 16px;
}

.mail-hero__signals {
  display: flex;
  flex-wrap: wrap;
  gap: 9px 18px;
  margin-top: 34px;
  color: #7f7f7f;
  list-style: none;
}

.mail-hero__signals li {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 10px;
}

.mail-hero__signals li :deep(svg) {
  width: 13px;
  height: 13px;
  color: #8fd8b8;
}

.mail-context-preview {
  position: relative;
  min-width: 0;
  overflow: hidden;
  border: 1px solid #393939;
  border-radius: 7px;
  background: #0d0d0d;
  box-shadow: 0 36px 90px rgb(0 0 0 / 55%);
}

.mail-context-preview::before {
  position: absolute;
  z-index: 0;
  right: -100px;
  bottom: -120px;
  width: 300px;
  height: 300px;
  border-radius: 50%;
  background: rgb(86 185 139 / 7%);
  content: '';
  filter: blur(4px);
  pointer-events: none;
}

.mail-context-preview__bar,
.mail-context-preview__footer {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid #2b2b2b;
  padding: 15px 18px;
}

.mail-context-preview__bar > span,
.mail-context-preview__bar > small,
.mail-context-preview__footer span {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.mail-context-preview__bar > span {
  color: #ededed;
  font-size: 12px;
  font-weight: 600;
}

.mail-context-preview__bar > span :deep(svg) {
  width: 16px;
  height: 16px;
  color: #8fd8b8;
}

.mail-context-preview__bar > small {
  color: #8fd8b8;
  font-size: 8px;
}

.mail-context-preview__bar i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #48b986;
}

.mail-context-preview__body {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(190px, 0.65fr);
}

.mail-context-preview__message {
  min-width: 0;
  border-right: 1px solid #2b2b2b;
  padding: clamp(24px, 3vw, 38px);
}

.mail-context-preview__message > p:first-child,
.mail-context-preview__rail p {
  color: #777;
  font-family: var(--font-mono);
  font-size: 8px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.mail-context-preview__message h2 {
  max-width: 430px;
  margin-top: 11px;
  color: #f4f4f4;
  font-size: clamp(25px, 2.7vw, 38px);
  font-weight: 350;
  letter-spacing: -0.045em;
  line-height: 1.08;
}

.mail-context-preview__sender {
  display: flex;
  align-items: center;
  gap: 11px;
  margin-top: 28px;
  border-top: 1px solid #292929;
  padding-top: 18px;
}

.mail-context-preview__sender > span {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 50%;
  background: #efefeb;
  color: #111;
  font-size: 9px;
  font-weight: 700;
}

.mail-context-preview__sender div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.mail-context-preview__sender strong {
  color: #e4e4e4;
  font-size: 11px;
}

.mail-context-preview__sender small {
  color: #6f6f6f;
  font-size: 9px;
}

.mail-context-preview__excerpt {
  max-width: 470px;
  margin-top: 23px;
  color: #b8b8b8;
  font-size: 12px;
  line-height: 1.65;
}

.mail-context-preview__attachment {
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  gap: 8px;
  margin-top: 23px;
  border: 1px solid #343434;
  border-radius: 4px;
  background: #101010;
  color: #999;
  padding: 9px 11px;
  font-size: 9px;
}

.mail-context-preview__attachment :deep(svg) {
  width: 13px;
  height: 13px;
  color: #8fd8b8;
}

.mail-context-preview__rail {
  display: grid;
  min-width: 0;
  align-content: stretch;
  background: #111;
}

.mail-context-preview__rail > div {
  position: relative;
  display: flex;
  min-height: 128px;
  flex-direction: column;
  justify-content: center;
  border-bottom: 1px solid #2b2b2b;
  padding: 20px 18px 20px 54px;
}

.mail-context-preview__rail > div:last-child {
  border-bottom: 0;
}

.mail-context-preview__rail > div.is-ai {
  background: #0d1812;
}

.mail-context-preview__icon {
  position: absolute;
  top: 20px;
  left: 18px;
  display: grid;
  width: 25px;
  height: 25px;
  place-items: center;
  border: 1px solid #3c3c3c;
  border-radius: 50%;
  color: #8fd8b8;
}

.mail-context-preview__icon :deep(svg) {
  width: 12px;
  height: 12px;
}

.mail-context-preview__rail strong {
  margin-top: 6px;
  color: #e8e8e8;
  font-size: 11px;
  line-height: 1.3;
}

.mail-context-preview__rail small {
  margin-top: 5px;
  color: #729282;
  font-size: 8px;
  line-height: 1.35;
}

.mail-context-preview__footer {
  border-top: 1px solid #2b2b2b;
  border-bottom: 0;
  color: #797979;
  font-size: 8px;
}

.mail-context-preview__footer span:first-child {
  color: #8fd8b8;
}

.mail-context-preview__footer :deep(svg) {
  width: 13px;
  height: 13px;
}

.mail-outcomes,
.mail-capabilities,
.mail-trust {
  padding: clamp(88px, 10vw, 142px) 0;
}

.mail-outcomes {
  background: #f5f5f1;
}

.mail-section-heading {
  margin-bottom: clamp(48px, 6vw, 78px);
}

.mail-section-heading--split {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(360px, 0.65fr);
  align-items: end;
  gap: clamp(54px, 8vw, 128px);
}

.mail-section-heading h2,
.mail-trust__intro h2 {
  margin-top: 20px;
  font-size: clamp(48px, 6.2vw, 88px);
  font-variation-settings: 'opsz' 78, 'wght' 300;
  font-weight: 300;
  letter-spacing: -0.055em;
  line-height: 0.96;
}

.mail-section-heading h2 em,
.mail-trust__intro h2 em,
.mail-workflow__heading h2 em,
.mail-final-cta h2 em {
  color: #2f7958;
  font-variation-settings: 'opsz' 60, 'wght' 360;
  font-weight: 360;
}

.mail-section-heading--split > p,
.mail-trust__intro > p {
  color: #5f5f5b;
  font-size: 16px;
  line-height: 1.72;
}

.mail-outcomes__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border-top: 1px solid #cfcfca;
  border-bottom: 1px solid #cfcfca;
  list-style: none;
}

.mail-outcomes__grid li {
  position: relative;
  min-width: 0;
  border-right: 1px solid #cfcfca;
  padding: 34px clamp(22px, 3vw, 42px) 42px;
}

.mail-outcomes__grid li:last-child {
  border-right: 0;
}

.mail-outcomes__index {
  color: #7a7a74;
  font-family: var(--font-mono);
  font-size: 9px;
}

.mail-outcomes__grid li > :deep(svg) {
  display: block;
  width: 30px;
  height: 30px;
  margin-top: 48px;
  color: #2f7958;
  stroke-width: 1.35;
}

.mail-outcomes__grid h3 {
  max-width: 290px;
  margin-top: 24px;
  font-size: clamp(21px, 2vw, 27px);
  font-weight: 480;
  letter-spacing: -0.035em;
  line-height: 1.12;
}

.mail-outcomes__grid p {
  margin-top: 15px;
  color: #62625e;
  font-size: 13px;
  line-height: 1.65;
}

.mail-capabilities {
  border-bottom: 1px solid #d3d3ce;
  background: #fbfbf8;
}

.mail-capabilities__grid {
  display: grid;
  overflow: hidden;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  border: 1px solid #d6d6d1;
  border-radius: 7px;
  background: #d6d6d1;
}

.mail-capabilities__grid article {
  min-width: 0;
  min-height: 330px;
  background: #f7f7f3;
  padding: 29px clamp(24px, 3vw, 38px) 36px;
}

.mail-capability__topline {
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

.mail-capability__icon {
  display: grid;
  width: 50px;
  height: 50px;
  place-items: center;
  margin-top: 54px;
  border: 1px solid #bfcfc6;
  border-radius: 50%;
  background: #e9f3ed;
  color: #2f7958;
}

.mail-capability__icon :deep(svg) {
  width: 23px;
  height: 23px;
  stroke-width: 1.35;
}

.mail-capabilities__grid h3 {
  margin-top: 25px;
  font-size: 22px;
  font-weight: 520;
  letter-spacing: -0.03em;
  line-height: 1.18;
}

.mail-capabilities__grid article > p {
  margin-top: 13px;
  color: #686864;
  font-size: 13px;
  line-height: 1.65;
}

.mail-workflow {
  border-bottom: 1px solid #294437;
  background: #07120c;
  color: #f4f5f2;
  padding: clamp(88px, 10vw, 142px) 0;
}

.mail-workflow__heading {
  display: grid;
  grid-template-columns: 180px minmax(0, 980px);
  gap: 40px;
}

.mail-workflow__heading h2 {
  font-size: clamp(45px, 6.2vw, 84px);
  font-variation-settings: 'opsz' 78, 'wght' 290;
  font-weight: 290;
  letter-spacing: -0.055em;
  line-height: 0.98;
}

.mail-workflow__heading h2 em {
  display: block;
  color: #b9e8d1;
}

.mail-workflow__steps {
  margin-top: clamp(60px, 8vw, 104px);
  border-top: 1px solid #355244;
  list-style: none;
}

.mail-workflow__steps li {
  display: grid;
  grid-template-columns: 74px 64px minmax(0, 1fr);
  align-items: center;
  gap: 24px;
  border-bottom: 1px solid #355244;
  padding: 29px 0;
}

.mail-workflow__number {
  color: #668271;
  font-family: var(--font-mono);
  font-size: 10px;
}

.mail-workflow__icon {
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
  border: 1px solid #3c6752;
  border-radius: 50%;
  color: #9de0bd;
}

.mail-workflow__icon :deep(svg) {
  width: 21px;
  height: 21px;
  stroke-width: 1.4;
}

.mail-workflow__steps li > div:last-child {
  display: grid;
  grid-template-columns: minmax(110px, 0.4fr) minmax(260px, 0.8fr) minmax(320px, 1fr);
  align-items: center;
  gap: clamp(24px, 4vw, 72px);
}

.mail-workflow__steps p {
  color: #8fd8b8;
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.mail-workflow__steps h3 {
  font-size: clamp(18px, 2vw, 26px);
  font-weight: 470;
  letter-spacing: -0.03em;
  line-height: 1.2;
}

.mail-workflow__steps li > div:last-child > span {
  color: #8f9c94;
  font-size: 12.5px;
  line-height: 1.6;
}

.mail-human-control {
  display: grid;
  grid-template-columns: minmax(230px, 0.45fr) minmax(0, 1fr);
  align-items: center;
  gap: clamp(32px, 6vw, 90px);
  margin-top: 34px;
  border: 1px solid #355244;
  border-radius: 5px;
  background: #0c1c13;
  padding: 22px 26px;
}

.mail-human-control > div {
  display: flex;
  align-items: center;
  gap: 13px;
  color: #dcebe2;
  font-size: 13px;
  font-weight: 600;
}

.mail-human-control :deep(svg) {
  width: 24px;
  height: 24px;
  color: #8fd8b8;
  stroke-width: 1.35;
}

.mail-human-control > p {
  color: #92a097;
  font-size: 12px;
  line-height: 1.6;
}

.mail-trust {
  background: #eef4ef;
}

.mail-trust__grid {
  display: grid;
  grid-template-columns: minmax(0, 0.85fr) minmax(480px, 1.15fr);
  gap: clamp(68px, 10vw, 150px);
}

.mail-trust__intro > p {
  max-width: 570px;
  margin-top: 28px;
}

.mail-integrations {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
  margin-top: 34px;
  list-style: none;
}

.mail-integrations li {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid #c5d2ca;
  border-radius: 999px;
  background: #f8faf7;
  color: #34463c;
  padding: 9px 12px;
  font-size: 11px;
  font-weight: 550;
}

.mail-integrations :deep(svg) {
  width: 13px;
  height: 13px;
  color: #2f7958;
}

.mail-trust__assurances {
  border-top: 1px solid #bdcbc2;
}

.mail-trust__assurances article {
  display: grid;
  grid-template-columns: 46px minmax(0, 1fr);
  gap: 22px;
  border-bottom: 1px solid #bdcbc2;
  padding: 29px 0;
}

.mail-trust__assurances article > :deep(svg) {
  width: 30px;
  height: 30px;
  color: #2f7958;
  stroke-width: 1.3;
}

.mail-trust__assurances h3 {
  font-size: 19px;
  font-weight: 550;
  letter-spacing: -0.02em;
  line-height: 1.25;
}

.mail-trust__assurances article p {
  margin-top: 8px;
  color: #607066;
  font-size: 12px;
  line-height: 1.62;
}

.mail-trust__note {
  display: flex;
  gap: 8px;
  margin-top: 20px;
  color: #718078;
  font-size: 9px;
  line-height: 1.55;
}

.mail-trust__note span {
  color: #2f7958;
}

.mail-final-cta {
  border-bottom: 1px solid #292929;
  background:
    radial-gradient(circle at 77% 45%, rgb(53 118 84 / 21%), transparent 32%),
    #030303;
  color: #f7f7f7;
  padding: clamp(90px, 11vw, 150px) 0;
}

.mail-final-cta h2 {
  max-width: 1060px;
  margin-top: 21px;
  font-size: clamp(52px, 7.4vw, 102px);
  font-variation-settings: 'opsz' 84, 'wght' 280;
  font-weight: 280;
  letter-spacing: -0.06em;
  line-height: 0.92;
}

.mail-final-cta h2 em {
  color: #b9e8d1;
}

.mail-final-cta > .mail-page-shell > p:not(.mail-eyebrow) {
  max-width: 590px;
  margin-top: 30px;
  color: #a3a3a3;
  font-size: 16px;
  line-height: 1.65;
}

.mail-footer {
  background: #030303;
  color: #f7f7f7;
}

.mail-footer__inner {
  display: grid;
  width: min(1440px, calc(100% - 80px));
  min-height: 132px;
  grid-template-columns: 1fr minmax(280px, 1.2fr) 1fr;
  align-items: center;
  gap: 32px;
  margin: 0 auto;
}

.mail-footer__brand {
  font-size: 18px;
  font-weight: 550;
}

.mail-footer p {
  max-width: 480px;
  color: #818181;
  font-size: 12px;
  line-height: 1.55;
  text-align: center;
}

.mail-footer nav {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 21px;
}

.mail-footer nav a {
  color: #a6a6a6;
  font-size: 12px;
  text-decoration: none;
}

.mail-footer nav a:hover {
  color: #fff;
}

.mail-landing-page :is(a):focus-visible {
  outline-color: currentColor;
  outline-offset: 4px;
}

@media (max-width: 1099px) {
  .mail-page-shell {
    width: min(840px, calc(100% - 64px));
  }

  .mail-site-header__inner {
    width: min(100% - 64px, 1040px);
    grid-template-columns: 1fr auto;
  }

  .mail-site-nav {
    display: none;
  }

  .mail-hero__grid,
  .mail-section-heading--split,
  .mail-trust__grid {
    grid-template-columns: 1fr;
  }

  .mail-hero__copy {
    max-width: 760px;
  }

  .mail-context-preview {
    width: 100%;
  }

  .mail-section-heading--split {
    align-items: start;
    gap: 35px;
  }

  .mail-section-heading--split > p {
    max-width: 660px;
  }

  .mail-capabilities__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .mail-workflow__heading {
    grid-template-columns: 1fr;
    gap: 22px;
  }

  .mail-workflow__steps li > div:last-child {
    grid-template-columns: minmax(90px, 0.25fr) minmax(240px, 0.75fr) minmax(0, 1fr);
    gap: 28px;
  }

  .mail-trust__grid {
    gap: 62px;
  }

  .mail-trust__intro {
    max-width: 700px;
  }

  .mail-footer__inner {
    grid-template-columns: 1fr;
    justify-items: start;
    gap: 22px;
    padding: 38px 0;
  }

  .mail-footer p {
    max-width: 540px;
    text-align: left;
  }

  .mail-footer nav {
    justify-content: flex-start;
  }
}

@media (max-width: 767px) {
  .mail-page-shell,
  .mail-site-header__inner,
  .mail-footer__inner {
    width: min(100% - 40px, 620px);
  }

  .mail-site-header__inner {
    min-height: 72px;
    gap: 16px;
  }

  .mail-brand {
    gap: 9px;
  }

  .mail-brand img {
    width: 26px;
    height: 26px;
  }

  .mail-brand span {
    font-size: 17px;
  }

  .mail-brand small {
    display: none;
  }

  .mail-header-cta {
    min-height: 38px;
    padding: 8px 11px;
    font-size: 11px;
  }

  .mail-header-cta :deep(svg) {
    display: none;
  }

  .mail-hero {
    padding-top: 24px;
  }

  .mail-hero__grid {
    gap: 50px;
    margin-top: 58px;
  }

  .mail-hero h1 {
    font-size: clamp(47px, 14vw, 68px);
  }

  .mail-hero__lead {
    margin-top: 26px;
    font-size: 15px;
  }

  .mail-hero__actions,
  .mail-final-cta__actions {
    flex-direction: column;
  }

  .mail-button {
    width: 100%;
  }

  .mail-context-preview__body {
    grid-template-columns: 1fr;
  }

  .mail-context-preview__message {
    border-right: 0;
    border-bottom: 1px solid #2b2b2b;
    padding: 25px 21px;
  }

  .mail-context-preview__rail {
    grid-template-columns: 1fr;
  }

  .mail-context-preview__rail > div {
    min-height: 104px;
  }

  .mail-context-preview__footer span:last-child {
    display: none;
  }

  .mail-section-heading h2,
  .mail-trust__intro h2 {
    font-size: clamp(41px, 12vw, 57px);
  }

  .mail-section-heading--split > p,
  .mail-trust__intro > p {
    font-size: 14px;
  }

  .mail-outcomes__grid {
    grid-template-columns: 1fr;
  }

  .mail-outcomes__grid li,
  .mail-outcomes__grid li:last-child {
    border-right: 0;
    border-bottom: 1px solid #cfcfca;
    padding: 27px 4px 32px;
  }

  .mail-outcomes__grid li:last-child {
    border-bottom: 0;
  }

  .mail-outcomes__grid li > :deep(svg) {
    margin-top: 32px;
  }

  .mail-capabilities__grid {
    grid-template-columns: 1fr;
  }

  .mail-capabilities__grid article {
    min-height: 300px;
    padding: 26px 23px 31px;
  }

  .mail-capability__icon {
    margin-top: 40px;
  }

  .mail-workflow__heading h2 {
    font-size: clamp(40px, 12vw, 56px);
  }

  .mail-workflow__steps li {
    grid-template-columns: 42px minmax(0, 1fr);
    align-items: start;
    gap: 18px;
    padding: 28px 0;
  }

  .mail-workflow__icon {
    grid-column: 1;
    grid-row: 2;
    width: 38px;
    height: 38px;
  }

  .mail-workflow__number {
    grid-column: 1;
    grid-row: 1;
  }

  .mail-workflow__steps li > div:last-child {
    display: flex;
    grid-column: 2;
    grid-row: 1 / span 2;
    align-items: flex-start;
    flex-direction: column;
    gap: 10px;
  }

  .mail-workflow__steps li > div:last-child > span {
    margin-top: 3px;
  }

  .mail-human-control {
    grid-template-columns: 1fr;
    gap: 16px;
    padding: 20px;
  }

  .mail-trust__grid {
    grid-template-columns: 1fr;
    gap: 52px;
  }

  .mail-trust__assurances article {
    grid-template-columns: 38px minmax(0, 1fr);
    gap: 16px;
  }

  .mail-final-cta h2 {
    font-size: clamp(45px, 13vw, 64px);
  }
}

@media (max-width: 420px) {
  .mail-header-cta {
    max-width: 124px;
    line-height: 1.2;
    text-align: center;
  }

  .mail-context-preview__bar {
    padding-right: 13px;
    padding-left: 13px;
  }

  .mail-context-preview__bar > small {
    display: none;
  }

  .mail-hero__signals {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 359px) {
  .mail-page-shell,
  .mail-site-header__inner,
  .mail-footer__inner {
    width: calc(100% - 32px);
  }

  .mail-brand span {
    font-size: 15px;
  }

  .mail-header-cta {
    max-width: 112px;
    padding-right: 8px;
    padding-left: 8px;
    font-size: 10px;
  }

  .mail-context-preview__message h2 {
    font-size: 24px;
  }

  .mail-integrations {
    flex-direction: column;
  }

  .mail-integrations li {
    justify-content: center;
  }
}

@media (prefers-reduced-motion: reduce) {
  .mail-header-cta,
  .mail-button {
    transition: none;
  }
}
</style>
