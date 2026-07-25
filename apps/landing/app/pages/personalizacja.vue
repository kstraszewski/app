<script setup lang="ts">
import type {
  PersonalizationTheme,
  PresetThemeId,
  ThemeColorKey,
  ThemeId,
} from '~/utils/personalization-theme'
import {
  clonePersonalizationTheme,
  createCustomTheme,
  getContrastRatio,
  isHexColor,
  normalizeCustomTheme,
  personalizationPresets,
  themeFontOptions,
  themeToCssVariables,
} from '~/utils/personalization-theme'
import { loadThemeFonts } from '~/utils/theme-fonts'

useLandingSeo({
  title: 'Personalizacja CRM — OpenExpert',
  description: 'Porównaj neutralne warianty kolorystyczne i typograficzne CRM albo zbuduj własny motyw.',
  path: '/personalizacja',
})

const STORAGE_KEY = 'openexpert-personalization-theme-v2'
const presetThemeIds: PresetThemeId[] = ['ocean', 'ember', 'plum']
const selectedThemeId = ref<ThemeId>('ocean')
const lastPresetThemeId = ref<PresetThemeId>('ocean')
const mobileView = ref<'settings' | 'preview'>('settings')
const customInitialized = ref(false)
const saveMessage = ref('')
const announcement = ref('Wybrano motyw Ocean.')
const customTheme = reactive<PersonalizationTheme>(createCustomTheme(personalizationPresets[0]!))
let saveMessageTimer: ReturnType<typeof setTimeout> | undefined

const colorControls: Array<{ key: ThemeColorKey, label: string, helper: string }> = [
  { key: 'primary', label: 'Kolor główny', helper: 'Nawigacja i główne akcje' },
  { key: 'accent', label: 'Akcent', helper: 'Aktywne statusy i wyróżnienia' },
  { key: 'onPrimary', label: 'Tekst na głównym', helper: 'Ikony i tekst na CTA' },
  { key: 'background', label: 'Tło', helper: 'Obszar roboczy CRM' },
  { key: 'surface', label: 'Powierzchnia', helper: 'Karty i podgląd sprawy' },
  { key: 'text', label: 'Tekst', helper: 'Nagłówki i najważniejsze dane' },
  { key: 'muted', label: 'Tekst pomocniczy', helper: 'Opisy i metadane' },
  { key: 'border', label: 'Obramowanie', helper: 'Separatory i kontury' },
]

const activeTheme = computed<PersonalizationTheme>(() => {
  if (selectedThemeId.value === 'custom') return customTheme
  return personalizationPresets.find(theme => theme.id === selectedThemeId.value) ?? personalizationPresets[0]!
})

const themeCards = computed<PersonalizationTheme[]>(() => [
  ...personalizationPresets,
  clonePersonalizationTheme(customTheme),
])

const activeThemeStyles = computed(() => themeToCssVariables(activeTheme.value))
const contrastRatio = computed(() => getContrastRatio(customTheme.colors.text, customTheme.colors.surface))
const contrastPasses = computed(() => contrastRatio.value >= 4.5)

function presetById(id: PresetThemeId): PersonalizationTheme {
  return personalizationPresets.find(theme => theme.id === id) ?? personalizationPresets[0]!
}

function replaceCustomTheme(source: PersonalizationTheme) {
  Object.assign(customTheme, createCustomTheme(source))
  customInitialized.value = true
}

function selectTheme(id: ThemeId) {
  if (id === 'custom') {
    if (!customInitialized.value) replaceCustomTheme(presetById(lastPresetThemeId.value))
  }
  else {
    lastPresetThemeId.value = id
  }

  selectedThemeId.value = id
  announcement.value = `Wybrano motyw ${id === 'custom' ? 'Custom' : activeTheme.value.name}.`
}

function customizeActiveTheme() {
  replaceCustomTheme(activeTheme.value)
  selectedThemeId.value = 'custom'
  announcement.value = `Utworzono wariant Custom na bazie motywu ${presetById(lastPresetThemeId.value).name}.`
}

function resetCustomTheme() {
  replaceCustomTheme(presetById(lastPresetThemeId.value))
  selectedThemeId.value = 'custom'
  announcement.value = 'Przywrócono wariant Custom do ostatnio wybranego presetu.'
}

function updateHexColor(key: ThemeColorKey, event: Event) {
  const input = event.target as HTMLInputElement
  const value = input.value.trim().toUpperCase()

  if (isHexColor(value)) {
    customTheme.colors[key] = value
    input.setCustomValidity('')
    return
  }

  input.setCustomValidity('Wpisz kolor w formacie #RRGGBB, np. #2563EB.')
}

function validateHexColor(event: FocusEvent) {
  const input = event.target as HTMLInputElement
  if (!input.checkValidity()) input.reportValidity()
}

function updateColorPicker(key: ThemeColorKey, event: Event) {
  const input = event.target as HTMLInputElement
  customTheme.colors[key] = input.value.toUpperCase()
}

function showSaveMessage(message: string) {
  saveMessage.value = message
  if (saveMessageTimer) clearTimeout(saveMessageTimer)
  saveMessageTimer = setTimeout(() => {
    saveMessage.value = ''
  }, 3200)
}

function saveTheme() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    activeThemeId: selectedThemeId.value,
    lastPresetThemeId: lastPresetThemeId.value,
    customTheme,
  }))
  showSaveMessage('Motyw zapisany na tym urządzeniu.')
  announcement.value = 'Motyw został zapisany na tym urządzeniu.'
}

onMounted(() => {
  loadThemeFonts()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return

    const stored = JSON.parse(raw) as {
      activeThemeId?: ThemeId
      lastPresetThemeId?: PresetThemeId
      customTheme?: unknown
    }
    const fallbackPresetId = presetThemeIds.includes(stored.lastPresetThemeId as PresetThemeId)
      ? stored.lastPresetThemeId as PresetThemeId
      : 'ocean'

    lastPresetThemeId.value = fallbackPresetId
    Object.assign(customTheme, normalizeCustomTheme(stored.customTheme, presetById(fallbackPresetId)))
    customInitialized.value = true

    if ([...presetThemeIds, 'custom'].includes(stored.activeThemeId as ThemeId)) {
      selectedThemeId.value = stored.activeThemeId as ThemeId
    }
  }
  catch {
    localStorage.removeItem(STORAGE_KEY)
  }
})

onBeforeUnmount(() => {
  if (saveMessageTimer) clearTimeout(saveMessageTimer)
})
</script>

<template>
  <div class="personalization-page">
    <header class="personalization-nav">
      <NuxtLink to="/" class="personalization-brand" aria-label="OpenExpert — wróć na stronę główną">
        <img src="/assets/logo-light.svg" alt="" width="29" height="29">
        <span>OpenExpert</span>
      </NuxtLink>

      <span class="personalization-nav__label">Laboratorium designu</span>

      <NuxtLink to="/" class="personalization-back">
        <Icon name="lucide:arrow-left" aria-hidden="true" />
        Strona główna
      </NuxtLink>
    </header>

    <main class="personalization-main">
      <section class="personalization-intro" aria-labelledby="personalization-title">
        <div>
          <p class="personalization-eyebrow">Personalizacja organizacji</p>
          <h1 id="personalization-title">CRM w rytmie{{ ' ' }}<br><em>Twojej marki.</em></h1>
        </div>
        <div class="personalization-intro__copy">
          <p>Wybierz gotową identyfikację lub zbuduj własną. Kolory, fonty i kształt aktualizują się od razu na żywym podglądzie sprawy obsługiwanej przez ekspertów i agentów AI.</p>
          <span>Demo zapisuje ustawienia lokalnie — bez zmiany danych organizacji.</span>
        </div>
      </section>

      <div class="personalization-mobile-tabs" role="group" aria-label="Widok konfiguratora">
        <button
          type="button"
          :class="{ 'is-active': mobileView === 'settings' }"
          :aria-pressed="mobileView === 'settings'"
          @click="mobileView = 'settings'"
        >
          <Icon name="lucide:settings" aria-hidden="true" />
          Ustawienia
        </button>
        <button
          type="button"
          :class="{ 'is-active': mobileView === 'preview' }"
          :aria-pressed="mobileView === 'preview'"
          @click="mobileView = 'preview'"
        >
          <Icon name="lucide:eye" aria-hidden="true" />
          Podgląd
        </button>
      </div>

      <div class="personalization-workspace" :class="`is-${mobileView}`">
        <aside class="personalization-controls" aria-label="Ustawienia motywu">
          <section class="controls-section">
            <div class="controls-section__heading">
              <span>01</span>
              <div>
                <p>Motyw</p>
                <h2>Wybierz punkt wyjścia</h2>
              </div>
            </div>

            <fieldset class="theme-picker">
              <legend class="visually-hidden">Motyw kolorystyczny CRM</legend>
              <label
                v-for="theme in themeCards"
                :key="theme.id"
                class="theme-card"
                :style="themeToCssVariables(theme)"
              >
                <input
                  v-model="selectedThemeId"
                  type="radio"
                  name="personalization-theme"
                  :value="theme.id"
                  @change="selectTheme(theme.id)"
                >
                <span class="theme-card__topline">
                  <strong>{{ theme.name }}</strong>
                  <span class="theme-card__check" aria-hidden="true"><Icon name="lucide:check" /></span>
                </span>
                <span class="theme-card__sample">Aa</span>
                <span class="theme-card__swatches" aria-hidden="true">
                  <i :style="{ background: theme.colors.primary }" />
                  <i :style="{ background: theme.colors.accent }" />
                  <i :style="{ background: theme.colors.background }" />
                  <i :style="{ background: theme.colors.text }" />
                </span>
              </label>
            </fieldset>

            <button
              v-if="selectedThemeId !== 'custom'"
              type="button"
              class="secondary-action"
              @click="customizeActiveTheme"
            >
              <Icon name="lucide:sliders-horizontal" aria-hidden="true" />
              Dostosuj ten wariant
            </button>
          </section>

          <section v-if="selectedThemeId === 'custom'" class="controls-section controls-section--custom">
            <div class="controls-section__heading">
              <span>02</span>
              <div>
                <p>Custom</p>
                <h2>Zbuduj własny motyw</h2>
              </div>
            </div>

            <div class="control-group">
              <div class="control-group__heading">
                <Icon name="lucide:palette" aria-hidden="true" />
                <div>
                  <h3>Kolory</h3>
                  <p>Wpisz HEX lub użyj próbnika.</p>
                </div>
              </div>

              <div class="color-controls">
                <label v-for="control in colorControls" :key="control.key" class="color-control">
                  <span>
                    <strong>{{ control.label }}</strong>
                    <small>{{ control.helper }}</small>
                  </span>
                  <span class="color-control__inputs">
                    <input
                      type="color"
                      :value="customTheme.colors[control.key]"
                      :aria-label="`Wybierz: ${control.label}`"
                      @input="updateColorPicker(control.key, $event)"
                    >
                    <input
                      type="text"
                      :value="customTheme.colors[control.key]"
                      maxlength="7"
                      spellcheck="false"
                      :aria-label="`${control.label} w formacie HEX`"
                      @input="updateHexColor(control.key, $event)"
                      @blur="validateHexColor"
                    >
                  </span>
                </label>
              </div>

              <div class="contrast-check" :class="{ 'is-warning': !contrastPasses }">
                <span>
                  <Icon :name="contrastPasses ? 'lucide:circle-check' : 'lucide:triangle-alert'" aria-hidden="true" />
                  Kontrast tekstu do powierzchni
                </span>
                <strong>{{ contrastRatio.toFixed(1) }}:1 · {{ contrastPasses ? 'AA' : 'poniżej AA' }}</strong>
              </div>
            </div>

            <div class="control-group">
              <div class="control-group__heading">
                <Icon name="lucide:type" aria-hidden="true" />
                <div>
                  <h3>Typografia</h3>
                  <p>Osobno dla nagłówków i treści.</p>
                </div>
              </div>

              <div class="select-controls">
                <label>
                  <span>Font nagłówków</span>
                  <select v-model="customTheme.fonts.display">
                    <option v-for="font in themeFontOptions" :key="font.value" :value="font.value">{{ font.label }}</option>
                  </select>
                </label>
                <label>
                  <span>Font interfejsu</span>
                  <select v-model="customTheme.fonts.body">
                    <option v-for="font in themeFontOptions" :key="font.value" :value="font.value">{{ font.label }}</option>
                  </select>
                </label>
              </div>

              <p class="font-note">Wszystkie warianty korzystają z krojów dostępnych w aplikacji lub systemie. DM Sans, Manrope i Roboto zapewniają spójny wygląd na różnych urządzeniach.</p>
            </div>

            <div class="control-group">
              <div class="control-group__heading">
                <Icon name="lucide:scan-line" aria-hidden="true" />
                <div>
                  <h3>Kształt</h3>
                  <p>Osobno dla powierzchni i kontrolek.</p>
                </div>
              </div>

              <div class="range-controls">
                <label class="range-control">
                  <span>Panele i karty <strong>{{ customTheme.radius }} px</strong></span>
                  <input v-model.number="customTheme.radius" type="range" min="0" max="24" step="1">
                </label>
                <label class="range-control">
                  <span>Przyciski i pola <strong>{{ customTheme.controlRadius }} px</strong></span>
                  <input v-model.number="customTheme.controlRadius" type="range" min="0" max="24" step="1">
                </label>
              </div>
            </div>

            <div class="custom-actions">
              <button type="button" class="primary-action" @click="saveTheme">
                <Icon name="lucide:save" aria-hidden="true" />
                Zapisz na tym urządzeniu
              </button>
              <button type="button" class="secondary-action" @click="resetCustomTheme">
                <Icon name="lucide:rotate-ccw" aria-hidden="true" />
                Przywróć preset
              </button>
            </div>
            <p class="save-message" aria-live="polite">{{ saveMessage }}</p>
          </section>
        </aside>

        <section class="personalization-preview" aria-labelledby="preview-title">
          <header class="preview-header">
            <div>
              <span class="preview-live"><i aria-hidden="true" /> Podgląd na żywo</span>
              <h2 id="preview-title">Sprawa klienta</h2>
            </div>
            <span class="preview-theme-name">
              <i :style="{ background: activeTheme.colors.primary }" aria-hidden="true" />
              {{ activeTheme.name }}
            </span>
          </header>

          <div class="preview-canvas" :style="activeThemeStyles">
            <PersonalizationCasePreview />
          </div>

          <footer class="preview-footer">
            <p><Icon name="lucide:bot" aria-hidden="true" /> Warstwa agentowa pozostaje czytelna w każdym wariancie marki.</p>
            <span>Widok responsywny</span>
          </footer>
        </section>
      </div>

      <p class="visually-hidden" aria-live="polite">{{ announcement }}</p>
    </main>
  </div>
</template>

<style scoped>
.personalization-page {
  min-width: 0;
  min-height: 100vh;
  background: #f3f3f0;
  color: #111;
  font-family: var(--font-sans);
}

.personalization-nav {
  display: grid;
  width: min(1600px, calc(100% - 64px));
  min-height: 78px;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  border-bottom: 1px solid #d8d8d3;
  margin: 0 auto;
}

.personalization-brand,
.personalization-back {
  display: inline-flex;
  width: fit-content;
  align-items: center;
  color: #111;
  text-decoration: none;
}

.personalization-brand {
  gap: 11px;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.025em;
}

.personalization-brand img {
  width: 29px;
  height: 29px;
}

.personalization-nav__label {
  color: #666;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.personalization-back {
  min-height: 44px;
  gap: 8px;
  justify-self: end;
  color: #4e4e4e;
  font-size: 13px;
  font-weight: 500;
}

.personalization-back:hover {
  color: #000;
}

.personalization-back :deep(svg) {
  width: 16px;
  height: 16px;
}

.personalization-main {
  width: min(1600px, calc(100% - 64px));
  margin: 0 auto;
  padding: 58px 0 72px;
}

.personalization-intro {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(360px, 0.85fr);
  align-items: end;
  gap: clamp(48px, 8vw, 140px);
  margin-bottom: 48px;
}

.personalization-eyebrow {
  margin-bottom: 20px;
  color: #6d6d68;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.personalization-intro h1 {
  color: #101010;
  font-size: clamp(52px, 5.6vw, 82px);
  font-variation-settings: 'opsz' 80, 'wght' 300;
  font-weight: 300;
  letter-spacing: -0.055em;
  line-height: 0.96;
}

.personalization-intro h1 em {
  font-family: var(--font-serif);
  font-style: italic;
  font-variation-settings: 'opsz' 80, 'wght' 340;
  font-weight: 340;
}

.personalization-intro__copy {
  max-width: 590px;
  padding-bottom: 4px;
}

.personalization-intro__copy p {
  margin-bottom: 16px;
  color: #4f4f4b;
  font-size: 17px;
  line-height: 1.65;
}

.personalization-intro__copy span {
  display: inline-flex;
  border-left: 2px solid #111;
  color: #767671;
  font-size: 12px;
  line-height: 1.5;
  padding-left: 12px;
}

.personalization-mobile-tabs {
  display: none;
}

.personalization-workspace {
  display: grid;
  grid-template-columns: 410px minmax(0, 1fr);
  align-items: start;
  gap: 24px;
}

.personalization-controls,
.personalization-preview {
  min-width: 0;
  border: 1px solid #deded9;
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 18px 50px rgba(29, 29, 25, 0.05);
}

.personalization-controls {
  overflow: hidden;
}

.controls-section {
  padding: 26px;
}

.controls-section + .controls-section {
  border-top: 1px solid #e4e4df;
}

.controls-section__heading {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 12px;
  margin-bottom: 22px;
}

.controls-section__heading > span {
  padding-top: 3px;
  color: #969691;
  font-family: var(--font-mono);
  font-size: 10px;
}

.controls-section__heading p {
  margin-bottom: 3px;
  color: #777772;
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.controls-section__heading h2 {
  color: #161616;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.025em;
}

.theme-picker {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  border: 0;
}

.theme-card {
  position: relative;
  display: flex;
  min-height: 142px;
  min-width: 0;
  flex-direction: column;
  border: 1px solid #dcdcd7;
  border-radius: var(--theme-radius);
  background: #fff;
  color: #151515;
  padding: 14px;
  cursor: pointer;
  transition: border-color 150ms ease, border-radius 220ms ease, box-shadow 150ms ease, transform 150ms ease;
}

.theme-card:hover {
  border-color: #999994;
  transform: translateY(-1px);
}

.theme-card:has(input:checked) {
  border-color: #161616;
  box-shadow: 0 0 0 1px #161616;
}

.theme-card:has(input:focus-visible) {
  outline: 2px solid #111;
  outline-offset: 3px;
}

.theme-card > input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  opacity: 0;
}

.theme-card__topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.theme-card__topline strong {
  font-size: 13px;
  font-weight: 650;
}

.theme-card__check {
  display: grid;
  width: 20px;
  height: 20px;
  place-items: center;
  border: 1px solid #d4d4cf;
  border-radius: 50%;
  color: transparent;
}

.theme-card:has(input:checked) .theme-card__check {
  border-color: #151515;
  background: #151515;
  color: #fff;
}

.theme-card__check :deep(svg) {
  width: 12px;
  height: 12px;
  stroke-width: 2;
}

.theme-card__sample {
  margin: 12px 0 auto;
  color: var(--theme-text);
  font-family: var(--theme-font-display);
  font-size: 29px;
  font-weight: 600;
  letter-spacing: -0.055em;
  line-height: 1;
}

.theme-card__swatches {
  display: grid;
  height: 15px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  overflow: hidden;
  border: 1px solid #e2e2dd;
  border-radius: var(--theme-control-radius);
  margin-top: 13px;
}

.theme-card__swatches i + i {
  border-left: 1px solid rgba(0, 0, 0, 0.08);
}

.font-note {
  color: #757570;
  font-size: 11px;
  line-height: 1.55;
}

.primary-action,
.secondary-action {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 8px;
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 600;
  padding: 10px 14px;
  cursor: pointer;
  transition: background 150ms ease, color 150ms ease, border-color 150ms ease;
}

.primary-action {
  border: 1px solid #111;
  background: #111;
  color: #fff;
}

.primary-action:hover {
  background: #343434;
}

.secondary-action {
  width: 100%;
  border: 1px solid #d6d6d1;
  background: #fff;
  color: #222;
}

.theme-picker + .secondary-action {
  margin-top: 16px;
}

.secondary-action:hover {
  border-color: #999994;
  background: #f5f5f2;
}

.primary-action :deep(svg),
.secondary-action :deep(svg) {
  width: 15px;
  height: 15px;
}

.controls-section--custom {
  background: #fbfbf9;
}

.control-group {
  border-top: 1px solid #deded9;
  padding: 22px 0 4px;
}

.control-group + .control-group {
  margin-top: 18px;
}

.control-group__heading {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 18px;
}

.control-group__heading :deep(svg) {
  width: 17px;
  height: 17px;
  flex: 0 0 auto;
  margin-top: 2px;
  stroke-width: 1.6;
}

.control-group__heading h3 {
  margin-bottom: 3px;
  color: #1d1d1d;
  font-size: 14px;
  font-weight: 650;
}

.control-group__heading p {
  color: #81817c;
  font-size: 11px;
}

.color-controls {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 10px;
}

.color-control {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
}

.color-control > span:first-child {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.color-control strong {
  color: #2d2d2a;
  font-size: 11px;
  font-weight: 600;
}

.color-control small {
  overflow: hidden;
  color: #8a8a85;
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.color-control__inputs {
  display: grid;
  min-width: 0;
  grid-template-columns: 38px minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid #d4d4cf;
  border-radius: 7px;
  background: #fff;
}

.color-control__inputs input[type='color'] {
  width: 38px;
  height: 37px;
  border: 0;
  border-right: 1px solid #d4d4cf;
  background: transparent;
  padding: 5px;
  cursor: pointer;
}

.color-control__inputs input[type='text'] {
  width: 100%;
  min-width: 0;
  border: 0;
  background: transparent;
  color: #333;
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 0 8px;
  text-transform: uppercase;
}

.color-control__inputs:focus-within {
  border-color: #111;
  box-shadow: 0 0 0 1px #111;
}

.contrast-check {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid #cddfcf;
  border-radius: 8px;
  background: #f2faf3;
  color: #1b5b25;
  margin-top: 16px;
  padding: 11px 12px;
}

.contrast-check.is-warning {
  border-color: #eed9a9;
  background: #fff8e8;
  color: #7b5410;
}

.contrast-check span {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
  font-size: 10px;
}

.contrast-check :deep(svg) {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
}

.contrast-check strong {
  flex: 0 0 auto;
  font-size: 10px;
}

.select-controls {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.select-controls label {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 7px;
  color: #343431;
  font-size: 10px;
  font-weight: 600;
}

.select-controls select {
  width: 100%;
  min-width: 0;
  height: 40px;
  border: 1px solid #d4d4cf;
  border-radius: 7px;
  background: #fff;
  color: #333;
  font-family: var(--font-sans);
  font-size: 10px;
  padding: 0 28px 0 10px;
}

.font-note {
  margin-top: 12px;
}

.range-controls,
.range-control {
  display: flex;
  flex-direction: column;
}

.range-controls {
  gap: 17px;
}

.range-control {
  gap: 11px;
}

.range-control > span {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #4e4e49;
  font-size: 11px;
}

.range-control strong {
  color: #111;
  font-family: var(--font-mono);
  font-size: 10px;
}

.range-control input {
  width: 100%;
  accent-color: #111;
}

.custom-actions {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 0.75fr);
  gap: 8px;
  margin-top: 24px;
}

.custom-actions .secondary-action {
  width: auto;
}

.save-message {
  min-height: 18px;
  margin-top: 8px;
  color: #3f6d46;
  font-size: 10px;
  text-align: center;
}

.personalization-preview {
  position: sticky;
  top: 18px;
  overflow: hidden;
  padding: 24px;
}

.preview-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  padding: 2px 2px 22px;
}

.preview-live {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 8px;
  color: #777772;
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.preview-live i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #2f9e44;
  box-shadow: 0 0 0 4px rgba(47, 158, 68, 0.12);
}

.preview-header h2 {
  color: #171717;
  font-size: 23px;
  font-weight: 600;
  letter-spacing: -0.03em;
}

.preview-theme-name {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid #d8d8d3;
  border-radius: 999px;
  color: #555550;
  font-size: 11px;
  font-weight: 600;
  padding: 7px 11px;
}

.preview-theme-name i {
  width: 9px;
  height: 9px;
  border-radius: 50%;
}

.preview-canvas {
  min-width: 0;
  border: 1px solid #e1e1dc;
  border-radius: 14px;
  background: var(--theme-background);
  padding: clamp(12px, 1.5vw, 24px);
  transition: background 220ms ease;
}

.preview-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 18px 2px 0;
  color: #7d7d78;
  font-size: 10px;
}

.preview-footer p {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.preview-footer :deep(svg) {
  width: 14px;
  height: 14px;
}

.preview-footer > span {
  flex: 0 0 auto;
  font-family: var(--font-mono);
  letter-spacing: 0.07em;
  text-transform: uppercase;
}

.visually-hidden {
  position: absolute !important;
  width: 1px !important;
  height: 1px !important;
  overflow: hidden !important;
  clip: rect(0 0 0 0) !important;
  clip-path: inset(50%) !important;
  white-space: nowrap !important;
}

.personalization-page :is(a, button, input, select):focus-visible {
  outline: 2px solid #111;
  outline-offset: 3px;
}

@media (max-width: 1180px) {
  .personalization-workspace {
    grid-template-columns: 380px minmax(0, 1fr);
  }

  .personalization-nav,
  .personalization-main {
    width: min(100% - 40px, 1600px);
  }
}

@media (min-width: 961px) and (max-width: 1320px) {
  .personalization-workspace {
    display: block;
  }

  .personalization-controls,
  .personalization-preview {
    width: 100%;
  }

  .personalization-preview {
    position: static;
    margin-top: 24px;
  }

  .theme-picker {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .color-controls {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (max-width: 960px) {
  .personalization-main {
    padding-top: 40px;
  }

  .personalization-intro {
    grid-template-columns: 1fr;
    gap: 28px;
    margin-bottom: 32px;
  }

  .personalization-intro__copy {
    max-width: 700px;
  }

  .personalization-mobile-tabs {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    border: 1px solid #d7d7d2;
    border-radius: 10px;
    background: #e9e9e5;
    gap: 4px;
    margin-bottom: 16px;
    padding: 4px;
  }

  .personalization-mobile-tabs button {
    display: inline-flex;
    min-height: 44px;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: #64645f;
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 600;
  }

  .personalization-mobile-tabs button.is-active {
    background: #fff;
    box-shadow: 0 1px 4px rgba(20, 20, 18, 0.08);
    color: #111;
  }

  .personalization-mobile-tabs :deep(svg) {
    width: 16px;
    height: 16px;
  }

  .personalization-workspace {
    display: block;
  }

  .personalization-workspace.is-settings .personalization-preview,
  .personalization-workspace.is-preview .personalization-controls {
    display: none;
  }

  .personalization-controls,
  .personalization-preview {
    width: 100%;
  }

  .personalization-preview {
    position: static;
  }
}

@media (max-width: 640px) {
  .personalization-nav,
  .personalization-main {
    width: calc(100% - 28px);
  }

  .personalization-nav {
    min-height: 68px;
    grid-template-columns: 1fr auto;
  }

  .personalization-nav__label {
    display: none;
  }

  .personalization-brand {
    font-size: 18px;
  }

  .personalization-back {
    font-size: 0;
  }

  .personalization-back :deep(svg) {
    width: 19px;
    height: 19px;
  }

  .personalization-main {
    padding: 34px 0 52px;
  }

  .personalization-intro h1 {
    font-size: clamp(46px, 14vw, 62px);
  }

  .personalization-intro__copy p {
    font-size: 15px;
  }

  .controls-section {
    padding: 22px 18px;
  }

  .personalization-controls,
  .personalization-preview {
    border-radius: 14px;
  }

  .personalization-preview {
    padding: 15px;
  }

  .preview-header {
    padding: 5px 2px 16px;
  }

  .preview-theme-name {
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .preview-canvas {
    padding: 8px;
  }

  .preview-footer {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }

  .color-controls,
  .select-controls {
    grid-template-columns: 1fr;
  }

  .custom-actions {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .personalization-page *,
  .personalization-page *::before,
  .personalization-page *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}
</style>
