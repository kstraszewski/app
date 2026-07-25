<script setup lang="ts">
import type { OrganizationDesignSettings } from '#shared/design'
import {
  brandProfileCompletion,
  createEmptyExpertBrandProfile,
  normalizeExpertBrandProfile,
  type ExpertBrandProfile,
} from '#shared/brand'
import {
  cloneDefaultOrganizationDesign,
  normalizeOrganizationDesign,
} from '#shared/design'
import { apiErrorMessage } from '~/utils/api-error'

definePageMeta({ middleware: ['auth', 'organization'] })
useHead({ title: 'Centrum marki — OpenExpert CRM' })

type BrandResponse = {
  data: {
    profile: ExpertBrandProfile
    design: OrganizationDesignSettings
  }
  permissions: {
    canEditProfile: boolean
    canEditVisualIdentity: boolean
  }
  updatedAt: string | null
  visualIdentityUpdatedAt: string | null
}

const { orgApiPath, orgPath } = useOrganizationContext()
const toast = useToast()
const organizationDesign = useOrganizationDesignState()
const saving = ref(false)
const uploading = ref<'logo' | 'portrait' | null>(null)
const deleting = ref<'logo' | 'portrait' | null>(null)
const logoInput = ref<HTMLInputElement | null>(null)
const portraitInput = ref<HTMLInputElement | null>(null)

const { data: response, error } = await useFetch<BrandResponse>(() => orgApiPath('/brand'))
const profile = reactive<ExpertBrandProfile>(createEmptyExpertBrandProfile())
const savedProfile = ref<ExpertBrandProfile>(createEmptyExpertBrandProfile())
const design = reactive<OrganizationDesignSettings>(cloneDefaultOrganizationDesign())
const savedDesign = ref<OrganizationDesignSettings>(cloneDefaultOrganizationDesign())

function applyResponse(value: BrandResponse | null | undefined) {
  if (!value) return
  const normalizedProfile = normalizeExpertBrandProfile(value.data.profile)
  const normalizedDesign = normalizeOrganizationDesign(value.data.design)
  Object.assign(profile, normalizedProfile)
  Object.assign(design, normalizedDesign)
  savedProfile.value = normalizedProfile
  savedDesign.value = normalizedDesign
  organizationDesign.value = normalizedDesign
}

watch(response, applyResponse, { immediate: true })
watch(design, value => {
  organizationDesign.value = normalizeOrganizationDesign(value)
}, { deep: true })
onBeforeUnmount(() => {
  organizationDesign.value = normalizeOrganizationDesign(savedDesign.value)
})

const tabs = computed(() => [
  { label: 'Brand Core', to: orgPath('/brand'), icon: 'i-lucide-fingerprint', exact: true },
  { label: 'Generator materiałów', to: orgPath('/brand/materials'), icon: 'i-lucide-layout-template' },
])
const completion = computed(() => brandProfileCompletion(profile))
const specializationsText = computed({
  get: () => profile.specializations.join(', '),
  set: (value: string) => {
    profile.specializations = value.split(',').map(item => item.trim()).filter(Boolean).slice(0, 8)
  },
})
const isProfileDirty = computed(() => (
  JSON.stringify(normalizeExpertBrandProfile(profile)) !== JSON.stringify(savedProfile.value)
))
const isDesignDirty = computed(() => (
  JSON.stringify(normalizeOrganizationDesign(design)) !== JSON.stringify(savedDesign.value)
))
const isDirty = computed(() => isProfileDirty.value || isDesignDirty.value)
const visualStyleItems = [
  { label: 'Minimalny', value: 'minimal', description: 'Dużo oddechu i mocna typografia.' },
  { label: 'Redakcyjny', value: 'editorial', description: 'Ekspercki ton i akcent serifowy.' },
  { label: 'Ciepły', value: 'warm', description: 'Łagodniejsze formy i relacyjny charakter.' },
]

async function saveBrandCore() {
  if (!response.value || saving.value) return
  saving.value = true
  try {
    if (isProfileDirty.value) {
      const result = await $fetch<{ data: ExpertBrandProfile, updatedAt: string }>(orgApiPath('/brand'), {
        method: 'PATCH',
        body: normalizeExpertBrandProfile(profile),
      })
      Object.assign(profile, result.data)
      savedProfile.value = normalizeExpertBrandProfile(result.data)
      response.value.updatedAt = result.updatedAt
    }
    if (isDesignDirty.value && response.value.permissions.canEditVisualIdentity) {
      const result = await $fetch<{ data: OrganizationDesignSettings, updatedAt: string }>(orgApiPath('/design'), {
        method: 'PATCH',
        body: normalizeOrganizationDesign(design),
      })
      Object.assign(design, result.data)
      savedDesign.value = normalizeOrganizationDesign(result.data)
      response.value.visualIdentityUpdatedAt = result.updatedAt
    }
    toast.add({
      title: 'Brand Core zapisany',
      description: 'Nowe dane są już używane w generatorze materiałów.',
      color: 'success',
      icon: 'i-lucide-check',
    })
  } catch (saveError) {
    toast.add({
      title: 'Nie udało się zapisać Brand Core',
      description: apiErrorMessage(saveError),
      color: 'error',
      icon: 'i-lucide-alert-triangle',
    })
  } finally {
    saving.value = false
  }
}

function discardChanges() {
  Object.assign(profile, normalizeExpertBrandProfile(savedProfile.value))
  Object.assign(design, normalizeOrganizationDesign(savedDesign.value))
}

async function uploadAsset(kind: 'logo' | 'portrait', event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || uploading.value) return
  uploading.value = kind
  try {
    const body = new FormData()
    body.append('image', file)
    const result = await $fetch<{ data: ExpertBrandProfile }>(orgApiPath(`/brand/assets/${kind}`), {
      method: 'POST',
      body,
    })
    const assetKey = kind === 'logo' ? 'logoUrl' : 'portraitUrl'
    profile[assetKey] = result.data[assetKey]
    savedProfile.value = normalizeExpertBrandProfile({
      ...savedProfile.value,
      [assetKey]: result.data[assetKey],
    })
    if (response.value) response.value.data.profile[assetKey] = result.data[assetKey]
    toast.add({
      title: kind === 'logo' ? 'Logo zostało dodane' : 'Portret został dodany',
      color: 'success',
      icon: 'i-lucide-image-check',
    })
  } catch (uploadError) {
    toast.add({
      title: 'Nie udało się przesłać obrazu',
      description: apiErrorMessage(uploadError),
      color: 'error',
    })
  } finally {
    uploading.value = null
    input.value = ''
  }
}

async function removeAsset(kind: 'logo' | 'portrait') {
  if (deleting.value) return
  deleting.value = kind
  try {
    const result = await $fetch<{ data: ExpertBrandProfile }>(orgApiPath(`/brand/assets/${kind}`), {
      method: 'DELETE',
    })
    const assetKey = kind === 'logo' ? 'logoUrl' : 'portraitUrl'
    profile[assetKey] = result.data[assetKey]
    savedProfile.value = normalizeExpertBrandProfile({
      ...savedProfile.value,
      [assetKey]: result.data[assetKey],
    })
    if (response.value) response.value.data.profile[assetKey] = result.data[assetKey]
    toast.add({ title: kind === 'logo' ? 'Logo usunięte' : 'Portret usunięty', color: 'success' })
  } catch (deleteError) {
    toast.add({
      title: 'Nie udało się usunąć obrazu',
      description: apiErrorMessage(deleteError),
      color: 'error',
    })
  } finally {
    deleting.value = null
  }
}
</script>

<template>
  <CrmShell
    title="Centrum marki"
    eyebrow="Marka osobista"
    description="Jedno źródło danych eksperta, identyfikacji wizualnej i materiałów marketingowych."
    :tabs="tabs"
  >
    <template #actions>
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
        icon="i-lucide-save"
        :loading="saving"
        :disabled="!isDirty || Boolean(error)"
        @click="saveBrandCore"
      >
        Zapisz Brand Core
      </UButton>
    </template>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-cloud-alert"
      title="Nie udało się pobrać Brand Core"
      description="Odśwież stronę i spróbuj ponownie. Edycja jest chwilowo niedostępna."
      class="brand-alert"
    />

    <div v-else class="brand-layout">
      <section class="brand-main">
        <UCard>
          <template #header>
            <div class="section-head">
              <div>
                <span>Tożsamość</span>
                <h2>Jak przedstawiasz się klientom</h2>
                <p>Te dane trafiają automatycznie do wizytówek, postów i materiałów kontaktowych.</p>
              </div>
              <UBadge color="neutral" variant="outline">Profil osobisty</UBadge>
            </div>
          </template>

          <div class="form-grid">
            <UFormField label="Nazwa marki" name="brandName" description="Może to być Twoje imię lub nazwa pracowni.">
              <UInput v-model="profile.brandName" class="w-full" placeholder="Anna Nowak Finansuje" />
            </UFormField>
            <UFormField label="Imię i nazwisko eksperta" name="expertName">
              <UInput v-model="profile.expertName" class="w-full" placeholder="Anna Nowak" />
            </UFormField>
            <UFormField label="Tytuł zawodowy" name="professionalTitle">
              <UInput v-model="profile.professionalTitle" class="w-full" placeholder="Ekspertka kredytowa" />
            </UFormField>
            <UFormField label="Lokalizacja" name="location">
              <UInput v-model="profile.location" class="w-full" icon="i-lucide-map-pin" placeholder="Warszawa i online" />
            </UFormField>
            <UFormField class="form-grid__full" label="Hasło marki" name="tagline" :hint="`${profile.tagline.length}/140`">
              <UInput v-model="profile.tagline" class="w-full" maxlength="140" placeholder="Spokojnie przeprowadzę Cię przez finansowanie domu." />
            </UFormField>
            <UFormField class="form-grid__full" label="Bio" name="bio" :hint="`${profile.bio.length}/800`">
              <UTextarea
                v-model="profile.bio"
                class="w-full"
                :rows="5"
                autoresize
                :maxrows="8"
                maxlength="800"
                placeholder="Napisz krótko, komu pomagasz i jak wygląda współpraca."
              />
            </UFormField>
            <UFormField
              class="form-grid__full"
              label="Specjalizacje"
              name="specializations"
              description="Oddziel przecinkami; pokażemy maksymalnie 8."
            >
              <UInput
                v-model="specializationsText"
                class="w-full"
                placeholder="Kredyty hipoteczne, refinansowanie, pierwsze mieszkanie"
              />
            </UFormField>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <div class="section-head">
              <div>
                <span>Kontakt</span>
                <h2>Jak klient może się z Tobą skontaktować</h2>
              </div>
            </div>
          </template>
          <div class="form-grid">
            <UFormField label="E-mail" name="email">
              <UInput v-model="profile.email" class="w-full" type="email" icon="i-lucide-mail" placeholder="kontakt@twojamarka.pl" />
            </UFormField>
            <UFormField label="Telefon" name="phone">
              <UInput v-model="profile.phone" class="w-full" type="tel" icon="i-lucide-phone" placeholder="+48 500 000 000" />
            </UFormField>
            <UFormField class="form-grid__full" label="Strona internetowa" name="website">
              <UInput v-model="profile.website" class="w-full" type="url" icon="i-lucide-globe-2" placeholder="https://twojamarka.pl" />
            </UFormField>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <div class="section-head">
              <div>
                <span>Styl wizualny</span>
                <h2>Paleta współdzielona z aplikacją</h2>
                <p>To te same tokeny, które są używane w ustawieniach Design — zmiana nie tworzy drugiej palety.</p>
              </div>
              <UButton
                :to="orgPath('/settings/design')"
                color="neutral"
                variant="ghost"
                size="sm"
                trailing-icon="i-lucide-arrow-up-right"
              >
                Pełne ustawienia
              </UButton>
            </div>
          </template>

          <UAlert
            v-if="response && !response.permissions.canEditVisualIdentity"
            color="info"
            variant="subtle"
            icon="i-lucide-link"
            title="Paleta organizacji"
            description="Korzystasz ze wspólnych kolorów. Administrator organizacji może je zmienić w ustawieniach Design."
            class="palette-alert"
          />

          <fieldset :disabled="!response?.permissions.canEditVisualIdentity">
            <div class="palette-grid">
              <label>
                <span>Kolor główny</span>
                <div class="color-field">
                  <input v-model="design.colors.light.primary" type="color" aria-label="Kolor główny marki">
                  <UInput v-model="design.colors.light.primary" class="w-full" />
                </div>
              </label>
              <label>
                <span>Kolor dodatkowy</span>
                <div class="color-field">
                  <input v-model="design.colors.light.secondary" type="color" aria-label="Kolor dodatkowy marki">
                  <UInput v-model="design.colors.light.secondary" class="w-full" />
                </div>
              </label>
              <label>
                <span>Tło</span>
                <div class="color-field">
                  <input v-model="design.colors.light.background" type="color" aria-label="Kolor tła marki">
                  <UInput v-model="design.colors.light.background" class="w-full" />
                </div>
              </label>
              <label>
                <span>Tekst</span>
                <div class="color-field">
                  <input v-model="design.colors.light.textHighlighted" type="color" aria-label="Kolor tekstu marki">
                  <UInput v-model="design.colors.light.textHighlighted" class="w-full" />
                </div>
              </label>
            </div>
          </fieldset>

          <UFormField label="Charakter materiałów" description="Wpływa na kompozycję wszystkich szablonów." class="visual-style-field">
            <URadioGroup v-model="profile.visualStyle" :items="visualStyleItems" orientation="horizontal" />
          </UFormField>
        </UCard>
      </section>

      <aside class="brand-sidebar">
        <UCard class="readiness-card">
          <div class="readiness-card__score">
            <div>
              <span>Gotowość marki</span>
              <strong>{{ completion.percentage }}%</strong>
            </div>
            <UProgress :model-value="completion.percentage" color="neutral" aria-label="Kompletność Brand Core" />
          </div>
          <p v-if="completion.missing.length">
            Uzupełnij: {{ completion.missing.slice(0, 3).join(', ') }}<template v-if="completion.missing.length > 3"> i {{ completion.missing.length - 3 }} więcej</template>.
          </p>
          <p v-else>Brand Core jest kompletny i gotowy do generowania materiałów.</p>
          <UButton :to="orgPath('/brand/materials')" block trailing-icon="i-lucide-arrow-right">
            Otwórz generator
          </UButton>
        </UCard>

        <UCard>
          <template #header>
            <div class="asset-card__head">
              <div>
                <span>Logo</span>
                <h2>Znak marki</h2>
              </div>
              <UBadge :color="profile.logoUrl ? 'success' : 'neutral'" variant="subtle">
                {{ profile.logoUrl ? 'Dodane' : 'Opcjonalne' }}
              </UBadge>
            </div>
          </template>
          <div class="asset-preview asset-preview--logo">
            <img v-if="profile.logoUrl" :src="profile.logoUrl" :alt="`Logo ${profile.brandName}`">
            <div v-else>
              <UIcon name="i-lucide-image-plus" />
              <span>Bez logo użyjemy monogramu.</span>
            </div>
          </div>
          <input
            ref="logoInput"
            class="sr-only"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-label="Wybierz plik logo"
            @change="uploadAsset('logo', $event)"
          >
          <div class="asset-actions">
            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-upload"
              :loading="uploading === 'logo'"
              @click="logoInput?.click()"
            >
              {{ profile.logoUrl ? 'Zmień logo' : 'Dodaj logo' }}
            </UButton>
            <UButton
              v-if="profile.logoUrl"
              color="error"
              variant="ghost"
              icon="i-lucide-trash-2"
              square
              aria-label="Usuń logo"
              :loading="deleting === 'logo'"
              @click="removeAsset('logo')"
            />
          </div>
          <small>PNG, JPG lub WebP, maks. 5 MB. Plik zostanie zoptymalizowany.</small>
        </UCard>

        <UCard>
          <template #header>
            <div class="asset-card__head">
              <div>
                <span>Portret</span>
                <h2>Zdjęcie eksperta</h2>
              </div>
              <UBadge :color="profile.portraitUrl ? 'success' : 'neutral'" variant="subtle">
                {{ profile.portraitUrl ? 'Dodane' : 'Opcjonalne' }}
              </UBadge>
            </div>
          </template>
          <div class="asset-preview asset-preview--portrait">
            <img v-if="profile.portraitUrl" :src="profile.portraitUrl" :alt="`Portret: ${profile.expertName}`">
            <div v-else>
              <UIcon name="i-lucide-user-round" />
              <span>Szablony zadziałają też bez zdjęcia.</span>
            </div>
          </div>
          <input
            ref="portraitInput"
            class="sr-only"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-label="Wybierz zdjęcie portretowe"
            @change="uploadAsset('portrait', $event)"
          >
          <div class="asset-actions">
            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-upload"
              :loading="uploading === 'portrait'"
              @click="portraitInput?.click()"
            >
              {{ profile.portraitUrl ? 'Zmień portret' : 'Dodaj portret' }}
            </UButton>
            <UButton
              v-if="profile.portraitUrl"
              color="error"
              variant="ghost"
              icon="i-lucide-trash-2"
              square
              aria-label="Usuń portret"
              :loading="deleting === 'portrait'"
              @click="removeAsset('portrait')"
            />
          </div>
          <small>Najlepiej pionowe zdjęcie z neutralnym tłem.</small>
        </UCard>
      </aside>
    </div>
  </CrmShell>
</template>

<style scoped>
.brand-alert {
  margin-bottom: 24px;
}

.brand-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 360px);
  gap: 24px;
  align-items: start;
}

.brand-main,
.brand-sidebar {
  display: grid;
  gap: 20px;
  min-width: 0;
}

.brand-sidebar {
  position: sticky;
  top: 20px;
}

.section-head,
.asset-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}

.section-head > div,
.asset-card__head > div {
  min-width: 0;
}

.section-head span,
.asset-card__head span {
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.section-head h2,
.asset-card__head h2 {
  margin: 4px 0 0;
  color: var(--ui-text-highlighted);
  font-size: 19px;
}

.section-head p {
  max-width: 680px;
  margin: 7px 0 0;
  color: var(--ui-text-muted);
  font-size: 13px;
  line-height: 1.5;
}

.form-grid,
.palette-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.form-grid__full {
  grid-column: 1 / -1;
}

.palette-alert {
  margin-bottom: 18px;
}

.palette-grid label {
  display: grid;
  gap: 7px;
  color: var(--ui-text);
  font-size: 13px;
  font-weight: 550;
}

.color-field {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  gap: 8px;
}

.color-field input[type='color'] {
  width: 42px;
  height: 40px;
  padding: 3px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  background: var(--ui-bg);
}

.visual-style-field {
  margin-top: 22px;
}

.readiness-card__score {
  display: grid;
  gap: 12px;
}

.readiness-card__score > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 14px;
}

.readiness-card__score span {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.readiness-card__score strong {
  color: var(--ui-text-highlighted);
  font-size: 30px;
}

.readiness-card p {
  margin: 14px 0 18px;
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.asset-preview {
  display: grid;
  place-items: center;
  overflow: hidden;
  border: 1px dashed var(--ui-border-accented);
  border-radius: var(--oe-radius-surface);
  background: var(--ui-bg-muted);
}

.asset-preview--logo {
  min-height: 160px;
  padding: 24px;
}

.asset-preview--portrait {
  aspect-ratio: 4 / 3;
}

.asset-preview img {
  width: 100%;
  height: 100%;
  max-height: 260px;
  object-fit: contain;
}

.asset-preview--portrait img {
  object-fit: cover;
}

.asset-preview > div {
  display: grid;
  justify-items: center;
  gap: 10px;
  padding: 20px;
  color: var(--ui-text-muted);
  text-align: center;
  font-size: 12px;
}

.asset-preview svg {
  width: 30px;
  height: 30px;
}

.asset-actions {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 12px;
}

.brand-sidebar small {
  display: block;
  margin-top: 10px;
  color: var(--ui-text-dimmed);
  font-size: 11px;
  line-height: 1.4;
}

@media (max-width: 1080px) {
  .brand-layout {
    grid-template-columns: 1fr;
  }

  .brand-sidebar {
    position: static;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 780px) {
  .brand-sidebar {
    grid-template-columns: 1fr;
  }

  .form-grid,
  .palette-grid {
    grid-template-columns: 1fr;
  }

  .form-grid__full {
    grid-column: 1;
  }

  .section-head {
    flex-direction: column;
  }
}
</style>
