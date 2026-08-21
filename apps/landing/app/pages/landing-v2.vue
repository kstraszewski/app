<script setup lang="ts">
useLandingSeo({
  title: 'OpenExpert — jeden system do prowadzenia spraw',
  description: 'CRM, poczta i agenci AI pracują na jednym kontekście. Prowadź klientów, deleguj pracę i zatwierdzaj wyniki bez przełączania narzędzi.',
  path: '/landing-v2',
  socialImageAlt: 'OpenExpert — jeden system pracy dla ekspertów',
})

const workflowSteps = [
  {
    number: '01',
    icon: 'lucide:mail',
    title: 'Wiadomość staje się sprawą',
    description: 'Mail, klient, dokumenty i następny krok trafiają do jednego kontekstu — bez ręcznego przepisywania danych.',
  },
  {
    number: '02',
    icon: 'lucide:bot',
    title: 'Agent pracuje na pełnym obrazie',
    description: 'Eve dostaje jasny cel, historię relacji i właściwe materiały. Przygotowuje wynik, a nie tylko odpowiedź na czacie.',
  },
  {
    number: '03',
    icon: 'lucide:shield-check',
    title: 'Ty zachowujesz kontrolę',
    description: 'Każdy rezultat ma status, artefakt i dowód wykonania. Zatwierdzasz dopiero wtedy, gdy wszystko jest gotowe.',
  },
]

const capabilities = [
  {
    eyebrow: 'Relacje',
    title: 'CRM, który pamięta kontekst',
    description: 'Każda osoba, firma i sprawa ma jedną historię — widoczną dokładnie tam, gdzie podejmujesz decyzję.',
    icon: 'lucide:users-round',
  },
  {
    eyebrow: 'Komunikacja',
    title: 'Poczta połączona z pracą',
    description: 'Wiadomość nie kończy się w skrzynce. Od razu widzisz powiązaną sprawę, termin i rekomendowany następny krok.',
    icon: 'lucide:mail',
  },
  {
    eyebrow: 'Wykonanie',
    title: 'Agenci z wynikiem do review',
    description: 'Delegujesz konkretne zadanie, śledzisz postęp i otrzymujesz gotowy materiał wraz z dowodem wykonania.',
    icon: 'lucide:circle-check',
  },
]
</script>

<template>
  <div class="next-landing">
    <a class="skip-link" href="#main-content">Przejdź do treści</a>

    <header class="landing-header">
      <NuxtLink to="/" class="brand" aria-label="OpenExpert — strona główna">
        <img src="/assets/logo-light.svg" alt="" width="28" height="28">
        <span>OpenExpert</span>
      </NuxtLink>

      <nav class="landing-nav" aria-label="Główna nawigacja">
        <a href="#jak-dziala">Jak działa</a>
        <a href="#mozliwosci">Możliwości</a>
        <NuxtLink to="/o-nas">O nas</NuxtLink>
      </nav>

      <NuxtLink to="/waitlist" class="header-cta">
        <span class="header-cta__wide">Poproś o dostęp</span>
        <span class="header-cta__short">Dołącz</span>
        <Icon name="lucide:arrow-right" aria-hidden="true" />
      </NuxtLink>
    </header>

    <main id="main-content" tabindex="-1">
      <section class="hero" aria-labelledby="hero-title">
        <div class="hero__inner">
          <div class="hero__copy">
            <p class="eyebrow"><span /> System pracy dla ekspertów</p>

            <h1 id="hero-title">
              Prowadź sprawy.<br>
              <em>Nie narzędzia.</em>
            </h1>

            <p class="hero__lead">
              CRM, poczta i agenci AI działają na jednym kontekście. OpenExpert porządkuje pracę od pierwszej wiadomości do zatwierdzonego wyniku.
            </p>

            <div class="hero__actions">
              <NuxtLink to="/waitlist" class="button button--primary">
                Zacznij z OpenExpert
                <Icon name="lucide:arrow-right" aria-hidden="true" />
              </NuxtLink>
              <a href="#jak-dziala" class="button button--secondary">Zobacz, jak działa</a>
            </div>

            <ul class="hero__signals" aria-label="Główne możliwości platformy">
              <li><Icon name="lucide:circle-check" aria-hidden="true" /> CRM</li>
              <li><Icon name="lucide:circle-check" aria-hidden="true" /> OpenExpert Mail</li>
              <li><Icon name="lucide:circle-check" aria-hidden="true" /> Agenci AI</li>
            </ul>
          </div>

          <div class="hero__visual">
            <LandingOrbitPhoneHero />
          </div>
        </div>
      </section>

      <section class="value-rail" aria-label="Wartość platformy">
        <p>Jeden kontekst</p><span />
        <p>Jedna odpowiedzialność</p><span />
        <p>Każdy wynik do weryfikacji</p>
      </section>

      <section id="jak-dziala" class="workflow section-shell" aria-labelledby="workflow-title">
        <div class="section-heading">
          <p class="eyebrow"><span /> Od sygnału do wyniku</p>
          <h2 id="workflow-title">Praca płynie dalej.<br><em>Kontekst zostaje.</em></h2>
          <p>OpenExpert łączy komunikację, dane i wykonanie w jeden czytelny przepływ. Każdy etap ma właściciela i następny krok.</p>
        </div>

        <ol class="workflow-grid">
          <li v-for="step in workflowSteps" :key="step.number" class="workflow-card">
            <div class="workflow-card__meta">
              <span>{{ step.number }}</span>
              <Icon :name="step.icon" aria-hidden="true" />
            </div>
            <h3>{{ step.title }}</h3>
            <p>{{ step.description }}</p>
          </li>
        </ol>
      </section>

      <section class="control-band" aria-labelledby="control-title">
        <div class="control-band__inner section-shell">
          <p class="control-band__index">01 / 03</p>
          <div>
            <p class="eyebrow eyebrow--inverse"><span /> Agent wykonuje</p>
            <h2 id="control-title">Automatyzacja bez<br><em>utraty kontroli.</em></h2>
          </div>
          <div class="control-band__copy">
            <p>Agent może analizować, przygotowywać i porządkować. Decyzja, wysyłka i finalne zatwierdzenie pozostają po Twojej stronie.</p>
            <ul>
              <li><Icon name="lucide:check" aria-hidden="true" /> Jawny plan i zakres zadania</li>
              <li><Icon name="lucide:check" aria-hidden="true" /> Artefakt zamiast samej wiadomości</li>
              <li><Icon name="lucide:check" aria-hidden="true" /> Review przed oznaczeniem jako ukończone</li>
            </ul>
          </div>
        </div>
      </section>

      <section id="mozliwosci" class="capabilities section-shell" aria-labelledby="capabilities-title">
        <div class="section-heading section-heading--row">
          <div>
            <p class="eyebrow"><span /> Jeden graf pracy</p>
            <h2 id="capabilities-title">Trzy perspektywy.<br><em>Jeden system.</em></h2>
          </div>
          <p>Nie składasz firmy z osobnych narzędzi. Każdy moduł jest innym widokiem na te same relacje, sprawy i zadania.</p>
        </div>

        <div class="capability-grid">
          <article v-for="capability in capabilities" :key="capability.title" class="capability-card">
            <div class="capability-card__icon"><Icon :name="capability.icon" aria-hidden="true" /></div>
            <p>{{ capability.eyebrow }}</p>
            <h3>{{ capability.title }}</h3>
            <span>{{ capability.description }}</span>
          </article>
        </div>
      </section>

      <section class="closing-cta section-shell" aria-labelledby="closing-title">
        <p class="eyebrow"><span /> OpenExpert</p>
        <h2 id="closing-title">Mniej przełączania.<br><em>Więcej domkniętych spraw.</em></h2>
        <p>Dołącz do programu i zobacz, jak jeden system może uporządkować pracę Twoją i całego zespołu.</p>
        <NuxtLink to="/waitlist" class="button button--primary">
          Poproś o dostęp
          <Icon name="lucide:arrow-right" aria-hidden="true" />
        </NuxtLink>
      </section>
    </main>

    <footer class="landing-footer">
      <NuxtLink to="/" class="brand" aria-label="OpenExpert — strona główna">
        <img src="/assets/logo-light.svg" alt="" width="26" height="26">
        <span>OpenExpert</span>
      </NuxtLink>
      <p>System wykonywania pracy dla ekspertów.</p>
      <div>
        <NuxtLink to="/o-nas">O nas</NuxtLink>
        <NuxtLink to="/waitlist">Dołącz</NuxtLink>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.next-landing {
  --landing-accent: #dfff5c;
  min-height: 100vh;
  overflow: hidden;
  color: var(--fg-primary);
  background: var(--bg-default);
}

.skip-link {
  position: fixed;
  z-index: 100;
  top: 12px;
  left: 12px;
  min-height: 44px;
  padding: 0 16px;
  display: inline-flex;
  align-items: center;
  color: var(--bg-default);
  background: var(--fg-primary);
  transform: translateY(-160%);
}

.skip-link:focus { transform: translateY(0); }

.landing-header {
  position: relative;
  z-index: 20;
  width: min(100% - 40px, 1480px);
  min-height: 76px;
  margin-inline: auto;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: var(--space-6);
  border-bottom: 1px solid var(--border-default);
}

.brand {
  width: fit-content;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: inherit;
  font-weight: var(--weight-semibold);
  letter-spacing: var(--tracking-tight);
  text-decoration: none;
}

.landing-nav {
  display: flex;
  align-items: center;
  gap: var(--space-8);
}

.landing-nav a,
.landing-footer a {
  color: var(--fg-secondary);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  text-decoration: none;
  transition: color var(--transition-fast);
}

.landing-nav a:hover,
.landing-footer a:hover { color: var(--fg-primary); }

.header-cta {
  min-height: 44px;
  padding: 0 16px;
  justify-self: end;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--fg-primary);
  border-radius: var(--radius-md);
  color: var(--bg-default);
  background: var(--fg-primary);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  text-decoration: none;
}

.header-cta svg { width: 16px; height: 16px; }
.header-cta__short { display: none; }

.hero {
  min-height: calc(100svh - 76px);
  border-bottom: 1px solid var(--border-default);
}

.hero__inner {
  width: 100%;
  min-height: inherit;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: stretch;
}

.hero__copy {
  position: relative;
  z-index: 2;
  padding:
    clamp(72px, 10vh, 120px)
    clamp(36px, 5vw, 86px)
    72px
    max(20px, calc((100vw - 1480px) / 2));
  display: flex;
  flex-direction: column;
  justify-content: center;
  border-right: 1px solid var(--border-default);
}

.eyebrow {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--fg-tertiary);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: var(--weight-medium);
  letter-spacing: var(--tracking-wider);
  text-transform: uppercase;
}

.eyebrow > span {
  width: 28px;
  height: 1px;
  display: block;
  background: currentColor;
}

.hero h1 {
  max-width: 760px;
  margin-top: clamp(24px, 4vh, 42px);
  font-size: clamp(58px, 6.4vw, 104px);
  font-weight: var(--weight-medium);
  line-height: 0.86;
  letter-spacing: -0.06em;
}

.hero h1 em {
  font-family: inherit;
  font-style: normal;
  font-weight: inherit;
}

.section-heading h2 em,
.control-band h2 em,
.closing-cta h2 em {
  font-family: var(--font-serif);
  font-weight: 430;
}

.hero__lead {
  max-width: 600px;
  margin-top: clamp(28px, 4vh, 42px);
  color: var(--fg-secondary);
  font-size: clamp(17px, 1.45vw, 21px);
  line-height: var(--leading-relaxed);
}

.hero__actions {
  margin-top: 34px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.button {
  min-height: 50px;
  padding: 0 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  text-decoration: none;
  transition:
    color var(--transition-fast),
    background var(--transition-fast),
    border-color var(--transition-fast),
    transform var(--transition-fast);
}

.button:hover { transform: translateY(-2px); }
.button svg { width: 17px; height: 17px; }

.button--primary {
  color: var(--bg-default);
  background: var(--fg-primary);
}

.button--secondary {
  border-color: var(--border-strong);
  color: var(--fg-primary);
  background: var(--bg-default);
}

.hero__signals {
  margin-top: clamp(36px, 7vh, 72px);
  display: flex;
  flex-wrap: wrap;
  gap: 14px 22px;
  list-style: none;
}

.hero__signals li {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--fg-secondary);
  font-size: 13px;
}

.hero__signals svg { width: 15px; height: 15px; color: var(--fg-primary); }

.hero__visual {
  position: relative;
  min-width: 0;
  overflow: hidden;
  isolation: isolate;
  background: transparent;
}

.value-rail {
  min-height: 82px;
  padding: 18px max(20px, calc((100vw - 1480px) / 2));
  display: flex;
  align-items: center;
  justify-content: center;
  gap: clamp(18px, 4vw, 62px);
  border-bottom: 1px solid var(--border-default);
  color: var(--fg-secondary);
  font-size: 13px;
  letter-spacing: var(--tracking-wide);
  text-align: center;
  text-transform: uppercase;
}

.value-rail span {
  width: 4px;
  height: 4px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--fg-primary);
}

.section-shell {
  width: min(100% - 40px, 1320px);
  margin-inline: auto;
}

.workflow,
.capabilities {
  padding-block: clamp(96px, 12vw, 180px);
}

.section-heading { max-width: 820px; }

.section-heading h2,
.closing-cta h2 {
  margin-top: 24px;
  font-size: clamp(46px, 5.4vw, 78px);
  font-weight: var(--weight-medium);
  line-height: 0.92;
  letter-spacing: -0.05em;
}

.section-heading > p:last-child {
  max-width: 600px;
  margin-top: 28px;
  color: var(--fg-secondary);
  font-size: var(--text-md);
  line-height: var(--leading-relaxed);
}

.workflow-grid {
  margin-top: clamp(64px, 8vw, 104px);
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  border-top: 1px solid var(--border-default);
  border-bottom: 1px solid var(--border-default);
  list-style: none;
}

.workflow-card {
  min-height: 330px;
  padding: clamp(24px, 3vw, 42px);
  display: flex;
  flex-direction: column;
}

.workflow-card + .workflow-card { border-left: 1px solid var(--border-default); }

.workflow-card__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--fg-tertiary);
  font-family: var(--font-mono);
  font-size: 11px;
}

.workflow-card__meta svg { width: 22px; height: 22px; color: var(--fg-primary); }

.workflow-card h3 {
  max-width: 280px;
  margin-top: auto;
  font-size: clamp(23px, 2.2vw, 31px);
  font-weight: var(--weight-medium);
  line-height: var(--leading-tight);
  letter-spacing: var(--tracking-tight);
}

.workflow-card > p {
  margin-top: 18px;
  color: var(--fg-secondary);
  line-height: var(--leading-relaxed);
}

.control-band {
  color: #f7f7f1;
  background: #080a0b;
}

.control-band__inner {
  min-height: 650px;
  padding-block: clamp(80px, 10vw, 140px);
  display: grid;
  grid-template-columns: 100px minmax(360px, 1fr) minmax(300px, 0.72fr);
  align-items: center;
  gap: clamp(28px, 5vw, 86px);
}

.control-band__index {
  align-self: start;
  color: #777c7f;
  font-family: var(--font-mono);
  font-size: 11px;
}

.eyebrow--inverse { color: #8f9496; }

.control-band h2 {
  margin-top: 26px;
  font-size: clamp(50px, 6vw, 88px);
  font-weight: var(--weight-medium);
  line-height: 0.9;
  letter-spacing: -0.055em;
}

.control-band__copy > p {
  color: #b8bcbd;
  font-size: var(--text-md);
  line-height: var(--leading-relaxed);
}

.control-band__copy ul {
  margin-top: 34px;
  display: grid;
  gap: 16px;
  list-style: none;
}

.control-band__copy li {
  display: grid;
  grid-template-columns: 22px 1fr;
  gap: 10px;
  color: #e1e3e3;
  font-size: var(--text-sm);
}

.control-band__copy svg { width: 18px; height: 18px; color: var(--landing-accent); }

.section-heading--row {
  max-width: none;
  display: grid;
  grid-template-columns: minmax(400px, 1fr) minmax(280px, 0.55fr);
  align-items: end;
  gap: 64px;
}

.section-heading--row > p:last-child { margin: 0; }

.capability-grid {
  margin-top: clamp(64px, 8vw, 100px);
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.capability-card {
  min-height: 390px;
  padding: clamp(24px, 3vw, 38px);
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--bg-subtle);
}

.capability-card__icon {
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  border: 1px solid var(--border-default);
  border-radius: 50%;
  background: var(--bg-default);
}

.capability-card__icon svg { width: 20px; height: 20px; }

.capability-card > p {
  margin-top: auto;
  color: var(--fg-tertiary);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
}

.capability-card h3 {
  max-width: 300px;
  margin-top: 12px;
  font-size: clamp(24px, 2.2vw, 32px);
  font-weight: var(--weight-medium);
  line-height: var(--leading-tight);
  letter-spacing: var(--tracking-tight);
}

.capability-card > span {
  margin-top: 18px;
  color: var(--fg-secondary);
  line-height: var(--leading-relaxed);
}

.closing-cta {
  margin-bottom: clamp(72px, 8vw, 120px);
  padding: clamp(64px, 8vw, 110px);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background:
    radial-gradient(circle at 82% 18%, color-mix(in srgb, var(--landing-accent) 22%, transparent), transparent 24rem),
    var(--bg-subtle);
}

.closing-cta > p:nth-of-type(2) {
  max-width: 620px;
  margin-top: 26px;
  color: var(--fg-secondary);
  font-size: var(--text-md);
  line-height: var(--leading-relaxed);
}

.closing-cta .button { margin-top: 34px; }

.landing-footer {
  width: min(100% - 40px, 1480px);
  min-height: 120px;
  margin-inline: auto;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 24px;
  border-top: 1px solid var(--border-default);
}

.landing-footer > p {
  color: var(--fg-tertiary);
  font-size: var(--text-sm);
}

.landing-footer > div {
  justify-self: end;
  display: flex;
  gap: 24px;
}

@media (max-width: 1100px) {
  .hero__inner {
    grid-template-columns: minmax(350px, 0.8fr) minmax(500px, 1.2fr);
  }

  .hero__copy { padding-right: 36px; }
  .control-band__inner { grid-template-columns: 64px 1fr 0.8fr; }
}

@media (max-width: 900px) {
  .landing-header { grid-template-columns: 1fr auto; }
  .landing-nav { display: none; }

  .hero__inner {
    grid-template-columns: 1fr;
  }

  .hero__visual {
    min-height: 560px;
    order: -1;
    border-bottom: 1px solid var(--border-default);
  }

  .hero__copy {
    padding: 72px 20px 84px;
    border-right: 0;
  }

  .hero h1 { max-width: 720px; }

  .workflow-grid,
  .capability-grid { grid-template-columns: 1fr; }

  .workflow-card { min-height: 280px; }
  .workflow-card + .workflow-card { border-top: 1px solid var(--border-default); border-left: 0; }

  .control-band__inner {
    grid-template-columns: 1fr;
    align-items: start;
  }

  .control-band__index { display: none; }
  .control-band__copy { max-width: 620px; }

  .section-heading--row { grid-template-columns: 1fr; gap: 28px; }
  .section-heading--row > p:last-child { margin: 0; }

  .capability-card { min-height: 310px; }
}

@media (max-width: 640px) {
  .landing-header,
  .section-shell,
  .landing-footer {
    width: min(100% - 28px, 1480px);
  }

  .landing-header { min-height: 68px; }
  .brand { font-size: var(--text-sm); }
  .brand img { width: 25px; height: 25px; }
  .header-cta { padding-inline: 13px; }
  .header-cta__wide { display: none; }
  .header-cta__short { display: inline; }

  .hero__visual { min-height: 430px; }
  .hero__copy { padding: 56px 14px 68px; }

  .hero h1 {
    margin-top: 22px;
    font-size: clamp(48px, 15vw, 68px);
    line-height: 0.9;
  }

  .hero__lead { margin-top: 26px; font-size: var(--text-base); }
  .hero__actions { align-items: stretch; flex-direction: column; }
  .button { width: 100%; }
  .hero__signals { margin-top: 34px; }

  .value-rail {
    min-height: auto;
    padding-block: 24px;
    align-items: flex-start;
    flex-direction: column;
    gap: 10px;
    text-align: left;
  }

  .value-rail span { display: none; }

  .workflow,
  .capabilities { padding-block: 88px; }

  .section-heading h2,
  .closing-cta h2 { font-size: clamp(42px, 13vw, 60px); }

  .workflow-grid { margin-top: 56px; }
  .workflow-card { min-height: 270px; padding: 28px 6px; }

  .control-band__inner { min-height: auto; padding-block: 88px; }
  .control-band h2 { font-size: clamp(46px, 14vw, 66px); }

  .capability-grid { margin-top: 52px; }
  .capability-card { min-height: 290px; }

  .closing-cta {
    width: calc(100% - 28px);
    margin-bottom: 72px;
    padding: 52px 22px;
  }

  .landing-footer {
    padding-block: 32px;
    grid-template-columns: 1fr auto;
  }

  .landing-footer > p { display: none; }
}

@media (prefers-color-scheme: dark) {
  .brand img { content: url('/assets/logo-dark.svg'); }
}

@media (prefers-reduced-motion: reduce) {
  .button,
  .landing-nav a,
  .landing-footer a { transition: none; }

  .button:hover { transform: none; }
}

@media print {
  .landing-header { position: static; }
  .hero { min-height: auto; }
}

@media (forced-colors: active) {
  .capability-card,
  .closing-cta,
  .button,
  .header-cta {
    border: 1px solid CanvasText;
  }

}
</style>
