<script setup lang="ts">
const railItems = [
  { icon: 'lucide:folder', label: 'Sprawy', active: true },
  { icon: 'lucide:user-round', label: 'Klienci' },
  { icon: 'lucide:calendar-days', label: 'Kalendarz' },
  { icon: 'lucide:message-square', label: 'Wiadomości' },
  { icon: 'lucide:file-text', label: 'Dokumenty' },
]

const agentActivity = [
  { name: 'CRM', detail: 'Kontekst gotowy', state: 'done' },
  { name: 'Eve', detail: '4 brakujące dane', state: 'active' },
  { name: 'Eksport PDF', detail: 'Po zatwierdzeniu', state: 'waiting' },
]

const caseSteps = [
  {
    index: '01',
    icon: 'lucide:house',
    title: 'Nieruchomość — wybrana',
    description: 'Znalezienie i weryfikacja nieruchomości',
    status: 'Zakończone',
    state: 'done',
  },
  {
    index: '02',
    icon: 'lucide:landmark',
    title: 'Kredyt hipoteczny — w analizie',
    description: 'Analiza zdolności i ofert finansowania',
    status: 'W trakcie',
    state: 'active',
  },
  {
    index: '03',
    icon: 'lucide:shield-check',
    title: 'Ubezpieczenie — do przygotowania',
    description: 'Dobór ochrony i przygotowanie oferty',
    status: 'Do zrobienia',
    state: 'waiting',
  },
]
</script>

<template>
  <article class="theme-case" aria-label="Podgląd spersonalizowanej sprawy klienta w OpenExpert CRM">
    <aside class="theme-case__rail" aria-label="Nawigacja podglądu CRM">
      <img src="/assets/logo-dark.svg" alt="OpenExpert" width="30" height="30" class="theme-case__logo">

      <div class="theme-case__rail-items">
        <span
          v-for="item in railItems"
          :key="item.label"
          class="theme-case__rail-item"
          :class="{ 'theme-case__rail-item--active': item.active }"
          :aria-label="item.label"
        >
          <Icon :name="item.icon" aria-hidden="true" />
        </span>
      </div>

      <span class="theme-case__rail-item theme-case__rail-settings" aria-label="Ustawienia">
        <Icon name="lucide:settings" aria-hidden="true" />
      </span>
    </aside>

    <div class="theme-case__body">
      <header class="theme-case__header">
        <div>
          <p class="theme-case__eyebrow">Sprawa OE-2048</p>
          <h2>Nowe mieszkanie</h2>
        </div>
        <button type="button" class="theme-case__agent-button">
          <Icon name="lucide:bot" aria-hidden="true" />
          Jak pracują agenci
        </button>
      </header>

      <div class="theme-case__people">
        <div class="theme-person">
          <span class="theme-person__label">Klient</span>
          <span class="theme-person__name">
            <Icon name="lucide:user-round" aria-hidden="true" />
            Marta Kowalska
          </span>
        </div>
        <div class="theme-person">
          <span class="theme-person__label">Ekspert prowadzący</span>
          <span class="theme-person__name">
            <Icon name="lucide:user-round" aria-hidden="true" />
            Jan Nowak
          </span>
        </div>
      </div>

      <section class="theme-agents" aria-labelledby="preview-agents-title">
        <div class="theme-agents__heading">
          <span class="theme-agents__icon" aria-hidden="true">
            <Icon name="lucide:bot" />
          </span>
          <span>
            <small>Aktywność w sprawie</small>
            <strong id="preview-agents-title">Agenci pracują na wspólnym kontekście</strong>
          </span>
        </div>

        <ul class="theme-agents__activity">
          <li v-for="activity in agentActivity" :key="activity.name">
            <span>
              <i :class="`is-${activity.state}`" aria-hidden="true" />
              {{ activity.name }}
            </span>
            <small>{{ activity.detail }}</small>
          </li>
        </ul>
      </section>

      <ol class="theme-case__steps" aria-label="Etapy sprawy klienta">
        <li v-for="step in caseSteps" :key="step.index" class="theme-step">
          <span class="theme-step__index">{{ step.index }}</span>
          <span class="theme-step__connector" aria-hidden="true"><i /></span>
          <span class="theme-step__icon" aria-hidden="true">
            <Icon :name="step.icon" />
          </span>
          <span class="theme-step__copy">
            <strong>{{ step.title }}</strong>
            <small>{{ step.description }}</small>
          </span>
          <span class="theme-step__status" :class="`is-${step.state}`">{{ step.status }}</span>
        </li>
      </ol>
    </div>

    <nav class="theme-case__mobile-nav" aria-label="Mobilna nawigacja podglądu CRM">
      <span
        v-for="item in railItems.slice(0, 4)"
        :key="item.label"
        :class="{ 'is-active': item.active }"
      >
        <Icon :name="item.icon" aria-hidden="true" />
        <small>{{ item.label }}</small>
      </span>
    </nav>
  </article>
</template>

<style scoped>
.theme-case {
  position: relative;
  display: grid;
  min-width: 0;
  min-height: clamp(620px, 66cqw, 720px);
  grid-template-columns: 70px minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid var(--theme-border);
  border-radius: calc(var(--theme-radius) + 4px);
  background: var(--theme-surface);
  box-shadow: 0 20px 60px rgba(17, 25, 40, 0.08);
  color: var(--theme-text);
  container-type: inline-size;
  font-family: var(--theme-font-body);
  transition: background 220ms ease, border-color 220ms ease, color 220ms ease, border-radius 220ms ease;
}

.theme-case__rail {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  background: var(--theme-primary);
  color: var(--theme-on-primary);
  padding: 20px 10px 14px;
  transition: background 220ms ease;
}

.theme-case__logo {
  width: 30px;
  height: 30px;
  margin-bottom: 24px;
}

.theme-case__rail-items {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.theme-case__rail-item {
  display: grid;
  width: 46px;
  height: 46px;
  place-items: center;
  border-radius: max(4px, calc(var(--theme-radius) - 3px));
  color: var(--theme-on-primary);
  opacity: 0.72;
}

.theme-case__rail-item :deep(svg) {
  width: 21px;
  height: 21px;
  stroke-width: 1.55;
}

.theme-case__rail-item--active {
  background: rgba(255, 255, 255, 0.18);
  opacity: 1;
}

.theme-case__rail-settings {
  margin-top: auto;
}

.theme-case__body {
  min-width: 0;
  padding: 34px 38px 26px;
}

.theme-case__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 30px;
}

.theme-case__eyebrow {
  margin-bottom: 7px;
  color: var(--theme-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.theme-case__header h2 {
  color: var(--theme-text);
  font-family: var(--theme-font-display);
  font-size: clamp(30px, 3.3cqw, 44px);
  font-weight: 600;
  letter-spacing: -0.045em;
  line-height: 1.08;
}

.theme-case__agent-button {
  display: inline-flex;
  min-height: 46px;
  align-items: center;
  gap: 9px;
  flex: 0 0 auto;
  border: 1px solid var(--theme-primary);
  border-radius: max(4px, calc(var(--theme-radius) - 2px));
  background: var(--theme-primary);
  color: var(--theme-on-primary);
  font-family: var(--theme-font-body);
  font-size: 13px;
  font-weight: 600;
  padding: 10px 15px;
  cursor: pointer;
  transition: opacity 150ms ease, transform 150ms ease, border-radius 220ms ease;
}

.theme-case__agent-button:hover {
  opacity: 0.88;
  transform: translateY(-1px);
}

.theme-case__agent-button :deep(svg) {
  width: 17px;
  height: 17px;
  stroke-width: 1.6;
}

.theme-case__people {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border-bottom: 1px solid var(--theme-border);
  padding-bottom: 24px;
}

.theme-person {
  min-width: 0;
  padding-right: 28px;
}

.theme-person + .theme-person {
  border-left: 1px solid var(--theme-border);
  padding-right: 0;
  padding-left: 28px;
}

.theme-person__label {
  display: block;
  margin-bottom: 10px;
  color: var(--theme-muted);
  font-size: 12px;
}

.theme-person__name {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 11px;
  color: var(--theme-text);
  font-size: 17px;
  font-weight: 600;
}

.theme-person__name :deep(svg) {
  width: 21px;
  height: 21px;
  flex: 0 0 auto;
  color: var(--theme-primary);
  stroke-width: 1.6;
}

.theme-agents {
  display: grid;
  grid-template-columns: minmax(230px, 0.9fr) minmax(0, 1.1fr);
  align-items: center;
  gap: 22px;
  border-bottom: 1px solid var(--theme-border);
  background: var(--theme-primary-soft);
  margin: 0 -38px;
  padding: 18px 38px;
  transition: background 220ms ease;
}

.theme-agents__heading {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
}

.theme-agents__icon {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  flex: 0 0 auto;
  border: 1px solid var(--theme-primary);
  border-radius: max(4px, calc(var(--theme-radius) - 2px));
  background: var(--theme-surface);
  color: var(--theme-primary);
}

.theme-agents__icon :deep(svg) {
  width: 20px;
  height: 20px;
  stroke-width: 1.6;
}

.theme-agents__heading > span:last-child {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.theme-agents__heading small,
.theme-agents__activity small {
  color: var(--theme-muted);
  font-size: 11px;
  line-height: 1.4;
}

.theme-agents__heading strong {
  color: var(--theme-text);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.35;
}

.theme-agents__activity {
  display: grid;
  min-width: 0;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  list-style: none;
}

.theme-agents__activity li {
  min-width: 0;
  padding: 0 12px;
}

.theme-agents__activity li + li {
  border-left: 1px solid var(--theme-border);
}

.theme-agents__activity li > span {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 4px;
  color: var(--theme-text);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.065em;
  text-transform: uppercase;
}

.theme-agents__activity i {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--theme-border);
}

.theme-agents__activity i.is-done {
  background: var(--theme-primary);
}

.theme-agents__activity i.is-active {
  background: var(--theme-accent);
}

.theme-case__steps {
  list-style: none;
}

.theme-step {
  display: grid;
  min-height: 112px;
  grid-template-columns: 54px 24px 54px minmax(0, 1fr) auto;
  align-items: center;
  column-gap: 14px;
  border-bottom: 1px solid var(--theme-border);
}

.theme-step:last-child {
  border-bottom: 0;
}

.theme-step__index,
.theme-step__icon {
  display: grid;
  width: 54px;
  height: 54px;
  place-items: center;
  border: 1px solid var(--theme-border);
  border-radius: max(4px, calc(var(--theme-radius) - 3px));
  background: var(--theme-surface);
}

.theme-step__index {
  color: var(--theme-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 17px;
}

.theme-step__icon {
  color: var(--theme-primary);
}

.theme-step__icon :deep(svg) {
  width: 26px;
  height: 26px;
  stroke-width: 1.45;
}

.theme-step__connector {
  position: relative;
  align-self: stretch;
}

.theme-step__connector::before {
  position: absolute;
  top: -1px;
  bottom: -1px;
  left: 50%;
  border-left: 1px dashed var(--theme-border);
  content: '';
  transform: translateX(-50%);
}

.theme-step:first-child .theme-step__connector::before {
  top: 50%;
}

.theme-step:last-child .theme-step__connector::before {
  bottom: 50%;
}

.theme-step__connector i {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 10px;
  height: 10px;
  border: 2px solid var(--theme-surface);
  border-radius: 50%;
  background: var(--theme-primary);
  transform: translate(-50%, -50%);
}

.theme-step__copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
}

.theme-step__copy strong {
  color: var(--theme-text);
  font-family: var(--theme-font-display);
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.3;
}

.theme-step__copy small {
  color: var(--theme-muted);
  font-size: 13px;
  line-height: 1.45;
}

.theme-step__status {
  border: 1px solid var(--theme-border);
  border-radius: max(3px, calc(var(--theme-radius) - 5px));
  background: var(--theme-surface);
  color: var(--theme-muted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.055em;
  padding: 7px 9px;
  text-transform: uppercase;
}

.theme-step__status.is-done {
  border-color: var(--theme-primary);
  color: var(--theme-primary);
}

.theme-step__status.is-active {
  border-color: var(--theme-accent);
  background: var(--theme-accent-soft);
  color: var(--theme-text);
}

.theme-case__mobile-nav {
  display: none;
}

@container (max-width: 820px) {
  .theme-case__body {
    padding-right: 28px;
    padding-left: 28px;
  }

  .theme-agents {
    grid-template-columns: 1fr;
    gap: 14px;
    margin-right: -28px;
    margin-left: -28px;
    padding-right: 28px;
    padding-left: 28px;
  }

  .theme-agents__activity li:first-child {
    padding-left: 0;
  }

  .theme-step {
    grid-template-columns: 48px 20px 48px minmax(0, 1fr);
    column-gap: 10px;
  }

  .theme-step__index,
  .theme-step__icon {
    width: 48px;
    height: 48px;
  }

  .theme-step__status {
    display: none;
  }
}

@container (max-width: 620px) {
  .theme-case {
    display: block;
    min-height: 0;
    padding-bottom: 72px;
  }

  .theme-case__rail {
    display: none;
  }

  .theme-case__body {
    padding: 24px 20px 14px;
  }

  .theme-case__header {
    display: block;
    margin-bottom: 22px;
  }

  .theme-case__header h2 {
    font-size: 30px;
  }

  .theme-case__agent-button {
    width: 100%;
    margin-top: 18px;
    justify-content: center;
  }

  .theme-case__people {
    grid-template-columns: 1fr;
    gap: 18px;
  }

  .theme-person {
    padding-right: 0;
  }

  .theme-person + .theme-person {
    border-top: 1px solid var(--theme-border);
    border-left: 0;
    padding-top: 18px;
    padding-left: 0;
  }

  .theme-agents {
    margin: 0 -20px;
    padding: 18px 20px;
  }

  .theme-agents__activity {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .theme-agents__activity li,
  .theme-agents__activity li:first-child {
    border-left: 0;
    padding: 0;
  }

  .theme-step {
    min-height: 100px;
    grid-template-columns: 44px 14px minmax(0, 1fr);
    column-gap: 9px;
  }

  .theme-step__index {
    width: 44px;
    height: 44px;
    font-size: 15px;
  }

  .theme-step__icon {
    display: none;
  }

  .theme-step__copy strong {
    font-size: 16px;
  }

  .theme-step__copy small {
    font-size: 12px;
  }

  .theme-case__mobile-nav {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    display: grid;
    height: 64px;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    border-top: 1px solid var(--theme-border);
    background: var(--theme-surface);
  }

  .theme-case__mobile-nav span {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 4px;
    color: var(--theme-muted);
  }

  .theme-case__mobile-nav span.is-active {
    color: var(--theme-primary);
  }

  .theme-case__mobile-nav :deep(svg) {
    width: 18px;
    height: 18px;
  }

  .theme-case__mobile-nav small {
    overflow: hidden;
    max-width: 100%;
    font-size: 9px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

@media (prefers-reduced-motion: reduce) {
  .theme-case,
  .theme-case__rail,
  .theme-case__agent-button,
  .theme-agents {
    transition: none;
  }
}
</style>
