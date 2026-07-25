<template>
  <section id="rozliczenia" class="settlements-section" aria-labelledby="settlements-title">
    <div class="settlements-inner">
      <div class="settlements-copy">
        <p class="settlements-label">Proste i przejrzyste rozliczenia</p>
        <h2 id="settlements-title">Wiesz, ile zarobisz.{{ ' ' }}<br><em>I dokładnie za co.</em></h2>
        <p class="settlements-lead">Po podpisaniu umowy kredytowej rozliczamy sprawę w ciągu 3 dni. Jasne zasady, aktualne kwoty i pełne wyjaśnienie wyniku — zawsze w jednym miejscu.</p>

        <ol class="settlements-points">
          <li>
            <span class="settlements-points__index">01</span>
            <div>
              <h3>Rozliczenie do 3 dni</h3>
              <p>Od podpisania umowy kredytowej do gotowego rozliczenia — maksymalnie 3 dni.</p>
            </div>
          </li>
          <li>
            <span class="settlements-points__index">02</span>
            <div>
              <h3>Zasady znane z góry</h3>
              <p>Stawki, warunki i podział są jasne, więc każdy wie, ile zarobi na danej sprawie.</p>
            </div>
          </li>
          <li>
            <span class="settlements-points__index">03</span>
            <div>
              <h3>Każda kwota ma uzasadnienie</h3>
              <p>Na bieżąco widzisz, ile już zarobiłeś, na których sprawach i z czego wynika każda kwota.</p>
            </div>
          </li>
        </ol>
      </div>

      <article class="earnings-card" aria-label="Przykładowe rozliczenie sprawy kredytowej">
        <header class="earnings-card__header">
          <div>
            <p>Przykładowe rozliczenie</p>
            <h3>Sprawa: Nowe mieszkanie</h3>
          </div>
          <span class="earnings-status"><span aria-hidden="true" /> Umowa podpisana</span>
        </header>

        <dl class="earnings-breakdown">
          <div>
            <dt>Produkty w rozliczeniu</dt>
            <dd>4</dd>
          </div>
          <div>
            <dt>Łączna wartość kredytów</dt>
            <dd>460 000 zł</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>Gotowe do wypłaty</dd>
          </div>
        </dl>

        <div class="earnings-total">
          <span>
            <small>Do wypłaty</small>
            <strong>9 120 zł</strong>
          </span>
          <span>
            <small>Termin rozliczenia</small>
            <strong>do 3 dni</strong>
          </span>
        </div>

        <div class="earnings-reason">
          <div class="earnings-reason__header">
            <span>Dlaczego tyle?</span>
            <strong>Składniki rozliczenia</strong>
          </div>

          <div class="earnings-reason__columns" aria-hidden="true">
            <span>Składnik</span>
            <span>Podstawa naliczenia</span>
            <span>Kwota</span>
          </div>

          <ul class="earnings-sources">
            <li>
              <strong class="earnings-source__product">Kredyt hipoteczny</strong>
              <span class="earnings-source__basis">420 000 zł × 1,40%</span>
              <strong class="earnings-source__amount">5 880 zł</strong>
            </li>
            <li>
              <strong class="earnings-source__product">Kredyt gotówkowy — remont</strong>
              <span class="earnings-source__basis">40 000 zł × 2,50%</span>
              <strong class="earnings-source__amount">1 000 zł</strong>
            </li>
            <li>
              <strong class="earnings-source__product">Ubezpieczenie nieruchomości</strong>
              <span class="earnings-source__basis">1 200 zł składki × 20%</span>
              <strong class="earnings-source__amount">240 zł</strong>
            </li>
            <li>
              <strong class="earnings-source__product">Obsługa transakcji</strong>
              <span class="earnings-source__basis">8 000 zł prowizji × 25%</span>
              <strong class="earnings-source__amount">2 000 zł</strong>
            </li>
          </ul>

          <div class="earnings-reason__total">
            <span>Łącznie dla Ciebie</span>
            <strong>9 120 zł</strong>
          </div>

          <p class="earnings-reason__disclaimer">To przykładowa kalkulacja; rzeczywiste kwoty wynikają z umowy, obowiązujących stawek i spełnienia warunków rozliczenia danej sprawy.</p>
        </div>

        <footer class="earnings-card__footer">
          <span>Pełna historia rozliczeń</span>
          <span>Każda sprawa · każda kwota</span>
        </footer>
      </article>
    </div>
  </section>
</template>

<style scoped>
.settlements-section {
  scroll-margin-top: 88px;
  border-top: 1px solid #cfcfca;
  background: #ecece8;
  color: #111;
  font-family: var(--font-sans);
}

.settlements-inner {
  display: grid;
  width: min(1340px, calc(100% - 96px));
  grid-template-columns: minmax(0, 0.92fr) minmax(500px, 1.08fr);
  align-items: center;
  gap: clamp(64px, 8vw, 126px);
  margin: 0 auto;
  padding: 104px 0 112px;
}

.settlements-label {
  margin-bottom: 24px;
  color: #555;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  letter-spacing: 0.105em;
  line-height: 1.5;
  text-transform: uppercase;
}

.settlements-copy h2 {
  max-width: 650px;
  margin-bottom: 25px;
  font-size: clamp(42px, 4vw, 58px);
  font-variation-settings: 'opsz' 58, 'wght' 300;
  font-weight: 300;
  letter-spacing: -0.045em;
  line-height: 1.08;
}

.settlements-copy h2 em {
  font-family: var(--font-serif);
  font-style: italic;
  font-variation-settings: 'opsz' 58, 'wght' 340;
  font-weight: 340;
}

.settlements-lead {
  max-width: 560px;
  margin-bottom: 42px;
  color: #505050;
  font-size: 17px;
  line-height: 1.7;
}

.settlements-points {
  border-top: 1px solid #c9c9c4;
  list-style: none;
}

.settlements-points li {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  gap: 18px;
  border-bottom: 1px solid #c9c9c4;
  padding: 21px 0;
}

.settlements-points__index {
  padding-top: 4px;
  color: #777;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
}

.settlements-points h3 {
  margin-bottom: 5px;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.015em;
}

.settlements-points p {
  max-width: 480px;
  color: #5c5c5c;
  font-size: 13.5px;
  line-height: 1.6;
}

.earnings-card {
  min-width: 0;
  border: 1px solid #333;
  border-radius: 6px;
  background: #080808;
  color: #f7f7f7;
  padding: clamp(24px, 3vw, 38px);
}

.earnings-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  border-bottom: 1px solid #353535;
  padding-bottom: 26px;
}

.earnings-card__header p {
  margin-bottom: 8px;
  color: #858585;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 9px;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.earnings-card__header h3 {
  font-size: clamp(20px, 2vw, 25px);
  font-weight: 500;
  letter-spacing: -0.025em;
}

.earnings-status {
  display: inline-flex;
  min-height: 30px;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  border: 1px solid #3e3e3e;
  border-radius: 999px;
  padding: 5px 11px;
  color: #cfcfcf;
  font-size: 10px;
  white-space: nowrap;
}

.earnings-status > span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #8fcf9b;
}

.earnings-breakdown {
  padding: 11px 0;
}

.earnings-breakdown > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  border-bottom: 1px solid #292929;
  padding: 15px 0;
}

.earnings-breakdown dt {
  color: #818181;
  font-size: 12px;
}

.earnings-breakdown dd {
  color: #e8e8e8;
  font-size: 13px;
  font-weight: 500;
  text-align: right;
}

.earnings-total {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  margin-top: 10px;
  background: #3b3b3b;
}

.earnings-total > span {
  display: flex;
  min-width: 0;
  background: #111;
  padding: 22px;
  flex-direction: column;
  gap: 8px;
}

.earnings-total small,
.earnings-reason__header > span,
.earnings-reason__columns {
  color: #838383;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.earnings-total strong {
  font-size: clamp(22px, 2.3vw, 30px);
  font-weight: 500;
  letter-spacing: -0.035em;
}

.earnings-reason {
  overflow: hidden;
  border: 1px solid #383838;
  margin-top: 18px;
}

.earnings-reason__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  border-bottom: 1px solid #303030;
  padding: 17px 20px;
}

.earnings-reason__header strong {
  color: #bdbdbd;
  font-size: 11px;
  font-weight: 500;
}

.earnings-reason__columns,
.earnings-sources li {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.9fr) auto;
  align-items: center;
  gap: 18px;
}

.earnings-reason__columns {
  border-bottom: 1px solid #292929;
  padding: 10px 20px;
  font-size: 8px;
}

.earnings-reason__columns span:last-child {
  text-align: right;
}

.earnings-sources {
  list-style: none;
}

.earnings-sources li {
  border-bottom: 1px solid #292929;
  padding: 14px 20px;
}

.earnings-source__product,
.earnings-source__amount {
  font-size: 12px;
  font-weight: 500;
}

.earnings-source__basis {
  color: #858585;
  font-size: 10.5px;
  line-height: 1.45;
}

.earnings-source__amount {
  color: #f1f1f1;
  text-align: right;
  white-space: nowrap;
}

.earnings-reason__total {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  background: #111;
  padding: 17px 20px;
}

.earnings-reason__total span {
  color: #aaa;
  font-size: 12px;
}

.earnings-reason__total strong {
  font-size: 20px;
  font-weight: 500;
  letter-spacing: -0.025em;
  white-space: nowrap;
}

.earnings-reason__disclaimer {
  padding: 12px 20px 15px;
  color: #999;
  font-size: 9.5px;
  line-height: 1.5;
}

.earnings-card__footer {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  padding-top: 24px;
  color: #999;
  font-size: 10px;
}

@media (max-width: 1099px) {
  .settlements-inner {
    width: min(760px, calc(100% - 64px));
    grid-template-columns: 1fr;
    gap: 64px;
  }

  .settlements-copy {
    max-width: 650px;
  }
}

@media (max-width: 767px) {
  .settlements-inner {
    width: min(100% - 40px, 620px);
    gap: 44px;
    padding: 70px 0;
  }

  .settlements-copy h2 {
    font-size: clamp(36px, 10vw, 46px);
  }

  .settlements-lead {
    margin-bottom: 34px;
    font-size: 15.5px;
  }

  .earnings-card {
    padding: 20px;
  }

  .earnings-card__header {
    flex-direction: column;
  }

  .earnings-total {
    grid-template-columns: 1fr;
  }

  .earnings-total strong {
    font-size: 25px;
  }

  .earnings-reason__columns {
    display: none;
  }

  .earnings-sources li {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 5px 14px;
  }

  .earnings-source__basis {
    grid-column: 1 / -1;
  }

  .earnings-card__footer {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }
}

@media (max-width: 359px) {
  .settlements-inner {
    width: calc(100% - 32px);
  }
}
</style>
