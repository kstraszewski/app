<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui'
import type { CaseProperty } from '~/types/cases'
import type { PropertyImportPreview } from '~/types/property-import'

const props = defineProps<{
  open: boolean
  property: CaseProperty | null
  scenarioValue: number | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'saved': []
}>()

interface PropertyFormState {
  address: string
  city: string
  postal_code: string
  property_type: string
  market_type: string
  price_amount: number | null
  appraisal_value_amount: number | null
  area_m2: number | null
  rooms: number | null
}

interface ImportDetailsState {
  listingTitle: string
  description: string
  floor: number | null
  buildingFloors: number | null
  yearBuilt: number | null
  landAreaM2: number | null
  monthlyFees: number | null
  ownership: string
  condition: string
  heating: string
  externalId: string
  sourcePublishedAt: string
  pricePerM2: number | null
  featuresText: string
}

const route = useRoute()
const { crmApiPath } = useOrganizationContext()
const toast = useToast()
const saving = ref(false)
const analyzing = ref(false)
const mode = ref<'import' | 'manual'>('import')
const importUrl = ref('')
const preview = ref<PropertyImportPreview | null>(null)
const selectedImageUrls = ref<string[]>([])

const form = reactive<PropertyFormState>({
  address: '',
  city: '',
  postal_code: '',
  property_type: '',
  market_type: '',
  price_amount: null,
  appraisal_value_amount: null,
  area_m2: null,
  rooms: null,
})

const importDetails = reactive<ImportDetailsState>({
  listingTitle: '',
  description: '',
  floor: null,
  buildingFloors: null,
  yearBuilt: null,
  landAreaM2: null,
  monthlyFees: null,
  ownership: '',
  condition: '',
  heating: '',
  externalId: '',
  sourcePublishedAt: '',
  pricePerM2: null,
  featuresText: '',
})

const caseId = computed(() => {
  const value = route.params.id
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')
})

const isEditing = computed(() => Boolean(props.property?.id))
const slideoverTitle = computed(() => isEditing.value ? 'Edytuj nieruchomość' : 'Dodaj nieruchomość')
const slideoverDescription = computed(() => mode.value === 'import'
  ? 'Wklej link do ogłoszenia. Gemini przygotuje dane i zdjęcia do zatwierdzenia.'
  : 'Uzupełnij ręcznie dane przedmiotu finansowania.')
const selectedImageCount = computed(() => selectedImageUrls.value.length)
const selectedImageNoun = computed(() => {
  const count = selectedImageCount.value
  const lastTwo = count % 100
  if (count === 1) return 'zdjęcie'
  if (count % 10 >= 2 && count % 10 <= 4 && (lastTwo < 12 || lastTwo > 14)) return 'zdjęcia'
  return 'zdjęć'
})
const confidenceLabel = computed(() => {
  const confidence = preview.value?.confidence ?? 0
  if (confidence >= 0.8) return 'Wysoka pewność'
  if (confidence >= 0.55) return 'Średnia pewność'
  return 'Wymaga dokładnej weryfikacji'
})
const confidenceColor = computed(() => {
  const confidence = preview.value?.confidence ?? 0
  return confidence >= 0.8 ? 'success' : confidence >= 0.55 ? 'warning' : 'error'
})

const propertyTypeItems = [
  { label: 'Mieszkanie', value: 'apartment' },
  { label: 'Dom', value: 'house' },
  { label: 'Działka', value: 'plot' },
  { label: 'Lokal użytkowy', value: 'commercial' },
  { label: 'Inny typ', value: 'other' },
]

const marketTypeItems = [
  { label: 'Rynek pierwotny', value: 'primary' },
  { label: 'Rynek wtórny', value: 'secondary' },
  { label: 'Najem', value: 'rental' },
  { label: 'Inny', value: 'other' },
]

function finiteNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

function positiveNumber(value: unknown): number | null {
  const number = finiteNumber(value)
  return number != null && number > 0 ? number : null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function resetImportDetails() {
  const listing = asRecord(props.property?.metadata?.listing)
  importDetails.listingTitle = props.property?.listing_title ?? ''
  importDetails.description = props.property?.description ?? ''
  importDetails.floor = finiteNumber(listing.floor)
  importDetails.buildingFloors = finiteNumber(listing.buildingFloors)
  importDetails.yearBuilt = finiteNumber(listing.yearBuilt)
  importDetails.landAreaM2 = finiteNumber(listing.landAreaM2)
  importDetails.monthlyFees = finiteNumber(listing.monthlyFees)
  importDetails.ownership = typeof listing.ownership === 'string' ? listing.ownership : ''
  importDetails.condition = typeof listing.condition === 'string' ? listing.condition : ''
  importDetails.heating = typeof listing.heating === 'string' ? listing.heating : ''
  importDetails.externalId = typeof listing.externalId === 'string' ? listing.externalId : ''
  importDetails.sourcePublishedAt = props.property?.source_published_at ?? ''
  importDetails.pricePerM2 = finiteNumber(listing.pricePerM2)
  importDetails.featuresText = Array.isArray(listing.features)
    ? listing.features.filter(item => typeof item === 'string').join('\n')
    : ''
}

function resetForm() {
  const property = props.property
  const suggestedValue = finiteNumber(props.scenarioValue)
  form.address = property?.address ?? ''
  form.city = property?.city ?? ''
  form.postal_code = property?.postal_code ?? ''
  form.property_type = property?.property_type ?? ''
  form.market_type = property?.market_type ?? ''
  form.price_amount = finiteNumber(property?.price_amount) ?? suggestedValue
  form.appraisal_value_amount = finiteNumber(property?.appraisal_value_amount)
  form.area_m2 = finiteNumber(property?.area_m2)
  form.rooms = finiteNumber(property?.rooms)
  mode.value = property ? 'manual' : 'import'
  importUrl.value = property?.source_url ?? ''
  preview.value = null
  selectedImageUrls.value = []
  resetImportDetails()
}

watch(
  [() => props.open, () => props.property, () => props.scenarioValue],
  ([open]) => {
    if (open) resetForm()
  },
  { immediate: true },
)

function validateProperty(state: Partial<PropertyFormState>): FormError[] {
  const errors: FormError[] = []
  if (!state.address?.trim()) {
    errors.push({ name: 'address', message: 'Podaj adres lub najdokładniejszą ujawnioną lokalizację.' })
  }
  if (state.price_amount != null && state.price_amount < 0) {
    errors.push({ name: 'price_amount', message: 'Wartość nie może być ujemna.' })
  }
  if (state.appraisal_value_amount != null && state.appraisal_value_amount <= 0) {
    errors.push({ name: 'appraisal_value_amount', message: 'Wartość z operatu musi być większa od zera.' })
  }
  if (state.area_m2 != null && state.area_m2 <= 0) {
    errors.push({ name: 'area_m2', message: 'Powierzchnia musi być większa od zera.' })
  }
  if (state.rooms != null && state.rooms <= 0) {
    errors.push({ name: 'rooms', message: 'Liczba pokoi musi być większa od zera.' })
  }
  return errors
}

function optionalText(value: string) {
  const normalized = value.trim()
  return normalized || null
}

function parsedFeatures() {
  return [...new Set(importDetails.featuresText
    .split(/[\n,;]/u)
    .map(item => item.trim())
    .filter(Boolean))].slice(0, 40)
}

function errorMessage(caught: unknown) {
  const error = caught as {
    data?: { statusMessage?: string, message?: string }
    statusMessage?: string
    message?: string
  }
  return error.data?.statusMessage
    ?? error.data?.message
    ?? error.statusMessage
    ?? error.message
    ?? 'Sprawdź dane i spróbuj ponownie.'
}

function closePanel() {
  if (saving.value || analyzing.value) return
  emit('update:open', false)
}

function applyPreview(result: PropertyImportPreview) {
  preview.value = result
  form.address = result.address ?? ''
  form.city = result.city ?? ''
  form.postal_code = result.postalCode ?? ''
  form.property_type = result.propertyType ?? ''
  form.market_type = result.marketType ?? ''
  form.price_amount = finiteNumber(result.priceAmount) ?? finiteNumber(props.scenarioValue)
  form.area_m2 = finiteNumber(result.areaM2)
  form.rooms = finiteNumber(result.rooms)
  importDetails.listingTitle = result.listingTitle ?? ''
  importDetails.description = result.description ?? ''
  importDetails.floor = finiteNumber(result.floor)
  importDetails.buildingFloors = finiteNumber(result.buildingFloors)
  importDetails.yearBuilt = finiteNumber(result.yearBuilt)
  importDetails.landAreaM2 = finiteNumber(result.landAreaM2)
  importDetails.monthlyFees = finiteNumber(result.monthlyFees)
  importDetails.ownership = result.ownership ?? ''
  importDetails.condition = result.condition ?? ''
  importDetails.heating = result.heating ?? ''
  importDetails.externalId = result.externalId ?? ''
  importDetails.sourcePublishedAt = result.sourcePublishedAt ?? ''
  importDetails.pricePerM2 = finiteNumber(result.pricePerM2)
  importDetails.featuresText = result.features.join('\n')
  selectedImageUrls.value = result.images.filter(image => image.selected).map(image => image.url).slice(0, 8)
}

async function analyzeLink() {
  if (analyzing.value || saving.value || !caseId.value) return
  const url = importUrl.value.trim()
  if (!url) {
    toast.add({ title: 'Wklej link do ogłoszenia', color: 'warning', icon: 'i-lucide-link' })
    return
  }

  analyzing.value = true
  preview.value = null
  selectedImageUrls.value = []
  try {
    const response = await $fetch<{ data: PropertyImportPreview }>(
      crmApiPath(`/cases/${caseId.value}/properties/import/preview`),
      { method: 'POST', body: { url } },
    )
    applyPreview(response.data)
    toast.add({
      title: 'Ogłoszenie przeanalizowane',
      description: 'Sprawdź pola i wybierz zdjęcia przed zapisem.',
      color: 'success',
      icon: 'i-lucide-sparkles',
    })
  }
  catch (caught) {
    toast.add({
      title: 'Nie udało się przeanalizować linku',
      description: errorMessage(caught),
      color: 'error',
      icon: 'i-lucide-triangle-alert',
    })
  }
  finally {
    analyzing.value = false
  }
}

function toggleImage(url: string) {
  if (selectedImageUrls.value.includes(url)) {
    selectedImageUrls.value = selectedImageUrls.value.filter(item => item !== url)
    return
  }
  if (selectedImageUrls.value.length >= 8) {
    toast.add({ title: 'Możesz zapisać maksymalnie 8 zdjęć', color: 'warning' })
    return
  }
  selectedImageUrls.value = [...selectedImageUrls.value, url]
}

async function saveImportedProperty() {
  const result = preview.value
  if (!result) return
  const response = await $fetch<{ data: CaseProperty, warnings: string[] }>(
    crmApiPath(`/cases/${caseId.value}/properties/import/commit`),
    {
      method: 'POST',
      body: {
        propertyId: props.property?.id ?? null,
        previewId: result.previewId,
        sourceUrl: result.sourceUrl,
        retrievedUrl: result.retrievedUrl,
        extractedAt: result.extractedAt,
        listingTitle: optionalText(importDetails.listingTitle),
        description: optionalText(importDetails.description),
        address: form.address.trim(),
        city: optionalText(form.city),
        postalCode: optionalText(form.postal_code),
        propertyType: optionalText(form.property_type),
        marketType: optionalText(form.market_type),
        priceAmount: finiteNumber(form.price_amount),
        currency: result.currency || props.property?.currency || 'PLN',
        areaM2: positiveNumber(form.area_m2),
        rooms: positiveNumber(form.rooms),
        floor: finiteNumber(importDetails.floor),
        buildingFloors: positiveNumber(importDetails.buildingFloors),
        yearBuilt: finiteNumber(importDetails.yearBuilt),
        landAreaM2: positiveNumber(importDetails.landAreaM2),
        monthlyFees: finiteNumber(importDetails.monthlyFees),
        ownership: optionalText(importDetails.ownership),
        condition: optionalText(importDetails.condition),
        heating: optionalText(importDetails.heating),
        externalId: optionalText(importDetails.externalId),
        sourcePublishedAt: optionalText(importDetails.sourcePublishedAt),
        pricePerM2: finiteNumber(importDetails.pricePerM2),
        features: parsedFeatures(),
        confidence: result.confidence,
        warnings: result.warnings,
        images: result.images
          .filter(image => selectedImageUrls.value.includes(image.url))
          .map(image => ({ url: image.url, alt: image.alt })),
        import: {
          provider: result.import.provider,
          urlContextStatus: result.import.urlContextStatus,
          citations: result.import.citations,
        },
      },
    },
  )
  return response
}

async function saveProperty(_event: FormSubmitEvent<PropertyFormState>) {
  if (saving.value || analyzing.value || !caseId.value) return
  if (mode.value === 'import' && !preview.value) return

  saving.value = true
  try {
    if (mode.value === 'import') {
      const response = await saveImportedProperty()
      toast.add({
        title: props.property ? 'Zaktualizowano nieruchomość' : 'Zaimportowano nieruchomość',
        description: response?.warnings.length
          ? `Dane zapisano. ${response.warnings.length} zdjęć wymagało pominięcia.`
          : `${selectedImageCount.value} ${selectedImageNoun.value} zapisano w sprawie.`,
        color: response?.warnings.length ? 'warning' : 'success',
        icon: response?.warnings.length ? 'i-lucide-triangle-alert' : 'i-lucide-circle-check',
      })
    }
    else {
      const body = {
        address: form.address.trim(),
        city: optionalText(form.city),
        postal_code: optionalText(form.postal_code),
        property_type: optionalText(form.property_type),
        market_type: optionalText(form.market_type),
        price_amount: finiteNumber(form.price_amount),
        appraisal_value_amount: positiveNumber(form.appraisal_value_amount),
        currency: props.property?.currency ?? 'PLN',
        area_m2: finiteNumber(form.area_m2),
        rooms: finiteNumber(form.rooms),
      }
      const endpoint = props.property
        ? crmApiPath(`/cases/${caseId.value}/properties/${props.property.id}`)
        : crmApiPath(`/cases/${caseId.value}/properties`)
      await $fetch(endpoint, { method: props.property ? 'PATCH' : 'POST', body })
      toast.add({
        title: props.property ? 'Zaktualizowano nieruchomość' : 'Dodano nieruchomość',
        description: form.address.trim(),
        color: 'success',
        icon: 'i-lucide-circle-check',
      })
    }
    emit('saved')
    emit('update:open', false)
  }
  catch (caught) {
    toast.add({
      title: 'Nie udało się zapisać nieruchomości',
      description: errorMessage(caught),
      color: 'error',
      icon: 'i-lucide-triangle-alert',
    })
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <USlideover
    :default-open="open"
    @update:open="emit('update:open', $event)"
    :title="slideoverTitle"
    :description="slideoverDescription"
    :dismissible="!saving && !analyzing"
    :ui="{ content: 'sm:max-w-3xl' }"
  >
    <template #body>
      <div class="property-mode" role="tablist" aria-label="Sposób dodania nieruchomości">
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'import'"
          :class="{ active: mode === 'import' }"
          @click="mode = 'import'"
        >
          <UIcon name="i-lucide-sparkles" />
          Import z ogłoszenia
          <UBadge color="primary" variant="subtle" size="xs">Gemini</UBadge>
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'manual'"
          :class="{ active: mode === 'manual' }"
          @click="mode = 'manual'"
        >
          <UIcon name="i-lucide-pencil-line" />
          Wpisz ręcznie
        </button>
      </div>

      <section v-if="mode === 'import'" class="import-workspace" aria-labelledby="property-import-heading">
        <div class="import-hero">
          <span class="import-hero__icon"><UIcon name="i-lucide-link-2" /></span>
          <div>
            <h3 id="property-import-heading">Wklej link do dowolnego publicznego ogłoszenia</h3>
            <p>Gemini 3.5 Flash-Lite odczyta opis, cenę, parametry i kandydatów zdjęć. Nic nie zapisze bez Twojego zatwierdzenia.</p>
          </div>
        </div>
        <form class="url-form" @submit.prevent="analyzeLink">
          <UInput
            v-model="importUrl"
            class="w-full"
            type="url"
            inputmode="url"
            autocomplete="url"
            icon="i-lucide-globe-2"
            placeholder="https://portal.pl/oferta/..."
            :disabled="analyzing || saving"
          />
          <UButton
            type="submit"
            icon="i-lucide-wand-sparkles"
            :loading="analyzing"
            :disabled="saving || !importUrl.trim()"
          >
            {{ preview ? 'Analizuj ponownie' : 'Analizuj link' }}
          </UButton>
        </form>
        <p class="privacy-note"><UIcon name="i-lucide-shield-check" /> Obsługiwane są publiczne linki HTTP/HTTPS. Zdjęcia trafią do prywatnej przestrzeni tej sprawy.</p>

        <div v-if="analyzing" class="analysis-state" aria-live="polite">
          <span><UIcon name="i-lucide-loader-circle" class="spin" /></span>
          <div><strong>Gemini analizuje ogłoszenie</strong><p>Odczytujemy stronę, rozpoznajemy pola i szukamy właściwych zdjęć.</p></div>
        </div>

        <template v-if="preview && !analyzing">
          <div class="review-heading">
            <div>
              <span class="review-heading__check"><UIcon name="i-lucide-check" /></span>
              <div><strong>Podgląd gotowy do weryfikacji</strong><p>AI może się pomylić — sprawdź dane przed zapisem.</p></div>
            </div>
            <UBadge :color="confidenceColor" variant="subtle">{{ confidenceLabel }} · {{ Math.round(preview.confidence * 100) }}%</UBadge>
          </div>

          <UAlert
            v-if="preview.warnings.length"
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="Sprawdź przed zapisem"
            :description="preview.warnings.join(' ')"
          />

          <section v-if="preview.images.length" class="photo-review" aria-labelledby="photo-review-title">
            <header>
              <div><h3 id="photo-review-title">Zdjęcia ogłoszenia</h3><p>Wybierz maksymalnie 8 zdjęć do zapisania.</p></div>
              <UBadge color="neutral" variant="subtle">{{ selectedImageCount }}/8 wybranych</UBadge>
            </header>
            <div class="photo-grid">
              <button
                v-for="(image, index) in preview.images"
                :key="image.url"
                type="button"
                :class="{ selected: selectedImageUrls.includes(image.url) }"
                :aria-pressed="selectedImageUrls.includes(image.url)"
                @click="toggleImage(image.url)"
              >
                <img :src="image.url" :alt="image.alt || `Zdjęcie ${index + 1}`" loading="lazy" referrerpolicy="no-referrer">
                <span class="photo-check"><UIcon :name="selectedImageUrls.includes(image.url) ? 'i-lucide-check' : 'i-lucide-plus'" /></span>
              </button>
            </div>
          </section>
        </template>
      </section>

      <UForm
        v-if="mode === 'manual' || preview"
        id="case-property-form"
        :state="form"
        :validate="validateProperty"
        :validate-on="['blur', 'change']"
        class="property-form"
        @submit="saveProperty"
      >
        <section v-if="mode === 'import'" class="form-section" aria-labelledby="listing-description-heading">
          <div class="section-heading">
            <span class="section-icon"><UIcon name="i-lucide-file-text" /></span>
            <div><h3 id="listing-description-heading">Ogłoszenie</h3><p>Tytuł i opis zapiszą się razem ze źródłem importu.</p></div>
          </div>
          <div class="form-grid">
            <UFormField class="full" label="Tytuł ogłoszenia">
              <UInput v-model="importDetails.listingTitle" class="w-full" :maxlength="500" />
            </UFormField>
            <UFormField class="full" label="Opis nieruchomości">
              <UTextarea v-model="importDetails.description" class="w-full" :rows="6" :maxlength="50000" autoresize />
            </UFormField>
          </div>
        </section>

        <USeparator v-if="mode === 'import'" />

        <section class="form-section" aria-labelledby="property-location-heading">
          <div class="section-heading">
            <span class="section-icon"><UIcon name="i-lucide-map-pin-house" /></span>
            <div><h3 id="property-location-heading">Lokalizacja</h3><p>Adres jest wymagany, bo będzie używany w dokumentach bankowych i ubezpieczeniowych.</p></div>
          </div>
          <div class="form-grid">
            <UFormField class="full" name="address" label="Adres lub ujawniona lokalizacja" required>
              <UInput v-model="form.address" class="w-full" autocomplete="street-address" :maxlength="500" placeholder="ul. Przykładowa 12/4 lub dzielnica" />
            </UFormField>
            <UFormField name="postal_code" label="Kod pocztowy">
              <UInput v-model="form.postal_code" class="w-full" autocomplete="postal-code" :maxlength="32" placeholder="00-001" />
            </UFormField>
            <UFormField name="city" label="Miejscowość">
              <UInput v-model="form.city" class="w-full" autocomplete="address-level2" :maxlength="160" placeholder="Warszawa" />
            </UFormField>
          </div>
        </section>

        <USeparator />

        <section class="form-section" aria-labelledby="property-details-heading">
          <div class="section-heading">
            <span class="section-icon"><UIcon name="i-lucide-building-2" /></span>
            <div><h3 id="property-details-heading">Najważniejsze parametry</h3><p>Te pola trafią do danych sprawy i Multiwniosku.</p></div>
          </div>
          <div class="form-grid">
            <UFormField name="property_type" label="Typ nieruchomości">
              <USelect v-model="form.property_type" class="w-full" :items="propertyTypeItems" value-key="value" placeholder="Wybierz typ" />
            </UFormField>
            <UFormField name="market_type" label="Rynek">
              <USelect v-model="form.market_type" class="w-full" :items="marketTypeItems" value-key="value" placeholder="Wybierz rynek" />
            </UFormField>
            <UFormField class="full" name="price_amount" label="Cena nieruchomości" :description="!property && scenarioValue && !preview ? 'Podpowiedź pochodzi z aktywnego scenariusza kredytowego.' : undefined">
              <UInputNumber v-model="form.price_amount" class="w-full" :min="0" :step="1000" :format-options="{ style: 'currency', currency: preview?.currency ?? property?.currency ?? 'PLN', maximumFractionDigits: 0 }" />
            </UFormField>
            <UFormField class="full" name="appraisal_value_amount" label="Wartość z operatu szacunkowego" description="Pozostaw puste do czasu otrzymania operatu. Oferty wymagające wyceny pozostaną wtedy niegotowe do wniosku.">
              <UInputNumber v-model="form.appraisal_value_amount" class="w-full" :min="1" :step="1000" :format-options="{ style: 'currency', currency: preview?.currency ?? property?.currency ?? 'PLN', maximumFractionDigits: 0 }" />
            </UFormField>
            <UFormField name="area_m2" label="Powierzchnia (m²)">
              <UInputNumber v-model="form.area_m2" class="w-full" :min="0.01" :step="0.1" :format-options="{ maximumFractionDigits: 2 }" />
            </UFormField>
            <UFormField name="rooms" label="Liczba pokoi">
              <UInputNumber v-model="form.rooms" class="w-full" :min="1" :step="1" :format-options="{ maximumFractionDigits: 1 }" />
            </UFormField>
          </div>
        </section>

        <template v-if="mode === 'import'">
          <USeparator />
          <section class="form-section" aria-labelledby="property-extra-heading">
            <div class="section-heading">
              <span class="section-icon"><UIcon name="i-lucide-list-tree" /></span>
              <div><h3 id="property-extra-heading">Dodatkowe informacje</h3><p>Gemini uzupełnia je tylko wtedy, gdy znalazł je w ogłoszeniu.</p></div>
            </div>
            <div class="form-grid form-grid--three">
              <UFormField label="Piętro"><UInputNumber v-model="importDetails.floor" class="w-full" :step="1" /></UFormField>
              <UFormField label="Liczba pięter"><UInputNumber v-model="importDetails.buildingFloors" class="w-full" :min="1" :step="1" /></UFormField>
              <UFormField label="Rok budowy"><UInputNumber v-model="importDetails.yearBuilt" class="w-full" :min="1700" :max="2200" :step="1" /></UFormField>
              <UFormField label="Powierzchnia działki (m²)"><UInputNumber v-model="importDetails.landAreaM2" class="w-full" :min="0" :step="1" /></UFormField>
              <UFormField label="Opłaty miesięczne"><UInputNumber v-model="importDetails.monthlyFees" class="w-full" :min="0" :step="10" /></UFormField>
              <UFormField label="Cena za m²"><UInputNumber v-model="importDetails.pricePerM2" class="w-full" :min="0" :step="100" /></UFormField>
              <UFormField label="Forma własności"><UInput v-model="importDetails.ownership" class="w-full" :maxlength="200" /></UFormField>
              <UFormField label="Stan"><UInput v-model="importDetails.condition" class="w-full" :maxlength="200" /></UFormField>
              <UFormField label="Ogrzewanie"><UInput v-model="importDetails.heating" class="w-full" :maxlength="200" /></UFormField>
              <UFormField class="full" label="Cechy (jedna w linii)"><UTextarea v-model="importDetails.featuresText" class="w-full" :rows="3" placeholder="Balkon&#10;Garaż&#10;Winda" /></UFormField>
            </div>
          </section>

          <details v-if="preview?.evidence.length" class="ai-evidence">
            <summary><UIcon name="i-lucide-quote" /> Dlaczego AI uzupełniło te pola?</summary>
            <ul><li v-for="item in preview.evidence" :key="`${item.field}:${item.snippet}`"><strong>{{ item.field }}</strong><span>{{ item.snippet }}</span></li></ul>
          </details>
        </template>

        <section v-if="mode === 'manual' && property?.images?.length" class="saved-gallery" aria-labelledby="saved-gallery-title">
          <div class="section-heading">
            <span class="section-icon"><UIcon name="i-lucide-images" /></span>
            <div><h3 id="saved-gallery-title">Zdjęcia zapisane w sprawie</h3><p>{{ property.images.length }} prywatnych plików z importu.</p></div>
          </div>
          <div class="saved-gallery__grid"><img v-for="image in property.images" :key="image.id" :src="image.url ?? ''" :alt="image.alt_text ?? property.address" loading="lazy"></div>
        </section>
      </UForm>
    </template>

    <template #footer>
      <div class="slideover-footer">
        <p v-if="mode === 'import'"><UIcon name="i-lucide-bot" /> Gemini 3.5 Flash-Lite · zapis dopiero po weryfikacji</p>
        <p v-else><UIcon name="i-lucide-link-2" /> Dane zostaną powiązane z bieżącą sprawą.</p>
        <div class="footer-actions">
          <UButton color="neutral" variant="ghost" :disabled="saving || analyzing" @click="closePanel">Anuluj</UButton>
          <UButton
            v-if="mode === 'import' && !preview"
            icon="i-lucide-wand-sparkles"
            :loading="analyzing"
            :disabled="saving || !importUrl.trim()"
            @click="analyzeLink"
          >
            Analizuj link
          </UButton>
          <UButton v-else type="submit" form="case-property-form" icon="i-lucide-save" :loading="saving" :disabled="analyzing">
            <template v-if="mode === 'import'">Zapisz dane i {{ selectedImageCount }} {{ selectedImageNoun }}</template>
            <template v-else>{{ isEditing ? 'Zapisz zmiany' : 'Dodaj nieruchomość' }}</template>
          </UButton>
        </div>
      </div>
    </template>
  </USlideover>
</template>

<style scoped>
.property-form,
.form-section,
.import-workspace {
  display: grid;
  gap: 20px;
}

.property-form { gap: 28px; margin-top: 28px; }
.import-workspace { margin-top: 22px; }

.property-mode {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  background: var(--ui-bg-muted);
}

.property-mode button {
  display: flex;
  min-height: 42px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid transparent;
  border-radius: calc(var(--oe-radius-control) - 3px);
  color: var(--ui-text-muted);
  font-size: 13px;
  font-weight: 600;
  transition: .15s ease;
}

.property-mode button.active {
  border-color: var(--ui-border);
  background: var(--ui-bg);
  color: var(--ui-text-highlighted);
  box-shadow: 0 1px 2px rgb(15 23 42 / 7%);
}

.import-hero,
.section-heading,
.review-heading,
.review-heading > div,
.photo-review header,
.slideover-footer,
.slideover-footer p,
.footer-actions,
.privacy-note,
.analysis-state,
.ai-evidence summary {
  display: flex;
  align-items: flex-start;
}

.import-hero { gap: 13px; }
.import-hero__icon,
.section-icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  background: var(--ui-bg-muted);
}
.import-hero__icon { width: 42px; height: 42px; color: var(--ui-primary); font-size: 20px; }
.section-icon { width: 36px; height: 36px; color: var(--ui-text-highlighted); }
.section-icon :deep(svg) { width: 18px; height: 18px; }

.import-hero h3,
.import-hero p,
.section-heading h3,
.section-heading p,
.review-heading p,
.photo-review h3,
.photo-review p,
.analysis-state p,
.privacy-note,
.slideover-footer p { margin: 0; }
.import-hero h3,
.section-heading h3,
.photo-review h3 { color: var(--ui-text-highlighted); font-size: 15px; font-weight: 650; }
.import-hero p,
.section-heading p,
.photo-review p,
.review-heading p,
.analysis-state p,
.privacy-note,
.slideover-footer p { color: var(--ui-text-muted); font-size: 12px; line-height: 1.55; }

.url-form { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; }
.privacy-note { align-items: center; gap: 7px; margin-top: -10px; }
.privacy-note :deep(svg) { flex: 0 0 auto; color: var(--ui-success); }

.analysis-state {
  gap: 12px;
  padding: 16px;
  border: 1px solid color-mix(in srgb, var(--ui-primary) 25%, var(--ui-border));
  border-radius: var(--oe-radius-control);
  background: color-mix(in srgb, var(--ui-primary) 5%, var(--ui-bg));
}
.analysis-state > span { display: grid; width: 34px; height: 34px; flex: 0 0 auto; place-items: center; color: var(--ui-primary); }
.analysis-state strong,
.review-heading strong { display: block; color: var(--ui-text-highlighted); font-size: 13px; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.review-heading { align-items: center; justify-content: space-between; gap: 16px; padding-top: 2px; }
.review-heading > div { align-items: center; gap: 10px; }
.review-heading__check { display: grid; width: 30px; height: 30px; flex: 0 0 auto; place-items: center; border-radius: 999px; background: color-mix(in srgb, var(--ui-success) 13%, transparent); color: var(--ui-success); }

.photo-review { display: grid; gap: 12px; }
.photo-review header { align-items: center; justify-content: space-between; gap: 12px; }
.photo-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.photo-grid button { position: relative; aspect-ratio: 4 / 3; overflow: hidden; border: 2px solid transparent; border-radius: 10px; background: var(--ui-bg-muted); transition: .15s ease; }
.photo-grid button.selected { border-color: var(--ui-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-primary) 15%, transparent); }
.photo-grid img { width: 100%; height: 100%; object-fit: cover; }
.photo-check { position: absolute; top: 6px; right: 6px; display: grid; width: 24px; height: 24px; place-items: center; border: 1px solid rgb(255 255 255 / 75%); border-radius: 999px; background: rgb(15 23 42 / 68%); color: white; backdrop-filter: blur(4px); }
.photo-grid button.selected .photo-check { background: var(--ui-primary); }

.section-heading { gap: 12px; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.form-grid--three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.full { grid-column: 1 / -1; }

.ai-evidence { overflow: hidden; border: 1px solid var(--ui-border); border-radius: var(--oe-radius-control); background: var(--ui-bg-muted); }
.ai-evidence summary { align-items: center; gap: 8px; padding: 12px 14px; color: var(--ui-text-toned); cursor: pointer; font-size: 12px; font-weight: 600; }
.ai-evidence ul { display: grid; gap: 8px; max-height: 260px; overflow: auto; margin: 0; padding: 0 14px 14px; list-style: none; }
.ai-evidence li { display: grid; grid-template-columns: minmax(90px, .28fr) minmax(0, 1fr); gap: 12px; padding-top: 8px; border-top: 1px solid var(--ui-border); color: var(--ui-text-muted); font-size: 11px; }
.ai-evidence li strong { color: var(--ui-text-toned); }

.saved-gallery { display: grid; gap: 16px; padding-top: 8px; }
.saved-gallery__grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.saved-gallery__grid img { width: 100%; aspect-ratio: 4 / 3; border-radius: 9px; object-fit: cover; background: var(--ui-bg-muted); }

.slideover-footer { width: 100%; align-items: center; justify-content: space-between; gap: 16px; }
.slideover-footer p,
.footer-actions { align-items: center; gap: 8px; }
.slideover-footer p :deep(svg) { width: 15px; height: 15px; }

@media (max-width: 767px) {
  .photo-grid,
  .saved-gallery__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .form-grid--three { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 639px) {
  .property-mode,
  .form-grid,
  .form-grid--three,
  .url-form { grid-template-columns: minmax(0, 1fr); }
  .full { grid-column: auto; }
  .review-heading,
  .slideover-footer { align-items: stretch; flex-direction: column; }
  .footer-actions { justify-content: flex-end; }
}
</style>
