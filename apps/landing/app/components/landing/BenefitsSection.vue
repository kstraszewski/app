<script setup lang="ts">
const timingBenefits = [
  {
    index: '01',
    label: 'Akredytacja',
    icon: 'lucide:user-round-check',
    title: 'Gotowość do działania',
    description: 'Od kompletu wymaganych danych i dokumentów do zakończenia akredytacji.',
  },
  {
    index: '02',
    label: 'Wypłata',
    icon: 'lucide:landmark',
    title: 'Środki u Ciebie',
    description: 'Od spełnienia warunków rozliczenia do wypłaty wynagrodzenia.',
  },
]

const workflowBenefits = [
  {
    index: '03',
    label: 'Zintegrowana poczta',
    icon: 'lucide:mail',
    title: 'Korespondencja w CRM',
    description: 'Czytaj, wyszukuj i odpowiadaj bez przełączania narzędzi.',
    status: 'W jednym miejscu',
  },
  {
    index: '04',
    label: 'Status kredytu',
    icon: 'lucide:workflow',
    title: 'Etap i następny krok',
    description: 'System monitoruje dostępne statusy i pokazuje, co powinno wydarzyć się dalej.',
    status: 'Na bieżąco',
  },
]

const zeroBenefits = [
  {
    index: '01',
    title: 'Uzupełniania wniosków',
    ariaLabel: 'Zero ręcznego uzupełniania wniosków',
  },
  {
    index: '02',
    title: 'Raportowania statusów',
    ariaLabel: 'Zero ręcznego raportowania statusów',
  },
  {
    index: '03',
    title: 'Rozliczania spraw',
    ariaLabel: 'Zero ręcznego rozliczania spraw',
  },
]
</script>

<template>
  <section id="korzysci" class="benefits-section" aria-labelledby="benefits-title">
    <div class="benefits-inner">
      <header class="benefits-heading">
        <p class="benefits-label">Najważniejsze przewagi</p>
        <h2 id="benefits-title">
          Mniej czekania.
          <em>Mniej pilnowania.</em>
        </h2>
        <p>Akredytacja i wypłata mają jasny termin. Poczta i status kredytu są w jednej uporządkowanej sprawie.</p>
      </header>

      <div class="benefits-showcase">
        <article class="timing-panel" aria-labelledby="timing-panel-title">
          <div class="panel-kicker panel-kicker--dark">
            <span>01–02</span>
            <span>Przewidywalny czas</span>
          </div>

          <div class="timing-panel__intro">
            <p class="timing-metric" aria-label="Do 5 dni roboczych">
              <span>do</span>
              <strong>5</strong>
              <small>dni<br>roboczych</small>
            </p>
            <h3 id="timing-panel-title">Dwa kluczowe etapy, jeden jasny termin.</h3>
          </div>

          <ol class="timing-list">
            <li v-for="benefit in timingBenefits" :key="benefit.index" class="timing-benefit">
              <div class="timing-benefit__top">
                <span class="timing-benefit__index">{{ benefit.index }}</span>
                <Icon :name="benefit.icon" aria-hidden="true" />
              </div>
              <small>{{ benefit.label }}</small>
              <strong>{{ benefit.title }}</strong>
              <p>{{ benefit.description }}</p>
            </li>
          </ol>
        </article>

        <article class="workflow-panel" aria-labelledby="workflow-panel-title">
          <div class="panel-kicker panel-kicker--light">
            <span>03–04</span>
            <span class="workflow-live"><i aria-hidden="true" /> System aktywny</span>
          </div>

          <header class="workflow-panel__heading">
            <h3 id="workflow-panel-title">Poczta i status kredytu pracują razem.</h3>
            <p>Bez przełączania narzędzi i ręcznego przepisywania etapu sprawy.</p>
          </header>

          <ol class="workflow-list">
            <li v-for="benefit in workflowBenefits" :key="benefit.index" class="workflow-benefit">
              <Icon :name="benefit.icon" aria-hidden="true" />
              <span class="workflow-benefit__copy">
                <small>{{ benefit.index }} / {{ benefit.label }}</small>
                <strong>{{ benefit.title }}</strong>
                <span>{{ benefit.description }}</span>
              </span>
              <span class="workflow-benefit__status">{{ benefit.status }}</span>
            </li>
          </ol>
        </article>

        <article class="zero-panel" aria-labelledby="zero-panel-title">
          <header class="zero-panel__heading">
            <div class="panel-kicker panel-kicker--light">
              <span>05</span>
              <span>Automatyzacja operacji</span>
            </div>
            <h3 id="zero-panel-title">
              Trzy czynności.
              <em>Zero ręcznej pracy.</em>
            </h3>
          </header>

          <ul class="zero-list">
            <li
              v-for="benefit in zeroBenefits"
              :key="benefit.index"
              class="zero-benefit"
              :aria-label="benefit.ariaLabel"
            >
              <strong class="zero-benefit__metric" aria-hidden="true">0</strong>
              <span class="zero-benefit__copy">
                <small>{{ benefit.index }} / ręcznego</small>
                <strong>{{ benefit.title }}</strong>
              </span>
            </li>
          </ul>
        </article>
      </div>

      <p class="benefits-note">Terminy akredytacji i wypłaty liczone są od spełnienia warunków określonych w zasadach współpracy. Termin decyzji banku pozostaje po stronie banku.</p>
    </div>
  </section>
</template>

<style scoped>
.benefits-section {
  scroll-margin-top: 88px;
  border-top: 1px solid #292929;
  background: #030303;
  color: #f7f7f7;
  font-family: var(--font-sans);
}

.benefits-inner {
  width: min(1340px, calc(100% - 96px));
  margin: 0 auto;
  padding: 64px 0 38px;
}

.benefits-heading {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(340px, 0.7fr);
  align-items: end;
  gap: 30px 72px;
  margin-bottom: 34px;
}

.benefits-label {
  grid-column: 1 / -1;
  margin-bottom: -10px;
  color: #a8a8a8;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
  letter-spacing: 0.105em;
  line-height: 1.5;
  text-transform: uppercase;
}

.benefits-heading h2 {
  max-width: 760px;
  font-size: clamp(42px, 3.9vw, 58px);
  font-variation-settings: 'opsz' 58, 'wght' 300;
  font-weight: 300;
  letter-spacing: -0.045em;
  line-height: 1.04;
}

.benefits-heading h2 em {
  display: block;
  font-family: var(--font-serif);
  font-style: italic;
  font-variation-settings: 'opsz' 58, 'wght' 340;
  font-weight: 340;
}

.benefits-heading > p:last-child {
  max-width: 470px;
  color: #a8a8a8;
  font-size: 15px;
  line-height: 1.65;
}

.benefits-showcase {
  display: grid;
  overflow: hidden;
  grid-template-columns: minmax(0, 1.06fr) minmax(0, 0.94fr);
  border: 1px solid #333;
  border-radius: 6px;
}

.timing-panel,
.workflow-panel {
  min-width: 0;
  padding: 34px 36px 32px;
}

.timing-panel {
  background: #f1f1ed;
  color: #111;
}

.workflow-panel {
  border-left: 1px solid #333;
  background: #080808;
  color: #f7f7f7;
}

.panel-kicker {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 9px;
  letter-spacing: 0.09em;
  line-height: 1.4;
  text-transform: uppercase;
}

.panel-kicker--dark {
  color: #656565;
}

.panel-kicker--light {
  color: #8e8e8e;
}

.timing-panel__intro {
  display: grid;
  grid-template-columns: minmax(220px, 0.8fr) minmax(230px, 1.2fr);
  align-items: end;
  gap: 34px;
  margin: 36px 0 38px;
}

.timing-metric {
  display: flex;
  align-items: flex-end;
  color: #111;
  white-space: nowrap;
}

.timing-metric > span {
  align-self: flex-start;
  margin-top: 15px;
  margin-right: 6px;
  color: #555;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.timing-metric strong {
  font-size: clamp(84px, 7.8vw, 116px);
  font-variation-settings: 'opsz' 96, 'wght' 280;
  font-weight: 280;
  letter-spacing: -0.075em;
  line-height: 0.72;
}

.timing-metric small {
  margin-left: 14px;
  padding-bottom: 2px;
  color: #565656;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.08em;
  line-height: 1.35;
  text-transform: uppercase;
}

.timing-panel__intro h3,
.workflow-panel__heading h3 {
  font-weight: 500;
  letter-spacing: -0.03em;
  line-height: 1.18;
}

.timing-panel__intro h3 {
  max-width: 310px;
  font-size: clamp(24px, 2.1vw, 31px);
}

.timing-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border-top: 1px solid #c8c8c3;
  border-bottom: 1px solid #c8c8c3;
  list-style: none;
}

.timing-benefit {
  min-width: 0;
  padding: 20px 24px 20px 0;
}

.timing-benefit + .timing-benefit {
  border-left: 1px solid #c8c8c3;
  padding-right: 0;
  padding-left: 24px;
}

.timing-benefit__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 21px;
  color: #4d4d4d;
}

.timing-benefit__top :deep(svg) {
  width: 21px;
  height: 21px;
  stroke-width: 1.45;
}

.timing-benefit__index,
.timing-benefit > small,
.workflow-benefit__copy small {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.timing-benefit__index {
  font-size: 9px;
}

.timing-benefit > small {
  display: block;
  margin-bottom: 6px;
  color: #656565;
  font-size: 9px;
}

.timing-benefit > strong {
  display: block;
  margin-bottom: 7px;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.015em;
}

.timing-benefit > p {
  max-width: 270px;
  color: #5b5b5b;
  font-size: 12.5px;
  line-height: 1.55;
}

.workflow-live {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.workflow-live i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #48b986;
}

.workflow-panel__heading {
  margin: 42px 0 29px;
}

.workflow-panel__heading h3 {
  max-width: 480px;
  margin-bottom: 12px;
  font-size: clamp(26px, 2.35vw, 34px);
}

.workflow-panel__heading p {
  max-width: 430px;
  color: #979797;
  font-size: 13px;
  line-height: 1.6;
}

.workflow-list {
  border-top: 1px solid #353535;
  border-bottom: 1px solid #353535;
  list-style: none;
}

.workflow-benefit {
  display: grid;
  min-width: 0;
  grid-template-columns: 26px minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  padding: 17px 0;
}

.workflow-benefit + .workflow-benefit {
  border-top: 1px solid #353535;
}

.workflow-benefit > :deep(svg) {
  width: 22px;
  height: 22px;
  color: #e9e9e9;
  stroke-width: 1.4;
}

.workflow-benefit__copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.workflow-benefit__copy small {
  color: #777;
  font-size: 8px;
}

.workflow-benefit__copy strong {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.workflow-benefit__copy > span {
  color: #8f8f8f;
  font-size: 11.5px;
  line-height: 1.5;
}

.workflow-benefit__status {
  color: #a8a8a8;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 8px;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  white-space: nowrap;
}

.zero-panel {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: minmax(260px, 0.72fr) minmax(0, 2.28fr);
  align-items: stretch;
  gap: 36px;
  border-top: 1px solid #333;
  background: #121212;
  padding: 28px 36px;
}

.zero-panel__heading {
  border-right: 1px solid #393939;
  padding-right: 36px;
}

.zero-panel__heading h3 {
  margin-top: 20px;
  font-size: clamp(23px, 2vw, 29px);
  font-weight: 450;
  letter-spacing: -0.03em;
  line-height: 1.08;
}

.zero-panel__heading h3 em {
  display: block;
  font-family: var(--font-serif);
  font-style: italic;
  font-variation-settings: 'opsz' 36, 'wght' 340;
  font-weight: 340;
}

.zero-list {
  display: grid;
  min-width: 0;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  list-style: none;
}

.zero-benefit {
  display: grid;
  min-width: 0;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: end;
  gap: 14px;
  border-left: 1px solid #393939;
  padding: 9px 22px;
}

.zero-benefit:first-child {
  border-left: 0;
  padding-left: 0;
}

.zero-benefit:last-child {
  padding-right: 0;
}

.zero-benefit__metric {
  font-size: clamp(48px, 4.3vw, 62px);
  font-variation-settings: 'opsz' 58, 'wght' 300;
  font-weight: 300;
  letter-spacing: -0.065em;
  line-height: 0.76;
}

.zero-benefit__copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 5px;
}

.zero-benefit__copy small {
  color: #777;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 8px;
  letter-spacing: 0.075em;
  line-height: 1.4;
  text-transform: uppercase;
}

.zero-benefit__copy > strong {
  max-width: 150px;
  font-size: 15px;
  font-weight: 550;
  letter-spacing: -0.015em;
  line-height: 1.25;
}

.benefits-note {
  padding-top: 14px;
  color: #777;
  font-size: 11px;
  line-height: 1.55;
}

@media (max-width: 1099px) {
  .benefits-inner {
    width: min(760px, calc(100% - 64px));
  }

  .benefits-heading {
    grid-template-columns: 1fr;
    gap: 17px;
  }

  .benefits-label {
    grid-column: auto;
    margin-bottom: 0;
  }

  .benefits-heading > p:last-child {
    max-width: 580px;
  }

  .timing-panel,
  .workflow-panel {
    padding: 28px;
  }

  .timing-panel__intro {
    grid-template-columns: 1fr;
    gap: 19px;
    margin: 34px 0 30px;
  }

  .timing-metric strong {
    font-size: clamp(82px, 10vw, 98px);
  }

  .timing-list {
    grid-template-columns: 1fr;
  }

  .timing-benefit {
    padding: 17px 0;
  }

  .timing-benefit + .timing-benefit {
    border-top: 1px solid #c8c8c3;
    border-left: 0;
    padding: 17px 0;
  }

  .timing-benefit__top {
    margin-bottom: 14px;
  }

  .workflow-panel__heading {
    margin-top: 34px;
  }

  .workflow-benefit {
    grid-template-columns: 24px minmax(0, 1fr);
    gap: 13px;
  }

  .workflow-benefit__status {
    display: none;
  }

  .zero-panel {
    grid-template-columns: 1fr;
    gap: 24px;
    padding: 26px 28px;
  }

  .zero-panel__heading {
    border-right: 0;
    padding-right: 0;
  }

  .zero-panel__heading h3 {
    margin-top: 17px;
    font-size: 27px;
  }

  .zero-benefit {
    padding-right: 16px;
    padding-left: 16px;
  }
}

@media (max-width: 767px) {
  .benefits-inner {
    width: min(100% - 40px, 620px);
    padding: 58px 0 30px;
  }

  .benefits-heading {
    margin-bottom: 30px;
  }

  .benefits-heading h2 {
    font-size: clamp(37px, 10.5vw, 46px);
  }

  .benefits-heading > p:last-child {
    font-size: 14.5px;
  }

  .benefits-showcase {
    grid-template-columns: 1fr;
  }

  .timing-panel,
  .workflow-panel {
    padding: 25px 22px;
  }

  .workflow-panel {
    border-top: 1px solid #333;
    border-left: 0;
  }

  .zero-panel {
    gap: 22px;
    padding: 25px 22px;
  }

  .zero-list {
    grid-template-columns: 1fr;
    border-top: 1px solid #393939;
    border-bottom: 1px solid #393939;
  }

  .zero-benefit,
  .zero-benefit:first-child,
  .zero-benefit:last-child {
    border-left: 0;
    padding: 16px 0;
  }

  .zero-benefit + .zero-benefit {
    border-top: 1px solid #393939;
  }

  .zero-benefit__metric {
    width: 52px;
    font-size: 52px;
  }

  .zero-benefit__copy > strong {
    max-width: none;
    font-size: 15.5px;
  }

  .timing-panel__intro h3 {
    font-size: 24px;
  }

  .workflow-panel__heading h3 {
    font-size: 27px;
  }
}

@media (max-width: 359px) {
  .benefits-inner {
    width: calc(100% - 32px);
  }

  .timing-panel,
  .workflow-panel,
  .zero-panel {
    padding-right: 19px;
    padding-left: 19px;
  }
}
</style>
