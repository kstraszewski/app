<script setup lang="ts">
const fillMethods = [
  {
    icon: 'lucide:file-pen-line',
    label: 'Aktywny PDF',
    title: 'Edytowalne pola banku',
    description: 'Dane trafiają bezpośrednio do pól formularza, który nadal można sprawdzić i poprawić.',
  },
  {
    icon: 'lucide:scan-text',
    label: 'PDF z nakładką',
    title: 'Formularz bez aktywnych pól',
    description: 'OpenExpert umieszcza dane w odpowiednich miejscach oficjalnego dokumentu bankowego.',
  },
  {
    icon: 'lucide:sheet',
    label: 'Arkusz XLSX',
    title: 'Kosztorys inwestycji',
    description: 'System zachowuje strukturę arkusza, komórki i format wymagany w procesie bankowym.',
  },
]

const applications = [
  { bank: 'PKO BP', method: 'Aktywny PDF', state: 'Komplet gotowy', tone: 'ready' },
  { bank: 'Erste', method: 'PDF z nakładką', state: 'Komplet gotowy', tone: 'ready' },
  { bank: 'Pekao', method: 'PDF + XLSX', state: 'Do weryfikacji', tone: 'review' },
]

const packageItems = [
  { icon: 'lucide:badge-check', title: 'Dane klienta', detail: 'Jedno źródło · zsynchronizowane', state: 'Gotowe' },
  { icon: 'lucide:file-pen-line', title: 'Formularze bankowe', detail: 'PDF aktywny i PDF z nakładką', state: 'Gotowe' },
  { icon: 'lucide:sheet', title: 'Kosztorys inwestycji', detail: 'Arkusz XLSX', state: 'Gotowe' },
  { icon: 'lucide:paperclip', title: 'Załączniki klienta', detail: 'Dokumenty dobrane z checklisty', state: 'Sprawdź' },
]

const featurePoints = [
  {
    index: '01',
    icon: 'lucide:database',
    title: 'Jedno źródło danych klienta',
    description: 'Dane z karty klienta, kalkulacji i formularza są używane ponownie we wszystkich wybranych bankach.',
  },
  {
    index: '02',
    icon: 'lucide:list-checks',
    title: 'Pełne pokrycie skonfigurowanej ścieżki',
    description: 'Każdy wymagany formularz, załącznik, podpis i krok ręczny ma własny status — bez ukrytych braków na końcu.',
  },
  {
    index: '03',
    icon: 'lucide:user-round-cog',
    title: 'Klient uzupełnia dane w swoim panelu',
    description: 'Udostępniasz pytania i dokumenty klientowi, a odpowiedzi wracają do tej samej sprawy eksperta.',
  },
]
</script>

<template>
  <section id="multiwniosek" class="multiform-section" aria-labelledby="multiform-title">
    <div class="multiform-inner">
      <header class="multiform-heading">
        <p class="multiform-label">Multiwniosek AI</p>
        <h2 id="multiform-title">
          Uzupełniasz raz.
          <em>Składasz do wielu banków.</em>
        </h2>
        <p>Jeden wywiad zasila formularze, checklisty i paczki dokumentów dla wszystkich wybranych banków. Bez przepisywania tych samych danych i bez osobnych folderów poza sprawą.</p>
      </header>

      <dl class="multiform-facts" aria-label="Najważniejsze możliwości Multiwniosku">
        <div>
          <dt>1</dt>
          <dd>spójne źródło danych</dd>
        </div>
        <div>
          <dt>0×</dt>
          <dd>przepisywania danych</dd>
        </div>
        <div>
          <dt>PDF + XLSX</dt>
          <dd>różne metody uzupełniania</dd>
        </div>
        <div>
          <dt>100%</dt>
          <dd>pokrycia konfiguracji</dd>
        </div>
      </dl>

      <div class="multiform-showcase">
        <article class="multiform-preview" aria-label="Przykładowa sprawa z trzema wnioskami bankowymi">
          <header class="preview-bar">
            <div>
              <span class="preview-bar__eyebrow">Sprawa OE-2048</span>
              <strong>Zakup mieszkania · jeden wnioskodawca</strong>
            </div>
            <span class="preview-status"><i aria-hidden="true" /> Dane zsynchronizowane</span>
          </header>

          <div class="preview-workspace">
            <aside class="application-list" aria-label="Wnioski bankowe">
              <div class="application-list__heading">
                <span>Wnioski</span>
                <strong>Wybrane</strong>
              </div>

              <ol>
                <li
                  v-for="(application, index) in applications"
                  :key="application.bank"
                  :class="{ 'is-active': index === 1 }"
                >
                  <span class="application-icon" aria-hidden="true"><Icon name="lucide:landmark" /></span>
                  <span class="application-copy">
                    <strong>{{ application.bank }}</strong>
                    <small>{{ application.method }}</small>
                    <em :class="`is-${application.tone}`">{{ application.state }}</em>
                  </span>
                  <Icon name="lucide:chevron-right" aria-hidden="true" />
                </li>
              </ol>

              <div class="client-panel-note">
                <Icon name="lucide:user-round-check" aria-hidden="true" />
                <span>
                  <small>Panel klienta</small>
                  <strong>4 odpowiedzi zapisane</strong>
                </span>
              </div>
            </aside>

            <div class="package-view">
              <header class="package-view__heading">
                <div>
                  <span>Erste · komplet dokumentów</span>
                  <h3>Gotowe do weryfikacji eksperta</h3>
                </div>
                <span class="package-score">100%</span>
              </header>

              <div class="package-progress" role="progressbar" aria-label="Kompletność paczki 100%" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100">
                <span />
              </div>

              <ul class="package-list">
                <li v-for="item in packageItems" :key="item.title">
                  <span class="package-list__icon" aria-hidden="true"><Icon :name="item.icon" /></span>
                  <span class="package-list__copy">
                    <strong>{{ item.title }}</strong>
                    <small>{{ item.detail }}</small>
                  </span>
                  <span :class="{ 'needs-review': item.state === 'Sprawdź' }">{{ item.state }}</span>
                </li>
              </ul>

              <footer class="package-footer">
                <span><Icon name="lucide:folder-tree" aria-hidden="true" /> Osobny folder dla każdego banku</span>
                <strong><Icon name="lucide:download" aria-hidden="true" /> Pobierz paczkę ZIP</strong>
              </footer>
            </div>
          </div>
        </article>

        <div class="multiform-copy">
          <ol class="multiform-points">
            <li v-for="point in featurePoints" :key="point.index">
              <span class="multiform-point__index">{{ point.index }}</span>
              <span class="multiform-point__icon" aria-hidden="true"><Icon :name="point.icon" /></span>
              <div>
                <h3>{{ point.title }}</h3>
                <p>{{ point.description }}</p>
              </div>
            </li>
          </ol>

          <aside class="integration-note">
            <span class="integration-note__icon" aria-hidden="true"><Icon name="lucide:plug-zap" /></span>
            <div>
              <span class="integration-note__label">Kolejny krok · planowane</span>
              <h3>Formularze internetowe i integracje API banków</h3>
              <p>Metoda uzupełniania jest gotowa na kolejne kanały — od formularza na stronie banku po bezpośrednią integrację systemową.</p>
            </div>
          </aside>
        </div>
      </div>

      <div class="fill-methods" aria-label="Obsługiwane metody uzupełniania dokumentów">
        <article v-for="method in fillMethods" :key="method.label">
          <div class="fill-method__top">
            <span aria-hidden="true"><Icon :name="method.icon" /></span>
            <small>{{ method.label }}</small>
          </div>
          <h3>{{ method.title }}</h3>
          <p>{{ method.description }}</p>
        </article>
      </div>

      <p class="multiform-note">Pełne pokrycie dotyczy dokumentów i reguł skonfigurowanych dla obsługiwanych produktów bankowych. Elementy wymagające podpisu, danych pracodawcy lub czynności banku są wyraźnie oznaczane jako ręczne.</p>
    </div>
  </section>
</template>

<style scoped>
.multiform-section {
  scroll-margin-top: 88px;
  border-top: 1px solid #cececa;
  border-bottom: 1px solid #cececa;
  background: #f7f7f5;
  color: #111;
  font-family: var(--font-sans);
}

.multiform-inner {
  width: min(1340px, calc(100% - 96px));
  margin: 0 auto;
  padding: 104px 0 88px;
}

.multiform-heading {
  display: grid;
  grid-template-columns: minmax(0, 1.18fr) minmax(360px, 0.82fr);
  align-items: end;
  gap: 28px 80px;
  margin-bottom: 42px;
}

.multiform-label {
  grid-column: 1 / -1;
  margin-bottom: -8px;
  color: #555;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
  letter-spacing: 0.105em;
  line-height: 1.5;
  text-transform: uppercase;
}

.multiform-heading h2 {
  max-width: 830px;
  font-size: clamp(44px, 4.35vw, 64px);
  font-variation-settings: 'opsz' 62, 'wght' 300;
  font-weight: 300;
  letter-spacing: -0.05em;
  line-height: 1.04;
}

.multiform-heading h2 em {
  display: block;
  font-family: var(--font-serif);
  font-style: italic;
  font-variation-settings: 'opsz' 62, 'wght' 340;
  font-weight: 340;
}

.multiform-heading > p:last-child {
  max-width: 520px;
  color: #505050;
  font-size: 17px;
  line-height: 1.7;
}

.multiform-facts {
  display: grid;
  grid-template-columns: 0.7fr 0.9fr 1.2fr 1fr;
  border-top: 1px solid #c9c9c4;
  border-bottom: 1px solid #c9c9c4;
  margin-bottom: 42px;
}

.multiform-facts > div {
  min-width: 0;
  padding: 23px 28px;
}

.multiform-facts > div + div {
  border-left: 1px solid #c9c9c4;
}

.multiform-facts dt {
  margin-bottom: 5px;
  font-size: clamp(27px, 2.5vw, 36px);
  font-variation-settings: 'opsz' 36, 'wght' 380;
  font-weight: 380;
  letter-spacing: -0.05em;
  line-height: 1;
}

.multiform-facts dd {
  color: #5e5e5e;
  font-size: 11px;
  line-height: 1.45;
}

.multiform-showcase {
  display: grid;
  grid-template-columns: minmax(620px, 1.15fr) minmax(360px, 0.85fr);
  align-items: start;
  gap: clamp(48px, 6vw, 84px);
}

.multiform-preview {
  min-width: 0;
  overflow: hidden;
  border: 1px solid #303030;
  border-radius: 6px;
  background: #090909;
  color: #f7f7f7;
  box-shadow: 0 22px 54px rgba(17, 17, 17, 0.14);
}

.preview-bar {
  display: flex;
  min-height: 64px;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  border-bottom: 1px solid #303030;
  padding: 13px 20px;
}

.preview-bar > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.preview-bar__eyebrow,
.preview-bar strong,
.preview-status,
.application-list__heading,
.application-copy small,
.application-copy em,
.client-panel-note small,
.package-view__heading span,
.package-list small,
.package-list > li > span:last-child,
.package-footer,
.integration-note__label,
.fill-method__top small {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.preview-bar__eyebrow {
  color: #777;
  font-size: 8px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.preview-bar strong {
  overflow: hidden;
  font-size: 11px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-status {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  color: #a7a7a7;
  font-size: 8px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.preview-status i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #48b986;
  box-shadow: 0 0 0 4px rgba(72, 185, 134, 0.1);
}

.preview-workspace {
  display: grid;
  grid-template-columns: 214px minmax(0, 1fr);
  min-height: 510px;
}

.application-list {
  display: flex;
  min-width: 0;
  border-right: 1px solid #303030;
  background: #101010;
  padding: 18px 14px 15px;
  flex-direction: column;
}

.application-list__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  padding: 0 7px;
  color: #777;
  font-size: 8px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.application-list__heading strong {
  color: #aaa;
  font-weight: 500;
}

.application-list ol {
  display: flex;
  flex-direction: column;
  gap: 5px;
  list-style: none;
}

.application-list li {
  display: grid;
  min-width: 0;
  grid-template-columns: 32px minmax(0, 1fr) 14px;
  align-items: center;
  gap: 10px;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 11px 9px;
  color: #ddd;
}

.application-list li.is-active {
  border-color: #c9c9c4;
  background: #f1f1ed;
  color: #111;
}

.application-icon {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border: 1px solid #444;
  border-radius: 4px;
  background: #171717;
}

.application-list li.is-active .application-icon {
  border-color: #c1c1bc;
  background: #fff;
}

.application-icon :deep(svg) {
  width: 16px;
  height: 16px;
  stroke-width: 1.5;
}

.application-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.application-copy strong {
  overflow: hidden;
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.application-copy small {
  overflow: hidden;
  color: #777;
  font-size: 7px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.application-copy em {
  color: #999;
  font-size: 7px;
  font-style: normal;
}

.application-copy em.is-ready {
  color: #48b986;
}

.application-copy em.is-review {
  color: #d9ad52;
}

.application-list li > :deep(svg) {
  width: 14px;
  height: 14px;
  color: #666;
}

.client-panel-note {
  display: grid;
  grid-template-columns: 27px minmax(0, 1fr);
  align-items: center;
  gap: 9px;
  border-top: 1px solid #303030;
  margin-top: auto;
  padding: 15px 7px 0;
}

.client-panel-note > :deep(svg) {
  width: 19px;
  height: 19px;
  color: #aaa;
  stroke-width: 1.5;
}

.client-panel-note span {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.client-panel-note small {
  color: #777;
  font-size: 7px;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}

.client-panel-note strong {
  font-size: 9px;
  font-weight: 500;
}

.package-view {
  min-width: 0;
  padding: 24px 24px 20px;
}

.package-view__heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
}

.package-view__heading > div {
  min-width: 0;
}

.package-view__heading span:not(.package-score) {
  display: block;
  margin-bottom: 8px;
  color: #777;
  font-size: 7.5px;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}

.package-view__heading h3 {
  font-size: clamp(19px, 2vw, 25px);
  font-weight: 500;
  letter-spacing: -0.035em;
  line-height: 1.14;
}

.package-score {
  color: #48b986;
  font-size: 20px;
  font-weight: 500;
}

.package-progress {
  height: 3px;
  overflow: hidden;
  border-radius: 999px;
  margin: 18px 0 22px;
  background: #272727;
}

.package-progress span {
  display: block;
  width: 100%;
  height: 100%;
  background: #48b986;
}

.package-list {
  border-top: 1px solid #303030;
  border-bottom: 1px solid #303030;
  list-style: none;
}

.package-list li {
  display: grid;
  min-width: 0;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  align-items: center;
  gap: 13px;
  padding: 15px 2px;
}

.package-list li + li {
  border-top: 1px solid #303030;
}

.package-list__icon {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 4px;
  background: #171717;
  color: #ddd;
}

.package-list__icon :deep(svg) {
  width: 17px;
  height: 17px;
  stroke-width: 1.45;
}

.package-list__copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.package-list__copy strong {
  font-size: 11.5px;
  font-weight: 600;
}

.package-list small {
  overflow: hidden;
  color: #777;
  font-size: 7.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.package-list > li > span:last-child {
  color: #48b986;
  font-size: 7px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.package-list > li > span.needs-review {
  color: #d9ad52;
}

.package-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  margin-top: 18px;
  color: #777;
  font-size: 7.5px;
}

.package-footer span,
.package-footer strong {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.package-footer strong {
  min-height: 34px;
  border: 1px solid #555;
  border-radius: 4px;
  padding: 7px 11px;
  color: #eee;
  font-weight: 500;
}

.package-footer :deep(svg) {
  width: 13px;
  height: 13px;
  stroke-width: 1.5;
}

.multiform-copy {
  min-width: 0;
}

.multiform-points {
  border-top: 1px solid #c9c9c4;
  list-style: none;
}

.multiform-points li {
  display: grid;
  grid-template-columns: 28px 46px minmax(0, 1fr);
  align-items: start;
  gap: 15px;
  border-bottom: 1px solid #c9c9c4;
  padding: 23px 0;
}

.multiform-point__index {
  padding-top: 13px;
  color: #777;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 9px;
}

.multiform-point__icon {
  display: grid;
  width: 46px;
  height: 46px;
  place-items: center;
  border: 1px solid #aaa;
  border-radius: 4px;
}

.multiform-point__icon :deep(svg) {
  width: 21px;
  height: 21px;
  stroke-width: 1.4;
}

.multiform-points h3 {
  margin: 2px 0 7px;
  font-size: 18px;
  font-weight: 550;
  letter-spacing: -0.025em;
  line-height: 1.22;
}

.multiform-points p {
  max-width: 430px;
  color: #555;
  font-size: 13px;
  line-height: 1.6;
}

.integration-note {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  gap: 17px;
  border: 1px solid #c8c8c3;
  border-radius: 5px;
  margin-top: 24px;
  background: #ecece8;
  padding: 21px;
}

.integration-note__icon {
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  border: 1px solid #aaa;
  border-radius: 4px;
  background: #f7f7f5;
}

.integration-note__icon :deep(svg) {
  width: 21px;
  height: 21px;
  stroke-width: 1.4;
}

.integration-note__label {
  display: block;
  margin-bottom: 7px;
  color: #696969;
  font-size: 8px;
  letter-spacing: 0.075em;
  text-transform: uppercase;
}

.integration-note h3 {
  margin-bottom: 7px;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.3;
}

.integration-note p {
  color: #5d5d5d;
  font-size: 12px;
  line-height: 1.55;
}

.fill-methods {
  display: grid;
  overflow: hidden;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border: 1px solid #c9c9c4;
  border-radius: 6px;
  margin-top: 42px;
}

.fill-methods article {
  min-width: 0;
  padding: 25px 27px 27px;
}

.fill-methods article + article {
  border-left: 1px solid #c9c9c4;
}

.fill-method__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 25px;
}

.fill-method__top > span {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border: 1px solid #aaa;
  border-radius: 4px;
}

.fill-method__top :deep(svg) {
  width: 21px;
  height: 21px;
  stroke-width: 1.4;
}

.fill-method__top small {
  color: #666;
  font-size: 8px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.fill-methods h3 {
  margin-bottom: 8px;
  font-size: 18px;
  font-weight: 550;
  letter-spacing: -0.025em;
}

.fill-methods p {
  max-width: 350px;
  color: #575757;
  font-size: 13px;
  line-height: 1.6;
}

.multiform-note {
  max-width: 920px;
  margin-top: 15px;
  color: #777;
  font-size: 10.5px;
  line-height: 1.55;
}

@media (max-width: 1099px) {
  .multiform-inner {
    width: min(760px, calc(100% - 64px));
    padding: 88px 0 78px;
  }

  .multiform-heading,
  .multiform-showcase {
    grid-template-columns: 1fr;
  }

  .multiform-heading {
    gap: 19px;
  }

  .multiform-label {
    grid-column: auto;
    margin-bottom: 0;
  }

  .multiform-heading > p:last-child {
    max-width: 620px;
  }

  .multiform-facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .multiform-facts > div:nth-child(3) {
    border-top: 1px solid #c9c9c4;
    border-left: 0;
  }

  .multiform-facts > div:nth-child(4) {
    border-top: 1px solid #c9c9c4;
  }

  .multiform-copy {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(270px, 0.72fr);
    gap: 32px;
  }

  .integration-note {
    align-self: start;
    grid-template-columns: 1fr;
    margin-top: 0;
  }
}

@media (max-width: 767px) {
  .multiform-inner {
    width: min(100% - 40px, 620px);
    padding: 68px 0 60px;
  }

  .multiform-heading {
    margin-bottom: 34px;
  }

  .multiform-heading h2 {
    font-size: clamp(37px, 10.3vw, 48px);
  }

  .multiform-heading > p:last-child {
    font-size: 15px;
  }

  .multiform-facts {
    margin-bottom: 32px;
  }

  .multiform-facts > div {
    padding: 18px 16px;
  }

  .multiform-facts dt {
    font-size: 27px;
  }

  .preview-bar {
    align-items: flex-start;
    flex-direction: column;
    gap: 9px;
    padding: 15px 17px;
  }

  .preview-workspace {
    grid-template-columns: 1fr;
  }

  .application-list {
    border-right: 0;
    border-bottom: 1px solid #303030;
    padding: 15px;
  }

  .application-list ol {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .application-list li {
    grid-template-columns: 1fr;
    gap: 7px;
    padding: 10px;
  }

  .application-list li > :deep(svg) {
    display: none;
  }

  .application-icon {
    width: 30px;
    height: 30px;
  }

  .application-copy small {
    white-space: normal;
  }

  .client-panel-note {
    display: none;
  }

  .package-view {
    padding: 22px 18px 18px;
  }

  .package-view__heading {
    align-items: flex-start;
  }

  .package-view__heading h3 {
    font-size: 21px;
  }

  .package-footer {
    align-items: flex-start;
    flex-direction: column;
  }

  .package-footer strong {
    width: 100%;
    justify-content: center;
  }

  .multiform-copy {
    grid-template-columns: 1fr;
  }

  .integration-note {
    grid-template-columns: 44px minmax(0, 1fr);
  }

  .fill-methods {
    grid-template-columns: 1fr;
  }

  .fill-methods article + article {
    border-top: 1px solid #c9c9c4;
    border-left: 0;
  }
}

@media (max-width: 359px) {
  .multiform-inner {
    width: calc(100% - 32px);
  }

  .multiform-facts {
    grid-template-columns: 1fr;
  }

  .multiform-facts > div + div {
    border-top: 1px solid #c9c9c4;
    border-left: 0;
  }

  .application-list ol {
    grid-template-columns: 1fr;
  }

  .application-list li {
    grid-template-columns: 30px minmax(0, 1fr);
  }

  .application-list li > :deep(svg) {
    display: none;
  }

  .integration-note {
    grid-template-columns: 1fr;
  }
}
</style>
