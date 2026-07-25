<script setup lang="ts">
import type { OrganizationDesignSettings } from '#shared/design'
import {
  brandMaterialOptions,
  brandProfileCompletion,
  buildBrandMaterialContent,
  buildMaterialBrandIdentity,
  buildBrandPalette,
  createEmptyExpertBrandProfile,
  type BrandMaterialContent,
  type BrandMaterialType,
  type ExpertBrandProfile,
} from '#shared/brand'

definePageMeta({ middleware: ['auth', 'organization'] })
useHead({ title: 'Generator materiałów — OpenExpert CRM' })

type BrandResponse = {
  data: {
    profile: ExpertBrandProfile
    design: OrganizationDesignSettings
  }
}

const { orgApiPath, orgPath } = useOrganizationContext()
const toast = useToast()
const selectedType = ref<BrandMaterialType>('linkedin')
const { data: response, error, status } = await useFetch<BrandResponse>(() => orgApiPath('/brand'))
const profile = computed(() => response.value?.data.profile ?? createEmptyExpertBrandProfile())
const brandIdentity = computed(() => response.value
  ? buildMaterialBrandIdentity(response.value.data.design)
  : { name: 'Twoja marka', logoUrl: null })
const palette = computed(() => response.value
  ? buildBrandPalette(response.value.data.design)
  : {
      primary: '#000000',
      secondary: '#525252',
      background: '#ffffff',
      surface: '#fafafa',
      foreground: '#0a0a0a',
      muted: '#737373',
    })
const completion = computed(() => brandProfileCompletion(profile.value))
const generatedContent = computed(() => buildBrandMaterialContent(profile.value, selectedType.value))
const content = reactive<BrandMaterialContent>(buildBrandMaterialContent(profile.value, selectedType.value))

watch(generatedContent, value => {
  Object.assign(content, value)
}, { immediate: true })

const tabs = computed(() => [
  { label: 'Ustawienia Design', to: orgPath('/settings/design'), icon: 'i-lucide-swatch-book' },
  { label: 'Generator materiałów', to: orgPath('/settings/design/materials'), icon: 'i-lucide-layout-template' },
])
const selectedOption = computed(() => brandMaterialOptions.find(item => item.value === selectedType.value)!)

function resetCopy() {
  Object.assign(content, generatedContent.value)
}

async function copyMaterialText() {
  const lines = [
    content.eyebrow,
    content.headline,
    '',
    content.body,
    '',
    content.callToAction,
  ]
  await navigator.clipboard.writeText(lines.join('\n'))
  toast.add({ title: 'Treść materiału skopiowana', color: 'success', icon: 'i-lucide-copy-check' })
}
</script>

<template>
  <CrmShell
    title="Generator materiałów"
    eyebrow="Administracja · Design"
    description="Szablony korzystają bezpośrednio ze wspólnego logo, kolorów i typografii oraz profilu eksperta ustawionego w Design."
    :tabs="tabs"
  >
    <template #actions>
      <UButton color="neutral" variant="outline" icon="i-lucide-copy" @click="copyMaterialText">
        Kopiuj treść
      </UButton>
    </template>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-cloud-alert"
      title="Nie udało się pobrać ustawień Design"
      description="Odśwież stronę, aby wygenerować materiały z aktualnej konfiguracji organizacji."
      class="materials-alert"
    />

    <div v-else-if="status === 'pending'" class="materials-loading" aria-label="Ładowanie generatora">
      <USkeleton class="h-32 w-full" />
      <USkeleton class="h-96 w-full" />
    </div>

    <div v-else class="materials-layout">
      <aside class="materials-controls">
        <section>
          <div class="control-head">
            <span>01</span>
            <div>
              <h2>Wybierz format</h2>
              <p>Każdy szablon korzysta z tych samych danych i kolorów.</p>
            </div>
          </div>
          <div class="material-options" role="radiogroup" aria-label="Rodzaj materiału">
            <button
              v-for="option in brandMaterialOptions"
              :key="option.value"
              type="button"
              class="material-option"
              :class="{ 'material-option--active': selectedType === option.value }"
              role="radio"
              :aria-checked="selectedType === option.value"
              @click="selectedType = option.value"
            >
              <span class="material-option__icon"><UIcon :name="option.icon" /></span>
              <span>
                <strong>{{ option.label }}</strong>
                <small>{{ option.description }}</small>
              </span>
              <UIcon v-if="selectedType === option.value" name="i-lucide-check" />
            </button>
          </div>
        </section>

        <section>
          <div class="control-head">
            <span>02</span>
            <div>
              <h2>Dopasuj treść</h2>
              <p>Punkt wyjścia powstał lokalnie z profilu eksperta w Design.</p>
            </div>
          </div>
          <div class="copy-form">
            <UFormField label="Nadtytuł">
              <UInput v-model="content.eyebrow" class="w-full" />
            </UFormField>
            <UFormField label="Nagłówek">
              <UTextarea v-model="content.headline" class="w-full" :rows="2" autoresize :maxrows="4" />
            </UFormField>
            <UFormField label="Treść">
              <UTextarea v-model="content.body" class="w-full" :rows="4" autoresize :maxrows="8" />
            </UFormField>
            <UFormField label="Wezwanie do działania">
              <UInput v-model="content.callToAction" class="w-full" />
            </UFormField>
            <UButton color="neutral" variant="ghost" icon="i-lucide-rotate-ccw" @click="resetCopy">
              Przywróć propozycję
            </UButton>
          </div>
        </section>

        <UAlert
          v-if="completion.percentage < 100"
          color="info"
          variant="subtle"
          icon="i-lucide-wand-sparkles"
          :title="`Profil eksperta gotowy w ${completion.percentage}%`"
          description="Brakujące dane lub portret zastępujemy czytelnymi wartościami domyślnymi."
        >
          <template #actions>
            <UButton :to="orgPath('/settings/design')" color="neutral" variant="outline" size="xs">
              Uzupełnij w Design
            </UButton>
          </template>
        </UAlert>
      </aside>

      <section class="materials-stage" aria-live="polite">
        <div class="stage-head">
          <div>
            <span>Podgląd na żywo</span>
            <h2>{{ selectedOption.label }}</h2>
          </div>
          <UBadge color="success" variant="subtle" icon="i-lucide-check-circle-2">
            Gotowy szablon
          </UBadge>
        </div>
        <div class="stage-canvas">
          <BrandMaterialPreview
            :profile="profile"
            :brand-name="brandIdentity.name"
            :logo-url="brandIdentity.logoUrl"
            :palette="palette"
            :type="selectedType"
            :content="content"
          />
        </div>
        <div class="stage-foot">
          <span><UIcon name="i-lucide-link" /> Logo, dane i paleta pochodzą z ustawień Design</span>
          <span><UIcon name="i-lucide-shield-check" /> Podgląd generowany lokalnie</span>
        </div>
      </section>
    </div>
  </CrmShell>
</template>

<style scoped>
.materials-alert {
  margin-bottom: 24px;
}

.materials-loading {
  display: grid;
  gap: 20px;
}

.materials-layout {
  display: grid;
  grid-template-columns: minmax(300px, 380px) minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}

.materials-controls {
  display: grid;
  gap: 18px;
}

.materials-controls > section {
  padding: 20px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background: var(--ui-bg);
}

.control-head {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 12px;
  margin-bottom: 18px;
}

.control-head > span {
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
}

.control-head h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 16px;
}

.control-head p {
  margin: 4px 0 0;
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.material-options,
.copy-form {
  display: grid;
  gap: 8px;
}

.material-option {
  width: 100%;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 11px;
  padding: 11px;
  color: var(--ui-text);
  text-align: left;
  border: 1px solid transparent;
  border-radius: var(--oe-radius-control);
  background: transparent;
  cursor: pointer;
  transition: background var(--oe-motion-fast), border-color var(--oe-motion-fast);
}

.material-option:hover {
  background: var(--ui-bg-muted);
}

.material-option:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 2px;
}

.material-option--active {
  border-color: var(--ui-border-accented);
  background: var(--ui-bg-muted);
}

.material-option__icon {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 9px;
  color: var(--ui-text-muted);
  background: var(--ui-bg-elevated);
}

.material-option--active .material-option__icon,
.material-option--active > svg {
  color: var(--ui-primary);
}

.material-option > span:nth-child(2) {
  display: grid;
  gap: 2px;
}

.material-option strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.material-option small {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.copy-form {
  gap: 14px;
}

.materials-stage {
  position: sticky;
  top: 18px;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background: var(--ui-bg);
}

.stage-head,
.stage-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 16px 18px;
}

.stage-head {
  border-bottom: 1px solid var(--ui-border);
}

.stage-head span {
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.stage-head h2 {
  margin: 3px 0 0;
  color: var(--ui-text-highlighted);
  font-size: 16px;
}

.stage-canvas {
  min-height: 620px;
  display: grid;
  place-items: center;
  padding: clamp(18px, 4vw, 48px);
  background:
    linear-gradient(45deg, color-mix(in srgb, var(--ui-border) 38%, transparent) 25%, transparent 25%),
    linear-gradient(-45deg, color-mix(in srgb, var(--ui-border) 38%, transparent) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, color-mix(in srgb, var(--ui-border) 38%, transparent) 75%),
    linear-gradient(-45deg, transparent 75%, color-mix(in srgb, var(--ui-border) 38%, transparent) 75%),
    var(--ui-bg-muted);
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  background-size: 16px 16px;
}

.stage-foot {
  justify-content: flex-start;
  flex-wrap: wrap;
  border-top: 1px solid var(--ui-border);
  color: var(--ui-text-muted);
  font-size: 10px;
}

.stage-foot span {
  display: flex;
  align-items: center;
  gap: 6px;
}

@media (max-width: 1120px) {
  .materials-layout {
    grid-template-columns: 1fr;
  }

  .materials-controls {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .materials-controls > :last-child {
    grid-column: 1 / -1;
  }

  .materials-stage {
    position: static;
  }
}

@media (max-width: 720px) {
  .materials-controls {
    grid-template-columns: 1fr;
  }

  .materials-controls > :last-child {
    grid-column: 1;
  }

  .stage-head,
  .stage-foot {
    align-items: flex-start;
    flex-direction: column;
  }

  .stage-canvas {
    min-height: 420px;
    padding: 14px;
  }
}
</style>
