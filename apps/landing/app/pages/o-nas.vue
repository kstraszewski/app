<script setup lang="ts">
const { canonicalUrl, siteOrigin } = useLandingSeo({
  title: 'O OpenExpert — platforma dla ekspertów i klientów',
  description: 'Poznaj OpenExpert: system pracy, publiczny katalog i rezerwacje, które łączą ekspertów, placówki i klientów w jednym procesie.',
  path: '/o-nas',
  socialImagePath: '/o-nas-og.png',
  socialImageAlt: 'O OpenExpert — platformie łączącej ekspertów, placówki i klientów',
})

useHead({
  script: [{
    key: 'structured-data:about',
    type: 'application/ld+json',
    innerHTML: serializeLandingStructuredData({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'AboutPage',
          '@id': `${canonicalUrl}#webpage`,
          url: canonicalUrl,
          name: 'O OpenExpert',
          description: 'Informacje o platformie OpenExpert, publicznym katalogu, rezerwacjach i rozdzieleniu kontekstu eksperta od konta klienta.',
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
              name: 'O OpenExpert',
              item: canonicalUrl,
            },
          ],
        },
      ],
    }),
  }],
})
</script>

<template>
  <div class="about-page">
    <DirectorySiteHeader active="about" />

    <main id="directory-content" tabindex="-1">
      <section class="about-hero" aria-labelledby="about-title">
        <div class="about-shell">
          <nav class="about-breadcrumb" aria-label="Okruszki">
            <NuxtLink to="/">OpenExpert</NuxtLink>
            <span aria-hidden="true">/</span>
            <span aria-current="page">O nas</span>
          </nav>
          <p class="about-kicker">O platformie</p>
          <h1 id="about-title">
            Technologia, która łączy eksperta,{{ ' ' }}<br>
            <em>klienta i całą sprawę.</em>
          </h1>
          <p class="about-lead">
            OpenExpert porządkuje pracę eksperta, udostępnia klientom katalog
            konsultacji i prowadzi obie strony od wyboru terminu do dalszej obsługi.
          </p>
        </div>
      </section>

      <section class="about-mission" aria-labelledby="mission-title">
        <div class="about-shell">
          <p class="about-kicker">Po co powstał OpenExpert</p>
          <div class="about-split">
            <h2 id="mission-title">Jedna sprawa zamiast wielu oderwanych narzędzi.</h2>
            <div class="about-copy">
              <p>
                Obsługa nieruchomości, kredytu lub ubezpieczenia wymaga wielu danych,
                dokumentów i decyzji. OpenExpert zbiera je w jednym procesie, w którym
                ekspert zachowuje kontrolę, a agenci AI pomagają wykonać pracę operacyjną.
              </p>
              <p>
                Klient może znaleźć publicznie udostępnionego eksperta lub placówkę,
                sprawdzić zakres konsultacji i samodzielnie wybrać termin w aktualnym
                kalendarzu.
              </p>
            </div>
          </div>

          <div class="about-audiences">
            <article>
              <span>01</span>
              <h3>Dla klientów</h3>
              <p>Przejrzysty wybór eksperta, usługi, placówki i terminu bez oczekiwania na telefon zwrotny.</p>
              <NuxtLink to="/eksperci">
                Zobacz ekspertów
                <Icon name="lucide:arrow-right" aria-hidden="true" />
              </NuxtLink>
            </article>
            <article>
              <span>02</span>
              <h3>Dla ekspertów i zespołów</h3>
              <p>CRM, proces, rezerwacje i agenci AI pracujący na wspólnym kontekście sprawy.</p>
              <NuxtLink to="/#dla-ekspertow">
                Poznaj system
                <Icon name="lucide:arrow-right" aria-hidden="true" />
              </NuxtLink>
            </article>
          </div>
        </div>
      </section>

      <section class="about-directory" aria-labelledby="directory-rules-title">
        <div class="about-shell">
          <p class="about-kicker">Publiczny katalog</p>
          <h2 id="directory-rules-title">Publikacja jest świadomą decyzją organizacji.</h2>
          <ol>
            <li>
              <span>01</span>
              <div>
                <h3>Tylko aktywny kalendarz</h3>
                <p>W katalogu może pojawić się wyłącznie aktywny kalendarz konsultacji z prawidłowo skonfigurowaną usługą i ekspertem.</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Jawne włączenie publikacji</h3>
                <p>Sam fakt korzystania z OpenExpert nie publikuje profilu. Organizacja osobno decyduje o obecności w katalogu i może ją wyłączyć.</p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Dane zgodne z kalendarzem</h3>
                <p>Katalog pokazuje nazwy ekspertów, placówek i usług udostępnione w konfiguracji aktualnej rezerwacji.</p>
              </div>
            </li>
          </ol>
          <aside>
            <Icon name="lucide:shield-check" aria-hidden="true" />
            <p>
              Obecność w katalogu nie jest automatycznym potwierdzeniem licencji ani
              uprawnień zawodowych. Jeżeli są istotne dla Twojej sprawy, zweryfikuj je
              bezpośrednio u eksperta lub w odpowiednim rejestrze.
            </p>
          </aside>
        </div>
      </section>

      <section class="about-contexts" aria-labelledby="contexts-title">
        <div class="about-shell">
          <p class="about-kicker">Konto i role</p>
          <div class="about-split">
            <h2 id="contexts-title">Jedno logowanie.{{ ' ' }}<br><em>Osobne konteksty.</em></h2>
            <div class="about-copy">
              <p>
                Ta sama osoba może korzystać z OpenExpert jako członek zespołu oraz jako
                klient innej organizacji. System nie tworzy wtedy sztucznie drugiej
                tożsamości.
              </p>
              <p>
                Po zalogowaniu użytkownik wybiera właściwy kontekst. Widok klienta,
                uprawnienia organizacyjne i dane spraw pozostają od siebie oddzielone.
              </p>
            </div>
          </div>
          <div class="context-flow" aria-label="Rozdzielenie kontekstów jednego konta">
            <div>
              <span>To samo konto</span>
              <strong>Bez duplikowania tożsamości</strong>
            </div>
            <Icon name="lucide:arrow-right" aria-hidden="true" />
            <div>
              <span>Kontekst pracy</span>
              <strong>Ekspert lub zespół</strong>
            </div>
            <Icon name="lucide:arrow-right" aria-hidden="true" />
            <div>
              <span>Kontekst prywatny</span>
              <strong>Klient i jego wizyty</strong>
            </div>
          </div>
        </div>
      </section>

      <section class="about-contact" aria-labelledby="contact-title">
        <div class="about-shell">
          <p class="about-kicker">Transparentność i kontakt</p>
          <h2 id="contact-title">Budujemy OpenExpert otwarcie.</h2>
          <p>
            Kod projektu jest publiczny, a pytania dotyczące platformy możesz przesłać
            bezpośrednio do zespołu.
          </p>
          <div class="about-actions">
            <a href="mailto:hello@openexpert.app">
              hello@openexpert.app
              <Icon name="lucide:mail" aria-hidden="true" />
            </a>
            <a
              href="https://github.com/OpenExpertApp/OpenExpert"
              target="_blank"
              rel="noopener noreferrer"
            >
              Repozytorium GitHub
              <Icon name="lucide:github" aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>
    </main>

    <DirectorySiteFooter />
  </div>
</template>

<style scoped>
.about-page {
  min-width: 0;
  background: #f7f7f5;
  color: #111;
  font-family: var(--font-sans);
}

#directory-content:focus {
  outline: none;
}

.about-shell {
  width: min(1240px, calc(100% - 96px));
  margin: 0 auto;
}

.about-kicker {
  color: #666;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.about-hero {
  border-bottom: 1px solid #292929;
  padding: 34px 0 clamp(84px, 10vw, 132px);
  background: #030303;
  color: #f7f7f7;
}

.about-breadcrumb {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: clamp(64px, 8vw, 104px);
  color: #aaa;
  font-size: 12px;
}

.about-breadcrumb a {
  color: #e1e1e1;
  text-decoration: none;
}

.about-breadcrumb a:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.about-hero .about-kicker {
  color: #aaa;
}

.about-hero h1 {
  max-width: 1120px;
  margin-top: 20px;
  font-size: clamp(50px, 7vw, 98px);
  font-variation-settings: 'opsz' 98, 'wght' 300;
  font-weight: 300;
  letter-spacing: -0.055em;
  line-height: 0.94;
}

.about-hero h1 em {
  color: #aaa;
  font-family: var(--font-serif);
  font-weight: 400;
}

.about-lead {
  max-width: 720px;
  margin-top: 36px;
  color: #bdbdbd;
  font-size: clamp(17px, 1.6vw, 21px);
  line-height: 1.6;
}

.about-mission,
.about-contexts,
.about-contact {
  padding: clamp(78px, 9vw, 124px) 0;
}

.about-mission {
  border-bottom: 1px solid #d0d0cb;
}

.about-split {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(300px, 0.9fr);
  align-items: start;
  gap: clamp(48px, 7vw, 96px);
  margin-top: 20px;
}

.about-split h2,
.about-directory h2,
.about-contact h2 {
  max-width: 760px;
  font-size: clamp(38px, 5vw, 68px);
  font-variation-settings: 'opsz' 68, 'wght' 300;
  font-weight: 300;
  letter-spacing: -0.045em;
  line-height: 1;
}

.about-split h2 em {
  color: #777;
  font-family: var(--font-serif);
}

.about-copy {
  display: grid;
  gap: 18px;
  padding-top: 8px;
}

.about-copy p,
.about-contact > .about-shell > p {
  color: #555;
  font-size: 15px;
  line-height: 1.7;
}

.about-audiences {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-top: 64px;
  border-top: 1px solid #aaa;
}

.about-audiences article {
  padding: 28px 40px 0 0;
}

.about-audiences article + article {
  border-left: 1px solid #d0d0cb;
  padding-left: 40px;
}

.about-audiences article > span,
.about-directory li > span,
.context-flow span {
  color: #666;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.about-audiences h3 {
  margin-top: 28px;
  font-size: 22px;
  font-weight: 600;
}

.about-audiences p {
  max-width: 480px;
  margin-top: 10px;
  color: #555;
  font-size: 14px;
  line-height: 1.6;
}

.about-audiences a {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  margin-top: 22px;
  border-bottom: 1px solid #777;
  color: #111;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
}

.about-audiences a :deep(svg) {
  width: 15px;
  height: 15px;
}

.about-directory {
  padding: clamp(78px, 9vw, 124px) 0;
  background: #111;
  color: #f7f7f7;
}

.about-directory .about-kicker {
  color: #aaa;
}

.about-directory h2 {
  margin-top: 20px;
}

.about-directory ol {
  margin-top: 54px;
  border-top: 1px solid #555;
  list-style: none;
}

.about-directory li {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: 24px;
  border-bottom: 1px solid #333;
  padding: 25px 0;
}

.about-directory li > span {
  color: #999;
}

.about-directory li h3 {
  font-size: 18px;
  font-weight: 600;
}

.about-directory li p {
  max-width: 720px;
  margin-top: 7px;
  color: #aaa;
  font-size: 14px;
  line-height: 1.6;
}

.about-directory aside {
  display: grid;
  max-width: 840px;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 16px;
  margin-top: 34px;
  border: 1px solid #484848;
  border-radius: 5px;
  padding: 20px;
  background: #181818;
}

.about-directory aside :deep(svg) {
  width: 22px;
  height: 22px;
}

.about-directory aside p {
  color: #c7c7c7;
  font-size: 13px;
  line-height: 1.6;
}

.about-contexts {
  border-bottom: 1px solid #d0d0cb;
  background: #ecece8;
}

.context-flow {
  display: grid;
  grid-template-columns: 1fr auto 1fr auto 1fr;
  align-items: center;
  gap: 18px;
  margin-top: 58px;
}

.context-flow > div {
  display: grid;
  min-height: 118px;
  align-content: center;
  gap: 10px;
  border: 1px solid #c5c5c0;
  border-radius: 5px;
  padding: 22px;
  background: #f7f7f5;
}

.context-flow strong {
  font-size: 15px;
}

.context-flow > :deep(svg) {
  width: 18px;
  height: 18px;
  color: #777;
}

.about-contact h2 {
  margin-top: 20px;
}

.about-contact > .about-shell > p {
  max-width: 650px;
  margin-top: 22px;
}

.about-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 34px;
}

.about-actions a {
  display: inline-flex;
  min-height: 46px;
  align-items: center;
  gap: 10px;
  border: 1px solid #111;
  border-radius: 4px;
  padding: 10px 15px;
  background: #111;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
}

.about-actions a + a {
  background: transparent;
  color: #111;
}

.about-actions a :deep(svg) {
  width: 16px;
  height: 16px;
}

.about-page :is(a, button):focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 3px;
}

.about-actions a:focus-visible {
  outline-color: #111;
}

@media (max-width: 760px) {
  .about-shell {
    width: min(100% - 40px, 620px);
  }

  .about-hero {
    padding-top: 28px;
  }

  .about-breadcrumb {
    margin-bottom: 58px;
  }

  .about-hero h1 {
    font-size: clamp(46px, 14vw, 68px);
  }

  .about-split,
  .about-audiences {
    grid-template-columns: 1fr;
  }

  .about-split {
    gap: 24px;
  }

  .about-audiences article {
    padding: 24px 0;
  }

  .about-audiences article + article {
    border-top: 1px solid #d0d0cb;
    border-left: 0;
    padding-left: 0;
  }

  .about-directory li {
    grid-template-columns: 54px minmax(0, 1fr);
  }

  .context-flow {
    grid-template-columns: 1fr;
  }

  .context-flow > :deep(svg) {
    margin-left: 22px;
    transform: rotate(90deg);
  }
}
</style>
