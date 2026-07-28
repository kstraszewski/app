<script setup lang="ts">
import {
  personalizationPresets,
  themeToCssVariables,
} from '~/utils/personalization-theme'
import { loadThemeFonts } from '~/utils/theme-fonts'

const CYCLE_DURATION = 4400
const FADE_DURATION = 180

const previewRoot = ref<HTMLElement | null>(null)
const activeThemeIndex = ref(0)
const cycleRunId = ref(0)
const isTransitioning = ref(false)
const isVisible = ref(false)
const isHoverPaused = ref(false)
const isFocusPaused = ref(false)
const isPageHidden = ref(false)
const isUserPaused = ref(false)
const prefersReducedMotion = ref(false)

const activeTheme = computed(() => personalizationPresets[activeThemeIndex.value] ?? personalizationPresets[0]!)
const previewStyles = computed(() => ({
  ...themeToCssVariables(activeTheme.value),
  '--theme-cycle-duration': `${CYCLE_DURATION}ms`,
}))
const isAutoPaused = computed(() => (
  isUserPaused.value
  || isHoverPaused.value
  || isFocusPaused.value
  || isPageHidden.value
  || prefersReducedMotion.value
  || !isVisible.value
))

let cycleTimer: ReturnType<typeof setTimeout> | undefined
let fadeTimer: ReturnType<typeof setTimeout> | undefined
let previewObserver: IntersectionObserver | undefined
let motionPreference: MediaQueryList | undefined

function clearCycleTimer() {
  if (cycleTimer) clearTimeout(cycleTimer)
  cycleTimer = undefined
}

function clearFadeTimer() {
  if (fadeTimer) clearTimeout(fadeTimer)
  fadeTimer = undefined
}

function scheduleNextTheme() {
  clearCycleTimer()
  if (isAutoPaused.value) return

  cycleRunId.value += 1
  cycleTimer = setTimeout(() => {
    changeTheme((activeThemeIndex.value + 1) % personalizationPresets.length)
  }, CYCLE_DURATION)
}

function changeTheme(nextIndex: number) {
  if (nextIndex === activeThemeIndex.value) {
    scheduleNextTheme()
    return
  }

  clearCycleTimer()
  clearFadeTimer()

  if (prefersReducedMotion.value) {
    activeThemeIndex.value = nextIndex
    scheduleNextTheme()
    return
  }

  isTransitioning.value = true
  fadeTimer = setTimeout(() => {
    activeThemeIndex.value = nextIndex
    requestAnimationFrame(() => {
      isTransitioning.value = false
      scheduleNextTheme()
    })
  }, FADE_DURATION)
}

function chooseTheme(index: number) {
  clearCycleTimer()
  clearFadeTimer()
  isUserPaused.value = true
  isTransitioning.value = false
  activeThemeIndex.value = index
  cycleRunId.value += 1
}

function toggleAnimation() {
  if (prefersReducedMotion.value) return

  const isResuming = isUserPaused.value
  isUserPaused.value = !isUserPaused.value

  if (isResuming) {
    isHoverPaused.value = false
    isFocusPaused.value = false
  }
}

function handleFocusOut(event: FocusEvent) {
  const nextTarget = event.relatedTarget
  if (nextTarget instanceof Node && previewRoot.value?.contains(nextTarget)) return
  isFocusPaused.value = false
}

function updateMotionPreference(event: MediaQueryListEvent | MediaQueryList) {
  prefersReducedMotion.value = event.matches
}

function updatePageVisibility() {
  isPageHidden.value = document.hidden
}

watch(isAutoPaused, (paused) => {
  if (paused) {
    clearCycleTimer()
    clearFadeTimer()
    isTransitioning.value = false
  }
  else scheduleNextTheme()
})

onMounted(() => {
  motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
  updateMotionPreference(motionPreference)
  motionPreference.addEventListener('change', updateMotionPreference)

  isPageHidden.value = document.hidden
  document.addEventListener('visibilitychange', updatePageVisibility)

  if ('IntersectionObserver' in window) {
    previewObserver = new IntersectionObserver(([entry]) => {
      isVisible.value = Boolean(entry?.isIntersecting)
      if (isVisible.value) loadThemeFonts()
    }, { threshold: 0.25 })

    if (previewRoot.value) previewObserver.observe(previewRoot.value)
  }
  else {
    isVisible.value = true
    loadThemeFonts()
  }
})

onBeforeUnmount(() => {
  clearCycleTimer()
  clearFadeTimer()
  previewObserver?.disconnect()
  motionPreference?.removeEventListener('change', updateMotionPreference)
  document.removeEventListener('visibilitychange', updatePageVisibility)
})
</script>

<template>
  <div
    ref="previewRoot"
    class="personalization-demo"
    :class="{
      'is-paused': isAutoPaused,
      'is-transitioning': isTransitioning,
      'has-reduced-motion': prefersReducedMotion,
    }"
    :style="previewStyles"
    @mouseenter="isHoverPaused = true"
    @mouseleave="isHoverPaused = false"
    @focusin="isFocusPaused = true"
    @focusout="handleFocusOut"
  >
    <header class="personalization-demo__header">
      <span class="personalization-demo__live">
        <i aria-hidden="true" />
        Podgląd na żywo
      </span>

      <div class="personalization-demo__status">
        <Transition name="theme-label" mode="out-in">
          <span :key="activeTheme.id" aria-live="off">{{ activeTheme.name }}</span>
        </Transition>
        <button
          type="button"
          :disabled="prefersReducedMotion"
          :aria-label="prefersReducedMotion
            ? 'Automatyczna animacja jest wyłączona przez ustawienia systemu'
            : isUserPaused
              ? 'Wznów automatyczną zmianę motywu'
              : 'Wstrzymaj automatyczną zmianę motywu'"
          @click="toggleAnimation"
        >
          <Icon :name="isUserPaused || prefersReducedMotion ? 'lucide:play' : 'lucide:pause'" aria-hidden="true" />
        </button>
      </div>
    </header>

    <article class="personalization-demo__app" aria-label="Przykład sprawy klienta zmieniający wygląd zgodnie z aktywnym motywem">
      <aside class="personalization-demo__rail" aria-hidden="true">
        <img src="/assets/logo-dark.svg" alt="" width="24" height="24">
        <span class="is-active"><Icon name="lucide:folder" /></span>
        <span><Icon name="lucide:user-round" /></span>
        <span><Icon name="lucide:calendar-days" /></span>
        <span><Icon name="lucide:message-square" /></span>
      </aside>

      <div class="personalization-demo__body">
        <div class="personalization-demo__case-heading">
          <span>
            <small>Sprawa OE-2048</small>
            <strong>Nowe mieszkanie</strong>
          </span>
          <span class="personalization-demo__agent-state">
            <Icon name="lucide:bot" aria-hidden="true" />
            <span class="personalization-demo__agent-state-label">3 agentów aktywnych</span>
          </span>
        </div>

        <div class="personalization-demo__client">
          <span class="personalization-demo__client-icon" aria-hidden="true">
            <Icon name="lucide:user-round" />
          </span>
          <span>
            <small>Klient</small>
            <strong>Marta Kowalska</strong>
          </span>
          <span class="personalization-demo__case-state">
            <i aria-hidden="true" />
            Kredyt · analiza
          </span>
        </div>

        <div class="personalization-demo__cards">
          <section class="personalization-demo__next" aria-labelledby="personalization-next-title">
            <header>
              <span>Następny krok</span>
              <small>02 / 04</small>
            </header>
            <span class="personalization-demo__step-icon" aria-hidden="true">
              <Icon name="lucide:landmark" />
            </span>
            <h3 id="personalization-next-title">Uzupełnij źródło dochodu</h3>
            <p>Dwie informacje dzielą sprawę od kompletnej analizy.</p>
            <span class="personalization-demo__completion">
              <i aria-hidden="true"><span /></i>
              68% danych gotowych
            </span>
          </section>

          <section class="personalization-demo__agent" aria-labelledby="personalization-agent-title">
            <header>
              <span class="personalization-demo__agent-icon" aria-hidden="true">
                <Icon name="lucide:sparkles" />
              </span>
              <span>
                <small>Aktywność Eve</small>
                <strong id="personalization-agent-title">Wykryła 2 brakujące dane</strong>
              </span>
            </header>
            <ul>
              <li><Icon name="lucide:circle-check" aria-hidden="true" /><span>Historia zatrudnienia</span><small>Gotowe</small></li>
              <li><Icon name="lucide:circle-dashed" aria-hidden="true" /><span>Dochód za 3 mies.</span><small>Brakuje</small></li>
            </ul>
          </section>
        </div>
      </div>
    </article>

    <footer class="personalization-demo__footer">
      <div class="personalization-demo__themes" role="group" aria-label="Sterowanie podglądem motywu">
        <button
          v-for="(theme, index) in personalizationPresets"
          :key="theme.id"
          type="button"
          :class="{ 'is-active': index === activeThemeIndex }"
          :aria-pressed="index === activeThemeIndex"
          @click="chooseTheme(index)"
        >
          <span>{{ theme.name }}</span>
          <i aria-hidden="true">
            <span v-if="index === activeThemeIndex" :key="`${activeTheme.id}-${cycleRunId}`" />
          </i>
        </button>
      </div>
      <span>Kolory · font · kształt</span>
    </footer>
  </div>
</template>

<style scoped>
.personalization-demo {
  min-width: 0;
  container-name: personalization-demo;
  container-type: inline-size;
  font-family: var(--font-sans);
}

.personalization-demo__header,
.personalization-demo__status,
.personalization-demo__live,
.personalization-demo__footer {
  display: flex;
  align-items: center;
}

.personalization-demo__header {
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
  color: #666;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.personalization-demo__live {
  gap: 8px;
}

.personalization-demo__live i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #2f9e44;
  box-shadow: 0 0 0 4px rgba(47, 158, 68, 0.12);
}

.personalization-demo__status {
  min-width: 114px;
  justify-content: flex-end;
  gap: 9px;
  color: #444;
}

.personalization-demo__status > span {
  min-width: 62px;
  text-align: right;
}

.personalization-demo__status button {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border: 1px solid #d0d0cb;
  border-radius: 50%;
  background: #fff;
  color: #222;
  cursor: pointer;
}

.personalization-demo__status button:hover {
  border-color: #999994;
}

.personalization-demo__status button:disabled {
  cursor: default;
  opacity: 0.5;
}

.personalization-demo__status button :deep(svg) {
  width: 13px;
  height: 13px;
  fill: currentColor;
  stroke-width: 1.6;
}

.personalization-demo__app {
  display: grid;
  min-width: 0;
  min-height: 342px;
  grid-template-columns: 54px minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid var(--theme-border);
  border-radius: var(--theme-radius);
  background: var(--theme-surface);
  box-shadow: 0 18px 44px rgba(17, 25, 40, 0.08);
  color: var(--theme-text);
  font-family: var(--theme-font-body);
  opacity: 1;
  transition:
    opacity 180ms ease,
    border-color 680ms cubic-bezier(0.22, 1, 0.36, 1),
    border-radius 680ms cubic-bezier(0.22, 1, 0.36, 1),
    background-color 680ms cubic-bezier(0.22, 1, 0.36, 1),
    color 680ms cubic-bezier(0.22, 1, 0.36, 1);
}

.is-transitioning .personalization-demo__app {
  opacity: 0.62;
}

.personalization-demo__rail {
  display: flex;
  align-items: center;
  flex-direction: column;
  gap: 8px;
  background: var(--theme-primary);
  color: var(--theme-on-primary);
  padding: 15px 7px;
  transition: background-color 680ms cubic-bezier(0.22, 1, 0.36, 1);
}

.personalization-demo__rail img {
  width: 24px;
  height: 24px;
  margin-bottom: 9px;
}

.personalization-demo__rail > span {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: var(--theme-control-radius);
  opacity: 0.68;
  transition: border-radius 680ms cubic-bezier(0.22, 1, 0.36, 1);
}

.personalization-demo__rail > span.is-active {
  background: rgba(255, 255, 255, 0.19);
  opacity: 1;
}

.personalization-demo__rail :deep(svg) {
  width: 18px;
  height: 18px;
  stroke-width: 1.55;
}

.personalization-demo__body {
  min-width: 0;
  padding: 22px;
}

.personalization-demo__case-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 18px;
}

.personalization-demo__case-heading > span:first-child,
.personalization-demo__client > span:nth-child(2),
.personalization-demo__agent header > span:last-child {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.personalization-demo__case-heading small,
.personalization-demo__client small,
.personalization-demo__agent small {
  color: var(--theme-muted);
}

.personalization-demo__case-heading small {
  margin-bottom: 4px;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.085em;
  text-transform: uppercase;
}

.personalization-demo__case-heading strong {
  font-family: var(--theme-font-display);
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.035em;
  line-height: 1.08;
}

.personalization-demo__agent-state {
  display: inline-flex;
  min-height: 33px;
  align-items: center;
  gap: 7px;
  flex: 0 0 auto;
  border-radius: var(--theme-control-radius);
  background: var(--theme-primary);
  color: var(--theme-on-primary);
  font-size: 10px;
  font-weight: 600;
  padding: 7px 10px;
  transition:
    border-radius 680ms cubic-bezier(0.22, 1, 0.36, 1),
    background-color 680ms cubic-bezier(0.22, 1, 0.36, 1),
    color 680ms cubic-bezier(0.22, 1, 0.36, 1);
}

.personalization-demo__agent-state :deep(.iconify) {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  stroke-width: 1.7;
}

.personalization-demo__client {
  display: grid;
  min-width: 0;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  align-items: center;
  gap: 11px;
  border: 1px solid var(--theme-border);
  border-radius: var(--theme-control-radius);
  background: var(--theme-primary-soft);
  margin-bottom: 13px;
  padding: 10px 12px;
  transition:
    border-color 680ms cubic-bezier(0.22, 1, 0.36, 1),
    border-radius 680ms cubic-bezier(0.22, 1, 0.36, 1),
    background-color 680ms cubic-bezier(0.22, 1, 0.36, 1);
}

.personalization-demo__client-icon,
.personalization-demo__step-icon,
.personalization-demo__agent-icon {
  display: grid;
  place-items: center;
  border-radius: var(--theme-control-radius);
  color: var(--theme-primary);
  transition:
    border-radius 680ms cubic-bezier(0.22, 1, 0.36, 1),
    color 680ms cubic-bezier(0.22, 1, 0.36, 1);
}

.personalization-demo__client-icon {
  width: 34px;
  height: 34px;
  border: 1px solid var(--theme-border);
  background: var(--theme-surface);
}

.personalization-demo__client-icon :deep(svg) {
  width: 17px;
  height: 17px;
}

.personalization-demo__client small {
  margin-bottom: 2px;
  font-size: 9px;
}

.personalization-demo__client strong {
  overflow: hidden;
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.personalization-demo__case-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--theme-text);
  font-size: 9px;
  font-weight: 600;
}

.personalization-demo__case-state i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--theme-accent);
  transition: background-color 680ms cubic-bezier(0.22, 1, 0.36, 1);
}

.personalization-demo__cards {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr);
  gap: 13px;
}

.personalization-demo__next,
.personalization-demo__agent {
  min-width: 0;
  border: 1px solid var(--theme-border);
  border-radius: var(--theme-control-radius);
  background: var(--theme-surface);
  padding: 14px;
  transition:
    border-color 680ms cubic-bezier(0.22, 1, 0.36, 1),
    border-radius 680ms cubic-bezier(0.22, 1, 0.36, 1),
    background-color 680ms cubic-bezier(0.22, 1, 0.36, 1);
}

.personalization-demo__next header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 11px;
  color: var(--theme-muted);
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}

.personalization-demo__step-icon {
  width: 31px;
  height: 31px;
  background: var(--theme-primary-soft);
  margin-bottom: 10px;
}

.personalization-demo__step-icon :deep(svg) {
  width: 17px;
  height: 17px;
  stroke-width: 1.6;
}

.personalization-demo__next h3 {
  margin-bottom: 5px;
  color: var(--theme-text);
  font-family: var(--theme-font-display);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.015em;
  line-height: 1.25;
}

.personalization-demo__next p {
  color: var(--theme-muted);
  font-size: 9.5px;
  line-height: 1.45;
}

.personalization-demo__completion {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 14px;
  color: var(--theme-muted);
  font-size: 8.5px;
}

.personalization-demo__completion > i {
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--theme-primary-soft);
}

.personalization-demo__completion > i span {
  display: block;
  width: 68%;
  height: 100%;
  border-radius: inherit;
  background: var(--theme-primary);
  transition: background-color 680ms cubic-bezier(0.22, 1, 0.36, 1);
}

.personalization-demo__agent header {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 13px;
}

.personalization-demo__agent-icon {
  width: 31px;
  height: 31px;
  flex: 0 0 auto;
  background: var(--theme-accent-soft);
  color: var(--theme-accent);
}

.personalization-demo__agent-icon :deep(svg) {
  width: 16px;
  height: 16px;
  stroke-width: 1.7;
}

.personalization-demo__agent small {
  margin-bottom: 2px;
  font-size: 8.5px;
}

.personalization-demo__agent strong {
  overflow: hidden;
  font-size: 10.5px;
  font-weight: 600;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.personalization-demo__agent ul {
  display: flex;
  flex-direction: column;
  gap: 1px;
  overflow: hidden;
  border: 1px solid var(--theme-border);
  border-radius: var(--theme-control-radius);
  background: var(--theme-border);
  list-style: none;
  transition:
    border-color 680ms cubic-bezier(0.22, 1, 0.36, 1),
    border-radius 680ms cubic-bezier(0.22, 1, 0.36, 1),
    background-color 680ms cubic-bezier(0.22, 1, 0.36, 1);
}

.personalization-demo__agent li {
  display: grid;
  min-width: 0;
  grid-template-columns: 15px minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  background: var(--theme-background);
  color: var(--theme-text);
  padding: 8px;
  font-size: 8.5px;
  transition:
    background-color 680ms cubic-bezier(0.22, 1, 0.36, 1),
    color 680ms cubic-bezier(0.22, 1, 0.36, 1);
}

.personalization-demo__agent li :deep(svg) {
  width: 13px;
  height: 13px;
  color: var(--theme-primary);
}

.personalization-demo__agent li:last-child :deep(svg) {
  color: var(--theme-accent);
}

.personalization-demo__agent li span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.personalization-demo__agent li small {
  margin: 0;
  font-size: 7.5px;
}

.personalization-demo__footer {
  justify-content: space-between;
  gap: 18px;
  margin-top: 15px;
}

.personalization-demo__footer > span {
  flex: 0 0 auto;
  color: #777772;
  font-family: var(--font-mono);
  font-size: 8px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.personalization-demo__themes {
  display: grid;
  width: min(330px, 100%);
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.personalization-demo__themes button {
  display: flex;
  min-width: 0;
  min-height: 44px;
  flex-direction: column;
  justify-content: flex-end;
  gap: 7px;
  border: 0;
  background: transparent;
  color: #777772;
  font-family: var(--font-sans);
  font-size: 9px;
  font-weight: 600;
  padding: 0;
  text-align: left;
  cursor: pointer;
}

.personalization-demo__themes button.is-active {
  color: #111;
}

.personalization-demo__themes button > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.personalization-demo__themes button > i {
  display: block;
  height: 2px;
  overflow: hidden;
  border-radius: 999px;
  background: #d6d6d1;
}

.personalization-demo__themes button > i span {
  display: block;
  width: 0;
  height: 100%;
  border-radius: inherit;
  background: var(--theme-primary);
  animation: theme-progress var(--theme-cycle-duration) linear forwards;
}

.is-paused .personalization-demo__themes button > i span {
  animation-play-state: paused;
}

.has-reduced-motion .personalization-demo__themes button > i span {
  width: 100%;
  animation: none;
}

.theme-label-enter-active,
.theme-label-leave-active {
  transition: opacity 150ms ease;
}

.theme-label-enter-from,
.theme-label-leave-to {
  opacity: 0;
}

@keyframes theme-progress {
  from { width: 0; }
  to { width: 100%; }
}

@container personalization-demo (max-width: 560px) {
  .personalization-demo__app {
    min-height: 0;
    grid-template-columns: 1fr;
  }

  .personalization-demo__rail {
    display: none;
  }

  .personalization-demo__body {
    padding: 18px;
  }

  .personalization-demo__agent-state {
    width: 34px;
    min-height: 34px;
    justify-content: center;
    padding: 0;
  }

  .personalization-demo__agent-state-label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .personalization-demo__cards {
    grid-template-columns: 1fr;
  }

  .personalization-demo__next {
    display: none;
  }

  .personalization-demo__footer {
    align-items: flex-end;
  }

  .personalization-demo__footer > span {
    display: none;
  }

  .personalization-demo__themes {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .personalization-demo *,
  .personalization-demo *::before,
  .personalization-demo *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
</style>
