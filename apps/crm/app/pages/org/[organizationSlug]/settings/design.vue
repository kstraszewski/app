<script setup lang="ts">
import type { DesignColorTokens, OrganizationDesignSettings } from '#shared/design'
import {
  buildOrganizationDesignCss,
  cloneDefaultOrganizationDesign,
  fontFamilyOptions,
  normalizeOrganizationDesign,
} from '#shared/design'

definePageMeta({ middleware: ['auth', 'organization'] })
useHead({ title: 'Design — Ustawienia — OpenExpert CRM' })

const { orgApiPath } = useOrganizationContext()
const toast = useToast()
const organizationDesign = useOrganizationDesignState()
const activeSection = ref('brand')
const activeColorMode = ref<'light' | 'dark'>('light')
const previewSurface = ref<'app' | 'brand'>('app')
const saving = ref(false)
const fontFamilyItems = [...fontFamilyOptions]

const { data: response, error: designError } = await useFetch<{
  data: OrganizationDesignSettings
  canEdit: boolean
  updatedAt: string | null
}>(() => orgApiPath('/design'))

const draft = reactive<OrganizationDesignSettings>(cloneDefaultOrganizationDesign())
const saved = ref<OrganizationDesignSettings>(cloneDefaultOrganizationDesign())

function replaceDraft(value: unknown) {
  const normalized = normalizeOrganizationDesign(value)
  Object.assign(draft, normalized)
  saved.value = normalizeOrganizationDesign(normalized)
  organizationDesign.value = normalizeOrganizationDesign(normalized)
}

watch(() => response.value?.data, value => {
  if (value) replaceDraft(value)
}, { immediate: true })

watch(draft, value => {
  organizationDesign.value = normalizeOrganizationDesign(value)
}, { deep: true })

onBeforeUnmount(() => {
  organizationDesign.value = normalizeOrganizationDesign(saved.value)
})

const isDirty = computed(() => (
  JSON.stringify(normalizeOrganizationDesign(draft)) !== JSON.stringify(saved.value)
))
const activeColors = computed(() => draft.colors[activeColorMode.value])
const generatedCss = computed(() => buildOrganizationDesignCss(draft))

const sectionItems = [
  { label: 'Marka', value: 'brand', icon: 'i-lucide-sparkles' },
  { label: 'Kolory', value: 'colors', icon: 'i-lucide-palette' },
  { label: 'Typografia', value: 'typography', icon: 'i-lucide-type' },
  { label: 'Kształt i layout', value: 'shape', icon: 'i-lucide-scan-line' },
  { label: 'Ruch', value: 'motion', icon: 'i-lucide-gauge' },
]

const modeItems = [
  { label: 'Jasny', value: 'light', icon: 'i-lucide-sun' },
  { label: 'Ciemny', value: 'dark', icon: 'i-lucide-moon' },
]

const previewSurfaceItems = [
  { label: 'Aplikacja', value: 'app', icon: 'i-lucide-panels-top-left' },
  { label: 'Marka', value: 'brand', icon: 'i-lucide-swatch-book' },
]

const activeSectionIndex = computed(() => Math.max(
  0,
  sectionItems.findIndex(item => item.value === activeSection.value),
))
const sectionProgress = computed(() => (
  ((activeSectionIndex.value + 1) / sectionItems.length) * 100
))

type ColorKey = keyof DesignColorTokens
const colorGroups: Array<{
  label: string
  description: string
  tokens: Array<{ key: ColorKey, label: string, token: string }>
}> = [
  {
    label: 'Semantyczne',
    description: 'Akcje, statusy i komunikaty w całym produkcie.',
    tokens: [
      { key: 'primary', label: 'Primary', token: '--ui-primary' },
      { key: 'secondary', label: 'Secondary', token: '--ui-secondary' },
      { key: 'info', label: 'Info', token: '--ui-info' },
      { key: 'success', label: 'Success', token: '--ui-success' },
      { key: 'warning', label: 'Warning', token: '--ui-warning' },
      { key: 'error', label: 'Error', token: '--ui-error' },
    ],
  },
  {
    label: 'Tekst',
    description: 'Hierarchia treści i kontrast na powierzchniach.',
    tokens: [
      { key: 'textHighlighted', label: 'Highlighted', token: '--ui-text-highlighted' },
      { key: 'text', label: 'Default', token: '--ui-text' },
      { key: 'textToned', label: 'Toned', token: '--ui-text-toned' },
      { key: 'textMuted', label: 'Muted', token: '--ui-text-muted' },
      { key: 'textDimmed', label: 'Dimmed', token: '--ui-text-dimmed' },
      { key: 'textInverted', label: 'Inverted', token: '--ui-text-inverted' },
    ],
  },
  {
    label: 'Powierzchnie',
    description: 'Tła stron, kart, hoverów i odwróconych sekcji.',
    tokens: [
      { key: 'background', label: 'Default', token: '--ui-bg' },
      { key: 'backgroundMuted', label: 'Muted', token: '--ui-bg-muted' },
      { key: 'backgroundElevated', label: 'Elevated', token: '--ui-bg-elevated' },
      { key: 'backgroundAccented', label: 'Accented', token: '--ui-bg-accented' },
      { key: 'backgroundInverted', label: 'Inverted', token: '--ui-bg-inverted' },
    ],
  },
  {
    label: 'Obrysy',
    description: 'Separatory, ramki formularzy i aktywne granice.',
    tokens: [
      { key: 'border', label: 'Default', token: '--ui-border' },
      { key: 'borderMuted', label: 'Muted', token: '--ui-border-muted' },
      { key: 'borderAccented', label: 'Accented', token: '--ui-border-accented' },
      { key: 'borderInverted', label: 'Inverted', token: '--ui-border-inverted' },
    ],
  },
]

const typographyWeights = [
  { label: '300 — Light', value: 300 },
  { label: '400 — Regular', value: 400 },
  { label: '500 — Medium', value: 500 },
  { label: '600 — Semibold', value: 600 },
  { label: '700 — Bold', value: 700 },
  { label: '800 — Extra bold', value: 800 },
]

async function saveDesign() {
  if (!response.value?.canEdit || saving.value) return
  saving.value = true
  try {
    const result = await $fetch<{ data: OrganizationDesignSettings, updatedAt: string }>(orgApiPath('/design'), {
      method: 'PATCH',
      body: normalizeOrganizationDesign(draft),
    })
    replaceDraft(result.data)
    if (response.value) response.value.updatedAt = result.updatedAt
    toast.add({
      title: 'Design zapisany',
      description: 'Tokeny zostały zastosowane dla całej organizacji.',
      color: 'success',
      icon: 'i-lucide-check',
    })
  } catch {
    toast.add({
      title: 'Nie udało się zapisać designu',
      color: 'error',
      icon: 'i-lucide-alert-triangle',
    })
  } finally {
    saving.value = false
  }
}

function resetToDefault() {
  Object.assign(draft, cloneDefaultOrganizationDesign())
  toast.add({
    title: 'Przywrócono preset domyślny',
    description: 'Zapisz zmiany, aby opublikować go dla organizacji.',
    color: 'info',
  })
}

function discardChanges() {
  Object.assign(draft, normalizeOrganizationDesign(saved.value))
}

async function copyTokens() {
  await navigator.clipboard.writeText(generatedCss.value)
  toast.add({ title: 'Skopiowano CSS tokenów', color: 'success' })
}
</script>

<template>
  <CrmShell class="design-system-shell" title="Design system">
    <template #meta>
      <p class="design-header__description">Dopasuj wygląd aplikacji do swojej organizacji.</p>
    </template>

    <template #actions>
      <div v-if="designError" class="design-header__status design-header__status--error">
        <span />
        Błąd pobierania ustawień
      </div>
      <div v-else class="design-header__status" :class="{ 'design-header__status--dirty': isDirty }">
        <span />
        {{ isDirty ? 'Niezapisane zmiany' : 'Wszystkie zmiany zapisane' }}
      </div>
      <UButton
        color="neutral"
        variant="ghost"
        icon="i-lucide-rotate-ccw"
        square
        aria-label="Przywróć domyślny preset"
        title="Przywróć domyślny preset"
        :disabled="!response?.canEdit"
        @click="resetToDefault"
      />
      <UButton
        v-if="isDirty"
        color="neutral"
        variant="ghost"
        icon="i-lucide-undo-2"
        @click="discardChanges"
      >
        Odrzuć
      </UButton>
      <UButton
        color="neutral"
        variant="solid"
        icon="i-lucide-save"
        :loading="saving"
        :disabled="!response?.canEdit || !isDirty"
        @click="saveDesign"
      >
        Zapisz zmiany
      </UButton>
    </template>

    <OrganizationSettingsNav />

    <UAlert
      v-if="designError"
      class="design-editor__alert"
      color="error"
      variant="subtle"
      icon="i-lucide-cloud-alert"
      title="Nie udało się pobrać ustawień designu"
      description="Odśwież stronę i spróbuj ponownie. Do tego czasu edycja pozostaje zablokowana."
    />

    <UAlert
      v-else-if="response && !response.canEdit"
      class="design-editor__alert"
      color="warning"
      variant="subtle"
      icon="i-lucide-lock-keyhole"
      title="Tryb tylko do odczytu"
      description="Tylko administrator organizacji może zmieniać design system."
    />

    <div class="design-editor">
      <aside class="design-editor__controls">
        <div class="design-section-bar">
          <UTabs
            v-model="activeSection"
            :items="sectionItems"
            class="design-editor__tabs"
            :content="false"
          />
          <div class="design-section-progress" aria-live="polite">
            <span>Sekcja {{ activeSectionIndex + 1 }} z {{ sectionItems.length }}</span>
            <UProgress
              :model-value="sectionProgress"
              color="neutral"
              size="xs"
              :aria-label="`Pozycja sekcji: ${activeSectionIndex + 1} z ${sectionItems.length}`"
            />
          </div>
        </div>

        <div class="design-editor__panel">
          <fieldset class="design-editor__fieldset" :disabled="!response?.canEdit">
            <section v-if="activeSection === 'brand'" class="editor-section">
            <div class="editor-section__head">
              <p>Marka</p>
              <h2>Tożsamość produktu</h2>
              <span>Ustaw nazwę oraz warianty logo używane na jasnych i ciemnych powierzchniach.</span>
            </div>

            <div class="editor-field-group">
              <UFormField label="Nazwa produktu" description="Widoczna w navbarze i materiałach marki.">
                <UInput v-model="draft.branding.productName" class="w-full" />
              </UFormField>
              <UFormField label="Logo na jasnym tle" description="Ścieżka lokalna lub bezpieczny URL HTTPS.">
                <UInput v-model="draft.branding.logoOnLight" class="w-full" icon="i-lucide-image" />
              </UFormField>
              <UFormField label="Logo na ciemnym tle" description="Ten wariant jest używany w czarnym navbarze.">
                <UInput v-model="draft.branding.logoOnDark" class="w-full" icon="i-lucide-image" />
              </UFormField>
            </div>

            <div class="editor-subsection-head">
              <h3>Nawigacja</h3>
              <span>Kolory bocznego navbaru i jego treści.</span>
            </div>

            <div class="editor-color-pair">
              <label>
                <span>Tło navbaru</span>
                <div class="color-control">
                  <input v-model="draft.branding.sidebarBackground" type="color" aria-label="Tło navbaru">
                  <UInput v-model="draft.branding.sidebarBackground" />
                </div>
              </label>
              <label>
                <span>Tekst navbaru</span>
                <div class="color-control">
                  <input v-model="draft.branding.sidebarForeground" type="color" aria-label="Tekst navbaru">
                  <UInput v-model="draft.branding.sidebarForeground" />
                </div>
              </label>
            </div>
            </section>

            <section v-else-if="activeSection === 'colors'" class="editor-section">
            <div class="editor-section__head editor-section__head--inline">
              <div>
                <p>Kolorystyka</p>
                <h2>Tokeny semantyczne</h2>
              </div>
              <UTabs v-model="activeColorMode" :items="modeItems" :content="false" class="mode-tabs" />
            </div>

            <div v-for="group in colorGroups" :key="group.label" class="token-group">
              <div class="token-group__head">
                <strong>{{ group.label }}</strong>
                <span>{{ group.description }}</span>
              </div>
              <div class="token-list">
                <label v-for="token in group.tokens" :key="token.key" class="token-control">
                  <input v-model="activeColors[token.key]" type="color" :aria-label="token.label">
                  <span>
                    <strong>{{ token.label }}</strong>
                    <code>{{ token.token }}</code>
                  </span>
                  <UInput v-model="activeColors[token.key]" size="sm" />
                </label>
              </div>
            </div>
            </section>

            <section v-else-if="activeSection === 'typography'" class="editor-section">
            <div class="editor-section__head">
              <p>Typografia</p>
              <h2>Rodziny i hierarchia</h2>
              <span>Kontroluj krój, wagę i rytm tekstu bez zmiany komponentów.</span>
            </div>

            <div class="editor-grid editor-grid--two">
              <UFormField label="Tekst bazowy">
                <USelect v-model="draft.typography.bodyFamily" :items="fontFamilyItems" class="w-full" />
              </UFormField>
              <UFormField label="Nagłówki">
                <USelect v-model="draft.typography.displayFamily" :items="fontFamilyItems" class="w-full" />
              </UFormField>
              <UFormField label="Akcent serif">
                <USelect v-model="draft.typography.serifFamily" :items="fontFamilyItems" class="w-full" />
              </UFormField>
              <UFormField label="Dane i kod">
                <USelect v-model="draft.typography.monoFamily" :items="fontFamilyItems" class="w-full" />
              </UFormField>
            </div>

            <div class="editor-grid editor-grid--two">
              <UFormField label="Rozmiar bazowy" :hint="`${draft.typography.baseSize}px`">
                <USlider v-model="draft.typography.baseSize" :min="13" :max="20" :step="1" />
              </UFormField>
              <UFormField label="Interlinia" :hint="String(draft.typography.lineHeight)">
                <USlider v-model="draft.typography.lineHeight" :min="1.2" :max="1.9" :step="0.05" />
              </UFormField>
              <UFormField label="Waga tekstu">
                <USelect v-model="draft.typography.bodyWeight" :items="typographyWeights" class="w-full" />
              </UFormField>
              <UFormField label="Waga nagłówków">
                <USelect v-model="draft.typography.headingWeight" :items="typographyWeights" class="w-full" />
              </UFormField>
            </div>

            <UFormField label="Tracking nagłówków" :hint="`${draft.typography.headingTracking}em`">
              <USlider v-model="draft.typography.headingTracking" :min="-0.06" :max="0.08" :step="0.005" />
            </UFormField>
            </section>

            <section v-else-if="activeSection === 'shape'" class="editor-section">
            <div class="editor-section__head">
              <p>Kształt i layout</p>
              <h2>Radius, rozmiary i gęstość</h2>
              <span>Wszystkie kontrolki i powierzchnie dziedziczą te wartości globalnie.</span>
            </div>

            <div class="editor-grid editor-grid--two">
              <UFormField label="Radius bazowy" :hint="`${draft.shape.radiusBase}px`">
                <USlider v-model="draft.shape.radiusBase" :min="0" :max="28" />
              </UFormField>
              <UFormField label="Kontrolki" :hint="`${draft.shape.radiusControl}px`">
                <USlider v-model="draft.shape.radiusControl" :min="0" :max="28" />
              </UFormField>
              <UFormField label="Karty" :hint="`${draft.shape.radiusSurface}px`">
                <USlider v-model="draft.shape.radiusSurface" :min="0" :max="40" />
              </UFormField>
              <UFormField label="Elementy wyróżnione" :hint="`${draft.shape.radiusEmphasis}px`">
                <USlider v-model="draft.shape.radiusEmphasis" :min="0" :max="56" />
              </UFormField>
            </div>

            <div class="editor-grid editor-grid--three">
              <UFormField label="Wysokość kontrolek" description="32–56 px">
                <UInputNumber v-model="draft.shape.controlHeight" :min="32" :max="56" class="w-full" />
              </UFormField>
              <UFormField label="Padding przycisku X" description="8–28 px">
                <UInputNumber v-model="draft.shape.buttonPaddingX" :min="8" :max="28" class="w-full" />
              </UFormField>
              <UFormField label="Waga przycisku">
                <USelect v-model="draft.shape.buttonFontWeight" :items="typographyWeights" class="w-full" />
              </UFormField>
            </div>

            <div class="editor-grid editor-grid--two">
              <UFormField label="Maks. szerokość treści" description="960–1920 px">
                <UInputNumber v-model="draft.layout.contentWidth" :min="960" :max="1920" :step="16" class="w-full" />
              </UFormField>
              <UFormField label="Skala odstępów" description="0.8–1.3">
                <UInputNumber v-model="draft.layout.spacingScale" :min="0.8" :max="1.3" :step="0.05" class="w-full" />
              </UFormField>
              <UFormField label="Szerokość navbaru">
                <UInputNumber v-model="draft.layout.sidebarWidth" :min="220" :max="360" class="w-full" />
              </UFormField>
              <UFormField label="Navbar mini">
                <UInputNumber v-model="draft.layout.sidebarCollapsedWidth" :min="60" :max="96" class="w-full" />
              </UFormField>
            </div>
            </section>

            <section v-else class="editor-section">
            <div class="editor-section__head">
              <p>Ruch</p>
              <h2>Tempo interakcji</h2>
              <span>Czasy przejść są tokenami i respektują systemowe reduced motion.</span>
            </div>
            <div class="editor-grid editor-grid--three">
              <UFormField label="Szybkie" :hint="`${draft.motion.fast}ms`">
                <USlider v-model="draft.motion.fast" :min="0" :max="500" :step="10" />
              </UFormField>
              <UFormField label="Bazowe" :hint="`${draft.motion.base}ms`">
                <USlider v-model="draft.motion.base" :min="0" :max="700" :step="10" />
              </UFormField>
              <UFormField label="Wolne" :hint="`${draft.motion.slow}ms`">
                <USlider v-model="draft.motion.slow" :min="0" :max="1000" :step="10" />
              </UFormField>
            </div>
            <div class="motion-preview">
              <span />
              Zmień wartości, aby zobaczyć tempo hover i focus w podglądzie.
            </div>
            </section>
          </fieldset>

          <div class="editor-footer">
            <UButton color="neutral" variant="ghost" icon="i-lucide-undo-2" :disabled="!isDirty" @click="discardChanges">
              Odrzuć zmiany
            </UButton>
            <UButton color="neutral" variant="ghost" icon="i-lucide-copy" @click="copyTokens">
              Kopiuj CSS
            </UButton>
          </div>
        </div>
      </aside>

      <section class="design-preview" aria-label="Podgląd design systemu">
        <div class="design-preview__head">
          <div>
            <p>Podgląd</p>
            <span>Aktualizuje się wraz ze zmianami.</span>
          </div>
          <UColorModeSelect class="preview-color-mode" aria-label="Motyw podglądu" />
        </div>

        <UTabs
          v-model="previewSurface"
          :items="previewSurfaceItems"
          :content="false"
          class="preview-surface-tabs"
        />

        <div v-if="previewSurface === 'brand'" class="brand-preview-grid">
          <div class="brand-preview brand-preview--light">
            <img :src="draft.branding.logoOnLight" alt="">
            <strong>{{ draft.branding.productName }}</strong>
            <span>Logo na jasnej powierzchni</span>
          </div>
          <div class="brand-preview brand-preview--dark">
            <img :src="draft.branding.logoOnDark" alt="">
            <strong>{{ draft.branding.productName }}</strong>
            <span>Logo na ciemnej powierzchni</span>
          </div>
        </div>

        <div v-else class="preview-dashboard">
          <aside>
            <div class="preview-dashboard__brand">
              <img :src="draft.branding.logoOnDark" alt="">
              <strong>{{ draft.branding.productName }}</strong>
            </div>
            <span class="preview-dashboard__section">Kalkulatory</span>
            <a><UIcon name="i-lucide-calculator" />Zdolność</a>
            <a><UIcon name="i-lucide-house" />Hipoteki</a>
            <span class="preview-dashboard__section">Ekspert</span>
            <a class="active"><UIcon name="i-lucide-layout-dashboard" />Dashboard</a>
            <a><UIcon name="i-lucide-briefcase-business" />Sprawy</a>
            <a><UIcon name="i-lucide-calendar-days" />Kalendarz</a>
            <a><UIcon name="i-lucide-users" />Klienci</a>
            <a><UIcon name="i-lucide-code-xml" />Widgety</a>
          </aside>
          <main>
            <div class="preview-toolbar">
              <div>
                <p>Organizacja</p>
                <h3>Przegląd biznesu</h3>
              </div>
              <UButton size="sm" color="neutral" variant="solid" icon="i-lucide-plus">Dodaj klienta</UButton>
            </div>
            <div class="preview-metrics">
              <UCard>
                <span>Nowe sprawy</span>
                <strong>24</strong>
                <small>+12% w tym tygodniu</small>
              </UCard>
              <UCard>
                <span>Wartość spraw</span>
                <strong>1,08 mln zł</strong>
                <small>+8% w tym tygodniu</small>
              </UCard>
              <UCard>
                <span>Spotkania</span>
                <strong>12</strong>
                <small>4 dzisiaj</small>
              </UCard>
            </div>

            <UCard class="preview-activity-card">
              <template #header>
                <div class="preview-card-head">
                  <div>
                    <strong>Nadchodzące zadania</strong>
                    <span>Najważniejsze aktywności zespołu.</span>
                  </div>
                  <UButton size="xs" color="neutral" variant="ghost" trailing-icon="i-lucide-arrow-right">Wszystkie</UButton>
                </div>
              </template>
              <div class="preview-activity-list">
                <div>
                  <span class="preview-activity-icon"><UIcon name="i-lucide-file-check-2" /></span>
                  <span><strong>Przygotuj ofertę dla ABC Sp. z o.o.</strong><small>Oferta kredytowa</small></span>
                  <time>Dzisiaj, 11:00</time>
                </div>
                <div>
                  <span class="preview-activity-icon"><UIcon name="i-lucide-phone" /></span>
                  <span><strong>Kontakt z Janem Kowalskim</strong><small>Telefon</small></span>
                  <time>Jutro, 09:30</time>
                </div>
                <div>
                  <span class="preview-activity-icon"><UIcon name="i-lucide-calendar-check" /></span>
                  <span><strong>Podsumowanie sprawy hipotecznej</strong><small>Spotkanie</small></span>
                  <time>17 maj, 14:00</time>
                </div>
              </div>
            </UCard>
          </main>
        </div>
      </section>
    </div>
  </CrmShell>
</template>

<style scoped>
.design-editor__alert {
  margin-bottom: 20px;
}

.design-editor {
  display: grid;
  grid-template-columns: minmax(460px, 0.8fr) minmax(520px, 1.2fr);
  gap: 24px;
  align-items: start;
}

.design-editor__controls {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  overflow: hidden;
  background: var(--ui-bg);
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
}

.design-editor__tabs {
  align-items: stretch;
  padding: 12px;
  background: var(--ui-bg-muted);
  border-right: 1px solid var(--ui-border);
}

.design-editor__panel {
  min-width: 0;
  padding: calc(24px * var(--oe-spacing-scale));
}

.editor-section,
.token-group,
.token-list {
  display: grid;
}

.editor-section {
  gap: calc(22px * var(--oe-spacing-scale));
}

.editor-section__head {
  display: grid;
  gap: 6px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--ui-border);
}

.editor-section__head--inline,
.design-preview__head,
.preview-toolbar,
.preview-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.editor-section__head p,
.design-preview__head p,
.preview-toolbar p {
  margin: 0;
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.editor-section__head h2,
.design-preview__head h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 22px;
}

.editor-section__head span,
.token-group__head span,
.preview-card-head span {
  color: var(--ui-text-muted);
  font-size: 13px;
  line-height: 1.5;
}

.editor-grid,
.editor-color-pair {
  display: grid;
  gap: 16px;
}

.editor-grid--two,
.editor-color-pair {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.editor-grid--three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.editor-color-pair label {
  display: grid;
  gap: 8px;
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 600;
}

.color-control {
  display: grid;
  grid-template-columns: 42px 1fr;
  gap: 8px;
}

.color-control input,
.token-control > input {
  width: 100%;
  height: var(--oe-control-height);
  padding: 4px;
  overflow: hidden;
  background: var(--ui-bg);
  border: 1px solid var(--ui-border-accented);
  border-radius: var(--oe-radius-control);
  cursor: pointer;
}

.token-group {
  gap: 12px;
}

.token-group__head {
  display: grid;
  gap: 2px;
}

.token-group__head strong {
  color: var(--ui-text-highlighted);
  font-size: 14px;
}

.token-list {
  gap: 1px;
  overflow: hidden;
  background: var(--ui-border);
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
}

.token-control {
  display: grid;
  grid-template-columns: 40px minmax(120px, 1fr) 120px;
  gap: 10px;
  align-items: center;
  min-height: 56px;
  padding: 8px;
  background: var(--ui-bg);
}

.token-control > input {
  height: 40px;
}

.token-control > span {
  display: grid;
  gap: 2px;
}

.token-control strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.token-control code {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.mode-tabs {
  width: 170px;
}

.editor-footer {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding-top: 18px;
  border-top: 1px solid var(--ui-border);
}

.motion-preview {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 72px;
  padding: 16px;
  color: var(--ui-text-toned);
  background: var(--ui-bg-muted);
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  transition: transform var(--oe-motion-base), background var(--oe-motion-base);
}

.motion-preview:hover {
  background: var(--ui-bg-elevated);
  transform: translateY(-3px);
}

.motion-preview span {
  width: 12px;
  height: 12px;
  border-radius: 999px;
  background: var(--ui-primary);
}

.design-preview {
  position: sticky;
  top: 24px;
  display: grid;
  gap: 18px;
  min-width: 0;
}

.brand-preview-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.brand-preview {
  display: grid;
  grid-template-columns: 28px 1fr;
  gap: 2px 10px;
  align-items: center;
  min-height: 96px;
  padding: 18px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
}

.brand-preview img {
  grid-row: span 2;
  width: 28px;
  height: 28px;
  object-fit: contain;
}

.brand-preview span {
  font-size: 11px;
  opacity: 0.62;
}

.brand-preview--light {
  color: #0a0a0a;
  background: #ffffff;
}

.brand-preview--dark {
  color: var(--oe-sidebar-fg);
  background: var(--oe-sidebar-bg);
  border-color: color-mix(in srgb, var(--oe-sidebar-fg) 16%, transparent);
}

.preview-dashboard {
  display: grid;
  grid-template-columns: 170px minmax(0, 1fr);
  min-height: 620px;
  overflow: hidden;
  background: var(--ui-bg-muted);
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-emphasis);
}

.preview-dashboard > aside {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 18px 12px;
  color: var(--oe-sidebar-fg);
  background: var(--oe-sidebar-bg);
}

.preview-dashboard__brand,
.preview-dashboard > aside a {
  display: flex;
  align-items: center;
  gap: 9px;
}

.preview-dashboard__brand {
  margin: 0 8px 22px;
}

.preview-dashboard__brand img {
  width: 20px;
  height: 20px;
  object-fit: contain;
}

.preview-dashboard__section {
  margin: 0 9px 4px;
  color: color-mix(in srgb, var(--oe-sidebar-fg) 48%, transparent);
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.preview-dashboard > aside a {
  min-height: 36px;
  padding: 0 9px;
  color: color-mix(in srgb, var(--oe-sidebar-fg) 64%, transparent);
  border: 1px solid transparent;
  border-radius: var(--oe-radius-control);
  font-size: 12px;
}

.preview-dashboard > aside a.active {
  color: var(--oe-sidebar-fg);
  border-color: color-mix(in srgb, var(--oe-sidebar-fg) 18%, transparent);
}

.preview-dashboard > main {
  display: grid;
  align-content: start;
  gap: 18px;
  min-width: 0;
  padding: 24px;
}

.preview-toolbar h3 {
  margin: 4px 0 0;
  color: var(--ui-text-highlighted);
  font-size: 26px;
}

.preview-metrics {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.preview-metrics > :deep([data-slot="root"]) {
  min-width: 0;
}

.preview-metrics span {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.preview-metrics strong {
  display: block;
  margin: 10px 0;
  color: var(--ui-text-highlighted);
  font-size: 30px;
}

.preview-card-head > div {
  display: grid;
  gap: 3px;
}

.preview-form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

@media (max-width: 1320px) {
  .design-editor {
    grid-template-columns: 1fr;
  }

  .design-preview {
    position: static;
  }
}

@media (max-width: 760px) {
  .design-editor__controls {
    grid-template-columns: 1fr;
  }

  .design-editor__tabs {
    border-right: 0;
    border-bottom: 1px solid var(--ui-border);
  }

  .editor-grid--two,
  .editor-grid--three,
  .editor-color-pair,
  .brand-preview-grid,
  .preview-form,
  .preview-metrics {
    grid-template-columns: 1fr;
  }

  .preview-dashboard {
    grid-template-columns: 72px minmax(0, 1fr);
  }

  .preview-dashboard__brand strong,
  .preview-dashboard > aside a:not(.active) {
    display: none;
  }
}

/* Option 3: one continuous workspace with horizontal navigation and a sticky preview. */
.design-header__description {
  margin: 2px 0 0;
  color: var(--ui-text-muted);
  font-size: 14px;
}

.design-header__status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--ui-text-muted);
  font-size: 13px;
  white-space: nowrap;
}

.design-header__status > span {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--ui-success);
}

.design-header__status--dirty > span {
  background: var(--ui-warning);
}

.design-header__status--error > span {
  background: var(--ui-error);
}

.design-editor {
  grid-template-columns: minmax(440px, 0.9fr) minmax(440px, 1.1fr);
  grid-template-areas:
    "sections sections"
    "editor preview";
  gap: 0;
  width: calc(100% + 64px);
  margin-inline: -32px;
  overflow: clip;
  background: var(--ui-bg);
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
}

.design-editor__controls {
  display: contents;
}

.design-section-bar {
  grid-area: sections;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  min-width: 0;
  padding: 0 28px;
  background: var(--ui-bg);
  border-bottom: 1px solid var(--ui-border);
}

.design-editor__tabs {
  min-width: 0;
  flex: 1;
  align-items: initial;
  padding: 0;
  background: transparent;
  border: 0;
}

.design-editor__tabs :deep([role="tablist"]) {
  justify-content: flex-start;
  gap: 6px;
  overflow-x: auto;
  background: transparent;
  border-radius: 0;
}

.design-editor__tabs :deep([role="tab"]) {
  min-height: 58px;
  white-space: nowrap;
}

.design-editor__tabs :deep([data-slot="indicator"]) {
  inset-block: auto 0;
  height: 2px;
  background: var(--ui-text-highlighted);
  border-radius: 0;
  box-shadow: none;
}

.design-editor__tabs :deep([role="tab"][aria-selected="true"]) {
  color: var(--ui-text-highlighted);
}

.design-section-progress {
  display: grid;
  grid-template-columns: max-content 148px;
  gap: 14px;
  align-items: center;
  flex: 0 0 auto;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.design-editor__panel {
  grid-area: editor;
  min-height: 720px;
  padding: calc(32px * var(--oe-spacing-scale));
  border-right: 1px solid var(--ui-border);
}

.design-editor__fieldset {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.design-editor__fieldset:disabled {
  cursor: not-allowed;
}

.editor-field-group {
  display: grid;
  gap: calc(20px * var(--oe-spacing-scale));
}

.editor-section {
  gap: calc(26px * var(--oe-spacing-scale));
}

.editor-subsection-head {
  display: grid;
  gap: 5px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--ui-border);
}

.editor-subsection-head h3 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 18px;
}

.editor-subsection-head span {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.editor-footer {
  justify-content: flex-start;
  gap: 18px;
  margin-top: 30px;
}

.design-preview {
  top: 16px;
  grid-area: preview;
  gap: 16px;
  padding: calc(32px * var(--oe-spacing-scale));
}

.design-preview__head > div {
  display: grid;
  gap: 3px;
}

.design-preview__head p {
  color: var(--ui-text-highlighted);
  font-family: inherit;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 0;
  text-transform: none;
}

.design-preview__head span {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.preview-color-mode {
  width: 120px;
}

.preview-surface-tabs {
  width: min(100%, 260px);
}

.brand-preview {
  grid-template-columns: 32px 1fr;
  min-height: 118px;
  padding: 20px;
}

.brand-preview img {
  width: 32px;
  height: 32px;
}

.preview-dashboard {
  grid-template-columns: 130px minmax(0, 1fr);
  min-height: 540px;
  border-radius: var(--oe-radius-surface);
}

.preview-dashboard > aside {
  gap: 3px;
  padding: 15px 9px;
}

.preview-dashboard__brand {
  margin: 0 7px 16px;
  gap: 7px;
  font-size: 11px;
}

.preview-dashboard__brand img {
  width: 17px;
  height: 17px;
}

.preview-dashboard__section {
  margin: 9px 7px 3px;
  font-size: 7px;
}

.preview-dashboard > aside a {
  min-height: 29px;
  padding: 0 7px;
  gap: 7px;
  font-size: 9px;
}

.preview-dashboard > aside a.active {
  background: color-mix(in srgb, var(--oe-sidebar-fg) 7%, transparent);
}

.preview-dashboard > main {
  gap: 14px;
  padding: 18px;
}

.preview-toolbar h3 {
  margin-top: 3px;
  font-size: 20px;
}

.preview-metrics {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.preview-metrics span,
.preview-metrics small {
  display: block;
  color: var(--ui-text-muted);
  font-size: 9px;
}

.preview-metrics strong {
  margin: 8px 0 5px;
  font-size: 18px;
  line-height: 1.1;
}

.preview-activity-card :deep([data-slot="header"]) {
  padding-block: 14px;
}

.preview-activity-list {
  display: grid;
}

.preview-activity-list > div {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) max-content;
  gap: 9px;
  align-items: center;
  padding: 11px 0;
  border-bottom: 1px solid var(--ui-border);
}

.preview-activity-list > div:first-child {
  padding-top: 0;
}

.preview-activity-list > div:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.preview-activity-icon {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  color: var(--ui-text-toned);
  background: var(--ui-bg-muted);
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
}

.preview-activity-list > div > span:nth-child(2) {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.preview-activity-list strong,
.preview-activity-list small,
.preview-activity-list time {
  overflow: hidden;
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-activity-list small,
.preview-activity-list time {
  color: var(--ui-text-muted);
}

@media (max-width: 1240px) {
  .design-editor {
    grid-template-columns: 1fr;
    grid-template-areas:
      "sections"
      "editor"
      "preview";
  }

  .design-editor__panel {
    min-height: auto;
    border-right: 0;
    border-bottom: 1px solid var(--ui-border);
  }

  .design-preview {
    position: static;
  }
}

@media (max-width: 900px) {
  .design-editor {
    width: calc(100% + 32px);
    margin-inline: -16px;
  }
}

@media (max-width: 820px) {
  .design-section-bar {
    align-items: stretch;
    flex-direction: column;
    gap: 8px;
    padding: 0 18px 14px;
  }

  .design-section-progress {
    grid-template-columns: max-content minmax(120px, 1fr);
  }

  .design-editor__panel,
  .design-preview {
    padding: 22px;
  }

  .editor-grid--three,
  .preview-metrics {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 620px) {
  .editor-section__head--inline,
  .design-preview__head,
  .preview-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .editor-grid--two,
  .editor-grid--three,
  .editor-color-pair,
  .brand-preview-grid {
    grid-template-columns: 1fr;
  }

  .mode-tabs,
  .preview-color-mode {
    width: 100%;
  }

  .token-control {
    grid-template-columns: 38px minmax(0, 1fr);
  }

  .token-control > :last-child {
    grid-column: 1 / -1;
  }

  .preview-dashboard {
    grid-template-columns: 58px minmax(0, 1fr);
  }

  .preview-dashboard__brand strong,
  .preview-dashboard > aside a:not(.active),
  .preview-dashboard__section {
    display: none;
  }

  .preview-dashboard > aside a.active {
    justify-content: center;
    font-size: 0;
  }

  .preview-activity-list > div {
    grid-template-columns: 30px minmax(0, 1fr);
  }

  .preview-activity-list time {
    grid-column: 2;
  }
}
</style>
