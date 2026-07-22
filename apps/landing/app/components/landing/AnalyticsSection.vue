<script setup lang="ts">
const opportunities = [
  {
    id: 'OE-142',
    client: 'Marta Kowalska',
    product: 'Kredyt hipoteczny',
    chance: 87,
    level: 'Wysoka szansa',
    tone: 'high',
    reason: 'Komplet danych i zaakceptowany wariant oferty.',
    nextStep: 'Potwierdź komplet dokumentów.',
  },
  {
    id: 'OE-137',
    client: 'Piotr Zieliński',
    product: 'Ubezpieczenie',
    chance: 71,
    level: 'Dobra szansa',
    tone: 'medium',
    reason: 'Klient wrócił do oferty i otworzył ją ponownie.',
    nextStep: 'Zaplanuj rozmowę na dziś.',
  },
  {
    id: 'OE-128',
    client: 'Anna Lewandowska',
    product: 'Nieruchomość',
    chance: 54,
    level: 'Do rozwinięcia',
    tone: 'low',
    reason: 'Brakuje potwierdzonego źródła finansowania.',
    nextStep: 'Uzupełnij dane finansowe.',
  },
]
</script>

<template>
  <section id="analityka" class="analytics-section" aria-labelledby="analytics-title">
    <div class="analytics-inner">
      <article class="analytics-preview" aria-label="Przykładowa analityka szans sprzedażowych">
        <header class="analytics-preview__header">
          <div>
            <p>Przykładowy pipeline</p>
            <h3>Szanse sprzedażowe</h3>
          </div>
          <span class="analytics-live"><span aria-hidden="true" /> Aktualizacja na żywo</span>
        </header>

        <div class="analytics-summary" aria-label="Podsumowanie pipeline’u">
          <span>
            <strong>12</strong>
            <small>otwartych spraw</small>
          </span>
          <span>
            <strong>4</strong>
            <small>wysokie szanse</small>
          </span>
          <span>
            <strong>7</strong>
            <small>akcji na dziś</small>
          </span>
        </div>

        <ol class="opportunity-list">
          <li v-for="opportunity in opportunities" :key="opportunity.id" class="opportunity-row">
            <div class="opportunity-row__heading">
              <div>
                <span>{{ opportunity.id }} · {{ opportunity.product }}</span>
                <h4>{{ opportunity.client }}</h4>
              </div>
              <strong :class="`is-${opportunity.tone}`">{{ opportunity.chance }}%</strong>
            </div>

            <div
              class="opportunity-progress"
              role="progressbar"
              :aria-label="`${opportunity.level}: ${opportunity.chance}%`"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-valuenow="opportunity.chance"
            >
              <span :class="`is-${opportunity.tone}`" :style="{ width: `${opportunity.chance}%` }" />
            </div>

            <div class="opportunity-row__details">
              <p><span>Dlaczego</span>{{ opportunity.reason }}</p>
              <p><span>Następny krok</span><strong>{{ opportunity.nextStep }}</strong></p>
            </div>
          </li>
        </ol>
      </article>

      <div class="analytics-copy">
        <p class="analytics-label">Zaawansowana analityka spraw</p>
        <h2 id="analytics-title">Wiesz, gdzie jest szansa —<br><em>i co zrobić dalej.</em></h2>
        <p class="analytics-lead">OpenExpert porządkuje sprawy według potencjału sprzedażowego, wyjaśnia każdą ocenę i sugeruje kolejny ruch. Ty ustalasz priorytety i podejmujesz decyzję.</p>

        <ol class="analytics-points">
          <li>
            <span>01</span>
            <div>
              <h3>Najlepsze szanse na wierzchu</h3>
              <p>Od razu widzisz sprawy o największym potencjale sprzedażowym.</p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <h3>Ocena, którą rozumiesz</h3>
              <p>Każdy wynik pokazuje dane i sygnały, które wpłynęły na potencjał sprawy.</p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <h3>Następny krok bez zgadywania</h3>
              <p>System sugeruje konkretną akcję: kontakt, uzupełnienie danych albo przygotowanie oferty.</p>
            </div>
          </li>
        </ol>
      </div>
    </div>
  </section>
</template>

<style scoped>
.analytics-section {
  scroll-margin-top: 88px;
  border-top: 1px solid #cfcfca;
  background: #ecece8;
  color: #111;
  font-family: var(--font-sans);
}

.analytics-inner {
  display: grid;
  width: min(1340px, calc(100% - 96px));
  grid-template-columns: minmax(540px, 1.08fr) minmax(0, 0.92fr);
  align-items: center;
  gap: clamp(64px, 8vw, 126px);
  margin: 0 auto;
  padding: 104px 0 112px;
}

.analytics-preview {
  min-width: 0;
  border: 1px solid #c7c7c2;
  border-radius: 6px;
  background: #f8f8f6;
  padding: clamp(24px, 3vw, 36px);
}

.analytics-preview__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 22px;
}

.analytics-preview__header p {
  margin-bottom: 7px;
  color: #777;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 9px;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.analytics-preview__header h3 {
  font-size: clamp(21px, 2vw, 26px);
  font-weight: 500;
  letter-spacing: -0.025em;
}

.analytics-live {
  display: inline-flex;
  min-height: 30px;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  border: 1px solid #c6c6c1;
  border-radius: 999px;
  padding: 5px 11px;
  color: #555;
  font-size: 10px;
  white-space: nowrap;
}

.analytics-live > span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #27885f;
}

.analytics-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  background: #d5d5d0;
}

.analytics-summary > span {
  display: flex;
  min-width: 0;
  background: #fff;
  padding: 17px;
  flex-direction: column;
  gap: 4px;
}

.analytics-summary strong {
  font-size: 25px;
  font-weight: 500;
  letter-spacing: -0.035em;
}

.analytics-summary small {
  color: #6a6a6a;
  font-size: 10.5px;
  line-height: 1.35;
}

.opportunity-list {
  margin-top: 19px;
  border-top: 1px solid #cececa;
  list-style: none;
}

.opportunity-row {
  border-bottom: 1px solid #cececa;
  padding: 19px 0;
}

.opportunity-row__heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}

.opportunity-row__heading span {
  display: block;
  margin-bottom: 4px;
  color: #777;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 9px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.opportunity-row__heading h4 {
  font-size: 15px;
  font-weight: 600;
}

.opportunity-row__heading > strong {
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.025em;
}

.opportunity-row__heading > strong.is-high {
  color: #21704f;
}

.opportunity-row__heading > strong.is-medium {
  color: #9b6713;
}

.opportunity-row__heading > strong.is-low {
  color: #7c5d3e;
}

.opportunity-progress {
  height: 4px;
  margin: 13px 0 14px;
  overflow: hidden;
  background: #deded9;
}

.opportunity-progress > span {
  display: block;
  height: 100%;
  background: #777;
}

.opportunity-progress > span.is-high {
  background: #27885f;
}

.opportunity-progress > span.is-medium {
  background: #c38a2d;
}

.opportunity-progress > span.is-low {
  background: #9d7652;
}

.opportunity-row__details {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
}

.opportunity-row__details p {
  color: #5d5d5d;
  font-size: 11.5px;
  line-height: 1.5;
}

.opportunity-row__details p > span {
  display: block;
  margin-bottom: 3px;
  color: #929292;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 8px;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}

.opportunity-row__details strong {
  color: #222;
  font-weight: 600;
}

.analytics-label {
  margin-bottom: 24px;
  color: #555;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  letter-spacing: 0.105em;
  line-height: 1.5;
  text-transform: uppercase;
}

.analytics-copy h2 {
  max-width: 650px;
  margin-bottom: 25px;
  font-size: clamp(42px, 4vw, 58px);
  font-variation-settings: 'opsz' 58, 'wght' 300;
  font-weight: 300;
  letter-spacing: -0.045em;
  line-height: 1.08;
}

.analytics-copy h2 em {
  font-family: var(--font-serif);
  font-style: italic;
  font-variation-settings: 'opsz' 58, 'wght' 340;
  font-weight: 340;
}

.analytics-lead {
  max-width: 550px;
  margin-bottom: 42px;
  color: #505050;
  font-size: 17px;
  line-height: 1.7;
}

.analytics-points {
  border-top: 1px solid #c9c9c4;
  list-style: none;
}

.analytics-points li {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  gap: 18px;
  border-bottom: 1px solid #c9c9c4;
  padding: 20px 0;
}

.analytics-points li > span {
  padding-top: 4px;
  color: #777;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
}

.analytics-points h3 {
  margin-bottom: 5px;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.015em;
}

.analytics-points p {
  max-width: 470px;
  color: #5c5c5c;
  font-size: 13.5px;
  line-height: 1.6;
}

@media (max-width: 1099px) {
  .analytics-inner {
    width: min(760px, calc(100% - 64px));
    grid-template-columns: 1fr;
    gap: 64px;
  }

  .analytics-copy {
    max-width: 650px;
    order: -1;
  }
}

@media (max-width: 767px) {
  .analytics-inner {
    width: min(100% - 40px, 620px);
    gap: 44px;
    padding: 70px 0;
  }

  .analytics-copy h2 {
    font-size: clamp(36px, 10vw, 46px);
  }

  .analytics-lead {
    margin-bottom: 34px;
    font-size: 15.5px;
  }

  .analytics-preview {
    padding: 20px;
  }

  .analytics-preview__header {
    flex-direction: column;
  }

  .analytics-summary {
    grid-template-columns: 1fr;
  }

  .analytics-summary > span {
    flex-direction: row;
    align-items: baseline;
    gap: 12px;
  }

  .opportunity-row__details {
    grid-template-columns: 1fr;
    gap: 10px;
  }
}

@media (max-width: 359px) {
  .analytics-inner {
    width: calc(100% - 32px);
  }
}
</style>
