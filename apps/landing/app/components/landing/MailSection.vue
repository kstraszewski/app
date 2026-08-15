<script setup lang="ts">
const mailFeatures = [
  {
    icon: 'lucide:mail',
    title: 'Gmail, Microsoft i inne skrzynki',
    description: 'Podłącz Gmail, Outlook lub Microsoft 365, a także inną skrzynkę przez szyfrowane IMAP i SMTP.',
  },
  {
    icon: 'lucide:message-square',
    title: 'Pełna obsługa bez opuszczania CRM',
    description: 'Czytaj, wyszukuj, pisz i odpowiadaj bez przełączania kart i narzędzi.',
  },
  {
    icon: 'lucide:search',
    title: 'Korespondencja przy kliencie i sprawie',
    description: 'OpenExpert znajduje wątki po adresach e-mail i pozwala przypiąć je do właściwego klienta lub sprawy.',
  },
  {
    icon: 'lucide:shield-check',
    title: 'Bezpieczny podgląd bez śledzenia',
    description: 'Piksele śledzące i aktywny kod nie uruchamiają się podczas czytania wiadomości.',
  },
]

const previewThreads = [
  {
    sender: 'Anna Kowalska',
    subject: 'Dokumenty do umowy kredytowej',
    preview: 'Dzień dobry, przesyłam brakujące zaświadczenie…',
    time: '10:42',
    unread: true,
  },
  {
    sender: 'Bank Północny',
    subject: 'Sprawa OE-142 — decyzja',
    preview: 'Wniosek został przekazany do finalnej weryfikacji.',
    time: '09:18',
    unread: false,
  },
  {
    sender: 'Tomasz Nowak',
    subject: 'Termin spotkania',
    preview: 'Czwartek o 12:30 będzie dla mnie odpowiedni.',
    time: 'wczoraj',
    unread: false,
  },
]
</script>

<template>
  <section id="openexpert-mail" class="mail-section" aria-labelledby="mail-title">
    <div class="mail-inner">
      <header class="mail-heading">
        <div class="mail-heading__copy">
          <p class="mail-label">OpenExpert Mail</p>
          <h2 id="mail-title">
            Poczta ma po prostu działać.
            <em>Zawsze, kiedy jej potrzebujesz.</em>
          </h2>
          <p class="mail-lead">Czytaj, wyszukuj, wysyłaj i odpowiadaj bez wychodzenia z OpenExpert. Z poziomu klienta lub sprawy znajdziesz pasujące wątki, przypniesz je do kontekstu i odpiszesz bez przełączania narzędzi.</p>
        </div>

        <aside class="availability-card" aria-labelledby="availability-title">
          <div class="availability-card__topline">
            <span class="availability-status"><i aria-hidden="true" /> Niezawodność i bezpieczeństwo</span>
            <Icon name="lucide:shield-check" aria-hidden="true" />
          </div>

          <p class="availability-number" aria-label="99,99 procent dostępności">
            <strong>99,99</strong><span>%</span>
          </p>
          <h3 id="availability-title">gwarantowanej dostępności OpenExpert Mail</h3>
          <p class="availability-explanation">W prostych słowach: możesz liczyć na pocztę przez całą dobę — także wtedy, gdy klient, bank lub partner czeka na odpowiedź.</p>

          <div class="availability-facts" role="list" aria-label="Ochrona poczty w OpenExpert Mail">
            <span role="listitem">
              <Icon name="lucide:user-round-check" aria-hidden="true" />
              <span class="availability-fact__copy">
                <strong>Prywatny dostęp</strong>
                <small>Każda skrzynka jest dostępna tylko dla jej właściciela.</small>
              </span>
            </span>
            <span role="listitem">
              <Icon name="lucide:lock-keyhole" aria-hidden="true" />
              <span class="availability-fact__copy">
                <strong>Szyfrowane dane</strong>
                <small>Dane dostępowe do poczty są chronione szyfrowaniem.</small>
              </span>
            </span>
          </div>

          <p class="availability-assurance">
            <Icon name="lucide:shield-check" aria-hidden="true" />
            <span>Wiadomości pozostają w Twojej skrzynce — ich treść nie jest zapisywana w CRM.</span>
          </p>
        </aside>
      </header>

      <div class="mail-showcase">
        <article class="mail-preview" aria-label="Statyczny podgląd OpenExpert Mail">
          <header class="mail-preview__bar">
            <span class="mail-preview__brand">
              <Icon name="lucide:mail" aria-hidden="true" />
              <strong>OpenExpert Mail</strong>
            </span>
            <span class="mail-preview__connected">
              <i aria-hidden="true" />
              Skrzynka połączona
            </span>
          </header>

          <div class="mail-preview__tabs" aria-label="Foldery poczty">
            <span class="is-active">Odebrane <small>12</small></span>
            <span>Oznaczone</span>
            <span>Wysłane</span>
            <span>Szkice <small>2</small></span>
          </div>

          <div class="mail-preview__workspace">
            <div class="mail-list">
              <div class="mail-search" aria-hidden="true">
                <Icon name="lucide:search" />
                <span>Szukaj w poczcie</span>
              </div>

              <ul class="mail-list__threads">
                <li
                  v-for="(thread, index) in previewThreads"
                  :key="thread.subject"
                  :class="{ 'is-selected': index === 0, 'is-unread': thread.unread }"
                >
                  <span class="mail-thread__topline">
                    <strong>{{ thread.sender }}</strong>
                    <small>{{ thread.time }}</small>
                  </span>
                  <span class="mail-thread__subject">{{ thread.subject }}</span>
                  <span class="mail-thread__preview">{{ thread.preview }}</span>
                </li>
              </ul>
            </div>

            <div class="mail-detail">
              <div class="mail-detail__context">
                <span>
                  <Icon name="lucide:circle-check" aria-hidden="true" />
                  Sugerowane powiązanie
                </span>
                <strong>Anna Kowalska · Sprawa OE-142</strong>
              </div>

              <header class="mail-detail__heading">
                <div>
                  <p>Wątek · 3 wiadomości</p>
                  <h3>Dokumenty do umowy kredytowej</h3>
                </div>
                <span class="mail-detail__safe">
                  <Icon name="lucide:shield-check" aria-hidden="true" />
                  Bez obrazów śledzących
                </span>
              </header>

              <div class="mail-message">
                <header class="mail-message__sender">
                  <span class="mail-avatar" aria-hidden="true">AK</span>
                  <span>
                    <strong>Anna Kowalska</strong>
                    <small>anna.kowalska@example.com</small>
                  </span>
                  <time>dziś, 10:42</time>
                </header>

                <div class="mail-message__body">
                  <p>Dzień dobry,</p>
                  <p>przesyłam brakujące zaświadczenie. Proszę o informację, czy możemy przejść do podpisania umowy.</p>
                  <p>Pozdrawiam<br>Anna Kowalska</p>
                </div>

                <footer class="mail-message__footer">
                  <span class="mail-attachment">
                    <Icon name="lucide:file-text" aria-hidden="true" />
                    zaswiadczenie.pdf · 1,2 MB
                  </span>
                  <span class="mail-reply">
                    <Icon name="lucide:message-square" aria-hidden="true" />
                    Odpowiedz w OpenExpert
                  </span>
                </footer>
              </div>
            </div>
          </div>
        </article>

        <ol class="mail-features" aria-label="Możliwości OpenExpert Mail">
          <li v-for="(feature, index) in mailFeatures" :key="feature.title">
            <span class="mail-feature__index">0{{ index + 1 }}</span>
            <Icon :name="feature.icon" aria-hidden="true" />
            <div>
              <h3>{{ feature.title }}</h3>
              <p>{{ feature.description }}</p>
            </div>
          </li>
        </ol>
      </div>

      <p class="mail-guarantee-note"><span aria-hidden="true">*</span> Gwarancja 99,99% dotyczy dostępności usługi OpenExpert Mail. Wysyłanie i odbieranie wiadomości zależy także od działania podłączonego dostawcy poczty, takiego jak Google, Microsoft lub serwer IMAP/SMTP, oraz połączenia internetowego.</p>
    </div>
  </section>
</template>

<style scoped>
.mail-section {
  scroll-margin-top: 88px;
  border-top: 1px solid #292929;
  background: #030303;
  color: #f7f7f7;
  font-family: var(--font-sans);
}

.mail-inner {
  width: min(1340px, calc(100% - 96px));
  margin: 0 auto;
  padding: 104px 0 52px;
}

.mail-heading {
  display: grid;
  grid-template-columns: minmax(0, 0.88fr) minmax(520px, 1.12fr);
  align-items: stretch;
  gap: clamp(56px, 7vw, 112px);
  margin-bottom: 52px;
}

.mail-heading__copy {
  align-self: center;
}

.mail-label {
  margin-bottom: 24px;
  color: #8fd8b8;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
  letter-spacing: 0.12em;
  line-height: 1.5;
  text-transform: uppercase;
}

.mail-heading h2 {
  max-width: 720px;
  font-size: clamp(44px, 4.2vw, 62px);
  font-variation-settings: 'opsz' 58, 'wght' 300;
  font-weight: 300;
  letter-spacing: -0.047em;
  line-height: 1.03;
}

.mail-heading h2 em {
  display: block;
  color: #b9e8d1;
  font-family: var(--font-serif);
  font-style: italic;
  font-variation-settings: 'opsz' 60, 'wght' 340;
  font-weight: 340;
}

.mail-lead {
  max-width: 610px;
  margin-top: 25px;
  color: #aaa;
  font-size: 16px;
  line-height: 1.65;
}

.availability-card {
  min-width: 0;
  border: 1px solid #5a8f76;
  border-radius: 6px;
  background: #e9f3ed;
  color: #0b2117;
  padding: clamp(28px, 3vw, 42px);
}

.availability-card__topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 35px;
}

.availability-card__topline > :deep(svg) {
  width: 30px;
  height: 30px;
  color: #247653;
  stroke-width: 1.4;
}

.availability-status {
  display: inline-flex;
  min-height: 31px;
  align-items: center;
  gap: 8px;
  border: 1px solid #9cc8af;
  border-radius: 999px;
  padding: 5px 11px;
  color: #245b43;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 9px;
  letter-spacing: 0.06em;
  line-height: 1.3;
  text-transform: uppercase;
}

.availability-status i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #27885f;
  box-shadow: 0 0 0 4px rgba(39, 136, 95, 0.12);
}

.availability-number {
  display: flex;
  align-items: flex-start;
  white-space: nowrap;
}

.availability-number strong {
  font-size: clamp(78px, 8vw, 124px);
  font-variation-settings: 'opsz' 110, 'wght' 260;
  font-weight: 260;
  letter-spacing: -0.078em;
  line-height: 0.75;
}

.availability-number span {
  margin: 1px 0 0 10px;
  color: #247653;
  font-size: clamp(25px, 2.8vw, 40px);
  font-weight: 400;
  line-height: 1;
}

.availability-card h3 {
  margin-top: 22px;
  font-size: clamp(19px, 1.7vw, 24px);
  font-weight: 500;
  letter-spacing: -0.025em;
  line-height: 1.25;
}

.availability-explanation {
  max-width: 580px;
  margin-top: 12px;
  color: #385d4b;
  font-size: 14px;
  line-height: 1.55;
}

.availability-facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  margin-top: 27px;
  background: #a9c9b8;
}

.availability-facts > span {
  display: grid;
  min-width: 0;
  grid-template-columns: 24px minmax(0, 1fr);
  align-items: start;
  gap: 11px;
  background: #f4f8f5;
  padding: 16px 17px;
}

.availability-facts > span > :deep(svg) {
  width: 22px;
  height: 22px;
  color: #247653;
  stroke-width: 1.55;
}

.availability-fact__copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.availability-facts strong {
  color: #154b34;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.035em;
  line-height: 1.2;
}

.availability-facts small {
  color: #547061;
  font-size: 10.5px;
  line-height: 1.45;
}

.availability-assurance {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin-top: 10px;
  border: 1px solid #b7d2c3;
  border-radius: 4px;
  background: #e1eee6;
  color: #385d4b;
  padding: 10px 13px;
  font-size: 10.5px;
  line-height: 1.45;
}

.availability-assurance > :deep(svg) {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  color: #247653;
  stroke-width: 1.6;
}

.mail-showcase {
  display: grid;
  grid-template-columns: minmax(0, 1.62fr) minmax(310px, 0.58fr);
  align-items: stretch;
  gap: 1px;
  overflow: hidden;
  border: 1px solid #343434;
  border-radius: 6px;
  background: #343434;
}

.mail-preview {
  min-width: 0;
  background: #0b0b0b;
}

.mail-preview__bar {
  display: flex;
  min-height: 62px;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  border-bottom: 1px solid #2b2b2b;
  padding: 13px 18px;
}

.mail-preview__brand,
.mail-preview__connected {
  display: inline-flex;
  align-items: center;
}

.mail-preview__brand {
  gap: 10px;
}

.mail-preview__brand :deep(svg) {
  width: 20px;
  height: 20px;
  color: #a3e2c3;
  stroke-width: 1.5;
}

.mail-preview__brand strong {
  font-size: 14px;
  font-weight: 550;
}

.mail-preview__connected {
  gap: 7px;
  color: #8fd8b8;
  font-size: 10px;
}

.mail-preview__connected i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #48b986;
}

.mail-preview__tabs {
  display: flex;
  min-height: 47px;
  align-items: stretch;
  gap: 4px;
  overflow: hidden;
  border-bottom: 1px solid #2b2b2b;
  padding: 0 13px;
  color: #858585;
  white-space: nowrap;
}

.mail-preview__tabs > span {
  display: inline-flex;
  min-height: 47px;
  align-items: center;
  gap: 7px;
  border-bottom: 1px solid transparent;
  padding: 0 10px;
  font-size: 10.5px;
}

.mail-preview__tabs > span.is-active {
  border-color: #f1f1f1;
  color: #f1f1f1;
}

.mail-preview__tabs small {
  display: grid;
  min-width: 20px;
  height: 20px;
  place-items: center;
  border-radius: 999px;
  background: #262626;
  color: #bdbdbd;
  padding: 0 5px;
  font-size: 8px;
}

.mail-preview__workspace {
  display: grid;
  min-height: 468px;
  grid-template-columns: minmax(235px, 0.64fr) minmax(0, 1.36fr);
}

.mail-list {
  min-width: 0;
  border-right: 1px solid #2b2b2b;
  background: #080808;
}

.mail-search {
  display: flex;
  min-height: 48px;
  align-items: center;
  gap: 9px;
  margin: 14px;
  border: 1px solid #353535;
  border-radius: 4px;
  padding: 0 12px;
  color: #676767;
  font-size: 10px;
}

.mail-search :deep(svg) {
  width: 16px;
  height: 16px;
  stroke-width: 1.5;
}

.mail-list__threads {
  border-top: 1px solid #252525;
  list-style: none;
}

.mail-list__threads li {
  position: relative;
  display: flex;
  min-width: 0;
  min-height: 112px;
  border-bottom: 1px solid #252525;
  padding: 17px 15px;
  flex-direction: column;
}

.mail-list__threads li.is-selected {
  background: #141414;
}

.mail-list__threads li.is-selected::before {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 2px;
  background: #8fd8b8;
  content: '';
}

.mail-thread__topline {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.mail-thread__topline strong {
  overflow: hidden;
  color: #d7d7d7;
  font-size: 11px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mail-list__threads li.is-unread .mail-thread__topline strong {
  color: #fff;
  font-weight: 650;
}

.mail-thread__topline small {
  flex: 0 0 auto;
  color: #777;
  font-size: 8px;
}

.mail-thread__subject,
.mail-thread__preview {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mail-thread__subject {
  margin-bottom: 5px;
  color: #e5e5e5;
  font-size: 10.5px;
  font-weight: 550;
}

.mail-thread__preview {
  color: #777;
  font-size: 9.5px;
}

.mail-detail {
  min-width: 0;
  background: #101010;
  padding: 24px;
}

.mail-detail__context {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  border: 1px solid #2f5542;
  border-radius: 4px;
  background: #10231a;
  padding: 10px 12px;
}

.mail-detail__context span {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 7px;
  color: #8fd8b8;
  font-size: 9px;
}

.mail-detail__context span :deep(svg) {
  width: 14px;
  height: 14px;
}

.mail-detail__context strong {
  overflow: hidden;
  color: #d6eadf;
  font-size: 9.5px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mail-detail__heading {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding: 26px 0 20px;
}

.mail-detail__heading > div {
  min-width: 0;
}

.mail-detail__heading p {
  margin-bottom: 8px;
  color: #777;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 8px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.mail-detail__heading h3 {
  overflow: hidden;
  color: #f5f5f5;
  font-size: clamp(20px, 2.1vw, 29px);
  font-weight: 400;
  letter-spacing: -0.035em;
  line-height: 1.13;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mail-detail__safe {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  color: #8fd8b8;
  font-size: 9px;
}

.mail-detail__safe :deep(svg) {
  width: 14px;
  height: 14px;
}

.mail-message {
  overflow: hidden;
  border: 1px solid #313131;
  border-radius: 5px;
  background: #090909;
}

.mail-message__sender {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 11px;
  border-bottom: 1px solid #292929;
  padding: 15px 16px;
}

.mail-avatar {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 50%;
  background: #ecece8;
  color: #111;
  font-size: 9px;
  font-weight: 650;
}

.mail-message__sender > span:nth-child(2) {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.mail-message__sender strong,
.mail-message__sender small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mail-message__sender strong {
  color: #ededed;
  font-size: 10.5px;
  font-weight: 600;
}

.mail-message__sender small,
.mail-message__sender time {
  color: #767676;
  font-size: 8.5px;
}

.mail-message__sender time {
  flex: 0 0 auto;
}

.mail-message__body {
  min-height: 150px;
  padding: 24px 26px;
  color: #c9c9c9;
  font-size: 11.5px;
  line-height: 1.65;
}

.mail-message__body p + p {
  margin-top: 13px;
}

.mail-message__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  border-top: 1px solid #292929;
  padding: 12px 15px;
}

.mail-attachment,
.mail-reply {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 8.5px;
}

.mail-attachment {
  min-width: 0;
  overflow: hidden;
  color: #939393;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mail-reply {
  flex: 0 0 auto;
  border: 1px solid #424242;
  border-radius: 3px;
  color: #e7e7e7;
  padding: 7px 9px;
}

.mail-attachment :deep(svg),
.mail-reply :deep(svg) {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
}

.mail-features {
  display: grid;
  min-width: 0;
  background: #111;
  list-style: none;
}

.mail-features li {
  display: grid;
  min-width: 0;
  grid-template-columns: 25px 32px minmax(0, 1fr);
  align-items: start;
  gap: 14px;
  border-bottom: 1px solid #343434;
  padding: 27px 25px;
}

.mail-features li:last-child {
  border-bottom: 0;
}

.mail-feature__index {
  color: #686868;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 9px;
  letter-spacing: 0.06em;
}

.mail-features li > :deep(svg) {
  width: 25px;
  height: 25px;
  color: #8fd8b8;
  stroke-width: 1.35;
}

.mail-features h3 {
  margin-bottom: 7px;
  color: #f2f2f2;
  font-size: 15px;
  font-weight: 550;
  letter-spacing: -0.015em;
  line-height: 1.28;
}

.mail-features p {
  color: #8e8e8e;
  font-size: 11.5px;
  line-height: 1.55;
}

.mail-guarantee-note {
  display: flex;
  max-width: 1040px;
  align-items: flex-start;
  gap: 8px;
  margin-top: 19px;
  color: #737373;
  font-size: 10px;
  line-height: 1.55;
}

.mail-guarantee-note span {
  flex: 0 0 auto;
  color: #8fd8b8;
}

@media (max-width: 1099px) {
  .mail-inner {
    width: min(760px, calc(100% - 64px));
    padding-top: 88px;
  }

  .mail-heading {
    grid-template-columns: 1fr;
    gap: 42px;
  }

  .mail-heading__copy {
    max-width: 690px;
  }

  .availability-card {
    max-width: 760px;
  }

  .availability-number strong {
    font-size: clamp(90px, 15vw, 116px);
  }

  .mail-showcase {
    grid-template-columns: 1fr;
  }

  .mail-features {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .mail-features li:nth-child(odd) {
    border-right: 1px solid #343434;
  }

  .mail-features li:nth-last-child(-n + 2) {
    border-bottom: 0;
  }
}

@media (max-width: 767px) {
  .mail-inner {
    width: min(100% - 40px, 620px);
    padding: 72px 0 42px;
  }

  .mail-heading {
    gap: 34px;
    margin-bottom: 36px;
  }

  .mail-label {
    margin-bottom: 19px;
  }

  .mail-heading h2 {
    font-size: clamp(37px, 11.5vw, 50px);
  }

  .mail-lead {
    margin-top: 20px;
    font-size: 15px;
    line-height: 1.62;
  }

  .availability-card {
    padding: 25px 20px 20px;
  }

  .availability-card__topline {
    margin-bottom: 29px;
  }

  .availability-card__topline > :deep(svg) {
    display: none;
  }

  .availability-status {
    min-height: 28px;
    padding: 4px 9px;
    font-size: 8px;
  }

  .availability-number strong {
    font-size: clamp(69px, 22vw, 94px);
  }

  .availability-number span {
    margin-left: 6px;
    font-size: 25px;
  }

  .availability-card h3 {
    margin-top: 19px;
    font-size: 19px;
  }

  .availability-explanation {
    font-size: 13px;
  }

  .availability-facts {
    grid-template-columns: 1fr;
    margin-top: 22px;
  }

  .availability-facts > span {
    padding: 14px 15px;
  }

  .mail-preview__bar {
    min-height: 56px;
    padding: 11px 13px;
  }

  .mail-preview__brand strong {
    font-size: 12px;
  }

  .mail-preview__connected {
    font-size: 8px;
  }

  .mail-preview__tabs {
    padding: 0 7px;
  }

  .mail-preview__tabs > span {
    padding: 0 7px;
  }

  .mail-preview__tabs > span:nth-child(2) {
    display: none;
  }

  .mail-preview__workspace {
    min-height: 0;
    grid-template-columns: 1fr;
  }

  .mail-list {
    display: none;
  }

  .mail-detail {
    padding: 14px;
  }

  .mail-detail__context {
    align-items: flex-start;
    flex-direction: column;
    gap: 5px;
  }

  .mail-detail__heading {
    gap: 12px;
    padding: 22px 0 17px;
  }

  .mail-detail__heading h3 {
    font-size: clamp(20px, 6.5vw, 26px);
    white-space: normal;
  }

  .mail-detail__safe {
    display: none;
  }

  .mail-message__sender {
    padding: 13px;
  }

  .mail-message__sender time {
    display: none;
  }

  .mail-message__body {
    min-height: 0;
    padding: 19px 16px;
    font-size: 11px;
  }

  .mail-message__footer {
    align-items: stretch;
    flex-direction: column;
  }

  .mail-reply {
    justify-content: center;
  }

  .mail-features {
    grid-template-columns: 1fr;
  }

  .mail-features li,
  .mail-features li:nth-child(odd),
  .mail-features li:nth-last-child(-n + 2) {
    border-right: 0;
    border-bottom: 1px solid #343434;
    padding: 22px 18px;
  }

  .mail-features li:last-child {
    border-bottom: 0;
  }

  .mail-guarantee-note {
    margin-top: 16px;
    font-size: 9.5px;
  }
}

@media (max-width: 359px) {
  .mail-inner {
    width: calc(100% - 32px);
  }

  .availability-card {
    padding-right: 16px;
    padding-left: 16px;
  }

  .availability-number strong {
    font-size: 64px;
  }

  .availability-number span {
    margin-top: 0;
    font-size: 22px;
  }

  .mail-preview__connected {
    display: none;
  }

  .mail-preview__tabs > span {
    padding-right: 6px;
    padding-left: 6px;
    font-size: 9.5px;
  }

  .mail-preview__tabs > span:nth-child(3) {
    display: none;
  }

  .mail-features li {
    grid-template-columns: 21px 28px minmax(0, 1fr);
    gap: 11px;
    padding-right: 14px;
    padding-left: 14px;
  }

  .mail-features li > :deep(svg) {
    width: 22px;
    height: 22px;
  }
}
</style>
