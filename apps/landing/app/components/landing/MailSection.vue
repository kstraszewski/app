<script setup lang="ts">
withDefaults(defineProps<{
  showProductLink?: boolean
}>(), {
  showProductLink: true,
})

const mailFeatures = [
  {
    icon: 'lucide:user-round',
    title: 'Cała korespondencja w widoku klienta',
    description: 'Wiadomości z klientem masz przy jego karcie — razem z danymi, dokumentami i historią współpracy.',
  },
  {
    icon: 'lucide:link-2',
    title: 'Maile powiązane z właściwą sprawą',
    description: 'OpenExpert pokazuje pasujące wiadomości w widoku sprawy, a ważne wątki możesz z nią trwale powiązać.',
  },
  {
    icon: 'lucide:sparkles',
    title: 'Propozycje odpowiedzi od agenta AI',
    description: 'Agent analizuje wiadomość i kontekst sprawy, a potem przygotowuje szkic, który sprawdzasz przed wysłaniem.',
  },
  {
    icon: 'lucide:mail-check',
    title: 'Twoja skrzynka, bez zmiany adresu',
    description: 'Podłącz Gmail, Outlook, Microsoft 365 lub inną skrzynkę przez szyfrowane IMAP i SMTP.',
  },
]

const mailAssurances = [
  {
    icon: 'lucide:gauge',
    title: '99,99% dostępności*',
    description: 'Gwarancja dla usługi OpenExpert Mail',
  },
  {
    icon: 'lucide:lock-keyhole',
    title: 'Prywatny, szyfrowany dostęp',
    description: 'Skrzynka jest widoczna tylko dla jej właściciela',
  },
  {
    icon: 'lucide:shield-check',
    title: 'Bezpieczny podgląd',
    description: 'Bez uruchamiania pikseli śledzących i aktywnego kodu',
  },
]

const previewThreads = [
  {
    sender: 'PKO Bank Polski',
    subject: 'Jest decyzja · Anna Kowalska',
    preview: 'Pozytywna decyzja dla wniosku OE-142 jest w załączniku.',
    time: '10:42',
    unread: true,
  },
  {
    sender: 'Santander Bank Polska',
    subject: 'Formularz informacyjny · Tomasz Nowak',
    preview: 'Formularz ESIS dla wybranego wariantu jest gotowy.',
    time: '09:18',
    unread: false,
  },
  {
    sender: 'mBank',
    subject: 'Brakujące dokumenty · Joanna Wiśniewska',
    preview: 'Prosimy o uzupełnienie wyciągu z rachunku do 19 sierpnia.',
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
          <h2 id="mail-title" aria-label="Poczta e-mail zintegrowana z CRM.">
            <span aria-hidden="true">Poczta e-mail.</span>{{ ' ' }}
            <em aria-hidden="true">Zintegrowana z CRM.</em>
          </h2>
        </div>

        <div class="mail-heading__intro">
          <p class="mail-lead">Całą korespondencję masz tam, gdzie pracujesz: w widoku klienta i sprawy. Widzisz pełny kontekst, a agent AI przygotowuje propozycje odpowiedzi — bez przełączania się między CRM-em a skrzynką.</p>
          <p class="mail-heading__note">
            <Icon name="lucide:inbox" aria-hidden="true" />
            <span>Czytaj, wyszukuj, pisz i odpowiadaj bez opuszczania OpenExpert.</span>
          </p>
          <NuxtLink v-if="showProductLink" to="/poczta-dla-ekseprta" class="mail-product-link">
            Poznaj OpenExpert Mail
            <Icon name="lucide:arrow-right" aria-hidden="true" />
          </NuxtLink>
        </div>
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
                  <Icon name="lucide:link-2" aria-hidden="true" />
                  Sugerowane powiązanie
                </span>
                <strong>Anna Kowalska · Sprawa OE-142</strong>
              </div>

              <header class="mail-detail__heading">
                <div>
                  <p>Wiadomość z banku · 1 załącznik</p>
                  <h3>Pozytywna decyzja kredytowa</h3>
                </div>
                <span class="mail-detail__safe">
                  <Icon name="lucide:shield-check" aria-hidden="true" />
                  Bez obrazów śledzących
                </span>
              </header>

              <div class="mail-message">
                <header class="mail-message__sender">
                  <span class="mail-avatar" aria-hidden="true">PKO</span>
                  <span>
                    <strong>PKO Bank Polski</strong>
                    <small>decyzje.hipoteczne@pkobp.pl</small>
                  </span>
                  <time>dziś, 10:42</time>
                </header>

                <div class="mail-message__body">
                  <p>Dzień dobry,</p>
                  <p>informujemy, że dla wniosku Anny Kowalskiej, numer OE-142, wydano pozytywną decyzję kredytową. Decyzję oraz warunki uruchomienia kredytu przekazujemy w załączniku.</p>
                  <p>Z poważaniem<br>PKO Bank Polski</p>
                </div>

                <div class="mail-ai-suggestion">
                  <span class="mail-ai-suggestion__icon">
                    <Icon name="lucide:sparkles" aria-hidden="true" />
                  </span>
                  <span class="mail-ai-suggestion__copy">
                    <strong>Agent AI przygotował propozycję odpowiedzi</strong>
                    <small>Na podstawie tej wiadomości oraz kontekstu sprawy OE-142.</small>
                  </span>
                  <span class="mail-ai-suggestion__action">Przejrzyj szkic</span>
                </div>

                <footer class="mail-message__footer">
                  <span class="mail-attachment">
                    <Icon name="lucide:file-text" aria-hidden="true" />
                    decyzja_kredytowa_AK.pdf · 842 KB
                  </span>
                  <span class="mail-reply mail-reply--primary">
                    <Icon name="lucide:file-check-2" aria-hidden="true" />
                    Dodaj decyzję do sprawy
                    <Icon name="lucide:arrow-right" aria-hidden="true" />
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

      <ul class="mail-assurances" aria-label="Niezawodność i bezpieczeństwo OpenExpert Mail">
        <li v-for="assurance in mailAssurances" :key="assurance.title">
          <Icon :name="assurance.icon" aria-hidden="true" />
          <span>
            <strong>{{ assurance.title }}</strong>
            <small>{{ assurance.description }}</small>
          </span>
        </li>
      </ul>

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
  grid-template-columns: minmax(0, 1.3fr) minmax(390px, 0.7fr);
  align-items: end;
  gap: clamp(48px, 7vw, 108px);
  margin-bottom: 38px;
}

.mail-heading__copy {
  min-width: 0;
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
  max-width: 880px;
  font-size: clamp(58px, 6.5vw, 92px);
  font-variation-settings: 'opsz' 82, 'wght' 280;
  font-weight: 300;
  letter-spacing: -0.055em;
  line-height: 0.96;
}

.mail-heading h2 em {
  display: block;
  color: #b9e8d1;
  font-family: var(--font-serif);
  font-style: italic;
  font-variation-settings: 'opsz' 60, 'wght' 340;
  font-weight: 340;
}

.mail-heading__intro {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 24px;
  padding-bottom: 5px;
}

.mail-lead {
  color: #b2b2b2;
  font-size: 17px;
  line-height: 1.68;
}

.mail-heading__note {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid #2f5542;
  border-radius: 4px;
  background: #0d1b14;
  color: #b9dcca;
  padding: 12px 14px;
  font-size: 11px;
  line-height: 1.5;
}

.mail-heading__note > :deep(svg) {
  width: 17px;
  height: 17px;
  flex: 0 0 auto;
  color: #8fd8b8;
  stroke-width: 1.5;
}

.mail-product-link {
  display: inline-flex;
  width: fit-content;
  min-height: 46px;
  align-items: center;
  justify-content: center;
  gap: 11px;
  border: 1px solid #d8f4e6;
  border-radius: 4px;
  background: #b9e8d1;
  box-shadow: 0 5px 18px rgb(143 216 184 / 14%);
  color: #10231a;
  padding: 11px 17px;
  font-size: 13px;
  font-weight: 650;
  text-decoration: none;
  transition:
    background-color var(--transition-fast),
    border-color var(--transition-fast),
    transform var(--transition-fast);
}

.mail-product-link:hover {
  border-color: #effff7;
  background: #cef2df;
  transform: translateY(-1px);
}

.mail-product-link:focus-visible {
  outline-color: #b9e8d1;
  outline-offset: 4px;
}

.mail-product-link :deep(svg) {
  width: 16px;
  height: 16px;
  stroke-width: 1.7;
}

.mail-assurances {
  display: grid;
  overflow: hidden;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  margin-top: 20px;
  border: 1px solid #343434;
  border-radius: 6px;
  background: #343434;
  list-style: none;
}

.mail-assurances li {
  display: grid;
  min-width: 0;
  grid-template-columns: 31px minmax(0, 1fr);
  align-items: center;
  gap: 13px;
  background: #0d0d0d;
  padding: 18px 21px;
}

.mail-assurances li > :deep(svg) {
  width: 24px;
  height: 24px;
  color: #8fd8b8;
  stroke-width: 1.4;
}

.mail-assurances li > span {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.mail-assurances strong {
  color: #e8e8e8;
  font-size: 13px;
  font-weight: 580;
  line-height: 1.3;
}

.mail-assurances small {
  color: #858585;
  font-size: 10px;
  line-height: 1.45;
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

.mail-ai-suggestion {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) auto;
  align-items: center;
  gap: 11px;
  border-top: 1px solid #294437;
  background: #0d1812;
  padding: 12px 15px;
}

.mail-ai-suggestion__icon {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 1px solid #3a694f;
  border-radius: 50%;
  background: #152a1f;
  color: #a3e2c3;
}

.mail-ai-suggestion__icon :deep(svg) {
  width: 14px;
  height: 14px;
  stroke-width: 1.6;
}

.mail-ai-suggestion__copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.mail-ai-suggestion__copy strong {
  overflow: hidden;
  color: #dcebe2;
  font-size: 9.5px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mail-ai-suggestion__copy small {
  overflow: hidden;
  color: #779487;
  font-size: 8px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mail-ai-suggestion__action {
  flex: 0 0 auto;
  border: 1px solid #416e58;
  border-radius: 3px;
  color: #b9e8d1;
  padding: 6px 8px;
  font-size: 8.5px;
  white-space: nowrap;
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

.mail-reply--primary {
  max-width: 260px;
  min-height: 38px;
  justify-content: center;
  border-color: #d8f4e6;
  background: #b9e8d1;
  box-shadow:
    inset 0 -2px 0 rgb(16 35 26 / 16%),
    0 5px 14px rgb(0 0 0 / 28%);
  color: #10231a;
  padding: 9px 12px;
  font-size: 9px;
  font-weight: 650;
  line-height: 1.3;
  text-align: center;
  white-space: normal;
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

  .mail-heading__intro {
    max-width: 650px;
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

  .mail-heading__intro {
    gap: 18px;
    padding-bottom: 0;
  }

  .mail-product-link {
    width: 100%;
  }

  .mail-lead {
    font-size: 15px;
    line-height: 1.62;
  }

  .mail-assurances {
    grid-template-columns: 1fr;
  }

  .mail-assurances li {
    padding: 15px 17px;
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

  .mail-ai-suggestion {
    grid-template-columns: 30px minmax(0, 1fr);
    padding: 12px 13px;
  }

  .mail-ai-suggestion__copy strong,
  .mail-ai-suggestion__copy small {
    white-space: normal;
  }

  .mail-ai-suggestion__action {
    min-height: 36px;
    grid-column: 1 / -1;
    padding: 10px 12px;
    text-align: center;
  }

  .mail-message__footer {
    align-items: stretch;
    flex-direction: column;
  }

  .mail-reply {
    justify-content: center;
  }

  .mail-reply--primary {
    width: 100%;
    max-width: none;
    min-height: 44px;
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

  .mail-heading__note {
    align-items: flex-start;
    padding-right: 12px;
    padding-left: 12px;
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
