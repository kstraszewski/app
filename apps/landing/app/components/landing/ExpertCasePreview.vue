<script setup lang="ts">
const railItems = [
  { icon: 'lucide:folder', label: 'Sprawy', active: true },
  { icon: 'lucide:user-round', label: 'Klienci' },
  { icon: 'lucide:calendar-days', label: 'Kalendarz' },
  { icon: 'lucide:message-square', label: 'Wiadomości' },
  { icon: 'lucide:file-text', label: 'Dokumenty' },
]

const caseSteps = [
  {
    index: '01',
    icon: 'lucide:house',
    title: 'Nieruchomość — wybrana',
    description: 'Znalezienie i weryfikacja nieruchomości',
    status: 'Zakończone',
  },
  {
    index: '02',
    icon: 'lucide:landmark',
    title: 'Kredyt hipoteczny — w analizie',
    description: 'Analiza zdolności i ofert finansowania',
    status: 'W trakcie',
  },
  {
    index: '03',
    icon: 'lucide:shield-check',
    title: 'Ubezpieczenie — do przygotowania',
    description: 'Dobór ochrony i przygotowanie oferty',
    status: 'Do zrobienia',
  },
]

const agentActivity = [
  {
    name: 'Poczta',
    detail: '3 wiadomości w sprawie',
  },
  {
    name: 'Status',
    detail: 'Kredyt · analiza',
  },
  {
    name: 'Eve',
    detail: '4 brakujące dane',
  },
]
</script>

<template>
  <article class="case-preview" aria-label="Przykład jednej sprawy prowadzonej przez eksperta i wspieranej przez agentów AI w OpenExpert">
    <img src="/assets/logo-dark.svg" alt="" width="28" height="28" class="case-preview__mobile-logo" aria-hidden="true">
    <aside class="case-rail" aria-hidden="true">
      <img src="/assets/logo-dark.svg" alt="" width="28" height="28" class="case-rail__logo">
      <div class="case-rail__items">
        <span
          v-for="item in railItems"
          :key="item.label"
          class="case-rail__item"
          :class="{ 'case-rail__item--active': item.active }"
        >
          <Icon :name="item.icon" />
        </span>
      </div>
      <span class="case-rail__item case-rail__settings">
        <Icon name="lucide:settings" />
      </span>
    </aside>

    <div class="case-preview__body">
      <header class="case-preview__header">
        <h2>Sprawa: Nowe mieszkanie</h2>
        <a href="#agenci-ai" class="case-preview__details">
          <Icon name="lucide:bot" />
          Jak pracują agenci
        </a>
      </header>

      <div class="case-preview__people">
        <div class="case-person">
          <span class="case-person__label">Klient</span>
          <span class="case-person__name">
            <Icon name="lucide:user-round" />
            Marta Kowalska
          </span>
        </div>
        <div class="case-person">
          <span class="case-person__label">Ekspert prowadzący</span>
          <span class="case-person__name">
            <Icon name="lucide:user-round" />
            Jan Nowak
          </span>
        </div>
      </div>

      <section class="case-agents" aria-labelledby="case-agents-title">
        <div class="case-agents__heading">
          <span class="case-agents__icon" aria-hidden="true">
            <Icon name="lucide:bot" />
          </span>
          <span>
            <small>Aktywność w sprawie</small>
            <h3 id="case-agents-title">Poczta, dane i status w jednym kontekście</h3>
          </span>
        </div>

        <ul class="case-agents__activity">
          <li v-for="activity in agentActivity" :key="activity.name">
            <span><i aria-hidden="true" />{{ activity.name }}</span>
            <small>{{ activity.detail }}</small>
          </li>
        </ul>
      </section>

      <ol class="case-steps" aria-label="Etapy sprawy klienta">
        <li v-for="step in caseSteps" :key="step.index" class="case-step">
          <span class="case-step__index">{{ step.index }}</span>
          <span class="case-step__connector" aria-hidden="true"><span /></span>
          <span class="case-step__icon" aria-hidden="true">
            <Icon :name="step.icon" />
          </span>
          <span class="case-step__copy">
            <strong>{{ step.title }}</strong>
            <small>{{ step.description }}</small>
          </span>
          <span class="case-step__status">{{ step.status }}</span>
        </li>
      </ol>
    </div>
  </article>
</template>

<style scoped>
.case-preview {
  position: relative;
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr);
  min-width: 0;
  min-height: 506px;
  background: #050505;
  border: 1px solid #404040;
  border-radius: 6px;
  color: #f7f7f7;
}

.case-preview__mobile-logo {
  display: none;
}

.case-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  border-right: 1px solid #2f2f2f;
  padding: 16px 8px 12px;
}

.case-rail__logo {
  width: 28px;
  height: 28px;
  margin-bottom: 18px;
}

.case-rail__items {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.case-rail__item {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border-radius: 4px;
  color: #d5d5d5;
}

.case-rail__item :deep(svg) {
  width: 20px;
  height: 20px;
  stroke-width: 1.45;
}

.case-rail__item--active {
  background: #202020;
  color: #fff;
}

.case-rail__settings {
  margin-top: auto;
}

.case-preview__body {
  min-width: 0;
  padding: 26px 32px 20px;
}

.case-preview__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 20px;
}

.case-preview__header h2 {
  color: #f7f7f7;
  font-family: var(--font-sans);
  font-size: clamp(26px, 2.2vw, 34px);
  font-variation-settings: 'opsz' 36, 'wght' 300;
  font-weight: 300;
  letter-spacing: -0.035em;
  line-height: 1.12;
}

.case-preview__details {
  display: inline-flex;
  min-height: 38px;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  border: 1px solid #383838;
  border-radius: 4px;
  padding: 7px 11px;
  color: #d0d0d0;
  font-size: 12px;
  text-decoration: none;
  transition: border-color 150ms ease-out, color 150ms ease-out, background 150ms ease-out;
}

.case-preview__details:hover {
  border-color: #656565;
  background: #121212;
  color: #fff;
}

.case-preview__details :deep(svg) {
  width: 15px;
  height: 15px;
  stroke-width: 1.45;
}

.case-preview__people {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border-bottom: 1px solid #333;
  padding-bottom: 16px;
}

.case-person {
  min-width: 0;
  padding-right: 24px;
}

.case-person + .case-person {
  border-left: 1px solid #333;
  padding-right: 0;
  padding-left: 24px;
}

.case-person__label {
  display: block;
  margin-bottom: 10px;
  color: #a8a8a8;
  font-size: 12px;
}

.case-person__name {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
  color: #f2f2f2;
  font-size: 16px;
  font-weight: 500;
}

.case-person__name :deep(svg) {
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  stroke-width: 1.45;
}

.case-agents {
  display: grid;
  grid-template-columns: minmax(178px, 0.85fr) minmax(0, 1.15fr);
  align-items: center;
  gap: 18px;
  border-bottom: 1px solid #333;
  padding: 13px 0;
}

.case-agents__heading {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}

.case-agents__icon {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  flex: 0 0 auto;
  border: 1px solid #4b4b4b;
  border-radius: 4px;
  background: #111;
  color: #f2f2f2;
}

.case-agents__icon :deep(svg) {
  width: 18px;
  height: 18px;
  stroke-width: 1.45;
}

.case-agents__heading > span:last-child {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.case-agents__heading small,
.case-agents__activity small {
  color: #8e8e8e;
  font-size: 10.5px;
  line-height: 1.35;
}

.case-agents__heading h3 {
  color: #ededed;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.35;
}

.case-agents__activity {
  display: grid;
  min-width: 0;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  list-style: none;
}

.case-agents__activity li {
  min-width: 0;
  padding: 0 10px;
}

.case-agents__activity li + li {
  border-left: 1px solid #333;
}

.case-agents__activity li > span {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 3px;
  color: #e8e8e8;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.case-agents__activity i {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: #d8d8d8;
}

.case-agents__activity small {
  display: block;
}

.case-steps {
  list-style: none;
}

.case-step {
  display: grid;
  min-height: 82px;
  grid-template-columns: 48px 22px 48px minmax(0, 1fr) auto;
  align-items: center;
  column-gap: 12px;
  border-bottom: 1px solid #2f2f2f;
}

.case-step:last-child {
  border-bottom: 0;
}

.case-step__index,
.case-step__icon {
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
  border: 1px solid #404040;
  border-radius: 4px;
}

.case-step__index {
  color: #e7e7e7;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 17px;
}

.case-step__icon :deep(svg) {
  width: 25px;
  height: 25px;
  stroke-width: 1.35;
}

.case-step__connector {
  position: relative;
  align-self: stretch;
}

.case-step__connector::before {
  position: absolute;
  top: -1px;
  bottom: -1px;
  left: 50%;
  border-left: 1px dashed #777;
  content: '';
  transform: translateX(-50%);
}

.case-step:first-child .case-step__connector::before {
  top: 50%;
}

.case-step:last-child .case-step__connector::before {
  bottom: 50%;
}

.case-step__connector span {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #b8b8b8;
  transform: translate(-50%, -50%);
}

.case-step__copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 5px;
}

.case-step__copy strong {
  color: #f2f2f2;
  font-size: 16px;
  font-weight: 500;
  line-height: 1.3;
}

.case-step__copy small {
  color: #a8a8a8;
  font-size: 12.5px;
  line-height: 1.45;
}

.case-step__status {
  border: 1px solid #3b3b3b;
  border-radius: 3px;
  padding: 5px 8px;
  color: #b7b7b7;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

@media (max-width: 1180px) {
  .case-preview__body {
    padding-right: 28px;
    padding-left: 28px;
  }

  .case-agents {
    grid-template-columns: minmax(168px, 0.8fr) minmax(0, 1.2fr);
    gap: 10px;
  }

  .case-agents__activity li {
    padding-right: 7px;
    padding-left: 7px;
  }

  .case-step {
    grid-template-columns: 44px 18px 44px minmax(0, 1fr);
    column-gap: 10px;
  }

  .case-step__index,
  .case-step__icon {
    width: 44px;
    height: 44px;
  }

  .case-step__status {
    display: none;
  }
}

@media (max-width: 767px) {
  .case-preview {
    display: block;
    min-height: 0;
    border-color: #494949;
  }

  .case-rail,
  .case-preview__details {
    display: none;
  }

  .case-preview__body {
    padding: 40px 16px 16px;
  }

  .case-preview__mobile-logo {
    position: absolute;
    top: 20px;
    left: 10px;
    display: block;
    width: 24px;
    height: 24px;
  }

  .case-preview__header {
    justify-content: center;
    margin-bottom: 14px;
    text-align: center;
  }

  .case-preview__header h2 {
    font-size: clamp(24px, 7vw, 28px);
  }

  .case-preview__people {
    padding-bottom: 22px;
  }

  .case-person {
    padding-right: 14px;
  }

  .case-person + .case-person {
    padding-left: 14px;
  }

  .case-person__label {
    min-height: 34px;
    margin-bottom: 7px;
    font-size: 12px;
    line-height: 1.4;
  }

  .case-person__name {
    align-items: flex-start;
    gap: 8px;
    font-size: 14px;
    line-height: 1.3;
  }

  .case-person__name :deep(svg) {
    width: 18px;
    height: 18px;
  }

  .case-agents {
    grid-template-columns: 1fr;
    gap: 13px;
    padding: 16px 0;
  }

  .case-agents__activity li:first-child {
    padding-left: 0;
  }

  .case-agents__activity li:last-child {
    padding-right: 0;
  }

  .case-step {
    min-height: 104px;
    grid-template-columns: 42px 18px 42px minmax(0, 1fr);
    column-gap: 8px;
  }

  .case-step__index,
  .case-step__icon {
    width: 42px;
    height: 42px;
  }

  .case-step__index {
    font-size: 15px;
  }

  .case-step__icon :deep(svg) {
    width: 23px;
    height: 23px;
  }

  .case-step__copy {
    gap: 6px;
    padding: 15px 0;
  }

  .case-step__copy strong {
    font-size: 15px;
    line-height: 1.38;
  }

  .case-step__copy small {
    font-size: 12.5px;
    line-height: 1.5;
  }
}

@media (max-width: 350px) {
  .case-preview__body {
    padding-right: 12px;
    padding-left: 12px;
  }

  .case-person__name {
    font-size: 13px;
  }

  .case-step {
    grid-template-columns: 38px 14px 38px minmax(0, 1fr);
    column-gap: 6px;
  }

  .case-step__index,
  .case-step__icon {
    width: 38px;
    height: 38px;
  }
}
</style>
